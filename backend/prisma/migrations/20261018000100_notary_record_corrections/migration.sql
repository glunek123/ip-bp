-- PostgreSQL must commit a new enum value before application statements use it.
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'notary.record.correct';

BEGIN;

CREATE TABLE "notary_evidence_corrections" (
  "id" UUID NOT NULL,
  "matter_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "correction_reason" VARCHAR(500) NOT NULL,
  "evidence_at" DATE NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notary_evidence_corrections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notary_evidence_corrections_matter_id_revision_key" UNIQUE ("matter_id", "revision"),
  CONSTRAINT "notary_evidence_corrections_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "notary_evidence_corrections_reason_check" CHECK ("correction_reason" = BTRIM("correction_reason") AND CHAR_LENGTH("correction_reason") BETWEEN 1 AND 500),
  CONSTRAINT "notary_evidence_corrections_matter_id_department_id_fkey" FOREIGN KEY ("matter_id", "department_id")
    REFERENCES "notary_matters"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_evidence_corrections_original_fkey" FOREIGN KEY ("matter_id", "department_id")
    REFERENCES "notary_matter_evidence"("matter_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_evidence_corrections_actor_user_id_fkey" FOREIGN KEY ("actor_user_id")
    REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "notary_evidence_corrections_department_id_matter_id_idx" ON "notary_evidence_corrections"("department_id", "matter_id");

CREATE TABLE "notary_evidence_correction_logistics" (
  "id" UUID NOT NULL,
  "correction_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "company_state" "notary_logistics_field_state" NOT NULL,
  "company_value" VARCHAR(200),
  "tracking_state" "notary_logistics_field_state" NOT NULL,
  "tracking_value" VARCHAR(100),
  CONSTRAINT "notary_evidence_correction_logistics_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notary_evidence_correction_logistics_correction_id_position_key" UNIQUE ("correction_id", "position"),
  CONSTRAINT "notary_evidence_correction_logistics_position_check" CHECK ("position" >= 1),
  CONSTRAINT "notary_evidence_correction_logistics_company_check" CHECK (
    ("company_state" = 'PRESENT' AND "company_value" IS NOT NULL AND "company_value" = BTRIM("company_value") AND CHAR_LENGTH("company_value") BETWEEN 1 AND 200)
    OR ("company_state" = 'NONE' AND "company_value" IS NULL)
  ),
  CONSTRAINT "notary_evidence_correction_logistics_tracking_check" CHECK (
    ("tracking_state" = 'PRESENT' AND "tracking_value" IS NOT NULL AND "tracking_value" = BTRIM("tracking_value") AND CHAR_LENGTH("tracking_value") BETWEEN 1 AND 100)
    OR ("tracking_state" = 'NONE' AND "tracking_value" IS NULL)
  ),
  CONSTRAINT "notary_evidence_correction_logistics_correction_id_fkey" FOREIGN KEY ("correction_id")
    REFERENCES "notary_evidence_corrections"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "notary_opening_sender_corrections" (
  "id" UUID NOT NULL,
  "matter_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "correction_reason" VARCHAR(500) NOT NULL,
  "sender_name" VARCHAR(200),
  "sender_phone" VARCHAR(100),
  "sender_address" VARCHAR(500),
  "actor_user_id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notary_opening_sender_corrections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notary_opening_sender_corrections_matter_id_revision_key" UNIQUE ("matter_id", "revision"),
  CONSTRAINT "notary_opening_sender_corrections_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "notary_opening_sender_corrections_reason_check" CHECK ("correction_reason" = BTRIM("correction_reason") AND CHAR_LENGTH("correction_reason") BETWEEN 1 AND 500),
  CONSTRAINT "notary_opening_sender_corrections_matter_id_department_id_fkey" FOREIGN KEY ("matter_id", "department_id")
    REFERENCES "notary_matters"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_opening_sender_corrections_original_fkey" FOREIGN KEY ("matter_id", "department_id")
    REFERENCES "notary_matter_opening"("matter_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_opening_sender_corrections_actor_user_id_fkey" FOREIGN KEY ("actor_user_id")
    REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "notary_opening_sender_corrections_department_id_matter_id_idx" ON "notary_opening_sender_corrections"("department_id", "matter_id");

CREATE FUNCTION "reject_notary_record_correction_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'confirmed notary correction is immutable' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER "notary_evidence_corrections_immutable" BEFORE UPDATE OR DELETE ON "notary_evidence_corrections"
  FOR EACH ROW EXECUTE FUNCTION "reject_notary_record_correction_mutation"();
CREATE TRIGGER "notary_evidence_correction_logistics_immutable" BEFORE UPDATE OR DELETE ON "notary_evidence_correction_logistics"
  FOR EACH ROW EXECUTE FUNCTION "reject_notary_record_correction_mutation"();
CREATE TRIGGER "notary_opening_sender_corrections_immutable" BEFORE UPDATE OR DELETE ON "notary_opening_sender_corrections"
  FOR EACH ROW EXECUTE FUNCTION "reject_notary_record_correction_mutation"();

COMMIT;
