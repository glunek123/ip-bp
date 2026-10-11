BEGIN;

CREATE TABLE "case_execution_submissions" (
  "id" uuid PRIMARY KEY,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "trial_round_id" uuid NOT NULL,
  "judgment_next_step_id" uuid NOT NULL,
  "second_instance_result_id" uuid,
  "prior_submission_id" uuid,
  "change_reason" varchar(500),
  "from_version" integer NOT NULL,
  "to_version" integer NOT NULL,
  "submitted_at" timestamptz(3) NOT NULL DEFAULT now(),
  "submitted_by_user_id" uuid NOT NULL,
  "audit_event_id" uuid NOT NULL UNIQUE,
  CONSTRAINT "case_execution_submissions_id_case_department_key" UNIQUE ("id", "case_id", "department_id"),
  CONSTRAINT "case_execution_submissions_case_from_key" UNIQUE ("case_id", "from_version"),
  CONSTRAINT "case_execution_submissions_case_to_key" UNIQUE ("case_id", "to_version"),
  CONSTRAINT "case_execution_submissions_version_check" CHECK ("from_version" > 0 AND "to_version" = "from_version" + 1),
  CONSTRAINT "case_execution_submissions_reason_check" CHECK (("prior_submission_id" IS NULL AND "change_reason" IS NULL) OR ("prior_submission_id" IS NOT NULL AND length(btrim("change_reason")) BETWEEN 1 AND 500)),
  CONSTRAINT "case_execution_submissions_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_submissions_round_fkey" FOREIGN KEY ("trial_round_id", "case_id", "department_id") REFERENCES "case_trial_rounds"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_submissions_choice_fkey" FOREIGN KEY ("judgment_next_step_id", "case_id", "department_id", "trial_round_id") REFERENCES "case_judgment_next_steps"("id", "case_id", "department_id", "trial_round_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_submissions_result_fkey" FOREIGN KEY ("second_instance_result_id", "case_id", "department_id") REFERENCES "case_second_instance_results"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_submissions_prior_fkey" FOREIGN KEY ("prior_submission_id", "case_id", "department_id") REFERENCES "case_execution_submissions"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_submissions_user_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_submissions_audit_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_execution_submission_versions" (
  "submission_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "material_id" uuid NOT NULL,
  "content_version_id" uuid NOT NULL,
  PRIMARY KEY ("submission_id", "content_version_id"),
  CONSTRAINT "case_execution_submission_versions_submission_fkey" FOREIGN KEY ("submission_id", "case_id", "department_id") REFERENCES "case_execution_submissions"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_submission_versions_content_fkey" FOREIGN KEY ("material_id", "content_version_id") REFERENCES "content_versions"("material_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_execution_submission_receipts" (
  "id" uuid PRIMARY KEY,
  "department_id" uuid NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "request_fingerprint" char(64) NOT NULL,
  "result_snapshot" jsonb NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "case_execution_submission_receipts_actor_key" UNIQUE ("department_id", "actor_user_id", "idempotency_key"),
  CONSTRAINT "case_execution_submission_receipts_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_submission_receipts_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

ALTER TABLE "cases" ADD COLUMN "current_execution_submission_id" uuid;
ALTER TABLE "cases" ADD CONSTRAINT "cases_current_execution_submission_key" UNIQUE ("current_execution_submission_id", "id", "department_id");
ALTER TABLE "cases" ADD CONSTRAINT "cases_current_execution_submission_fkey" FOREIGN KEY ("current_execution_submission_id", "id", "department_id") REFERENCES "case_execution_submissions"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

WITH requested AS (
  SELECT g."role_template_id", g."scope", 'case.execution.submit'::"permission_action" AS "action"
  FROM "role_grants" g JOIN "role_templates" t ON t."id" = g."role_template_id" AND t."active"
  WHERE g."action" = 'case.judgment.register'::"permission_action"
), inserted AS (
  INSERT INTO "role_grants" ("id", "role_template_id", "action", "scope")
  SELECT gen_random_uuid(), "role_template_id", "action", "scope" FROM requested
  ON CONFLICT ("role_template_id", "action", "scope") DO NOTHING RETURNING "role_template_id"
), changed AS (
  UPDATE "role_templates" SET "version" = "version" + 1, "updated_at" = CURRENT_TIMESTAMP
  WHERE "id" IN (SELECT DISTINCT "role_template_id" FROM inserted)
  RETURNING "id", "department_id"
)
UPDATE "user_accounts" u SET "authorization_revision" = u."authorization_revision" + 1, "updated_at" = CURRENT_TIMESTAMP
WHERE u."active" AND EXISTS (
  SELECT 1 FROM "role_assignments" a JOIN changed t ON t."id" = a."role_template_id" AND t."department_id" = a."department_id"
  JOIN "department_memberships" m ON m."user_id" = a."user_id" AND m."department_id" = a."department_id" AND m."active"
  WHERE a."user_id" = u."id" AND a."active"
);

COMMIT;
