-- 旧库公证过程与寄件信息（迁移快照，仅展示）。
ALTER TABLE "notary_matters"
  ADD COLUMN IF NOT EXISTS "legacy_notarization_type" varchar(200),
  ADD COLUMN IF NOT EXISTS "legacy_notarization_platform" varchar(100),
  ADD COLUMN IF NOT EXISTS "legacy_notarization_number" varchar(200),
  ADD COLUMN IF NOT EXISTS "legacy_upload_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_forensics_open_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_forensics_confirm_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_forensics_approve_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_forensics_issue_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_notary_office" varchar(200),
  ADD COLUMN IF NOT EXISTS "legacy_sender_name" varchar(100),
  ADD COLUMN IF NOT EXISTS "legacy_sender_phone" varchar(100),
  ADD COLUMN IF NOT EXISTS "legacy_sender_address" varchar(500),
  ADD COLUMN IF NOT EXISTS "legacy_sender_tracking" varchar(200);
