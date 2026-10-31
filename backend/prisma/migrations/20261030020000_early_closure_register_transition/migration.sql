-- Draft only. The 197 INSERT gate remains unchanged.
BEGIN;
CREATE FUNCTION case_early_closure_register_transition(old_case cases,new_case cases)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
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
$$;
DO $wrap$
DECLARE p record; definition text; changed integer:=0; preserved integer:=0;
 needle text := 'IF case_early_closure_transition(OLD, NEW) THEN RETURN NEW; END IF;';
 replacement text := 'IF case_early_closure_transition(OLD, NEW) OR case_early_closure_register_transition(OLD, NEW) THEN RETURN NEW; END IF;';
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
   RAISE EXCEPTION 'unreviewed register parent guard %',p.proname USING ERRCODE='23514';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO definition;
  IF definition IS NULL OR position('case_early_closure_register_transition' IN definition)>0 OR
   (length(definition)-length(replace(definition,needle,'')))<>length(needle) THEN
   RAISE EXCEPTION 'changed register parent guard %',p.proname USING ERRCODE='23514';
  END IF;
  EXECUTE replace(definition,needle,replacement); changed:=changed+1;
 END LOOP;
 IF changed<>12 OR preserved<>6 THEN RAISE EXCEPTION 'register parent inventory changed: %, %',changed,preserved USING ERRCODE='23514'; END IF;
END;
$wrap$;
COMMIT;
