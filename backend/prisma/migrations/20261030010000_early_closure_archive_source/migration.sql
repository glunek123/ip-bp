-- Extend archive source selection only. Preserve all historical archive actor,
-- chain, audit, receipt and note checks. The 120000 INSERT gate stays enabled;
-- this draft does not authorize third-source archiving or implement finance.
BEGIN;

DO $archive_source$
DECLARE
  function_name text;
  definition text;
  opening text := 'IF f."id" IS NULL THEN';
  closing text;
  source_args text;
  branch text := $branch$IF closure_head."early_closure_id" IS NOT NULL THEN
  DECLARE early record;
  BEGIN
    SELECT * INTO early FROM "case_early_closures" WHERE "id"=closure_head."early_closure_id"
      AND "case_id"=closure_head."case_id" AND "department_id"=closure_head."department_id";
    IF early."id" IS NULL OR closure_head."finish_id" IS NOT NULL OR
       closure_head."external_entry_id" IS NOT NULL OR f."id" IS NOT NULL OR
       early."from_version"<1 OR early."to_version" IS DISTINCT FROM early."from_version"+1 OR
       EXISTS (SELECT 1 FROM "case_execution_finishes" WHERE "case_id"=closure_head."case_id" AND "department_id"=closure_head."department_id") OR
       EXISTS (SELECT 1 FROM "case_early_archives" WHERE "case_id"=closure_head."case_id" AND "department_id"=closure_head."department_id")
    THEN RAISE EXCEPTION 'archive lacks exact early closure root' USING ERRCODE='23514'; END IF;
    terminal:=case_closure_source_terminal_version(closure_head."case_id",closure_head."department_id",NULL,early."to_version");
  END;
 ELSE
 IF f."id" IS NULL THEN$branch$;
BEGIN
  FOREACH function_name IN ARRAY ARRAY['check_case_archive_actor','check_case_archive_final'] LOOP
    source_args := CASE WHEN function_name='check_case_archive_actor' THEN 'c."id",c."department_id"' ELSE 'target_case,target_department' END;
    closing := 'terminal:=case_closure_source_terminal_version(' || source_args || E',f."id",f."to_version");\n END IF;';
    SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=current_schema() AND p.proname=function_name AND p.pronargs=0;
    IF definition IS NULL OR position('early_closure_id' IN definition)>0 OR
       position('closure_head record;' IN definition)=0 OR
       (length(definition)-length(replace(definition,opening,'')))<>length(opening) OR
       (length(definition)-length(replace(definition,closing,'')))<>length(closing) THEN
      RAISE EXCEPTION 'archive source guard changed: %', function_name USING ERRCODE='23514';
    END IF;
    definition:=replace(definition,opening,branch);
    definition:=replace(definition,closing,closing || E'\n END IF;');
    EXECUTE definition;
  END LOOP;
END;
$archive_source$;

-- The source-neutral archive terminal/receipt protocols retain exact closure
-- and closure-version anchors; no protocol or financial predicate is removed.
COMMIT;
