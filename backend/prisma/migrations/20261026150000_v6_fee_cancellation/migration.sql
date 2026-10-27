-- Source draft only. Apply after schema and PostgreSQL migration review.
BEGIN;
CREATE TABLE "fee_cancellations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "fee_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "original_status" VARCHAR(20) NOT NULL,
  "original_amount" DECIMAL(30,2) NOT NULL,
  "original_version" INTEGER NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" VARCHAR(64) NOT NULL,
  "action_event_id" UUID NOT NULL,
  "outcome" VARCHAR(20) NOT NULL,
  "refund_reconciliation_status" VARCHAR(20) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fee_cancellations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fee_cancellations_outcome_check" CHECK ("outcome" IN ('DELETED', 'VOIDED')),
  CONSTRAINT "fee_cancellations_refund_status_check" CHECK ("refund_reconciliation_status" IN ('NOT_REQUIRED', 'PENDING', 'PAYMENT_UNVERIFIED')),
  CONSTRAINT "fee_cancellations_original_version_check" CHECK ("original_version" >= 1),
  CONSTRAINT "fee_cancellations_reason_check" CHECK (length(btrim("reason")) > 0)
);

CREATE UNIQUE INDEX "fee_cancellations_fee_id_key" ON "fee_cancellations"("fee_id");
CREATE UNIQUE INDEX "fee_cancellations_id_department_key" ON "fee_cancellations"("id", "department_id");
CREATE UNIQUE INDEX "fee_cancellations_fee_department_key" ON "fee_cancellations"("fee_id", "department_id");
CREATE UNIQUE INDEX "fee_cancellations_department_actor_idempotency_key" ON "fee_cancellations"("department_id", "actor_user_id", "idempotency_key");
CREATE UNIQUE INDEX "fee_cancellations_action_event_id_key" ON "fee_cancellations"("action_event_id");
CREATE INDEX "fee_cancellations_department_case_idx" ON "fee_cancellations"("department_id", "case_id", "created_at");

ALTER TABLE "fee_cancellations" ADD CONSTRAINT "fee_cancellations_fee_department_fk"
  FOREIGN KEY ("fee_id", "department_id") REFERENCES "fee_records"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_cancellations" ADD CONSTRAINT "fee_cancellations_case_department_fk"
  FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_cancellations" ADD CONSTRAINT "fee_cancellations_actor_user_fk"
  FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_cancellations" ADD CONSTRAINT "fee_cancellations_actor_department_fk"
  FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_cancellations" ADD CONSTRAINT "fee_cancellations_action_event_id_fkey"
  FOREIGN KEY ("action_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- A cancellation may only follow an optimistic version bump in the same fee row.
-- The linked audit event must describe the exact action and immutable snapshot.
CREATE FUNCTION "guard_fee_cancellation_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  fee_row "fee_records"%ROWTYPE;
  audit_row "audit_events"%ROWTYPE;
BEGIN
  SELECT * INTO fee_row FROM "fee_records" WHERE "id" = NEW."fee_id" AND "department_id" = NEW."department_id" FOR UPDATE;
  IF NOT FOUND OR fee_row."case_id" IS DISTINCT FROM NEW."case_id"
     OR fee_row."status" IS DISTINCT FROM NEW."original_status"
     OR fee_row."amount" IS DISTINCT FROM NEW."original_amount"
     OR fee_row."version" IS DISTINCT FROM NEW."original_version" + 1 THEN
    RAISE EXCEPTION 'fee cancellation source snapshot mismatch';
  END IF;
  IF (NEW."outcome" = 'VOIDED' AND (NEW."original_status" NOT IN ('发起', '已支付') OR fee_row."deleted_at" IS NOT NULL
      OR NEW."refund_reconciliation_status" <> CASE WHEN NEW."original_status" = '发起' THEN 'PAYMENT_UNVERIFIED' ELSE 'PENDING' END))
     OR (NEW."outcome" = 'DELETED' AND (NEW."original_status" <> '未发起' OR fee_row."deleted_at" IS NULL OR NEW."refund_reconciliation_status" <> 'NOT_REQUIRED')) THEN
    RAISE EXCEPTION 'fee cancellation outcome mismatch';
  END IF;
  SELECT * INTO audit_row FROM "audit_events" WHERE "id" = NEW."action_event_id" FOR UPDATE;
  IF NOT FOUND OR audit_row."department_id" IS DISTINCT FROM NEW."department_id"
     OR audit_row."actor_user_id" IS DISTINCT FROM NEW."actor_user_id"
     OR audit_row."internal_actor_user_id" IS DISTINCT FROM NEW."actor_user_id"
     OR audit_row."resource_type" IS DISTINCT FROM 'FEE'
     OR audit_row."resource_id" IS DISTINCT FROM NEW."fee_id"
     OR audit_row."action" IS DISTINCT FROM (CASE WHEN NEW."outcome" = 'VOIDED' THEN 'fee.voided' ELSE 'fee.deleted' END)
     OR audit_row."details"->>'cancellationId' IS DISTINCT FROM NEW."id"::text
     OR audit_row."details"->>'originalStatus' IS DISTINCT FROM NEW."original_status"
     OR (audit_row."details"->>'originalAmount')::numeric IS DISTINCT FROM NEW."original_amount"
     OR audit_row."details"->>'reason' IS DISTINCT FROM NEW."reason"
     OR audit_row."details"->>'requestFingerprint' IS DISTINCT FROM NEW."request_fingerprint"
     OR (audit_row."details"->>'fromVersion')::integer IS DISTINCT FROM NEW."original_version"
     OR (audit_row."details"->>'toVersion')::integer IS DISTINCT FROM NEW."original_version" + 1 THEN
    RAISE EXCEPTION 'fee cancellation audit mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "fee_cancellations_insert_guard" BEFORE INSERT ON "fee_cancellations"
  FOR EACH ROW EXECUTE FUNCTION "guard_fee_cancellation_insert"();

CREATE FUNCTION "guard_fee_cancellation_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'fee cancellation is immutable';
END;
$$;
CREATE TRIGGER "fee_cancellations_immutable_guard" BEFORE UPDATE OR DELETE ON "fee_cancellations"
  FOR EACH ROW EXECUTE FUNCTION "guard_fee_cancellation_immutable"();

CREATE FUNCTION "guard_cancelled_fee_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "fee_cancellations" WHERE "fee_id" = OLD."id") THEN
    RAISE EXCEPTION 'cancelled fee source is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "fee_records_cancelled_guard" BEFORE UPDATE OR DELETE ON "fee_records"
  FOR EACH ROW EXECUTE FUNCTION "guard_cancelled_fee_immutable"();

CREATE FUNCTION "guard_fee_cancellation_audit_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "fee_cancellations" WHERE "action_event_id" = OLD."id") THEN
    RAISE EXCEPTION 'fee cancellation audit is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "audit_events_fee_cancellation_guard" BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "guard_fee_cancellation_audit_immutable"();

CREATE TABLE "fee_cancellation_payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cancellation_id" UUID NOT NULL,
  "fee_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "amount" DECIMAL(30,2) NOT NULL,
  "payment_date" DATE,
  "proof_material_id" UUID,
  "proof_content_version_id" UUID,
  "actor_user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" VARCHAR(64) NOT NULL,
  "action_event_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fee_cancellation_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fee_cancellation_payments_amount_check" CHECK ("amount" >= 0),
  CONSTRAINT "fee_cancellation_payments_date_check" CHECK (("amount" = 0 AND "payment_date" IS NULL) OR ("amount" > 0 AND "payment_date" IS NOT NULL)),
  CONSTRAINT "fee_cancellation_payments_proof_pair_check" CHECK (("proof_material_id" IS NULL) = ("proof_content_version_id" IS NULL))
);
CREATE UNIQUE INDEX "fee_cancellation_payments_cancellation_id_key" ON "fee_cancellation_payments"("cancellation_id");
CREATE UNIQUE INDEX "fee_cancellation_payments_cancellation_department_key" ON "fee_cancellation_payments"("cancellation_id", "department_id");
CREATE UNIQUE INDEX "fee_cancellation_payments_id_cancellation_department_key" ON "fee_cancellation_payments"("id", "cancellation_id", "department_id");
CREATE UNIQUE INDEX "fee_cancellation_payments_department_actor_key" ON "fee_cancellation_payments"("department_id", "actor_user_id", "idempotency_key");
CREATE UNIQUE INDEX "fee_cancellation_payments_action_event_id_key" ON "fee_cancellation_payments"("action_event_id");
ALTER TABLE "fee_cancellation_payments" ADD CONSTRAINT "fee_cancellation_payments_cancellation_id_department_id_fkey"
  FOREIGN KEY ("cancellation_id", "department_id") REFERENCES "fee_cancellations"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_cancellation_payments" ADD CONSTRAINT "fee_cancellation_payments_fee_id_department_id_fkey"
  FOREIGN KEY ("fee_id", "department_id") REFERENCES "fee_records"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_cancellation_payments" ADD CONSTRAINT "fee_cancellation_payments_case_id_department_id_fkey"
  FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_cancellation_payments" ADD CONSTRAINT "fee_cancellation_payments_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_cancellation_payments" ADD CONSTRAINT "fee_cancellation_payments_actor_user_id_department_id_fkey"
  FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_cancellation_payments" ADD CONSTRAINT "fee_cancellation_payments_action_event_id_fkey"
  FOREIGN KEY ("action_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_cancellation_payments" ADD CONSTRAINT "fee_cancellation_payments_proof_material_id_department_id_fkey"
  FOREIGN KEY ("proof_material_id", "department_id") REFERENCES "materials"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_cancellation_payments" ADD CONSTRAINT "fee_cancellation_payments_proof_material_id_proof_content_version_id_fkey"
  FOREIGN KEY ("proof_material_id", "proof_content_version_id") REFERENCES "content_versions"("material_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "fee_refund_reconciliations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cancellation_id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "fee_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "amount" DECIMAL(30,2) NOT NULL,
  "refund_date" DATE NOT NULL,
  "proof_material_id" UUID,
  "proof_content_version_id" UUID,
  "actor_user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" VARCHAR(64) NOT NULL,
  "action_event_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fee_refund_reconciliations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fee_refund_reconciliations_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "fee_refund_reconciliations_proof_pair_check" CHECK (("proof_material_id" IS NULL) = ("proof_content_version_id" IS NULL))
);
CREATE UNIQUE INDEX "fee_refund_reconciliations_department_actor_key" ON "fee_refund_reconciliations"("department_id", "actor_user_id", "idempotency_key");
CREATE UNIQUE INDEX "fee_refund_reconciliations_action_event_id_key" ON "fee_refund_reconciliations"("action_event_id");
CREATE INDEX "fee_refund_reconciliations_payment_id_idx" ON "fee_refund_reconciliations"("payment_id");
ALTER TABLE "fee_refund_reconciliations" ADD CONSTRAINT "fee_refund_reconciliations_cancellation_id_department_id_fkey"
  FOREIGN KEY ("cancellation_id", "department_id") REFERENCES "fee_cancellations"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_refund_reconciliations" ADD CONSTRAINT "fee_refund_reconciliations_payment_id_cancellation_id_department_id_fkey"
  FOREIGN KEY ("payment_id", "cancellation_id", "department_id") REFERENCES "fee_cancellation_payments"("id", "cancellation_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_refund_reconciliations" ADD CONSTRAINT "fee_refund_reconciliations_fee_id_department_id_fkey"
  FOREIGN KEY ("fee_id", "department_id") REFERENCES "fee_records"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_refund_reconciliations" ADD CONSTRAINT "fee_refund_reconciliations_case_id_department_id_fkey"
  FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_refund_reconciliations" ADD CONSTRAINT "fee_refund_reconciliations_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_refund_reconciliations" ADD CONSTRAINT "fee_refund_reconciliations_actor_user_id_department_id_fkey"
  FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_refund_reconciliations" ADD CONSTRAINT "fee_refund_reconciliations_action_event_id_fkey"
  FOREIGN KEY ("action_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_refund_reconciliations" ADD CONSTRAINT "fee_refund_reconciliations_proof_material_id_department_id_fkey"
  FOREIGN KEY ("proof_material_id", "department_id") REFERENCES "materials"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "fee_refund_reconciliations" ADD CONSTRAINT "fee_refund_reconciliations_proof_material_id_proof_content_version_id_fkey"
  FOREIGN KEY ("proof_material_id", "proof_content_version_id") REFERENCES "content_versions"("material_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Freeze is written by the service before the immutable payment/refund fact.
-- Lock both rows so a concurrent deletion cannot pass between status checks and insert.
-- A historical version may be used when it remains AVAILABLE and has an exact frozen reference.
CREATE FUNCTION "assert_fee_reconciliation_proof"(
  p_department_id uuid,
  p_case_id uuid,
  p_material_id uuid,
  p_content_version_id uuid,
  p_action_event_id uuid,
  p_resource_type text,
  p_resource_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  proof_row "materials"%ROWTYPE;
  version_status text;
BEGIN
  IF p_material_id IS NULL THEN RETURN; END IF;
  SELECT * INTO proof_row FROM "materials"
    WHERE "id" = p_material_id AND "department_id" = p_department_id FOR UPDATE;
  IF NOT FOUND OR proof_row."owner_type"::text <> 'CASE'
     OR proof_row."owner_id" IS DISTINCT FROM p_case_id
     OR proof_row."category"::text <> 'FEE_PROOF'
     OR proof_row."purpose" IS DISTINCT FROM 'FEE_PROOF'
     OR proof_row."status"::text <> 'ACTIVE'
     OR proof_row."deleted_at" IS NOT NULL THEN
    RAISE EXCEPTION 'fee reconciliation material is not available';
  END IF;
  SELECT "status"::text INTO version_status FROM "content_versions"
    WHERE "id" = p_content_version_id AND "material_id" = p_material_id FOR UPDATE;
  IF NOT FOUND OR version_status <> 'AVAILABLE' THEN
    RAISE EXCEPTION 'fee reconciliation content version is not available';
  END IF;
  PERFORM 1 FROM "material_references"
    WHERE "department_id" = p_department_id
      AND "resource_type" = p_resource_type
      AND "resource_id" = p_resource_id
      AND "purpose" = 'FEE_PROOF'
      AND "material_id" = p_material_id
      AND "content_version_id" = p_content_version_id
      AND "action_event_id" = p_action_event_id
      AND "asset_version_id" IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fee reconciliation proof is not frozen to this fact';
  END IF;
END;
$$;

CREATE FUNCTION "guard_fee_payment_verification_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cancellation_row "fee_cancellations"%ROWTYPE;
  audit_row "audit_events"%ROWTYPE;
BEGIN
  SELECT * INTO cancellation_row FROM "fee_cancellations" WHERE "id" = NEW."cancellation_id" AND "department_id" = NEW."department_id" FOR UPDATE;
  IF NOT FOUND OR cancellation_row."outcome" <> 'VOIDED'
     OR cancellation_row."fee_id" IS DISTINCT FROM NEW."fee_id"
     OR cancellation_row."case_id" IS DISTINCT FROM NEW."case_id" THEN
    RAISE EXCEPTION 'payment verification cancellation mismatch';
  END IF;
  PERFORM "assert_fee_reconciliation_proof"(
    NEW."department_id", NEW."case_id", NEW."proof_material_id",
    NEW."proof_content_version_id", NEW."action_event_id",
    'fee-payment-verification', NEW."id"
  );
  SELECT * INTO audit_row FROM "audit_events" WHERE "id" = NEW."action_event_id" FOR UPDATE;
  IF NOT FOUND OR audit_row."department_id" IS DISTINCT FROM NEW."department_id"
     OR audit_row."actor_user_id" IS DISTINCT FROM NEW."actor_user_id"
     OR audit_row."internal_actor_user_id" IS DISTINCT FROM NEW."actor_user_id"
     OR audit_row."resource_type" IS DISTINCT FROM 'FEE'
     OR audit_row."resource_id" IS DISTINCT FROM NEW."fee_id"
     OR audit_row."action" IS DISTINCT FROM 'fee.payment-verified'
     OR audit_row."details"->>'paymentId' IS DISTINCT FROM NEW."id"::text
     OR audit_row."details"->>'cancellationId' IS DISTINCT FROM NEW."cancellation_id"::text
     OR (audit_row."details"->>'amount')::numeric IS DISTINCT FROM NEW."amount"
      OR audit_row."details"->>'paymentDate' IS DISTINCT FROM (CASE WHEN NEW."payment_date" IS NULL THEN NULL ELSE to_char(NEW."payment_date", 'YYYY-MM-DD') END)
     OR audit_row."details"->>'proofMaterialId' IS DISTINCT FROM NEW."proof_material_id"::text
     OR audit_row."details"->>'proofContentVersionId' IS DISTINCT FROM NEW."proof_content_version_id"::text
     OR audit_row."details"->>'requestFingerprint' IS DISTINCT FROM NEW."request_fingerprint" THEN
    RAISE EXCEPTION 'payment verification audit mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "fee_cancellation_payments_insert_guard" BEFORE INSERT ON "fee_cancellation_payments"
  FOR EACH ROW EXECUTE FUNCTION "guard_fee_payment_verification_insert"();

CREATE FUNCTION "guard_fee_refund_reconciliation_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cancellation_row "fee_cancellations"%ROWTYPE;
  payment_row "fee_cancellation_payments"%ROWTYPE;
  audit_row "audit_events"%ROWTYPE;
  refunded NUMERIC;
BEGIN
  SELECT * INTO cancellation_row FROM "fee_cancellations" WHERE "id" = NEW."cancellation_id" AND "department_id" = NEW."department_id";
  IF NOT FOUND OR cancellation_row."outcome" <> 'VOIDED'
     OR cancellation_row."fee_id" IS DISTINCT FROM NEW."fee_id"
     OR cancellation_row."case_id" IS DISTINCT FROM NEW."case_id" THEN
    RAISE EXCEPTION 'refund cancellation mismatch';
  END IF;
  -- Serialize even direct SQL writers on the same verified payment row.
  SELECT * INTO payment_row FROM "fee_cancellation_payments" WHERE "id" = NEW."payment_id" AND "cancellation_id" = NEW."cancellation_id" AND "department_id" = NEW."department_id" FOR UPDATE;
  IF NOT FOUND OR payment_row."fee_id" IS DISTINCT FROM NEW."fee_id"
     OR payment_row."case_id" IS DISTINCT FROM NEW."case_id" OR payment_row."amount" <= 0 THEN
    RAISE EXCEPTION 'refund payment mismatch';
  END IF;
  SELECT COALESCE(SUM("amount"), 0) INTO refunded FROM "fee_refund_reconciliations" WHERE "payment_id" = NEW."payment_id";
  IF refunded + NEW."amount" > payment_row."amount" THEN
    RAISE EXCEPTION 'refund exceeds verified payment';
  END IF;
  PERFORM "assert_fee_reconciliation_proof"(
    NEW."department_id", NEW."case_id", NEW."proof_material_id",
    NEW."proof_content_version_id", NEW."action_event_id",
    'fee-refund-reconciliation', NEW."id"
  );
  SELECT * INTO audit_row FROM "audit_events" WHERE "id" = NEW."action_event_id" FOR UPDATE;
  IF NOT FOUND OR audit_row."department_id" IS DISTINCT FROM NEW."department_id"
     OR audit_row."actor_user_id" IS DISTINCT FROM NEW."actor_user_id"
     OR audit_row."internal_actor_user_id" IS DISTINCT FROM NEW."actor_user_id"
     OR audit_row."resource_type" IS DISTINCT FROM 'FEE'
     OR audit_row."resource_id" IS DISTINCT FROM NEW."fee_id"
     OR audit_row."action" IS DISTINCT FROM 'fee.refund-reconciled'
     OR audit_row."details"->>'refundId' IS DISTINCT FROM NEW."id"::text
     OR audit_row."details"->>'cancellationId' IS DISTINCT FROM NEW."cancellation_id"::text
     OR audit_row."details"->>'paymentId' IS DISTINCT FROM NEW."payment_id"::text
     OR (audit_row."details"->>'amount')::numeric IS DISTINCT FROM NEW."amount"
     OR audit_row."details"->>'refundDate' IS DISTINCT FROM to_char(NEW."refund_date", 'YYYY-MM-DD')
     OR audit_row."details"->>'proofMaterialId' IS DISTINCT FROM NEW."proof_material_id"::text
     OR audit_row."details"->>'proofContentVersionId' IS DISTINCT FROM NEW."proof_content_version_id"::text
     OR audit_row."details"->>'requestFingerprint' IS DISTINCT FROM NEW."request_fingerprint" THEN
    RAISE EXCEPTION 'refund audit mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "fee_refund_reconciliations_insert_guard" BEFORE INSERT ON "fee_refund_reconciliations"
  FOR EACH ROW EXECUTE FUNCTION "guard_fee_refund_reconciliation_insert"();

CREATE FUNCTION "guard_fee_financial_fact_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'fee payment or refund fact is immutable';
END;
$$;
CREATE TRIGGER "fee_cancellation_payments_immutable_guard" BEFORE UPDATE OR DELETE ON "fee_cancellation_payments"
  FOR EACH ROW EXECUTE FUNCTION "guard_fee_financial_fact_immutable"();
CREATE TRIGGER "fee_refund_reconciliations_immutable_guard" BEFORE UPDATE OR DELETE ON "fee_refund_reconciliations"
  FOR EACH ROW EXECUTE FUNCTION "guard_fee_financial_fact_immutable"();

CREATE OR REPLACE FUNCTION "guard_fee_cancellation_audit_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "fee_cancellations" WHERE "action_event_id" = OLD."id")
     OR EXISTS (SELECT 1 FROM "fee_cancellation_payments" WHERE "action_event_id" = OLD."id")
     OR EXISTS (SELECT 1 FROM "fee_refund_reconciliations" WHERE "action_event_id" = OLD."id") THEN
    RAISE EXCEPTION 'fee financial audit is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_fee_reconciliation_reference_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD."resource_type" = 'fee-payment-verification' AND EXISTS (
       SELECT 1 FROM "fee_cancellation_payments" fact
       WHERE fact."id" = OLD."resource_id"
         AND fact."department_id" = OLD."department_id"
         AND fact."action_event_id" = OLD."action_event_id"
         AND fact."proof_material_id" = OLD."material_id"
         AND fact."proof_content_version_id" = OLD."content_version_id"
     )) OR (OLD."resource_type" = 'fee-refund-reconciliation' AND EXISTS (
       SELECT 1 FROM "fee_refund_reconciliations" fact
       WHERE fact."id" = OLD."resource_id"
         AND fact."department_id" = OLD."department_id"
         AND fact."action_event_id" = OLD."action_event_id"
         AND fact."proof_material_id" = OLD."material_id"
         AND fact."proof_content_version_id" = OLD."content_version_id"
     )) THEN
    RAISE EXCEPTION 'fee reconciliation proof reference is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "material_references_fee_reconciliation_guard" BEFORE UPDATE OR DELETE ON "material_references"
  FOR EACH ROW EXECUTE FUNCTION "guard_fee_reconciliation_reference_immutable"();

-- The installed fee proof guard predates payment/refund reconciliation. Keep
-- its original fee path unchanged; the two new paths consume an exact audit
-- written in this transaction before the immutable fact is inserted.
CREATE OR REPLACE FUNCTION "check_fee_proof_reference"() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF NEW.resource_type IN ('fee-payment-verification', 'fee-refund-reconciliation')
     AND NEW.purpose='FEE_PROOF' AND actual_category='FEE_PROOF' THEN
    IF NEW.asset_version_id IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM fee_cancellations cancellation
      JOIN fee_records fee ON fee.id=cancellation.fee_id AND fee.department_id=cancellation.department_id
        AND fee.case_id=cancellation.case_id AND fee.deleted_at IS NULL
      JOIN materials material ON material.id=NEW.material_id AND material.department_id=cancellation.department_id
        AND material.owner_type='CASE' AND material.owner_id=cancellation.case_id
        AND material.category='FEE_PROOF' AND material.purpose='FEE_PROOF'
        AND material.status='ACTIVE' AND material.deleted_at IS NULL
      JOIN content_versions version ON version.id=NEW.content_version_id AND version.material_id=material.id
        AND version.status='AVAILABLE' AND version.case_section_record_upload_draft_id IS NULL
        AND version.execution_supplement_upload_draft_id IS NULL
      JOIN audit_events audit ON audit.id=NEW.action_event_id AND audit.department_id=cancellation.department_id
        AND audit.resource_type='FEE' AND audit.resource_id=fee.id
        AND audit.action=CASE NEW.resource_type
          WHEN 'fee-payment-verification' THEN 'fee.payment-verified'
          ELSE 'fee.refund-reconciled' END
        AND audit.actor_kind='HUMAN' AND audit.actor_user_id IS NOT NULL
        AND audit.internal_actor_user_id=audit.actor_user_id
        AND audit.customer_account_binding_id IS NULL AND audit.lawyer_account_binding_id IS NULL
        AND audit.notary_office_account_binding_id IS NULL
      JOIN department_memberships membership ON membership.user_id=audit.actor_user_id
        AND membership.department_id=cancellation.department_id AND membership.active=true
      JOIN user_accounts account ON account.id=audit.actor_user_id
        AND account.active=true AND account.account_type='INTERNAL'
      WHERE cancellation.department_id=NEW.department_id AND cancellation.outcome='VOIDED'
        AND audit.details->>(CASE NEW.resource_type
          WHEN 'fee-payment-verification' THEN 'paymentId' ELSE 'refundId' END)=NEW.resource_id::text
        AND audit.details->>'cancellationId'=cancellation.id::text
        AND audit.details->>'proofMaterialId'=material.id::text
        AND audit.details->>'proofContentVersionId'=version.id::text
        AND audit.xmin=pg_current_xact_id()::text::xid
    ) THEN RAISE EXCEPTION 'fee reconciliation proof lacks exact same-transaction internal source' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
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

-- Reference insertion precedes fact insertion. At commit every new reference
-- must point back to the exact fact created in this same transaction.
CREATE FUNCTION "check_fee_reconciliation_reference_final"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (
    (NEW.resource_type='fee-payment-verification' AND EXISTS (
      SELECT 1 FROM fee_cancellation_payments fact
      WHERE fact.id=NEW.resource_id AND fact.department_id=NEW.department_id
        AND fact.proof_material_id=NEW.material_id AND fact.proof_content_version_id=NEW.content_version_id
        AND fact.action_event_id=NEW.action_event_id AND fact.xmin=pg_current_xact_id()::text::xid
    )) OR
    (NEW.resource_type='fee-refund-reconciliation' AND EXISTS (
      SELECT 1 FROM fee_refund_reconciliations fact
      WHERE fact.id=NEW.resource_id AND fact.department_id=NEW.department_id
        AND fact.proof_material_id=NEW.material_id AND fact.proof_content_version_id=NEW.content_version_id
        AND fact.action_event_id=NEW.action_event_id AND fact.xmin=pg_current_xact_id()::text::xid
    ))
  ) THEN RAISE EXCEPTION 'fee reconciliation proof lacks exact same-transaction fact' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "fee_reconciliation_reference_final" AFTER INSERT ON "material_references"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.resource_type IN ('fee-payment-verification', 'fee-refund-reconciliation') AND NEW.purpose='FEE_PROOF')
  EXECUTE FUNCTION "check_fee_reconciliation_reference_final"();

COMMIT;
