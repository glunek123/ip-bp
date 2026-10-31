-- New forward migration only: internal own-case early closure accepts either existing action.
-- No accounts/grants, ordinary closure authorization, stage mutation or immutable facts are rewritten.
BEGIN;
SET LOCAL search_path = public;
DO $before$
DECLARE expected record; actual record;
BEGIN
 IF current_schema() IS DISTINCT FROM 'public' OR current_schemas(false) IS DISTINCT FROM ARRAY['public']::name[]
  OR to_regclass('public.cases') IS NULL OR to_regclass('public.case_closure_versions') IS NULL THEN
  RAISE EXCEPTION '269 requires the existing public case schema' USING ERRCODE='23514'; END IF;
 IF to_regprocedure('public.case_early_closure_action_authorized(uuid,uuid,uuid)') IS NOT NULL
  OR to_regprocedure('public.case_early_closure_initial_version_authorized(public.case_closure_versions,boolean)') IS NOT NULL
  OR to_regprocedure('public.case_early_closure_initial_payment_reference_authorized(uuid,uuid,uuid,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION '269 early authorization helper already exists' USING ERRCODE='23514'; END IF;
 FOR expected IN SELECT * FROM (VALUES
   ('case_early_closure_upload_authorized(uuid,uuid,uuid)','f756bd14f054d26553dc8b069bc7c8d6','sql','s','boolean'),
   ('guard_early_closure_actor_draft()','837d6f16932d776a289231285385b9e6','plpgsql','v','trigger'),
   ('check_early_closure_initial_payment_actor_draft()','6d7fc25057f53b841570dad3b0a55bb7','plpgsql','v','trigger'),
   ('check_case_closure_actor()','7667f84288e3f114e4166e74ce846601','plpgsql','v','trigger'),
   ('check_settlement_update_default_actor_final_draft()','90553484d3ee274a7ab50aa2c49cdc5e','plpgsql','v','trigger'),
   ('case_closure_actor_authorized(uuid,uuid,uuid,boolean)','e1443b704c22b7c2cd425dbfa44a1a9a','sql','s','boolean'),
   ('case_early_closure_register_transition(cases,cases)','c3595fa620a8070c6f41fea9f91d1443','plpgsql','s','boolean')
 ) required(signature,body_md5,language,volatility,result_type) LOOP
  SELECT p.*,l.lanname INTO actual FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='public' AND p.oid=to_regprocedure('public.'||expected.signature);
  IF actual.oid IS NULL OR md5(actual.prosrc) IS DISTINCT FROM expected.body_md5 OR actual.lanname IS DISTINCT FROM expected.language
   OR actual.provolatile::text IS DISTINCT FROM expected.volatility OR actual.prorettype IS DISTINCT FROM expected.result_type::regtype
   OR actual.prokind<>'f' OR actual.prosecdef OR actual.proleakproof OR actual.proisstrict
   OR actual.proparallel<>'u' OR actual.pronargdefaults<>0 OR actual.proconfig IS NOT NULL THEN
   RAISE EXCEPTION '269 unexpected function baseline: %',expected.signature USING ERRCODE='23514'; END IF;
 END LOOP;
END;
$before$;

DO $triggers$
DECLARE expected record;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('case_early_closures','early_closure_actor_draft_guard','guard_early_closure_actor_draft()',7,false,false),
  ('case_closure_payment_versions','early_closure_initial_payment_actor_draft','check_early_closure_initial_payment_actor_draft()',7,false,false),
  ('case_closure_payment_versions','early_closure_initial_payment_actor_final_draft','check_early_closure_initial_payment_actor_draft()',5,true,true),
  ('case_closure_versions','case_closure_actor_guard','check_case_closure_actor()',7,false,false),
  ('case_closure_versions','settlement_update_default_actor_final_draft','check_settlement_update_default_actor_final_draft()',5,true,true),
  ('upload_drafts','case_closure_upload_actor_guard','check_case_closure_upload_actor()',23,false,false)
 ) required(table_name,trigger_name,function_signature,trigger_type,deferred,initially_deferred) LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass('public.'||expected.table_name)
   AND t.tgname=expected.trigger_name AND t.tgfoid=to_regprocedure('public.'||expected.function_signature)
   AND t.tgtype=expected.trigger_type AND t.tgenabled='O' AND NOT t.tgisinternal
   AND t.tgdeferrable=expected.deferred AND t.tginitdeferred=expected.initially_deferred
   AND octet_length(t.tgargs)=0 AND t.tgqual IS NULL) THEN
   RAISE EXCEPTION '269 unexpected existing trigger: %',expected.trigger_name USING ERRCODE='23514'; END IF;
 END LOOP;
END;
$triggers$;

CREATE FUNCTION public.case_early_closure_action_authorized(target_actor uuid,target_case uuid,target_department uuid)
RETURNS boolean LANGUAGE sql STABLE AS $action$
 SELECT EXISTS (
  SELECT 1 FROM public.cases c JOIN public.user_accounts u
   ON u.id=target_actor AND u.active AND u.account_type='INTERNAL'
  JOIN public.department_memberships member ON member.user_id=u.id AND member.department_id=c.department_id AND member.active
  WHERE c.id=target_case AND c.department_id=target_department AND c.responsible_user_id=target_actor
   AND public.case_record_edit_actor_authorized(target_actor,target_case,target_department,'case.read') IS TRUE
   AND (public.case_record_edit_actor_authorized(target_actor,target_case,target_department,'case.closure.record') IS TRUE
     OR public.case_record_edit_actor_authorized(target_actor,target_case,target_department,'case.archive') IS TRUE)
   AND EXISTS (SELECT 1 FROM public.role_assignments r JOIN public.role_templates t
    ON t.id=r.role_template_id AND t.department_id=r.department_id AND t.active
    JOIN public.role_grants g ON g.role_template_id=t.id AND g.action='case.read'
    WHERE r.user_id=target_actor AND r.department_id=target_department AND r.active
     AND (g.scope IN ('DEPARTMENT','SELF') OR (g.scope='TEAM' AND r.team_id=member.team_id
      AND EXISTS (SELECT 1 FROM public.teams team WHERE team.id=r.team_id AND team.department_id=target_department AND team.status='ACTIVE'))))
   AND EXISTS (SELECT 1 FROM public.role_assignments r JOIN public.role_templates t
    ON t.id=r.role_template_id AND t.department_id=r.department_id AND t.active
    JOIN public.role_grants g ON g.role_template_id=t.id AND g.action IN ('case.closure.record','case.archive')
    WHERE r.user_id=target_actor AND r.department_id=target_department AND r.active
     AND (g.scope IN ('DEPARTMENT','SELF') OR (g.scope='TEAM' AND r.team_id=member.team_id
      AND EXISTS (SELECT 1 FROM public.teams team WHERE team.id=r.team_id AND team.department_id=target_department AND team.status='ACTIVE'))))
 );
$action$;

-- This predicate is only for the initial REGISTER in the same early-closure transaction.
-- It is not available to ordinary closure REGISTER or any correction/settlement update.
CREATE FUNCTION public.case_early_closure_initial_version_authorized(v public.case_closure_versions,final_check boolean)
RETURNS boolean LANGUAGE plpgsql STABLE AS $initial$
DECLARE c public.cases%ROWTYPE; e record; h record; a record; er record; before_register public.cases%ROWTYPE;
BEGIN
 IF final_check IS NULL OR v.id IS NULL OR v.kind IS DISTINCT FROM 'REGISTER' OR v.early_closure_id IS NULL
  OR v.finish_id IS NOT NULL OR v.external_entry_id IS NOT NULL OR v.prior_version_id IS NOT NULL
  OR v.from_version IS NULL OR v.to_version IS DISTINCT FROM v.from_version+1
  OR public.case_early_closure_action_authorized(v.recorded_by_user_id,v.case_id,v.department_id) IS NOT TRUE THEN RETURN false; END IF;
 SELECT * INTO c FROM public.cases WHERE id=v.case_id AND department_id=v.department_id;
 SELECT t.*,t.xmin AS creation_xmin INTO e FROM public.case_early_closures t
  WHERE t.id=v.early_closure_id AND t.case_id=v.case_id AND t.department_id=v.department_id;
 SELECT t.*,t.xmin AS creation_xmin INTO h FROM public.case_closures t
  WHERE t.id=v.closure_id AND t.case_id=v.case_id AND t.department_id=v.department_id;
 SELECT t.*,t.xmin AS creation_xmin INTO a FROM public.audit_events t WHERE t.id=v.audit_event_id;
 SELECT t.*,t.xmin AS creation_xmin INTO er FROM public.case_early_closure_receipts t
  WHERE t.early_closure_id=v.early_closure_id AND t.case_id=v.case_id AND t.department_id=v.department_id
   AND t.actor_user_id=v.recorded_by_user_id;
 IF c.id IS NULL OR c.stage IS DISTINCT FROM 'WAITING_ARCHIVE' OR c.responsible_user_id IS DISTINCT FROM v.recorded_by_user_id
  OR e.id IS NULL OR h.id IS NULL OR a.id IS NULL OR er.id IS NULL
  OR e.creation_xmin IS DISTINCT FROM pg_current_xact_id()::text::xid
  OR h.creation_xmin IS DISTINCT FROM pg_current_xact_id()::text::xid
  OR a.creation_xmin IS DISTINCT FROM pg_current_xact_id()::text::xid
  OR er.creation_xmin IS DISTINCT FROM pg_current_xact_id()::text::xid
  OR e.recorded_by_user_id IS DISTINCT FROM v.recorded_by_user_id OR e.to_version IS DISTINCT FROM v.from_version
  OR h.early_closure_id IS DISTINCT FROM e.id OR h.finish_id IS NOT NULL OR h.external_entry_id IS NOT NULL
  OR a.action IS DISTINCT FROM 'case.closure.recorded' OR a.actor_kind::text IS DISTINCT FROM 'HUMAN'
  OR a.actor_user_id IS DISTINCT FROM v.recorded_by_user_id OR a.internal_actor_user_id IS DISTINCT FROM v.recorded_by_user_id
  OR a.department_id IS DISTINCT FROM v.department_id OR a.resource_type IS DISTINCT FROM 'CASE' OR a.resource_id IS DISTINCT FROM v.case_id
  OR a.customer_account_binding_id IS NOT NULL OR a.lawyer_account_binding_id IS NOT NULL OR a.notary_office_account_binding_id IS NOT NULL
  OR a.details->>'closureId' IS DISTINCT FROM v.closure_id::text OR a.details->>'closureVersionId' IS DISTINCT FROM v.id::text
  OR a.details->>'fromVersion' IS DISTINCT FROM v.from_version::text OR a.details->>'toVersion' IS DISTINCT FROM v.to_version::text
  OR NOT EXISTS (SELECT 1 FROM public.audit_events source JOIN public.user_accounts u ON u.id=v.recorded_by_user_id
   WHERE source.id=e.audit_event_id AND source.xmin=pg_current_xact_id()::text::xid
    AND source.action='case.early_closed' AND source.actor_kind::text='HUMAN'
    AND source.actor_user_id=v.recorded_by_user_id AND source.internal_actor_user_id=v.recorded_by_user_id
    AND source.department_id=v.department_id AND source.resource_type='CASE' AND source.resource_id=v.case_id
    AND source.customer_account_binding_id IS NULL AND source.lawyer_account_binding_id IS NULL AND source.notary_office_account_binding_id IS NULL
    AND source.details->'authorizationRevision'=to_jsonb(u.authorization_revision)) THEN RETURN false; END IF;
 IF NOT final_check THEN
  RETURN c.version=v.from_version AND h.current_version_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.case_closure_versions existing WHERE existing.closure_id=v.closure_id);
 END IF;
 IF c.version IS DISTINCT FROM v.to_version OR h.current_version_id IS DISTINCT FROM v.id
  OR NOT EXISTS (SELECT 1 FROM public.case_closure_versions installed WHERE installed.id=v.id
   AND installed.xmin=pg_current_xact_id()::text::xid AND to_jsonb(installed)=to_jsonb(v))
  OR NOT EXISTS (SELECT 1 FROM public.case_closure_receipts receipt WHERE receipt.case_id=v.case_id
   AND receipt.department_id=v.department_id AND receipt.actor_user_id=v.recorded_by_user_id AND receipt.command='RECORD'
   AND receipt.idempotency_key=er.idempotency_key AND receipt.request_fingerprint=er.request_fingerprint
   AND receipt.xmin=pg_current_xact_id()::text::xid AND receipt.result_snapshot->>'closureVersionId'=v.id::text
   AND receipt.result_snapshot->>'stage'='WAITING_ARCHIVE' AND receipt.result_snapshot->>'version'=v.to_version::text) THEN RETURN false; END IF;
 before_register:=c; before_register.version:=v.from_version;
 RETURN public.case_early_closure_register_transition(before_register,c) IS TRUE;
END;
$initial$;
-- Provisional evidence freeze occurs before payment/closure receipts are appended.
-- Admit only this transaction's first payment of its real initial early REGISTER.
-- Existing3034 deferred actor/receipt/document guards remain responsible for complete commit proof.
CREATE FUNCTION public.case_early_closure_initial_payment_reference_authorized(target_payment uuid,target_case uuid,target_department uuid,target_actor uuid)
RETURNS boolean LANGUAGE sql STABLE AS $payment_reference$
 SELECT EXISTS (
  SELECT 1 FROM public.case_closure_payment_versions p
  JOIN public.case_closure_versions v ON v.id=p.closure_version_id AND v.case_id=p.case_id AND v.department_id=p.department_id
  JOIN public.case_early_closures e ON e.id=v.early_closure_id AND e.case_id=p.case_id AND e.department_id=p.department_id
  JOIN public.case_closures h ON h.id=v.closure_id AND h.early_closure_id=e.id AND h.case_id=p.case_id AND h.department_id=p.department_id
  JOIN public.cases c ON c.id=p.case_id AND c.department_id=p.department_id
  JOIN public.audit_events a ON a.id=p.audit_event_id
  JOIN public.audit_events closure_audit ON closure_audit.id=v.audit_event_id
  JOIN public.audit_events source_audit ON source_audit.id=e.audit_event_id
  JOIN public.case_early_closure_receipts er ON er.early_closure_id=e.id AND er.case_id=p.case_id
   AND er.department_id=p.department_id AND er.actor_user_id=target_actor
  JOIN public.user_accounts u ON u.id=target_actor
  WHERE p.id=target_payment AND p.case_id=target_case AND p.department_id=target_department
   AND p.recorded_by_user_id=target_actor AND p.revision=1 AND p.payment_id=p.id AND p.state='ACTIVE' AND p.prior_version_id IS NULL
   AND p.xmin=pg_current_xact_id()::text::xid AND v.xmin=pg_current_xact_id()::text::xid
   AND e.xmin=pg_current_xact_id()::text::xid AND h.xmin=pg_current_xact_id()::text::xid
   AND er.xmin=pg_current_xact_id()::text::xid AND a.xmin=pg_current_xact_id()::text::xid
   AND source_audit.xmin=pg_current_xact_id()::text::xid AND closure_audit.xmin=pg_current_xact_id()::text::xid
   AND v.kind='REGISTER' AND v.prior_version_id IS NULL AND v.finish_id IS NULL AND v.external_entry_id IS NULL
   AND h.finish_id IS NULL AND h.external_entry_id IS NULL AND h.current_version_id=v.id
   AND e.recorded_by_user_id=target_actor AND v.recorded_by_user_id=target_actor
   AND e.to_version=v.from_version AND v.to_version=v.from_version+1
   AND c.stage='WAITING_ARCHIVE' AND c.version=v.to_version AND c.responsible_user_id=target_actor
   AND public.case_early_closure_action_authorized(target_actor,target_case,target_department) IS TRUE
   AND a.action='CASE_CLOSURE_PAYMENT_RECORD' AND a.actor_kind::text='HUMAN'
   AND a.actor_user_id=target_actor AND a.internal_actor_user_id=target_actor AND a.department_id=target_department
   AND a.resource_type='CASE_CLOSURE_PAYMENT_VERSION' AND a.resource_id=p.id
   AND a.customer_account_binding_id IS NULL AND a.lawyer_account_binding_id IS NULL AND a.notary_office_account_binding_id IS NULL
   AND jsonb_typeof(a.details->'authorizationRevision')='number' AND a.details->'authorizationRevision'=to_jsonb(u.authorization_revision)
   AND a.details->>'caseId'=target_case::text AND a.details->>'closureVersionId'=v.id::text
   AND a.details->>'paymentVersionId'=p.id::text AND a.details->>'fingerprint'=er.request_fingerprint
   AND source_audit.action='case.early_closed' AND source_audit.actor_kind::text='HUMAN'
   AND source_audit.actor_user_id=target_actor AND source_audit.internal_actor_user_id=target_actor AND source_audit.department_id=target_department
   AND source_audit.resource_type='CASE' AND source_audit.resource_id=target_case
   AND source_audit.customer_account_binding_id IS NULL AND source_audit.lawyer_account_binding_id IS NULL AND source_audit.notary_office_account_binding_id IS NULL
   AND jsonb_typeof(source_audit.details->'authorizationRevision')='number' AND source_audit.details->'authorizationRevision'=to_jsonb(u.authorization_revision)
   AND source_audit.details->>'requestFingerprint'=er.request_fingerprint
   AND closure_audit.action='case.closure.recorded' AND closure_audit.actor_kind::text='HUMAN'
   AND closure_audit.actor_user_id=target_actor AND closure_audit.internal_actor_user_id=target_actor AND closure_audit.department_id=target_department
   AND closure_audit.resource_type='CASE' AND closure_audit.resource_id=target_case
   AND closure_audit.customer_account_binding_id IS NULL AND closure_audit.lawyer_account_binding_id IS NULL AND closure_audit.notary_office_account_binding_id IS NULL
   AND closure_audit.details->>'closureId'=h.id::text AND closure_audit.details->>'closureVersionId'=v.id::text
   AND closure_audit.details->>'fromVersion'=v.from_version::text AND closure_audit.details->>'toVersion'=v.to_version::text
 );
$payment_reference$;
CREATE OR REPLACE FUNCTION case_early_closure_upload_authorized(target_actor uuid,target_case uuid,target_department uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (SELECT 1 FROM "cases" c JOIN "user_accounts" u
  ON u."id"=target_actor AND u."active" AND u."account_type"='INTERNAL'
  JOIN "department_memberships" m ON m."user_id"=u."id" AND m."department_id"=c."department_id" AND m."active"
  WHERE c."id"=target_case AND c."department_id"=target_department AND c."responsible_user_id"=target_actor
  AND c."stage" IN ('PENDING_MATCH', 'WAITING_COMPLAINT', 'WAITING_COMPLAINT_CONFIRMATION', 'WAITING_COMPLAINT_STAMP', 'WAITING_FILING', 'WAITING_FORMAL_ACCEPTANCE', 'WAITING_HEARING', 'WAITING_JUDGMENT', 'SECOND_INSTANCE', 'WAITING_EXECUTION_DOCUMENTS', 'WAITING_EXECUTION_CONFIRMATION', 'WAITING_EXECUTION_STAMP', 'WAITING_EXECUTION_FILING', 'EXECUTING')
  AND NOT EXISTS (SELECT 1 FROM "case_closures" h WHERE h."case_id"=c."id" AND h."department_id"=c."department_id")
  AND NOT EXISTS (SELECT 1 FROM "case_early_closures" e WHERE e."case_id"=c."id" AND e."department_id"=c."department_id")
  AND NOT EXISTS (SELECT 1 FROM "case_early_archives" e WHERE e."case_id"=c."id" AND e."department_id"=c."department_id")
  AND public.case_early_closure_action_authorized(target_actor,target_case,target_department));
$$;

CREATE OR REPLACE FUNCTION guard_early_closure_actor_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u user_accounts%ROWTYPE; member department_memberships%ROWTYPE; c cases%ROWTYPE; role_id uuid;
BEGIN
 IF current_setting('transaction_isolation') <> 'serializable' THEN
  RAISE EXCEPTION 'early closure authorization requires serializable transaction' USING ERRCODE='23514';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('organization:'||NEW.department_id::text,0)) THEN
  RAISE EXCEPTION 'early closure authorization facts busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO u FROM user_accounts WHERE id=NEW.recorded_by_user_id FOR SHARE NOWAIT;
 SELECT * INTO member FROM department_memberships WHERE user_id=NEW.recorded_by_user_id
  AND department_id=NEW.department_id FOR SHARE NOWAIT;
 PERFORM id FROM role_assignments WHERE user_id=NEW.recorded_by_user_id AND department_id=NEW.department_id ORDER BY id FOR SHARE NOWAIT;
 FOR role_id IN SELECT DISTINCT role_template_id FROM role_assignments
  WHERE user_id=NEW.recorded_by_user_id AND department_id=NEW.department_id ORDER BY role_template_id LOOP
  PERFORM id FROM role_templates WHERE id=role_id FOR SHARE NOWAIT;
  PERFORM id FROM role_grants WHERE role_template_id=role_id ORDER BY id FOR SHARE NOWAIT;
 END LOOP;
 PERFORM t.id FROM teams t WHERE t.id=member.team_id OR t.id IN
  (SELECT team_id FROM role_assignments WHERE user_id=NEW.recorded_by_user_id AND department_id=NEW.department_id)
  ORDER BY t.id FOR SHARE NOWAIT;
 SELECT * INTO c FROM cases WHERE id=NEW.case_id AND department_id=NEW.department_id FOR UPDATE NOWAIT;
 IF u.id IS NULL OR u.active IS NOT TRUE OR u.account_type <> 'INTERNAL'
  OR member.user_id IS NULL OR member.active IS NOT TRUE
  OR c.id IS NULL OR c.responsible_user_id IS DISTINCT FROM NEW.recorded_by_user_id
  OR case_record_edit_actor_authorized(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id,'case.read') IS NOT TRUE
  OR public.case_early_closure_action_authorized(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id) IS NOT TRUE
 THEN RAISE EXCEPTION 'early closure actor unauthorized' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION check_early_closure_initial_payment_actor_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v record; e record; c cases; source_case cases; waiting_case cases; final_case cases;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'payment history is immutable' USING ERRCODE='23514'; END IF;
 SELECT *,xmin AS creation_xmin INTO v FROM case_closure_versions WHERE id=NEW.closure_version_id
  AND case_id=NEW.case_id AND department_id=NEW.department_id;
 -- Later independent payments keep the unchanged 2400 authorization branch.
 IF v.id IS NULL OR v.early_closure_id IS NULL OR v.kind<>'REGISTER'
  OR v.creation_xmin IS DISTINCT FROM pg_current_xact_id()::text::xid THEN RETURN NEW; END IF;
 PERFORM assert_case_financial_actor_draft(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id,
  NEW.audit_event_id,NEW.id,'CASE_CLOSURE_PAYMENT_VERSION','CASE_CLOSURE_PAYMENT_RECORD',ARRAY['WAITING_ARCHIVE']);
 SELECT * INTO c FROM cases WHERE id=NEW.case_id AND department_id=NEW.department_id FOR UPDATE;
 SELECT *,xmin AS creation_xmin INTO e FROM case_early_closures WHERE id=v.early_closure_id
  AND case_id=NEW.case_id AND department_id=NEW.department_id;
 IF e.id IS NULL OR e.creation_xmin IS DISTINCT FROM pg_current_xact_id()::text::xid
  OR NEW.revision<>1 OR NEW.state<>'ACTIVE' OR NEW.prior_version_id IS NOT NULL
  OR NEW.recorded_by_user_id IS DISTINCT FROM e.recorded_by_user_id
  OR v.recorded_by_user_id IS DISTINCT FROM e.recorded_by_user_id
  OR v.from_version IS DISTINCT FROM e.to_version OR v.to_version IS DISTINCT FROM e.to_version+1
  OR c.stage<>'WAITING_ARCHIVE' OR c.version IS DISTINCT FROM v.to_version
  OR public.case_early_closure_action_authorized(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id) IS NOT TRUE
  OR NOT EXISTS (SELECT 1 FROM case_closures h WHERE h.id=v.closure_id AND h.case_id=NEW.case_id
    AND h.department_id=NEW.department_id AND h.early_closure_id=e.id AND h.current_version_id=v.id
    AND h.xmin=pg_current_xact_id()::text::xid)
  OR NOT EXISTS (SELECT 1 FROM audit_events a WHERE a.id=NEW.audit_event_id AND a.xmin=pg_current_xact_id()::text::xid)
 THEN RAISE EXCEPTION 'initial payment requires exact early closure actor and transaction' USING ERRCODE='23514'; END IF;
 IF TG_WHEN='AFTER' THEN
  source_case:=c; source_case.stage:=e.from_stage; source_case.version:=e.from_version;
  waiting_case:=c; waiting_case.version:=e.to_version;
  final_case:=c;
  -- Existing predicates preserve the allowed source stages and exact source/
  -- closure audits, receipts, fingerprints, versions and historical branches.
  IF case_early_closure_transition(source_case,waiting_case) IS NOT TRUE
   OR case_early_closure_register_transition(waiting_case,final_case) IS NOT TRUE
   OR NOT EXISTS (SELECT 1 FROM case_closure_payment_receipts r JOIN case_early_closure_receipts er
     ON er.early_closure_id=e.id AND er.case_id=NEW.case_id AND er.department_id=NEW.department_id
     AND er.actor_user_id=NEW.recorded_by_user_id
     WHERE r.payment_version_id=NEW.id AND r.case_id=NEW.case_id AND r.department_id=NEW.department_id
      AND r.actor_user_id=NEW.recorded_by_user_id AND r.audit_event_id=NEW.audit_event_id
      AND r.request_fingerprint=er.request_fingerprint
      AND r.xmin=pg_current_xact_id()::text::xid AND er.xmin=pg_current_xact_id()::text::xid)
  THEN RAISE EXCEPTION 'initial payment requires complete atomic early closure receipts' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION check_case_closure_actor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record;
BEGIN
 SELECT * INTO c FROM cases WHERE id=NEW.case_id AND department_id=NEW.department_id FOR UPDATE;
 IF c.id IS NULL OR c.stage<>'WAITING_ARCHIVE' OR c.version<>NEW.from_version
  OR NEW.close_at>(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date THEN
  RAISE EXCEPTION 'closure actor forbidden' USING ERRCODE='23514';
 END IF;
 IF public.case_early_closure_initial_version_authorized(NEW,false) IS TRUE THEN RETURN NEW; END IF;
 IF case_closure_actor_authorized(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id,NEW.kind='CORRECT') THEN
  RETURN NEW;
 END IF;
 IF NEW.kind<>'CORRECT' THEN
  RAISE EXCEPTION 'closure actor forbidden' USING ERRCODE='23514';
 END IF;
 -- Only provisional admission. The deferred trigger below requires the exact
 -- composed receipt before commit; ordinary correction/upload grants stay intact.
 PERFORM assert_case_financial_actor_draft(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id,
  NEW.audit_event_id,NEW.case_id,'CASE','case.closure.corrected',ARRAY['WAITING_ARCHIVE']);
 IF EXISTS(SELECT 1 FROM case_consolidation_members WHERE case_id=NEW.case_id AND NOT is_main) THEN
  RAISE EXCEPTION 'settlement update requires main case' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION check_settlement_update_default_actor_final_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF public.case_early_closure_initial_version_authorized(NEW,true) IS TRUE THEN RETURN NEW; END IF;
 IF case_closure_actor_authorized(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id,NEW.kind='CORRECT') THEN
  RETURN NEW;
 END IF;
 PERFORM assert_case_financial_actor_draft(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id,
  NEW.audit_event_id,NEW.case_id,'CASE','case.closure.corrected',ARRAY['WAITING_ARCHIVE']);
 IF NEW.kind<>'CORRECT' OR NOT EXISTS (
  SELECT 1 FROM case_closure_settlement_update_receipts r
  WHERE r.closure_version_id=NEW.id AND r.closure_audit_event_id=NEW.audit_event_id
   AND r.case_id=NEW.case_id AND r.department_id=NEW.department_id
   AND r.actor_user_id=NEW.recorded_by_user_id
   AND r.xmin=pg_current_xact_id()::text::xid
 ) THEN
  RAISE EXCEPTION 'default closure actor requires atomic settlement update receipt' USING ERRCODE='23514';
 END IF;
 -- Existing receipt final guard (2700) independently checks all child facts,
 -- exact same-transaction closure/audit, version chain and amount provenance.
 RETURN NEW;
END; $$;

-- Both ordinary closure authorization and the existing complete register-transition proof stay exact.
DO $after$
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.case_closure_actor_authorized(uuid,uuid,uuid,boolean)'::regprocedure)
   IS DISTINCT FROM 'e1443b704c22b7c2cd425dbfa44a1a9a'
  OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.case_early_closure_register_transition(public.cases,public.cases)'::regprocedure)
   IS DISTINCT FROM 'c3595fa620a8070c6f41fea9f91d1443' THEN
  RAISE EXCEPTION '269 changed an ordinary authorization or complete transition predicate' USING ERRCODE='23514'; END IF;
END;
$after$;
COMMIT;
