BEGIN;

-- An unaccepted REMAND child has no case fact capable of advancing the case
-- version. Bind it to the exact source result until formal acceptance begins.
CREATE FUNCTION "check_empty_remand_child_version"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_case record; current_round record; source_result record;
BEGIN
  SELECT * INTO current_case FROM "cases" WHERE "id" = NEW."id";
  IF current_case."id" IS NULL OR current_case."stage" <> 'WAITING_FORMAL_ACCEPTANCE' OR
     current_case."current_acceptance_id" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT "id", "sequence", "source_result_id", "revoked_at" INTO current_round
    FROM "case_trial_rounds"
    WHERE "id" = current_case."current_trial_round_id" AND "case_id" = current_case."id"
      AND "department_id" = current_case."department_id";
  IF current_round."id" IS NULL OR current_round."sequence" = 1 OR
     current_round."revoked_at" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT "id", "to_version" INTO source_result FROM "case_second_instance_results"
    WHERE "id" = current_round."source_result_id" AND "case_id" = current_case."id"
      AND "department_id" = current_case."department_id" AND "result" = 'REMAND';
  IF source_result."id" IS NULL OR current_case."version" IS DISTINCT FROM source_result."to_version" THEN
    RAISE EXCEPTION 'unaccepted remand child version differs from source result' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE CONSTRAINT TRIGGER "cases_empty_remand_child_version_guard"
  AFTER INSERT OR UPDATE ON "cases" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "check_empty_remand_child_version"();

COMMIT;
