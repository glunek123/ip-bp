-- Correction preparation only. All source, payment and total-command gates remain closed.
BEGIN;
CREATE FUNCTION case_early_closure_correction_transition(old_case cases,new_case cases)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE e record; h record; v record; prior record; r record; a record;
BEGIN
 IF old_case.id IS DISTINCT FROM new_case.id OR old_case.department_id IS DISTINCT FROM new_case.department_id
  OR old_case.stage<>'WAITING_ARCHIVE' OR new_case.stage<>'WAITING_ARCHIVE'
  OR new_case.version IS DISTINCT FROM old_case.version+1
  OR to_jsonb(old_case)-'version' IS DISTINCT FROM to_jsonb(new_case)-'version' THEN RETURN false; END IF;
 SELECT * INTO e FROM case_early_closures WHERE case_id=new_case.id AND department_id=new_case.department_id;
 IF e.id IS NULL THEN RETURN false; END IF;
 SELECT * INTO h FROM case_closures WHERE case_id=new_case.id AND department_id=new_case.department_id;
 SELECT * INTO v FROM case_closure_versions WHERE id=h.current_version_id AND closure_id=h.id
  AND case_id=new_case.id AND department_id=new_case.department_id AND xmin=pg_current_xact_id()::text::xid;
 SELECT * INTO prior FROM case_closure_versions WHERE id=v.prior_version_id AND closure_id=h.id
  AND case_id=new_case.id AND department_id=new_case.department_id;
 IF h.id IS NULL OR v.id IS NULL OR prior.id IS NULL OR h.early_closure_id IS DISTINCT FROM e.id
  OR v.early_closure_id IS DISTINCT FROM e.id OR prior.early_closure_id IS DISTINCT FROM e.id
  OR h.finish_id IS NOT NULL OR h.external_entry_id IS NOT NULL OR v.finish_id IS NOT NULL OR v.external_entry_id IS NOT NULL
  OR prior.finish_id IS NOT NULL OR prior.external_entry_id IS NOT NULL OR v.kind<>'CORRECT'
  OR prior.to_version IS DISTINCT FROM old_case.version OR v.from_version IS DISTINCT FROM old_case.version
  OR v.to_version IS DISTINCT FROM new_case.version THEN RETURN false; END IF;
 -- Validate the whole REGISTER/CORRECT chain from the genuine early root, including the prior link.
 IF case_closure_source_terminal_version(new_case.id,new_case.department_id,NULL,e.to_version) IS DISTINCT FROM new_case.version THEN RETURN false; END IF;
 SELECT * INTO r FROM case_closure_settlement_update_receipts WHERE closure_version_id=v.id
  AND case_id=new_case.id AND department_id=new_case.department_id AND actor_user_id=v.recorded_by_user_id
  AND closure_audit_event_id=v.audit_event_id AND xmin=pg_current_xact_id()::text::xid;
 SELECT * INTO a FROM audit_events WHERE id=r.audit_event_id AND xmin=pg_current_xact_id()::text::xid;
 IF r.id IS NULL OR a.id IS NULL OR a.actor_kind IS DISTINCT FROM 'HUMAN'
  OR a.department_id IS DISTINCT FROM new_case.department_id OR a.actor_user_id IS DISTINCT FROM v.recorded_by_user_id
  OR a.internal_actor_user_id IS DISTINCT FROM v.recorded_by_user_id OR a.customer_account_binding_id IS NOT NULL
  OR a.lawyer_account_binding_id IS NOT NULL OR a.notary_office_account_binding_id IS NOT NULL
  OR a.resource_type IS DISTINCT FROM 'CASE_CLOSURE_SETTLEMENT_UPDATE' OR a.resource_id IS DISTINCT FROM r.id
  OR a.action IS DISTINCT FROM 'CASE_CLOSURE_SETTLEMENT_UPDATED'
  OR a.details IS DISTINCT FROM jsonb_build_object('requestFingerprint',r.request_fingerprint,'result',r.result_snapshot)
  OR NOT EXISTS(SELECT 1 FROM audit_events ca WHERE ca.id=v.audit_event_id AND ca.xmin=pg_current_xact_id()::text::xid
   AND ca.action='case.closure.corrected' AND ca.resource_type='CASE' AND ca.resource_id=new_case.id
   AND ca.department_id=new_case.department_id AND ca.actor_user_id=v.recorded_by_user_id AND ca.internal_actor_user_id=v.recorded_by_user_id)
  OR NOT EXISTS(SELECT 1 FROM case_closure_receipts cr WHERE cr.case_id=new_case.id AND cr.department_id=new_case.department_id
   AND cr.actor_user_id=v.recorded_by_user_id AND cr.command='CORRECT' AND cr.idempotency_key=r.idempotency_key
   AND cr.request_fingerprint=r.request_fingerprint AND cr.result_snapshot->>'closureVersionId'=v.id::text
   AND cr.xmin=pg_current_xact_id()::text::xid) THEN RETURN false; END IF;
 -- Full closure/archive/source/followup and total-receipt deferred validators still execute.
 RETURN true;
END; $$;
DO $wrap$
DECLARE p record; definition text; changed integer:=0; preserved integer:=0;
 needle text := 'IF case_early_closure_transition(OLD, NEW) OR case_early_closure_register_transition(OLD, NEW) THEN RETURN NEW; END IF;';
 replacement text := 'IF case_early_closure_transition(OLD, NEW) OR case_early_closure_register_transition(OLD, NEW) OR case_early_closure_correction_transition(OLD, NEW) THEN RETURN NEW; END IF;';
BEGIN
 FOR p IN SELECT DISTINCT proc.oid,proc.proname FROM pg_trigger t JOIN pg_proc proc ON proc.oid=t.tgfoid
  WHERE t.tgrelid='cases'::regclass AND NOT t.tgisinternal AND t.tgdeferrable LOOP
  IF p.proname=ANY(ARRAY['check_case_closure_final','check_case_archive_final','check_execution_followup_case_final',
   'case_early_archive_final','case_archive_source_checks_final','case_early_closure_source_checks_final']) THEN
   preserved:=preserved+1; CONTINUE;
  END IF;
  IF p.proname<>ALL(ARRAY['check_case_trial_round_foundation','check_empty_remand_child_version','check_retrial_prejudgment_version',
   'check_case_judgment_final','check_case_judgment_next_step_final','check_case_second_instance_final',
   'check_case_execution_submission_final','check_case_execution_confirmation_final','check_case_execution_mailing_final',
   'check_case_execution_filing_final','check_case_execution_finish_final','check_case_external_source_final']) THEN
   RAISE EXCEPTION 'unreviewed correction parent guard %',p.proname USING ERRCODE='23514';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO definition;
  IF definition IS NULL OR position('case_early_closure_correction_transition' IN definition)>0 OR
   (length(definition)-length(replace(definition,needle,'')))<>length(needle) THEN
   RAISE EXCEPTION 'changed correction parent guard %',p.proname USING ERRCODE='23514';
  END IF;
  EXECUTE replace(definition,needle,replacement); changed:=changed+1;
 END LOOP;
 IF changed<>12 OR preserved<>6 THEN RAISE EXCEPTION 'correction parent inventory changed: %, %',changed,preserved USING ERRCODE='23514'; END IF;
END;
$wrap$;
COMMIT;
