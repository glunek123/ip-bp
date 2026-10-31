-- Unified normal pre-judgment source stages; no history or fact writes.
BEGIN;
DO $preflight$ DECLARE spec record; p record; BEGIN
 FOR spec IN SELECT * FROM (VALUES ('case_archive_source_checks','c cases, source_stage case_stage','1da4637d69d8b74357489a4bd25814896724ae586ee54fea19ecc54b7d22cfbc','boolean','sql','i'),
('case_archive_source_checks_final','','9bf39beaea3c223cecb5f2763f35c557c24ae2445c0596d5da37868defe0adc6','trigger','plpgsql','v'),
('case_archive_terminal_version','target_case uuid, target_department uuid, target_closure uuid, target_closure_version uuid, closure_version integer','42311ae20cb3ade7db57108f8c77fcb0c6f73e9112b330f36dcb5aeda261403f','integer','plpgsql','v'),
('case_closure_source_terminal_version','target_case uuid, target_department uuid, target_finish uuid, finish_version integer','cdd0e51c8357dcc0a67fec63b7d427637dd47db0c35e51b1516e13592c8d294d','integer','plpgsql','v'),
('case_early_archive_final','','852e1215d143a84ee987b0323dffea66b5c480cdc945957e8276167cac4eca64','trigger','plpgsql','v'),
('case_early_closure_source_checks_final','','fc985cb4911e9428440ae8afa9a131e8a193ea009b05d148cae2f496d29a36d6','trigger','plpgsql','v'),
('case_effective_acceptance_date','target_acceptance uuid','5357e22aa762f287dce6a4de24ad1b9e17eefaaa9ee05dcf69eb37915222b20e','date','sql','s'),
('case_effective_acceptance_no','target_acceptance uuid','6b0f76c90d6772f37f9c8c0c0f26a20d976d8256adf027cc87199dfa56678fdb','character varying','sql','s'),
('check_case_archive_final','','a55570b0318b33e3bec6241811ccbbcd1f36f7f8ae07a22f2977cf31785850e0','trigger','plpgsql','v'),
('check_case_closure_final','','c0a9ef636750592eb2960ece32d71a4a3c22d700a54853776cf0fcccf2a8b1f5','trigger','plpgsql','v'),
('check_case_execution_confirmation_final','','41c039f05c8a46ce76668924c7538d457ad0168ade69466fca0e5d07fddd19eb','trigger','plpgsql','v'),
('check_case_execution_filing_final','','54c8360e88791324b06b37f7e322838835486f2cf6fb07117e37f76076001083','trigger','plpgsql','v'),
('check_case_execution_finish_final','','98d5082ddd3506bd8064a2b5353ab02ad516f9b9a732b76f706e8fa923881014','trigger','plpgsql','v'),
('check_case_execution_mailing_final','','6d098d864689cc41bdfb4501c5678356aeb8810ed1653f5da627e074f244ba9f','trigger','plpgsql','v'),
('check_case_execution_submission_final','','fa6f8a930ba283dd6d8a3f388462cae651500ed6d7797fcccc1e71660843e470','trigger','plpgsql','v'),
('check_case_external_source_final','','05cda3414687d75dadcbbf7678179f1b8975d518de2c2b6325194d6f365bf4ad','trigger','plpgsql','v'),
('check_case_judgment_final','','4df532c43bb89cabd16ac1aabb82b82ef1d1a5b6dbc315b4b99a9833a77b8e61','trigger','plpgsql','v'),
('check_case_judgment_next_step_final','','cc027aaa930a488196c03bdc99176424a4867105f60163fc36e5ad6191c8e699','trigger','plpgsql','v'),
('check_case_second_instance_final','','54d2c948acfff0981a7be579e81625af67280ccc17ce57b2f01686ffcc2cc06b','trigger','plpgsql','v'),
('check_case_trial_round_foundation','','6f6bb085bf0a428b5072b0e0813c7e9f33fc83a568396bdcedbf9faf790dddf0','trigger','plpgsql','v'),
('check_empty_remand_child_version','','05240eaedde81fd66bab23d005abd2193357dea01038fcb3250fc7f34e6f62c1','trigger','plpgsql','v'),
('check_execution_followup_case_final','','aa840691716adb4822c0d034946b97f55b2d2faca7e416a24f9782402d065e94','trigger','plpgsql','v'),
('check_retrial_prejudgment_version','','8459a982ec7967f14633fd34849731e9ad9c2cda1ac0e9865ca01d8c818efdca','trigger','plpgsql','v'),
('normal_initial_appeal_early_terminal','target_case uuid, target_department uuid','43ad1ebc08807549c286727ba1c55dbf88b2c7aa1b569191eebd237e6fc20d8d','boolean','sql','s'),
('normal_pending_early_terminal','target_case uuid, target_department uuid','3442456a862912db77e631765aa4b208563f5b378d2768118e903279501a0479','boolean','sql','s')) expected(name,args,sha,result,lang,volatility) LOOP
  SELECT f.*,l.lanname INTO p FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace JOIN pg_language l ON l.oid=f.prolang
   WHERE f.proname=spec.name AND pg_get_function_identity_arguments(f.oid)=spec.args AND n.nspname=current_schema();
  IF p.oid IS NULL OR p.prosecdef OR p.proconfig IS NOT NULL OR p.lanname IS DISTINCT FROM spec.lang
   OR p.prorettype IS DISTINCT FROM spec.result::regtype::oid OR p.provolatile::text IS DISTINCT FROM spec.volatility
   OR encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex') IS DISTINCT FROM spec.sha THEN
   RAISE EXCEPTION 'unexpected 3058 normal source predecessor %',spec.name USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR spec IN SELECT * FROM (VALUES ('case_acceptances','case_trial_round_acceptance_guard','CREATE CONSTRAINT TRIGGER case_trial_round_acceptance_guard AFTER INSERT ON case_acceptances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_trial_round_foundation()'),
('case_execution_confirmations','case_execution_confirmation_fact_guard','CREATE CONSTRAINT TRIGGER case_execution_confirmation_fact_guard AFTER INSERT ON case_execution_confirmations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_confirmation_final()'),
('case_execution_filings','case_execution_filing_fact_guard','CREATE CONSTRAINT TRIGGER case_execution_filing_fact_guard AFTER INSERT ON case_execution_filings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_filing_final()'),
('case_execution_finishes','case_execution_finish_fact_guard','CREATE CONSTRAINT TRIGGER case_execution_finish_fact_guard AFTER INSERT ON case_execution_finishes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_finish_final()'),
('case_execution_mailings','case_execution_mailing_fact_guard','CREATE CONSTRAINT TRIGGER case_execution_mailing_fact_guard AFTER INSERT ON case_execution_mailings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_mailing_final()'),
('case_hearing_advances','case_trial_round_advance_guard','CREATE CONSTRAINT TRIGGER case_trial_round_advance_guard AFTER INSERT ON case_hearing_advances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_trial_round_foundation()'),
('case_hearing_arrangements','case_trial_round_hearing_guard','CREATE CONSTRAINT TRIGGER case_trial_round_hearing_guard AFTER INSERT ON case_hearing_arrangements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_trial_round_foundation()'),
('case_judgment_facts','case_judgment_fact_guard','CREATE CONSTRAINT TRIGGER case_judgment_fact_guard AFTER INSERT ON case_judgment_facts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_judgment_final()'),
('case_judgment_facts','case_trial_round_judgment_guard','CREATE CONSTRAINT TRIGGER case_trial_round_judgment_guard AFTER INSERT ON case_judgment_facts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_trial_round_foundation()'),
('case_judgment_next_step_revocations','case_judgment_next_step_revoke_guard','CREATE CONSTRAINT TRIGGER case_judgment_next_step_revoke_guard AFTER INSERT ON case_judgment_next_step_revocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_judgment_next_step_final()'),
('case_judgment_next_steps','case_judgment_next_step_fact_guard','CREATE CONSTRAINT TRIGGER case_judgment_next_step_fact_guard AFTER INSERT ON case_judgment_next_steps DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_judgment_next_step_final()'),
('case_judgment_next_steps','case_trial_round_choice_guard','CREATE CONSTRAINT TRIGGER case_trial_round_choice_guard AFTER INSERT ON case_judgment_next_steps DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_trial_round_foundation()'),
('case_trial_rounds','case_trial_round_round_guard','CREATE CONSTRAINT TRIGGER case_trial_round_round_guard AFTER INSERT ON case_trial_rounds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_trial_round_foundation()'),
('cases','case_archive_case_final','CREATE CONSTRAINT TRIGGER case_archive_case_final AFTER INSERT OR UPDATE ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_archive_final()'),
('cases','case_archive_source_checks_final','CREATE CONSTRAINT TRIGGER case_archive_source_checks_final AFTER INSERT OR UPDATE ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION case_archive_source_checks_final()'),
('cases','case_closure_case_final','CREATE CONSTRAINT TRIGGER case_closure_case_final AFTER UPDATE ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_closure_final()'),
('cases','case_early_archive_case_final','CREATE CONSTRAINT TRIGGER case_early_archive_case_final AFTER INSERT OR UPDATE ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION case_early_archive_final()'),
('cases','case_early_closure_source_checks_case_final','CREATE CONSTRAINT TRIGGER case_early_closure_source_checks_case_final AFTER INSERT OR UPDATE ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION case_early_closure_source_checks_final()'),
('cases','case_execution_confirmation_head_guard','CREATE CONSTRAINT TRIGGER case_execution_confirmation_head_guard AFTER UPDATE OF stage, version, current_execution_submission_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_confirmation_final()'),
('cases','case_execution_filing_head_guard','CREATE CONSTRAINT TRIGGER case_execution_filing_head_guard AFTER UPDATE OF stage, version, current_execution_submission_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_filing_final()'),
('cases','case_execution_finish_head_guard','CREATE CONSTRAINT TRIGGER case_execution_finish_head_guard AFTER UPDATE OF stage, version, current_execution_submission_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_finish_final()'),
('cases','case_execution_head_guard','CREATE CONSTRAINT TRIGGER case_execution_head_guard AFTER UPDATE OF stage, version, current_trial_round_id, current_judgment_next_step_id, current_second_instance_result_id, current_execution_submission_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_submission_final()'),
('cases','case_execution_mailing_head_guard','CREATE CONSTRAINT TRIGGER case_execution_mailing_head_guard AFTER UPDATE OF stage, version, current_execution_submission_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_mailing_final()'),
('cases','case_external_source_case_final','CREATE CONSTRAINT TRIGGER case_external_source_case_final AFTER INSERT OR UPDATE ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_external_source_final()'),
('cases','case_judgment_case_guard','CREATE CONSTRAINT TRIGGER case_judgment_case_guard AFTER UPDATE OF stage, version, current_judgment_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_judgment_final()'),
('cases','case_judgment_next_step_case_guard','CREATE CONSTRAINT TRIGGER case_judgment_next_step_case_guard AFTER UPDATE OF stage, version, current_judgment_id, current_judgment_next_step_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_judgment_next_step_final()'),
('cases','case_second_instance_case_guard','CREATE CONSTRAINT TRIGGER case_second_instance_case_guard AFTER UPDATE OF stage, version, current_trial_round_id, current_second_instance_progress_id, current_second_instance_result_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_second_instance_final()'),
('cases','case_trial_round_case_guard','CREATE CONSTRAINT TRIGGER case_trial_round_case_guard AFTER INSERT OR UPDATE OF stage, current_trial_round_id, current_acceptance_id, court_case_no, current_hearing_arrangement_id, current_hearing_advance_id, current_judgment_id, current_judgment_next_step_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_trial_round_foundation()'),
('cases','cases_empty_remand_child_version_guard','CREATE CONSTRAINT TRIGGER cases_empty_remand_child_version_guard AFTER INSERT OR UPDATE ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_empty_remand_child_version()'),
('cases','cases_retrial_prejudgment_version_guard','CREATE CONSTRAINT TRIGGER cases_retrial_prejudgment_version_guard AFTER INSERT OR UPDATE ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_retrial_prejudgment_version()'),
('cases','ef_case_final','CREATE CONSTRAINT TRIGGER ef_case_final AFTER UPDATE ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_execution_followup_case_final()')) expected(tbl,name,definition) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass(format('%I.%I',current_schema(),spec.tbl))
   AND t.tgname=spec.name AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgdeferrable AND t.tginitdeferred
   AND pg_get_triggerdef(t.oid,true)=spec.definition) THEN
   RAISE EXCEPTION 'unexpected 3058 source trigger %.%',spec.tbl,spec.name USING ERRCODE='23514'; END IF;
 END LOOP;
END; $preflight$;
-- Source-specific normal pre-judgment terminal, with real complaint/round anchors.
CREATE FUNCTION normal_prejudgment_early_terminal(target_case uuid,target_department uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM cases c
  JOIN leads l ON l.id=c.source_lead_id AND l.department_id=c.department_id AND l.customer_id=c.customer_id AND l.rights_holder_id=c.rights_holder_id
  JOIN notary_matters nm ON nm.id=c.source_notary_matter_id AND nm.department_id=c.department_id AND nm.source_type='LEAD' AND nm.source_lead_id=l.id
   AND nm.customer_id=c.customer_id AND nm.rights_holder_id=c.rights_holder_id
  JOIN notary_certificates nc ON nc.id=c.certificate_id AND nc.matter_id=nm.id AND nc.department_id=c.department_id
  JOIN case_early_closures ec ON ec.case_id=c.id AND ec.department_id=c.department_id AND ec.source_stage_locked
  CROSS JOIN LATERAL (SELECT array_position(ARRAY['WAITING_COMPLAINT','WAITING_COMPLAINT_CONFIRMATION','WAITING_COMPLAINT_STAMP','WAITING_FILING','WAITING_FORMAL_ACCEPTANCE','WAITING_HEARING','WAITING_JUDGMENT']::case_stage[],ec.from_stage) AS idx) phase
  JOIN case_closures ch ON ch.case_id=c.id AND ch.department_id=c.department_id AND ch.early_closure_id=ec.id
  JOIN case_closure_versions cv ON cv.id=ch.current_version_id AND cv.closure_id=ch.id AND cv.case_id=c.id AND cv.department_id=c.department_id AND cv.early_closure_id=ec.id
  LEFT JOIN case_complaint_confirmations cc ON cc.case_id=c.id AND cc.department_id=c.department_id
  LEFT JOIN case_complaint_mailings cm ON cm.case_id=c.id AND cm.department_id=c.department_id
  LEFT JOIN case_filing_submissions fs ON fs.case_id=c.id AND fs.department_id=c.department_id
  LEFT JOIN case_trial_rounds r ON r.id=c.current_trial_round_id AND r.case_id=c.id AND r.department_id=c.department_id
  LEFT JOIN case_acceptances ac ON ac.id=c.current_acceptance_id AND ac.case_id=c.id AND ac.department_id=c.department_id AND ac.trial_round_id=r.id
  LEFT JOIN case_hearing_arrangements ha ON ha.id=c.current_hearing_arrangement_id AND ha.case_id=c.id AND ha.department_id=c.department_id AND ha.trial_round_id=r.id
  LEFT JOIN case_hearing_advances hd ON hd.id=c.current_hearing_advance_id AND hd.case_id=c.id AND hd.department_id=c.department_id AND hd.trial_round_id=r.id AND hd.arrangement_id=ha.id
  JOIN LATERAL (
   SELECT a.* FROM audit_events a WHERE a.resource_type='CASE' AND a.resource_id=c.id AND a.department_id=c.department_id
    AND ((phase.idx=1 AND a.action='case.match.succeeded' AND a.details->>'matchedOn'=c.matched_on::text AND EXISTS(
      SELECT 1 FROM case_match_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.actor_user_id=a.actor_user_id
       AND z.result_snapshot->>'id'=c.id::text AND z.result_snapshot->>'stage'='WAITING_COMPLAINT'
       AND z.result_snapshot->'version'=a.details->'toVersion' AND (z.result_snapshot->>'matchedAt')::timestamptz=c.matched_at))
     OR (phase.idx=2 AND a.action='case.complaint.submitted' AND a.actor_user_id=c.complaint_submitted_by_user_id AND EXISTS(
      SELECT 1 FROM case_complaint_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.actor_user_id=a.actor_user_id
       AND z.result_snapshot->>'id'=c.id::text AND z.result_snapshot->>'stage'='WAITING_COMPLAINT_CONFIRMATION'
       AND z.result_snapshot->'version'=a.details->'toVersion' AND (z.result_snapshot->>'submittedAt')::timestamptz=c.complaint_submitted_at))
     OR (phase.idx=3 AND a.id=cc.audit_event_id AND a.action='case.complaint.confirmed' AND a.actor_user_id=cc.confirmed_by_user_id AND EXISTS(
      SELECT 1 FROM case_complaint_confirmation_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.actor_user_id=a.actor_user_id
       AND z.result_snapshot->>'id'=c.id::text AND z.result_snapshot->>'stage'='WAITING_COMPLAINT_STAMP'
       AND z.result_snapshot->'version'=a.details->'toVersion' AND (z.result_snapshot->>'confirmedAt')::timestamptz=cc.confirmed_at))
     OR (phase.idx=4 AND a.id=cm.audit_event_id AND a.action='case.complaint.mailed' AND a.actor_user_id=cm.recorded_by_user_id AND EXISTS(
      SELECT 1 FROM case_complaint_mailing_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.actor_user_id=a.actor_user_id
       AND z.result_snapshot->>'id'=c.id::text AND z.result_snapshot->>'stage'='WAITING_FILING'
       AND z.result_snapshot->'version'=a.details->'toVersion' AND z.result_snapshot->>'mailedAt'=cm.mailed_at::text))
     OR (phase.idx=5 AND a.id=fs.audit_event_id AND a.action='case.filing.submitted' AND a.actor_user_id=fs.recorded_by_user_id AND EXISTS(
      SELECT 1 FROM case_filing_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.actor_user_id=a.actor_user_id
       AND z.result_snapshot->>'id'=c.id::text AND z.result_snapshot->>'stage'='WAITING_FORMAL_ACCEPTANCE'
       AND z.result_snapshot->'version'=a.details->'toVersion' AND z.result_snapshot->>'submittedAt'=fs.submitted_at::text))
     OR (phase.idx=6 AND ha.id IS NULL AND a.id=ac.audit_event_id AND a.action='case.acceptance.registered' AND EXISTS(
      SELECT 1 FROM case_acceptance_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.actor_user_id=a.actor_user_id
       AND z.result_snapshot->>'id'=c.id::text AND z.result_snapshot->>'stage'='WAITING_HEARING' AND z.result_snapshot->'version'=a.details->'toVersion'
       AND z.result_snapshot->>'acceptedAt'=ac.accepted_at::text AND z.result_snapshot->>'courtCaseNo'=ac.court_case_no))
     OR (phase.idx=6 AND ha.id IS NOT NULL AND a.id=ha.audit_event_id AND a.action='case.hearing.scheduled' AND a.details->>'arrangementId'=ha.id::text AND (a.details->>'toVersion')::integer=ha.to_version)
     OR (phase.idx=7 AND a.id=hd.audit_event_id AND a.action='case.hearing.auto_advanced' AND a.details->>'advanceId'=hd.id::text AND (a.details->>'toVersion')::integer=hd.to_version))
  ) source_audit ON (source_audit.details->>'toVersion')::integer=ec.from_version
  WHERE c.id=target_case AND c.department_id=target_department AND c.stage IN ('WAITING_ARCHIVE','ARCHIVED') AND phase.idx BETWEEN 1 AND 7
   AND c.source_lead_ordinal>=1 AND c.matched_at IS NOT NULL AND c.matched_on IS NOT NULL
   AND ec.to_version=ec.from_version+1 AND case_archive_source_checks(c,ec.from_stage) IS TRUE
   AND EXISTS(SELECT 1 FROM case_match_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.result_snapshot->>'id'=c.id::text
     AND z.result_snapshot->>'stage'='WAITING_COMPLAINT' AND (z.result_snapshot->>'matchedAt')::timestamptz=c.matched_at AND (z.result_snapshot->>'version')::integer<=ec.from_version)
   AND ((phase.idx=1 AND NOT EXISTS(SELECT 1 FROM case_complaint_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id))
    OR (phase.idx>=2 AND EXISTS(SELECT 1 FROM case_complaint_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.result_snapshot->>'id'=c.id::text
     AND z.result_snapshot->>'stage'='WAITING_COMPLAINT_CONFIRMATION' AND (z.result_snapshot->>'submittedAt')::timestamptz=c.complaint_submitted_at AND (z.result_snapshot->>'version')::integer<=ec.from_version)))
   AND ((phase.idx<3 AND NOT EXISTS(SELECT 1 FROM case_complaint_confirmation_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id))
    OR (phase.idx>=3 AND EXISTS(SELECT 1 FROM case_complaint_confirmation_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.result_snapshot->>'id'=c.id::text
     AND z.result_snapshot->>'stage'='WAITING_COMPLAINT_STAMP' AND (z.result_snapshot->>'confirmedAt')::timestamptz=cc.confirmed_at AND (z.result_snapshot->>'version')::integer<=ec.from_version)))
   AND ((phase.idx<4 AND NOT EXISTS(SELECT 1 FROM case_complaint_mailing_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id))
    OR (phase.idx>=4 AND EXISTS(SELECT 1 FROM case_complaint_mailing_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.result_snapshot->>'id'=c.id::text
     AND z.result_snapshot->>'stage'='WAITING_FILING' AND z.result_snapshot->>'mailedAt'=cm.mailed_at::text AND (z.result_snapshot->>'version')::integer<=ec.from_version)))
   AND ((phase.idx<5 AND NOT EXISTS(SELECT 1 FROM case_filing_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id))
    OR (phase.idx>=5 AND EXISTS(SELECT 1 FROM case_filing_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.result_snapshot->>'id'=c.id::text
     AND z.result_snapshot->>'stage'='WAITING_FORMAL_ACCEPTANCE' AND z.result_snapshot->>'submittedAt'=fs.submitted_at::text AND (z.result_snapshot->>'version')::integer<=ec.from_version)))
   AND ((phase.idx<=5 AND NOT EXISTS(SELECT 1 FROM case_acceptance_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id))
    OR (phase.idx>=6 AND EXISTS(SELECT 1 FROM case_acceptance_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.result_snapshot->>'id'=c.id::text
     AND z.result_snapshot->>'stage'='WAITING_HEARING' AND z.result_snapshot->>'acceptedAt'=ac.accepted_at::text AND z.result_snapshot->>'courtCaseNo'=ac.court_case_no AND (z.result_snapshot->>'version')::integer<=ec.from_version)))
   AND ch.finish_id IS NULL AND ch.external_entry_id IS NULL AND cv.finish_id IS NULL AND cv.external_entry_id IS NULL AND cv.kind IN ('REGISTER','CORRECT')
   AND cv.to_version=case_closure_source_terminal_version(c.id,c.department_id,NULL,ec.to_version)
   AND ((c.stage='WAITING_ARCHIVE' AND c.version=cv.to_version AND NOT EXISTS(SELECT 1 FROM case_archives z WHERE z.case_id=c.id AND z.department_id=c.department_id))
    OR (c.stage='ARCHIVED' AND EXISTS(SELECT 1 FROM case_archives z JOIN case_archive_versions av ON av.id=z.current_version_id AND av.archive_id=z.id
      AND av.case_id=z.case_id AND av.department_id=z.department_id AND av.closure_version_id=z.closure_version_id
      WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.closure_id=ch.id AND z.closure_version_id=cv.id AND av.to_version=c.version)))
   AND ((phase.idx<3 AND cc.id IS NULL) OR (phase.idx>=3 AND cc.id IS NOT NULL AND cc.external_entry_id IS NULL
     AND cc.amount_state=c.complaint_amount_state AND cc.amount IS NOT DISTINCT FROM c.complaint_amount AND cc.pending_reason IS NOT DISTINCT FROM c.complaint_pending_reason))
   AND ((phase.idx<4 AND cm.id IS NULL) OR (phase.idx>=4 AND cm.id IS NOT NULL AND cm.external_entry_id IS NULL))
   AND ((phase.idx<5 AND fs.id IS NULL) OR (phase.idx>=5 AND fs.id IS NOT NULL AND fs.external_entry_id IS NULL))
   AND ((phase.idx<=5 AND c.current_trial_round_id IS NULL AND c.current_acceptance_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM case_trial_rounds z WHERE z.case_id=c.id AND z.department_id=c.department_id)
      AND NOT EXISTS(SELECT 1 FROM case_acceptances z WHERE z.case_id=c.id AND z.department_id=c.department_id))
    OR (phase.idx>=6 AND r.id IS NOT NULL AND ac.id IS NOT NULL AND r.origin='NORMAL' AND r.sequence=1 AND r.source_result_id IS NULL AND r.external_entry_id IS NULL AND r.revoked_at IS NULL
      AND ac.external_entry_id IS NULL AND case_effective_acceptance_no(ac.id)=c.court_case_no
      AND (SELECT count(*) FROM case_trial_rounds z WHERE z.case_id=c.id AND z.department_id=c.department_id)=1
      AND (SELECT count(*) FROM case_acceptances z WHERE z.case_id=c.id AND z.department_id=c.department_id)=1))
   AND ((phase.idx<=5 AND c.current_hearing_arrangement_id IS NULL AND NOT EXISTS(SELECT 1 FROM case_hearing_arrangements z WHERE z.case_id=c.id AND z.department_id=c.department_id))
    OR (phase.idx>=6 AND ((c.current_hearing_arrangement_id IS NULL AND NOT EXISTS(SELECT 1 FROM case_hearing_arrangements z WHERE z.case_id=c.id AND z.department_id=c.department_id))
      OR (ha.id IS NOT NULL AND ha.external_entry_id IS NULL AND ha.id=(SELECT z.id FROM case_hearing_arrangements z WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.trial_round_id=r.id ORDER BY z.to_version DESC LIMIT 1)))))
   AND ((phase.idx<=6 AND c.current_hearing_advance_id IS NULL AND NOT EXISTS(SELECT 1 FROM case_hearing_advances z WHERE z.case_id=c.id AND z.department_id=c.department_id))
    OR (phase.idx=7 AND ha.id IS NOT NULL AND hd.id IS NOT NULL AND hd.external_entry_id IS NULL AND hd.from_version=ha.to_version AND hd.to_version=hd.from_version+1))
   AND c.current_judgment_id IS NULL AND c.current_judgment_next_step_id IS NULL AND c.current_second_instance_progress_id IS NULL AND c.current_second_instance_result_id IS NULL AND c.current_execution_submission_id IS NULL
   AND NOT EXISTS(SELECT 1 FROM case_external_entries z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_judgment_facts z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_judgment_next_steps z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_second_instance_progresses z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_second_instance_results z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_execution_submissions z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_execution_confirmations z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_execution_mailings z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_execution_filings z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_execution_finishes z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_early_archives z WHERE z.case_id=c.id AND z.department_id=c.department_id)
 );
$$;

DO $execution_preflight$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='case_execution_submissions'::regclass AND t.tgname='case_execution_submission_guard'
  AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgdeferrable AND t.tginitdeferred AND pg_get_triggerdef(t.oid,true)='CREATE CONSTRAINT TRIGGER case_execution_submission_guard AFTER INSERT ON case_execution_submissions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_submission_final()') THEN
  RAISE EXCEPTION 'unexpected 3058 execution submission fact trigger' USING ERRCODE='23514'; END IF;
END; $execution_preflight$;
-- Initial normal first-judgment EXECUTION choice and its real preparation chain.
CREATE FUNCTION normal_initial_execution_early_terminal(target_case uuid,target_department uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM cases c
  JOIN leads l ON l.id=c.source_lead_id AND l.department_id=c.department_id AND l.customer_id=c.customer_id AND l.rights_holder_id=c.rights_holder_id
  JOIN notary_matters nm ON nm.id=c.source_notary_matter_id AND nm.department_id=c.department_id AND nm.source_type='LEAD' AND nm.source_lead_id=l.id AND nm.customer_id=c.customer_id AND nm.rights_holder_id=c.rights_holder_id
  JOIN notary_certificates nc ON nc.id=c.certificate_id AND nc.matter_id=nm.id AND nc.department_id=c.department_id
  JOIN case_early_closures ec ON ec.case_id=c.id AND ec.department_id=c.department_id AND ec.source_stage_locked
  CROSS JOIN LATERAL (SELECT array_position(ARRAY['WAITING_EXECUTION_DOCUMENTS','WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING']::case_stage[],ec.from_stage) AS idx) phase
  JOIN case_closures ch ON ch.case_id=c.id AND ch.department_id=c.department_id AND ch.early_closure_id=ec.id
  JOIN case_closure_versions cv ON cv.id=ch.current_version_id AND cv.closure_id=ch.id AND cv.case_id=c.id AND cv.department_id=c.department_id AND cv.early_closure_id=ec.id
  JOIN case_trial_rounds r ON r.id=c.current_trial_round_id AND r.case_id=c.id AND r.department_id=c.department_id
  JOIN case_acceptances ac ON ac.id=c.current_acceptance_id AND ac.case_id=c.id AND ac.department_id=c.department_id AND ac.trial_round_id=r.id
  JOIN case_hearing_arrangements ha ON ha.id=c.current_hearing_arrangement_id AND ha.case_id=c.id AND ha.department_id=c.department_id AND ha.trial_round_id=r.id
  JOIN case_hearing_advances hd ON hd.id=c.current_hearing_advance_id AND hd.case_id=c.id AND hd.department_id=c.department_id AND hd.trial_round_id=r.id AND hd.arrangement_id=ha.id
  JOIN case_judgment_facts j ON j.id=c.current_judgment_id AND j.case_id=c.id AND j.department_id=c.department_id AND j.trial_round_id=r.id
  JOIN case_judgment_next_steps s ON s.id=c.current_judgment_next_step_id AND s.case_id=c.id AND s.department_id=c.department_id AND s.trial_round_id=r.id AND s.judgment_id=j.id
  LEFT JOIN case_execution_submissions p ON p.id=c.current_execution_submission_id AND p.case_id=c.id AND p.department_id=c.department_id
  LEFT JOIN case_execution_confirmations q ON q.case_id=c.id AND q.department_id=c.department_id
  LEFT JOIN case_execution_mailings m ON m.case_id=c.id AND m.department_id=c.department_id
  LEFT JOIN case_execution_filings f ON f.case_id=c.id AND f.department_id=c.department_id
  JOIN LATERAL (
   SELECT a.* FROM audit_events a WHERE a.resource_type='CASE' AND a.resource_id=c.id AND a.department_id=c.department_id AND a.actor_kind='HUMAN'
    AND ((phase.idx=1 AND a.id=s.audit_event_id AND a.action='case.judgment.next_step' AND a.actor_user_id=s.recorded_by_user_id
      AND a.details->>'choiceId'=s.id::text AND a.details->>'judgmentId'=j.id::text AND a.details->>'next'='EXECUTION')
     OR (phase.idx=2 AND a.id=p.audit_event_id AND a.action='case.execution.submitted' AND a.actor_user_id=p.submitted_by_user_id AND a.details->>'submissionId'=p.id::text)
     OR (phase.idx=3 AND a.id=q.audit_event_id AND a.action='case.execution.confirmed' AND a.actor_user_id=q.confirmed_by_user_id AND a.details->>'confirmationId'=q.id::text AND a.details->>'submissionId'=p.id::text)
     OR (phase.idx=4 AND a.id=m.audit_event_id AND a.action='case.execution.mailed' AND a.actor_user_id=m.recorded_by_user_id AND a.details->>'mailingId'=m.id::text AND a.details->>'confirmationId'=q.id::text)
     OR (phase.idx=5 AND a.id=f.audit_event_id AND a.action='case.execution.filing.submitted' AND a.actor_user_id=f.submitted_by_user_id AND a.details->>'filingId'=f.id::text AND a.details->>'mailingId'=m.id::text))
  ) source_audit ON (source_audit.details->>'toVersion')::integer=ec.from_version
  WHERE c.id=target_case AND c.department_id=target_department AND c.stage IN ('WAITING_ARCHIVE','ARCHIVED') AND phase.idx BETWEEN 1 AND 5
   AND c.source_lead_ordinal>=1 AND c.matched_at IS NOT NULL AND c.matched_on IS NOT NULL AND case_archive_source_checks(c,ec.from_stage) IS TRUE
   AND ec.to_version=ec.from_version+1
   AND r.origin='NORMAL' AND r.sequence=1 AND r.source_result_id IS NULL AND r.external_entry_id IS NULL AND r.revoked_at IS NULL
   AND (SELECT count(*) FROM case_trial_rounds z WHERE z.case_id=c.id AND z.department_id=c.department_id)=1
   AND ac.external_entry_id IS NULL AND case_effective_acceptance_no(ac.id)=c.court_case_no
   AND ha.external_entry_id IS NULL AND hd.external_entry_id IS NULL AND j.external_entry_id IS NULL AND s.external_entry_id IS NULL
   AND ha.id=(SELECT z.id FROM case_hearing_arrangements z WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.trial_round_id=r.id ORDER BY z.to_version DESC LIMIT 1)
   AND hd.from_version=ha.to_version AND hd.to_version=hd.from_version+1
   AND j.kind='REGISTER' AND j.prior_fact_id IS NULL AND j.from_version=hd.to_version AND j.to_version=j.from_version+1
   AND (SELECT count(*) FROM case_judgment_facts z WHERE z.case_id=c.id AND z.department_id=c.department_id)=1
   AND s.next='EXECUTION' AND s.execution_readiness_confirmed AND s.plaintiff_rights_holder_id IS NULL
   AND s.from_version=j.to_version AND s.to_version=s.from_version+1
   AND (SELECT count(*) FROM case_judgment_next_steps z WHERE z.case_id=c.id AND z.department_id=c.department_id)=1
   AND NOT EXISTS(SELECT 1 FROM case_judgment_next_step_revocations z WHERE z.choice_id=s.id)
   AND NOT EXISTS(SELECT 1 FROM case_judgment_appeal_defendants z WHERE z.choice_id=s.id)
   AND EXISTS(SELECT 1 FROM case_judgment_next_step_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.actor_user_id=s.recorded_by_user_id AND z.action='CHOOSE'
     AND z.result_snapshot->>'choiceId'=s.id::text AND z.result_snapshot->>'judgmentId'=j.id::text AND (z.result_snapshot->>'version')::integer=s.to_version)
   AND ((phase.idx=1 AND ec.from_version=s.to_version AND c.current_execution_submission_id IS NULL AND NOT EXISTS(SELECT 1 FROM case_execution_submissions z WHERE z.case_id=c.id AND z.department_id=c.department_id)
      AND NOT EXISTS(SELECT 1 FROM case_execution_submission_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id))
    OR (phase.idx>=2 AND p.id IS NOT NULL AND p.prior_submission_id IS NULL AND p.external_entry_id IS NULL AND p.trial_round_id=r.id
      AND p.judgment_next_step_id=s.id AND p.second_instance_result_id IS NULL AND p.from_version=s.to_version AND p.to_version=p.from_version+1
      AND (SELECT count(*) FROM case_execution_submissions z WHERE z.case_id=c.id AND z.department_id=c.department_id)=1
      AND EXISTS(SELECT 1 FROM case_execution_submission_versions z WHERE z.submission_id=p.id AND z.case_id=c.id AND z.department_id=c.department_id)
      AND EXISTS(SELECT 1 FROM case_execution_submission_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.actor_user_id=p.submitted_by_user_id
       AND z.result_snapshot->>'id'=c.id::text AND z.result_snapshot->>'stage'='WAITING_EXECUTION_CONFIRMATION' AND z.result_snapshot->>'submissionId'=p.id::text AND (z.result_snapshot->>'version')::integer=p.to_version)))
   AND ((phase.idx<3 AND q.id IS NULL AND NOT EXISTS(SELECT 1 FROM case_execution_confirmation_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id))
    OR (phase.idx>=3 AND q.id IS NOT NULL AND q.external_entry_id IS NULL AND q.submission_id=p.id AND q.from_version=p.to_version AND q.to_version=q.from_version+1
      AND EXISTS(SELECT 1 FROM case_execution_confirmation_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.actor_user_id=q.confirmed_by_user_id
       AND z.result_snapshot->>'id'=c.id::text AND z.result_snapshot->>'stage'='WAITING_EXECUTION_STAMP' AND z.result_snapshot->>'submissionId'=p.id::text AND z.result_snapshot->>'confirmationId'=q.id::text AND (z.result_snapshot->>'version')::integer=q.to_version)))
   AND ((phase.idx<4 AND m.id IS NULL AND NOT EXISTS(SELECT 1 FROM case_execution_mailing_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id))
    OR (phase.idx>=4 AND m.id IS NOT NULL AND m.external_entry_id IS NULL AND m.confirmation_id=q.id AND m.from_version=q.to_version AND m.to_version=m.from_version+1
      AND EXISTS(SELECT 1 FROM case_execution_mailing_versions z WHERE z.mailing_id=m.id AND z.case_id=c.id AND z.department_id=c.department_id)
      AND EXISTS(SELECT 1 FROM case_execution_mailing_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.actor_user_id=m.recorded_by_user_id
       AND z.result_snapshot->>'id'=c.id::text AND z.result_snapshot->>'stage'='WAITING_EXECUTION_FILING' AND z.result_snapshot->>'mailingId'=m.id::text AND z.result_snapshot->>'confirmationId'=q.id::text AND (z.result_snapshot->>'version')::integer=m.to_version)))
   AND ((phase.idx<5 AND f.id IS NULL AND NOT EXISTS(SELECT 1 FROM case_execution_filing_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id))
    OR (phase.idx=5 AND f.id IS NOT NULL AND f.external_entry_id IS NULL AND f.mailing_id=m.id AND f.from_version=m.to_version AND f.to_version=f.from_version+1
      AND EXISTS(SELECT 1 FROM case_execution_filing_versions z WHERE z.filing_id=f.id AND z.case_id=c.id AND z.department_id=c.department_id)
      AND EXISTS(SELECT 1 FROM case_execution_filing_receipts z WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.actor_user_id=f.submitted_by_user_id
       AND z.result_snapshot->>'id'=c.id::text AND z.result_snapshot->>'stage'='EXECUTING' AND z.result_snapshot->>'filingId'=f.id::text AND z.result_snapshot->>'mailingId'=m.id::text AND (z.result_snapshot->>'version')::integer=f.to_version)))
   AND ec.from_version=CASE phase.idx WHEN 1 THEN s.to_version WHEN 2 THEN p.to_version WHEN 3 THEN q.to_version WHEN 4 THEN m.to_version WHEN 5 THEN f.to_version END
   AND c.current_second_instance_progress_id IS NULL AND c.current_second_instance_result_id IS NULL
   AND ch.finish_id IS NULL AND ch.external_entry_id IS NULL AND cv.finish_id IS NULL AND cv.external_entry_id IS NULL AND cv.kind IN ('REGISTER','CORRECT')
   AND cv.to_version=case_closure_source_terminal_version(c.id,c.department_id,NULL,ec.to_version)
   AND ((c.stage='WAITING_ARCHIVE' AND c.version=cv.to_version AND NOT EXISTS(SELECT 1 FROM case_archives z WHERE z.case_id=c.id AND z.department_id=c.department_id))
    OR (c.stage='ARCHIVED' AND EXISTS(SELECT 1 FROM case_archives z JOIN case_archive_versions av ON av.id=z.current_version_id AND av.archive_id=z.id
      AND av.case_id=z.case_id AND av.department_id=z.department_id AND av.closure_version_id=z.closure_version_id
      WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.closure_id=ch.id AND z.closure_version_id=cv.id AND av.to_version=c.version)))
   AND NOT EXISTS(SELECT 1 FROM case_external_entries z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_second_instance_progresses z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_second_instance_results z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_execution_finishes z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_early_archives z WHERE z.case_id=c.id AND z.department_id=c.department_id)
 );
$$;

CREATE OR REPLACE FUNCTION check_case_execution_confirmation_final() RETURNS trigger LANGUAGE plpgsql AS $$
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
END; $$;
CREATE OR REPLACE FUNCTION check_case_execution_mailing_final() RETURNS trigger LANGUAGE plpgsql AS $$
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
END; $$;
CREATE OR REPLACE FUNCTION check_case_execution_filing_final() RETURNS trigger LANGUAGE plpgsql AS $$
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
END; $$;
CREATE OR REPLACE FUNCTION check_case_execution_finish_final() RETURNS trigger LANGUAGE plpgsql AS $$
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
END; $$;
CREATE OR REPLACE FUNCTION check_case_trial_round_foundation() RETURNS trigger LANGUAGE plpgsql AS $$
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
END; $$;
CREATE OR REPLACE FUNCTION check_case_judgment_final() RETURNS trigger LANGUAGE plpgsql AS $$
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
END; $$;
CREATE OR REPLACE FUNCTION check_case_judgment_next_step_final() RETURNS trigger LANGUAGE plpgsql AS $$
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
$$;
CREATE OR REPLACE FUNCTION check_case_execution_submission_final() RETURNS trigger LANGUAGE plpgsql AS $$
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
END; $$;
COMMIT;
