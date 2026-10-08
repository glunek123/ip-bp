-- Keep Prisma's composite relation keys represented in PostgreSQL metadata.
CREATE UNIQUE INDEX "cases_current_judgment_id_id_department_id_key"
  ON "cases"("current_judgment_id", "id", "department_id");
CREATE UNIQUE INDEX "case_judgment_facts_prior_fact_id_case_id_department_id_key"
  ON "case_judgment_facts"("prior_fact_id", "case_id", "department_id");

-- PL/pgSQL's OLD transition record conflicts with an unquoted SQL alias named old.
CREATE OR REPLACE FUNCTION "check_case_judgment_version"() RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;
