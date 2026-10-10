BEGIN;
-- Audit is inserted before the case CAS, so the lawyer path checks the source
-- WAITING_JUDGMENT stage. The deferred choice guard checks the target stage.
DO $migration$
DECLARE old_definition text; new_definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO old_definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname = 'enforce_case_client_mailing_actor_path'
      AND p.pronargs = 0 AND p.prorettype = 'trigger'::regtype;
  IF old_definition IS NULL OR position('WHEN ''case.judgment.registered'' THEN ''WAITING_JUDGMENT''' IN old_definition) = 0 OR
     position('WHEN ''case.judgment.next_step'' THEN ''WAITING_JUDGMENT''' IN old_definition) <> 0 THEN
    RAISE EXCEPTION 'unknown lawyer audit actor path definition' USING ERRCODE = '23514';
  END IF;
  new_definition := replace(old_definition,
    'WHEN ''case.judgment.registered'' THEN ''WAITING_JUDGMENT''',
    'WHEN ''case.judgment.registered'' THEN ''WAITING_JUDGMENT''' || E'\n          ' ||
    'WHEN ''case.judgment.next_step'' THEN ''WAITING_JUDGMENT''');
  EXECUTE new_definition;
END;
$migration$;
COMMIT;
