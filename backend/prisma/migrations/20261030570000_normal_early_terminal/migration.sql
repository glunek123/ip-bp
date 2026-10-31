-- Follow-up only for real normal PENDING_MATCH roots closed before litigation.
-- No rows/facts/permissions changed; all fact-table event bodies remain intact.
BEGIN;
DO $preflight$ DECLARE spec record; p record; BEGIN
 FOR spec IN SELECT * FROM (VALUES ('case_archive_source_checks','c cases, source_stage case_stage','1da4637d69d8b74357489a4bd25814896724ae586ee54fea19ecc54b7d22cfbc','boolean','sql','i'),
('case_archive_source_checks_final','','9bf39beaea3c223cecb5f2763f35c557c24ae2445c0596d5da37868defe0adc6','trigger','plpgsql','v'),
('case_archive_terminal_version','target_case uuid, target_department uuid, target_closure uuid, target_closure_version uuid, closure_version integer','42311ae20cb3ade7db57108f8c77fcb0c6f73e9112b330f36dcb5aeda261403f','integer','plpgsql','v'),
('case_closure_source_terminal_version','target_case uuid, target_department uuid, target_finish uuid, finish_version integer','cdd0e51c8357dcc0a67fec63b7d427637dd47db0c35e51b1516e13592c8d294d','integer','plpgsql','v'),
('case_early_archive_final','','852e1215d143a84ee987b0323dffea66b5c480cdc945957e8276167cac4eca64','trigger','plpgsql','v'),
('case_early_closure_correction_transition','old_case cases, new_case cases','3880c957eb9715f3828841a430a6206c2a18b16f5010aac95ce781b7a767e020','boolean','plpgsql','s'),
('case_early_closure_register_transition','old_case cases, new_case cases','ee31ebb4d54a59365811dd44971179bce7817e3fb3ed92a872e11381f2df04d4','boolean','plpgsql','s'),
('case_early_closure_source_checks_final','','fc985cb4911e9428440ae8afa9a131e8a193ea009b05d148cae2f496d29a36d6','trigger','plpgsql','v'),
('case_early_closure_transition','old_case cases, new_case cases','569cd851de4974e76c0a9e23497de2b9eb6a281f81393958dd5bd6bc9d6ba1cd','boolean','plpgsql','s'),
('check_case_archive_final','','a55570b0318b33e3bec6241811ccbbcd1f36f7f8ae07a22f2977cf31785850e0','trigger','plpgsql','v'),
('check_case_closure_final','','c0a9ef636750592eb2960ece32d71a4a3c22d700a54853776cf0fcccf2a8b1f5','trigger','plpgsql','v'),
('check_case_execution_confirmation_final','','6f73227c3f5d35d46d28bbe698b9927ffe0f94a6d344cac4cba6787c3607185b','trigger','plpgsql','v'),
('check_case_execution_filing_final','','5d40e00548ba07a57f132176dad832510da0b1f680dc55822abe50bc5d4f58f5','trigger','plpgsql','v'),
('check_case_execution_finish_final','','600aef1af1b4e55e45acee510184e7aab6734fd50a066cfa33ebc72dc40a9892','trigger','plpgsql','v'),
('check_case_execution_mailing_final','','f3cf4bba51757222f48e47c48c59c8d7c451cd102d958d319d641e7a6b81937a','trigger','plpgsql','v'),
('check_case_execution_submission_final','','fa6f8a930ba283dd6d8a3f388462cae651500ed6d7797fcccc1e71660843e470','trigger','plpgsql','v'),
('check_case_external_source_final','','05cda3414687d75dadcbbf7678179f1b8975d518de2c2b6325194d6f365bf4ad','trigger','plpgsql','v'),
('check_case_judgment_final','','7c6d0d008e9372d8bcdbc1f50c525a6b176767ed9f172b3f24c3e7048ab665c7','trigger','plpgsql','v'),
('check_case_judgment_next_step_final','','aee643fe6ae400e3631c247db3fee32e1905b922366e8ee6d63c2bea39469ef8','trigger','plpgsql','v'),
('check_case_second_instance_final','','54d2c948acfff0981a7be579e81625af67280ccc17ce57b2f01686ffcc2cc06b','trigger','plpgsql','v'),
('check_case_trial_round_foundation','','cf22bbe4311b8a698a830e8c9fef3ea5a71fd7d16e3213b88aef7c32e6cf9ad0','trigger','plpgsql','v'),
('check_empty_remand_child_version','','05240eaedde81fd66bab23d005abd2193357dea01038fcb3250fc7f34e6f62c1','trigger','plpgsql','v'),
('check_execution_followup_case_final','','aa840691716adb4822c0d034946b97f55b2d2faca7e416a24f9782402d065e94','trigger','plpgsql','v'),
('check_retrial_prejudgment_version','','8459a982ec7967f14633fd34849731e9ad9c2cda1ac0e9865ca01d8c818efdca','trigger','plpgsql','v')) expected(name,args,sha,result,lang,volatility) LOOP
  SELECT f.*,l.lanname INTO p FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace JOIN pg_language l ON l.oid=f.prolang
   WHERE f.proname=spec.name AND pg_get_function_identity_arguments(f.oid)=spec.args AND n.nspname=current_schema();
  IF p.oid IS NULL OR p.prosecdef OR p.proconfig IS NOT NULL OR p.lanname IS DISTINCT FROM spec.lang
   OR p.prorettype IS DISTINCT FROM spec.result::regtype::oid OR p.provolatile::text IS DISTINCT FROM spec.volatility
   OR encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex') IS DISTINCT FROM spec.sha THEN
   RAISE EXCEPTION 'unexpected 3057 normal terminal predecessor %',spec.name USING ERRCODE='23514'; END IF;
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
   RAISE EXCEPTION 'unexpected 3057 terminal trigger %.%',spec.tbl,spec.name USING ERRCODE='23514'; END IF;
 END LOOP;
END; $preflight$;
CREATE FUNCTION normal_pending_early_terminal(target_case uuid,target_department uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM cases c
  JOIN leads l ON l.id=c.source_lead_id AND l.department_id=c.department_id AND l.customer_id=c.customer_id AND l.rights_holder_id=c.rights_holder_id
  JOIN notary_matters m ON m.id=c.source_notary_matter_id AND m.department_id=c.department_id AND m.source_type='LEAD' AND m.source_lead_id=l.id
   AND m.customer_id=c.customer_id AND m.rights_holder_id=c.rights_holder_id
  JOIN notary_certificates n ON n.id=c.certificate_id AND n.matter_id=m.id AND n.department_id=c.department_id
  JOIN case_early_closures ec ON ec.case_id=c.id AND ec.department_id=c.department_id AND ec.source_stage_locked
  JOIN case_closures ch ON ch.case_id=c.id AND ch.department_id=c.department_id AND ch.early_closure_id=ec.id
  JOIN case_closure_versions v ON v.id=ch.current_version_id AND v.closure_id=ch.id AND v.case_id=c.id AND v.department_id=c.department_id AND v.early_closure_id=ec.id
  WHERE c.id=target_case AND c.department_id=target_department AND c.stage IN ('WAITING_ARCHIVE','ARCHIVED')
   AND ec.from_stage='PENDING_MATCH' AND ec.from_version=1 AND ec.to_version=ec.from_version+1
   AND c.source_lead_ordinal>=1 AND c.matched_at IS NULL AND c.matched_on IS NULL
   AND case_archive_source_checks(c,ec.from_stage) IS TRUE
   AND ch.finish_id IS NULL AND ch.external_entry_id IS NULL AND v.finish_id IS NULL AND v.external_entry_id IS NULL
   AND v.kind IN ('REGISTER','CORRECT')
   AND v.to_version=case_closure_source_terminal_version(c.id,c.department_id,NULL,ec.to_version)
   AND ((c.stage='WAITING_ARCHIVE' AND c.version=v.to_version AND NOT EXISTS(SELECT 1 FROM case_archives a WHERE a.case_id=c.id AND a.department_id=c.department_id))
    OR (c.stage='ARCHIVED' AND EXISTS(SELECT 1 FROM case_archives a JOIN case_archive_versions av ON av.id=a.current_version_id AND av.archive_id=a.id
      AND av.case_id=a.case_id AND av.department_id=a.department_id AND av.closure_version_id=a.closure_version_id
      WHERE a.case_id=c.id AND a.department_id=c.department_id AND a.closure_id=ch.id AND a.closure_version_id=v.id AND av.to_version=c.version)))
   AND c.current_trial_round_id IS NULL AND c.current_acceptance_id IS NULL AND c.current_hearing_arrangement_id IS NULL AND c.current_hearing_advance_id IS NULL
   AND c.current_judgment_id IS NULL AND c.current_judgment_next_step_id IS NULL AND c.current_second_instance_progress_id IS NULL
   AND c.current_second_instance_result_id IS NULL AND c.current_execution_submission_id IS NULL
   AND NOT EXISTS(SELECT 1 FROM case_external_entries z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_trial_rounds z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_acceptances z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_hearing_arrangements z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_hearing_advances z WHERE z.case_id=c.id AND z.department_id=c.department_id)
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
-- Only a real initial normal APPEAL choice before any second progress/result.
CREATE FUNCTION normal_initial_appeal_early_terminal(target_case uuid,target_department uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM cases c
  JOIN leads l ON l.id=c.source_lead_id AND l.department_id=c.department_id AND l.customer_id=c.customer_id AND l.rights_holder_id=c.rights_holder_id
  JOIN notary_matters m ON m.id=c.source_notary_matter_id AND m.department_id=c.department_id AND m.source_type='LEAD' AND m.source_lead_id=l.id
   AND m.customer_id=c.customer_id AND m.rights_holder_id=c.rights_holder_id
  JOIN notary_certificates n ON n.id=c.certificate_id AND n.matter_id=m.id AND n.department_id=c.department_id
  JOIN case_early_closures ec ON ec.case_id=c.id AND ec.department_id=c.department_id AND ec.source_stage_locked AND ec.from_stage='SECOND_INSTANCE'
  JOIN case_closures ch ON ch.case_id=c.id AND ch.department_id=c.department_id AND ch.early_closure_id=ec.id
  JOIN case_closure_versions v ON v.id=ch.current_version_id AND v.closure_id=ch.id AND v.case_id=c.id AND v.department_id=c.department_id AND v.early_closure_id=ec.id
  JOIN case_trial_rounds r ON r.id=c.current_trial_round_id AND r.case_id=c.id AND r.department_id=c.department_id
  JOIN case_acceptances a ON a.id=c.current_acceptance_id AND a.case_id=c.id AND a.department_id=c.department_id AND a.trial_round_id=r.id
  JOIN case_hearing_arrangements ha ON ha.id=c.current_hearing_arrangement_id AND ha.case_id=c.id AND ha.department_id=c.department_id AND ha.trial_round_id=r.id
  JOIN case_hearing_advances hd ON hd.id=c.current_hearing_advance_id AND hd.case_id=c.id AND hd.department_id=c.department_id AND hd.trial_round_id=r.id AND hd.arrangement_id=ha.id
  JOIN case_judgment_facts j ON j.id=c.current_judgment_id AND j.case_id=c.id AND j.department_id=c.department_id AND j.trial_round_id=r.id
  JOIN case_judgment_next_steps s ON s.id=c.current_judgment_next_step_id AND s.case_id=c.id AND s.department_id=c.department_id AND s.trial_round_id=r.id AND s.judgment_id=j.id
  WHERE c.id=target_case AND c.department_id=target_department AND c.stage IN ('WAITING_ARCHIVE','ARCHIVED')
   AND c.source_lead_ordinal>=1 AND c.matched_at IS NOT NULL AND c.matched_on IS NOT NULL
   AND case_archive_source_checks(c,ec.from_stage) IS TRUE
   AND ec.to_version=ec.from_version+1 AND ec.from_version=s.to_version
   AND r.origin='NORMAL' AND r.sequence=1 AND r.source_result_id IS NULL AND r.external_entry_id IS NULL AND r.revoked_at IS NULL
   AND (SELECT count(*) FROM case_trial_rounds z WHERE z.case_id=c.id AND z.department_id=c.department_id)=1
   AND a.external_entry_id IS NULL AND case_effective_acceptance_no(a.id)=c.court_case_no
   AND ha.external_entry_id IS NULL AND hd.external_entry_id IS NULL AND j.external_entry_id IS NULL AND s.external_entry_id IS NULL
   AND ha.id=(SELECT z.id FROM case_hearing_arrangements z WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.trial_round_id=r.id ORDER BY z.to_version DESC LIMIT 1)
   AND hd.from_version=ha.to_version AND hd.to_version=hd.from_version+1
   AND j.kind='REGISTER' AND j.prior_fact_id IS NULL AND j.from_version=hd.to_version AND j.to_version=j.from_version+1
   AND (SELECT count(*) FROM case_judgment_facts z WHERE z.case_id=c.id AND z.department_id=c.department_id)=1
   AND s.next='APPEAL' AND s.from_version=j.to_version AND s.to_version=s.from_version+1
   AND (s.plaintiff_rights_holder_id=c.rights_holder_id OR (s.plaintiff_rights_holder_id IS NULL AND EXISTS(SELECT 1 FROM case_judgment_appeal_defendants z WHERE z.choice_id=s.id)))
   AND (SELECT count(*) FROM case_judgment_next_steps z WHERE z.case_id=c.id AND z.department_id=c.department_id)=1
   AND NOT EXISTS(SELECT 1 FROM case_judgment_next_step_revocations z WHERE z.choice_id=s.id)
   AND c.current_second_instance_progress_id IS NULL AND c.current_second_instance_result_id IS NULL AND c.current_execution_submission_id IS NULL
   AND ch.finish_id IS NULL AND ch.external_entry_id IS NULL AND v.finish_id IS NULL AND v.external_entry_id IS NULL AND v.kind IN ('REGISTER','CORRECT')
   AND v.to_version=case_closure_source_terminal_version(c.id,c.department_id,NULL,ec.to_version)
   AND ((c.stage='WAITING_ARCHIVE' AND c.version=v.to_version AND NOT EXISTS(SELECT 1 FROM case_archives z WHERE z.case_id=c.id AND z.department_id=c.department_id))
    OR (c.stage='ARCHIVED' AND EXISTS(SELECT 1 FROM case_archives z JOIN case_archive_versions av ON av.id=z.current_version_id AND av.archive_id=z.id
      AND av.case_id=z.case_id AND av.department_id=z.department_id AND av.closure_version_id=z.closure_version_id
      WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.closure_id=ch.id AND z.closure_version_id=v.id AND av.to_version=c.version)))
   AND NOT EXISTS(SELECT 1 FROM case_external_entries z WHERE z.case_id=c.id AND z.department_id=c.department_id)
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

CREATE OR REPLACE FUNCTION check_case_execution_confirmation_final() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; c record; f record; s record; a record; entry_root "case_external_entries"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='cases' THEN
    IF normal_pending_early_terminal(NEW.id,NEW.department_id) OR normal_initial_appeal_early_terminal(NEW.id,NEW.department_id) THEN RETURN NEW; END IF;
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
    IF normal_pending_early_terminal(NEW.id,NEW.department_id) OR normal_initial_appeal_early_terminal(NEW.id,NEW.department_id) THEN RETURN NEW; END IF;
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
    IF normal_pending_early_terminal(NEW.id,NEW.department_id) OR normal_initial_appeal_early_terminal(NEW.id,NEW.department_id) THEN RETURN NEW; END IF;
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
    IF normal_pending_early_terminal(NEW.id,NEW.department_id) OR normal_initial_appeal_early_terminal(NEW.id,NEW.department_id) THEN RETURN NEW; END IF;
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
    IF normal_pending_early_terminal(NEW.id,NEW.department_id) THEN RETURN NEW; END IF;
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
    IF normal_pending_early_terminal(NEW.id,NEW.department_id) OR normal_initial_appeal_early_terminal(NEW.id,NEW.department_id) THEN RETURN NEW; END IF;
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
    IF normal_pending_early_terminal(NEW.id,NEW.department_id) OR normal_initial_appeal_early_terminal(NEW.id,NEW.department_id) THEN RETURN NEW; END IF;
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
COMMIT;
