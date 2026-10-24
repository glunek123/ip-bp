-- An external case with a later real appeal must retain its external source chain.
-- A normal-source appeal has no case_external_entries row; keep its existing
-- choice, version, pointer, audit, receipt and material checks unchanged.
DO $migration$
DECLARE definition text; needle text; replacement text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=current_schema() AND p.proname='check_case_second_instance_final' AND p.pronargs=0;

  -- The entire prior clause is the expected upstream branch fingerprint.
  -- Later migrations change other portions of this function, not this clause.
  needle := $guard$
    IF NOT EXISTS (SELECT 1 FROM "case_judgment_next_steps" actual
      JOIN "case_judgment_facts" judgment ON judgment."id"=actual."judgment_id"
      JOIN "case_external_entries" e ON e."case_id"=actual."case_id" AND e."department_id"=actual."department_id"
      WHERE actual."id"=NEW."choice_id" AND actual."trial_round_id"=NEW."trial_round_id"
        AND actual."case_id"=NEW."case_id" AND actual."department_id"=NEW."department_id"
        AND actual."external_entry_id"=e."id" AND judgment."external_entry_id"=e."id"
        AND judgment."trial_round_id"=NEW."trial_round_id" AND actual."next"='APPEAL'
        AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_step_revocations" v WHERE v."choice_id"=actual."id")) THEN
      RAISE EXCEPTION 'external real appeal requires true source choice/judgment' USING ERRCODE='23514';
    END IF;$guard$;
  IF definition IS NOT NULL AND position(needle IN definition)=0 THEN
    needle := replace(needle,E'\n',E'\r\n');
  END IF;
  replacement := replace(needle,
    'IF NOT EXISTS (SELECT 1 FROM "case_judgment_next_steps" actual',
    'IF EXISTS (SELECT 1 FROM "case_external_entries" entry'
      || ' WHERE entry."case_id"=target_case AND entry."department_id"=target_department)'
      || CASE WHEN position(E'\r\n' IN needle)>0 THEN E'\r\n    ' ELSE E'\n    ' END
      || 'AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_steps" actual');
  IF definition IS NULL OR
     (length(definition)-length(replace(definition,needle,''))) / length(needle) <> 1 THEN
    RAISE EXCEPTION 'unknown second-instance progress source guard' USING ERRCODE='23514';
  END IF;

  EXECUTE replace(definition,needle,replacement);
END;
$migration$;
