-- 旧库线索流程日期与审核意见（迁移快照）。
ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "legacy_approved_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_confirmed_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_purchased_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_review_opinion" varchar(500),
  ADD COLUMN IF NOT EXISTS "legacy_review_note" varchar(500);
