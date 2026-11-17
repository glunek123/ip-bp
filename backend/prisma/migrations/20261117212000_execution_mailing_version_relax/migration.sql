-- 执行更新停留在强制执行中：邮寄链允许后续立案记录接管当前版本。
BEGIN;
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
           AND f."mailing_id"=m."id" AND f."from_version"=m."to_version" AND (f."to_version"=c."version" OR
             EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND
               ef."department_id"=target_department AND ef."from_version"=f."to_version" AND ef."to_version"=c."version"))))) OR
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
COMMIT;
