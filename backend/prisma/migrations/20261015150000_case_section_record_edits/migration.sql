-- Additive only: original workflow facts, receipts, source and archive anchors stay frozen.
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.execution.mailing.correct';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.execution.filing.correct';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.execution.finish.correct';

BEGIN;
CREATE TYPE "case_section_record_edit_command" AS ENUM ('EXECUTION_MAILING_CORRECTION', 'EXECUTION_FILING_CORRECTION', 'EXECUTION_FINISH_CORRECTION', 'HEARING_RECORD_CORRECTION', 'JUDGMENT_RECORD_CORRECTION', 'CLOSURE_RECORD_CORRECTION');

CREATE TABLE "case_execution_mailing_record_corrections" (
  "id" uuid PRIMARY KEY,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "mailing_id" uuid NOT NULL,
  "prior_correction_id" uuid UNIQUE,
  "from_revision" integer NOT NULL,
  "to_revision" integer NOT NULL,
  "mailed_at" date NOT NULL,
  "correction_reason" varchar(500) NOT NULL,
  "case_anchor_snapshot" jsonb NOT NULL DEFAULT '{}',
  "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by_user_id" uuid NOT NULL,
  "audit_event_id" uuid NOT NULL UNIQUE,
  UNIQUE ("id", "mailing_id", "case_id", "department_id"),
  UNIQUE ("id","case_id","department_id"),
  CONSTRAINT "execution_mailing_record_from_revision_key" UNIQUE ("mailing_id","case_id","department_id","from_revision"),
  CONSTRAINT "execution_mailing_record_to_revision_key" UNIQUE ("mailing_id","case_id","department_id","to_revision"),
  CHECK ("from_revision">=0 AND "to_revision"="from_revision"+1),
  CHECK (("from_revision"=0)=("prior_correction_id" IS NULL)),
  CHECK ("correction_reason"=btrim("correction_reason") AND "correction_reason"<>''),
  FOREIGN KEY ("case_id", "department_id") REFERENCES "cases" ("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("mailing_id", "case_id", "department_id") REFERENCES "case_execution_mailings" ("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("prior_correction_id", "mailing_id", "case_id", "department_id") REFERENCES "case_execution_mailing_record_corrections" ("id", "mailing_id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("audit_event_id") REFERENCES "audit_events" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "case_execution_mailing_record_documents" (
  "correction_id" uuid NOT NULL, "case_id" uuid NOT NULL, "department_id" uuid NOT NULL,
  "material_id" uuid NOT NULL, "content_version_id" uuid NOT NULL,
  PRIMARY KEY ("correction_id","content_version_id"), UNIQUE ("correction_id","material_id"),
  FOREIGN KEY ("correction_id", "case_id", "department_id") REFERENCES "case_execution_mailing_record_corrections" ("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("material_id", "content_version_id") REFERENCES "content_versions" ("material_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_execution_filing_record_corrections" (
  "id" uuid PRIMARY KEY,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "filing_id" uuid NOT NULL,
  "prior_correction_id" uuid UNIQUE,
  "from_revision" integer NOT NULL,
  "to_revision" integer NOT NULL,
  "submitted_at" date NOT NULL,
  "correction_reason" varchar(500) NOT NULL,
  "case_anchor_snapshot" jsonb NOT NULL DEFAULT '{}',
  "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by_user_id" uuid NOT NULL,
  "audit_event_id" uuid NOT NULL UNIQUE,
  UNIQUE ("id", "filing_id", "case_id", "department_id"),
  UNIQUE ("id","case_id","department_id"),
  CONSTRAINT "execution_filing_record_from_revision_key" UNIQUE ("filing_id","case_id","department_id","from_revision"),
  CONSTRAINT "execution_filing_record_to_revision_key" UNIQUE ("filing_id","case_id","department_id","to_revision"),
  CHECK ("from_revision">=0 AND "to_revision"="from_revision"+1),
  CHECK (("from_revision"=0)=("prior_correction_id" IS NULL)),
  CHECK ("correction_reason"=btrim("correction_reason") AND "correction_reason"<>''),
  FOREIGN KEY ("case_id", "department_id") REFERENCES "cases" ("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("filing_id", "case_id", "department_id") REFERENCES "case_execution_filings" ("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("prior_correction_id", "filing_id", "case_id", "department_id") REFERENCES "case_execution_filing_record_corrections" ("id", "filing_id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("audit_event_id") REFERENCES "audit_events" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "case_execution_filing_record_documents" (
  "correction_id" uuid NOT NULL, "case_id" uuid NOT NULL, "department_id" uuid NOT NULL,
  "material_id" uuid NOT NULL, "content_version_id" uuid NOT NULL,
  PRIMARY KEY ("correction_id","content_version_id"), UNIQUE ("correction_id","material_id"),
  FOREIGN KEY ("correction_id", "case_id", "department_id") REFERENCES "case_execution_filing_record_corrections" ("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("material_id", "content_version_id") REFERENCES "content_versions" ("material_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_execution_finish_record_corrections" (
  "id" uuid PRIMARY KEY,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "finish_id" uuid NOT NULL,
  "prior_correction_id" uuid UNIQUE,
  "from_revision" integer NOT NULL,
  "to_revision" integer NOT NULL,
  "finished_at" date NOT NULL,
  "business_reason" varchar(2000) NOT NULL,
  "basis_note" varchar(2000),
  "correction_reason" varchar(500) NOT NULL,
  "case_anchor_snapshot" jsonb NOT NULL DEFAULT '{}',
  "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by_user_id" uuid NOT NULL,
  "audit_event_id" uuid NOT NULL UNIQUE,
  UNIQUE ("id", "finish_id", "case_id", "department_id"),
  UNIQUE ("id","case_id","department_id"),
  CONSTRAINT "execution_finish_record_from_revision_key" UNIQUE ("finish_id","case_id","department_id","from_revision"),
  CONSTRAINT "execution_finish_record_to_revision_key" UNIQUE ("finish_id","case_id","department_id","to_revision"),
  CHECK ("from_revision">=0 AND "to_revision"="from_revision"+1),
  CHECK (("from_revision"=0)=("prior_correction_id" IS NULL)),
  CHECK ("correction_reason"=btrim("correction_reason") AND "correction_reason"<>''),
  FOREIGN KEY ("case_id", "department_id") REFERENCES "cases" ("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("finish_id", "case_id", "department_id") REFERENCES "case_execution_finishes" ("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("prior_correction_id", "finish_id", "case_id", "department_id") REFERENCES "case_execution_finish_record_corrections" ("id", "finish_id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("audit_event_id") REFERENCES "audit_events" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (char_length(btrim("business_reason")) BETWEEN 1 AND 2000),
  CHECK ("basis_note" IS NULL OR char_length(btrim("basis_note")) BETWEEN 1 AND 2000)
);
CREATE TABLE "case_execution_finish_record_documents" (
  "correction_id" uuid NOT NULL, "case_id" uuid NOT NULL, "department_id" uuid NOT NULL,
  "material_id" uuid NOT NULL, "content_version_id" uuid NOT NULL,
  PRIMARY KEY ("correction_id","content_version_id"), UNIQUE ("correction_id","material_id"),
  FOREIGN KEY ("correction_id", "case_id", "department_id") REFERENCES "case_execution_finish_record_corrections" ("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("material_id", "content_version_id") REFERENCES "content_versions" ("material_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_hearing_record_corrections" (
  "id" uuid PRIMARY KEY,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "arrangement_id" uuid NOT NULL,
  "trial_round_id" uuid NOT NULL,
  "prior_correction_id" uuid UNIQUE,
  "from_revision" integer NOT NULL,
  "to_revision" integer NOT NULL,
  "hearing_at" date,
  "correction_reason" varchar(500) NOT NULL,
  "case_anchor_snapshot" jsonb NOT NULL DEFAULT '{}',
  "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by_user_id" uuid NOT NULL,
  "audit_event_id" uuid NOT NULL UNIQUE,
  UNIQUE ("id", "arrangement_id", "case_id", "department_id", "trial_round_id"),
  UNIQUE ("id","case_id","department_id"),
  CONSTRAINT "hearing_record_from_revision_key" UNIQUE ("arrangement_id","case_id","department_id","from_revision"),
  CONSTRAINT "hearing_record_to_revision_key" UNIQUE ("arrangement_id","case_id","department_id","to_revision"),
  CHECK ("from_revision">=0 AND "to_revision"="from_revision"+1),
  CHECK (("from_revision"=0)=("prior_correction_id" IS NULL)),
  CHECK ("correction_reason"=btrim("correction_reason") AND "correction_reason"<>''),
  FOREIGN KEY ("case_id", "department_id") REFERENCES "cases" ("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("arrangement_id", "case_id", "department_id", "trial_round_id") REFERENCES "case_hearing_arrangements" ("id", "case_id", "department_id", "trial_round_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("prior_correction_id", "arrangement_id", "case_id", "department_id", "trial_round_id") REFERENCES "case_hearing_record_corrections" ("id", "arrangement_id", "case_id", "department_id", "trial_round_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("audit_event_id") REFERENCES "audit_events" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_judgment_record_corrections" (
  "id" uuid PRIMARY KEY,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "judgment_id" uuid NOT NULL,
  "trial_round_id" uuid NOT NULL,
  "prior_correction_id" uuid UNIQUE,
  "from_revision" integer NOT NULL,
  "to_revision" integer NOT NULL,
  "judgment_received_at" date NOT NULL,
  "judgment_amount_state" "case_complaint_amount_state" NOT NULL,
  "judgment_amount" decimal(16,2),
  "paid_litigation_fee_state" "case_complaint_amount_state" NOT NULL,
  "paid_litigation_fee" decimal(16,2),
  "correction_reason" varchar(500) NOT NULL,
  "case_anchor_snapshot" jsonb NOT NULL DEFAULT '{}',
  "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by_user_id" uuid NOT NULL,
  "audit_event_id" uuid NOT NULL UNIQUE,
  UNIQUE ("id", "judgment_id", "case_id", "department_id", "trial_round_id"),
  UNIQUE ("id","case_id","department_id"),
  CONSTRAINT "judgment_record_from_revision_key" UNIQUE ("judgment_id","case_id","department_id","from_revision"),
  CONSTRAINT "judgment_record_to_revision_key" UNIQUE ("judgment_id","case_id","department_id","to_revision"),
  CHECK ("from_revision">=0 AND "to_revision"="from_revision"+1),
  CHECK (("from_revision"=0)=("prior_correction_id" IS NULL)),
  CHECK ("correction_reason"=btrim("correction_reason") AND "correction_reason"<>''),
  FOREIGN KEY ("case_id", "department_id") REFERENCES "cases" ("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("judgment_id", "case_id", "department_id", "trial_round_id") REFERENCES "case_judgment_facts" ("id", "case_id", "department_id", "trial_round_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("prior_correction_id", "judgment_id", "case_id", "department_id", "trial_round_id") REFERENCES "case_judgment_record_corrections" ("id", "judgment_id", "case_id", "department_id", "trial_round_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("audit_event_id") REFERENCES "audit_events" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (("judgment_amount_state"='PENDING' AND "judgment_amount" IS NULL) OR ("judgment_amount_state"='KNOWN' AND "judgment_amount" IS NOT NULL AND "judgment_amount">=0)),
  CHECK (("paid_litigation_fee_state"='PENDING' AND "paid_litigation_fee" IS NULL) OR ("paid_litigation_fee_state"='KNOWN' AND "paid_litigation_fee" IS NOT NULL AND "paid_litigation_fee">=0))
);
CREATE TABLE "case_judgment_record_documents" (
  "correction_id" uuid NOT NULL, "case_id" uuid NOT NULL, "department_id" uuid NOT NULL,
  "material_id" uuid NOT NULL, "content_version_id" uuid NOT NULL,
  PRIMARY KEY ("correction_id","content_version_id"), UNIQUE ("correction_id","material_id"),
  FOREIGN KEY ("correction_id", "case_id", "department_id") REFERENCES "case_judgment_record_corrections" ("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("material_id", "content_version_id") REFERENCES "content_versions" ("material_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_closure_record_corrections" (
  "id" uuid PRIMARY KEY,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "closure_id" uuid NOT NULL,
  "prior_correction_id" uuid UNIQUE,
  "from_revision" integer NOT NULL,
  "to_revision" integer NOT NULL,
  "source_closure_version_id" uuid NOT NULL,
  "close_at" date,
  "close_amount_state" "case_complaint_amount_state" NOT NULL,
  "close_amt" decimal(16,2),
  "note" varchar(2000),
  "correction_reason" varchar(500) NOT NULL,
  "case_anchor_snapshot" jsonb NOT NULL DEFAULT '{}',
  "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by_user_id" uuid NOT NULL,
  "audit_event_id" uuid NOT NULL UNIQUE,
  UNIQUE ("id", "closure_id", "case_id", "department_id"),
  UNIQUE ("id","case_id","department_id"),
  CONSTRAINT "closure_record_from_revision_key" UNIQUE ("closure_id","case_id","department_id","from_revision"),
  CONSTRAINT "closure_record_to_revision_key" UNIQUE ("closure_id","case_id","department_id","to_revision"),
  CHECK ("from_revision">=0 AND "to_revision"="from_revision"+1),
  CHECK (("from_revision"=0)=("prior_correction_id" IS NULL)),
  CHECK ("correction_reason"=btrim("correction_reason") AND "correction_reason"<>''),
  FOREIGN KEY ("case_id", "department_id") REFERENCES "cases" ("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("closure_id", "case_id", "department_id") REFERENCES "case_closures" ("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("prior_correction_id", "closure_id", "case_id", "department_id") REFERENCES "case_closure_record_corrections" ("id", "closure_id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("audit_event_id") REFERENCES "audit_events" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("source_closure_version_id", "closure_id", "case_id", "department_id") REFERENCES "case_closure_versions" ("id", "closure_id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ("note" IS NULL OR char_length(btrim("note")) BETWEEN 1 AND 2000),
  CHECK (("close_amount_state"='PENDING' AND "close_amt" IS NULL) OR ("close_amount_state"='KNOWN' AND "close_amt" IS NOT NULL AND "close_amt">=0))
);
CREATE TABLE "case_closure_record_documents" (
  "correction_id" uuid NOT NULL, "case_id" uuid NOT NULL, "department_id" uuid NOT NULL,
  "material_id" uuid NOT NULL, "content_version_id" uuid NOT NULL,
  PRIMARY KEY ("correction_id","content_version_id"), UNIQUE ("correction_id","material_id"),
  FOREIGN KEY ("correction_id", "case_id", "department_id") REFERENCES "case_closure_record_corrections" ("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("material_id", "content_version_id") REFERENCES "content_versions" ("material_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "case_section_record_edit_receipts" (
 "id" uuid PRIMARY KEY, "department_id" uuid NOT NULL, "actor_user_id" uuid NOT NULL, "case_id" uuid NOT NULL,
 "command" "case_section_record_edit_command" NOT NULL, "idempotency_key" varchar(128) NOT NULL,
 "request_fingerprint" char(64) NOT NULL, "result_snapshot" jsonb NOT NULL,
 "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("department_id","actor_user_id","command","idempotency_key"),
 FOREIGN KEY ("case_id", "department_id") REFERENCES "cases" ("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT, FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK (length(btrim("idempotency_key")) BETWEEN 1 AND 128 AND "idempotency_key"=btrim("idempotency_key")),
 CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "case_section_record_edit_fact_receipt_key" ON "case_section_record_edit_receipts" (("result_snapshot"->>'correctionId'));

CREATE FUNCTION "capture_case_section_record_anchor"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT to_jsonb(c) INTO NEW."case_anchor_snapshot" FROM "cases" c
    WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id" FOR UPDATE;
  IF NEW."case_anchor_snapshot" IS NULL THEN RAISE EXCEPTION 'section correction lacks same-department case' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

-- Each typed guard is independently bound; table names below are migration constants.
CREATE FUNCTION "check_execution_mailing_record_correction"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original "case_execution_mailings"%ROWTYPE; prior "case_execution_mailing_record_corrections"%ROWTYPE; a "audit_events"%ROWTYPE;
 r "case_section_record_edit_receipts"%ROWTYPE; current_case jsonb; before_values jsonb; after_values jsonb; before_files jsonb; after_files jsonb;
BEGIN
  SELECT * INTO original FROM "case_execution_mailings" WHERE "id"=NEW."mailing_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
  SELECT to_jsonb(c) INTO current_case FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id" FOR UPDATE;
  IF original."id" IS NULL OR current_case IS DISTINCT FROM NEW."case_anchor_snapshot" THEN RAISE EXCEPTION 'section correction changed workflow anchors' USING ERRCODE='23514'; END IF;

  IF NOT case_record_edit_actor_authorized(NEW."recorded_by_user_id",NEW."case_id",NEW."department_id",'case.execution.mailing.correct') THEN RAISE EXCEPTION 'section correction operator unauthorized' USING ERRCODE='23514'; END IF;
  IF NEW."from_revision"=0 THEN
    before_values:=jsonb_build_object('mailedAt',original."mailed_at");
    SELECT coalesce(jsonb_agg("content_version_id" ORDER BY "content_version_id"),'[]') INTO before_files FROM "case_execution_mailing_versions" WHERE "mailing_id"=NEW."mailing_id";
  ELSE
    SELECT * INTO prior FROM "case_execution_mailing_record_corrections" WHERE "id"=NEW."prior_correction_id" AND "mailing_id"=NEW."mailing_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
    IF prior."id" IS NULL OR prior."to_revision"<>NEW."from_revision" THEN RAISE EXCEPTION 'broken section correction chain' USING ERRCODE='23514'; END IF;
    before_values:=jsonb_build_object('mailedAt',prior."mailed_at");
    SELECT coalesce(jsonb_agg("content_version_id" ORDER BY "content_version_id"),'[]') INTO before_files FROM "case_execution_mailing_record_documents" WHERE "correction_id"=prior."id";
  END IF;
  after_values:=jsonb_build_object('mailedAt',NEW."mailed_at");
  SELECT coalesce(jsonb_agg("content_version_id" ORDER BY "content_version_id"),'[]') INTO after_files FROM "case_execution_mailing_record_documents" WHERE "correction_id"=NEW."id";
  IF jsonb_array_length(after_files) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'invalid correction document count' USING ERRCODE='23514'; END IF;
  IF EXISTS (SELECT 1 FROM "case_execution_mailing_record_documents" d WHERE d."correction_id"=NEW."id" AND NOT EXISTS (SELECT 1 FROM "material_references" r WHERE r."material_id"=d."material_id" AND r."content_version_id"=d."content_version_id" AND r."department_id"=d."department_id" AND r."resource_type"='case' AND r."resource_id"=d."case_id" AND r."purpose"='MAIL_RECEIPT' AND r."action_event_id"=NEW."audit_event_id")) THEN RAISE EXCEPTION 'correction document lacks exact retained material reference' USING ERRCODE='23514'; END IF;
  before_values:=before_values||jsonb_build_object('contentVersionIds',before_files); after_values:=after_values||jsonb_build_object('contentVersionIds',after_files);
  IF before_values=after_values THEN RAISE EXCEPTION 'section correction has no change' USING ERRCODE='23514'; END IF;
  IF NEW."mailed_at">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date THEN RAISE EXCEPTION 'future business date' USING ERRCODE='23514'; END IF;
  SELECT * INTO a FROM "audit_events" WHERE "id"=NEW."audit_event_id" AND xmin=pg_current_xact_id()::text::xid;
  IF a."id" IS NULL OR a."department_id"<>NEW."department_id" OR a."resource_type"<>'CASE' OR a."resource_id"<>NEW."case_id" OR a."actor_user_id" IS DISTINCT FROM NEW."recorded_by_user_id" OR a."internal_actor_user_id" IS DISTINCT FROM NEW."recorded_by_user_id" OR a."action"<>'case.execution.mailing.record-corrected' OR
    NOT (a."details" @> jsonb_build_object('correctionId',NEW."id",'mailingId',NEW."mailing_id",'fromRevision',NEW."from_revision",'toRevision',NEW."to_revision",'correctionReason',NEW."correction_reason")) OR a."details"->'before' IS DISTINCT FROM before_values OR a."details"->'after' IS DISTINCT FROM after_values
  THEN RAISE EXCEPTION 'section correction audit mismatch' USING ERRCODE='23514'; END IF;
  SELECT * INTO r FROM "case_section_record_edit_receipts" WHERE "command"='EXECUTION_MAILING_CORRECTION' AND "department_id"=NEW."department_id" AND "case_id"=NEW."case_id" AND "actor_user_id"=NEW."recorded_by_user_id" AND "result_snapshot"->>'correctionId'=NEW."id"::text AND xmin=pg_current_xact_id()::text::xid;
  IF r."id" IS NULL OR r."result_snapshot" IS DISTINCT FROM jsonb_build_object('caseId',NEW."case_id",'correctionId',NEW."id",'recordedAt',to_char(NEW."recorded_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'mailingId',NEW."mailing_id",'mailingRevision',NEW."to_revision",'mailedAt',NEW."mailed_at") THEN RAISE EXCEPTION 'section correction receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "execution_mailing_record_anchor" BEFORE INSERT ON "case_execution_mailing_record_corrections" FOR EACH ROW EXECUTE FUNCTION "capture_case_section_record_anchor"();
CREATE CONSTRAINT TRIGGER "execution_mailing_record_guard" AFTER INSERT ON "case_execution_mailing_record_corrections" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_execution_mailing_record_correction"();
CREATE TRIGGER "execution_mailing_record_immutable" BEFORE UPDATE OR DELETE ON "case_execution_mailing_record_corrections" FOR EACH ROW EXECUTE FUNCTION "reject_case_acceptance_mutation"();
CREATE TRIGGER "execution_mailing_record_documents_immutable" BEFORE UPDATE OR DELETE ON "case_execution_mailing_record_documents" FOR EACH ROW EXECUTE FUNCTION "reject_case_acceptance_mutation"();
CREATE FUNCTION "check_execution_mailing_record_document_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE same_tx boolean;
BEGIN
  SELECT xmin=pg_current_xact_id()::text::xid INTO same_tx FROM "case_execution_mailing_record_corrections" WHERE "id"=NEW."correction_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
  IF same_tx IS DISTINCT FROM true THEN RAISE EXCEPTION 'cannot append documents to committed correction' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM "materials" m JOIN "content_versions" v ON v."material_id"=m."id" AND v."id"=NEW."content_version_id" WHERE m."id"=NEW."material_id" AND m."department_id"=NEW."department_id" AND m."owner_type"='CASE' AND m."owner_id"=NEW."case_id" AND m."deleted_at" IS NULL AND m."status"='ACTIVE' AND m."category"='MAIL_RECEIPT' AND m."purpose"='MAIL_RECEIPT' AND v."status"='AVAILABLE'
    AND v."mime_type" IN ('application/pdf','image/jpeg','image/png') AND v."size_bytes">0 AND v."size_bytes"<=20971520
    AND (m."current_version_id"=v."id" OR EXISTS (SELECT 1 FROM "material_references" r JOIN "audit_events" a ON a."id"=r."action_event_id" WHERE r."department_id"=NEW."department_id" AND r."resource_type"='case' AND r."resource_id"=NEW."case_id" AND r."material_id"=NEW."material_id" AND r."content_version_id"=NEW."content_version_id" AND r."purpose"='MAIL_RECEIPT' AND a."department_id"=NEW."department_id" AND a."resource_type"='CASE' AND a."resource_id"=NEW."case_id" AND a."action" IN ('case.execution.mailed','case.execution.mailing.record-corrected') AND r."action_event_id"<>(SELECT "audit_event_id" FROM "case_execution_mailing_record_corrections" WHERE "id"=NEW."correction_id"))) FOR SHARE OF m,v;
  IF NOT FOUND THEN RAISE EXCEPTION 'correction document has wrong case, department, category or unavailable bytes' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "execution_mailing_record_document_insert" BEFORE INSERT ON "case_execution_mailing_record_documents" FOR EACH ROW EXECUTE FUNCTION "check_execution_mailing_record_document_insert"();
CREATE FUNCTION "check_execution_filing_record_correction"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original "case_execution_filings"%ROWTYPE; prior "case_execution_filing_record_corrections"%ROWTYPE; a "audit_events"%ROWTYPE;
 r "case_section_record_edit_receipts"%ROWTYPE; current_case jsonb; before_values jsonb; after_values jsonb; before_files jsonb; after_files jsonb;
BEGIN
  SELECT * INTO original FROM "case_execution_filings" WHERE "id"=NEW."filing_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
  SELECT to_jsonb(c) INTO current_case FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id" FOR UPDATE;
  IF original."id" IS NULL OR current_case IS DISTINCT FROM NEW."case_anchor_snapshot" THEN RAISE EXCEPTION 'section correction changed workflow anchors' USING ERRCODE='23514'; END IF;

  IF NOT case_record_edit_actor_authorized(NEW."recorded_by_user_id",NEW."case_id",NEW."department_id",'case.execution.filing.correct') THEN RAISE EXCEPTION 'section correction operator unauthorized' USING ERRCODE='23514'; END IF;
  IF NEW."from_revision"=0 THEN
    before_values:=jsonb_build_object('submittedAt',original."submitted_at");
    SELECT coalesce(jsonb_agg("content_version_id" ORDER BY "content_version_id"),'[]') INTO before_files FROM "case_execution_filing_versions" WHERE "filing_id"=NEW."filing_id";
  ELSE
    SELECT * INTO prior FROM "case_execution_filing_record_corrections" WHERE "id"=NEW."prior_correction_id" AND "filing_id"=NEW."filing_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
    IF prior."id" IS NULL OR prior."to_revision"<>NEW."from_revision" THEN RAISE EXCEPTION 'broken section correction chain' USING ERRCODE='23514'; END IF;
    before_values:=jsonb_build_object('submittedAt',prior."submitted_at");
    SELECT coalesce(jsonb_agg("content_version_id" ORDER BY "content_version_id"),'[]') INTO before_files FROM "case_execution_filing_record_documents" WHERE "correction_id"=prior."id";
  END IF;
  after_values:=jsonb_build_object('submittedAt',NEW."submitted_at");
  SELECT coalesce(jsonb_agg("content_version_id" ORDER BY "content_version_id"),'[]') INTO after_files FROM "case_execution_filing_record_documents" WHERE "correction_id"=NEW."id";
  IF jsonb_array_length(after_files) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'invalid correction document count' USING ERRCODE='23514'; END IF;
  IF EXISTS (SELECT 1 FROM "case_execution_filing_record_documents" d WHERE d."correction_id"=NEW."id" AND NOT EXISTS (SELECT 1 FROM "material_references" r WHERE r."material_id"=d."material_id" AND r."content_version_id"=d."content_version_id" AND r."department_id"=d."department_id" AND r."resource_type"='case' AND r."resource_id"=d."case_id" AND r."purpose"='EXECUTION_FILING_PROOF' AND r."action_event_id"=NEW."audit_event_id")) THEN RAISE EXCEPTION 'correction document lacks exact retained material reference' USING ERRCODE='23514'; END IF;
  before_values:=before_values||jsonb_build_object('contentVersionIds',before_files); after_values:=after_values||jsonb_build_object('contentVersionIds',after_files);
  IF before_values=after_values THEN RAISE EXCEPTION 'section correction has no change' USING ERRCODE='23514'; END IF;
  IF NEW."submitted_at">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date THEN RAISE EXCEPTION 'future business date' USING ERRCODE='23514'; END IF;
  SELECT * INTO a FROM "audit_events" WHERE "id"=NEW."audit_event_id" AND xmin=pg_current_xact_id()::text::xid;
  IF a."id" IS NULL OR a."department_id"<>NEW."department_id" OR a."resource_type"<>'CASE' OR a."resource_id"<>NEW."case_id" OR a."actor_user_id" IS DISTINCT FROM NEW."recorded_by_user_id" OR a."internal_actor_user_id" IS DISTINCT FROM NEW."recorded_by_user_id" OR a."action"<>'case.execution.filing.record-corrected' OR
    NOT (a."details" @> jsonb_build_object('correctionId',NEW."id",'filingId',NEW."filing_id",'fromRevision',NEW."from_revision",'toRevision',NEW."to_revision",'correctionReason',NEW."correction_reason")) OR a."details"->'before' IS DISTINCT FROM before_values OR a."details"->'after' IS DISTINCT FROM after_values
  THEN RAISE EXCEPTION 'section correction audit mismatch' USING ERRCODE='23514'; END IF;
  SELECT * INTO r FROM "case_section_record_edit_receipts" WHERE "command"='EXECUTION_FILING_CORRECTION' AND "department_id"=NEW."department_id" AND "case_id"=NEW."case_id" AND "actor_user_id"=NEW."recorded_by_user_id" AND "result_snapshot"->>'correctionId'=NEW."id"::text AND xmin=pg_current_xact_id()::text::xid;
  IF r."id" IS NULL OR r."result_snapshot" IS DISTINCT FROM jsonb_build_object('caseId',NEW."case_id",'correctionId',NEW."id",'recordedAt',to_char(NEW."recorded_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'filingId',NEW."filing_id",'filingRevision',NEW."to_revision",'submittedAt',NEW."submitted_at") THEN RAISE EXCEPTION 'section correction receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "execution_filing_record_anchor" BEFORE INSERT ON "case_execution_filing_record_corrections" FOR EACH ROW EXECUTE FUNCTION "capture_case_section_record_anchor"();
CREATE CONSTRAINT TRIGGER "execution_filing_record_guard" AFTER INSERT ON "case_execution_filing_record_corrections" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_execution_filing_record_correction"();
CREATE TRIGGER "execution_filing_record_immutable" BEFORE UPDATE OR DELETE ON "case_execution_filing_record_corrections" FOR EACH ROW EXECUTE FUNCTION "reject_case_acceptance_mutation"();
CREATE TRIGGER "execution_filing_record_documents_immutable" BEFORE UPDATE OR DELETE ON "case_execution_filing_record_documents" FOR EACH ROW EXECUTE FUNCTION "reject_case_acceptance_mutation"();
CREATE FUNCTION "check_execution_filing_record_document_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE same_tx boolean;
BEGIN
  SELECT xmin=pg_current_xact_id()::text::xid INTO same_tx FROM "case_execution_filing_record_corrections" WHERE "id"=NEW."correction_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
  IF same_tx IS DISTINCT FROM true THEN RAISE EXCEPTION 'cannot append documents to committed correction' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM "materials" m JOIN "content_versions" v ON v."material_id"=m."id" AND v."id"=NEW."content_version_id" WHERE m."id"=NEW."material_id" AND m."department_id"=NEW."department_id" AND m."owner_type"='CASE' AND m."owner_id"=NEW."case_id" AND m."deleted_at" IS NULL AND m."status"='ACTIVE' AND m."category"='EXECUTION_FILING_PROOF' AND m."purpose"='EXECUTION_FILING_PROOF' AND v."status"='AVAILABLE'
    AND v."mime_type" IN ('application/pdf','image/jpeg','image/png') AND v."size_bytes">0 AND v."size_bytes"<=52428800
    AND (m."current_version_id"=v."id" OR EXISTS (SELECT 1 FROM "material_references" r JOIN "audit_events" a ON a."id"=r."action_event_id" WHERE r."department_id"=NEW."department_id" AND r."resource_type"='case' AND r."resource_id"=NEW."case_id" AND r."material_id"=NEW."material_id" AND r."content_version_id"=NEW."content_version_id" AND r."purpose"='EXECUTION_FILING_PROOF' AND a."department_id"=NEW."department_id" AND a."resource_type"='CASE' AND a."resource_id"=NEW."case_id" AND a."action" IN ('case.execution.filing.submitted','case.execution.filing.record-corrected') AND r."action_event_id"<>(SELECT "audit_event_id" FROM "case_execution_filing_record_corrections" WHERE "id"=NEW."correction_id"))) FOR SHARE OF m,v;
  IF NOT FOUND THEN RAISE EXCEPTION 'correction document has wrong case, department, category or unavailable bytes' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "execution_filing_record_document_insert" BEFORE INSERT ON "case_execution_filing_record_documents" FOR EACH ROW EXECUTE FUNCTION "check_execution_filing_record_document_insert"();
CREATE FUNCTION "check_execution_finish_record_correction"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original "case_execution_finishes"%ROWTYPE; prior "case_execution_finish_record_corrections"%ROWTYPE; a "audit_events"%ROWTYPE;
 r "case_section_record_edit_receipts"%ROWTYPE; current_case jsonb; before_values jsonb; after_values jsonb; before_files jsonb; after_files jsonb;
BEGIN
  SELECT * INTO original FROM "case_execution_finishes" WHERE "id"=NEW."finish_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
  SELECT to_jsonb(c) INTO current_case FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id" FOR UPDATE;
  IF original."id" IS NULL OR current_case IS DISTINCT FROM NEW."case_anchor_snapshot" THEN RAISE EXCEPTION 'section correction changed workflow anchors' USING ERRCODE='23514'; END IF;

  IF NOT case_record_edit_actor_authorized(NEW."recorded_by_user_id",NEW."case_id",NEW."department_id",'case.execution.finish.correct') THEN RAISE EXCEPTION 'section correction operator unauthorized' USING ERRCODE='23514'; END IF;
  IF NEW."from_revision"=0 THEN
    before_values:=jsonb_build_object('finishedAt',original."finished_at",'reason',original."reason",'basisNote',original."basis_note");
    SELECT coalesce(jsonb_agg("content_version_id" ORDER BY "content_version_id"),'[]') INTO before_files FROM "case_execution_finish_versions" WHERE "finish_id"=NEW."finish_id";
  ELSE
    SELECT * INTO prior FROM "case_execution_finish_record_corrections" WHERE "id"=NEW."prior_correction_id" AND "finish_id"=NEW."finish_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
    IF prior."id" IS NULL OR prior."to_revision"<>NEW."from_revision" THEN RAISE EXCEPTION 'broken section correction chain' USING ERRCODE='23514'; END IF;
    before_values:=jsonb_build_object('finishedAt',prior."finished_at",'reason',prior."business_reason",'basisNote',prior."basis_note");
    SELECT coalesce(jsonb_agg("content_version_id" ORDER BY "content_version_id"),'[]') INTO before_files FROM "case_execution_finish_record_documents" WHERE "correction_id"=prior."id";
  END IF;
  after_values:=jsonb_build_object('finishedAt',NEW."finished_at",'reason',NEW."business_reason",'basisNote',NEW."basis_note");
  SELECT coalesce(jsonb_agg("content_version_id" ORDER BY "content_version_id"),'[]') INTO after_files FROM "case_execution_finish_record_documents" WHERE "correction_id"=NEW."id";
  IF jsonb_array_length(after_files) >10 THEN RAISE EXCEPTION 'invalid correction document count' USING ERRCODE='23514'; END IF;
  IF EXISTS (SELECT 1 FROM "case_execution_finish_record_documents" d WHERE d."correction_id"=NEW."id" AND NOT EXISTS (SELECT 1 FROM "material_references" r WHERE r."material_id"=d."material_id" AND r."content_version_id"=d."content_version_id" AND r."department_id"=d."department_id" AND r."resource_type"='case' AND r."resource_id"=d."case_id" AND r."purpose"='EXECUTION_FINISH_BASIS' AND r."action_event_id"=NEW."audit_event_id")) THEN RAISE EXCEPTION 'correction document lacks exact retained material reference' USING ERRCODE='23514'; END IF;
  before_values:=before_values||jsonb_build_object('contentVersionIds',before_files); after_values:=after_values||jsonb_build_object('contentVersionIds',after_files);
  IF before_values=after_values THEN RAISE EXCEPTION 'section correction has no change' USING ERRCODE='23514'; END IF;
  IF NEW."finished_at">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date THEN RAISE EXCEPTION 'future business date' USING ERRCODE='23514'; END IF;
  SELECT * INTO a FROM "audit_events" WHERE "id"=NEW."audit_event_id" AND xmin=pg_current_xact_id()::text::xid;
  IF a."id" IS NULL OR a."department_id"<>NEW."department_id" OR a."resource_type"<>'CASE' OR a."resource_id"<>NEW."case_id" OR a."actor_user_id" IS DISTINCT FROM NEW."recorded_by_user_id" OR a."internal_actor_user_id" IS DISTINCT FROM NEW."recorded_by_user_id" OR a."action"<>'case.execution.finish.record-corrected' OR
    NOT (a."details" @> jsonb_build_object('correctionId',NEW."id",'finishId',NEW."finish_id",'fromRevision',NEW."from_revision",'toRevision',NEW."to_revision",'correctionReason',NEW."correction_reason")) OR a."details"->'before' IS DISTINCT FROM before_values OR a."details"->'after' IS DISTINCT FROM after_values
  THEN RAISE EXCEPTION 'section correction audit mismatch' USING ERRCODE='23514'; END IF;
  SELECT * INTO r FROM "case_section_record_edit_receipts" WHERE "command"='EXECUTION_FINISH_CORRECTION' AND "department_id"=NEW."department_id" AND "case_id"=NEW."case_id" AND "actor_user_id"=NEW."recorded_by_user_id" AND "result_snapshot"->>'correctionId'=NEW."id"::text AND xmin=pg_current_xact_id()::text::xid;
  IF r."id" IS NULL OR r."result_snapshot" IS DISTINCT FROM jsonb_build_object('caseId',NEW."case_id",'correctionId',NEW."id",'recordedAt',to_char(NEW."recorded_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'finishId',NEW."finish_id",'finishRevision',NEW."to_revision",'finishedAt',NEW."finished_at") THEN RAISE EXCEPTION 'section correction receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "execution_finish_record_anchor" BEFORE INSERT ON "case_execution_finish_record_corrections" FOR EACH ROW EXECUTE FUNCTION "capture_case_section_record_anchor"();
CREATE CONSTRAINT TRIGGER "execution_finish_record_guard" AFTER INSERT ON "case_execution_finish_record_corrections" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_execution_finish_record_correction"();
CREATE TRIGGER "execution_finish_record_immutable" BEFORE UPDATE OR DELETE ON "case_execution_finish_record_corrections" FOR EACH ROW EXECUTE FUNCTION "reject_case_acceptance_mutation"();
CREATE TRIGGER "execution_finish_record_documents_immutable" BEFORE UPDATE OR DELETE ON "case_execution_finish_record_documents" FOR EACH ROW EXECUTE FUNCTION "reject_case_acceptance_mutation"();
CREATE FUNCTION "check_execution_finish_record_document_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE same_tx boolean;
BEGIN
  SELECT xmin=pg_current_xact_id()::text::xid INTO same_tx FROM "case_execution_finish_record_corrections" WHERE "id"=NEW."correction_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
  IF same_tx IS DISTINCT FROM true THEN RAISE EXCEPTION 'cannot append documents to committed correction' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM "materials" m JOIN "content_versions" v ON v."material_id"=m."id" AND v."id"=NEW."content_version_id" WHERE m."id"=NEW."material_id" AND m."department_id"=NEW."department_id" AND m."owner_type"='CASE' AND m."owner_id"=NEW."case_id" AND m."deleted_at" IS NULL AND m."status"='ACTIVE' AND m."category"='EXECUTION_FINISH_BASIS' AND m."purpose"='EXECUTION_FINISH_BASIS' AND v."status"='AVAILABLE'
    AND v."mime_type" IN ('application/pdf','image/jpeg','image/png') AND v."size_bytes">0 AND v."size_bytes"<=52428800
    AND (m."current_version_id"=v."id" OR EXISTS (SELECT 1 FROM "material_references" r JOIN "audit_events" a ON a."id"=r."action_event_id" WHERE r."department_id"=NEW."department_id" AND r."resource_type"='case' AND r."resource_id"=NEW."case_id" AND r."material_id"=NEW."material_id" AND r."content_version_id"=NEW."content_version_id" AND r."purpose"='EXECUTION_FINISH_BASIS' AND a."department_id"=NEW."department_id" AND a."resource_type"='CASE' AND a."resource_id"=NEW."case_id" AND a."action" IN ('case.execution.finished','case.execution.finish.record-corrected') AND r."action_event_id"<>(SELECT "audit_event_id" FROM "case_execution_finish_record_corrections" WHERE "id"=NEW."correction_id"))) FOR SHARE OF m,v;
  IF NOT FOUND THEN RAISE EXCEPTION 'correction document has wrong case, department, category or unavailable bytes' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "execution_finish_record_document_insert" BEFORE INSERT ON "case_execution_finish_record_documents" FOR EACH ROW EXECUTE FUNCTION "check_execution_finish_record_document_insert"();
CREATE FUNCTION "check_hearing_record_correction"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original "case_hearing_arrangements"%ROWTYPE; prior "case_hearing_record_corrections"%ROWTYPE; a "audit_events"%ROWTYPE;
 r "case_section_record_edit_receipts"%ROWTYPE; current_case jsonb; before_values jsonb; after_values jsonb; before_files jsonb; after_files jsonb;
BEGIN
  SELECT * INTO original FROM "case_hearing_arrangements" WHERE "id"=NEW."arrangement_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
  SELECT to_jsonb(c) INTO current_case FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id" FOR UPDATE;
  IF original."id" IS NULL OR current_case IS DISTINCT FROM NEW."case_anchor_snapshot" THEN RAISE EXCEPTION 'section correction changed workflow anchors' USING ERRCODE='23514'; END IF;

  IF NOT case_record_edit_actor_authorized(NEW."recorded_by_user_id",NEW."case_id",NEW."department_id",'case.hearing.correct') THEN RAISE EXCEPTION 'section correction operator unauthorized' USING ERRCODE='23514'; END IF;
  IF NEW."from_revision"=0 THEN
    before_values:=jsonb_build_object('hearingAt',original."hearing_at");

  ELSE
    SELECT * INTO prior FROM "case_hearing_record_corrections" WHERE "id"=NEW."prior_correction_id" AND "arrangement_id"=NEW."arrangement_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
    IF prior."id" IS NULL OR prior."to_revision"<>NEW."from_revision" THEN RAISE EXCEPTION 'broken section correction chain' USING ERRCODE='23514'; END IF;
    before_values:=jsonb_build_object('hearingAt',prior."hearing_at");

  END IF;
  after_values:=jsonb_build_object('hearingAt',NEW."hearing_at");

  IF before_values=after_values THEN RAISE EXCEPTION 'section correction has no change' USING ERRCODE='23514'; END IF;

  SELECT * INTO a FROM "audit_events" WHERE "id"=NEW."audit_event_id" AND xmin=pg_current_xact_id()::text::xid;
  IF a."id" IS NULL OR a."department_id"<>NEW."department_id" OR a."resource_type"<>'CASE' OR a."resource_id"<>NEW."case_id" OR a."actor_user_id" IS DISTINCT FROM NEW."recorded_by_user_id" OR a."internal_actor_user_id" IS DISTINCT FROM NEW."recorded_by_user_id" OR a."action"<>'case.hearing.record-corrected' OR
    NOT (a."details" @> jsonb_build_object('correctionId',NEW."id",'arrangementId',NEW."arrangement_id",'fromRevision',NEW."from_revision",'toRevision',NEW."to_revision",'correctionReason',NEW."correction_reason",'trialRoundId',NEW."trial_round_id")) OR a."details"->'before' IS DISTINCT FROM before_values OR a."details"->'after' IS DISTINCT FROM after_values
  THEN RAISE EXCEPTION 'section correction audit mismatch' USING ERRCODE='23514'; END IF;
  SELECT * INTO r FROM "case_section_record_edit_receipts" WHERE "command"='HEARING_RECORD_CORRECTION' AND "department_id"=NEW."department_id" AND "case_id"=NEW."case_id" AND "actor_user_id"=NEW."recorded_by_user_id" AND "result_snapshot"->>'correctionId'=NEW."id"::text AND xmin=pg_current_xact_id()::text::xid;
  IF r."id" IS NULL OR r."result_snapshot" IS DISTINCT FROM jsonb_build_object('caseId',NEW."case_id",'correctionId',NEW."id",'recordedAt',to_char(NEW."recorded_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'arrangementId',NEW."arrangement_id",'hearingRevision',NEW."to_revision",'hearingAt',NEW."hearing_at",'trialRoundId',NEW."trial_round_id") THEN RAISE EXCEPTION 'section correction receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "hearing_record_anchor" BEFORE INSERT ON "case_hearing_record_corrections" FOR EACH ROW EXECUTE FUNCTION "capture_case_section_record_anchor"();
CREATE CONSTRAINT TRIGGER "hearing_record_guard" AFTER INSERT ON "case_hearing_record_corrections" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_hearing_record_correction"();
CREATE TRIGGER "hearing_record_immutable" BEFORE UPDATE OR DELETE ON "case_hearing_record_corrections" FOR EACH ROW EXECUTE FUNCTION "reject_case_acceptance_mutation"();
CREATE FUNCTION "check_judgment_record_correction"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original "case_judgment_facts"%ROWTYPE; prior "case_judgment_record_corrections"%ROWTYPE; a "audit_events"%ROWTYPE;
 r "case_section_record_edit_receipts"%ROWTYPE; current_case jsonb; before_values jsonb; after_values jsonb; before_files jsonb; after_files jsonb;
BEGIN
  SELECT * INTO original FROM "case_judgment_facts" WHERE "id"=NEW."judgment_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
  SELECT to_jsonb(c) INTO current_case FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id" FOR UPDATE;
  IF original."id" IS NULL OR current_case IS DISTINCT FROM NEW."case_anchor_snapshot" THEN RAISE EXCEPTION 'section correction changed workflow anchors' USING ERRCODE='23514'; END IF;

  IF NOT case_record_edit_actor_authorized(NEW."recorded_by_user_id",NEW."case_id",NEW."department_id",'case.judgment.correct') THEN RAISE EXCEPTION 'section correction operator unauthorized' USING ERRCODE='23514'; END IF;
  IF NEW."from_revision"=0 THEN
    before_values:=jsonb_build_object('judgmentReceivedAt',original."judgment_received_at",'judgmentAmountState',original."judgment_amount_state",'judgmentAmount',CASE WHEN original."judgment_amount" IS NULL THEN NULL ELSE to_char(original."judgment_amount",'FM999999999999990.00') END,'paidLitigationFeeState',original."paid_litigation_fee_state",'paidLitigationFee',CASE WHEN original."paid_litigation_fee" IS NULL THEN NULL ELSE to_char(original."paid_litigation_fee",'FM999999999999990.00') END);
    SELECT coalesce(jsonb_agg("content_version_id" ORDER BY "content_version_id"),'[]') INTO before_files FROM "case_judgment_versions" WHERE "fact_id"=NEW."judgment_id";
  ELSE
    SELECT * INTO prior FROM "case_judgment_record_corrections" WHERE "id"=NEW."prior_correction_id" AND "judgment_id"=NEW."judgment_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
    IF prior."id" IS NULL OR prior."to_revision"<>NEW."from_revision" THEN RAISE EXCEPTION 'broken section correction chain' USING ERRCODE='23514'; END IF;
    before_values:=jsonb_build_object('judgmentReceivedAt',prior."judgment_received_at",'judgmentAmountState',prior."judgment_amount_state",'judgmentAmount',CASE WHEN prior."judgment_amount" IS NULL THEN NULL ELSE to_char(prior."judgment_amount",'FM999999999999990.00') END,'paidLitigationFeeState',prior."paid_litigation_fee_state",'paidLitigationFee',CASE WHEN prior."paid_litigation_fee" IS NULL THEN NULL ELSE to_char(prior."paid_litigation_fee",'FM999999999999990.00') END);
    SELECT coalesce(jsonb_agg("content_version_id" ORDER BY "content_version_id"),'[]') INTO before_files FROM "case_judgment_record_documents" WHERE "correction_id"=prior."id";
  END IF;
  after_values:=jsonb_build_object('judgmentReceivedAt',NEW."judgment_received_at",'judgmentAmountState',NEW."judgment_amount_state",'judgmentAmount',CASE WHEN NEW."judgment_amount" IS NULL THEN NULL ELSE to_char(NEW."judgment_amount",'FM999999999999990.00') END,'paidLitigationFeeState',NEW."paid_litigation_fee_state",'paidLitigationFee',CASE WHEN NEW."paid_litigation_fee" IS NULL THEN NULL ELSE to_char(NEW."paid_litigation_fee",'FM999999999999990.00') END);
  SELECT coalesce(jsonb_agg("content_version_id" ORDER BY "content_version_id"),'[]') INTO after_files FROM "case_judgment_record_documents" WHERE "correction_id"=NEW."id";
  IF jsonb_array_length(after_files) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'invalid correction document count' USING ERRCODE='23514'; END IF;
  IF EXISTS (SELECT 1 FROM "case_judgment_record_documents" d WHERE d."correction_id"=NEW."id" AND NOT EXISTS (SELECT 1 FROM "material_references" r WHERE r."material_id"=d."material_id" AND r."content_version_id"=d."content_version_id" AND r."department_id"=d."department_id" AND r."resource_type"='case' AND r."resource_id"=d."case_id" AND r."purpose"='JUDGMENT' AND r."action_event_id"=NEW."audit_event_id")) THEN RAISE EXCEPTION 'correction document lacks exact retained material reference' USING ERRCODE='23514'; END IF;
  before_values:=before_values||jsonb_build_object('contentVersionIds',before_files); after_values:=after_values||jsonb_build_object('contentVersionIds',after_files);
  IF before_values=after_values THEN RAISE EXCEPTION 'section correction has no change' USING ERRCODE='23514'; END IF;
  IF NEW."judgment_received_at">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date THEN RAISE EXCEPTION 'future business date' USING ERRCODE='23514'; END IF;
  SELECT * INTO a FROM "audit_events" WHERE "id"=NEW."audit_event_id" AND xmin=pg_current_xact_id()::text::xid;
  IF a."id" IS NULL OR a."department_id"<>NEW."department_id" OR a."resource_type"<>'CASE' OR a."resource_id"<>NEW."case_id" OR a."actor_user_id" IS DISTINCT FROM NEW."recorded_by_user_id" OR a."internal_actor_user_id" IS DISTINCT FROM NEW."recorded_by_user_id" OR a."action"<>'case.judgment.record-corrected' OR
    NOT (a."details" @> jsonb_build_object('correctionId',NEW."id",'judgmentId',NEW."judgment_id",'fromRevision',NEW."from_revision",'toRevision',NEW."to_revision",'correctionReason',NEW."correction_reason",'trialRoundId',NEW."trial_round_id")) OR a."details"->'before' IS DISTINCT FROM before_values OR a."details"->'after' IS DISTINCT FROM after_values
  THEN RAISE EXCEPTION 'section correction audit mismatch' USING ERRCODE='23514'; END IF;
  SELECT * INTO r FROM "case_section_record_edit_receipts" WHERE "command"='JUDGMENT_RECORD_CORRECTION' AND "department_id"=NEW."department_id" AND "case_id"=NEW."case_id" AND "actor_user_id"=NEW."recorded_by_user_id" AND "result_snapshot"->>'correctionId'=NEW."id"::text AND xmin=pg_current_xact_id()::text::xid;
  IF r."id" IS NULL OR r."result_snapshot" IS DISTINCT FROM jsonb_build_object('caseId',NEW."case_id",'correctionId',NEW."id",'recordedAt',to_char(NEW."recorded_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'judgmentId',NEW."judgment_id",'judgmentRevision',NEW."to_revision",'judgmentReceivedAt',NEW."judgment_received_at",'trialRoundId',NEW."trial_round_id") THEN RAISE EXCEPTION 'section correction receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "judgment_record_anchor" BEFORE INSERT ON "case_judgment_record_corrections" FOR EACH ROW EXECUTE FUNCTION "capture_case_section_record_anchor"();
CREATE CONSTRAINT TRIGGER "judgment_record_guard" AFTER INSERT ON "case_judgment_record_corrections" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_judgment_record_correction"();
CREATE TRIGGER "judgment_record_immutable" BEFORE UPDATE OR DELETE ON "case_judgment_record_corrections" FOR EACH ROW EXECUTE FUNCTION "reject_case_acceptance_mutation"();
CREATE TRIGGER "judgment_record_documents_immutable" BEFORE UPDATE OR DELETE ON "case_judgment_record_documents" FOR EACH ROW EXECUTE FUNCTION "reject_case_acceptance_mutation"();
CREATE FUNCTION "check_judgment_record_document_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE same_tx boolean;
BEGIN
  SELECT xmin=pg_current_xact_id()::text::xid INTO same_tx FROM "case_judgment_record_corrections" WHERE "id"=NEW."correction_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
  IF same_tx IS DISTINCT FROM true THEN RAISE EXCEPTION 'cannot append documents to committed correction' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM "materials" m JOIN "content_versions" v ON v."material_id"=m."id" AND v."id"=NEW."content_version_id" WHERE m."id"=NEW."material_id" AND m."department_id"=NEW."department_id" AND m."owner_type"='CASE' AND m."owner_id"=NEW."case_id" AND m."deleted_at" IS NULL AND m."status"='ACTIVE' AND m."category"='JUDGMENT' AND m."purpose"='JUDGMENT' AND v."status"='AVAILABLE'
    AND v."mime_type" IN ('application/pdf','image/jpeg','image/png') AND v."size_bytes">0 AND v."size_bytes"<=52428800
    AND (m."current_version_id"=v."id" OR EXISTS (SELECT 1 FROM "material_references" r JOIN "audit_events" a ON a."id"=r."action_event_id" WHERE r."department_id"=NEW."department_id" AND r."resource_type"='case' AND r."resource_id"=NEW."case_id" AND r."material_id"=NEW."material_id" AND r."content_version_id"=NEW."content_version_id" AND r."purpose"='JUDGMENT' AND a."department_id"=NEW."department_id" AND a."resource_type"='CASE' AND a."resource_id"=NEW."case_id" AND a."action" IN ('case.judgment.registered','case.judgment.corrected','case.judgment.record-corrected') AND r."action_event_id"<>(SELECT "audit_event_id" FROM "case_judgment_record_corrections" WHERE "id"=NEW."correction_id"))) FOR SHARE OF m,v;
  IF NOT FOUND THEN RAISE EXCEPTION 'correction document has wrong case, department, category or unavailable bytes' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "judgment_record_document_insert" BEFORE INSERT ON "case_judgment_record_documents" FOR EACH ROW EXECUTE FUNCTION "check_judgment_record_document_insert"();
CREATE FUNCTION "check_closure_record_correction"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original "case_closure_versions"%ROWTYPE; prior "case_closure_record_corrections"%ROWTYPE; a "audit_events"%ROWTYPE;
 r "case_section_record_edit_receipts"%ROWTYPE; current_case jsonb; before_values jsonb; after_values jsonb; before_files jsonb; after_files jsonb;
BEGIN
  SELECT * INTO original FROM "case_closure_versions" WHERE "id"=NEW."source_closure_version_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
  SELECT to_jsonb(c) INTO current_case FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id" FOR UPDATE;
  IF original."id" IS NULL OR current_case IS DISTINCT FROM NEW."case_anchor_snapshot" THEN RAISE EXCEPTION 'section correction changed workflow anchors' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "case_closures" WHERE "id"=NEW."closure_id" AND "current_version_id"=NEW."source_closure_version_id") THEN RAISE EXCEPTION 'closure correction source changed' USING ERRCODE='23514'; END IF;
  IF NOT case_record_edit_actor_authorized(NEW."recorded_by_user_id",NEW."case_id",NEW."department_id",'case.closure.correct') THEN RAISE EXCEPTION 'section correction operator unauthorized' USING ERRCODE='23514'; END IF;
  IF NEW."from_revision"=0 THEN
    before_values:=jsonb_build_object('closeAt',original."close_at",'closeAmountState',original."close_amount_state",'closeAmt',CASE WHEN original."close_amt" IS NULL THEN NULL ELSE to_char(original."close_amt",'FM999999999999990.00') END,'note',original."note");
    SELECT coalesce(jsonb_agg("content_version_id" ORDER BY "content_version_id"),'[]') INTO before_files FROM "case_closure_documents" WHERE "closure_version_id"=NEW."source_closure_version_id";
  ELSE
    SELECT * INTO prior FROM "case_closure_record_corrections" WHERE "id"=NEW."prior_correction_id" AND "closure_id"=NEW."closure_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
    IF prior."id" IS NULL OR prior."to_revision"<>NEW."from_revision" OR prior."source_closure_version_id"<>NEW."source_closure_version_id" THEN RAISE EXCEPTION 'broken section correction chain' USING ERRCODE='23514'; END IF;
    before_values:=jsonb_build_object('closeAt',prior."close_at",'closeAmountState',prior."close_amount_state",'closeAmt',CASE WHEN prior."close_amt" IS NULL THEN NULL ELSE to_char(prior."close_amt",'FM999999999999990.00') END,'note',prior."note");
    SELECT coalesce(jsonb_agg("content_version_id" ORDER BY "content_version_id"),'[]') INTO before_files FROM "case_closure_record_documents" WHERE "correction_id"=prior."id";
  END IF;
  after_values:=jsonb_build_object('closeAt',NEW."close_at",'closeAmountState',NEW."close_amount_state",'closeAmt',CASE WHEN NEW."close_amt" IS NULL THEN NULL ELSE to_char(NEW."close_amt",'FM999999999999990.00') END,'note',NEW."note");
  SELECT coalesce(jsonb_agg("content_version_id" ORDER BY "content_version_id"),'[]') INTO after_files FROM "case_closure_record_documents" WHERE "correction_id"=NEW."id";
  IF jsonb_array_length(after_files) >10 THEN RAISE EXCEPTION 'invalid correction document count' USING ERRCODE='23514'; END IF;
  IF EXISTS (SELECT 1 FROM "case_closure_record_documents" d WHERE d."correction_id"=NEW."id" AND NOT EXISTS (SELECT 1 FROM "material_references" r WHERE r."material_id"=d."material_id" AND r."content_version_id"=d."content_version_id" AND r."department_id"=d."department_id" AND r."resource_type"='case' AND r."resource_id"=d."case_id" AND r."purpose"='CASE_CLOSURE_DOCUMENT' AND r."action_event_id"=NEW."audit_event_id")) THEN RAISE EXCEPTION 'correction document lacks exact retained material reference' USING ERRCODE='23514'; END IF;
  before_values:=before_values||jsonb_build_object('contentVersionIds',before_files); after_values:=after_values||jsonb_build_object('contentVersionIds',after_files);
  IF before_values=after_values THEN RAISE EXCEPTION 'section correction has no change' USING ERRCODE='23514'; END IF;
  IF NEW."close_at">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date THEN RAISE EXCEPTION 'future business date' USING ERRCODE='23514'; END IF;
  SELECT * INTO a FROM "audit_events" WHERE "id"=NEW."audit_event_id" AND xmin=pg_current_xact_id()::text::xid;
  IF a."id" IS NULL OR a."department_id"<>NEW."department_id" OR a."resource_type"<>'CASE' OR a."resource_id"<>NEW."case_id" OR a."actor_user_id" IS DISTINCT FROM NEW."recorded_by_user_id" OR a."internal_actor_user_id" IS DISTINCT FROM NEW."recorded_by_user_id" OR a."action"<>'case.closure.record-corrected' OR
    NOT (a."details" @> jsonb_build_object('correctionId',NEW."id",'closureId',NEW."closure_id",'fromRevision',NEW."from_revision",'toRevision',NEW."to_revision",'correctionReason',NEW."correction_reason")) OR a."details"->'before' IS DISTINCT FROM before_values OR a."details"->'after' IS DISTINCT FROM after_values
  THEN RAISE EXCEPTION 'section correction audit mismatch' USING ERRCODE='23514'; END IF;
  SELECT * INTO r FROM "case_section_record_edit_receipts" WHERE "command"='CLOSURE_RECORD_CORRECTION' AND "department_id"=NEW."department_id" AND "case_id"=NEW."case_id" AND "actor_user_id"=NEW."recorded_by_user_id" AND "result_snapshot"->>'correctionId'=NEW."id"::text AND xmin=pg_current_xact_id()::text::xid;
  IF r."id" IS NULL OR r."result_snapshot" IS DISTINCT FROM jsonb_build_object('caseId',NEW."case_id",'correctionId',NEW."id",'recordedAt',to_char(NEW."recorded_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'closureId',NEW."closure_id",'closureRevision',NEW."to_revision",'closeAt',NEW."close_at") THEN RAISE EXCEPTION 'section correction receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "closure_record_anchor" BEFORE INSERT ON "case_closure_record_corrections" FOR EACH ROW EXECUTE FUNCTION "capture_case_section_record_anchor"();
CREATE CONSTRAINT TRIGGER "closure_record_guard" AFTER INSERT ON "case_closure_record_corrections" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_closure_record_correction"();
CREATE TRIGGER "closure_record_immutable" BEFORE UPDATE OR DELETE ON "case_closure_record_corrections" FOR EACH ROW EXECUTE FUNCTION "reject_case_acceptance_mutation"();
CREATE TRIGGER "closure_record_documents_immutable" BEFORE UPDATE OR DELETE ON "case_closure_record_documents" FOR EACH ROW EXECUTE FUNCTION "reject_case_acceptance_mutation"();
CREATE FUNCTION "check_closure_record_document_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE same_tx boolean;
BEGIN
  SELECT xmin=pg_current_xact_id()::text::xid INTO same_tx FROM "case_closure_record_corrections" WHERE "id"=NEW."correction_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
  IF same_tx IS DISTINCT FROM true THEN RAISE EXCEPTION 'cannot append documents to committed correction' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM "materials" m JOIN "content_versions" v ON v."material_id"=m."id" AND v."id"=NEW."content_version_id" WHERE m."id"=NEW."material_id" AND m."department_id"=NEW."department_id" AND m."owner_type"='CASE' AND m."owner_id"=NEW."case_id" AND m."deleted_at" IS NULL AND m."status"='ACTIVE' AND m."category"='CASE_CLOSURE_DOCUMENT' AND m."purpose"='CASE_CLOSURE_DOCUMENT' AND v."status"='AVAILABLE'
    AND v."mime_type" IN ('application/pdf','image/jpeg','image/png') AND v."size_bytes">0 AND v."size_bytes"<=52428800
    AND (m."current_version_id"=v."id" OR EXISTS (SELECT 1 FROM "material_references" r JOIN "audit_events" a ON a."id"=r."action_event_id" WHERE r."department_id"=NEW."department_id" AND r."resource_type"='case' AND r."resource_id"=NEW."case_id" AND r."material_id"=NEW."material_id" AND r."content_version_id"=NEW."content_version_id" AND r."purpose"='CASE_CLOSURE_DOCUMENT' AND a."department_id"=NEW."department_id" AND a."resource_type"='CASE' AND a."resource_id"=NEW."case_id" AND a."action" IN ('case.closure.recorded','case.closure.corrected','case.closure.record-corrected') AND r."action_event_id"<>(SELECT "audit_event_id" FROM "case_closure_record_corrections" WHERE "id"=NEW."correction_id"))) FOR SHARE OF m,v;
  IF NOT FOUND THEN RAISE EXCEPTION 'correction document has wrong case, department, category or unavailable bytes' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "closure_record_document_insert" BEFORE INSERT ON "case_closure_record_documents" FOR EACH ROW EXECUTE FUNCTION "check_closure_record_document_insert"();
CREATE FUNCTION "check_case_section_record_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE exact_fact boolean;
BEGIN
  CASE NEW."command"
    WHEN 'EXECUTION_MAILING_CORRECTION' THEN SELECT EXISTS (SELECT 1 FROM "case_execution_mailing_record_corrections" c WHERE c."id"::text=NEW."result_snapshot"->>'correctionId' AND c."case_id"=NEW."case_id" AND c."department_id"=NEW."department_id" AND c."recorded_by_user_id"=NEW."actor_user_id") INTO exact_fact;
    WHEN 'EXECUTION_FILING_CORRECTION' THEN SELECT EXISTS (SELECT 1 FROM "case_execution_filing_record_corrections" c WHERE c."id"::text=NEW."result_snapshot"->>'correctionId' AND c."case_id"=NEW."case_id" AND c."department_id"=NEW."department_id" AND c."recorded_by_user_id"=NEW."actor_user_id") INTO exact_fact;
    WHEN 'EXECUTION_FINISH_CORRECTION' THEN SELECT EXISTS (SELECT 1 FROM "case_execution_finish_record_corrections" c WHERE c."id"::text=NEW."result_snapshot"->>'correctionId' AND c."case_id"=NEW."case_id" AND c."department_id"=NEW."department_id" AND c."recorded_by_user_id"=NEW."actor_user_id") INTO exact_fact;
    WHEN 'HEARING_RECORD_CORRECTION' THEN SELECT EXISTS (SELECT 1 FROM "case_hearing_record_corrections" c WHERE c."id"::text=NEW."result_snapshot"->>'correctionId' AND c."case_id"=NEW."case_id" AND c."department_id"=NEW."department_id" AND c."recorded_by_user_id"=NEW."actor_user_id") INTO exact_fact;
    WHEN 'JUDGMENT_RECORD_CORRECTION' THEN SELECT EXISTS (SELECT 1 FROM "case_judgment_record_corrections" c WHERE c."id"::text=NEW."result_snapshot"->>'correctionId' AND c."case_id"=NEW."case_id" AND c."department_id"=NEW."department_id" AND c."recorded_by_user_id"=NEW."actor_user_id") INTO exact_fact;
    WHEN 'CLOSURE_RECORD_CORRECTION' THEN SELECT EXISTS (SELECT 1 FROM "case_closure_record_corrections" c WHERE c."id"::text=NEW."result_snapshot"->>'correctionId' AND c."case_id"=NEW."case_id" AND c."department_id"=NEW."department_id" AND c."recorded_by_user_id"=NEW."actor_user_id") INTO exact_fact;
  END CASE;
  IF exact_fact IS DISTINCT FROM true THEN RAISE EXCEPTION 'section receipt lacks its exact correction' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "case_section_record_receipt_guard" AFTER INSERT ON "case_section_record_edit_receipts" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_section_record_receipt"();
CREATE TRIGGER "case_section_record_receipt_immutable" BEFORE UPDATE OR DELETE ON "case_section_record_edit_receipts" FOR EACH ROW EXECUTE FUNCTION "reject_case_acceptance_mutation"();


CREATE FUNCTION "reject_case_section_record_reference_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (EXISTS (SELECT 1 FROM "case_execution_mailing_record_documents" d JOIN "case_execution_mailing_record_corrections" c ON c."id"=d."correction_id" WHERE d."material_id"=OLD."material_id" AND d."content_version_id"=OLD."content_version_id" AND d."department_id"=OLD."department_id" AND d."case_id"=OLD."resource_id" AND OLD."resource_type"='case' AND c."audit_event_id"=OLD."action_event_id") OR EXISTS (SELECT 1 FROM "case_execution_filing_record_documents" d JOIN "case_execution_filing_record_corrections" c ON c."id"=d."correction_id" WHERE d."material_id"=OLD."material_id" AND d."content_version_id"=OLD."content_version_id" AND d."department_id"=OLD."department_id" AND d."case_id"=OLD."resource_id" AND OLD."resource_type"='case' AND c."audit_event_id"=OLD."action_event_id") OR EXISTS (SELECT 1 FROM "case_execution_finish_record_documents" d JOIN "case_execution_finish_record_corrections" c ON c."id"=d."correction_id" WHERE d."material_id"=OLD."material_id" AND d."content_version_id"=OLD."content_version_id" AND d."department_id"=OLD."department_id" AND d."case_id"=OLD."resource_id" AND OLD."resource_type"='case' AND c."audit_event_id"=OLD."action_event_id") OR EXISTS (SELECT 1 FROM "case_judgment_record_documents" d JOIN "case_judgment_record_corrections" c ON c."id"=d."correction_id" WHERE d."material_id"=OLD."material_id" AND d."content_version_id"=OLD."content_version_id" AND d."department_id"=OLD."department_id" AND d."case_id"=OLD."resource_id" AND OLD."resource_type"='case' AND c."audit_event_id"=OLD."action_event_id") OR EXISTS (SELECT 1 FROM "case_closure_record_documents" d JOIN "case_closure_record_corrections" c ON c."id"=d."correction_id" WHERE d."material_id"=OLD."material_id" AND d."content_version_id"=OLD."content_version_id" AND d."department_id"=OLD."department_id" AND d."case_id"=OLD."resource_id" AND OLD."resource_type"='case' AND c."audit_event_id"=OLD."action_event_id")) THEN
    RAISE EXCEPTION 'section correction material reference is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_section_record_reference_immutable" BEFORE UPDATE OR DELETE ON "material_references" FOR EACH ROW EXECUTE FUNCTION "reject_case_section_record_reference_mutation"();

CREATE FUNCTION "check_case_section_record_reference_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_action text; exact_document boolean;
BEGIN
  SELECT "action" INTO event_action FROM "audit_events" WHERE "id"=NEW."action_event_id";
  IF event_action IN ('case.execution.mailing.record-corrected','case.execution.filing.record-corrected','case.execution.finish.record-corrected','case.hearing.record-corrected','case.judgment.record-corrected','case.closure.record-corrected') THEN
    SELECT (EXISTS (SELECT 1 FROM "case_execution_mailing_record_documents" d JOIN "case_execution_mailing_record_corrections" c ON c."id"=d."correction_id" WHERE d."material_id"=NEW."material_id" AND d."content_version_id"=NEW."content_version_id" AND d."department_id"=NEW."department_id" AND d."case_id"=NEW."resource_id" AND NEW."resource_type"='case' AND NEW."purpose"='MAIL_RECEIPT' AND NEW."asset_version_id" IS NULL AND c."audit_event_id"=NEW."action_event_id") OR EXISTS (SELECT 1 FROM "case_execution_filing_record_documents" d JOIN "case_execution_filing_record_corrections" c ON c."id"=d."correction_id" WHERE d."material_id"=NEW."material_id" AND d."content_version_id"=NEW."content_version_id" AND d."department_id"=NEW."department_id" AND d."case_id"=NEW."resource_id" AND NEW."resource_type"='case' AND NEW."purpose"='EXECUTION_FILING_PROOF' AND NEW."asset_version_id" IS NULL AND c."audit_event_id"=NEW."action_event_id") OR EXISTS (SELECT 1 FROM "case_execution_finish_record_documents" d JOIN "case_execution_finish_record_corrections" c ON c."id"=d."correction_id" WHERE d."material_id"=NEW."material_id" AND d."content_version_id"=NEW."content_version_id" AND d."department_id"=NEW."department_id" AND d."case_id"=NEW."resource_id" AND NEW."resource_type"='case' AND NEW."purpose"='EXECUTION_FINISH_BASIS' AND NEW."asset_version_id" IS NULL AND c."audit_event_id"=NEW."action_event_id") OR EXISTS (SELECT 1 FROM "case_judgment_record_documents" d JOIN "case_judgment_record_corrections" c ON c."id"=d."correction_id" WHERE d."material_id"=NEW."material_id" AND d."content_version_id"=NEW."content_version_id" AND d."department_id"=NEW."department_id" AND d."case_id"=NEW."resource_id" AND NEW."resource_type"='case' AND NEW."purpose"='JUDGMENT' AND NEW."asset_version_id" IS NULL AND c."audit_event_id"=NEW."action_event_id") OR EXISTS (SELECT 1 FROM "case_closure_record_documents" d JOIN "case_closure_record_corrections" c ON c."id"=d."correction_id" WHERE d."material_id"=NEW."material_id" AND d."content_version_id"=NEW."content_version_id" AND d."department_id"=NEW."department_id" AND d."case_id"=NEW."resource_id" AND NEW."resource_type"='case' AND NEW."purpose"='CASE_CLOSURE_DOCUMENT' AND NEW."asset_version_id" IS NULL AND c."audit_event_id"=NEW."action_event_id")) INTO exact_document;
    IF exact_document IS DISTINCT FROM true THEN RAISE EXCEPTION 'section correction reference lacks exact document' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "case_section_record_reference_guard" AFTER INSERT ON "material_references" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_section_record_reference_insert"();

CREATE FUNCTION "reject_case_section_record_audit_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."action" IN ('case.execution.mailing.record-corrected','case.execution.filing.record-corrected','case.execution.finish.record-corrected','case.hearing.record-corrected','case.judgment.record-corrected','case.closure.record-corrected') OR (TG_OP='UPDATE' AND NEW."action" IN ('case.execution.mailing.record-corrected','case.execution.filing.record-corrected','case.execution.finish.record-corrected','case.hearing.record-corrected','case.judgment.record-corrected','case.closure.record-corrected')) THEN
    RAISE EXCEPTION 'section correction audit is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_section_record_audit_immutable" BEFORE UPDATE OR DELETE ON "audit_events" FOR EACH ROW EXECUTE FUNCTION "reject_case_section_record_audit_mutation"();

CREATE FUNCTION "reject_case_closure_record_source_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."current_version_id" IS DISTINCT FROM NEW."current_version_id" AND EXISTS (SELECT 1 FROM "case_closure_record_corrections" WHERE "closure_id"=OLD."id" AND "case_id"=OLD."case_id" AND "department_id"=OLD."department_id") THEN
    RAISE EXCEPTION 'closure record corrections retain their exact frozen source' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_closure_record_source_immutable" BEFORE UPDATE OF "current_version_id" ON "case_closures" FOR EACH ROW EXECUTE FUNCTION "reject_case_closure_record_source_change"();

CREATE FUNCTION "reject_case_section_frozen_content_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (EXISTS (SELECT 1 FROM "case_execution_mailing_record_documents" WHERE "content_version_id"=OLD."id") OR EXISTS (SELECT 1 FROM "case_execution_filing_record_documents" WHERE "content_version_id"=OLD."id") OR EXISTS (SELECT 1 FROM "case_execution_finish_record_documents" WHERE "content_version_id"=OLD."id") OR EXISTS (SELECT 1 FROM "case_judgment_record_documents" WHERE "content_version_id"=OLD."id") OR EXISTS (SELECT 1 FROM "case_closure_record_documents" WHERE "content_version_id"=OLD."id")) AND (TG_OP='DELETE' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)) THEN
    RAISE EXCEPTION 'section correction content is frozen' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_section_frozen_content_immutable" BEFORE UPDATE OR DELETE ON "content_versions" FOR EACH ROW EXECUTE FUNCTION "reject_case_section_frozen_content_mutation"();

CREATE FUNCTION "reject_case_section_frozen_material_deletion"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (EXISTS (SELECT 1 FROM "case_execution_mailing_record_documents" WHERE "material_id"=OLD."id") OR EXISTS (SELECT 1 FROM "case_execution_filing_record_documents" WHERE "material_id"=OLD."id") OR EXISTS (SELECT 1 FROM "case_execution_finish_record_documents" WHERE "material_id"=OLD."id") OR EXISTS (SELECT 1 FROM "case_judgment_record_documents" WHERE "material_id"=OLD."id") OR EXISTS (SELECT 1 FROM "case_closure_record_documents" WHERE "material_id"=OLD."id")) AND (TG_OP='DELETE' OR NEW."status" IS DISTINCT FROM OLD."status" OR NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at" OR (NEW."owner_type",NEW."owner_id",NEW."department_id",NEW."category",NEW."purpose") IS DISTINCT FROM (OLD."owner_type",OLD."owner_id",OLD."department_id",OLD."category",OLD."purpose")) THEN
    RAISE EXCEPTION 'section correction material is frozen' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_section_frozen_material_deletion" BEFORE UPDATE OR DELETE ON "materials" FOR EACH ROW EXECUTE FUNCTION "reject_case_section_frozen_material_deletion"();

-- E handoff to S only. Not executed. S owns the sole formal migration.
-- Preserve existing execution action gates only: valid date/today/exact external stageReachedOn. No inferred acceptance/closure/archive/finish-filing ordering.
CREATE FUNCTION case_execution_record_date_valid(target_case uuid, target_department uuid, target_date date)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE c cases%ROWTYPE; e case_external_entries%ROWTYPE;
BEGIN
  SELECT * INTO c FROM cases WHERE id=target_case AND department_id=target_department;
  IF c.id IS NULL OR target_date IS NULL OR target_date>(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date THEN RETURN false; END IF;
  SELECT * INTO e FROM case_external_entries WHERE case_id=c.id AND department_id=c.department_id;
  IF e.id IS NOT NULL THEN
    IF c.source_lead_id IS NOT NULL OR c.source_notary_matter_id IS NOT NULL OR c.certificate_id IS NOT NULL THEN RETURN false; END IF;
    IF target_date<e.stage_reached_on THEN RETURN false; END IF;
  ELSIF c.source_lead_id IS NULL OR c.source_notary_matter_id IS NULL OR c.certificate_id IS NULL THEN RETURN false;
  END IF;
  RETURN true;
END; $$;
CREATE FUNCTION check_case_execution_record_date() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate date; original_entry uuid; actual_entry uuid; root_found boolean;
BEGIN
  -- S anchor trigger already acquires the shared case lock and preserves the entire cases row.
  IF TG_TABLE_NAME='case_execution_mailing_record_corrections' THEN
    candidate:=NEW.mailed_at;
    SELECT true,external_entry_id INTO root_found,original_entry FROM case_execution_mailings
      WHERE id=NEW.mailing_id AND case_id=NEW.case_id AND department_id=NEW.department_id;
  ELSIF TG_TABLE_NAME='case_execution_filing_record_corrections' THEN
    candidate:=NEW.submitted_at;
    SELECT true,external_entry_id INTO root_found,original_entry FROM case_execution_filings
      WHERE id=NEW.filing_id AND case_id=NEW.case_id AND department_id=NEW.department_id;
  ELSIF TG_TABLE_NAME='case_execution_finish_record_corrections' THEN
    candidate:=NEW.finished_at;
    SELECT true,external_entry_id INTO root_found,original_entry FROM case_execution_finishes
      WHERE id=NEW.finish_id AND case_id=NEW.case_id AND department_id=NEW.department_id;
  ELSE RAISE EXCEPTION 'unsupported execution correction target' USING ERRCODE='23514'; END IF;
  SELECT id INTO actual_entry FROM case_external_entries WHERE case_id=NEW.case_id AND department_id=NEW.department_id;
  IF root_found IS DISTINCT FROM true OR original_entry IS DISTINCT FROM actual_entry OR
    case_execution_record_date_valid(NEW.case_id,NEW.department_id,candidate) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'execution correction conflicts with exact source or effective dates' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER execution_mailing_record_date_guard AFTER INSERT ON case_execution_mailing_record_corrections
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_record_date();
CREATE CONSTRAINT TRIGGER execution_filing_record_date_guard AFTER INSERT ON case_execution_filing_record_corrections
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_record_date();
CREATE CONSTRAINT TRIGGER execution_finish_record_date_guard AFTER INSERT ON case_execution_finish_record_corrections
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_record_date();

-- H handoff only. S owns final migration. Not executed against any database.
-- Install after all six correction models exist. No stage-order or finish>=filing rule.
CREATE FUNCTION case_section_trial_date_valid(cid uuid, did uuid, rid uuid, p_kind text, proposed date, advanced boolean)
RETURNS boolean LANGUAGE sql STABLE AS $$
WITH RECURSIVE rounds AS (
  SELECT id FROM case_trial_rounds WHERE id=rid AND case_id=cid AND department_id=did
  UNION
  SELECT child.id FROM case_trial_rounds child
  JOIN case_second_instance_results result ON result.id=child.source_result_id
    AND result.case_id=child.case_id AND result.department_id=child.department_id
  JOIN rounds parent ON parent.id=result.trial_round_id
  WHERE child.case_id=cid AND child.department_id=did
), lower_dates AS (
  SELECT parent.result_received_at AS value FROM case_trial_rounds round
  JOIN case_second_instance_results parent ON parent.id=round.source_result_id
    AND parent.case_id=round.case_id AND parent.department_id=round.department_id
  WHERE round.id=rid AND round.case_id=cid AND round.department_id=did
  UNION ALL
  SELECT CASE WHEN edit.id IS NULL THEN a.accepted_at ELSE edit.accepted_at END
  FROM case_acceptances a
  LEFT JOIN LATERAL (SELECT id,accepted_at FROM case_acceptance_corrections e
    WHERE e.acceptance_id=a.id AND e.case_id=cid AND e.department_id=did ORDER BY to_revision DESC LIMIT 1) edit ON true
  WHERE a.trial_round_id=rid AND a.case_id=cid AND a.department_id=did
  UNION ALL
  SELECT CASE WHEN edit.id IS NULL THEN a.hearing_at ELSE edit.hearing_at END
  FROM case_hearing_advances advance JOIN case_hearing_arrangements a
    ON a.id=advance.arrangement_id AND a.case_id=advance.case_id AND a.department_id=advance.department_id
  LEFT JOIN LATERAL (SELECT id,hearing_at FROM case_hearing_record_corrections e
    WHERE e.arrangement_id=a.id AND e.case_id=cid AND e.department_id=did ORDER BY to_revision DESC LIMIT 1) edit ON true
  WHERE p_kind='JUDGMENT' AND advance.trial_round_id=rid AND advance.case_id=cid AND advance.department_id=did
  UNION ALL
  SELECT entry.stage_reached_on FROM case_trial_rounds round JOIN case_external_entries entry
    ON entry.id=round.external_entry_id AND entry.case_id=round.case_id AND entry.department_id=round.department_id
  WHERE round.id=rid AND round.case_id=cid AND round.department_id=did AND round.source_result_id IS NULL
  UNION ALL
  SELECT (entry.known->>'acceptedOn')::date FROM case_trial_rounds round JOIN case_external_entries entry
    ON entry.id=round.external_entry_id AND entry.case_id=round.case_id AND entry.department_id=round.department_id
  WHERE round.id=rid AND round.case_id=cid AND round.department_id=did AND round.source_result_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM case_acceptances a WHERE a.trial_round_id=rid AND a.case_id=cid AND a.department_id=did)
), upper_dates AS (
  SELECT CASE WHEN edit.id IS NULL THEN j.judgment_received_at ELSE edit.judgment_received_at END AS value
  FROM case_judgment_facts j LEFT JOIN LATERAL (SELECT id,judgment_received_at FROM case_judgment_record_corrections e
    WHERE e.judgment_id=j.id AND e.case_id=cid AND e.department_id=did ORDER BY to_revision DESC LIMIT 1) edit ON true
  WHERE p_kind='HEARING' AND j.case_id=cid AND j.department_id=did AND j.trial_round_id IN (SELECT id FROM rounds)
  UNION ALL
  SELECT hearing_at FROM case_second_instance_progresses WHERE case_id=cid AND department_id=did AND trial_round_id IN (SELECT id FROM rounds)
  UNION ALL
  SELECT result_received_at FROM case_second_instance_results WHERE case_id=cid AND department_id=did AND trial_round_id IN (SELECT id FROM rounds)
  UNION ALL
  SELECT accepted_at FROM (SELECT DISTINCT ON (choice_id,trial_round_id) accepted_at
    FROM case_second_instance_acceptance_changes WHERE case_id=cid AND department_id=did AND trial_round_id IN (SELECT id FROM rounds)
    ORDER BY choice_id,trial_round_id,to_revision DESC) acceptance_heads
  UNION ALL
  SELECT CASE WHEN edit.id IS NULL THEN a.accepted_at ELSE edit.accepted_at END
  FROM case_acceptances a LEFT JOIN LATERAL (SELECT id,accepted_at FROM case_acceptance_corrections e
    WHERE e.acceptance_id=a.id AND e.case_id=cid AND e.department_id=did ORDER BY to_revision DESC LIMIT 1) edit ON true
  WHERE a.case_id=cid AND a.department_id=did AND a.trial_round_id IN (SELECT id FROM rounds WHERE id<>rid)
)
SELECT EXISTS(SELECT 1 FROM case_trial_rounds WHERE id=rid AND case_id=cid AND department_id=did AND revoked_at IS NULL)
  AND CASE WHEN proposed IS NULL THEN NOT advanced AND NOT EXISTS(SELECT 1 FROM upper_dates WHERE value IS NOT NULL)
  ELSE proposed >= ALL(SELECT value FROM lower_dates WHERE value IS NOT NULL)
    AND proposed <= ALL(SELECT value FROM upper_dates WHERE value IS NOT NULL)
    AND (NOT advanced AND NOT EXISTS(SELECT 1 FROM upper_dates WHERE value IS NOT NULL)
      OR proposed <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date) END;
$$;

CREATE FUNCTION case_section_closure_date_valid(cid uuid,did uuid,proposed date)
RETURNS boolean LANGUAGE sql STABLE AS $$
SELECT proposed IS NULL OR (
  proposed <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date
  AND NOT EXISTS(SELECT 1 FROM case_external_entries WHERE case_id=cid AND department_id=did AND proposed<stage_reached_on)
);
$$;

CREATE FUNCTION check_case_historical_record_dates() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid boolean;
BEGIN
  -- S anchor trigger acquires the same case lock. Keep a lock here for direct SQL callers.
  PERFORM 1 FROM cases WHERE id=NEW.case_id AND department_id=NEW.department_id FOR UPDATE;
  IF TG_TABLE_NAME='case_hearing_record_corrections' THEN
    valid := case_section_trial_date_valid(NEW.case_id,NEW.department_id,NEW.trial_round_id,'HEARING',NEW.hearing_at,
      EXISTS(SELECT 1 FROM case_hearing_advances WHERE arrangement_id=NEW.arrangement_id AND case_id=NEW.case_id AND department_id=NEW.department_id));
  ELSIF TG_TABLE_NAME='case_judgment_record_corrections' THEN
    valid := case_section_trial_date_valid(NEW.case_id,NEW.department_id,NEW.trial_round_id,'JUDGMENT',NEW.judgment_received_at,true);
  ELSE
    valid := case_section_closure_date_valid(NEW.case_id,NEW.department_id,NEW.close_at);
  END IF;
  IF valid IS DISTINCT FROM true THEN RAISE EXCEPTION 'conflicting historical section business date' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER case_hearing_record_dates BEFORE INSERT ON case_hearing_record_corrections FOR EACH ROW EXECUTE FUNCTION check_case_historical_record_dates();
CREATE TRIGGER case_judgment_record_dates BEFORE INSERT ON case_judgment_record_corrections FOR EACH ROW EXECUTE FUNCTION check_case_historical_record_dates();
CREATE TRIGGER case_closure_record_dates BEFORE INSERT ON case_closure_record_corrections FOR EACH ROW EXECUTE FUNCTION check_case_historical_record_dates();


CREATE CONSTRAINT TRIGGER case_hearing_record_dates_final AFTER INSERT ON case_hearing_record_corrections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_historical_record_dates();

CREATE CONSTRAINT TRIGGER case_judgment_record_dates_final AFTER INSERT ON case_judgment_record_corrections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_historical_record_dates();

CREATE CONSTRAINT TRIGGER case_closure_record_dates_final AFTER INSERT ON case_closure_record_corrections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_historical_record_dates();

-- Effective date inputs for existing exact source constraints. No new ordering rule.
CREATE FUNCTION "case_section_hearing_date"(target_id uuid) RETURNS date LANGUAGE sql STABLE AS $date$
  SELECT CASE WHEN edit."id" IS NULL THEN root."hearing_at" ELSE edit."hearing_at" END
  FROM "case_hearing_arrangements" root
  LEFT JOIN LATERAL (SELECT c."id",c."hearing_at" FROM "case_hearing_record_corrections" c
    WHERE c."arrangement_id"=root."id" AND c."case_id"=root."case_id" AND c."department_id"=root."department_id"
    ORDER BY c."to_revision" DESC LIMIT 1) edit ON true
  WHERE root."id"=target_id;
$date$;
CREATE FUNCTION "case_section_judgment_date"(target_id uuid) RETURNS date LANGUAGE sql STABLE AS $date$
  SELECT CASE WHEN edit."id" IS NULL THEN root."judgment_received_at" ELSE edit."judgment_received_at" END
  FROM "case_judgment_facts" root
  LEFT JOIN LATERAL (SELECT c."id",c."judgment_received_at" FROM "case_judgment_record_corrections" c
    WHERE c."judgment_id"=root."id" AND c."case_id"=root."case_id" AND c."department_id"=root."department_id"
    ORDER BY c."to_revision" DESC LIMIT 1) edit ON true
  WHERE root."id"=target_id;
$date$;
CREATE FUNCTION "case_section_execution_mailing_date"(target_id uuid) RETURNS date LANGUAGE sql STABLE AS $date$
  SELECT CASE WHEN edit."id" IS NULL THEN root."mailed_at" ELSE edit."mailed_at" END
  FROM "case_execution_mailings" root
  LEFT JOIN LATERAL (SELECT c."id",c."mailed_at" FROM "case_execution_mailing_record_corrections" c
    WHERE c."mailing_id"=root."id" AND c."case_id"=root."case_id" AND c."department_id"=root."department_id"
    ORDER BY c."to_revision" DESC LIMIT 1) edit ON true
  WHERE root."id"=target_id;
$date$;
CREATE FUNCTION "case_section_execution_filing_date"(target_id uuid) RETURNS date LANGUAGE sql STABLE AS $date$
  SELECT CASE WHEN edit."id" IS NULL THEN root."submitted_at" ELSE edit."submitted_at" END
  FROM "case_execution_filings" root
  LEFT JOIN LATERAL (SELECT c."id",c."submitted_at" FROM "case_execution_filing_record_corrections" c
    WHERE c."filing_id"=root."id" AND c."case_id"=root."case_id" AND c."department_id"=root."department_id"
    ORDER BY c."to_revision" DESC LIMIT 1) edit ON true
  WHERE root."id"=target_id;
$date$;
CREATE FUNCTION "case_section_execution_finish_date"(target_id uuid) RETURNS date LANGUAGE sql STABLE AS $date$
  SELECT CASE WHEN edit."id" IS NULL THEN root."finished_at" ELSE edit."finished_at" END
  FROM "case_execution_finishes" root
  LEFT JOIN LATERAL (SELECT c."id",c."finished_at" FROM "case_execution_finish_record_corrections" c
    WHERE c."finish_id"=root."id" AND c."case_id"=root."case_id" AND c."department_id"=root."department_id"
    ORDER BY c."to_revision" DESC LIMIT 1) edit ON true
  WHERE root."id"=target_id;
$date$;
CREATE FUNCTION "case_section_closure_version_date"(target_id uuid) RETURNS date LANGUAGE sql STABLE AS $date$
  SELECT CASE WHEN edit."id" IS NULL THEN version."close_at" ELSE edit."close_at" END
  FROM "case_closure_versions" version
  LEFT JOIN "case_closures" root ON root."id"=version."closure_id" AND root."current_version_id"=version."id"
    AND root."case_id"=version."case_id" AND root."department_id"=version."department_id"
  LEFT JOIN LATERAL (SELECT c."id",c."close_at" FROM "case_closure_record_corrections" c
    WHERE c."closure_id"=root."id" AND c."source_closure_version_id"=version."id"
      AND c."case_id"=version."case_id" AND c."department_id"=version."department_id"
    ORDER BY c."to_revision" DESC LIMIT 1) edit ON true
  WHERE version."id"=target_id;
$date$;

-- Preserve the installed check_case_hearing_fact logic, changing only its enumerated date inputs.
DO $compat$
DECLARE definition text; function_count integer;
BEGIN
  SELECT count(*),min(pg_get_functiondef(p."oid")) INTO function_count,definition
    FROM "pg_proc" p JOIN "pg_namespace" n ON n."oid"=p."pronamespace"
    WHERE p."proname"='check_case_hearing_fact' AND n."nspname"=current_schema();
  IF function_count<>1 THEN RAISE EXCEPTION 'expected one installed check_case_hearing_fact'; END IF;
  IF position($old$AND ar."hearing_at" IS NOT NULL$old$ IN definition)=0 THEN RAISE EXCEPTION 'missing exact check_case_hearing_fact date input'; END IF;
  definition:=replace(definition,$old$AND ar."hearing_at" IS NOT NULL$old$,$new$AND case_section_hearing_date(ar."id") IS NOT NULL$new$);
  IF position($old$((ar."hearing_at" + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')$old$ IN definition)=0 THEN RAISE EXCEPTION 'missing exact check_case_hearing_fact date input'; END IF;
  definition:=replace(definition,$old$((ar."hearing_at" + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')$old$,$new$((case_section_hearing_date(ar."id") + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')$new$);
  EXECUTE definition;
END;
$compat$;

-- Preserve the installed check_case_acceptance_correction_final logic, changing only its enumerated date inputs.
DO $compat$
DECLARE definition text; function_count integer;
BEGIN
  SELECT count(*),min(pg_get_functiondef(p."oid")) INTO function_count,definition
    FROM "pg_proc" p JOIN "pg_namespace" n ON n."oid"=p."pronamespace"
    WHERE p."proname"='check_case_acceptance_correction_final' AND n."nspname"=current_schema();
  IF function_count<>1 THEN RAISE EXCEPTION 'expected one installed check_case_acceptance_correction_final'; END IF;
  IF position($old$h."hearing_at"$old$ IN definition)=0 THEN RAISE EXCEPTION 'missing exact check_case_acceptance_correction_final date input'; END IF;
  definition:=replace(definition,$old$h."hearing_at"$old$,$new$case_section_hearing_date(h."id")$new$);
  IF position($old$j."judgment_received_at"$old$ IN definition)=0 THEN RAISE EXCEPTION 'missing exact check_case_acceptance_correction_final date input'; END IF;
  definition:=replace(definition,$old$j."judgment_received_at"$old$,$new$case_section_judgment_date(j."id")$new$);
  IF position($old$m."mailed_at"$old$ IN definition)=0 THEN RAISE EXCEPTION 'missing exact check_case_acceptance_correction_final date input'; END IF;
  definition:=replace(definition,$old$m."mailed_at"$old$,$new$case_section_execution_mailing_date(m."id")$new$);
  IF position($old$f."submitted_at"$old$ IN definition)=0 THEN RAISE EXCEPTION 'missing exact check_case_acceptance_correction_final date input'; END IF;
  definition:=replace(definition,$old$f."submitted_at"$old$,$new$case_section_execution_filing_date(f."id")$new$);
  IF position($old$f."finished_at"$old$ IN definition)=0 THEN RAISE EXCEPTION 'missing exact check_case_acceptance_correction_final date input'; END IF;
  definition:=replace(definition,$old$f."finished_at"$old$,$new$case_section_execution_finish_date(f."id")$new$);
  IF position($old$v."close_at"$old$ IN definition)=0 THEN RAISE EXCEPTION 'missing exact check_case_acceptance_correction_final date input'; END IF;
  definition:=replace(definition,$old$v."close_at"$old$,$new$case_section_closure_version_date(v."id")$new$);
  EXECUTE definition;
END;
$compat$;

-- Preserve the installed check_case_second_acceptance_dates logic, changing only its enumerated date inputs.
DO $compat$
DECLARE definition text; function_count integer;
BEGIN
  SELECT count(*),min(pg_get_functiondef(p."oid")) INTO function_count,definition
    FROM "pg_proc" p JOIN "pg_namespace" n ON n."oid"=p."pronamespace"
    WHERE p."proname"='check_case_second_acceptance_dates' AND n."nspname"=current_schema();
  IF function_count<>1 THEN RAISE EXCEPTION 'expected one installed check_case_second_acceptance_dates'; END IF;
  IF position($old$j."judgment_received_at"$old$ IN definition)=0 THEN RAISE EXCEPTION 'missing exact check_case_second_acceptance_dates date input'; END IF;
  definition:=replace(definition,$old$j."judgment_received_at"$old$,$new$case_section_judgment_date(j."id")$new$);
  IF position($old$m."mailed_at"$old$ IN definition)=0 THEN RAISE EXCEPTION 'missing exact check_case_second_acceptance_dates date input'; END IF;
  definition:=replace(definition,$old$m."mailed_at"$old$,$new$case_section_execution_mailing_date(m."id")$new$);
  IF position($old$f."submitted_at"$old$ IN definition)=0 THEN RAISE EXCEPTION 'missing exact check_case_second_acceptance_dates date input'; END IF;
  definition:=replace(definition,$old$f."submitted_at"$old$,$new$case_section_execution_filing_date(f."id")$new$);
  IF position($old$f."finished_at"$old$ IN definition)=0 THEN RAISE EXCEPTION 'missing exact check_case_second_acceptance_dates date input'; END IF;
  definition:=replace(definition,$old$f."finished_at"$old$,$new$case_section_execution_finish_date(f."id")$new$);
  IF position($old$v."close_at"$old$ IN definition)=0 THEN RAISE EXCEPTION 'missing exact check_case_second_acceptance_dates date input'; END IF;
  definition:=replace(definition,$old$v."close_at"$old$,$new$case_section_closure_version_date(v."id")$new$);
  EXECUTE definition;
END;
$compat$;

-- Preserve the installed check_case_second_acceptance_dependent_date logic, changing only its enumerated date inputs.
DO $compat$
DECLARE definition text; function_count integer;
BEGIN
  SELECT count(*),min(pg_get_functiondef(p."oid")) INTO function_count,definition
    FROM "pg_proc" p JOIN "pg_namespace" n ON n."oid"=p."pronamespace"
    WHERE p."proname"='check_case_second_acceptance_dependent_date' AND n."nspname"=current_schema();
  IF function_count<>1 THEN RAISE EXCEPTION 'expected one installed check_case_second_acceptance_dependent_date'; END IF;
  IF position($old$j."judgment_received_at"$old$ IN definition)=0 THEN RAISE EXCEPTION 'missing exact check_case_second_acceptance_dependent_date date input'; END IF;
  definition:=replace(definition,$old$j."judgment_received_at"$old$,$new$case_section_judgment_date(j."id")$new$);
  EXECUTE definition;
END;
$compat$;

COMMIT;
