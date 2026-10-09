BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM customers WHERE deleted_at IS NOT NULL AND ever_admitted) THEN
    RAISE EXCEPTION 'existing deleted customer has admission history' USING ERRCODE = '23514';
  END IF;
END $$;

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
    IF OLD.profile_status = 'ADMITTED' OR OLD.admitted_at IS NOT NULL OR OLD.ever_admitted
      OR NEW.profile_status <> 'DRAFT' OR NEW.admitted_at IS NOT NULL OR NEW.ever_admitted
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

ALTER TABLE customers ADD CONSTRAINT customers_deleted_never_admitted_check
  CHECK (deleted_at IS NULL OR NOT ever_admitted);

COMMIT;
