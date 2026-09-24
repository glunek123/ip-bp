CREATE TYPE "lead_evidence_result" AS ENUM ('NO_EVIDENCE');

BEGIN;

ALTER TABLE "lead_review_decisions"
  ADD CONSTRAINT "lead_review_decisions_evidence_identity_key"
  UNIQUE ("id", "lead_id", "customer_id", "department_id", "result");

CREATE TABLE "lead_evidence_decisions" (
  "id" UUID NOT NULL,
  "original_review_decision_id" UUID NOT NULL,
  "original_review_result" "lead_review_result" NOT NULL DEFAULT 'INFRINGEMENT',
  "lead_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "actor_display_name_snapshot" TEXT NOT NULL,
  "result" "lead_evidence_result" NOT NULL,
  "reason" TEXT NOT NULL,
  "archive_type" "lead_archive_type" NOT NULL,
  "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(3) NOT NULL,
  "from_version" INTEGER NOT NULL,
  "to_version" INTEGER NOT NULL,
  CONSTRAINT "lead_evidence_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_evidence_decisions_original_review_decision_id_key" UNIQUE ("original_review_decision_id"),
  CONSTRAINT "lead_evidence_decisions_lead_id_key" UNIQUE ("lead_id"),
  CONSTRAINT "lead_evidence_decisions_lead_identity_key" UNIQUE ("lead_id", "customer_id", "department_id"),
  CONSTRAINT "lead_evidence_decisions_review_identity_key" UNIQUE ("original_review_decision_id", "lead_id", "customer_id", "department_id"),
  CONSTRAINT "lead_evidence_decisions_review_result_identity_key" UNIQUE ("original_review_decision_id", "lead_id", "customer_id", "department_id", "original_review_result"),
  CONSTRAINT "lead_evidence_decisions_reason_check" CHECK ("reason" = BTRIM("reason") AND "reason" ~ '[^[:space:]]' AND CHAR_LENGTH("reason") BETWEEN 1 AND 5000),
  CONSTRAINT "lead_evidence_decisions_result_check" CHECK ("result" = 'NO_EVIDENCE' AND "archive_type" = 'NO_EVIDENCE'),
  CONSTRAINT "lead_evidence_decisions_original_review_result_check" CHECK ("original_review_result" = 'INFRINGEMENT'),
  CONSTRAINT "lead_evidence_decisions_version_check" CHECK ("from_version" >= 1 AND "to_version" = "from_version" + 1),
  CONSTRAINT "lead_evidence_decisions_time_check" CHECK ("archived_at" = "decided_at")
);

CREATE INDEX "lead_evidence_decisions_department_customer_decided_at_idx"
  ON "lead_evidence_decisions" ("department_id", "customer_id", "decided_at");

ALTER TABLE "lead_evidence_decisions"
  ADD CONSTRAINT "lead_evidence_decisions_lead_identity_fkey"
    FOREIGN KEY ("lead_id", "customer_id", "department_id")
    REFERENCES "leads"("id", "customer_id", "department_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "lead_evidence_decisions_review_identity_fkey"
    FOREIGN KEY ("original_review_decision_id", "lead_id", "customer_id", "department_id", "original_review_result")
    REFERENCES "lead_review_decisions"("id", "lead_id", "customer_id", "department_id", "result")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "lead_evidence_decisions_actor_membership_fkey"
    FOREIGN KEY ("actor_user_id", "department_id")
    REFERENCES "department_memberships"("user_id", "department_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION reject_lead_evidence_decision_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lead evidence decisions are immutable' USING ERRCODE = '55000';
END
$$;
CREATE TRIGGER reject_lead_evidence_decision_mutation
BEFORE UPDATE OR DELETE ON "lead_evidence_decisions"
FOR EACH ROW EXECUTE FUNCTION reject_lead_evidence_decision_mutation();

COMMIT;
