BEGIN;

-- Preserve the existing archive guard and add the note-to-audit invariant.
-- Older audit rows omit archiveNote. They remain valid when the stored note
-- is NULL; any non-NULL stored note must have an identical audited value.
DO $guard$
DECLARE
  definition text;
  needle text := $needle$a."details"->>'archiveReason' IS DISTINCT FROM v."archive_reason" OR$needle$;
  replacement text := $replacement$a."details"->>'archiveReason' IS DISTINCT FROM v."archive_reason" OR
   (a."details" ? 'archiveNote' AND a."details"->'archiveNote' IS DISTINCT FROM COALESCE(to_jsonb(v."archive_note"),'null'::jsonb)) OR
   (NOT (a."details" ? 'archiveNote') AND v."archive_note" IS NOT NULL) OR$replacement$;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = current_schema()
     AND p.proname = 'check_case_archive_final'
     AND pg_get_function_identity_arguments(p.oid) = '';

  IF definition IS NULL
     OR position(needle IN definition) = 0
     OR position('archiveNote' IN definition) > 0 THEN
    RAISE EXCEPTION 'unknown case archive audit guard' USING ERRCODE = '23514';
  END IF;

  EXECUTE replace(definition, needle, replacement);
END;
$guard$;

COMMIT;
