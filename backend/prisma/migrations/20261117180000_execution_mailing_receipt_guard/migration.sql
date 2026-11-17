-- 邮寄凭证改为选填备注：凭据函数同样允许 0 个版本。
BEGIN;
CREATE OR REPLACE FUNCTION "check_case_execution_mailing_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m record;
BEGIN
  SELECT * INTO m FROM "case_execution_mailings" WHERE "id"=(NEW."result_snapshot"->>'mailingId')::uuid
    AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id" AND "recorded_by_user_id"=NEW."actor_user_id";
  IF m."id" IS NULL OR NEW."result_snapshot"->>'id' IS DISTINCT FROM NEW."case_id"::text OR
     NEW."result_snapshot"->>'confirmationId' IS DISTINCT FROM m."confirmation_id"::text OR
     NEW."result_snapshot"->>'stage' IS DISTINCT FROM 'WAITING_EXECUTION_FILING' OR
     NEW."result_snapshot"->>'version' IS DISTINCT FROM m."to_version"::text OR
     (NEW."result_snapshot"->>'mailedAt')::date IS DISTINCT FROM m."mailed_at" OR
     (NEW."result_snapshot"->>'recordedAt')::timestamptz IS DISTINCT FROM m."recorded_at" OR
     NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id"
       AND c."stage"='WAITING_EXECUTION_FILING' AND c."version"=m."to_version") OR
     (SELECT count(*) FROM "case_execution_mailing_versions" v WHERE v."mailing_id"=m."id") NOT BETWEEN 0 AND 10 THEN
    RAISE EXCEPTION 'execution mailing receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
COMMIT;
