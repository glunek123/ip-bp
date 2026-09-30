BEGIN;
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.complaint.submit';
ALTER TYPE "case_stage" ADD VALUE IF NOT EXISTS 'WAITING_COMPLAINT_CONFIRMATION';
ALTER TYPE "material_owner_type" ADD VALUE IF NOT EXISTS 'CASE';
ALTER TYPE "material_category" ADD VALUE IF NOT EXISTS 'COMPLAINT';
ALTER TYPE "material_category" ADD VALUE IF NOT EXISTS 'AUTHORIZATION';
COMMIT;

BEGIN;
CREATE TYPE "case_complaint_amount_state" AS ENUM ('KNOWN', 'PENDING');
ALTER TABLE "cases" DROP CONSTRAINT "cases_matching_state_check";
ALTER TABLE "cases" ADD COLUMN "complaint_amount_state" "case_complaint_amount_state";
ALTER TABLE "cases" ADD COLUMN "complaint_amount" DECIMAL(16,2);
ALTER TABLE "cases" ADD COLUMN "complaint_pending_reason" VARCHAR(500);
ALTER TABLE "cases" ADD COLUMN "complaint_submitted_at" TIMESTAMPTZ(3);
ALTER TABLE "cases" ADD COLUMN "complaint_submitted_by_user_id" UUID;
ALTER TABLE "cases" ADD CONSTRAINT "cases_matching_state_check" CHECK (
  "version" >= 1 AND (
    ("stage" = 'PENDING_MATCH' AND "matched_at" IS NULL) OR
    ("stage" IN ('WAITING_COMPLAINT', 'WAITING_COMPLAINT_CONFIRMATION') AND "matched_at" IS NOT NULL)
  )
);
ALTER TABLE "cases" ADD CONSTRAINT "cases_complaint_state_check" CHECK (
  ("stage" <> 'WAITING_COMPLAINT_CONFIRMATION' AND "complaint_submitted_at" IS NULL AND "complaint_submitted_by_user_id" IS NULL AND "complaint_amount_state" IS NULL AND "complaint_amount" IS NULL AND "complaint_pending_reason" IS NULL)
  OR
  ("stage" = 'WAITING_COMPLAINT_CONFIRMATION' AND "complaint_submitted_at" IS NOT NULL AND "complaint_submitted_by_user_id" IS NOT NULL AND "complaint_amount_state" IS NOT NULL AND (("complaint_amount_state" = 'KNOWN' AND "complaint_amount" IS NOT NULL AND "complaint_amount" >= 0 AND "complaint_pending_reason" IS NULL) OR ("complaint_amount_state" = 'PENDING' AND "complaint_amount" IS NULL AND "complaint_pending_reason" IS NOT NULL AND CHAR_LENGTH(BTRIM("complaint_pending_reason")) > 0)))
);
ALTER TABLE "cases" ADD CONSTRAINT "cases_complaint_submitter_fkey" FOREIGN KEY ("complaint_submitted_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "case_complaint_receipts" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_complaint_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_complaint_receipts_department_id_actor_user_id_idempotency_key_key" UNIQUE ("department_id", "actor_user_id", "idempotency_key"),
  CONSTRAINT "case_complaint_receipts_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_complaint_receipts_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE FUNCTION "enforce_case_material_owner"() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."owner_type" = 'CASE'::"material_owner_type" AND NOT EXISTS (
    SELECT 1 FROM "cases" WHERE "id" = NEW."owner_id" AND "department_id" = NEW."department_id"
  ) THEN
    RAISE foreign_key_violation USING MESSAGE = 'CASE material owner must be an existing case in the same department';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "materials_case_owner_guard"
  BEFORE INSERT OR UPDATE OF "owner_type", "owner_id", "department_id" ON "materials"
  FOR EACH ROW EXECUTE FUNCTION "enforce_case_material_owner"();

INSERT INTO "role_grants" ("id", "role_template_id", "action", "scope")
SELECT (
  SUBSTR(MD5("grant"."role_template_id"::text || ':case.complaint.submit:' || LOWER("grant"."scope"::text)), 1, 8) || '-' ||
  SUBSTR(MD5("grant"."role_template_id"::text || ':case.complaint.submit:' || LOWER("grant"."scope"::text)), 9, 4) || '-4' ||
  SUBSTR(MD5("grant"."role_template_id"::text || ':case.complaint.submit:' || LOWER("grant"."scope"::text)), 14, 3) || '-8' ||
  SUBSTR(MD5("grant"."role_template_id"::text || ':case.complaint.submit:' || LOWER("grant"."scope"::text)), 18, 3) || '-' ||
  SUBSTR(MD5("grant"."role_template_id"::text || ':case.complaint.submit:' || LOWER("grant"."scope"::text)), 21, 12)
)::UUID, "grant"."role_template_id", 'case.complaint.submit'::"permission_action", "grant"."scope"
FROM "role_grants" AS "grant"
WHERE "grant"."action" = 'case.match'::"permission_action"
ON CONFLICT ("role_template_id", "action", "scope") DO NOTHING;

UPDATE "user_accounts" SET "authorization_revision" = "authorization_revision" + 1, "updated_at" = CURRENT_TIMESTAMP
WHERE "id" IN (SELECT "assignment"."user_id" FROM "role_assignments" AS "assignment" JOIN "role_grants" AS "grant" ON "grant"."role_template_id" = "assignment"."role_template_id" WHERE "assignment"."active" AND "grant"."action" = 'case.complaint.submit'::"permission_action");
COMMIT;
