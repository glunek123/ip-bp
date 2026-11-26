ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "legacy_operator_id" varchar(20);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "legacy_operator_id" varchar(20);
