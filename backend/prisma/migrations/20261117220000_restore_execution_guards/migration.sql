-- 撤回「执行更新不推进阶段」的守卫放宽，恢复原始阶段/版本约束。
BEGIN;
CREATE OR REPLACE FUNCTION public.check_case_closure_final()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; c record; f record; h record; v record; a record; selected jsonb; base_version integer; entry_root "case_external_entries"%ROWTYPE; early record;
BEGIN
  IF TG_TABLE_NAME = 'cases' AND TG_OP = 'UPDATE' THEN
    IF case_early_closure_transition(OLD, NEW) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN
    IF TG_OP = 'UPDATE' THEN
      IF case_early_archive_transition(OLD, NEW) THEN RETURN NEW; END IF;
    END IF;
  END IF;
IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; target_department:=NEW."department_id";
 ELSE target_case:=NEW."case_id"; target_department:=NEW."department_id"; END IF;
 SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
 SELECT * INTO h FROM "case_closures" WHERE "case_id"=target_case AND "department_id"=target_department;
 IF h."id" IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO f FROM "case_execution_finishes" WHERE "id"=h."finish_id" AND "case_id"=target_case AND "department_id"=target_department;
 IF h."early_closure_id" IS NOT NULL THEN
  SELECT * INTO early FROM "case_early_closures" WHERE "id"=h."early_closure_id" AND
    "case_id"=target_case AND "department_id"=target_department;
  IF early."id" IS NULL OR h."finish_id" IS NOT NULL OR h."external_entry_id" IS NOT NULL OR
     f."id" IS NOT NULL OR EXISTS (SELECT 1 FROM "case_early_archives" WHERE "case_id"=target_case AND "department_id"=target_department)
  THEN RAISE EXCEPTION 'closure lacks exact early source root' USING ERRCODE='23514'; END IF;
  base_version:=early."to_version";
 ELSE
 IF f."id" IS NULL THEN
  SELECT * INTO entry_root FROM "case_external_entries" WHERE "case_id"=target_case AND "department_id"=target_department AND "initial_stage"='WAITING_ARCHIVE';
  IF h."finish_id" IS NOT NULL OR h."external_entry_id" IS DISTINCT FROM entry_root."id" OR entry_root."id" IS NULL OR
   c."source_lead_id" IS NOT NULL OR c."source_notary_matter_id" IS NOT NULL OR c."certificate_id" IS NOT NULL OR
   EXISTS (SELECT 1 FROM "case_execution_finishes" x WHERE x."case_id"=target_case AND x."department_id"=target_department)
  THEN RAISE EXCEPTION 'closure lacks exact external finish root' USING ERRCODE='23514'; END IF;
  base_version:=1;
 ELSE
  base_version:=f."to_version";
 END IF;
 END IF;
 IF c."stage" NOT IN ('WAITING_ARCHIVE','ARCHIVED') OR c."version"<>case_closure_terminal_version(target_case,target_department,h."finish_id",base_version) THEN RAISE EXCEPTION 'closure terminal mismatch' USING ERRCODE='23514'; END IF;
 FOR v IN SELECT * FROM "case_closure_versions" WHERE "closure_id"=h."id" LOOP
  SELECT * INTO a FROM "audit_events" WHERE "id"=v."audit_event_id";
  selected:=a."details"->'closeContentVersionIds';
  IF v."finish_id" IS DISTINCT FROM h."finish_id" OR (v."early_closure_id" IS DISTINCT FROM h."early_closure_id") OR (f."id" IS NULL AND h."early_closure_id" IS NULL AND v."external_entry_id" IS DISTINCT FROM entry_root."id") OR
   a."id" IS NULL OR a."actor_kind"<>'HUMAN' OR a."department_id"<>target_department OR a."resource_type"<>'CASE' OR a."resource_id"<>target_case OR a."actor_user_id"<>v."recorded_by_user_id" OR
   a."action" IS DISTINCT FROM (CASE WHEN v."kind"='REGISTER' THEN 'case.closure.recorded' ELSE 'case.closure.corrected' END) OR
   (a."internal_actor_user_id" IS DISTINCT FROM v."recorded_by_user_id" AND (v."kind"<>'REGISTER' OR NOT EXISTS (SELECT 1 FROM "lawyer_account_bindings" b WHERE b."id"=a."lawyer_account_binding_id" AND b."user_id"=v."recorded_by_user_id" AND b."department_id"=target_department))) OR
   a."details"->>'closureId' IS DISTINCT FROM h."id"::text OR a."details"->>'closureVersionId' IS DISTINCT FROM v."id"::text OR
   a."details"->'finishId' IS DISTINCT FROM COALESCE(to_jsonb(h."finish_id"),'null'::jsonb) OR
   a."details"->'priorVersionId' IS DISTINCT FROM COALESCE(to_jsonb(v."prior_version_id"),'null'::jsonb) OR a."details"->>'fromVersion' IS DISTINCT FROM v."from_version"::text OR a."details"->>'toVersion' IS DISTINCT FROM v."to_version"::text OR
   a."details"->'closeAt' IS DISTINCT FROM COALESCE(to_jsonb(v."close_at"),'null'::jsonb) OR a."details"->>'closeAmountState' IS DISTINCT FROM v."close_amount_state"::text OR a."details"->'closeAmt' IS DISTINCT FROM COALESCE(to_jsonb(v."close_amt"::text),'null'::jsonb) OR
   a."details"->'note' IS DISTINCT FROM COALESCE(to_jsonb(v."note"),'null'::jsonb) OR a."details"->'correctionReason' IS DISTINCT FROM COALESCE(to_jsonb(v."correction_reason"),'null'::jsonb) OR
   jsonb_typeof(selected) IS DISTINCT FROM 'array' OR jsonb_array_length(selected) NOT BETWEEN 0 AND 10 OR
   (SELECT count(*) FROM "case_closure_documents" d WHERE d."closure_version_id"=v."id")<>jsonb_array_length(selected) OR
   EXISTS (SELECT 1 FROM "case_closure_documents" d WHERE d."closure_version_id"=v."id" AND (NOT selected ? d."content_version_id"::text OR NOT EXISTS (SELECT 1 FROM "material_references" r WHERE r."action_event_id"=v."audit_event_id" AND r."department_id"=target_department AND r."resource_type"='case' AND r."resource_id"=target_case AND r."purpose"='CASE_CLOSURE_DOCUMENT' AND r."material_id"=d."material_id" AND r."content_version_id"=d."content_version_id"))) OR
   NOT EXISTS (SELECT 1 FROM "case_closure_receipts" r WHERE r."case_id"=target_case AND r."department_id"=target_department AND r."actor_user_id"=v."recorded_by_user_id" AND r."result_snapshot"->>'closureVersionId'=v."id"::text)
  THEN RAISE EXCEPTION 'closure audit/reference/receipt mismatch' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END; $function$;

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
END; $function$;

CREATE OR REPLACE FUNCTION public.check_case_execution_filing_final()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; c record; f record; m record; audit record; selected jsonb;
BEGIN
  IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; target_department:=NEW."department_id";
  ELSE target_case:=NEW."case_id"; target_department:=NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
  SELECT * INTO f FROM "case_execution_filings" WHERE "case_id"=target_case AND "department_id"=target_department;
  IF f."id" IS NULL THEN
    IF c."stage"='EXECUTING' THEN RAISE EXCEPTION 'execution filing missing' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO m FROM "case_execution_mailings" WHERE "id"=f."mailing_id" AND "case_id"=target_case AND "department_id"=target_department;
  SELECT * INTO audit FROM "audit_events" WHERE "id"=f."audit_event_id";
  selected:=audit."details"->'executionFilingProofContentVersionIds';
  IF m."id" IS NULL OR m."confirmation_id" IS DISTINCT FROM
       (SELECT x."id" FROM "case_execution_confirmations" x WHERE x."case_id"=target_case AND x."department_id"=target_department) OR
     c."stage"<>'EXECUTING' OR c."version"<>f."to_version" OR
     f."from_version"<>m."to_version" OR f."to_version"<>f."from_version"+1 OR
     audit."id" IS NULL OR audit."department_id"<>target_department OR audit."resource_type"<>'CASE' OR
     audit."resource_id"<>target_case OR audit."actor_kind"<>'HUMAN' OR
     audit."actor_user_id"<>f."submitted_by_user_id" OR audit."action"<>'case.execution.filing.submitted' OR
     audit."details"->>'filingId' IS DISTINCT FROM f."id"::text OR
     audit."details"->>'mailingId' IS DISTINCT FROM f."mailing_id"::text OR
     audit."details"->>'fromVersion' IS DISTINCT FROM f."from_version"::text OR
     audit."details"->>'toVersion' IS DISTINCT FROM f."to_version"::text OR
     (audit."details"->>'submittedAt')::date IS DISTINCT FROM f."submitted_at" OR
     jsonb_typeof(selected) IS DISTINCT FROM 'array' OR jsonb_array_length(selected) NOT BETWEEN 0 AND 10 OR
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
END; $function$;

CREATE OR REPLACE FUNCTION public.check_case_execution_finish_final()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
  -- Only the local litigation head's temporal context changes. No NEW/OLD/fact/DB row projection.
  IF TG_TABLE_NAME='cases' THEN
    SELECT projected.stage,projected.version INTO c.stage,c.version
      FROM public.cases physical_case
      CROSS JOIN LATERAL public.case_early_terminal_workflow_context(physical_case) projected
      WHERE physical_case.id=NEW.id AND physical_case.department_id=NEW.department_id;
  END IF;
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
END; $function$;

CREATE OR REPLACE FUNCTION public.check_case_execution_finish_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM "case_execution_finishes" WHERE "id"=(NEW."result_snapshot"->>'finishId')::uuid
    AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id" AND "recorded_by_user_id"=NEW."actor_user_id";
  IF jsonb_typeof(NEW."result_snapshot") IS DISTINCT FROM 'object' OR
     (SELECT count(*) FROM jsonb_object_keys(NEW."result_snapshot"))<>7 OR
     NOT NEW."result_snapshot" ?& ARRAY['id','finishId','filingId','stage','version','finishedAt','recordedAt'] OR
     f."id" IS NULL OR NEW."result_snapshot"->>'id' IS DISTINCT FROM NEW."case_id"::text OR
     NEW."result_snapshot"->'filingId' IS DISTINCT FROM COALESCE(to_jsonb(f."filing_id"),'null'::jsonb) OR
     NEW."result_snapshot"->>'stage' IS DISTINCT FROM 'WAITING_ARCHIVE' OR
     NEW."result_snapshot"->>'version' IS DISTINCT FROM f."to_version"::text OR
     (NEW."result_snapshot"->>'finishedAt')::date IS DISTINCT FROM f."finished_at" OR
     (NEW."result_snapshot"->>'recordedAt')::timestamptz IS DISTINCT FROM f."recorded_at" OR
     NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id"
       AND c."stage"='WAITING_ARCHIVE' AND c."version"=f."to_version") OR
     (SELECT count(*) FROM "case_execution_finish_versions" v WHERE v."finish_id"=f."id") NOT BETWEEN 0 AND 10 OR
     (f."basis_note" IS NULL AND NOT EXISTS (SELECT 1 FROM "case_execution_finish_versions" v WHERE v."finish_id"=f."id")) OR
     EXISTS (SELECT 1 FROM "case_execution_finish_versions" v WHERE v."finish_id"=f."id" AND NOT EXISTS
       (SELECT 1 FROM "material_references" r WHERE r."action_event_id"=f."audit_event_id" AND r."resource_type"='case'
         AND r."resource_id"=NEW."case_id" AND r."purpose"='EXECUTION_FINISH_BASIS'
         AND r."material_id"=v."material_id" AND r."content_version_id"=v."content_version_id")) THEN
    RAISE EXCEPTION 'execution filing receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.check_case_execution_mailing_final()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; c record; m record; conf record; audit record; selected jsonb;
BEGIN
  IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; target_department:=NEW."department_id";
  ELSE target_case:=NEW."case_id"; target_department:=NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
  SELECT * INTO m FROM "case_execution_mailings" WHERE "case_id"=target_case AND "department_id"=target_department;
  IF m."id" IS NULL THEN
    IF c."stage" IN ('WAITING_EXECUTION_FILING','EXECUTING') THEN
      RAISE EXCEPTION 'execution mailing missing' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO conf FROM "case_execution_confirmations" WHERE "id"=m."confirmation_id"
    AND "case_id"=target_case AND "department_id"=target_department;
  SELECT * INTO audit FROM "audit_events" WHERE "id"=m."audit_event_id";
  selected:=audit."details"->'mailReceiptContentVersionIds';
  IF conf."id" IS NULL OR conf."submission_id" IS DISTINCT FROM c."current_execution_submission_id" OR
     m."from_version"<>conf."to_version" OR m."to_version"<>m."from_version"+1 OR
     NOT ((c."stage"='WAITING_EXECUTION_FILING' AND c."version"=m."to_version" AND NOT EXISTS
       (SELECT 1 FROM "case_execution_filings" f WHERE f."case_id"=target_case AND f."department_id"=target_department)) OR
       (c."stage"='EXECUTING' AND EXISTS (SELECT 1 FROM "case_execution_filings" f
         WHERE f."case_id"=target_case AND f."department_id"=target_department
           AND f."mailing_id"=m."id" AND f."from_version"=m."to_version" AND f."to_version"=c."version"))) OR
     audit."id" IS NULL OR audit."department_id"<>target_department OR audit."resource_type"<>'CASE' OR
     audit."resource_id"<>target_case OR audit."actor_kind"<>'HUMAN' OR
     audit."actor_user_id"<>m."recorded_by_user_id" OR audit."action"<>'case.execution.mailed' OR
     (m."actor_type"='INTERNAL' AND audit."internal_actor_user_id" IS DISTINCT FROM m."recorded_by_user_id") OR
     (m."actor_type"='CLIENT' AND audit."customer_account_binding_id" IS DISTINCT FROM m."customer_account_binding_id") OR
     (m."actor_type"='LAWYER' AND audit."lawyer_account_binding_id" IS DISTINCT FROM m."lawyer_account_binding_id") OR
     audit."details"->>'actorType' IS DISTINCT FROM m."actor_type"::text OR
     audit."details"->>'mailingId' IS DISTINCT FROM m."id"::text OR
     audit."details"->>'confirmationId' IS DISTINCT FROM m."confirmation_id"::text OR
     audit."details"->>'fromVersion' IS DISTINCT FROM m."from_version"::text OR
     audit."details"->>'toVersion' IS DISTINCT FROM m."to_version"::text OR
     (audit."details"->>'mailedAt')::date IS DISTINCT FROM m."mailed_at" OR
     jsonb_typeof(selected) IS DISTINCT FROM 'array' OR jsonb_array_length(selected) NOT BETWEEN 0 AND 10 OR
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
END; $function$;
COMMIT;
