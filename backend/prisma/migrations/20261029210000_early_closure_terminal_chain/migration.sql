-- Add the third, fact-anchored closure version seed. The historical finish
-- and external-entry branches remain byte-for-byte in the existing function.
-- This does not remove the 120000 early-source INSERT gate.
BEGIN;

DO $chain$
DECLARE
  definition text;
  needle text := 'IF target_finish IS NULL THEN';
  branch text := $body$
IF target_finish IS NULL AND EXISTS (
  SELECT 1 FROM "case_early_closures" e WHERE e."case_id"=target_case AND e."department_id"=target_department
) THEN
  DECLARE early record; h record; v record; terminal integer; expected_prior uuid; seen integer:=0;
  BEGIN
    SELECT * INTO early FROM "case_early_closures" WHERE "case_id"=target_case AND "department_id"=target_department;
    IF early."id" IS NULL OR early."from_version"<1 OR early."to_version" IS DISTINCT FROM early."from_version"+1 OR
       finish_version IS DISTINCT FROM early."to_version" OR
       EXISTS (SELECT 1 FROM "case_execution_finishes" WHERE "case_id"=target_case AND "department_id"=target_department) OR
       EXISTS (SELECT 1 FROM "case_early_archives" WHERE "case_id"=target_case AND "department_id"=target_department)
    THEN RAISE EXCEPTION 'invalid early closure source seed' USING ERRCODE='23514'; END IF;
    SELECT * INTO h FROM "case_closures" WHERE "case_id"=target_case AND "department_id"=target_department;
    IF h."id" IS NULL THEN RETURN early."to_version"; END IF;
    IF h."early_closure_id" IS DISTINCT FROM early."id" OR h."finish_id" IS NOT NULL OR
       h."external_entry_id" IS NOT NULL OR h."current_version_id" IS NULL
    THEN RAISE EXCEPTION 'invalid early closure head' USING ERRCODE='23514'; END IF;
    terminal:=early."to_version";
    FOR v IN SELECT * FROM "case_closure_versions" WHERE "closure_id"=h."id" AND
      "case_id"=target_case AND "department_id"=target_department ORDER BY "from_version" LOOP
      IF v."early_closure_id" IS DISTINCT FROM early."id" OR v."finish_id" IS NOT NULL OR
         v."external_entry_id" IS NOT NULL OR v."from_version" IS DISTINCT FROM terminal OR
         v."to_version" IS DISTINCT FROM terminal+1 OR
         v."prior_version_id" IS DISTINCT FROM expected_prior OR
         (seen=0 AND v."kind"<>'REGISTER') OR (seen>0 AND v."kind"<>'CORRECT')
      THEN RAISE EXCEPTION 'broken early closure chain' USING ERRCODE='23514'; END IF;
      terminal:=v."to_version"; expected_prior:=v."id"; seen:=seen+1;
    END LOOP;
    IF seen=0 OR expected_prior IS DISTINCT FROM h."current_version_id" THEN
      RAISE EXCEPTION 'nonterminal early closure head' USING ERRCODE='23514';
    END IF;
    RETURN terminal;
  END;
END IF;
$body$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=current_schema() AND p.proname='case_closure_source_terminal_version' AND p.pronargs=4;
  IF definition IS NULL OR position(needle IN definition)=0 OR
     position('early_closure_id' IN definition)>0 OR
     (length(definition)-length(replace(definition,needle,'')))<>length(needle) THEN
    RAISE EXCEPTION 'closure source terminal function changed' USING ERRCODE='23514';
  END IF;
  EXECUTE replace(definition,needle,branch || E'\n ' || needle);
END;
$chain$;

COMMIT;
