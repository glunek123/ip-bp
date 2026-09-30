BEGIN;

LOCK TABLE "role_templates", "role_grants", "role_assignments", "department_memberships", "user_accounts"
IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE "notary_export_changed_templates" (
  "role_template_id" UUID PRIMARY KEY
) ON COMMIT DROP;

WITH "inserted" AS (
  INSERT INTO "role_grants" ("id", "role_template_id", "action", "scope")
  SELECT (
    SUBSTR("digest", 1, 8) || '-' || SUBSTR("digest", 9, 4) || '-4' ||
    SUBSTR("digest", 14, 3) || '-8' || SUBSTR("digest", 18, 3) || '-' ||
    SUBSTR("digest", 21, 12)
  )::UUID, "role_template_id", 'notary.list.export'::"permission_action", 'DEPARTMENT'
  FROM (
    SELECT "role"."id" AS "role_template_id",
      MD5("role"."id"::text || ':notary.list.export') AS "digest"
    FROM "role_templates" AS "role"
    WHERE EXISTS (
      SELECT 1 FROM "role_grants" AS "grant"
      WHERE "grant"."role_template_id" = "role"."id"
        AND "grant"."action" = 'role.manage'::"permission_action"
        AND "grant"."scope" = 'DEPARTMENT'::"permission_scope"
    )
  ) AS "candidate"
  ON CONFLICT ("role_template_id", "action", "scope") DO NOTHING
  RETURNING "role_template_id"
)
INSERT INTO "notary_export_changed_templates" ("role_template_id")
SELECT DISTINCT "role_template_id" FROM "inserted";

UPDATE "role_templates" AS "role"
SET "version" = "role"."version" + 1,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "role"."id" IN (
  SELECT "role_template_id" FROM "notary_export_changed_templates"
);

UPDATE "user_accounts" AS "account"
SET "authorization_revision" = "account"."authorization_revision" + 1,
    "updated_at" = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM "role_assignments" AS "assignment"
  JOIN "notary_export_changed_templates" AS "changed"
    ON "changed"."role_template_id" = "assignment"."role_template_id"
  JOIN "role_templates" AS "role"
    ON "role"."id" = "assignment"."role_template_id"
    AND "role"."active" = true
  JOIN "department_memberships" AS "membership"
    ON "membership"."user_id" = "assignment"."user_id"
    AND "membership"."department_id" = "assignment"."department_id"
    AND "membership"."active" = true
  WHERE "assignment"."user_id" = "account"."id"
    AND "assignment"."active" = true
    AND "account"."active" = true
);

COMMIT;
