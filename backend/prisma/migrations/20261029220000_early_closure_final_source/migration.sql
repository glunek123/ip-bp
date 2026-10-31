-- Add only the fact-anchored branch to the closure final guard. Its existing
-- audit, document-reference, receipt, stage and terminal checks still run.
-- The 120000 early-source INSERT gate remains in force.
BEGIN;

DO $final$
DECLARE
  definition text;
  old_decl text := 'entry_root "case_external_entries"%ROWTYPE;';
  old_open text := 'IF f."id" IS NULL THEN';
  old_close text := E'base_version:=f."to_version";\n END IF;';
  old_version_source text := '(f."id" IS NULL AND v."external_entry_id" IS DISTINCT FROM entry_root."id")';
  new_open text := $part$IF h."early_closure_id" IS NOT NULL THEN
  SELECT * INTO early FROM "case_early_closures" WHERE "id"=h."early_closure_id" AND
    "case_id"=target_case AND "department_id"=target_department;
  IF early."id" IS NULL OR h."finish_id" IS NOT NULL OR h."external_entry_id" IS NOT NULL OR
     f."id" IS NOT NULL OR EXISTS (SELECT 1 FROM "case_early_archives" WHERE "case_id"=target_case AND "department_id"=target_department)
  THEN RAISE EXCEPTION 'closure lacks exact early source root' USING ERRCODE='23514'; END IF;
  base_version:=early."to_version";
 ELSE
 IF f."id" IS NULL THEN$part$;
  new_version_source text := '(v."early_closure_id" IS DISTINCT FROM h."early_closure_id") OR (f."id" IS NULL AND h."early_closure_id" IS NULL AND v."external_entry_id" IS DISTINCT FROM entry_root."id")';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=current_schema() AND p.proname='check_case_closure_final' AND p.pronargs=0;
  IF definition IS NULL OR position('early_closure_id' IN definition)>0 OR
     position(old_decl IN definition)=0 OR position(old_open IN definition)=0 OR
     position(old_close IN definition)=0 OR position(old_version_source IN definition)=0 THEN
    RAISE EXCEPTION 'closure final guard changed' USING ERRCODE='23514';
  END IF;
  definition:=replace(definition,old_decl,old_decl || ' early record;');
  definition:=replace(definition,old_open,new_open);
  definition:=replace(definition,old_close,old_close || E'\n END IF;');
  definition:=replace(definition,old_version_source,new_version_source);
  EXECUTE definition;
END;
$final$;

COMMIT;
