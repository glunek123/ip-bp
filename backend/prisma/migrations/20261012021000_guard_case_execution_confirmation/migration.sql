BEGIN;

ALTER TABLE "cases" DROP CONSTRAINT "cases_matching_state_check";
ALTER TABLE "cases" ADD CONSTRAINT "cases_matching_state_check" CHECK (
  "version" >= 1 AND (("stage" = 'PENDING_MATCH' AND "matched_at" IS NULL) OR
  ("stage" IN ('WAITING_COMPLAINT', 'WAITING_COMPLAINT_CONFIRMATION', 'WAITING_COMPLAINT_STAMP', 'WAITING_FILING', 'WAITING_FORMAL_ACCEPTANCE', 'WAITING_HEARING', 'WAITING_JUDGMENT', 'SECOND_INSTANCE', 'WAITING_EXECUTION_DOCUMENTS', 'WAITING_EXECUTION_CONFIRMATION', 'WAITING_EXECUTION_STAMP') AND "matched_at" IS NOT NULL))
);
ALTER TABLE "cases" DROP CONSTRAINT "cases_complaint_state_check";
ALTER TABLE "cases" ADD CONSTRAINT "cases_complaint_state_check" CHECK (
  ("stage" IN ('PENDING_MATCH', 'WAITING_COMPLAINT') AND "complaint_submitted_at" IS NULL AND "complaint_submitted_by_user_id" IS NULL AND "complaint_amount_state" IS NULL AND "complaint_amount" IS NULL AND "complaint_pending_reason" IS NULL) OR
  ("stage" IN ('WAITING_COMPLAINT_CONFIRMATION', 'WAITING_COMPLAINT_STAMP', 'WAITING_FILING', 'WAITING_FORMAL_ACCEPTANCE', 'WAITING_HEARING', 'WAITING_JUDGMENT', 'SECOND_INSTANCE', 'WAITING_EXECUTION_DOCUMENTS', 'WAITING_EXECUTION_CONFIRMATION', 'WAITING_EXECUTION_STAMP') AND "complaint_submitted_at" IS NOT NULL AND "complaint_submitted_by_user_id" IS NOT NULL AND "complaint_amount_state" IS NOT NULL AND
    (("complaint_amount_state" = 'KNOWN' AND "complaint_amount" IS NOT NULL AND "complaint_amount" >= 0 AND "complaint_pending_reason" IS NULL) OR
     ("complaint_amount_state" = 'PENDING' AND "complaint_amount" IS NULL AND "complaint_pending_reason" IS NOT NULL AND CHAR_LENGTH(BTRIM("complaint_pending_reason")) > 0)))
);

CREATE TABLE "case_execution_confirmations" (
  "id" uuid PRIMARY KEY,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "submission_id" uuid NOT NULL,
  "from_version" integer NOT NULL,
  "to_version" integer NOT NULL,
  "confirmed_at" timestamptz(3) NOT NULL,
  "confirmed_by_user_id" uuid NOT NULL,
  "audit_event_id" uuid NOT NULL,
  CONSTRAINT "case_execution_confirmations_case_key" UNIQUE ("case_id"),
  CONSTRAINT "case_execution_confirmations_submission_key" UNIQUE ("submission_id"),
  CONSTRAINT "case_execution_confirmations_audit_key" UNIQUE ("audit_event_id"),
  CONSTRAINT "case_execution_confirmations_from_key" UNIQUE ("case_id", "from_version"),
  CONSTRAINT "case_execution_confirmations_to_key" UNIQUE ("case_id", "to_version"),
  CONSTRAINT "case_execution_confirmations_case_department_key" UNIQUE ("case_id", "department_id"),
  CONSTRAINT "case_execution_confirmations_submission_case_department_key" UNIQUE ("submission_id", "case_id", "department_id"),
  CONSTRAINT "case_execution_confirmations_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_confirmations_submission_fkey" FOREIGN KEY ("submission_id", "case_id", "department_id") REFERENCES "case_execution_submissions"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_confirmations_actor_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_confirmations_audit_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "case_execution_confirmation_receipts" (
  "id" uuid PRIMARY KEY,
  "department_id" uuid NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "request_fingerprint" char(64) NOT NULL,
  "result_snapshot" jsonb NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "case_execution_confirmation_receipts_actor_key" UNIQUE ("department_id", "actor_user_id", "idempotency_key"),
  CONSTRAINT "case_execution_confirmation_receipts_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_confirmation_receipts_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

WITH requested AS (
  SELECT g."role_template_id", g."scope", 'case.execution.confirm'::"permission_action" AS "action"
  FROM "role_grants" g JOIN "role_templates" t ON t."id" = g."role_template_id" AND t."active"
  WHERE g."action" = 'case.execution.submit'::"permission_action"
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

-- Keep CA-009/010 source validation intact and extend their terminal state only.
DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname = 'check_case_trial_round_foundation' AND p.pronargs = 0;
  IF definition IS NULL OR position('''WAITING_EXECUTION_CONFIRMATION'')' IN definition) = 0 THEN
    RAISE EXCEPTION 'unknown trial-round guard' USING ERRCODE = '23514';
  END IF;
  EXECUTE replace(definition, '''WAITING_EXECUTION_CONFIRMATION'')', '''WAITING_EXECUTION_CONFIRMATION'',''WAITING_EXECUTION_STAMP'')');

  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname = 'check_case_judgment_final' AND p.pronargs = 0;
  IF definition IS NULL OR position('expected_stage := ''WAITING_EXECUTION_CONFIRMATION'';' IN definition) = 0 THEN
    RAISE EXCEPTION 'unknown current-judgment guard' USING ERRCODE = '23514';
  END IF;
  definition := replace(definition, '''WAITING_EXECUTION_CONFIRMATION'') THEN',
    '''WAITING_EXECUTION_CONFIRMATION'', ''WAITING_EXECUTION_STAMP'') THEN');
  definition := replace(definition,
    'expected_stage := ''WAITING_EXECUTION_CONFIRMATION'';',
    'IF EXISTS (SELECT 1 FROM "case_execution_confirmations" f WHERE f."case_id" = target_case AND f."department_id" = target_department) THEN' || E'\n' ||
    '  SELECT f."to_version" INTO expected_version FROM "case_execution_confirmations" f WHERE f."case_id" = target_case AND f."department_id" = target_department AND f."submission_id" = c."current_execution_submission_id";' || E'\n' ||
    '  expected_stage := ''WAITING_EXECUTION_STAMP'';' || E'\n' ||
    'ELSE expected_stage := ''WAITING_EXECUTION_CONFIRMATION''; END IF;');
  EXECUTE definition;

  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname = 'check_case_judgment_next_step_final' AND p.pronargs = 0;
  IF definition IS NULL OR position('''WAITING_EXECUTION_CONFIRMATION'')' IN definition) = 0 THEN
    RAISE EXCEPTION 'unknown choice guard' USING ERRCODE = '23514';
  END IF;
  EXECUTE replace(definition, '''WAITING_EXECUTION_CONFIRMATION'')',
    '''WAITING_EXECUTION_CONFIRMATION'',''WAITING_EXECUTION_STAMP'')');

  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname = 'check_case_second_instance_final' AND p.pronargs = 0;
  IF definition IS NULL OR position('c."stage" NOT IN (''WAITING_EXECUTION_DOCUMENTS'',''WAITING_EXECUTION_CONFIRMATION'')' IN definition) = 0 THEN
    RAISE EXCEPTION 'unknown second-instance guard' USING ERRCODE = '23514';
  END IF;
  EXECUTE replace(definition, 'c."stage" NOT IN (''WAITING_EXECUTION_DOCUMENTS'',''WAITING_EXECUTION_CONFIRMATION'')',
    'c."stage" NOT IN (''WAITING_EXECUTION_DOCUMENTS'',''WAITING_EXECUTION_CONFIRMATION'',''WAITING_EXECUTION_STAMP'')');

  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname = 'enforce_case_client_mailing_actor_path' AND p.pronargs = 0;
  IF definition IS NULL OR position('WHEN ''case.execution.submitted'' THEN ''WAITING_EXECUTION_DOCUMENTS,WAITING_EXECUTION_CONFIRMATION''' IN definition) = 0 THEN
    RAISE EXCEPTION 'unknown lawyer execution audit actor guard' USING ERRCODE = '23514';
  END IF;
  EXECUTE replace(definition,
    'WHEN ''case.execution.submitted'' THEN ''WAITING_EXECUTION_DOCUMENTS,WAITING_EXECUTION_CONFIRMATION''',
    'WHEN ''case.execution.submitted'' THEN ''WAITING_EXECUTION_DOCUMENTS,WAITING_EXECUTION_CONFIRMATION''' || E'\n' ||
    '          WHEN ''case.execution.confirmed'' THEN ''WAITING_EXECUTION_CONFIRMATION,WAITING_EXECUTION_STAMP''');
END; $migration$;

CREATE OR REPLACE FUNCTION "reject_case_judgment_audit_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."action" IN ('case.judgment.registered', 'case.judgment.corrected', 'case.judgment.next_step',
      'case.judgment.next_step.revoke', 'case.second_instance.save', 'case.second_instance.result',
      'case.second_instance.result.revoke', 'case.execution.submitted', 'case.execution.confirmed') OR
     (TG_OP = 'UPDATE' AND NEW."action" IN ('case.judgment.registered', 'case.judgment.corrected',
      'case.judgment.next_step', 'case.judgment.next_step.revoke', 'case.second_instance.save',
      'case.second_instance.result', 'case.second_instance.result.revoke', 'case.execution.submitted',
      'case.execution.confirmed')) THEN
    RAISE EXCEPTION 'judgment/second-instance/execution audit is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER "case_execution_confirmations_immutable" BEFORE UPDATE OR DELETE ON "case_execution_confirmations"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE TRIGGER "case_execution_confirmation_receipts_immutable" BEFORE UPDATE OR DELETE ON "case_execution_confirmation_receipts"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();

-- The CA-011 head remains the same submission after confirmation; only its terminal version changes.
DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname = 'check_case_execution_submission_final' AND p.pronargs = 0;
  IF definition IS NULL OR position('c."stage" <> ''WAITING_EXECUTION_CONFIRMATION'' OR c."version" <> e."to_version"' IN definition) = 0 THEN
    RAISE EXCEPTION 'unknown execution submission guard' USING ERRCODE = '23514';
  END IF;
  definition := replace(definition,
    'c."stage" <> ''WAITING_EXECUTION_CONFIRMATION'' OR c."version" <> e."to_version"',
    'NOT ((c."stage" = ''WAITING_EXECUTION_CONFIRMATION'' AND c."version" = e."to_version" AND NOT EXISTS (' || E'\n' ||
    '  SELECT 1 FROM "case_execution_confirmations" f WHERE f."case_id" = target_case AND f."department_id" = target_department)) OR' || E'\n' ||
    '  (c."stage" = ''WAITING_EXECUTION_STAMP'' AND EXISTS (' || E'\n' ||
    '    SELECT 1 FROM "case_execution_confirmations" f WHERE f."case_id" = target_case AND f."department_id" = target_department' || E'\n' ||
    '      AND f."submission_id" = e."id" AND f."from_version" = e."to_version" AND f."to_version" = c."version")))');
  definition := replace(definition,
    'IF TG_TABLE_NAME = ''case_execution_submissions'' THEN',
    'IF TG_TABLE_NAME = ''case_execution_submissions'' THEN' || E'\n' ||
    '    IF EXISTS (SELECT 1 FROM "case_execution_confirmations" f WHERE f."case_id" = target_case AND f."department_id" = target_department) THEN' || E'\n' ||
    '      RAISE EXCEPTION ''execution confirmation blocks resubmission'' USING ERRCODE = ''23514'';' || E'\n' ||
    '    END IF;');
  EXECUTE definition;
END; $migration$;

CREATE FUNCTION "check_case_execution_confirmation_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; c record; f record; s record; a record;
BEGIN
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id" = target_case AND "department_id" = target_department;
  SELECT * INTO f FROM "case_execution_confirmations" WHERE "case_id" = target_case AND "department_id" = target_department;
  IF f."id" IS NULL THEN
    IF c."stage" = 'WAITING_EXECUTION_STAMP' THEN
      RAISE EXCEPTION 'execution stamp has no confirmation' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO s FROM "case_execution_submissions" WHERE "id" = f."submission_id"
    AND "case_id" = target_case AND "department_id" = target_department;
  SELECT * INTO a FROM "audit_events" WHERE "id" = f."audit_event_id";
  IF s."id" IS NULL OR c."current_execution_submission_id" IS DISTINCT FROM s."id" OR
     c."stage" <> 'WAITING_EXECUTION_STAMP' OR c."version" <> f."to_version" OR
     f."from_version" <> s."to_version" OR f."to_version" <> f."from_version" + 1 OR
     c."current_trial_round_id" IS DISTINCT FROM s."trial_round_id" OR
     c."current_judgment_next_step_id" IS DISTINCT FROM s."judgment_next_step_id" OR
     c."current_second_instance_result_id" IS DISTINCT FROM s."second_instance_result_id" OR
     NOT EXISTS (SELECT 1 FROM "case_execution_submission_versions" v WHERE v."submission_id" = s."id") OR
     s."id" IS DISTINCT FROM (SELECT x."id" FROM "case_execution_submissions" x
       WHERE x."case_id" = target_case AND x."department_id" = target_department ORDER BY x."to_version" DESC LIMIT 1) OR
     a."id" IS NULL OR a."department_id" <> target_department OR a."resource_type" <> 'CASE' OR
     a."resource_id" <> target_case OR a."actor_kind" <> 'HUMAN' OR
     a."actor_user_id" <> f."confirmed_by_user_id" OR a."action" <> 'case.execution.confirmed' OR
     a."details"->>'confirmationId' IS DISTINCT FROM f."id"::text OR
     a."details"->>'submissionId' IS DISTINCT FROM f."submission_id"::text OR
     a."details"->>'fromVersion' IS DISTINCT FROM f."from_version"::text OR
     a."details"->>'toVersion' IS DISTINCT FROM f."to_version"::text OR
     NOT EXISTS (SELECT 1 FROM "case_execution_confirmation_receipts" r WHERE r."case_id" = target_case
       AND r."department_id" = target_department AND r."actor_user_id" = f."confirmed_by_user_id"
       AND r."result_snapshot"->>'confirmationId' = f."id"::text) THEN
    RAISE EXCEPTION 'execution confirmation chain mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "case_execution_confirmation_head_guard" AFTER UPDATE OF "stage", "version", "current_execution_submission_id" ON "cases"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_execution_confirmation_final"();
CREATE CONSTRAINT TRIGGER "case_execution_confirmation_fact_guard" AFTER INSERT ON "case_execution_confirmations"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_execution_confirmation_final"();

CREATE FUNCTION "check_case_execution_confirmation_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f record; c record;
BEGIN
  SELECT * INTO f FROM "case_execution_confirmations" WHERE "id" = (NEW."result_snapshot"->>'confirmationId')::uuid
    AND "case_id" = NEW."case_id" AND "department_id" = NEW."department_id"
    AND "confirmed_by_user_id" = NEW."actor_user_id";
  SELECT * INTO c FROM "cases" WHERE "id" = NEW."case_id" AND "department_id" = NEW."department_id";
  IF f."id" IS NULL OR NEW."request_fingerprint" !~ '^[0-9a-f]{64}$' OR
     NEW."result_snapshot"->>'id' IS DISTINCT FROM NEW."case_id"::text OR
     NEW."result_snapshot"->>'submissionId' IS DISTINCT FROM f."submission_id"::text OR
     NEW."result_snapshot"->>'stage' IS DISTINCT FROM 'WAITING_EXECUTION_STAMP' OR
     NEW."result_snapshot"->>'version' IS DISTINCT FROM f."to_version"::text OR
     (NEW."result_snapshot"->>'confirmedAt')::timestamptz IS DISTINCT FROM f."confirmed_at" OR
     c."stage" <> 'WAITING_EXECUTION_STAMP' OR c."version" <> f."to_version" OR
     c."current_execution_submission_id" IS DISTINCT FROM f."submission_id" THEN
    RAISE EXCEPTION 'execution confirmation receipt mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_execution_confirmation_receipt_guard" BEFORE INSERT ON "case_execution_confirmation_receipts"
  FOR EACH ROW EXECUTE FUNCTION "check_case_execution_confirmation_receipt"();

COMMIT;
