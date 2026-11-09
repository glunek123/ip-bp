ALTER TYPE "lead_archive_type" ADD VALUE IF NOT EXISTS 'LINK_REMOVED';
ALTER TYPE "lead_archive_type" ADD VALUE IF NOT EXISTS 'NO_INFRINGEMENT_INFORMATION';

ALTER TABLE "lead_review_decisions" ADD COLUMN "archive_date" DATE;
ALTER TABLE "lead_evidence_decisions" ADD COLUMN "archive_date" DATE;

ALTER TABLE "lead_evidence_decisions"
  DROP CONSTRAINT "lead_evidence_decisions_lead_id_key",
  DROP CONSTRAINT "lead_evidence_decisions_lead_identity_key",
  DROP CONSTRAINT "lead_evidence_decisions_result_check",
  ADD CONSTRAINT "lead_evidence_decisions_result_check" CHECK (
    "result" = 'NO_EVIDENCE' AND "archive_type"::text IN
      ('LINK_REMOVED', 'NO_INFRINGEMENT_INFORMATION', 'NO_EVIDENCE')
  ),
  ADD CONSTRAINT "lead_evidence_decisions_active_identity_key"
    UNIQUE ("id", "lead_id", "customer_id", "department_id");

ALTER TABLE "leads" ADD COLUMN "active_evidence_decision_id" UUID;
UPDATE "leads" AS lead
SET "active_evidence_decision_id" = decision."id"
FROM "lead_evidence_decisions" AS decision
WHERE lead."id" = decision."lead_id";

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_active_evidence_decision_id_key"
    UNIQUE ("active_evidence_decision_id"),
  ADD CONSTRAINT "leads_active_evidence_decision_identity_key"
    UNIQUE ("active_evidence_decision_id", "id", "customer_id", "department_id"),
  ADD CONSTRAINT "leads_active_evidence_decision_identity_fkey"
    FOREIGN KEY ("active_evidence_decision_id", "id", "customer_id", "department_id")
    REFERENCES "lead_evidence_decisions"("id", "lead_id", "customer_id", "department_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "lead_evidence_decisions_lead_identity_idx"
  ON "lead_evidence_decisions"("lead_id", "customer_id", "department_id");
