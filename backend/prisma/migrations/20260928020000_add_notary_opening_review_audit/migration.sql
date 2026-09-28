BEGIN;

ALTER TABLE "notary_opening_review_decisions"
  ADD CONSTRAINT "notary_opening_review_decisions_audit_identity_key"
  UNIQUE ("id", "matter_id", "department_id", "customer_id", "actor_user_id", "actor_kind", "result", "to_version");

CREATE TABLE "notary_opening_review_audit_events" (
  "id" UUID NOT NULL,
  "review_decision_id" UUID NOT NULL,
  "matter_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "actor_kind" VARCHAR(10) NOT NULL,
  "result" "notary_opening_review_result" NOT NULL,
  "matter_version" INTEGER NOT NULL,
  "action" VARCHAR(100) NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notary_opening_review_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notary_opening_review_audit_events_review_decision_id_key" UNIQUE ("review_decision_id"),
  CONSTRAINT "notary_opening_review_audit_events_decision_identity_key"
    UNIQUE ("review_decision_id", "matter_id", "department_id", "customer_id", "actor_user_id", "actor_kind", "result", "matter_version"),
  CONSTRAINT "notary_opening_review_audit_events_action_check" CHECK ("action" = 'notary.opening.review.succeeded'),
  CONSTRAINT "notary_opening_review_audit_events_decision_identity_fkey"
    FOREIGN KEY ("review_decision_id", "matter_id", "department_id", "customer_id", "actor_user_id", "actor_kind", "result", "matter_version")
    REFERENCES "notary_opening_review_decisions"("id", "matter_id", "department_id", "customer_id", "actor_user_id", "actor_kind", "result", "to_version")
    ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "notary_opening_review_audit_events_matter_department_occurred_at_idx"
  ON "notary_opening_review_audit_events"("matter_id", "department_id", "occurred_at");

CREATE TRIGGER reject_notary_opening_review_audit_mutation
  BEFORE UPDATE OR DELETE ON "notary_opening_review_audit_events"
  FOR EACH ROW EXECUTE FUNCTION reject_notary_opening_review_mutation();

COMMIT;
