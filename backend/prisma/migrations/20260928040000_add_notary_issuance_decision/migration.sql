BEGIN;

ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'notary.issuance.decide';
ALTER TYPE "notary_matter_stage" ADD VALUE IF NOT EXISTS 'WAITING_CERTIFICATE';
ALTER TYPE "notary_matter_stage" ADD VALUE IF NOT EXISTS 'WAITING_RETURN';
CREATE TYPE "notary_issuance_choice" AS ENUM ('ISSUE', 'NO_ISSUE');

ALTER TABLE "notary_opening_review_decisions"
  ADD CONSTRAINT "notary_opening_review_decisions_issuance_identity_key"
  UNIQUE ("id", "matter_id", "department_id", "result");

CREATE TABLE "notary_issuance_decisions" (
  "id" UUID NOT NULL,
  "matter_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "opening_review_decision_id" UUID NOT NULL,
  "opening_review_result" "notary_opening_review_result" NOT NULL DEFAULT 'INFRINGEMENT',
  "actor_user_id" UUID NOT NULL,
  "actor_display_name_snapshot" VARCHAR(200) NOT NULL,
  "decision" "notary_issuance_choice" NOT NULL,
  "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "from_version" INTEGER NOT NULL,
  "to_version" INTEGER NOT NULL,
  CONSTRAINT "notary_issuance_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notary_issuance_decisions_matter_id_key" UNIQUE ("matter_id"),
  CONSTRAINT "notary_issuance_decisions_matter_department_key" UNIQUE ("matter_id", "department_id"),
  CONSTRAINT "notary_issuance_decisions_opening_review_decision_id_key" UNIQUE ("opening_review_decision_id"),
  CONSTRAINT "notary_issuance_decisions_review_identity_key" UNIQUE ("opening_review_decision_id", "matter_id", "department_id", "opening_review_result"),
  CONSTRAINT "notary_issuance_decisions_audit_identity_key"
    UNIQUE ("id", "matter_id", "department_id", "actor_user_id", "decision", "to_version"),
  CONSTRAINT "notary_issuance_decisions_review_result_check" CHECK ("opening_review_result" = 'INFRINGEMENT'),
  CONSTRAINT "notary_issuance_decisions_actor_name_check" CHECK (
    "actor_display_name_snapshot" = BTRIM("actor_display_name_snapshot") AND CHAR_LENGTH("actor_display_name_snapshot") BETWEEN 1 AND 200
  ),
  CONSTRAINT "notary_issuance_decisions_version_check" CHECK ("from_version" >= 1 AND "to_version" = "from_version" + 1),
  CONSTRAINT "notary_issuance_decisions_matter_fkey"
    FOREIGN KEY ("matter_id", "department_id") REFERENCES "notary_matters"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_issuance_decisions_review_fkey"
    FOREIGN KEY ("opening_review_decision_id", "matter_id", "department_id", "opening_review_result")
    REFERENCES "notary_opening_review_decisions"("id", "matter_id", "department_id", "result") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_issuance_decisions_actor_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_issuance_decisions_internal_actor_fkey"
    FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "notary_issuance_decisions_department_decided_at_idx" ON "notary_issuance_decisions"("department_id", "decided_at");

CREATE TABLE "notary_issuance_decision_audit_events" (
  "id" UUID NOT NULL,
  "issuance_decision_id" UUID NOT NULL,
  "matter_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "decision" "notary_issuance_choice" NOT NULL,
  "matter_version" INTEGER NOT NULL,
  "action" VARCHAR(100) NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notary_issuance_decision_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notary_issuance_decision_audit_events_issuance_decision_id_key" UNIQUE ("issuance_decision_id"),
  CONSTRAINT "notary_issuance_decision_audit_events_identity_key" UNIQUE ("issuance_decision_id", "matter_id", "department_id", "actor_user_id", "decision", "matter_version"),
  CONSTRAINT "notary_issuance_decision_audit_events_action_check" CHECK ("action" = 'notary.issuance.decide.succeeded'),
  CONSTRAINT "notary_issuance_decision_audit_events_decision_fkey"
    FOREIGN KEY ("issuance_decision_id", "matter_id", "department_id", "actor_user_id", "decision", "matter_version")
    REFERENCES "notary_issuance_decisions"("id", "matter_id", "department_id", "actor_user_id", "decision", "to_version")
    ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "notary_issuance_decision_audit_events_matter_department_occurred_at_idx"
  ON "notary_issuance_decision_audit_events"("matter_id", "department_id", "occurred_at");

CREATE FUNCTION reject_notary_issuance_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'confirmed notary issuance decision is immutable' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER reject_notary_issuance_decision_mutation BEFORE UPDATE OR DELETE ON "notary_issuance_decisions"
  FOR EACH ROW EXECUTE FUNCTION reject_notary_issuance_mutation();
CREATE TRIGGER reject_notary_issuance_audit_mutation BEFORE UPDATE OR DELETE ON "notary_issuance_decision_audit_events"
  FOR EACH ROW EXECUTE FUNCTION reject_notary_issuance_mutation();

COMMIT;
