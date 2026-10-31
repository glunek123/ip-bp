-- Closed forward draft: only missing-round requirement for verified pre-hearing early sources.
BEGIN;
DO $migration$ DECLARE installed text; oldbody text := $old$
DECLARE c record; e record; r record; s record; a record;
BEGIN
  SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
  SELECT * INTO e FROM "case_external_entries" WHERE "case_id"=target_case AND "department_id"=target_department;
  IF c."id" IS NULL OR e."id" IS NULL OR c."source_lead_id" IS NOT NULL OR c."source_notary_matter_id" IS NOT NULL OR c."certificate_id" IS NOT NULL
  THEN RAISE EXCEPTION 'external trial round lacks entry root' USING ERRCODE='23514'; END IF;
  IF c."current_trial_round_id" IS NULL THEN
    IF (c."stage" IN ('WAITING_HEARING','WAITING_JUDGMENT','SECOND_INSTANCE','WAITING_EXECUTION_DOCUMENTS','WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE') OR
      (c."stage"='ARCHIVED' AND e."initial_stage"<>'ARCHIVED') OR c."current_acceptance_id" IS NOT NULL OR
      c."current_hearing_arrangement_id" IS NOT NULL OR c."current_hearing_advance_id" IS NOT NULL OR c."current_judgment_id" IS NOT NULL OR
      c."current_judgment_next_step_id" IS NOT NULL OR c."current_second_instance_progress_id" IS NOT NULL OR c."current_second_instance_result_id" IS NOT NULL OR
      EXISTS (SELECT 1 FROM "case_trial_rounds" x WHERE x."case_id"=target_case AND x."department_id"=target_department))
    THEN RAISE EXCEPTION 'external case current round missing' USING ERRCODE='23514'; END IF;
    RETURN;
  END IF;
  SELECT * INTO r FROM "case_trial_rounds" WHERE "id"=c."current_trial_round_id" AND "case_id"=target_case AND "department_id"=target_department;
  IF r."id" IS NULL OR r."revoked_at" IS NOT NULL OR r."external_entry_id" IS DISTINCT FROM e."id"
  THEN RAISE EXCEPTION 'external current round mismatch' USING ERRCODE='23514'; END IF;
  IF r."origin"='EXTERNAL_CURRENT' THEN
    IF r."sequence"<>1 OR r."source_result_id" IS NOT NULL THEN RAISE EXCEPTION 'external current round shape mismatch' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT * INTO s FROM "case_second_instance_results" WHERE "id"=r."source_result_id" AND "case_id"=target_case AND "department_id"=target_department;
    IF r."origin"<>'NORMAL' OR r."sequence"<=1 OR s."id" IS NULL OR s."external_entry_id" IS DISTINCT FROM e."id" OR s."result"<>'REMAND' OR
      EXISTS (SELECT 1 FROM "case_second_instance_result_revocations" z WHERE z."result_id"=s."id")
    THEN RAISE EXCEPTION 'external remand round source mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  SELECT * INTO a FROM "case_acceptances" WHERE "id"=c."current_acceptance_id" AND "case_id"=target_case AND "department_id"=target_department;
  IF c."current_acceptance_id" IS NOT NULL AND (a."id" IS NULL OR a."trial_round_id" IS DISTINCT FROM r."id" OR
      a."external_entry_id" IS DISTINCT FROM e."id" OR case_effective_acceptance_no(a."id") IS DISTINCT FROM c."court_case_no")
  THEN RAISE EXCEPTION 'external current acceptance mismatch' USING ERRCODE='23514'; END IF;
  IF (c."current_hearing_arrangement_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_hearing_arrangements" x WHERE x."id"=c."current_hearing_arrangement_id" AND x."trial_round_id"=r."id" AND x."external_entry_id"=e."id")) OR
     (c."current_hearing_advance_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_hearing_advances" x WHERE x."id"=c."current_hearing_advance_id" AND x."trial_round_id"=r."id" AND x."external_entry_id"=e."id")) OR
     (c."current_judgment_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_judgment_facts" x WHERE x."id"=c."current_judgment_id" AND x."trial_round_id"=r."id" AND x."external_entry_id"=e."id")) OR
     (c."current_judgment_next_step_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_steps" x WHERE x."id"=c."current_judgment_next_step_id" AND x."trial_round_id"=r."id" AND x."external_entry_id"=e."id")) OR
     (c."current_second_instance_progress_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_second_instance_progresses" x WHERE x."id"=c."current_second_instance_progress_id" AND x."trial_round_id"=r."id" AND x."external_entry_id"=e."id")) OR
     (c."current_second_instance_result_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_second_instance_results" x WHERE x."id"=c."current_second_instance_result_id" AND x."external_entry_id"=e."id" AND
       (x."trial_round_id"=r."id" OR (x."result"='REMAND' AND x."id"=r."source_result_id"))))
  THEN RAISE EXCEPTION 'external current fact pointer crosses round' USING ERRCODE='23514'; END IF;
END; $old$; newbody text := $new$
DECLARE c record; e record; r record; s record; a record;
BEGIN
  SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
  SELECT * INTO e FROM "case_external_entries" WHERE "case_id"=target_case AND "department_id"=target_department;
  IF c."id" IS NULL OR e."id" IS NULL OR c."source_lead_id" IS NOT NULL OR c."source_notary_matter_id" IS NOT NULL OR c."certificate_id" IS NOT NULL
  THEN RAISE EXCEPTION 'external trial round lacks entry root' USING ERRCODE='23514'; END IF;
  IF c."current_trial_round_id" IS NULL THEN
    IF (((c."stage" IN ('WAITING_HEARING','WAITING_JUDGMENT','SECOND_INSTANCE','WAITING_EXECUTION_DOCUMENTS','WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE') OR
      (c."stage"='ARCHIVED' AND e."initial_stage"<>'ARCHIVED')) AND NOT EXISTS (
       SELECT 1 FROM case_early_closures ec JOIN case_closures h ON h.early_closure_id=ec.id AND h.case_id=ec.case_id AND h.department_id=ec.department_id
       JOIN case_closure_versions v ON v.id=h.current_version_id AND v.closure_id=h.id AND v.case_id=h.case_id AND v.department_id=h.department_id AND v.early_closure_id=ec.id
       WHERE ec.case_id=target_case AND ec.department_id=target_department AND ec.source_stage_locked
        AND c."stage" IN ('WAITING_ARCHIVE','ARCHIVED') AND ec.from_stage IN ('PENDING_MATCH','WAITING_COMPLAINT','WAITING_COMPLAINT_CONFIRMATION','WAITING_COMPLAINT_STAMP','WAITING_FILING','WAITING_FORMAL_ACCEPTANCE')
        AND h.finish_id IS NULL AND h.external_entry_id IS NULL AND v.finish_id IS NULL AND v.external_entry_id IS NULL)) OR c."current_acceptance_id" IS NOT NULL OR
      c."current_hearing_arrangement_id" IS NOT NULL OR c."current_hearing_advance_id" IS NOT NULL OR c."current_judgment_id" IS NOT NULL OR
      c."current_judgment_next_step_id" IS NOT NULL OR c."current_second_instance_progress_id" IS NOT NULL OR c."current_second_instance_result_id" IS NOT NULL OR
      EXISTS (SELECT 1 FROM "case_trial_rounds" x WHERE x."case_id"=target_case AND x."department_id"=target_department))
    THEN RAISE EXCEPTION 'external case current round missing' USING ERRCODE='23514'; END IF;
    RETURN;
  END IF;
  SELECT * INTO r FROM "case_trial_rounds" WHERE "id"=c."current_trial_round_id" AND "case_id"=target_case AND "department_id"=target_department;
  IF r."id" IS NULL OR r."revoked_at" IS NOT NULL OR r."external_entry_id" IS DISTINCT FROM e."id"
  THEN RAISE EXCEPTION 'external current round mismatch' USING ERRCODE='23514'; END IF;
  IF r."origin"='EXTERNAL_CURRENT' THEN
    IF r."sequence"<>1 OR r."source_result_id" IS NOT NULL THEN RAISE EXCEPTION 'external current round shape mismatch' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT * INTO s FROM "case_second_instance_results" WHERE "id"=r."source_result_id" AND "case_id"=target_case AND "department_id"=target_department;
    IF r."origin"<>'NORMAL' OR r."sequence"<=1 OR s."id" IS NULL OR s."external_entry_id" IS DISTINCT FROM e."id" OR s."result"<>'REMAND' OR
      EXISTS (SELECT 1 FROM "case_second_instance_result_revocations" z WHERE z."result_id"=s."id")
    THEN RAISE EXCEPTION 'external remand round source mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  SELECT * INTO a FROM "case_acceptances" WHERE "id"=c."current_acceptance_id" AND "case_id"=target_case AND "department_id"=target_department;
  IF c."current_acceptance_id" IS NOT NULL AND (a."id" IS NULL OR a."trial_round_id" IS DISTINCT FROM r."id" OR
      a."external_entry_id" IS DISTINCT FROM e."id" OR case_effective_acceptance_no(a."id") IS DISTINCT FROM c."court_case_no")
  THEN RAISE EXCEPTION 'external current acceptance mismatch' USING ERRCODE='23514'; END IF;
  IF (c."current_hearing_arrangement_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_hearing_arrangements" x WHERE x."id"=c."current_hearing_arrangement_id" AND x."trial_round_id"=r."id" AND x."external_entry_id"=e."id")) OR
     (c."current_hearing_advance_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_hearing_advances" x WHERE x."id"=c."current_hearing_advance_id" AND x."trial_round_id"=r."id" AND x."external_entry_id"=e."id")) OR
     (c."current_judgment_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_judgment_facts" x WHERE x."id"=c."current_judgment_id" AND x."trial_round_id"=r."id" AND x."external_entry_id"=e."id")) OR
     (c."current_judgment_next_step_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_steps" x WHERE x."id"=c."current_judgment_next_step_id" AND x."trial_round_id"=r."id" AND x."external_entry_id"=e."id")) OR
     (c."current_second_instance_progress_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_second_instance_progresses" x WHERE x."id"=c."current_second_instance_progress_id" AND x."trial_round_id"=r."id" AND x."external_entry_id"=e."id")) OR
     (c."current_second_instance_result_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_second_instance_results" x WHERE x."id"=c."current_second_instance_result_id" AND x."external_entry_id"=e."id" AND
       (x."trial_round_id"=r."id" OR (x."result"='REMAND' AND x."id"=r."source_result_id"))))
  THEN RAISE EXCEPTION 'external current fact pointer crosses round' USING ERRCODE='23514'; END IF;
END; $new$;
BEGIN
 SELECT p.prosrc INTO installed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname=current_schema() AND p.proname='ca018_assert_external_trial_round' AND p.proargtypes=ARRAY['uuid'::regtype::oid,'uuid'::regtype::oid]::oidvector AND p.prorettype='void'::regtype AND l.lanname='plpgsql' AND NOT p.prosecdef;
 IF replace(installed,E'\r\n',E'\n') IS DISTINCT FROM replace(oldbody,E'\r\n',E'\n') THEN RAISE EXCEPTION 'unexpected external trial round guard'; END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION %I.ca018_assert_external_trial_round(target_case uuid,target_department uuid) RETURNS void LANGUAGE plpgsql AS %L',current_schema(),newbody);
END; $migration$;
COMMIT;
