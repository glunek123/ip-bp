-- 用户确认（2026-11-24）：待归档且无律师的案件允许先录律师结算（线下交付），指派后归集。
-- 原约束要求 side='LAWYER' 时 lawyer_id 非空，导致这类案件既不能补指派也不能结算。
-- 只需放开律师侧收付方；客户侧不变。

BEGIN;

ALTER TABLE "case_settlement_launches"
  DROP CONSTRAINT IF EXISTS "case_settlement_launches_values_check";

ALTER TABLE "case_settlement_launches"
  ADD CONSTRAINT "case_settlement_launches_values_check"
  CHECK (
    ("nth" > 0)
    AND ("amount" > (0)::numeric)
    AND (length(btrim(("idempotency_key")::text)) > 0)
    AND (
      (("side" = 'CUSTOMER'::"settlement_side") AND ("customer_id" IS NOT NULL) AND ("lawyer_id" IS NULL))
      OR (("side" = 'LAWYER'::"settlement_side") AND ("customer_id" IS NULL))
    )
  );

COMMIT;
