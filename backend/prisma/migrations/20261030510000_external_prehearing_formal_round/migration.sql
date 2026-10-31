-- Forward migration: preserve the original no-round branch and existing parent guards.
BEGIN;
DO $migration$ DECLARE installed text; oldbody text := $old$
 SELECT EXISTS (SELECT 1 FROM cases c JOIN case_external_entries e ON e.case_id=c.id AND e.department_id=c.department_id
 JOIN case_early_closures ec ON ec.case_id=c.id AND ec.department_id=c.department_id AND ec.source_stage_locked
 JOIN case_closures h ON h.case_id=c.id AND h.department_id=c.department_id AND h.early_closure_id=ec.id
 JOIN case_closure_versions v ON v.id=h.current_version_id AND v.closure_id=h.id AND v.case_id=c.id AND v.department_id=c.department_id AND v.early_closure_id=ec.id
 WHERE c.id=target_case AND c.department_id=target_department AND c.stage IN ('WAITING_ARCHIVE','ARCHIVED')
 AND ec.from_stage IN ('PENDING_MATCH','WAITING_COMPLAINT','WAITING_COMPLAINT_CONFIRMATION','WAITING_COMPLAINT_STAMP','WAITING_FILING','WAITING_FORMAL_ACCEPTANCE')
 AND h.finish_id IS NULL AND h.external_entry_id IS NULL AND v.finish_id IS NULL AND v.external_entry_id IS NULL
 AND c.current_trial_round_id IS NULL AND c.current_acceptance_id IS NULL AND c.current_hearing_arrangement_id IS NULL AND c.current_hearing_advance_id IS NULL
 AND c.current_judgment_id IS NULL AND c.current_judgment_next_step_id IS NULL AND c.current_second_instance_progress_id IS NULL AND c.current_second_instance_result_id IS NULL
 AND NOT EXISTS(SELECT 1 FROM case_trial_rounds z WHERE z.case_id=c.id AND z.department_id=c.department_id)
 AND NOT EXISTS(SELECT 1 FROM case_judgment_facts z WHERE z.case_id=c.id AND z.department_id=c.department_id)
 AND NOT EXISTS(SELECT 1 FROM case_judgment_next_steps z WHERE z.case_id=c.id AND z.department_id=c.department_id)
 AND NOT EXISTS(SELECT 1 FROM case_second_instance_progresses z WHERE z.case_id=c.id AND z.department_id=c.department_id)
 AND NOT EXISTS(SELECT 1 FROM case_second_instance_results z WHERE z.case_id=c.id AND z.department_id=c.department_id));
$old$; newbody text := $new$
 SELECT EXISTS (SELECT 1 FROM cases c JOIN case_external_entries e ON e.case_id=c.id AND e.department_id=c.department_id
 JOIN case_early_closures ec ON ec.case_id=c.id AND ec.department_id=c.department_id AND ec.source_stage_locked
 JOIN case_closures h ON h.case_id=c.id AND h.department_id=c.department_id AND h.early_closure_id=ec.id
 JOIN case_closure_versions v ON v.id=h.current_version_id AND v.closure_id=h.id AND v.case_id=c.id AND v.department_id=c.department_id AND v.early_closure_id=ec.id
 WHERE c.id=target_case AND c.department_id=target_department AND c.stage IN ('WAITING_ARCHIVE','ARCHIVED')
 AND ec.from_stage IN ('PENDING_MATCH','WAITING_COMPLAINT','WAITING_COMPLAINT_CONFIRMATION','WAITING_COMPLAINT_STAMP','WAITING_FILING','WAITING_FORMAL_ACCEPTANCE')
 AND h.finish_id IS NULL AND h.external_entry_id IS NULL AND v.finish_id IS NULL AND v.external_entry_id IS NULL
 AND (c.current_trial_round_id IS NULL OR (ec.from_stage='WAITING_FORMAL_ACCEPTANCE' AND e.initial_stage='WAITING_FORMAL_ACCEPTANCE' AND EXISTS (SELECT 1 FROM case_trial_rounds r WHERE r.id=c.current_trial_round_id AND r.case_id=c.id AND r.department_id=c.department_id AND r.external_entry_id=e.id AND r.origin='EXTERNAL_CURRENT' AND r.sequence=1 AND r.source_result_id IS NULL AND r.revoked_at IS NULL) AND (SELECT count(*) FROM case_trial_rounds r WHERE r.case_id=c.id AND r.department_id=c.department_id)=1 AND NOT EXISTS(SELECT 1 FROM case_acceptances z WHERE z.case_id=c.id AND z.department_id=c.department_id) AND NOT EXISTS(SELECT 1 FROM case_hearing_arrangements z WHERE z.case_id=c.id AND z.department_id=c.department_id) AND NOT EXISTS(SELECT 1 FROM case_hearing_advances z WHERE z.case_id=c.id AND z.department_id=c.department_id))) AND c.current_acceptance_id IS NULL AND c.current_hearing_arrangement_id IS NULL AND c.current_hearing_advance_id IS NULL
 AND c.current_judgment_id IS NULL AND c.current_judgment_next_step_id IS NULL AND c.current_second_instance_progress_id IS NULL AND c.current_second_instance_result_id IS NULL
 AND (c.current_trial_round_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM case_trial_rounds z WHERE z.case_id=c.id AND z.department_id=c.department_id))
 AND NOT EXISTS(SELECT 1 FROM case_judgment_facts z WHERE z.case_id=c.id AND z.department_id=c.department_id)
 AND NOT EXISTS(SELECT 1 FROM case_judgment_next_steps z WHERE z.case_id=c.id AND z.department_id=c.department_id)
 AND NOT EXISTS(SELECT 1 FROM case_second_instance_progresses z WHERE z.case_id=c.id AND z.department_id=c.department_id)
 AND NOT EXISTS(SELECT 1 FROM case_second_instance_results z WHERE z.case_id=c.id AND z.department_id=c.department_id));
$new$;
BEGIN
 SELECT p.prosrc INTO installed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname=current_schema() AND p.proname='external_prehearing_early_empty_judgment_draft' AND p.proargtypes=ARRAY['uuid'::regtype::oid,'uuid'::regtype::oid]::oidvector AND p.prorettype='boolean'::regtype AND l.lanname='sql' AND NOT p.prosecdef;
 IF replace(installed,E'\r\n',E'\n') IS DISTINCT FROM replace(oldbody,E'\r\n',E'\n') THEN RAISE EXCEPTION 'unexpected prehearing helper'; END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION %I.external_prehearing_early_empty_judgment_draft(target_case uuid,target_department uuid) RETURNS boolean LANGUAGE sql STABLE AS %L',current_schema(),newbody);
END; $migration$;
COMMIT;

