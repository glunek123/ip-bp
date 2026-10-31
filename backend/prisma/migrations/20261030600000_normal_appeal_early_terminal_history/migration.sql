-- Candidate only. Replaces one helper; no guards, triggers, history or grants changed.
BEGIN;
DO $verify$ DECLARE spec record; BEGIN
 FOR spec IN SELECT * FROM (VALUES
('check_case_execution_confirmation_final','','351832ac64ad09ca20f6130c0d25d735b3cee003bb3ef7b4ebfcb642ed2dcaf2','plpgsql','v','u','trigger'),
('check_case_execution_filing_final','','97a6096a752d3681c6bc5b05a45e53de08fb61c1bb45a082e7ccd1ca2b90a65f','plpgsql','v','u','trigger'),
('check_case_execution_finish_final','','c99bf3d9dcf4f01199177cf85a074dacecca31bf9e03a227f510274fc8a55386','plpgsql','v','u','trigger'),
('check_case_execution_mailing_final','','d637a36fc15ad821e5d8ebb0643fa5994dfb59ba0191c748ab2a00c840bcb796','plpgsql','v','u','trigger'),
('check_case_judgment_final','','4256eb4a6e02b451b6c34d974012fffede83b868e52a9626e519b0771d919d58','plpgsql','v','u','trigger'),
('check_case_judgment_next_step_final','','8a8fd94a23939d68d6793c81922b2a7688d9932fab22bc0c8fe309fd6613a17b','plpgsql','v','u','trigger'),
('normal_initial_appeal_early_terminal','target_case uuid, target_department uuid','43ad1ebc08807549c286727ba1c55dbf88b2c7aa1b569191eebd237e6fc20d8d','sql','s','u','boolean')
 ) v(name,args,sha,language,volatility,parallel,result) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
   WHERE n.nspname=current_schema() AND p.proname=spec.name AND pg_get_function_identity_arguments(p.oid)=spec.args
    AND l.lanname=spec.language AND p.provolatile::text=spec.volatility AND p.proparallel::text=spec.parallel
    AND p.prorettype::regtype::text=spec.result AND NOT p.prosecdef AND p.proconfig IS NULL
    AND encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')=spec.sha) THEN
   RAISE EXCEPTION 'unexpected normal appeal terminal baseline: %',spec.name USING ERRCODE='23514';
  END IF;
 END LOOP;
END; $verify$;
CREATE OR REPLACE FUNCTION normal_initial_appeal_early_terminal(target_case uuid,target_department uuid)
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
   AND s.next='APPEAL' AND s.to_version=s.from_version+1
   AND (s.plaintiff_rights_holder_id=c.rights_holder_id OR (s.plaintiff_rights_holder_id IS NULL AND EXISTS(SELECT 1 FROM case_judgment_appeal_defendants z WHERE z.choice_id=s.id)))
   AND NOT EXISTS(SELECT 1 FROM case_judgment_next_step_revocations z WHERE z.choice_id=s.id)
     -- Reconstruct every immutable judgment ancestor, then every APPEAL /
     -- revocation / reselect edge. Count equality rejects unvisited roots,
     -- forks, detached history and current-head substitution.
     AND EXISTS (
      WITH RECURSIVE judgments AS (
       SELECT z.* FROM case_judgment_facts z
        WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.trial_round_id=r.id
         AND z.kind='REGISTER' AND z.prior_fact_id IS NULL AND z.external_entry_id IS NULL
         AND z.from_version=hd.to_version AND z.to_version=z.from_version+1 AND z.to_version<=j.to_version
       UNION ALL
       SELECT z.* FROM case_judgment_facts z JOIN judgments prev ON z.prior_fact_id=prev.id
        WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.trial_round_id=r.id
         AND z.kind='CORRECT' AND z.external_entry_id IS NULL
         AND z.from_version=prev.to_version AND z.to_version=z.from_version+1 AND z.to_version<=j.to_version
      ), choices AS (
       SELECT z.*,NULL::uuid AS predecessor_revocation FROM case_judgment_next_steps z
        WHERE z.case_id=c.id AND z.department_id=c.department_id AND z.trial_round_id=r.id
         AND z.judgment_id=j.id AND z.next='APPEAL' AND z.external_entry_id IS NULL
         AND z.from_version=j.to_version AND z.to_version=z.from_version+1 AND z.to_version<=s.to_version
       UNION ALL
       SELECT z.*,rv.id AS predecessor_revocation FROM choices prev
        JOIN case_judgment_next_step_revocations rv ON rv.choice_id=prev.id AND rv.case_id=c.id AND rv.department_id=c.department_id
         AND rv.from_version=prev.to_version AND rv.to_version=rv.from_version+1
        JOIN case_judgment_next_steps z ON z.from_version=rv.to_version
         AND z.case_id=c.id AND z.department_id=c.department_id AND z.trial_round_id=r.id
         AND z.judgment_id=j.id AND z.next='APPEAL' AND z.external_entry_id IS NULL
         AND z.to_version=z.from_version+1 AND z.to_version<=s.to_version
      )
      SELECT 1 WHERE EXISTS(SELECT 1 FROM judgments z WHERE z.id=j.id)
       AND (SELECT count(*) FROM judgments)=(SELECT count(*) FROM case_judgment_facts z WHERE z.case_id=c.id AND z.department_id=c.department_id)
       AND EXISTS(SELECT 1 FROM choices z WHERE z.id=s.id)
       AND (SELECT count(*) FROM choices)=(SELECT count(*) FROM case_judgment_next_steps z WHERE z.case_id=c.id AND z.department_id=c.department_id)
       AND (SELECT count(*) FROM case_judgment_next_step_revocations z WHERE z.case_id=c.id AND z.department_id=c.department_id)=(SELECT count(*)-1 FROM choices)
       AND NOT EXISTS(SELECT 1 FROM judgments g WHERE NOT EXISTS (
        SELECT 1 FROM audit_events au JOIN case_judgment_receipts cr
         ON cr.case_id=g.case_id AND cr.department_id=g.department_id AND cr.actor_user_id=g.recorded_by_user_id AND cr.action=g.kind
        WHERE au.id=g.audit_event_id AND au.department_id=g.department_id AND au.resource_type='CASE' AND au.resource_id=g.case_id
         AND au.actor_kind='HUMAN' AND au.actor_user_id=g.recorded_by_user_id
         AND au.action=CASE WHEN g.kind='REGISTER' THEN 'case.judgment.registered' ELSE 'case.judgment.corrected' END
         AND au.details->>'judgmentId'=g.id::text AND au.details->>'fromVersion'=g.from_version::text AND au.details->>'toVersion'=g.to_version::text
         AND au.details->>'judgmentReceivedAt'=g.judgment_received_at::text AND au.details->>'judgmentAmountState'=g.judgment_amount_state::text
         AND au.details->>'judgmentAmount' IS NOT DISTINCT FROM g.judgment_amount::text
         AND au.details->>'paidLitigationFeeState'=g.paid_litigation_fee_state::text
         AND au.details->>'paidLitigationFee' IS NOT DISTINCT FROM g.paid_litigation_fee::text
         AND au.details->>'priorFactId' IS NOT DISTINCT FROM g.prior_fact_id::text AND au.details->>'reason' IS NOT DISTINCT FROM g.reason
         AND cr.result_snapshot=jsonb_build_object('id',g.case_id,'stage','WAITING_JUDGMENT','version',g.to_version,'judgmentId',g.id,
          'recordedAt',to_char(g.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
       ))
       AND NOT EXISTS(SELECT 1 FROM choices q WHERE q.execution_readiness_confirmed
        OR (q.plaintiff_rights_holder_id=c.rights_holder_id OR (q.plaintiff_rights_holder_id IS NULL AND EXISTS(
         SELECT 1 FROM case_judgment_appeal_defendants ad WHERE ad.choice_id=q.id AND ad.case_id=c.id AND ad.department_id=c.department_id))) IS NOT TRUE
        OR NOT EXISTS (
         SELECT 1 FROM audit_events au JOIN case_judgment_next_step_receipts cr
          ON cr.case_id=q.case_id AND cr.department_id=q.department_id AND cr.actor_user_id=q.recorded_by_user_id AND cr.action='CHOOSE'
         WHERE au.id=q.audit_event_id AND au.department_id=q.department_id AND au.resource_type='CASE' AND au.resource_id=q.case_id
          AND au.actor_kind='HUMAN' AND au.actor_user_id=q.recorded_by_user_id AND au.action='case.judgment.next_step'
          AND au.details->>'choiceId'=q.id::text AND au.details->>'judgmentId'=j.id::text AND au.details->>'next'='APPEAL'
          AND au.details->>'fromVersion'=q.from_version::text AND au.details->>'toVersion'=q.to_version::text
          AND au.details->'plaintiffAppeals'=to_jsonb(q.plaintiff_rights_holder_id IS NOT NULL)
          AND au.details->'executionReadinessConfirmed'='false'::jsonb
          AND au.details->'defendantIds'=(SELECT coalesce(jsonb_agg(ad.defendant_id ORDER BY ad.defendant_id),'[]'::jsonb) FROM case_judgment_appeal_defendants ad WHERE ad.choice_id=q.id)
          AND cr.result_snapshot=jsonb_build_object('id',q.case_id,'stage','SECOND_INSTANCE','version',q.to_version,'choiceId',q.id,'judgmentId',q.judgment_id,
           'recordedAt',to_char(q.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        ))
       AND NOT EXISTS(SELECT 1 FROM choices q WHERE q.id<>s.id AND NOT EXISTS (
        SELECT 1 FROM case_judgment_next_step_revocations rv JOIN choices successor ON successor.predecessor_revocation=rv.id
         JOIN audit_events au ON au.id=rv.audit_event_id
         JOIN case_judgment_next_step_receipts cr ON cr.case_id=rv.case_id AND cr.department_id=rv.department_id AND cr.actor_user_id=rv.recorded_by_user_id AND cr.action='REVOKE'
        WHERE rv.choice_id=q.id AND rv.case_id=c.id AND rv.department_id=c.department_id
         AND rv.from_version=q.to_version AND rv.to_version=rv.from_version+1
         AND au.department_id=rv.department_id AND au.resource_type='CASE' AND au.resource_id=rv.case_id
         AND au.actor_kind='HUMAN' AND au.actor_user_id=rv.recorded_by_user_id AND au.internal_actor_user_id=rv.recorded_by_user_id
         AND au.action='case.judgment.next_step.revoke' AND au.details->>'choiceId'=q.id::text AND au.details->>'revocationId'=rv.id::text
         AND au.details->>'reason'=rv.reason AND au.details->>'fromVersion'=rv.from_version::text AND au.details->>'toVersion'=rv.to_version::text
         AND cr.result_snapshot=jsonb_build_object('id',rv.case_id,'stage','WAITING_JUDGMENT','version',rv.to_version,'choiceId',q.id,'judgmentId',q.judgment_id,
          'revocationId',rv.id,'recordedAt',to_char(rv.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
       ))
     )
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
COMMIT;
