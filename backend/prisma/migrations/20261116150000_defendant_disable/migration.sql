-- 被告改为可停用（逻辑删除），数据库仍禁止物理删除与身份变更。
ALTER TABLE "case_defendants" ADD COLUMN "disabled_at" timestamptz(3);
ALTER TABLE "case_defendants" ADD COLUMN "disabled_by_user_id" uuid;

-- 停用时间与操作人必须成对出现。
ALTER TABLE "case_defendants"
  ADD CONSTRAINT "case_defendants_disabled_pair_check"
  CHECK (("disabled_at" IS NULL) = ("disabled_by_user_id" IS NULL));

CREATE INDEX "case_defendants_active_idx"
  ON "case_defendants" ("case_id", "department_id")
  WHERE "disabled_at" IS NULL;

-- 允许停用/恢复，其余身份字段仍不可变；联系方式变更仍要求修订号 +1。
CREATE OR REPLACE FUNCTION "reject_case_defendant_identity_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'case defendant identity is immutable' USING ERRCODE='23514';
  END IF;
  IF (to_jsonb(NEW)-'phone'-'address'-'contact_revision'-'disabled_at'-'disabled_by_user_id')
     IS DISTINCT FROM
     (to_jsonb(OLD)-'phone'-'address'-'contact_revision'-'disabled_at'-'disabled_by_user_id')
  THEN
    RAISE EXCEPTION 'case defendant identity is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW."phone" IS DISTINCT FROM OLD."phone" OR NEW."address" IS DISTINCT FROM OLD."address" THEN
    IF NEW."contact_revision" <> OLD."contact_revision"+1 THEN
      RAISE EXCEPTION 'case defendant contacts require a revision' USING ERRCODE='23514';
    END IF;
  ELSIF NEW."contact_revision" <> OLD."contact_revision" THEN
    RAISE EXCEPTION 'case defendant contacts require a revision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
