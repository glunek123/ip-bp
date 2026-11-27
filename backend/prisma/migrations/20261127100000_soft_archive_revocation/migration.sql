-- 软撤销：保留归档/结案/入口阶段等历史事实，仅打作废标记。
ALTER TABLE "case_archives" ADD COLUMN IF NOT EXISTS "revoked_at" timestamptz(3);
ALTER TABLE "case_archives" ADD COLUMN IF NOT EXISTS "revoked_by_user_id" uuid;
ALTER TABLE "case_archives" ADD COLUMN IF NOT EXISTS "revocation_reason" varchar(500);

-- 归档触发器：放行「仅 revoked_at 由空变非空」的更新，其余身份/版本头变更仍拒绝。
CREATE OR REPLACE FUNCTION public.check_case_archive_head_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF TG_OP='UPDATE'
    AND OLD."revoked_at" IS NULL AND NEW."revoked_at" IS NOT NULL
    AND NEW."id"=OLD."id"
    AND NEW."case_id"=OLD."case_id"
    AND NEW."department_id"=OLD."department_id"
    AND NEW."closure_id"=OLD."closure_id"
    AND NEW."closure_version_id"=OLD."closure_version_id"
    AND NEW."current_version_id" IS NOT DISTINCT FROM OLD."current_version_id"
 THEN RETURN NEW; END IF;

 IF TG_OP='DELETE' OR NEW."id"<>OLD."id" OR NEW."case_id"<>OLD."case_id" OR NEW."department_id"<>OLD."department_id" OR NEW."closure_id"<>OLD."closure_id" OR NEW."closure_version_id"<>OLD."closure_version_id" OR NEW."current_version_id" IS NULL OR
  NOT EXISTS (SELECT 1 FROM "case_archive_versions" v WHERE v."id"=NEW."current_version_id" AND v."archive_id"=OLD."id" AND v."case_id"=OLD."case_id" AND v."department_id"=OLD."department_id" AND v."closure_version_id"=OLD."closure_version_id" AND v."prior_version_id" IS NOT DISTINCT FROM OLD."current_version_id")
 THEN RAISE EXCEPTION 'immutable archive identity or invalid head advance' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION revoke_case_archive(
  p_case_id uuid, p_department_id uuid, p_user_id uuid, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_archive uuid;
BEGIN
  SELECT id INTO v_archive FROM case_archives
  WHERE case_id = p_case_id AND revoked_at IS NULL LIMIT 1;
  IF v_archive IS NULL THEN RAISE EXCEPTION 'ARCHIVE_NOT_FOUND'; END IF;

  INSERT INTO case_archive_revocations
    (id, case_id, department_id, archive_id, prior_stage, reason, revoked_by_user_id, revoked_at)
  VALUES (gen_random_uuid(), p_case_id, p_department_id, v_archive, 'WAITING_ARCHIVE', p_reason, p_user_id, now());

  UPDATE case_archives
  SET revoked_at = now(), revoked_by_user_id = p_user_id, revocation_reason = p_reason
  WHERE id = v_archive;

  UPDATE cases SET stage = 'WAITING_ARCHIVE', version = version + 1 WHERE id = p_case_id;
  RETURN 'WAITING_ARCHIVE';
END $$;

GRANT EXECUTE ON FUNCTION revoke_case_archive(uuid, uuid, uuid, text) TO PUBLIC;
