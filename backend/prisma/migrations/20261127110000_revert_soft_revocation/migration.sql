-- 撤销软撤销实验：产品口径确定为「撤销即退回结案前」（A 方案），
-- 归档与结案随撤销一并作废，因此撤回 revoked_at 字段并恢复触发器原语义。

ALTER TABLE "case_archives" DROP COLUMN IF EXISTS "revoked_at";
ALTER TABLE "case_archives" DROP COLUMN IF EXISTS "revoked_by_user_id";
ALTER TABLE "case_archives" DROP COLUMN IF EXISTS "revocation_reason";

CREATE OR REPLACE FUNCTION public.check_case_archive_head_mutation()
 RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
 IF TG_OP='DELETE' OR NEW."id"<>OLD."id" OR NEW."case_id"<>OLD."case_id" OR NEW."department_id"<>OLD."department_id" OR NEW."closure_id"<>OLD."closure_id" OR NEW."closure_version_id"<>OLD."closure_version_id" OR NEW."current_version_id" IS NULL OR
  NOT EXISTS (SELECT 1 FROM "case_archive_versions" v WHERE v."id"=NEW."current_version_id" AND v."archive_id"=OLD."id" AND v."case_id"=OLD."case_id" AND v."department_id"=OLD."department_id" AND v."closure_version_id"=OLD."closure_version_id" AND v."prior_version_id" IS NOT DISTINCT FROM OLD."current_version_id")
 THEN RAISE EXCEPTION 'immutable archive identity or invalid head advance' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $function$;

-- 撤销：按 A 口径作废归档与结案，退回待归档（保留撤销留痕）。
CREATE OR REPLACE FUNCTION revoke_case_archive(
  p_case_id uuid, p_department_id uuid, p_user_id uuid, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_archive uuid;
BEGIN
  SELECT id INTO v_archive FROM case_archives WHERE case_id = p_case_id LIMIT 1;
  IF v_archive IS NULL THEN RAISE EXCEPTION 'ARCHIVE_NOT_FOUND'; END IF;

  INSERT INTO case_archive_revocations
    (id, case_id, department_id, archive_id, prior_stage, reason, revoked_by_user_id, revoked_at)
  VALUES (gen_random_uuid(), p_case_id, p_department_id, v_archive, 'WAITING_ARCHIVE', p_reason, p_user_id, now());

  ALTER TABLE case_archives DISABLE TRIGGER USER;
  DELETE FROM case_archives WHERE id = v_archive;
  ALTER TABLE case_archives ENABLE TRIGGER USER;

  ALTER TABLE case_closure_versions DISABLE TRIGGER USER;
  DELETE FROM case_closure_versions WHERE case_id = p_case_id;
  ALTER TABLE case_closure_versions ENABLE TRIGGER USER;
  ALTER TABLE case_closures DISABLE TRIGGER USER;
  DELETE FROM case_closures WHERE case_id = p_case_id;
  ALTER TABLE case_closures ENABLE TRIGGER USER;

  ALTER TABLE case_external_entries DISABLE TRIGGER USER;
  UPDATE case_external_entries SET initial_stage = 'WAITING_ARCHIVE' WHERE case_id = p_case_id;
  ALTER TABLE case_external_entries ENABLE TRIGGER USER;

  ALTER TABLE cases DISABLE TRIGGER USER;
  UPDATE cases SET stage = 'WAITING_ARCHIVE', version = version + 1 WHERE id = p_case_id;
  ALTER TABLE cases ENABLE TRIGGER USER;

  RETURN 'WAITING_ARCHIVE';
END $$;
