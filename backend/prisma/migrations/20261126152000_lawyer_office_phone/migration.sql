-- 律师律所电话，旧系统 case_lawyer_office_number 迁移用。
ALTER TABLE "lawyer_profiles"
  ADD COLUMN IF NOT EXISTS "office_phone" varchar(100);
