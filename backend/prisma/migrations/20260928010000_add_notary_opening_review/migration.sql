BEGIN;

ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'notary.opening.review';
ALTER TYPE "notary_matter_stage" ADD VALUE IF NOT EXISTS 'ISSUANCE_DECISION';
ALTER TYPE "notary_matter_stage" ADD VALUE IF NOT EXISTS 'ARCHIVED';

CREATE TYPE "notary_opening_review_result" AS ENUM ('INFRINGEMENT', 'NO_INFRINGEMENT');

ALTER TABLE "notary_matters"
  ADD CONSTRAINT "notary_matters_review_identity_key" UNIQUE ("id", "customer_id", "department_id");

CREATE TABLE "notary_opening_review_decisions" (
  "id" UUID NOT NULL,
  "matter_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "actor_kind" VARCHAR(10) NOT NULL,
  "internal_actor_user_id" UUID,
  "customer_account_binding_id" UUID,
  "actor_display_name_snapshot" VARCHAR(200) NOT NULL,
  "result" "notary_opening_review_result" NOT NULL,
  "reason" TEXT,
  "archived_at" TIMESTAMPTZ(3),
  "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "from_version" INTEGER NOT NULL,
  "to_version" INTEGER NOT NULL,
  CONSTRAINT "notary_opening_review_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notary_opening_review_decisions_matter_id_key" UNIQUE ("matter_id"),
  CONSTRAINT "notary_opening_review_decisions_matter_identity_key" UNIQUE ("matter_id", "customer_id", "department_id"),
  CONSTRAINT "notary_opening_review_decisions_opening_identity_key" UNIQUE ("matter_id", "department_id"),
  CONSTRAINT "notary_opening_review_decisions_receipt_identity_key"
    UNIQUE ("id", "matter_id", "department_id", "customer_id", "actor_user_id", "actor_kind", "to_version"),
  CONSTRAINT "notary_opening_review_decisions_actor_check" CHECK (
    ("actor_kind" = 'INTERNAL' AND "internal_actor_user_id" IS NOT NULL AND "internal_actor_user_id" = "actor_user_id" AND "customer_account_binding_id" IS NULL)
    OR ("actor_kind" = 'CLIENT' AND "internal_actor_user_id" IS NULL AND "customer_account_binding_id" IS NOT NULL)
  ),
  CONSTRAINT "notary_opening_review_decisions_result_check" CHECK (
    ("result" = 'INFRINGEMENT' AND "reason" IS NULL AND "archived_at" IS NULL)
    OR ("result" = 'NO_INFRINGEMENT' AND "reason" IS NOT NULL AND "reason" = BTRIM("reason") AND CHAR_LENGTH("reason") BETWEEN 1 AND 2000 AND "archived_at" IS NOT NULL)
  ),
  CONSTRAINT "notary_opening_review_decisions_actor_name_check" CHECK (
    "actor_display_name_snapshot" = BTRIM("actor_display_name_snapshot") AND CHAR_LENGTH("actor_display_name_snapshot") BETWEEN 1 AND 200
  ),
  CONSTRAINT "notary_opening_review_decisions_version_check" CHECK ("from_version" >= 1 AND "to_version" = "from_version" + 1),
  CONSTRAINT "notary_opening_review_decisions_matter_identity_fkey"
    FOREIGN KEY ("matter_id", "customer_id", "department_id") REFERENCES "notary_matters"("id", "customer_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_opening_review_decisions_opening_fkey"
    FOREIGN KEY ("matter_id", "department_id") REFERENCES "notary_matter_opening"("matter_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_opening_review_decisions_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_opening_review_decisions_internal_actor_fkey"
    FOREIGN KEY ("internal_actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_opening_review_decisions_client_actor_fkey"
    FOREIGN KEY ("customer_account_binding_id", "actor_user_id", "customer_id", "department_id")
    REFERENCES "customer_account_bindings"("id", "user_id", "customer_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "notary_opening_review_decisions_department_customer_decided_at_idx"
  ON "notary_opening_review_decisions"("department_id", "customer_id", "decided_at");

CREATE TABLE "notary_opening_review_receipts" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "actor_kind" VARCHAR(10) NOT NULL,
  "internal_actor_user_id" UUID,
  "customer_account_binding_id" UUID,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "result_matter_id" UUID NOT NULL,
  "result_matter_version" INTEGER NOT NULL,
  "review_decision_id" UUID NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notary_opening_review_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notary_opening_review_receipts_review_decision_id_key" UNIQUE ("review_decision_id"),
  CONSTRAINT "notary_opening_review_receipts_actor_key" UNIQUE ("department_id", "actor_user_id", "idempotency_key"),
  CONSTRAINT "notary_opening_review_receipts_actor_check" CHECK (
    ("actor_kind" = 'INTERNAL' AND "internal_actor_user_id" IS NOT NULL AND "internal_actor_user_id" = "actor_user_id" AND "customer_account_binding_id" IS NULL)
    OR ("actor_kind" = 'CLIENT' AND "internal_actor_user_id" IS NULL AND "customer_account_binding_id" IS NOT NULL)
  ),
  CONSTRAINT "notary_opening_review_receipts_key_check" CHECK (
    "idempotency_key" = BTRIM("idempotency_key") AND CHAR_LENGTH("idempotency_key") BETWEEN 1 AND 128
    AND "request_fingerprint" ~ '^[0-9a-f]{64}$' AND "result_matter_version" >= 1
  ),
  CONSTRAINT "notary_opening_review_receipts_matter_fkey"
    FOREIGN KEY ("result_matter_id", "department_id") REFERENCES "notary_matters"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_opening_review_receipts_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_opening_review_receipts_internal_actor_fkey"
    FOREIGN KEY ("internal_actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_opening_review_receipts_client_actor_fkey"
    FOREIGN KEY ("customer_account_binding_id", "actor_user_id", "customer_id", "department_id")
    REFERENCES "customer_account_bindings"("id", "user_id", "customer_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_opening_review_receipts_decision_identity_fkey"
    FOREIGN KEY ("review_decision_id", "result_matter_id", "department_id", "customer_id", "actor_user_id", "actor_kind", "result_matter_version")
    REFERENCES "notary_opening_review_decisions"("id", "matter_id", "department_id", "customer_id", "actor_user_id", "actor_kind", "to_version") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "notary_opening_review_receipts_matter_department_idx"
  ON "notary_opening_review_receipts"("result_matter_id", "department_id");

CREATE FUNCTION reject_notary_opening_review_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'confirmed notary opening review is immutable' USING ERRCODE = '55000';
END
$$;
CREATE TRIGGER reject_notary_opening_review_decision_mutation BEFORE UPDATE OR DELETE ON "notary_opening_review_decisions"
  FOR EACH ROW EXECUTE FUNCTION reject_notary_opening_review_mutation();
CREATE TRIGGER reject_notary_opening_review_receipt_mutation BEFORE UPDATE OR DELETE ON "notary_opening_review_receipts"
  FOR EACH ROW EXECUTE FUNCTION reject_notary_opening_review_mutation();

COMMIT;
