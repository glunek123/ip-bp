BEGIN;

ALTER TABLE "cases" DROP CONSTRAINT "cases_matching_state_check";
ALTER TABLE "cases" ADD CONSTRAINT "cases_matching_state_check" CHECK (
  "version" >= 1 AND (("stage" = 'PENDING_MATCH' AND "matched_at" IS NULL) OR
  ("stage" IN ('WAITING_COMPLAINT', 'WAITING_COMPLAINT_CONFIRMATION', 'WAITING_COMPLAINT_STAMP', 'WAITING_FILING', 'WAITING_FORMAL_ACCEPTANCE', 'WAITING_HEARING', 'WAITING_JUDGMENT', 'SECOND_INSTANCE', 'WAITING_EXECUTION_DOCUMENTS', 'WAITING_EXECUTION_CONFIRMATION') AND "matched_at" IS NOT NULL))
);
ALTER TABLE "cases" DROP CONSTRAINT "cases_complaint_state_check";
ALTER TABLE "cases" ADD CONSTRAINT "cases_complaint_state_check" CHECK (
  ("stage" IN ('PENDING_MATCH', 'WAITING_COMPLAINT') AND "complaint_submitted_at" IS NULL AND "complaint_submitted_by_user_id" IS NULL AND "complaint_amount_state" IS NULL AND "complaint_amount" IS NULL AND "complaint_pending_reason" IS NULL) OR
  ("stage" IN ('WAITING_COMPLAINT_CONFIRMATION', 'WAITING_COMPLAINT_STAMP', 'WAITING_FILING', 'WAITING_FORMAL_ACCEPTANCE', 'WAITING_HEARING', 'WAITING_JUDGMENT', 'SECOND_INSTANCE', 'WAITING_EXECUTION_DOCUMENTS', 'WAITING_EXECUTION_CONFIRMATION') AND "complaint_submitted_at" IS NOT NULL AND "complaint_submitted_by_user_id" IS NOT NULL AND "complaint_amount_state" IS NOT NULL AND
    (("complaint_amount_state" = 'KNOWN' AND "complaint_amount" IS NOT NULL AND "complaint_amount" >= 0 AND "complaint_pending_reason" IS NULL) OR
     ("complaint_amount_state" = 'PENDING' AND "complaint_amount" IS NULL AND "complaint_pending_reason" IS NOT NULL AND CHAR_LENGTH(BTRIM("complaint_pending_reason")) > 0)))
);

ALTER TABLE "case_execution_submission_versions" ADD CONSTRAINT "case_execution_submission_versions_one_material_key" UNIQUE ("submission_id", "material_id");
ALTER TABLE "material_references" ADD CONSTRAINT "material_references_execution_event_check"
  CHECK ("purpose" <> 'EXECUTION_APPLICATION' OR "action_event_id" IS NOT NULL);
DROP INDEX "material_references_resource_purpose_version_key";
CREATE UNIQUE INDEX "material_references_resource_purpose_version_key"
  ON "material_references"("resource_type", "resource_id", "purpose", "content_version_id")
  WHERE "purpose" NOT IN ('JUDGMENT','SECOND_INSTANCE_DOCUMENT','SECOND_INSTANCE_SERVICE','SECOND_INSTANCE_JUDGMENT','EXECUTION_APPLICATION');

-- Retain all prior CA-009/010 validation and change only the new terminal state.
DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname = 'check_case_trial_round_foundation' AND p.pronargs = 0;
  IF definition IS NULL OR position('''WAITING_EXECUTION_DOCUMENTS'')' IN definition) = 0 THEN
    RAISE EXCEPTION 'unknown trial-round guard' USING ERRCODE = '23514';
  END IF;
  EXECUTE replace(definition, '''WAITING_EXECUTION_DOCUMENTS'')', '''WAITING_EXECUTION_DOCUMENTS'',''WAITING_EXECUTION_CONFIRMATION'')');

  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname = 'check_case_judgment_final' AND p.pronargs = 0;
  IF definition IS NULL OR position('IF c."stage"::text IS DISTINCT FROM expected_stage OR c."version" <> expected_version THEN' IN definition) = 0 THEN
    RAISE EXCEPTION 'unknown current-judgment guard' USING ERRCODE = '23514';
  END IF;
  definition := replace(definition, '''SECOND_INSTANCE'', ''WAITING_EXECUTION_DOCUMENTS'') THEN',
    '''SECOND_INSTANCE'', ''WAITING_EXECUTION_DOCUMENTS'', ''WAITING_EXECUTION_CONFIRMATION'') THEN');
  definition := replace(definition,
    'IF c."stage"::text IS DISTINCT FROM expected_stage OR c."version" <> expected_version THEN',
    'IF EXISTS (SELECT 1 FROM "case_execution_submissions" e WHERE e."case_id" = target_case AND e."department_id" = target_department AND e."trial_round_id" = round_id) THEN' || E'\n' ||
    '  IF expected_stage <> ''WAITING_EXECUTION_DOCUMENTS'' OR NOT EXISTS (' || E'\n' ||
    '    SELECT 1 FROM "case_execution_submissions" e WHERE e."id" = c."current_execution_submission_id"' || E'\n' ||
    '      AND e."case_id" = target_case AND e."department_id" = target_department AND e."trial_round_id" = round_id' || E'\n' ||
    '      AND e."judgment_next_step_id" = latest_choice."id"' || E'\n' ||
    '      AND e."second_instance_result_id" IS NOT DISTINCT FROM c."current_second_instance_result_id"' || E'\n' ||
    '      AND e."id" = (SELECT x."id" FROM "case_execution_submissions" x WHERE x."case_id" = target_case' || E'\n' ||
    '        AND x."department_id" = target_department AND x."trial_round_id" = round_id ORDER BY x."to_version" DESC LIMIT 1)) THEN' || E'\n' ||
    '    RAISE EXCEPTION ''execution head or source mismatch'' USING ERRCODE = ''23514'';' || E'\n' ||
    '  END IF;' || E'\n' ||
    '  SELECT e."to_version" INTO expected_version FROM "case_execution_submissions" e WHERE e."id" = c."current_execution_submission_id";' || E'\n' ||
    '  expected_stage := ''WAITING_EXECUTION_CONFIRMATION'';' || E'\n' ||
    'ELSIF c."current_execution_submission_id" IS NOT NULL THEN' || E'\n' ||
    '  RAISE EXCEPTION ''execution pointer without fact'' USING ERRCODE = ''23514'';' || E'\n' ||
    'END IF;' || E'\n' ||
    'IF c."stage"::text IS DISTINCT FROM expected_stage OR c."version" <> expected_version THEN');
  EXECUTE definition;

  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname = 'check_case_judgment_next_step_final' AND p.pronargs = 0;
  IF definition IS NULL OR position('''SECOND_INSTANCE'', ''WAITING_EXECUTION_DOCUMENTS'')' IN definition) = 0 THEN
    RAISE EXCEPTION 'unknown choice guard' USING ERRCODE = '23514';
  END IF;
  EXECUTE replace(definition, '''SECOND_INSTANCE'', ''WAITING_EXECUTION_DOCUMENTS'')',
    '''SECOND_INSTANCE'', ''WAITING_EXECUTION_DOCUMENTS'', ''WAITING_EXECUTION_CONFIRMATION'')');

  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname = 'check_case_second_instance_final' AND p.pronargs = 0;
  IF definition IS NULL OR position('c."stage" <> ''WAITING_EXECUTION_DOCUMENTS''' IN definition) = 0 THEN
    RAISE EXCEPTION 'unknown second-instance guard' USING ERRCODE = '23514';
  END IF;
  EXECUTE replace(definition, 'c."stage" <> ''WAITING_EXECUTION_DOCUMENTS''',
    'c."stage" NOT IN (''WAITING_EXECUTION_DOCUMENTS'',''WAITING_EXECUTION_CONFIRMATION'')');

  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname = 'enforce_case_client_mailing_actor_path' AND p.pronargs = 0;
  IF definition IS NULL OR position('''SECOND_INSTANCE_JUDGMENT'')' IN definition) = 0 OR
     position('WHEN ''case.second_instance.result'' THEN ''SECOND_INSTANCE''' IN definition) = 0 THEN
    RAISE EXCEPTION 'unknown lawyer actor guard' USING ERRCODE = '23514';
  END IF;
  definition := replace(definition, '''SECOND_INSTANCE_JUDGMENT'')', '''SECOND_INSTANCE_JUDGMENT'', ''EXECUTION_APPLICATION'')');
  definition := replace(definition,
    'WHEN NEW."category" IN (''SECOND_INSTANCE_DOCUMENT'', ''SECOND_INSTANCE_SERVICE'', ''SECOND_INSTANCE_JUDGMENT'') THEN ''SECOND_INSTANCE''',
    'WHEN NEW."category" IN (''SECOND_INSTANCE_DOCUMENT'', ''SECOND_INSTANCE_SERVICE'', ''SECOND_INSTANCE_JUDGMENT'') THEN ''SECOND_INSTANCE''' || E'\n' ||
    '        WHEN NEW."category" = ''EXECUTION_APPLICATION'' THEN ''WAITING_EXECUTION_DOCUMENTS,WAITING_EXECUTION_CONFIRMATION''');
  definition := replace(definition,
    'WHEN ''case.second_instance.result'' THEN ''SECOND_INSTANCE''',
    'WHEN ''case.second_instance.result'' THEN ''SECOND_INSTANCE''' || E'\n' ||
    '          WHEN ''case.execution.submitted'' THEN ''WAITING_EXECUTION_DOCUMENTS,WAITING_EXECUTION_CONFIRMATION''');
  EXECUTE definition;
END; $migration$;

CREATE OR REPLACE FUNCTION "reject_case_judgment_audit_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."action" IN ('case.judgment.registered', 'case.judgment.corrected', 'case.judgment.next_step',
      'case.judgment.next_step.revoke', 'case.second_instance.save', 'case.second_instance.result',
      'case.second_instance.result.revoke', 'case.execution.submitted') OR
     (TG_OP = 'UPDATE' AND NEW."action" IN ('case.judgment.registered', 'case.judgment.corrected',
      'case.judgment.next_step', 'case.judgment.next_step.revoke', 'case.second_instance.save',
      'case.second_instance.result', 'case.second_instance.result.revoke', 'case.execution.submitted')) THEN
    RAISE EXCEPTION 'judgment/second-instance/execution audit is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER "case_execution_submissions_immutable" BEFORE UPDATE OR DELETE ON "case_execution_submissions"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE TRIGGER "case_execution_submission_versions_immutable" BEFORE UPDATE OR DELETE ON "case_execution_submission_versions"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE TRIGGER "case_execution_submission_receipts_immutable" BEFORE UPDATE OR DELETE ON "case_execution_submission_receipts"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();

CREATE FUNCTION "block_execution_source_revocation"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_choice uuid;
BEGIN
  SELECT c."id" INTO source_choice FROM "cases" c WHERE c."id" = NEW."case_id" AND c."department_id" = NEW."department_id" FOR UPDATE;
  IF TG_TABLE_NAME = 'case_judgment_next_step_revocations' THEN
    IF EXISTS (SELECT 1 FROM "case_execution_submissions" e WHERE e."case_id" = NEW."case_id"
      AND e."department_id" = NEW."department_id" AND e."judgment_next_step_id" = NEW."choice_id") THEN
      RAISE EXCEPTION 'execution submission blocks choice revocation' USING ERRCODE = '23514';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM "case_execution_submissions" e WHERE e."case_id" = NEW."case_id"
    AND e."department_id" = NEW."department_id" AND e."second_instance_result_id" = NEW."result_id") THEN
    RAISE EXCEPTION 'execution submission blocks result revocation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_execution_choice_revoke_block" BEFORE INSERT ON "case_judgment_next_step_revocations"
  FOR EACH ROW EXECUTE FUNCTION "block_execution_source_revocation"();
CREATE TRIGGER "case_execution_result_revoke_block" BEFORE INSERT ON "case_second_instance_result_revocations"
  FOR EACH ROW EXECUTE FUNCTION "block_execution_source_revocation"();

CREATE FUNCTION "check_case_execution_submission_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; c record; e record; prior record; choice_record record;
        result_record record; selected jsonb; expected_source_version integer;
BEGIN
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id" = target_case AND "department_id" = target_department;
  SELECT * INTO e FROM "case_execution_submissions" WHERE "id" = c."current_execution_submission_id"
    AND "case_id" = target_case AND "department_id" = target_department;
  IF c."current_execution_submission_id" IS NULL THEN
    IF c."stage" = 'WAITING_EXECUTION_CONFIRMATION' OR EXISTS (
      SELECT 1 FROM "case_execution_submissions" x WHERE x."case_id" = target_case
        AND x."department_id" = target_department AND x."trial_round_id" = c."current_trial_round_id") THEN
      RAISE EXCEPTION 'execution confirmation has no head' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF e."id" IS NULL OR c."stage" <> 'WAITING_EXECUTION_CONFIRMATION' OR c."version" <> e."to_version" OR
       c."current_trial_round_id" IS DISTINCT FROM e."trial_round_id" OR
       c."current_judgment_next_step_id" IS DISTINCT FROM e."judgment_next_step_id" OR
       c."current_second_instance_result_id" IS DISTINCT FROM e."second_instance_result_id" OR
       e."id" IS DISTINCT FROM (SELECT x."id" FROM "case_execution_submissions" x
         WHERE x."case_id" = target_case AND x."department_id" = target_department
           AND x."trial_round_id" = e."trial_round_id" ORDER BY x."to_version" DESC LIMIT 1) THEN
      RAISE EXCEPTION 'execution head stage/version/source mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'case_execution_submissions' THEN
    SELECT * INTO e FROM "case_execution_submissions" WHERE "id" = NEW."id";
    SELECT * INTO choice_record FROM "case_judgment_next_steps" s WHERE s."id" = e."judgment_next_step_id"
      AND s."case_id" = target_case AND s."department_id" = target_department
      AND s."trial_round_id" = e."trial_round_id" AND NOT EXISTS
        (SELECT 1 FROM "case_judgment_next_step_revocations" r WHERE r."choice_id" = s."id");
    IF choice_record."id" IS NULL THEN RAISE EXCEPTION 'execution choice source missing' USING ERRCODE = '23514'; END IF;
    IF choice_record."next" = 'EXECUTION' THEN
      IF e."second_instance_result_id" IS NOT NULL THEN
        RAISE EXCEPTION 'direct execution cannot have appeal result' USING ERRCODE = '23514';
      END IF;
      expected_source_version := choice_record."to_version";
    ELSE
      SELECT * INTO result_record FROM "case_second_instance_results" r WHERE r."id" = e."second_instance_result_id"
        AND r."case_id" = target_case AND r."department_id" = target_department
        AND r."trial_round_id" = e."trial_round_id" AND r."choice_id" = e."judgment_next_step_id"
        AND r."result" IN ('AFFIRM','CHANGE') AND NOT EXISTS
          (SELECT 1 FROM "case_second_instance_result_revocations" v WHERE v."result_id" = r."id");
      IF choice_record."next" <> 'APPEAL' OR result_record."id" IS NULL THEN
        RAISE EXCEPTION 'execution appeal result source missing' USING ERRCODE = '23514';
      END IF;
      expected_source_version := result_record."to_version";
    END IF;
    SELECT * INTO prior FROM "case_execution_submissions" WHERE "id" = e."prior_submission_id"
      AND "case_id" = target_case AND "department_id" = target_department;
    IF (e."prior_submission_id" IS NULL AND (e."change_reason" IS NOT NULL OR
         e."from_version" <> expected_source_version)) OR
       (e."prior_submission_id" IS NOT NULL AND (prior."id" IS NULL OR
         prior."id" = e."id" OR prior."to_version" <> e."from_version" OR
         prior."trial_round_id" <> e."trial_round_id" OR
         prior."judgment_next_step_id" <> e."judgment_next_step_id" OR
         prior."second_instance_result_id" IS DISTINCT FROM e."second_instance_result_id" OR
         NULLIF(btrim(e."change_reason"), '') IS NULL OR
         prior."id" IS DISTINCT FROM (SELECT x."id" FROM "case_execution_submissions" x
           WHERE x."case_id" = target_case AND x."department_id" = target_department
             AND x."trial_round_id" = e."trial_round_id" AND x."id" <> e."id"
           ORDER BY x."to_version" DESC LIMIT 1) OR
         (SELECT array_agg(x."content_version_id" ORDER BY x."content_version_id")
           FROM "case_execution_submission_versions" x WHERE x."submission_id" = prior."id") IS NOT DISTINCT FROM
         (SELECT array_agg(x."content_version_id" ORDER BY x."content_version_id")
           FROM "case_execution_submission_versions" x WHERE x."submission_id" = e."id"))) THEN
      RAISE EXCEPTION 'execution submission version, predecessor or change mismatch' USING ERRCODE = '23514';
    END IF;
    SELECT a."details"->'executionApplicationContentVersionIds' INTO selected FROM "audit_events" a
      WHERE a."id" = e."audit_event_id" AND a."department_id" = target_department
        AND a."resource_type" = 'CASE' AND a."resource_id" = target_case
        AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = e."submitted_by_user_id"
        AND a."action" = 'case.execution.submitted'
        AND a."details"->>'submissionId' = e."id"::text
        AND a."details"->>'trialRoundId' = e."trial_round_id"::text
        AND a."details"->>'judgmentNextStepId' = e."judgment_next_step_id"::text
        AND a."details"->>'secondInstanceResultId' IS NOT DISTINCT FROM e."second_instance_result_id"::text
        AND a."details"->>'priorSubmissionId' IS NOT DISTINCT FROM e."prior_submission_id"::text
        AND a."details"->>'changeReason' IS NOT DISTINCT FROM e."change_reason"
        AND a."details"->>'fromVersion' = e."from_version"::text
        AND a."details"->>'toVersion' = e."to_version"::text;
    IF jsonb_typeof(selected) IS DISTINCT FROM 'array' OR jsonb_array_length(selected) NOT BETWEEN 1 AND 10 OR
       (SELECT count(*) FROM "case_execution_submission_versions" v WHERE v."submission_id" = e."id") <> jsonb_array_length(selected) OR
       EXISTS (SELECT 1 FROM "case_execution_submission_versions" v WHERE v."submission_id" = e."id"
         AND NOT selected ? v."content_version_id"::text) OR
       NOT EXISTS (SELECT 1 FROM "case_execution_submission_receipts" r WHERE r."case_id" = target_case
         AND r."department_id" = target_department AND r."actor_user_id" = e."submitted_by_user_id"
         AND r."result_snapshot"->>'submissionId' = e."id"::text) THEN
      RAISE EXCEPTION 'execution audit, frozen set or receipt mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "case_execution_head_guard" AFTER UPDATE OF "stage", "version", "current_trial_round_id",
  "current_judgment_next_step_id", "current_second_instance_result_id", "current_execution_submission_id" ON "cases"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_execution_submission_final"();
CREATE CONSTRAINT TRIGGER "case_execution_submission_guard" AFTER INSERT ON "case_execution_submissions"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_execution_submission_final"();

CREATE FUNCTION "check_case_execution_submission_version"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected jsonb; fact_audit uuid;
BEGIN
  SELECT s."audit_event_id", a."details"->'executionApplicationContentVersionIds' INTO fact_audit, selected
    FROM "case_execution_submissions" s JOIN "audit_events" a ON a."id" = s."audit_event_id"
    WHERE s."id" = NEW."submission_id" AND s."case_id" = NEW."case_id"
      AND s."department_id" = NEW."department_id" FOR UPDATE OF s;
  IF fact_audit IS NULL OR jsonb_typeof(selected) IS DISTINCT FROM 'array' OR
     NOT selected ? NEW."content_version_id"::text OR NOT EXISTS (
       SELECT 1 FROM "materials" m JOIN "content_versions" v ON v."material_id" = m."id"
       WHERE m."id" = NEW."material_id" AND v."id" = NEW."content_version_id"
         AND m."department_id" = NEW."department_id" AND m."owner_type" = 'CASE'
         AND m."owner_id" = NEW."case_id" AND m."category" = 'EXECUTION_APPLICATION'
         AND m."purpose" = 'EXECUTION_APPLICATION' AND m."status" = 'ACTIVE' AND v."status" = 'AVAILABLE'
         AND v."mime_type" IN ('application/pdf','application/msword',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
         AND v."size_bytes" <= 52428800
         AND (m."current_version_id" = v."id" OR EXISTS (
           SELECT 1 FROM "case_execution_submission_versions" prior_v
           WHERE prior_v."case_id" = NEW."case_id" AND prior_v."department_id" = NEW."department_id"
             AND prior_v."material_id" = m."id" AND prior_v."content_version_id" = v."id"))) THEN
    RAISE EXCEPTION 'execution frozen version mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_execution_submission_versions_guard" BEFORE INSERT ON "case_execution_submission_versions"
  FOR EACH ROW EXECUTE FUNCTION "check_case_execution_submission_version"();

CREATE FUNCTION "check_case_execution_submission_reference"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fact_id uuid;
BEGIN
  IF NEW."purpose" <> 'EXECUTION_APPLICATION' THEN RETURN NEW; END IF;
  IF NEW."resource_type" <> 'case' OR NEW."action_event_id" IS NULL THEN
    RAISE EXCEPTION 'execution reference source invalid' USING ERRCODE = '23514';
  END IF;
  SELECT s."id" INTO fact_id FROM "case_execution_submissions" s
    WHERE s."case_id" = NEW."resource_id" AND s."department_id" = NEW."department_id"
      AND s."audit_event_id" = NEW."action_event_id" FOR UPDATE OF s;
  IF fact_id IS NULL OR NOT EXISTS (SELECT 1 FROM "case_execution_submission_versions" v
    WHERE v."submission_id" = fact_id AND v."case_id" = NEW."resource_id"
      AND v."department_id" = NEW."department_id" AND v."material_id" = NEW."material_id"
      AND v."content_version_id" = NEW."content_version_id") OR EXISTS (
      SELECT 1 FROM "case_execution_submission_receipts" r WHERE r."case_id" = NEW."resource_id"
        AND r."department_id" = NEW."department_id" AND r."result_snapshot"->>'submissionId' = fact_id::text) THEN
    RAISE EXCEPTION 'execution reference mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_execution_material_reference_guard" BEFORE INSERT ON "material_references"
  FOR EACH ROW EXECUTE FUNCTION "check_case_execution_submission_reference"();
CREATE FUNCTION "reject_case_execution_submission_reference_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."purpose" = 'EXECUTION_APPLICATION' OR
     (TG_OP = 'UPDATE' AND NEW."purpose" = 'EXECUTION_APPLICATION') THEN
    RAISE EXCEPTION 'execution material reference is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_execution_material_reference_immutable" BEFORE UPDATE OR DELETE ON "material_references"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_execution_submission_reference_mutation"();

CREATE FUNCTION "check_case_execution_submission_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fact record;
BEGIN
  SELECT s.* INTO fact FROM "case_execution_submissions" s
    WHERE s."id" = (NEW."result_snapshot"->>'submissionId')::uuid AND s."case_id" = NEW."case_id"
      AND s."department_id" = NEW."department_id" AND s."submitted_by_user_id" = NEW."actor_user_id";
  IF fact."id" IS NULL OR NEW."request_fingerprint" !~ '^[0-9a-f]{64}$' OR
     NEW."result_snapshot"->>'id' IS DISTINCT FROM NEW."case_id"::text OR
     NEW."result_snapshot"->>'stage' IS DISTINCT FROM 'WAITING_EXECUTION_CONFIRMATION' OR
     NEW."result_snapshot"->>'version' IS DISTINCT FROM fact."to_version"::text OR
     (NEW."result_snapshot"->>'submittedAt')::timestamptz IS DISTINCT FROM fact."submitted_at" OR
     NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id" = NEW."case_id" AND c."department_id" = NEW."department_id"
       AND c."current_execution_submission_id" = fact."id" AND c."stage" = 'WAITING_EXECUTION_CONFIRMATION'
       AND c."version" = fact."to_version") OR
     (SELECT count(*) FROM "case_execution_submission_versions" v WHERE v."submission_id" = fact."id") NOT BETWEEN 1 AND 10 OR
     EXISTS (SELECT 1 FROM "case_execution_submission_versions" v WHERE v."submission_id" = fact."id"
       AND NOT EXISTS (SELECT 1 FROM "material_references" r WHERE r."action_event_id" = fact."audit_event_id"
         AND r."resource_type" = 'case' AND r."resource_id" = NEW."case_id"
         AND r."purpose" = 'EXECUTION_APPLICATION' AND r."material_id" = v."material_id"
         AND r."content_version_id" = v."content_version_id")) THEN
    RAISE EXCEPTION 'execution receipt or frozen set mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_execution_submission_receipt_guard" BEFORE INSERT ON "case_execution_submission_receipts"
  FOR EACH ROW EXECUTE FUNCTION "check_case_execution_submission_receipt"();

COMMIT;
