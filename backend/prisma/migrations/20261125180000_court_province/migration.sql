-- 法院所在地（省份），用于检索与展示。
ALTER TABLE "filing_courts"
  ADD COLUMN IF NOT EXISTS "province" varchar(100);
