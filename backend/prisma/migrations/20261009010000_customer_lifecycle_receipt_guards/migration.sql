BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM rights_holder_command_receipts r
    JOIN customer_rights_holder_links l ON l.id = r.result_link_id AND l.department_id = r.department_id
    WHERE l.customer_id <> r.result_customer_id OR l.rights_holder_id <> r.result_holder_id
  ) THEN
    RAISE EXCEPTION 'existing rights holder receipt/link identity mismatch' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM customer_admission_receipts r
    JOIN customers c ON c.id = r.result_customer_id AND c.department_id = r.department_id
    WHERE c.deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'existing admission receipt references deleted customer' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM rights_holder_command_receipts r
    JOIN customers c ON c.id = r.result_customer_id AND c.department_id = r.department_id
    WHERE c.deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'existing rights holder receipt references deleted customer' USING ERRCODE = '23514';
  END IF;
END $$;

UPDATE customers c SET ever_admitted = true
WHERE NOT ever_admitted AND EXISTS (
  SELECT 1 FROM customer_admission_receipts r WHERE r.result_customer_id = c.id AND r.department_id = c.department_id
);

CREATE FUNCTION customer_admission_receipt_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent customers%ROWTYPE;
BEGIN
  SELECT * INTO parent FROM customers
  WHERE id = NEW.result_customer_id AND department_id = NEW.department_id FOR SHARE;
  IF NOT FOUND OR parent.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'customer unavailable for business association' USING ERRCODE = '23514';
  END IF;
  IF parent.profile_status <> 'ADMITTED' OR parent.admitted_at IS NULL OR NOT parent.ever_admitted THEN
    RAISE EXCEPTION 'customer admission receipt requires admitted customer' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_admission_receipt_parent_guard BEFORE INSERT OR UPDATE ON customer_admission_receipts
  FOR EACH ROW EXECUTE FUNCTION customer_admission_receipt_parent_guard();

CREATE FUNCTION rights_holder_receipt_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent customers%ROWTYPE;
DECLARE linked customer_rights_holder_links%ROWTYPE;
BEGIN
  SELECT * INTO parent FROM customers
  WHERE id = NEW.result_customer_id AND department_id = NEW.department_id FOR SHARE;
  IF NOT FOUND OR parent.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'customer unavailable for business association' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO linked FROM customer_rights_holder_links
  WHERE id = NEW.result_link_id AND department_id = NEW.department_id FOR SHARE;
  IF NOT FOUND OR linked.customer_id <> NEW.result_customer_id OR linked.rights_holder_id <> NEW.result_holder_id THEN
    RAISE EXCEPTION 'rights holder receipt/link identity mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rights_holder_receipt_parent_guard BEFORE INSERT OR UPDATE ON rights_holder_command_receipts
  FOR EACH ROW EXECUTE FUNCTION rights_holder_receipt_parent_guard();

CREATE OR REPLACE FUNCTION customer_draft_deletion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    IF NEW.id <> OLD.id OR NEW.department_id <> OLD.department_id OR NEW.profile_status <> 'DRAFT'
      OR EXISTS (SELECT 1 FROM customer_admission_receipts WHERE result_customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM rights_holder_command_receipts WHERE result_customer_id = NEW.id)
    THEN
      RAISE EXCEPTION 'invalid customer restore' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    IF NEW.profile_status <> 'DRAFT' OR NEW.admitted_at IS NOT NULL OR NEW.ever_admitted
      OR EXISTS (SELECT 1 FROM customer_admission_receipts WHERE result_customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM rights_holder_command_receipts WHERE result_customer_id = NEW.id)
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

COMMIT;
