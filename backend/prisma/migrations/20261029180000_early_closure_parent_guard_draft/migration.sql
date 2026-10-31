-- Fail-closed parent-guard preparation. The early-closure INSERT gate from
-- 120000 remains intact; this migration alone cannot create an early closure.
-- A later migration must extend the closure/archive source and terminal chain
-- before replacing that gate.
BEGIN;

DO $wrap$
DECLARE
  p record;
  definition text;
  old_prefix text := E'BEGIN\n  IF TG_TABLE_NAME = ''cases'' THEN\n    IF TG_OP = ''UPDATE'' THEN\n      IF case_early_archive_transition(OLD, NEW) THEN RETURN NEW; END IF;';
  new_prefix text := E'BEGIN\n  IF TG_TABLE_NAME = ''cases'' AND TG_OP = ''UPDATE'' THEN\n    IF case_early_closure_transition(OLD, NEW) THEN RETURN NEW; END IF;\n  END IF;\n  IF TG_TABLE_NAME = ''cases'' THEN\n    IF TG_OP = ''UPDATE'' THEN\n      IF case_early_archive_transition(OLD, NEW) THEN RETURN NEW; END IF;';
  wrapped_count integer := 0;
  followup_count integer := 0;
BEGIN
  FOR p IN
    SELECT DISTINCT proc.oid, proc.proname
    FROM pg_trigger t JOIN pg_proc proc ON proc.oid = t.tgfoid
    WHERE t.tgrelid = 'cases'::regclass AND NOT t.tgisinternal AND t.tgdeferrable
      AND proc.proname <> 'case_early_archive_final'
      AND proc.proname <> 'case_archive_source_checks_final'
  LOOP
    IF p.proname <> ALL(ARRAY[
      'check_case_trial_round_foundation', 'check_empty_remand_child_version',
      'check_retrial_prejudgment_version', 'check_case_judgment_final',
      'check_case_judgment_next_step_final', 'check_case_second_instance_final',
      'check_case_execution_submission_final', 'check_case_execution_confirmation_final',
      'check_case_execution_mailing_final', 'check_case_execution_filing_final',
      'check_case_execution_finish_final', 'check_case_closure_final',
      'check_case_archive_final', 'check_case_external_source_final',
      'check_execution_followup_case_final'
    ]) THEN
      RAISE EXCEPTION 'unreviewed case parent guard %', p.proname USING ERRCODE = '23514';
    END IF;
    SELECT pg_get_functiondef(p.oid) INTO definition;
    IF definition IS NULL OR position('case_early_closure_transition' IN definition) > 0 THEN
      RAISE EXCEPTION 'unknown case parent guard %', p.proname USING ERRCODE = '23514';
    END IF;
    -- The follow-up guard checks independent feedback/supplement state and
    -- must execute its complete historical body during the new transition.
    IF p.proname = 'check_execution_followup_case_final' THEN
      followup_count := followup_count + 1;
      CONTINUE;
    END IF;
    -- Require the exact wrapper installed by the old early-archive migration.
    -- If any later migration changed its entry shape, abort atomically.
    IF position(old_prefix IN definition) = 0 OR
       position(old_prefix IN definition) <> position(E'BEGIN\n' IN definition) THEN
      RAISE EXCEPTION 'changed case parent guard %', p.proname USING ERRCODE = '23514';
    END IF;
    definition := replace(definition, old_prefix, new_prefix);
    EXECUTE definition;
    wrapped_count := wrapped_count + 1;
  END LOOP;
  IF wrapped_count <> 14 OR followup_count <> 1 THEN
    RAISE EXCEPTION 'case parent guard inventory changed: %, %',
      wrapped_count, followup_count USING ERRCODE = '23514';
  END IF;
END;
$wrap$;

COMMIT;
