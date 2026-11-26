-- 承办法官快照：旧系统迁移保留，新案件仍通过开庭排期维护。
ALTER TABLE "cases"
  ADD COLUMN IF NOT EXISTS "judge_name" varchar(100);
