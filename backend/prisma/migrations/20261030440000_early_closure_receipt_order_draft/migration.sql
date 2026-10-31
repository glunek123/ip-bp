-- Closed draft. Existing write gates and historical receipt guard remain unchanged.
BEGIN;
DO $migration$
DECLARE oldbody text := $old$
DECLARE e record; h record; v record; er record; cr record; a record; source_case cases;
BEGIN
 IF old_case.id IS DISTINCT FROM new_case.id OR old_case.department_id IS DISTINCT FROM new_case.department_id OR
  old_case.stage<>'WAITING_ARCHIVE' OR new_case.stage<>'WAITING_ARCHIVE' OR
  new_case.version IS DISTINCT FROM old_case.version+1 OR
  to_jsonb(old_case)-'version' IS DISTINCT FROM to_jsonb(new_case)-'version' THEN RETURN false; END IF;
 SELECT * INTO e FROM case_early_closures WHERE case_id=new_case.id AND department_id=new_case.department_id
  AND xmin=pg_current_xact_id()::text::xid;
 IF e.id IS NULL OR e.to_version IS DISTINCT FROM old_case.version OR NOT EXISTS (
  SELECT 1 FROM audit_events WHERE id=e.audit_event_id AND xmin=pg_current_xact_id()::text::xid
 ) THEN RETURN false; END IF;
 source_case:=old_case; source_case.stage:=e.from_stage; source_case.version:=e.from_version;
 IF case_early_closure_transition(source_case,old_case) IS NOT TRUE THEN RETURN false; END IF;
 SELECT * INTO h FROM case_closures WHERE case_id=new_case.id AND department_id=new_case.department_id AND xmin=pg_current_xact_id()::text::xid;
 SELECT * INTO v FROM case_closure_versions WHERE id=h.current_version_id AND closure_id=h.id
  AND case_id=new_case.id AND department_id=new_case.department_id AND xmin=pg_current_xact_id()::text::xid;
 IF h.id IS NULL OR v.id IS NULL OR h.early_closure_id IS DISTINCT FROM e.id OR v.early_closure_id IS DISTINCT FROM e.id OR
  h.finish_id IS NOT NULL OR h.external_entry_id IS NOT NULL OR v.finish_id IS NOT NULL OR v.external_entry_id IS NOT NULL OR
  v.kind<>'REGISTER' OR v.prior_version_id IS NOT NULL OR v.from_version IS DISTINCT FROM old_case.version OR
  v.to_version IS DISTINCT FROM new_case.version OR v.recorded_by_user_id IS DISTINCT FROM e.recorded_by_user_id OR
  (SELECT count(*) FROM case_closure_versions WHERE closure_id=h.id)<>1 THEN RETURN false; END IF;
 SELECT * INTO er FROM case_early_closure_receipts WHERE early_closure_id=e.id AND case_id=e.case_id
  AND department_id=e.department_id AND actor_user_id=e.recorded_by_user_id AND xmin=pg_current_xact_id()::text::xid;
 SELECT * INTO cr FROM case_closure_receipts WHERE department_id=e.department_id AND actor_user_id=e.recorded_by_user_id
  AND case_id=e.case_id AND command='RECORD' AND idempotency_key=er.idempotency_key
  AND request_fingerprint=er.request_fingerprint AND xmin=pg_current_xact_id()::text::xid;
 IF er.id IS NULL OR cr.id IS NULL OR cr.result_snapshot IS DISTINCT FROM jsonb_build_object(
  'id',e.case_id,'closureId',h.id,'closureVersionId',v.id,'finishId',NULL,
  'stage','WAITING_ARCHIVE','version',v.to_version,'recordedAt',
  to_char(v.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) THEN RETURN false; END IF;
 SELECT * INTO a FROM audit_events WHERE id=v.audit_event_id AND xmin=pg_current_xact_id()::text::xid;
 IF a.id IS NULL OR a.action IS DISTINCT FROM 'case.closure.recorded' OR a.actor_kind IS DISTINCT FROM 'HUMAN' OR
  a.actor_user_id IS DISTINCT FROM e.recorded_by_user_id OR a.internal_actor_user_id IS DISTINCT FROM e.recorded_by_user_id OR
  a.department_id IS DISTINCT FROM e.department_id OR a.resource_type IS DISTINCT FROM 'CASE' OR a.resource_id IS DISTINCT FROM e.case_id OR
  a.customer_account_binding_id IS NOT NULL OR a.notary_office_account_binding_id IS NOT NULL OR a.lawyer_account_binding_id IS NOT NULL OR
  a.details->>'closureId' IS DISTINCT FROM h.id::text OR a.details->>'closureVersionId' IS DISTINCT FROM v.id::text OR
  a.details->>'fromVersion' IS DISTINCT FROM v.from_version::text OR a.details->>'toVersion' IS DISTINCT FROM v.to_version::text
 THEN RETURN false; END IF;
 -- The full closure final guard remains active, including exact audit/document/receipt checks.
 RETURN true;
END;
$old$; newbody text := $new$
DECLARE e record; h record; v record; er record; cr record; a record; source_case cases;
BEGIN
 IF old_case.id IS DISTINCT FROM new_case.id OR old_case.department_id IS DISTINCT FROM new_case.department_id OR
  old_case.stage<>'WAITING_ARCHIVE' OR new_case.stage<>'WAITING_ARCHIVE' OR
  new_case.version IS DISTINCT FROM old_case.version+1 OR
  to_jsonb(old_case)-'version' IS DISTINCT FROM to_jsonb(new_case)-'version' THEN RETURN false; END IF;
 SELECT * INTO e FROM case_early_closures WHERE case_id=new_case.id AND department_id=new_case.department_id
  AND xmin=pg_current_xact_id()::text::xid;
 IF e.id IS NULL OR e.to_version IS DISTINCT FROM old_case.version OR NOT EXISTS (
  SELECT 1 FROM audit_events WHERE id=e.audit_event_id AND xmin=pg_current_xact_id()::text::xid
 ) THEN RETURN false; END IF;
 source_case:=old_case; source_case.stage:=e.from_stage; source_case.version:=e.from_version;
 IF case_early_closure_transition(source_case,old_case) IS NOT TRUE THEN RETURN false; END IF;
 SELECT * INTO h FROM case_closures WHERE case_id=new_case.id AND department_id=new_case.department_id AND xmin=pg_current_xact_id()::text::xid;
 SELECT * INTO v FROM case_closure_versions WHERE id=h.current_version_id AND closure_id=h.id
  AND case_id=new_case.id AND department_id=new_case.department_id AND xmin=pg_current_xact_id()::text::xid;
 IF h.id IS NULL OR v.id IS NULL OR h.early_closure_id IS DISTINCT FROM e.id OR v.early_closure_id IS DISTINCT FROM e.id OR
  h.finish_id IS NOT NULL OR h.external_entry_id IS NOT NULL OR v.finish_id IS NOT NULL OR v.external_entry_id IS NOT NULL OR
  v.kind<>'REGISTER' OR v.prior_version_id IS NOT NULL OR v.from_version IS DISTINCT FROM old_case.version OR
  v.to_version IS DISTINCT FROM new_case.version OR v.recorded_by_user_id IS DISTINCT FROM e.recorded_by_user_id OR
  (SELECT count(*) FROM case_closure_versions WHERE closure_id=h.id)<>1 THEN RETURN false; END IF;
 SELECT * INTO er FROM case_early_closure_receipts WHERE early_closure_id=e.id AND case_id=e.case_id
  AND department_id=e.department_id AND actor_user_id=e.recorded_by_user_id AND xmin=pg_current_xact_id()::text::xid;
 IF er.id IS NULL THEN RETURN false; END IF;
 SELECT * INTO a FROM audit_events WHERE id=v.audit_event_id AND xmin=pg_current_xact_id()::text::xid;
 IF a.id IS NULL OR a.action IS DISTINCT FROM 'case.closure.recorded' OR a.actor_kind IS DISTINCT FROM 'HUMAN' OR
  a.actor_user_id IS DISTINCT FROM e.recorded_by_user_id OR a.internal_actor_user_id IS DISTINCT FROM e.recorded_by_user_id OR
  a.department_id IS DISTINCT FROM e.department_id OR a.resource_type IS DISTINCT FROM 'CASE' OR a.resource_id IS DISTINCT FROM e.case_id OR
  a.customer_account_binding_id IS NOT NULL OR a.notary_office_account_binding_id IS NOT NULL OR a.lawyer_account_binding_id IS NOT NULL OR
  a.details->>'closureId' IS DISTINCT FROM h.id::text OR a.details->>'closureVersionId' IS DISTINCT FROM v.id::text OR
  a.details->>'fromVersion' IS DISTINCT FROM v.from_version::text OR a.details->>'toVersion' IS DISTINCT FROM v.to_version::text
 THEN RETURN false; END IF;
 -- The full closure final guard remains active, including exact audit/document/receipt checks.
 RETURN true;
END;
$new$; installed text;
BEGIN
 SELECT p.prosrc INTO installed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname=current_schema() AND p.proname='case_early_closure_register_transition'
 AND p.proargtypes=ARRAY['cases'::regtype::oid,'cases'::regtype::oid]::oidvector AND p.prorettype='boolean'::regtype AND l.lanname='plpgsql' AND NOT p.prosecdef;
 IF replace(installed,E'\r\n',E'\n') IS DISTINCT FROM replace(oldbody,E'\r\n',E'\n') THEN RAISE EXCEPTION 'unexpected early closure register transition'; END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION %I.case_early_closure_register_transition(old_case cases,new_case cases) RETURNS boolean LANGUAGE plpgsql STABLE AS %L',current_schema(),newbody);
END; $migration$;
CREATE FUNCTION check_early_closure_register_receipt_final_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c cases%ROWTYPE; waiting cases%ROWTYPE; h case_closures%ROWTYPE; v case_closure_versions%ROWTYPE; er case_early_closure_receipts%ROWTYPE; cr case_closure_receipts%ROWTYPE;
BEGIN
 SELECT * INTO c FROM cases WHERE id=NEW.case_id AND department_id=NEW.department_id FOR UPDATE;
 SELECT * INTO h FROM case_closures WHERE case_id=NEW.case_id AND department_id=NEW.department_id AND early_closure_id=NEW.id AND xmin=pg_current_xact_id()::text::xid;
 SELECT * INTO v FROM case_closure_versions WHERE id=h.current_version_id AND closure_id=h.id AND xmin=pg_current_xact_id()::text::xid;
 SELECT * INTO er FROM case_early_closure_receipts WHERE early_closure_id=NEW.id AND case_id=NEW.case_id AND department_id=NEW.department_id AND actor_user_id=NEW.recorded_by_user_id AND xmin=pg_current_xact_id()::text::xid;
 SELECT * INTO cr FROM case_closure_receipts WHERE case_id=NEW.case_id AND department_id=NEW.department_id AND actor_user_id=NEW.recorded_by_user_id AND command='RECORD' AND idempotency_key=er.idempotency_key AND request_fingerprint=er.request_fingerprint AND xmin=pg_current_xact_id()::text::xid;
 waiting:=c; waiting.version:=NEW.to_version;
 IF c.id IS NULL OR h.id IS NULL OR v.id IS NULL OR er.id IS NULL OR cr.id IS NULL
  OR case_early_closure_register_transition(waiting,c) IS NOT TRUE
  OR cr.result_snapshot IS DISTINCT FROM jsonb_build_object('id',NEW.case_id,'closureId',h.id,'closureVersionId',v.id,'finishId',NULL,'stage','WAITING_ARCHIVE','version',v.to_version,'recordedAt',to_char(v.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
 THEN RAISE EXCEPTION 'early closure requires atomic matching closure receipt' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER early_closure_register_receipt_final_draft AFTER INSERT ON case_early_closures DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_early_closure_register_receipt_final_draft();
COMMIT;
