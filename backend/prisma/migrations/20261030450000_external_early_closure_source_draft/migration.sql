-- Forward draft: external early closure source compatibility; no history changes or gates opened.
BEGIN;
DO $migration$
DECLARE oldbody text := $old$
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
END; $old$; newbody text := $new$
DECLARE c record; e record;
BEGIN
  SELECT "source_lead_id","source_notary_matter_id","certificate_id" INTO c
    FROM "cases" WHERE "id"=NEW."case_id" AND "department_id"=NEW."department_id";
  SELECT "id","initial_stage" INTO e FROM "case_external_entries"
    WHERE "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
  IF NOT FOUND AND c."source_lead_id" IS NULL THEN RAISE EXCEPTION 'external fact lacks case root' USING ERRCODE='23514'; END IF;
  IF c."source_lead_id" IS NULL THEN
    IF e."initial_stage"='ARCHIVED' THEN RAISE EXCEPTION 'archived entry has no follow-up facts' USING ERRCODE='23514'; END IF;
    IF NEW."external_entry_id" IS DISTINCT FROM e."id" THEN
      IF TG_TABLE_NAME NOT IN ('case_closures','case_closure_versions') OR NEW."external_entry_id" IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM case_early_closures ec WHERE ec.id::text=to_jsonb(NEW)->>'early_closure_id'
        AND ec.case_id=NEW."case_id" AND ec.department_id=NEW."department_id") THEN
       RAISE EXCEPTION 'external fact source mismatch' USING ERRCODE='23514';
      END IF;
    END IF;
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
END; $new$; installed text; f oid; t text;
BEGIN
 SELECT p.oid,p.prosrc INTO f,installed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname=current_schema() AND p.proname='check_case_external_fact_source' AND p.pronargs=0 AND p.prorettype='trigger'::regtype AND l.lanname='plpgsql' AND NOT p.prosecdef;
 IF f IS NULL OR replace(installed,E'\r\n',E'\n') IS DISTINCT FROM replace(oldbody,E'\r\n',E'\n') THEN RAISE EXCEPTION 'unexpected external fact guard'; END IF;
 FOREACH t IN ARRAY ARRAY['case_closures','case_closure_versions'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass(format('%I.%I',current_schema(),t)) AND tgname=t||'_source_guard' AND tgfoid=f AND tgtype=21 AND tgenabled='O' AND NOT tgisinternal AND tgdeferrable AND tginitdeferred) THEN RAISE EXCEPTION 'unexpected external fact trigger %',t; END IF;
 END LOOP;
 EXECUTE format('CREATE OR REPLACE FUNCTION %I.check_case_external_fact_source() RETURNS trigger LANGUAGE plpgsql AS %L',current_schema(),newbody);
END; $migration$;
COMMIT;
