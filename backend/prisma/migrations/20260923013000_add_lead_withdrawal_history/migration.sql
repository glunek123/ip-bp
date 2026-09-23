BEGIN;

-- Keep every old decision and receipt. The old one-decision-per-lead shape
-- makes this backfill exact; future rounds use the explicit pointer.
ALTER TABLE "lead_review_decisions"
  ADD CONSTRAINT "lead_review_decisions_active_identity_key"
    UNIQUE ("id", "lead_id", "customer_id", "department_id"),
  ADD CONSTRAINT "lead_review_decisions_lead_id_from_version_key"
    UNIQUE ("lead_id", "from_version");

ALTER TABLE "leads" ADD COLUMN "active_review_decision_id" UUID;
UPDATE "leads" AS "lead"
SET "active_review_decision_id" = "decision"."id"
FROM "lead_review_decisions" AS "decision"
WHERE "decision"."lead_id" = "lead"."id"
  AND "decision"."customer_id" = "lead"."customer_id"
  AND "decision"."department_id" = "lead"."department_id";

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_active_review_decision_id_key"
    UNIQUE ("active_review_decision_id"),
  ADD CONSTRAINT "leads_active_review_decision_identity_key"
    UNIQUE ("active_review_decision_id", "id", "customer_id", "department_id"),
  ADD CONSTRAINT "leads_active_review_decision_identity_fkey"
    FOREIGN KEY ("active_review_decision_id", "id", "customer_id", "department_id")
    REFERENCES "lead_review_decisions"("id", "lead_id", "customer_id", "department_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "lead_review_decisions"
  DROP CONSTRAINT "lead_review_decisions_lead_id_key",
  DROP CONSTRAINT "lead_review_decisions_lead_id_department_id_key",
  DROP CONSTRAINT "lead_review_decisions_lead_identity_key";

CREATE TABLE "lead_withdrawal_applications" (
  "id" UUID NOT NULL,
  "original_decision_id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "applicant_user_id" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "applied_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "from_version" INTEGER NOT NULL,
  "to_version" INTEGER NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  CONSTRAINT "lead_withdrawal_applications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_withdrawal_applications_original_decision_id_key" UNIQUE ("original_decision_id"),
  CONSTRAINT "lead_withdrawal_applications_identity_key" UNIQUE ("id", "original_decision_id", "lead_id", "customer_id", "department_id"),
  CONSTRAINT "lead_withdrawal_applications_decision_identity_key" UNIQUE ("original_decision_id", "lead_id", "customer_id", "department_id"),
  CONSTRAINT "lead_withdrawal_applications_department_actor_key" UNIQUE ("department_id", "applicant_user_id", "idempotency_key"),
  CONSTRAINT "lead_withdrawal_applications_reason_check" CHECK ("reason" = BTRIM("reason") AND CHAR_LENGTH("reason") BETWEEN 1 AND 5000),
  CONSTRAINT "lead_withdrawal_applications_version_check" CHECK ("from_version" >= 1 AND "to_version" = "from_version" + 1),
  CONSTRAINT "lead_withdrawal_applications_idempotency_key_check" CHECK (CHAR_LENGTH("idempotency_key") BETWEEN 1 AND 128)
);
CREATE INDEX "lead_withdrawal_applications_lead_version_idx"
  ON "lead_withdrawal_applications"("lead_id", "from_version");
ALTER TABLE "lead_withdrawal_applications"
  ADD CONSTRAINT "lead_withdrawal_applications_lead_identity_fkey"
    FOREIGN KEY ("lead_id", "customer_id", "department_id")
    REFERENCES "leads"("id", "customer_id", "department_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "lead_withdrawal_applications_decision_identity_fkey"
    FOREIGN KEY ("original_decision_id", "lead_id", "customer_id", "department_id")
    REFERENCES "lead_review_decisions"("id", "lead_id", "customer_id", "department_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "lead_withdrawal_applications_applicant_membership_fkey"
    FOREIGN KEY ("applicant_user_id", "department_id")
    REFERENCES "department_memberships"("user_id", "department_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "lead_withdrawal_confirmations" (
  "id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "original_decision_id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "customer_account_binding_id" UUID NOT NULL,
  "confirmed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "from_version" INTEGER NOT NULL,
  "to_version" INTEGER NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  CONSTRAINT "lead_withdrawal_confirmations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_withdrawal_confirmations_application_id_key" UNIQUE ("application_id"),
  CONSTRAINT "lead_withdrawal_confirmations_application_identity_key" UNIQUE ("application_id", "original_decision_id", "lead_id", "customer_id", "department_id"),
  CONSTRAINT "lead_withdrawal_confirmations_department_actor_key" UNIQUE ("department_id", "actor_user_id", "idempotency_key"),
  CONSTRAINT "lead_withdrawal_confirmations_version_check" CHECK ("from_version" >= 1 AND "to_version" = "from_version" + 1),
  CONSTRAINT "lead_withdrawal_confirmations_idempotency_key_check" CHECK (CHAR_LENGTH("idempotency_key") BETWEEN 1 AND 128)
);
CREATE INDEX "lead_withdrawal_confirmations_lead_version_idx"
  ON "lead_withdrawal_confirmations"("lead_id", "from_version");
ALTER TABLE "lead_withdrawal_confirmations"
  ADD CONSTRAINT "lead_withdrawal_confirmations_application_identity_fkey"
    FOREIGN KEY ("application_id", "original_decision_id", "lead_id", "customer_id", "department_id")
    REFERENCES "lead_withdrawal_applications"("id", "original_decision_id", "lead_id", "customer_id", "department_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "lead_withdrawal_confirmations_binding_identity_fkey"
    FOREIGN KEY ("customer_account_binding_id", "actor_user_id", "customer_id", "department_id")
    REFERENCES "customer_account_bindings"("id", "user_id", "customer_id", "department_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION reject_lead_withdrawal_application_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lead withdrawal applications are immutable' USING ERRCODE = '55000';
END
$$;
CREATE TRIGGER reject_lead_withdrawal_application_mutation
BEFORE UPDATE OR DELETE ON "lead_withdrawal_applications"
FOR EACH ROW EXECUTE FUNCTION reject_lead_withdrawal_application_mutation();

CREATE FUNCTION reject_lead_withdrawal_confirmation_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lead withdrawal confirmations are immutable' USING ERRCODE = '55000';
END
$$;
CREATE TRIGGER reject_lead_withdrawal_confirmation_mutation
BEFORE UPDATE OR DELETE ON "lead_withdrawal_confirmations"
FOR EACH ROW EXECUTE FUNCTION reject_lead_withdrawal_confirmation_mutation();

-- Upgrade only the unique unshared bootstrap template, never ordinary roles.
LOCK TABLE "department_memberships", "role_assignments", "role_templates", "role_grants", "local_credentials", "user_accounts"
IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE "bootstrap_roles_to_upgrade" ON COMMIT DROP AS
SELECT "assignment"."role_template_id", "assignment"."user_id"
FROM "role_assignments" AS "assignment"
JOIN "role_templates" AS "role"
  ON "role"."id" = "assignment"."role_template_id"
 AND "role"."department_id" = "assignment"."department_id"
JOIN "department_memberships" AS "membership"
  ON "membership"."user_id" = "assignment"."user_id"
 AND "membership"."department_id" = "assignment"."department_id"
JOIN "local_credentials" AS "credential"
  ON "credential"."user_id" = "assignment"."user_id"
WHERE "assignment"."active" = true
  AND "assignment"."team_id" IS NULL
  AND "role"."active" = true
  AND "membership"."active" = true
  AND (
    SELECT COUNT(DISTINCT "local_membership"."user_id")
    FROM "department_memberships" AS "local_membership"
    JOIN "local_credentials" AS "local_credential"
      ON "local_credential"."user_id" = "local_membership"."user_id"
    WHERE "local_membership"."department_id" = "assignment"."department_id"
      AND "local_membership"."active" = true
  ) = 1
  AND (
    SELECT COUNT(*) FROM "role_assignments" AS "active_assignment"
    WHERE "active_assignment"."user_id" = "assignment"."user_id"
      AND "active_assignment"."department_id" = "assignment"."department_id"
      AND "active_assignment"."active" = true
  ) = 1
  AND NOT EXISTS (
    SELECT 1 FROM "role_assignments" AS "shared_assignment"
    WHERE "shared_assignment"."role_template_id" = "assignment"."role_template_id"
      AND "shared_assignment"."user_id" <> "assignment"."user_id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "role_grants" AS "grant"
    WHERE "grant"."role_template_id" = "assignment"."role_template_id"
      AND "grant"."action" = 'lead.withdraw.apply'
  )
  AND NOT EXISTS (
    SELECT 1 FROM (VALUES
      ('customer.read'::"permission_action"),
      ('customer.create-draft'::"permission_action"),
      ('customer.edit-routine'::"permission_action"),
      ('customer.admit'::"permission_action"),
      ('lead.read'::"permission_action"),
      ('lead.create'::"permission_action"),
      ('lead.edit'::"permission_action"),
      ('lead.push'::"permission_action"),
      ('user.read'::"permission_action"),
      ('user.manage'::"permission_action"),
      ('team.read'::"permission_action"),
      ('team.manage'::"permission_action"),
      ('role.read'::"permission_action"),
      ('role.assign'::"permission_action"),
      ('role.manage'::"permission_action")
    ) AS "required"("action")
    WHERE NOT EXISTS (
      SELECT 1 FROM "role_grants" AS "grant"
      WHERE "grant"."role_template_id" = "assignment"."role_template_id"
        AND "grant"."action" = "required"."action"
        AND "grant"."scope" = 'DEPARTMENT'
    )
  );
INSERT INTO "role_grants"("id", "role_template_id", "action", "scope")
SELECT (
         SUBSTR(MD5("candidate"."role_template_id"::text || ':lead.withdraw.apply'), 1, 8) || '-' ||
         SUBSTR(MD5("candidate"."role_template_id"::text || ':lead.withdraw.apply'), 9, 4) || '-4' ||
         SUBSTR(MD5("candidate"."role_template_id"::text || ':lead.withdraw.apply'), 14, 3) || '-8' ||
         SUBSTR(MD5("candidate"."role_template_id"::text || ':lead.withdraw.apply'), 18, 3) || '-' ||
         SUBSTR(MD5("candidate"."role_template_id"::text || ':lead.withdraw.apply'), 21, 12)
       )::uuid,
       "candidate"."role_template_id", 'lead.withdraw.apply'::"permission_action", 'DEPARTMENT'
FROM "bootstrap_roles_to_upgrade" AS "candidate"
ON CONFLICT ("role_template_id", "action", "scope") DO NOTHING;
UPDATE "user_accounts" AS "account"
SET "authorization_revision" = "authorization_revision" + 1,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "account"."id" IN (SELECT "user_id" FROM "bootstrap_roles_to_upgrade");

COMMIT;
