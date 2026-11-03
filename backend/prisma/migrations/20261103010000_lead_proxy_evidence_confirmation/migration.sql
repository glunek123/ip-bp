BEGIN;

ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'lead.evidence.confirm.proxy';
CREATE TYPE "lead_proxy_evidence_result" AS ENUM ('EVIDENCE', 'NO_EVIDENCE');


CREATE TABLE "lead_proxy_evidence_confirmations" (
  "id" UUID NOT NULL,
  "original_review_decision_id" UUID NOT NULL,
  "original_review_result" "lead_review_result" NOT NULL DEFAULT 'INFRINGEMENT',
  "lead_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "actor_kind" VARCHAR(20) NOT NULL DEFAULT 'INTERNAL_PROXY',
  "actor_display_name_snapshot" TEXT NOT NULL,
  "result" "lead_proxy_evidence_result" NOT NULL,
  "reason" TEXT,
  "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "from_version" INTEGER NOT NULL,
  "to_version" INTEGER NOT NULL,
  CONSTRAINT "lead_proxy_evidence_confirmations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_proxy_evidence_confirmations_actor_kind_check" CHECK ("actor_kind" = 'INTERNAL_PROXY'),
  CONSTRAINT "lead_proxy_evidence_confirmations_review_result_check" CHECK ("original_review_result" = 'INFRINGEMENT'),
  CONSTRAINT "lead_proxy_evidence_confirmations_result_reason_check" CHECK (
    ("result" = 'EVIDENCE' AND "reason" IS NULL) OR
    ("result" = 'NO_EVIDENCE' AND "reason" IS NOT NULL AND length(btrim("reason")) BETWEEN 1 AND 5000)
  ),
  CONSTRAINT "lead_proxy_evidence_confirmations_version_check" CHECK ("from_version" >= 1 AND "to_version" = "from_version" + 1),
  CONSTRAINT "lead_proxy_evidence_confirmations_lead_identity_fkey" FOREIGN KEY ("lead_id", "customer_id", "department_id") REFERENCES "leads"("id", "customer_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "lead_proxy_evidence_confirmations_review_identity_fkey" FOREIGN KEY ("original_review_decision_id", "lead_id", "customer_id", "department_id", "original_review_result") REFERENCES "lead_review_decisions"("id", "lead_id", "customer_id", "department_id", "result") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "lead_proxy_evidence_confirmations_actor_membership_fkey" FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "lead_proxy_evidence_confirmations_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "lead_proxy_evidence_confirmations_lead_version_key" ON "lead_proxy_evidence_confirmations"("lead_id", "from_version");
CREATE INDEX "lead_proxy_evidence_confirmations_review_time_idx" ON "lead_proxy_evidence_confirmations"("original_review_decision_id", "decided_at");
CREATE INDEX "lead_proxy_evidence_confirmations_department_customer_time_idx" ON "lead_proxy_evidence_confirmations"("department_id", "customer_id", "decided_at");

CREATE FUNCTION reject_lead_proxy_evidence_confirmation_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'proxy evidence confirmations are append-only'; END $$;
CREATE TRIGGER lead_proxy_evidence_confirmations_immutable BEFORE UPDATE OR DELETE ON "lead_proxy_evidence_confirmations"
FOR EACH ROW EXECUTE FUNCTION reject_lead_proxy_evidence_confirmation_mutation();

COMMIT;
