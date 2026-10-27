-- Forward-only source change. No existing review, certificate or receipt is rewritten.
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'lead.review.proxy';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'lead.withdraw.confirm.proxy';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'notary.certificate.issue.proxy';

ALTER TABLE "client_lead_review_receipts"
  DROP CONSTRAINT "client_lead_review_receipts_decision_identity_fkey",
  DROP CONSTRAINT "client_lead_review_receipts_action_check";

ALTER TABLE "lead_review_decisions"
  ALTER COLUMN "customer_account_binding_id" DROP NOT NULL,
  ADD COLUMN "actor_kind" VARCHAR(20) NOT NULL DEFAULT 'CLIENT',
  ADD COLUMN "internal_actor_user_id" UUID,
  ADD CONSTRAINT "lead_review_decisions_proxy_receipt_identity_key"
    UNIQUE ("id", "department_id", "lead_id", "reviewer_user_id", "to_version"),
  ADD CONSTRAINT "lead_review_decisions_proxy_actor_check" CHECK (
    ("actor_kind" = 'CLIENT' AND "customer_account_binding_id" IS NOT NULL AND "internal_actor_user_id" IS NULL)
    OR ("actor_kind" = 'INTERNAL_PROXY' AND "customer_account_binding_id" IS NULL AND "internal_actor_user_id" = "reviewer_user_id")
  ),
  ADD CONSTRAINT "lead_review_decisions_proxy_membership_fkey"
    FOREIGN KEY ("internal_actor_user_id", "department_id")
    REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "client_lead_review_receipts"
  ALTER COLUMN "customer_account_binding_id" DROP NOT NULL,
  ADD COLUMN "actor_kind" VARCHAR(20) NOT NULL DEFAULT 'CLIENT',
  ADD COLUMN "internal_actor_user_id" UUID,
  ADD CONSTRAINT "client_lead_review_receipts_proxy_decision_identity_key"
    UNIQUE ("review_decision_id", "department_id", "result_lead_id", "actor_user_id", "result_lead_version"),
  ADD CONSTRAINT "client_lead_review_receipts_decision_identity_fkey"
    FOREIGN KEY ("review_decision_id", "department_id", "result_lead_id", "actor_user_id", "result_lead_version")
    REFERENCES "lead_review_decisions"("id", "department_id", "lead_id", "reviewer_user_id", "to_version")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "client_lead_review_receipts_action_check" CHECK (
    ("actor_kind" = 'CLIENT' AND "action" = 'client.lead.review' AND "customer_account_binding_id" IS NOT NULL AND "internal_actor_user_id" IS NULL)
    OR ("actor_kind" = 'INTERNAL_PROXY' AND "action" = 'lead.review.proxy' AND "customer_account_binding_id" IS NULL AND "internal_actor_user_id" = "actor_user_id")
  ),
  ADD CONSTRAINT "client_lead_review_receipts_proxy_membership_fkey"
    FOREIGN KEY ("internal_actor_user_id", "department_id")
    REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "lead_withdrawal_confirmations"
  ALTER COLUMN "customer_account_binding_id" DROP NOT NULL,
  ADD COLUMN "actor_kind" VARCHAR(20) NOT NULL DEFAULT 'CLIENT',
  ADD COLUMN "internal_actor_user_id" UUID,
  ADD CONSTRAINT "lead_withdrawal_confirmations_proxy_actor_check" CHECK (
    ("actor_kind" = 'CLIENT' AND "customer_account_binding_id" IS NOT NULL AND "internal_actor_user_id" IS NULL)
    OR ("actor_kind" = 'INTERNAL_PROXY' AND "customer_account_binding_id" IS NULL AND "internal_actor_user_id" = "actor_user_id")
  ),
  ADD CONSTRAINT "lead_withdrawal_confirmations_proxy_membership_fkey"
    FOREIGN KEY ("internal_actor_user_id", "department_id")
    REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "notary_certificates"
  ALTER COLUMN "notary_office_account_binding_id" DROP NOT NULL,
  ADD COLUMN "actor_kind" VARCHAR(20) NOT NULL DEFAULT 'NOTARY',
  ADD COLUMN "internal_actor_user_id" UUID,
  ADD CONSTRAINT "notary_certificates_proxy_actor_check" CHECK (
    ("actor_kind" = 'NOTARY' AND "notary_office_account_binding_id" IS NOT NULL AND "internal_actor_user_id" IS NULL)
    OR ("actor_kind" = 'INTERNAL_PROXY' AND "notary_office_account_binding_id" IS NULL AND "internal_actor_user_id" = "actor_user_id")
  ),
  ADD CONSTRAINT "notary_certificates_proxy_membership_fkey"
    FOREIGN KEY ("internal_actor_user_id", "department_id")
    REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
