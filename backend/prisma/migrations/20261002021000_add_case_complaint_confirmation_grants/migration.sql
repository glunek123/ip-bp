BEGIN;
WITH copied AS (
  INSERT INTO "role_grants" ("id", "role_template_id", "action", "scope")
  SELECT (
    SUBSTR(MD5("grant"."role_template_id"::text || ':case.complaint.confirm:' || LOWER("grant"."scope"::text)), 1, 8) || '-' ||
    SUBSTR(MD5("grant"."role_template_id"::text || ':case.complaint.confirm:' || LOWER("grant"."scope"::text)), 9, 4) || '-4' ||
    SUBSTR(MD5("grant"."role_template_id"::text || ':case.complaint.confirm:' || LOWER("grant"."scope"::text)), 14, 3) || '-8' ||
    SUBSTR(MD5("grant"."role_template_id"::text || ':case.complaint.confirm:' || LOWER("grant"."scope"::text)), 18, 3) || '-' ||
    SUBSTR(MD5("grant"."role_template_id"::text || ':case.complaint.confirm:' || LOWER("grant"."scope"::text)), 21, 12)
  )::UUID, "grant"."role_template_id", 'case.complaint.confirm'::"permission_action", "grant"."scope"
  FROM "role_grants" AS "grant"
  WHERE "grant"."action" = 'case.complaint.submit'::"permission_action"
  ON CONFLICT ("role_template_id", "action", "scope") DO NOTHING
  RETURNING "role_template_id"
), affected_templates AS (
  UPDATE "role_templates" SET "version" = "version" + 1, "updated_at" = CURRENT_TIMESTAMP
  WHERE "id" IN (SELECT DISTINCT "role_template_id" FROM copied)
  RETURNING "id"
)
UPDATE "user_accounts" SET "authorization_revision" = "authorization_revision" + 1, "updated_at" = CURRENT_TIMESTAMP
WHERE "id" IN (
  SELECT "assignment"."user_id" FROM "role_assignments" AS "assignment"
  JOIN affected_templates ON affected_templates."id" = "assignment"."role_template_id"
  WHERE "assignment"."active"
);
COMMIT;
