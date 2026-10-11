BEGIN;

-- A re-trial round with no judgment has no choice/result fact to prove the
-- case version. Resolve the exact current acceptance/hearing head instead of
-- accepting any version above a historical maximum. A correction may keep the
-- prior advance when its new hearing is already due.
CREATE FUNCTION "check_retrial_prejudgment_version"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record; current_round record; source_result record; accepted record;
        arrangement record; advance record; correction record; expected_version integer;
BEGIN
  SELECT * INTO c FROM "cases" WHERE "id" = NEW."id";
  SELECT "id", "sequence", "source_result_id" INTO current_round FROM "case_trial_rounds"
    WHERE "id" = c."current_trial_round_id" AND "case_id" = c."id"
      AND "department_id" = c."department_id";
  IF current_round."id" IS NULL OR current_round."sequence" = 1 OR
     c."current_acceptance_id" IS NULL OR c."current_judgment_id" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT "id", "to_version" INTO source_result FROM "case_second_instance_results"
    WHERE "id" = current_round."source_result_id" AND "case_id" = c."id"
      AND "department_id" = c."department_id" AND "result" = 'REMAND';
  SELECT "id", "audit_event_id", "recorded_by_user_id" INTO accepted FROM "case_acceptances"
    WHERE "id" = c."current_acceptance_id" AND "case_id" = c."id"
      AND "department_id" = c."department_id" AND "trial_round_id" = current_round."id";
  expected_version := source_result."to_version" + 1;
  IF source_result."id" IS NULL OR accepted."id" IS NULL OR
     NOT EXISTS (SELECT 1 FROM "audit_events" e
       WHERE e."id" = accepted."audit_event_id" AND e."department_id" = c."department_id"
         AND e."resource_type" = 'CASE' AND e."resource_id" = c."id"
         AND e."action" = 'case.acceptance.registered'
         AND e."actor_user_id" = accepted."recorded_by_user_id"
         AND e."details"->>'fromVersion' = source_result."to_version"::text
         AND e."details"->>'toVersion' = expected_version::text) THEN
    RAISE EXCEPTION 'retrial acceptance lacks exact source version' USING ERRCODE = '23514';
  END IF;

  IF c."current_hearing_arrangement_id" IS NULL THEN
    IF c."current_hearing_advance_id" IS NOT NULL OR c."stage" <> 'WAITING_HEARING' THEN
      RAISE EXCEPTION 'retrial acceptance stage/head mismatch' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT "id", "to_version" INTO arrangement FROM "case_hearing_arrangements"
      WHERE "id" = c."current_hearing_arrangement_id" AND "case_id" = c."id"
        AND "department_id" = c."department_id" AND "trial_round_id" = current_round."id";
    IF arrangement."id" IS NULL THEN
      RAISE EXCEPTION 'retrial hearing head missing' USING ERRCODE = '23514';
    END IF;
    expected_version := arrangement."to_version";
    IF c."current_hearing_advance_id" IS NULL THEN
      IF c."stage" <> 'WAITING_HEARING' THEN
        RAISE EXCEPTION 'retrial scheduled hearing stage mismatch' USING ERRCODE = '23514';
      END IF;
    ELSE
      SELECT "id", "arrangement_id", "to_version" INTO advance FROM "case_hearing_advances"
        WHERE "id" = c."current_hearing_advance_id" AND "case_id" = c."id"
          AND "department_id" = c."department_id" AND "trial_round_id" = current_round."id";
      IF advance."id" IS NULL OR c."stage" <> 'WAITING_JUDGMENT' THEN
        RAISE EXCEPTION 'retrial advance stage/head mismatch' USING ERRCODE = '23514';
      END IF;
      IF advance."arrangement_id" = arrangement."id" THEN
        expected_version := advance."to_version";
      ELSE
        SELECT "id", "to_version" INTO correction FROM "case_hearing_corrections"
          WHERE "new_arrangement_id" = arrangement."id" AND "prior_advance_id" = advance."id"
            AND "case_id" = c."id" AND "department_id" = c."department_id"
            AND "result_stage" = 'WAITING_JUDGMENT';
        IF correction."id" IS NULL OR correction."to_version" <> arrangement."to_version" THEN
          RAISE EXCEPTION 'retrial corrected hearing head mismatch' USING ERRCODE = '23514';
        END IF;
      END IF;
    END IF;
  END IF;
  IF c."version" IS DISTINCT FROM expected_version THEN
    RAISE EXCEPTION 'retrial case version lacks current round fact' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE CONSTRAINT TRIGGER "cases_retrial_prejudgment_version_guard"
  AFTER INSERT OR UPDATE ON "cases" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "check_retrial_prejudgment_version"();

COMMIT;
