-- 允许「执行更新」在外部录入案件上只登记字段、不推进阶段。
-- 原链条要求：存在执行结束行即必须处于「待归档」，与执行更新的语义冲突，
-- 导致外部录入案件（占全部强制执行案件）无法登记执行立案信息。
-- 这里只放行 finish 行存在且阶段仍为 EXECUTING 的组合，版本一致性照旧校验。

CREATE OR REPLACE FUNCTION "ca018_assert_execution_phase_chain"(target_case uuid,target_department uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE c record; e record; s record; q record; m record; f record; x record; h record; a record;
        source_version integer; terminal integer; phase "case_stage"; predecessor record;
BEGIN
 SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
 SELECT * INTO e FROM "case_external_entries" WHERE "case_id"=target_case AND "department_id"=target_department;
 IF c."id" IS NULL OR e."id" IS NULL OR c."source_lead_id" IS NOT NULL OR
    c."source_notary_matter_id" IS NOT NULL OR c."certificate_id" IS NOT NULL
 THEN RAISE EXCEPTION 'execution external root mismatch' USING ERRCODE='23514'; END IF;
 SELECT * INTO s FROM "case_execution_submissions" WHERE "id"=c."current_execution_submission_id" AND "case_id"=target_case AND "department_id"=target_department;
 SELECT * INTO q FROM "case_execution_confirmations" WHERE "case_id"=target_case AND "department_id"=target_department;
 SELECT * INTO m FROM "case_execution_mailings" WHERE "case_id"=target_case AND "department_id"=target_department;
 SELECT * INTO f FROM "case_execution_filings" WHERE "case_id"=target_case AND "department_id"=target_department;
 SELECT * INTO x FROM "case_execution_finishes" WHERE "case_id"=target_case AND "department_id"=target_department;
 SELECT * INTO h FROM "case_closures" WHERE "case_id"=target_case AND "department_id"=target_department;
 SELECT * INTO a FROM "case_archives" WHERE "case_id"=target_case AND "department_id"=target_department;
 IF (s."id" IS NULL AND EXISTS (SELECT 1 FROM "case_execution_submissions" z WHERE z."case_id"=target_case AND z."department_id"=target_department)) OR
    (s."id" IS NOT NULL AND e."initial_stage" IN ('WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED')) OR
    (s."id" IS NOT NULL AND (s."external_entry_id" IS DISTINCT FROM e."id" OR s."trial_round_id" IS DISTINCT FROM c."current_trial_round_id" OR
      s."judgment_next_step_id" IS DISTINCT FROM c."current_judgment_next_step_id" OR s."second_instance_result_id" IS DISTINCT FROM c."current_second_instance_result_id"))
 THEN RAISE EXCEPTION 'execution submission pointer or source mismatch' USING ERRCODE='23514'; END IF;
 phase:=e."initial_stage"; terminal:=1;
 IF s."id" IS NOT NULL THEN
  IF s."prior_submission_id" IS NULL THEN
   IF s."judgment_next_step_id" IS NOT NULL THEN
    SELECT * INTO predecessor FROM "case_judgment_next_steps" z WHERE z."id"=s."judgment_next_step_id" AND z."case_id"=target_case AND z."department_id"=target_department;
    IF predecessor."id" IS NULL OR predecessor."external_entry_id" IS DISTINCT FROM e."id" THEN RAISE EXCEPTION 'execution choice source mismatch' USING ERRCODE='23514'; END IF;
    IF predecessor."next"='APPEAL' THEN
      SELECT * INTO predecessor FROM "case_second_instance_results" z WHERE z."id"=s."second_instance_result_id" AND z."case_id"=target_case AND z."department_id"=target_department AND z."choice_id"=s."judgment_next_step_id" AND z."result" IN ('AFFIRM','CHANGE') AND NOT EXISTS (SELECT 1 FROM "case_second_instance_result_revocations" r WHERE r."result_id"=z."id");
      IF predecessor."id" IS NULL OR predecessor."external_entry_id" IS DISTINCT FROM e."id" THEN RAISE EXCEPTION 'execution appeal source mismatch' USING ERRCODE='23514'; END IF;
    ELSIF predecessor."next"<>'EXECUTION' OR s."second_instance_result_id" IS NOT NULL THEN
      RAISE EXCEPTION 'execution choice result mismatch' USING ERRCODE='23514';
    END IF;
    source_version:=predecessor."to_version";
   ELSIF e."initial_stage"='SECOND_INSTANCE' THEN
    SELECT * INTO predecessor FROM "case_second_instance_results" z WHERE z."id"=s."second_instance_result_id" AND z."case_id"=target_case AND z."department_id"=target_department AND z."choice_id" IS NULL AND z."result" IN ('AFFIRM','CHANGE');
    IF predecessor."id" IS NULL OR predecessor."external_entry_id" IS DISTINCT FROM e."id" THEN RAISE EXCEPTION 'execution direct appeal source mismatch' USING ERRCODE='23514'; END IF;
    source_version:=predecessor."to_version";
   ELSIF e."initial_stage"='WAITING_EXECUTION_DOCUMENTS' AND s."second_instance_result_id" IS NULL THEN source_version:=1;
   ELSE RAISE EXCEPTION 'execution submission source stage mismatch' USING ERRCODE='23514'; END IF;
   IF s."from_version" IS DISTINCT FROM source_version THEN RAISE EXCEPTION 'execution submission initial version mismatch' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT * INTO predecessor FROM "case_execution_submissions" z WHERE z."id"=s."prior_submission_id" AND z."case_id"=target_case AND z."department_id"=target_department;
   IF predecessor."id" IS NULL OR predecessor."external_entry_id" IS DISTINCT FROM e."id" OR predecessor."to_version" IS DISTINCT FROM s."from_version"
   THEN RAISE EXCEPTION 'execution resubmission predecessor mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  IF s."to_version" IS DISTINCT FROM s."from_version"+1 THEN RAISE EXCEPTION 'execution submission version gap' USING ERRCODE='23514'; END IF;
  phase:='WAITING_EXECUTION_CONFIRMATION'; terminal:=s."to_version";
 END IF;
 IF q."id" IS NOT NULL THEN
  IF q."external_entry_id" IS DISTINCT FROM e."id" OR
    NOT ((s."id" IS NOT NULL AND q."submission_id" IS NOT DISTINCT FROM s."id" AND q."from_version" IS NOT DISTINCT FROM terminal) OR
         (s."id" IS NULL AND e."initial_stage"='WAITING_EXECUTION_CONFIRMATION' AND q."submission_id" IS NULL AND q."from_version"=1)) OR
    q."to_version" IS DISTINCT FROM q."from_version"+1
  THEN RAISE EXCEPTION 'execution confirmation source/version mismatch' USING ERRCODE='23514'; END IF;
  phase:='WAITING_EXECUTION_STAMP'; terminal:=q."to_version";
 END IF;
 IF m."id" IS NOT NULL THEN
  IF m."external_entry_id" IS DISTINCT FROM e."id" OR
    NOT ((q."id" IS NOT NULL AND m."confirmation_id" IS NOT DISTINCT FROM q."id" AND m."from_version" IS NOT DISTINCT FROM terminal) OR
         (q."id" IS NULL AND s."id" IS NULL AND e."initial_stage"='WAITING_EXECUTION_STAMP' AND m."confirmation_id" IS NULL AND m."from_version"=1)) OR
    m."to_version" IS DISTINCT FROM m."from_version"+1
  THEN RAISE EXCEPTION 'execution mailing source/version mismatch' USING ERRCODE='23514'; END IF;
  phase:='WAITING_EXECUTION_FILING'; terminal:=m."to_version";
 END IF;
 IF f."id" IS NOT NULL THEN
  IF f."external_entry_id" IS DISTINCT FROM e."id" OR
    NOT ((m."id" IS NOT NULL AND f."mailing_id" IS NOT DISTINCT FROM m."id" AND f."from_version" IS NOT DISTINCT FROM terminal) OR
         (m."id" IS NULL AND q."id" IS NULL AND s."id" IS NULL AND e."initial_stage"='WAITING_EXECUTION_FILING' AND f."mailing_id" IS NULL AND f."from_version"=1)) OR
    f."to_version" IS DISTINCT FROM f."from_version"+1
  THEN RAISE EXCEPTION 'execution filing source/version mismatch' USING ERRCODE='23514'; END IF;
  phase:='EXECUTING'; terminal:=f."to_version";
 END IF;
 IF x."id" IS NOT NULL THEN
  IF x."external_entry_id" IS DISTINCT FROM e."id" OR
    NOT ((f."id" IS NOT NULL AND x."filing_id" IS NOT DISTINCT FROM f."id" AND x."from_version" IS NOT DISTINCT FROM terminal) OR
         (f."id" IS NULL AND m."id" IS NULL AND q."id" IS NULL AND s."id" IS NULL AND e."initial_stage"='EXECUTING' AND x."filing_id" IS NULL AND x."from_version"=1)) OR
    x."to_version" IS DISTINCT FROM x."from_version"+1
  THEN RAISE EXCEPTION 'execution finish source/version mismatch' USING ERRCODE='23514'; END IF;
  phase:='WAITING_ARCHIVE'; terminal:=x."to_version";
 END IF;
 IF h."id" IS NOT NULL THEN
  IF h."external_entry_id" IS DISTINCT FROM e."id" OR
    NOT ((x."id" IS NOT NULL AND h."finish_id" IS NOT DISTINCT FROM x."id") OR
         (x."id" IS NULL AND f."id" IS NULL AND m."id" IS NULL AND q."id" IS NULL AND s."id" IS NULL AND e."initial_stage"='WAITING_ARCHIVE' AND h."finish_id" IS NULL))
  THEN RAISE EXCEPTION 'closure lacks actual finish or entry root' USING ERRCODE='23514'; END IF;
  terminal:=case_closure_source_terminal_version(target_case,target_department,h."finish_id",terminal);
  phase:='WAITING_ARCHIVE';
 END IF;
 IF a."id" IS NOT NULL THEN
  IF h."id" IS NULL OR a."closure_id" IS DISTINCT FROM h."id" OR a."closure_version_id" IS DISTINCT FROM h."current_version_id"
  THEN RAISE EXCEPTION 'archive lacks actual closure version' USING ERRCODE='23514'; END IF;
  terminal:=case_archive_terminal_version(target_case,target_department,h."id",h."current_version_id",terminal);
  phase:='ARCHIVED';
 END IF;
 -- 执行更新（finish）只登记字段、不推进阶段，此时案件会同时持有 finish 行
 -- 与「强制执行中」阶段。放行这一种组合，其余不一致仍然拦截。
 IF (c."stage" IS DISTINCT FROM phase
     AND NOT (x."id" IS NOT NULL AND c."stage" = 'EXECUTING'))
   OR c."version" IS DISTINCT FROM terminal
 THEN RAISE EXCEPTION 'execution external terminal mismatch' USING ERRCODE='23514'; END IF;
END; $$;
