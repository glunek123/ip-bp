-- TEMP: 结案终态诊断（带值），定位后回退。
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
 IF c."stage" NOT IN ('WAITING_ARCHIVE','ARCHIVED') OR c."version"<>case_closure_terminal_version(target_case,target_department,h."finish_id",base_version) THEN RAISE EXCEPTION 'closure terminal mismatch table=% stage=% version=% base=% terminal=%', TG_TABLE_NAME, c."stage", c."version", base_version, case_closure_terminal_version(target_case,target_department,h."finish_id",base_version) USING ERRCODE='23514'; END IF;
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
COMMIT;
