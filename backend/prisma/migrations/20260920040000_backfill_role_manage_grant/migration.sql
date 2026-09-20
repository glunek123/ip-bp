BEGIN;

LOCK TABLE "department_memberships", "role_assignments", "role_templates", "role_grants", "local_credentials", "user_accounts"
IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE "bootstrap_roles_to_upgrade" ON COMMIT DROP AS
SELECT "assignment"."role_template_id", "assignment"."user_id"
FROM "role_assignments" AS "assignment"
JOIN "role_templates" AS "role"
  ON "role"."id" = "assignment"."role_template_id"
 AND "role"."department_id" = "assignment"."department_id"
JOIN "department_memberships" AS "membership"
  ON "membership"."user_id" = "assignment"."user_id"
 AND "membership"."department_id" = "assignment"."department_id"
JOIN "local_credentials" AS "credential"
  ON "credential"."user_id" = "assignment"."user_id"
WHERE "assignment"."active" = true
  AND "assignment"."team_id" IS NULL
  AND "role"."active" = true
  AND "membership"."active" = true
  AND (
    SELECT COUNT(DISTINCT "local_membership"."user_id")
    FROM "department_memberships" AS "local_membership"
    JOIN "local_credentials" AS "local_credential"
      ON "local_credential"."user_id" = "local_membership"."user_id"
    WHERE "local_membership"."department_id" = "assignment"."department_id"
      AND "local_membership"."active" = true
  ) = 1
  AND (
    SELECT COUNT(*) FROM "role_assignments" AS "active_assignment"
    WHERE "active_assignment"."user_id" = "assignment"."user_id"
      AND "active_assignment"."department_id" = "assignment"."department_id"
      AND "active_assignment"."active" = true
  ) = 1
  AND NOT EXISTS (
    SELECT 1 FROM "role_assignments" AS "shared_assignment"
    WHERE "shared_assignment"."role_template_id" = "assignment"."role_template_id"
      AND "shared_assignment"."user_id" <> "assignment"."user_id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "role_grants" AS "existing_role_manage"
    WHERE "existing_role_manage"."role_template_id" = "assignment"."role_template_id"
      AND "existing_role_manage"."action" = 'role.manage'
      AND "existing_role_manage"."scope" = 'DEPARTMENT'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('customer.read'::"permission_action"),
      ('customer.create-draft'::"permission_action"),
      ('customer.edit-routine'::"permission_action"),
      ('user.read'::"permission_action"),
      ('user.manage'::"permission_action"),
      ('team.read'::"permission_action"),
      ('team.manage'::"permission_action"),
      ('role.read'::"permission_action"),
      ('role.assign'::"permission_action")
    ) AS "required"("action")
    WHERE NOT EXISTS (
      SELECT 1 FROM "role_grants" AS "grant"
      WHERE "grant"."role_template_id" = "assignment"."role_template_id"
        AND "grant"."action" = "required"."action"
        AND "grant"."scope" = 'DEPARTMENT'
    )
  );

INSERT INTO "role_grants"("id", "role_template_id", "action", "scope")
SELECT (
         SUBSTR(MD5("candidate"."role_template_id"::text || ':' || "permission"."action"::text), 1, 8) || '-' ||
         SUBSTR(MD5("candidate"."role_template_id"::text || ':' || "permission"."action"::text), 9, 4) || '-4' ||
         SUBSTR(MD5("candidate"."role_template_id"::text || ':' || "permission"."action"::text), 14, 3) || '-8' ||
         SUBSTR(MD5("candidate"."role_template_id"::text || ':' || "permission"."action"::text), 18, 3) || '-' ||
         SUBSTR(MD5("candidate"."role_template_id"::text || ':' || "permission"."action"::text), 21, 12)
       )::uuid,
       "candidate"."role_template_id", "permission"."action", 'DEPARTMENT'
FROM "bootstrap_roles_to_upgrade" AS "candidate"
CROSS JOIN (VALUES
  ('role.manage'::"permission_action")
) AS "permission"("action")
ON CONFLICT ("role_template_id", "action", "scope") DO NOTHING;

UPDATE "user_accounts" AS "account"
SET "authorization_revision" = "authorization_revision" + 1,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "account"."id" IN (
  SELECT "user_id" FROM "bootstrap_roles_to_upgrade"
);

COMMIT;
