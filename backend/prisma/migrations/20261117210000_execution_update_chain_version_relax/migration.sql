-- 执行更新停留在强制执行中：确认链与提交链允许立案记录接管当前版本。
BEGIN;
CREATE OR REPLACE FUNCTION public.check_case_execution_confirmation_final()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
  -- Only the local litigation head's temporal context changes. No NEW/OLD/fact/DB row projection.
  IF TG_TABLE_NAME='cases' THEN
    SELECT projected.stage,projected.version INTO c.stage,c.version
      FROM public.cases physical_case
      CROSS JOIN LATERAL public.case_early_terminal_workflow_context(physical_case) projected
      WHERE physical_case.id=NEW.id AND physical_case.department_id=NEW.department_id;
  END IF;
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
 (c."stage" IN ('EXECUTING','WAITING_ARCHIVE','ARCHIVED') AND EXISTS (SELECT 1 FROM "case_execution_mailings" mm JOIN "case_execution_filings" ff ON ff."mailing_id"=mm."id" AND ff."case_id"=mm."case_id" AND ff."department_id"=mm."department_id" WHERE mm."case_id"=target_case AND mm."department_id"=target_department AND mm."confirmation_id"=f."id" AND mm."from_version"=f."to_version" AND ff."from_version"=mm."to_version" AND ((c."stage"='EXECUTING' AND (ff."to_version"=c."version" OR EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department AND ef."from_version"=ff."to_version" AND ef."to_version"=c."version"))) OR
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
END; $function$;

CREATE OR REPLACE FUNCTION public.check_case_execution_submission_final()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
  -- Only the local litigation head's temporal context changes. No NEW/OLD/fact/DB row projection.
  IF TG_TABLE_NAME='cases' THEN
    SELECT projected.stage,projected.version INTO c.stage,c.version
      FROM public.cases physical_case
      CROSS JOIN LATERAL public.case_early_terminal_workflow_context(physical_case) projected
      WHERE physical_case.id=NEW.id AND physical_case.department_id=NEW.department_id;
  END IF;
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
 (c."stage" IN ('EXECUTING','WAITING_ARCHIVE','ARCHIVED') AND EXISTS (SELECT 1 FROM "case_execution_mailings" mm JOIN "case_execution_filings" ff ON ff."mailing_id"=mm."id" AND ff."case_id"=mm."case_id" AND ff."department_id"=mm."department_id" WHERE mm."case_id"=target_case AND mm."department_id"=target_department AND mm."confirmation_id"=f."id" AND mm."from_version"=f."to_version" AND ff."from_version"=mm."to_version" AND ((c."stage"='EXECUTING' AND (ff."to_version"=c."version" OR EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department AND ef."from_version"=ff."to_version" AND ef."to_version"=c."version"))) OR
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
END; $function$;
COMMIT;
