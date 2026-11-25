-- 保留旧系统「归档结果」：迁移数据用，新登记可空。
ALTER TABLE "case_closure_versions"
  ADD COLUMN IF NOT EXISTS "close_outcome" varchar(32);
