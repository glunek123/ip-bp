BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM customer_agreements a
    WHERE a.version <> (SELECT max(v.version) FROM customer_agreement_versions v WHERE v.agreement_id = a.id)
  ) OR EXISTS (
    SELECT 1 FROM customer_invoice_profiles p
    WHERE p.version <> (SELECT max(v.version) FROM customer_invoice_profile_versions v WHERE v.profile_id = p.id)
  ) OR EXISTS (
    SELECT 1 FROM customer_agreement_versions v JOIN audit_events a ON a.id = v.audit_event_id
    WHERE a.department_id <> v.department_id OR a.actor_user_id <> v.recorded_by_user_id
      OR a.resource_type <> 'customer_agreement' OR a.resource_id <> v.agreement_id
      OR a.action <> CASE WHEN v.version = 1 THEN 'customer.agreement.created' ELSE 'customer.agreement.revised' END
  ) OR EXISTS (
    SELECT 1 FROM customer_invoice_profile_versions v JOIN audit_events a ON a.id = v.audit_event_id
    WHERE a.department_id <> v.department_id OR a.actor_user_id <> v.recorded_by_user_id
      OR a.resource_type <> 'customer_invoice_profile' OR a.resource_id <> v.profile_id
      OR a.action <> CASE WHEN v.version = 1 THEN 'customer.invoice.created' ELSE 'customer.invoice.revised' END
  ) THEN
    RAISE EXCEPTION 'existing customer document head or audit is inconsistent' USING ERRCODE = '23514';
  END IF;
END $$;

CREATE FUNCTION customer_document_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.action IN ('customer.agreement.created','customer.agreement.revised','customer.invoice.created','customer.invoice.revised')
    OR NEW.action IN ('customer.agreement.created','customer.agreement.revised','customer.invoice.created','customer.invoice.revised')
    OR OLD.resource_type IN ('customer_agreement','customer_invoice_profile')
    OR NEW.resource_type IN ('customer_agreement','customer_invoice_profile')
    OR EXISTS (SELECT 1 FROM customer_agreement_versions v WHERE v.audit_event_id = OLD.id)
    OR EXISTS (SELECT 1 FROM customer_invoice_profile_versions v WHERE v.audit_event_id = OLD.id) THEN
    RAISE EXCEPTION 'customer document audit is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_document_audit_immutable BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION customer_document_audit_immutable();

CREATE FUNCTION customer_document_head_never_retreats() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.version < OLD.version THEN
    RAISE EXCEPTION 'customer document version cannot retreat' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_agreement_head_never_retreats BEFORE UPDATE ON customer_agreements
  FOR EACH ROW EXECUTE FUNCTION customer_document_head_never_retreats();
CREATE TRIGGER customer_invoice_head_never_retreats BEFORE UPDATE ON customer_invoice_profiles
  FOR EACH ROW EXECUTE FUNCTION customer_document_head_never_retreats();

CREATE OR REPLACE FUNCTION customer_document_current_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entity_id uuid; current_id uuid; current_number integer; maximum_number integer;
        owner_customer_id uuid; owner_department_id uuid;
BEGIN
  IF TG_TABLE_NAME IN ('customer_agreements','customer_agreement_versions') THEN
    IF TG_TABLE_NAME = 'customer_agreements' THEN entity_id := NEW.id;
    ELSE entity_id := NEW.agreement_id; END IF;
    SELECT a.current_version_id, a.version, a.customer_id, a.department_id
      INTO current_id, current_number, owner_customer_id, owner_department_id
      FROM customer_agreements a WHERE a.id = entity_id;
    SELECT max(v.version) INTO maximum_number
      FROM customer_agreement_versions v WHERE v.agreement_id = entity_id;
    IF current_id IS NULL OR current_number IS DISTINCT FROM maximum_number
      OR NOT EXISTS (
        SELECT 1 FROM customer_agreement_versions v
        WHERE v.id = current_id AND v.agreement_id = entity_id
          AND v.customer_id = owner_customer_id AND v.department_id = owner_department_id
          AND v.version = current_number
      ) THEN
      RAISE EXCEPTION 'agreement current version is not the latest' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF TG_TABLE_NAME = 'customer_invoice_profiles' THEN entity_id := NEW.id;
    ELSE entity_id := NEW.profile_id; END IF;
    SELECT p.current_version_id, p.version, p.customer_id, p.department_id
      INTO current_id, current_number, owner_customer_id, owner_department_id
      FROM customer_invoice_profiles p WHERE p.id = entity_id;
    SELECT max(v.version) INTO maximum_number
      FROM customer_invoice_profile_versions v WHERE v.profile_id = entity_id;
    IF current_id IS NULL OR current_number IS DISTINCT FROM maximum_number
      OR NOT EXISTS (
        SELECT 1 FROM customer_invoice_profile_versions v
        WHERE v.id = current_id AND v.profile_id = entity_id
          AND v.customer_id = owner_customer_id AND v.department_id = owner_department_id
          AND v.version = current_number
      ) THEN
      RAISE EXCEPTION 'invoice current version is not the latest' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER customer_agreement_version_head_guard AFTER INSERT ON customer_agreement_versions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_document_current_guard();
CREATE CONSTRAINT TRIGGER customer_invoice_version_head_guard AFTER INSERT ON customer_invoice_profile_versions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_document_current_guard();

COMMIT;
