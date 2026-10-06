BEGIN;

-- Serialize selected-version inserts with the success receipt. The accepted
-- set is the registration audit's three explicit version-id arrays.
CREATE OR REPLACE FUNCTION "check_case_acceptance_version"() RETURNS TRIGGER AS $$
DECLARE selected_ids JSONB;
BEGIN
  SELECT CASE NEW."category"
      WHEN 'ACCEPTANCE_NOTICE' THEN a."details" -> 'acceptanceNoticeContentVersionIds'
      WHEN 'PAYMENT_LIST' THEN a."details" -> 'paymentListContentVersionIds'
      WHEN 'SERVICE_DOCUMENT' THEN a."details" -> 'serviceDocumentContentVersionIds'
    END INTO selected_ids
  FROM "case_acceptances" ca
  JOIN "audit_events" a ON a."id" = ca."audit_event_id"
  WHERE ca."id" = NEW."acceptance_id"
    AND ca."case_id" = NEW."case_id"
    AND ca."department_id" = NEW."department_id"
    AND a."department_id" = NEW."department_id"
    AND a."action" = 'case.acceptance.registered'
  FOR UPDATE OF ca;

  IF jsonb_typeof(selected_ids) IS DISTINCT FROM 'array'
    OR NOT (selected_ids ? NEW."content_version_id"::text)
    OR EXISTS (
      SELECT 1 FROM "case_acceptance_receipts" r
      WHERE r."case_id" = NEW."case_id" AND r."department_id" = NEW."department_id"
    ) THEN
    RAISE EXCEPTION 'acceptance frozen version is not an open selected version' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "materials" m JOIN "content_versions" v ON v."material_id" = m."id"
    WHERE m."id" = NEW."material_id" AND v."id" = NEW."content_version_id"
      AND m."department_id" = NEW."department_id" AND m."owner_type" = 'CASE'
      AND m."owner_id" = NEW."case_id" AND m."category" = NEW."category"
      AND m."purpose" = NEW."category"::text AND m."status" = 'ACTIVE'
      AND v."status" = 'AVAILABLE' AND m."current_version_id" = v."id"
      AND v."size_bytes" <= 52428800
      AND v."mime_type" IN ('application/pdf','image/jpeg','image/png')
  ) THEN
    RAISE EXCEPTION 'acceptance material mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The receipt completes the set; selected IDs and frozen IDs must match for
-- each category before the immutable success receipt can be written.
CREATE FUNCTION "check_case_acceptance_receipt"() RETURNS TRIGGER AS $$
DECLARE acceptance_fact_id UUID; selected_details JSONB; selected_ids JSONB; category_name "material_category"; property_name TEXT;
BEGIN
  SELECT ca."id", a."details" INTO acceptance_fact_id, selected_details
  FROM "case_acceptances" ca
  JOIN "audit_events" a ON a."id" = ca."audit_event_id"
  WHERE ca."case_id" = NEW."case_id" AND ca."department_id" = NEW."department_id"
    AND a."department_id" = NEW."department_id"
    AND a."action" = 'case.acceptance.registered'
  FOR UPDATE OF ca;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'acceptance receipt requires a registration fact' USING ERRCODE = '23514';
  END IF;

  FOR category_name, property_name IN
    SELECT 'ACCEPTANCE_NOTICE'::"material_category", 'acceptanceNoticeContentVersionIds'
    UNION ALL SELECT 'PAYMENT_LIST'::"material_category", 'paymentListContentVersionIds'
    UNION ALL SELECT 'SERVICE_DOCUMENT'::"material_category", 'serviceDocumentContentVersionIds'
  LOOP
    selected_ids := selected_details -> property_name;
    IF jsonb_typeof(selected_ids) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'acceptance receipt selected list is invalid' USING ERRCODE = '23514';
    END IF;
    IF jsonb_array_length(selected_ids) > 10
      OR (SELECT COUNT(*) FROM "case_acceptance_versions" v
          WHERE v."acceptance_id" = acceptance_fact_id
            AND v."category" = category_name) <> jsonb_array_length(selected_ids)
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(selected_ids) AS chosen("id")
        WHERE NOT EXISTS (
          SELECT 1 FROM "case_acceptance_versions" v
          WHERE v."acceptance_id" = acceptance_fact_id
            AND v."category" = category_name
            AND v."content_version_id"::text = chosen."id"
        )
      ) THEN
      RAISE EXCEPTION 'acceptance receipt requires the exact selected versions' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "case_acceptance_receipts_selected_set_guard"
  BEFORE INSERT ON "case_acceptance_receipts" FOR EACH ROW
  EXECUTE FUNCTION "check_case_acceptance_receipt"();

-- Only this new action's audit rows become immutable. All older actions keep
-- their prior update/delete behavior, and their actor-path guards are unchanged.
CREATE FUNCTION "reject_case_acceptance_audit_mutation"() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."action" = 'case.acceptance.registered'
    OR (TG_OP = 'UPDATE' AND NEW."action" = 'case.acceptance.registered') THEN
    RAISE EXCEPTION 'case acceptance audit is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "case_acceptance_audit_immutable"
  BEFORE UPDATE OR DELETE ON "audit_events" FOR EACH ROW
  EXECUTE FUNCTION "reject_case_acceptance_audit_mutation"();

COMMIT;
