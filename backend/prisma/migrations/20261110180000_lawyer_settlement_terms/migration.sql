-- 匹配律师时需要同时记录结算约定：结算模式、基础费、分成比例；
-- 律师档案补一个地址，供卡片直接带出。
ALTER TABLE "lawyer_profiles" ADD COLUMN "address" VARCHAR(500);

ALTER TABLE "case_lawyer_assignments" ADD COLUMN "settlement_mode" VARCHAR(20);
ALTER TABLE "case_lawyer_assignments" ADD COLUMN "base_fee" DECIMAL(14,2);
ALTER TABLE "case_lawyer_assignments" ADD COLUMN "split_percent" INTEGER;

ALTER TABLE "case_lawyer_assignments" ADD CONSTRAINT "case_lawyer_assignments_settlement_shape" CHECK (
  ("settlement_mode" IS NULL AND "base_fee" IS NULL AND "split_percent" IS NULL)
  OR (
    "settlement_mode" IN ('FULL_RISK', 'HALF_RISK', 'FIXED_FEE')
    AND "split_percent" BETWEEN 0 AND 100
    AND "base_fee" >= 0
    AND ("settlement_mode" <> 'FULL_RISK' OR "base_fee" = 0)
  )
);
