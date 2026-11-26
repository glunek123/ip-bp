CREATE TABLE IF NOT EXISTS "case_archive_revocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "archive_id" uuid NOT NULL,
  "prior_stage" varchar(50) NOT NULL,
  "reason" varchar(500) NOT NULL,
  "revoked_by_user_id" uuid NOT NULL,
  "revoked_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "case_archive_revocations_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "case_archive_revocations_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX IF NOT EXISTS "case_archive_revocations_case_id_idx" ON "case_archive_revocations"("case_id");
CREATE INDEX IF NOT EXISTS "case_archive_revocations_department_id_idx" ON "case_archive_revocations"("department_id");
