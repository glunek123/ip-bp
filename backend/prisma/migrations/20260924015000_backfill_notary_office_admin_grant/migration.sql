BEGIN;

CREATE TEMP TABLE "notary_admin_grant_roles" ON COMMIT DROP AS
SELECT "role"."id", "role"."department_id"
FROM "role_templates" AS "role"
WHERE "role"."name" = '系统管理员'
  AND "role"."active" = true
  AND EXISTS (
    SELECT 1 FROM "role_grants" AS "grant"
    WHERE "grant"."role_template_id" = "role"."id"
      AND "grant"."action" = 'role.manage'
      AND "grant"."scope" = 'DEPARTMENT'
  );

INSERT INTO "role_grants" ("id", "role_template_id", "action", "scope")
SELECT (
  SUBSTR(MD5("candidate"."id"::text || ':notary.office.manage'), 1, 8) || '-' ||
  SUBSTR(MD5("candidate"."id"::text || ':notary.office.manage'), 9, 4) || '-4' ||
  SUBSTR(MD5("candidate"."id"::text || ':notary.office.manage'), 14, 3) || '-8' ||
  SUBSTR(MD5("candidate"."id"::text || ':notary.office.manage'), 18, 3) || '-' ||
  SUBSTR(MD5("candidate"."id"::text || ':notary.office.manage'), 21, 12)
)::uuid, "candidate"."id", 'notary.office.manage'::"permission_action", 'DEPARTMENT'
FROM "notary_admin_grant_roles" AS "candidate"
ON CONFLICT ("role_template_id", "action", "scope") DO NOTHING;

UPDATE "user_accounts" AS "account"
SET "authorization_revision" = "authorization_revision" + 1,
    "updated_at" = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM "role_assignments" AS "assignment"
  JOIN "notary_admin_grant_roles" AS "role" ON "role"."id" = "assignment"."role_template_id"
  WHERE "assignment"."user_id" = "account"."id"
    AND "assignment"."department_id" = "role"."department_id"
    AND "assignment"."active" = true
);

COMMIT;
