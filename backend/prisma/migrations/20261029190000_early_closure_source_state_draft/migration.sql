-- Deferred source-state validation for early closure. The 120000 source
-- INSERT gate remains enabled; this does not make the new command writable.
BEGIN;

DO $checks$
DECLARE item record; body text; count_checks integer := 0;
BEGIN
  IF to_regprocedure('case_archive_source_checks(cases,case_stage)') IS NULL THEN
    RAISE EXCEPTION 'missing historical archive source checks' USING ERRCODE = '23514';
  END IF;
  FOR item IN SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conrelid = 'cases'::regclass AND
      conname IN ('cases_matching_state_check', 'cases_complaint_state_check')
  LOOP
    IF left(item.definition, 7) <> 'CHECK (' OR
       position('''ARCHIVED''::case_stage' IN item.definition) = 0 OR
       position('''WAITING_ARCHIVE''::case_stage' IN item.definition) = 0 THEN
      RAISE EXCEPTION 'unknown case state constraint %', item.conname USING ERRCODE = '23514';
    END IF;
    body := substr(item.definition, 8, length(item.definition) - 8);
    EXECUTE format('ALTER TABLE cases DROP CONSTRAINT %I', item.conname);
    EXECUTE format('ALTER TABLE cases ADD CONSTRAINT %I CHECK ((%s) OR stage = ''WAITING_ARCHIVE''::case_stage)',
      item.conname, body);
    count_checks := count_checks + 1;
  END LOOP;
  IF count_checks <> 2 OR NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'cases'::regclass AND
      conname = 'cases_matched_on_state_check' AND
      pg_get_constraintdef(oid) LIKE '%stage <> ''PENDING_MATCH''%'
  ) THEN
    RAISE EXCEPTION 'case source state constraint inventory changed' USING ERRCODE = '23514';
  END IF;
END;
$checks$;

-- The matched_on check already permits null for the PENDING_MATCH source and
-- non-null for later sources in WAITING_ARCHIVE/ARCHIVED. Keep it untouched.
CREATE FUNCTION "case_early_closure_source_checks_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_case cases%ROWTYPE; source_stage case_stage; early record;
BEGIN
  IF TG_TABLE_NAME = 'cases' THEN
    SELECT * INTO current_case FROM cases WHERE id = NEW.id AND department_id = NEW.department_id;
  ELSE
    SELECT * INTO current_case FROM cases WHERE id = NEW.case_id AND department_id = NEW.department_id;
  END IF;
  IF current_case.id IS NULL THEN
    RAISE EXCEPTION 'early closure case missing' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO early FROM case_early_closures WHERE case_id = current_case.id AND
    department_id = current_case.department_id;
  IF early.id IS NOT NULL THEN
    IF current_case.stage NOT IN ('WAITING_ARCHIVE', 'ARCHIVED') OR
       EXISTS (SELECT 1 FROM case_early_archives WHERE case_id = current_case.id) THEN
      RAISE EXCEPTION 'early closure source stage mismatch' USING ERRCODE = '23514';
    END IF;
    source_stage := early.from_stage;
  ELSIF current_case.stage = 'WAITING_ARCHIVE' THEN
    source_stage := current_case.stage;
  ELSE
    RETURN NEW;
  END IF;
  IF case_archive_source_checks(current_case, source_stage) IS NOT TRUE THEN
    RAISE EXCEPTION 'early closure source fields invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER case_early_closure_source_checks_case_final
  AFTER INSERT OR UPDATE ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION case_early_closure_source_checks_final();
CREATE CONSTRAINT TRIGGER case_early_closure_source_checks_fact_final
  AFTER INSERT ON case_early_closures DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION case_early_closure_source_checks_final();

-- Preserve the original ARCHIVED branch and add only the new fact as a
-- fallback source when there is no historical early-archive fact.
DO $historical$
DECLARE definition text;
  old_text text := E'SELECT from_stage INTO original_stage FROM case_early_archives\n    WHERE case_id = current_case.id AND department_id = current_case.department_id;';
  new_text text := E'SELECT from_stage INTO original_stage FROM case_early_archives\n    WHERE case_id = current_case.id AND department_id = current_case.department_id;\n  IF original_stage IS NULL THEN\n    SELECT from_stage INTO original_stage FROM case_early_closures\n      WHERE case_id = current_case.id AND department_id = current_case.department_id;\n  END IF;';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname = 'case_archive_source_checks_final' AND p.pronargs = 0;
  IF definition IS NULL OR position(old_text IN definition) = 0 OR
     position('case_early_closures' IN definition) > 0 THEN
    RAISE EXCEPTION 'historical archive source check changed' USING ERRCODE = '23514';
  END IF;
  EXECUTE replace(definition, old_text, new_text);
END;
$historical$;

COMMIT;
