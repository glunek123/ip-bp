-- Forward-only guard for committed judgment references and strict trigger identity.
-- No existing business row is updated or deleted.
BEGIN;
DO $migration$
DECLARE
  schema_name text := current_schema();
  original_guard_oid oid;
  reference_guard_oid oid;
  actual_body text;
  expected_body text := $body$
BEGIN
  IF OLD."purpose" = 'JUDGMENT' OR
     (TG_OP = 'UPDATE' AND NEW."purpose" = 'JUDGMENT') THEN
    RAISE EXCEPTION 'judgment material reference is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$body$;
BEGIN
  IF schema_name IS NULL THEN
    RAISE EXCEPTION 'schema is required' USING ERRCODE = '23514';
  END IF;
  SELECT p.oid INTO original_guard_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = schema_name AND p.proname = 'check_case_judgment_version'
      AND p.pronargs = 0 AND p.prorettype = 'trigger'::regtype
      AND l.lanname = 'plpgsql' AND NOT p.prosecdef;
  IF original_guard_oid IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = schema_name AND c.relname = 'case_judgment_versions'
      AND t.tgname = 'case_judgment_versions_guard' AND t.tgfoid = original_guard_oid
      AND t.tgtype = 7 -- BEFORE INSERT FOR EACH ROW, no other events
      AND t.tgenabled = 'O' AND NOT t.tgisinternal AND t.tgparentid = 0
      AND t.tgqual IS NULL AND t.tgnargs = 0 AND t.tgargs = ''::bytea
      AND t.tgattr::text = '' AND t.tgconstraint = 0
      AND NOT t.tgdeferrable AND NOT t.tginitdeferred
  ) THEN
    RAISE EXCEPTION 'unknown judgment version trigger definition' USING ERRCODE = '23514';
  END IF;

  SELECT p.oid, p.prosrc INTO reference_guard_oid, actual_body
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = schema_name AND p.proname = 'check_case_judgment_reference_immutable'
      AND p.pronargs = 0 AND p.prorettype = 'trigger'::regtype
      AND l.lanname = 'plpgsql' AND NOT p.prosecdef;
  IF reference_guard_oid IS NULL THEN
    EXECUTE format('CREATE FUNCTION %I.check_case_judgment_reference_immutable() RETURNS trigger LANGUAGE plpgsql AS %L',
      schema_name, expected_body);
    SELECT p.oid INTO reference_guard_oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = schema_name AND p.proname = 'check_case_judgment_reference_immutable'
        AND p.pronargs = 0;
  ELSIF btrim(replace(actual_body, E'\r', '')) <> btrim(expected_body) THEN
    RAISE EXCEPTION 'unknown judgment reference guard function' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = schema_name AND c.relname = 'material_references'
      AND t.tgname = 'material_references_judgment_immutable_guard'
  ) THEN
    EXECUTE format('CREATE TRIGGER material_references_judgment_immutable_guard BEFORE UPDATE OR DELETE ON %I.material_references FOR EACH ROW EXECUTE FUNCTION %I.check_case_judgment_reference_immutable()',
      schema_name, schema_name);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = schema_name AND c.relname = 'material_references'
      AND t.tgname = 'material_references_judgment_immutable_guard'
      AND t.tgfoid = reference_guard_oid AND t.tgtype = 27 -- BEFORE UPDATE OR DELETE FOR EACH ROW
      AND t.tgenabled = 'O' AND NOT t.tgisinternal AND t.tgparentid = 0
      AND t.tgqual IS NULL AND t.tgnargs = 0 AND t.tgargs = ''::bytea
      AND t.tgattr::text = '' AND t.tgconstraint = 0
      AND NOT t.tgdeferrable AND NOT t.tginitdeferred
  ) THEN
    RAISE EXCEPTION 'unknown judgment reference trigger definition' USING ERRCODE = '23514';
  END IF;
END;
$migration$;
COMMIT;
