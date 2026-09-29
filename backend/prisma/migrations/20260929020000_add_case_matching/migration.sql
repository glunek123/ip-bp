BEGIN;

ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.match';
ALTER TYPE "case_stage" ADD VALUE IF NOT EXISTS 'WAITING_COMPLAINT';
COMMIT;

BEGIN;
CREATE TYPE "case_party_kind" AS ENUM ('PERSON', 'ORGANIZATION');

ALTER TABLE "cases" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "cases" ADD COLUMN "matched_at" TIMESTAMPTZ(3);
ALTER TABLE "cases" ADD CONSTRAINT "cases_matching_state_check" CHECK (
  "version" >= 1 AND (("stage" = 'PENDING_MATCH' AND "matched_at" IS NULL) OR ("stage" = 'WAITING_COMPLAINT' AND "matched_at" IS NOT NULL))
);

CREATE TABLE "case_defendants" (
  "id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "kind" "case_party_kind" NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "id_no" VARCHAR(100),
  "phone" VARCHAR(100),
  "address" VARCHAR(500),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_defendants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_defendants_name_check" CHECK ("name" = BTRIM("name") AND CHAR_LENGTH("name") BETWEEN 1 AND 200),
  CONSTRAINT "case_defendants_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "case_defendants_case_id_department_id_idx" ON "case_defendants"("case_id", "department_id");

CREATE TABLE "lawyer_profiles" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "full_name" VARCHAR(200) NOT NULL,
  "law_firm" VARCHAR(200) NOT NULL,
  "phone" VARCHAR(100),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lawyer_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lawyer_profiles_id_department_id_key" UNIQUE ("id", "department_id"),
  CONSTRAINT "lawyer_profiles_name_check" CHECK ("full_name" = BTRIM("full_name") AND CHAR_LENGTH("full_name") BETWEEN 1 AND 200),
  CONSTRAINT "lawyer_profiles_firm_check" CHECK ("law_firm" = BTRIM("law_firm") AND CHAR_LENGTH("law_firm") BETWEEN 1 AND 200),
  CONSTRAINT "lawyer_profiles_department_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_lawyer_assignments" (
  "id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "lawyer_id" UUID NOT NULL,
  "role" VARCHAR(30) NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "ended_at" TIMESTAMPTZ(3),
  CONSTRAINT "case_lawyer_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_lawyer_assignments_role_check" CHECK ("role" = 'PRIMARY'),
  CONSTRAINT "case_lawyer_assignments_dates_check" CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at"),
  CONSTRAINT "case_lawyer_assignments_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_lawyer_assignments_lawyer_fkey" FOREIGN KEY ("lawyer_id", "department_id") REFERENCES "lawyer_profiles"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "case_lawyer_assignments_case_id_department_id_idx" ON "case_lawyer_assignments"("case_id", "department_id");
CREATE UNIQUE INDEX "case_lawyer_assignments_one_active_primary_key" ON "case_lawyer_assignments"("case_id") WHERE "role" = 'PRIMARY' AND "ended_at" IS NULL;

CREATE TABLE "case_match_receipts" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_match_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_match_receipts_department_id_actor_user_id_idempotency_key_key" UNIQUE ("department_id", "actor_user_id", "idempotency_key"),
  CONSTRAINT "case_match_receipts_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_match_receipts_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

INSERT INTO "role_grants" ("id", "role_template_id", "action", "scope")
SELECT (
  SUBSTR(MD5("grant"."role_template_id"::text || ':case.match:self'), 1, 8) || '-' ||
  SUBSTR(MD5("grant"."role_template_id"::text || ':case.match:self'), 9, 4) || '-4' ||
  SUBSTR(MD5("grant"."role_template_id"::text || ':case.match:self'), 14, 3) || '-8' ||
  SUBSTR(MD5("grant"."role_template_id"::text || ':case.match:self'), 18, 3) || '-' ||
  SUBSTR(MD5("grant"."role_template_id"::text || ':case.match:self'), 21, 12)
)::UUID, "grant"."role_template_id", 'case.match'::"permission_action", 'SELF'::"permission_scope"
FROM "role_grants" AS "grant"
WHERE "grant"."action" = 'lead.edit'::"permission_action"
GROUP BY "grant"."role_template_id"
ON CONFLICT ("role_template_id", "action", "scope") DO NOTHING;

-- Department role managers need the covering grant to delegate TEAM/DEPARTMENT
-- matching. Regular lead editors retain only SELF matching from the insert above.
INSERT INTO "role_grants" ("id", "role_template_id", "action", "scope")
SELECT (
  SUBSTR(MD5("grant"."role_template_id"::text || ':case.match:department'), 1, 8) || '-' ||
  SUBSTR(MD5("grant"."role_template_id"::text || ':case.match:department'), 9, 4) || '-4' ||
  SUBSTR(MD5("grant"."role_template_id"::text || ':case.match:department'), 14, 3) || '-8' ||
  SUBSTR(MD5("grant"."role_template_id"::text || ':case.match:department'), 18, 3) || '-' ||
  SUBSTR(MD5("grant"."role_template_id"::text || ':case.match:department'), 21, 12)
)::UUID, "grant"."role_template_id", 'case.match'::"permission_action", 'DEPARTMENT'::"permission_scope"
FROM "role_grants" AS "grant"
WHERE "grant"."action" = 'role.manage'::"permission_action" AND "grant"."scope" = 'DEPARTMENT'::"permission_scope"
GROUP BY "grant"."role_template_id"
ON CONFLICT ("role_template_id", "action", "scope") DO NOTHING;

UPDATE "user_accounts" SET "authorization_revision" = "authorization_revision" + 1, "updated_at" = CURRENT_TIMESTAMP
WHERE "id" IN (SELECT "assignment"."user_id" FROM "role_assignments" AS "assignment"
  JOIN "role_grants" AS "grant" ON "grant"."role_template_id" = "assignment"."role_template_id"
  WHERE "assignment"."active" AND "grant"."action" = 'case.match'::"permission_action");

COMMIT;
