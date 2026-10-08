BEGIN;
WITH eligible_schedule AS (
  SELECT g."role_template_id", g."scope" FROM "role_grants" g
  JOIN "role_templates" t ON t."id" = g."role_template_id" AND t."active"
  WHERE g."action" = 'case.acceptance.register'::"permission_action"
), eligible_correct AS (
  SELECT t."id" AS "role_template_id", 'DEPARTMENT'::"permission_scope" AS "scope"
  FROM "role_templates" t
  WHERE t."active"
    AND EXISTS (SELECT 1 FROM "role_grants" g WHERE g."role_template_id" = t."id"
      AND g."action" = 'case.match'::"permission_action" AND g."scope" = 'DEPARTMENT')
    AND EXISTS (SELECT 1 FROM "role_grants" g WHERE g."role_template_id" = t."id"
      AND g."action" = 'role.manage'::"permission_action" AND g."scope" = 'DEPARTMENT')
), requested AS (
  SELECT "role_template_id", 'case.hearing.schedule'::"permission_action" AS "action", "scope" FROM eligible_schedule
  UNION ALL
  SELECT "role_template_id", 'case.hearing.correct'::"permission_action", "scope" FROM eligible_correct
), inserted AS (
  INSERT INTO "role_grants"("id", "role_template_id", "action", "scope")
  SELECT gen_random_uuid(), "role_template_id", "action", "scope" FROM requested
  ON CONFLICT ("role_template_id", "action", "scope") DO NOTHING
  RETURNING "role_template_id"
), changed_templates AS (
  UPDATE "role_templates" SET "version" = "version" + 1, "updated_at" = CURRENT_TIMESTAMP
  WHERE "id" IN (SELECT DISTINCT "role_template_id" FROM inserted)
  RETURNING "id", "department_id"
)
UPDATE "user_accounts" u SET "authorization_revision" = u."authorization_revision" + 1,
  "updated_at" = CURRENT_TIMESTAMP
WHERE u."active" AND EXISTS (
  SELECT 1 FROM "role_assignments" a JOIN changed_templates t
    ON t."id" = a."role_template_id" AND t."department_id" = a."department_id"
  JOIN "department_memberships" m ON m."user_id" = a."user_id"
    AND m."department_id" = a."department_id" AND m."active"
  WHERE a."user_id" = u."id" AND a."active"
);
COMMIT;
