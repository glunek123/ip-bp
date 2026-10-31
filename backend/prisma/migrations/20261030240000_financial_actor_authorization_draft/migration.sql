-- DRAFT ONLY. No gates are removed, no accounts/grants are changed.
-- Independent financial commands only. Early-closure initial payment needs its
-- own transition authorization; do not reuse this pending/archive-stage guard.
-- Before enabling: adapters must bind their authenticated actor revision into
-- audit.details.authorizationRevision (a JSON integer). Missing context fails closed.
BEGIN;
CREATE FUNCTION assert_case_financial_actor_draft(
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
  OR c.id IS NULL OR c.responsible_user_id IS DISTINCT FROM target_actor
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

CREATE FUNCTION guard_case_financial_actor_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_action text; expected_resource text; allowed text[];
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'financial history is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='case_closure_payment_versions' THEN
  expected_resource := 'CASE_CLOSURE_PAYMENT_VERSION';
  expected_action := CASE WHEN NEW.revision=1 THEN 'CASE_CLOSURE_PAYMENT_RECORD'
   WHEN NEW.state='VOID' THEN 'CASE_CLOSURE_PAYMENT_VOID' ELSE 'CASE_CLOSURE_PAYMENT_CORRECT' END;
  allowed := ARRAY['WAITING_ARCHIVE','ARCHIVED'];
 ELSIF TG_TABLE_NAME='case_refund_inventory_versions' THEN
  expected_resource := 'CASE_REFUND_INVENTORY_VERSION';
  SELECT CASE WHEN NEW.declaration='UNKNOWN' OR (NEW.declaration='COMPLETE' AND EXISTS (
   SELECT 1 FROM case_refund_inventory_versions p WHERE p.id=NEW.prior_version_id AND p.declaration='COMPLETE'))
   THEN 'CASE_REFUND_INVENTORY_RECORD' ELSE 'CASE_REFUND_INVENTORY_CONFIRM' END INTO expected_action;
  allowed := ARRAY['WAITING_ARCHIVE'];
 ELSIF TG_TABLE_NAME='case_settlement_assessment_versions' THEN
  expected_resource := 'CASE_SETTLEMENT_ASSESSMENT_VERSION';
  expected_action := 'CASE_SETTLEMENT_ASSESSMENT_RECORD';
  allowed := ARRAY['WAITING_ARCHIVE','ARCHIVED'];
 ELSE RAISE EXCEPTION 'unsupported financial authorization target' USING ERRCODE='23514'; END IF;
 PERFORM assert_case_financial_actor_draft(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id,
  NEW.audit_event_id,NEW.id,expected_resource,expected_action,allowed);
 IF NOT EXISTS (SELECT 1 FROM case_closures h JOIN case_closure_versions v
  ON v.id=h.current_version_id AND v.closure_id=h.id
   AND v.case_id=h.case_id AND v.department_id=h.department_id
  WHERE h.case_id=NEW.case_id AND h.department_id=NEW.department_id
   AND (TG_TABLE_NAME='case_refund_inventory_versions'
    OR v.id::text=to_jsonb(NEW)->>'closure_version_id')) THEN
  RAISE EXCEPTION 'financial write requires exact current same-case closure' USING ERRCODE='23514';
 END IF;
 -- Existing version-chain, current closure, audit declaration, item, screenshot
 -- and immutable guards remain independent. This function certifies no money.
 RETURN NEW;
END; $$;
CREATE TRIGGER case_closure_payment_actor_draft_guard BEFORE INSERT OR UPDATE OR DELETE
 ON case_closure_payment_versions FOR EACH ROW EXECUTE FUNCTION guard_case_financial_actor_draft();
CREATE TRIGGER case_refund_inventory_actor_draft_guard BEFORE INSERT OR UPDATE OR DELETE
 ON case_refund_inventory_versions FOR EACH ROW EXECUTE FUNCTION guard_case_financial_actor_draft();
CREATE TRIGGER case_settlement_assessment_actor_draft_guard BEFORE INSERT OR UPDATE OR DELETE
 ON case_settlement_assessment_versions FOR EACH ROW EXECUTE FUNCTION guard_case_financial_actor_draft();
COMMIT;
