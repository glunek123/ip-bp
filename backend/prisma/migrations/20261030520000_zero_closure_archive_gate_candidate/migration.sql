-- Forward candidate; requires independent review and isolated database acceptance.
BEGIN;
DO $verify$ DECLARE f oid; body text; BEGIN
SELECT p.oid,p.prosrc INTO f,body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname=current_schema() AND p.proname='case_early_closure_structure_guard' AND p.pronargs=0 AND p.prorettype='trigger'::regtype AND l.lanname='plpgsql' AND NOT p.prosecdef;
IF f IS NULL OR replace(body,E'\r\n',E'\n') IS DISTINCT FROM replace($body$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'early closure source is not enabled' USING ERRCODE = '23514';
  END IF;
  RAISE EXCEPTION 'early closure source is immutable' USING ERRCODE = '23514';
END; $body$,E'\r\n',E'\n') THEN RAISE EXCEPTION 'unexpected function case_early_closure_structure_guard'; END IF;
SELECT p.oid,p.prosrc INTO f,body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname=current_schema() AND p.proname='guard_case_closure_payment_type_draft' AND p.pronargs=0 AND p.prorettype='trigger'::regtype AND l.lanname='plpgsql' AND NOT p.prosecdef;
IF f IS NULL OR replace(body,E'\r\n',E'\n') IS DISTINCT FROM replace($body$
BEGIN
 IF NEW."payment_type" IS NOT NULL THEN
  RAISE EXCEPTION 'typed closure payment command is draft and not enabled' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $body$,E'\r\n',E'\n') THEN RAISE EXCEPTION 'unexpected function guard_case_closure_payment_type_draft'; END IF;
SELECT p.oid,p.prosrc INTO f,body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname=current_schema() AND p.proname='check_case_closure_effective_payment_type' AND p.pronargs=0 AND p.prorettype='trigger'::regtype AND l.lanname='plpgsql' AND NOT p.prosecdef;
IF f IS NULL OR replace(body,E'\r\n',E'\n') IS DISTINCT FROM replace($body$
DECLARE target_case uuid; target_department uuid; selected_type text; selected_version uuid; active_count bigint;
BEGIN
 target_case:=NEW."case_id"; target_department:=NEW."department_id";
 PERFORM 1 FROM "cases" WHERE "id"=target_case AND "department_id"=target_department FOR UPDATE;
 SELECT v."payment_type",v."id" INTO selected_type,selected_version
 FROM "case_closures" c JOIN "case_closure_versions" v ON v."id"=c."current_version_id"
 WHERE c."case_id"=target_case AND c."department_id"=target_department;
 IF TG_TABLE_NAME='case_closure_payment_versions' THEN
 IF
  (selected_type IS NULL OR NEW."closure_version_id" IS DISTINCT FROM selected_version) THEN
  RAISE EXCEPTION 'payment requires exact current typed closure version' USING ERRCODE='23514';
 END IF;
 END IF;
 -- History remains unknown only until the first explicit selection. An old
 -- correction command cannot erase a known type by creating a null-typed head.
 IF selected_type IS NULL THEN
  IF EXISTS (SELECT 1 FROM "case_closure_versions" known
   WHERE known."case_id"=target_case AND known."department_id"=target_department
   AND known."payment_type" IS NOT NULL) THEN
   RAISE EXCEPTION 'known payment type cannot become unknown' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'typed payments require serializable transaction' USING ERRCODE='23514';
 END IF;
 SELECT count(*) INTO active_count FROM "case_closure_payment_versions" p
 WHERE p."case_id"=target_case AND p."department_id"=target_department AND p."state"='ACTIVE'
 AND NOT EXISTS (SELECT 1 FROM "case_closure_payment_versions" n WHERE n."prior_version_id"=p."id");
 IF selected_type='ONE_TIME' AND active_count>1 THEN
  RAISE EXCEPTION 'one time payment permits at most one effective payment' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $body$,E'\r\n',E'\n') THEN RAISE EXCEPTION 'unexpected function check_case_closure_effective_payment_type'; END IF;
SELECT p.oid,p.prosrc INTO f,body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname=current_schema() AND p.proname='reject_case_judgment_mutation' AND p.pronargs=0 AND p.prorettype='trigger'::regtype AND l.lanname='plpgsql' AND NOT p.prosecdef;
IF f IS NULL OR replace(body,E'\r\n',E'\n') IS DISTINCT FROM replace($body$
BEGIN
  RAISE EXCEPTION 'judgment fact, version, receipt, or audit is immutable' USING ERRCODE = '23514';
END;
$body$,E'\r\n',E'\n') THEN RAISE EXCEPTION 'unexpected function reject_case_judgment_mutation'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE t.tgrelid='case_early_closures'::regclass AND t.tgname='case_early_closures_structure_guard' AND t.tgtype=31 AND t.tgenabled='O' AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred AND n.nspname=current_schema() AND p.proname='case_early_closure_structure_guard') THEN RAISE EXCEPTION 'unexpected gate case_early_closures.case_early_closures_structure_guard'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE t.tgrelid='case_early_closure_receipts'::regclass AND t.tgname='case_early_closure_receipts_structure_guard' AND t.tgtype=31 AND t.tgenabled='O' AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred AND n.nspname=current_schema() AND p.proname='case_early_closure_structure_guard') THEN RAISE EXCEPTION 'unexpected gate case_early_closure_receipts.case_early_closure_receipts_structure_guard'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE t.tgrelid='case_closure_versions'::regclass AND t.tgname='closure_payment_type_draft_guard' AND t.tgtype=23 AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgdeferrable=false AND t.tginitdeferred=false AND n.nspname=current_schema() AND p.proname='guard_case_closure_payment_type_draft') THEN RAISE EXCEPTION 'unexpected typed payment trigger closure_payment_type_draft_guard'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE t.tgrelid='case_closures'::regclass AND t.tgname='closure_payment_effective_count' AND t.tgtype=21 AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgdeferrable=true AND t.tginitdeferred=true AND n.nspname=current_schema() AND p.proname='check_case_closure_effective_payment_type') THEN RAISE EXCEPTION 'unexpected typed payment trigger closure_payment_effective_count'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE t.tgrelid='case_closure_payment_versions'::regclass AND t.tgname='closure_payment_version_effective_count' AND t.tgtype=5 AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgdeferrable=true AND t.tginitdeferred=true AND n.nspname=current_schema() AND p.proname='check_case_closure_effective_payment_type') THEN RAISE EXCEPTION 'unexpected typed payment trigger closure_payment_version_effective_count'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='case_closure_versions'::regclass AND t.tgname='case_closure_version_immutable' AND t.tgfoid=(SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname='reject_case_judgment_mutation' AND p.pronargs=0) AND t.tgtype=27 AND t.tgenabled='O' AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred) THEN RAISE EXCEPTION 'unexpected closure version immutable trigger'; END IF;
SELECT p.oid,p.prosrc INTO f,body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname=current_schema() AND p.proname='guard_early_closure_actor_draft' AND p.pronargs=0 AND p.prorettype='trigger'::regtype AND l.lanname='plpgsql' AND NOT p.prosecdef;
IF f IS NULL OR replace(body,E'\r\n',E'\n') IS DISTINCT FROM replace($body$
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
  OR case_record_edit_actor_authorized(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id,'case.closure.record') IS NOT TRUE
  OR EXISTS (SELECT 1 FROM (VALUES ('case.read'::permission_action),('case.closure.record'::permission_action)) required(action)
   WHERE NOT EXISTS (SELECT 1 FROM role_assignments r JOIN role_templates t ON t.id=r.role_template_id
    AND t.department_id=r.department_id AND t.active JOIN role_grants g ON g.role_template_id=t.id AND g.action=required.action
    WHERE r.user_id=NEW.recorded_by_user_id AND r.department_id=NEW.department_id AND r.active
     AND (g.scope IN ('DEPARTMENT','SELF') OR (g.scope='TEAM' AND r.team_id=member.team_id
      AND EXISTS (SELECT 1 FROM teams team WHERE team.id=r.team_id AND team.department_id=NEW.department_id AND team.status='ACTIVE')))))
 THEN RAISE EXCEPTION 'early closure actor unauthorized' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $body$,E'\r\n',E'\n') THEN RAISE EXCEPTION 'unexpected guard_early_closure_actor_draft'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='case_early_closures'::regclass AND t.tgname='early_closure_actor_draft_guard' AND t.tgfoid=f AND t.tgtype=7 AND t.tgenabled='O' AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred) THEN RAISE EXCEPTION 'unexpected early_closure_actor_draft_guard'; END IF;
SELECT p.oid,p.prosrc INTO f,body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname=current_schema() AND p.proname='check_early_closure_source_authorization_revision_draft' AND p.pronargs=0 AND p.prorettype='trigger'::regtype AND l.lanname='plpgsql' AND NOT p.prosecdef;
IF f IS NULL OR replace(body,E'\r\n',E'\n') IS DISTINCT FROM replace($body$
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
END; $body$,E'\r\n',E'\n') THEN RAISE EXCEPTION 'unexpected check_early_closure_source_authorization_revision_draft'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='case_early_closures'::regclass AND t.tgname='early_closure_source_authorization_revision_draft' AND t.tgfoid=f AND t.tgtype=7 AND t.tgenabled='O' AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred) THEN RAISE EXCEPTION 'unexpected early_closure_source_authorization_revision_draft'; END IF;
END; $verify$;
DO $verify$ DECLARE f oid; body text; BEGIN
SELECT p.oid,p.prosrc INTO f,body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname=current_schema() AND p.proname='guard_case_archive_snapshot_draft' AND p.pronargs=0 AND p.prorettype='trigger'::regtype AND l.lanname='plpgsql' AND NOT p.prosecdef;
IF f IS NULL OR replace(body,E'\r\n',E'\n') IS DISTINCT FROM replace($body$
BEGIN
 RAISE EXCEPTION 'archive evidence snapshot persistence is draft and not enabled' USING ERRCODE='23514';
END; $body$,E'\r\n',E'\n') THEN RAISE EXCEPTION 'unexpected archive snapshot gate function'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='case_archive_evidence_snapshots'::regclass AND tgname='case_archive_snapshot_draft_gate' AND tgfoid=f AND tgtype=31 AND tgenabled='O' AND NOT tgisinternal AND NOT tgdeferrable AND NOT tginitdeferred) THEN RAISE EXCEPTION 'unexpected case_archive_snapshot_draft_gate'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='case_archive_snapshot_payments'::regclass AND tgname='case_archive_snapshot_payment_draft_gate' AND tgfoid=f AND tgtype=31 AND tgenabled='O' AND NOT tgisinternal AND NOT tgdeferrable AND NOT tginitdeferred) THEN RAISE EXCEPTION 'unexpected case_archive_snapshot_payment_draft_gate'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='case_archive_snapshot_allocations'::regclass AND tgname='case_archive_snapshot_allocation_draft_gate' AND tgfoid=f AND tgtype=31 AND tgenabled='O' AND NOT tgisinternal AND NOT tgdeferrable AND NOT tginitdeferred) THEN RAISE EXCEPTION 'unexpected case_archive_snapshot_allocation_draft_gate'; END IF;
END; $verify$;
CREATE FUNCTION guard_early_zero_source_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'early closure source is immutable' USING ERRCODE='23514'; END IF; IF TG_RELID='case_early_closure_receipts'::regclass THEN IF NOT EXISTS(SELECT 1 FROM case_early_closures e WHERE e.id=NEW.early_closure_id AND e.case_id=NEW.case_id AND e.department_id=NEW.department_id AND e.xmin=pg_current_xact_id()::text::xid) THEN RAISE EXCEPTION 'receipt requires transaction-local early source' USING ERRCODE='23514'; END IF; END IF; RETURN NEW; END; $$;
DROP TRIGGER case_early_closures_structure_guard ON case_early_closures;
CREATE TRIGGER case_early_closures_structure_guard BEFORE INSERT OR UPDATE OR DELETE ON case_early_closures FOR EACH ROW EXECUTE FUNCTION guard_early_zero_source_gate();
DROP TRIGGER case_early_closure_receipts_structure_guard ON case_early_closure_receipts;
CREATE TRIGGER case_early_closure_receipts_structure_guard BEFORE INSERT OR UPDATE OR DELETE ON case_early_closure_receipts FOR EACH ROW EXECUTE FUNCTION guard_early_zero_source_gate();
CREATE FUNCTION check_early_zero_source_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM case_closures h JOIN case_closure_versions v ON v.id=h.current_version_id AND v.closure_id=h.id AND v.case_id=h.case_id AND v.department_id=h.department_id
 WHERE h.early_closure_id=NEW.id AND h.case_id=NEW.case_id AND h.department_id=NEW.department_id AND h.xmin=pg_current_xact_id()::text::xid AND v.xmin=pg_current_xact_id()::text::xid
 AND v.early_closure_id=NEW.id AND v.kind='REGISTER' AND v.prior_version_id IS NULL AND v.recorded_by_user_id=NEW.recorded_by_user_id AND v.from_version=NEW.to_version AND v.to_version=NEW.to_version+1 AND v.close_amount_state='KNOWN' AND v.close_amt=0)
 OR NOT EXISTS(SELECT 1 FROM case_early_closure_receipts r WHERE r.early_closure_id=NEW.id AND r.case_id=NEW.case_id AND r.department_id=NEW.department_id AND r.actor_user_id=NEW.recorded_by_user_id AND r.xmin=pg_current_xact_id()::text::xid)
 OR EXISTS(SELECT 1 FROM case_closure_payment_versions p WHERE p.case_id=NEW.case_id AND p.department_id=NEW.department_id) THEN
 RAISE EXCEPTION 'early closure zero amount contract required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER early_zero_source_final AFTER INSERT ON case_early_closures DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_early_zero_source_final();
CREATE FUNCTION guard_zero_typed_closure_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.payment_type IS NOT NULL AND NEW.close_amount_state='KNOWN' AND NEW.close_amt=0 AND NEW.kind='REGISTER' AND NEW.prior_version_id IS NULL AND EXISTS (SELECT 1 FROM case_early_closures e WHERE e.id=NEW.early_closure_id AND e.case_id=NEW.case_id AND e.department_id=NEW.department_id AND e.recorded_by_user_id=NEW.recorded_by_user_id AND e.to_version=NEW.from_version AND NEW.to_version=NEW.from_version+1 AND e.xmin=pg_current_xact_id()::text::xid) THEN RETURN NEW; END IF;
 IF NEW.payment_type IS NOT NULL THEN RAISE EXCEPTION 'typed closure payment command is draft and not enabled' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER closure_payment_type_draft_guard ON case_closure_versions;
CREATE TRIGGER closure_payment_type_draft_guard BEFORE INSERT OR UPDATE ON case_closure_versions FOR EACH ROW EXECUTE FUNCTION guard_zero_typed_closure_gate();
CREATE FUNCTION guard_zero_archive_snapshot_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid uuid; s case_archive_evidence_snapshots%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'archive evidence snapshot persistence is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='case_archive_evidence_snapshots' THEN
  IF NEW.closure_amount IS DISTINCT FROM 0 OR NEW.creation_xid IS DISTINCT FROM pg_current_xact_id() OR NOT EXISTS (SELECT 1 FROM case_closure_versions v WHERE v.id=NEW.closure_version_id AND v.case_id=NEW.case_id AND v.department_id=NEW.department_id AND v.close_amount_state='KNOWN' AND v.close_amt=0 AND v.early_closure_id IS NOT NULL AND EXISTS (SELECT 1 FROM case_early_closures e JOIN case_closures h ON h.early_closure_id=e.id AND h.case_id=e.case_id AND h.department_id=e.department_id WHERE e.id=v.early_closure_id AND e.case_id=v.case_id AND e.department_id=v.department_id AND h.current_version_id=v.id)) THEN RAISE EXCEPTION 'zero archive snapshot required' USING ERRCODE='23514'; END IF;
 ELSE
  sid:=NEW.snapshot_id; SELECT * INTO s FROM case_archive_evidence_snapshots WHERE id=sid AND xmin=pg_current_xact_id()::text::xid;
  IF s.id IS NULL OR s.closure_amount IS DISTINCT FROM 0 OR s.creation_xid IS DISTINCT FROM pg_current_xact_id() THEN RAISE EXCEPTION 'zero archive snapshot required' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW;
END; $$;
DROP TRIGGER case_archive_snapshot_draft_gate ON case_archive_evidence_snapshots;
CREATE TRIGGER case_archive_snapshot_draft_gate BEFORE INSERT OR UPDATE OR DELETE ON case_archive_evidence_snapshots FOR EACH ROW EXECUTE FUNCTION guard_zero_archive_snapshot_gate();
DROP TRIGGER case_archive_snapshot_payment_draft_gate ON case_archive_snapshot_payments;
CREATE TRIGGER case_archive_snapshot_payment_draft_gate BEFORE INSERT OR UPDATE OR DELETE ON case_archive_snapshot_payments FOR EACH ROW EXECUTE FUNCTION guard_zero_archive_snapshot_gate();
DROP TRIGGER case_archive_snapshot_allocation_draft_gate ON case_archive_snapshot_allocations;
CREATE TRIGGER case_archive_snapshot_allocation_draft_gate BEFORE INSERT OR UPDATE OR DELETE ON case_archive_snapshot_allocations FOR EACH ROW EXECUTE FUNCTION guard_zero_archive_snapshot_gate();
COMMIT;
