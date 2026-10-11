BEGIN;

-- Extend only the current PRIMARY lawyer's CASE draft path. The existing
-- binding, actor identity and assignment checks remain in the function.
DO $migration$
DECLARE old_definition text; new_definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO old_definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname = 'enforce_case_client_mailing_actor_path'
      AND p.pronargs = 0 AND p.prorettype = 'trigger'::regtype;
  IF old_definition IS NULL OR
     position('''SERVICE_DOCUMENT'', ''JUDGMENT'')' IN old_definition) = 0 OR
     position('WHEN NEW."category" = ''JUDGMENT'' THEN ''WAITING_JUDGMENT''' IN old_definition) = 0 OR
     position('''SECOND_INSTANCE_DOCUMENT'', ''SECOND_INSTANCE_SERVICE'', ''SECOND_INSTANCE_JUDGMENT''' IN old_definition) <> 0 THEN
    RAISE EXCEPTION 'unknown lawyer material actor path definition' USING ERRCODE = '23514';
  END IF;
  new_definition := replace(old_definition,
    '''SERVICE_DOCUMENT'', ''JUDGMENT'')',
    '''SERVICE_DOCUMENT'', ''JUDGMENT'', ''SECOND_INSTANCE_DOCUMENT'', ''SECOND_INSTANCE_SERVICE'', ''SECOND_INSTANCE_JUDGMENT'')');
  new_definition := replace(new_definition,
    'WHEN NEW."category" = ''JUDGMENT'' THEN ''WAITING_JUDGMENT''',
    'WHEN NEW."category" = ''JUDGMENT'' THEN ''WAITING_JUDGMENT''' || E'\n        ' ||
    'WHEN NEW."category" IN (''SECOND_INSTANCE_DOCUMENT'', ''SECOND_INSTANCE_SERVICE'', ''SECOND_INSTANCE_JUDGMENT'') THEN ''SECOND_INSTANCE''');
  EXECUTE new_definition;
END;
$migration$;

COMMIT;
