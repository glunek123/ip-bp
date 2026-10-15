BEGIN;

-- A normal case has no entry ID on any fact. Only trial rounds have an
-- origin column, so inspect that column inside the trial-round branch.
CREATE OR REPLACE FUNCTION "check_case_external_fact_source"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record; e record;
BEGIN
  SELECT "source_lead_id","source_notary_matter_id","certificate_id" INTO c
    FROM "cases" WHERE "id"=NEW."case_id" AND "department_id"=NEW."department_id";
  SELECT "id","initial_stage" INTO e FROM "case_external_entries"
    WHERE "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
  IF NOT FOUND AND c."source_lead_id" IS NULL THEN RAISE EXCEPTION 'external fact lacks case root' USING ERRCODE='23514'; END IF;
  IF c."source_lead_id" IS NULL THEN
    IF e."initial_stage"='ARCHIVED' THEN RAISE EXCEPTION 'archived entry has no follow-up facts' USING ERRCODE='23514'; END IF;
    IF NEW."external_entry_id" IS DISTINCT FROM e."id" THEN RAISE EXCEPTION 'external fact source mismatch' USING ERRCODE='23514'; END IF;
    IF TG_TABLE_NAME='case_trial_rounds' THEN
      IF NEW."origin"='EXTERNAL_CURRENT' AND (NEW."sequence"<>1 OR NEW."source_result_id" IS NOT NULL) THEN RAISE EXCEPTION 'invalid external current round' USING ERRCODE='23514'; END IF;
      IF NEW."origin"='NORMAL' AND NEW."source_result_id" IS NULL THEN RAISE EXCEPTION 'external descendant has no remand result' USING ERRCODE='23514'; END IF;
    END IF;
  ELSE
    IF NEW."external_entry_id" IS NOT NULL THEN
      RAISE EXCEPTION 'normal fact has external root' USING ERRCODE='23514';
    END IF;
    IF TG_TABLE_NAME='case_trial_rounds' THEN
      IF NEW."origin"<>'NORMAL' THEN
        RAISE EXCEPTION 'normal fact has external root' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

COMMIT;
