BEGIN;

-- A remand keeps earlier registration receipts. Only the receipt for this
-- acceptance's audit version can close its selected-version set.
CREATE OR REPLACE FUNCTION "check_case_acceptance_version"() RETURNS TRIGGER AS $$
DECLARE selected_ids JSONB; acceptance_version TEXT;
BEGIN
  SELECT CASE NEW."category"
      WHEN 'ACCEPTANCE_NOTICE' THEN a."details" -> 'acceptanceNoticeContentVersionIds'
      WHEN 'PAYMENT_LIST' THEN a."details" -> 'paymentListContentVersionIds'
      WHEN 'SERVICE_DOCUMENT' THEN a."details" -> 'serviceDocumentContentVersionIds'
    END, a."details" ->> 'toVersion'
    INTO selected_ids, acceptance_version
  FROM "case_acceptances" ca
  JOIN "cases" c ON c."id" = ca."case_id" AND c."department_id" = ca."department_id"
  JOIN "audit_events" a ON a."id" = ca."audit_event_id"
  WHERE ca."id" = NEW."acceptance_id"
    AND ca."case_id" = NEW."case_id"
    AND ca."department_id" = NEW."department_id"
    AND c."current_acceptance_id" = ca."id"
    AND c."current_trial_round_id" = ca."trial_round_id"
    AND c."stage" = 'WAITING_HEARING'
    AND c."version"::text = a."details" ->> 'toVersion'
    AND a."department_id" = NEW."department_id"
    AND a."action" = 'case.acceptance.registered'
  FOR UPDATE OF ca;

  IF jsonb_typeof(selected_ids) IS DISTINCT FROM 'array'
    OR acceptance_version IS NULL
    OR NOT (selected_ids ? NEW."content_version_id"::text)
    OR EXISTS (
      SELECT 1 FROM "case_acceptance_receipts" r
      WHERE r."case_id" = NEW."case_id"
        AND r."department_id" = NEW."department_id"
        AND r."result_snapshot" ->> 'version' = acceptance_version
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

-- The success receipt must close the current acceptance, never an arbitrary
-- older fact from the same case.
CREATE OR REPLACE FUNCTION "check_case_acceptance_receipt"() RETURNS TRIGGER AS $$
DECLARE acceptance_fact_id UUID; selected_details JSONB; selected_ids JSONB; category_name "material_category"; property_name TEXT;
BEGIN
  SELECT ca."id", a."details" INTO acceptance_fact_id, selected_details
  FROM "cases" c
  JOIN "case_acceptances" ca ON ca."id" = c."current_acceptance_id"
    AND ca."case_id" = c."id" AND ca."department_id" = c."department_id"
    AND ca."trial_round_id" = c."current_trial_round_id"
  JOIN "audit_events" a ON a."id" = ca."audit_event_id"
  WHERE c."id" = NEW."case_id" AND c."department_id" = NEW."department_id"
    AND c."stage" = 'WAITING_HEARING'
    AND c."version"::text = a."details" ->> 'toVersion'
    AND a."department_id" = NEW."department_id"
    AND a."action" = 'case.acceptance.registered'
    AND NEW."actor_user_id" = ca."recorded_by_user_id"
    AND NEW."result_snapshot" ->> 'id' = NEW."case_id"::text
    AND NEW."result_snapshot" ->> 'stage' = 'WAITING_HEARING'
    AND NEW."result_snapshot" ->> 'version' = a."details" ->> 'toVersion'
    AND NEW."result_snapshot" ->> 'courtCaseNo' = ca."court_case_no"
    AND NEW."result_snapshot" ->> 'acceptedAt' = ca."accepted_at"::text
  FOR UPDATE OF ca;
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM "case_acceptance_receipts" r
    WHERE r."case_id" = NEW."case_id"
      AND r."department_id" = NEW."department_id"
      AND r."result_snapshot" ->> 'version' = NEW."result_snapshot" ->> 'version'
  ) THEN
    RAISE EXCEPTION 'acceptance receipt requires the current registration fact' USING ERRCODE = '23514';
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

COMMIT;
