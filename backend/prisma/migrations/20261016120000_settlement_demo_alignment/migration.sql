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
    "source_kind" VARCHAR(50),
    "source_id" VARCHAR(200),
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
CREATE UNIQUE INDEX "fee_records_department_source_key" ON "fee_records"("department_id", "source_kind", "source_id");

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
  AND (("source" = 'manual' AND "actor_user_id" IS NOT NULL AND "idempotency_key" IS NOT NULL AND LENGTH(BTRIM("idempotency_key")) > 0 AND "source_kind" IS NULL AND "source_id" IS NULL)
    OR ("source" = 'auto' AND "actor_user_id" IS NULL AND "idempotency_key" IS NULL AND "source_kind" IS NOT NULL AND "source_id" IS NOT NULL AND LENGTH(BTRIM("source_kind")) > 0 AND LENGTH(BTRIM("source_id")) > 0))
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

-- One-time projection of actual existing case sources. These are new ledger
-- New fee proof guards do not replace any installed workflow classifier.
ALTER TABLE "fee_records" ADD CONSTRAINT "fee_proof_material_department_fk"
  FOREIGN KEY ("proof_material_id", "department_id") REFERENCES "materials"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_records" ADD CONSTRAINT "fee_proof_content_material_fk"
  FOREIGN KEY ("proof_material_id", "proof_content_version_id") REFERENCES "content_versions"("material_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION "check_fee_proof_reference"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_category text;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    IF OLD.purpose='FEE_PROOF' OR (TG_OP='UPDATE' AND NEW.purpose='FEE_PROOF') THEN
      RAISE EXCEPTION 'fee proof references are immutable' USING ERRCODE='23514';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  SELECT m.category::text INTO actual_category FROM materials m WHERE m.id=NEW.material_id;
  IF NEW.purpose<>'FEE_PROOF' AND actual_category IS DISTINCT FROM 'FEE_PROOF' THEN RETURN NEW; END IF;
  IF NEW.resource_type<>'fee' OR NEW.purpose<>'FEE_PROOF' OR NEW.asset_version_id IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM fee_records f
    JOIN materials m ON m.id=NEW.material_id AND m.department_id=f.department_id
      AND m.owner_type='CASE' AND m.owner_id=f.case_id AND m.category='FEE_PROOF' AND m.purpose='FEE_PROOF'
      AND m.status='ACTIVE' AND m.deleted_at IS NULL
    JOIN content_versions cv ON cv.id=NEW.content_version_id AND cv.material_id=m.id AND cv.status='AVAILABLE'
      AND cv.case_section_record_upload_draft_id IS NULL AND cv.execution_supplement_upload_draft_id IS NULL
    JOIN audit_events a ON a.id=NEW.action_event_id AND a.department_id=f.department_id
      AND a.resource_type='FEE' AND a.resource_id=f.id AND a.action='fee.proof-updated'
      AND a.actor_kind='HUMAN' AND a.actor_user_id IS NOT NULL AND a.internal_actor_user_id=a.actor_user_id
      AND a.customer_account_binding_id IS NULL AND a.lawyer_account_binding_id IS NULL AND a.notary_office_account_binding_id IS NULL
    WHERE f.id=NEW.resource_id AND f.department_id=NEW.department_id
      AND f.proof_material_id=m.id AND f.proof_content_version_id=cv.id AND f.deleted_at IS NULL
      AND a.details->>'caseId'=f.case_id::text AND a.details->>'proofMaterialId'=m.id::text
      AND a.details->>'proofContentVersionId'=cv.id::text AND a.details->>'toVersion'=f.version::text
      AND a.xmin=pg_current_xact_id()::text::xid AND f.xmin=pg_current_xact_id()::text::xid
  ) THEN RAISE EXCEPTION 'fee proof lacks exact same-transaction internal source' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "fee_proof_reference_guard" BEFORE INSERT OR UPDATE OR DELETE ON "material_references"
  FOR EACH ROW EXECUTE FUNCTION "check_fee_proof_reference"();

CREATE FUNCTION "check_fee_proof_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f fee_records%ROWTYPE;
BEGIN
  SELECT * INTO f FROM fee_records WHERE id=NEW.id;
  IF TG_OP='UPDATE' AND (NEW.proof_material_id,NEW.proof_content_version_id)
    IS DISTINCT FROM (OLD.proof_material_id,OLD.proof_content_version_id) THEN
    IF NEW.version<>OLD.version+1 OR NOT EXISTS (
      SELECT 1 FROM audit_events a WHERE a.department_id=NEW.department_id AND a.resource_type='FEE'
        AND a.resource_id=NEW.id AND a.action='fee.proof-updated' AND a.actor_kind='HUMAN'
        AND a.actor_user_id IS NOT NULL AND a.internal_actor_user_id=a.actor_user_id
        AND a.customer_account_binding_id IS NULL AND a.lawyer_account_binding_id IS NULL AND a.notary_office_account_binding_id IS NULL
        AND a.details->>'caseId'=NEW.case_id::text AND a.details->>'fromVersion'=OLD.version::text
        AND a.details->>'toVersion'=NEW.version::text
        AND (a.details->>'proofMaterialId') IS NOT DISTINCT FROM NEW.proof_material_id::text
        AND (a.details->>'proofContentVersionId') IS NOT DISTINCT FROM NEW.proof_content_version_id::text
        AND a.xmin=pg_current_xact_id()::text::xid
    ) THEN RAISE EXCEPTION 'fee proof change lacks exact internal command audit' USING ERRCODE='23514'; END IF;
  END IF;
  IF f.proof_material_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM material_references r
    JOIN materials m ON m.id=r.material_id AND m.department_id=f.department_id AND m.owner_type='CASE'
      AND m.owner_id=f.case_id AND m.category='FEE_PROOF' AND m.purpose='FEE_PROOF'
    JOIN content_versions cv ON cv.id=r.content_version_id AND cv.material_id=m.id
    JOIN audit_events a ON a.id=r.action_event_id AND a.department_id=f.department_id
      AND a.resource_type='FEE' AND a.resource_id=f.id AND a.action='fee.proof-updated'
      AND a.internal_actor_user_id=a.actor_user_id AND a.actor_user_id IS NOT NULL
    WHERE r.department_id=f.department_id AND r.resource_type='fee' AND r.resource_id=f.id
      AND r.purpose='FEE_PROOF' AND r.material_id=f.proof_material_id AND r.content_version_id=f.proof_content_version_id
      AND r.asset_version_id IS NULL AND a.details->>'caseId'=f.case_id::text
      AND a.details->>'proofMaterialId'=r.material_id::text AND a.details->>'proofContentVersionId'=r.content_version_id::text
  ) THEN RAISE EXCEPTION 'fee current proof lacks exact retained source reference' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "fee_proof_final" AFTER INSERT OR UPDATE ON "fee_records"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_fee_proof_final"();

CREATE FUNCTION "guard_financial_audit_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.action IN ('fee.created','fee.updated','fee.proof-updated','fee.source-initialized','fee.batch.launched','fee.batch.deleted',
    'settlement.terms.updated','settlement.launch.created','settlement.bill.created','settlement.bill.cancelled')
    OR (TG_OP='UPDATE' AND NEW.action IN ('fee.created','fee.updated','fee.proof-updated','fee.source-initialized','fee.batch.launched','fee.batch.deleted',
      'settlement.terms.updated','settlement.launch.created','settlement.bill.created','settlement.bill.cancelled')) THEN
    RAISE EXCEPTION 'financial audit receipts are immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "financial_audit_receipt_immutable" BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "guard_financial_audit_receipt"();

CREATE FUNCTION "guard_fee_source_identity"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'fee history must be retained' USING ERRCODE='23514'; END IF;
  IF (NEW.id,NEW.case_id,NEW.department_id,NEW.source,NEW.source_kind,NEW.source_id,NEW.actor_user_id,NEW.idempotency_key)
    IS DISTINCT FROM (OLD.id,OLD.case_id,OLD.department_id,OLD.source,OLD.source_kind,OLD.source_id,OLD.actor_user_id,OLD.idempotency_key)
    OR (OLD.source='auto' AND (NEW.type,NEW.amount,NEW.fee_date) IS DISTINCT FROM (OLD.type,OLD.amount,OLD.fee_date)) THEN
    RAISE EXCEPTION 'fee source identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "fee_source_identity_immutable" BEFORE UPDATE OR DELETE ON "fee_records"
  FOR EACH ROW EXECUTE FUNCTION "guard_fee_source_identity"();

CREATE FUNCTION "check_fee_automatic_origin"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source<>'auto' THEN RETURN NEW; END IF;
  IF NOT (
    (NEW.source_kind='NOTARY_CERTIFICATE_FEE' AND EXISTS (
      SELECT 1 FROM cases c JOIN notary_certificates cert ON cert.id=c.certificate_id
        AND cert.department_id=c.department_id AND cert.matter_id=c.source_notary_matter_id
      JOIN notary_certificate_fees f ON f.certificate_id=cert.id
      WHERE c.id=NEW.case_id AND c.department_id=NEW.department_id
        AND NEW.source_id=cert.id::text || ':' || f.category::text
        AND f.state='KNOWN' AND f.amount=NEW.amount AND cert.certificate_date=NEW.fee_date
        AND NEW.type=(CASE f.category::text WHEN 'NOTARY' THEN '公证费' WHEN 'INVESTIGATION' THEN '调查费' WHEN 'DISCLOSURE' THEN '披露费' END)
    )) OR (NEW.source_kind='NOTARY_MATTER_EVIDENCE' AND EXISTS (
      SELECT 1 FROM cases c JOIN notary_certificates cert ON cert.id=c.certificate_id
        AND cert.department_id=c.department_id AND cert.matter_id=c.source_notary_matter_id
      JOIN notary_matter_evidence e ON e.matter_id=cert.matter_id AND e.department_id=c.department_id
      WHERE c.id=NEW.case_id AND c.department_id=NEW.department_id
        AND NEW.source_id=e.matter_id::text || ':sample' AND NEW.type='样品费'
        AND e.sample_fee_state='KNOWN' AND e.sample_fee_amount=NEW.amount AND e.evidence_at=NEW.fee_date
    ))
  ) THEN RAISE EXCEPTION 'automatic fee lacks exact known original source' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "fee_automatic_origin_guard" BEFORE INSERT ON "fee_records"
  FOR EACH ROW EXECUTE FUNCTION "check_fee_automatic_origin"();

CREATE FUNCTION "guard_fee_frozen_material"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM material_references r WHERE r.purpose='FEE_PROOF'
    AND ((TG_TABLE_NAME='materials' AND r.material_id=OLD.id)
      OR (TG_TABLE_NAME='content_versions' AND r.content_version_id=OLD.id))) THEN
    IF TG_OP='DELETE' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      RAISE EXCEPTION 'frozen fee proof must be retained' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "fee_frozen_material_guard" BEFORE UPDATE OR DELETE ON "materials"
  FOR EACH ROW EXECUTE FUNCTION "guard_fee_frozen_material"();
CREATE TRIGGER "fee_frozen_content_guard" BEFORE UPDATE OR DELETE ON "content_versions"
  FOR EACH ROW EXECUTE FUNCTION "guard_fee_frozen_material"();

CREATE FUNCTION "reject_fee_batch_receipt_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'fee batch receipts are immutable' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER "fee_batch_receipt_immutable" BEFORE UPDATE OR DELETE ON "fee_batch_receipts"
  FOR EACH ROW EXECUTE FUNCTION "reject_fee_batch_receipt_mutation"();

-- One-time projection of actual existing case sources. These are new ledger
-- rows only; the old certificate/sample facts and their original audits stay.
INSERT INTO "fee_records" (
  "id", "case_id", "department_id", "type", "direction", "status",
  "amount", "fee_date", "source", "source_kind", "source_id"
)
SELECT gen_random_uuid(), c."id", c."department_id",
  CASE f."category"::text WHEN 'NOTARY' THEN '公证费'
    WHEN 'INVESTIGATION' THEN '调查费' WHEN 'DISCLOSURE' THEN '披露费' END,
  '支出', '未发起', f."amount", cert."certificate_date", 'auto',
  'NOTARY_CERTIFICATE_FEE', cert."id"::text || ':' || f."category"::text
FROM "cases" c JOIN "notary_certificates" cert
  ON cert."id"=c."certificate_id" AND cert."department_id"=c."department_id"
  AND cert."matter_id"=c."source_notary_matter_id"
JOIN "notary_certificate_fees" f ON f."certificate_id"=cert."id"
WHERE f."state"='KNOWN' AND f."amount" IS NOT NULL AND f."amount">=0;

INSERT INTO "fee_records" (
  "id", "case_id", "department_id", "type", "direction", "status",
  "amount", "fee_date", "source", "source_kind", "source_id"
)
SELECT gen_random_uuid(), c."id", c."department_id", '样品费',
  '支出', '未发起', e."sample_fee_amount", e."evidence_at", 'auto',
  'NOTARY_MATTER_EVIDENCE', e."matter_id"::text || ':sample'
FROM "cases" c JOIN "notary_certificates" cert
  ON cert."id"=c."certificate_id" AND cert."department_id"=c."department_id"
  AND cert."matter_id"=c."source_notary_matter_id"
JOIN "notary_matter_evidence" e
  ON e."matter_id"=cert."matter_id" AND e."department_id"=c."department_id"
WHERE e."sample_fee_state"='KNOWN' AND e."sample_fee_amount" IS NOT NULL AND e."sample_fee_amount">=0;

COMMIT;
