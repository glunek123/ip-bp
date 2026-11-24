-- 用户确认（2026-11-24）：律师库对所有运营角色开放读写，部门范围。
-- 上一支迁移只把权限复制给「管理律师账号」的授权方，导致仅知产运营可见。
-- 本迁移给所有启用中的角色模板补 lawyer.profile.read / manage，幂等可重跑。
-- 新建角色模板仍需在角色模板编辑器里勾选这两项，迁移不覆盖未来模板。

BEGIN;

WITH "targets" AS (
  SELECT t."id" AS "role_template_id"
  FROM "role_templates" t
  WHERE t."active"
), "inserted" AS (
  INSERT INTO "role_grants" ("id", "role_template_id", "action", "scope")
  SELECT (
    SUBSTR(MD5(tg."role_template_id"::text || ':' || a."action"::text || ':all-roles'), 1, 8) || '-' ||
    SUBSTR(MD5(tg."role_template_id"::text || ':' || a."action"::text || ':all-roles'), 9, 4) || '-4' ||
    SUBSTR(MD5(tg."role_template_id"::text || ':' || a."action"::text || ':all-roles'), 14, 3) || '-8' ||
    SUBSTR(MD5(tg."role_template_id"::text || ':' || a."action"::text || ':all-roles'), 18, 3) || '-' ||
    SUBSTR(MD5(tg."role_template_id"::text || ':' || a."action"::text || ':all-roles'), 21, 12)
  )::UUID,
  tg."role_template_id",
  a."action",
  'DEPARTMENT'::"permission_scope"
  FROM "targets" tg
  CROSS JOIN (
    VALUES
      ('lawyer.profile.read'::"permission_action"),
      ('lawyer.profile.manage'::"permission_action")
  ) AS a("action")
  ON CONFLICT ("role_template_id", "action", "scope") DO NOTHING
  RETURNING "role_template_id"
), "affected_templates" AS (
  UPDATE "role_templates"
  SET "version" = "version" + 1, "updated_at" = CURRENT_TIMESTAMP
  WHERE "id" IN (SELECT DISTINCT "role_template_id" FROM "inserted")
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
