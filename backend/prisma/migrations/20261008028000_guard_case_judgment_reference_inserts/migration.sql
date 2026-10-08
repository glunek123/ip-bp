-- Forward-only guard for the exact judgment reference set.
-- A judgment reference is written after its version and before its receipt.
BEGIN;
DO $migration$
DECLARE
  schema_name text := current_schema();
  guard_oid oid;
  actual_body text;
  expected_body text := $body$
DECLARE target_fact_id uuid;
BEGIN
  IF NEW."purpose" <> 'JUDGMENT' THEN RETURN NEW; END IF;
  SELECT f."id" INTO target_fact_id
    FROM "case_judgment_facts" f
    WHERE NEW."resource_type" = 'case' AND f."case_id" = NEW."resource_id"
      AND f."department_id" = NEW."department_id"
      AND f."audit_event_id" = NEW."action_event_id"
    FOR UPDATE OF f;
  IF target_fact_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM "case_judgment_versions" v
    WHERE v."fact_id" = target_fact_id AND v."case_id" = NEW."resource_id"
      AND v."department_id" = NEW."department_id"
      AND v."material_id" = NEW."material_id"
      AND v."content_version_id" = NEW."content_version_id"
  ) OR EXISTS (
    SELECT 1 FROM "case_judgment_receipts" r
    WHERE r."case_id" = NEW."resource_id" AND r."department_id" = NEW."department_id"
      AND r."result_snapshot"->>'judgmentId' = target_fact_id::text
  ) THEN
    RAISE EXCEPTION 'judgment reference requires an open matching fact and version'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$body$;
BEGIN
  IF schema_name IS NULL THEN
    RAISE EXCEPTION 'schema is required' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "material_references" r
    LEFT JOIN "case_judgment_facts" f ON f."audit_event_id" = r."action_event_id"
      AND f."case_id" = r."resource_id" AND f."department_id" = r."department_id"
      AND r."resource_type" = 'case'
    LEFT JOIN "case_judgment_versions" v ON v."fact_id" = f."id"
      AND v."case_id" = r."resource_id" AND v."department_id" = r."department_id"
      AND v."material_id" = r."material_id" AND v."content_version_id" = r."content_version_id"
    WHERE r."purpose" = 'JUDGMENT' AND (f."id" IS NULL OR v."fact_id" IS NULL)
  ) THEN
    RAISE EXCEPTION 'existing judgment reference has no matching fact and version'
      USING ERRCODE = '23514';
  END IF;
  SELECT p.oid, p.prosrc INTO guard_oid, actual_body
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = schema_name AND p.proname = 'check_case_judgment_reference_insert'
      AND p.pronargs = 0 AND p.prorettype = 'trigger'::regtype
      AND l.lanname = 'plpgsql' AND NOT p.prosecdef;
  IF guard_oid IS NULL THEN
    EXECUTE format('CREATE FUNCTION %I.check_case_judgment_reference_insert() RETURNS trigger LANGUAGE plpgsql AS %L',
      schema_name, expected_body);
    SELECT p.oid INTO guard_oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = schema_name AND p.proname = 'check_case_judgment_reference_insert'
        AND p.pronargs = 0;
  ELSIF btrim(replace(actual_body, E'\r', '')) <> btrim(expected_body) THEN
    RAISE EXCEPTION 'unknown judgment reference insert function' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = schema_name AND c.relname = 'material_references'
      AND t.tgname = 'material_references_judgment_insert_guard'
  ) THEN
    EXECUTE format('CREATE TRIGGER material_references_judgment_insert_guard BEFORE INSERT ON %I.material_references FOR EACH ROW EXECUTE FUNCTION %I.check_case_judgment_reference_insert()',
      schema_name, schema_name);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = schema_name AND c.relname = 'material_references'
      AND t.tgname = 'material_references_judgment_insert_guard'
      AND t.tgfoid = guard_oid AND t.tgtype = 7 -- BEFORE INSERT FOR EACH ROW
      AND t.tgenabled = 'O' AND NOT t.tgisinternal AND t.tgparentid = 0
      AND t.tgqual IS NULL AND t.tgnargs = 0 AND t.tgargs = ''::bytea
      AND t.tgattr::text = '' AND t.tgconstraint = 0
      AND NOT t.tgdeferrable AND NOT t.tginitdeferred
  ) THEN
    RAISE EXCEPTION 'unknown judgment reference insert trigger' USING ERRCODE = '23514';
  END IF;
END;
$migration$;
COMMIT;
