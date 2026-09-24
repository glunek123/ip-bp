ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'notary.evidence.record';
ALTER TYPE "notary_matter_stage" ADD VALUE IF NOT EXISTS 'WAITING_UNBOX';

BEGIN;

CREATE TYPE "notary_sample_fee_state" AS ENUM ('KNOWN', 'PENDING');
CREATE TYPE "notary_logistics_field_state" AS ENUM ('PRESENT', 'NONE');

CREATE TABLE "notary_matter_evidence" (
  "matter_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "evidence_at" DATE NOT NULL,
  "sample_fee_state" "notary_sample_fee_state" NOT NULL,
  "sample_fee_amount" NUMERIC(18,2),
  "recorded_by_user_id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notary_matter_evidence_pkey" PRIMARY KEY ("matter_id"),
  CONSTRAINT "notary_matter_evidence_matter_department_key" UNIQUE ("matter_id", "department_id"),
  CONSTRAINT "notary_matter_evidence_sample_fee_check" CHECK (
    ("sample_fee_state" = 'KNOWN' AND "sample_fee_amount" IS NOT NULL AND "sample_fee_amount" >= 0)
    OR ("sample_fee_state" = 'PENDING' AND "sample_fee_amount" IS NULL)
  ),
  CONSTRAINT "notary_matter_evidence_matter_department_fkey" FOREIGN KEY ("matter_id", "department_id")
    REFERENCES "notary_matters"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_matter_evidence_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id")
    REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "notary_matter_logistics" (
  "id" UUID NOT NULL,
  "matter_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "company_state" "notary_logistics_field_state" NOT NULL,
  "company_value" VARCHAR(200),
  "tracking_state" "notary_logistics_field_state" NOT NULL,
  "tracking_value" VARCHAR(100),
  CONSTRAINT "notary_matter_logistics_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notary_matter_logistics_matter_id_position_key" UNIQUE ("matter_id", "position"),
  CONSTRAINT "notary_matter_logistics_position_check" CHECK ("position" >= 1),
  CONSTRAINT "notary_matter_logistics_company_check" CHECK (
    ("company_state" = 'PRESENT' AND "company_value" IS NOT NULL AND "company_value" = BTRIM("company_value") AND CHAR_LENGTH("company_value") BETWEEN 1 AND 200)
    OR ("company_state" = 'NONE' AND "company_value" IS NULL)
  ),
  CONSTRAINT "notary_matter_logistics_tracking_check" CHECK (
    ("tracking_state" = 'PRESENT' AND "tracking_value" IS NOT NULL AND "tracking_value" = BTRIM("tracking_value") AND CHAR_LENGTH("tracking_value") BETWEEN 1 AND 100)
    OR ("tracking_state" = 'NONE' AND "tracking_value" IS NULL)
  ),
  CONSTRAINT "notary_matter_logistics_matter_id_fkey" FOREIGN KEY ("matter_id")
    REFERENCES "notary_matter_evidence"("matter_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "notary_matter_command_receipts" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "action" VARCHAR(100) NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "result_matter_id" UUID NOT NULL,
  "result_matter_version" INTEGER NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notary_matter_command_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notary_matter_receipts_department_actor_action_key" UNIQUE ("department_id", "actor_user_id", "action", "idempotency_key"),
  CONSTRAINT "notary_matter_receipts_version_check" CHECK ("result_matter_version" >= 2),
  CONSTRAINT "notary_matter_receipts_department_id_fkey" FOREIGN KEY ("department_id")
    REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "notary_matter_receipts_actor_department_fkey" FOREIGN KEY ("actor_user_id", "department_id")
    REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_matter_receipts_matter_department_fkey" FOREIGN KEY ("result_matter_id", "department_id")
    REFERENCES "notary_matters"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "notary_matter_receipts_result_matter_department_idx" ON "notary_matter_command_receipts"("result_matter_id", "department_id");

CREATE FUNCTION reject_notary_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'confirmed notary evidence is immutable' USING ERRCODE = '55000';
END
$$;
CREATE TRIGGER reject_notary_evidence_update_delete BEFORE UPDATE OR DELETE ON "notary_matter_evidence"
  FOR EACH ROW EXECUTE FUNCTION reject_notary_evidence_mutation();
CREATE TRIGGER reject_notary_logistics_update_delete BEFORE UPDATE OR DELETE ON "notary_matter_logistics"
  FOR EACH ROW EXECUTE FUNCTION reject_notary_evidence_mutation();

COMMIT;
