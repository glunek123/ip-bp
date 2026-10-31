-- Closed forward draft: no gate is opened; historical source audits remain readable.
BEGIN;
DO $migration$
DECLARE installed text; expected text := $old$
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
$old$; replacement text := $new$
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
     (audit."details" ? 'authorizationRevision' AND
      (jsonb_typeof(audit."details"->'authorizationRevision') IS DISTINCT FROM 'number' OR
       (audit."details"->>'authorizationRevision')::numeric <= 0 OR
       trunc((audit."details"->>'authorizationRevision')::numeric) IS DISTINCT FROM (audit."details"->>'authorizationRevision')::numeric)) OR
     (audit."details" - 'authorizationRevision') IS DISTINCT FROM jsonb_build_object(
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
$new$;
BEGIN
 SELECT p.prosrc INTO installed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname=current_schema()
 AND p.proname='case_early_closure_transition' AND p.proargtypes=ARRAY['cases'::regtype::oid,'cases'::regtype::oid]::oidvector
 AND p.prorettype='boolean'::regtype AND l.lanname='plpgsql' AND NOT p.prosecdef;
 IF replace(installed,E'\r\n',E'\n') IS DISTINCT FROM replace(expected,E'\r\n',E'\n') THEN RAISE EXCEPTION 'unexpected early closure transition function' USING ERRCODE='23514'; END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION %I.case_early_closure_transition(old_case cases,new_case cases) RETURNS boolean LANGUAGE plpgsql STABLE AS %L',current_schema(),replacement);
END; $migration$;
CREATE FUNCTION check_early_closure_source_authorization_revision_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a audit_events%ROWTYPE; revision integer;
BEGIN
 -- The existing actor guard locks user and authorization facts; lock independently
 -- so this guard does not depend on trigger ordering.
 SELECT authorization_revision INTO revision FROM user_accounts WHERE id=NEW.recorded_by_user_id FOR SHARE NOWAIT;
 SELECT * INTO a FROM audit_events WHERE id=NEW.audit_event_id AND xmin=pg_current_xact_id()::text::xid FOR SHARE NOWAIT;
 IF revision IS NULL OR revision <= 0 OR a.id IS NULL OR a.department_id IS DISTINCT FROM NEW.department_id
  OR a.actor_kind::text IS DISTINCT FROM 'HUMAN' OR a.actor_user_id IS DISTINCT FROM NEW.recorded_by_user_id
  OR a.internal_actor_user_id IS DISTINCT FROM NEW.recorded_by_user_id OR a.customer_account_binding_id IS NOT NULL
  OR a.lawyer_account_binding_id IS NOT NULL OR a.notary_office_account_binding_id IS NOT NULL
  OR a.resource_type IS DISTINCT FROM 'CASE' OR a.resource_id IS DISTINCT FROM NEW.case_id
  OR a.action IS DISTINCT FROM 'case.early_closed'
  OR jsonb_typeof(a.details->'authorizationRevision') IS DISTINCT FROM 'number'
  OR a.details->'authorizationRevision' IS DISTINCT FROM to_jsonb(revision)
 THEN RAISE EXCEPTION 'early closure source authorization revision mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER early_closure_source_authorization_revision_draft BEFORE INSERT ON case_early_closures
 FOR EACH ROW EXECUTE FUNCTION check_early_closure_source_authorization_revision_draft();
COMMIT;

