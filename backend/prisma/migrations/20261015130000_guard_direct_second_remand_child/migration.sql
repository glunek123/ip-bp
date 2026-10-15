BEGIN;

-- After accepting a real REMAND child, the current second-instance result is
-- intentionally cleared. Keep the direct root guard while recognizing that
-- one exact, already accepted child as the current first-instance round.
CREATE OR REPLACE FUNCTION "ca018_h_direct_second_chain"(target_case uuid,target_department uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE c record; e record; root_round record; child_round record; result_record record;
        latest_progress record; latest_revoke record; acceptance_record record;
        hearing_record record; advance_record record; acceptance_version integer;
BEGIN
  SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
  SELECT * INTO e FROM "case_external_entries" WHERE "case_id"=target_case AND "department_id"=target_department;
  IF e."id" IS NULL OR e."initial_stage"<>'SECOND_INSTANCE' THEN
    RAISE EXCEPTION 'direct second source missing' USING ERRCODE='23514';
  END IF;
  PERFORM ca018_assert_external_trial_round(target_case,target_department);
  SELECT * INTO root_round FROM "case_trial_rounds" r WHERE r."case_id"=target_case
    AND r."department_id"=target_department AND r."origin"='EXTERNAL_CURRENT' AND r."sequence"=1
    AND r."external_entry_id"=e."id" AND r."source_result_id" IS NULL AND r."revoked_at" IS NULL;
  IF root_round."id" IS NULL OR c."current_judgment_id" IS NOT NULL OR c."current_judgment_next_step_id" IS NOT NULL OR
     EXISTS (SELECT 1 FROM "case_acceptances" a WHERE a."trial_round_id"=root_round."id") OR
     EXISTS (SELECT 1 FROM "case_hearing_arrangements" h WHERE h."trial_round_id"=root_round."id") OR
     EXISTS (SELECT 1 FROM "case_hearing_advances" h WHERE h."trial_round_id"=root_round."id") OR
     EXISTS (SELECT 1 FROM "case_judgment_facts" j WHERE j."trial_round_id"=root_round."id") OR
     EXISTS (SELECT 1 FROM "case_judgment_next_steps" s WHERE s."trial_round_id"=root_round."id") THEN
    RAISE EXCEPTION 'direct second has invented first-instance facts' USING ERRCODE='23514';
  END IF;
  SELECT p."id",p."to_version" INTO latest_progress FROM "case_second_instance_progresses" p
    WHERE p."case_id"=target_case AND p."department_id"=target_department AND p."trial_round_id"=root_round."id"
      AND p."choice_id" IS NULL AND p."external_entry_id"=e."id"
    ORDER BY p."to_version" DESC LIMIT 1;
  SELECT v."to_version" INTO latest_revoke FROM "case_second_instance_result_revocations" v
    JOIN "case_second_instance_results" s ON s."id"=v."result_id"
    WHERE s."case_id"=target_case AND s."department_id"=target_department AND s."trial_round_id"=root_round."id"
      AND s."choice_id" IS NULL AND s."external_entry_id"=e."id"
    ORDER BY v."to_version" DESC LIMIT 1;
  IF c."current_second_instance_result_id" IS NULL THEN
    IF c."current_trial_round_id" IS DISTINCT FROM root_round."id" THEN
      SELECT * INTO child_round FROM "case_trial_rounds" r WHERE r."id"=c."current_trial_round_id"
        AND r."case_id"=target_case AND r."department_id"=target_department
        AND r."origin"='NORMAL' AND r."sequence"=root_round."sequence"+1
        AND r."external_entry_id"=e."id" AND r."source_result_id" IS NOT NULL AND r."revoked_at" IS NULL;
      SELECT * INTO result_record FROM "case_second_instance_results" s WHERE s."id"=child_round."source_result_id"
        AND s."case_id"=target_case AND s."department_id"=target_department
        AND s."trial_round_id"=root_round."id" AND s."external_entry_id"=e."id"
        AND s."choice_id" IS NULL AND s."judgment_id" IS NULL AND s."result"='REMAND'
        AND NOT EXISTS (SELECT 1 FROM "case_second_instance_result_revocations" v WHERE v."result_id"=s."id");
      SELECT a.*, (audit."details"->>'toVersion')::integer AS accepted_to_version INTO acceptance_record
        FROM "case_acceptances" a JOIN "audit_events" audit ON audit."id"=a."audit_event_id"
        WHERE a."id"=c."current_acceptance_id" AND a."case_id"=target_case
          AND a."department_id"=target_department AND a."trial_round_id"=child_round."id"
          AND a."external_entry_id"=e."id" AND audit."action"='case.acceptance.registered'
          AND audit."resource_type"='CASE' AND audit."resource_id"=target_case
          AND audit."department_id"=target_department;
      acceptance_version:=acceptance_record.accepted_to_version;
      SELECT * INTO hearing_record FROM "case_hearing_arrangements" h
        WHERE h."id"=c."current_hearing_arrangement_id" AND h."case_id"=target_case
          AND h."department_id"=target_department AND h."trial_round_id"=child_round."id"
          AND h."external_entry_id"=e."id";
      SELECT * INTO advance_record FROM "case_hearing_advances" h
        WHERE h."id"=c."current_hearing_advance_id" AND h."case_id"=target_case
          AND h."department_id"=target_department AND h."trial_round_id"=child_round."id"
          AND h."external_entry_id"=e."id";
      IF child_round."id" IS NULL OR result_record."id" IS NULL OR acceptance_record."id" IS NULL OR
         result_record."progress_id" IS DISTINCT FROM latest_progress."id" OR
         result_record."result_received_at"<e."stage_reached_on" OR
         (e."known"->>'acceptedOn' IS NOT NULL AND result_record."result_received_at"<(e."known"->>'acceptedOn')::date) OR
         (e."known"->>'secondInstanceAcceptedOn' IS NOT NULL AND result_record."result_received_at"<(e."known"->>'secondInstanceAcceptedOn')::date) OR
         acceptance_record."accepted_at"<result_record."result_received_at" OR
         acceptance_version IS NULL OR acceptance_version<>result_record."to_version"+1 OR
         c."version"<greatest(acceptance_version,coalesce(hearing_record."to_version",0),coalesce(advance_record."to_version",0)) OR
         c."current_second_instance_progress_id" IS NOT NULL OR
         c."stage" NOT IN ('WAITING_HEARING','WAITING_JUDGMENT') OR
         c."current_hearing_arrangement_id" IS DISTINCT FROM
           (SELECT h."id" FROM "case_hearing_arrangements" h WHERE h."case_id"=target_case
             AND h."department_id"=target_department AND h."trial_round_id"=child_round."id"
             ORDER BY h."to_version" DESC LIMIT 1) OR
         (c."current_hearing_arrangement_id" IS NOT NULL AND hearing_record."id" IS NULL) OR
         (c."current_hearing_advance_id" IS NOT NULL AND advance_record."id" IS NULL) OR
         (c."stage"='WAITING_HEARING' AND c."current_hearing_advance_id" IS NOT NULL) OR
         (c."stage"='WAITING_JUDGMENT' AND
           (advance_record."id" IS NULL OR hearing_record."id" IS NULL)) THEN
        RAISE EXCEPTION 'accepted direct remand child source/head mismatch' USING ERRCODE='23514';
      END IF;
      RETURN;
    END IF;
    IF c."stage"<>'SECOND_INSTANCE' OR
       c."current_second_instance_progress_id" IS DISTINCT FROM latest_progress."id" OR
       c."version"<>greatest(1,coalesce(latest_progress."to_version",0),coalesce(latest_revoke."to_version",0)) THEN
      RAISE EXCEPTION 'direct second progress/head mismatch' USING ERRCODE='23514';
    END IF;
    RETURN;
  END IF;
  SELECT * INTO result_record FROM "case_second_instance_results" s WHERE s."id"=c."current_second_instance_result_id"
    AND s."case_id"=target_case AND s."department_id"=target_department AND s."trial_round_id"=root_round."id"
    AND s."choice_id" IS NULL AND s."judgment_id" IS NULL AND s."external_entry_id"=e."id"
    AND NOT EXISTS (SELECT 1 FROM "case_second_instance_result_revocations" v WHERE v."result_id"=s."id");
  IF result_record."id" IS NULL OR result_record."progress_id" IS DISTINCT FROM latest_progress."id" OR
     result_record."result_received_at"<e."stage_reached_on" OR
     (e."known"->>'acceptedOn' IS NOT NULL AND result_record."result_received_at"<(e."known"->>'acceptedOn')::date) OR
     (e."known"->>'secondInstanceAcceptedOn' IS NOT NULL AND result_record."result_received_at"<(e."known"->>'secondInstanceAcceptedOn')::date) THEN
    RAISE EXCEPTION 'direct second result source/date mismatch' USING ERRCODE='23514';
  END IF;
  IF result_record."result"='REMAND' THEN
    IF NOT EXISTS (SELECT 1 FROM "case_trial_rounds" child WHERE child."id"=c."current_trial_round_id"
         AND child."case_id"=target_case AND child."department_id"=target_department
         AND child."source_result_id"=result_record."id" AND child."external_entry_id"=e."id"
         AND child."origin"='NORMAL' AND child."revoked_at" IS NULL) THEN
      RAISE EXCEPTION 'direct second remand child mismatch' USING ERRCODE='23514';
    END IF;
    IF c."current_acceptance_id" IS NULL THEN
      IF c."stage"<>'WAITING_FORMAL_ACCEPTANCE' OR c."version"<>result_record."to_version" OR
         c."current_second_instance_progress_id" IS NOT NULL OR
         EXISTS (SELECT 1 FROM "case_judgment_facts" x WHERE x."trial_round_id"=c."current_trial_round_id") THEN
        RAISE EXCEPTION 'unaccepted direct remand child moved without fact' USING ERRCODE='23514';
      END IF;
    ELSIF c."version"<=result_record."to_version" OR NOT EXISTS (
      SELECT 1 FROM "case_acceptances" a WHERE a."id"=c."current_acceptance_id"
        AND a."case_id"=target_case AND a."department_id"=target_department
        AND a."trial_round_id"=c."current_trial_round_id" AND a."external_entry_id"=e."id") THEN
      RAISE EXCEPTION 'direct remand child lacks real acceptance' USING ERRCODE='23514';
    END IF;
  ELSIF c."current_trial_round_id" IS DISTINCT FROM root_round."id" OR
        c."stage" NOT IN ('WAITING_EXECUTION_DOCUMENTS','WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP',
          'WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED') OR
        c."version"<result_record."to_version" OR
        c."current_second_instance_progress_id" IS DISTINCT FROM result_record."progress_id" THEN
    RAISE EXCEPTION 'direct second result head mismatch' USING ERRCODE='23514';
  END IF;
END; $$;

COMMIT;
