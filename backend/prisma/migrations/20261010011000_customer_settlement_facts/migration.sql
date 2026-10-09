BEGIN;

CREATE TABLE customer_settlement_records (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL,
  department_id uuid NOT NULL,
  current_version_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT customer_settlement_records_owner_key UNIQUE (id, customer_id, department_id),
  CONSTRAINT customer_settlement_records_customer_fkey FOREIGN KEY (customer_id, department_id)
    REFERENCES customers(id, department_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE customer_settlement_versions (
  id uuid PRIMARY KEY,
  record_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  department_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  action customer_settlement_action NOT NULL,
  settlement_date date NOT NULL,
  settlement_amount numeric NOT NULL,
  invoice_amount numeric,
  received_amount numeric,
  received_date date,
  correction_reason varchar(500),
  recorded_by_user_id uuid NOT NULL REFERENCES user_accounts(id) ON DELETE RESTRICT,
  recorded_at timestamptz(3) NOT NULL DEFAULT now(),
  audit_event_id uuid NOT NULL UNIQUE REFERENCES audit_events(id) ON DELETE RESTRICT,
  CONSTRAINT customer_settlement_versions_number_key UNIQUE (record_id, version),
  CONSTRAINT customer_settlement_versions_owner_key UNIQUE (id, record_id, customer_id, department_id),
  CONSTRAINT customer_settlement_versions_record_fkey FOREIGN KEY (record_id, customer_id, department_id)
    REFERENCES customer_settlement_records(id, customer_id, department_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT customer_settlement_versions_action_check CHECK (
    (version = 1 AND action = 'REGISTER' AND correction_reason IS NULL)
    OR (version > 1 AND action = 'CORRECT' AND correction_reason IS NOT NULL
      AND length(btrim(correction_reason)) BETWEEN 1 AND 500)
  ),
  CONSTRAINT customer_settlement_versions_settlement_amount_check CHECK (
    scale(settlement_amount) <= 2 AND settlement_amount >= 0
    AND settlement_amount < 10000000000000000 AND settlement_amount <> 'NaN'::numeric
  ),
  CONSTRAINT customer_settlement_versions_invoice_amount_check CHECK (
    invoice_amount IS NULL OR (scale(invoice_amount) <= 2 AND invoice_amount >= 0
    AND invoice_amount < 10000000000000000 AND invoice_amount <> 'NaN'::numeric)
  ),
  CONSTRAINT customer_settlement_versions_received_amount_check CHECK (
    received_amount IS NULL OR (scale(received_amount) <= 2 AND received_amount >= 0
    AND received_amount < 10000000000000000 AND received_amount <> 'NaN'::numeric)
  )
);
ALTER TABLE customer_settlement_records ADD CONSTRAINT customer_settlement_records_current_fkey
  FOREIGN KEY (current_version_id, id, customer_id, department_id)
  REFERENCES customer_settlement_versions(id, record_id, customer_id, department_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX customer_settlement_records_customer_idx ON customer_settlement_records(customer_id, department_id);
CREATE INDEX customer_settlement_versions_current_sort_idx
  ON customer_settlement_versions(customer_id, department_id, settlement_date DESC, record_id DESC);

CREATE TABLE customer_settlement_receipts (
  id uuid PRIMARY KEY,
  department_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  action customer_settlement_action NOT NULL,
  idempotency_key varchar(200) NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_fingerprint char(64) NOT NULL,
  customer_id uuid NOT NULL,
  record_id uuid NOT NULL,
  result_version_id uuid NOT NULL,
  result_customer_version integer NOT NULL CHECK (result_customer_version > 0),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT customer_settlement_receipts_actor_key UNIQUE (department_id, actor_user_id, action, idempotency_key),
  CONSTRAINT customer_settlement_receipts_actor_fkey FOREIGN KEY (actor_user_id, department_id)
    REFERENCES department_memberships(user_id, department_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT customer_settlement_receipts_record_fkey FOREIGN KEY (record_id, customer_id, department_id)
    REFERENCES customer_settlement_records(id, customer_id, department_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT customer_settlement_receipts_version_fkey FOREIGN KEY (result_version_id, record_id, customer_id, department_id)
    REFERENCES customer_settlement_versions(id, record_id, customer_id, department_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX customer_settlement_receipts_customer_idx ON customer_settlement_receipts(customer_id, department_id);

CREATE FUNCTION customer_settlement_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM customers WHERE id = NEW.customer_id AND department_id = NEW.department_id
    AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'customer unavailable for settlement' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_settlement_record_parent BEFORE INSERT OR UPDATE ON customer_settlement_records
  FOR EACH ROW EXECUTE FUNCTION customer_settlement_parent_guard();
CREATE TRIGGER customer_settlement_version_parent BEFORE INSERT ON customer_settlement_versions
  FOR EACH ROW EXECUTE FUNCTION customer_settlement_parent_guard();
CREATE TRIGGER customer_settlement_receipt_parent BEFORE INSERT ON customer_settlement_receipts
  FOR EACH ROW EXECUTE FUNCTION customer_settlement_parent_guard();

CREATE FUNCTION customer_settlement_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'settlement history is immutable' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER customer_settlement_version_immutable BEFORE UPDATE OR DELETE ON customer_settlement_versions
  FOR EACH ROW EXECUTE FUNCTION customer_settlement_immutable();
CREATE TRIGGER customer_settlement_receipt_immutable BEFORE UPDATE OR DELETE ON customer_settlement_receipts
  FOR EACH ROW EXECUTE FUNCTION customer_settlement_immutable();
CREATE TRIGGER customer_settlement_record_no_delete BEFORE DELETE ON customer_settlement_records
  FOR EACH ROW EXECUTE FUNCTION customer_settlement_immutable();

CREATE FUNCTION customer_settlement_version_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_number integer; latest integer;
BEGIN
  SELECT version INTO current_number FROM customer_settlement_records WHERE id = NEW.record_id FOR UPDATE;
  SELECT max(version) INTO latest FROM customer_settlement_versions WHERE record_id = NEW.record_id;
  IF (latest IS NULL AND (NEW.version <> 1 OR NEW.action <> 'REGISTER'))
    OR (latest IS NOT NULL AND (NEW.version <> latest + 1 OR NEW.action <> 'CORRECT')) THEN
    RAISE EXCEPTION 'settlement versions must advance consecutively' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM audit_events a WHERE a.id = NEW.audit_event_id
      AND a.department_id = NEW.department_id AND a.actor_user_id = NEW.recorded_by_user_id
      AND a.resource_type = 'customer_settlement' AND a.resource_id = NEW.record_id
      AND a.action = CASE WHEN NEW.action = 'REGISTER' THEN 'customer.settlement.register' ELSE 'customer.settlement.correct' END
  ) THEN RAISE EXCEPTION 'settlement audit mismatch' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_settlement_version_insert BEFORE INSERT ON customer_settlement_versions
  FOR EACH ROW EXECUTE FUNCTION customer_settlement_version_insert_guard();

CREATE FUNCTION customer_settlement_record_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.customer_id, NEW.department_id, NEW.created_at) IS DISTINCT FROM
     (OLD.id, OLD.customer_id, OLD.department_id, OLD.created_at)
    OR NEW.version < OLD.version OR NEW.version > OLD.version + 1
    OR (OLD.current_version_id IS NOT NULL AND NEW.version = OLD.version)
    OR NEW.current_version_id IS NOT DISTINCT FROM OLD.current_version_id THEN
    RAISE EXCEPTION 'settlement head cannot retreat or change identity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_settlement_record_update BEFORE UPDATE ON customer_settlement_records
  FOR EACH ROW EXECUTE FUNCTION customer_settlement_record_update_guard();

CREATE FUNCTION customer_settlement_current_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entity_id uuid; current_id uuid; current_number integer; maximum_number integer;
        owner_customer_id uuid; owner_department_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'customer_settlement_records' THEN entity_id := NEW.id;
  ELSE entity_id := NEW.record_id; END IF;
  SELECT r.current_version_id, r.version, r.customer_id, r.department_id
    INTO current_id, current_number, owner_customer_id, owner_department_id
    FROM customer_settlement_records r WHERE r.id = entity_id;
  SELECT max(v.version) INTO maximum_number FROM customer_settlement_versions v WHERE v.record_id = entity_id;
  IF current_id IS NULL OR current_number IS DISTINCT FROM maximum_number OR NOT EXISTS (
    SELECT 1 FROM customer_settlement_versions v WHERE v.id = current_id
      AND v.record_id = entity_id AND v.customer_id = owner_customer_id
      AND v.department_id = owner_department_id AND v.version = current_number
  ) THEN RAISE EXCEPTION 'settlement current version is not latest' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER customer_settlement_record_head AFTER INSERT OR UPDATE ON customer_settlement_records
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_settlement_current_guard();
CREATE CONSTRAINT TRIGGER customer_settlement_version_head AFTER INSERT ON customer_settlement_versions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_settlement_current_guard();

CREATE FUNCTION customer_settlement_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.action IN ('customer.settlement.register','customer.settlement.correct')
    OR OLD.resource_type = 'customer_settlement'
    OR (TG_OP = 'UPDATE' AND (NEW.action IN ('customer.settlement.register','customer.settlement.correct')
      OR NEW.resource_type = 'customer_settlement'))
    OR EXISTS (SELECT 1 FROM customer_settlement_versions v WHERE v.audit_event_id = OLD.id) THEN
    RAISE EXCEPTION 'settlement audit is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_settlement_audit_seal BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION customer_settlement_audit_immutable();

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
      OR EXISTS (SELECT 1 FROM customer_settlement_records WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_settlement_versions WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_settlement_receipts WHERE customer_id = NEW.id)
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
