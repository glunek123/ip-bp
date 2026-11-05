-- Extend only the existing case ownership gates needed for explicitly granted
-- department proxy actions. Historical migrations and global scope calculations remain intact.
BEGIN;
CREATE FUNCTION public.case_department_proxy_action_authorized(
 target_actor uuid,target_case uuid,target_department uuid,target_action permission_action
) RETURNS boolean LANGUAGE sql STABLE AS $proxy$
 SELECT target_action IN ('case.routine.edit','case.closure.settlement.update','case.closure.record','case.archive')
  AND EXISTS (
   SELECT 1 FROM public.cases c
   JOIN public.user_accounts u ON u.id=target_actor AND u.active AND u.account_type='INTERNAL'
   JOIN public.department_memberships m ON m.user_id=u.id AND m.department_id=c.department_id AND m.active
   JOIN public.role_assignments r ON r.user_id=u.id AND r.department_id=c.department_id AND r.active
   JOIN public.role_templates t ON t.id=r.role_template_id AND t.department_id=r.department_id AND t.active
   JOIN public.role_grants g ON g.role_template_id=t.id AND g.action=target_action AND g.scope='DEPARTMENT'
   WHERE c.id=target_case AND c.department_id=target_department
  );
$proxy$;

CREATE OR REPLACE FUNCTION public.case_early_closure_action_authorized(target_actor uuid,target_case uuid,target_department uuid)
RETURNS boolean LANGUAGE sql STABLE AS $action$
 SELECT EXISTS (
  SELECT 1 FROM public.cases c JOIN public.user_accounts u
   ON u.id=target_actor AND u.active AND u.account_type='INTERNAL'
  JOIN public.department_memberships member ON member.user_id=u.id AND member.department_id=c.department_id AND member.active
  WHERE c.id=target_case AND c.department_id=target_department AND (c.responsible_user_id=target_actor
    OR public.case_department_proxy_action_authorized(target_actor,target_case,target_department,'case.closure.record')
    OR public.case_department_proxy_action_authorized(target_actor,target_case,target_department,'case.archive'))
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

CREATE OR REPLACE FUNCTION public.case_early_closure_initial_version_authorized(v public.case_closure_versions,final_check boolean)
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
 IF c.id IS NULL OR c.stage IS DISTINCT FROM 'WAITING_ARCHIVE'
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

CREATE OR REPLACE FUNCTION public.case_early_closure_initial_payment_reference_authorized(target_payment uuid,target_case uuid,target_department uuid,target_actor uuid)
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
   AND c.stage='WAITING_ARCHIVE' AND c.version=v.to_version
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
  WHERE c."id"=target_case AND c."department_id"=target_department
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
  OR c.id IS NULL
  OR case_record_edit_actor_authorized(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id,'case.read') IS NOT TRUE
  OR public.case_early_closure_action_authorized(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id) IS NOT TRUE
 THEN RAISE EXCEPTION 'early closure actor unauthorized' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION assert_case_financial_actor_draft(
 target_actor uuid,target_case uuid,target_department uuid,target_audit uuid,
 target_version uuid,target_resource text,target_action text,allowed_stages text[]
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE u user_accounts%ROWTYPE; c cases%ROWTYPE; a audit_events%ROWTYPE;
 member department_memberships%ROWTYPE; role_id uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'financial authorization requires serializable transaction' USING ERRCODE='23514';
 END IF;
 -- Match organization.lockDepartment. Try/NOWAIT avoids waiting on a reverse
 -- case -> organization path from older guards. Callers should acquire this
 -- order BEFORE any case/source rows: organization, actor, membership,
 -- assignments (id), templates/grants (id), teams (id), cases (id), sources.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('organization:'||target_department::text,0)) THEN
  RAISE EXCEPTION 'financial authorization facts busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO u FROM user_accounts WHERE id=target_actor FOR SHARE NOWAIT;
 SELECT * INTO member FROM department_memberships
  WHERE user_id=target_actor AND department_id=target_department FOR SHARE NOWAIT;
 PERFORM id FROM role_assignments WHERE user_id=target_actor AND department_id=target_department
  ORDER BY id FOR SHARE NOWAIT;
 FOR role_id IN SELECT DISTINCT role_template_id FROM role_assignments
  WHERE user_id=target_actor AND department_id=target_department ORDER BY role_template_id LOOP
  PERFORM id FROM role_templates WHERE id=role_id FOR SHARE NOWAIT;
  PERFORM id FROM role_grants WHERE role_template_id=role_id ORDER BY id FOR SHARE NOWAIT;
 END LOOP;
 PERFORM t.id FROM teams t WHERE t.id=member.team_id OR t.id IN
  (SELECT team_id FROM role_assignments WHERE user_id=target_actor AND department_id=target_department)
  ORDER BY t.id FOR SHARE NOWAIT;
 SELECT * INTO c FROM cases WHERE id=target_case AND department_id=target_department FOR UPDATE NOWAIT;
 SELECT * INTO a FROM audit_events WHERE id=target_audit FOR SHARE NOWAIT;
 IF u.id IS NULL OR u.active IS NOT TRUE OR u.account_type<>'INTERNAL'
  OR member.user_id IS NULL OR member.active IS NOT TRUE
  OR c.id IS NULL OR NOT (c.responsible_user_id=target_actor
    OR (target_action IN ('CASE_CLOSURE_PAYMENT_RECORD','CASE_REFUND_INVENTORY_RECORD',
      'CASE_REFUND_INVENTORY_CONFIRM','CASE_SETTLEMENT_ASSESSMENT_RECORD',
      'case.closure.corrected','case.closure.settlement_amounts.updated')
     AND public.case_department_proxy_action_authorized(target_actor,target_case,target_department,'case.closure.settlement.update'))
    OR (target_action='CASE_CLOSURE_PAYMENT_RECORD'
     AND public.case_early_closure_action_authorized(target_actor,target_case,target_department)
     AND EXISTS (SELECT 1 FROM public.case_early_closures e WHERE e.case_id=target_case
       AND e.department_id=target_department AND e.recorded_by_user_id=target_actor
       AND e.xmin=pg_current_xact_id()::text::xid)))
  OR NOT (c.stage::text=ANY(allowed_stages))
  OR a.id IS NULL OR a.department_id IS DISTINCT FROM target_department
  OR a.actor_kind::text IS DISTINCT FROM 'HUMAN'
  OR a.actor_user_id IS DISTINCT FROM target_actor OR a.internal_actor_user_id IS DISTINCT FROM target_actor
  OR a.resource_type IS DISTINCT FROM target_resource OR a.resource_id IS DISTINCT FROM target_version
  OR a.action IS DISTINCT FROM target_action
  OR a.customer_account_binding_id IS NOT NULL OR a.lawyer_account_binding_id IS NOT NULL
  OR a.notary_office_account_binding_id IS NOT NULL
  OR jsonb_typeof(a.details->'authorizationRevision') IS DISTINCT FROM 'number'
  OR a.details->'authorizationRevision' IS DISTINCT FROM to_jsonb(u.authorization_revision)
  OR case_record_edit_actor_authorized(target_actor,target_case,target_department,'case.read') IS NOT TRUE
  OR NOT EXISTS (
   SELECT 1 FROM role_assignments r JOIN role_templates t ON t.id=r.role_template_id
    AND t.department_id=r.department_id AND t.active
   JOIN role_grants g ON g.role_template_id=t.id AND g.action='case.read'
   WHERE r.user_id=target_actor AND r.department_id=target_department AND r.active
    AND (g.scope IN ('DEPARTMENT','SELF') OR (g.scope='TEAM' AND r.team_id=member.team_id
      AND EXISTS (SELECT 1 FROM teams team WHERE team.id=r.team_id
       AND team.department_id=target_department AND team.status='ACTIVE')))
  ) THEN
  RAISE EXCEPTION 'financial actor unauthorized or stale' USING ERRCODE='23514';
 END IF;
END; $$;

CREATE OR REPLACE FUNCTION case_payment_proof_upload_eligible(target_actor uuid,target_case uuid,target_department uuid)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE c cases%ROWTYPE; h case_closures%ROWTYPE;
BEGIN
 SELECT * INTO c FROM cases WHERE id=target_case AND department_id=target_department;
 IF c.id IS NULL OR NOT (c.responsible_user_id=target_actor
   OR public.case_department_proxy_action_authorized(target_actor,target_case,target_department,'case.closure.settlement.update')
   OR case_early_closure_upload_authorized(target_actor,target_case,target_department)) OR NOT EXISTS (
  SELECT 1 FROM user_accounts u JOIN department_memberships m ON m.user_id=u.id
  WHERE u.id=target_actor AND u.active AND u.account_type='INTERNAL' AND m.active AND m.department_id=target_department
 ) OR case_record_edit_actor_authorized(target_actor,target_case,target_department,'case.read') IS NOT TRUE THEN RETURN false; END IF;
 IF case_early_closure_upload_authorized(target_actor,target_case,target_department) IS TRUE THEN RETURN true; END IF;
 IF c.stage NOT IN ('WAITING_ARCHIVE','ARCHIVED') THEN RETURN false; END IF;
 SELECT * INTO h FROM case_closures WHERE case_id=c.id AND department_id=c.department_id;
 IF h.id IS NULL OR h.current_version_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM case_closure_versions v WHERE v.id=h.current_version_id AND v.closure_id=h.id
   AND v.case_id=c.id AND v.department_id=c.department_id
 ) THEN RETURN false; END IF;
 IF c.stage='ARCHIVED' AND NOT EXISTS (
  SELECT 1 FROM case_archives a WHERE a.case_id=c.id AND a.department_id=c.department_id
   AND a.closure_id=h.id AND a.closure_version_id=h.current_version_id AND a.current_version_id IS NOT NULL
 ) THEN RETURN false; END IF;
 -- Own-case internal handling uses the existing case.read operational grant.
 -- This is file eligibility only: payment correction still needs its locked command authorization.
 RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION settlement_update_document_upload_eligible(target_actor uuid,target_case uuid,target_department uuid,target_closure uuid,target_revision integer)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE c record; h record; e record; f record; source_version integer;
BEGIN
 SELECT * INTO c FROM cases WHERE id=target_case AND department_id=target_department;
 SELECT * INTO h FROM case_closures WHERE case_id=target_case AND department_id=target_department;
 IF c.id IS NULL OR c.stage<>'WAITING_ARCHIVE' OR NOT (c.responsible_user_id=target_actor
   OR public.case_department_proxy_action_authorized(target_actor,target_case,target_department,'case.closure.settlement.update'))
  OR h.id IS NULL OR h.current_version_id IS DISTINCT FROM target_closure
  OR NOT EXISTS(SELECT 1 FROM user_accounts u JOIN department_memberships m ON m.user_id=u.id
   WHERE u.id=target_actor AND u.active AND u.account_type='INTERNAL' AND u.authorization_revision=target_revision AND m.active AND m.department_id=target_department)
  OR NOT EXISTS(SELECT 1 FROM role_assignments r JOIN role_templates template ON template.id=r.role_template_id AND template.department_id=r.department_id AND template.active
   JOIN role_grants g ON g.role_template_id=template.id AND g.action='case.read'
   JOIN department_memberships membership ON membership.user_id=r.user_id AND membership.department_id=r.department_id AND membership.active
   WHERE r.user_id=target_actor AND r.department_id=target_department AND r.active
    AND (g.scope IN ('SELF','DEPARTMENT') OR (g.scope='TEAM' AND r.team_id=membership.team_id AND EXISTS(
     SELECT 1 FROM teams team WHERE team.id=r.team_id AND team.department_id=target_department AND team.status='ACTIVE'))))
  OR case_record_edit_actor_authorized(target_actor,target_case,target_department,'case.read') IS NOT TRUE THEN RETURN false; END IF;
 IF h.early_closure_id IS NOT NULL THEN
  SELECT * INTO e FROM case_early_closures WHERE id=h.early_closure_id AND case_id=target_case AND department_id=target_department;
  IF e.id IS NULL OR h.finish_id IS NOT NULL OR h.external_entry_id IS NOT NULL THEN RETURN false; END IF;
  source_version:=e.to_version;
 ELSIF h.finish_id IS NOT NULL THEN
  SELECT * INTO f FROM case_execution_finishes WHERE id=h.finish_id AND case_id=target_case AND department_id=target_department;
  IF f.id IS NULL THEN RETURN false; END IF; source_version:=f.to_version;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM case_external_entries root WHERE root.id=h.external_entry_id AND root.case_id=target_case
   AND root.department_id=target_department AND root.initial_stage='WAITING_ARCHIVE') OR
   c.source_lead_id IS NOT NULL OR c.source_notary_matter_id IS NOT NULL OR c.certificate_id IS NOT NULL THEN RETURN false; END IF;
  source_version:=1;
 END IF;
 RETURN case_closure_source_terminal_version(target_case,target_department,h.finish_id,source_version)=c.version;
END; $$;
COMMIT;
