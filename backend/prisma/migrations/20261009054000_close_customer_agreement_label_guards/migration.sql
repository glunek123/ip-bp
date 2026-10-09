BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM materials m
    WHERE (m.category = 'CUSTOMER_AGREEMENT') <> (m.purpose = 'CUSTOMER_AGREEMENT')
  ) OR EXISTS (
    SELECT 1 FROM upload_drafts d
    WHERE (d.category = 'CUSTOMER_AGREEMENT') <> (d.purpose = 'CUSTOMER_AGREEMENT')
  ) THEN
    RAISE EXCEPTION 'existing agreement category and purpose mismatch' USING ERRCODE = '23514';
  END IF;
END $$;

ALTER TABLE material_references
  DROP CONSTRAINT material_references_customer_agreement_shape_check;
ALTER TABLE material_references
  ADD CONSTRAINT material_references_customer_agreement_shape_check CHECK (
    (purpose = 'CUSTOMER_AGREEMENT' AND resource_type = 'customer_agreement_version'
      AND action_event_id IS NOT NULL AND asset_version_id IS NULL)
    OR (purpose <> 'CUSTOMER_AGREEMENT' AND resource_type <> 'customer_agreement_version')
  );

CREATE OR REPLACE FUNCTION check_customer_agreement_material() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'materials' AND TG_OP = 'UPDATE' AND
    EXISTS (SELECT 1 FROM material_references r WHERE r.material_id = OLD.id AND r.purpose = 'CUSTOMER_AGREEMENT') AND
    (NEW.owner_type, NEW.owner_id, NEW.department_id, NEW.category, NEW.purpose, NEW.status)
      IS DISTINCT FROM (OLD.owner_type, OLD.owner_id, OLD.department_id, OLD.category, OLD.purpose, OLD.status) THEN
    RAISE EXCEPTION 'frozen agreement material identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.category = 'CUSTOMER_AGREEMENT' OR NEW.purpose = 'CUSTOMER_AGREEMENT' THEN
    IF NEW.category <> 'CUSTOMER_AGREEMENT' OR NEW.purpose <> 'CUSTOMER_AGREEMENT'
      OR NEW.owner_type <> 'CUSTOMER' OR NOT EXISTS (
        SELECT 1 FROM customers c WHERE c.id = NEW.owner_id AND c.department_id = NEW.department_id
      ) THEN
      RAISE EXCEPTION 'invalid agreement material owner or purpose' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION check_customer_agreement_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v customer_agreement_versions%ROWTYPE;
BEGIN
  IF NEW.purpose <> 'CUSTOMER_AGREEMENT' AND NEW.resource_type <> 'customer_agreement_version' THEN
    RETURN NEW;
  END IF;
  IF NEW.purpose <> 'CUSTOMER_AGREEMENT' OR NEW.resource_type <> 'customer_agreement_version' THEN
    RAISE EXCEPTION 'invalid agreement reference purpose or type' USING ERRCODE = '23514';
  END IF;
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
