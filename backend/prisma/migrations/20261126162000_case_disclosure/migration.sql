-- 旧库费用日期与结算进度（迁移快照）
ALTER TABLE "cases"
  ADD COLUMN IF NOT EXISTS "legacy_prepay_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_court_fee_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_customer_settlement" varchar(500),
  ADD COLUMN IF NOT EXISTS "legacy_customer_settle_note" varchar(1000),
  ADD COLUMN IF NOT EXISTS "legacy_lawyer_settlement" varchar(500),
  ADD COLUMN IF NOT EXISTS "legacy_lawyer_settle_note" varchar(1000);

-- 旧库披露信息（每案一条，迁移快照）
CREATE TABLE IF NOT EXISTS "case_disclosures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" uuid NOT NULL UNIQUE,
  "department_id" uuid NOT NULL,
  "license" varchar(200),
  "entity_name" varchar(200),
  "address" varchar(500),
  "entity_type" varchar(100),
  "id_number" varchar(100),
  "legal_person" varchar(100),
  "phone" varchar(100),
  "emergency_phone" varchar(100),
  "extra_info" text,
  "sales_amount" varchar(100),
  "disclosed_on" date,
  CONSTRAINT "case_disclosures_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "case_disclosures_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX IF NOT EXISTS "case_disclosures_department_id_idx" ON "case_disclosures"("department_id");
