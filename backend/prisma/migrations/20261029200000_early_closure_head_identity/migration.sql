-- Strengthen the closure head for the third source without enabling it.
-- Existing source-terminal/final guards still reject early-closure writes.
BEGIN;

DO $head$
DECLARE
  definition text;
  old_identity text := 'NEW."finish_id" IS DISTINCT FROM OLD."finish_id" OR NEW."current_version_id" IS NULL';
  new_identity text := 'NEW."finish_id" IS DISTINCT FROM OLD."finish_id" OR NEW."external_entry_id" IS DISTINCT FROM OLD."external_entry_id" OR NEW."early_closure_id" IS DISTINCT FROM OLD."early_closure_id" OR NEW."current_version_id" IS NULL';
  old_version text := 'v."finish_id" IS NOT DISTINCT FROM OLD."finish_id" AND v."prior_version_id" IS NOT DISTINCT FROM OLD."current_version_id"';
  new_version text := 'v."finish_id" IS NOT DISTINCT FROM OLD."finish_id" AND v."external_entry_id" IS NOT DISTINCT FROM OLD."external_entry_id" AND v."early_closure_id" IS NOT DISTINCT FROM OLD."early_closure_id" AND v."prior_version_id" IS NOT DISTINCT FROM OLD."current_version_id"';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname = 'check_case_closure_head_mutation' AND p.pronargs = 0;
  IF definition IS NULL OR position(old_identity IN definition) = 0 OR
     position(old_version IN definition) = 0 OR
     position('early_closure_id' IN definition) > 0 THEN
    RAISE EXCEPTION 'closure head guard changed' USING ERRCODE = '23514';
  END IF;
  definition := replace(replace(definition, old_identity, new_identity), old_version, new_version);
  EXECUTE definition;
END;
$head$;

COMMIT;
