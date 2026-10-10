BEGIN;

ALTER TABLE "cases" ADD COLUMN "current_judgment_next_step_id" uuid;
ALTER TABLE "cases" DROP CONSTRAINT "cases_matching_state_check";
ALTER TABLE "cases" ADD CONSTRAINT "cases_matching_state_check" CHECK (
  "version" >= 1 AND (("stage" = 'PENDING_MATCH' AND "matched_at" IS NULL) OR
  ("stage" IN ('WAITING_COMPLAINT', 'WAITING_COMPLAINT_CONFIRMATION', 'WAITING_COMPLAINT_STAMP', 'WAITING_FILING', 'WAITING_FORMAL_ACCEPTANCE', 'WAITING_HEARING', 'WAITING_JUDGMENT', 'SECOND_INSTANCE', 'WAITING_EXECUTION_DOCUMENTS') AND "matched_at" IS NOT NULL))
);
ALTER TABLE "cases" DROP CONSTRAINT "cases_complaint_state_check";
ALTER TABLE "cases" ADD CONSTRAINT "cases_complaint_state_check" CHECK (
  ("stage" IN ('PENDING_MATCH', 'WAITING_COMPLAINT') AND "complaint_submitted_at" IS NULL AND "complaint_submitted_by_user_id" IS NULL AND "complaint_amount_state" IS NULL AND "complaint_amount" IS NULL AND "complaint_pending_reason" IS NULL) OR
  ("stage" IN ('WAITING_COMPLAINT_CONFIRMATION', 'WAITING_COMPLAINT_STAMP', 'WAITING_FILING', 'WAITING_FORMAL_ACCEPTANCE', 'WAITING_HEARING', 'WAITING_JUDGMENT', 'SECOND_INSTANCE', 'WAITING_EXECUTION_DOCUMENTS') AND "complaint_submitted_at" IS NOT NULL AND "complaint_submitted_by_user_id" IS NOT NULL AND "complaint_amount_state" IS NOT NULL AND
    (("complaint_amount_state" = 'KNOWN' AND "complaint_amount" IS NOT NULL AND "complaint_amount" >= 0 AND "complaint_pending_reason" IS NULL) OR
     ("complaint_amount_state" = 'PENDING' AND "complaint_amount" IS NULL AND "complaint_pending_reason" IS NOT NULL AND CHAR_LENGTH(BTRIM("complaint_pending_reason")) > 0)))
);

CREATE TABLE "case_judgment_next_steps" (
  "id" uuid PRIMARY KEY,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "judgment_id" uuid NOT NULL,
  "next" "case_judgment_next_step_kind" NOT NULL,
  "plaintiff_rights_holder_id" uuid,
  "plaintiff_name" varchar(200),
  "execution_readiness_confirmed" boolean NOT NULL DEFAULT false,
  "from_version" integer NOT NULL,
  "to_version" integer NOT NULL,
  "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by_user_id" uuid NOT NULL,
  "audit_event_id" uuid NOT NULL UNIQUE,
  CONSTRAINT "case_judgment_next_steps_identity_key" UNIQUE ("id", "case_id", "department_id"),
  CONSTRAINT "case_judgment_next_steps_case_from_key" UNIQUE ("case_id", "from_version"),
  CONSTRAINT "case_judgment_next_steps_case_to_key" UNIQUE ("case_id", "to_version"),
  CONSTRAINT "case_judgment_next_steps_version_check" CHECK ("from_version" >= 1 AND "to_version" = "from_version" + 1),
  CONSTRAINT "case_judgment_next_steps_kind_check" CHECK (
    ("next" = 'EXECUTION' AND "execution_readiness_confirmed" AND "plaintiff_rights_holder_id" IS NULL AND "plaintiff_name" IS NULL) OR
    ("next" = 'APPEAL' AND NOT "execution_readiness_confirmed" AND (("plaintiff_rights_holder_id" IS NULL AND "plaintiff_name" IS NULL) OR ("plaintiff_rights_holder_id" IS NOT NULL AND "plaintiff_name" IS NOT NULL AND char_length(btrim("plaintiff_name")) > 0)))),
  CONSTRAINT "case_judgment_next_steps_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_judgment_next_steps_judgment_fkey" FOREIGN KEY ("judgment_id", "case_id", "department_id") REFERENCES "case_judgment_facts"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_judgment_next_steps_plaintiff_fkey" FOREIGN KEY ("plaintiff_rights_holder_id", "department_id") REFERENCES "rights_holders"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_judgment_next_steps_actor_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_judgment_next_steps_audit_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "case_defendants_id_case_id_department_id_key" ON "case_defendants"("id", "case_id", "department_id");
CREATE TABLE "case_judgment_appeal_defendants" (
  "choice_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "defendant_id" uuid NOT NULL,
  "name_snapshot" varchar(200) NOT NULL,
  CONSTRAINT "case_judgment_appeal_defendants_pkey" PRIMARY KEY ("choice_id", "defendant_id"),
  CONSTRAINT "case_judgment_appeal_defendants_name_check" CHECK (char_length(btrim("name_snapshot")) > 0),
  CONSTRAINT "case_judgment_appeal_defendants_choice_fkey" FOREIGN KEY ("choice_id", "case_id", "department_id") REFERENCES "case_judgment_next_steps"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_judgment_appeal_defendants_defendant_fkey" FOREIGN KEY ("defendant_id", "case_id", "department_id") REFERENCES "case_defendants"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "case_judgment_next_step_revocations" (
  "id" uuid PRIMARY KEY,
  "choice_id" uuid NOT NULL UNIQUE,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "reason" varchar(500) NOT NULL,
  "from_version" integer NOT NULL,
  "to_version" integer NOT NULL,
  "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by_user_id" uuid NOT NULL,
  "audit_event_id" uuid NOT NULL UNIQUE,
  CONSTRAINT "case_judgment_next_step_revocations_case_from_key" UNIQUE ("case_id", "from_version"),
  CONSTRAINT "case_judgment_next_step_revocations_case_to_key" UNIQUE ("case_id", "to_version"),
  CONSTRAINT "case_judgment_next_step_revocations_reason_check" CHECK ("reason" = btrim("reason") AND char_length("reason") BETWEEN 1 AND 500 AND "to_version" = "from_version" + 1),
  CONSTRAINT "case_judgment_next_step_revocations_choice_fkey" FOREIGN KEY ("choice_id", "case_id", "department_id") REFERENCES "case_judgment_next_steps"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_judgment_next_step_revocations_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_judgment_next_step_revocations_actor_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_judgment_next_step_revocations_audit_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "case_judgment_next_step_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "department_id" uuid NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "action" "case_judgment_next_step_action" NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "request_fingerprint" char(64) NOT NULL,
  "result_snapshot" jsonb NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_judgment_next_step_receipts_key" UNIQUE ("department_id", "actor_user_id", "action", "idempotency_key"),
  CONSTRAINT "case_judgment_next_step_receipts_key_check" CHECK ("idempotency_key" = btrim("idempotency_key") AND char_length("idempotency_key") BETWEEN 1 AND 128 AND "request_fingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "case_judgment_next_step_receipts_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_judgment_next_step_receipts_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "cases_current_judgment_next_step_id_id_department_id_key" ON "cases"("current_judgment_next_step_id", "id", "department_id");
ALTER TABLE "cases" ADD CONSTRAINT "cases_current_judgment_next_step_fkey"
  FOREIGN KEY ("current_judgment_next_step_id", "id", "department_id") REFERENCES "case_judgment_next_steps"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- New actions inherit exactly the approved grants and scopes; existing grants are untouched.
WITH requested AS (
  SELECT g."role_template_id", 'case.judgment.next_step'::"permission_action" AS "action", g."scope"
    FROM "role_grants" g JOIN "role_templates" t ON t."id" = g."role_template_id" AND t."active"
    WHERE g."action" = 'case.judgment.register'::"permission_action"
  UNION ALL
  SELECT g."role_template_id", 'case.judgment.next_step.revoke'::"permission_action", g."scope"
    FROM "role_grants" g JOIN "role_templates" t ON t."id" = g."role_template_id" AND t."active"
    WHERE g."action" = 'case.judgment.correct'::"permission_action"
), inserted AS (
  INSERT INTO "role_grants"("id", "role_template_id", "action", "scope")
  SELECT gen_random_uuid(), "role_template_id", "action", "scope" FROM requested
  ON CONFLICT ("role_template_id", "action", "scope") DO NOTHING
  RETURNING "role_template_id"
), changed_templates AS (
  UPDATE "role_templates" SET "version" = "version" + 1, "updated_at" = CURRENT_TIMESTAMP
  WHERE "id" IN (SELECT DISTINCT "role_template_id" FROM inserted)
  RETURNING "id", "department_id"
)
UPDATE "user_accounts" u SET "authorization_revision" = u."authorization_revision" + 1, "updated_at" = CURRENT_TIMESTAMP
WHERE u."active" AND EXISTS (
  SELECT 1 FROM "role_assignments" a JOIN changed_templates t ON t."id" = a."role_template_id" AND t."department_id" = a."department_id"
  JOIN "department_memberships" m ON m."user_id" = a."user_id" AND m."department_id" = a."department_id" AND m."active"
  WHERE a."user_id" = u."id" AND a."active"
);

COMMIT;
