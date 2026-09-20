BEGIN;

LOCK TABLE "department_memberships", "role_assignments", "customers"
IN SHARE ROW EXCLUSIVE MODE;

CREATE TYPE "team_status" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "team_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "teams_id_department_id_key"
ON "teams"("id", "department_id");
CREATE INDEX "teams_department_id_status_idx"
ON "teams"("department_id", "status");

CREATE FUNCTION "prevent_team_department_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."department_id" IS DISTINCT FROM OLD."department_id" THEN
    RAISE EXCEPTION 'Team department is immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'teams_department_immutable_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "teams_department_immutable_trigger"
BEFORE UPDATE OF "department_id" ON "teams"
FOR EACH ROW EXECUTE FUNCTION "prevent_team_department_change"();

ALTER TABLE "teams"
ADD CONSTRAINT "teams_department_id_fkey"
FOREIGN KEY ("department_id") REFERENCES "departments"("id")
ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TEMP TABLE "team_backfill_map" ON COMMIT DROP AS
WITH "referenced_teams" AS (
    SELECT "team_id" AS "old_team_id", "department_id"
    FROM "department_memberships" WHERE "team_id" IS NOT NULL
    UNION
    SELECT "team_id", "department_id"
    FROM "role_assignments" WHERE "team_id" IS NOT NULL
    UNION
    SELECT "team_id", "department_id"
    FROM "customers" WHERE "team_id" IS NOT NULL
), "ranked_teams" AS (
    SELECT "old_team_id", "department_id",
           ROW_NUMBER() OVER (
             PARTITION BY "old_team_id" ORDER BY "department_id"::text
           ) AS "department_rank"
    FROM "referenced_teams"
)
SELECT "old_team_id", "department_id",
       CASE WHEN "department_rank" = 1 THEN "old_team_id"
            ELSE (
              SUBSTR(MD5("old_team_id"::text || ':' || "department_id"::text), 1, 8) || '-' ||
              SUBSTR(MD5("old_team_id"::text || ':' || "department_id"::text), 9, 4) || '-4' ||
              SUBSTR(MD5("old_team_id"::text || ':' || "department_id"::text), 14, 3) || '-8' ||
              SUBSTR(MD5("old_team_id"::text || ':' || "department_id"::text), 18, 3) || '-' ||
              SUBSTR(MD5("old_team_id"::text || ':' || "department_id"::text), 21, 12)
            )::uuid
       END AS "new_team_id"
FROM "ranked_teams";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "team_backfill_map"
    GROUP BY "new_team_id" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'team compatibility mapping produced duplicate UUIDs';
  END IF;
END $$;

INSERT INTO "teams"("id", "department_id", "name", "status", "updated_at")
SELECT "new_team_id", "department_id",
       '兼容团队 ' || SUBSTR(REPLACE("old_team_id"::text, '-', ''), 1, 8),
       'ACTIVE'::"team_status", CURRENT_TIMESTAMP
FROM "team_backfill_map";

UPDATE "department_memberships" AS "membership"
SET "team_id" = "mapping"."new_team_id"
FROM "team_backfill_map" AS "mapping"
WHERE "membership"."team_id" = "mapping"."old_team_id"
  AND "membership"."department_id" = "mapping"."department_id";

UPDATE "role_assignments" AS "assignment"
SET "team_id" = "mapping"."new_team_id"
FROM "team_backfill_map" AS "mapping"
WHERE "assignment"."team_id" = "mapping"."old_team_id"
  AND "assignment"."department_id" = "mapping"."department_id";

UPDATE "customers" AS "customer"
SET "team_id" = "mapping"."new_team_id"
FROM "team_backfill_map" AS "mapping"
WHERE "customer"."team_id" = "mapping"."old_team_id"
  AND "customer"."department_id" = "mapping"."department_id";

ALTER TABLE "department_memberships"
ADD CONSTRAINT "department_memberships_team_department_fkey"
FOREIGN KEY ("team_id", "department_id")
REFERENCES "teams"("id", "department_id")
ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "role_assignments"
ADD CONSTRAINT "role_assignments_team_department_fkey"
FOREIGN KEY ("team_id", "department_id")
REFERENCES "teams"("id", "department_id")
ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "customers"
ADD CONSTRAINT "customers_team_department_fkey"
FOREIGN KEY ("team_id", "department_id")
REFERENCES "teams"("id", "department_id")
ON DELETE RESTRICT ON UPDATE RESTRICT;

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
    SELECT 1
    FROM (VALUES
      ('customer.read'::"permission_action"),
      ('customer.create-draft'::"permission_action"),
      ('customer.edit-routine'::"permission_action")
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
  ('user.read'::"permission_action"),
  ('user.manage'::"permission_action"),
  ('team.read'::"permission_action"),
  ('team.manage'::"permission_action"),
  ('role.read'::"permission_action"),
  ('role.assign'::"permission_action")
) AS "permission"("action")
ON CONFLICT ("role_template_id", "action", "scope") DO NOTHING;

UPDATE "user_accounts" AS "account"
SET "authorization_revision" = "authorization_revision" + 1,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "account"."id" IN (
  SELECT "user_id" FROM "bootstrap_roles_to_upgrade"
);

COMMIT;
