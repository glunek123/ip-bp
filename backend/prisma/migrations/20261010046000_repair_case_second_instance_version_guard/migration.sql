-- Replace only the guard function: `old` is PL/pgSQL's trigger record, so using
-- it as a relation alias makes OLD.case_id ambiguous on a result file insert.
CREATE OR REPLACE FUNCTION "check_case_second_instance_version"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected_ids jsonb; expected_category "material_category"; fact_audit uuid;
BEGIN
  IF TG_TABLE_NAME = 'case_second_instance_progress_versions' THEN
    SELECT p."audit_event_id", NEW."category", CASE WHEN NEW."category" = 'SECOND_INSTANCE_DOCUMENT'
      THEN a."details"->'documentContentVersionIds' ELSE a."details"->'serviceContentVersionIds' END
      INTO fact_audit, expected_category, selected_ids
      FROM "case_second_instance_progresses" p JOIN "audit_events" a ON a."id" = p."audit_event_id"
      WHERE p."id" = NEW."progress_id" AND p."case_id" = NEW."case_id" AND p."department_id" = NEW."department_id"
      FOR UPDATE OF p;
  ELSE
    expected_category := 'SECOND_INSTANCE_JUDGMENT';
    SELECT s."audit_event_id", a."details"->'judgmentContentVersionIds' INTO fact_audit, selected_ids
      FROM "case_second_instance_results" s JOIN "audit_events" a ON a."id" = s."audit_event_id"
      WHERE s."id" = NEW."result_id" AND s."case_id" = NEW."case_id" AND s."department_id" = NEW."department_id"
      FOR UPDATE OF s;
  END IF;
  IF fact_audit IS NULL OR jsonb_typeof(selected_ids) IS DISTINCT FROM 'array' OR
     NOT selected_ids ? NEW."content_version_id"::text OR
     NOT EXISTS (SELECT 1 FROM "materials" m JOIN "content_versions" v ON v."material_id" = m."id"
       WHERE m."id" = NEW."material_id" AND v."id" = NEW."content_version_id"
         AND m."department_id" = NEW."department_id" AND m."owner_type" = 'CASE' AND m."owner_id" = NEW."case_id"
         AND m."category" = expected_category AND m."purpose"::text = expected_category::text
         AND m."status" = 'ACTIVE' AND v."status" = 'AVAILABLE'
         AND v."mime_type" IN ('application/pdf','image/jpeg','image/png')
         AND v."size_bytes" <= 52428800
         AND (m."current_version_id" = v."id" OR EXISTS (
           SELECT 1 FROM "case_second_instance_progress_versions" prior_progress_version
           WHERE prior_progress_version."case_id" = NEW."case_id" AND prior_progress_version."department_id" = NEW."department_id"
             AND prior_progress_version."material_id" = m."id" AND prior_progress_version."content_version_id" = v."id") OR EXISTS (
           SELECT 1 FROM "case_second_instance_result_versions" prior_result_version
           WHERE prior_result_version."case_id" = NEW."case_id" AND prior_result_version."department_id" = NEW."department_id"
             AND prior_result_version."material_id" = m."id" AND prior_result_version."content_version_id" = v."id"))) THEN
    RAISE EXCEPTION 'second-instance frozen version mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
