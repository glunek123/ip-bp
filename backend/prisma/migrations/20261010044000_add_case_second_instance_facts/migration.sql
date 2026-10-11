BEGIN;

CREATE TABLE "case_second_instance_progresses" (
  "id" uuid PRIMARY KEY,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "trial_round_id" uuid NOT NULL,
  "choice_id" uuid NOT NULL,
  "prior_progress_id" uuid,
  "hearing_at" date,
  "hearing_place" varchar(500),
  "judge_name" varchar(200),
  "from_version" integer NOT NULL,
  "to_version" integer NOT NULL,
  "recorded_at" timestamptz(3) NOT NULL DEFAULT now(),
  "recorded_by_user_id" uuid NOT NULL,
  "audit_event_id" uuid NOT NULL UNIQUE,
  CONSTRAINT "case_second_instance_progresses_id_case_department_key" UNIQUE ("id", "case_id", "department_id"),
  CONSTRAINT "case_second_instance_progresses_id_case_department_round_key" UNIQUE ("id", "case_id", "department_id", "trial_round_id"),
  CONSTRAINT "case_second_instance_progresses_case_from_key" UNIQUE ("case_id", "from_version"),
  CONSTRAINT "case_second_instance_progresses_case_to_key" UNIQUE ("case_id", "to_version"),
  CONSTRAINT "case_second_instance_progresses_version_check" CHECK ("from_version" > 0 AND "to_version" = "from_version" + 1),
  CONSTRAINT "case_second_instance_progresses_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_second_instance_progresses_round_fkey" FOREIGN KEY ("trial_round_id", "case_id", "department_id") REFERENCES "case_trial_rounds"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_second_instance_progresses_choice_fkey" FOREIGN KEY ("choice_id", "case_id", "department_id", "trial_round_id") REFERENCES "case_judgment_next_steps"("id", "case_id", "department_id", "trial_round_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_second_instance_progresses_prior_fkey" FOREIGN KEY ("prior_progress_id", "case_id", "department_id", "trial_round_id") REFERENCES "case_second_instance_progresses"("id", "case_id", "department_id", "trial_round_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_second_instance_progresses_user_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_second_instance_progresses_audit_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_second_instance_progress_versions" (
  "progress_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "material_id" uuid NOT NULL,
  "content_version_id" uuid NOT NULL,
  "category" "material_category" NOT NULL,
  PRIMARY KEY ("progress_id", "content_version_id"),
  CONSTRAINT "case_second_instance_progress_versions_category_check" CHECK ("category" IN ('SECOND_INSTANCE_DOCUMENT', 'SECOND_INSTANCE_SERVICE')),
  CONSTRAINT "case_second_instance_progress_versions_progress_fkey" FOREIGN KEY ("progress_id", "case_id", "department_id") REFERENCES "case_second_instance_progresses"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_second_instance_progress_versions_content_fkey" FOREIGN KEY ("material_id", "content_version_id") REFERENCES "content_versions"("material_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_second_instance_results" (
  "id" uuid PRIMARY KEY,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "trial_round_id" uuid NOT NULL,
  "choice_id" uuid NOT NULL,
  "judgment_id" uuid NOT NULL,
  "progress_id" uuid,
  "result" "case_second_instance_result_kind" NOT NULL,
  "result_received_at" date NOT NULL,
  "judgment_amount_state" "case_complaint_amount_state",
  "judgment_amount" numeric(16,2),
  "paid_litigation_fee_state" "case_complaint_amount_state" NOT NULL,
  "paid_litigation_fee" numeric(16,2),
  "from_version" integer NOT NULL,
  "to_version" integer NOT NULL,
  "recorded_at" timestamptz(3) NOT NULL DEFAULT now(),
  "recorded_by_user_id" uuid NOT NULL,
  "audit_event_id" uuid NOT NULL UNIQUE,
  CONSTRAINT "case_second_instance_results_id_case_department_key" UNIQUE ("id", "case_id", "department_id"),
  CONSTRAINT "case_second_instance_results_case_from_key" UNIQUE ("case_id", "from_version"),
  CONSTRAINT "case_second_instance_results_case_to_key" UNIQUE ("case_id", "to_version"),
  CONSTRAINT "case_second_instance_results_version_check" CHECK ("from_version" > 0 AND "to_version" = "from_version" + 1),
  CONSTRAINT "case_second_instance_results_amount_check" CHECK (
    (("result" = 'REMAND' AND "judgment_amount_state" IS NULL AND "judgment_amount" IS NULL) OR
     ("result" <> 'REMAND' AND "judgment_amount_state" IS NOT NULL AND (("judgment_amount_state" = 'PENDING' AND "judgment_amount" IS NULL) OR ("judgment_amount_state" = 'KNOWN' AND "judgment_amount" IS NOT NULL AND "judgment_amount" >= 0))))
    AND (("paid_litigation_fee_state" = 'PENDING' AND "paid_litigation_fee" IS NULL) OR ("paid_litigation_fee_state" = 'KNOWN' AND "paid_litigation_fee" >= 0))
  ),
  CONSTRAINT "case_second_instance_results_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_second_instance_results_round_fkey" FOREIGN KEY ("trial_round_id", "case_id", "department_id") REFERENCES "case_trial_rounds"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_second_instance_results_choice_fkey" FOREIGN KEY ("choice_id", "case_id", "department_id", "trial_round_id") REFERENCES "case_judgment_next_steps"("id", "case_id", "department_id", "trial_round_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_second_instance_results_judgment_fkey" FOREIGN KEY ("judgment_id", "case_id", "department_id", "trial_round_id") REFERENCES "case_judgment_facts"("id", "case_id", "department_id", "trial_round_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_second_instance_results_progress_fkey" FOREIGN KEY ("progress_id", "case_id", "department_id", "trial_round_id") REFERENCES "case_second_instance_progresses"("id", "case_id", "department_id", "trial_round_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_second_instance_results_user_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_second_instance_results_audit_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_second_instance_result_versions" (
  "result_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "material_id" uuid NOT NULL,
  "content_version_id" uuid NOT NULL,
  PRIMARY KEY ("result_id", "content_version_id"),
  CONSTRAINT "case_second_instance_result_versions_result_fkey" FOREIGN KEY ("result_id", "case_id", "department_id") REFERENCES "case_second_instance_results"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_second_instance_result_versions_content_fkey" FOREIGN KEY ("material_id", "content_version_id") REFERENCES "content_versions"("material_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_second_instance_result_revocations" (
  "id" uuid PRIMARY KEY,
  "result_id" uuid NOT NULL UNIQUE,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "reason" varchar(500) NOT NULL,
  "from_version" integer NOT NULL,
  "to_version" integer NOT NULL,
  "recorded_at" timestamptz(3) NOT NULL DEFAULT now(),
  "recorded_by_user_id" uuid NOT NULL,
  "audit_event_id" uuid NOT NULL UNIQUE,
  CONSTRAINT "case_second_instance_result_revocations_result_case_key" UNIQUE ("result_id", "case_id", "department_id"),
  CONSTRAINT "case_second_instance_result_revocations_case_from_key" UNIQUE ("case_id", "from_version"),
  CONSTRAINT "case_second_instance_result_revocations_case_to_key" UNIQUE ("case_id", "to_version"),
  CONSTRAINT "case_second_instance_result_revocations_version_check" CHECK ("from_version" > 0 AND "to_version" = "from_version" + 1 AND length(btrim("reason")) BETWEEN 1 AND 500),
  CONSTRAINT "case_second_instance_result_revocations_result_fkey" FOREIGN KEY ("result_id", "case_id", "department_id") REFERENCES "case_second_instance_results"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_second_instance_result_revocations_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_second_instance_result_revocations_user_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_second_instance_result_revocations_audit_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_second_instance_receipts" (
  "id" uuid PRIMARY KEY,
  "department_id" uuid NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "action" "case_second_instance_action" NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "request_fingerprint" char(64) NOT NULL,
  "result_snapshot" jsonb NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "case_second_instance_receipts_actor_key" UNIQUE ("department_id", "actor_user_id", "action", "idempotency_key"),
  CONSTRAINT "case_second_instance_receipts_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_second_instance_receipts_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

ALTER TABLE "case_trial_rounds" ADD COLUMN "source_result_id" uuid;
ALTER TABLE "case_trial_rounds" ADD CONSTRAINT "case_trial_rounds_source_result_id_key" UNIQUE ("source_result_id");
ALTER TABLE "case_trial_rounds" ADD CONSTRAINT "case_trial_rounds_source_result_case_key" UNIQUE ("source_result_id", "case_id", "department_id");
ALTER TABLE "case_trial_rounds" ADD CONSTRAINT "case_trial_rounds_source_result_fkey" FOREIGN KEY ("source_result_id", "case_id", "department_id") REFERENCES "case_second_instance_results"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "cases" ADD COLUMN "current_second_instance_progress_id" uuid;
ALTER TABLE "cases" ADD COLUMN "current_second_instance_result_id" uuid;
ALTER TABLE "cases" ADD CONSTRAINT "cases_current_second_progress_key" UNIQUE ("current_second_instance_progress_id", "id", "department_id");
ALTER TABLE "cases" ADD CONSTRAINT "cases_current_second_result_key" UNIQUE ("current_second_instance_result_id", "id", "department_id");
ALTER TABLE "cases" ADD CONSTRAINT "cases_current_second_progress_fkey" FOREIGN KEY ("current_second_instance_progress_id", "id", "department_id") REFERENCES "case_second_instance_progresses"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "cases" ADD CONSTRAINT "cases_current_second_result_fkey" FOREIGN KEY ("current_second_instance_result_id", "id", "department_id") REFERENCES "case_second_instance_results"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

WITH requested AS (
  SELECT g."role_template_id", g."scope", v."action"::"permission_action" AS "action"
  FROM "role_grants" g JOIN "role_templates" t ON t."id" = g."role_template_id" AND t."active"
  CROSS JOIN LATERAL (VALUES ('case.second_instance.save'), ('case.second_instance.result')) v("action")
  WHERE g."action" = 'case.judgment.register'::"permission_action"
  UNION ALL
  SELECT g."role_template_id", g."scope", 'case.second_instance.result.revoke'::"permission_action"
  FROM "role_grants" g JOIN "role_templates" t ON t."id" = g."role_template_id" AND t."active"
  WHERE g."action" = 'case.judgment.correct'::"permission_action"
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
