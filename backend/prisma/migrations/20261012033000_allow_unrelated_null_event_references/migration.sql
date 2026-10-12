-- Forward-only repair after 20261012031000_guard_execution_mailing_filing.
-- Preserve the complete reference scope/version/event guard; change only the
-- NULL-sensitive early return for unrelated material references.
BEGIN;
DO $migration$
DECLARE
  definition text;
  needle constant text := 'IF event_action<>''case.execution.mailed'' THEN RETURN NEW; END IF;';
  replacement constant text := 'IF event_action IS DISTINCT FROM ''case.execution.mailed'' THEN RETURN NEW; END IF;';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = current_schema()
    AND p.proname = 'check_case_execution_mailing_reference'
    AND p.pronargs = 0;

  IF definition IS NULL OR
     position('SELECT a."action" INTO event_action FROM "audit_events" a WHERE a."id"=NEW."action_event_id";' IN definition) = 0 OR
     position(needle IN definition) = 0 OR
     position('IF NEW."purpose"<>''MAIL_RECEIPT'' OR NEW."resource_type"<>''case'' THEN' IN definition) = 0 OR
     position('SELECT m."id" INTO fact_id FROM "case_execution_mailings" m' IN definition) = 0 OR
     position('"audit_event_id"=NEW."action_event_id"' IN definition) = 0 OR
     position('"content_version_id"=NEW."content_version_id"' IN definition) = 0 OR
     length(definition) - length(replace(definition, needle, '')) <> length(needle) THEN
    RAISE EXCEPTION 'unknown execution mailing reference guard shape' USING ERRCODE = '23514';
  END IF;

  EXECUTE replace(definition, needle, replacement);
END; $migration$;
COMMIT;
