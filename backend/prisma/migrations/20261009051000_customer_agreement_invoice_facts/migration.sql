BEGIN;

CREATE TABLE customer_agreements (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL,
  department_id uuid NOT NULL,
  current_version_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT customer_agreements_customer_department_key UNIQUE (customer_id, department_id),
  CONSTRAINT customer_agreements_id_customer_department_key UNIQUE (id, customer_id, department_id),
  CONSTRAINT customer_agreements_customer_fkey FOREIGN KEY (customer_id, department_id)
    REFERENCES customers(id, department_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE customer_agreement_versions (
  id uuid PRIMARY KEY,
  agreement_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  department_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  title varchar(200) NOT NULL CHECK (length(btrim(title)) > 0),
  model varchar(100),
  settlement_method varchar(200),
  validity_mode customer_agreement_validity_mode NOT NULL,
  effective_from date,
  effective_to date,
  content_version_ids uuid[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(content_version_ids) <= 10),
  recorded_by_user_id uuid NOT NULL REFERENCES user_accounts(id) ON DELETE RESTRICT,
  recorded_at timestamptz(3) NOT NULL DEFAULT now(),
  audit_event_id uuid NOT NULL UNIQUE REFERENCES audit_events(id) ON DELETE RESTRICT,
  CONSTRAINT customer_agreement_versions_agreement_version_key UNIQUE (agreement_id, version),
  CONSTRAINT customer_agreement_versions_composite_key UNIQUE (id, agreement_id, customer_id, department_id),
  CONSTRAINT customer_agreement_versions_owner_fkey FOREIGN KEY (agreement_id, customer_id, department_id)
    REFERENCES customer_agreements(id, customer_id, department_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT customer_agreement_versions_dates_check CHECK (
    ((validity_mode = 'FIXED' AND effective_to IS NOT NULL) OR
     (validity_mode <> 'FIXED' AND effective_to IS NULL)) AND
    (effective_from IS NULL OR effective_to IS NULL OR effective_from <= effective_to)
  )
);
ALTER TABLE customer_agreements ADD CONSTRAINT customer_agreements_current_fkey
  FOREIGN KEY (current_version_id, id, customer_id, department_id)
  REFERENCES customer_agreement_versions(id, agreement_id, customer_id, department_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX customer_agreement_versions_history_idx
  ON customer_agreement_versions(customer_id, department_id, version DESC, id DESC);

CREATE TABLE customer_invoice_profiles (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL,
  department_id uuid NOT NULL,
  current_version_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT customer_invoice_profiles_customer_department_key UNIQUE (customer_id, department_id),
  CONSTRAINT customer_invoice_profiles_id_customer_department_key UNIQUE (id, customer_id, department_id),
  CONSTRAINT customer_invoice_profiles_customer_fkey FOREIGN KEY (customer_id, department_id)
    REFERENCES customers(id, department_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE customer_invoice_profile_versions (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  department_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  invoice_type varchar(100),
  invoice_subject varchar(200),
  tax_no varchar(100),
  bank varchar(500),
  recorded_by_user_id uuid NOT NULL REFERENCES user_accounts(id) ON DELETE RESTRICT,
  recorded_at timestamptz(3) NOT NULL DEFAULT now(),
  audit_event_id uuid NOT NULL UNIQUE REFERENCES audit_events(id) ON DELETE RESTRICT,
  CONSTRAINT customer_invoice_profile_versions_profile_version_key UNIQUE (profile_id, version),
  CONSTRAINT customer_invoice_profile_versions_composite_key UNIQUE (id, profile_id, customer_id, department_id),
  CONSTRAINT customer_invoice_profile_versions_owner_fkey FOREIGN KEY (profile_id, customer_id, department_id)
    REFERENCES customer_invoice_profiles(id, customer_id, department_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
ALTER TABLE customer_invoice_profiles ADD CONSTRAINT customer_invoice_profiles_current_fkey
  FOREIGN KEY (current_version_id, id, customer_id, department_id)
  REFERENCES customer_invoice_profile_versions(id, profile_id, customer_id, department_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX customer_invoice_profile_versions_history_idx
  ON customer_invoice_profile_versions(customer_id, department_id, version DESC, id DESC);

CREATE TABLE customer_agreement_invoice_receipts (
  id uuid PRIMARY KEY,
  department_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  action varchar(40) NOT NULL CHECK (action IN ('AGREEMENT_CREATE','AGREEMENT_REVISE','INVOICE_CREATE','INVOICE_REVISE')),
  idempotency_key varchar(200) NOT NULL CHECK (length(idempotency_key) > 0),
  request_fingerprint char(64) NOT NULL,
  customer_id uuid NOT NULL,
  result_snapshot jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT customer_agreement_invoice_receipts_actor_key UNIQUE (department_id, actor_user_id, action, idempotency_key),
  CONSTRAINT customer_agreement_invoice_receipts_customer_fkey FOREIGN KEY (customer_id, department_id)
    REFERENCES customers(id, department_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT customer_agreement_invoice_receipts_actor_fkey FOREIGN KEY (actor_user_id, department_id)
    REFERENCES department_memberships(user_id, department_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX customer_agreement_invoice_receipts_customer_idx
  ON customer_agreement_invoice_receipts(customer_id, department_id);

CREATE FUNCTION customer_agreement_invoice_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent customers%ROWTYPE;
BEGIN
  SELECT * INTO parent FROM customers WHERE id = NEW.customer_id AND department_id = NEW.department_id FOR SHARE;
  IF NOT FOUND OR parent.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'customer unavailable for agreement or invoice' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_agreement_parent_guard BEFORE INSERT OR UPDATE ON customer_agreements
  FOR EACH ROW EXECUTE FUNCTION customer_agreement_invoice_parent_guard();
CREATE TRIGGER customer_invoice_parent_guard BEFORE INSERT OR UPDATE ON customer_invoice_profiles
  FOR EACH ROW EXECUTE FUNCTION customer_agreement_invoice_parent_guard();
CREATE TRIGGER customer_agreement_version_parent_guard BEFORE INSERT ON customer_agreement_versions
  FOR EACH ROW EXECUTE FUNCTION customer_agreement_invoice_parent_guard();
CREATE TRIGGER customer_invoice_version_parent_guard BEFORE INSERT ON customer_invoice_profile_versions
  FOR EACH ROW EXECUTE FUNCTION customer_agreement_invoice_parent_guard();
CREATE TRIGGER customer_agreement_invoice_receipt_parent_guard BEFORE INSERT ON customer_agreement_invoice_receipts
  FOR EACH ROW EXECUTE FUNCTION customer_agreement_invoice_parent_guard();

CREATE FUNCTION customer_agreement_invoice_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'agreement and invoice versions are immutable' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER customer_agreement_version_immutable BEFORE UPDATE OR DELETE ON customer_agreement_versions
  FOR EACH ROW EXECUTE FUNCTION customer_agreement_invoice_version_immutable();
CREATE TRIGGER customer_invoice_version_immutable BEFORE UPDATE OR DELETE ON customer_invoice_profile_versions
  FOR EACH ROW EXECUTE FUNCTION customer_agreement_invoice_version_immutable();
CREATE TRIGGER customer_agreement_invoice_receipt_immutable BEFORE UPDATE OR DELETE ON customer_agreement_invoice_receipts
  FOR EACH ROW EXECUTE FUNCTION customer_agreement_invoice_version_immutable();

ALTER TABLE material_references ADD CONSTRAINT material_references_customer_agreement_shape_check CHECK (
  (purpose = 'CUSTOMER_AGREEMENT' AND resource_type = 'customer_agreement_version'
    AND action_event_id IS NOT NULL AND asset_version_id IS NULL)
  OR purpose <> 'CUSTOMER_AGREEMENT'
);
CREATE FUNCTION check_customer_agreement_material() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'materials' AND TG_OP = 'UPDATE' AND
    EXISTS (SELECT 1 FROM material_references r WHERE r.material_id = OLD.id AND r.purpose = 'CUSTOMER_AGREEMENT') AND
    (NEW.owner_type, NEW.owner_id, NEW.department_id, NEW.category, NEW.purpose, NEW.status)
      IS DISTINCT FROM (OLD.owner_type, OLD.owner_id, OLD.department_id, OLD.category, OLD.purpose, OLD.status) THEN
    RAISE EXCEPTION 'frozen agreement material identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.category = 'CUSTOMER_AGREEMENT' AND
    (NEW.owner_type <> 'CUSTOMER' OR NEW.purpose <> 'CUSTOMER_AGREEMENT' OR
      NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = NEW.owner_id AND c.department_id = NEW.department_id)) THEN
    RAISE EXCEPTION 'invalid agreement material owner or purpose' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER materials_customer_agreement_guard BEFORE INSERT OR UPDATE ON materials
  FOR EACH ROW EXECUTE FUNCTION check_customer_agreement_material();
CREATE TRIGGER upload_drafts_customer_agreement_guard BEFORE INSERT OR UPDATE ON upload_drafts
  FOR EACH ROW EXECUTE FUNCTION check_customer_agreement_material();

CREATE FUNCTION check_customer_agreement_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v customer_agreement_versions%ROWTYPE;
BEGIN
  IF NEW.purpose <> 'CUSTOMER_AGREEMENT' THEN RETURN NEW; END IF;
  SELECT * INTO v FROM customer_agreement_versions WHERE id = NEW.resource_id;
  IF NOT FOUND OR v.department_id <> NEW.department_id OR v.audit_event_id <> NEW.action_event_id
    OR NOT (NEW.content_version_id = ANY(v.content_version_ids)) OR NOT EXISTS (
      SELECT 1 FROM materials m JOIN content_versions cv ON cv.material_id = m.id
      WHERE m.id = NEW.material_id AND cv.id = NEW.content_version_id
        AND m.owner_type = 'CUSTOMER' AND m.owner_id = v.customer_id
        AND m.department_id = v.department_id AND m.category = 'CUSTOMER_AGREEMENT'
        AND m.purpose = 'CUSTOMER_AGREEMENT' AND m.status = 'ACTIVE'
        AND cv.status = 'AVAILABLE' AND cv.mime_type IN ('application/pdf','image/jpeg','image/png')
        AND cv.size_bytes <= 20971520
    ) THEN
    RAISE EXCEPTION 'agreement reference does not match frozen customer material' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER material_references_customer_agreement_insert_guard BEFORE INSERT ON material_references
  FOR EACH ROW EXECUTE FUNCTION check_customer_agreement_reference();
CREATE FUNCTION reject_customer_agreement_reference_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.purpose = 'CUSTOMER_AGREEMENT' OR (TG_OP = 'UPDATE' AND NEW.purpose = 'CUSTOMER_AGREEMENT') THEN
    RAISE EXCEPTION 'frozen agreement reference is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER material_references_customer_agreement_immutable BEFORE UPDATE OR DELETE ON material_references
  FOR EACH ROW EXECUTE FUNCTION reject_customer_agreement_reference_mutation();
CREATE FUNCTION check_customer_agreement_reference_set() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF cardinality(NEW.content_version_ids) <> (SELECT count(DISTINCT id) FROM unnest(NEW.content_version_ids) AS id)
    OR cardinality(NEW.content_version_ids) <> (SELECT count(*) FROM material_references WHERE purpose = 'CUSTOMER_AGREEMENT' AND resource_id = NEW.id)
    OR EXISTS (SELECT 1 FROM unnest(NEW.content_version_ids) AS id WHERE NOT EXISTS (
      SELECT 1 FROM material_references r WHERE r.purpose = 'CUSTOMER_AGREEMENT'
        AND r.resource_id = NEW.id AND r.content_version_id = id)) THEN
    RAISE EXCEPTION 'agreement frozen reference set mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER customer_agreement_reference_set_guard AFTER INSERT ON customer_agreement_versions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_customer_agreement_reference_set();
CREATE FUNCTION reject_frozen_customer_agreement_content_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM material_references WHERE purpose = 'CUSTOMER_AGREEMENT' AND content_version_id = OLD.id) THEN
    RAISE EXCEPTION 'frozen agreement content is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER content_versions_customer_agreement_immutable BEFORE UPDATE OR DELETE ON content_versions
  FOR EACH ROW EXECUTE FUNCTION reject_frozen_customer_agreement_content_mutation();

CREATE OR REPLACE FUNCTION customer_draft_deletion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    IF NEW.id <> OLD.id OR NEW.department_id <> OLD.department_id OR NEW.profile_status <> 'DRAFT'
      OR EXISTS (SELECT 1 FROM customer_admission_receipts WHERE result_customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM rights_holder_command_receipts WHERE result_customer_id = NEW.id)
    THEN RAISE EXCEPTION 'invalid customer restore' USING ERRCODE = '23514'; END IF;
  ELSIF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    IF NEW.profile_status <> 'DRAFT' OR NEW.admitted_at IS NOT NULL OR NEW.ever_admitted
      OR EXISTS (SELECT 1 FROM customer_admission_receipts WHERE result_customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM rights_holder_command_receipts WHERE result_customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_contacts WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_rights_holder_links WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_account_bindings WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_right_assets WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_right_asset_versions WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_right_asset_receipts WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_agreements WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_agreement_versions WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_invoice_profiles WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_invoice_profile_versions WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_agreement_invoice_receipts WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM leads WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM cases WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM upload_drafts WHERE owner_type = 'CUSTOMER' AND owner_id = NEW.id)
      OR EXISTS (SELECT 1 FROM materials WHERE owner_type = 'CUSTOMER' AND owner_id = NEW.id)
    THEN RAISE EXCEPTION 'customer draft has business history' USING ERRCODE = '23514'; END IF;
  ELSIF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'deleted customer is immutable until restore' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

COMMIT;
