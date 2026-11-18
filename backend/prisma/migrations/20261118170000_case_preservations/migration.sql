CREATE TABLE "case_preservations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "department_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "document_version_id" UUID,
  "document_name" VARCHAR(200),
  "preserved_on" DATE NOT NULL,
  "fee_amount" DECIMAL(16,2),
  "premium_amount" DECIMAL(16,2),
  "recorded_by_user_id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_preservations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "case_preservations_case_id_idx" ON "case_preservations"("case_id");
ALTER TABLE "case_preservations" ADD CONSTRAINT "case_preservations_case_id_fkey"
  FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
