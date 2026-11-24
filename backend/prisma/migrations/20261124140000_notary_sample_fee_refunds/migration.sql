-- 样品费退款：待退货阶段逐笔登记，样品费净值 = 取证登记金额 − 累计退款。
-- 不改写 notary_matter_evidence.sample_fee_amount，历史取证数据保持原样。

BEGIN;

CREATE TABLE "notary_sample_fee_refunds" (
  "id" uuid NOT NULL,
  "matter_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "amount" numeric(18,2) NOT NULL,
  "refunded_on" date NOT NULL,
  "note" varchar(500),
  "recorded_by_user_id" uuid NOT NULL,
  "recorded_at" timestamptz(3) NOT NULL DEFAULT now(),
  "audit_event_id" uuid NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  CONSTRAINT "notary_sample_fee_refunds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notary_sample_fee_refunds_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "notary_sample_fee_refunds_idempotency_check" CHECK (
    length(btrim("idempotency_key")) BETWEEN 1 AND 128
    AND "idempotency_key" = btrim("idempotency_key")
  ),
  CONSTRAINT "notary_sample_fee_refunds_matter_fkey"
    FOREIGN KEY ("matter_id", "department_id")
    REFERENCES "notary_matters"("id", "department_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_sample_fee_refunds_recorder_fkey"
    FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_sample_fee_refunds_audit_fkey"
    FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "notary_sample_fee_refunds_audit_event_id_key"
  ON "notary_sample_fee_refunds"("audit_event_id");

CREATE UNIQUE INDEX "notary_sample_fee_refunds_idempotency_key"
  ON "notary_sample_fee_refunds"("department_id", "recorded_by_user_id", "idempotency_key");

CREATE INDEX "notary_sample_fee_refunds_matter_idx"
  ON "notary_sample_fee_refunds"("matter_id", "department_id");

COMMIT;
