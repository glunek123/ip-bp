BEGIN;

CREATE TYPE "lead_review_result" AS ENUM ('INFRINGEMENT');

CREATE TABLE "lead_review_decisions" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "reviewer_user_id" UUID NOT NULL,
  "customer_account_binding_id" UUID NOT NULL,
  "reviewer_display_name_snapshot" TEXT NOT NULL,
  "result" "lead_review_result" NOT NULL,
  "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "from_version" INTEGER NOT NULL,
  "to_version" INTEGER NOT NULL,
  CONSTRAINT "lead_review_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_review_decisions_lead_id_key" UNIQUE ("lead_id"),
  CONSTRAINT "lead_review_decisions_lead_id_department_id_key" UNIQUE ("lead_id", "department_id"),
  CONSTRAINT "lead_review_decisions_from_version_positive_check" CHECK ("from_version" >= 1),
  CONSTRAINT "lead_review_decisions_version_transition_check" CHECK ("to_version" = "from_version" + 1)
);

CREATE INDEX "lead_review_decisions_department_id_customer_id_decided_at_idx"
  ON "lead_review_decisions"("department_id", "customer_id", "decided_at");

ALTER TABLE "lead_review_decisions"
  ADD CONSTRAINT "lead_review_decisions_department_id_fkey"
    FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "lead_review_decisions_lead_department_fkey"
    FOREIGN KEY ("lead_id", "department_id") REFERENCES "leads"("id", "department_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "lead_review_decisions_customer_department_fkey"
    FOREIGN KEY ("customer_id", "department_id") REFERENCES "customers"("id", "department_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "lead_review_decisions_reviewer_user_id_fkey"
    FOREIGN KEY ("reviewer_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "lead_review_decisions_customer_account_binding_id_fkey"
    FOREIGN KEY ("customer_account_binding_id") REFERENCES "customer_account_bindings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "client_lead_review_receipts" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "customer_account_binding_id" UUID NOT NULL,
  "action" VARCHAR(100) NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "result_lead_id" UUID NOT NULL,
  "result_lead_version" INTEGER NOT NULL,
  "review_decision_id" UUID NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_lead_review_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "client_lead_review_receipts_review_decision_id_key" UNIQUE ("review_decision_id"),
  CONSTRAINT "client_lead_review_receipts_department_actor_action_key" UNIQUE ("department_id", "actor_user_id", "action", "idempotency_key"),
  CONSTRAINT "client_lead_review_receipts_result_version_positive_check" CHECK ("result_lead_version" >= 1),
  CONSTRAINT "client_lead_review_receipts_action_check" CHECK ("action" = 'client.lead.review')
);

CREATE INDEX "client_lead_review_receipts_result_lead_id_department_id_idx"
  ON "client_lead_review_receipts"("result_lead_id", "department_id");

ALTER TABLE "client_lead_review_receipts"
  ADD CONSTRAINT "client_lead_review_receipts_department_id_fkey"
    FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "client_lead_review_receipts_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "client_lead_review_receipts_customer_account_binding_id_fkey"
    FOREIGN KEY ("customer_account_binding_id") REFERENCES "customer_account_bindings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "client_lead_review_receipts_lead_department_fkey"
    FOREIGN KEY ("result_lead_id", "department_id") REFERENCES "leads"("id", "department_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "client_lead_review_receipts_review_decision_id_fkey"
    FOREIGN KEY ("review_decision_id") REFERENCES "lead_review_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_lead_review_decision_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lead review decisions are immutable'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER reject_lead_review_decision_mutation
BEFORE UPDATE OR DELETE ON lead_review_decisions
FOR EACH ROW EXECUTE FUNCTION reject_lead_review_decision_mutation();

COMMIT;
