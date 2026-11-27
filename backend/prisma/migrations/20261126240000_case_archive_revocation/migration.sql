CREATE TABLE IF NOT EXISTS "case_archive_revocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "archive_id" uuid NOT NULL,
  "prior_stage" varchar(50) NOT NULL,
  "reason" varchar(500) NOT NULL,
  "revoked_by_user_id" uuid NOT NULL,
  "revoked_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "case_archive_revocations_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "case_archive_revocations_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX IF NOT EXISTS "case_archive_revocations_case_id_idx" ON "case_archive_revocations"("case_id");
CREATE INDEX IF NOT EXISTS "case_archive_revocations_department_id_idx" ON "case_archive_revocations"("department_id");

-- 撤销归档：写留痕、移除归档与结案、同步入口阶段、退回待归档。
-- 相关表使用 ENABLE ALWAYS 触发器，replica 模式无效，函数内需临时禁用 USER 触发器；
-- 属过渡方案，长期应改为软撤销（保留归档记录 + 投影排除）。
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

GRANT EXECUTE ON FUNCTION revoke_case_archive(uuid, uuid, uuid, text) TO PUBLIC;
