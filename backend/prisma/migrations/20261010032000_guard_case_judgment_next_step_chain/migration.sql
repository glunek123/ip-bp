BEGIN;

-- Preserve the CA-008 checks while allowing only an evidenced choice/revocation
-- interval after the current judgment. Old receipt snapshots are never changed.
CREATE OR REPLACE FUNCTION "check_case_judgment_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; current_record record; latest_id uuid; latest_version integer;
        root_count integer; fact_count integer; expected_version integer; expected_stage text;
        latest_choice record; latest_revoke record;
BEGIN
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT c."id", c."stage", c."version", c."current_judgment_id", c."current_judgment_next_step_id"
    INTO current_record FROM "cases" c WHERE c."id" = target_case AND c."department_id" = target_department;
  SELECT count(*), count(*) FILTER (WHERE "kind" = 'REGISTER') INTO fact_count, root_count
    FROM "case_judgment_facts" WHERE "case_id" = target_case AND "department_id" = target_department;
  IF fact_count = 0 THEN
    IF current_record."current_judgment_id" IS NOT NULL OR current_record."current_judgment_next_step_id" IS NOT NULL OR
       current_record."stage" IN ('SECOND_INSTANCE', 'WAITING_EXECUTION_DOCUMENTS') THEN
      RAISE EXCEPTION 'judgment pointer or later stage without fact' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT f."id", f."to_version" INTO latest_id, latest_version FROM "case_judgment_facts" f
    WHERE f."case_id" = target_case AND f."department_id" = target_department
    ORDER BY f."to_version" DESC LIMIT 1;
  SELECT s."id", s."judgment_id", s."next", s."to_version" INTO latest_choice
    FROM "case_judgment_next_steps" s WHERE s."case_id" = target_case AND s."department_id" = target_department
    ORDER BY s."to_version" DESC LIMIT 1;
  expected_version := latest_version;
  IF latest_choice."id" IS NOT NULL THEN
    SELECT r."id", r."to_version" INTO latest_revoke FROM "case_judgment_next_step_revocations" r
      WHERE r."choice_id" = latest_choice."id" AND r."case_id" = target_case AND r."department_id" = target_department;
    IF latest_revoke."id" IS NULL THEN
      expected_stage := CASE WHEN latest_choice."next" = 'APPEAL' THEN 'SECOND_INSTANCE' ELSE 'WAITING_EXECUTION_DOCUMENTS' END;
      IF current_record."current_judgment_next_step_id" IS DISTINCT FROM latest_choice."id" OR
         current_record."current_judgment_id" IS DISTINCT FROM latest_choice."judgment_id" OR
         current_record."stage"::text IS DISTINCT FROM expected_stage OR
         current_record."version" IS DISTINCT FROM latest_choice."to_version" THEN
        RAISE EXCEPTION 'active judgment choice mismatch' USING ERRCODE = '23514';
      END IF;
    ELSE
      expected_version := greatest(expected_version, latest_revoke."to_version");
      IF current_record."current_judgment_next_step_id" IS NOT NULL OR current_record."stage" <> 'WAITING_JUDGMENT' OR
         current_record."version" <> expected_version THEN
        RAISE EXCEPTION 'revoked judgment choice mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF current_record."current_judgment_next_step_id" IS NOT NULL OR current_record."stage" <> 'WAITING_JUDGMENT' OR
        current_record."version" <> expected_version THEN
    RAISE EXCEPTION 'judgment case stage or version mismatch' USING ERRCODE = '23514';
  END IF;
  IF root_count <> 1 OR current_record."current_judgment_id" IS DISTINCT FROM latest_id THEN
    RAISE EXCEPTION 'judgment chain head mismatch' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'case_judgment_facts' THEN
    IF NEW."judgment_received_at" < (SELECT "accepted_at" FROM "case_acceptances" WHERE "case_id" = target_case AND "department_id" = target_department) OR
       NEW."judgment_received_at" > (NEW."recorded_at" AT TIME ZONE 'Asia/Shanghai')::date OR
       (NEW."kind" = 'REGISTER' AND NEW."prior_fact_id" IS NOT NULL) OR
       (NEW."kind" = 'CORRECT' AND NOT EXISTS (
         SELECT 1 FROM "case_judgment_facts" prior WHERE prior."id" = NEW."prior_fact_id"
           AND prior."case_id" = NEW."case_id" AND prior."department_id" = NEW."department_id"
           AND prior."id" = (SELECT f."id" FROM "case_judgment_facts" f
             WHERE f."case_id" = NEW."case_id" AND f."department_id" = NEW."department_id" AND f."id" <> NEW."id"
             ORDER BY f."to_version" DESC LIMIT 1)
           AND (prior."to_version" = NEW."from_version" OR EXISTS (
             SELECT 1 FROM "case_judgment_next_step_revocations" r
             JOIN "case_judgment_next_steps" s ON s."id" = r."choice_id"
             WHERE s."judgment_id" = prior."id" AND s."case_id" = NEW."case_id"
               AND s."department_id" = NEW."department_id" AND r."to_version" = NEW."from_version"
               AND r."to_version" = (SELECT max(x."to_version") FROM "case_judgment_next_step_revocations" x WHERE x."case_id" = NEW."case_id")
           )))) OR
       NOT EXISTS (
         SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
           AND a."department_id" = NEW."department_id" AND a."resource_type" = 'CASE' AND a."resource_id" = NEW."case_id"
           AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
           AND a."action" = CASE WHEN NEW."kind" = 'REGISTER' THEN 'case.judgment.registered' ELSE 'case.judgment.corrected' END
           AND a."details"->>'judgmentId' = NEW."id"::text
           AND a."details"->>'fromVersion' = NEW."from_version"::text
           AND a."details"->>'toVersion' = NEW."to_version"::text
           AND a."details"->>'judgmentReceivedAt' = NEW."judgment_received_at"::text
           AND a."details"->>'judgmentAmountState' = NEW."judgment_amount_state"::text
           AND a."details"->>'judgmentAmount' IS NOT DISTINCT FROM NEW."judgment_amount"::text
           AND a."details"->>'paidLitigationFeeState' = NEW."paid_litigation_fee_state"::text
           AND a."details"->>'paidLitigationFee' IS NOT DISTINCT FROM NEW."paid_litigation_fee"::text
           AND a."details"->>'priorFactId' IS NOT DISTINCT FROM NEW."prior_fact_id"::text
           AND a."details"->>'reason' IS NOT DISTINCT FROM NEW."reason"
       ) OR NOT EXISTS (
         SELECT 1 FROM "case_judgment_receipts" r WHERE r."case_id" = NEW."case_id"
           AND r."department_id" = NEW."department_id" AND r."actor_user_id" = NEW."recorded_by_user_id"
           AND r."action" = NEW."kind" AND r."result_snapshot"->>'judgmentId' = NEW."id"::text
       ) THEN
      RAISE EXCEPTION 'judgment fact or audit mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "check_case_judgment_next_step_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; choice_record record; case_record record;
        latest_prior_id uuid; latest_prior_revoked_to integer; expected_from integer; judgment_version integer;
BEGIN
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT c."stage", c."version", c."current_judgment_id", c."current_judgment_next_step_id", c."rights_holder_id"
    INTO case_record FROM "cases" c WHERE c."id" = target_case AND c."department_id" = target_department;
  IF case_record."stage" IN ('SECOND_INSTANCE', 'WAITING_EXECUTION_DOCUMENTS') AND case_record."current_judgment_next_step_id" IS NULL THEN
    RAISE EXCEPTION 'advanced stage requires current choice' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'case_judgment_next_steps' THEN
    SELECT f."to_version" INTO judgment_version FROM "case_judgment_facts" f
      WHERE f."id" = NEW."judgment_id" AND f."case_id" = target_case AND f."department_id" = target_department;
    SELECT s."id", r."to_version" INTO latest_prior_id, latest_prior_revoked_to
      FROM "case_judgment_next_steps" s LEFT JOIN "case_judgment_next_step_revocations" r ON r."choice_id" = s."id"
      WHERE s."case_id" = target_case AND s."department_id" = target_department AND s."id" <> NEW."id"
      ORDER BY s."to_version" DESC LIMIT 1;
    expected_from := greatest(judgment_version, coalesce(latest_prior_revoked_to, 0));
    IF judgment_version IS NULL OR (latest_prior_id IS NOT NULL AND latest_prior_revoked_to IS NULL) OR
       NEW."from_version" <> expected_from OR
       NEW."judgment_id" IS DISTINCT FROM case_record."current_judgment_id" OR
       (NEW."next" = 'APPEAL' AND NEW."plaintiff_rights_holder_id" IS NULL AND NOT EXISTS (
         SELECT 1 FROM "case_judgment_appeal_defendants" d WHERE d."choice_id" = NEW."id")) OR
       (NEW."next" = 'EXECUTION' AND EXISTS (
         SELECT 1 FROM "case_judgment_appeal_defendants" d WHERE d."choice_id" = NEW."id")) OR
       (NEW."plaintiff_rights_holder_id" IS NOT NULL AND NEW."plaintiff_rights_holder_id" <> case_record."rights_holder_id") OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = target_department AND a."resource_type" = 'CASE' AND a."resource_id" = target_case
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = 'case.judgment.next_step' AND a."details"->>'choiceId' = NEW."id"::text
         AND a."details"->>'judgmentId' = NEW."judgment_id"::text AND a."details"->>'next' = NEW."next"::text
         AND a."details"->>'fromVersion' = NEW."from_version"::text AND a."details"->>'toVersion' = NEW."to_version"::text
         AND (a."details"->>'plaintiffAppeals')::boolean = (NEW."plaintiff_rights_holder_id" IS NOT NULL)
         AND (a."details"->>'executionReadinessConfirmed')::boolean = NEW."execution_readiness_confirmed"
         AND a."details"->'defendantIds' = (SELECT coalesce(jsonb_agg(d."defendant_id" ORDER BY d."defendant_id"), '[]'::jsonb)
            FROM "case_judgment_appeal_defendants" d WHERE d."choice_id" = NEW."id")) OR
       NOT EXISTS (SELECT 1 FROM "case_judgment_next_step_receipts" r WHERE r."case_id" = target_case
         AND r."department_id" = target_department AND r."actor_user_id" = NEW."recorded_by_user_id"
         AND r."action" = 'CHOOSE' AND r."result_snapshot"->>'choiceId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'judgment choice source, parties, audit or receipt mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'case_judgment_next_step_revocations' THEN
    SELECT s."id", s."judgment_id", s."to_version" INTO choice_record FROM "case_judgment_next_steps" s
      WHERE s."id" = NEW."choice_id" AND s."case_id" = target_case AND s."department_id" = target_department;
    IF choice_record."id" IS NULL OR NEW."from_version" <> choice_record."to_version" OR
       NEW."choice_id" <> (SELECT s."id" FROM "case_judgment_next_steps" s WHERE s."case_id" = target_case
         ORDER BY s."to_version" DESC LIMIT 1) OR
       case_record."current_judgment_id" IS DISTINCT FROM choice_record."judgment_id" OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = target_department AND a."resource_type" = 'CASE' AND a."resource_id" = target_case
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."internal_actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = 'case.judgment.next_step.revoke' AND a."details"->>'choiceId' = NEW."choice_id"::text
         AND a."details"->>'revocationId' = NEW."id"::text AND a."details"->>'reason' = NEW."reason"
         AND a."details"->>'fromVersion' = NEW."from_version"::text AND a."details"->>'toVersion' = NEW."to_version"::text) OR
       NOT EXISTS (SELECT 1 FROM "case_judgment_next_step_receipts" r WHERE r."case_id" = target_case
         AND r."department_id" = target_department AND r."actor_user_id" = NEW."recorded_by_user_id"
         AND r."action" = 'REVOKE' AND r."result_snapshot"->>'revocationId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'judgment choice revocation mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "case_judgment_next_step_case_guard"
  AFTER UPDATE OF "stage", "version", "current_judgment_id", "current_judgment_next_step_id" ON "cases"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_judgment_next_step_final"();
CREATE CONSTRAINT TRIGGER "case_judgment_next_step_fact_guard" AFTER INSERT ON "case_judgment_next_steps"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_judgment_next_step_final"();
CREATE CONSTRAINT TRIGGER "case_judgment_next_step_revoke_guard" AFTER INSERT ON "case_judgment_next_step_revocations"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_judgment_next_step_final"();

CREATE FUNCTION "check_case_judgment_appeal_defendant"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "case_judgment_next_steps" s JOIN "case_defendants" d
      ON d."id" = NEW."defendant_id" AND d."case_id" = s."case_id" AND d."department_id" = s."department_id"
    WHERE s."id" = NEW."choice_id" AND s."next" = 'APPEAL' AND d."name" = NEW."name_snapshot") THEN
    RAISE EXCEPTION 'appeal defendant snapshot mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "case_judgment_appeal_defendant_guard" BEFORE INSERT ON "case_judgment_appeal_defendants"
  FOR EACH ROW EXECUTE FUNCTION "check_case_judgment_appeal_defendant"();

CREATE FUNCTION "check_case_judgment_next_step_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_record record; expected_stage text;
BEGIN
  IF NEW."action" = 'CHOOSE' THEN
    SELECT s."id", s."judgment_id", s."to_version", s."recorded_at", s."recorded_by_user_id", s."next"
      INTO source_record FROM "case_judgment_next_steps" s
      WHERE s."id" = (NEW."result_snapshot"->>'choiceId')::uuid AND s."case_id" = NEW."case_id"
        AND s."department_id" = NEW."department_id";
    expected_stage := CASE WHEN source_record."next" = 'APPEAL' THEN 'SECOND_INSTANCE' ELSE 'WAITING_EXECUTION_DOCUMENTS' END;
    IF source_record."id" IS NULL OR NEW."result_snapshot"->>'stage' IS DISTINCT FROM expected_stage OR
       NEW."result_snapshot"->>'judgmentId' IS DISTINCT FROM source_record."judgment_id"::text THEN
      RAISE EXCEPTION 'choice receipt source mismatch' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT r."id", s."id" AS choice_id, s."judgment_id", r."to_version", r."recorded_at", r."recorded_by_user_id"
      INTO source_record FROM "case_judgment_next_step_revocations" r JOIN "case_judgment_next_steps" s ON s."id" = r."choice_id"
      WHERE r."id" = (NEW."result_snapshot"->>'revocationId')::uuid AND r."case_id" = NEW."case_id"
        AND r."department_id" = NEW."department_id";
    IF source_record."id" IS NULL OR NEW."result_snapshot"->>'stage' IS DISTINCT FROM 'WAITING_JUDGMENT' OR
       NEW."result_snapshot"->>'choiceId' IS DISTINCT FROM source_record.choice_id::text OR
       NEW."result_snapshot"->>'judgmentId' IS DISTINCT FROM source_record."judgment_id"::text THEN
      RAISE EXCEPTION 'revocation receipt source mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."result_snapshot"->>'id' IS DISTINCT FROM NEW."case_id"::text OR
     NEW."result_snapshot"->>'version' IS DISTINCT FROM source_record."to_version"::text OR
     (NEW."result_snapshot"->>'recordedAt')::timestamptz IS DISTINCT FROM source_record."recorded_at" OR
     NEW."actor_user_id" IS DISTINCT FROM source_record."recorded_by_user_id" THEN
    RAISE EXCEPTION 'judgment next step receipt mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "case_judgment_next_step_receipts_guard" BEFORE INSERT ON "case_judgment_next_step_receipts"
  FOR EACH ROW EXECUTE FUNCTION "check_case_judgment_next_step_receipt"();

CREATE TRIGGER "case_judgment_next_steps_immutable" BEFORE UPDATE OR DELETE ON "case_judgment_next_steps"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE TRIGGER "case_judgment_appeal_defendants_immutable" BEFORE UPDATE OR DELETE ON "case_judgment_appeal_defendants"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE TRIGGER "case_judgment_next_step_revocations_immutable" BEFORE UPDATE OR DELETE ON "case_judgment_next_step_revocations"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE TRIGGER "case_judgment_next_step_receipts_immutable" BEFORE UPDATE OR DELETE ON "case_judgment_next_step_receipts"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE OR REPLACE FUNCTION "reject_case_judgment_audit_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."action" IN ('case.judgment.registered', 'case.judgment.corrected', 'case.judgment.next_step', 'case.judgment.next_step.revoke') OR
     (TG_OP = 'UPDATE' AND NEW."action" IN ('case.judgment.registered', 'case.judgment.corrected', 'case.judgment.next_step', 'case.judgment.next_step.revoke')) THEN
    RAISE EXCEPTION 'judgment audit is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

COMMIT;
