BEGIN;

-- Keep both genuine execution-reference sources while avoiding a PL/pgSQL
-- variable name that collides with submission_id and confirmation_id columns.
CREATE OR REPLACE FUNCTION "check_case_execution_submission_reference"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_submission_id uuid; target_confirmation_id uuid;
BEGIN
  IF NEW."purpose"<>'EXECUTION_APPLICATION' THEN RETURN NEW; END IF;
  IF NEW."resource_type"<>'case' OR NEW."action_event_id" IS NULL THEN RAISE EXCEPTION 'execution reference source invalid' USING ERRCODE='23514'; END IF;
  SELECT s."id" INTO target_submission_id FROM "case_execution_submissions" s
    WHERE s."case_id"=NEW."resource_id" AND s."department_id"=NEW."department_id" AND s."audit_event_id"=NEW."action_event_id" FOR UPDATE OF s;
  SELECT c."id" INTO target_confirmation_id FROM "case_execution_confirmations" c
    WHERE c."case_id"=NEW."resource_id" AND c."department_id"=NEW."department_id" AND c."audit_event_id"=NEW."action_event_id"
      AND c."submission_id" IS NULL AND c."external_entry_id" IS NOT NULL FOR UPDATE OF c;
  IF ((target_submission_id IS NULL) = (target_confirmation_id IS NULL)) OR
    (target_submission_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_execution_submission_versions" v
      WHERE v."submission_id"=target_submission_id AND v."case_id"=NEW."resource_id" AND v."department_id"=NEW."department_id"
        AND v."material_id"=NEW."material_id" AND v."content_version_id"=NEW."content_version_id")) OR
    (target_submission_id IS NOT NULL AND EXISTS (SELECT 1 FROM "case_execution_submission_receipts" r
      WHERE r."case_id"=NEW."resource_id" AND r."department_id"=NEW."department_id" AND r."result_snapshot"->>'submissionId'=target_submission_id::text)) OR
    (target_confirmation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_execution_confirmation_versions" v
      WHERE v."confirmation_id"=target_confirmation_id AND v."case_id"=NEW."resource_id" AND v."department_id"=NEW."department_id"
        AND v."material_id"=NEW."material_id" AND v."content_version_id"=NEW."content_version_id")) OR
    (target_confirmation_id IS NOT NULL AND EXISTS (SELECT 1 FROM "case_execution_confirmation_receipts" r
      WHERE r."case_id"=NEW."resource_id" AND r."department_id"=NEW."department_id" AND r."result_snapshot"->>'confirmationId'=target_confirmation_id::text))
  THEN RAISE EXCEPTION 'execution reference mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

COMMIT;
