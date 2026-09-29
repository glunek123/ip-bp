BEGIN;

-- Identify only grants made by the first CA-001 migration. Role administration
-- alone is not a business basis for matching cases; manually created grants
-- have independent identities and are not considered here.
CREATE TEMP TABLE "case_match_changed_templates" (
  "role_template_id" UUID PRIMARY KEY
) ON COMMIT DROP;

WITH "candidates" AS (
  SELECT "grant"."id", "grant"."role_template_id", "grant"."scope",
    MD5("grant"."role_template_id"::text || ':case.match:' || LOWER("grant"."scope"::text)) AS "digest"
  FROM "role_grants" AS "grant"
  WHERE "grant"."action" = 'case.match'::"permission_action"
    AND "grant"."scope" IN ('SELF'::"permission_scope", 'DEPARTMENT'::"permission_scope")
), "stale" AS (
  SELECT "candidate"."id", "candidate"."role_template_id"
  FROM "candidates" AS "candidate"
  WHERE "candidate"."id" = (
    SUBSTR("candidate"."digest", 1, 8) || '-' ||
    SUBSTR("candidate"."digest", 9, 4) || '-4' ||
    SUBSTR("candidate"."digest", 14, 3) || '-8' ||
    SUBSTR("candidate"."digest", 18, 3) || '-' ||
    SUBSTR("candidate"."digest", 21, 12)
  )::UUID
    AND NOT EXISTS (
      SELECT 1 FROM "role_grants" AS "business"
      WHERE "business"."role_template_id" = "candidate"."role_template_id"
        AND "business"."action" = 'lead.edit'::"permission_action"
        AND "business"."scope" = "candidate"."scope"
    )
), "deleted" AS (
  DELETE FROM "role_grants" AS "grant"
  USING "stale"
  WHERE "grant"."id" = "stale"."id"
  RETURNING "grant"."role_template_id"
)
INSERT INTO "case_match_changed_templates" ("role_template_id")
SELECT DISTINCT "role_template_id" FROM "deleted"
ON CONFLICT ("role_template_id") DO NOTHING;

-- Existing lead-edit TEAM/DEPARTMENT templates receive the same business
-- scope. SELF grants with a matching lead-edit SELF grant remain from CA-001.
WITH "business" AS (
  SELECT "grant"."role_template_id", "grant"."scope",
    MD5("grant"."role_template_id"::text || ':case.match:' || LOWER("grant"."scope"::text)) AS "digest"
  FROM "role_grants" AS "grant"
  WHERE "grant"."action" = 'lead.edit'::"permission_action"
    AND "grant"."scope" IN ('TEAM'::"permission_scope", 'DEPARTMENT'::"permission_scope")
), "inserted" AS (
  INSERT INTO "role_grants" ("id", "role_template_id", "action", "scope")
  SELECT (
    SUBSTR("business"."digest", 1, 8) || '-' ||
    SUBSTR("business"."digest", 9, 4) || '-4' ||
    SUBSTR("business"."digest", 14, 3) || '-8' ||
    SUBSTR("business"."digest", 18, 3) || '-' ||
    SUBSTR("business"."digest", 21, 12)
  )::UUID, "business"."role_template_id", 'case.match'::"permission_action", "business"."scope"
  FROM "business"
  WHERE TRUE
  ON CONFLICT ("role_template_id", "action", "scope") DO NOTHING
  RETURNING "role_template_id"
)
INSERT INTO "case_match_changed_templates" ("role_template_id")
SELECT DISTINCT "role_template_id" FROM "inserted"
ON CONFLICT ("role_template_id") DO NOTHING;

UPDATE "user_accounts" AS "account"
SET "authorization_revision" = "account"."authorization_revision" + 1,
    "updated_at" = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM "role_assignments" AS "assignment"
  JOIN "case_match_changed_templates" AS "changed"
    ON "changed"."role_template_id" = "assignment"."role_template_id"
  WHERE "assignment"."user_id" = "account"."id" AND "assignment"."active"
);

COMMIT;
