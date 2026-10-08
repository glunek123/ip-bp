-- Forward-only convergence for partial 240/250 Prisma deploy failures.
-- Existing business rows are never rewritten or deleted. Keep this migration atomic.
BEGIN;
DO $repair$
DECLARE
  schema_name text := current_schema();
  expected_function text := $body$
DECLARE selected_ids JSONB;
BEGIN
  SELECT a."details"->'judgmentContentVersionIds' INTO selected_ids
    FROM "case_judgment_facts" f JOIN "audit_events" a ON a."id" = f."audit_event_id"
    WHERE f."id" = NEW."fact_id" AND f."case_id" = NEW."case_id" AND f."department_id" = NEW."department_id"
    FOR UPDATE OF f;
  IF jsonb_typeof(selected_ids) IS DISTINCT FROM 'array' OR NOT (selected_ids ? NEW."content_version_id"::text) OR
     EXISTS (SELECT 1 FROM "case_judgment_receipts" r WHERE r."result_snapshot"->>'judgmentId' = NEW."fact_id"::text) OR
     NOT EXISTS (
       SELECT 1 FROM "materials" m JOIN "content_versions" v ON v."material_id" = m."id"
       WHERE m."id" = NEW."material_id" AND v."id" = NEW."content_version_id"
         AND m."department_id" = NEW."department_id" AND m."owner_type" = 'CASE' AND m."owner_id" = NEW."case_id"
         AND m."category" = 'JUDGMENT' AND m."purpose" = 'JUDGMENT' AND m."status" = 'ACTIVE'
         AND v."status" = 'AVAILABLE' AND v."size_bytes" <= 52428800
         AND v."mime_type" IN ('application/pdf','image/jpeg','image/png')
         AND (m."current_version_id" = v."id" OR EXISTS (
           SELECT 1 FROM "case_judgment_versions" prior_version WHERE prior_version."material_id" = m."id"
             AND prior_version."content_version_id" = v."id" AND prior_version."case_id" = NEW."case_id"))
     ) THEN
    RAISE EXCEPTION 'judgment frozen version mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$body$;
  actual_function text;
  function_oid oid;
  existing_constraint record;
  existing_index record;
  wanted record;
  object_oid oid;
  normalized_predicate text;
BEGIN
  IF schema_name IS NULL THEN RAISE EXCEPTION 'schema is required' USING ERRCODE = '23514'; END IF;
  SELECT p.oid, p.prosrc INTO function_oid, actual_function
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = schema_name AND p.proname = 'check_case_judgment_version'
      AND p.pronargs = 0 AND p.prorettype = 'trigger'::regtype AND l.lanname = 'plpgsql'
      AND NOT p.prosecdef;
  IF function_oid IS NULL OR
     btrim(replace(actual_function, E'\r', '')) NOT IN (
       btrim(expected_function),
       btrim(replace(expected_function, 'prior_version', 'old'))
     ) THEN
    RAISE EXCEPTION 'unknown judgment version guard definition' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = schema_name AND c.relname = 'case_judgment_versions'
      AND t.tgname = 'case_judgment_versions_guard' AND t.tgfoid = function_oid
      AND t.tgenabled = 'O' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'unknown judgment version trigger' USING ERRCODE = '23514';
  END IF;

  -- The old four-column constraint may still exist when 250 failed before its DROP.
  SELECT c.oid, c.contype, c.conindid,
    ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.ord) AS columns
    INTO existing_constraint
    FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = schema_name AND r.relname = 'material_references'
      AND c.conname = 'material_references_resource_purpose_version_key';
  IF FOUND THEN
    IF existing_constraint.contype <> 'u' OR existing_constraint.conindid = 0 OR
       existing_constraint.columns <> ARRAY['resource_type','resource_id','purpose','content_version_id']::text[] OR
       NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = existing_constraint.conindid
         AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive) THEN
      RAISE EXCEPTION 'unknown original material reference constraint' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM "material_references" WHERE "purpose" = 'JUDGMENT' AND "action_event_id" IS NULL) OR
     EXISTS (SELECT 1 FROM "material_references" WHERE "purpose" = 'JUDGMENT'
       GROUP BY "resource_type", "resource_id", "purpose", "content_version_id", "action_event_id" HAVING COUNT(*) > 1) OR
     EXISTS (SELECT 1 FROM "material_references" WHERE "purpose" <> 'JUDGMENT'
       GROUP BY "resource_type", "resource_id", "purpose", "content_version_id" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'material reference data violates target uniqueness' USING ERRCODE = '23514';
  END IF;

  -- Missing 240 indexes are created only after catalog validation below.
  FOR wanted IN SELECT * FROM (VALUES
    ('cases_current_judgment_id_id_department_id_key', 'cases', ARRAY['current_judgment_id','id','department_id']::text[], false),
    ('case_judgment_facts_prior_fact_id_case_id_department_id_key', 'case_judgment_facts', ARRAY['prior_fact_id','case_id','department_id']::text[], false)
  ) AS targets(index_name, table_name, columns, partial) LOOP
    SELECT c.oid INTO object_oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = schema_name AND c.relname = wanted.index_name;
    IF object_oid IS NULL THEN
      EXECUTE format('CREATE UNIQUE INDEX %I ON %I.%I (%s)', wanted.index_name, schema_name,
        wanted.table_name, array_to_string(wanted.columns, ', '));
    END IF;
  END LOOP;
  IF btrim(replace(actual_function, E'\r', '')) <> btrim(expected_function) THEN
    EXECUTE format('CREATE OR REPLACE FUNCTION %I.check_case_judgment_version() RETURNS trigger LANGUAGE plpgsql AS %L',
      schema_name, expected_function);
  END IF;

  IF existing_constraint.oid IS NOT NULL THEN
    EXECUTE format('ALTER TABLE %I.material_references DROP CONSTRAINT material_references_resource_purpose_version_key', schema_name);
  END IF;
  SELECT c.oid, c.contype, regexp_replace(pg_get_constraintdef(c.oid), '[()"[:space:]]', '', 'g') AS definition
    INTO existing_constraint
    FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = schema_name AND r.relname = 'material_references'
      AND c.conname = 'material_references_judgment_event_check';
  IF NOT FOUND THEN
    EXECUTE format('ALTER TABLE %I.material_references ADD CONSTRAINT material_references_judgment_event_check CHECK ("purpose" <> ''JUDGMENT'' OR "action_event_id" IS NOT NULL)', schema_name);
  ELSIF existing_constraint.contype <> 'c' OR
    existing_constraint.definition <> 'CHECKpurpose::text<>''JUDGMENT''::textORaction_event_idISNOTNULL' THEN
    RAISE EXCEPTION 'unknown judgment event check definition' USING ERRCODE = '23514';
  END IF;

  FOR wanted IN SELECT * FROM (VALUES
    ('material_references_resource_purpose_version_key', ARRAY['resource_type','resource_id','purpose','content_version_id']::text[], true),
    ('material_references_resource_purpose_version_event_key', ARRAY['resource_type','resource_id','purpose','content_version_id','action_event_id']::text[], false)
  ) AS targets(index_name, columns, partial) LOOP
    SELECT c.oid INTO object_oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = schema_name AND c.relname = wanted.index_name;
    IF object_oid IS NULL THEN
      EXECUTE format('CREATE UNIQUE INDEX %I ON %I.material_references (%s)%s', wanted.index_name,
        schema_name, array_to_string(wanted.columns, ', '),
        CASE WHEN wanted.partial THEN ' WHERE "purpose" <> ''JUDGMENT''' ELSE '' END);
    END IF;
  END LOOP;

  -- Check every named object, including pre-existing ones that IF NOT EXISTS would mask.
  FOR wanted IN SELECT * FROM (VALUES
    ('cases_current_judgment_id_id_department_id_key', 'cases', ARRAY['current_judgment_id','id','department_id']::text[], false),
    ('case_judgment_facts_prior_fact_id_case_id_department_id_key', 'case_judgment_facts', ARRAY['prior_fact_id','case_id','department_id']::text[], false),
    ('material_references_resource_purpose_version_key', 'material_references', ARRAY['resource_type','resource_id','purpose','content_version_id']::text[], true),
    ('material_references_resource_purpose_version_event_key', 'material_references', ARRAY['resource_type','resource_id','purpose','content_version_id','action_event_id']::text[], false)
  ) AS targets(index_name, table_name, columns, partial) LOOP
    SELECT i.indisunique, i.indisvalid, i.indisready, i.indislive, i.indnkeyatts, i.indnatts,
      am.amname AS method, r.relname AS table_name, i.indexprs IS NULL AS no_expression,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum ORDER BY k.ord) AS columns,
      regexp_replace(COALESCE(pg_get_expr(i.indpred, i.indrelid), ''), '[()"[:space:]]', '', 'g') AS predicate
      INTO existing_index
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
      JOIN pg_class r ON r.oid = i.indrelid
      JOIN pg_am am ON am.oid = c.relam
      WHERE n.nspname = schema_name AND c.relname = wanted.index_name;
    normalized_predicate := CASE WHEN wanted.partial THEN 'purpose::text<>''JUDGMENT''::text' ELSE '' END;
    IF NOT FOUND OR NOT existing_index.indisunique OR NOT existing_index.indisvalid OR
      NOT existing_index.indisready OR NOT existing_index.indislive OR
      existing_index.indnkeyatts <> cardinality(wanted.columns) OR
      existing_index.indnatts <> cardinality(wanted.columns) OR
      existing_index.method <> 'btree' OR existing_index.table_name <> wanted.table_name OR
      NOT existing_index.no_expression OR existing_index.columns <> wanted.columns OR
      existing_index.predicate <> normalized_predicate THEN
      RAISE EXCEPTION 'unknown or invalid judgment migration index %', wanted.index_name USING ERRCODE = '23514';
    END IF;
  END LOOP;
  SELECT c.contype, regexp_replace(pg_get_constraintdef(c.oid), '[()"[:space:]]', '', 'g') AS definition
    INTO existing_constraint
    FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = schema_name AND r.relname = 'material_references'
      AND c.conname = 'material_references_judgment_event_check';
  IF NOT FOUND OR existing_constraint.contype <> 'c' OR
    existing_constraint.definition <> 'CHECKpurpose::text<>''JUDGMENT''::textORaction_event_idISNOTNULL' THEN
    RAISE EXCEPTION 'judgment event check mismatch' USING ERRCODE = '23514';
  END IF;
END;
$repair$;
COMMIT;
