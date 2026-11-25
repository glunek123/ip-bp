-- 样品费退款从「逐笔明细」改为「可修改的单值」：
-- 现样品费 = 取证登记样品费 − 本值，原登记值保持不动。
ALTER TABLE "notary_matters"
  ADD COLUMN "sample_fee_refund" numeric(18, 2) NOT NULL DEFAULT 0;

-- 合并既有逐笔退款（各事项合计）写入新字段。
UPDATE "notary_matters" m
SET "sample_fee_refund" = COALESCE((
  SELECT SUM(r."amount")
  FROM "notary_sample_fee_refunds" r
  WHERE r."matter_id" = m."id" AND r."department_id" = m."department_id"
), 0);

DROP TABLE "notary_sample_fee_refunds";
