BEGIN;

-- CreateEnum
CREATE TYPE "settlement_side" AS ENUM ('CUSTOMER', 'LAWYER');

-- CreateEnum
CREATE TYPE "lawyer_settlement_mode" AS ENUM ('FULL_RISK', 'HALF_RISK', 'FIXED_FEE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "permission_action" ADD VALUE 'settlement.read';
ALTER TYPE "permission_action" ADD VALUE 'settlement.terms.update';
ALTER TYPE "permission_action" ADD VALUE 'settlement.launch';
ALTER TYPE "permission_action" ADD VALUE 'settlement.bill.create';
ALTER TYPE "permission_action" ADD VALUE 'settlement.bill.cancel';
ALTER TYPE "permission_action" ADD VALUE 'fee.read';
ALTER TYPE "permission_action" ADD VALUE 'fee.create';
ALTER TYPE "permission_action" ADD VALUE 'fee.update';
ALTER TYPE "permission_action" ADD VALUE 'fee.launch';
ALTER TYPE "permission_action" ADD VALUE 'fee.delete';

-- CreateTable
CREATE TABLE "case_settlement_terms" (
    "case_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "customer_formula" VARCHAR(500),
    "lawyer_mode" "lawyer_settlement_mode",
    "lawyer_base_fee" DECIMAL(30,2),
    "lawyer_split_percent" DECIMAL(20,16),
    "customer_manual_amount" DECIMAL(30,2),
    "lawyer_manual_amount" DECIMAL(30,2),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "case_settlement_terms_pkey" PRIMARY KEY ("case_id")
);

-- CreateTable
CREATE TABLE "case_settlement_launches" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "side" "settlement_side" NOT NULL,
    "nth" INTEGER NOT NULL,
    "amount" DECIMAL(30,2) NOT NULL,
    "launch_date" DATE NOT NULL,
    "note" VARCHAR(500),
    "customer_id" UUID,
    "lawyer_id" UUID,
    "bill_id" UUID,
    "actor_user_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_settlement_launches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_bills" (
    "id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "side" "settlement_side" NOT NULL,
    "bill_no" VARCHAR(40) NOT NULL,
    "bill_date" DATE NOT NULL,
    "amount" DECIMAL(30,2) NOT NULL,
    "note" VARCHAR(500),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancellation_reason" VARCHAR(500),
    "cancellation_key" VARCHAR(128),
    "actor_user_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_bill_items" (
    "id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "launch_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "side" "settlement_side" NOT NULL,
    "case_id" UUID NOT NULL,
    "payee_id" UUID NOT NULL,
    "payee_name" VARCHAR(200) NOT NULL,
    "nth" INTEGER NOT NULL,
    "amount" DECIMAL(30,2) NOT NULL,

    CONSTRAINT "settlement_bill_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_records" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "direction" VARCHAR(10) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "amount" DECIMAL(30,2) NOT NULL,
    "fee_date" DATE NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "actor_user_id" UUID,
    "idempotency_key" VARCHAR(128),
    "note" VARCHAR(500),
    "proof_material_id" UUID,
    "proof_content_version_id" UUID,
    "launched_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "case_settlement_terms_case_id_department_id_key" ON "case_settlement_terms"("case_id", "department_id");

-- CreateIndex
CREATE INDEX "case_settlement_launches_department_id_side_launch_date_id_idx" ON "case_settlement_launches"("department_id", "side", "launch_date", "id");

-- CreateIndex
CREATE UNIQUE INDEX "case_settlement_launches_case_id_side_nth_key" ON "case_settlement_launches"("case_id", "side", "nth");

-- CreateIndex
CREATE UNIQUE INDEX "case_settlement_launches_department_id_actor_user_id_idempo_key" ON "case_settlement_launches"("department_id", "actor_user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "case_settlement_launches_id_department_id_side_key" ON "case_settlement_launches"("id", "department_id", "side");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_bills_bill_no_key" ON "settlement_bills"("bill_no");

-- CreateIndex
CREATE INDEX "settlement_bills_department_id_side_bill_date_id_idx" ON "settlement_bills"("department_id", "side", "bill_date", "id");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_bills_id_department_id_side_key" ON "settlement_bills"("id", "department_id", "side");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_bills_department_id_actor_user_id_idempotency_ke_key" ON "settlement_bills"("department_id", "actor_user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "settlement_bill_items_launch_id_department_id_idx" ON "settlement_bill_items"("launch_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_bill_items_bill_id_launch_id_key" ON "settlement_bill_items"("bill_id", "launch_id");

-- CreateIndex
CREATE INDEX "fee_records_department_id_fee_date_id_idx" ON "fee_records"("department_id", "fee_date", "id");

-- CreateIndex
CREATE INDEX "fee_records_case_id_department_id_idx" ON "fee_records"("case_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_records_id_department_id_key" ON "fee_records"("id", "department_id");

CREATE UNIQUE INDEX "fee_records_department_actor_idempotency_key" ON "fee_records"("department_id", "actor_user_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "case_settlement_terms" ADD CONSTRAINT "case_settlement_terms_case_id_department_id_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_settlement_launches" ADD CONSTRAINT "case_settlement_launches_case_id_department_id_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_settlement_launches" ADD CONSTRAINT "case_settlement_launches_customer_id_department_id_fkey" FOREIGN KEY ("customer_id", "department_id") REFERENCES "customers"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_settlement_launches" ADD CONSTRAINT "case_settlement_launches_lawyer_id_department_id_fkey" FOREIGN KEY ("lawyer_id", "department_id") REFERENCES "lawyer_profiles"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_settlement_launches" ADD CONSTRAINT "case_settlement_launches_bill_id_department_id_side_fkey" FOREIGN KEY ("bill_id", "department_id", "side") REFERENCES "settlement_bills"("id", "department_id", "side") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "settlement_bill_items" ADD CONSTRAINT "settlement_bill_items_bill_id_department_id_side_fkey" FOREIGN KEY ("bill_id", "department_id", "side") REFERENCES "settlement_bills"("id", "department_id", "side") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "settlement_bill_items" ADD CONSTRAINT "settlement_bill_items_launch_id_department_id_side_fkey" FOREIGN KEY ("launch_id", "department_id", "side") REFERENCES "case_settlement_launches"("id", "department_id", "side") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fee_records" ADD CONSTRAINT "fee_records_case_id_department_id_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- New rows have no legacy states. Keep amount, payee, and fee status invariants in storage.
ALTER TABLE "case_settlement_terms" ADD CONSTRAINT "case_settlement_terms_values_check" CHECK (
  "version" > 0
  AND ("lawyer_base_fee" IS NULL OR "lawyer_base_fee" >= 0)
  AND ("lawyer_split_percent" IS NULL OR "lawyer_split_percent" BETWEEN 0 AND 100)
  AND ("customer_manual_amount" IS NULL OR "customer_manual_amount" >= 0)
  AND ("lawyer_manual_amount" IS NULL OR "lawyer_manual_amount" >= 0)
  AND ("lawyer_mode" IS NULL OR "lawyer_base_fee" IS NOT NULL)
  AND ("lawyer_mode" IS NULL OR "lawyer_split_percent" IS NOT NULL)
  AND ("lawyer_mode" IS DISTINCT FROM 'FULL_RISK' OR "lawyer_base_fee" = 0)
);

ALTER TABLE "case_settlement_launches" ADD CONSTRAINT "case_settlement_launches_values_check" CHECK (
  "nth" > 0 AND "amount" > 0 AND LENGTH(BTRIM("idempotency_key")) > 0
  AND (("side" = 'CUSTOMER' AND "customer_id" IS NOT NULL AND "lawyer_id" IS NULL)
    OR ("side" = 'LAWYER' AND "lawyer_id" IS NOT NULL AND "customer_id" IS NULL))
);

ALTER TABLE "settlement_bills" ADD CONSTRAINT "settlement_bills_values_check" CHECK (
  "amount" > 0 AND LENGTH(BTRIM("idempotency_key")) > 0
  AND (("cancelled_at" IS NULL AND "cancellation_reason" IS NULL AND "cancellation_key" IS NULL)
    OR ("cancelled_at" IS NOT NULL AND "cancellation_key" IS NOT NULL AND LENGTH(BTRIM("cancellation_key")) > 0))
);

ALTER TABLE "settlement_bill_items" ADD CONSTRAINT "settlement_bill_items_values_check" CHECK (
  "nth" > 0 AND "amount" > 0 AND NULLIF(BTRIM("payee_name"), '') IS NOT NULL
);

ALTER TABLE "fee_records" ADD CONSTRAINT "fee_records_values_check" CHECK (
  "amount" >= 0 AND "version" > 0
  AND "type" IN ('诉讼费', '保全费', '保全保费', '公告费', '调档费', '调查费', '公证费', '披露费', '样品费', '样品费退款', '退货运费', '律师费', '诉讼退费', '其他')
  AND "direction" IN ('支出', '收入')
  AND (("type" = '诉讼退费' AND "status" IN ('退原告', '退律所'))
    OR ("type" <> '诉讼退费' AND "status" IN ('未发起', '发起', '已支付')))
  AND "source" IN ('manual', 'auto')
  AND (("source" = 'manual' AND "actor_user_id" IS NOT NULL AND "idempotency_key" IS NOT NULL AND LENGTH(BTRIM("idempotency_key")) > 0)
    OR ("source" = 'auto' AND "actor_user_id" IS NULL AND "idempotency_key" IS NULL))
  AND (("proof_material_id" IS NULL AND "proof_content_version_id" IS NULL)
    OR ("proof_material_id" IS NOT NULL AND "proof_content_version_id" IS NOT NULL))
);

CREATE TABLE "fee_batch_receipts" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "command" VARCHAR(20) NOT NULL,
  "selected_ids" UUID[] NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fee_batch_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fee_batch_receipts_command_check" CHECK ("command" IN ('LAUNCH', 'DELETE') AND CARDINALITY("selected_ids") > 0 AND LENGTH(BTRIM("idempotency_key")) > 0),
  CONSTRAINT "fee_batch_receipts_department_actor_key" UNIQUE ("department_id", "actor_user_id", "idempotency_key")
);

-- Finance actions are internal actors in the same department. Source-derived
-- fees keep a null action actor; their real origin is not an invented operator.
ALTER TABLE "case_settlement_launches" ADD CONSTRAINT "settlement_launch_actor_user_fk" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "case_settlement_launches" ADD CONSTRAINT "settlement_launch_actor_membership_fk" FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "settlement_bills" ADD CONSTRAINT "settlement_bill_actor_user_fk" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "settlement_bills" ADD CONSTRAINT "settlement_bill_actor_membership_fk" FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_records" ADD CONSTRAINT "fee_record_actor_user_fk" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_records" ADD CONSTRAINT "fee_record_actor_membership_fk" FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_batch_receipts" ADD CONSTRAINT "fee_batch_receipt_actor_user_fk" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_batch_receipts" ADD CONSTRAINT "fee_batch_receipt_actor_membership_fk" FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

COMMIT;
