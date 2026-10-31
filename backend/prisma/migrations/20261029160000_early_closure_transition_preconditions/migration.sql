-- Forward-only, fail-closed preparation for the early-closure transition.
-- The 120000 structure trigger still rejects INSERT. No HTTP command may use
-- this source until the existing closure/archive terminal guards are extended.
BEGIN;

ALTER TABLE "case_early_closures" ADD CONSTRAINT "case_early_closures_allowed_source_stage_check"
  CHECK ("from_stage" IN (
    'PENDING_MATCH', 'WAITING_COMPLAINT', 'WAITING_COMPLAINT_CONFIRMATION',
    'WAITING_COMPLAINT_STAMP', 'WAITING_FILING', 'WAITING_FORMAL_ACCEPTANCE',
    'WAITING_HEARING', 'WAITING_JUDGMENT', 'SECOND_INSTANCE',
    'WAITING_EXECUTION_DOCUMENTS', 'WAITING_EXECUTION_CONFIRMATION',
    'WAITING_EXECUTION_STAMP', 'WAITING_EXECUTION_FILING', 'EXECUTING'
  ));

-- This predicate is intentionally not wired into the existing parent guards.
-- It is the exact transition precondition to use when those guards can be
-- extended together, with their historical branches preserved.
CREATE FUNCTION "case_early_closure_transition"(old_case "cases", new_case "cases")
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE
  fact record;
  receipt record;
  audit record;
BEGIN
  IF old_case."id" IS DISTINCT FROM new_case."id" OR
     old_case."department_id" IS DISTINCT FROM new_case."department_id" OR
     old_case."stage" NOT IN (
       'PENDING_MATCH', 'WAITING_COMPLAINT', 'WAITING_COMPLAINT_CONFIRMATION',
       'WAITING_COMPLAINT_STAMP', 'WAITING_FILING', 'WAITING_FORMAL_ACCEPTANCE',
       'WAITING_HEARING', 'WAITING_JUDGMENT', 'SECOND_INSTANCE',
       'WAITING_EXECUTION_DOCUMENTS', 'WAITING_EXECUTION_CONFIRMATION',
       'WAITING_EXECUTION_STAMP', 'WAITING_EXECUTION_FILING', 'EXECUTING'
     ) OR new_case."stage" <> 'WAITING_ARCHIVE' OR
     new_case."version" IS DISTINCT FROM old_case."version" + 1 OR
     to_jsonb(new_case) - 'stage' - 'version' IS DISTINCT FROM
       to_jsonb(old_case) - 'stage' - 'version' THEN
    RETURN false;
  END IF;

  SELECT * INTO fact FROM "case_early_closures"
    WHERE "case_id" = new_case."id" AND "department_id" = new_case."department_id";
  IF fact."id" IS NULL OR fact."from_stage" IS DISTINCT FROM old_case."stage" OR
     fact."from_version" IS DISTINCT FROM old_case."version" OR
     fact."to_version" IS DISTINCT FROM new_case."version" OR
     EXISTS (SELECT 1 FROM "case_early_archives" WHERE "case_id" = new_case."id") OR
     EXISTS (SELECT 1 FROM "case_execution_finishes" WHERE "case_id" = new_case."id") OR
     EXISTS (SELECT 1 FROM "case_archives" WHERE "case_id" = new_case."id") THEN
    RETURN false;
  END IF;

  SELECT * INTO audit FROM "audit_events" WHERE "id" = fact."audit_event_id";
  SELECT * INTO receipt FROM "case_early_closure_receipts"
    WHERE "early_closure_id" = fact."id" AND "case_id" = fact."case_id" AND
      "department_id" = fact."department_id" AND
      "actor_user_id" = fact."recorded_by_user_id";
  IF audit."id" IS NULL OR audit."actor_kind" IS DISTINCT FROM 'HUMAN' OR
     audit."resource_type" IS DISTINCT FROM 'CASE' OR
     audit."resource_id" IS DISTINCT FROM fact."case_id" OR
     audit."department_id" IS DISTINCT FROM fact."department_id" OR
     audit."actor_user_id" IS DISTINCT FROM fact."recorded_by_user_id" OR
     audit."internal_actor_user_id" IS DISTINCT FROM fact."recorded_by_user_id" OR
     audit."customer_account_binding_id" IS NOT NULL OR
     audit."notary_office_account_binding_id" IS NOT NULL OR
     audit."lawyer_account_binding_id" IS NOT NULL OR
     audit."action" IS DISTINCT FROM 'case.early_closed' OR
     receipt."id" IS NULL OR
     receipt."request_fingerprint" !~ '^[0-9a-f]{64}$' OR
     audit."details" IS DISTINCT FROM jsonb_build_object(
       'earlyClosureId', fact."id", 'fromStage', fact."from_stage",
       'fromVersion', fact."from_version", 'toVersion', fact."to_version",
       'requestFingerprint', receipt."request_fingerprint") OR
     receipt."result_snapshot" IS DISTINCT FROM jsonb_build_object(
       'id', fact."case_id", 'earlyClosureId', fact."id",
       'fromStage', fact."from_stage", 'stage', 'WAITING_ARCHIVE',
       'version', fact."to_version", 'recordedAt',
       to_char(fact."recorded_at" AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

COMMIT;
