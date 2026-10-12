BEGIN;

-- The CA-011 actor guard already admits EXECUTION_APPLICATION drafts, but its
-- category list was expanded before the stage arm was replaced. The broad
-- replacement also changed that arm, leaving execution drafts at SECOND_INSTANCE.
DO $migration$
DECLARE
  definition text;
  corrected text;
  old_arm text := 'WHEN NEW."category" IN (''SECOND_INSTANCE_DOCUMENT'', ''SECOND_INSTANCE_SERVICE'', ''SECOND_INSTANCE_JUDGMENT'', ''EXECUTION_APPLICATION'') THEN ''SECOND_INSTANCE''';
  new_arm text := 'WHEN NEW."category" IN (''SECOND_INSTANCE_DOCUMENT'', ''SECOND_INSTANCE_SERVICE'', ''SECOND_INSTANCE_JUDGMENT'') THEN ''SECOND_INSTANCE''' || E'\n' ||
    '        WHEN NEW."category" = ''EXECUTION_APPLICATION'' THEN ''WAITING_EXECUTION_DOCUMENTS,WAITING_EXECUTION_CONFIRMATION''';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = current_schema() AND p.proname = 'enforce_case_client_mailing_actor_path'
    AND p.pronargs = 0 AND p.prorettype = 'trigger'::regtype;
  IF definition IS NULL OR
     length(definition) - length(replace(definition, old_arm, '')) <> length(old_arm) OR
     position('''EXECUTION_APPLICATION'') OR NEW."purpose" <> NEW."category"::text' IN definition) = 0 OR
     position('WHEN ''case.execution.submitted'' THEN ''WAITING_EXECUTION_DOCUMENTS,WAITING_EXECUTION_CONFIRMATION''' IN definition) = 0 OR
     position('JOIN "case_lawyer_assignments" a ON' IN definition) = 0 OR
     position('WHEN NEW."category" = ''EXECUTION_APPLICATION'' THEN ''WAITING_EXECUTION_DOCUMENTS,WAITING_EXECUTION_CONFIRMATION''' IN definition) <> 0 THEN
    RAISE EXCEPTION 'unknown lawyer execution upload actor path' USING ERRCODE = '23514';
  END IF;

  EXECUTE replace(definition, old_arm, new_arm);

  SELECT pg_get_functiondef(p.oid) INTO corrected
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = current_schema() AND p.proname = 'enforce_case_client_mailing_actor_path'
    AND p.pronargs = 0 AND p.prorettype = 'trigger'::regtype;
  IF corrected IS NULL OR position(old_arm IN corrected) <> 0 OR
     length(corrected) - length(replace(corrected,
       'WHEN NEW."category" = ''EXECUTION_APPLICATION'' THEN ''WAITING_EXECUTION_DOCUMENTS,WAITING_EXECUTION_CONFIRMATION''',
       '')) <> length('WHEN NEW."category" = ''EXECUTION_APPLICATION'' THEN ''WAITING_EXECUTION_DOCUMENTS,WAITING_EXECUTION_CONFIRMATION''') OR
     position('''EXECUTION_APPLICATION'') OR NEW."purpose" <> NEW."category"::text' IN corrected) = 0 OR
     position('WHEN ''case.execution.submitted'' THEN ''WAITING_EXECUTION_DOCUMENTS,WAITING_EXECUTION_CONFIRMATION''' IN corrected) = 0 OR
     position('JOIN "case_lawyer_assignments" a ON' IN corrected) = 0 THEN
    RAISE EXCEPTION 'lawyer execution upload actor path correction failed' USING ERRCODE = '23514';
  END IF;
END;
$migration$;

COMMIT;
