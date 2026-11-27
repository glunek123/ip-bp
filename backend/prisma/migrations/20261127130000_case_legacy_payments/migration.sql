-- 历史实收流水（旧库 ip_payment_case 迁移）：收款方无来源，标记 verified=false，不计入当前有效付款与财务总额。
CREATE TABLE IF NOT EXISTS "case_legacy_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" uuid NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  "legacy_payment_id" text NOT NULL,
  "amount" numeric(16,2) NOT NULL DEFAULT 0,
  "paid_on" date,
  "payer" text,
  "note" text,
  "source" text NOT NULL DEFAULT 'NOCOBASE',
  "verified" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "case_legacy_payments_id_key" UNIQUE ("legacy_payment_id")
);
CREATE INDEX IF NOT EXISTS "case_legacy_payments_case_id_idx" ON "case_legacy_payments"("case_id");
