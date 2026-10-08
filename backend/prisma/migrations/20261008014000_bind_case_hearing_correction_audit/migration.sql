BEGIN;
-- Forward-only strengthening of the deferred hearing fact guard. A carried
-- advance must be the one bound to the immediately prior judgment arrangement.
CREATE OR REPLACE FUNCTION "check_case_hearing_fact"() RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'case_hearing_arrangements' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "cases" c JOIN "case_acceptances" ac ON ac."case_id" = c."id" AND ac."department_id" = c."department_id"
      WHERE c."id" = NEW."case_id" AND c."department_id" = NEW."department_id"
        AND c."current_hearing_arrangement_id" = NEW."id" AND c."version" = NEW."to_version"
        AND c."stage" IN ('WAITING_HEARING', 'WAITING_JUDGMENT')
        AND (NEW."hearing_at" IS NULL OR NEW."hearing_at" >= ac."accepted_at")
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
$$ LANGUAGE plpgsql;
COMMIT;
