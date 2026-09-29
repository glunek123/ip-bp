BEGIN;

ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'notary.return.archive';
CREATE TYPE "notary_return_choice" AS ENUM ('RETURN', 'KEEP', 'REFUND_ONLY');
CREATE TYPE "notary_return_amount_kind" AS ENUM ('REFUND', 'FREIGHT');
CREATE TYPE "notary_return_party_kind" AS ENUM ('CUSTOMER', 'FIRM', 'MERCHANT', 'OTHER');

CREATE TABLE "notary_return_archives" (
  "id" UUID NOT NULL,
  "matter_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "issuance_decision_id" UUID NOT NULL,
  "issuance_decision_choice" "notary_issuance_choice" NOT NULL DEFAULT 'NO_ISSUE',
  "actor_user_id" UUID NOT NULL,
  "return_choice" "notary_return_choice" NOT NULL,
  "archive_reason" TEXT NOT NULL,
  "archived_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "from_version" INTEGER NOT NULL,
  "to_version" INTEGER NOT NULL,
  CONSTRAINT "notary_return_archives_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notary_return_archives_matter_id_key" UNIQUE ("matter_id"),
  CONSTRAINT "notary_return_archives_issuance_decision_id_key" UNIQUE ("issuance_decision_id"),
  CONSTRAINT "notary_return_archives_amount_identity_key" UNIQUE ("id", "matter_id", "department_id", "return_choice"),
  CONSTRAINT "notary_return_archives_matter_department_key" UNIQUE ("matter_id", "department_id"),
  CONSTRAINT "notary_return_archives_decision_identity_key" UNIQUE ("issuance_decision_id", "matter_id", "department_id", "issuance_decision_choice"),
  CONSTRAINT "notary_return_archives_decision_check" CHECK ("issuance_decision_choice" = 'NO_ISSUE'),
  CONSTRAINT "notary_return_archives_reason_check" CHECK (
    "archive_reason" = BTRIM("archive_reason") AND CHAR_LENGTH("archive_reason") BETWEEN 1 AND 5000
  ),
  CONSTRAINT "notary_return_archives_version_check" CHECK ("from_version" >= 1 AND "to_version" = "from_version" + 1),
  CONSTRAINT "notary_return_archives_matter_fkey"
    FOREIGN KEY ("matter_id", "department_id") REFERENCES "notary_matters"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_return_archives_decision_fkey"
    FOREIGN KEY ("issuance_decision_id", "matter_id", "department_id", "issuance_decision_choice")
    REFERENCES "notary_issuance_decisions"("id", "matter_id", "department_id", "decision") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_return_archives_actor_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_return_archives_internal_actor_fkey"
    FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "notary_return_archives_department_archived_at_idx" ON "notary_return_archives"("department_id", "archived_at");

CREATE TABLE "notary_return_amounts" (
  "id" UUID NOT NULL,
  "archive_id" UUID NOT NULL,
  "matter_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "return_choice" "notary_return_choice" NOT NULL,
  "kind" "notary_return_amount_kind" NOT NULL,
  "state" "notary_sample_fee_state" NOT NULL,
  "amount" DECIMAL(18,2),
  "party_kind" "notary_return_party_kind",
  "party_name" VARCHAR(200),
  "source_evidence_matter_id" UUID,
  CONSTRAINT "notary_return_amounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notary_return_amounts_archive_kind_key" UNIQUE ("archive_id", "kind"),
  CONSTRAINT "notary_return_amounts_branch_check" CHECK (
    ("return_choice" = 'RETURN') OR ("return_choice" = 'REFUND_ONLY' AND "kind" = 'REFUND')
  ),
  CONSTRAINT "notary_return_amounts_state_check" CHECK (
    ("state" = 'KNOWN' AND "amount" IS NOT NULL AND "amount" >= 0)
    OR ("state" = 'PENDING' AND "amount" IS NULL)
  ),
  CONSTRAINT "notary_return_amounts_party_check" CHECK (
    (("state" = 'KNOWN' AND "amount" > 0) = ("party_kind" IS NOT NULL))
    AND COALESCE("party_kind" = 'OTHER', FALSE) = ("party_name" IS NOT NULL)
    AND ("party_name" IS NULL OR ("party_name" = BTRIM("party_name") AND CHAR_LENGTH("party_name") BETWEEN 1 AND 200))
  ),
  CONSTRAINT "notary_return_amounts_source_check" CHECK (
    ("kind" = 'REFUND' AND "source_evidence_matter_id" IS NOT NULL AND "source_evidence_matter_id" = "matter_id")
    OR ("kind" = 'FREIGHT' AND "source_evidence_matter_id" IS NULL)
  ),
  CONSTRAINT "notary_return_amounts_archive_fkey"
    FOREIGN KEY ("archive_id", "matter_id", "department_id", "return_choice")
    REFERENCES "notary_return_archives"("id", "matter_id", "department_id", "return_choice") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_return_amounts_source_fkey"
    FOREIGN KEY ("source_evidence_matter_id", "department_id")
    REFERENCES "notary_matter_evidence"("matter_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "notary_return_amounts_source_idx" ON "notary_return_amounts"("source_evidence_matter_id", "department_id");

CREATE FUNCTION reject_notary_return_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'confirmed notary return fact is immutable' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER reject_notary_return_archive_mutation BEFORE UPDATE OR DELETE ON "notary_return_archives"
  FOR EACH ROW EXECUTE FUNCTION reject_notary_return_mutation();
CREATE TRIGGER reject_notary_return_amount_mutation BEFORE UPDATE OR DELETE ON "notary_return_amounts"
  FOR EACH ROW EXECUTE FUNCTION reject_notary_return_mutation();

COMMIT;
