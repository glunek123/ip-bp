BEGIN;

-- A remand is the only way to create or activate a later trial round. A
-- canceled child remains recorded, but can never become current again.
CREATE OR REPLACE FUNCTION "check_case_trial_round_foundation"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; c record; r record; source_result record;
BEGIN
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id" = target_case AND "department_id" = target_department;
  IF c."current_trial_round_id" IS NULL THEN
    IF c."current_acceptance_id" IS NOT NULL OR c."stage" IN
      ('WAITING_HEARING','WAITING_JUDGMENT','SECOND_INSTANCE','WAITING_EXECUTION_DOCUMENTS') OR
      c."current_second_instance_progress_id" IS NOT NULL OR c."current_second_instance_result_id" IS NOT NULL OR
      EXISTS (SELECT 1 FROM "case_trial_rounds" x WHERE x."case_id" = target_case AND x."department_id" = target_department) OR
      EXISTS (SELECT 1 FROM "case_acceptances" a WHERE a."case_id" = target_case AND a."department_id" = target_department) THEN
      RAISE EXCEPTION 'accepted case has no active trial round' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO r FROM "case_trial_rounds" WHERE "id" = c."current_trial_round_id"
      AND "case_id" = target_case AND "department_id" = target_department;
    IF r."id" IS NULL OR r."revoked_at" IS NOT NULL THEN
      RAISE EXCEPTION 'active trial round missing or revoked' USING ERRCODE = '23514';
    END IF;
    IF r."sequence" = 1 THEN
      IF r."source_result_id" IS NOT NULL OR c."current_acceptance_id" IS NULL OR
         NOT EXISTS (SELECT 1 FROM "case_acceptances" a WHERE a."id" = c."current_acceptance_id"
           AND a."trial_round_id" = r."id" AND a."case_id" = target_case AND a."department_id" = target_department
           AND a."court_case_no" = c."court_case_no") THEN
        RAISE EXCEPTION 'initial trial round or acceptance mismatch' USING ERRCODE = '23514';
      END IF;
    ELSE
      SELECT s."id", s."case_id", s."department_id", s."trial_round_id", s."result", s."to_version", v."id" AS revocation_id
        INTO source_result FROM "case_second_instance_results" s
        LEFT JOIN "case_second_instance_result_revocations" v ON v."result_id" = s."id"
        WHERE s."id" = r."source_result_id" AND s."case_id" = target_case AND s."department_id" = target_department;
      IF source_result."id" IS NULL OR source_result."result" <> 'REMAND' OR source_result.revocation_id IS NOT NULL OR
         r."sequence" <> (SELECT p."sequence" + 1 FROM "case_trial_rounds" p WHERE p."id" = source_result."trial_round_id") THEN
        RAISE EXCEPTION 'later trial round lacks active remand source' USING ERRCODE = '23514';
      END IF;
      IF c."current_acceptance_id" IS NULL THEN
        IF c."stage" <> 'WAITING_FORMAL_ACCEPTANCE' OR c."current_second_instance_result_id" IS DISTINCT FROM source_result."id" OR
           c."court_case_no" IS NOT NULL OR c."current_hearing_arrangement_id" IS NOT NULL OR
           c."current_hearing_advance_id" IS NOT NULL OR c."current_judgment_id" IS NOT NULL OR
           c."current_judgment_next_step_id" IS NOT NULL OR c."current_second_instance_progress_id" IS NOT NULL THEN
          RAISE EXCEPTION 'unaccepted remand child pointers mismatch' USING ERRCODE = '23514';
        END IF;
      ELSIF NOT EXISTS (SELECT 1 FROM "case_acceptances" a WHERE a."id" = c."current_acceptance_id"
        AND a."trial_round_id" = r."id" AND a."case_id" = target_case AND a."department_id" = target_department
        AND a."court_case_no" = c."court_case_no") OR c."current_second_instance_result_id" IS NOT NULL THEN
        RAISE EXCEPTION 'accepted remand child pointers mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'case_trial_rounds' THEN
    IF NEW."revoked_at" IS NOT NULL OR c."current_trial_round_id" IS DISTINCT FROM NEW."id" OR
       (NEW."sequence" = 1 AND NEW."source_result_id" IS NOT NULL) OR
       (NEW."sequence" > 1 AND NOT EXISTS (SELECT 1 FROM "case_second_instance_results" s
         WHERE s."id" = NEW."source_result_id" AND s."case_id" = target_case AND s."department_id" = target_department
           AND s."result" = 'REMAND' AND s."to_version" = c."version")) THEN
      RAISE EXCEPTION 'new trial round requires exact remand result' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME <> 'cases' THEN
    IF NEW."trial_round_id" IS DISTINCT FROM c."current_trial_round_id" THEN
      RAISE EXCEPTION 'new case fact must belong to current trial round' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF (c."current_hearing_arrangement_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_hearing_arrangements" x WHERE x."id" = c."current_hearing_arrangement_id"
        AND x."trial_round_id" = c."current_trial_round_id")) OR
     (c."current_hearing_advance_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_hearing_advances" x WHERE x."id" = c."current_hearing_advance_id"
        AND x."trial_round_id" = c."current_trial_round_id")) OR
     (c."current_judgment_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_judgment_facts" x WHERE x."id" = c."current_judgment_id"
        AND x."trial_round_id" = c."current_trial_round_id")) OR
     (c."current_judgment_next_step_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_judgment_next_steps" x WHERE x."id" = c."current_judgment_next_step_id"
        AND x."trial_round_id" = c."current_trial_round_id")) OR
     (c."current_second_instance_progress_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_second_instance_progresses" x WHERE x."id" = c."current_second_instance_progress_id"
        AND x."trial_round_id" = c."current_trial_round_id")) OR
     (c."current_second_instance_result_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_second_instance_results" x WHERE x."id" = c."current_second_instance_result_id"
        AND (x."trial_round_id" = c."current_trial_round_id" OR
          (x."result" = 'REMAND' AND EXISTS (SELECT 1 FROM "case_trial_rounds" child
            WHERE child."id" = c."current_trial_round_id" AND child."source_result_id" = x."id"))))) THEN
    RAISE EXCEPTION 'case current pointer crosses trial rounds' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION "reject_case_trial_round_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."revoked_at" IS NULL AND NEW."revoked_at" IS NOT NULL AND
     (OLD."id", OLD."case_id", OLD."department_id", OLD."sequence", OLD."source_result_id") IS NOT DISTINCT FROM
     (NEW."id", NEW."case_id", NEW."department_id", NEW."sequence", NEW."source_result_id") AND
     EXISTS (SELECT 1 FROM "case_second_instance_result_revocations" v
       WHERE v."case_id" = OLD."case_id" AND v."department_id" = OLD."department_id"
         AND v."result_id" = OLD."source_result_id" AND v."recorded_at" = NEW."revoked_at") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'trial round is immutable without exact result revocation' USING ERRCODE = '23514';
END; $$;

-- The previous CA-009 guard compared every round to the globally latest
-- judgment/choice. Keep the original audit/receipt checks, but scope the
-- judgment chain to the active round and prove subsequent versions by facts.
CREATE OR REPLACE FUNCTION "check_case_judgment_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; c record; round_id uuid;
        latest_judgment record; latest_choice record; latest_revoke record; latest_progress record; active_result record; latest_result_revocation record;
        root_count integer; expected_version integer; expected_stage text;
BEGIN
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id" = target_case AND "department_id" = target_department;
  round_id := c."current_trial_round_id";
  SELECT f."id", f."to_version" INTO latest_judgment FROM "case_judgment_facts" f
    WHERE f."case_id" = target_case AND f."department_id" = target_department AND f."trial_round_id" = round_id
    ORDER BY f."to_version" DESC LIMIT 1;
  IF latest_judgment."id" IS NULL THEN
    IF c."current_judgment_id" IS NOT NULL OR c."current_judgment_next_step_id" IS NOT NULL OR
       c."stage" IN ('SECOND_INSTANCE', 'WAITING_EXECUTION_DOCUMENTS') THEN
      RAISE EXCEPTION 'current round has no judgment for stage' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT count(*) INTO root_count FROM "case_judgment_facts" f WHERE f."case_id" = target_case
      AND f."department_id" = target_department AND f."trial_round_id" = round_id AND f."kind" = 'REGISTER';
    IF root_count <> 1 OR c."current_judgment_id" IS DISTINCT FROM latest_judgment."id" THEN
      RAISE EXCEPTION 'current round judgment head mismatch' USING ERRCODE = '23514';
    END IF;
    SELECT s."id", s."judgment_id", s."next", s."to_version" INTO latest_choice
      FROM "case_judgment_next_steps" s WHERE s."case_id" = target_case AND s."department_id" = target_department
        AND s."trial_round_id" = round_id ORDER BY s."to_version" DESC LIMIT 1;
    expected_version := latest_judgment."to_version";
    IF latest_choice."id" IS NOT NULL THEN
      SELECT v."id", v."to_version" INTO latest_revoke FROM "case_judgment_next_step_revocations" v
        WHERE v."choice_id" = latest_choice."id" AND v."case_id" = target_case AND v."department_id" = target_department;
      IF latest_revoke."id" IS NULL THEN
        IF c."current_judgment_next_step_id" IS DISTINCT FROM latest_choice."id" OR
           c."current_judgment_id" IS DISTINCT FROM latest_choice."judgment_id" THEN
          RAISE EXCEPTION 'current round active choice mismatch' USING ERRCODE = '23514';
        END IF;
        expected_stage := CASE WHEN latest_choice."next" = 'APPEAL' THEN 'SECOND_INSTANCE' ELSE 'WAITING_EXECUTION_DOCUMENTS' END;
        expected_version := latest_choice."to_version";
        IF latest_choice."next" = 'APPEAL' THEN
          SELECT p."id", p."to_version" INTO latest_progress FROM "case_second_instance_progresses" p
            WHERE p."case_id" = target_case AND p."department_id" = target_department AND p."trial_round_id" = round_id
              AND p."choice_id" = latest_choice."id" ORDER BY p."to_version" DESC LIMIT 1;
          IF c."current_second_instance_progress_id" IS DISTINCT FROM latest_progress."id" THEN
            RAISE EXCEPTION 'active second-instance progress head mismatch' USING ERRCODE = '23514';
          END IF;
          expected_version := greatest(expected_version, coalesce(latest_progress."to_version", 0));
          SELECT s."id", s."result", s."to_version" INTO active_result FROM "case_second_instance_results" s
            LEFT JOIN "case_second_instance_result_revocations" v ON v."result_id" = s."id"
            WHERE s."case_id" = target_case AND s."department_id" = target_department AND s."trial_round_id" = round_id
              AND s."choice_id" = latest_choice."id" AND v."id" IS NULL ORDER BY s."to_version" DESC LIMIT 1;
          IF active_result."id" IS NOT NULL THEN
            IF active_result."result" = 'REMAND' OR c."current_second_instance_result_id" IS DISTINCT FROM active_result."id" THEN
              RAISE EXCEPTION 'source round with active remand/result mismatch' USING ERRCODE = '23514';
            END IF;
            expected_stage := 'WAITING_EXECUTION_DOCUMENTS';
            expected_version := active_result."to_version";
          ELSE
            IF c."current_second_instance_result_id" IS NOT NULL THEN
              RAISE EXCEPTION 'second-instance result pointer without active result' USING ERRCODE = '23514';
            END IF;
            SELECT v."to_version" INTO latest_result_revocation FROM "case_second_instance_result_revocations" v
              JOIN "case_second_instance_results" s ON s."id" = v."result_id"
              WHERE s."case_id" = target_case AND s."department_id" = target_department
                AND s."trial_round_id" = round_id AND s."choice_id" = latest_choice."id"
              ORDER BY v."to_version" DESC LIMIT 1;
            expected_version := greatest(expected_version, coalesce(latest_result_revocation."to_version", 0));
          END IF;
        END IF;
        IF c."stage"::text IS DISTINCT FROM expected_stage OR c."version" <> expected_version THEN
          RAISE EXCEPTION 'active judgment choice stage/version mismatch' USING ERRCODE = '23514';
        END IF;
      ELSE
        expected_version := greatest(expected_version, latest_revoke."to_version");
        IF c."current_judgment_next_step_id" IS NOT NULL OR c."stage" <> 'WAITING_JUDGMENT' OR c."version" <> expected_version THEN
          RAISE EXCEPTION 'revoked judgment choice mismatch' USING ERRCODE = '23514';
        END IF;
      END IF;
    ELSIF c."current_judgment_next_step_id" IS NOT NULL OR c."stage" <> 'WAITING_JUDGMENT' OR c."version" <> expected_version THEN
      RAISE EXCEPTION 'judgment stage/version mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'case_judgment_facts' THEN
    IF NEW."judgment_received_at" < (SELECT a."accepted_at" FROM "case_acceptances" a
          WHERE a."case_id" = target_case AND a."department_id" = target_department AND a."trial_round_id" = NEW."trial_round_id") OR
       NEW."judgment_received_at" > (NEW."recorded_at" AT TIME ZONE 'Asia/Shanghai')::date OR
       (NEW."kind" = 'REGISTER' AND NEW."prior_fact_id" IS NOT NULL) OR
       (NEW."kind" = 'CORRECT' AND NOT EXISTS (SELECT 1 FROM "case_judgment_facts" prior
         WHERE prior."id" = NEW."prior_fact_id" AND prior."case_id" = NEW."case_id"
           AND prior."department_id" = NEW."department_id" AND prior."trial_round_id" = NEW."trial_round_id"
           AND prior."id" = (SELECT f."id" FROM "case_judgment_facts" f WHERE f."case_id" = NEW."case_id"
             AND f."department_id" = NEW."department_id" AND f."trial_round_id" = NEW."trial_round_id"
             AND f."id" <> NEW."id" ORDER BY f."to_version" DESC LIMIT 1)
           AND (prior."to_version" = NEW."from_version" OR EXISTS (SELECT 1 FROM "case_judgment_next_step_revocations" v
             JOIN "case_judgment_next_steps" s ON s."id" = v."choice_id"
             WHERE s."judgment_id" = prior."id" AND s."trial_round_id" = NEW."trial_round_id"
               AND s."case_id" = NEW."case_id" AND s."department_id" = NEW."department_id"
               AND v."to_version" = NEW."from_version")))) OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = NEW."department_id" AND a."resource_type" = 'CASE' AND a."resource_id" = NEW."case_id"
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = CASE WHEN NEW."kind" = 'REGISTER' THEN 'case.judgment.registered' ELSE 'case.judgment.corrected' END
         AND a."details"->>'judgmentId' = NEW."id"::text AND a."details"->>'fromVersion' = NEW."from_version"::text
         AND a."details"->>'toVersion' = NEW."to_version"::text
         AND a."details"->>'judgmentReceivedAt' = NEW."judgment_received_at"::text
         AND a."details"->>'judgmentAmountState' = NEW."judgment_amount_state"::text
         AND a."details"->>'judgmentAmount' IS NOT DISTINCT FROM NEW."judgment_amount"::text
         AND a."details"->>'paidLitigationFeeState' = NEW."paid_litigation_fee_state"::text
         AND a."details"->>'paidLitigationFee' IS NOT DISTINCT FROM NEW."paid_litigation_fee"::text
         AND a."details"->>'priorFactId' IS NOT DISTINCT FROM NEW."prior_fact_id"::text
         AND a."details"->>'reason' IS NOT DISTINCT FROM NEW."reason") OR
       NOT EXISTS (SELECT 1 FROM "case_judgment_receipts" v WHERE v."case_id" = NEW."case_id"
         AND v."department_id" = NEW."department_id" AND v."actor_user_id" = NEW."recorded_by_user_id"
         AND v."action" = NEW."kind" AND v."result_snapshot"->>'judgmentId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'judgment fact or audit mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

-- Retain CA-009 field/audit/receipt checks while scoping its two latest-choice
-- lookups to the same source round. Assert no later second-instance facts on
-- a choice revocation even if the caller bypasses the service.
DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname = 'check_case_judgment_next_step_final' AND p.pronargs = 0;
  IF definition IS NULL OR position('AND s."id" <> NEW."id"' IN definition) = 0 OR
     position('ORDER BY s."to_version" DESC LIMIT 1)' IN definition) = 0 THEN
    RAISE EXCEPTION 'unknown CA-009 choice guard' USING ERRCODE = '23514';
  END IF;
  definition := replace(definition,
    'AND s."id" <> NEW."id"',
    'AND s."id" <> NEW."id" AND s."trial_round_id" = NEW."trial_round_id"');
  definition := replace(definition,
    'WHERE s."case_id" = target_case' || E'\n         ORDER BY s."to_version" DESC LIMIT 1)',
    'WHERE s."case_id" = target_case AND s."trial_round_id" = choice_record."trial_round_id"' || E'\n         ORDER BY s."to_version" DESC LIMIT 1)');
  -- pg_get_functiondef may normalize whitespace. A post-migration database
  -- assertion below checks that both round predicates actually landed.
  definition := replace(definition,
    's."to_version" INTO choice_record FROM "case_judgment_next_steps" s',
    's."to_version", s."trial_round_id" INTO choice_record FROM "case_judgment_next_steps" s');
  definition := replace(definition,
    'case_record."current_judgment_id" IS DISTINCT FROM choice_record."judgment_id" OR',
    'case_record."current_judgment_id" IS DISTINCT FROM choice_record."judgment_id" OR' || E'\n       EXISTS (SELECT 1 FROM "case_second_instance_progresses" p WHERE p."choice_id" = NEW."choice_id") OR' || E'\n       EXISTS (SELECT 1 FROM "case_second_instance_results" x WHERE x."choice_id" = NEW."choice_id") OR');
  EXECUTE definition;
END; $migration$;

CREATE OR REPLACE FUNCTION "check_hearing_without_judgment"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "case_judgment_facts" f WHERE f."case_id" = NEW."case_id"
    AND f."department_id" = NEW."department_id" AND f."trial_round_id" =
      (SELECT ar."trial_round_id" FROM "case_hearing_arrangements" ar WHERE ar."id" = NEW."new_arrangement_id")) THEN
    RAISE EXCEPTION 'hearing correction after current-round judgment' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;

-- Audit actor path remains the pre-CAS source stage for lawyer writes.
DO $migration$
DECLARE old_definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO old_definition FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname = 'enforce_case_client_mailing_actor_path'
      AND p.pronargs = 0 AND p.prorettype = 'trigger'::regtype;
  IF old_definition IS NULL OR position('WHEN ''case.judgment.next_step'' THEN ''WAITING_JUDGMENT''' IN old_definition) = 0 OR
     position('WHEN ''case.second_instance.save'' THEN ''SECOND_INSTANCE''' IN old_definition) <> 0 THEN
    RAISE EXCEPTION 'unknown lawyer audit actor path definition' USING ERRCODE = '23514';
  END IF;
  old_definition := replace(old_definition,
    'WHEN ''case.judgment.next_step'' THEN ''WAITING_JUDGMENT''',
    'WHEN ''case.judgment.next_step'' THEN ''WAITING_JUDGMENT''' || E'\n          ' ||
    'WHEN ''case.second_instance.save'' THEN ''SECOND_INSTANCE''' || E'\n          ' ||
    'WHEN ''case.second_instance.result'' THEN ''SECOND_INSTANCE''');
  EXECUTE old_definition;
END; $migration$;

CREATE OR REPLACE FUNCTION "reject_case_judgment_audit_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."action" IN ('case.judgment.registered', 'case.judgment.corrected', 'case.judgment.next_step',
      'case.judgment.next_step.revoke', 'case.second_instance.save', 'case.second_instance.result',
      'case.second_instance.result.revoke') OR
     (TG_OP = 'UPDATE' AND NEW."action" IN ('case.judgment.registered', 'case.judgment.corrected',
      'case.judgment.next_step', 'case.judgment.next_step.revoke', 'case.second_instance.save',
      'case.second_instance.result', 'case.second_instance.result.revoke')) THEN
    RAISE EXCEPTION 'judgment/second-instance audit is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER "case_second_instance_progresses_immutable" BEFORE UPDATE OR DELETE ON "case_second_instance_progresses"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE TRIGGER "case_second_instance_progress_versions_immutable" BEFORE UPDATE OR DELETE ON "case_second_instance_progress_versions"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE TRIGGER "case_second_instance_results_immutable" BEFORE UPDATE OR DELETE ON "case_second_instance_results"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE TRIGGER "case_second_instance_result_versions_immutable" BEFORE UPDATE OR DELETE ON "case_second_instance_result_versions"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE TRIGGER "case_second_instance_result_revocations_immutable" BEFORE UPDATE OR DELETE ON "case_second_instance_result_revocations"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE TRIGGER "case_second_instance_receipts_immutable" BEFORE UPDATE OR DELETE ON "case_second_instance_receipts"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();

CREATE FUNCTION "check_case_second_instance_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; c record; choice_record record; source_result record;
        prior_progress record; prior_result record; last_revocation record; expected_from integer; accepted_date date;
BEGIN
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id" = target_case AND "department_id" = target_department;
  IF c."current_second_instance_progress_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "case_second_instance_progresses" p WHERE p."id" = c."current_second_instance_progress_id"
      AND p."case_id" = target_case AND p."department_id" = target_department
      AND p."trial_round_id" = c."current_trial_round_id" AND p."choice_id" = c."current_judgment_next_step_id") THEN
    RAISE EXCEPTION 'second-instance current progress pointer mismatch' USING ERRCODE = '23514';
  END IF;
  IF c."current_second_instance_result_id" IS NOT NULL THEN
    SELECT s.*, v."id" AS revocation_id INTO source_result FROM "case_second_instance_results" s
      LEFT JOIN "case_second_instance_result_revocations" v ON v."result_id" = s."id"
      WHERE s."id" = c."current_second_instance_result_id" AND s."case_id" = target_case
        AND s."department_id" = target_department;
    IF source_result."id" IS NULL OR source_result.revocation_id IS NOT NULL OR
       (source_result."result" = 'REMAND' AND (c."stage" <> 'WAITING_FORMAL_ACCEPTANCE' OR
         NOT EXISTS (SELECT 1 FROM "case_trial_rounds" child WHERE child."id" = c."current_trial_round_id"
           AND child."source_result_id" = source_result."id" AND child."revoked_at" IS NULL))) OR
       (source_result."result" <> 'REMAND' AND (c."stage" <> 'WAITING_EXECUTION_DOCUMENTS' OR
         source_result."trial_round_id" <> c."current_trial_round_id")) THEN
      RAISE EXCEPTION 'second-instance current result pointer mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'case_second_instance_progresses' THEN
    SELECT s."id", s."to_version" INTO choice_record FROM "case_judgment_next_steps" s
      WHERE s."id" = NEW."choice_id" AND s."case_id" = target_case AND s."department_id" = target_department
        AND s."trial_round_id" = NEW."trial_round_id" AND s."next" = 'APPEAL'
        AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_step_revocations" v WHERE v."choice_id" = s."id");
    SELECT p."id", p."to_version" INTO prior_progress FROM "case_second_instance_progresses" p
      WHERE p."case_id" = target_case AND p."department_id" = target_department
        AND p."trial_round_id" = NEW."trial_round_id" AND p."choice_id" = NEW."choice_id"
        AND p."id" <> NEW."id" ORDER BY p."to_version" DESC LIMIT 1;
    SELECT v."to_version" INTO last_revocation FROM "case_second_instance_result_revocations" v
      JOIN "case_second_instance_results" s ON s."id" = v."result_id"
      WHERE s."case_id" = target_case AND s."department_id" = target_department
        AND s."trial_round_id" = NEW."trial_round_id" AND s."choice_id" = NEW."choice_id"
      ORDER BY v."to_version" DESC LIMIT 1;
    expected_from := greatest(coalesce(choice_record."to_version", 0), coalesce(prior_progress."to_version", 0),
      coalesce(last_revocation."to_version", 0));
    IF choice_record."id" IS NULL OR NEW."prior_progress_id" IS DISTINCT FROM prior_progress."id" OR
       NEW."from_version" <> expected_from OR
       (c."current_trial_round_id" <> NEW."trial_round_id" AND NOT EXISTS (
         SELECT 1 FROM "case_second_instance_results" s WHERE s."trial_round_id" = NEW."trial_round_id"
           AND s."progress_id" = NEW."id" AND s."result" = 'REMAND' AND
           c."current_second_instance_result_id" = s."id")) OR
       (c."current_trial_round_id" = NEW."trial_round_id" AND c."current_second_instance_progress_id" IS DISTINCT FROM NEW."id") OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = target_department AND a."resource_type" = 'CASE' AND a."resource_id" = target_case
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = 'case.second_instance.save' AND a."details"->>'progressId' = NEW."id"::text
         AND a."details"->>'trialRoundId' = NEW."trial_round_id"::text
         AND a."details"->>'choiceId' = NEW."choice_id"::text
         AND a."details"->>'priorProgressId' IS NOT DISTINCT FROM NEW."prior_progress_id"::text
         AND a."details"->>'fromVersion' = NEW."from_version"::text
         AND a."details"->>'toVersion' = NEW."to_version"::text
         AND a."details"->>'hearingAt' IS NOT DISTINCT FROM NEW."hearing_at"::text
         AND a."details"->>'hearingPlace' IS NOT DISTINCT FROM NEW."hearing_place"
         AND a."details"->>'judgeName' IS NOT DISTINCT FROM NEW."judge_name") OR
       NOT EXISTS (SELECT 1 FROM "case_second_instance_receipts" r WHERE r."case_id" = target_case
         AND r."department_id" = target_department AND r."actor_user_id" = NEW."recorded_by_user_id"
         AND r."action" IN ('SAVE', 'RESULT') AND r."result_snapshot"->>'progressId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'second-instance progress chain/audit/receipt mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'case_second_instance_results' THEN
    SELECT s."id", s."judgment_id", s."to_version", s."trial_round_id" INTO choice_record
      FROM "case_judgment_next_steps" s WHERE s."id" = NEW."choice_id" AND s."case_id" = target_case
        AND s."department_id" = target_department AND s."trial_round_id" = NEW."trial_round_id"
        AND s."next" = 'APPEAL' AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_step_revocations" v WHERE v."choice_id" = s."id");
    SELECT a."accepted_at" INTO accepted_date FROM "case_acceptances" a WHERE a."case_id" = target_case
      AND a."department_id" = target_department AND a."trial_round_id" = NEW."trial_round_id";
    SELECT p."id", p."to_version" INTO prior_progress FROM "case_second_instance_progresses" p
      WHERE p."case_id" = target_case AND p."department_id" = target_department
        AND p."trial_round_id" = NEW."trial_round_id" AND p."choice_id" = NEW."choice_id"
      ORDER BY p."to_version" DESC LIMIT 1;
    SELECT v."to_version" INTO last_revocation FROM "case_second_instance_result_revocations" v
      JOIN "case_second_instance_results" s ON s."id" = v."result_id"
      WHERE s."case_id" = target_case AND s."department_id" = target_department
        AND s."trial_round_id" = NEW."trial_round_id" AND s."choice_id" = NEW."choice_id"
      ORDER BY v."to_version" DESC LIMIT 1;
    expected_from := greatest(coalesce(choice_record."to_version", 0), coalesce(prior_progress."to_version", 0),
      coalesce(last_revocation."to_version", 0));
    IF choice_record."id" IS NULL OR NEW."judgment_id" IS DISTINCT FROM choice_record."judgment_id" OR
       NEW."progress_id" IS DISTINCT FROM prior_progress."id" OR NEW."from_version" <> expected_from OR
       accepted_date IS NULL OR NEW."result_received_at" < accepted_date OR
       NEW."result_received_at" > (NEW."recorded_at" AT TIME ZONE 'Asia/Shanghai')::date OR
       c."current_second_instance_result_id" IS DISTINCT FROM NEW."id" OR
       (NEW."result" = 'AFFIRM' AND NOT EXISTS (SELECT 1 FROM "case_judgment_facts" j
         WHERE j."id" = NEW."judgment_id" AND j."judgment_amount_state" = NEW."judgment_amount_state"
           AND j."judgment_amount" IS NOT DISTINCT FROM NEW."judgment_amount")) OR
       (NEW."result" = 'REMAND' AND NOT EXISTS (SELECT 1 FROM "case_trial_rounds" child
         WHERE child."source_result_id" = NEW."id" AND child."id" = c."current_trial_round_id")) OR
       (NEW."result" <> 'REMAND' AND c."current_trial_round_id" <> NEW."trial_round_id") OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = target_department AND a."resource_type" = 'CASE' AND a."resource_id" = target_case
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = 'case.second_instance.result' AND a."details"->>'resultId' = NEW."id"::text
         AND a."details"->>'trialRoundId' = NEW."trial_round_id"::text
         AND a."details"->>'choiceId' = NEW."choice_id"::text
         AND a."details"->>'judgmentId' = NEW."judgment_id"::text
         AND a."details"->>'progressId' IS NOT DISTINCT FROM NEW."progress_id"::text
         AND a."details"->>'result' = NEW."result"::text
         AND a."details"->>'resultReceivedAt' = NEW."result_received_at"::text
         AND a."details"->>'judgmentAmountState' IS NOT DISTINCT FROM NEW."judgment_amount_state"::text
         AND a."details"->>'judgmentAmount' IS NOT DISTINCT FROM NEW."judgment_amount"::text
         AND a."details"->>'paidLitigationFeeState' = NEW."paid_litigation_fee_state"::text
         AND a."details"->>'paidLitigationFee' IS NOT DISTINCT FROM NEW."paid_litigation_fee"::text
         AND a."details"->>'fromVersion' = NEW."from_version"::text
         AND a."details"->>'toVersion' = NEW."to_version"::text) OR
       NOT EXISTS (SELECT 1 FROM "case_second_instance_receipts" r WHERE r."case_id" = target_case
         AND r."department_id" = target_department AND r."actor_user_id" = NEW."recorded_by_user_id"
         AND r."action" = 'RESULT' AND r."result_snapshot"->>'resultId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'second-instance result source/audit/receipt mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'case_second_instance_result_revocations' THEN
    SELECT s.* INTO source_result FROM "case_second_instance_results" s WHERE s."id" = NEW."result_id"
      AND s."case_id" = target_case AND s."department_id" = target_department;
    IF source_result."id" IS NULL OR NEW."from_version" <> c."version" - 1 OR
       c."current_second_instance_result_id" IS NOT NULL OR c."stage" <> 'SECOND_INSTANCE' OR
       c."current_trial_round_id" <> source_result."trial_round_id" OR
       c."current_second_instance_progress_id" IS DISTINCT FROM source_result."progress_id" OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = target_department AND a."resource_type" = 'CASE' AND a."resource_id" = target_case
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."internal_actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = 'case.second_instance.result.revoke'
         AND a."details"->>'resultId' = NEW."result_id"::text
         AND a."details"->>'revocationId' = NEW."id"::text
         AND a."details"->>'reason' = NEW."reason"
         AND a."details"->>'fromVersion' = NEW."from_version"::text
         AND a."details"->>'toVersion' = NEW."to_version"::text) OR
       NOT EXISTS (SELECT 1 FROM "case_second_instance_receipts" r WHERE r."case_id" = target_case
         AND r."department_id" = target_department AND r."actor_user_id" = NEW."recorded_by_user_id"
         AND r."action" = 'REVOKE' AND r."result_snapshot"->>'revocationId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'second-instance result revocation mismatch' USING ERRCODE = '23514';
    END IF;
    IF source_result."result" = 'REMAND' AND NOT EXISTS (SELECT 1 FROM "case_trial_rounds" child
      WHERE child."source_result_id" = source_result."id" AND child."revoked_at" = NEW."recorded_at"
        AND NOT EXISTS (SELECT 1 FROM "case_acceptances" a WHERE a."trial_round_id" = child."id")
        AND NOT EXISTS (SELECT 1 FROM "case_hearing_arrangements" h WHERE h."trial_round_id" = child."id")
        AND NOT EXISTS (SELECT 1 FROM "case_judgment_facts" j WHERE j."trial_round_id" = child."id")) THEN
      RAISE EXCEPTION 'remand child not empty/revoked' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE CONSTRAINT TRIGGER "case_second_instance_case_guard" AFTER UPDATE OF "stage", "version", "current_trial_round_id",
  "current_second_instance_progress_id", "current_second_instance_result_id" ON "cases"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_second_instance_final"();
CREATE CONSTRAINT TRIGGER "case_second_instance_progress_guard" AFTER INSERT ON "case_second_instance_progresses"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_second_instance_final"();
CREATE CONSTRAINT TRIGGER "case_second_instance_result_guard" AFTER INSERT ON "case_second_instance_results"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_second_instance_final"();
CREATE CONSTRAINT TRIGGER "case_second_instance_revoke_guard" AFTER INSERT ON "case_second_instance_result_revocations"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_second_instance_final"();

CREATE FUNCTION "check_case_second_instance_version"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected_ids jsonb; expected_category "material_category"; fact_audit uuid;
BEGIN
  IF TG_TABLE_NAME = 'case_second_instance_progress_versions' THEN
    SELECT p."audit_event_id", NEW."category", CASE WHEN NEW."category" = 'SECOND_INSTANCE_DOCUMENT'
      THEN a."details"->'documentContentVersionIds' ELSE a."details"->'serviceContentVersionIds' END
      INTO fact_audit, expected_category, selected_ids
      FROM "case_second_instance_progresses" p JOIN "audit_events" a ON a."id" = p."audit_event_id"
      WHERE p."id" = NEW."progress_id" AND p."case_id" = NEW."case_id" AND p."department_id" = NEW."department_id"
      FOR UPDATE OF p;
  ELSE
    expected_category := 'SECOND_INSTANCE_JUDGMENT';
    SELECT s."audit_event_id", a."details"->'judgmentContentVersionIds' INTO fact_audit, selected_ids
      FROM "case_second_instance_results" s JOIN "audit_events" a ON a."id" = s."audit_event_id"
      WHERE s."id" = NEW."result_id" AND s."case_id" = NEW."case_id" AND s."department_id" = NEW."department_id"
      FOR UPDATE OF s;
  END IF;
  IF fact_audit IS NULL OR jsonb_typeof(selected_ids) IS DISTINCT FROM 'array' OR
     NOT selected_ids ? NEW."content_version_id"::text OR
     NOT EXISTS (SELECT 1 FROM "materials" m JOIN "content_versions" v ON v."material_id" = m."id"
       WHERE m."id" = NEW."material_id" AND v."id" = NEW."content_version_id"
         AND m."department_id" = NEW."department_id" AND m."owner_type" = 'CASE' AND m."owner_id" = NEW."case_id"
         AND m."category" = expected_category AND m."purpose"::text = expected_category::text
         AND m."status" = 'ACTIVE' AND v."status" = 'AVAILABLE'
         AND v."mime_type" IN ('application/pdf','image/jpeg','image/png')
         AND v."size_bytes" <= 52428800
         AND (m."current_version_id" = v."id" OR EXISTS (
           SELECT 1 FROM "case_second_instance_progress_versions" old
           WHERE old."case_id" = NEW."case_id" AND old."department_id" = NEW."department_id"
             AND old."material_id" = m."id" AND old."content_version_id" = v."id") OR EXISTS (
           SELECT 1 FROM "case_second_instance_result_versions" old
           WHERE old."case_id" = NEW."case_id" AND old."department_id" = NEW."department_id"
             AND old."material_id" = m."id" AND old."content_version_id" = v."id"))) THEN
    RAISE EXCEPTION 'second-instance frozen version mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_second_instance_progress_versions_guard" BEFORE INSERT ON "case_second_instance_progress_versions"
  FOR EACH ROW EXECUTE FUNCTION "check_case_second_instance_version"();
CREATE TRIGGER "case_second_instance_result_versions_guard" BEFORE INSERT ON "case_second_instance_result_versions"
  FOR EACH ROW EXECUTE FUNCTION "check_case_second_instance_version"();

CREATE FUNCTION "check_case_second_instance_reference"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fact_id uuid; is_progress boolean;
BEGIN
  IF NEW."purpose" NOT IN ('SECOND_INSTANCE_DOCUMENT','SECOND_INSTANCE_SERVICE','SECOND_INSTANCE_JUDGMENT') THEN RETURN NEW; END IF;
  IF NEW."resource_type" <> 'case' THEN
    RAISE EXCEPTION 'second-instance reference must be a case' USING ERRCODE = '23514';
  END IF;
  is_progress := NEW."purpose" <> 'SECOND_INSTANCE_JUDGMENT';
  IF is_progress THEN
    SELECT p."id" INTO fact_id FROM "case_second_instance_progresses" p
      WHERE p."case_id" = NEW."resource_id" AND p."department_id" = NEW."department_id"
        AND p."audit_event_id" = NEW."action_event_id" FOR UPDATE OF p;
    IF fact_id IS NULL OR NOT EXISTS (SELECT 1 FROM "case_second_instance_progress_versions" v
      WHERE v."progress_id" = fact_id AND v."case_id" = NEW."resource_id" AND v."department_id" = NEW."department_id"
        AND v."category"::text = NEW."purpose" AND v."material_id" = NEW."material_id"
        AND v."content_version_id" = NEW."content_version_id") THEN
      RAISE EXCEPTION 'second-instance progress reference mismatch' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT s."id" INTO fact_id FROM "case_second_instance_results" s
      WHERE s."case_id" = NEW."resource_id" AND s."department_id" = NEW."department_id"
        AND s."audit_event_id" = NEW."action_event_id" FOR UPDATE OF s;
    IF fact_id IS NULL OR NOT EXISTS (SELECT 1 FROM "case_second_instance_result_versions" v
      WHERE v."result_id" = fact_id AND v."case_id" = NEW."resource_id" AND v."department_id" = NEW."department_id"
        AND v."material_id" = NEW."material_id" AND v."content_version_id" = NEW."content_version_id") THEN
      RAISE EXCEPTION 'second-instance result reference mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_second_instance_material_reference_guard" BEFORE INSERT ON "material_references"
  FOR EACH ROW EXECUTE FUNCTION "check_case_second_instance_reference"();

CREATE FUNCTION "check_case_second_instance_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fact record; selected_docs jsonb; selected_services jsonb; selected_judgments jsonb; expected_stage text;
BEGIN
  IF NEW."action" = 'SAVE' THEN
    SELECT p.*, a."details"->'documentContentVersionIds' AS docs,
      a."details"->'serviceContentVersionIds' AS services INTO fact
      FROM "case_second_instance_progresses" p JOIN "audit_events" a ON a."id" = p."audit_event_id"
      WHERE p."id" = (NEW."result_snapshot"->>'progressId')::uuid AND p."case_id" = NEW."case_id"
        AND p."department_id" = NEW."department_id" AND p."recorded_by_user_id" = NEW."actor_user_id"
        AND a."details"->>'sourceAction' = 'SAVE';
    IF fact."id" IS NULL THEN
      -- A blank first save or an unchanged repeat is intentionally receipt-only.
      IF NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id" = NEW."case_id" AND c."department_id" = NEW."department_id"
        AND c."stage" = 'SECOND_INSTANCE' AND c."version" = (NEW."result_snapshot"->>'version')::integer
        AND c."current_trial_round_id"::text = NEW."result_snapshot"->>'currentTrialRoundId'
        AND c."current_second_instance_progress_id"::text IS NOT DISTINCT FROM NEW."result_snapshot"->>'progressId') OR
        NEW."result_snapshot"->>'resultId' IS NOT NULL THEN
        RAISE EXCEPTION 'unchanged second-instance save receipt mismatch' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    selected_docs := fact.docs; selected_services := fact.services;
    IF NEW."result_snapshot"->>'version' IS DISTINCT FROM fact."to_version"::text OR
       NEW."result_snapshot"->>'resultId' IS NOT NULL OR
       jsonb_typeof(selected_docs) IS DISTINCT FROM 'array' OR jsonb_typeof(selected_services) IS DISTINCT FROM 'array' OR
       (SELECT count(*) FROM "case_second_instance_progress_versions" v WHERE v."progress_id" = fact."id") <>
         jsonb_array_length(selected_docs) + jsonb_array_length(selected_services) OR
       EXISTS (SELECT 1 FROM "case_second_instance_progress_versions" v WHERE v."progress_id" = fact."id" AND NOT EXISTS (
         SELECT 1 FROM "material_references" r WHERE r."action_event_id" = fact."audit_event_id"
           AND r."resource_type" = 'case' AND r."resource_id" = NEW."case_id"
           AND r."purpose" = v."category"::text AND r."material_id" = v."material_id"
           AND r."content_version_id" = v."content_version_id")) THEN
      RAISE EXCEPTION 'second-instance save frozen set mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."action" = 'RESULT' THEN
    SELECT s.*, a."details"->'judgmentContentVersionIds' AS judgments INTO fact
      FROM "case_second_instance_results" s JOIN "audit_events" a ON a."id" = s."audit_event_id"
      WHERE s."id" = (NEW."result_snapshot"->>'resultId')::uuid AND s."case_id" = NEW."case_id"
        AND s."department_id" = NEW."department_id" AND s."recorded_by_user_id" = NEW."actor_user_id";
    selected_judgments := fact.judgments;
    expected_stage := CASE WHEN fact."result" = 'REMAND' THEN 'WAITING_FORMAL_ACCEPTANCE' ELSE 'WAITING_EXECUTION_DOCUMENTS' END;
    IF fact."id" IS NULL OR jsonb_typeof(selected_judgments) IS DISTINCT FROM 'array' OR
       jsonb_array_length(selected_judgments) NOT BETWEEN 1 AND 10 OR
       NEW."result_snapshot"->>'version' IS DISTINCT FROM fact."to_version"::text OR
       NEW."result_snapshot"->>'progressId' IS DISTINCT FROM fact."progress_id"::text OR
       NEW."result_snapshot"->>'stage' IS DISTINCT FROM expected_stage OR
       (SELECT count(*) FROM "case_second_instance_result_versions" v WHERE v."result_id" = fact."id") <>
         jsonb_array_length(selected_judgments) OR
       EXISTS (SELECT 1 FROM "case_second_instance_result_versions" v WHERE v."result_id" = fact."id" AND NOT EXISTS (
         SELECT 1 FROM "material_references" r WHERE r."action_event_id" = fact."audit_event_id"
           AND r."resource_type" = 'case' AND r."resource_id" = NEW."case_id"
           AND r."purpose" = 'SECOND_INSTANCE_JUDGMENT' AND r."material_id" = v."material_id"
           AND r."content_version_id" = v."content_version_id")) THEN
      RAISE EXCEPTION 'second-instance result frozen set mismatch' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT v.* INTO fact FROM "case_second_instance_result_revocations" v
      WHERE v."id" = (NEW."result_snapshot"->>'revocationId')::uuid AND v."case_id" = NEW."case_id"
        AND v."department_id" = NEW."department_id" AND v."recorded_by_user_id" = NEW."actor_user_id";
    IF fact."id" IS NULL OR NEW."result_snapshot"->>'version' IS DISTINCT FROM fact."to_version"::text OR
       NEW."result_snapshot"->>'stage' IS DISTINCT FROM 'SECOND_INSTANCE' OR
       NEW."result_snapshot"->>'resultId' IS NOT NULL THEN
      RAISE EXCEPTION 'second-instance revoke receipt mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."result_snapshot"->>'id' IS DISTINCT FROM NEW."case_id"::text OR
     (NEW."result_snapshot"->>'recordedAt')::timestamptz IS DISTINCT FROM fact."recorded_at" THEN
    RAISE EXCEPTION 'second-instance receipt identity/time mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_second_instance_receipt_guard" BEFORE INSERT ON "case_second_instance_receipts"
  FOR EACH ROW EXECUTE FUNCTION "check_case_second_instance_receipt"();

COMMIT;
