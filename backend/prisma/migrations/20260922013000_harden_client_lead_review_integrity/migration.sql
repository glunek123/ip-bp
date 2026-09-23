BEGIN;

-- Existing review facts must be consistent before these keys can be installed.
-- A violation aborts this whole forward migration without rewriting history.
ALTER TABLE "leads"
  ADD CONSTRAINT "leads_review_identity_key"
    UNIQUE ("id", "customer_id", "department_id");

ALTER TABLE "customer_account_bindings"
  ADD CONSTRAINT "customer_account_bindings_review_identity_key"
    UNIQUE ("id", "user_id", "customer_id", "department_id");

ALTER TABLE "lead_review_decisions"
  ADD CONSTRAINT "lead_review_decisions_lead_identity_key"
    UNIQUE ("lead_id", "customer_id", "department_id"),
  ADD CONSTRAINT "lead_review_decisions_receipt_identity_key"
    UNIQUE ("id", "department_id", "lead_id", "reviewer_user_id", "customer_account_binding_id", "to_version"),
  ADD CONSTRAINT "lead_review_decisions_lead_customer_department_fkey"
    FOREIGN KEY ("lead_id", "customer_id", "department_id")
    REFERENCES "leads"("id", "customer_id", "department_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "lead_review_decisions_binding_reviewer_customer_department_fkey"
    FOREIGN KEY ("customer_account_binding_id", "reviewer_user_id", "customer_id", "department_id")
    REFERENCES "customer_account_bindings"("id", "user_id", "customer_id", "department_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "client_lead_review_receipts"
  ADD CONSTRAINT "client_lead_review_receipts_decision_identity_key"
    UNIQUE ("review_decision_id", "department_id", "result_lead_id", "actor_user_id", "customer_account_binding_id", "result_lead_version"),
  ADD CONSTRAINT "client_lead_review_receipts_decision_identity_fkey"
    FOREIGN KEY ("review_decision_id", "department_id", "result_lead_id", "actor_user_id", "customer_account_binding_id", "result_lead_version")
    REFERENCES "lead_review_decisions"("id", "department_id", "lead_id", "reviewer_user_id", "customer_account_binding_id", "to_version")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION reject_client_lead_review_receipt_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'client lead review receipts are immutable'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER reject_client_lead_review_receipt_mutation
BEFORE UPDATE OR DELETE ON "client_lead_review_receipts"
FOR EACH ROW EXECUTE FUNCTION reject_client_lead_review_receipt_mutation();

COMMIT;
