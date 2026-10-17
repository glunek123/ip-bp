-- Keep ordinary material references unique by resource, purpose and version.
-- A section correction may freeze the same version again only when this insert
-- is tied to its newly written audit event, typed correction and exact document.
BEGIN;

ALTER TABLE "material_references"
  ADD COLUMN "is_repeatable_typed_reference" boolean NOT NULL DEFAULT false;

DROP INDEX "material_references_resource_purpose_version_key";
CREATE UNIQUE INDEX "material_references_resource_purpose_version_key"
  ON "material_references"("resource_type", "resource_id", "purpose", "content_version_id")
  WHERE "purpose" NOT IN ('JUDGMENT','SECOND_INSTANCE_DOCUMENT','SECOND_INSTANCE_SERVICE','SECOND_INSTANCE_JUDGMENT','EXECUTION_APPLICATION','EXECUTION_FILING_PROOF')
    AND NOT "is_repeatable_typed_reference";

CREATE FUNCTION "classify_case_record_material_reference"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  event_action text;
  exact_document boolean := false;
BEGIN
  -- The marker is derived by the database; INSERT data cannot assert it.
  SELECT a."action" INTO event_action
  FROM "audit_events" a
  WHERE a."id" = NEW."action_event_id"
    AND a."department_id" = NEW."department_id"
    AND a."resource_type" = 'CASE'
    AND a."resource_id" = NEW."resource_id"
    AND a.xmin = pg_current_xact_id()::text::xid;

  IF event_action IN (
    'case.execution.mailing.record-corrected',
    'case.execution.filing.record-corrected',
    'case.execution.finish.record-corrected',
    'case.judgment.record-corrected',
    'case.closure.record-corrected'
  ) THEN
    IF NEW."resource_type" <> 'case' OR NEW."asset_version_id" IS NOT NULL THEN
      RAISE EXCEPTION 'section correction reference has wrong resource'
        USING ERRCODE = '23514';
    END IF;

    CASE event_action
      WHEN 'case.execution.mailing.record-corrected' THEN
        SELECT EXISTS (
          SELECT 1 FROM "case_execution_mailing_record_corrections" c
          JOIN "case_execution_mailing_record_documents" d
            ON d."correction_id" = c."id"
           AND d."case_id" = c."case_id"
           AND d."department_id" = c."department_id"
          WHERE c."audit_event_id" = NEW."action_event_id"
            AND c."case_id" = NEW."resource_id"
            AND c."department_id" = NEW."department_id"
            AND c.xmin = pg_current_xact_id()::text::xid
            AND d."material_id" = NEW."material_id"
            AND d."content_version_id" = NEW."content_version_id"
            AND NEW."purpose" = 'MAIL_RECEIPT'
        ) INTO exact_document;
      WHEN 'case.execution.filing.record-corrected' THEN
        SELECT EXISTS (
          SELECT 1 FROM "case_execution_filing_record_corrections" c
          JOIN "case_execution_filing_record_documents" d
            ON d."correction_id" = c."id"
           AND d."case_id" = c."case_id"
           AND d."department_id" = c."department_id"
          WHERE c."audit_event_id" = NEW."action_event_id"
            AND c."case_id" = NEW."resource_id"
            AND c."department_id" = NEW."department_id"
            AND c.xmin = pg_current_xact_id()::text::xid
            AND d."material_id" = NEW."material_id"
            AND d."content_version_id" = NEW."content_version_id"
            AND NEW."purpose" = 'EXECUTION_FILING_PROOF'
        ) INTO exact_document;
      WHEN 'case.execution.finish.record-corrected' THEN
        SELECT EXISTS (
          SELECT 1 FROM "case_execution_finish_record_corrections" c
          JOIN "case_execution_finish_record_documents" d
            ON d."correction_id" = c."id"
           AND d."case_id" = c."case_id"
           AND d."department_id" = c."department_id"
          WHERE c."audit_event_id" = NEW."action_event_id"
            AND c."case_id" = NEW."resource_id"
            AND c."department_id" = NEW."department_id"
            AND c.xmin = pg_current_xact_id()::text::xid
            AND d."material_id" = NEW."material_id"
            AND d."content_version_id" = NEW."content_version_id"
            AND NEW."purpose" = 'EXECUTION_FINISH_BASIS'
        ) INTO exact_document;
      WHEN 'case.judgment.record-corrected' THEN
        SELECT EXISTS (
          SELECT 1 FROM "case_judgment_record_corrections" c
          JOIN "case_judgment_record_documents" d
            ON d."correction_id" = c."id"
           AND d."case_id" = c."case_id"
           AND d."department_id" = c."department_id"
          WHERE c."audit_event_id" = NEW."action_event_id"
            AND c."case_id" = NEW."resource_id"
            AND c."department_id" = NEW."department_id"
            AND c.xmin = pg_current_xact_id()::text::xid
            AND d."material_id" = NEW."material_id"
            AND d."content_version_id" = NEW."content_version_id"
            AND NEW."purpose" = 'JUDGMENT'
        ) INTO exact_document;
      WHEN 'case.closure.record-corrected' THEN
        SELECT EXISTS (
          SELECT 1 FROM "case_closure_record_corrections" c
          JOIN "case_closure_record_documents" d
            ON d."correction_id" = c."id"
           AND d."case_id" = c."case_id"
           AND d."department_id" = c."department_id"
          WHERE c."audit_event_id" = NEW."action_event_id"
            AND c."case_id" = NEW."resource_id"
            AND c."department_id" = NEW."department_id"
            AND c.xmin = pg_current_xact_id()::text::xid
            AND d."material_id" = NEW."material_id"
            AND d."content_version_id" = NEW."content_version_id"
            AND NEW."purpose" = 'CASE_CLOSURE_DOCUMENT'
        ) INTO exact_document;
    END CASE;

    IF NOT exact_document THEN
      RAISE EXCEPTION 'section correction reference lacks same-transaction typed document'
        USING ERRCODE = '23514';
    END IF;
    NEW."is_repeatable_typed_reference" := true;
  ELSE
    -- A correction action with mismatched case, department, or old audit row
    -- must never become an ordinary reference through a failed proof lookup.
    IF EXISTS (
      SELECT 1 FROM "audit_events" a
      WHERE a."id" = NEW."action_event_id"
        AND a."action" IN (
          'case.execution.mailing.record-corrected',
          'case.execution.filing.record-corrected',
          'case.execution.finish.record-corrected',
          'case.judgment.record-corrected',
          'case.closure.record-corrected'
        )
    ) THEN
      RAISE EXCEPTION 'section correction reference has invalid audit proof'
        USING ERRCODE = '23514';
    END IF;
    NEW."is_repeatable_typed_reference" := false;
  END IF;

  IF NEW."purpose" NOT IN ('JUDGMENT','SECOND_INSTANCE_DOCUMENT','SECOND_INSTANCE_SERVICE','SECOND_INSTANCE_JUDGMENT','EXECUTION_APPLICATION','EXECUTION_FILING_PROOF') THEN
    -- Both ordinary and correction inserts take this lock, so an ordinary
    -- insert cannot race past a correction that has already consumed the key.
    PERFORM pg_advisory_xact_lock(hashtextextended(
      concat_ws(chr(31), NEW."resource_type", NEW."resource_id"::text,
        NEW."purpose", NEW."content_version_id"::text), 0));
    IF NOT NEW."is_repeatable_typed_reference" AND EXISTS (
      SELECT 1 FROM "material_references" r
      WHERE r."resource_type" = NEW."resource_type"
        AND r."resource_id" = NEW."resource_id"
        AND r."purpose" = NEW."purpose"
        AND r."content_version_id" = NEW."content_version_id"
        AND r."is_repeatable_typed_reference"
    ) AND NOT EXISTS (
      SELECT 1 FROM "material_references" r
      WHERE r."resource_type" = NEW."resource_type"
        AND r."resource_id" = NEW."resource_id"
        AND r."purpose" = NEW."purpose"
        AND r."content_version_id" = NEW."content_version_id"
        AND NOT r."is_repeatable_typed_reference"
    ) THEN
      RAISE EXCEPTION 'ordinary material reference already consumed by correction'
        USING ERRCODE = '23505', CONSTRAINT = 'material_references_resource_purpose_version_key';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER "material_references_repeatable_typed_insert"
  BEFORE INSERT ON "material_references"
  FOR EACH ROW EXECUTE FUNCTION "classify_case_record_material_reference"();

CREATE FUNCTION "reject_material_reference_classification_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."is_repeatable_typed_reference" IS DISTINCT FROM OLD."is_repeatable_typed_reference" THEN
    RAISE EXCEPTION 'material reference classification is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER "material_references_repeatable_typed_immutable"
  BEFORE UPDATE ON "material_references"
  FOR EACH ROW EXECUTE FUNCTION "reject_material_reference_classification_change"();

-- Four older purpose-wide BEFORE INSERT guards accept only their original
-- workflow facts. Add one exact, same-transaction record-correction branch to
-- each; retain every byte of the verified ordinary guard body after it.
DO $repair_original_reference_guards$
DECLARE
  target record;
  function_oid oid;
  old_body text;
  proof_branch text;
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('check_case_execution_filing_reference','89c9b856dd7eea9a9a4da9cf38cbf425','case.execution.filing.record-corrected','EXECUTION_FILING_PROOF','case_execution_filing_record_corrections','case_execution_filing_record_documents'),
    ('check_case_execution_finish_reference','93a253023e12d75047452f8d49cc161c','case.execution.finish.record-corrected','EXECUTION_FINISH_BASIS','case_execution_finish_record_corrections','case_execution_finish_record_documents'),
    ('check_case_judgment_reference_insert','1399d74e07a16c67aa079c1dfeff7f23','case.judgment.record-corrected','JUDGMENT','case_judgment_record_corrections','case_judgment_record_documents'),
    ('check_case_closure_reference','e8632d06bbde700ddb67828136f7a9eb','case.closure.record-corrected','CASE_CLOSURE_DOCUMENT','case_closure_record_corrections','case_closure_record_documents')
  ) AS expected(name,body_md5,action,purpose,correction_table,document_table) LOOP
    SELECT p.oid,p.prosrc INTO function_oid,old_body
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname=current_schema() AND p.proname=target.name
      AND p.pronargs=0 AND p.prorettype='trigger'::regtype
      AND l.lanname='plpgsql' AND NOT p.prosecdef;
    IF function_oid IS NULL OR md5(old_body)<>target.body_md5 OR
      length(old_body)-length(replace(old_body,E'\nBEGIN\n',''))<>length(E'\nBEGIN\n') THEN
      RAISE EXCEPTION 'unrecognized original material reference guard %',target.name
        USING ERRCODE='23514';
    END IF;
    proof_branch:=format($branch$
  IF EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id"=NEW."action_event_id" AND a."action"=%L) THEN
    IF NOT EXISTS (
      SELECT 1 FROM "audit_events" a
      JOIN %I c ON c."audit_event_id"=a."id"
      JOIN %I d ON d."correction_id"=c."id" AND d."case_id"=c."case_id"
        AND d."department_id"=c."department_id"
      WHERE a."id"=NEW."action_event_id" AND a."department_id"=NEW."department_id"
        AND a."resource_type"='CASE' AND a."resource_id"=NEW."resource_id"
        AND a.xmin=pg_current_xact_id()::text::xid
        AND c."case_id"=NEW."resource_id" AND c."department_id"=NEW."department_id"
        AND c.xmin=pg_current_xact_id()::text::xid
        AND d."material_id"=NEW."material_id"
        AND d."content_version_id"=NEW."content_version_id"
        AND NEW."resource_type"='case' AND NEW."purpose"=%L
        AND NEW."asset_version_id" IS NULL
    ) THEN RAISE EXCEPTION 'record correction reference lacks exact typed document'
      USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
$branch$,target.action,target.correction_table,target.document_table,target.purpose);
    EXECUTE format('CREATE OR REPLACE FUNCTION %I.%I() RETURNS trigger LANGUAGE plpgsql AS %L',
      current_schema(),target.name,replace(old_body,E'\nBEGIN\n',E'\nBEGIN\n'||proof_branch));
    IF (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname=current_schema() AND p.proname=target.name AND p.pronargs=0)
       IS DISTINCT FROM function_oid THEN
      RAISE EXCEPTION 'material reference guard identity changed %',target.name
        USING ERRCODE='23514';
    END IF;
  END LOOP;
END; $repair_original_reference_guards$;

COMMIT;
