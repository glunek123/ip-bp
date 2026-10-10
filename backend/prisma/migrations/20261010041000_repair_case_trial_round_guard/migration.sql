BEGIN;

-- PL/pgSQL resolves record fields even when another AND operand is false.
-- Keep table-specific NEW fields inside their own branches.
CREATE OR REPLACE FUNCTION "check_case_trial_round_foundation"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; c record; r record;
BEGIN
  IF TG_TABLE_NAME = 'cases' THEN
    target_case := NEW."id"; target_department := NEW."department_id";
  ELSE
    target_case := NEW."case_id"; target_department := NEW."department_id";
  END IF;
  SELECT * INTO c FROM "cases" WHERE "id" = target_case AND "department_id" = target_department;
  IF c."current_trial_round_id" IS NULL THEN
    IF c."current_acceptance_id" IS NOT NULL OR c."stage" IN
      ('WAITING_HEARING','WAITING_JUDGMENT','SECOND_INSTANCE','WAITING_EXECUTION_DOCUMENTS') THEN
      RAISE EXCEPTION 'accepted case has no active trial round' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO r FROM "case_trial_rounds" WHERE "id" = c."current_trial_round_id"
      AND "case_id" = target_case AND "department_id" = target_department;
    IF r."sequence" <> 1 OR r."revoked_at" IS NOT NULL OR
      c."current_acceptance_id" IS NULL OR
      NOT EXISTS (SELECT 1 FROM "case_acceptances" a WHERE a."id" = c."current_acceptance_id"
        AND a."trial_round_id" = r."id" AND a."case_id" = target_case AND a."department_id" = target_department
        AND a."court_case_no" = c."court_case_no") THEN
      RAISE EXCEPTION 'initial trial round or acceptance mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'case_trial_rounds' THEN
    IF NEW."sequence" <> 1 OR NEW."revoked_at" IS NOT NULL OR
      c."current_trial_round_id" IS DISTINCT FROM NEW."id" THEN
      RAISE EXCEPTION 'new trial round requires a verified remand result' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME <> 'cases' THEN
    IF NEW."trial_round_id" IS DISTINCT FROM c."current_trial_round_id" THEN
      RAISE EXCEPTION 'new case fact must belong to the current trial round' USING ERRCODE = '23514';
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
        AND x."trial_round_id" = c."current_trial_round_id")) THEN
    RAISE EXCEPTION 'case current pointer crosses trial rounds' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;

COMMIT;
