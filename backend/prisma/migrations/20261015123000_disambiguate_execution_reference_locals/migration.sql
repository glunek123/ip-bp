BEGIN;

-- Keep both genuine execution-reference sources while avoiding a PL/pgSQL
-- variable name that collides with submission_id and confirmation_id columns.
CREATE OR REPLACE FUNCTION "check_case_execution_submission_reference"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_submission_id uuid; target_confirmation_id uuid;
BEGIN
  IF NEW."purpose"<>'EXECUTION_APPLICATION' THEN RETURN NEW; END IF;
  IF NEW."resource_type"<>'case' OR NEW."action_event_id" IS NULL THEN RAISE EXCEPTION 'execution reference source invalid' USING ERRCODE='23514'; END IF;
  SELECT s."id" INTO target_submission_id FROM "case_execution_submissions" s
    WHERE s."case_id"=NEW."resource_id" AND s."department_id"=NEW."department_id" AND s."audit_event_id"=NEW."action_event_id" FOR UPDATE OF s;
  SELECT c."id" INTO target_confirmation_id FROM "case_execution_confirmations" c
    WHERE c."case_id"=NEW."resource_id" AND c."department_id"=NEW."department_id" AND c."audit_event_id"=NEW."action_event_id"
      AND c."submission_id" IS NULL AND c."external_entry_id" IS NOT NULL FOR UPDATE OF c;
  IF ((target_submission_id IS NULL) = (target_confirmation_id IS NULL)) OR
    (target_submission_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_execution_submission_versions" v
      WHERE v."submission_id"=target_submission_id AND v."case_id"=NEW."resource_id" AND v."department_id"=NEW."department_id"
        AND v."material_id"=NEW."material_id" AND v."content_version_id"=NEW."content_version_id")) OR
    (target_submission_id IS NOT NULL AND EXISTS (SELECT 1 FROM "case_execution_submission_receipts" r
      WHERE r."case_id"=NEW."resource_id" AND r."department_id"=NEW."department_id" AND r."result_snapshot"->>'submissionId'=target_submission_id::text)) OR
    (target_confirmation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_execution_confirmation_versions" v
      WHERE v."confirmation_id"=target_confirmation_id AND v."case_id"=NEW."resource_id" AND v."department_id"=NEW."department_id"
        AND v."material_id"=NEW."material_id" AND v."content_version_id"=NEW."content_version_id")) OR
    (target_confirmation_id IS NOT NULL AND EXISTS (SELECT 1 FROM "case_execution_confirmation_receipts" r
      WHERE r."case_id"=NEW."resource_id" AND r."department_id"=NEW."department_id" AND r."result_snapshot"->>'confirmationId'=target_confirmation_id::text))
  THEN RAISE EXCEPTION 'execution reference mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

-- Preserve the post-152 source checks while isolating table-specific NEW fields
-- and disambiguating local case records from SQL table aliases.
CREATE OR REPLACE FUNCTION "check_case_hearing_fact"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM "case_external_entries" e WHERE e."case_id"=NEW."case_id" AND e."department_id"=NEW."department_id") THEN
    PERFORM ca018_assert_external_trial_round(NEW."case_id",NEW."department_id");
    IF TG_TABLE_NAME='case_hearing_arrangements' THEN
      IF NOT EXISTS (
      SELECT 1 FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id"
        AND c."current_trial_round_id"=NEW."trial_round_id" AND NEW."external_entry_id"=(SELECT e."id" FROM "case_external_entries" e WHERE e."case_id"=c."id")
        AND NEW."from_version"=c."version"-1) THEN
        RAISE EXCEPTION 'external hearing schedule source/version mismatch' USING ERRCODE='23514';
      END IF;
    END IF;
    IF TG_TABLE_NAME='case_hearing_advances' THEN
      IF NOT EXISTS (
      SELECT 1 FROM "case_hearing_arrangements" ar WHERE ar."id"=NEW."arrangement_id"
        AND ar."trial_round_id"=NEW."trial_round_id" AND ar."external_entry_id"=NEW."external_entry_id") THEN
        RAISE EXCEPTION 'external hearing advance source mismatch' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'case_hearing_arrangements' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "cases" c LEFT JOIN "case_acceptances" ac ON ac."case_id" = c."id" AND ac."department_id" = c."department_id"
        AND ac."trial_round_id" = NEW."trial_round_id"
      LEFT JOIN "case_external_entries" e ON e."case_id"=c."id" AND e."department_id"=c."department_id"
      WHERE c."id" = NEW."case_id" AND c."department_id" = NEW."department_id"
        AND c."current_hearing_arrangement_id" = NEW."id" AND c."version" = NEW."to_version"
        AND c."stage" IN ('WAITING_HEARING', 'WAITING_JUDGMENT')
        AND (c."source_lead_id" IS NOT NULL AND ac."id" IS NOT NULL OR
          e."id" IS NOT NULL AND NEW."external_entry_id"=e."id" AND
          (ac."id" IS NOT NULL OR (e."initial_stage"='WAITING_HEARING' AND
             NOT EXISTS (SELECT 1 FROM "case_acceptances" actual WHERE actual."trial_round_id"=NEW."trial_round_id"))))
        AND (NEW."hearing_at" IS NULL OR
          (ac."id" IS NOT NULL AND NEW."hearing_at">=case_effective_acceptance_date(ac."id")) OR
          (ac."id" IS NULL AND e."initial_stage"='WAITING_HEARING' AND
            NEW."hearing_at">=e."stage_reached_on" AND
            (e."known"->>'acceptedOn' IS NULL OR NEW."hearing_at">=(e."known"->>'acceptedOn')::date)))
    ) THEN
      RAISE EXCEPTION 'hearing arrangement case or accepted date mismatch' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
      AND a."department_id" = NEW."department_id" AND a."resource_type" = 'CASE'
      AND a."resource_id" = NEW."case_id" AND a."actor_kind" = 'HUMAN'
      AND a."actor_user_id" = NEW."recorded_by_user_id"
      AND a."action" = CASE WHEN NEW."source" = 'SCHEDULE' THEN 'case.hearing.scheduled' ELSE 'case.hearing.corrected' END
      AND a."details"->>'arrangementId' = NEW."id"::text
      AND a."details"->>'fromVersion' = NEW."from_version"::text
      AND a."details"->>'toVersion' = NEW."to_version"::text
      AND a."details"->>'hearingAt' IS NOT DISTINCT FROM NEW."hearing_at"::text
    ) THEN
      RAISE EXCEPTION 'hearing arrangement audit mismatch' USING ERRCODE = '23514';
    END IF;
    IF NEW."source" = 'CORRECTION' AND NOT EXISTS (
      SELECT 1 FROM "case_hearing_corrections" x WHERE x."new_arrangement_id" = NEW."id"
        AND x."case_id" = NEW."case_id" AND x."department_id" = NEW."department_id"
        AND x."audit_event_id" = NEW."audit_event_id"
    ) THEN
      RAISE EXCEPTION 'corrected arrangement requires correction fact' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'case_hearing_advances' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "cases" c JOIN "case_hearing_arrangements" ar
        ON ar."id" = NEW."arrangement_id" AND ar."case_id" = c."id" AND ar."department_id" = c."department_id"
      JOIN "audit_events" a ON a."id" = NEW."audit_event_id"
      WHERE c."id" = NEW."case_id" AND c."department_id" = NEW."department_id"
        AND c."stage" = 'WAITING_JUDGMENT' AND c."version" = NEW."to_version"
        AND c."current_hearing_arrangement_id" = ar."id" AND c."current_hearing_advance_id" = NEW."id"
        AND ar."hearing_at" IS NOT NULL
        AND NEW."due_at" = ((ar."hearing_at" + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')
        AND NEW."from_version" = ar."to_version"
        AND a."actor_kind" = 'SYSTEM' AND a."department_id" = c."department_id"
        AND a."resource_type" = 'CASE' AND a."resource_id" = c."id"
        AND a."action" = 'case.hearing.auto_advanced'
    ) THEN
      RAISE EXCEPTION 'hearing advance source or audit mismatch' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM "cases" c JOIN "case_hearing_advances" h ON h."id" = NEW."prior_advance_id"
      JOIN "case_hearing_arrangements" ar ON ar."id" = NEW."new_arrangement_id"
      JOIN "audit_events" a ON a."id" = NEW."audit_event_id"
      WHERE c."id" = NEW."case_id" AND c."department_id" = NEW."department_id"
        AND c."current_hearing_arrangement_id" = ar."id" AND c."version" = NEW."to_version"
        AND c."stage" = NEW."result_stage"
        AND (NEW."result_stage" = 'WAITING_JUDGMENT' AND c."current_hearing_advance_id" = h."id" OR
             NEW."result_stage" = 'WAITING_HEARING' AND c."current_hearing_advance_id" IS NULL)
        AND h."case_id" = c."id" AND h."department_id" = c."department_id"
        AND h."id" = (SELECT latest."id" FROM "case_hearing_advances" latest
          WHERE latest."case_id" = c."id" AND latest."department_id" = c."department_id"
          ORDER BY latest."to_version" DESC, latest."id" DESC LIMIT 1)
        AND NEW."prior_arrangement_id" = (SELECT latest."id" FROM "case_hearing_arrangements" latest
          WHERE latest."case_id" = c."id" AND latest."department_id" = c."department_id"
            AND latest."id" <> NEW."new_arrangement_id"
          ORDER BY latest."to_version" DESC, latest."id" DESC LIMIT 1)
        AND ar."case_id" = c."id" AND ar."department_id" = c."department_id"
        AND ar."source" = 'CORRECTION' AND ar."audit_event_id" = a."id"
        AND ar."recorded_by_user_id" = NEW."recorded_by_user_id"
        AND (NEW."result_stage" = 'WAITING_JUDGMENT') =
          (ar."hearing_at" IS NOT NULL AND ar."hearing_at" < (NEW."recorded_at" AT TIME ZONE 'Asia/Shanghai')::date)
        AND NEW."from_version" = CASE
          WHEN NEW."prior_arrangement_id" = h."arrangement_id" THEN h."to_version"
          ELSE (SELECT prior."to_version" FROM "case_hearing_arrangements" prior WHERE prior."id" = NEW."prior_arrangement_id") END
        AND EXISTS (
          SELECT 1 FROM "case_hearing_arrangements" prior
          WHERE prior."id" = NEW."prior_arrangement_id" AND prior."case_id" = c."id"
            AND prior."department_id" = c."department_id"
            AND ((h."arrangement_id" = prior."id" AND h."to_version" = NEW."from_version") OR
              (prior."to_version" = NEW."from_version" AND EXISTS (
                SELECT 1 FROM "case_hearing_corrections" prior_correction
                WHERE prior_correction."new_arrangement_id" = prior."id"
                  AND prior_correction."case_id" = c."id"
                  AND prior_correction."department_id" = c."department_id"
                  AND prior_correction."prior_advance_id" = h."id"
                  AND prior_correction."result_stage" = 'WAITING_JUDGMENT')))
        )
        AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
        AND a."department_id" = c."department_id" AND a."resource_type" = 'CASE'
        AND a."resource_id" = c."id" AND a."action" = 'case.hearing.corrected'
        AND a."details"->>'reason' = NEW."reason"
        AND a."details"->>'priorArrangementId' = NEW."prior_arrangement_id"::text
        AND a."details"->>'priorAdvanceId' = NEW."prior_advance_id"::text
        AND a."details"->>'resultStage' = NEW."result_stage"::text
    ) THEN
      RAISE EXCEPTION 'hearing correction source or audit mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION "check_case_judgment_final"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; case_head record; round_id uuid;
        latest_judgment record; latest_choice record; latest_revoke record; latest_progress record; active_result record; latest_result_revocation record;
        root_count integer; expected_version integer; expected_stage text;
BEGIN
  IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; ELSE target_case:=NEW."case_id"; END IF;
  target_department:=NEW."department_id";
  IF EXISTS (SELECT 1 FROM "case_external_entries" e WHERE e."case_id"=target_case
    AND e."department_id"=NEW."department_id") THEN
    PERFORM ca018_assert_external_trial_round(target_case,NEW."department_id");
    IF ca018_h_is_unadvanced_root(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF ca018_h_downstream_entry_without_judgment(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM "case_external_entries" e JOIN "cases" c ON c."id"=e."case_id" AND c."department_id"=e."department_id"
      WHERE c."id"=target_case AND e."initial_stage"='SECOND_INSTANCE'
        AND c."current_judgment_id" IS NULL) THEN
      PERFORM ca018_h_direct_second_chain(target_case,NEW."department_id");
      RETURN NEW;
    END IF;
    IF TG_TABLE_NAME='case_judgment_facts' THEN
      IF NOT EXISTS (
      SELECT 1 FROM "case_external_entries" e JOIN "case_trial_rounds" r ON r."case_id"=e."case_id" AND r."department_id"=e."department_id"
      WHERE e."case_id"=NEW."case_id" AND e."department_id"=NEW."department_id" AND r."id"=NEW."trial_round_id"
        AND NEW."external_entry_id"=e."id" AND NEW."judgment_received_at">=e."stage_reached_on"
        AND (e."known"->>'acceptedOn' IS NULL OR NEW."judgment_received_at">=(e."known"->>'acceptedOn')::date)
        AND (r."origin"<>'EXTERNAL_CURRENT' OR e."initial_stage"='WAITING_JUDGMENT' OR
          (e."initial_stage"='WAITING_HEARING' AND EXISTS (SELECT 1 FROM "case_hearing_advances" h
            WHERE h."id"=(SELECT c."current_hearing_advance_id" FROM "cases" c WHERE c."id"=NEW."case_id")
              AND h."trial_round_id"=r."id" AND h."external_entry_id"=e."id")))) THEN
        RAISE EXCEPTION 'external judgment source/date mismatch' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT * INTO case_head FROM "cases" WHERE "id" = target_case AND "department_id" = target_department;
  round_id := case_head."current_trial_round_id";
  SELECT f."id", f."to_version" INTO latest_judgment FROM "case_judgment_facts" f
    WHERE f."case_id" = target_case AND f."department_id" = target_department AND f."trial_round_id" = round_id
    ORDER BY f."to_version" DESC LIMIT 1;
  IF latest_judgment."id" IS NULL THEN
    IF case_head."current_judgment_id" IS NOT NULL OR case_head."current_judgment_next_step_id" IS NOT NULL OR
       case_head."stage" IN ('SECOND_INSTANCE', 'WAITING_EXECUTION_DOCUMENTS', 'WAITING_EXECUTION_CONFIRMATION', 'WAITING_EXECUTION_STAMP', 'WAITING_EXECUTION_FILING', 'EXECUTING','WAITING_ARCHIVE','ARCHIVED') THEN
      RAISE EXCEPTION 'current round has no judgment for stage' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT count(*) INTO root_count FROM "case_judgment_facts" f WHERE f."case_id" = target_case
      AND f."department_id" = target_department AND f."trial_round_id" = round_id AND f."kind" = 'REGISTER';
    IF root_count <> 1 OR case_head."current_judgment_id" IS DISTINCT FROM latest_judgment."id" THEN
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
        IF case_head."current_judgment_next_step_id" IS DISTINCT FROM latest_choice."id" OR
           case_head."current_judgment_id" IS DISTINCT FROM latest_choice."judgment_id" THEN
          RAISE EXCEPTION 'current round active choice mismatch' USING ERRCODE = '23514';
        END IF;
        expected_stage := CASE WHEN latest_choice."next" = 'APPEAL' THEN 'SECOND_INSTANCE' ELSE 'WAITING_EXECUTION_DOCUMENTS' END;
        expected_version := latest_choice."to_version";
        IF latest_choice."next" = 'APPEAL' THEN
          SELECT p."id", p."to_version" INTO latest_progress FROM "case_second_instance_progresses" p
            WHERE p."case_id" = target_case AND p."department_id" = target_department AND p."trial_round_id" = round_id
              AND p."choice_id" = latest_choice."id" ORDER BY p."to_version" DESC LIMIT 1;
          IF case_head."current_second_instance_progress_id" IS DISTINCT FROM latest_progress."id" THEN
            RAISE EXCEPTION 'active second-instance progress head mismatch' USING ERRCODE = '23514';
          END IF;
          expected_version := greatest(expected_version, coalesce(latest_progress."to_version", 0));
          SELECT s."id", s."result", s."to_version" INTO active_result FROM "case_second_instance_results" s
            LEFT JOIN "case_second_instance_result_revocations" v ON v."result_id" = s."id"
            WHERE s."case_id" = target_case AND s."department_id" = target_department AND s."trial_round_id" = round_id
              AND s."choice_id" = latest_choice."id" AND v."id" IS NULL ORDER BY s."to_version" DESC LIMIT 1;
          IF active_result."id" IS NOT NULL THEN
            IF active_result."result" = 'REMAND' OR case_head."current_second_instance_result_id" IS DISTINCT FROM active_result."id" THEN
              RAISE EXCEPTION 'source round with active remand/result mismatch' USING ERRCODE = '23514';
            END IF;
            expected_stage := 'WAITING_EXECUTION_DOCUMENTS';
            expected_version := active_result."to_version";
          ELSE
            IF case_head."current_second_instance_result_id" IS NOT NULL THEN
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
        IF EXISTS (SELECT 1 FROM "case_execution_submissions" e WHERE e."case_id" = target_case AND e."department_id" = target_department AND e."trial_round_id" = round_id) THEN
  IF expected_stage <> 'WAITING_EXECUTION_DOCUMENTS' OR NOT EXISTS (
    SELECT 1 FROM "case_execution_submissions" e WHERE e."id" = case_head."current_execution_submission_id"
      AND e."case_id" = target_case AND e."department_id" = target_department AND e."trial_round_id" = round_id
      AND e."judgment_next_step_id" = latest_choice."id"
      AND e."second_instance_result_id" IS NOT DISTINCT FROM case_head."current_second_instance_result_id"
      AND e."id" = (SELECT x."id" FROM "case_execution_submissions" x WHERE x."case_id" = target_case
        AND x."department_id" = target_department AND x."trial_round_id" = round_id ORDER BY x."to_version" DESC LIMIT 1)) THEN
    RAISE EXCEPTION 'execution head or source mismatch' USING ERRCODE = '23514';
  END IF;
  SELECT e."to_version" INTO expected_version FROM "case_execution_submissions" e WHERE e."id" = case_head."current_execution_submission_id";
  IF EXISTS (SELECT 1 FROM "case_execution_confirmations" f WHERE f."case_id" = target_case AND f."department_id" = target_department) THEN
  SELECT f."to_version" INTO expected_version FROM "case_execution_confirmations" f WHERE f."case_id" = target_case AND f."department_id" = target_department AND f."submission_id" = case_head."current_execution_submission_id";
  IF EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department) THEN
 SELECT case_closure_terminal_version(target_case,target_department,ef."id",ef."to_version") INTO expected_version FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department;
 expected_stage := CASE WHEN EXISTS (SELECT 1 FROM "case_archives" WHERE "case_id"=target_case AND "department_id"=target_department) THEN 'ARCHIVED'::case_stage ELSE 'WAITING_ARCHIVE'::case_stage END;
ELSIF EXISTS (SELECT 1 FROM "case_execution_filings" ff WHERE ff."case_id"=target_case AND ff."department_id"=target_department) THEN
 SELECT ff."to_version" INTO expected_version FROM "case_execution_filings" ff WHERE ff."case_id"=target_case AND ff."department_id"=target_department;
 expected_stage := 'EXECUTING';
ELSIF EXISTS (SELECT 1 FROM "case_execution_mailings" mm WHERE mm."case_id"=target_case AND mm."department_id"=target_department) THEN
 SELECT mm."to_version" INTO expected_version FROM "case_execution_mailings" mm WHERE mm."case_id"=target_case AND mm."department_id"=target_department;
 expected_stage := 'WAITING_EXECUTION_FILING';
ELSE expected_stage := 'WAITING_EXECUTION_STAMP'; END IF;
ELSE expected_stage := 'WAITING_EXECUTION_CONFIRMATION'; END IF;
ELSIF case_head."current_execution_submission_id" IS NOT NULL THEN
  RAISE EXCEPTION 'execution pointer without fact' USING ERRCODE = '23514';
END IF;
IF case_head."stage"::text IS DISTINCT FROM expected_stage OR case_head."version" <> expected_version THEN
          RAISE EXCEPTION 'active judgment choice stage/version mismatch' USING ERRCODE = '23514';
        END IF;
      ELSE
        expected_version := greatest(expected_version, latest_revoke."to_version");
        IF case_head."current_judgment_next_step_id" IS NOT NULL OR case_head."stage" <> 'WAITING_JUDGMENT' OR case_head."version" <> expected_version THEN
          RAISE EXCEPTION 'revoked judgment choice mismatch' USING ERRCODE = '23514';
        END IF;
      END IF;
    ELSIF case_head."current_judgment_next_step_id" IS NOT NULL OR case_head."stage" <> 'WAITING_JUDGMENT' OR case_head."version" <> expected_version THEN
      RAISE EXCEPTION 'judgment stage/version mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'case_judgment_facts' THEN
    IF NEW."judgment_received_at" < (SELECT case_effective_acceptance_date(a."id") FROM "case_acceptances" a
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
END; $function$;

CREATE OR REPLACE FUNCTION "check_case_judgment_next_step_final"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; choice_record record; case_record record;
        latest_prior_id uuid; latest_prior_revoked_to integer; expected_from integer; judgment_version integer;
BEGIN
  IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; ELSE target_case:=NEW."case_id"; END IF;
  target_department:=NEW."department_id";
  IF EXISTS (SELECT 1 FROM "case_external_entries" e WHERE e."case_id"=target_case
    AND e."department_id"=NEW."department_id") THEN
    PERFORM ca018_assert_external_trial_round(target_case,NEW."department_id");
    IF ca018_h_is_unadvanced_root(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF ca018_h_downstream_entry_without_judgment(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM "case_external_entries" e JOIN "cases" c ON c."id"=e."case_id" AND c."department_id"=e."department_id"
      WHERE c."id"=target_case AND e."initial_stage"='SECOND_INSTANCE'
        AND c."current_judgment_id" IS NULL) THEN
      PERFORM ca018_h_direct_second_chain(target_case,NEW."department_id");
      RETURN NEW;
    END IF;
    IF TG_TABLE_NAME='case_judgment_next_steps' THEN
      IF NOT EXISTS (
      SELECT 1 FROM "case_judgment_facts" j JOIN "case_external_entries" e ON e."case_id"=j."case_id" AND e."department_id"=j."department_id"
      WHERE j."id"=NEW."judgment_id" AND j."trial_round_id"=NEW."trial_round_id" AND j."external_entry_id"=e."id"
        AND NEW."external_entry_id"=e."id" AND j."case_id"=NEW."case_id" AND j."department_id"=NEW."department_id") THEN
        RAISE EXCEPTION 'external judgment choice lacks real judgment' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT c."stage", c."version", c."current_judgment_id", c."current_judgment_next_step_id", c."rights_holder_id"
    INTO case_record FROM "cases" c WHERE c."id" = target_case AND c."department_id" = target_department;
  IF case_record."stage" IN ('SECOND_INSTANCE', 'WAITING_EXECUTION_DOCUMENTS', 'WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED') AND case_record."current_judgment_next_step_id" IS NULL THEN
    RAISE EXCEPTION 'advanced stage requires current choice' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'case_judgment_next_steps' THEN
    SELECT f."to_version" INTO judgment_version FROM "case_judgment_facts" f
      WHERE f."id" = NEW."judgment_id" AND f."case_id" = target_case AND f."department_id" = target_department;
    SELECT s."id", r."to_version" INTO latest_prior_id, latest_prior_revoked_to
      FROM "case_judgment_next_steps" s LEFT JOIN "case_judgment_next_step_revocations" r ON r."choice_id" = s."id"
      WHERE s."case_id" = target_case AND s."department_id" = target_department AND s."id" <> NEW."id" AND s."trial_round_id" = NEW."trial_round_id"
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
    SELECT s."id", s."judgment_id", s."to_version", s."trial_round_id" INTO choice_record FROM "case_judgment_next_steps" s
      WHERE s."id" = NEW."choice_id" AND s."case_id" = target_case AND s."department_id" = target_department;
    IF choice_record."id" IS NULL OR NEW."from_version" <> choice_record."to_version" OR
       NEW."choice_id" <> (SELECT s."id" FROM "case_judgment_next_steps" s WHERE s."case_id" = target_case AND s."trial_round_id" = choice_record."trial_round_id"
         ORDER BY s."to_version" DESC LIMIT 1) OR
       case_record."current_judgment_id" IS DISTINCT FROM choice_record."judgment_id" OR
       EXISTS (SELECT 1 FROM "case_second_instance_progresses" p WHERE p."choice_id" = NEW."choice_id") OR
       EXISTS (SELECT 1 FROM "case_second_instance_results" x WHERE x."choice_id" = NEW."choice_id") OR
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
$function$;

CREATE OR REPLACE FUNCTION "check_case_second_instance_final"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; case_head record; choice_record record; source_result record;
        prior_progress record; prior_result record; last_revocation record; expected_from integer; accepted_date date;
BEGIN
  IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; ELSE target_case:=NEW."case_id"; END IF;
  target_department:=NEW."department_id";
  IF EXISTS (SELECT 1 FROM "case_external_entries" e WHERE e."case_id"=target_case
    AND e."department_id"=NEW."department_id") THEN
    PERFORM ca018_assert_external_trial_round(target_case,NEW."department_id");
    IF ca018_h_is_unadvanced_root(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF ca018_h_downstream_entry_without_judgment(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM "case_external_entries" e JOIN "cases" c ON c."id"=e."case_id" AND c."department_id"=e."department_id"
      WHERE e."case_id"=target_case
        AND e."department_id"=NEW."department_id" AND e."initial_stage"='SECOND_INSTANCE'
        AND c."current_judgment_id" IS NULL) THEN
      PERFORM ca018_h_direct_second_chain(target_case,NEW."department_id");
      IF TG_TABLE_NAME='case_second_instance_progresses' THEN
        IF NOT EXISTS (
        SELECT 1 FROM "case_external_entries" e JOIN "case_trial_rounds" r ON r."case_id"=e."case_id" AND r."department_id"=e."department_id"
        WHERE e."case_id"=NEW."case_id" AND e."department_id"=NEW."department_id"
          AND r."id"=NEW."trial_round_id" AND r."origin"='EXTERNAL_CURRENT'
          AND NEW."external_entry_id"=e."id" AND NEW."choice_id" IS NULL
          AND NEW."to_version"=NEW."from_version"+1
          AND NEW."from_version"=greatest(1,
            coalesce((SELECT p."to_version" FROM "case_second_instance_progresses" p
              WHERE p."case_id"=NEW."case_id" AND p."department_id"=NEW."department_id"
                AND p."trial_round_id"=NEW."trial_round_id" AND p."id"<>NEW."id"
              ORDER BY p."to_version" DESC LIMIT 1),0),
            coalesce((SELECT v."to_version" FROM "case_second_instance_result_revocations" v
              JOIN "case_second_instance_results" s ON s."id"=v."result_id"
              WHERE s."case_id"=NEW."case_id" AND s."department_id"=NEW."department_id"
                AND s."trial_round_id"=NEW."trial_round_id" AND s."choice_id" IS NULL
              ORDER BY v."to_version" DESC LIMIT 1),0))
          AND NEW."prior_progress_id" IS NOT DISTINCT FROM (SELECT p."id" FROM "case_second_instance_progresses" p
            WHERE p."case_id"=NEW."case_id" AND p."department_id"=NEW."department_id"
              AND p."trial_round_id"=NEW."trial_round_id" AND p."id"<>NEW."id"
            ORDER BY p."to_version" DESC LIMIT 1)
          AND (NEW."hearing_at" IS NULL OR
            (NEW."hearing_at">=e."stage_reached_on" AND
             (e."known"->>'acceptedOn' IS NULL OR NEW."hearing_at">=(e."known"->>'acceptedOn')::date) AND
             (e."known"->>'secondInstanceAcceptedOn' IS NULL OR NEW."hearing_at">=(e."known"->>'secondInstanceAcceptedOn')::date)))
          AND EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id"=NEW."audit_event_id" AND a."action"='case.second_instance.save'
            AND a."resource_id"=NEW."case_id" AND a."department_id"=NEW."department_id"
            AND a."resource_type"='CASE' AND a."actor_kind"='HUMAN'
            AND a."actor_user_id"=NEW."recorded_by_user_id"
            AND a."details"->>'progressId'=NEW."id"::text AND a."details"->>'choiceId' IS NULL
            AND a."details"->>'trialRoundId'=NEW."trial_round_id"::text
            AND a."details"->>'priorProgressId' IS NOT DISTINCT FROM NEW."prior_progress_id"::text
            AND a."details"->>'fromVersion'=NEW."from_version"::text
            AND a."details"->>'toVersion'=NEW."to_version"::text
            AND a."details"->>'hearingAt' IS NOT DISTINCT FROM NEW."hearing_at"::text
            AND a."details"->>'hearingPlace' IS NOT DISTINCT FROM NEW."hearing_place"
            AND a."details"->>'judgeName' IS NOT DISTINCT FROM NEW."judge_name")
          AND EXISTS (SELECT 1 FROM "case_second_instance_receipts" receipt WHERE receipt."case_id"=NEW."case_id"
            AND receipt."department_id"=NEW."department_id" AND receipt."actor_user_id"=NEW."recorded_by_user_id"
            AND receipt."action" IN ('SAVE','RESULT')
            AND receipt."result_snapshot"->>'progressId'=NEW."id"::text)) THEN
          RAISE EXCEPTION 'direct second progress source/audit/receipt mismatch' USING ERRCODE='23514';
        END IF;
      END IF;
      IF TG_TABLE_NAME='case_second_instance_results' THEN
        IF NOT EXISTS (
        SELECT 1 FROM "case_external_entries" e JOIN "case_trial_rounds" r ON r."case_id"=e."case_id" AND r."department_id"=e."department_id"
        WHERE e."case_id"=NEW."case_id" AND e."department_id"=NEW."department_id"
          AND r."id"=NEW."trial_round_id" AND r."origin"='EXTERNAL_CURRENT'
          AND NEW."external_entry_id"=e."id" AND NEW."choice_id" IS NULL AND NEW."judgment_id" IS NULL
          AND NEW."to_version"=NEW."from_version"+1
          AND NEW."from_version"=greatest(1,
            coalesce((SELECT p."to_version" FROM "case_second_instance_progresses" p
              WHERE p."case_id"=NEW."case_id" AND p."department_id"=NEW."department_id"
                AND p."trial_round_id"=NEW."trial_round_id"
              ORDER BY p."to_version" DESC LIMIT 1),0),
            coalesce((SELECT v."to_version" FROM "case_second_instance_result_revocations" v
              JOIN "case_second_instance_results" s ON s."id"=v."result_id"
              WHERE s."case_id"=NEW."case_id" AND s."department_id"=NEW."department_id"
                AND s."trial_round_id"=NEW."trial_round_id" AND s."choice_id" IS NULL
              ORDER BY v."to_version" DESC LIMIT 1),0))
          AND NEW."progress_id" IS NOT DISTINCT FROM (SELECT p."id" FROM "case_second_instance_progresses" p
            WHERE p."case_id"=NEW."case_id" AND p."department_id"=NEW."department_id"
              AND p."trial_round_id"=NEW."trial_round_id" ORDER BY p."to_version" DESC LIMIT 1)
          AND NEW."result_received_at">=e."stage_reached_on"
          AND NEW."result_received_at" <= (NEW."recorded_at" AT TIME ZONE 'Asia/Shanghai')::date
          AND NOT EXISTS (SELECT 1 FROM "case_second_instance_results" other
            WHERE other."case_id"=NEW."case_id" AND other."department_id"=NEW."department_id"
              AND other."trial_round_id"=NEW."trial_round_id" AND other."id"<>NEW."id"
              AND NOT EXISTS (SELECT 1 FROM "case_second_instance_result_revocations" v WHERE v."result_id"=other."id"))
          AND (NEW."result"<>'AFFIRM' OR NEW."judgment_amount_state" IS NOT NULL)
          AND EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id"=NEW."audit_event_id"
            AND a."action"='case.second_instance.result' AND a."resource_id"=NEW."case_id"
            AND a."department_id"=NEW."department_id" AND a."resource_type"='CASE'
            AND a."actor_kind"='HUMAN' AND a."actor_user_id"=NEW."recorded_by_user_id"
            AND a."details"->>'resultId'=NEW."id"::text
            AND a."details"->>'trialRoundId'=NEW."trial_round_id"::text
            AND a."details"->>'choiceId' IS NULL AND a."details"->>'judgmentId' IS NULL
            AND a."details"->>'progressId' IS NOT DISTINCT FROM NEW."progress_id"::text
            AND a."details"->>'result'=NEW."result"::text
            AND a."details"->>'resultReceivedAt'=NEW."result_received_at"::text
            AND a."details"->>'judgmentAmountState' IS NOT DISTINCT FROM NEW."judgment_amount_state"::text
            AND a."details"->>'judgmentAmount' IS NOT DISTINCT FROM NEW."judgment_amount"::text
            AND a."details"->>'paidLitigationFeeState'=NEW."paid_litigation_fee_state"::text
            AND a."details"->>'paidLitigationFee' IS NOT DISTINCT FROM NEW."paid_litigation_fee"::text
            AND a."details"->>'fromVersion'=NEW."from_version"::text
            AND a."details"->>'toVersion'=NEW."to_version"::text)
          AND EXISTS (SELECT 1 FROM "case_second_instance_receipts" receipt WHERE receipt."case_id"=NEW."case_id"
            AND receipt."department_id"=NEW."department_id" AND receipt."actor_user_id"=NEW."recorded_by_user_id"
            AND receipt."action"='RESULT'
            AND receipt."result_snapshot"->>'resultId'=NEW."id"::text)) THEN
          RAISE EXCEPTION 'direct second result source/audit/receipt mismatch' USING ERRCODE='23514';
        END IF;
      END IF;
      IF TG_TABLE_NAME='case_second_instance_result_revocations' THEN
        IF NOT EXISTS (
        SELECT 1 FROM "case_second_instance_results" s JOIN "audit_events" a ON a."id"=NEW."audit_event_id"
        JOIN "case_second_instance_receipts" receipt ON receipt."case_id"=NEW."case_id"
          AND receipt."department_id"=NEW."department_id" AND receipt."action"='REVOKE'
          AND receipt."result_snapshot"->>'revocationId'=NEW."id"::text
        WHERE s."id"=NEW."result_id" AND s."case_id"=NEW."case_id" AND s."department_id"=NEW."department_id"
          AND s."external_entry_id"=(SELECT e."id" FROM "case_external_entries" e WHERE e."case_id"=NEW."case_id")
          AND s."choice_id" IS NULL AND NEW."to_version"=NEW."from_version"+1
          AND NEW."from_version"=(SELECT c."version"-1 FROM "cases" c WHERE c."id"=NEW."case_id")
          AND a."department_id"=NEW."department_id" AND a."resource_type"='CASE'
          AND a."actor_kind"='HUMAN' AND a."actor_user_id"=NEW."recorded_by_user_id"
          AND a."internal_actor_user_id"=NEW."recorded_by_user_id"
          AND a."action"='case.second_instance.result.revoke' AND a."resource_id"=NEW."case_id"
          AND a."details"->>'resultId'=NEW."result_id"::text
          AND a."details"->>'revocationId'=NEW."id"::text
          AND a."details"->>'reason'=NEW."reason"
          AND a."details"->>'fromVersion'=NEW."from_version"::text
          AND a."details"->>'toVersion'=NEW."to_version"::text
          AND receipt."actor_user_id"=NEW."recorded_by_user_id"
          AND NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id"=NEW."case_id"
            AND (c."current_second_instance_result_id" IS NOT NULL OR c."stage"<>'SECOND_INSTANCE'
              OR c."current_trial_round_id"<>s."trial_round_id"
              OR c."current_second_instance_progress_id" IS DISTINCT FROM s."progress_id"))
          AND NOT EXISTS (SELECT 1 FROM "case_execution_submissions" downstream
            WHERE downstream."second_instance_result_id"=s."id")
          AND (s."result"<>'REMAND' OR EXISTS (SELECT 1 FROM "case_trial_rounds" child
            WHERE child."source_result_id"=s."id" AND child."external_entry_id"=s."external_entry_id"
              AND child."revoked_at"=NEW."recorded_at"
              AND NOT EXISTS (SELECT 1 FROM "case_acceptances" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_hearing_arrangements" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_hearing_advances" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_judgment_facts" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_steps" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_second_instance_progresses" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_second_instance_results" x WHERE x."trial_round_id"=child."id")))) THEN
          RAISE EXCEPTION 'direct second result revoke mismatch' USING ERRCODE='23514';
        END IF;
      END IF;
      RETURN NEW;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT * INTO case_head FROM "cases" WHERE "id" = target_case AND "department_id" = target_department;
  IF case_head."current_second_instance_progress_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "case_second_instance_progresses" p WHERE p."id" = case_head."current_second_instance_progress_id"
      AND p."case_id" = target_case AND p."department_id" = target_department
      AND p."trial_round_id" = case_head."current_trial_round_id" AND p."choice_id" = case_head."current_judgment_next_step_id") THEN
    RAISE EXCEPTION 'second-instance current progress pointer mismatch' USING ERRCODE = '23514';
  END IF;
  IF case_head."current_second_instance_result_id" IS NOT NULL THEN
    SELECT s.*, v."id" AS revocation_id INTO source_result FROM "case_second_instance_results" s
      LEFT JOIN "case_second_instance_result_revocations" v ON v."result_id" = s."id"
      WHERE s."id" = case_head."current_second_instance_result_id" AND s."case_id" = target_case
        AND s."department_id" = target_department;
    IF source_result."id" IS NULL OR source_result.revocation_id IS NOT NULL OR
       (source_result."result" = 'REMAND' AND (case_head."stage" <> 'WAITING_FORMAL_ACCEPTANCE' OR
         NOT EXISTS (SELECT 1 FROM "case_trial_rounds" child WHERE child."id" = case_head."current_trial_round_id"
           AND child."source_result_id" = source_result."id" AND child."revoked_at" IS NULL))) OR
       (source_result."result" <> 'REMAND' AND (case_head."stage" NOT IN ('WAITING_EXECUTION_DOCUMENTS','WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED') OR
         source_result."trial_round_id" <> case_head."current_trial_round_id")) THEN
      RAISE EXCEPTION 'second-instance current result pointer mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'case_second_instance_progresses' THEN
    SELECT s."id", s."to_version" INTO choice_record FROM "case_judgment_next_steps" s
      WHERE s."id" = NEW."choice_id" AND s."case_id" = target_case AND s."department_id" = target_department
        AND s."trial_round_id" = NEW."trial_round_id" AND s."next" = 'APPEAL'
        AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_step_revocations" v WHERE v."choice_id" = s."id");
    IF NOT EXISTS (SELECT 1 FROM "case_judgment_next_steps" actual
      JOIN "case_judgment_facts" judgment ON judgment."id"=actual."judgment_id"
      JOIN "case_external_entries" e ON e."case_id"=actual."case_id" AND e."department_id"=actual."department_id"
      WHERE actual."id"=NEW."choice_id" AND actual."trial_round_id"=NEW."trial_round_id"
        AND actual."case_id"=NEW."case_id" AND actual."department_id"=NEW."department_id"
        AND actual."external_entry_id"=e."id" AND judgment."external_entry_id"=e."id"
        AND judgment."trial_round_id"=NEW."trial_round_id" AND actual."next"='APPEAL'
        AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_step_revocations" v WHERE v."choice_id"=actual."id")) THEN
      RAISE EXCEPTION 'external real appeal requires true source choice/judgment' USING ERRCODE='23514';
    END IF;
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
       (case_head."current_trial_round_id" <> NEW."trial_round_id" AND NOT EXISTS (
         SELECT 1 FROM "case_second_instance_results" s WHERE s."trial_round_id" = NEW."trial_round_id"
           AND s."progress_id" = NEW."id" AND s."result" = 'REMAND' AND
           case_head."current_second_instance_result_id" = s."id")) OR
       (case_head."current_trial_round_id" = NEW."trial_round_id" AND case_head."current_second_instance_progress_id" IS DISTINCT FROM NEW."id") OR
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
    SELECT case_effective_acceptance_date(a."id") INTO accepted_date FROM "case_acceptances" a WHERE a."case_id" = target_case
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
       (accepted_date IS NULL AND NOT EXISTS (SELECT 1 FROM "case_external_entries" e
         WHERE e."case_id"=target_case AND e."department_id"=target_department
           AND e."initial_stage" IN ('WAITING_HEARING','WAITING_JUDGMENT') AND NEW."external_entry_id"=e."id")) OR
       NEW."result_received_at" < coalesce(accepted_date,(SELECT e."stage_reached_on" FROM "case_external_entries" e
         WHERE e."case_id"=target_case AND e."department_id"=target_department)) OR
       NEW."result_received_at" > (NEW."recorded_at" AT TIME ZONE 'Asia/Shanghai')::date OR
       case_head."current_second_instance_result_id" IS DISTINCT FROM NEW."id" OR
       (NEW."result" = 'AFFIRM' AND NOT EXISTS (SELECT 1 FROM "case_judgment_facts" j
         WHERE j."id" = NEW."judgment_id" AND j."judgment_amount_state" = NEW."judgment_amount_state"
           AND j."judgment_amount" IS NOT DISTINCT FROM NEW."judgment_amount")) OR
       (NEW."result" = 'REMAND' AND NOT EXISTS (SELECT 1 FROM "case_trial_rounds" child
         WHERE child."source_result_id" = NEW."id" AND child."id" = case_head."current_trial_round_id")) OR
       (NEW."result" <> 'REMAND' AND case_head."current_trial_round_id" <> NEW."trial_round_id") OR
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
    IF source_result."id" IS NULL OR NEW."from_version" <> case_head."version" - 1 OR
       case_head."current_second_instance_result_id" IS NOT NULL OR case_head."stage" <> 'SECOND_INSTANCE' OR
       case_head."current_trial_round_id" <> source_result."trial_round_id" OR
       case_head."current_second_instance_progress_id" IS DISTINCT FROM source_result."progress_id" OR
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
END; $function$;

-- Evaluate material-reference fields only for material-reference trigger rows.
CREATE OR REPLACE FUNCTION "check_case_external_confirmation_bundle"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; q record; a record; selected jsonb; selected_count integer;
BEGIN
  IF TG_TABLE_NAME='case_execution_confirmations' THEN target_case:=NEW."case_id"; target_department:=NEW."department_id";
  ELSIF TG_TABLE_NAME='case_execution_confirmation_versions' THEN target_case:=NEW."case_id"; target_department:=NEW."department_id";
  ELSE target_case:=NEW."resource_id"; target_department:=NEW."department_id"; END IF;
  SELECT * INTO q FROM "case_execution_confirmations" WHERE "case_id"=target_case AND "department_id"=target_department;
  IF q."id" IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='material_references' THEN
    IF NEW."action_event_id" IS DISTINCT FROM q."audit_event_id" THEN RETURN NEW; END IF;
  END IF;
  SELECT * INTO a FROM "audit_events" WHERE "id"=q."audit_event_id";
  selected:=a."details"->'executionApplicationContentVersionIds';
  SELECT count(*) INTO selected_count FROM "case_execution_confirmation_versions" v WHERE v."confirmation_id"=q."id";
  IF q."submission_id" IS NOT NULL THEN
    IF selected_count<>0 THEN RAISE EXCEPTION 'submission-backed confirmation owns direct bundle' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF q."external_entry_id" IS NULL OR a."id" IS NULL OR a."action" IS DISTINCT FROM 'case.execution.confirmed' OR
    a."resource_type" IS DISTINCT FROM 'CASE' OR a."resource_id" IS DISTINCT FROM target_case OR
    a."department_id" IS DISTINCT FROM target_department OR a."actor_user_id" IS DISTINCT FROM q."confirmed_by_user_id" OR
    jsonb_typeof(selected) IS DISTINCT FROM 'array' OR jsonb_array_length(selected) NOT BETWEEN 1 AND 10 OR
    selected_count<>jsonb_array_length(selected) OR
    EXISTS (SELECT 1 FROM "case_execution_confirmation_versions" v WHERE v."confirmation_id"=q."id" AND NOT selected ? v."content_version_id"::text) OR
    EXISTS (SELECT 1 FROM jsonb_array_elements_text(selected) requested WHERE NOT EXISTS
      (SELECT 1 FROM "case_execution_confirmation_versions" v WHERE v."confirmation_id"=q."id" AND v."content_version_id"::text=requested.value)) OR
    -- The first confirmation must freeze the entire current available bundle,
    -- not just a self-consistent subset selected by its caller. This deferred
    -- check fires only for that confirmation transaction; future material
    -- changes do not rewrite its historical snapshot.
    (SELECT count(*) FROM "materials" m JOIN "content_versions" cv
       ON cv."id"=m."current_version_id" AND cv."material_id"=m."id"
      WHERE m."department_id"=target_department AND m."owner_type"='CASE' AND m."owner_id"=target_case
        AND m."category"='EXECUTION_APPLICATION' AND m."purpose"='EXECUTION_APPLICATION'
        AND m."status"='ACTIVE' AND cv."status"='AVAILABLE')<>selected_count OR
    EXISTS (SELECT 1 FROM "materials" m JOIN "content_versions" cv
       ON cv."id"=m."current_version_id" AND cv."material_id"=m."id"
      WHERE m."department_id"=target_department AND m."owner_type"='CASE' AND m."owner_id"=target_case
        AND m."category"='EXECUTION_APPLICATION' AND m."purpose"='EXECUTION_APPLICATION'
        AND m."status"='ACTIVE' AND cv."status"='AVAILABLE'
        AND NOT EXISTS (SELECT 1 FROM "case_execution_confirmation_versions" v
          WHERE v."confirmation_id"=q."id" AND v."material_id"=m."id" AND v."content_version_id"=cv."id")) OR
    (SELECT count(*) FROM "material_references" r WHERE r."action_event_id"=q."audit_event_id" AND r."resource_type"='case' AND r."resource_id"=target_case AND r."department_id"=target_department AND r."purpose"='EXECUTION_APPLICATION')<>selected_count OR
    EXISTS (SELECT 1 FROM "case_execution_confirmation_versions" v WHERE v."confirmation_id"=q."id" AND NOT EXISTS
      (SELECT 1 FROM "material_references" r WHERE r."action_event_id"=q."audit_event_id" AND r."resource_type"='case' AND r."resource_id"=target_case AND r."department_id"=target_department AND r."purpose"='EXECUTION_APPLICATION' AND r."material_id"=v."material_id" AND r."content_version_id"=v."content_version_id"))
  THEN RAISE EXCEPTION 'external execution confirmation bundle mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

COMMIT;
