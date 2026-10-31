-- Review draft only; no old migration edited. Actual canonical266 catalog is the exact predecessor.
BEGIN;
DO $preflight$ DECLARE spec record; installed_proc record; BEGIN
 IF current_schema() IS DISTINCT FROM 'public' THEN RAISE EXCEPTION '3062 requires public' USING ERRCODE='23514'; END IF;
 IF to_regprocedure('public.case_early_terminal_workflow_context(public.cases)') IS NOT NULL THEN RAISE EXCEPTION '3062 helper already exists' USING ERRCODE='23514'; END IF;
 FOR spec IN SELECT * FROM (VALUES
('check_empty_remand_child_version','c868d47ec424de96502892262757d3cdbbcdf558765acbd75d545e06b75d4dcb'),
('check_retrial_prejudgment_version','7414e93f1c21083f4ab52bfcb7a892350c479f111f7970fa193c37007b745d6a'),
('check_case_trial_round_foundation','4b46ddab283667f951d44441ba5bf19ce819bccd2d3053169978f72f54f3a171'),
('check_case_judgment_final','574c8b3b929b350778d0141e84a375a92a7fc96aab7efc68d5957fa0310718bc'),
('check_case_judgment_next_step_final','19b6fc9165228a13c1a9b6a4c25e73165c6fec55e2c2a51d76063804b516da01'),
('check_case_second_instance_final','9caeb19b1b1842b8e44fbcbbaafd8113d6667e03540883c839f5be749d71a824'),
('check_case_execution_submission_final','da188c94423305ffd98fcbeba496a27a835a8486a9b363e626f5495785632b5b'),
('check_case_execution_confirmation_final','660536ac477fd81e3faace3ad9e172b43157e774c8fb9f86e3468fa90675b93d'),
('check_case_execution_mailing_final','a0fc6735f877a92f47664b467d1785d2f7824144b9705abfcebfa9b68d7e65b1'),
('check_case_execution_filing_final','b520caeeefe5a4574292e8b14fb21ce247cfedeecdb8efd29db94774fe10ebbe'),
('check_case_execution_finish_final','0a9264a8b22305de4ceac11ff508823ea6246571ec89693bae967f60c87de041')
 ) expected(name,sha) LOOP
 SELECT f.*,l.lanname INTO installed_proc FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace JOIN pg_language l ON l.oid=f.prolang WHERE n.nspname='public' AND f.proname=spec.name AND pg_get_function_identity_arguments(f.oid)='';
 IF installed_proc.oid IS NULL OR installed_proc.prokind<>'f' OR installed_proc.prosecdef OR installed_proc.proconfig IS NOT NULL OR installed_proc.lanname<>'plpgsql' OR installed_proc.provolatile<>'v' OR installed_proc.proparallel<>'u' OR installed_proc.prorettype<>'trigger'::regtype OR encode(sha256(convert_to(pg_get_functiondef(installed_proc.oid),'UTF8')),'hex') IS DISTINCT FROM spec.sha THEN RAISE EXCEPTION '3062 unexpected actual266 validator %',spec.name USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR spec IN SELECT * FROM (VALUES
('case_acceptances','case_trial_round_acceptance_guard','check_case_trial_round_foundation','CREATE CONSTRAINT TRIGGER case_trial_round_acceptance_guard AFTER INSERT ON case_acceptances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_trial_round_foundation()'),
('case_execution_confirmations','case_execution_confirmation_fact_guard','check_case_execution_confirmation_final','CREATE CONSTRAINT TRIGGER case_execution_confirmation_fact_guard AFTER INSERT ON case_execution_confirmations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_confirmation_final()'),
('case_execution_filings','case_execution_filing_fact_guard','check_case_execution_filing_final','CREATE CONSTRAINT TRIGGER case_execution_filing_fact_guard AFTER INSERT ON case_execution_filings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_filing_final()'),
('case_execution_finishes','case_execution_finish_fact_guard','check_case_execution_finish_final','CREATE CONSTRAINT TRIGGER case_execution_finish_fact_guard AFTER INSERT ON case_execution_finishes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_finish_final()'),
('case_execution_mailings','case_execution_mailing_fact_guard','check_case_execution_mailing_final','CREATE CONSTRAINT TRIGGER case_execution_mailing_fact_guard AFTER INSERT ON case_execution_mailings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_mailing_final()'),
('case_execution_submissions','case_execution_submission_guard','check_case_execution_submission_final','CREATE CONSTRAINT TRIGGER case_execution_submission_guard AFTER INSERT ON case_execution_submissions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_submission_final()'),
('case_hearing_advances','case_trial_round_advance_guard','check_case_trial_round_foundation','CREATE CONSTRAINT TRIGGER case_trial_round_advance_guard AFTER INSERT ON case_hearing_advances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_trial_round_foundation()'),
('case_hearing_arrangements','case_trial_round_hearing_guard','check_case_trial_round_foundation','CREATE CONSTRAINT TRIGGER case_trial_round_hearing_guard AFTER INSERT ON case_hearing_arrangements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_trial_round_foundation()'),
('case_judgment_facts','case_judgment_fact_guard','check_case_judgment_final','CREATE CONSTRAINT TRIGGER case_judgment_fact_guard AFTER INSERT ON case_judgment_facts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_judgment_final()'),
('case_judgment_facts','case_trial_round_judgment_guard','check_case_trial_round_foundation','CREATE CONSTRAINT TRIGGER case_trial_round_judgment_guard AFTER INSERT ON case_judgment_facts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_trial_round_foundation()'),
('case_judgment_next_step_revocations','case_judgment_next_step_revoke_guard','check_case_judgment_next_step_final','CREATE CONSTRAINT TRIGGER case_judgment_next_step_revoke_guard AFTER INSERT ON case_judgment_next_step_revocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_judgment_next_step_final()'),
('case_judgment_next_steps','case_judgment_next_step_fact_guard','check_case_judgment_next_step_final','CREATE CONSTRAINT TRIGGER case_judgment_next_step_fact_guard AFTER INSERT ON case_judgment_next_steps DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_judgment_next_step_final()'),
('case_judgment_next_steps','case_trial_round_choice_guard','check_case_trial_round_foundation','CREATE CONSTRAINT TRIGGER case_trial_round_choice_guard AFTER INSERT ON case_judgment_next_steps DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_trial_round_foundation()'),
('case_second_instance_progresses','case_second_instance_progress_guard','check_case_second_instance_final','CREATE CONSTRAINT TRIGGER case_second_instance_progress_guard AFTER INSERT ON case_second_instance_progresses DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_second_instance_final()'),
('case_second_instance_result_revocations','case_second_instance_revoke_guard','check_case_second_instance_final','CREATE CONSTRAINT TRIGGER case_second_instance_revoke_guard AFTER INSERT ON case_second_instance_result_revocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_second_instance_final()'),
('case_second_instance_results','case_second_instance_result_guard','check_case_second_instance_final','CREATE CONSTRAINT TRIGGER case_second_instance_result_guard AFTER INSERT ON case_second_instance_results DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_second_instance_final()'),
('case_trial_rounds','case_trial_round_round_guard','check_case_trial_round_foundation','CREATE CONSTRAINT TRIGGER case_trial_round_round_guard AFTER INSERT ON case_trial_rounds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_trial_round_foundation()'),
('cases','case_execution_confirmation_head_guard','check_case_execution_confirmation_final','CREATE CONSTRAINT TRIGGER case_execution_confirmation_head_guard AFTER UPDATE OF stage, version, current_execution_submission_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_confirmation_final()'),
('cases','case_execution_filing_head_guard','check_case_execution_filing_final','CREATE CONSTRAINT TRIGGER case_execution_filing_head_guard AFTER UPDATE OF stage, version, current_execution_submission_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_filing_final()'),
('cases','case_execution_finish_head_guard','check_case_execution_finish_final','CREATE CONSTRAINT TRIGGER case_execution_finish_head_guard AFTER UPDATE OF stage, version, current_execution_submission_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_finish_final()'),
('cases','case_execution_head_guard','check_case_execution_submission_final','CREATE CONSTRAINT TRIGGER case_execution_head_guard AFTER UPDATE OF stage, version, current_trial_round_id, current_judgment_next_step_id, current_second_instance_result_id, current_execution_submission_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_submission_final()'),
('cases','case_execution_mailing_head_guard','check_case_execution_mailing_final','CREATE CONSTRAINT TRIGGER case_execution_mailing_head_guard AFTER UPDATE OF stage, version, current_execution_submission_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_mailing_final()'),
('cases','case_judgment_case_guard','check_case_judgment_final','CREATE CONSTRAINT TRIGGER case_judgment_case_guard AFTER UPDATE OF stage, version, current_judgment_id, current_judgment_next_step_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_judgment_final()'),
('cases','case_judgment_next_step_case_guard','check_case_judgment_next_step_final','CREATE CONSTRAINT TRIGGER case_judgment_next_step_case_guard AFTER UPDATE OF stage, version, current_judgment_id, current_judgment_next_step_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_judgment_next_step_final()'),
('cases','case_second_instance_case_guard','check_case_second_instance_final','CREATE CONSTRAINT TRIGGER case_second_instance_case_guard AFTER UPDATE OF stage, version, current_trial_round_id, current_second_instance_progress_id, current_second_instance_result_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_second_instance_final()'),
('cases','case_trial_round_case_guard','check_case_trial_round_foundation','CREATE CONSTRAINT TRIGGER case_trial_round_case_guard AFTER INSERT OR UPDATE OF stage, current_trial_round_id, current_acceptance_id, court_case_no, current_hearing_arrangement_id, current_hearing_advance_id, current_judgment_id, current_judgment_next_step_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_trial_round_foundation()'),
('cases','cases_empty_remand_child_version_guard','check_empty_remand_child_version','CREATE CONSTRAINT TRIGGER cases_empty_remand_child_version_guard AFTER INSERT OR UPDATE ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_empty_remand_child_version()'),
('cases','cases_retrial_prejudgment_version_guard','check_retrial_prejudgment_version','CREATE CONSTRAINT TRIGGER cases_retrial_prejudgment_version_guard AFTER INSERT OR UPDATE ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_retrial_prejudgment_version()')
 ) expected(tbl,name,fn,definition) LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid=format('public.%I',spec.tbl)::regclass AND t.tgname=spec.name AND p.proname=spec.fn AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgconstraint<>0 AND t.tgdeferrable AND t.tginitdeferred AND t.tgqual IS NULL AND octet_length(t.tgargs)=0 AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL AND pg_get_triggerdef(t.oid,true)=spec.definition) THEN RAISE EXCEPTION '3062 unexpected actual266 trigger %',spec.name USING ERRCODE='23514'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND NOT t.tgisinternal AND p.proname IN ('check_empty_remand_child_version','check_retrial_prejudgment_version','check_case_trial_round_foundation','check_case_judgment_final','check_case_judgment_next_step_final','check_case_second_instance_final','check_case_execution_submission_final','check_case_execution_confirmation_final','check_case_execution_mailing_final','check_case_execution_filing_final','check_case_execution_finish_final'))<>28 THEN RAISE EXCEPTION '3062 validator trigger inventory changed' USING ERRCODE='23514'; END IF;
 FOR spec IN SELECT * FROM (VALUES
('case_archive_source_checks','c cases, source_stage case_stage','8a255873ec5ddefd3bc3b46c120dbc9107bc314c5cf1cec98a9b9bf528ad23dc'),
('case_closure_source_terminal_version','target_case uuid, target_department uuid, target_finish uuid, finish_version integer','c2ecc7401760e46c19ea99e15a29b0119a26b4c36219bfba70e5bff001b9c80a'),
('case_archive_terminal_version','target_case uuid, target_department uuid, target_closure uuid, target_closure_version uuid, closure_version integer','368307c9fffd3e7f67c44cbb57f81e2c00f5124662d3baf9efde446d13070548')
 ) expected(name,args,sha) LOOP
 SELECT f.* INTO installed_proc FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname='public' AND f.proname=spec.name AND pg_get_function_identity_arguments(f.oid)=spec.args;
 IF installed_proc.oid IS NULL OR installed_proc.prokind<>'f' OR installed_proc.prosecdef OR installed_proc.proconfig IS NOT NULL OR encode(sha256(convert_to(pg_get_functiondef(installed_proc.oid),'UTF8')),'hex') IS DISTINCT FROM spec.sha THEN RAISE EXCEPTION '3062 source chain helper changed %',spec.name USING ERRCODE='23514'; END IF;
 END LOOP;
END; $preflight$;

-- DRAFT: static source only. Not installed or PG-compiled. Root owns real rollback compilation and API matrix.
CREATE FUNCTION public.case_early_terminal_workflow_context(c public.cases)
RETURNS public.cases LANGUAGE plpgsql STABLE AS $context$
DECLARE e record; a record; r record; h record; v record; closure_terminal integer; archive_terminal integer; projected public.cases;
BEGIN
 -- Ordinary workflow and external-entry paths retain their actual context.
 IF c.id IS NULL OR c.source_lead_id IS NULL OR c.stage NOT IN ('WAITING_ARCHIVE','ARCHIVED') THEN RETURN c; END IF;
 SELECT * INTO e FROM public.case_early_closures WHERE case_id=c.id AND department_id=c.department_id;
 IF e.id IS NULL THEN RETURN c; END IF;
 IF e.source_stage_locked IS NOT TRUE OR e.from_version IS NULL OR e.from_version<1 OR e.to_version IS DISTINCT FROM e.from_version+1
  OR e.from_stage NOT IN ('PENDING_MATCH','WAITING_COMPLAINT','WAITING_COMPLAINT_CONFIRMATION','WAITING_COMPLAINT_STAMP','WAITING_FILING','WAITING_FORMAL_ACCEPTANCE','WAITING_HEARING','WAITING_JUDGMENT','SECOND_INSTANCE','WAITING_EXECUTION_DOCUMENTS','WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING')
  OR EXISTS(SELECT 1 FROM public.case_external_entries x WHERE x.case_id=c.id)
  OR EXISTS(SELECT 1 FROM public.case_early_archives x WHERE x.case_id=c.id)
  OR EXISTS(SELECT 1 FROM public.case_execution_finishes x WHERE x.case_id=c.id)
  OR NOT EXISTS(SELECT 1 FROM public.leads l JOIN public.notary_matters nm ON nm.id=c.source_notary_matter_id AND nm.source_type='LEAD' AND nm.source_lead_id=l.id AND nm.department_id=c.department_id AND nm.customer_id=c.customer_id AND nm.rights_holder_id=c.rights_holder_id
   JOIN public.notary_certificates nc ON nc.id=c.certificate_id AND nc.matter_id=nm.id AND nc.department_id=c.department_id
   WHERE l.id=c.source_lead_id AND l.department_id=c.department_id AND l.customer_id=c.customer_id AND l.rights_holder_id=c.rights_holder_id)
  OR public.case_archive_source_checks(c,e.from_stage) IS NOT TRUE
 THEN RAISE EXCEPTION 'normal early terminal source identity mismatch' USING ERRCODE='23514'; END IF;
 SELECT * INTO a FROM public.audit_events WHERE id=e.audit_event_id;
 SELECT * INTO r FROM public.case_early_closure_receipts WHERE early_closure_id=e.id AND case_id=e.case_id AND department_id=e.department_id AND actor_user_id=e.recorded_by_user_id;
 IF a.id IS NULL OR a.actor_kind IS DISTINCT FROM 'HUMAN' OR a.resource_type IS DISTINCT FROM 'CASE' OR a.resource_id IS DISTINCT FROM c.id OR a.department_id IS DISTINCT FROM c.department_id
  OR a.actor_user_id IS DISTINCT FROM e.recorded_by_user_id OR a.internal_actor_user_id IS DISTINCT FROM e.recorded_by_user_id
  OR a.customer_account_binding_id IS NOT NULL OR a.notary_office_account_binding_id IS NOT NULL OR a.lawyer_account_binding_id IS NOT NULL OR a.action IS DISTINCT FROM 'case.early_closed'
  OR r.id IS NULL OR r.request_fingerprint !~ '^[0-9a-f]{64}$'
  OR (a.details ? 'authorizationRevision' AND (jsonb_typeof(a.details->'authorizationRevision') IS DISTINCT FROM 'number' OR (a.details->>'authorizationRevision')::numeric<=0 OR trunc((a.details->>'authorizationRevision')::numeric) IS DISTINCT FROM (a.details->>'authorizationRevision')::numeric))
  OR (a.details-'authorizationRevision') IS DISTINCT FROM jsonb_build_object('earlyClosureId',e.id,'fromStage',e.from_stage,'fromVersion',e.from_version,'toVersion',e.to_version,'requestFingerprint',r.request_fingerprint)
  OR r.result_snapshot IS DISTINCT FROM jsonb_build_object('id',e.case_id,'earlyClosureId',e.id,'fromStage',e.from_stage,'stage','WAITING_ARCHIVE','version',e.to_version,'recordedAt',to_char(e.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
 THEN RAISE EXCEPTION 'normal early terminal typed source receipt mismatch' USING ERRCODE='23514'; END IF;
 SELECT * INTO h FROM public.case_closures WHERE case_id=c.id AND department_id=c.department_id;
 SELECT * INTO v FROM public.case_closure_versions WHERE id=h.current_version_id AND closure_id=h.id AND case_id=c.id AND department_id=c.department_id;
 IF h.id IS NULL OR h.early_closure_id IS DISTINCT FROM e.id OR h.finish_id IS NOT NULL OR h.external_entry_id IS NOT NULL
  OR v.id IS NULL OR v.early_closure_id IS DISTINCT FROM e.id OR v.finish_id IS NOT NULL OR v.external_entry_id IS NOT NULL
 THEN RAISE EXCEPTION 'normal early terminal closure identity mismatch' USING ERRCODE='23514'; END IF;
 -- These existing DB-fact walkers reject gaps, forks, detached versions and wrong heads. Never MAX/>=.
 closure_terminal:=public.case_closure_source_terminal_version(c.id,c.department_id,NULL,e.to_version);
 IF v.to_version IS DISTINCT FROM closure_terminal THEN RAISE EXCEPTION 'normal early terminal closure chain mismatch' USING ERRCODE='23514'; END IF;
 IF c.stage='WAITING_ARCHIVE' THEN
  IF c.version IS DISTINCT FROM closure_terminal OR EXISTS(SELECT 1 FROM public.case_archives x WHERE x.case_id=c.id AND x.department_id=c.department_id)
   THEN RAISE EXCEPTION 'normal early terminal waiting head mismatch' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.case_archives x WHERE x.case_id=c.id AND x.department_id=c.department_id AND x.closure_id=h.id AND x.closure_version_id=v.id)
   THEN RAISE EXCEPTION 'normal early terminal archive anchor mismatch' USING ERRCODE='23514'; END IF;
  archive_terminal:=public.case_archive_terminal_version(c.id,c.department_id,h.id,v.id,closure_terminal);
  IF c.version IS DISTINCT FROM archive_terminal THEN RAISE EXCEPTION 'normal early terminal archive chain mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 -- This is reconstruction from immutable typed roots and exact version walks, NOT an alleged historical full-row snapshot.
 -- Current editable fields and effective acceptance/correction chains remain current; all original causal guard SQL still runs.
 projected:=c;projected.stage:=e.from_stage;projected.version:=e.from_version;RETURN projected;
END; $context$;

CREATE OR REPLACE FUNCTION public.check_empty_remand_child_version()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE current_case record; current_round record; source_result record;
BEGIN
  IF TG_TABLE_NAME = 'cases' AND TG_OP = 'UPDATE' THEN
    IF case_early_closure_transition(OLD, NEW) OR case_early_closure_register_transition(OLD, NEW) OR case_early_closure_correction_transition(OLD, NEW) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN
    IF TG_OP = 'UPDATE' THEN
      IF case_early_archive_transition(OLD, NEW) THEN RETURN NEW; END IF;
    END IF;
  END IF;
SELECT * INTO current_case FROM "cases" WHERE "id" = NEW."id";
  -- Only the local litigation head's temporal context changes. No NEW/OLD/fact/DB row projection.
  IF TG_TABLE_NAME='cases' THEN
    SELECT projected.stage,projected.version INTO current_case.stage,current_case.version
      FROM public.cases physical_case
      CROSS JOIN LATERAL public.case_early_terminal_workflow_context(physical_case) projected
      WHERE physical_case.id=NEW.id AND physical_case.department_id=NEW.department_id;
  END IF;
  IF current_case."id" IS NULL OR current_case."stage" <> 'WAITING_FORMAL_ACCEPTANCE' OR
     current_case."current_acceptance_id" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT "id", "sequence", "source_result_id", "revoked_at" INTO current_round
    FROM "case_trial_rounds"
    WHERE "id" = current_case."current_trial_round_id" AND "case_id" = current_case."id"
      AND "department_id" = current_case."department_id";
  IF current_round."id" IS NULL OR current_round."sequence" = 1 OR
     current_round."revoked_at" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT "id", "to_version" INTO source_result FROM "case_second_instance_results"
    WHERE "id" = current_round."source_result_id" AND "case_id" = current_case."id"
      AND "department_id" = current_case."department_id" AND "result" = 'REMAND';
  IF source_result."id" IS NULL OR current_case."version" IS DISTINCT FROM source_result."to_version" THEN
    RAISE EXCEPTION 'unaccepted remand child version differs from source result' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.check_retrial_prejudgment_version()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE c record; current_round record; source_result record; accepted record;
        arrangement record; advance record; correction record; expected_version integer;
BEGIN
  IF TG_TABLE_NAME = 'cases' AND TG_OP = 'UPDATE' THEN
    IF case_early_closure_transition(OLD, NEW) OR case_early_closure_register_transition(OLD, NEW) OR case_early_closure_correction_transition(OLD, NEW) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN
    IF TG_OP = 'UPDATE' THEN
      IF case_early_archive_transition(OLD, NEW) THEN RETURN NEW; END IF;
    END IF;
  END IF;
SELECT * INTO c FROM "cases" WHERE "id" = NEW."id";
  -- Only the local litigation head's temporal context changes. No NEW/OLD/fact/DB row projection.
  IF TG_TABLE_NAME='cases' THEN
    SELECT projected.stage,projected.version INTO c.stage,c.version
      FROM public.cases physical_case
      CROSS JOIN LATERAL public.case_early_terminal_workflow_context(physical_case) projected
      WHERE physical_case.id=NEW.id AND physical_case.department_id=NEW.department_id;
  END IF;
  SELECT "id", "sequence", "source_result_id" INTO current_round FROM "case_trial_rounds"
    WHERE "id" = c."current_trial_round_id" AND "case_id" = c."id"
      AND "department_id" = c."department_id";
  IF current_round."id" IS NULL OR current_round."sequence" = 1 OR
     c."current_acceptance_id" IS NULL OR c."current_judgment_id" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT "id", "to_version" INTO source_result FROM "case_second_instance_results"
    WHERE "id" = current_round."source_result_id" AND "case_id" = c."id"
      AND "department_id" = c."department_id" AND "result" = 'REMAND';
  SELECT "id", "audit_event_id", "recorded_by_user_id" INTO accepted FROM "case_acceptances"
    WHERE "id" = c."current_acceptance_id" AND "case_id" = c."id"
      AND "department_id" = c."department_id" AND "trial_round_id" = current_round."id";
  expected_version := source_result."to_version" + 1;
  IF source_result."id" IS NULL OR accepted."id" IS NULL OR
     NOT EXISTS (SELECT 1 FROM "audit_events" e
       WHERE e."id" = accepted."audit_event_id" AND e."department_id" = c."department_id"
         AND e."resource_type" = 'CASE' AND e."resource_id" = c."id"
         AND e."action" = 'case.acceptance.registered'
         AND e."actor_user_id" = accepted."recorded_by_user_id"
         AND e."details"->>'fromVersion' = source_result."to_version"::text
         AND e."details"->>'toVersion' = expected_version::text) THEN
    RAISE EXCEPTION 'retrial acceptance lacks exact source version' USING ERRCODE = '23514';
  END IF;

  IF c."current_hearing_arrangement_id" IS NULL THEN
    IF c."current_hearing_advance_id" IS NOT NULL OR c."stage" <> 'WAITING_HEARING' THEN
      RAISE EXCEPTION 'retrial acceptance stage/head mismatch' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT "id", "to_version" INTO arrangement FROM "case_hearing_arrangements"
      WHERE "id" = c."current_hearing_arrangement_id" AND "case_id" = c."id"
        AND "department_id" = c."department_id" AND "trial_round_id" = current_round."id";
    IF arrangement."id" IS NULL THEN
      RAISE EXCEPTION 'retrial hearing head missing' USING ERRCODE = '23514';
    END IF;
    expected_version := arrangement."to_version";
    IF c."current_hearing_advance_id" IS NULL THEN
      IF c."stage" <> 'WAITING_HEARING' THEN
        RAISE EXCEPTION 'retrial scheduled hearing stage mismatch' USING ERRCODE = '23514';
      END IF;
    ELSE
      SELECT "id", "arrangement_id", "to_version" INTO advance FROM "case_hearing_advances"
        WHERE "id" = c."current_hearing_advance_id" AND "case_id" = c."id"
          AND "department_id" = c."department_id" AND "trial_round_id" = current_round."id";
      IF advance."id" IS NULL OR c."stage" <> 'WAITING_JUDGMENT' THEN
        RAISE EXCEPTION 'retrial advance stage/head mismatch' USING ERRCODE = '23514';
      END IF;
      IF advance."arrangement_id" = arrangement."id" THEN
        expected_version := advance."to_version";
      ELSE
        SELECT "id", "to_version" INTO correction FROM "case_hearing_corrections"
          WHERE "new_arrangement_id" = arrangement."id" AND "prior_advance_id" = advance."id"
            AND "case_id" = c."id" AND "department_id" = c."department_id"
            AND "result_stage" = 'WAITING_JUDGMENT';
        IF correction."id" IS NULL OR correction."to_version" <> arrangement."to_version" THEN
          RAISE EXCEPTION 'retrial corrected hearing head mismatch' USING ERRCODE = '23514';
        END IF;
      END IF;
    END IF;
  END IF;
  IF c."version" IS DISTINCT FROM expected_version THEN
    RAISE EXCEPTION 'retrial case version lacks current round fact' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.check_case_trial_round_foundation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; c record; r record; source_result record;
BEGIN
  IF TG_TABLE_NAME='cases' THEN
    IF normal_pending_early_terminal(NEW.id,NEW.department_id) OR (NEW.current_trial_round_id IS NULL AND normal_prejudgment_early_terminal(NEW.id,NEW.department_id)) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' AND TG_OP = 'UPDATE' THEN
    IF case_early_closure_transition(OLD, NEW) OR case_early_closure_register_transition(OLD, NEW) OR case_early_closure_correction_transition(OLD, NEW) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN
    IF TG_OP = 'UPDATE' THEN
      IF case_early_archive_transition(OLD, NEW) THEN RETURN NEW; END IF;
    END IF;
  END IF;
IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id" = target_case AND "department_id" = target_department;
  -- Only the local litigation head's temporal context changes. No NEW/OLD/fact/DB row projection.
  IF TG_TABLE_NAME='cases' THEN
    SELECT projected.stage,projected.version INTO c.stage,c.version
      FROM public.cases physical_case
      CROSS JOIN LATERAL public.case_early_terminal_workflow_context(physical_case) projected
      WHERE physical_case.id=NEW.id AND physical_case.department_id=NEW.department_id;
  END IF;
  IF c."source_lead_id" IS NULL THEN PERFORM ca018_assert_external_trial_round(target_case,target_department); RETURN NEW; END IF;
  IF c."current_trial_round_id" IS NULL THEN
    IF c."current_acceptance_id" IS NOT NULL OR c."stage" IN
      ('WAITING_HEARING','WAITING_JUDGMENT','SECOND_INSTANCE','WAITING_EXECUTION_DOCUMENTS','WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED') OR
      c."current_second_instance_progress_id" IS NOT NULL OR c."current_second_instance_result_id" IS NOT NULL OR
      EXISTS (SELECT 1 FROM "case_trial_rounds" x WHERE x."case_id" = target_case AND x."department_id" = target_department) OR
      EXISTS (SELECT 1 FROM "case_acceptances" a WHERE a."case_id" = target_case AND a."department_id" = target_department) THEN
      RAISE EXCEPTION 'accepted case has no active trial round' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO r FROM "case_trial_rounds" WHERE "id" = c."current_trial_round_id"
      AND "case_id" = target_case AND "department_id" = target_department;
    IF r."id" IS NULL OR r."revoked_at" IS NOT NULL THEN
      RAISE EXCEPTION 'active trial round missing or revoked' USING ERRCODE = '23514';
    END IF;
    IF r."sequence" = 1 THEN
      IF r."source_result_id" IS NOT NULL OR c."current_acceptance_id" IS NULL OR
         NOT EXISTS (SELECT 1 FROM "case_acceptances" a WHERE a."id" = c."current_acceptance_id"
           AND a."trial_round_id" = r."id" AND a."case_id" = target_case AND a."department_id" = target_department
           AND case_effective_acceptance_no(a."id") = c."court_case_no") THEN
        RAISE EXCEPTION 'initial trial round or acceptance mismatch' USING ERRCODE = '23514';
      END IF;
    ELSE
      SELECT s."id", s."case_id", s."department_id", s."trial_round_id", s."result", s."to_version", v."id" AS revocation_id
        INTO source_result FROM "case_second_instance_results" s
        LEFT JOIN "case_second_instance_result_revocations" v ON v."result_id" = s."id"
        WHERE s."id" = r."source_result_id" AND s."case_id" = target_case AND s."department_id" = target_department;
      IF source_result."id" IS NULL OR source_result."result" <> 'REMAND' OR source_result.revocation_id IS NOT NULL OR
         r."sequence" <= (SELECT p."sequence" FROM "case_trial_rounds" p WHERE p."id" = source_result."trial_round_id") THEN
        RAISE EXCEPTION 'later trial round lacks active remand source' USING ERRCODE = '23514';
      END IF;
      IF c."current_acceptance_id" IS NULL THEN
        IF c."stage" <> 'WAITING_FORMAL_ACCEPTANCE' OR c."current_second_instance_result_id" IS DISTINCT FROM source_result."id" OR
           c."court_case_no" IS NOT NULL OR c."current_hearing_arrangement_id" IS NOT NULL OR
           c."current_hearing_advance_id" IS NOT NULL OR c."current_judgment_id" IS NOT NULL OR
           c."current_judgment_next_step_id" IS NOT NULL OR c."current_second_instance_progress_id" IS NOT NULL THEN
          RAISE EXCEPTION 'unaccepted remand child pointers mismatch' USING ERRCODE = '23514';
        END IF;
      ELSIF NOT EXISTS (SELECT 1 FROM "case_acceptances" a WHERE a."id" = c."current_acceptance_id"
        AND a."trial_round_id" = r."id" AND a."case_id" = target_case AND a."department_id" = target_department
        AND case_effective_acceptance_no(a."id") = c."court_case_no") OR c."current_second_instance_result_id" IS NOT NULL THEN
        RAISE EXCEPTION 'accepted remand child pointers mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'case_trial_rounds' THEN
    IF NEW."revoked_at" IS NOT NULL OR c."current_trial_round_id" IS DISTINCT FROM NEW."id" OR
       NEW."sequence" <> (SELECT COALESCE(MAX(p."sequence"),0) + 1 FROM "case_trial_rounds" p
         WHERE p."case_id" = target_case AND p."department_id" = target_department AND p."id" <> NEW."id") OR
       (NEW."sequence" = 1 AND NEW."source_result_id" IS NOT NULL) OR
       (NEW."sequence" > 1 AND NOT EXISTS (SELECT 1 FROM "case_second_instance_results" s
         WHERE s."id" = NEW."source_result_id" AND s."case_id" = target_case AND s."department_id" = target_department
           AND s."result" = 'REMAND' AND s."to_version" = c."version")) THEN
      RAISE EXCEPTION 'new trial round requires exact remand result' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME <> 'cases' THEN
    IF NEW."trial_round_id" IS DISTINCT FROM c."current_trial_round_id" THEN
      RAISE EXCEPTION 'new case fact must belong to current trial round' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF (c."current_hearing_arrangement_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_hearing_arrangements" x WHERE x."id" = c."current_hearing_arrangement_id"
        AND x."trial_round_id" = c."current_trial_round_id")) OR
     (c."current_hearing_advance_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_hearing_advances" x WHERE x."id" = c."current_hearing_advance_id"
        AND x."trial_round_id" = c."current_trial_round_id")) OR
     (c."current_judgment_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_judgment_facts" x WHERE x."id" = c."current_judgment_id"
        AND x."trial_round_id" = c."current_trial_round_id")) OR
     (c."current_judgment_next_step_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_judgment_next_steps" x WHERE x."id" = c."current_judgment_next_step_id"
        AND x."trial_round_id" = c."current_trial_round_id")) OR
     (c."current_second_instance_progress_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_second_instance_progresses" x WHERE x."id" = c."current_second_instance_progress_id"
        AND x."trial_round_id" = c."current_trial_round_id")) OR
     (c."current_second_instance_result_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_second_instance_results" x WHERE x."id" = c."current_second_instance_result_id"
        AND (x."trial_round_id" = c."current_trial_round_id" OR
          (x."result" = 'REMAND' AND EXISTS (SELECT 1 FROM "case_trial_rounds" child
            WHERE child."id" = c."current_trial_round_id" AND child."source_result_id" = x."id"))))) THEN
    RAISE EXCEPTION 'case current pointer crosses trial rounds' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.check_case_judgment_final()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; case_head record; round_id uuid;
        latest_judgment record; latest_choice record; latest_revoke record; latest_progress record; active_result record; latest_result_revocation record;
        root_count integer; expected_version integer; expected_stage text;
BEGIN
  IF TG_TABLE_NAME='cases' THEN
    IF normal_pending_early_terminal(NEW.id,NEW.department_id) OR normal_initial_appeal_early_terminal(NEW.id,NEW.department_id) OR normal_prejudgment_early_terminal(NEW.id,NEW.department_id) OR normal_initial_execution_early_terminal(NEW.id,NEW.department_id) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' AND TG_OP = 'UPDATE' THEN
    IF case_early_closure_transition(OLD, NEW) OR case_early_closure_register_transition(OLD, NEW) OR case_early_closure_correction_transition(OLD, NEW) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN
    IF TG_OP = 'UPDATE' THEN
      IF case_early_archive_transition(OLD, NEW) THEN RETURN NEW; END IF;
    END IF;
  END IF;
IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; ELSE target_case:=NEW."case_id"; END IF;
  target_department:=NEW."department_id";
  IF EXISTS (SELECT 1 FROM "case_external_entries" e WHERE e."case_id"=target_case
    AND e."department_id"=NEW."department_id") THEN
    PERFORM ca018_assert_external_trial_round(target_case,NEW."department_id");
    IF TG_TABLE_NAME='cases' AND (external_prehearing_early_empty_judgment_draft(target_case,NEW."department_id") OR external_unadvanced_round_early_terminal(target_case,NEW."department_id")) THEN RETURN NEW; END IF;
    IF ca018_h_is_unadvanced_root(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF ca018_h_downstream_entry_without_judgment(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM "case_external_entries" e JOIN "cases" c ON c."id"=e."case_id" AND c."department_id"=e."department_id"
      WHERE c."id"=target_case AND e."initial_stage"='SECOND_INSTANCE'
        AND c."current_judgment_id" IS NULL) THEN
      PERFORM ca018_h_direct_second_chain(target_case,NEW."department_id");
      RETURN NEW;
    END IF;
    IF TG_TABLE_NAME='case_judgment_facts' THEN
      IF NOT EXISTS (
      SELECT 1 FROM "case_external_entries" e JOIN "case_trial_rounds" r ON r."case_id"=e."case_id" AND r."department_id"=e."department_id"
      WHERE e."case_id"=NEW."case_id" AND e."department_id"=NEW."department_id" AND r."id"=NEW."trial_round_id"
        AND NEW."external_entry_id"=e."id" AND NEW."judgment_received_at">=e."stage_reached_on"
        AND (e."known"->>'acceptedOn' IS NULL OR NEW."judgment_received_at">=(e."known"->>'acceptedOn')::date)
        AND (r."origin"<>'EXTERNAL_CURRENT' OR e."initial_stage"='WAITING_JUDGMENT' OR
          (e."initial_stage"='WAITING_HEARING' AND EXISTS (SELECT 1 FROM "case_hearing_advances" h
            WHERE h."id"=(SELECT c."current_hearing_advance_id" FROM "cases" c WHERE c."id"=NEW."case_id")
              AND h."trial_round_id"=r."id" AND h."external_entry_id"=e."id")) OR EXISTS (
            SELECT 1 FROM "cases" progressed
            JOIN "case_acceptances" acceptance ON acceptance."id"=progressed."current_acceptance_id"
              AND acceptance."case_id"=progressed."id" AND acceptance."department_id"=progressed."department_id"
              AND acceptance."trial_round_id"=r."id" AND acceptance."external_entry_id"=e."id"
            JOIN "case_hearing_advances" advance ON advance."id"=progressed."current_hearing_advance_id"
              AND advance."case_id"=progressed."id" AND advance."department_id"=progressed."department_id"
              AND advance."trial_round_id"=r."id" AND advance."external_entry_id"=e."id"
            WHERE progressed."id"=NEW."case_id" AND progressed."department_id"=NEW."department_id"
              AND progressed."current_trial_round_id"=r."id"))) THEN
        RAISE EXCEPTION 'external judgment source/date mismatch' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT * INTO case_head FROM "cases" WHERE "id" = target_case AND "department_id" = target_department;
  -- Only the local litigation head's temporal context changes. No NEW/OLD/fact/DB row projection.
  IF TG_TABLE_NAME='cases' THEN
    SELECT projected.stage,projected.version INTO case_head.stage,case_head.version
      FROM public.cases physical_case
      CROSS JOIN LATERAL public.case_early_terminal_workflow_context(physical_case) projected
      WHERE physical_case.id=NEW.id AND physical_case.department_id=NEW.department_id;
  END IF;
  round_id := case_head."current_trial_round_id";
  SELECT f."id", f."to_version" INTO latest_judgment FROM "case_judgment_facts" f
    WHERE f."case_id" = target_case AND f."department_id" = target_department AND f."trial_round_id" = round_id
    ORDER BY f."to_version" DESC LIMIT 1;
  IF latest_judgment."id" IS NULL THEN
    IF case_head."current_judgment_id" IS NOT NULL OR case_head."current_judgment_next_step_id" IS NOT NULL OR
       case_head."stage" IN ('SECOND_INSTANCE', 'WAITING_EXECUTION_DOCUMENTS', 'WAITING_EXECUTION_CONFIRMATION', 'WAITING_EXECUTION_STAMP', 'WAITING_EXECUTION_FILING', 'EXECUTING','WAITING_ARCHIVE','ARCHIVED') THEN
      RAISE EXCEPTION 'current round has no judgment for stage' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT count(*) INTO root_count FROM "case_judgment_facts" f WHERE f."case_id" = target_case
      AND f."department_id" = target_department AND f."trial_round_id" = round_id AND f."kind" = 'REGISTER';
    IF root_count <> 1 OR case_head."current_judgment_id" IS DISTINCT FROM latest_judgment."id" THEN
      RAISE EXCEPTION 'current round judgment head mismatch' USING ERRCODE = '23514';
    END IF;
    SELECT s."id", s."judgment_id", s."next", s."to_version" INTO latest_choice
      FROM "case_judgment_next_steps" s WHERE s."case_id" = target_case AND s."department_id" = target_department
        AND s."trial_round_id" = round_id ORDER BY s."to_version" DESC LIMIT 1;
    expected_version := latest_judgment."to_version";
    IF latest_choice."id" IS NOT NULL THEN
      SELECT v."id", v."to_version" INTO latest_revoke FROM "case_judgment_next_step_revocations" v
        WHERE v."choice_id" = latest_choice."id" AND v."case_id" = target_case AND v."department_id" = target_department;
      IF latest_revoke."id" IS NULL THEN
        IF case_head."current_judgment_next_step_id" IS DISTINCT FROM latest_choice."id" OR
           case_head."current_judgment_id" IS DISTINCT FROM latest_choice."judgment_id" THEN
          RAISE EXCEPTION 'current round active choice mismatch' USING ERRCODE = '23514';
        END IF;
        expected_stage := CASE WHEN latest_choice."next" = 'APPEAL' THEN 'SECOND_INSTANCE' ELSE 'WAITING_EXECUTION_DOCUMENTS' END;
        expected_version := latest_choice."to_version";
        IF latest_choice."next" = 'APPEAL' THEN
          SELECT p."id", p."to_version" INTO latest_progress FROM "case_second_instance_progresses" p
            WHERE p."case_id" = target_case AND p."department_id" = target_department AND p."trial_round_id" = round_id
              AND p."choice_id" = latest_choice."id" ORDER BY p."to_version" DESC LIMIT 1;
          IF case_head."current_second_instance_progress_id" IS DISTINCT FROM latest_progress."id" THEN
            RAISE EXCEPTION 'active second-instance progress head mismatch' USING ERRCODE = '23514';
          END IF;
          expected_version := greatest(expected_version, coalesce(latest_progress."to_version", 0));
          SELECT s."id", s."result", s."to_version" INTO active_result FROM "case_second_instance_results" s
            LEFT JOIN "case_second_instance_result_revocations" v ON v."result_id" = s."id"
            WHERE s."case_id" = target_case AND s."department_id" = target_department AND s."trial_round_id" = round_id
              AND s."choice_id" = latest_choice."id" AND v."id" IS NULL ORDER BY s."to_version" DESC LIMIT 1;
          IF active_result."id" IS NOT NULL THEN
            IF active_result."result" = 'REMAND' OR case_head."current_second_instance_result_id" IS DISTINCT FROM active_result."id" THEN
              RAISE EXCEPTION 'source round with active remand/result mismatch' USING ERRCODE = '23514';
            END IF;
            expected_stage := 'WAITING_EXECUTION_DOCUMENTS';
            expected_version := active_result."to_version";
          ELSE
            IF case_head."current_second_instance_result_id" IS NOT NULL THEN
              RAISE EXCEPTION 'second-instance result pointer without active result' USING ERRCODE = '23514';
            END IF;
            SELECT v."to_version" INTO latest_result_revocation FROM "case_second_instance_result_revocations" v
              JOIN "case_second_instance_results" s ON s."id" = v."result_id"
              WHERE s."case_id" = target_case AND s."department_id" = target_department
                AND s."trial_round_id" = round_id AND s."choice_id" = latest_choice."id"
              ORDER BY v."to_version" DESC LIMIT 1;
            expected_version := greatest(expected_version, coalesce(latest_result_revocation."to_version", 0));
          END IF;
        END IF;
        IF EXISTS (SELECT 1 FROM "case_execution_submissions" e WHERE e."case_id" = target_case AND e."department_id" = target_department AND e."trial_round_id" = round_id) THEN
  IF expected_stage <> 'WAITING_EXECUTION_DOCUMENTS' OR NOT EXISTS (
    SELECT 1 FROM "case_execution_submissions" e WHERE e."id" = case_head."current_execution_submission_id"
      AND e."case_id" = target_case AND e."department_id" = target_department AND e."trial_round_id" = round_id
      AND e."judgment_next_step_id" = latest_choice."id"
      AND e."second_instance_result_id" IS NOT DISTINCT FROM case_head."current_second_instance_result_id"
      AND e."id" = (SELECT x."id" FROM "case_execution_submissions" x WHERE x."case_id" = target_case
        AND x."department_id" = target_department AND x."trial_round_id" = round_id ORDER BY x."to_version" DESC LIMIT 1)) THEN
    RAISE EXCEPTION 'execution head or source mismatch' USING ERRCODE = '23514';
  END IF;
  SELECT e."to_version" INTO expected_version FROM "case_execution_submissions" e WHERE e."id" = case_head."current_execution_submission_id";
  IF EXISTS (SELECT 1 FROM "case_execution_confirmations" f WHERE f."case_id" = target_case AND f."department_id" = target_department) THEN
  SELECT f."to_version" INTO expected_version FROM "case_execution_confirmations" f WHERE f."case_id" = target_case AND f."department_id" = target_department AND f."submission_id" = case_head."current_execution_submission_id";
  IF EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department) THEN
 SELECT case_closure_terminal_version(target_case,target_department,ef."id",ef."to_version") INTO expected_version FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department;
 expected_stage := CASE WHEN EXISTS (SELECT 1 FROM "case_archives" WHERE "case_id"=target_case AND "department_id"=target_department) THEN 'ARCHIVED'::case_stage ELSE 'WAITING_ARCHIVE'::case_stage END;
ELSIF EXISTS (SELECT 1 FROM "case_execution_filings" ff WHERE ff."case_id"=target_case AND ff."department_id"=target_department) THEN
 SELECT ff."to_version" INTO expected_version FROM "case_execution_filings" ff WHERE ff."case_id"=target_case AND ff."department_id"=target_department;
 expected_stage := 'EXECUTING';
ELSIF EXISTS (SELECT 1 FROM "case_execution_mailings" mm WHERE mm."case_id"=target_case AND mm."department_id"=target_department) THEN
 SELECT mm."to_version" INTO expected_version FROM "case_execution_mailings" mm WHERE mm."case_id"=target_case AND mm."department_id"=target_department;
 expected_stage := 'WAITING_EXECUTION_FILING';
ELSE expected_stage := 'WAITING_EXECUTION_STAMP'; END IF;
ELSE expected_stage := 'WAITING_EXECUTION_CONFIRMATION'; END IF;
ELSIF case_head."current_execution_submission_id" IS NOT NULL THEN
  RAISE EXCEPTION 'execution pointer without fact' USING ERRCODE = '23514';
END IF;
IF case_head."stage"::text IS DISTINCT FROM expected_stage OR case_head."version" <> expected_version THEN
          RAISE EXCEPTION 'active judgment choice stage/version mismatch' USING ERRCODE = '23514';
        END IF;
      ELSE
        expected_version := greatest(expected_version, latest_revoke."to_version");
        IF case_head."current_judgment_next_step_id" IS NOT NULL OR case_head."stage" <> 'WAITING_JUDGMENT' OR case_head."version" <> expected_version THEN
          RAISE EXCEPTION 'revoked judgment choice mismatch' USING ERRCODE = '23514';
        END IF;
      END IF;
    ELSIF case_head."current_judgment_next_step_id" IS NOT NULL OR case_head."stage" <> 'WAITING_JUDGMENT' OR case_head."version" <> expected_version THEN
      RAISE EXCEPTION 'judgment stage/version mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'case_judgment_facts' THEN
    IF NEW."judgment_received_at" < (SELECT case_effective_acceptance_date(a."id") FROM "case_acceptances" a
          WHERE a."case_id" = target_case AND a."department_id" = target_department AND a."trial_round_id" = NEW."trial_round_id") OR
       NEW."judgment_received_at" > (NEW."recorded_at" AT TIME ZONE 'Asia/Shanghai')::date OR
       (NEW."kind" = 'REGISTER' AND NEW."prior_fact_id" IS NOT NULL) OR
       (NEW."kind" = 'CORRECT' AND NOT EXISTS (SELECT 1 FROM "case_judgment_facts" prior
         WHERE prior."id" = NEW."prior_fact_id" AND prior."case_id" = NEW."case_id"
           AND prior."department_id" = NEW."department_id" AND prior."trial_round_id" = NEW."trial_round_id"
           AND prior."id" = (SELECT f."id" FROM "case_judgment_facts" f WHERE f."case_id" = NEW."case_id"
             AND f."department_id" = NEW."department_id" AND f."trial_round_id" = NEW."trial_round_id"
             AND f."id" <> NEW."id" ORDER BY f."to_version" DESC LIMIT 1)
           AND (prior."to_version" = NEW."from_version" OR EXISTS (SELECT 1 FROM "case_judgment_next_step_revocations" v
             JOIN "case_judgment_next_steps" s ON s."id" = v."choice_id"
             WHERE s."judgment_id" = prior."id" AND s."trial_round_id" = NEW."trial_round_id"
               AND s."case_id" = NEW."case_id" AND s."department_id" = NEW."department_id"
               AND v."to_version" = NEW."from_version")))) OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = NEW."department_id" AND a."resource_type" = 'CASE' AND a."resource_id" = NEW."case_id"
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = CASE WHEN NEW."kind" = 'REGISTER' THEN 'case.judgment.registered' ELSE 'case.judgment.corrected' END
         AND a."details"->>'judgmentId' = NEW."id"::text AND a."details"->>'fromVersion' = NEW."from_version"::text
         AND a."details"->>'toVersion' = NEW."to_version"::text
         AND a."details"->>'judgmentReceivedAt' = NEW."judgment_received_at"::text
         AND a."details"->>'judgmentAmountState' = NEW."judgment_amount_state"::text
         AND a."details"->>'judgmentAmount' IS NOT DISTINCT FROM NEW."judgment_amount"::text
         AND a."details"->>'paidLitigationFeeState' = NEW."paid_litigation_fee_state"::text
         AND a."details"->>'paidLitigationFee' IS NOT DISTINCT FROM NEW."paid_litigation_fee"::text
         AND a."details"->>'priorFactId' IS NOT DISTINCT FROM NEW."prior_fact_id"::text
         AND a."details"->>'reason' IS NOT DISTINCT FROM NEW."reason") OR
       NOT EXISTS (SELECT 1 FROM "case_judgment_receipts" v WHERE v."case_id" = NEW."case_id"
         AND v."department_id" = NEW."department_id" AND v."actor_user_id" = NEW."recorded_by_user_id"
         AND v."action" = NEW."kind" AND v."result_snapshot"->>'judgmentId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'judgment fact or audit mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.check_case_judgment_next_step_final()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; choice_record record; case_record record;
        latest_prior_id uuid; latest_prior_revoked_to integer; expected_from integer; judgment_version integer;
BEGIN
  IF TG_TABLE_NAME='cases' THEN
    IF normal_pending_early_terminal(NEW.id,NEW.department_id) OR normal_initial_appeal_early_terminal(NEW.id,NEW.department_id) OR normal_prejudgment_early_terminal(NEW.id,NEW.department_id) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' AND TG_OP = 'UPDATE' THEN
    IF case_early_closure_transition(OLD, NEW) OR case_early_closure_register_transition(OLD, NEW) OR case_early_closure_correction_transition(OLD, NEW) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN
    IF TG_OP = 'UPDATE' THEN
      IF case_early_archive_transition(OLD, NEW) THEN RETURN NEW; END IF;
    END IF;
  END IF;
IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; ELSE target_case:=NEW."case_id"; END IF;
  target_department:=NEW."department_id";
  IF EXISTS (SELECT 1 FROM "case_external_entries" e WHERE e."case_id"=target_case
    AND e."department_id"=NEW."department_id") THEN
    PERFORM ca018_assert_external_trial_round(target_case,NEW."department_id");
    IF TG_TABLE_NAME='cases' AND (external_prehearing_early_empty_judgment_draft(target_case,NEW."department_id") OR external_unadvanced_round_early_terminal(target_case,NEW."department_id")) THEN RETURN NEW; END IF;
    IF ca018_h_is_unadvanced_root(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF ca018_h_downstream_entry_without_judgment(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM "case_external_entries" e JOIN "cases" c ON c."id"=e."case_id" AND c."department_id"=e."department_id"
      WHERE c."id"=target_case AND e."initial_stage"='SECOND_INSTANCE'
        AND c."current_judgment_id" IS NULL) THEN
      PERFORM ca018_h_direct_second_chain(target_case,NEW."department_id");
      RETURN NEW;
    END IF;
    IF TG_TABLE_NAME='case_judgment_next_steps' THEN
      IF NOT EXISTS (
      SELECT 1 FROM "case_judgment_facts" j JOIN "case_external_entries" e ON e."case_id"=j."case_id" AND e."department_id"=j."department_id"
      WHERE j."id"=NEW."judgment_id" AND j."trial_round_id"=NEW."trial_round_id" AND j."external_entry_id"=e."id"
        AND NEW."external_entry_id"=e."id" AND j."case_id"=NEW."case_id" AND j."department_id"=NEW."department_id") THEN
        RAISE EXCEPTION 'external judgment choice lacks real judgment' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT c."stage", c."version", c."current_judgment_id", c."current_judgment_next_step_id", c."rights_holder_id"
    INTO case_record FROM "cases" c WHERE c."id" = target_case AND c."department_id" = target_department;
  -- Only the local litigation head's temporal context changes. No NEW/OLD/fact/DB row projection.
  IF TG_TABLE_NAME='cases' THEN
    SELECT projected.stage,projected.version INTO case_record.stage,case_record.version
      FROM public.cases physical_case
      CROSS JOIN LATERAL public.case_early_terminal_workflow_context(physical_case) projected
      WHERE physical_case.id=NEW.id AND physical_case.department_id=NEW.department_id;
  END IF;
  IF case_record."stage" IN ('SECOND_INSTANCE', 'WAITING_EXECUTION_DOCUMENTS', 'WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED') AND case_record."current_judgment_next_step_id" IS NULL THEN
    RAISE EXCEPTION 'advanced stage requires current choice' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'case_judgment_next_steps' THEN
    SELECT f."to_version" INTO judgment_version FROM "case_judgment_facts" f
      WHERE f."id" = NEW."judgment_id" AND f."case_id" = target_case AND f."department_id" = target_department;
    SELECT s."id", r."to_version" INTO latest_prior_id, latest_prior_revoked_to
      FROM "case_judgment_next_steps" s LEFT JOIN "case_judgment_next_step_revocations" r ON r."choice_id" = s."id"
      WHERE s."case_id" = target_case AND s."department_id" = target_department AND s."id" <> NEW."id" AND s."trial_round_id" = NEW."trial_round_id"
      ORDER BY s."to_version" DESC LIMIT 1;
    expected_from := greatest(judgment_version, coalesce(latest_prior_revoked_to, 0));
    IF judgment_version IS NULL OR (latest_prior_id IS NOT NULL AND latest_prior_revoked_to IS NULL) OR
       NEW."from_version" <> expected_from OR
       NEW."judgment_id" IS DISTINCT FROM case_record."current_judgment_id" OR
       (NEW."next" = 'APPEAL' AND NEW."plaintiff_rights_holder_id" IS NULL AND NOT EXISTS (
         SELECT 1 FROM "case_judgment_appeal_defendants" d WHERE d."choice_id" = NEW."id")) OR
       (NEW."next" = 'EXECUTION' AND EXISTS (
         SELECT 1 FROM "case_judgment_appeal_defendants" d WHERE d."choice_id" = NEW."id")) OR
       (NEW."plaintiff_rights_holder_id" IS NOT NULL AND NEW."plaintiff_rights_holder_id" <> case_record."rights_holder_id") OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = target_department AND a."resource_type" = 'CASE' AND a."resource_id" = target_case
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = 'case.judgment.next_step' AND a."details"->>'choiceId' = NEW."id"::text
         AND a."details"->>'judgmentId' = NEW."judgment_id"::text AND a."details"->>'next' = NEW."next"::text
         AND a."details"->>'fromVersion' = NEW."from_version"::text AND a."details"->>'toVersion' = NEW."to_version"::text
         AND (a."details"->>'plaintiffAppeals')::boolean = (NEW."plaintiff_rights_holder_id" IS NOT NULL)
         AND (a."details"->>'executionReadinessConfirmed')::boolean = NEW."execution_readiness_confirmed"
         AND a."details"->'defendantIds' = (SELECT coalesce(jsonb_agg(d."defendant_id" ORDER BY d."defendant_id"), '[]'::jsonb)
            FROM "case_judgment_appeal_defendants" d WHERE d."choice_id" = NEW."id")) OR
       NOT EXISTS (SELECT 1 FROM "case_judgment_next_step_receipts" r WHERE r."case_id" = target_case
         AND r."department_id" = target_department AND r."actor_user_id" = NEW."recorded_by_user_id"
         AND r."action" = 'CHOOSE' AND r."result_snapshot"->>'choiceId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'judgment choice source, parties, audit or receipt mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'case_judgment_next_step_revocations' THEN
    SELECT s."id", s."judgment_id", s."to_version", s."trial_round_id" INTO choice_record FROM "case_judgment_next_steps" s
      WHERE s."id" = NEW."choice_id" AND s."case_id" = target_case AND s."department_id" = target_department;
    IF choice_record."id" IS NULL OR NEW."from_version" <> choice_record."to_version" OR
       NEW."choice_id" <> (SELECT s."id" FROM "case_judgment_next_steps" s WHERE s."case_id" = target_case AND s."trial_round_id" = choice_record."trial_round_id"
         ORDER BY s."to_version" DESC LIMIT 1) OR
       case_record."current_judgment_id" IS DISTINCT FROM choice_record."judgment_id" OR
       EXISTS (SELECT 1 FROM "case_second_instance_progresses" p WHERE p."choice_id" = NEW."choice_id") OR
       EXISTS (SELECT 1 FROM "case_second_instance_results" x WHERE x."choice_id" = NEW."choice_id") OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = target_department AND a."resource_type" = 'CASE' AND a."resource_id" = target_case
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."internal_actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = 'case.judgment.next_step.revoke' AND a."details"->>'choiceId' = NEW."choice_id"::text
         AND a."details"->>'revocationId' = NEW."id"::text AND a."details"->>'reason' = NEW."reason"
         AND a."details"->>'fromVersion' = NEW."from_version"::text AND a."details"->>'toVersion' = NEW."to_version"::text) OR
       NOT EXISTS (SELECT 1 FROM "case_judgment_next_step_receipts" r WHERE r."case_id" = target_case
         AND r."department_id" = target_department AND r."actor_user_id" = NEW."recorded_by_user_id"
         AND r."action" = 'REVOKE' AND r."result_snapshot"->>'revocationId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'judgment choice revocation mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_case_second_instance_final()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; case_head record; choice_record record; source_result record;
        prior_progress record; prior_result record; last_revocation record; expected_from integer; accepted_date date;
BEGIN
  IF TG_TABLE_NAME = 'cases' AND TG_OP = 'UPDATE' THEN
    IF case_early_closure_transition(OLD, NEW) OR case_early_closure_register_transition(OLD, NEW) OR case_early_closure_correction_transition(OLD, NEW) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN
    IF TG_OP = 'UPDATE' THEN
      IF case_early_archive_transition(OLD, NEW) THEN RETURN NEW; END IF;
    END IF;
  END IF;
IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; ELSE target_case:=NEW."case_id"; END IF;
  target_department:=NEW."department_id";
  IF EXISTS (SELECT 1 FROM "case_external_entries" e WHERE e."case_id"=target_case
    AND e."department_id"=NEW."department_id") THEN
    PERFORM ca018_assert_external_trial_round(target_case,NEW."department_id");
    IF TG_TABLE_NAME='cases' AND (external_prehearing_early_empty_judgment_draft(target_case,NEW."department_id") OR external_unadvanced_round_early_terminal(target_case,NEW."department_id")) THEN RETURN NEW; END IF;
    IF ca018_h_is_unadvanced_root(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF ca018_h_downstream_entry_without_judgment(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM "case_external_entries" e JOIN "cases" c ON c."id"=e."case_id" AND c."department_id"=e."department_id"
      WHERE e."case_id"=target_case
        AND e."department_id"=NEW."department_id" AND e."initial_stage"='SECOND_INSTANCE'
        AND c."current_judgment_id" IS NULL) THEN
      PERFORM ca018_h_direct_second_chain(target_case,NEW."department_id");
      IF TG_TABLE_NAME='case_second_instance_progresses' THEN
        IF NOT EXISTS (
        SELECT 1 FROM "case_external_entries" e JOIN "case_trial_rounds" r ON r."case_id"=e."case_id" AND r."department_id"=e."department_id"
        WHERE e."case_id"=NEW."case_id" AND e."department_id"=NEW."department_id"
          AND r."id"=NEW."trial_round_id" AND r."origin"='EXTERNAL_CURRENT'
          AND NEW."external_entry_id"=e."id" AND NEW."choice_id" IS NULL
          AND NEW."to_version"=NEW."from_version"+1
          AND NEW."from_version"=greatest(1,
            coalesce((SELECT p."to_version" FROM "case_second_instance_progresses" p
              WHERE p."case_id"=NEW."case_id" AND p."department_id"=NEW."department_id"
                AND p."trial_round_id"=NEW."trial_round_id" AND p."id"<>NEW."id"
              ORDER BY p."to_version" DESC LIMIT 1),0),
            coalesce((SELECT v."to_version" FROM "case_second_instance_result_revocations" v
              JOIN "case_second_instance_results" s ON s."id"=v."result_id"
              WHERE s."case_id"=NEW."case_id" AND s."department_id"=NEW."department_id"
                AND s."trial_round_id"=NEW."trial_round_id" AND s."choice_id" IS NULL
              ORDER BY v."to_version" DESC LIMIT 1),0))
          AND NEW."prior_progress_id" IS NOT DISTINCT FROM (SELECT p."id" FROM "case_second_instance_progresses" p
            WHERE p."case_id"=NEW."case_id" AND p."department_id"=NEW."department_id"
              AND p."trial_round_id"=NEW."trial_round_id" AND p."id"<>NEW."id"
            ORDER BY p."to_version" DESC LIMIT 1)
          AND (NEW."hearing_at" IS NULL OR
            (NEW."hearing_at">=e."stage_reached_on" AND
             (e."known"->>'acceptedOn' IS NULL OR NEW."hearing_at">=(e."known"->>'acceptedOn')::date) AND
             (e."known"->>'secondInstanceAcceptedOn' IS NULL OR NEW."hearing_at">=(e."known"->>'secondInstanceAcceptedOn')::date)))
          AND EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id"=NEW."audit_event_id" AND a."action"='case.second_instance.save'
            AND a."resource_id"=NEW."case_id" AND a."department_id"=NEW."department_id"
            AND a."resource_type"='CASE' AND a."actor_kind"='HUMAN'
            AND a."actor_user_id"=NEW."recorded_by_user_id"
            AND a."details"->>'progressId'=NEW."id"::text AND a."details"->>'choiceId' IS NULL
            AND a."details"->>'trialRoundId'=NEW."trial_round_id"::text
            AND a."details"->>'priorProgressId' IS NOT DISTINCT FROM NEW."prior_progress_id"::text
            AND a."details"->>'fromVersion'=NEW."from_version"::text
            AND a."details"->>'toVersion'=NEW."to_version"::text
            AND a."details"->>'hearingAt' IS NOT DISTINCT FROM NEW."hearing_at"::text
            AND a."details"->>'hearingPlace' IS NOT DISTINCT FROM NEW."hearing_place"
            AND a."details"->>'judgeName' IS NOT DISTINCT FROM NEW."judge_name")
          AND EXISTS (SELECT 1 FROM "case_second_instance_receipts" receipt WHERE receipt."case_id"=NEW."case_id"
            AND receipt."department_id"=NEW."department_id" AND receipt."actor_user_id"=NEW."recorded_by_user_id"
            AND receipt."action" IN ('SAVE','RESULT')
            AND receipt."result_snapshot"->>'progressId'=NEW."id"::text)) THEN
          RAISE EXCEPTION 'direct second progress source/audit/receipt mismatch' USING ERRCODE='23514';
        END IF;
      END IF;
      IF TG_TABLE_NAME='case_second_instance_results' THEN
        IF NOT EXISTS (
        SELECT 1 FROM "case_external_entries" e JOIN "case_trial_rounds" r ON r."case_id"=e."case_id" AND r."department_id"=e."department_id"
        WHERE e."case_id"=NEW."case_id" AND e."department_id"=NEW."department_id"
          AND r."id"=NEW."trial_round_id" AND r."origin"='EXTERNAL_CURRENT'
          AND NEW."external_entry_id"=e."id" AND NEW."choice_id" IS NULL AND NEW."judgment_id" IS NULL
          AND NEW."to_version"=NEW."from_version"+1
          AND NEW."from_version"=greatest(1,
            coalesce((SELECT p."to_version" FROM "case_second_instance_progresses" p
              WHERE p."case_id"=NEW."case_id" AND p."department_id"=NEW."department_id"
                AND p."trial_round_id"=NEW."trial_round_id"
              ORDER BY p."to_version" DESC LIMIT 1),0),
            coalesce((SELECT v."to_version" FROM "case_second_instance_result_revocations" v
              JOIN "case_second_instance_results" s ON s."id"=v."result_id"
              WHERE s."case_id"=NEW."case_id" AND s."department_id"=NEW."department_id"
                AND s."trial_round_id"=NEW."trial_round_id" AND s."choice_id" IS NULL
              ORDER BY v."to_version" DESC LIMIT 1),0))
          AND NEW."progress_id" IS NOT DISTINCT FROM (SELECT p."id" FROM "case_second_instance_progresses" p
            WHERE p."case_id"=NEW."case_id" AND p."department_id"=NEW."department_id"
              AND p."trial_round_id"=NEW."trial_round_id" ORDER BY p."to_version" DESC LIMIT 1)
          AND NEW."result_received_at">=e."stage_reached_on"
          AND NEW."result_received_at" <= (NEW."recorded_at" AT TIME ZONE 'Asia/Shanghai')::date
          AND NOT EXISTS (SELECT 1 FROM "case_second_instance_results" other
            WHERE other."case_id"=NEW."case_id" AND other."department_id"=NEW."department_id"
              AND other."trial_round_id"=NEW."trial_round_id" AND other."id"<>NEW."id"
              AND NOT EXISTS (SELECT 1 FROM "case_second_instance_result_revocations" v WHERE v."result_id"=other."id"))
          AND (NEW."result"<>'AFFIRM' OR NEW."judgment_amount_state" IS NOT NULL)
          AND EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id"=NEW."audit_event_id"
            AND a."action"='case.second_instance.result' AND a."resource_id"=NEW."case_id"
            AND a."department_id"=NEW."department_id" AND a."resource_type"='CASE'
            AND a."actor_kind"='HUMAN' AND a."actor_user_id"=NEW."recorded_by_user_id"
            AND a."details"->>'resultId'=NEW."id"::text
            AND a."details"->>'trialRoundId'=NEW."trial_round_id"::text
            AND a."details"->>'choiceId' IS NULL AND a."details"->>'judgmentId' IS NULL
            AND a."details"->>'progressId' IS NOT DISTINCT FROM NEW."progress_id"::text
            AND a."details"->>'result'=NEW."result"::text
            AND a."details"->>'resultReceivedAt'=NEW."result_received_at"::text
            AND a."details"->>'judgmentAmountState' IS NOT DISTINCT FROM NEW."judgment_amount_state"::text
            AND a."details"->>'judgmentAmount' IS NOT DISTINCT FROM NEW."judgment_amount"::text
            AND a."details"->>'paidLitigationFeeState'=NEW."paid_litigation_fee_state"::text
            AND a."details"->>'paidLitigationFee' IS NOT DISTINCT FROM NEW."paid_litigation_fee"::text
            AND a."details"->>'fromVersion'=NEW."from_version"::text
            AND a."details"->>'toVersion'=NEW."to_version"::text)
          AND EXISTS (SELECT 1 FROM "case_second_instance_receipts" receipt WHERE receipt."case_id"=NEW."case_id"
            AND receipt."department_id"=NEW."department_id" AND receipt."actor_user_id"=NEW."recorded_by_user_id"
            AND receipt."action"='RESULT'
            AND receipt."result_snapshot"->>'resultId'=NEW."id"::text)) THEN
          RAISE EXCEPTION 'direct second result source/audit/receipt mismatch' USING ERRCODE='23514';
        END IF;
      END IF;
      IF TG_TABLE_NAME='case_second_instance_result_revocations' THEN
        IF NOT EXISTS (
        SELECT 1 FROM "case_second_instance_results" s JOIN "audit_events" a ON a."id"=NEW."audit_event_id"
        JOIN "case_second_instance_receipts" receipt ON receipt."case_id"=NEW."case_id"
          AND receipt."department_id"=NEW."department_id" AND receipt."action"='REVOKE'
          AND receipt."result_snapshot"->>'revocationId'=NEW."id"::text
        WHERE s."id"=NEW."result_id" AND s."case_id"=NEW."case_id" AND s."department_id"=NEW."department_id"
          AND s."external_entry_id"=(SELECT e."id" FROM "case_external_entries" e WHERE e."case_id"=NEW."case_id")
          AND s."choice_id" IS NULL AND NEW."to_version"=NEW."from_version"+1
          AND NEW."from_version"=(SELECT c."version"-1 FROM "cases" c WHERE c."id"=NEW."case_id")
          AND a."department_id"=NEW."department_id" AND a."resource_type"='CASE'
          AND a."actor_kind"='HUMAN' AND a."actor_user_id"=NEW."recorded_by_user_id"
          AND a."internal_actor_user_id"=NEW."recorded_by_user_id"
          AND a."action"='case.second_instance.result.revoke' AND a."resource_id"=NEW."case_id"
          AND a."details"->>'resultId'=NEW."result_id"::text
          AND a."details"->>'revocationId'=NEW."id"::text
          AND a."details"->>'reason'=NEW."reason"
          AND a."details"->>'fromVersion'=NEW."from_version"::text
          AND a."details"->>'toVersion'=NEW."to_version"::text
          AND receipt."actor_user_id"=NEW."recorded_by_user_id"
          AND NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id"=NEW."case_id"
            AND (c."current_second_instance_result_id" IS NOT NULL OR c."stage"<>'SECOND_INSTANCE'
              OR c."current_trial_round_id"<>s."trial_round_id"
              OR c."current_second_instance_progress_id" IS DISTINCT FROM s."progress_id"))
          AND NOT EXISTS (SELECT 1 FROM "case_execution_submissions" downstream
            WHERE downstream."second_instance_result_id"=s."id")
          AND (s."result"<>'REMAND' OR EXISTS (SELECT 1 FROM "case_trial_rounds" child
            WHERE child."source_result_id"=s."id" AND child."external_entry_id"=s."external_entry_id"
              AND child."revoked_at"=NEW."recorded_at"
              AND NOT EXISTS (SELECT 1 FROM "case_acceptances" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_hearing_arrangements" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_hearing_advances" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_judgment_facts" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_steps" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_second_instance_progresses" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_second_instance_results" x WHERE x."trial_round_id"=child."id")))) THEN
          RAISE EXCEPTION 'direct second result revoke mismatch' USING ERRCODE='23514';
        END IF;
      END IF;
      RETURN NEW;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT * INTO case_head FROM "cases" WHERE "id" = target_case AND "department_id" = target_department;
  -- Only the local litigation head's temporal context changes. No NEW/OLD/fact/DB row projection.
  IF TG_TABLE_NAME='cases' THEN
    SELECT projected.stage,projected.version INTO case_head.stage,case_head.version
      FROM public.cases physical_case
      CROSS JOIN LATERAL public.case_early_terminal_workflow_context(physical_case) projected
      WHERE physical_case.id=NEW.id AND physical_case.department_id=NEW.department_id;
  END IF;
  IF case_head."current_second_instance_progress_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "case_second_instance_progresses" p WHERE p."id" = case_head."current_second_instance_progress_id"
      AND p."case_id" = target_case AND p."department_id" = target_department
      AND p."trial_round_id" = case_head."current_trial_round_id" AND p."choice_id" = case_head."current_judgment_next_step_id") THEN
    RAISE EXCEPTION 'second-instance current progress pointer mismatch' USING ERRCODE = '23514';
  END IF;
  IF case_head."current_second_instance_result_id" IS NOT NULL THEN
    SELECT s.*, v."id" AS revocation_id INTO source_result FROM "case_second_instance_results" s
      LEFT JOIN "case_second_instance_result_revocations" v ON v."result_id" = s."id"
      WHERE s."id" = case_head."current_second_instance_result_id" AND s."case_id" = target_case
        AND s."department_id" = target_department;
    IF source_result."id" IS NULL OR source_result.revocation_id IS NOT NULL OR
       (source_result."result" = 'REMAND' AND (case_head."stage" <> 'WAITING_FORMAL_ACCEPTANCE' OR
         NOT EXISTS (SELECT 1 FROM "case_trial_rounds" child WHERE child."id" = case_head."current_trial_round_id"
           AND child."source_result_id" = source_result."id" AND child."revoked_at" IS NULL))) OR
       (source_result."result" <> 'REMAND' AND (case_head."stage" NOT IN ('WAITING_EXECUTION_DOCUMENTS','WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED') OR
         source_result."trial_round_id" <> case_head."current_trial_round_id")) THEN
      RAISE EXCEPTION 'second-instance current result pointer mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'case_second_instance_progresses' THEN
    SELECT s."id", s."to_version" INTO choice_record FROM "case_judgment_next_steps" s
      WHERE s."id" = NEW."choice_id" AND s."case_id" = target_case AND s."department_id" = target_department
        AND s."trial_round_id" = NEW."trial_round_id" AND s."next" = 'APPEAL'
        AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_step_revocations" v WHERE v."choice_id" = s."id");
    IF EXISTS (SELECT 1 FROM "case_external_entries" entry WHERE entry."case_id"=target_case AND entry."department_id"=target_department)
    AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_steps" actual
      JOIN "case_judgment_facts" judgment ON judgment."id"=actual."judgment_id"
      JOIN "case_external_entries" e ON e."case_id"=actual."case_id" AND e."department_id"=actual."department_id"
      WHERE actual."id"=NEW."choice_id" AND actual."trial_round_id"=NEW."trial_round_id"
        AND actual."case_id"=NEW."case_id" AND actual."department_id"=NEW."department_id"
        AND actual."external_entry_id"=e."id" AND judgment."external_entry_id"=e."id"
        AND judgment."trial_round_id"=NEW."trial_round_id" AND actual."next"='APPEAL'
        AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_step_revocations" v WHERE v."choice_id"=actual."id")) THEN
      RAISE EXCEPTION 'external real appeal requires true source choice/judgment' USING ERRCODE='23514';
    END IF;
    SELECT p."id", p."to_version" INTO prior_progress FROM "case_second_instance_progresses" p
      WHERE p."case_id" = target_case AND p."department_id" = target_department
        AND p."trial_round_id" = NEW."trial_round_id" AND p."choice_id" = NEW."choice_id"
        AND p."id" <> NEW."id" ORDER BY p."to_version" DESC LIMIT 1;
    SELECT v."to_version" INTO last_revocation FROM "case_second_instance_result_revocations" v
      JOIN "case_second_instance_results" s ON s."id" = v."result_id"
      WHERE s."case_id" = target_case AND s."department_id" = target_department
        AND s."trial_round_id" = NEW."trial_round_id" AND s."choice_id" = NEW."choice_id"
      ORDER BY v."to_version" DESC LIMIT 1;
    expected_from := greatest(coalesce(choice_record."to_version", 0), coalesce(prior_progress."to_version", 0),
      coalesce(last_revocation."to_version", 0));
    IF choice_record."id" IS NULL OR NEW."prior_progress_id" IS DISTINCT FROM prior_progress."id" OR
       NEW."from_version" <> expected_from OR
       (case_head."current_trial_round_id" <> NEW."trial_round_id" AND NOT EXISTS (
         SELECT 1 FROM "case_second_instance_results" s WHERE s."trial_round_id" = NEW."trial_round_id"
           AND s."progress_id" = NEW."id" AND s."result" = 'REMAND' AND
           case_head."current_second_instance_result_id" = s."id")) OR
       (case_head."current_trial_round_id" = NEW."trial_round_id" AND case_head."current_second_instance_progress_id" IS DISTINCT FROM NEW."id") OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = target_department AND a."resource_type" = 'CASE' AND a."resource_id" = target_case
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = 'case.second_instance.save' AND a."details"->>'progressId' = NEW."id"::text
         AND a."details"->>'trialRoundId' = NEW."trial_round_id"::text
         AND a."details"->>'choiceId' = NEW."choice_id"::text
         AND a."details"->>'priorProgressId' IS NOT DISTINCT FROM NEW."prior_progress_id"::text
         AND a."details"->>'fromVersion' = NEW."from_version"::text
         AND a."details"->>'toVersion' = NEW."to_version"::text
         AND a."details"->>'hearingAt' IS NOT DISTINCT FROM NEW."hearing_at"::text
         AND a."details"->>'hearingPlace' IS NOT DISTINCT FROM NEW."hearing_place"
         AND a."details"->>'judgeName' IS NOT DISTINCT FROM NEW."judge_name") OR
       NOT EXISTS (SELECT 1 FROM "case_second_instance_receipts" r WHERE r."case_id" = target_case
         AND r."department_id" = target_department AND r."actor_user_id" = NEW."recorded_by_user_id"
         AND r."action" IN ('SAVE', 'RESULT') AND r."result_snapshot"->>'progressId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'second-instance progress chain/audit/receipt mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'case_second_instance_results' THEN
    SELECT s."id", s."judgment_id", s."to_version", s."trial_round_id" INTO choice_record
      FROM "case_judgment_next_steps" s WHERE s."id" = NEW."choice_id" AND s."case_id" = target_case
        AND s."department_id" = target_department AND s."trial_round_id" = NEW."trial_round_id"
        AND s."next" = 'APPEAL' AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_step_revocations" v WHERE v."choice_id" = s."id");
    SELECT case_effective_acceptance_date(a."id") INTO accepted_date FROM "case_acceptances" a WHERE a."case_id" = target_case
      AND a."department_id" = target_department AND a."trial_round_id" = NEW."trial_round_id";
    SELECT p."id", p."to_version" INTO prior_progress FROM "case_second_instance_progresses" p
      WHERE p."case_id" = target_case AND p."department_id" = target_department
        AND p."trial_round_id" = NEW."trial_round_id" AND p."choice_id" = NEW."choice_id"
      ORDER BY p."to_version" DESC LIMIT 1;
    SELECT v."to_version" INTO last_revocation FROM "case_second_instance_result_revocations" v
      JOIN "case_second_instance_results" s ON s."id" = v."result_id"
      WHERE s."case_id" = target_case AND s."department_id" = target_department
        AND s."trial_round_id" = NEW."trial_round_id" AND s."choice_id" = NEW."choice_id"
      ORDER BY v."to_version" DESC LIMIT 1;
    expected_from := greatest(coalesce(choice_record."to_version", 0), coalesce(prior_progress."to_version", 0),
      coalesce(last_revocation."to_version", 0));
    IF choice_record."id" IS NULL OR NEW."judgment_id" IS DISTINCT FROM choice_record."judgment_id" OR
       NEW."progress_id" IS DISTINCT FROM prior_progress."id" OR NEW."from_version" <> expected_from OR
       (accepted_date IS NULL AND NOT EXISTS (SELECT 1 FROM "case_external_entries" e
         WHERE e."case_id"=target_case AND e."department_id"=target_department
           AND e."initial_stage" IN ('WAITING_HEARING','WAITING_JUDGMENT') AND NEW."external_entry_id"=e."id")) OR
       NEW."result_received_at" < coalesce(accepted_date,(SELECT e."stage_reached_on" FROM "case_external_entries" e
         WHERE e."case_id"=target_case AND e."department_id"=target_department)) OR
       NEW."result_received_at" > (NEW."recorded_at" AT TIME ZONE 'Asia/Shanghai')::date OR
       case_head."current_second_instance_result_id" IS DISTINCT FROM NEW."id" OR
       (NEW."result" = 'AFFIRM' AND NOT EXISTS (SELECT 1 FROM "case_judgment_facts" j
         WHERE j."id" = NEW."judgment_id" AND j."judgment_amount_state" = NEW."judgment_amount_state"
           AND j."judgment_amount" IS NOT DISTINCT FROM NEW."judgment_amount")) OR
       (NEW."result" = 'REMAND' AND NOT EXISTS (SELECT 1 FROM "case_trial_rounds" child
         WHERE child."source_result_id" = NEW."id" AND child."id" = case_head."current_trial_round_id")) OR
       (NEW."result" <> 'REMAND' AND case_head."current_trial_round_id" <> NEW."trial_round_id") OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = target_department AND a."resource_type" = 'CASE' AND a."resource_id" = target_case
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = 'case.second_instance.result' AND a."details"->>'resultId' = NEW."id"::text
         AND a."details"->>'trialRoundId' = NEW."trial_round_id"::text
         AND a."details"->>'choiceId' = NEW."choice_id"::text
         AND a."details"->>'judgmentId' = NEW."judgment_id"::text
         AND a."details"->>'progressId' IS NOT DISTINCT FROM NEW."progress_id"::text
         AND a."details"->>'result' = NEW."result"::text
         AND a."details"->>'resultReceivedAt' = NEW."result_received_at"::text
         AND a."details"->>'judgmentAmountState' IS NOT DISTINCT FROM NEW."judgment_amount_state"::text
         AND a."details"->>'judgmentAmount' IS NOT DISTINCT FROM NEW."judgment_amount"::text
         AND a."details"->>'paidLitigationFeeState' = NEW."paid_litigation_fee_state"::text
         AND a."details"->>'paidLitigationFee' IS NOT DISTINCT FROM NEW."paid_litigation_fee"::text
         AND a."details"->>'fromVersion' = NEW."from_version"::text
         AND a."details"->>'toVersion' = NEW."to_version"::text) OR
       NOT EXISTS (SELECT 1 FROM "case_second_instance_receipts" r WHERE r."case_id" = target_case
         AND r."department_id" = target_department AND r."actor_user_id" = NEW."recorded_by_user_id"
         AND r."action" = 'RESULT' AND r."result_snapshot"->>'resultId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'second-instance result source/audit/receipt mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'case_second_instance_result_revocations' THEN
    SELECT s.* INTO source_result FROM "case_second_instance_results" s WHERE s."id" = NEW."result_id"
      AND s."case_id" = target_case AND s."department_id" = target_department;
    IF source_result."id" IS NULL OR NEW."from_version" <> case_head."version" - 1 OR
       case_head."current_second_instance_result_id" IS NOT NULL OR case_head."stage" <> 'SECOND_INSTANCE' OR
       case_head."current_trial_round_id" <> source_result."trial_round_id" OR
       case_head."current_second_instance_progress_id" IS DISTINCT FROM source_result."progress_id" OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = target_department AND a."resource_type" = 'CASE' AND a."resource_id" = target_case
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."internal_actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = 'case.second_instance.result.revoke'
         AND a."details"->>'resultId' = NEW."result_id"::text
         AND a."details"->>'revocationId' = NEW."id"::text
         AND a."details"->>'reason' = NEW."reason"
         AND a."details"->>'fromVersion' = NEW."from_version"::text
         AND a."details"->>'toVersion' = NEW."to_version"::text) OR
       NOT EXISTS (SELECT 1 FROM "case_second_instance_receipts" r WHERE r."case_id" = target_case
         AND r."department_id" = target_department AND r."actor_user_id" = NEW."recorded_by_user_id"
         AND r."action" = 'REVOKE' AND r."result_snapshot"->>'revocationId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'second-instance result revocation mismatch' USING ERRCODE = '23514';
    END IF;
    IF source_result."result" = 'REMAND' AND NOT EXISTS (SELECT 1 FROM "case_trial_rounds" child
      WHERE child."source_result_id" = source_result."id" AND child."revoked_at" = NEW."recorded_at"
        AND NOT EXISTS (SELECT 1 FROM "case_acceptances" a WHERE a."trial_round_id" = child."id")
        AND NOT EXISTS (SELECT 1 FROM "case_hearing_arrangements" h WHERE h."trial_round_id" = child."id")
        AND NOT EXISTS (SELECT 1 FROM "case_judgment_facts" j WHERE j."trial_round_id" = child."id")) THEN
      RAISE EXCEPTION 'remand child not empty/revoked' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.check_case_execution_submission_final()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; c record; e record; prior record; choice_record record;
        result_record record; selected jsonb; expected_source_version integer; entry_root "case_external_entries"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='cases' THEN
    IF normal_initial_execution_early_terminal(NEW.id,NEW.department_id) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' AND TG_OP = 'UPDATE' THEN
    IF case_early_closure_transition(OLD, NEW) OR case_early_closure_register_transition(OLD, NEW) OR case_early_closure_correction_transition(OLD, NEW) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN
    IF TG_OP = 'UPDATE' THEN
      IF case_early_archive_transition(OLD, NEW) THEN RETURN NEW; END IF;
    END IF;
  END IF;
IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id" = target_case AND "department_id" = target_department;
  -- Only the local litigation head's temporal context changes. No NEW/OLD/fact/DB row projection.
  IF TG_TABLE_NAME='cases' THEN
    SELECT projected.stage,projected.version INTO c.stage,c.version
      FROM public.cases physical_case
      CROSS JOIN LATERAL public.case_early_terminal_workflow_context(physical_case) projected
      WHERE physical_case.id=NEW.id AND physical_case.department_id=NEW.department_id;
  END IF;
  SELECT * INTO entry_root FROM "case_external_entries" WHERE "case_id"=target_case AND "department_id"=target_department;
  SELECT * INTO e FROM "case_execution_submissions" WHERE "id" = c."current_execution_submission_id"
    AND "case_id" = target_case AND "department_id" = target_department;
  IF c."current_execution_submission_id" IS NULL AND entry_root."id" IS NOT NULL AND c."stage"='WAITING_EXECUTION_CONFIRMATION' THEN
    PERFORM ca018_assert_execution_phase_chain(target_case,target_department);
    RETURN NEW;
  END IF;
  IF c."current_execution_submission_id" IS NULL THEN
    IF c."stage" = 'WAITING_EXECUTION_CONFIRMATION' OR EXISTS (
      SELECT 1 FROM "case_execution_submissions" x WHERE x."case_id" = target_case
        AND x."department_id" = target_department AND x."trial_round_id" = c."current_trial_round_id") THEN
      RAISE EXCEPTION 'execution confirmation has no head' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF e."id" IS NULL OR NOT ((c."stage" = 'WAITING_EXECUTION_CONFIRMATION' AND c."version" = e."to_version" AND NOT EXISTS (
  SELECT 1 FROM "case_execution_confirmations" f WHERE f."case_id" = target_case AND f."department_id" = target_department)) OR
  (c."stage" IN ('WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED') AND EXISTS (
    SELECT 1 FROM "case_execution_confirmations" f WHERE f."case_id" = target_case AND f."department_id" = target_department
      AND f."submission_id" = e."id" AND f."from_version" = e."to_version" AND ((c."stage" = 'WAITING_EXECUTION_STAMP' AND f."to_version" = c."version" AND NOT EXISTS (SELECT 1 FROM "case_execution_mailings" mm WHERE mm."case_id"=target_case AND mm."department_id"=target_department)) OR
 (c."stage" = 'WAITING_EXECUTION_FILING' AND EXISTS (SELECT 1 FROM "case_execution_mailings" mm WHERE mm."case_id"=target_case AND mm."department_id"=target_department AND mm."confirmation_id"=f."id" AND mm."from_version"=f."to_version" AND mm."to_version"=c."version") AND NOT EXISTS (SELECT 1 FROM "case_execution_filings" ff WHERE ff."case_id"=target_case AND ff."department_id"=target_department)) OR
 (c."stage" IN ('EXECUTING','WAITING_ARCHIVE','ARCHIVED') AND EXISTS (SELECT 1 FROM "case_execution_mailings" mm JOIN "case_execution_filings" ff ON ff."mailing_id"=mm."id" AND ff."case_id"=mm."case_id" AND ff."department_id"=mm."department_id" WHERE mm."case_id"=target_case AND mm."department_id"=target_department AND mm."confirmation_id"=f."id" AND mm."from_version"=f."to_version" AND ff."from_version"=mm."to_version" AND ((c."stage"='EXECUTING' AND ff."to_version"=c."version" AND NOT EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department)) OR
 (c."stage" IN ('WAITING_ARCHIVE','ARCHIVED') AND EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department AND ef."filing_id"=ff."id" AND ef."from_version"=ff."to_version" AND case_closure_terminal_version(target_case,target_department,ef."id",ef."to_version")=c."version"))))))))) OR
       c."current_trial_round_id" IS DISTINCT FROM e."trial_round_id" OR
       c."current_judgment_next_step_id" IS DISTINCT FROM e."judgment_next_step_id" OR
       c."current_second_instance_result_id" IS DISTINCT FROM e."second_instance_result_id" OR
       e."id" IS DISTINCT FROM (SELECT x."id" FROM "case_execution_submissions" x
         WHERE x."case_id" = target_case AND x."department_id" = target_department
           AND x."trial_round_id" = e."trial_round_id" ORDER BY x."to_version" DESC LIMIT 1) THEN
      RAISE EXCEPTION 'execution head stage/version/source mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'case_execution_submissions' THEN
    IF EXISTS (SELECT 1 FROM "case_execution_confirmations" f WHERE f."case_id" = target_case AND f."department_id" = target_department) THEN
      RAISE EXCEPTION 'execution confirmation blocks resubmission' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO e FROM "case_execution_submissions" WHERE "id" = NEW."id";
    SELECT * INTO choice_record FROM "case_judgment_next_steps" s WHERE s."id" = e."judgment_next_step_id"
      AND s."case_id" = target_case AND s."department_id" = target_department
      AND s."trial_round_id" = e."trial_round_id" AND NOT EXISTS
        (SELECT 1 FROM "case_judgment_next_step_revocations" r WHERE r."choice_id" = s."id");
    IF choice_record."id" IS NULL THEN
      IF e."judgment_next_step_id" IS NOT NULL OR entry_root."id" IS NULL OR
         e."external_entry_id" IS DISTINCT FROM entry_root."id" OR
         c."source_lead_id" IS NOT NULL OR c."source_notary_matter_id" IS NOT NULL OR c."certificate_id" IS NOT NULL THEN
        RAISE EXCEPTION 'execution choice source missing' USING ERRCODE='23514'; END IF;
      IF entry_root."initial_stage"='WAITING_EXECUTION_DOCUMENTS' THEN
        IF e."second_instance_result_id" IS NOT NULL OR (e."prior_submission_id" IS NULL AND e."from_version" IS DISTINCT FROM 1) OR
           EXISTS (SELECT 1 FROM "case_second_instance_results" x WHERE x."case_id"=target_case AND x."department_id"=target_department)
        THEN RAISE EXCEPTION 'execution entry document seed mismatch' USING ERRCODE='23514'; END IF;
      ELSIF entry_root."initial_stage"='SECOND_INSTANCE' THEN
        SELECT * INTO result_record FROM "case_second_instance_results" r
         WHERE r."id"=e."second_instance_result_id" AND r."case_id"=target_case AND r."department_id"=target_department
           AND r."trial_round_id"=e."trial_round_id" AND r."choice_id" IS NULL AND
           r."external_entry_id"=entry_root."id" AND r."result" IN ('AFFIRM','CHANGE') AND
           NOT EXISTS (SELECT 1 FROM "case_second_instance_result_revocations" x WHERE x."result_id"=r."id");
        IF result_record."id" IS NULL OR result_record."id" IS DISTINCT FROM c."current_second_instance_result_id" OR
           (e."prior_submission_id" IS NULL AND e."from_version" IS DISTINCT FROM result_record."to_version")
        THEN RAISE EXCEPTION 'execution direct appeal result mismatch' USING ERRCODE='23514'; END IF;
      ELSE RAISE EXCEPTION 'execution choice source missing' USING ERRCODE='23514'; END IF;
      expected_source_version:=e."from_version";
    ELSIF choice_record."next" = 'EXECUTION' THEN
      IF e."second_instance_result_id" IS NOT NULL THEN
        RAISE EXCEPTION 'direct execution cannot have appeal result' USING ERRCODE = '23514';
      END IF;
      expected_source_version := choice_record."to_version";
    ELSE
      SELECT * INTO result_record FROM "case_second_instance_results" r WHERE r."id" = e."second_instance_result_id"
        AND r."case_id" = target_case AND r."department_id" = target_department
        AND r."trial_round_id" = e."trial_round_id" AND r."choice_id" = e."judgment_next_step_id"
        AND r."result" IN ('AFFIRM','CHANGE') AND NOT EXISTS
          (SELECT 1 FROM "case_second_instance_result_revocations" v WHERE v."result_id" = r."id");
      IF choice_record."next" <> 'APPEAL' OR result_record."id" IS NULL THEN
        RAISE EXCEPTION 'execution appeal result source missing' USING ERRCODE = '23514';
      END IF;
      expected_source_version := result_record."to_version";
    END IF;
    SELECT * INTO prior FROM "case_execution_submissions" WHERE "id" = e."prior_submission_id"
      AND "case_id" = target_case AND "department_id" = target_department;
    IF (e."prior_submission_id" IS NULL AND (e."change_reason" IS NOT NULL OR
         e."from_version" <> expected_source_version)) OR
       (e."prior_submission_id" IS NOT NULL AND (prior."id" IS NULL OR
         prior."id" = e."id" OR prior."to_version" <> e."from_version" OR
         prior."trial_round_id" <> e."trial_round_id" OR
         prior."external_entry_id" IS DISTINCT FROM e."external_entry_id" OR
         prior."judgment_next_step_id" IS DISTINCT FROM e."judgment_next_step_id" OR
         prior."second_instance_result_id" IS DISTINCT FROM e."second_instance_result_id" OR
         NULLIF(btrim(e."change_reason"), '') IS NULL OR
         prior."id" IS DISTINCT FROM (SELECT x."id" FROM "case_execution_submissions" x
           WHERE x."case_id" = target_case AND x."department_id" = target_department
             AND x."trial_round_id" = e."trial_round_id" AND x."id" <> e."id"
           ORDER BY x."to_version" DESC LIMIT 1) OR
         (SELECT array_agg(x."content_version_id" ORDER BY x."content_version_id")
           FROM "case_execution_submission_versions" x WHERE x."submission_id" = prior."id") IS NOT DISTINCT FROM
         (SELECT array_agg(x."content_version_id" ORDER BY x."content_version_id")
           FROM "case_execution_submission_versions" x WHERE x."submission_id" = e."id"))) THEN
      RAISE EXCEPTION 'execution submission version, predecessor or change mismatch' USING ERRCODE = '23514';
    END IF;
    SELECT a."details"->'executionApplicationContentVersionIds' INTO selected FROM "audit_events" a
      WHERE a."id" = e."audit_event_id" AND a."department_id" = target_department
        AND a."resource_type" = 'CASE' AND a."resource_id" = target_case
        AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = e."submitted_by_user_id"
        AND a."action" = 'case.execution.submitted'
        AND a."details"->>'submissionId' = e."id"::text
        AND a."details"->>'trialRoundId' = e."trial_round_id"::text
        AND a."details"->'judgmentNextStepId' IS NOT DISTINCT FROM COALESCE(to_jsonb(e."judgment_next_step_id"),'null'::jsonb)
        AND a."details"->>'secondInstanceResultId' IS NOT DISTINCT FROM e."second_instance_result_id"::text
        AND a."details"->>'priorSubmissionId' IS NOT DISTINCT FROM e."prior_submission_id"::text
        AND a."details"->>'changeReason' IS NOT DISTINCT FROM e."change_reason"
        AND a."details"->>'fromVersion' = e."from_version"::text
        AND a."details"->>'toVersion' = e."to_version"::text;
    IF jsonb_typeof(selected) IS DISTINCT FROM 'array' OR jsonb_array_length(selected) NOT BETWEEN 1 AND 10 OR
       (SELECT count(*) FROM "case_execution_submission_versions" v WHERE v."submission_id" = e."id") <> jsonb_array_length(selected) OR
       EXISTS (SELECT 1 FROM "case_execution_submission_versions" v WHERE v."submission_id" = e."id"
         AND NOT selected ? v."content_version_id"::text) OR
       NOT EXISTS (SELECT 1 FROM "case_execution_submission_receipts" r WHERE r."case_id" = target_case
         AND r."department_id" = target_department AND r."actor_user_id" = e."submitted_by_user_id"
         AND r."result_snapshot"->>'submissionId' = e."id"::text) THEN
      RAISE EXCEPTION 'execution audit, frozen set or receipt mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.check_case_execution_confirmation_final()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; c record; f record; s record; a record; entry_root "case_external_entries"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='cases' THEN
    IF normal_pending_early_terminal(NEW.id,NEW.department_id) OR normal_initial_appeal_early_terminal(NEW.id,NEW.department_id) OR normal_prejudgment_early_terminal(NEW.id,NEW.department_id) OR normal_initial_execution_early_terminal(NEW.id,NEW.department_id) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' AND TG_OP = 'UPDATE' THEN
    IF case_early_closure_transition(OLD, NEW) OR case_early_closure_register_transition(OLD, NEW) OR case_early_closure_correction_transition(OLD, NEW) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN
    IF TG_OP = 'UPDATE' THEN
      IF case_early_archive_transition(OLD, NEW) THEN RETURN NEW; END IF;
    END IF;
  END IF;
IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id" = target_case AND "department_id" = target_department;
  -- Only the local litigation head's temporal context changes. No NEW/OLD/fact/DB row projection.
  IF TG_TABLE_NAME='cases' THEN
    SELECT projected.stage,projected.version INTO c.stage,c.version
      FROM public.cases physical_case
      CROSS JOIN LATERAL public.case_early_terminal_workflow_context(physical_case) projected
      WHERE physical_case.id=NEW.id AND physical_case.department_id=NEW.department_id;
  END IF;
  SELECT * INTO entry_root FROM "case_external_entries" WHERE "case_id"=target_case AND "department_id"=target_department;
  SELECT * INTO f FROM "case_execution_confirmations" WHERE "case_id" = target_case AND "department_id" = target_department;
  IF f."id" IS NULL AND entry_root."id" IS NOT NULL AND c."stage" IN ('WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED') THEN
    PERFORM ca018_assert_execution_phase_chain(target_case,target_department);
    RETURN NEW;
  END IF;
  IF f."id" IS NULL THEN
    IF c."stage" IN ('WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED') THEN
      RAISE EXCEPTION 'execution stamp has no confirmation' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO s FROM "case_execution_submissions" WHERE "id" = f."submission_id"
    AND "case_id" = target_case AND "department_id" = target_department;
  SELECT * INTO a FROM "audit_events" WHERE "id" = f."audit_event_id";
  IF NOT (s."id" IS NOT NULL OR (f."submission_id" IS NULL AND entry_root."initial_stage"='WAITING_EXECUTION_CONFIRMATION' AND
     f."external_entry_id" IS NOT DISTINCT FROM entry_root."id" AND entry_root."id" IS NOT NULL AND
     c."source_lead_id" IS NULL AND c."source_notary_matter_id" IS NULL AND c."certificate_id" IS NULL AND
     c."current_execution_submission_id" IS NULL AND c."current_judgment_next_step_id" IS NULL AND
     c."current_second_instance_result_id" IS NULL AND
     NOT EXISTS (SELECT 1 FROM "case_execution_submissions" x WHERE x."case_id"=target_case AND x."department_id"=target_department))) OR
     c."current_execution_submission_id" IS DISTINCT FROM s."id" OR
     NOT ((c."stage" = 'WAITING_EXECUTION_STAMP' AND c."version" = f."to_version" AND NOT EXISTS (SELECT 1 FROM "case_execution_mailings" mm WHERE mm."case_id"=target_case AND mm."department_id"=target_department)) OR
 (c."stage" = 'WAITING_EXECUTION_FILING' AND EXISTS (SELECT 1 FROM "case_execution_mailings" mm WHERE mm."case_id"=target_case AND mm."department_id"=target_department AND mm."confirmation_id"=f."id" AND mm."from_version"=f."to_version" AND mm."to_version"=c."version") AND NOT EXISTS (SELECT 1 FROM "case_execution_filings" ff WHERE ff."case_id"=target_case AND ff."department_id"=target_department)) OR
 (c."stage" IN ('EXECUTING','WAITING_ARCHIVE','ARCHIVED') AND EXISTS (SELECT 1 FROM "case_execution_mailings" mm JOIN "case_execution_filings" ff ON ff."mailing_id"=mm."id" AND ff."case_id"=mm."case_id" AND ff."department_id"=mm."department_id" WHERE mm."case_id"=target_case AND mm."department_id"=target_department AND mm."confirmation_id"=f."id" AND mm."from_version"=f."to_version" AND ff."from_version"=mm."to_version" AND ((c."stage"='EXECUTING' AND ff."to_version"=c."version" AND NOT EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department)) OR
 (c."stage" IN ('WAITING_ARCHIVE','ARCHIVED') AND EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department AND ef."filing_id"=ff."id" AND ef."from_version"=ff."to_version" AND case_closure_terminal_version(target_case,target_department,ef."id",ef."to_version")=c."version")))))) OR
     f."from_version" <> COALESCE(s."to_version",1) OR f."to_version" <> f."from_version" + 1 OR
     (s."id" IS NOT NULL AND c."current_trial_round_id" IS DISTINCT FROM s."trial_round_id") OR
     (s."id" IS NOT NULL AND c."current_judgment_next_step_id" IS DISTINCT FROM s."judgment_next_step_id") OR
     (s."id" IS NOT NULL AND c."current_second_instance_result_id" IS DISTINCT FROM s."second_instance_result_id") OR
     (s."id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_execution_submission_versions" v WHERE v."submission_id" = s."id")) OR
     (s."id" IS NULL AND (SELECT count(*) FROM "case_execution_confirmation_versions" v WHERE v."confirmation_id"=f."id") NOT BETWEEN 1 AND 10) OR
     s."id" IS DISTINCT FROM (SELECT x."id" FROM "case_execution_submissions" x
       WHERE x."case_id" = target_case AND x."department_id" = target_department ORDER BY x."to_version" DESC LIMIT 1) OR
     a."id" IS NULL OR a."department_id" <> target_department OR a."resource_type" <> 'CASE' OR
     a."resource_id" <> target_case OR a."actor_kind" <> 'HUMAN' OR
     a."actor_user_id" <> f."confirmed_by_user_id" OR a."action" <> 'case.execution.confirmed' OR
     a."details"->>'confirmationId' IS DISTINCT FROM f."id"::text OR
     a."details"->'submissionId' IS DISTINCT FROM COALESCE(to_jsonb(f."submission_id"),'null'::jsonb) OR
     a."details"->>'fromVersion' IS DISTINCT FROM f."from_version"::text OR
     a."details"->>'toVersion' IS DISTINCT FROM f."to_version"::text OR
     NOT EXISTS (SELECT 1 FROM "case_execution_confirmation_receipts" r WHERE r."case_id" = target_case
       AND r."department_id" = target_department AND r."actor_user_id" = f."confirmed_by_user_id"
       AND r."result_snapshot"->>'confirmationId' = f."id"::text) THEN
    RAISE EXCEPTION 'execution confirmation chain mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.check_case_execution_mailing_final()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; c record; m record; conf record; audit record; selected jsonb; entry_root "case_external_entries"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='cases' THEN
    IF normal_pending_early_terminal(NEW.id,NEW.department_id) OR normal_initial_appeal_early_terminal(NEW.id,NEW.department_id) OR normal_prejudgment_early_terminal(NEW.id,NEW.department_id) OR normal_initial_execution_early_terminal(NEW.id,NEW.department_id) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' AND TG_OP = 'UPDATE' THEN
    IF case_early_closure_transition(OLD, NEW) OR case_early_closure_register_transition(OLD, NEW) OR case_early_closure_correction_transition(OLD, NEW) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN
    IF TG_OP = 'UPDATE' THEN
      IF case_early_archive_transition(OLD, NEW) THEN RETURN NEW; END IF;
    END IF;
  END IF;
IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; target_department:=NEW."department_id";
  ELSE target_case:=NEW."case_id"; target_department:=NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
  -- Only the local litigation head's temporal context changes. No NEW/OLD/fact/DB row projection.
  IF TG_TABLE_NAME='cases' THEN
    SELECT projected.stage,projected.version INTO c.stage,c.version
      FROM public.cases physical_case
      CROSS JOIN LATERAL public.case_early_terminal_workflow_context(physical_case) projected
      WHERE physical_case.id=NEW.id AND physical_case.department_id=NEW.department_id;
  END IF;
  SELECT * INTO entry_root FROM "case_external_entries" WHERE "case_id"=target_case AND "department_id"=target_department;
  SELECT * INTO m FROM "case_execution_mailings" WHERE "case_id"=target_case AND "department_id"=target_department;
  IF m."id" IS NULL AND entry_root."id" IS NOT NULL AND c."stage" IN ('WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED') THEN
    PERFORM ca018_assert_execution_phase_chain(target_case,target_department);
    RETURN NEW;
  END IF;
  IF m."id" IS NULL THEN
    IF c."stage" IN ('WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED') THEN
      RAISE EXCEPTION 'execution mailing missing' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO conf FROM "case_execution_confirmations" WHERE "id"=m."confirmation_id"
    AND "case_id"=target_case AND "department_id"=target_department;
  SELECT * INTO audit FROM "audit_events" WHERE "id"=m."audit_event_id";
  selected:=audit."details"->'mailReceiptContentVersionIds';
  IF NOT (conf."id" IS NOT NULL OR (m."confirmation_id" IS NULL AND entry_root."initial_stage"='WAITING_EXECUTION_STAMP' AND
     m."external_entry_id" IS NOT DISTINCT FROM entry_root."id" AND entry_root."id" IS NOT NULL AND
     c."source_lead_id" IS NULL AND c."source_notary_matter_id" IS NULL AND c."certificate_id" IS NULL AND
     c."current_execution_submission_id" IS NULL AND
     NOT EXISTS (SELECT 1 FROM "case_execution_confirmations" x WHERE x."case_id"=target_case AND x."department_id"=target_department) AND
     NOT EXISTS (SELECT 1 FROM "case_execution_submissions" x WHERE x."case_id"=target_case AND x."department_id"=target_department))) OR
     conf."submission_id" IS DISTINCT FROM c."current_execution_submission_id" OR
     m."from_version"<>COALESCE(conf."to_version",1) OR m."to_version"<>m."from_version"+1 OR
     NOT ((c."stage"='WAITING_EXECUTION_FILING' AND c."version"=m."to_version" AND NOT EXISTS
       (SELECT 1 FROM "case_execution_filings" f WHERE f."case_id"=target_case AND f."department_id"=target_department)) OR
       (c."stage" IN ('EXECUTING','WAITING_ARCHIVE','ARCHIVED') AND EXISTS (SELECT 1 FROM "case_execution_filings" f
         WHERE f."case_id"=target_case AND f."department_id"=target_department
           AND f."mailing_id"=m."id" AND f."from_version"=m."to_version" AND ((c."stage"='EXECUTING' AND f."to_version"=c."version" AND NOT EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department)) OR
 (c."stage" IN ('WAITING_ARCHIVE','ARCHIVED') AND EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department AND ef."filing_id"=f."id" AND ef."from_version"=f."to_version" AND case_closure_terminal_version(target_case,target_department,ef."id",ef."to_version")=c."version")))))) OR
     audit."id" IS NULL OR audit."department_id"<>target_department OR audit."resource_type"<>'CASE' OR
     audit."resource_id"<>target_case OR audit."actor_kind"<>'HUMAN' OR
     audit."actor_user_id"<>m."recorded_by_user_id" OR audit."action"<>'case.execution.mailed' OR
     (m."actor_type"='INTERNAL' AND audit."internal_actor_user_id" IS DISTINCT FROM m."recorded_by_user_id") OR
     (m."actor_type"='CLIENT' AND audit."customer_account_binding_id" IS DISTINCT FROM m."customer_account_binding_id") OR
     (m."actor_type"='LAWYER' AND audit."lawyer_account_binding_id" IS DISTINCT FROM m."lawyer_account_binding_id") OR
     audit."details"->>'actorType' IS DISTINCT FROM m."actor_type"::text OR
     audit."details"->>'mailingId' IS DISTINCT FROM m."id"::text OR
     audit."details"->'confirmationId' IS DISTINCT FROM COALESCE(to_jsonb(m."confirmation_id"),'null'::jsonb) OR
     audit."details"->>'fromVersion' IS DISTINCT FROM m."from_version"::text OR
     audit."details"->>'toVersion' IS DISTINCT FROM m."to_version"::text OR
     (audit."details"->>'mailedAt')::date IS DISTINCT FROM m."mailed_at" OR
     jsonb_typeof(selected) IS DISTINCT FROM 'array' OR jsonb_array_length(selected) NOT BETWEEN 1 AND 10 OR
     (SELECT count(*) FROM "case_execution_mailing_versions" v WHERE v."mailing_id"=m."id")<>jsonb_array_length(selected) OR
     EXISTS (SELECT 1 FROM "case_execution_mailing_versions" v WHERE v."mailing_id"=m."id"
       AND NOT selected ? v."content_version_id"::text) OR
     EXISTS (SELECT 1 FROM "case_execution_mailing_versions" v WHERE v."mailing_id"=m."id"
       AND NOT EXISTS (SELECT 1 FROM "material_references" r WHERE r."action_event_id"=m."audit_event_id"
         AND r."resource_type"='case' AND r."resource_id"=target_case AND r."purpose"='MAIL_RECEIPT'
         AND r."material_id"=v."material_id" AND r."content_version_id"=v."content_version_id")) OR
     NOT EXISTS (SELECT 1 FROM "case_execution_mailing_receipts" r WHERE r."case_id"=target_case
       AND r."department_id"=target_department AND r."actor_user_id"=m."recorded_by_user_id"
       AND r."result_snapshot"->>'mailingId'=m."id"::text) THEN
    RAISE EXCEPTION 'execution mailing chain/audit/receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.check_case_execution_filing_final()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; c record; f record; m record; audit record; selected jsonb; entry_root "case_external_entries"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='cases' THEN
    IF normal_pending_early_terminal(NEW.id,NEW.department_id) OR normal_initial_appeal_early_terminal(NEW.id,NEW.department_id) OR normal_prejudgment_early_terminal(NEW.id,NEW.department_id) OR normal_initial_execution_early_terminal(NEW.id,NEW.department_id) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' AND TG_OP = 'UPDATE' THEN
    IF case_early_closure_transition(OLD, NEW) OR case_early_closure_register_transition(OLD, NEW) OR case_early_closure_correction_transition(OLD, NEW) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN
    IF TG_OP = 'UPDATE' THEN
      IF case_early_archive_transition(OLD, NEW) THEN RETURN NEW; END IF;
    END IF;
  END IF;
IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; target_department:=NEW."department_id";
  ELSE target_case:=NEW."case_id"; target_department:=NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
  -- Only the local litigation head's temporal context changes. No NEW/OLD/fact/DB row projection.
  IF TG_TABLE_NAME='cases' THEN
    SELECT projected.stage,projected.version INTO c.stage,c.version
      FROM public.cases physical_case
      CROSS JOIN LATERAL public.case_early_terminal_workflow_context(physical_case) projected
      WHERE physical_case.id=NEW.id AND physical_case.department_id=NEW.department_id;
  END IF;
  SELECT * INTO entry_root FROM "case_external_entries" WHERE "case_id"=target_case AND "department_id"=target_department;
  SELECT * INTO f FROM "case_execution_filings" WHERE "case_id"=target_case AND "department_id"=target_department;
  IF f."id" IS NULL AND entry_root."id" IS NOT NULL AND c."stage" IN ('EXECUTING','WAITING_ARCHIVE','ARCHIVED') THEN
    PERFORM ca018_assert_execution_phase_chain(target_case,target_department);
    RETURN NEW;
  END IF;
  IF f."id" IS NULL THEN
    IF c."stage" IN ('EXECUTING','WAITING_ARCHIVE','ARCHIVED') THEN RAISE EXCEPTION 'execution filing missing' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO m FROM "case_execution_mailings" WHERE "id"=f."mailing_id" AND "case_id"=target_case AND "department_id"=target_department;
  SELECT * INTO audit FROM "audit_events" WHERE "id"=f."audit_event_id";
  selected:=audit."details"->'executionFilingProofContentVersionIds';
  IF NOT (m."id" IS NOT NULL OR (f."mailing_id" IS NULL AND entry_root."initial_stage"='WAITING_EXECUTION_FILING' AND
     f."external_entry_id" IS NOT DISTINCT FROM entry_root."id" AND entry_root."id" IS NOT NULL AND
     c."source_lead_id" IS NULL AND c."source_notary_matter_id" IS NULL AND c."certificate_id" IS NULL AND
     NOT EXISTS (SELECT 1 FROM "case_execution_mailings" x WHERE x."case_id"=target_case AND x."department_id"=target_department) AND
     NOT EXISTS (SELECT 1 FROM "case_execution_confirmations" x WHERE x."case_id"=target_case AND x."department_id"=target_department) AND
     NOT EXISTS (SELECT 1 FROM "case_execution_submissions" x WHERE x."case_id"=target_case AND x."department_id"=target_department))) OR
     m."confirmation_id" IS DISTINCT FROM
       (SELECT x."id" FROM "case_execution_confirmations" x WHERE x."case_id"=target_case AND x."department_id"=target_department) OR
     NOT ((c."stage"='EXECUTING' AND c."version"=f."to_version" AND NOT EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department)) OR
 (c."stage" IN ('WAITING_ARCHIVE','ARCHIVED') AND EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department AND ef."filing_id"=f."id" AND ef."from_version"=f."to_version" AND case_closure_terminal_version(target_case,target_department,ef."id",ef."to_version")=c."version"))) OR
     f."from_version"<>COALESCE(m."to_version",1) OR f."to_version"<>f."from_version"+1 OR
     audit."id" IS NULL OR audit."department_id"<>target_department OR audit."resource_type"<>'CASE' OR
     audit."resource_id"<>target_case OR audit."actor_kind"<>'HUMAN' OR
     audit."actor_user_id"<>f."submitted_by_user_id" OR audit."action"<>'case.execution.filing.submitted' OR
     audit."details"->>'filingId' IS DISTINCT FROM f."id"::text OR
     audit."details"->'mailingId' IS DISTINCT FROM COALESCE(to_jsonb(f."mailing_id"),'null'::jsonb) OR
     audit."details"->>'fromVersion' IS DISTINCT FROM f."from_version"::text OR
     audit."details"->>'toVersion' IS DISTINCT FROM f."to_version"::text OR
     (audit."details"->>'submittedAt')::date IS DISTINCT FROM f."submitted_at" OR
     jsonb_typeof(selected) IS DISTINCT FROM 'array' OR jsonb_array_length(selected) NOT BETWEEN 1 AND 10 OR
     (SELECT count(*) FROM "case_execution_filing_versions" v WHERE v."filing_id"=f."id")<>jsonb_array_length(selected) OR
     EXISTS (SELECT 1 FROM "case_execution_filing_versions" v WHERE v."filing_id"=f."id"
       AND NOT selected ? v."content_version_id"::text) OR
     NOT EXISTS (SELECT 1 FROM "case_execution_filing_receipts" r WHERE r."case_id"=target_case
       AND r."department_id"=target_department AND r."actor_user_id"=f."submitted_by_user_id"
       AND r."result_snapshot"->>'filingId'=f."id"::text) OR
     EXISTS (SELECT 1 FROM "case_execution_filing_versions" v WHERE v."filing_id"=f."id"
       AND NOT EXISTS (SELECT 1 FROM "material_references" r WHERE r."action_event_id"=f."audit_event_id"
         AND r."resource_type"='case' AND r."resource_id"=target_case AND r."purpose"='EXECUTION_FILING_PROOF'
         AND r."material_id"=v."material_id" AND r."content_version_id"=v."content_version_id")) THEN
    RAISE EXCEPTION 'execution filing chain/audit/reference/receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.check_case_execution_finish_final()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; c record; f record; m record; audit record; selected jsonb; entry_root "case_external_entries"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='cases' THEN
    IF normal_pending_early_terminal(NEW.id,NEW.department_id) OR normal_initial_appeal_early_terminal(NEW.id,NEW.department_id) OR normal_prejudgment_early_terminal(NEW.id,NEW.department_id) OR normal_initial_execution_early_terminal(NEW.id,NEW.department_id) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' AND TG_OP = 'UPDATE' THEN
    IF case_early_closure_transition(OLD, NEW) OR case_early_closure_register_transition(OLD, NEW) OR case_early_closure_correction_transition(OLD, NEW) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN
    IF TG_OP = 'UPDATE' THEN
      IF case_early_archive_transition(OLD, NEW) THEN RETURN NEW; END IF;
    END IF;
  END IF;
IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; target_department:=NEW."department_id";
  ELSE target_case:=NEW."case_id"; target_department:=NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
  -- Only the local litigation head's temporal context changes. No NEW/OLD/fact/DB row projection.
  IF TG_TABLE_NAME='cases' THEN
    SELECT projected.stage,projected.version INTO c.stage,c.version
      FROM public.cases physical_case
      CROSS JOIN LATERAL public.case_early_terminal_workflow_context(physical_case) projected
      WHERE physical_case.id=NEW.id AND physical_case.department_id=NEW.department_id;
  END IF;
  SELECT * INTO entry_root FROM "case_external_entries" WHERE "case_id"=target_case AND "department_id"=target_department;
  SELECT * INTO f FROM "case_execution_finishes" WHERE "case_id"=target_case AND "department_id"=target_department;
  IF f."id" IS NULL AND entry_root."id" IS NOT NULL AND c."stage" IN ('WAITING_ARCHIVE','ARCHIVED') THEN
    PERFORM ca018_assert_execution_phase_chain(target_case,target_department);
    RETURN NEW;
  END IF;
  IF f."id" IS NULL THEN
    IF c."stage" IN ('WAITING_ARCHIVE','ARCHIVED') THEN RAISE EXCEPTION 'execution filing missing' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO m FROM "case_execution_filings" WHERE "id"=f."filing_id" AND "case_id"=target_case AND "department_id"=target_department;
  SELECT * INTO audit FROM "audit_events" WHERE "id"=f."audit_event_id";
  selected:=audit."details"->'basisContentVersionIds';
  IF NOT (m."id" IS NOT NULL OR (f."filing_id" IS NULL AND entry_root."initial_stage"='EXECUTING' AND
     f."external_entry_id" IS NOT DISTINCT FROM entry_root."id" AND entry_root."id" IS NOT NULL AND
     c."source_lead_id" IS NULL AND c."source_notary_matter_id" IS NULL AND c."certificate_id" IS NULL AND
     NOT EXISTS (SELECT 1 FROM "case_execution_filings" x WHERE x."case_id"=target_case AND x."department_id"=target_department) AND
     NOT EXISTS (SELECT 1 FROM "case_execution_mailings" x WHERE x."case_id"=target_case AND x."department_id"=target_department) AND
     NOT EXISTS (SELECT 1 FROM "case_execution_confirmations" x WHERE x."case_id"=target_case AND x."department_id"=target_department) AND
     NOT EXISTS (SELECT 1 FROM "case_execution_submissions" x WHERE x."case_id"=target_case AND x."department_id"=target_department))) OR
     m."mailing_id" IS DISTINCT FROM
       (SELECT x."id" FROM "case_execution_mailings" x WHERE x."case_id"=target_case AND x."department_id"=target_department) OR
     c."stage" NOT IN ('WAITING_ARCHIVE','ARCHIVED') OR c."version"<>case_closure_terminal_version(target_case,target_department,f."id",f."to_version") OR
     f."from_version"<>COALESCE(m."to_version",1) OR f."to_version"<>f."from_version"+1 OR
     audit."id" IS NULL OR audit."department_id"<>target_department OR audit."resource_type"<>'CASE' OR
     audit."resource_id"<>target_case OR audit."actor_kind"<>'HUMAN' OR
     audit."actor_user_id"<>f."recorded_by_user_id" OR audit."action"<>'case.execution.finished' OR
     audit."details"->>'finishId' IS DISTINCT FROM f."id"::text OR
     audit."details"->'filingId' IS DISTINCT FROM COALESCE(to_jsonb(f."filing_id"),'null'::jsonb) OR
     audit."details"->>'reason' IS DISTINCT FROM f."reason" OR
     audit."details"->'basisNote' IS DISTINCT FROM COALESCE(to_jsonb(f."basis_note"),'null'::jsonb) OR
     (audit."internal_actor_user_id" IS DISTINCT FROM f."recorded_by_user_id" AND NOT EXISTS
       (SELECT 1 FROM "lawyer_account_bindings" b WHERE b."id"=audit."lawyer_account_binding_id" AND b."user_id"=f."recorded_by_user_id" AND b."department_id"=target_department)) OR
     audit."details"->>'fromVersion' IS DISTINCT FROM f."from_version"::text OR
     audit."details"->>'toVersion' IS DISTINCT FROM f."to_version"::text OR
     (audit."details"->>'finishedAt')::date IS DISTINCT FROM f."finished_at" OR
     jsonb_typeof(selected) IS DISTINCT FROM 'array' OR jsonb_array_length(selected) NOT BETWEEN 0 AND 10 OR
     (f."basis_note" IS NULL AND jsonb_array_length(selected)=0) OR
     (SELECT count(*) FROM "case_execution_finish_versions" v WHERE v."finish_id"=f."id")<>jsonb_array_length(selected) OR
     EXISTS (SELECT 1 FROM "case_execution_finish_versions" v WHERE v."finish_id"=f."id"
       AND NOT selected ? v."content_version_id"::text) OR
     NOT EXISTS (SELECT 1 FROM "case_execution_finish_receipts" r WHERE r."case_id"=target_case
       AND r."department_id"=target_department AND r."actor_user_id"=f."recorded_by_user_id"
       AND r."result_snapshot"->>'finishId'=f."id"::text) OR
     EXISTS (SELECT 1 FROM "case_execution_finish_versions" v WHERE v."finish_id"=f."id"
       AND NOT EXISTS (SELECT 1 FROM "material_references" r WHERE r."action_event_id"=f."audit_event_id"
         AND r."resource_type"='case' AND r."resource_id"=target_case AND r."purpose"='EXECUTION_FINISH_BASIS'
         AND r."material_id"=v."material_id" AND r."content_version_id"=v."content_version_id")) THEN
    RAISE EXCEPTION 'execution filing chain/audit/reference/receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $function$;

COMMIT;
