-- 执行更新停留在强制执行中：立案链允许后续立案记录接管当前版本。
BEGIN;
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
     (c."stage" IN ('WAITING_ARCHIVE','ARCHIVED') AND NOT EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department AND ef."from_version"=f."to_version")) OR
     (c."stage"='EXECUTING' AND c."version"<>f."to_version" AND NOT EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department AND ef."from_version"=f."to_version" AND ef."to_version"=c."version")) OR
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
COMMIT;
