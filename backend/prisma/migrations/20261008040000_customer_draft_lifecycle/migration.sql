ALTER TYPE permission_action ADD VALUE 'customer.delete-draft';
ALTER TYPE permission_action ADD VALUE 'customer.restore-draft';

CREATE TYPE customer_draft_lifecycle_action AS ENUM ('DELETE', 'RESTORE');

ALTER TABLE customers ADD COLUMN ever_admitted boolean NOT NULL DEFAULT false,
  ADD COLUMN deleted_at timestamptz(3),
  ADD COLUMN deleted_by_user_id uuid,
  ADD COLUMN deletion_reason varchar(500),
  ADD CONSTRAINT customers_deleted_state_check CHECK (
    (deleted_at IS NULL AND deleted_by_user_id IS NULL AND deletion_reason IS NULL)
    OR (deleted_at IS NOT NULL AND deleted_by_user_id IS NOT NULL
        AND profile_status = 'DRAFT' AND admitted_at IS NULL)
  );

UPDATE customers SET ever_admitted = true
WHERE profile_status = 'ADMITTED' OR admitted_at IS NOT NULL
  OR EXISTS (SELECT 1 FROM customer_admission_receipts WHERE result_customer_id = customers.id)
  OR EXISTS (SELECT 1 FROM audit_events WHERE resource_type = 'customer'
    AND resource_id = customers.id AND department_id = customers.department_id
    AND action = 'customer.admitted');

CREATE FUNCTION customer_ever_admitted_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.ever_admitted := NEW.ever_admitted OR NEW.profile_status = 'ADMITTED' OR NEW.admitted_at IS NOT NULL;
  ELSE
    NEW.ever_admitted := OLD.ever_admitted OR NEW.ever_admitted
      OR OLD.profile_status = 'ADMITTED' OR OLD.admitted_at IS NOT NULL
      OR NEW.profile_status = 'ADMITTED' OR NEW.admitted_at IS NOT NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customers_ever_admitted_guard BEFORE INSERT OR UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION customer_ever_admitted_guard();

CREATE TABLE customer_draft_lifecycle_facts (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL,
  department_id uuid NOT NULL,
  action customer_draft_lifecycle_action NOT NULL,
  actor_user_id uuid NOT NULL,
  from_version integer NOT NULL,
  to_version integer NOT NULL,
  reason varchar(500),
  audit_event_id uuid NOT NULL UNIQUE REFERENCES audit_events(id) ON DELETE RESTRICT,
  occurred_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT customer_draft_lifecycle_facts_customer_fkey FOREIGN KEY (customer_id, department_id)
    REFERENCES customers(id, department_id) ON DELETE RESTRICT,
  CONSTRAINT customer_draft_lifecycle_facts_version_check CHECK (to_version = from_version + 1),
  UNIQUE (customer_id, to_version)
);
CREATE INDEX customer_draft_lifecycle_facts_lookup_idx ON customer_draft_lifecycle_facts(department_id, customer_id, occurred_at);

CREATE TABLE customer_draft_lifecycle_receipts (
  id uuid PRIMARY KEY,
  department_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  request_fingerprint char(64) NOT NULL,
  action customer_draft_lifecycle_action NOT NULL,
  customer_id uuid NOT NULL,
  result_snapshot jsonb NOT NULL,
  fact_id uuid NOT NULL UNIQUE REFERENCES customer_draft_lifecycle_facts(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT customer_draft_lifecycle_receipts_customer_fkey FOREIGN KEY (customer_id, department_id)
    REFERENCES customers(id, department_id) ON DELETE RESTRICT,
  UNIQUE (department_id, actor_user_id, idempotency_key)
);

CREATE FUNCTION customer_draft_association_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_id uuid;
  target_customer customers%ROWTYPE;
BEGIN
  IF TG_ARGV[0] = 'polymorphic' THEN
    IF (to_jsonb(NEW)->>'owner_type') <> 'CUSTOMER' THEN RETURN NEW; END IF;
    target_id := (to_jsonb(NEW)->>'owner_id')::uuid;
  ELSE
    target_id := (to_jsonb(NEW)->>'customer_id')::uuid;
  END IF;
  IF target_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO target_customer FROM customers WHERE id = target_id FOR SHARE;
  IF NOT FOUND OR target_customer.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'customer unavailable for business association' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION customer_draft_deletion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    IF NEW.id <> OLD.id OR NEW.department_id <> OLD.department_id OR NEW.profile_status <> 'DRAFT' THEN
      RAISE EXCEPTION 'invalid customer restore' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    IF NEW.profile_status <> 'DRAFT' OR NEW.admitted_at IS NOT NULL OR NEW.ever_admitted
      OR EXISTS (SELECT 1 FROM customer_admission_receipts WHERE result_customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_rights_holder_links WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_account_bindings WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_right_assets WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_right_asset_versions WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_right_asset_receipts WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM leads WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM cases WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM upload_drafts WHERE owner_type = 'CUSTOMER' AND owner_id = NEW.id)
      OR EXISTS (SELECT 1 FROM materials WHERE owner_type = 'CUSTOMER' AND owner_id = NEW.id)
    THEN
      RAISE EXCEPTION 'customer draft has business history' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'deleted customer is immutable until restore' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customers_draft_deletion_guard BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION customer_draft_deletion_guard();

CREATE TRIGGER customer_holder_link_parent_guard BEFORE INSERT OR UPDATE ON customer_rights_holder_links
  FOR EACH ROW EXECUTE FUNCTION customer_draft_association_guard();
CREATE TRIGGER customer_account_binding_parent_guard BEFORE INSERT OR UPDATE ON customer_account_bindings
  FOR EACH ROW EXECUTE FUNCTION customer_draft_association_guard();
CREATE TRIGGER customer_asset_parent_guard BEFORE INSERT OR UPDATE ON customer_right_assets
  FOR EACH ROW EXECUTE FUNCTION customer_draft_association_guard();
CREATE TRIGGER customer_asset_version_parent_guard BEFORE INSERT OR UPDATE ON customer_right_asset_versions
  FOR EACH ROW EXECUTE FUNCTION customer_draft_association_guard();
CREATE TRIGGER customer_asset_receipt_parent_guard BEFORE INSERT OR UPDATE ON customer_right_asset_receipts
  FOR EACH ROW EXECUTE FUNCTION customer_draft_association_guard();
CREATE TRIGGER customer_lead_parent_guard BEFORE INSERT OR UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION customer_draft_association_guard();
CREATE TRIGGER customer_case_parent_guard BEFORE INSERT OR UPDATE ON cases
  FOR EACH ROW EXECUTE FUNCTION customer_draft_association_guard();
CREATE TRIGGER customer_upload_draft_parent_guard BEFORE INSERT OR UPDATE ON upload_drafts
  FOR EACH ROW EXECUTE FUNCTION customer_draft_association_guard('polymorphic');
CREATE TRIGGER customer_material_parent_guard BEFORE INSERT OR UPDATE ON materials
  FOR EACH ROW EXECUTE FUNCTION customer_draft_association_guard('polymorphic');

CREATE FUNCTION customer_draft_lifecycle_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'customer draft lifecycle evidence is immutable' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER customer_draft_fact_immutable BEFORE UPDATE OR DELETE ON customer_draft_lifecycle_facts
  FOR EACH ROW EXECUTE FUNCTION customer_draft_lifecycle_immutable();
CREATE TRIGGER customer_draft_receipt_immutable BEFORE UPDATE OR DELETE ON customer_draft_lifecycle_receipts
  FOR EACH ROW EXECUTE FUNCTION customer_draft_lifecycle_immutable();
