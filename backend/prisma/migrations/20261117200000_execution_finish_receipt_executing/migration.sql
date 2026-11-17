-- 执行更新停留在强制执行中：收据函数接受 EXECUTING 快照，并允许结案后的待归档版本。
BEGIN;
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
     NOT (NEW."result_snapshot"->>'stage' IN ('EXECUTING','WAITING_ARCHIVE')) OR
     NEW."result_snapshot"->>'version' IS DISTINCT FROM f."to_version"::text OR
     (NEW."result_snapshot"->>'finishedAt')::date IS DISTINCT FROM f."finished_at" OR
     (NEW."result_snapshot"->>'recordedAt')::timestamptz IS DISTINCT FROM f."recorded_at" OR
     NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id"
       AND ((c."stage"='EXECUTING' AND c."version"=f."to_version") OR
            (c."stage"='WAITING_ARCHIVE' AND c."version"=case_closure_terminal_version(NEW."case_id",NEW."department_id",f."id",f."to_version")))) OR
     (SELECT count(*) FROM "case_execution_finish_versions" v WHERE v."finish_id"=f."id") NOT BETWEEN 0 AND 10 OR
     (f."basis_note" IS NULL AND NOT EXISTS (SELECT 1 FROM "case_execution_finish_versions" v WHERE v."finish_id"=f."id")) OR
     EXISTS (SELECT 1 FROM "case_execution_finish_versions" v WHERE v."finish_id"=f."id" AND NOT EXISTS
       (SELECT 1 FROM "material_references" r WHERE r."action_event_id"=f."audit_event_id" AND r."resource_type"='case'
         AND r."resource_id"=NEW."case_id" AND r."purpose"='EXECUTION_FINISH_BASIS'
         AND r."material_id"=v."material_id" AND r."content_version_id"=v."content_version_id")) THEN
    RAISE EXCEPTION 'execution filing receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $function$;
COMMIT;
