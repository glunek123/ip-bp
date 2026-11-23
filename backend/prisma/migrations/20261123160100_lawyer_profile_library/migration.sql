-- 律师库：档案扩展字段、启停与来源回填，并向现有律师账号管理授权复制律师库读写权限。
-- 只加列与加索引；不改现有列语义，不重建 lawyer_account_bindings 触发器。

BEGIN;

ALTER TABLE "lawyer_profiles"
  ADD COLUMN "email" VARCHAR(200),
  ADD COLUMN "bar_number" VARCHAR(100),
  ADD COLUMN "law_firm_credit_code" VARCHAR(50),
  ADD COLUMN "region" VARCHAR(100),
  ADD COLUMN "status" "lawyer_profile_status" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "source" "lawyer_profile_source" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 历史档案来源：存在账号或绑定的记为账号创建，其余为案件匹配遗留。
UPDATE "lawyer_profiles" p
SET "source" = CASE
  WHEN p."bound_user_id" IS NOT NULL
    OR EXISTS (SELECT 1 FROM "lawyer_account_bindings" b WHERE b."profile_id" = p."id")
  THEN 'ACCOUNT_CREATE'::"lawyer_profile_source"
  ELSE 'LEGACY_MATCH'::"lawyer_profile_source"
END;

CREATE INDEX "lawyer_profiles_department_id_status_full_name_idx"
  ON "lawyer_profiles" ("department_id", "status", "full_name");
CREATE INDEX "lawyer_profiles_department_id_law_firm_idx"
  ON "lawyer_profiles" ("department_id", "law_firm");

-- 律师库读写权限对齐现有「管理律师账号」的部门授权，不额外给任何角色增权。
WITH "copied" AS (
  INSERT INTO "role_grants" ("id", "role_template_id", "action", "scope")
  SELECT (
    SUBSTR(MD5(src."role_template_id"::text || ':' || a."action"::text || ':department'), 1, 8) || '-' ||
    SUBSTR(MD5(src."role_template_id"::text || ':' || a."action"::text || ':department'), 9, 4) || '-4' ||
    SUBSTR(MD5(src."role_template_id"::text || ':' || a."action"::text || ':department'), 14, 3) || '-8' ||
    SUBSTR(MD5(src."role_template_id"::text || ':' || a."action"::text || ':department'), 18, 3) || '-' ||
    SUBSTR(MD5(src."role_template_id"::text || ':' || a."action"::text || ':department'), 21, 12)
  )::UUID,
  src."role_template_id",
  a."action",
  'DEPARTMENT'::"permission_scope"
  FROM "role_grants" src
  CROSS JOIN (
    VALUES
      ('lawyer.profile.read'::"permission_action"),
      ('lawyer.profile.manage'::"permission_action")
  ) AS a("action")
  WHERE src."action" = 'lawyer.account.manage'::"permission_action"
    AND src."scope" = 'DEPARTMENT'::"permission_scope"
  ON CONFLICT ("role_template_id", "action", "scope") DO NOTHING
  RETURNING "role_template_id"
), "affected_templates" AS (
  UPDATE "role_templates"
  SET "version" = "version" + 1, "updated_at" = CURRENT_TIMESTAMP
  WHERE "id" IN (SELECT DISTINCT "role_template_id" FROM "copied")
  RETURNING "id"
)
UPDATE "user_accounts"
SET "authorization_revision" = "authorization_revision" + 1, "updated_at" = CURRENT_TIMESTAMP
WHERE "id" IN (
  SELECT ra."user_id"
  FROM "role_assignments" ra
  JOIN "affected_templates" t ON t."id" = ra."role_template_id"
  WHERE ra."active"
);

COMMIT;
