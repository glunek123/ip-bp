BEGIN;

-- Preserve the latest CU006 deletion rule, including OLD admission history.
CREATE OR REPLACE FUNCTION customer_draft_deletion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    IF NEW.id <> OLD.id OR NEW.department_id <> OLD.department_id OR NEW.profile_status <> 'DRAFT'
      OR EXISTS (SELECT 1 FROM customer_admission_receipts WHERE result_customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM rights_holder_command_receipts WHERE result_customer_id = NEW.id) THEN
      RAISE EXCEPTION 'invalid customer restore' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    IF OLD.profile_status = 'ADMITTED' OR OLD.admitted_at IS NOT NULL OR OLD.ever_admitted
      OR NEW.profile_status <> 'DRAFT' OR NEW.admitted_at IS NOT NULL OR NEW.ever_admitted
      OR EXISTS (SELECT 1 FROM customer_contacts WHERE customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM customer_admission_receipts WHERE result_customer_id = NEW.id)
      OR EXISTS (SELECT 1 FROM rights_holder_command_receipts WHERE result_customer_id = NEW.id)
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
      OR EXISTS (SELECT 1 FROM materials WHERE owner_type = 'CUSTOMER' AND owner_id = NEW.id) THEN
      RAISE EXCEPTION 'customer draft has business history' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'deleted customer is immutable until restore' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE customer_agreement_versions ADD CONSTRAINT customer_agreement_versions_actor_department_fkey
  FOREIGN KEY (recorded_by_user_id, department_id)
  REFERENCES department_memberships(user_id, department_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE customer_invoice_profile_versions ADD CONSTRAINT customer_invoice_versions_actor_department_fkey
  FOREIGN KEY (recorded_by_user_id, department_id)
  REFERENCES department_memberships(user_id, department_id) ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION customer_document_version_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_type text; expected_resource uuid; expected_action text;
BEGIN
  IF TG_TABLE_NAME = 'customer_agreement_versions' THEN
    expected_type := 'customer_agreement'; expected_resource := NEW.agreement_id;
    expected_action := CASE WHEN NEW.version = 1 THEN 'customer.agreement.created' ELSE 'customer.agreement.revised' END;
  ELSE
    expected_type := 'customer_invoice_profile'; expected_resource := NEW.profile_id;
    expected_action := CASE WHEN NEW.version = 1 THEN 'customer.invoice.created' ELSE 'customer.invoice.revised' END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_events a WHERE a.id = NEW.audit_event_id
    AND a.department_id = NEW.department_id AND a.actor_user_id = NEW.recorded_by_user_id
    AND a.resource_type = expected_type AND a.resource_id = expected_resource AND a.action = expected_action) THEN
    RAISE EXCEPTION 'document version audit identity mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_agreement_version_audit_guard BEFORE INSERT ON customer_agreement_versions
  FOR EACH ROW EXECUTE FUNCTION customer_document_version_audit_guard();
CREATE TRIGGER customer_invoice_version_audit_guard BEFORE INSERT ON customer_invoice_profile_versions
  FOR EACH ROW EXECUTE FUNCTION customer_document_version_audit_guard();

CREATE FUNCTION customer_document_current_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_id uuid; current_number integer;
BEGIN
  IF TG_TABLE_NAME = 'customer_agreements' THEN
    SELECT current_version_id, version INTO current_id, current_number FROM customer_agreements WHERE id = NEW.id;
    IF current_id IS NULL OR NOT EXISTS (SELECT 1 FROM customer_agreement_versions v
      WHERE v.id = current_id AND v.agreement_id = NEW.id AND v.customer_id = NEW.customer_id
        AND v.department_id = NEW.department_id AND v.version = current_number) THEN
      RAISE EXCEPTION 'agreement current version mismatch' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT current_version_id, version INTO current_id, current_number FROM customer_invoice_profiles WHERE id = NEW.id;
    IF current_id IS NULL OR NOT EXISTS (SELECT 1 FROM customer_invoice_profile_versions v
      WHERE v.id = current_id AND v.profile_id = NEW.id AND v.customer_id = NEW.customer_id
        AND v.department_id = NEW.department_id AND v.version = current_number) THEN
      RAISE EXCEPTION 'invoice current version mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER customer_agreement_current_guard AFTER INSERT OR UPDATE ON customer_agreements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_document_current_guard();
CREATE CONSTRAINT TRIGGER customer_invoice_current_guard AFTER INSERT OR UPDATE ON customer_invoice_profiles
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_document_current_guard();

CREATE OR REPLACE FUNCTION check_customer_agreement_reference() RETURNS trigger LANGUAGE plpgsql AS $$
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

COMMIT;
