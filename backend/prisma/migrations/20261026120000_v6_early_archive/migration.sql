-- Source-only draft. Do not apply without the separate PostgreSQL review and approval.
BEGIN;

CREATE TABLE "case_early_archives" (
  "id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "from_stage" "case_stage" NOT NULL,
  "from_version" integer NOT NULL,
  "to_version" integer NOT NULL,
  "archive_at" date NOT NULL,
  "reason" varchar(2000) NOT NULL,
  "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by_user_id" uuid NOT NULL,
  "audit_event_id" uuid NOT NULL,
  CONSTRAINT "case_early_archives_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_early_archives_case_id_key" UNIQUE ("case_id"),
  CONSTRAINT "case_early_archives_case_id_department_id_key" UNIQUE ("case_id", "department_id"),
  CONSTRAINT "case_early_archives_id_case_id_department_id_key" UNIQUE ("id", "case_id", "department_id"),
  CONSTRAINT "case_early_archives_case_id_from_version_key" UNIQUE ("case_id", "from_version"),
  CONSTRAINT "case_early_archives_audit_event_id_key" UNIQUE ("audit_event_id"),
  CONSTRAINT "case_early_archive_shape" CHECK ("from_stage" <> 'ARCHIVED' AND "from_version" >= 1 AND "to_version" = "from_version" + 1 AND length(btrim("reason")) > 0),
  CONSTRAINT "case_early_archive_case_fk" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_early_archive_actor_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "early_archive_actor_membership_fk" FOREIGN KEY ("recorded_by_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_early_archive_audit_fk" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "case_early_archives_department_id_recorded_at_id_idx" ON "case_early_archives"("department_id", "recorded_at", "id");

CREATE TABLE "case_early_archive_receipts" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "department_id" uuid NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "early_archive_id" uuid NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "request_fingerprint" char(64) NOT NULL,
  "result_snapshot" jsonb NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_early_archive_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "early_archive_actor_key" UNIQUE ("department_id", "actor_user_id", "idempotency_key"),
  CONSTRAINT "case_early_archive_receipts_early_archive_id_key" UNIQUE ("early_archive_id"),
  CONSTRAINT "case_early_archive_receipt_case_fk" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_early_archive_receipt_fact_fk" FOREIGN KEY ("early_archive_id", "case_id", "department_id") REFERENCES "case_early_archives"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_early_archive_receipt_actor_fk" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "early_archive_receipt_membership_fk" FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "case_early_archive_receipts_case_id_department_id_idx" ON "case_early_archive_receipts"("case_id", "department_id");

-- The only allowed parent mutation is stage/version. A valid earlier persisted
-- stage remains the historical source; existing workflow facts are untouched.
CREATE FUNCTION "case_early_archive_transition"(old_case "cases", new_case "cases") RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE fact record; audit record; receipt record;
BEGIN
  IF old_case."stage" = 'ARCHIVED' OR new_case."stage" <> 'ARCHIVED' OR
     new_case."version" <> old_case."version" + 1 OR
     to_jsonb(new_case) - 'stage' - 'version' IS DISTINCT FROM to_jsonb(old_case) - 'stage' - 'version' THEN
    RETURN false;
  END IF;
  SELECT * INTO fact FROM "case_early_archives" WHERE "case_id" = new_case."id" AND "department_id" = new_case."department_id";
  IF fact."id" IS NULL OR fact."from_stage" IS DISTINCT FROM old_case."stage" OR
     fact."from_version" IS DISTINCT FROM old_case."version" OR fact."to_version" IS DISTINCT FROM new_case."version" OR
     EXISTS (SELECT 1 FROM "case_archives" WHERE "case_id" = new_case."id") THEN RETURN false; END IF;
  SELECT * INTO audit FROM "audit_events" WHERE "id" = fact."audit_event_id";
  IF audit."id" IS NULL OR audit."actor_kind" IS DISTINCT FROM 'HUMAN' OR audit."resource_type" IS DISTINCT FROM 'CASE' OR
     audit."resource_id" IS DISTINCT FROM new_case."id" OR audit."department_id" IS DISTINCT FROM new_case."department_id" OR
     audit."actor_user_id" IS DISTINCT FROM fact."recorded_by_user_id" OR audit."internal_actor_user_id" IS DISTINCT FROM fact."recorded_by_user_id" OR
     audit."customer_account_binding_id" IS NOT NULL OR audit."notary_office_account_binding_id" IS NOT NULL OR
     audit."lawyer_account_binding_id" IS NOT NULL OR audit."action" IS DISTINCT FROM 'case.early_archived' THEN RETURN false; END IF;
  SELECT * INTO receipt FROM "case_early_archive_receipts" WHERE "early_archive_id" = fact."id" AND
    "case_id" = fact."case_id" AND "department_id" = fact."department_id" AND "actor_user_id" = fact."recorded_by_user_id";
  IF receipt."id" IS NULL OR receipt."request_fingerprint" !~ '^[0-9a-f]{64}$' OR
     audit."details" IS DISTINCT FROM jsonb_build_object(
       'earlyArchiveId',fact."id",'fromStage',fact."from_stage",'fromVersion',fact."from_version",
       'toVersion',fact."to_version",'archiveAt',fact."archive_at",'reason',fact."reason",
       'requestFingerprint',receipt."request_fingerprint") OR
     receipt."result_snapshot" IS DISTINCT FROM jsonb_build_object(
       'id', fact."case_id", 'earlyArchiveId', fact."id", 'fromStage', fact."from_stage",
       'stage', 'ARCHIVED', 'version', fact."to_version", 'recordedAt', to_char(fact."recorded_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) THEN RETURN false; END IF;
  RETURN true;
END; $$;

CREATE FUNCTION "case_early_archive_fact_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "cases"%ROWTYPE; actor record;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'early archive fact is immutable' USING ERRCODE='23514'; END IF;
  SELECT * INTO c FROM "cases" WHERE "id"=NEW."case_id" AND "department_id"=NEW."department_id" FOR UPDATE;
  SELECT "account_type", "active" INTO actor FROM "user_accounts" WHERE "id"=NEW."recorded_by_user_id";
  IF c."id" IS NULL OR c."stage" <> NEW."from_stage" OR c."version" <> NEW."from_version" OR
     NEW."archive_at" > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date OR
     actor."account_type" <> 'INTERNAL' OR NOT actor."active" OR
     NOT case_archive_actor_authorized(NEW."recorded_by_user_id",NEW."case_id",NEW."department_id",false) OR
     EXISTS (SELECT 1 FROM "case_archives" WHERE "case_id"=NEW."case_id") OR
     (EXISTS (SELECT 1 FROM "case_external_entries" e WHERE e."case_id"=NEW."case_id" AND NEW."archive_at"<e."stage_reached_on"))
  THEN RAISE EXCEPTION 'early archive source or actor invalid' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_early_archive_fact_guard" BEFORE INSERT OR UPDATE OR DELETE ON "case_early_archives"
  FOR EACH ROW EXECUTE FUNCTION "case_early_archive_fact_guard"();

CREATE FUNCTION "case_early_archive_receipt_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'early archive receipt is immutable' USING ERRCODE='23514'; END IF;
  IF NEW."idempotency_key" = '' OR length(btrim(NEW."idempotency_key")) <> length(NEW."idempotency_key") OR
     NEW."request_fingerprint" !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'early archive receipt shape invalid' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_early_archive_receipt_guard" BEFORE INSERT OR UPDATE OR DELETE ON "case_early_archive_receipts"
  FOR EACH ROW EXECUTE FUNCTION "case_early_archive_receipt_guard"();

CREATE FUNCTION "case_early_archive_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; c "cases"%ROWTYPE; source_case "cases"%ROWTYPE; fact record;
BEGIN
  IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id";
  ELSIF TG_TABLE_NAME='audit_events' THEN target_case:=NEW."resource_id";
  ELSE target_case:=NEW."case_id"; END IF;
  target_department:=NEW."department_id";
  SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
  SELECT * INTO fact FROM "case_early_archives" WHERE "case_id"=target_case AND "department_id"=target_department;
  IF TG_TABLE_NAME<>'cases' AND fact."id" IS NULL THEN
    RAISE EXCEPTION 'early archive fact missing' USING ERRCODE='23514'; END IF;
  IF fact."id" IS NOT NULL THEN
    source_case:=c;
    source_case."stage":=fact."from_stage";
    source_case."version":=fact."from_version";
    IF NOT case_early_archive_transition(source_case,c) THEN
      RAISE EXCEPTION 'early archive final mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "case_early_archive_case_final" AFTER INSERT OR UPDATE ON "cases" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "case_early_archive_final"();
CREATE CONSTRAINT TRIGGER "case_early_archive_fact_final" AFTER INSERT ON "case_early_archives" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "case_early_archive_final"();
CREATE CONSTRAINT TRIGGER "case_early_archive_receipt_final" AFTER INSERT ON "case_early_archive_receipts" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "case_early_archive_final"();
CREATE CONSTRAINT TRIGGER "case_early_archive_audit_final" AFTER INSERT ON "audit_events" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW."action" = 'case.early_archived') EXECUTE FUNCTION "case_early_archive_final"();

-- Existing deferred parent guards validated all previous workflow commits.
-- On this exact one-column-pair transition, the immutable source facts cannot
-- change, and their own INSERT guards still execute. All other paths retain
-- their existing guard bodies, including normal archive and imported ARCHIVED.
DO $wrap$
DECLARE p record; definition text; needle text := E'BEGIN\n'; injected text := E'BEGIN\n  IF TG_TABLE_NAME = ''cases'' THEN\n    IF TG_OP = ''UPDATE'' THEN\n      IF case_early_archive_transition(OLD, NEW) THEN RETURN NEW; END IF;\n    END IF;\n  END IF;\n';
BEGIN
  FOR p IN SELECT DISTINCT proc.oid, proc.proname
    FROM pg_trigger t JOIN pg_proc proc ON proc.oid=t.tgfoid
    WHERE t.tgrelid='cases'::regclass AND NOT t.tgisinternal AND t.tgdeferrable AND
      proc.proname <> 'case_early_archive_final' LOOP
    IF p.proname <> ALL(ARRAY[
      'check_case_trial_round_foundation', 'check_empty_remand_child_version',
      'check_retrial_prejudgment_version', 'check_case_judgment_final',
      'check_case_judgment_next_step_final', 'check_case_second_instance_final',
      'check_case_execution_submission_final', 'check_case_execution_confirmation_final',
      'check_case_execution_mailing_final', 'check_case_execution_filing_final',
      'check_case_execution_finish_final', 'check_case_closure_final',
      'check_case_archive_final', 'check_case_external_source_final',
      'check_execution_followup_case_final'
    ]) THEN RAISE EXCEPTION 'unreviewed case parent guard %', p.proname USING ERRCODE='23514'; END IF;
    -- Its original body must run: a feedback/supplement inserted in this
    -- transaction cannot be paired with any stage or version change.
    IF p.proname = 'check_execution_followup_case_final' THEN CONTINUE; END IF;
    SELECT pg_get_functiondef(p.oid) INTO definition;
    IF definition IS NULL OR position(needle IN definition)=0 OR
       position('case_early_archive_transition' IN definition)>0 THEN
      RAISE EXCEPTION 'unknown case parent guard %', p.proname USING ERRCODE='23514'; END IF;
    definition := regexp_replace(definition, E'BEGIN\\s*', injected, 'i');
    EXECUTE definition;
  END LOOP;
END; $wrap$;

-- Only stage-changing litigation facts and their command receipts are frozen.
-- Contact data, section-record corrections, assignment, materials, fees and
-- settlement retain their own approved authorization and guard contracts.
CREATE FUNCTION "case_early_archive_stop_litigation"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid;
BEGIN
  IF TG_OP='DELETE' THEN target_case:=OLD."case_id"; target_department:=OLD."department_id";
  ELSE target_case:=NEW."case_id"; target_department:=NEW."department_id"; END IF;
  IF EXISTS (SELECT 1 FROM "case_early_archives" e JOIN "cases" c ON c."id"=e."case_id" AND c."department_id"=e."department_id"
    WHERE e."case_id"=target_case AND e."department_id"=target_department AND c."stage"='ARCHIVED') THEN
    RAISE EXCEPTION 'litigation fact cannot change after early archive' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
DO $stop$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'case_trial_rounds',
    'case_match_receipts',
    'case_complaint_receipts', 'case_complaint_confirmations', 'case_complaint_confirmation_receipts',
    'case_complaint_mailings', 'case_complaint_mailing_versions', 'case_complaint_mailing_receipts',
    'case_filing_submissions', 'case_filing_versions', 'case_filing_receipts',
    'case_acceptances', 'case_acceptance_versions', 'case_acceptance_receipts',
    'case_hearing_arrangements', 'case_hearing_advances', 'case_hearing_corrections', 'case_hearing_receipts',
    'case_judgment_facts', 'case_judgment_versions', 'case_judgment_receipts',
    'case_judgment_next_steps', 'case_judgment_next_step_revocations', 'case_judgment_next_step_receipts',
    'case_second_instance_progresses', 'case_second_instance_progress_versions',
    'case_second_instance_results', 'case_second_instance_result_versions',
    'case_second_instance_result_revocations', 'case_second_instance_receipts',
    'case_execution_submissions', 'case_execution_submission_versions', 'case_execution_submission_receipts',
    'case_execution_confirmations', 'case_execution_confirmation_versions', 'case_execution_confirmation_receipts',
    'case_execution_mailings', 'case_execution_mailing_versions', 'case_execution_mailing_receipts',
    'case_execution_filings', 'case_execution_filing_versions', 'case_execution_filing_receipts',
    'case_execution_filing_feedbacks', 'case_execution_filing_supplements',
    'case_execution_filing_supplement_documents', 'case_execution_filing_followup_receipts',
    'case_execution_finishes', 'case_execution_finish_versions', 'case_execution_finish_receipts',
    'case_closures', 'case_closure_versions', 'case_closure_documents', 'case_closure_receipts',
    'case_archives', 'case_archive_versions', 'case_archive_receipts'
  ] LOOP
      IF to_regclass(format('%I.%I', current_schema(), table_name)) IS NULL THEN
        RAISE EXCEPTION 'missing litigation fact table %', table_name USING ERRCODE='23514'; END IF;
      EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION "case_early_archive_stop_litigation"()',
        'early_archive_stop_' || table_name, table_name);
    END LOOP;
END; $stop$;

COMMIT;
