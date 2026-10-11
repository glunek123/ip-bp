BEGIN;

-- A canceled remand child remains immutable history. A later remand from the
-- same source round therefore receives the next whole-case sequence, not the
-- source sequence plus one. Preserve the rest of the 45000 foundation guard.
CREATE OR REPLACE FUNCTION "check_case_trial_round_foundation"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; c record; r record; source_result record;
BEGIN
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id" = target_case AND "department_id" = target_department;
  IF c."current_trial_round_id" IS NULL THEN
    IF c."current_acceptance_id" IS NOT NULL OR c."stage" IN
      ('WAITING_HEARING','WAITING_JUDGMENT','SECOND_INSTANCE','WAITING_EXECUTION_DOCUMENTS') OR
      c."current_second_instance_progress_id" IS NOT NULL OR c."current_second_instance_result_id" IS NOT NULL OR
      EXISTS (SELECT 1 FROM "case_trial_rounds" x WHERE x."case_id" = target_case AND x."department_id" = target_department) OR
      EXISTS (SELECT 1 FROM "case_acceptances" a WHERE a."case_id" = target_case AND a."department_id" = target_department) THEN
      RAISE EXCEPTION 'accepted case has no active trial round' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO r FROM "case_trial_rounds" WHERE "id" = c."current_trial_round_id"
      AND "case_id" = target_case AND "department_id" = target_department;
    IF r."id" IS NULL OR r."revoked_at" IS NOT NULL THEN
      RAISE EXCEPTION 'active trial round missing or revoked' USING ERRCODE = '23514';
    END IF;
    IF r."sequence" = 1 THEN
      IF r."source_result_id" IS NOT NULL OR c."current_acceptance_id" IS NULL OR
         NOT EXISTS (SELECT 1 FROM "case_acceptances" a WHERE a."id" = c."current_acceptance_id"
           AND a."trial_round_id" = r."id" AND a."case_id" = target_case AND a."department_id" = target_department
           AND a."court_case_no" = c."court_case_no") THEN
        RAISE EXCEPTION 'initial trial round or acceptance mismatch' USING ERRCODE = '23514';
      END IF;
    ELSE
      SELECT s."id", s."case_id", s."department_id", s."trial_round_id", s."result", s."to_version", v."id" AS revocation_id
        INTO source_result FROM "case_second_instance_results" s
        LEFT JOIN "case_second_instance_result_revocations" v ON v."result_id" = s."id"
        WHERE s."id" = r."source_result_id" AND s."case_id" = target_case AND s."department_id" = target_department;
      IF source_result."id" IS NULL OR source_result."result" <> 'REMAND' OR source_result.revocation_id IS NOT NULL OR
         r."sequence" <= (SELECT p."sequence" FROM "case_trial_rounds" p WHERE p."id" = source_result."trial_round_id") THEN
        RAISE EXCEPTION 'later trial round lacks active remand source' USING ERRCODE = '23514';
      END IF;
      IF c."current_acceptance_id" IS NULL THEN
        IF c."stage" <> 'WAITING_FORMAL_ACCEPTANCE' OR c."current_second_instance_result_id" IS DISTINCT FROM source_result."id" OR
           c."court_case_no" IS NOT NULL OR c."current_hearing_arrangement_id" IS NOT NULL OR
           c."current_hearing_advance_id" IS NOT NULL OR c."current_judgment_id" IS NOT NULL OR
           c."current_judgment_next_step_id" IS NOT NULL OR c."current_second_instance_progress_id" IS NOT NULL THEN
          RAISE EXCEPTION 'unaccepted remand child pointers mismatch' USING ERRCODE = '23514';
        END IF;
      ELSIF NOT EXISTS (SELECT 1 FROM "case_acceptances" a WHERE a."id" = c."current_acceptance_id"
        AND a."trial_round_id" = r."id" AND a."case_id" = target_case AND a."department_id" = target_department
        AND a."court_case_no" = c."court_case_no") OR c."current_second_instance_result_id" IS NOT NULL THEN
        RAISE EXCEPTION 'accepted remand child pointers mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'case_trial_rounds' THEN
    IF NEW."revoked_at" IS NOT NULL OR c."current_trial_round_id" IS DISTINCT FROM NEW."id" OR
       NEW."sequence" <> (SELECT COALESCE(MAX(p."sequence"),0) + 1 FROM "case_trial_rounds" p
         WHERE p."case_id" = target_case AND p."department_id" = target_department AND p."id" <> NEW."id") OR
       (NEW."sequence" = 1 AND NEW."source_result_id" IS NOT NULL) OR
       (NEW."sequence" > 1 AND NOT EXISTS (SELECT 1 FROM "case_second_instance_results" s
         WHERE s."id" = NEW."source_result_id" AND s."case_id" = target_case AND s."department_id" = target_department
           AND s."result" = 'REMAND' AND s."to_version" = c."version")) THEN
      RAISE EXCEPTION 'new trial round requires exact remand result' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME <> 'cases' THEN
    IF NEW."trial_round_id" IS DISTINCT FROM c."current_trial_round_id" THEN
      RAISE EXCEPTION 'new case fact must belong to current trial round' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF (c."current_hearing_arrangement_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_hearing_arrangements" x WHERE x."id" = c."current_hearing_arrangement_id"
        AND x."trial_round_id" = c."current_trial_round_id")) OR
     (c."current_hearing_advance_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_hearing_advances" x WHERE x."id" = c."current_hearing_advance_id"
        AND x."trial_round_id" = c."current_trial_round_id")) OR
     (c."current_judgment_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_judgment_facts" x WHERE x."id" = c."current_judgment_id"
        AND x."trial_round_id" = c."current_trial_round_id")) OR
     (c."current_judgment_next_step_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_judgment_next_steps" x WHERE x."id" = c."current_judgment_next_step_id"
        AND x."trial_round_id" = c."current_trial_round_id")) OR
     (c."current_second_instance_progress_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_second_instance_progresses" x WHERE x."id" = c."current_second_instance_progress_id"
        AND x."trial_round_id" = c."current_trial_round_id")) OR
     (c."current_second_instance_result_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_second_instance_results" x WHERE x."id" = c."current_second_instance_result_id"
        AND (x."trial_round_id" = c."current_trial_round_id" OR
          (x."result" = 'REMAND' AND EXISTS (SELECT 1 FROM "case_trial_rounds" child
            WHERE child."id" = c."current_trial_round_id" AND child."source_result_id" = x."id"))))) THEN
    RAISE EXCEPTION 'case current pointer crosses trial rounds' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;

COMMIT;
