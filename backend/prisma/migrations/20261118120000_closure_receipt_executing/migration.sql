-- 结案收据允许强制执行中发起（并推进到待归档）。
BEGIN;
CREATE OR REPLACE FUNCTION public.check_case_closure_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v record;
BEGIN
 SELECT * INTO v FROM "case_closure_versions" WHERE "id"=(NEW."result_snapshot"->>'closureVersionId')::uuid AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id" AND "recorded_by_user_id"=NEW."actor_user_id";
 IF v."id" IS NULL OR jsonb_typeof(NEW."result_snapshot") IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(NEW."result_snapshot"))<>7 OR
  NOT NEW."result_snapshot" ?& ARRAY['id','closureId','closureVersionId','finishId','stage','version','recordedAt'] OR
  NEW."result_snapshot"->>'id' IS DISTINCT FROM NEW."case_id"::text OR NEW."result_snapshot"->>'closureId' IS DISTINCT FROM v."closure_id"::text OR
  NEW."result_snapshot"->'finishId' IS DISTINCT FROM COALESCE(to_jsonb(v."finish_id"),'null'::jsonb) OR
  NOT (NEW."result_snapshot"->>'stage' IN ('WAITING_ARCHIVE','EXECUTING')) OR NEW."result_snapshot"->>'version' IS DISTINCT FROM v."to_version"::text OR (NEW."result_snapshot"->>'recordedAt')::timestamptz IS DISTINCT FROM v."recorded_at" OR
  NEW."command"::text IS DISTINCT FROM (CASE WHEN v."kind"='REGISTER' THEN 'RECORD' ELSE 'CORRECT' END) OR
  NOT EXISTS (SELECT 1 FROM "cases" c JOIN "case_closures" h ON h."case_id"=c."id" AND h."department_id"=c."department_id" WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id" AND c."stage" IN ('WAITING_ARCHIVE','EXECUTING') AND c."version"=v."to_version" AND h."current_version_id"=v."id")
 THEN RAISE EXCEPTION 'closure receipt mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $function$;
COMMIT;
