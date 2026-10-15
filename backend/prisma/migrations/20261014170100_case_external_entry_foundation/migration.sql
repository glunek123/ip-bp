BEGIN;
CREATE TYPE "case_external_entry_kind" AS ENUM ('EXTERNAL_TRANSFER', 'HISTORICAL_BACKFILL');
CREATE TYPE "case_trial_round_origin" AS ENUM ('NORMAL', 'EXTERNAL_CURRENT');

ALTER TABLE "cases" ALTER COLUMN "source_lead_id" DROP NOT NULL;
ALTER TABLE "cases" ALTER COLUMN "source_notary_matter_id" DROP NOT NULL;
ALTER TABLE "cases" ALTER COLUMN "certificate_id" DROP NOT NULL;
ALTER TABLE "cases" ADD CONSTRAINT "cases_source_triple_check" CHECK (
  ("source_lead_id" IS NOT NULL AND "source_notary_matter_id" IS NOT NULL AND "certificate_id" IS NOT NULL) OR
  ("source_lead_id" IS NULL AND "source_notary_matter_id" IS NULL AND "certificate_id" IS NULL)
);

CREATE TABLE "case_external_entries" (
  "id" uuid PRIMARY KEY,
  "case_id" uuid NOT NULL UNIQUE,
  "department_id" uuid NOT NULL,
  "entry_kind" "case_external_entry_kind" NOT NULL,
  "initial_stage" "case_stage" NOT NULL,
  "stage_reached_on" date NOT NULL,
  "source" varchar(500) NOT NULL,
  "reason" varchar(500) NOT NULL,
  "known" jsonb NOT NULL,
  "recorded_by_user_id" uuid NOT NULL,
  "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "audit_event_id" uuid NOT NULL UNIQUE,
  UNIQUE ("id", "case_id", "department_id"),
  CHECK (char_length("source") BETWEEN 1 AND 500 AND "source"=btrim("source")),
  CHECK (char_length("reason") BETWEEN 1 AND 500 AND "reason"=btrim("reason")),
  CHECK ("stage_reached_on" <= ("recorded_at" AT TIME ZONE 'Asia/Shanghai')::date),
  CHECK (jsonb_typeof("known") = 'object'),
  FOREIGN KEY ("case_id", "department_id") REFERENCES "cases" ("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("audit_event_id") REFERENCES "audit_events" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_external_entry_receipts" (
  "id" uuid PRIMARY KEY,
  "department_id" uuid NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "request_fingerprint" char(64) NOT NULL,
  "result_snapshot" jsonb NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("department_id", "actor_user_id", "idempotency_key"),
  UNIQUE ("case_id", "department_id"),
  CHECK (char_length("idempotency_key") BETWEEN 1 AND 128),
  CHECK ("request_fingerprint" ~ '^[a-f0-9]{64}$'),
  FOREIGN KEY ("case_id", "department_id") REFERENCES "cases" ("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

ALTER TABLE "case_trial_rounds" ADD COLUMN "origin" "case_trial_round_origin" NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "case_trial_rounds" ADD COLUMN "external_entry_id" uuid;
ALTER TABLE "case_complaint_confirmations" ADD COLUMN "external_entry_id" uuid;
ALTER TABLE "case_complaint_mailings" ADD COLUMN "external_entry_id" uuid;
ALTER TABLE "case_filing_submissions" ADD COLUMN "external_entry_id" uuid;
ALTER TABLE "case_acceptances" ADD COLUMN "external_entry_id" uuid;
ALTER TABLE "case_acceptances" ADD COLUMN "court_id" uuid;
ALTER TABLE "case_acceptances" ADD CONSTRAINT "case_acceptances_court_fkey"
  FOREIGN KEY ("court_id","department_id") REFERENCES "filing_courts"("id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "case_hearing_arrangements" ADD COLUMN "external_entry_id" uuid;
ALTER TABLE "case_hearing_advances" ADD COLUMN "external_entry_id" uuid;
ALTER TABLE "case_judgment_facts" ADD COLUMN "external_entry_id" uuid;
ALTER TABLE "case_judgment_next_steps" ADD COLUMN "external_entry_id" uuid;
ALTER TABLE "case_second_instance_acceptance_changes" ADD COLUMN "external_entry_id" uuid;
ALTER TABLE "case_second_instance_progresses" ADD COLUMN "external_entry_id" uuid;
ALTER TABLE "case_second_instance_results" ADD COLUMN "external_entry_id" uuid;
ALTER TABLE "case_execution_submissions" ADD COLUMN "external_entry_id" uuid;
ALTER TABLE "case_execution_confirmations" ADD COLUMN "external_entry_id" uuid;
ALTER TABLE "case_execution_mailings" ADD COLUMN "external_entry_id" uuid;
ALTER TABLE "case_execution_filings" ADD COLUMN "external_entry_id" uuid;
ALTER TABLE "case_execution_finishes" ADD COLUMN "external_entry_id" uuid;
ALTER TABLE "case_closures" ADD COLUMN "external_entry_id" uuid;
ALTER TABLE "case_closure_versions" ADD COLUMN "external_entry_id" uuid;

ALTER TABLE "case_judgment_next_steps" ALTER COLUMN "judgment_id" DROP NOT NULL;
ALTER TABLE "case_second_instance_acceptance_changes" ALTER COLUMN "choice_id" DROP NOT NULL;
ALTER TABLE "case_second_instance_progresses" ALTER COLUMN "choice_id" DROP NOT NULL;
ALTER TABLE "case_second_instance_results" ALTER COLUMN "choice_id" DROP NOT NULL;
ALTER TABLE "case_second_instance_results" ALTER COLUMN "judgment_id" DROP NOT NULL;
ALTER TABLE "case_execution_submissions" ALTER COLUMN "judgment_next_step_id" DROP NOT NULL;
ALTER TABLE "case_execution_confirmations" ALTER COLUMN "submission_id" DROP NOT NULL;
ALTER TABLE "case_execution_mailings" ALTER COLUMN "confirmation_id" DROP NOT NULL;
ALTER TABLE "case_execution_filings" ALTER COLUMN "mailing_id" DROP NOT NULL;
ALTER TABLE "case_execution_finishes" ALTER COLUMN "filing_id" DROP NOT NULL;
ALTER TABLE "case_closures" ALTER COLUMN "finish_id" DROP NOT NULL;
ALTER TABLE "case_closure_versions" ALTER COLUMN "finish_id" DROP NOT NULL;

-- A direct confirmation records its actual application bundle without a
-- fabricated execution submission.
CREATE TABLE "case_execution_confirmation_versions" (
  "confirmation_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "material_id" uuid NOT NULL,
  "content_version_id" uuid NOT NULL,
  PRIMARY KEY ("confirmation_id","content_version_id"),
  UNIQUE ("confirmation_id","material_id"),
  FOREIGN KEY ("confirmation_id","case_id","department_id") REFERENCES "case_execution_confirmations"("id","case_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("material_id","content_version_id") REFERENCES "content_versions"("material_id","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

DO $entry_refs$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'case_trial_rounds', 'case_complaint_confirmations', 'case_complaint_mailings',
    'case_filing_submissions', 'case_acceptances', 'case_hearing_arrangements',
    'case_hearing_advances', 'case_judgment_facts', 'case_judgment_next_steps',
    'case_second_instance_acceptance_changes', 'case_second_instance_progresses',
    'case_second_instance_results', 'case_execution_submissions', 'case_execution_confirmations',
    'case_execution_mailings', 'case_execution_filings', 'case_execution_finishes',
    'case_closures', 'case_closure_versions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("external_entry_id","case_id","department_id") REFERENCES "case_external_entries"("id","case_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT', table_name, table_name || '_external_entry_fkey');
  END LOOP;
END; $entry_refs$;

CREATE FUNCTION "check_case_external_source_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; c record; e record;
BEGIN
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
  SELECT * INTO e FROM "case_external_entries" WHERE "case_id"=target_case AND "department_id"=target_department;
  IF c."id" IS NULL OR
    ((c."source_lead_id" IS NULL OR c."source_notary_matter_id" IS NULL OR c."certificate_id" IS NULL) AND
     (c."source_lead_id" IS NOT NULL OR c."source_notary_matter_id" IS NOT NULL OR c."certificate_id" IS NOT NULL)) OR
    ((c."source_lead_id" IS NULL) <> (e."id" IS NOT NULL)) OR
    (e."id" IS NOT NULL AND (e."initial_stage" IS NULL OR e."case_id"<>c."id" OR e."department_id"<>c."department_id")) OR
    (e."id" IS NOT NULL AND c."version"=1 AND c."stage" IS DISTINCT FROM e."initial_stage") OR
    (e."id" IS NOT NULL AND c."version"=1 AND
      (c."matched_at" IS NOT NULL OR c."matched_on" IS NOT NULL OR
       c."complaint_submitted_at" IS NOT NULL OR c."complaint_submitted_by_user_id" IS NOT NULL OR
       c."complaint_amount_state" IS NOT NULL OR c."complaint_amount" IS NOT NULL OR c."complaint_pending_reason" IS NOT NULL)) OR
    (e."id" IS NOT NULL AND c."version"=1 AND
      (c."current_acceptance_id" IS NOT NULL OR c."current_hearing_arrangement_id" IS NOT NULL OR
       c."current_hearing_advance_id" IS NOT NULL OR c."current_judgment_id" IS NOT NULL OR
       c."current_judgment_next_step_id" IS NOT NULL OR c."current_second_instance_progress_id" IS NOT NULL OR
       c."current_second_instance_result_id" IS NOT NULL OR c."current_execution_submission_id" IS NOT NULL)) OR
    (e."id" IS NOT NULL AND c."version"=1 AND
      ((e."initial_stage" IN ('PENDING_MATCH','WAITING_COMPLAINT','WAITING_COMPLAINT_CONFIRMATION',
          'WAITING_COMPLAINT_STAMP','WAITING_FILING','ARCHIVED') AND c."current_trial_round_id" IS NOT NULL) OR
       (e."initial_stage" IN ('WAITING_FORMAL_ACCEPTANCE','WAITING_HEARING','WAITING_JUDGMENT',
          'SECOND_INSTANCE','WAITING_EXECUTION_DOCUMENTS','WAITING_EXECUTION_CONFIRMATION',
          'WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE') AND
        c."current_trial_round_id" IS NULL))) OR
    (e."initial_stage"='PENDING_MATCH' AND c."version"=1 AND
      (EXISTS (SELECT 1 FROM "case_defendants" d WHERE d."case_id"=c."id" AND d."department_id"=c."department_id") OR
       EXISTS (SELECT 1 FROM "case_lawyer_assignments" l WHERE l."case_id"=c."id" AND l."department_id"=c."department_id"))) OR
    (e."initial_stage"='ARCHIVED' AND (c."stage"<>'ARCHIVED' OR c."version"<>1 OR c."current_trial_round_id" IS NOT NULL OR
      EXISTS (SELECT 1 FROM "case_archives" h WHERE h."case_id"=c."id" AND h."department_id"=c."department_id") OR
      EXISTS (SELECT 1 FROM "case_closures" h WHERE h."case_id"=c."id" AND h."department_id"=c."department_id")))
  THEN RAISE EXCEPTION 'invalid case source root' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "case_external_source_case_final" AFTER INSERT OR UPDATE ON "cases"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_external_source_final"();
CREATE CONSTRAINT TRIGGER "case_external_source_entry_final" AFTER INSERT ON "case_external_entries"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_external_source_final"();

CREATE FUNCTION "reject_case_external_entry_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'external entry is immutable' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER "case_external_entry_immutable" BEFORE UPDATE OR DELETE ON "case_external_entries"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_external_entry_mutation"();
CREATE TRIGGER "case_external_entry_receipt_immutable" BEFORE UPDATE OR DELETE ON "case_external_entry_receipts"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_external_entry_mutation"();

CREATE FUNCTION "check_case_external_entry_payload"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text; v jsonb;
BEGIN
  IF (SELECT count(*) FROM jsonb_object_keys(NEW."known"))<>9 OR
    NOT NEW."known" ?& ARRAY['courtId','courtCaseNo','acceptedOn','secondInstanceAcceptedOn','platform','shopName','shopExternalId','caseType','infringementTypes']
  THEN RAISE EXCEPTION 'external entry known shape mismatch' USING ERRCODE='23514'; END IF;
  FOR k,v IN SELECT key,value FROM jsonb_each(NEW."known") LOOP
    IF v<>'null'::jsonb AND
       ((k='infringementTypes' AND jsonb_typeof(v)<>'array') OR
        (k<>'infringementTypes' AND jsonb_typeof(v)<>'string'))
    THEN RAISE EXCEPTION 'external entry known type mismatch' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF (NEW."known"->>'courtId' IS NOT NULL AND
      (NEW."known"->>'courtId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
       NOT EXISTS (SELECT 1 FROM "filing_courts" f WHERE f."id"=(NEW."known"->>'courtId')::uuid AND f."department_id"=NEW."department_id"))) OR
     (NEW."known"->>'courtCaseNo' IS NOT NULL AND
      (char_length(NEW."known"->>'courtCaseNo') NOT BETWEEN 1 AND 100 OR NEW."known"->>'courtCaseNo'<>btrim(NEW."known"->>'courtCaseNo'))) OR
     (NEW."known"->>'shopName' IS NOT NULL AND
      (char_length(NEW."known"->>'shopName') NOT BETWEEN 1 AND 200 OR NEW."known"->>'shopName'<>btrim(NEW."known"->>'shopName'))) OR
     (NEW."known"->>'shopExternalId' IS NOT NULL AND
      (char_length(NEW."known"->>'shopExternalId') NOT BETWEEN 1 AND 100 OR NEW."known"->>'shopExternalId'<>btrim(NEW."known"->>'shopExternalId'))) OR
     (NEW."known"->'infringementTypes'<>'null'::jsonb AND
      (jsonb_array_length(NEW."known"->'infringementTypes') NOT BETWEEN 1 AND 12 OR
       EXISTS (SELECT 1 FROM jsonb_array_elements(NEW."known"->'infringementTypes') t(value)
         WHERE jsonb_typeof(t.value)<>'string') OR
       (SELECT count(DISTINCT t.value) FROM jsonb_array_elements(NEW."known"->'infringementTypes') t(value))<>
         jsonb_array_length(NEW."known"->'infringementTypes')))
  THEN RAISE EXCEPTION 'external entry known value mismatch' USING ERRCODE='23514'; END IF;
  IF NEW."known"->>'acceptedOn' IS NOT NULL AND
     ((NEW."known"->>'acceptedOn') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR (NEW."known"->>'acceptedOn')::date>NEW."stage_reached_on")
     OR NEW."known"->>'secondInstanceAcceptedOn' IS NOT NULL AND
     ((NEW."known"->>'secondInstanceAcceptedOn') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR (NEW."known"->>'secondInstanceAcceptedOn')::date>NEW."stage_reached_on")
  THEN RAISE EXCEPTION 'external entry known date mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_external_entry_payload_guard" BEFORE INSERT ON "case_external_entries"
  FOR EACH ROW EXECUTE FUNCTION "check_case_external_entry_payload"();

CREATE FUNCTION "check_case_external_entry_identity"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e record; c record; a record; r record;
BEGIN
  SELECT * INTO e FROM "case_external_entries" WHERE "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
  IF e."id" IS NULL THEN RAISE EXCEPTION 'external entry missing' USING ERRCODE='23514'; END IF;
  SELECT * INTO c FROM "cases" WHERE "id"=e."case_id" AND "department_id"=e."department_id";
  SELECT * INTO a FROM "audit_events" WHERE "id"=e."audit_event_id";
  SELECT * INTO r FROM "case_external_entry_receipts" WHERE "case_id"=e."case_id" AND "department_id"=e."department_id";
  IF c."id" IS NULL OR a."id" IS NULL OR r."id" IS NULL OR
    NOT EXISTS (SELECT 1 FROM "user_accounts" u JOIN "department_memberships" m
      ON m."user_id"=u."id" AND m."department_id"=e."department_id"
      WHERE u."id"=e."recorded_by_user_id" AND u."active" AND u."account_type"='INTERNAL' AND m."active") OR
    a."department_id" IS DISTINCT FROM e."department_id" OR a."resource_type" IS DISTINCT FROM 'CASE' OR
    a."resource_id" IS DISTINCT FROM e."case_id" OR a."action" IS DISTINCT FROM 'case.external-entry.created' OR
    a."actor_kind" IS DISTINCT FROM 'HUMAN' OR a."actor_user_id" IS DISTINCT FROM e."recorded_by_user_id" OR
    a."internal_actor_user_id" IS DISTINCT FROM e."recorded_by_user_id" OR
    a."notary_office_account_binding_id" IS NOT NULL OR a."customer_account_binding_id" IS NOT NULL OR a."lawyer_account_binding_id" IS NOT NULL OR
    a."details"->>'entryId' IS DISTINCT FROM e."id"::text OR
    a."details"->>'entryKind' IS DISTINCT FROM e."entry_kind"::text OR
    a."details"->>'initialStage' IS DISTINCT FROM e."initial_stage"::text OR
    a."details"->>'stageReachedOn' IS DISTINCT FROM e."stage_reached_on"::text OR
    a."details"->>'source' IS DISTINCT FROM e."source" OR a."details"->>'reason' IS DISTINCT FROM e."reason" OR
    r."actor_user_id" IS DISTINCT FROM e."recorded_by_user_id" OR
    jsonb_typeof(r."result_snapshot") IS DISTINCT FROM 'object' OR
    (SELECT count(*) FROM jsonb_object_keys(r."result_snapshot"))<>6 OR
    NOT r."result_snapshot" ?& ARRAY['id','businessNo','stage','version','entryId','recordedAt'] OR
    r."result_snapshot"->>'id' IS DISTINCT FROM e."case_id"::text OR
    r."result_snapshot"->>'entryId' IS DISTINCT FROM e."id"::text OR
    r."result_snapshot"->>'businessNo' IS DISTINCT FROM c."business_no" OR
    r."result_snapshot"->>'stage' IS DISTINCT FROM e."initial_stage"::text OR
    r."result_snapshot"->>'version' IS DISTINCT FROM '1' OR
    r."result_snapshot"->>'recordedAt' IS DISTINCT FROM to_char(e."recorded_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  THEN RAISE EXCEPTION 'external entry audit or receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "case_external_entry_identity_guard" AFTER INSERT ON "case_external_entries"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_external_entry_identity"();
CREATE CONSTRAINT TRIGGER "case_external_entry_receipt_identity_guard" AFTER INSERT ON "case_external_entry_receipts"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_external_entry_identity"();

-- A nullable finish must not turn the closure/version relation into an
-- unchecked composite foreign key. Use non-null identity columns for the
-- physical FKs and verify finish lineage with a deferred source guard.
DO $closure_fk$
DECLARE row record;
BEGIN
  FOR row IN SELECT conrelid::regclass AS table_name, conname
    FROM pg_constraint WHERE contype='f' AND
    ((conrelid='case_closures'::regclass AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (current_version_id, id, case_id, department_id, finish_id)%') OR
     (conrelid='case_closure_versions'::regclass AND
      (pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (closure_id, case_id, department_id, finish_id)%' OR
       pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (prior_version_id, closure_id, case_id, department_id, finish_id)%')))
  LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',row.table_name,row.conname); END LOOP;
END; $closure_fk$;
ALTER TABLE "case_closures" ADD CONSTRAINT "case_closures_current_version_identity_key" UNIQUE ("current_version_id","id","case_id","department_id");
ALTER TABLE "case_closure_versions" ADD CONSTRAINT "case_closure_versions_identity_key" UNIQUE ("id","closure_id","case_id","department_id");
ALTER TABLE "case_closures" ADD CONSTRAINT "case_closures_current_version_identity_fkey"
  FOREIGN KEY ("current_version_id","id","case_id","department_id") REFERENCES "case_closure_versions"("id","closure_id","case_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "case_closure_versions" ADD CONSTRAINT "case_closure_versions_closure_identity_fkey"
  FOREIGN KEY ("closure_id","case_id","department_id") REFERENCES "case_closures"("id","case_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "case_closure_versions" ADD CONSTRAINT "case_closure_versions_prior_identity_fkey"
  FOREIGN KEY ("prior_version_id","closure_id","case_id","department_id") REFERENCES "case_closure_versions"("id","closure_id","case_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;

-- A direct second-instance acceptance has no appeal choice. Its later genuine
-- corrections still need a navigable prior-change FK and unique revisions.
DO $second_acceptance_fk$
DECLARE row record;
BEGIN
  FOR row IN SELECT conname FROM pg_constraint WHERE conrelid='case_second_instance_acceptance_changes'::regclass
    AND contype='f' AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (prior_change_id, choice_id, case_id, department_id, trial_round_id)%'
  LOOP EXECUTE format('ALTER TABLE "case_second_instance_acceptance_changes" DROP CONSTRAINT %I',row.conname); END LOOP;
END; $second_acceptance_fk$;
ALTER TABLE "case_second_instance_acceptance_changes" ADD CONSTRAINT "second_acceptance_id_case_round_key"
  UNIQUE ("id","case_id","department_id","trial_round_id");
ALTER TABLE "case_second_instance_acceptance_changes" ADD CONSTRAINT "second_acceptance_prior_case_round_key"
  UNIQUE ("prior_change_id","case_id","department_id","trial_round_id");
ALTER TABLE "case_second_instance_acceptance_changes" ADD CONSTRAINT "second_acceptance_prior_case_round_fkey"
  FOREIGN KEY ("prior_change_id","case_id","department_id","trial_round_id")
  REFERENCES "case_second_instance_acceptance_changes"("id","case_id","department_id","trial_round_id")
  ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX "second_acceptance_external_from_revision_key"
  ON "case_second_instance_acceptance_changes"("case_id","department_id","trial_round_id","from_revision") WHERE "choice_id" IS NULL;
CREATE UNIQUE INDEX "second_acceptance_external_to_revision_key"
  ON "case_second_instance_acceptance_changes"("case_id","department_id","trial_round_id","to_revision") WHERE "choice_id" IS NULL;

ALTER TABLE "case_external_entry_receipts" ADD CONSTRAINT "case_external_entry_receipts_actor_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Preserve the complete existing normal-source expressions. Only an exact
-- all-null external source tuple may enter a later stage without old local
-- matched/complaint columns. The deferred source guard requires its entry.
DO $states$
DECLARE row record; body text;
BEGIN
  FOR row IN SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='cases'::regclass AND conname IN ('cases_matching_state_check','cases_complaint_state_check')
  LOOP
    IF left(row.definition,7)<>'CHECK (' THEN RAISE EXCEPTION 'unknown case stage check %',row.conname USING ERRCODE='23514'; END IF;
    body:=substr(row.definition,8,length(row.definition)-8);
    EXECUTE format('ALTER TABLE "cases" DROP CONSTRAINT %I',row.conname);
    EXECUTE format('ALTER TABLE "cases" ADD CONSTRAINT %I CHECK (("source_lead_id" IS NULL AND "source_notary_matter_id" IS NULL AND "certificate_id" IS NULL) OR (%s))',row.conname,body);
  END LOOP;
END; $states$;

CREATE OR REPLACE FUNCTION "check_case_complaint_confirmation_stage"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id"
    AND c."stage"='WAITING_COMPLAINT_STAMP' AND (c."complaint_submitted_at" IS NOT NULL OR
      (c."complaint_submitted_at" IS NULL AND EXISTS (SELECT 1 FROM "case_external_entries" e
        WHERE e."case_id"=c."id" AND e."department_id"=c."department_id"
          AND e."id"=NEW."external_entry_id" AND e."initial_stage"='WAITING_COMPLAINT_CONFIRMATION'))))
  THEN RAISE EXCEPTION 'confirmation lacks submitted complaint or exact external stage' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id"=NEW."audit_event_id" AND a."department_id"=NEW."department_id"
    AND a."resource_type"='CASE' AND a."resource_id"=NEW."case_id" AND a."actor_user_id"=NEW."confirmed_by_user_id"
    AND a."action"='case.complaint.confirmed')
  THEN RAISE EXCEPTION 'confirmation audit identity mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION "check_case_complaint_mailing_fact"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id"
    AND c."stage"='WAITING_FILING' AND (EXISTS (SELECT 1 FROM "case_complaint_confirmations" cc
      WHERE cc."case_id"=c."id" AND cc."department_id"=c."department_id") OR
      EXISTS (SELECT 1 FROM "case_external_entries" e WHERE e."case_id"=c."id" AND e."department_id"=c."department_id"
        AND e."id"=NEW."external_entry_id" AND e."initial_stage"='WAITING_COMPLAINT_STAMP'
        AND NOT EXISTS (SELECT 1 FROM "case_complaint_confirmations" cc WHERE cc."case_id"=c."id" AND cc."department_id"=c."department_id"))))
  THEN RAISE EXCEPTION 'mailing lacks confirmation or exact external stage' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "user_accounts" u WHERE u."id"=NEW."recorded_by_user_id" AND u."account_type"=NEW."actor_type")
  THEN RAISE EXCEPTION 'mailing actor type mismatch' USING ERRCODE='23514'; END IF;
  IF NEW."actor_type"='CLIENT' AND NOT EXISTS (SELECT 1 FROM "customer_account_bindings" b JOIN "cases" c ON c."id"=NEW."case_id"
    WHERE b."id"=NEW."customer_account_binding_id" AND b."user_id"=NEW."recorded_by_user_id"
      AND b."department_id"=NEW."department_id" AND b."customer_id"=c."customer_id")
  THEN RAISE EXCEPTION 'mailing client identity mismatch' USING ERRCODE='23514'; END IF;
  IF NEW."actor_type"='LAWYER' AND NOT EXISTS (SELECT 1 FROM "lawyer_account_bindings" b
    JOIN "case_lawyer_assignments" a ON a."lawyer_id"=b."profile_id" AND a."department_id"=b."department_id"
    WHERE b."id"=NEW."lawyer_account_binding_id" AND b."user_id"=NEW."recorded_by_user_id"
      AND b."department_id"=NEW."department_id" AND b."active" AND a."case_id"=NEW."case_id"
      AND a."role"='PRIMARY' AND a."ended_at" IS NULL)
  THEN RAISE EXCEPTION 'mailing lawyer identity mismatch' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id"=NEW."audit_event_id" AND a."department_id"=NEW."department_id"
    AND a."resource_type"='CASE' AND a."resource_id"=NEW."case_id" AND a."actor_user_id"=NEW."recorded_by_user_id"
    AND a."action"='case.complaint.mailed' AND (NEW."actor_type"<>'LAWYER' OR a."lawyer_account_binding_id"=NEW."lawyer_account_binding_id"))
  THEN RAISE EXCEPTION 'mailing audit identity mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION "check_case_filing_fact"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id"
    AND c."stage"='WAITING_FORMAL_ACCEPTANCE' AND (EXISTS (SELECT 1 FROM "case_complaint_mailings" m
      WHERE m."case_id"=c."id" AND m."department_id"=c."department_id") OR
      EXISTS (SELECT 1 FROM "case_external_entries" e WHERE e."case_id"=c."id" AND e."department_id"=c."department_id"
        AND e."id"=NEW."external_entry_id" AND e."initial_stage"='WAITING_FILING'
        AND NEW."submitted_at">=e."stage_reached_on" AND
        NOT EXISTS (SELECT 1 FROM "case_complaint_mailings" m WHERE m."case_id"=c."id" AND m."department_id"=c."department_id"))))
  THEN RAISE EXCEPTION 'filing lacks mailing or exact external stage' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "filing_courts" f WHERE f."id"=NEW."court_id" AND f."department_id"=NEW."department_id" AND f."name"=NEW."court_name")
  THEN RAISE EXCEPTION 'filing court snapshot mismatch' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "user_accounts" u WHERE u."id"=NEW."recorded_by_user_id" AND u."account_type" IN ('INTERNAL','LAWYER'))
  THEN RAISE EXCEPTION 'filing actor type invalid' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id"=NEW."audit_event_id" AND a."department_id"=NEW."department_id"
    AND a."resource_type"='CASE' AND a."resource_id"=NEW."case_id" AND a."actor_user_id"=NEW."recorded_by_user_id"
    AND a."action"='case.filing.submitted')
  THEN RAISE EXCEPTION 'filing audit identity mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION "check_case_acceptance_fact"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id"
    AND c."stage"='WAITING_HEARING' AND c."court_case_no"=NEW."court_case_no" AND
    (EXISTS (SELECT 1 FROM "case_filing_submissions" f WHERE f."case_id"=c."id" AND f."department_id"=c."department_id"
      AND NEW."court_id" IS NULL AND NEW."accepted_at">=f."submitted_at") OR
     EXISTS (SELECT 1 FROM "case_external_entries" e WHERE e."case_id"=c."id" AND e."department_id"=c."department_id"
      AND e."id"=NEW."external_entry_id" AND e."initial_stage"='WAITING_FORMAL_ACCEPTANCE'
      AND NEW."court_id" IS NOT NULL
      AND NEW."accepted_at">=e."stage_reached_on" AND
      (e."known"->>'acceptedOn' IS NULL OR NEW."accepted_at">=(e."known"->>'acceptedOn')::date)
      AND NOT EXISTS (SELECT 1 FROM "case_filing_submissions" f WHERE f."case_id"=c."id" AND f."department_id"=c."department_id")) OR
     (NEW."court_id" IS NOT NULL AND EXISTS (SELECT 1 FROM "case_trial_rounds" r
       JOIN "case_second_instance_results" s ON s."id"=r."source_result_id" AND s."case_id"=r."case_id" AND s."department_id"=r."department_id"
       JOIN "case_external_entries" e ON e."id"=r."external_entry_id" AND e."case_id"=r."case_id" AND e."department_id"=r."department_id"
       WHERE r."id"=NEW."trial_round_id" AND r."case_id"=c."id" AND r."department_id"=c."department_id"
         AND c."current_trial_round_id"=r."id" AND r."source_result_id"=s."id" AND s."result"='REMAND'
         AND s."external_entry_id"=e."id" AND NEW."external_entry_id"=e."id"
         AND NEW."accepted_at">=s."result_received_at" AND NOT EXISTS (SELECT 1 FROM "case_second_instance_result_revocations" z WHERE z."result_id"=s."id")
         AND NOT EXISTS (SELECT 1 FROM "case_filing_submissions" f WHERE f."case_id"=c."id" AND f."department_id"=c."department_id")))))
  THEN RAISE EXCEPTION 'acceptance lacks filing or exact external stage' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id"=NEW."audit_event_id" AND a."department_id"=NEW."department_id"
    AND a."resource_type"='CASE' AND a."resource_id"=NEW."case_id" AND a."actor_user_id"=NEW."recorded_by_user_id"
    AND a."action"='case.acceptance.registered')
  THEN RAISE EXCEPTION 'acceptance audit identity mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

-- Each subsequently created fact carries the immutable source identity, even
-- after a real predecessor exists. The composite FK above proves same-case
-- ownership; this deferred check rejects missing anchors on external cases
-- and entry IDs on normal cases. Remand children keep the entry lineage.
CREATE FUNCTION "check_case_external_fact_source"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record; e record;
BEGIN
  SELECT "source_lead_id","source_notary_matter_id","certificate_id" INTO c
    FROM "cases" WHERE "id"=NEW."case_id" AND "department_id"=NEW."department_id";
  SELECT "id","initial_stage" INTO e FROM "case_external_entries"
    WHERE "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
  IF NOT FOUND AND c."source_lead_id" IS NULL THEN RAISE EXCEPTION 'external fact lacks case root' USING ERRCODE='23514'; END IF;
  IF c."source_lead_id" IS NULL THEN
    IF e."initial_stage"='ARCHIVED' THEN RAISE EXCEPTION 'archived entry has no follow-up facts' USING ERRCODE='23514'; END IF;
    IF NEW."external_entry_id" IS DISTINCT FROM e."id" THEN RAISE EXCEPTION 'external fact source mismatch' USING ERRCODE='23514'; END IF;
    IF TG_TABLE_NAME='case_trial_rounds' THEN
      IF NEW."origin"='EXTERNAL_CURRENT' AND (NEW."sequence"<>1 OR NEW."source_result_id" IS NOT NULL) THEN RAISE EXCEPTION 'invalid external current round' USING ERRCODE='23514'; END IF;
      IF NEW."origin"='NORMAL' AND NEW."source_result_id" IS NULL THEN RAISE EXCEPTION 'external descendant has no remand result' USING ERRCODE='23514'; END IF;
    END IF;
  ELSIF NEW."external_entry_id" IS NOT NULL OR (TG_TABLE_NAME='case_trial_rounds' AND NEW."origin"<>'NORMAL') THEN
    RAISE EXCEPTION 'normal fact has external root' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DO $source_fact_triggers$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'case_trial_rounds','case_complaint_confirmations','case_complaint_mailings',
    'case_filing_submissions','case_acceptances','case_hearing_arrangements',
    'case_hearing_advances','case_judgment_facts','case_judgment_next_steps',
    'case_second_instance_acceptance_changes','case_second_instance_progresses',
    'case_second_instance_results','case_execution_submissions','case_execution_confirmations',
    'case_execution_mailings','case_execution_filings','case_execution_finishes',
    'case_closures','case_closure_versions'
  ] LOOP
    EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT OR UPDATE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_external_fact_source"()', table_name||'_source_guard',table_name);
  END LOOP;
END; $source_fact_triggers$;

CREATE FUNCTION "check_case_external_confirmation_version"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record; selected jsonb;
BEGIN
  SELECT * INTO c FROM "case_execution_confirmations"
    WHERE "id"=NEW."confirmation_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id" FOR UPDATE;
  SELECT "details"->'executionApplicationContentVersionIds' INTO selected FROM "audit_events" WHERE "id"=c."audit_event_id";
  IF c."id" IS NULL OR c."submission_id" IS NOT NULL OR c."external_entry_id" IS NULL OR
    jsonb_typeof(selected) IS DISTINCT FROM 'array' OR NOT selected ? NEW."content_version_id"::text OR
    NOT EXISTS (SELECT 1 FROM "materials" m JOIN "content_versions" v ON v."material_id"=m."id"
      WHERE m."id"=NEW."material_id" AND v."id"=NEW."content_version_id"
        AND m."department_id"=NEW."department_id" AND m."owner_type"='CASE' AND m."owner_id"=NEW."case_id"
        AND m."category"='EXECUTION_APPLICATION' AND m."purpose"='EXECUTION_APPLICATION'
        AND m."status"='ACTIVE' AND v."status"='AVAILABLE'
        AND v."mime_type" IN ('application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        AND v."size_bytes"<=52428800 AND m."current_version_id"=v."id")
  THEN RAISE EXCEPTION 'direct confirmation application version mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_external_confirmation_versions_guard" BEFORE INSERT ON "case_execution_confirmation_versions"
  FOR EACH ROW EXECUTE FUNCTION "check_case_external_confirmation_version"();
CREATE TRIGGER "case_external_confirmation_versions_immutable" BEFORE UPDATE OR DELETE ON "case_execution_confirmation_versions"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();

-- Validate the frozen bundle as a set after the command transaction has
-- inserted the confirmation, its selected versions, audit and references.
CREATE FUNCTION "check_case_external_confirmation_bundle"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; q record; a record; selected jsonb; selected_count integer;
BEGIN
  IF TG_TABLE_NAME='case_execution_confirmations' THEN target_case:=NEW."case_id"; target_department:=NEW."department_id";
  ELSIF TG_TABLE_NAME='case_execution_confirmation_versions' THEN target_case:=NEW."case_id"; target_department:=NEW."department_id";
  ELSE target_case:=NEW."resource_id"; target_department:=NEW."department_id"; END IF;
  SELECT * INTO q FROM "case_execution_confirmations" WHERE "case_id"=target_case AND "department_id"=target_department;
  IF q."id" IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='material_references' AND NEW."action_event_id" IS DISTINCT FROM q."audit_event_id" THEN RETURN NEW; END IF;
  SELECT * INTO a FROM "audit_events" WHERE "id"=q."audit_event_id";
  selected:=a."details"->'executionApplicationContentVersionIds';
  SELECT count(*) INTO selected_count FROM "case_execution_confirmation_versions" v WHERE v."confirmation_id"=q."id";
  IF q."submission_id" IS NOT NULL THEN
    IF selected_count<>0 THEN RAISE EXCEPTION 'submission-backed confirmation owns direct bundle' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF q."external_entry_id" IS NULL OR a."id" IS NULL OR a."action" IS DISTINCT FROM 'case.execution.confirmed' OR
    a."resource_type" IS DISTINCT FROM 'CASE' OR a."resource_id" IS DISTINCT FROM target_case OR
    a."department_id" IS DISTINCT FROM target_department OR a."actor_user_id" IS DISTINCT FROM q."confirmed_by_user_id" OR
    jsonb_typeof(selected) IS DISTINCT FROM 'array' OR jsonb_array_length(selected) NOT BETWEEN 1 AND 10 OR
    selected_count<>jsonb_array_length(selected) OR
    EXISTS (SELECT 1 FROM "case_execution_confirmation_versions" v WHERE v."confirmation_id"=q."id" AND NOT selected ? v."content_version_id"::text) OR
    EXISTS (SELECT 1 FROM jsonb_array_elements_text(selected) requested WHERE NOT EXISTS
      (SELECT 1 FROM "case_execution_confirmation_versions" v WHERE v."confirmation_id"=q."id" AND v."content_version_id"::text=requested.value)) OR
    -- The first confirmation must freeze the entire current available bundle,
    -- not just a self-consistent subset selected by its caller. This deferred
    -- check fires only for that confirmation transaction; future material
    -- changes do not rewrite its historical snapshot.
    (SELECT count(*) FROM "materials" m JOIN "content_versions" cv
       ON cv."id"=m."current_version_id" AND cv."material_id"=m."id"
      WHERE m."department_id"=target_department AND m."owner_type"='CASE' AND m."owner_id"=target_case
        AND m."category"='EXECUTION_APPLICATION' AND m."purpose"='EXECUTION_APPLICATION'
        AND m."status"='ACTIVE' AND cv."status"='AVAILABLE')<>selected_count OR
    EXISTS (SELECT 1 FROM "materials" m JOIN "content_versions" cv
       ON cv."id"=m."current_version_id" AND cv."material_id"=m."id"
      WHERE m."department_id"=target_department AND m."owner_type"='CASE' AND m."owner_id"=target_case
        AND m."category"='EXECUTION_APPLICATION' AND m."purpose"='EXECUTION_APPLICATION'
        AND m."status"='ACTIVE' AND cv."status"='AVAILABLE'
        AND NOT EXISTS (SELECT 1 FROM "case_execution_confirmation_versions" v
          WHERE v."confirmation_id"=q."id" AND v."material_id"=m."id" AND v."content_version_id"=cv."id")) OR
    (SELECT count(*) FROM "material_references" r WHERE r."action_event_id"=q."audit_event_id" AND r."resource_type"='case' AND r."resource_id"=target_case AND r."department_id"=target_department AND r."purpose"='EXECUTION_APPLICATION')<>selected_count OR
    EXISTS (SELECT 1 FROM "case_execution_confirmation_versions" v WHERE v."confirmation_id"=q."id" AND NOT EXISTS
      (SELECT 1 FROM "material_references" r WHERE r."action_event_id"=q."audit_event_id" AND r."resource_type"='case' AND r."resource_id"=target_case AND r."department_id"=target_department AND r."purpose"='EXECUTION_APPLICATION' AND r."material_id"=v."material_id" AND r."content_version_id"=v."content_version_id"))
  THEN RAISE EXCEPTION 'external execution confirmation bundle mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "case_external_confirmation_bundle_fact" AFTER INSERT OR UPDATE ON "case_execution_confirmations"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_external_confirmation_bundle"();
CREATE CONSTRAINT TRIGGER "case_external_confirmation_bundle_version" AFTER INSERT ON "case_execution_confirmation_versions"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_external_confirmation_bundle"();
CREATE CONSTRAINT TRIGGER "case_external_confirmation_bundle_reference" AFTER INSERT ON "material_references"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW."purpose"='EXECUTION_APPLICATION' AND NEW."resource_type"='case')
  EXECUTE FUNCTION "check_case_external_confirmation_bundle"();

CREATE FUNCTION "ca018_assert_external_trial_round"(target_case uuid,target_department uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE c record; e record; r record; s record; a record;
BEGIN
  SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
  SELECT * INTO e FROM "case_external_entries" WHERE "case_id"=target_case AND "department_id"=target_department;
  IF c."id" IS NULL OR e."id" IS NULL OR c."source_lead_id" IS NOT NULL OR c."source_notary_matter_id" IS NOT NULL OR c."certificate_id" IS NOT NULL
  THEN RAISE EXCEPTION 'external trial round lacks entry root' USING ERRCODE='23514'; END IF;
  IF c."current_trial_round_id" IS NULL THEN
    IF (c."stage" IN ('WAITING_HEARING','WAITING_JUDGMENT','SECOND_INSTANCE','WAITING_EXECUTION_DOCUMENTS','WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE') OR
      (c."stage"='ARCHIVED' AND e."initial_stage"<>'ARCHIVED') OR c."current_acceptance_id" IS NOT NULL OR
      c."current_hearing_arrangement_id" IS NOT NULL OR c."current_hearing_advance_id" IS NOT NULL OR c."current_judgment_id" IS NOT NULL OR
      c."current_judgment_next_step_id" IS NOT NULL OR c."current_second_instance_progress_id" IS NOT NULL OR c."current_second_instance_result_id" IS NOT NULL OR
      EXISTS (SELECT 1 FROM "case_trial_rounds" x WHERE x."case_id"=target_case AND x."department_id"=target_department))
    THEN RAISE EXCEPTION 'external case current round missing' USING ERRCODE='23514'; END IF;
    RETURN;
  END IF;
  SELECT * INTO r FROM "case_trial_rounds" WHERE "id"=c."current_trial_round_id" AND "case_id"=target_case AND "department_id"=target_department;
  IF r."id" IS NULL OR r."revoked_at" IS NOT NULL OR r."external_entry_id" IS DISTINCT FROM e."id"
  THEN RAISE EXCEPTION 'external current round mismatch' USING ERRCODE='23514'; END IF;
  IF r."origin"='EXTERNAL_CURRENT' THEN
    IF r."sequence"<>1 OR r."source_result_id" IS NOT NULL THEN RAISE EXCEPTION 'external current round shape mismatch' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT * INTO s FROM "case_second_instance_results" WHERE "id"=r."source_result_id" AND "case_id"=target_case AND "department_id"=target_department;
    IF r."origin"<>'NORMAL' OR r."sequence"<=1 OR s."id" IS NULL OR s."external_entry_id" IS DISTINCT FROM e."id" OR s."result"<>'REMAND' OR
      EXISTS (SELECT 1 FROM "case_second_instance_result_revocations" z WHERE z."result_id"=s."id")
    THEN RAISE EXCEPTION 'external remand round source mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  SELECT * INTO a FROM "case_acceptances" WHERE "id"=c."current_acceptance_id" AND "case_id"=target_case AND "department_id"=target_department;
  IF c."current_acceptance_id" IS NOT NULL AND (a."id" IS NULL OR a."trial_round_id" IS DISTINCT FROM r."id" OR
      a."external_entry_id" IS DISTINCT FROM e."id" OR a."court_case_no" IS DISTINCT FROM c."court_case_no")
  THEN RAISE EXCEPTION 'external current acceptance mismatch' USING ERRCODE='23514'; END IF;
  IF (c."current_hearing_arrangement_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_hearing_arrangements" x WHERE x."id"=c."current_hearing_arrangement_id" AND x."trial_round_id"=r."id" AND x."external_entry_id"=e."id")) OR
     (c."current_hearing_advance_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_hearing_advances" x WHERE x."id"=c."current_hearing_advance_id" AND x."trial_round_id"=r."id" AND x."external_entry_id"=e."id")) OR
     (c."current_judgment_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_judgment_facts" x WHERE x."id"=c."current_judgment_id" AND x."trial_round_id"=r."id" AND x."external_entry_id"=e."id")) OR
     (c."current_judgment_next_step_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_steps" x WHERE x."id"=c."current_judgment_next_step_id" AND x."trial_round_id"=r."id" AND x."external_entry_id"=e."id")) OR
     (c."current_second_instance_progress_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_second_instance_progresses" x WHERE x."id"=c."current_second_instance_progress_id" AND x."trial_round_id"=r."id" AND x."external_entry_id"=e."id")) OR
     (c."current_second_instance_result_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_second_instance_results" x WHERE x."id"=c."current_second_instance_result_id" AND x."external_entry_id"=e."id" AND
       (x."trial_round_id"=r."id" OR (x."result"='REMAND' AND x."id"=r."source_result_id"))))
  THEN RAISE EXCEPTION 'external current fact pointer crosses round' USING ERRCODE='23514'; END IF;
END; $$;
CREATE OR REPLACE FUNCTION "check_case_trial_round_foundation"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; c record; r record; source_result record;
BEGIN
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id" = target_case AND "department_id" = target_department;
  IF c."source_lead_id" IS NULL THEN PERFORM ca018_assert_external_trial_round(target_case,target_department); RETURN NEW; END IF;
  IF c."current_trial_round_id" IS NULL THEN
    IF c."current_acceptance_id" IS NOT NULL OR c."stage" IN
      ('WAITING_HEARING','WAITING_JUDGMENT','SECOND_INSTANCE','WAITING_EXECUTION_DOCUMENTS','WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED') OR
      c."current_second_instance_progress_id" IS NOT NULL OR c."current_second_instance_result_id" IS NOT NULL OR
      EXISTS (SELECT 1 FROM "case_trial_rounds" x WHERE x."case_id" = target_case AND x."department_id" = target_department) OR
      EXISTS (SELECT 1 FROM "case_acceptances" a WHERE a."case_id" = target_case AND a."department_id" = target_department) THEN
      RAISE EXCEPTION 'accepted case has no active trial round' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO r FROM "case_trial_rounds" WHERE "id" = c."current_trial_round_id"
      AND "case_id" = target_case AND "department_id" = target_department;
    IF r."id" IS NULL OR r."revoked_at" IS NOT NULL THEN
      RAISE EXCEPTION 'active trial round missing or revoked' USING ERRCODE = '23514';
    END IF;
    IF r."sequence" = 1 THEN
      IF r."source_result_id" IS NOT NULL OR c."current_acceptance_id" IS NULL OR
         NOT EXISTS (SELECT 1 FROM "case_acceptances" a WHERE a."id" = c."current_acceptance_id"
           AND a."trial_round_id" = r."id" AND a."case_id" = target_case AND a."department_id" = target_department
           AND case_effective_acceptance_no(a."id") = c."court_case_no") THEN
        RAISE EXCEPTION 'initial trial round or acceptance mismatch' USING ERRCODE = '23514';
      END IF;
    ELSE
      SELECT s."id", s."case_id", s."department_id", s."trial_round_id", s."result", s."to_version", v."id" AS revocation_id
        INTO source_result FROM "case_second_instance_results" s
        LEFT JOIN "case_second_instance_result_revocations" v ON v."result_id" = s."id"
        WHERE s."id" = r."source_result_id" AND s."case_id" = target_case AND s."department_id" = target_department;
      IF source_result."id" IS NULL OR source_result."result" <> 'REMAND' OR source_result.revocation_id IS NOT NULL OR
         r."sequence" <= (SELECT p."sequence" FROM "case_trial_rounds" p WHERE p."id" = source_result."trial_round_id") THEN
        RAISE EXCEPTION 'later trial round lacks active remand source' USING ERRCODE = '23514';
      END IF;
      IF c."current_acceptance_id" IS NULL THEN
        IF c."stage" <> 'WAITING_FORMAL_ACCEPTANCE' OR c."current_second_instance_result_id" IS DISTINCT FROM source_result."id" OR
           c."court_case_no" IS NOT NULL OR c."current_hearing_arrangement_id" IS NOT NULL OR
           c."current_hearing_advance_id" IS NOT NULL OR c."current_judgment_id" IS NOT NULL OR
           c."current_judgment_next_step_id" IS NOT NULL OR c."current_second_instance_progress_id" IS NOT NULL THEN
          RAISE EXCEPTION 'unaccepted remand child pointers mismatch' USING ERRCODE = '23514';
        END IF;
      ELSIF NOT EXISTS (SELECT 1 FROM "case_acceptances" a WHERE a."id" = c."current_acceptance_id"
        AND a."trial_round_id" = r."id" AND a."case_id" = target_case AND a."department_id" = target_department
        AND case_effective_acceptance_no(a."id") = c."court_case_no") OR c."current_second_instance_result_id" IS NOT NULL THEN
        RAISE EXCEPTION 'accepted remand child pointers mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'case_trial_rounds' THEN
    IF NEW."revoked_at" IS NOT NULL OR c."current_trial_round_id" IS DISTINCT FROM NEW."id" OR
       NEW."sequence" <> (SELECT COALESCE(MAX(p."sequence"),0) + 1 FROM "case_trial_rounds" p
         WHERE p."case_id" = target_case AND p."department_id" = target_department AND p."id" <> NEW."id") OR
       (NEW."sequence" = 1 AND NEW."source_result_id" IS NOT NULL) OR
       (NEW."sequence" > 1 AND NOT EXISTS (SELECT 1 FROM "case_second_instance_results" s
         WHERE s."id" = NEW."source_result_id" AND s."case_id" = target_case AND s."department_id" = target_department
           AND s."result" = 'REMAND' AND s."to_version" = c."version")) THEN
      RAISE EXCEPTION 'new trial round requires exact remand result' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME <> 'cases' THEN
    IF NEW."trial_round_id" IS DISTINCT FROM c."current_trial_round_id" THEN
      RAISE EXCEPTION 'new case fact must belong to current trial round' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF (c."current_hearing_arrangement_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_hearing_arrangements" x WHERE x."id" = c."current_hearing_arrangement_id"
        AND x."trial_round_id" = c."current_trial_round_id")) OR
     (c."current_hearing_advance_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_hearing_advances" x WHERE x."id" = c."current_hearing_advance_id"
        AND x."trial_round_id" = c."current_trial_round_id")) OR
     (c."current_judgment_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_judgment_facts" x WHERE x."id" = c."current_judgment_id"
        AND x."trial_round_id" = c."current_trial_round_id")) OR
     (c."current_judgment_next_step_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_judgment_next_steps" x WHERE x."id" = c."current_judgment_next_step_id"
        AND x."trial_round_id" = c."current_trial_round_id")) OR
     (c."current_second_instance_progress_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_second_instance_progresses" x WHERE x."id" = c."current_second_instance_progress_id"
        AND x."trial_round_id" = c."current_trial_round_id")) OR
     (c."current_second_instance_result_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_second_instance_results" x WHERE x."id" = c."current_second_instance_result_id"
        AND (x."trial_round_id" = c."current_trial_round_id" OR
          (x."result" = 'REMAND' AND EXISTS (SELECT 1 FROM "case_trial_rounds" child
            WHERE child."id" = c."current_trial_round_id" AND child."source_result_id" = x."id"))))) THEN
    RAISE EXCEPTION 'case current pointer crosses trial rounds' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $function$
;

-- An imported ARCHIVED case has only its real entry root; no closure or
-- archive fact exists to mutate. Leave the old normal archive chain intact.


CREATE OR REPLACE FUNCTION "check_case_execution_submission_reference"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE submission_id uuid; confirmation_id uuid;
BEGIN
  IF NEW."purpose"<>'EXECUTION_APPLICATION' THEN RETURN NEW; END IF;
  IF NEW."resource_type"<>'case' OR NEW."action_event_id" IS NULL THEN RAISE EXCEPTION 'execution reference source invalid' USING ERRCODE='23514'; END IF;
  SELECT s."id" INTO submission_id FROM "case_execution_submissions" s
    WHERE s."case_id"=NEW."resource_id" AND s."department_id"=NEW."department_id" AND s."audit_event_id"=NEW."action_event_id" FOR UPDATE OF s;
  SELECT c."id" INTO confirmation_id FROM "case_execution_confirmations" c
    WHERE c."case_id"=NEW."resource_id" AND c."department_id"=NEW."department_id" AND c."audit_event_id"=NEW."action_event_id"
      AND c."submission_id" IS NULL AND c."external_entry_id" IS NOT NULL FOR UPDATE OF c;
  IF ((submission_id IS NULL) = (confirmation_id IS NULL)) OR
    (submission_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_execution_submission_versions" v
      WHERE v."submission_id"=submission_id AND v."case_id"=NEW."resource_id" AND v."department_id"=NEW."department_id"
        AND v."material_id"=NEW."material_id" AND v."content_version_id"=NEW."content_version_id")) OR
    (submission_id IS NOT NULL AND EXISTS (SELECT 1 FROM "case_execution_submission_receipts" r
      WHERE r."case_id"=NEW."resource_id" AND r."department_id"=NEW."department_id" AND r."result_snapshot"->>'submissionId'=submission_id::text)) OR
    (confirmation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_execution_confirmation_versions" v
      WHERE v."confirmation_id"=confirmation_id AND v."case_id"=NEW."resource_id" AND v."department_id"=NEW."department_id"
        AND v."material_id"=NEW."material_id" AND v."content_version_id"=NEW."content_version_id")) OR
    (confirmation_id IS NOT NULL AND EXISTS (SELECT 1 FROM "case_execution_confirmation_receipts" r
      WHERE r."case_id"=NEW."resource_id" AND r."department_id"=NEW."department_id" AND r."result_snapshot"->>'confirmationId'=confirmation_id::text))
  THEN RAISE EXCEPTION 'execution reference mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

-- CA018 H-phase source-aware guards. B is the sole 152 migration writer.
-- These helpers require 152 ca018_assert_external_trial_round(uuid,uuid).
-- This artifact is intentionally outside the tracked migration tree.

CREATE OR REPLACE FUNCTION "ca018_h_is_unadvanced_root"(target_case uuid,target_department uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "cases" c JOIN "case_external_entries" e
      ON e."case_id"=c."id" AND e."department_id"=c."department_id"
    WHERE c."id"=target_case AND c."department_id"=target_department
      AND c."source_lead_id" IS NULL AND c."source_notary_matter_id" IS NULL AND c."certificate_id" IS NULL
      AND c."version"=1 AND c."stage"=e."initial_stage"
      AND c."current_acceptance_id" IS NULL AND c."current_hearing_arrangement_id" IS NULL
      AND c."current_hearing_advance_id" IS NULL AND c."current_judgment_id" IS NULL
      AND c."current_judgment_next_step_id" IS NULL AND c."current_second_instance_progress_id" IS NULL
      AND c."current_second_instance_result_id" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "case_hearing_arrangements" x WHERE x."case_id"=c."id")
      AND NOT EXISTS (SELECT 1 FROM "case_hearing_advances" x WHERE x."case_id"=c."id")
      AND NOT EXISTS (SELECT 1 FROM "case_judgment_facts" x WHERE x."case_id"=c."id")
      AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_steps" x WHERE x."case_id"=c."id")
      AND NOT EXISTS (SELECT 1 FROM "case_second_instance_progresses" x WHERE x."case_id"=c."id")
      AND NOT EXISTS (SELECT 1 FROM "case_second_instance_results" x WHERE x."case_id"=c."id")
  )
$$;

-- Downstream entry roots have no first judgment. Their real execution/closure
-- facts are checked by their own 150/152 guards, never synthesized here.
CREATE OR REPLACE FUNCTION "ca018_h_downstream_entry_without_judgment"(target_case uuid,target_department uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "cases" c JOIN "case_external_entries" e
      ON e."case_id"=c."id" AND e."department_id"=c."department_id"
    WHERE c."id"=target_case AND c."department_id"=target_department
      AND e."initial_stage" IN ('WAITING_EXECUTION_DOCUMENTS','WAITING_EXECUTION_CONFIRMATION',
        'WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED')
      AND c."version">1 AND c."current_judgment_id" IS NULL
      AND c."current_judgment_next_step_id" IS NULL AND c."current_second_instance_result_id" IS NULL
      AND c."stage" IN ('WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP',
        'WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED')
      AND NOT EXISTS (SELECT 1 FROM "case_judgment_facts" f WHERE f."case_id"=c."id")
      AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_steps" f WHERE f."case_id"=c."id")
      AND NOT EXISTS (SELECT 1 FROM "case_second_instance_results" f WHERE f."case_id"=c."id")
      AND (EXISTS (SELECT 1 FROM "case_execution_submissions" f WHERE f."case_id"=c."id" AND f."external_entry_id"=e."id")
        OR EXISTS (SELECT 1 FROM "case_execution_confirmations" f WHERE f."case_id"=c."id" AND f."external_entry_id"=e."id")
        OR EXISTS (SELECT 1 FROM "case_execution_mailings" f WHERE f."case_id"=c."id" AND f."external_entry_id"=e."id")
        OR EXISTS (SELECT 1 FROM "case_execution_filings" f WHERE f."case_id"=c."id" AND f."external_entry_id"=e."id")
        OR EXISTS (SELECT 1 FROM "case_execution_finishes" f WHERE f."case_id"=c."id" AND f."external_entry_id"=e."id")
        OR EXISTS (SELECT 1 FROM "case_closures" f WHERE f."case_id"=c."id" AND f."external_entry_id"=e."id")
        OR EXISTS (SELECT 1 FROM "case_archives" f WHERE f."case_id"=c."id" AND f."department_id"=c."department_id"))
  )
$$;

CREATE OR REPLACE FUNCTION "ca018_h_direct_second_chain"(target_case uuid,target_department uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE c record; e record; root_round record; result_record record; latest_progress record; latest_revoke record;
BEGIN
  SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
  SELECT * INTO e FROM "case_external_entries" WHERE "case_id"=target_case AND "department_id"=target_department;
  IF e."id" IS NULL OR e."initial_stage"<>'SECOND_INSTANCE' THEN
    RAISE EXCEPTION 'direct second source missing' USING ERRCODE='23514';
  END IF;
  PERFORM ca018_assert_external_trial_round(target_case,target_department);
  SELECT * INTO root_round FROM "case_trial_rounds" r WHERE r."case_id"=target_case
    AND r."department_id"=target_department AND r."origin"='EXTERNAL_CURRENT' AND r."sequence"=1
    AND r."external_entry_id"=e."id" AND r."source_result_id" IS NULL AND r."revoked_at" IS NULL;
  IF root_round."id" IS NULL OR c."current_judgment_id" IS NOT NULL OR c."current_judgment_next_step_id" IS NOT NULL OR
     EXISTS (SELECT 1 FROM "case_acceptances" a WHERE a."trial_round_id"=root_round."id") OR
     EXISTS (SELECT 1 FROM "case_hearing_arrangements" h WHERE h."trial_round_id"=root_round."id") OR
     EXISTS (SELECT 1 FROM "case_hearing_advances" h WHERE h."trial_round_id"=root_round."id") OR
     EXISTS (SELECT 1 FROM "case_judgment_facts" j WHERE j."trial_round_id"=root_round."id") OR
     EXISTS (SELECT 1 FROM "case_judgment_next_steps" s WHERE s."trial_round_id"=root_round."id") THEN
    RAISE EXCEPTION 'direct second has invented first-instance facts' USING ERRCODE='23514';
  END IF;
  SELECT p."id",p."to_version" INTO latest_progress FROM "case_second_instance_progresses" p
    WHERE p."case_id"=target_case AND p."department_id"=target_department AND p."trial_round_id"=root_round."id"
      AND p."choice_id" IS NULL AND p."external_entry_id"=e."id"
    ORDER BY p."to_version" DESC LIMIT 1;
  SELECT v."to_version" INTO latest_revoke FROM "case_second_instance_result_revocations" v
    JOIN "case_second_instance_results" s ON s."id"=v."result_id"
    WHERE s."case_id"=target_case AND s."department_id"=target_department AND s."trial_round_id"=root_round."id"
      AND s."choice_id" IS NULL AND s."external_entry_id"=e."id"
    ORDER BY v."to_version" DESC LIMIT 1;
  IF c."current_second_instance_result_id" IS NULL THEN
    IF c."current_trial_round_id" IS DISTINCT FROM root_round."id" OR c."stage"<>'SECOND_INSTANCE' OR
       c."current_second_instance_progress_id" IS DISTINCT FROM latest_progress."id" OR
       c."version"<>greatest(1,coalesce(latest_progress."to_version",0),coalesce(latest_revoke."to_version",0)) THEN
      RAISE EXCEPTION 'direct second progress/head mismatch' USING ERRCODE='23514';
    END IF;
    RETURN;
  END IF;
  SELECT * INTO result_record FROM "case_second_instance_results" s WHERE s."id"=c."current_second_instance_result_id"
    AND s."case_id"=target_case AND s."department_id"=target_department AND s."trial_round_id"=root_round."id"
    AND s."choice_id" IS NULL AND s."judgment_id" IS NULL AND s."external_entry_id"=e."id"
    AND NOT EXISTS (SELECT 1 FROM "case_second_instance_result_revocations" v WHERE v."result_id"=s."id");
  IF result_record."id" IS NULL OR result_record."progress_id" IS DISTINCT FROM latest_progress."id" OR
     result_record."result_received_at"<e."stage_reached_on" OR
     (e."known"->>'acceptedOn' IS NOT NULL AND result_record."result_received_at"<(e."known"->>'acceptedOn')::date) OR
     (e."known"->>'secondInstanceAcceptedOn' IS NOT NULL AND result_record."result_received_at"<(e."known"->>'secondInstanceAcceptedOn')::date) THEN
    RAISE EXCEPTION 'direct second result source/date mismatch' USING ERRCODE='23514';
  END IF;
  IF result_record."result"='REMAND' THEN
    IF NOT EXISTS (SELECT 1 FROM "case_trial_rounds" child WHERE child."id"=c."current_trial_round_id"
         AND child."case_id"=target_case AND child."department_id"=target_department
         AND child."source_result_id"=result_record."id" AND child."external_entry_id"=e."id"
         AND child."origin"='NORMAL' AND child."revoked_at" IS NULL) THEN
      RAISE EXCEPTION 'direct second remand child mismatch' USING ERRCODE='23514';
    END IF;
    IF c."current_acceptance_id" IS NULL THEN
      IF c."stage"<>'WAITING_FORMAL_ACCEPTANCE' OR c."version"<>result_record."to_version" OR
         c."current_second_instance_progress_id" IS NOT NULL OR
         EXISTS (SELECT 1 FROM "case_judgment_facts" x WHERE x."trial_round_id"=c."current_trial_round_id") THEN
        RAISE EXCEPTION 'unaccepted direct remand child moved without fact' USING ERRCODE='23514';
      END IF;
    ELSIF c."version"<=result_record."to_version" OR NOT EXISTS (
      SELECT 1 FROM "case_acceptances" a WHERE a."id"=c."current_acceptance_id"
        AND a."case_id"=target_case AND a."department_id"=target_department
        AND a."trial_round_id"=c."current_trial_round_id" AND a."external_entry_id"=e."id") THEN
      RAISE EXCEPTION 'direct remand child lacks real acceptance' USING ERRCODE='23514';
    END IF;
  ELSIF c."current_trial_round_id" IS DISTINCT FROM root_round."id" OR
        c."stage" NOT IN ('WAITING_EXECUTION_DOCUMENTS','WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP',
          'WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED') OR
        c."version"<result_record."to_version" OR
        c."current_second_instance_progress_id" IS DISTINCT FROM result_record."progress_id" THEN
    RAISE EXCEPTION 'direct second result head mismatch' USING ERRCODE='23514';
  END IF;
END; $$;


CREATE OR REPLACE FUNCTION "case_second_child_acceptance_date_valid"(target_round uuid,candidate date)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(candidate >= coalesce(case_effective_second_acceptance_date(parent."choice_id"),
    (SELECT x."accepted_at" FROM "case_second_instance_acceptance_changes" x
      WHERE x."case_id"=parent."case_id" AND x."department_id"=parent."department_id"
        AND x."trial_round_id"=parent."trial_round_id" AND x."choice_id" IS NULL
        AND x."external_entry_id"=parent."external_entry_id"
      ORDER BY x."to_revision" DESC LIMIT 1)),true)
  FROM "case_trial_rounds" child
  LEFT JOIN "case_second_instance_results" parent ON parent."id"=child."source_result_id"
  WHERE child."id"=target_round
$$;

CREATE OR REPLACE FUNCTION "check_case_hearing_fact"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM "case_external_entries" e WHERE e."case_id"=NEW."case_id" AND e."department_id"=NEW."department_id") THEN
    PERFORM ca018_assert_external_trial_round(NEW."case_id",NEW."department_id");
    IF TG_TABLE_NAME='case_hearing_arrangements' AND NOT EXISTS (
      SELECT 1 FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id"
        AND c."current_trial_round_id"=NEW."trial_round_id" AND NEW."external_entry_id"=(SELECT e."id" FROM "case_external_entries" e WHERE e."case_id"=c."id")
        AND NEW."from_version"=c."version"-1) THEN
      RAISE EXCEPTION 'external hearing schedule source/version mismatch' USING ERRCODE='23514';
    END IF;
    IF TG_TABLE_NAME='case_hearing_advances' AND NOT EXISTS (
      SELECT 1 FROM "case_hearing_arrangements" ar WHERE ar."id"=NEW."arrangement_id"
        AND ar."trial_round_id"=NEW."trial_round_id" AND ar."external_entry_id"=NEW."external_entry_id") THEN
      RAISE EXCEPTION 'external hearing advance source mismatch' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'case_hearing_arrangements' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "cases" c LEFT JOIN "case_acceptances" ac ON ac."case_id" = c."id" AND ac."department_id" = c."department_id"
        AND ac."trial_round_id" = NEW."trial_round_id"
      LEFT JOIN "case_external_entries" e ON e."case_id"=c."id" AND e."department_id"=c."department_id"
      WHERE c."id" = NEW."case_id" AND c."department_id" = NEW."department_id"
        AND c."current_hearing_arrangement_id" = NEW."id" AND c."version" = NEW."to_version"
        AND c."stage" IN ('WAITING_HEARING', 'WAITING_JUDGMENT')
        AND (c."source_lead_id" IS NOT NULL AND ac."id" IS NOT NULL OR
          e."id" IS NOT NULL AND NEW."external_entry_id"=e."id" AND
          (ac."id" IS NOT NULL OR (e."initial_stage"='WAITING_HEARING' AND
             NOT EXISTS (SELECT 1 FROM "case_acceptances" actual WHERE actual."trial_round_id"=NEW."trial_round_id"))))
        AND (NEW."hearing_at" IS NULL OR
          (ac."id" IS NOT NULL AND NEW."hearing_at">=case_effective_acceptance_date(ac."id")) OR
          (ac."id" IS NULL AND e."initial_stage"='WAITING_HEARING' AND
            NEW."hearing_at">=e."stage_reached_on" AND
            (e."known"->>'acceptedOn' IS NULL OR NEW."hearing_at">=(e."known"->>'acceptedOn')::date)))
    ) THEN
      RAISE EXCEPTION 'hearing arrangement case or accepted date mismatch' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
      AND a."department_id" = NEW."department_id" AND a."resource_type" = 'CASE'
      AND a."resource_id" = NEW."case_id" AND a."actor_kind" = 'HUMAN'
      AND a."actor_user_id" = NEW."recorded_by_user_id"
      AND a."action" = CASE WHEN NEW."source" = 'SCHEDULE' THEN 'case.hearing.scheduled' ELSE 'case.hearing.corrected' END
      AND a."details"->>'arrangementId' = NEW."id"::text
      AND a."details"->>'fromVersion' = NEW."from_version"::text
      AND a."details"->>'toVersion' = NEW."to_version"::text
      AND a."details"->>'hearingAt' IS NOT DISTINCT FROM NEW."hearing_at"::text
    ) THEN
      RAISE EXCEPTION 'hearing arrangement audit mismatch' USING ERRCODE = '23514';
    END IF;
    IF NEW."source" = 'CORRECTION' AND NOT EXISTS (
      SELECT 1 FROM "case_hearing_corrections" x WHERE x."new_arrangement_id" = NEW."id"
        AND x."case_id" = NEW."case_id" AND x."department_id" = NEW."department_id"
        AND x."audit_event_id" = NEW."audit_event_id"
    ) THEN
      RAISE EXCEPTION 'corrected arrangement requires correction fact' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'case_hearing_advances' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "cases" c JOIN "case_hearing_arrangements" ar
        ON ar."id" = NEW."arrangement_id" AND ar."case_id" = c."id" AND ar."department_id" = c."department_id"
      JOIN "audit_events" a ON a."id" = NEW."audit_event_id"
      WHERE c."id" = NEW."case_id" AND c."department_id" = NEW."department_id"
        AND c."stage" = 'WAITING_JUDGMENT' AND c."version" = NEW."to_version"
        AND c."current_hearing_arrangement_id" = ar."id" AND c."current_hearing_advance_id" = NEW."id"
        AND ar."hearing_at" IS NOT NULL
        AND NEW."due_at" = ((ar."hearing_at" + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')
        AND NEW."from_version" = ar."to_version"
        AND a."actor_kind" = 'SYSTEM' AND a."department_id" = c."department_id"
        AND a."resource_type" = 'CASE' AND a."resource_id" = c."id"
        AND a."action" = 'case.hearing.auto_advanced'
    ) THEN
      RAISE EXCEPTION 'hearing advance source or audit mismatch' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM "cases" c JOIN "case_hearing_advances" h ON h."id" = NEW."prior_advance_id"
      JOIN "case_hearing_arrangements" ar ON ar."id" = NEW."new_arrangement_id"
      JOIN "audit_events" a ON a."id" = NEW."audit_event_id"
      WHERE c."id" = NEW."case_id" AND c."department_id" = NEW."department_id"
        AND c."current_hearing_arrangement_id" = ar."id" AND c."version" = NEW."to_version"
        AND c."stage" = NEW."result_stage"
        AND (NEW."result_stage" = 'WAITING_JUDGMENT' AND c."current_hearing_advance_id" = h."id" OR
             NEW."result_stage" = 'WAITING_HEARING' AND c."current_hearing_advance_id" IS NULL)
        AND h."case_id" = c."id" AND h."department_id" = c."department_id"
        AND h."id" = (SELECT latest."id" FROM "case_hearing_advances" latest
          WHERE latest."case_id" = c."id" AND latest."department_id" = c."department_id"
          ORDER BY latest."to_version" DESC, latest."id" DESC LIMIT 1)
        AND NEW."prior_arrangement_id" = (SELECT latest."id" FROM "case_hearing_arrangements" latest
          WHERE latest."case_id" = c."id" AND latest."department_id" = c."department_id"
            AND latest."id" <> NEW."new_arrangement_id"
          ORDER BY latest."to_version" DESC, latest."id" DESC LIMIT 1)
        AND ar."case_id" = c."id" AND ar."department_id" = c."department_id"
        AND ar."source" = 'CORRECTION' AND ar."audit_event_id" = a."id"
        AND ar."recorded_by_user_id" = NEW."recorded_by_user_id"
        AND (NEW."result_stage" = 'WAITING_JUDGMENT') =
          (ar."hearing_at" IS NOT NULL AND ar."hearing_at" < (NEW."recorded_at" AT TIME ZONE 'Asia/Shanghai')::date)
        AND NEW."from_version" = CASE
          WHEN NEW."prior_arrangement_id" = h."arrangement_id" THEN h."to_version"
          ELSE (SELECT prior."to_version" FROM "case_hearing_arrangements" prior WHERE prior."id" = NEW."prior_arrangement_id") END
        AND EXISTS (
          SELECT 1 FROM "case_hearing_arrangements" prior
          WHERE prior."id" = NEW."prior_arrangement_id" AND prior."case_id" = c."id"
            AND prior."department_id" = c."department_id"
            AND ((h."arrangement_id" = prior."id" AND h."to_version" = NEW."from_version") OR
              (prior."to_version" = NEW."from_version" AND EXISTS (
                SELECT 1 FROM "case_hearing_corrections" prior_correction
                WHERE prior_correction."new_arrangement_id" = prior."id"
                  AND prior_correction."case_id" = c."id"
                  AND prior_correction."department_id" = c."department_id"
                  AND prior_correction."prior_advance_id" = h."id"
                  AND prior_correction."result_stage" = 'WAITING_JUDGMENT')))
        )
        AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
        AND a."department_id" = c."department_id" AND a."resource_type" = 'CASE'
        AND a."resource_id" = c."id" AND a."action" = 'case.hearing.corrected'
        AND a."details"->>'reason' = NEW."reason"
        AND a."details"->>'priorArrangementId' = NEW."prior_arrangement_id"::text
        AND a."details"->>'priorAdvanceId' = NEW."prior_advance_id"::text
        AND a."details"->>'resultStage' = NEW."result_stage"::text
    ) THEN
      RAISE EXCEPTION 'hearing correction source or audit mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION "check_case_judgment_final"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; c record; round_id uuid;
        latest_judgment record; latest_choice record; latest_revoke record; latest_progress record; active_result record; latest_result_revocation record;
        root_count integer; expected_version integer; expected_stage text;
BEGIN
  IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; ELSE target_case:=NEW."case_id"; END IF;
  target_department:=NEW."department_id";
  IF EXISTS (SELECT 1 FROM "case_external_entries" e WHERE e."case_id"=target_case
    AND e."department_id"=NEW."department_id") THEN
    PERFORM ca018_assert_external_trial_round(target_case,NEW."department_id");
    IF ca018_h_is_unadvanced_root(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF ca018_h_downstream_entry_without_judgment(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM "case_external_entries" e JOIN "cases" c ON c."id"=e."case_id" AND c."department_id"=e."department_id"
      WHERE c."id"=target_case AND e."initial_stage"='SECOND_INSTANCE'
        AND c."current_judgment_id" IS NULL) THEN
      PERFORM ca018_h_direct_second_chain(target_case,NEW."department_id");
      RETURN NEW;
    END IF;
    IF TG_TABLE_NAME='case_judgment_facts' AND NOT EXISTS (
      SELECT 1 FROM "case_external_entries" e JOIN "case_trial_rounds" r ON r."case_id"=e."case_id" AND r."department_id"=e."department_id"
      WHERE e."case_id"=NEW."case_id" AND e."department_id"=NEW."department_id" AND r."id"=NEW."trial_round_id"
        AND NEW."external_entry_id"=e."id" AND NEW."judgment_received_at">=e."stage_reached_on"
        AND (e."known"->>'acceptedOn' IS NULL OR NEW."judgment_received_at">=(e."known"->>'acceptedOn')::date)
        AND (r."origin"<>'EXTERNAL_CURRENT' OR e."initial_stage"='WAITING_JUDGMENT' OR
          (e."initial_stage"='WAITING_HEARING' AND EXISTS (SELECT 1 FROM "case_hearing_advances" h
            WHERE h."id"=(SELECT c."current_hearing_advance_id" FROM "cases" c WHERE c."id"=NEW."case_id")
              AND h."trial_round_id"=r."id" AND h."external_entry_id"=e."id")))) THEN
      RAISE EXCEPTION 'external judgment source/date mismatch' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id" = target_case AND "department_id" = target_department;
  round_id := c."current_trial_round_id";
  SELECT f."id", f."to_version" INTO latest_judgment FROM "case_judgment_facts" f
    WHERE f."case_id" = target_case AND f."department_id" = target_department AND f."trial_round_id" = round_id
    ORDER BY f."to_version" DESC LIMIT 1;
  IF latest_judgment."id" IS NULL THEN
    IF c."current_judgment_id" IS NOT NULL OR c."current_judgment_next_step_id" IS NOT NULL OR
       c."stage" IN ('SECOND_INSTANCE', 'WAITING_EXECUTION_DOCUMENTS', 'WAITING_EXECUTION_CONFIRMATION', 'WAITING_EXECUTION_STAMP', 'WAITING_EXECUTION_FILING', 'EXECUTING','WAITING_ARCHIVE','ARCHIVED') THEN
      RAISE EXCEPTION 'current round has no judgment for stage' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT count(*) INTO root_count FROM "case_judgment_facts" f WHERE f."case_id" = target_case
      AND f."department_id" = target_department AND f."trial_round_id" = round_id AND f."kind" = 'REGISTER';
    IF root_count <> 1 OR c."current_judgment_id" IS DISTINCT FROM latest_judgment."id" THEN
      RAISE EXCEPTION 'current round judgment head mismatch' USING ERRCODE = '23514';
    END IF;
    SELECT s."id", s."judgment_id", s."next", s."to_version" INTO latest_choice
      FROM "case_judgment_next_steps" s WHERE s."case_id" = target_case AND s."department_id" = target_department
        AND s."trial_round_id" = round_id ORDER BY s."to_version" DESC LIMIT 1;
    expected_version := latest_judgment."to_version";
    IF latest_choice."id" IS NOT NULL THEN
      SELECT v."id", v."to_version" INTO latest_revoke FROM "case_judgment_next_step_revocations" v
        WHERE v."choice_id" = latest_choice."id" AND v."case_id" = target_case AND v."department_id" = target_department;
      IF latest_revoke."id" IS NULL THEN
        IF c."current_judgment_next_step_id" IS DISTINCT FROM latest_choice."id" OR
           c."current_judgment_id" IS DISTINCT FROM latest_choice."judgment_id" THEN
          RAISE EXCEPTION 'current round active choice mismatch' USING ERRCODE = '23514';
        END IF;
        expected_stage := CASE WHEN latest_choice."next" = 'APPEAL' THEN 'SECOND_INSTANCE' ELSE 'WAITING_EXECUTION_DOCUMENTS' END;
        expected_version := latest_choice."to_version";
        IF latest_choice."next" = 'APPEAL' THEN
          SELECT p."id", p."to_version" INTO latest_progress FROM "case_second_instance_progresses" p
            WHERE p."case_id" = target_case AND p."department_id" = target_department AND p."trial_round_id" = round_id
              AND p."choice_id" = latest_choice."id" ORDER BY p."to_version" DESC LIMIT 1;
          IF c."current_second_instance_progress_id" IS DISTINCT FROM latest_progress."id" THEN
            RAISE EXCEPTION 'active second-instance progress head mismatch' USING ERRCODE = '23514';
          END IF;
          expected_version := greatest(expected_version, coalesce(latest_progress."to_version", 0));
          SELECT s."id", s."result", s."to_version" INTO active_result FROM "case_second_instance_results" s
            LEFT JOIN "case_second_instance_result_revocations" v ON v."result_id" = s."id"
            WHERE s."case_id" = target_case AND s."department_id" = target_department AND s."trial_round_id" = round_id
              AND s."choice_id" = latest_choice."id" AND v."id" IS NULL ORDER BY s."to_version" DESC LIMIT 1;
          IF active_result."id" IS NOT NULL THEN
            IF active_result."result" = 'REMAND' OR c."current_second_instance_result_id" IS DISTINCT FROM active_result."id" THEN
              RAISE EXCEPTION 'source round with active remand/result mismatch' USING ERRCODE = '23514';
            END IF;
            expected_stage := 'WAITING_EXECUTION_DOCUMENTS';
            expected_version := active_result."to_version";
          ELSE
            IF c."current_second_instance_result_id" IS NOT NULL THEN
              RAISE EXCEPTION 'second-instance result pointer without active result' USING ERRCODE = '23514';
            END IF;
            SELECT v."to_version" INTO latest_result_revocation FROM "case_second_instance_result_revocations" v
              JOIN "case_second_instance_results" s ON s."id" = v."result_id"
              WHERE s."case_id" = target_case AND s."department_id" = target_department
                AND s."trial_round_id" = round_id AND s."choice_id" = latest_choice."id"
              ORDER BY v."to_version" DESC LIMIT 1;
            expected_version := greatest(expected_version, coalesce(latest_result_revocation."to_version", 0));
          END IF;
        END IF;
        IF EXISTS (SELECT 1 FROM "case_execution_submissions" e WHERE e."case_id" = target_case AND e."department_id" = target_department AND e."trial_round_id" = round_id) THEN
  IF expected_stage <> 'WAITING_EXECUTION_DOCUMENTS' OR NOT EXISTS (
    SELECT 1 FROM "case_execution_submissions" e WHERE e."id" = c."current_execution_submission_id"
      AND e."case_id" = target_case AND e."department_id" = target_department AND e."trial_round_id" = round_id
      AND e."judgment_next_step_id" = latest_choice."id"
      AND e."second_instance_result_id" IS NOT DISTINCT FROM c."current_second_instance_result_id"
      AND e."id" = (SELECT x."id" FROM "case_execution_submissions" x WHERE x."case_id" = target_case
        AND x."department_id" = target_department AND x."trial_round_id" = round_id ORDER BY x."to_version" DESC LIMIT 1)) THEN
    RAISE EXCEPTION 'execution head or source mismatch' USING ERRCODE = '23514';
  END IF;
  SELECT e."to_version" INTO expected_version FROM "case_execution_submissions" e WHERE e."id" = c."current_execution_submission_id";
  IF EXISTS (SELECT 1 FROM "case_execution_confirmations" f WHERE f."case_id" = target_case AND f."department_id" = target_department) THEN
  SELECT f."to_version" INTO expected_version FROM "case_execution_confirmations" f WHERE f."case_id" = target_case AND f."department_id" = target_department AND f."submission_id" = c."current_execution_submission_id";
  IF EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department) THEN
 SELECT case_closure_terminal_version(target_case,target_department,ef."id",ef."to_version") INTO expected_version FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department;
 expected_stage := CASE WHEN EXISTS (SELECT 1 FROM "case_archives" WHERE "case_id"=target_case AND "department_id"=target_department) THEN 'ARCHIVED'::case_stage ELSE 'WAITING_ARCHIVE'::case_stage END;
ELSIF EXISTS (SELECT 1 FROM "case_execution_filings" ff WHERE ff."case_id"=target_case AND ff."department_id"=target_department) THEN
 SELECT ff."to_version" INTO expected_version FROM "case_execution_filings" ff WHERE ff."case_id"=target_case AND ff."department_id"=target_department;
 expected_stage := 'EXECUTING';
ELSIF EXISTS (SELECT 1 FROM "case_execution_mailings" mm WHERE mm."case_id"=target_case AND mm."department_id"=target_department) THEN
 SELECT mm."to_version" INTO expected_version FROM "case_execution_mailings" mm WHERE mm."case_id"=target_case AND mm."department_id"=target_department;
 expected_stage := 'WAITING_EXECUTION_FILING';
ELSE expected_stage := 'WAITING_EXECUTION_STAMP'; END IF;
ELSE expected_stage := 'WAITING_EXECUTION_CONFIRMATION'; END IF;
ELSIF c."current_execution_submission_id" IS NOT NULL THEN
  RAISE EXCEPTION 'execution pointer without fact' USING ERRCODE = '23514';
END IF;
IF c."stage"::text IS DISTINCT FROM expected_stage OR c."version" <> expected_version THEN
          RAISE EXCEPTION 'active judgment choice stage/version mismatch' USING ERRCODE = '23514';
        END IF;
      ELSE
        expected_version := greatest(expected_version, latest_revoke."to_version");
        IF c."current_judgment_next_step_id" IS NOT NULL OR c."stage" <> 'WAITING_JUDGMENT' OR c."version" <> expected_version THEN
          RAISE EXCEPTION 'revoked judgment choice mismatch' USING ERRCODE = '23514';
        END IF;
      END IF;
    ELSIF c."current_judgment_next_step_id" IS NOT NULL OR c."stage" <> 'WAITING_JUDGMENT' OR c."version" <> expected_version THEN
      RAISE EXCEPTION 'judgment stage/version mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'case_judgment_facts' THEN
    IF NEW."judgment_received_at" < (SELECT case_effective_acceptance_date(a."id") FROM "case_acceptances" a
          WHERE a."case_id" = target_case AND a."department_id" = target_department AND a."trial_round_id" = NEW."trial_round_id") OR
       NEW."judgment_received_at" > (NEW."recorded_at" AT TIME ZONE 'Asia/Shanghai')::date OR
       (NEW."kind" = 'REGISTER' AND NEW."prior_fact_id" IS NOT NULL) OR
       (NEW."kind" = 'CORRECT' AND NOT EXISTS (SELECT 1 FROM "case_judgment_facts" prior
         WHERE prior."id" = NEW."prior_fact_id" AND prior."case_id" = NEW."case_id"
           AND prior."department_id" = NEW."department_id" AND prior."trial_round_id" = NEW."trial_round_id"
           AND prior."id" = (SELECT f."id" FROM "case_judgment_facts" f WHERE f."case_id" = NEW."case_id"
             AND f."department_id" = NEW."department_id" AND f."trial_round_id" = NEW."trial_round_id"
             AND f."id" <> NEW."id" ORDER BY f."to_version" DESC LIMIT 1)
           AND (prior."to_version" = NEW."from_version" OR EXISTS (SELECT 1 FROM "case_judgment_next_step_revocations" v
             JOIN "case_judgment_next_steps" s ON s."id" = v."choice_id"
             WHERE s."judgment_id" = prior."id" AND s."trial_round_id" = NEW."trial_round_id"
               AND s."case_id" = NEW."case_id" AND s."department_id" = NEW."department_id"
               AND v."to_version" = NEW."from_version")))) OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = NEW."department_id" AND a."resource_type" = 'CASE' AND a."resource_id" = NEW."case_id"
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = CASE WHEN NEW."kind" = 'REGISTER' THEN 'case.judgment.registered' ELSE 'case.judgment.corrected' END
         AND a."details"->>'judgmentId' = NEW."id"::text AND a."details"->>'fromVersion' = NEW."from_version"::text
         AND a."details"->>'toVersion' = NEW."to_version"::text
         AND a."details"->>'judgmentReceivedAt' = NEW."judgment_received_at"::text
         AND a."details"->>'judgmentAmountState' = NEW."judgment_amount_state"::text
         AND a."details"->>'judgmentAmount' IS NOT DISTINCT FROM NEW."judgment_amount"::text
         AND a."details"->>'paidLitigationFeeState' = NEW."paid_litigation_fee_state"::text
         AND a."details"->>'paidLitigationFee' IS NOT DISTINCT FROM NEW."paid_litigation_fee"::text
         AND a."details"->>'priorFactId' IS NOT DISTINCT FROM NEW."prior_fact_id"::text
         AND a."details"->>'reason' IS NOT DISTINCT FROM NEW."reason") OR
       NOT EXISTS (SELECT 1 FROM "case_judgment_receipts" v WHERE v."case_id" = NEW."case_id"
         AND v."department_id" = NEW."department_id" AND v."actor_user_id" = NEW."recorded_by_user_id"
         AND v."action" = NEW."kind" AND v."result_snapshot"->>'judgmentId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'judgment fact or audit mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION "check_case_judgment_version"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION "check_case_judgment_receipt"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE fact_record RECORD; selected_ids JSONB;
BEGIN
  SELECT f.*, a."details"->'judgmentContentVersionIds' AS selected INTO fact_record
    FROM "case_judgment_facts" f JOIN "audit_events" a ON a."id" = f."audit_event_id"
    WHERE f."id" = (NEW."result_snapshot"->>'judgmentId')::uuid
      AND f."case_id" = NEW."case_id" AND f."department_id" = NEW."department_id"
      AND f."kind" = NEW."action" AND f."recorded_by_user_id" = NEW."actor_user_id"
    FOR UPDATE OF f;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'judgment receipt requires a matching fact' USING ERRCODE = '23514';
  END IF;
  selected_ids := fact_record.selected;
  IF fact_record."id" IS NULL OR jsonb_typeof(selected_ids) IS DISTINCT FROM 'array' OR
     jsonb_array_length(selected_ids) NOT BETWEEN 1 AND 10 OR
     NEW."result_snapshot"->>'id' IS DISTINCT FROM NEW."case_id"::text OR
     NEW."result_snapshot"->>'stage' IS DISTINCT FROM 'WAITING_JUDGMENT' OR
     NEW."result_snapshot"->>'version' IS DISTINCT FROM fact_record."to_version"::text OR
     (NEW."result_snapshot"->>'recordedAt')::timestamptz IS DISTINCT FROM fact_record."recorded_at" OR
     (SELECT COUNT(*) FROM "case_judgment_versions" v WHERE v."fact_id" = fact_record."id") <> jsonb_array_length(selected_ids) OR
     EXISTS (SELECT 1 FROM jsonb_array_elements_text(selected_ids) AS chosen("id") WHERE NOT EXISTS (
       SELECT 1 FROM "case_judgment_versions" v WHERE v."fact_id" = fact_record."id" AND v."content_version_id"::text = chosen."id")) OR
     (SELECT COUNT(*) FROM "material_references" r WHERE r."action_event_id" = fact_record."audit_event_id"
       AND r."resource_type" = 'case' AND r."resource_id" = NEW."case_id" AND r."purpose" = 'JUDGMENT') <> jsonb_array_length(selected_ids) OR
     EXISTS (SELECT 1 FROM "case_judgment_versions" v WHERE v."fact_id" = fact_record."id" AND NOT EXISTS (
       SELECT 1 FROM "material_references" r WHERE r."action_event_id" = fact_record."audit_event_id"
         AND r."resource_type" = 'case' AND r."resource_id" = NEW."case_id" AND r."purpose" = 'JUDGMENT'
         AND r."material_id" = v."material_id" AND r."content_version_id" = v."content_version_id")) THEN
    RAISE EXCEPTION 'judgment receipt requires exact frozen versions' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION "check_case_judgment_next_step_final"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; choice_record record; case_record record;
        latest_prior_id uuid; latest_prior_revoked_to integer; expected_from integer; judgment_version integer;
BEGIN
  IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; ELSE target_case:=NEW."case_id"; END IF;
  target_department:=NEW."department_id";
  IF EXISTS (SELECT 1 FROM "case_external_entries" e WHERE e."case_id"=target_case
    AND e."department_id"=NEW."department_id") THEN
    PERFORM ca018_assert_external_trial_round(target_case,NEW."department_id");
    IF ca018_h_is_unadvanced_root(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF ca018_h_downstream_entry_without_judgment(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM "case_external_entries" e JOIN "cases" c ON c."id"=e."case_id" AND c."department_id"=e."department_id"
      WHERE c."id"=target_case AND e."initial_stage"='SECOND_INSTANCE'
        AND c."current_judgment_id" IS NULL) THEN
      PERFORM ca018_h_direct_second_chain(target_case,NEW."department_id");
      RETURN NEW;
    END IF;
    IF TG_TABLE_NAME='case_judgment_next_steps' AND NOT EXISTS (
      SELECT 1 FROM "case_judgment_facts" j JOIN "case_external_entries" e ON e."case_id"=j."case_id" AND e."department_id"=j."department_id"
      WHERE j."id"=NEW."judgment_id" AND j."trial_round_id"=NEW."trial_round_id" AND j."external_entry_id"=e."id"
        AND NEW."external_entry_id"=e."id" AND j."case_id"=NEW."case_id" AND j."department_id"=NEW."department_id") THEN
      RAISE EXCEPTION 'external judgment choice lacks real judgment' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT c."stage", c."version", c."current_judgment_id", c."current_judgment_next_step_id", c."rights_holder_id"
    INTO case_record FROM "cases" c WHERE c."id" = target_case AND c."department_id" = target_department;
  IF case_record."stage" IN ('SECOND_INSTANCE', 'WAITING_EXECUTION_DOCUMENTS', 'WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED') AND case_record."current_judgment_next_step_id" IS NULL THEN
    RAISE EXCEPTION 'advanced stage requires current choice' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'case_judgment_next_steps' THEN
    SELECT f."to_version" INTO judgment_version FROM "case_judgment_facts" f
      WHERE f."id" = NEW."judgment_id" AND f."case_id" = target_case AND f."department_id" = target_department;
    SELECT s."id", r."to_version" INTO latest_prior_id, latest_prior_revoked_to
      FROM "case_judgment_next_steps" s LEFT JOIN "case_judgment_next_step_revocations" r ON r."choice_id" = s."id"
      WHERE s."case_id" = target_case AND s."department_id" = target_department AND s."id" <> NEW."id" AND s."trial_round_id" = NEW."trial_round_id"
      ORDER BY s."to_version" DESC LIMIT 1;
    expected_from := greatest(judgment_version, coalesce(latest_prior_revoked_to, 0));
    IF judgment_version IS NULL OR (latest_prior_id IS NOT NULL AND latest_prior_revoked_to IS NULL) OR
       NEW."from_version" <> expected_from OR
       NEW."judgment_id" IS DISTINCT FROM case_record."current_judgment_id" OR
       (NEW."next" = 'APPEAL' AND NEW."plaintiff_rights_holder_id" IS NULL AND NOT EXISTS (
         SELECT 1 FROM "case_judgment_appeal_defendants" d WHERE d."choice_id" = NEW."id")) OR
       (NEW."next" = 'EXECUTION' AND EXISTS (
         SELECT 1 FROM "case_judgment_appeal_defendants" d WHERE d."choice_id" = NEW."id")) OR
       (NEW."plaintiff_rights_holder_id" IS NOT NULL AND NEW."plaintiff_rights_holder_id" <> case_record."rights_holder_id") OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = target_department AND a."resource_type" = 'CASE' AND a."resource_id" = target_case
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = 'case.judgment.next_step' AND a."details"->>'choiceId' = NEW."id"::text
         AND a."details"->>'judgmentId' = NEW."judgment_id"::text AND a."details"->>'next' = NEW."next"::text
         AND a."details"->>'fromVersion' = NEW."from_version"::text AND a."details"->>'toVersion' = NEW."to_version"::text
         AND (a."details"->>'plaintiffAppeals')::boolean = (NEW."plaintiff_rights_holder_id" IS NOT NULL)
         AND (a."details"->>'executionReadinessConfirmed')::boolean = NEW."execution_readiness_confirmed"
         AND a."details"->'defendantIds' = (SELECT coalesce(jsonb_agg(d."defendant_id" ORDER BY d."defendant_id"), '[]'::jsonb)
            FROM "case_judgment_appeal_defendants" d WHERE d."choice_id" = NEW."id")) OR
       NOT EXISTS (SELECT 1 FROM "case_judgment_next_step_receipts" r WHERE r."case_id" = target_case
         AND r."department_id" = target_department AND r."actor_user_id" = NEW."recorded_by_user_id"
         AND r."action" = 'CHOOSE' AND r."result_snapshot"->>'choiceId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'judgment choice source, parties, audit or receipt mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'case_judgment_next_step_revocations' THEN
    SELECT s."id", s."judgment_id", s."to_version", s."trial_round_id" INTO choice_record FROM "case_judgment_next_steps" s
      WHERE s."id" = NEW."choice_id" AND s."case_id" = target_case AND s."department_id" = target_department;
    IF choice_record."id" IS NULL OR NEW."from_version" <> choice_record."to_version" OR
       NEW."choice_id" <> (SELECT s."id" FROM "case_judgment_next_steps" s WHERE s."case_id" = target_case AND s."trial_round_id" = choice_record."trial_round_id"
         ORDER BY s."to_version" DESC LIMIT 1) OR
       case_record."current_judgment_id" IS DISTINCT FROM choice_record."judgment_id" OR
       EXISTS (SELECT 1 FROM "case_second_instance_progresses" p WHERE p."choice_id" = NEW."choice_id") OR
       EXISTS (SELECT 1 FROM "case_second_instance_results" x WHERE x."choice_id" = NEW."choice_id") OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = target_department AND a."resource_type" = 'CASE' AND a."resource_id" = target_case
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."internal_actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = 'case.judgment.next_step.revoke' AND a."details"->>'choiceId' = NEW."choice_id"::text
         AND a."details"->>'revocationId' = NEW."id"::text AND a."details"->>'reason' = NEW."reason"
         AND a."details"->>'fromVersion' = NEW."from_version"::text AND a."details"->>'toVersion' = NEW."to_version"::text) OR
       NOT EXISTS (SELECT 1 FROM "case_judgment_next_step_receipts" r WHERE r."case_id" = target_case
         AND r."department_id" = target_department AND r."actor_user_id" = NEW."recorded_by_user_id"
         AND r."action" = 'REVOKE' AND r."result_snapshot"->>'revocationId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'judgment choice revocation mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION "check_case_judgment_next_step_receipt"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE source_record record; expected_stage text;
BEGIN
  IF NEW."action" = 'CHOOSE' THEN
    SELECT s."id", s."judgment_id", s."to_version", s."recorded_at", s."recorded_by_user_id", s."next"
      INTO source_record FROM "case_judgment_next_steps" s
      WHERE s."id" = (NEW."result_snapshot"->>'choiceId')::uuid AND s."case_id" = NEW."case_id"
        AND s."department_id" = NEW."department_id";
    expected_stage := CASE WHEN source_record."next" = 'APPEAL' THEN 'SECOND_INSTANCE' ELSE 'WAITING_EXECUTION_DOCUMENTS' END;
    IF source_record."id" IS NULL OR NEW."result_snapshot"->>'stage' IS DISTINCT FROM expected_stage OR
       NEW."result_snapshot"->>'judgmentId' IS DISTINCT FROM source_record."judgment_id"::text THEN
      RAISE EXCEPTION 'choice receipt source mismatch' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT r."id", s."id" AS choice_id, s."judgment_id", r."to_version", r."recorded_at", r."recorded_by_user_id"
      INTO source_record FROM "case_judgment_next_step_revocations" r JOIN "case_judgment_next_steps" s ON s."id" = r."choice_id"
      WHERE r."id" = (NEW."result_snapshot"->>'revocationId')::uuid AND r."case_id" = NEW."case_id"
        AND r."department_id" = NEW."department_id";
    IF source_record."id" IS NULL OR NEW."result_snapshot"->>'stage' IS DISTINCT FROM 'WAITING_JUDGMENT' OR
       NEW."result_snapshot"->>'choiceId' IS DISTINCT FROM source_record.choice_id::text OR
       NEW."result_snapshot"->>'judgmentId' IS DISTINCT FROM source_record."judgment_id"::text THEN
      RAISE EXCEPTION 'revocation receipt source mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."result_snapshot"->>'id' IS DISTINCT FROM NEW."case_id"::text OR
     NEW."result_snapshot"->>'version' IS DISTINCT FROM source_record."to_version"::text OR
     (NEW."result_snapshot"->>'recordedAt')::timestamptz IS DISTINCT FROM source_record."recorded_at" OR
     NEW."actor_user_id" IS DISTINCT FROM source_record."recorded_by_user_id" THEN
    RAISE EXCEPTION 'judgment next step receipt mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION "check_case_second_instance_final"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; c record; choice_record record; source_result record;
        prior_progress record; prior_result record; last_revocation record; expected_from integer; accepted_date date;
BEGIN
  IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; ELSE target_case:=NEW."case_id"; END IF;
  target_department:=NEW."department_id";
  IF EXISTS (SELECT 1 FROM "case_external_entries" e WHERE e."case_id"=target_case
    AND e."department_id"=NEW."department_id") THEN
    PERFORM ca018_assert_external_trial_round(target_case,NEW."department_id");
    IF ca018_h_is_unadvanced_root(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF ca018_h_downstream_entry_without_judgment(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM "case_external_entries" e JOIN "cases" c ON c."id"=e."case_id" AND c."department_id"=e."department_id"
      WHERE e."case_id"=target_case
        AND e."department_id"=NEW."department_id" AND e."initial_stage"='SECOND_INSTANCE'
        AND c."current_judgment_id" IS NULL) THEN
      PERFORM ca018_h_direct_second_chain(target_case,NEW."department_id");
      IF TG_TABLE_NAME='case_second_instance_progresses' AND NOT EXISTS (
        SELECT 1 FROM "case_external_entries" e JOIN "case_trial_rounds" r ON r."case_id"=e."case_id" AND r."department_id"=e."department_id"
        WHERE e."case_id"=NEW."case_id" AND e."department_id"=NEW."department_id"
          AND r."id"=NEW."trial_round_id" AND r."origin"='EXTERNAL_CURRENT'
          AND NEW."external_entry_id"=e."id" AND NEW."choice_id" IS NULL
          AND NEW."to_version"=NEW."from_version"+1
          AND NEW."from_version"=greatest(1,
            coalesce((SELECT p."to_version" FROM "case_second_instance_progresses" p
              WHERE p."case_id"=NEW."case_id" AND p."department_id"=NEW."department_id"
                AND p."trial_round_id"=NEW."trial_round_id" AND p."id"<>NEW."id"
              ORDER BY p."to_version" DESC LIMIT 1),0),
            coalesce((SELECT v."to_version" FROM "case_second_instance_result_revocations" v
              JOIN "case_second_instance_results" s ON s."id"=v."result_id"
              WHERE s."case_id"=NEW."case_id" AND s."department_id"=NEW."department_id"
                AND s."trial_round_id"=NEW."trial_round_id" AND s."choice_id" IS NULL
              ORDER BY v."to_version" DESC LIMIT 1),0))
          AND NEW."prior_progress_id" IS NOT DISTINCT FROM (SELECT p."id" FROM "case_second_instance_progresses" p
            WHERE p."case_id"=NEW."case_id" AND p."department_id"=NEW."department_id"
              AND p."trial_round_id"=NEW."trial_round_id" AND p."id"<>NEW."id"
            ORDER BY p."to_version" DESC LIMIT 1)
          AND (NEW."hearing_at" IS NULL OR
            (NEW."hearing_at">=e."stage_reached_on" AND
             (e."known"->>'acceptedOn' IS NULL OR NEW."hearing_at">=(e."known"->>'acceptedOn')::date) AND
             (e."known"->>'secondInstanceAcceptedOn' IS NULL OR NEW."hearing_at">=(e."known"->>'secondInstanceAcceptedOn')::date)))
          AND EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id"=NEW."audit_event_id" AND a."action"='case.second_instance.save'
            AND a."resource_id"=NEW."case_id" AND a."department_id"=NEW."department_id"
            AND a."resource_type"='CASE' AND a."actor_kind"='HUMAN'
            AND a."actor_user_id"=NEW."recorded_by_user_id"
            AND a."details"->>'progressId'=NEW."id"::text AND a."details"->>'choiceId' IS NULL
            AND a."details"->>'trialRoundId'=NEW."trial_round_id"::text
            AND a."details"->>'priorProgressId' IS NOT DISTINCT FROM NEW."prior_progress_id"::text
            AND a."details"->>'fromVersion'=NEW."from_version"::text
            AND a."details"->>'toVersion'=NEW."to_version"::text
            AND a."details"->>'hearingAt' IS NOT DISTINCT FROM NEW."hearing_at"::text
            AND a."details"->>'hearingPlace' IS NOT DISTINCT FROM NEW."hearing_place"
            AND a."details"->>'judgeName' IS NOT DISTINCT FROM NEW."judge_name")
          AND EXISTS (SELECT 1 FROM "case_second_instance_receipts" receipt WHERE receipt."case_id"=NEW."case_id"
            AND receipt."department_id"=NEW."department_id" AND receipt."actor_user_id"=NEW."recorded_by_user_id"
            AND receipt."action" IN ('SAVE','RESULT')
            AND receipt."result_snapshot"->>'progressId'=NEW."id"::text)) THEN
        RAISE EXCEPTION 'direct second progress source/audit/receipt mismatch' USING ERRCODE='23514';
      END IF;
      IF TG_TABLE_NAME='case_second_instance_results' AND NOT EXISTS (
        SELECT 1 FROM "case_external_entries" e JOIN "case_trial_rounds" r ON r."case_id"=e."case_id" AND r."department_id"=e."department_id"
        WHERE e."case_id"=NEW."case_id" AND e."department_id"=NEW."department_id"
          AND r."id"=NEW."trial_round_id" AND r."origin"='EXTERNAL_CURRENT'
          AND NEW."external_entry_id"=e."id" AND NEW."choice_id" IS NULL AND NEW."judgment_id" IS NULL
          AND NEW."to_version"=NEW."from_version"+1
          AND NEW."from_version"=greatest(1,
            coalesce((SELECT p."to_version" FROM "case_second_instance_progresses" p
              WHERE p."case_id"=NEW."case_id" AND p."department_id"=NEW."department_id"
                AND p."trial_round_id"=NEW."trial_round_id"
              ORDER BY p."to_version" DESC LIMIT 1),0),
            coalesce((SELECT v."to_version" FROM "case_second_instance_result_revocations" v
              JOIN "case_second_instance_results" s ON s."id"=v."result_id"
              WHERE s."case_id"=NEW."case_id" AND s."department_id"=NEW."department_id"
                AND s."trial_round_id"=NEW."trial_round_id" AND s."choice_id" IS NULL
              ORDER BY v."to_version" DESC LIMIT 1),0))
          AND NEW."progress_id" IS NOT DISTINCT FROM (SELECT p."id" FROM "case_second_instance_progresses" p
            WHERE p."case_id"=NEW."case_id" AND p."department_id"=NEW."department_id"
              AND p."trial_round_id"=NEW."trial_round_id" ORDER BY p."to_version" DESC LIMIT 1)
          AND NEW."result_received_at">=e."stage_reached_on"
          AND NEW."result_received_at" <= (NEW."recorded_at" AT TIME ZONE 'Asia/Shanghai')::date
          AND NOT EXISTS (SELECT 1 FROM "case_second_instance_results" other
            WHERE other."case_id"=NEW."case_id" AND other."department_id"=NEW."department_id"
              AND other."trial_round_id"=NEW."trial_round_id" AND other."id"<>NEW."id"
              AND NOT EXISTS (SELECT 1 FROM "case_second_instance_result_revocations" v WHERE v."result_id"=other."id"))
          AND (NEW."result"<>'AFFIRM' OR NEW."judgment_amount_state" IS NOT NULL)
          AND EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id"=NEW."audit_event_id"
            AND a."action"='case.second_instance.result' AND a."resource_id"=NEW."case_id"
            AND a."department_id"=NEW."department_id" AND a."resource_type"='CASE'
            AND a."actor_kind"='HUMAN' AND a."actor_user_id"=NEW."recorded_by_user_id"
            AND a."details"->>'resultId'=NEW."id"::text
            AND a."details"->>'trialRoundId'=NEW."trial_round_id"::text
            AND a."details"->>'choiceId' IS NULL AND a."details"->>'judgmentId' IS NULL
            AND a."details"->>'progressId' IS NOT DISTINCT FROM NEW."progress_id"::text
            AND a."details"->>'result'=NEW."result"::text
            AND a."details"->>'resultReceivedAt'=NEW."result_received_at"::text
            AND a."details"->>'judgmentAmountState' IS NOT DISTINCT FROM NEW."judgment_amount_state"::text
            AND a."details"->>'judgmentAmount' IS NOT DISTINCT FROM NEW."judgment_amount"::text
            AND a."details"->>'paidLitigationFeeState'=NEW."paid_litigation_fee_state"::text
            AND a."details"->>'paidLitigationFee' IS NOT DISTINCT FROM NEW."paid_litigation_fee"::text
            AND a."details"->>'fromVersion'=NEW."from_version"::text
            AND a."details"->>'toVersion'=NEW."to_version"::text)
          AND EXISTS (SELECT 1 FROM "case_second_instance_receipts" receipt WHERE receipt."case_id"=NEW."case_id"
            AND receipt."department_id"=NEW."department_id" AND receipt."actor_user_id"=NEW."recorded_by_user_id"
            AND receipt."action"='RESULT'
            AND receipt."result_snapshot"->>'resultId'=NEW."id"::text)) THEN
        RAISE EXCEPTION 'direct second result source/audit/receipt mismatch' USING ERRCODE='23514';
      END IF;
      IF TG_TABLE_NAME='case_second_instance_result_revocations' AND NOT EXISTS (
        SELECT 1 FROM "case_second_instance_results" s JOIN "audit_events" a ON a."id"=NEW."audit_event_id"
        JOIN "case_second_instance_receipts" receipt ON receipt."case_id"=NEW."case_id"
          AND receipt."department_id"=NEW."department_id" AND receipt."action"='REVOKE'
          AND receipt."result_snapshot"->>'revocationId'=NEW."id"::text
        WHERE s."id"=NEW."result_id" AND s."case_id"=NEW."case_id" AND s."department_id"=NEW."department_id"
          AND s."external_entry_id"=(SELECT e."id" FROM "case_external_entries" e WHERE e."case_id"=NEW."case_id")
          AND s."choice_id" IS NULL AND NEW."to_version"=NEW."from_version"+1
          AND NEW."from_version"=(SELECT c."version"-1 FROM "cases" c WHERE c."id"=NEW."case_id")
          AND a."department_id"=NEW."department_id" AND a."resource_type"='CASE'
          AND a."actor_kind"='HUMAN' AND a."actor_user_id"=NEW."recorded_by_user_id"
          AND a."internal_actor_user_id"=NEW."recorded_by_user_id"
          AND a."action"='case.second_instance.result.revoke' AND a."resource_id"=NEW."case_id"
          AND a."details"->>'resultId'=NEW."result_id"::text
          AND a."details"->>'revocationId'=NEW."id"::text
          AND a."details"->>'reason'=NEW."reason"
          AND a."details"->>'fromVersion'=NEW."from_version"::text
          AND a."details"->>'toVersion'=NEW."to_version"::text
          AND receipt."actor_user_id"=NEW."recorded_by_user_id"
          AND NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id"=NEW."case_id"
            AND (c."current_second_instance_result_id" IS NOT NULL OR c."stage"<>'SECOND_INSTANCE'
              OR c."current_trial_round_id"<>s."trial_round_id"
              OR c."current_second_instance_progress_id" IS DISTINCT FROM s."progress_id"))
          AND NOT EXISTS (SELECT 1 FROM "case_execution_submissions" downstream
            WHERE downstream."second_instance_result_id"=s."id")
          AND (s."result"<>'REMAND' OR EXISTS (SELECT 1 FROM "case_trial_rounds" child
            WHERE child."source_result_id"=s."id" AND child."external_entry_id"=s."external_entry_id"
              AND child."revoked_at"=NEW."recorded_at"
              AND NOT EXISTS (SELECT 1 FROM "case_acceptances" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_hearing_arrangements" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_hearing_advances" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_judgment_facts" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_steps" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_second_instance_progresses" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_second_instance_results" x WHERE x."trial_round_id"=child."id")))) THEN
        RAISE EXCEPTION 'direct second result revoke mismatch' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id" = target_case AND "department_id" = target_department;
  IF c."current_second_instance_progress_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "case_second_instance_progresses" p WHERE p."id" = c."current_second_instance_progress_id"
      AND p."case_id" = target_case AND p."department_id" = target_department
      AND p."trial_round_id" = c."current_trial_round_id" AND p."choice_id" = c."current_judgment_next_step_id") THEN
    RAISE EXCEPTION 'second-instance current progress pointer mismatch' USING ERRCODE = '23514';
  END IF;
  IF c."current_second_instance_result_id" IS NOT NULL THEN
    SELECT s.*, v."id" AS revocation_id INTO source_result FROM "case_second_instance_results" s
      LEFT JOIN "case_second_instance_result_revocations" v ON v."result_id" = s."id"
      WHERE s."id" = c."current_second_instance_result_id" AND s."case_id" = target_case
        AND s."department_id" = target_department;
    IF source_result."id" IS NULL OR source_result.revocation_id IS NOT NULL OR
       (source_result."result" = 'REMAND' AND (c."stage" <> 'WAITING_FORMAL_ACCEPTANCE' OR
         NOT EXISTS (SELECT 1 FROM "case_trial_rounds" child WHERE child."id" = c."current_trial_round_id"
           AND child."source_result_id" = source_result."id" AND child."revoked_at" IS NULL))) OR
       (source_result."result" <> 'REMAND' AND (c."stage" NOT IN ('WAITING_EXECUTION_DOCUMENTS','WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED') OR
         source_result."trial_round_id" <> c."current_trial_round_id")) THEN
      RAISE EXCEPTION 'second-instance current result pointer mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'case_second_instance_progresses' THEN
    SELECT s."id", s."to_version" INTO choice_record FROM "case_judgment_next_steps" s
      WHERE s."id" = NEW."choice_id" AND s."case_id" = target_case AND s."department_id" = target_department
        AND s."trial_round_id" = NEW."trial_round_id" AND s."next" = 'APPEAL'
        AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_step_revocations" v WHERE v."choice_id" = s."id");
    IF NOT EXISTS (SELECT 1 FROM "case_judgment_next_steps" actual
      JOIN "case_judgment_facts" judgment ON judgment."id"=actual."judgment_id"
      JOIN "case_external_entries" e ON e."case_id"=actual."case_id" AND e."department_id"=actual."department_id"
      WHERE actual."id"=NEW."choice_id" AND actual."trial_round_id"=NEW."trial_round_id"
        AND actual."case_id"=NEW."case_id" AND actual."department_id"=NEW."department_id"
        AND actual."external_entry_id"=e."id" AND judgment."external_entry_id"=e."id"
        AND judgment."trial_round_id"=NEW."trial_round_id" AND actual."next"='APPEAL'
        AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_step_revocations" v WHERE v."choice_id"=actual."id")) THEN
      RAISE EXCEPTION 'external real appeal requires true source choice/judgment' USING ERRCODE='23514';
    END IF;
    SELECT p."id", p."to_version" INTO prior_progress FROM "case_second_instance_progresses" p
      WHERE p."case_id" = target_case AND p."department_id" = target_department
        AND p."trial_round_id" = NEW."trial_round_id" AND p."choice_id" = NEW."choice_id"
        AND p."id" <> NEW."id" ORDER BY p."to_version" DESC LIMIT 1;
    SELECT v."to_version" INTO last_revocation FROM "case_second_instance_result_revocations" v
      JOIN "case_second_instance_results" s ON s."id" = v."result_id"
      WHERE s."case_id" = target_case AND s."department_id" = target_department
        AND s."trial_round_id" = NEW."trial_round_id" AND s."choice_id" = NEW."choice_id"
      ORDER BY v."to_version" DESC LIMIT 1;
    expected_from := greatest(coalesce(choice_record."to_version", 0), coalesce(prior_progress."to_version", 0),
      coalesce(last_revocation."to_version", 0));
    IF choice_record."id" IS NULL OR NEW."prior_progress_id" IS DISTINCT FROM prior_progress."id" OR
       NEW."from_version" <> expected_from OR
       (c."current_trial_round_id" <> NEW."trial_round_id" AND NOT EXISTS (
         SELECT 1 FROM "case_second_instance_results" s WHERE s."trial_round_id" = NEW."trial_round_id"
           AND s."progress_id" = NEW."id" AND s."result" = 'REMAND' AND
           c."current_second_instance_result_id" = s."id")) OR
       (c."current_trial_round_id" = NEW."trial_round_id" AND c."current_second_instance_progress_id" IS DISTINCT FROM NEW."id") OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = target_department AND a."resource_type" = 'CASE' AND a."resource_id" = target_case
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = 'case.second_instance.save' AND a."details"->>'progressId' = NEW."id"::text
         AND a."details"->>'trialRoundId' = NEW."trial_round_id"::text
         AND a."details"->>'choiceId' = NEW."choice_id"::text
         AND a."details"->>'priorProgressId' IS NOT DISTINCT FROM NEW."prior_progress_id"::text
         AND a."details"->>'fromVersion' = NEW."from_version"::text
         AND a."details"->>'toVersion' = NEW."to_version"::text
         AND a."details"->>'hearingAt' IS NOT DISTINCT FROM NEW."hearing_at"::text
         AND a."details"->>'hearingPlace' IS NOT DISTINCT FROM NEW."hearing_place"
         AND a."details"->>'judgeName' IS NOT DISTINCT FROM NEW."judge_name") OR
       NOT EXISTS (SELECT 1 FROM "case_second_instance_receipts" r WHERE r."case_id" = target_case
         AND r."department_id" = target_department AND r."actor_user_id" = NEW."recorded_by_user_id"
         AND r."action" IN ('SAVE', 'RESULT') AND r."result_snapshot"->>'progressId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'second-instance progress chain/audit/receipt mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'case_second_instance_results' THEN
    SELECT s."id", s."judgment_id", s."to_version", s."trial_round_id" INTO choice_record
      FROM "case_judgment_next_steps" s WHERE s."id" = NEW."choice_id" AND s."case_id" = target_case
        AND s."department_id" = target_department AND s."trial_round_id" = NEW."trial_round_id"
        AND s."next" = 'APPEAL' AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_step_revocations" v WHERE v."choice_id" = s."id");
    SELECT case_effective_acceptance_date(a."id") INTO accepted_date FROM "case_acceptances" a WHERE a."case_id" = target_case
      AND a."department_id" = target_department AND a."trial_round_id" = NEW."trial_round_id";
    SELECT p."id", p."to_version" INTO prior_progress FROM "case_second_instance_progresses" p
      WHERE p."case_id" = target_case AND p."department_id" = target_department
        AND p."trial_round_id" = NEW."trial_round_id" AND p."choice_id" = NEW."choice_id"
      ORDER BY p."to_version" DESC LIMIT 1;
    SELECT v."to_version" INTO last_revocation FROM "case_second_instance_result_revocations" v
      JOIN "case_second_instance_results" s ON s."id" = v."result_id"
      WHERE s."case_id" = target_case AND s."department_id" = target_department
        AND s."trial_round_id" = NEW."trial_round_id" AND s."choice_id" = NEW."choice_id"
      ORDER BY v."to_version" DESC LIMIT 1;
    expected_from := greatest(coalesce(choice_record."to_version", 0), coalesce(prior_progress."to_version", 0),
      coalesce(last_revocation."to_version", 0));
    IF choice_record."id" IS NULL OR NEW."judgment_id" IS DISTINCT FROM choice_record."judgment_id" OR
       NEW."progress_id" IS DISTINCT FROM prior_progress."id" OR NEW."from_version" <> expected_from OR
       (accepted_date IS NULL AND NOT EXISTS (SELECT 1 FROM "case_external_entries" e
         WHERE e."case_id"=target_case AND e."department_id"=target_department
           AND e."initial_stage" IN ('WAITING_HEARING','WAITING_JUDGMENT') AND NEW."external_entry_id"=e."id")) OR
       NEW."result_received_at" < coalesce(accepted_date,(SELECT e."stage_reached_on" FROM "case_external_entries" e
         WHERE e."case_id"=target_case AND e."department_id"=target_department)) OR
       NEW."result_received_at" > (NEW."recorded_at" AT TIME ZONE 'Asia/Shanghai')::date OR
       c."current_second_instance_result_id" IS DISTINCT FROM NEW."id" OR
       (NEW."result" = 'AFFIRM' AND NOT EXISTS (SELECT 1 FROM "case_judgment_facts" j
         WHERE j."id" = NEW."judgment_id" AND j."judgment_amount_state" = NEW."judgment_amount_state"
           AND j."judgment_amount" IS NOT DISTINCT FROM NEW."judgment_amount")) OR
       (NEW."result" = 'REMAND' AND NOT EXISTS (SELECT 1 FROM "case_trial_rounds" child
         WHERE child."source_result_id" = NEW."id" AND child."id" = c."current_trial_round_id")) OR
       (NEW."result" <> 'REMAND' AND c."current_trial_round_id" <> NEW."trial_round_id") OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = target_department AND a."resource_type" = 'CASE' AND a."resource_id" = target_case
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = 'case.second_instance.result' AND a."details"->>'resultId' = NEW."id"::text
         AND a."details"->>'trialRoundId' = NEW."trial_round_id"::text
         AND a."details"->>'choiceId' = NEW."choice_id"::text
         AND a."details"->>'judgmentId' = NEW."judgment_id"::text
         AND a."details"->>'progressId' IS NOT DISTINCT FROM NEW."progress_id"::text
         AND a."details"->>'result' = NEW."result"::text
         AND a."details"->>'resultReceivedAt' = NEW."result_received_at"::text
         AND a."details"->>'judgmentAmountState' IS NOT DISTINCT FROM NEW."judgment_amount_state"::text
         AND a."details"->>'judgmentAmount' IS NOT DISTINCT FROM NEW."judgment_amount"::text
         AND a."details"->>'paidLitigationFeeState' = NEW."paid_litigation_fee_state"::text
         AND a."details"->>'paidLitigationFee' IS NOT DISTINCT FROM NEW."paid_litigation_fee"::text
         AND a."details"->>'fromVersion' = NEW."from_version"::text
         AND a."details"->>'toVersion' = NEW."to_version"::text) OR
       NOT EXISTS (SELECT 1 FROM "case_second_instance_receipts" r WHERE r."case_id" = target_case
         AND r."department_id" = target_department AND r."actor_user_id" = NEW."recorded_by_user_id"
         AND r."action" = 'RESULT' AND r."result_snapshot"->>'resultId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'second-instance result source/audit/receipt mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'case_second_instance_result_revocations' THEN
    SELECT s.* INTO source_result FROM "case_second_instance_results" s WHERE s."id" = NEW."result_id"
      AND s."case_id" = target_case AND s."department_id" = target_department;
    IF source_result."id" IS NULL OR NEW."from_version" <> c."version" - 1 OR
       c."current_second_instance_result_id" IS NOT NULL OR c."stage" <> 'SECOND_INSTANCE' OR
       c."current_trial_round_id" <> source_result."trial_round_id" OR
       c."current_second_instance_progress_id" IS DISTINCT FROM source_result."progress_id" OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = target_department AND a."resource_type" = 'CASE' AND a."resource_id" = target_case
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."internal_actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = 'case.second_instance.result.revoke'
         AND a."details"->>'resultId' = NEW."result_id"::text
         AND a."details"->>'revocationId' = NEW."id"::text
         AND a."details"->>'reason' = NEW."reason"
         AND a."details"->>'fromVersion' = NEW."from_version"::text
         AND a."details"->>'toVersion' = NEW."to_version"::text) OR
       NOT EXISTS (SELECT 1 FROM "case_second_instance_receipts" r WHERE r."case_id" = target_case
         AND r."department_id" = target_department AND r."actor_user_id" = NEW."recorded_by_user_id"
         AND r."action" = 'REVOKE' AND r."result_snapshot"->>'revocationId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'second-instance result revocation mismatch' USING ERRCODE = '23514';
    END IF;
    IF source_result."result" = 'REMAND' AND NOT EXISTS (SELECT 1 FROM "case_trial_rounds" child
      WHERE child."source_result_id" = source_result."id" AND child."revoked_at" = NEW."recorded_at"
        AND NOT EXISTS (SELECT 1 FROM "case_acceptances" a WHERE a."trial_round_id" = child."id")
        AND NOT EXISTS (SELECT 1 FROM "case_hearing_arrangements" h WHERE h."trial_round_id" = child."id")
        AND NOT EXISTS (SELECT 1 FROM "case_judgment_facts" j WHERE j."trial_round_id" = child."id")) THEN
      RAISE EXCEPTION 'remand child not empty/revoked' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION "check_case_second_instance_version"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE selected_ids jsonb; expected_category "material_category"; fact_audit uuid;
BEGIN
  IF TG_TABLE_NAME = 'case_second_instance_progress_versions' THEN
    SELECT p."audit_event_id", NEW."category", CASE WHEN NEW."category" = 'SECOND_INSTANCE_DOCUMENT'
      THEN a."details"->'documentContentVersionIds' ELSE a."details"->'serviceContentVersionIds' END
      INTO fact_audit, expected_category, selected_ids
      FROM "case_second_instance_progresses" p JOIN "audit_events" a ON a."id" = p."audit_event_id"
      WHERE p."id" = NEW."progress_id" AND p."case_id" = NEW."case_id" AND p."department_id" = NEW."department_id"
      FOR UPDATE OF p;
  ELSE
    expected_category := 'SECOND_INSTANCE_JUDGMENT';
    SELECT s."audit_event_id", a."details"->'judgmentContentVersionIds' INTO fact_audit, selected_ids
      FROM "case_second_instance_results" s JOIN "audit_events" a ON a."id" = s."audit_event_id"
      WHERE s."id" = NEW."result_id" AND s."case_id" = NEW."case_id" AND s."department_id" = NEW."department_id"
      FOR UPDATE OF s;
  END IF;
  IF fact_audit IS NULL OR jsonb_typeof(selected_ids) IS DISTINCT FROM 'array' OR
     NOT selected_ids ? NEW."content_version_id"::text OR
     NOT EXISTS (SELECT 1 FROM "materials" m JOIN "content_versions" v ON v."material_id" = m."id"
       WHERE m."id" = NEW."material_id" AND v."id" = NEW."content_version_id"
         AND m."department_id" = NEW."department_id" AND m."owner_type" = 'CASE' AND m."owner_id" = NEW."case_id"
         AND m."category" = expected_category AND m."purpose"::text = expected_category::text
         AND m."status" = 'ACTIVE' AND v."status" = 'AVAILABLE'
         AND v."mime_type" IN ('application/pdf','image/jpeg','image/png')
         AND v."size_bytes" <= 52428800
         AND (m."current_version_id" = v."id" OR EXISTS (
           SELECT 1 FROM "case_second_instance_progress_versions" prior_progress_version
           WHERE prior_progress_version."case_id" = NEW."case_id" AND prior_progress_version."department_id" = NEW."department_id"
             AND prior_progress_version."material_id" = m."id" AND prior_progress_version."content_version_id" = v."id") OR EXISTS (
           SELECT 1 FROM "case_second_instance_result_versions" prior_result_version
           WHERE prior_result_version."case_id" = NEW."case_id" AND prior_result_version."department_id" = NEW."department_id"
             AND prior_result_version."material_id" = m."id" AND prior_result_version."content_version_id" = v."id"))) THEN
    RAISE EXCEPTION 'second-instance frozen version mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION "check_case_second_instance_reference"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE fact_id uuid; is_progress boolean;
BEGIN
  IF NEW."purpose" NOT IN ('SECOND_INSTANCE_DOCUMENT','SECOND_INSTANCE_SERVICE','SECOND_INSTANCE_JUDGMENT') THEN RETURN NEW; END IF;
  IF NEW."resource_type" <> 'case' THEN
    RAISE EXCEPTION 'second-instance reference must be a case' USING ERRCODE = '23514';
  END IF;
  is_progress := NEW."purpose" <> 'SECOND_INSTANCE_JUDGMENT';
  IF is_progress THEN
    SELECT p."id" INTO fact_id FROM "case_second_instance_progresses" p
      WHERE p."case_id" = NEW."resource_id" AND p."department_id" = NEW."department_id"
        AND p."audit_event_id" = NEW."action_event_id" FOR UPDATE OF p;
    IF fact_id IS NULL OR NOT EXISTS (SELECT 1 FROM "case_second_instance_progress_versions" v
      WHERE v."progress_id" = fact_id AND v."case_id" = NEW."resource_id" AND v."department_id" = NEW."department_id"
        AND v."category"::text = NEW."purpose" AND v."material_id" = NEW."material_id"
        AND v."content_version_id" = NEW."content_version_id") THEN
      RAISE EXCEPTION 'second-instance progress reference mismatch' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT s."id" INTO fact_id FROM "case_second_instance_results" s
      WHERE s."case_id" = NEW."resource_id" AND s."department_id" = NEW."department_id"
        AND s."audit_event_id" = NEW."action_event_id" FOR UPDATE OF s;
    IF fact_id IS NULL OR NOT EXISTS (SELECT 1 FROM "case_second_instance_result_versions" v
      WHERE v."result_id" = fact_id AND v."case_id" = NEW."resource_id" AND v."department_id" = NEW."department_id"
        AND v."material_id" = NEW."material_id" AND v."content_version_id" = NEW."content_version_id") THEN
      RAISE EXCEPTION 'second-instance result reference mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION "check_case_second_instance_receipt"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE fact record; selected_docs jsonb; selected_services jsonb; selected_judgments jsonb; expected_stage text;
BEGIN
  IF NEW."action" = 'SAVE' THEN
    SELECT p.*, a."details"->'documentContentVersionIds' AS docs,
      a."details"->'serviceContentVersionIds' AS services INTO fact
      FROM "case_second_instance_progresses" p JOIN "audit_events" a ON a."id" = p."audit_event_id"
      WHERE p."id" = (NEW."result_snapshot"->>'progressId')::uuid AND p."case_id" = NEW."case_id"
        AND p."department_id" = NEW."department_id" AND p."recorded_by_user_id" = NEW."actor_user_id"
        AND a."details"->>'sourceAction' = 'SAVE';
    IF fact."id" IS NULL THEN
      -- A blank first save or an unchanged repeat is intentionally receipt-only.
      IF NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id" = NEW."case_id" AND c."department_id" = NEW."department_id"
        AND c."stage" = 'SECOND_INSTANCE' AND c."version" = (NEW."result_snapshot"->>'version')::integer
        AND c."current_trial_round_id"::text = NEW."result_snapshot"->>'currentTrialRoundId'
        AND c."current_second_instance_progress_id"::text IS NOT DISTINCT FROM NEW."result_snapshot"->>'progressId') OR
        NEW."result_snapshot"->>'resultId' IS NOT NULL THEN
        RAISE EXCEPTION 'unchanged second-instance save receipt mismatch' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    selected_docs := fact.docs; selected_services := fact.services;
    IF NEW."result_snapshot"->>'version' IS DISTINCT FROM fact."to_version"::text OR
       NEW."result_snapshot"->>'resultId' IS NOT NULL OR
       jsonb_typeof(selected_docs) IS DISTINCT FROM 'array' OR jsonb_typeof(selected_services) IS DISTINCT FROM 'array' OR
       (SELECT count(*) FROM "case_second_instance_progress_versions" v WHERE v."progress_id" = fact."id") <>
         jsonb_array_length(selected_docs) + jsonb_array_length(selected_services) OR
       EXISTS (SELECT 1 FROM "case_second_instance_progress_versions" v WHERE v."progress_id" = fact."id" AND NOT EXISTS (
         SELECT 1 FROM "material_references" r WHERE r."action_event_id" = fact."audit_event_id"
           AND r."resource_type" = 'case' AND r."resource_id" = NEW."case_id"
           AND r."purpose" = v."category"::text AND r."material_id" = v."material_id"
           AND r."content_version_id" = v."content_version_id")) THEN
      RAISE EXCEPTION 'second-instance save frozen set mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."action" = 'RESULT' THEN
    SELECT s.*, a."details"->'judgmentContentVersionIds' AS judgments INTO fact
      FROM "case_second_instance_results" s JOIN "audit_events" a ON a."id" = s."audit_event_id"
      WHERE s."id" = (NEW."result_snapshot"->>'resultId')::uuid AND s."case_id" = NEW."case_id"
        AND s."department_id" = NEW."department_id" AND s."recorded_by_user_id" = NEW."actor_user_id";
    selected_judgments := fact.judgments;
    expected_stage := CASE WHEN fact."result" = 'REMAND' THEN 'WAITING_FORMAL_ACCEPTANCE' ELSE 'WAITING_EXECUTION_DOCUMENTS' END;
    IF fact."id" IS NULL OR jsonb_typeof(selected_judgments) IS DISTINCT FROM 'array' OR
       jsonb_array_length(selected_judgments) NOT BETWEEN 1 AND 10 OR
       NEW."result_snapshot"->>'version' IS DISTINCT FROM fact."to_version"::text OR
       NEW."result_snapshot"->>'progressId' IS DISTINCT FROM fact."progress_id"::text OR
       NEW."result_snapshot"->>'stage' IS DISTINCT FROM expected_stage OR
       (SELECT count(*) FROM "case_second_instance_result_versions" v WHERE v."result_id" = fact."id") <>
         jsonb_array_length(selected_judgments) OR
       EXISTS (SELECT 1 FROM "case_second_instance_result_versions" v WHERE v."result_id" = fact."id" AND NOT EXISTS (
         SELECT 1 FROM "material_references" r WHERE r."action_event_id" = fact."audit_event_id"
           AND r."resource_type" = 'case' AND r."resource_id" = NEW."case_id"
           AND r."purpose" = 'SECOND_INSTANCE_JUDGMENT' AND r."material_id" = v."material_id"
           AND r."content_version_id" = v."content_version_id")) THEN
      RAISE EXCEPTION 'second-instance result frozen set mismatch' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT v.* INTO fact FROM "case_second_instance_result_revocations" v
      WHERE v."id" = (NEW."result_snapshot"->>'revocationId')::uuid AND v."case_id" = NEW."case_id"
        AND v."department_id" = NEW."department_id" AND v."recorded_by_user_id" = NEW."actor_user_id";
    IF fact."id" IS NULL OR NEW."result_snapshot"->>'version' IS DISTINCT FROM fact."to_version"::text OR
       NEW."result_snapshot"->>'stage' IS DISTINCT FROM 'SECOND_INSTANCE' OR
       NEW."result_snapshot"->>'resultId' IS NOT NULL THEN
      RAISE EXCEPTION 'second-instance revoke receipt mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."result_snapshot"->>'id' IS DISTINCT FROM NEW."case_id"::text OR
     (NEW."result_snapshot"->>'recordedAt')::timestamptz IS DISTINCT FROM fact."recorded_at" THEN
    RAISE EXCEPTION 'second-instance receipt identity/time mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION "check_case_second_acceptance_dates"(target_choice uuid, target_case uuid, target_department uuid, target_round uuid, candidate date)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE source_received date;
BEGIN
  IF target_choice IS NULL THEN
    IF candidate IS NULL THEN RETURN true; END IF;
    IF NOT EXISTS (SELECT 1 FROM "case_external_entries" e JOIN "case_trial_rounds" r
      ON r."case_id"=e."case_id" AND r."department_id"=e."department_id" AND r."external_entry_id"=e."id"
      WHERE e."case_id"=target_case AND e."department_id"=target_department
        AND e."initial_stage"='SECOND_INSTANCE' AND r."id"=target_round AND r."origin"='EXTERNAL_CURRENT'
        AND candidate>=e."stage_reached_on"
        AND (e."known"->>'secondInstanceAcceptedOn' IS NULL OR candidate>=(e."known"->>'secondInstanceAcceptedOn')::date)
        AND (e."known"->>'acceptedOn' IS NULL OR candidate>=(e."known"->>'acceptedOn')::date)) THEN RETURN false; END IF;
    IF EXISTS (SELECT 1 FROM "case_second_instance_progresses" p
      WHERE p."case_id"=target_case AND p."department_id"=target_department AND p."trial_round_id"=target_round
        AND p."choice_id" IS NULL AND p."hearing_at"<candidate) OR
       EXISTS (SELECT 1 FROM "case_second_instance_results" s
      WHERE s."case_id"=target_case AND s."department_id"=target_department AND s."trial_round_id"=target_round
        AND s."choice_id" IS NULL AND s."result_received_at"<candidate) OR
       EXISTS (SELECT 1 FROM "case_second_instance_results" s JOIN "case_trial_rounds" child ON child."source_result_id"=s."id"
         JOIN "case_acceptances" a ON a."trial_round_id"=child."id"
      WHERE s."case_id"=target_case AND s."department_id"=target_department AND s."trial_round_id"=target_round
        AND s."choice_id" IS NULL AND case_effective_acceptance_date(a."id")<candidate) OR
       EXISTS (SELECT 1 FROM "case_second_instance_results" s JOIN "case_execution_submissions" submission
         ON submission."second_instance_result_id"=s."id"
       WHERE s."case_id"=target_case AND s."department_id"=target_department
         AND s."trial_round_id"=target_round AND s."choice_id" IS NULL AND
         (EXISTS (SELECT 1 FROM "case_execution_mailings" m WHERE m."case_id"=target_case AND m."mailed_at"<candidate) OR
          EXISTS (SELECT 1 FROM "case_execution_filings" f WHERE f."case_id"=target_case AND f."submitted_at"<candidate) OR
          EXISTS (SELECT 1 FROM "case_execution_finishes" f WHERE f."case_id"=target_case AND f."finished_at"<candidate) OR
          EXISTS (SELECT 1 FROM "case_closure_versions" v WHERE v."case_id"=target_case AND v."close_at"<candidate) OR
          EXISTS (SELECT 1 FROM "case_archive_versions" v WHERE v."case_id"=target_case AND v."archive_at"<candidate))) THEN RETURN false; END IF;
    RETURN true;
  END IF;
  IF candidate IS NULL THEN RETURN true; END IF;
  SELECT j."judgment_received_at" INTO source_received
  FROM "case_judgment_next_steps" choice
  JOIN "case_judgment_facts" j ON j."id"=choice."judgment_id" AND j."case_id"=choice."case_id" AND j."department_id"=choice."department_id"
  WHERE choice."id"=target_choice AND choice."case_id"=target_case AND choice."department_id"=target_department
    AND choice."trial_round_id"=target_round AND choice."next"='APPEAL';
  IF source_received IS NULL OR candidate < source_received THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM "case_second_instance_progresses" p WHERE p."choice_id"=target_choice AND p."case_id"=target_case AND p."department_id"=target_department AND p."hearing_at"<candidate) OR
     EXISTS (SELECT 1 FROM "case_second_instance_results" r WHERE r."choice_id"=target_choice AND r."case_id"=target_case AND r."department_id"=target_department AND r."result_received_at"<candidate) OR
     EXISTS (SELECT 1 FROM "case_second_instance_results" r JOIN "case_trial_rounds" child ON child."source_result_id"=r."id"
       JOIN "case_acceptances" a ON a."trial_round_id"=child."id" AND a."case_id"=target_case AND a."department_id"=target_department
       WHERE r."choice_id"=target_choice AND r."case_id"=target_case AND r."department_id"=target_department
         AND case_effective_acceptance_date(a."id")<candidate) OR
     EXISTS (SELECT 1 FROM "case_second_instance_results" r JOIN "case_execution_submissions" s ON s."second_instance_result_id"=r."id"
       WHERE r."choice_id"=target_choice AND r."case_id"=target_case AND r."department_id"=target_department AND
         (EXISTS (SELECT 1 FROM "case_execution_mailings" m WHERE m."case_id"=target_case AND m."mailed_at"<candidate) OR
          EXISTS (SELECT 1 FROM "case_execution_filings" f WHERE f."case_id"=target_case AND f."submitted_at"<candidate) OR
          EXISTS (SELECT 1 FROM "case_execution_finishes" f WHERE f."case_id"=target_case AND f."finished_at"<candidate) OR
          EXISTS (SELECT 1 FROM "case_closure_versions" v WHERE v."case_id"=target_case AND v."close_at"<candidate) OR
          EXISTS (SELECT 1 FROM "case_archive_versions" v WHERE v."case_id"=target_case AND v."archive_at"<candidate))) THEN
    RETURN false;
  END IF;
  RETURN true;
END; $function$;

CREATE OR REPLACE FUNCTION "check_case_second_acceptance_change_final"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE change_record record; previous record; root record; case_record record; audit_record record; revision integer:=0; prior_id uuid; prior_date date; prior_no varchar;
BEGIN
  IF NEW."choice_id" IS NULL THEN
    SELECT * INTO root FROM "case_external_entries" e WHERE e."case_id"=NEW."case_id"
      AND e."department_id"=NEW."department_id" AND e."id"=NEW."external_entry_id"
      AND e."initial_stage"='SECOND_INSTANCE';
    SELECT * INTO case_record FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id";
    IF root."id" IS NULL OR case_record."id" IS NULL OR NOT EXISTS (
      SELECT 1 FROM "case_trial_rounds" r WHERE r."id"=NEW."trial_round_id"
        AND r."case_id"=NEW."case_id" AND r."department_id"=NEW."department_id"
        AND r."external_entry_id"=root."id" AND r."origin"='EXTERNAL_CURRENT') THEN
      RAISE EXCEPTION 'direct second acceptance source mismatch' USING ERRCODE='23514';
    END IF;
    FOR change_record IN SELECT * FROM "case_second_instance_acceptance_changes" x
      WHERE x."case_id"=NEW."case_id" AND x."department_id"=NEW."department_id"
        AND x."trial_round_id"=NEW."trial_round_id" AND x."choice_id" IS NULL
        AND x."external_entry_id"=root."id" ORDER BY x."to_revision" LOOP
      SELECT * INTO audit_record FROM "audit_events" a WHERE a."id"=change_record."audit_event_id";
      IF change_record."from_revision"<>revision OR change_record."to_revision"<>revision+1 OR
         change_record."prior_change_id" IS DISTINCT FROM prior_id OR
         (revision=0 AND change_record."accepted_at" IS NULL AND change_record."court_case_no" IS NULL) OR
         (revision>0 AND change_record."accepted_at" IS NOT DISTINCT FROM prior_date AND
           change_record."court_case_no" IS NOT DISTINCT FROM prior_no) OR
         (revision>0 AND change_record."reason" IS NULL) OR
         audit_record."id" IS NULL OR audit_record."department_id"<>NEW."department_id" OR
         audit_record."resource_type"<>'CASE' OR audit_record."resource_id"<>NEW."case_id" OR
         audit_record."actor_user_id" IS DISTINCT FROM change_record."recorded_by_user_id" OR
         audit_record."internal_actor_user_id" IS DISTINCT FROM change_record."recorded_by_user_id" OR
         audit_record."action"<>'case.second-instance-acceptance.updated' OR
         audit_record."details"->>'choiceId' IS NOT NULL OR
         audit_record."details"->>'trialRoundId' IS DISTINCT FROM NEW."trial_round_id"::text OR
         audit_record."details"->>'changeId' IS DISTINCT FROM change_record."id"::text OR
         audit_record."details"->'priorChangeId' IS DISTINCT FROM coalesce(to_jsonb(prior_id),'null'::jsonb) OR
         audit_record."details"->>'fromRevision' IS DISTINCT FROM revision::text OR
         audit_record."details"->>'toRevision' IS DISTINCT FROM (revision+1)::text OR
         audit_record."details"->'beforeAcceptedAt' IS DISTINCT FROM coalesce(to_jsonb(prior_date),'null'::jsonb) OR
         audit_record."details"->'beforeCourtCaseNo' IS DISTINCT FROM coalesce(to_jsonb(prior_no),'null'::jsonb) OR
         audit_record."details"->'acceptedAt' IS DISTINCT FROM coalesce(to_jsonb(change_record."accepted_at"),'null'::jsonb) OR
         audit_record."details"->'courtCaseNo' IS DISTINCT FROM coalesce(to_jsonb(change_record."court_case_no"),'null'::jsonb) OR
         audit_record."details"->'reason' IS DISTINCT FROM coalesce(to_jsonb(change_record."reason"),'null'::jsonb) OR
         (change_record."id"=NEW."id" AND NOT case_record_edit_actor_authorized(
           change_record."recorded_by_user_id",NEW."case_id",NEW."department_id",'case.second-instance-acceptance.update')) OR
         NOT EXISTS (SELECT 1 FROM "case_record_edit_receipts" receipt WHERE receipt."case_id"=NEW."case_id"
           AND receipt."department_id"=NEW."department_id" AND receipt."actor_user_id"=change_record."recorded_by_user_id"
           AND receipt."command"='SECOND_INSTANCE_ACCEPTANCE_SAVE'
           AND receipt."result_snapshot"->>'changeId'=change_record."id"::text) THEN
        RAISE EXCEPTION 'direct second acceptance chain/audit/receipt mismatch' USING ERRCODE='23514';
      END IF;
      revision:=change_record."to_revision"; prior_id:=change_record."id";
      prior_date:=change_record."accepted_at"; prior_no:=change_record."court_case_no";
    END LOOP;
    IF NOT check_case_second_acceptance_dates(NULL::uuid,NEW."case_id",NEW."department_id",NEW."trial_round_id",prior_date) THEN
      RAISE EXCEPTION 'direct second acceptance date conflicts with history' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO root FROM "case_judgment_next_steps" WHERE "id"=NEW."choice_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id" AND "trial_round_id"=NEW."trial_round_id";
  SELECT * INTO case_record FROM "cases" WHERE "id"=NEW."case_id" AND "department_id"=NEW."department_id";
  IF root."id" IS NULL OR root."next"<>'APPEAL' OR case_record."id" IS NULL OR
     EXISTS (SELECT 1 FROM "case_judgment_next_step_revocations" v WHERE v."choice_id"=root."id") THEN
    RAISE EXCEPTION 'invalid second acceptance source' USING ERRCODE='23514';
  END IF;
  FOR change_record IN SELECT * FROM "case_second_instance_acceptance_changes" c
    WHERE c."choice_id"=root."id" AND c."case_id"=root."case_id" AND c."department_id"=root."department_id"
    ORDER BY c."to_revision" LOOP
    SELECT * INTO audit_record FROM "audit_events" a WHERE a."id"=change_record."audit_event_id";
    IF change_record."from_revision"<>revision OR change_record."to_revision"<>revision+1 OR
       change_record."prior_change_id" IS DISTINCT FROM prior_id OR
       (revision=0 AND change_record."accepted_at" IS NULL AND change_record."court_case_no" IS NULL) OR
       (revision>0 AND change_record."accepted_at" IS NOT DISTINCT FROM prior_date AND change_record."court_case_no" IS NOT DISTINCT FROM prior_no) OR
       (revision>0 AND change_record."reason" IS NULL) OR
       audit_record."id" IS NULL OR audit_record."department_id"<>root."department_id" OR audit_record."resource_type"<>'CASE' OR
       audit_record."resource_id"<>root."case_id" OR audit_record."actor_user_id" IS DISTINCT FROM change_record."recorded_by_user_id" OR
       audit_record."internal_actor_user_id" IS DISTINCT FROM change_record."recorded_by_user_id" OR
       audit_record."action"<>'case.second-instance-acceptance.updated' OR
       audit_record."details"->>'choiceId' IS DISTINCT FROM root."id"::text OR
       audit_record."details"->>'trialRoundId' IS DISTINCT FROM root."trial_round_id"::text OR
       audit_record."details"->>'changeId' IS DISTINCT FROM change_record."id"::text OR
       audit_record."details"->'priorChangeId' IS DISTINCT FROM coalesce(to_jsonb(prior_id),'null'::jsonb) OR
       audit_record."details"->>'fromRevision' IS DISTINCT FROM revision::text OR
       audit_record."details"->>'toRevision' IS DISTINCT FROM (revision+1)::text OR
       audit_record."details"->'beforeAcceptedAt' IS DISTINCT FROM coalesce(to_jsonb(prior_date),'null'::jsonb) OR
       audit_record."details"->'beforeCourtCaseNo' IS DISTINCT FROM coalesce(to_jsonb(prior_no),'null'::jsonb) OR
       audit_record."details"->'acceptedAt' IS DISTINCT FROM coalesce(to_jsonb(change_record."accepted_at"),'null'::jsonb) OR
       audit_record."details"->'courtCaseNo' IS DISTINCT FROM coalesce(to_jsonb(change_record."court_case_no"),'null'::jsonb) OR
       audit_record."details"->'reason' IS DISTINCT FROM coalesce(to_jsonb(change_record."reason"),'null'::jsonb) OR
       (change_record."id"=NEW."id" AND NOT case_record_edit_actor_authorized(change_record."recorded_by_user_id",root."case_id",root."department_id",'case.second-instance-acceptance.update')) OR
       NOT EXISTS (SELECT 1 FROM "case_record_edit_receipts" receipt WHERE receipt."case_id"=root."case_id" AND receipt."department_id"=root."department_id"
         AND receipt."actor_user_id"=change_record."recorded_by_user_id" AND receipt."command"='SECOND_INSTANCE_ACCEPTANCE_SAVE'
         AND receipt."result_snapshot"->>'changeId'=change_record."id"::text) THEN
      RAISE EXCEPTION 'broken second acceptance chain' USING ERRCODE='23514';
    END IF;
    revision:=change_record."to_revision"; prior_id:=change_record."id"; prior_date:=change_record."accepted_at"; prior_no:=change_record."court_case_no";
  END LOOP;
  IF NOT check_case_second_acceptance_dates(root."id",root."case_id",root."department_id",root."trial_round_id",prior_date) THEN
    RAISE EXCEPTION 'second acceptance date conflicts with effective history' USING ERRCODE='23514';
  END IF;
  IF case_record."current_judgment_next_step_id" IS DISTINCT FROM root."id" AND
     NOT EXISTS (SELECT 1 FROM "case_second_instance_progresses" p WHERE p."choice_id"=root."id") AND
     NOT EXISTS (SELECT 1 FROM "case_second_instance_results" r WHERE r."choice_id"=root."id") THEN
    RAISE EXCEPTION 'second acceptance lacks historical source' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION "check_case_second_acceptance_dependent_date"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE first_date date; second_date date; business_date date;
BEGIN
  IF EXISTS (SELECT 1 FROM "case_external_entries" e WHERE e."case_id"=NEW."case_id"
    AND e."department_id"=NEW."department_id") THEN
    SELECT greatest(case_effective_acceptance_date(a."id"), e."stage_reached_on",
      (e."known"->>'acceptedOn')::date,
      (e."known"->>'secondInstanceAcceptedOn')::date,
      (SELECT j."judgment_received_at" FROM "case_judgment_next_steps" choice
        JOIN "case_judgment_facts" j ON j."id"=choice."judgment_id"
        WHERE choice."id"=NEW."choice_id" AND choice."case_id"=NEW."case_id"
          AND choice."department_id"=NEW."department_id" AND choice."trial_round_id"=NEW."trial_round_id"))
      INTO first_date FROM "case_external_entries" e
      LEFT JOIN "case_acceptances" a ON a."case_id"=e."case_id" AND a."department_id"=e."department_id"
        AND a."trial_round_id"=NEW."trial_round_id"
      WHERE e."case_id"=NEW."case_id" AND e."department_id"=NEW."department_id";
    IF NEW."choice_id" IS NULL THEN
      SELECT x."accepted_at" INTO second_date FROM "case_second_instance_acceptance_changes" x
        WHERE x."case_id"=NEW."case_id" AND x."department_id"=NEW."department_id"
          AND x."trial_round_id"=NEW."trial_round_id" AND x."choice_id" IS NULL
        ORDER BY x."to_revision" DESC LIMIT 1;
    ELSE second_date:=case_effective_second_acceptance_date(NEW."choice_id"); END IF;
    IF TG_TABLE_NAME='case_second_instance_progresses' THEN business_date:=NEW."hearing_at";
    ELSE business_date:=NEW."result_received_at"; END IF;
    IF business_date IS NOT NULL AND ((first_date IS NOT NULL AND business_date<first_date) OR
      (second_date IS NOT NULL AND business_date<second_date)) THEN
      RAISE EXCEPTION 'external second date precedes true source' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT case_effective_acceptance_date(a."id") INTO first_date FROM "case_acceptances" a
    WHERE a."case_id"=NEW."case_id" AND a."department_id"=NEW."department_id" AND a."trial_round_id"=NEW."trial_round_id";
  second_date:=case_effective_second_acceptance_date(NEW."choice_id");
  IF TG_TABLE_NAME='case_second_instance_progresses' THEN business_date:=NEW."hearing_at";
  ELSE business_date:=NEW."result_received_at"; END IF;
  IF business_date IS NOT NULL AND (first_date IS NULL OR business_date<first_date OR
      (second_date IS NOT NULL AND business_date<second_date)) THEN
    RAISE EXCEPTION 'second instance date precedes effective acceptance' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION "check_case_second_acceptance_blocks_choice_revoke"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM "case_second_instance_acceptance_changes" c WHERE c."choice_id"=NEW."choice_id") THEN
    RAISE EXCEPTION 'second acceptance blocks appeal revoke' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $function$;

-- CA018 E review fragment for B to merge into the sole 152 migration.
-- Do not run alone: depends on B schema, entry/fact guards and direct confirmation bundle.
-- All definitions are unqualified for random-schema validation. The five
-- execution finals and seven actor/version functions derive from I's read-only
-- post-150 pg_get_functiondef snapshot; the normal paths are retained.

-- CA018 E source-aware closure/archive fragment for B's 152 migration.
-- Static CREATE OR REPLACE definitions; do not install without B/R reviewing
-- the complete execution guard set. Existing normal branches remain verbatim.

-- Used only by the five static final guards when their own phase has no fact.
-- It walks actual later facts and the exact version terminal; it does not
-- manufacture any predecessor or accept initial_stage as a shortcut.
CREATE OR REPLACE FUNCTION "ca018_assert_execution_phase_chain"(target_case uuid,target_department uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE c record; e record; s record; q record; m record; f record; x record; h record; a record;
        source_version integer; terminal integer; phase "case_stage"; predecessor record;
BEGIN
 SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
 SELECT * INTO e FROM "case_external_entries" WHERE "case_id"=target_case AND "department_id"=target_department;
 IF c."id" IS NULL OR e."id" IS NULL OR c."source_lead_id" IS NOT NULL OR
    c."source_notary_matter_id" IS NOT NULL OR c."certificate_id" IS NOT NULL
 THEN RAISE EXCEPTION 'execution external root mismatch' USING ERRCODE='23514'; END IF;
 SELECT * INTO s FROM "case_execution_submissions" WHERE "id"=c."current_execution_submission_id" AND "case_id"=target_case AND "department_id"=target_department;
 SELECT * INTO q FROM "case_execution_confirmations" WHERE "case_id"=target_case AND "department_id"=target_department;
 SELECT * INTO m FROM "case_execution_mailings" WHERE "case_id"=target_case AND "department_id"=target_department;
 SELECT * INTO f FROM "case_execution_filings" WHERE "case_id"=target_case AND "department_id"=target_department;
 SELECT * INTO x FROM "case_execution_finishes" WHERE "case_id"=target_case AND "department_id"=target_department;
 SELECT * INTO h FROM "case_closures" WHERE "case_id"=target_case AND "department_id"=target_department;
 SELECT * INTO a FROM "case_archives" WHERE "case_id"=target_case AND "department_id"=target_department;
 IF (s."id" IS NULL AND EXISTS (SELECT 1 FROM "case_execution_submissions" z WHERE z."case_id"=target_case AND z."department_id"=target_department)) OR
    (s."id" IS NOT NULL AND e."initial_stage" IN ('WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED')) OR
    (s."id" IS NOT NULL AND (s."external_entry_id" IS DISTINCT FROM e."id" OR s."trial_round_id" IS DISTINCT FROM c."current_trial_round_id" OR
      s."judgment_next_step_id" IS DISTINCT FROM c."current_judgment_next_step_id" OR s."second_instance_result_id" IS DISTINCT FROM c."current_second_instance_result_id"))
 THEN RAISE EXCEPTION 'execution submission pointer or source mismatch' USING ERRCODE='23514'; END IF;
 phase:=e."initial_stage"; terminal:=1;
 IF s."id" IS NOT NULL THEN
  IF s."prior_submission_id" IS NULL THEN
   IF s."judgment_next_step_id" IS NOT NULL THEN
    SELECT * INTO predecessor FROM "case_judgment_next_steps" z WHERE z."id"=s."judgment_next_step_id" AND z."case_id"=target_case AND z."department_id"=target_department;
    IF predecessor."id" IS NULL OR predecessor."external_entry_id" IS DISTINCT FROM e."id" THEN RAISE EXCEPTION 'execution choice source mismatch' USING ERRCODE='23514'; END IF;
    IF predecessor."next"='APPEAL' THEN
      SELECT * INTO predecessor FROM "case_second_instance_results" z WHERE z."id"=s."second_instance_result_id" AND z."case_id"=target_case AND z."department_id"=target_department AND z."choice_id"=s."judgment_next_step_id" AND z."result" IN ('AFFIRM','CHANGE') AND NOT EXISTS (SELECT 1 FROM "case_second_instance_result_revocations" r WHERE r."result_id"=z."id");
      IF predecessor."id" IS NULL OR predecessor."external_entry_id" IS DISTINCT FROM e."id" THEN RAISE EXCEPTION 'execution appeal source mismatch' USING ERRCODE='23514'; END IF;
    ELSIF predecessor."next"<>'EXECUTION' OR s."second_instance_result_id" IS NOT NULL THEN
      RAISE EXCEPTION 'execution choice result mismatch' USING ERRCODE='23514';
    END IF;
    source_version:=predecessor."to_version";
   ELSIF e."initial_stage"='SECOND_INSTANCE' THEN
    SELECT * INTO predecessor FROM "case_second_instance_results" z WHERE z."id"=s."second_instance_result_id" AND z."case_id"=target_case AND z."department_id"=target_department AND z."choice_id" IS NULL AND z."result" IN ('AFFIRM','CHANGE');
    IF predecessor."id" IS NULL OR predecessor."external_entry_id" IS DISTINCT FROM e."id" THEN RAISE EXCEPTION 'execution direct appeal source mismatch' USING ERRCODE='23514'; END IF;
    source_version:=predecessor."to_version";
   ELSIF e."initial_stage"='WAITING_EXECUTION_DOCUMENTS' AND s."second_instance_result_id" IS NULL THEN source_version:=1;
   ELSE RAISE EXCEPTION 'execution submission source stage mismatch' USING ERRCODE='23514'; END IF;
   IF s."from_version" IS DISTINCT FROM source_version THEN RAISE EXCEPTION 'execution submission initial version mismatch' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT * INTO predecessor FROM "case_execution_submissions" z WHERE z."id"=s."prior_submission_id" AND z."case_id"=target_case AND z."department_id"=target_department;
   IF predecessor."id" IS NULL OR predecessor."external_entry_id" IS DISTINCT FROM e."id" OR predecessor."to_version" IS DISTINCT FROM s."from_version"
   THEN RAISE EXCEPTION 'execution resubmission predecessor mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  IF s."to_version" IS DISTINCT FROM s."from_version"+1 THEN RAISE EXCEPTION 'execution submission version gap' USING ERRCODE='23514'; END IF;
  phase:='WAITING_EXECUTION_CONFIRMATION'; terminal:=s."to_version";
 END IF;
 IF q."id" IS NOT NULL THEN
  IF q."external_entry_id" IS DISTINCT FROM e."id" OR
    NOT ((s."id" IS NOT NULL AND q."submission_id" IS NOT DISTINCT FROM s."id" AND q."from_version" IS NOT DISTINCT FROM terminal) OR
         (s."id" IS NULL AND e."initial_stage"='WAITING_EXECUTION_CONFIRMATION' AND q."submission_id" IS NULL AND q."from_version"=1)) OR
    q."to_version" IS DISTINCT FROM q."from_version"+1
  THEN RAISE EXCEPTION 'execution confirmation source/version mismatch' USING ERRCODE='23514'; END IF;
  phase:='WAITING_EXECUTION_STAMP'; terminal:=q."to_version";
 END IF;
 IF m."id" IS NOT NULL THEN
  IF m."external_entry_id" IS DISTINCT FROM e."id" OR
    NOT ((q."id" IS NOT NULL AND m."confirmation_id" IS NOT DISTINCT FROM q."id" AND m."from_version" IS NOT DISTINCT FROM terminal) OR
         (q."id" IS NULL AND s."id" IS NULL AND e."initial_stage"='WAITING_EXECUTION_STAMP' AND m."confirmation_id" IS NULL AND m."from_version"=1)) OR
    m."to_version" IS DISTINCT FROM m."from_version"+1
  THEN RAISE EXCEPTION 'execution mailing source/version mismatch' USING ERRCODE='23514'; END IF;
  phase:='WAITING_EXECUTION_FILING'; terminal:=m."to_version";
 END IF;
 IF f."id" IS NOT NULL THEN
  IF f."external_entry_id" IS DISTINCT FROM e."id" OR
    NOT ((m."id" IS NOT NULL AND f."mailing_id" IS NOT DISTINCT FROM m."id" AND f."from_version" IS NOT DISTINCT FROM terminal) OR
         (m."id" IS NULL AND q."id" IS NULL AND s."id" IS NULL AND e."initial_stage"='WAITING_EXECUTION_FILING' AND f."mailing_id" IS NULL AND f."from_version"=1)) OR
    f."to_version" IS DISTINCT FROM f."from_version"+1
  THEN RAISE EXCEPTION 'execution filing source/version mismatch' USING ERRCODE='23514'; END IF;
  phase:='EXECUTING'; terminal:=f."to_version";
 END IF;
 IF x."id" IS NOT NULL THEN
  IF x."external_entry_id" IS DISTINCT FROM e."id" OR
    NOT ((f."id" IS NOT NULL AND x."filing_id" IS NOT DISTINCT FROM f."id" AND x."from_version" IS NOT DISTINCT FROM terminal) OR
         (f."id" IS NULL AND m."id" IS NULL AND q."id" IS NULL AND s."id" IS NULL AND e."initial_stage"='EXECUTING' AND x."filing_id" IS NULL AND x."from_version"=1)) OR
    x."to_version" IS DISTINCT FROM x."from_version"+1
  THEN RAISE EXCEPTION 'execution finish source/version mismatch' USING ERRCODE='23514'; END IF;
  phase:='WAITING_ARCHIVE'; terminal:=x."to_version";
 END IF;
 IF h."id" IS NOT NULL THEN
  IF h."external_entry_id" IS DISTINCT FROM e."id" OR
    NOT ((x."id" IS NOT NULL AND h."finish_id" IS NOT DISTINCT FROM x."id") OR
         (x."id" IS NULL AND f."id" IS NULL AND m."id" IS NULL AND q."id" IS NULL AND s."id" IS NULL AND e."initial_stage"='WAITING_ARCHIVE' AND h."finish_id" IS NULL))
  THEN RAISE EXCEPTION 'closure lacks actual finish or entry root' USING ERRCODE='23514'; END IF;
  terminal:=case_closure_source_terminal_version(target_case,target_department,h."finish_id",terminal);
  phase:='WAITING_ARCHIVE';
 END IF;
 IF a."id" IS NOT NULL THEN
  IF h."id" IS NULL OR a."closure_id" IS DISTINCT FROM h."id" OR a."closure_version_id" IS DISTINCT FROM h."current_version_id"
  THEN RAISE EXCEPTION 'archive lacks actual closure version' USING ERRCODE='23514'; END IF;
  terminal:=case_archive_terminal_version(target_case,target_department,h."id",h."current_version_id",terminal);
  phase:='ARCHIVED';
 END IF;
 IF c."stage" IS DISTINCT FROM phase OR c."version" IS DISTINCT FROM terminal
 THEN RAISE EXCEPTION 'execution external terminal mismatch' USING ERRCODE='23514'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION "case_closure_source_terminal_version"(target_case uuid,target_department uuid,target_finish uuid,finish_version integer) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE h record; v record; terminal integer; expected_prior uuid; seen integer:=0; entry_root record;
BEGIN
 IF target_finish IS NULL THEN
  SELECT e.* INTO entry_root FROM "case_external_entries" e JOIN "cases" c
   ON c."id"=e."case_id" AND c."department_id"=e."department_id"
   WHERE e."case_id"=target_case AND e."department_id"=target_department
    AND e."initial_stage"='WAITING_ARCHIVE' AND c."source_lead_id" IS NULL
    AND c."source_notary_matter_id" IS NULL AND c."certificate_id" IS NULL;
  IF entry_root."id" IS NULL OR finish_version IS DISTINCT FROM 1 OR
   EXISTS (SELECT 1 FROM "case_execution_finishes" f WHERE f."case_id"=target_case AND f."department_id"=target_department)
  THEN RAISE EXCEPTION 'closure external root or finish seed mismatch' USING ERRCODE='23514'; END IF;
  SELECT * INTO h FROM "case_closures" WHERE "case_id"=target_case AND "department_id"=target_department;
  IF h."id" IS NULL THEN RETURN 1; END IF;
  IF h."finish_id" IS NOT NULL OR h."external_entry_id" IS DISTINCT FROM entry_root."id" OR h."current_version_id" IS NULL
  THEN RAISE EXCEPTION 'invalid external closure head' USING ERRCODE='23514'; END IF;
  terminal:=1;
  FOR v IN SELECT * FROM "case_closure_versions" WHERE "closure_id"=h."id" AND "case_id"=target_case AND "department_id"=target_department ORDER BY "from_version" LOOP
   IF v."finish_id" IS NOT NULL OR v."external_entry_id" IS DISTINCT FROM entry_root."id" OR
    v."from_version" IS DISTINCT FROM terminal OR v."to_version" IS DISTINCT FROM terminal+1 OR
    v."prior_version_id" IS DISTINCT FROM expected_prior OR
    (seen=0 AND v."kind"<>'REGISTER') OR (seen>0 AND v."kind"<>'CORRECT')
   THEN RAISE EXCEPTION 'broken external closure chain' USING ERRCODE='23514'; END IF;
   terminal:=v."to_version"; expected_prior:=v."id"; seen:=seen+1;
  END LOOP;
  IF seen=0 OR expected_prior IS DISTINCT FROM h."current_version_id" THEN RAISE EXCEPTION 'nonterminal external closure head' USING ERRCODE='23514'; END IF;
  RETURN terminal;
 END IF;
 -- Unchanged 142 normal body after 143 renaming.
 SELECT * INTO h FROM "case_closures" WHERE "case_id"=target_case AND "department_id"=target_department;
 IF h."id" IS NULL THEN RETURN finish_version; END IF;
 IF h."finish_id" IS DISTINCT FROM target_finish OR h."current_version_id" IS NULL THEN RAISE EXCEPTION 'invalid closure head' USING ERRCODE='23514'; END IF;
 terminal:=finish_version;
 FOR v IN SELECT * FROM "case_closure_versions" WHERE "closure_id"=h."id" AND "case_id"=target_case AND "department_id"=target_department ORDER BY "from_version" LOOP
  IF v."finish_id"<>target_finish OR v."from_version"<>terminal OR v."to_version"<>terminal+1 OR v."prior_version_id" IS DISTINCT FROM expected_prior OR
     (seen=0 AND v."kind"<>'REGISTER') OR (seen>0 AND v."kind"<>'CORRECT') THEN RAISE EXCEPTION 'broken closure chain' USING ERRCODE='23514'; END IF;
  terminal:=v."to_version"; expected_prior:=v."id"; seen:=seen+1;
 END LOOP;
 IF seen=0 OR expected_prior IS DISTINCT FROM h."current_version_id" THEN RAISE EXCEPTION 'nonterminal closure head' USING ERRCODE='23514'; END IF;
 RETURN terminal;
END; $$;

-- The closure source function above is the only change needed in the 143
-- case_closure_terminal_version wrapper: it already passes target_finish through
-- and requires a real closure head before an archive terminal can exist.

CREATE OR REPLACE FUNCTION "check_case_closure_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v record;
BEGIN
 SELECT * INTO v FROM "case_closure_versions" WHERE "id"=(NEW."result_snapshot"->>'closureVersionId')::uuid AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id" AND "recorded_by_user_id"=NEW."actor_user_id";
 IF v."id" IS NULL OR jsonb_typeof(NEW."result_snapshot") IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(NEW."result_snapshot"))<>7 OR
  NOT NEW."result_snapshot" ?& ARRAY['id','closureId','closureVersionId','finishId','stage','version','recordedAt'] OR
  NEW."result_snapshot"->>'id' IS DISTINCT FROM NEW."case_id"::text OR NEW."result_snapshot"->>'closureId' IS DISTINCT FROM v."closure_id"::text OR
  NEW."result_snapshot"->'finishId' IS DISTINCT FROM COALESCE(to_jsonb(v."finish_id"),'null'::jsonb) OR
  NEW."result_snapshot"->>'stage' IS DISTINCT FROM 'WAITING_ARCHIVE' OR NEW."result_snapshot"->>'version' IS DISTINCT FROM v."to_version"::text OR (NEW."result_snapshot"->>'recordedAt')::timestamptz IS DISTINCT FROM v."recorded_at" OR
  NEW."command"::text IS DISTINCT FROM (CASE WHEN v."kind"='REGISTER' THEN 'RECORD' ELSE 'CORRECT' END) OR
  NOT EXISTS (SELECT 1 FROM "cases" c JOIN "case_closures" h ON h."case_id"=c."id" AND h."department_id"=c."department_id" WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id" AND c."stage"='WAITING_ARCHIVE' AND c."version"=v."to_version" AND h."current_version_id"=v."id")
 THEN RAISE EXCEPTION 'closure receipt mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION "check_case_closure_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; c record; f record; h record; v record; a record; selected jsonb; base_version integer; entry_root record;
BEGIN
 IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; target_department:=NEW."department_id";
 ELSE target_case:=NEW."case_id"; target_department:=NEW."department_id"; END IF;
 SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
 SELECT * INTO h FROM "case_closures" WHERE "case_id"=target_case AND "department_id"=target_department;
 IF h."id" IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO f FROM "case_execution_finishes" WHERE "id"=h."finish_id" AND "case_id"=target_case AND "department_id"=target_department;
 IF f."id" IS NULL THEN
  SELECT * INTO entry_root FROM "case_external_entries" WHERE "case_id"=target_case AND "department_id"=target_department AND "initial_stage"='WAITING_ARCHIVE';
  IF h."finish_id" IS NOT NULL OR h."external_entry_id" IS DISTINCT FROM entry_root."id" OR entry_root."id" IS NULL OR
   c."source_lead_id" IS NOT NULL OR c."source_notary_matter_id" IS NOT NULL OR c."certificate_id" IS NOT NULL OR
   EXISTS (SELECT 1 FROM "case_execution_finishes" x WHERE x."case_id"=target_case AND x."department_id"=target_department)
  THEN RAISE EXCEPTION 'closure lacks exact external finish root' USING ERRCODE='23514'; END IF;
  base_version:=1;
 ELSE
  base_version:=f."to_version";
 END IF;
 IF c."stage" NOT IN ('WAITING_ARCHIVE','ARCHIVED') OR c."version"<>case_closure_terminal_version(target_case,target_department,h."finish_id",base_version) THEN RAISE EXCEPTION 'closure terminal mismatch' USING ERRCODE='23514'; END IF;
 FOR v IN SELECT * FROM "case_closure_versions" WHERE "closure_id"=h."id" LOOP
  SELECT * INTO a FROM "audit_events" WHERE "id"=v."audit_event_id";
  selected:=a."details"->'closeContentVersionIds';
  IF v."finish_id" IS DISTINCT FROM h."finish_id" OR (f."id" IS NULL AND v."external_entry_id" IS DISTINCT FROM entry_root."id") OR
   a."id" IS NULL OR a."actor_kind"<>'HUMAN' OR a."department_id"<>target_department OR a."resource_type"<>'CASE' OR a."resource_id"<>target_case OR a."actor_user_id"<>v."recorded_by_user_id" OR
   a."action" IS DISTINCT FROM (CASE WHEN v."kind"='REGISTER' THEN 'case.closure.recorded' ELSE 'case.closure.corrected' END) OR
   (a."internal_actor_user_id" IS DISTINCT FROM v."recorded_by_user_id" AND (v."kind"<>'REGISTER' OR NOT EXISTS (SELECT 1 FROM "lawyer_account_bindings" b WHERE b."id"=a."lawyer_account_binding_id" AND b."user_id"=v."recorded_by_user_id" AND b."department_id"=target_department))) OR
   a."details"->>'closureId' IS DISTINCT FROM h."id"::text OR a."details"->>'closureVersionId' IS DISTINCT FROM v."id"::text OR
   a."details"->'finishId' IS DISTINCT FROM COALESCE(to_jsonb(h."finish_id"),'null'::jsonb) OR
   a."details"->'priorVersionId' IS DISTINCT FROM COALESCE(to_jsonb(v."prior_version_id"),'null'::jsonb) OR a."details"->>'fromVersion' IS DISTINCT FROM v."from_version"::text OR a."details"->>'toVersion' IS DISTINCT FROM v."to_version"::text OR
   a."details"->'closeAt' IS DISTINCT FROM COALESCE(to_jsonb(v."close_at"),'null'::jsonb) OR a."details"->>'closeAmountState' IS DISTINCT FROM v."close_amount_state"::text OR a."details"->'closeAmt' IS DISTINCT FROM COALESCE(to_jsonb(v."close_amt"::text),'null'::jsonb) OR
   a."details"->'note' IS DISTINCT FROM COALESCE(to_jsonb(v."note"),'null'::jsonb) OR a."details"->'correctionReason' IS DISTINCT FROM COALESCE(to_jsonb(v."correction_reason"),'null'::jsonb) OR
   jsonb_typeof(selected) IS DISTINCT FROM 'array' OR jsonb_array_length(selected) NOT BETWEEN 0 AND 10 OR
   (SELECT count(*) FROM "case_closure_documents" d WHERE d."closure_version_id"=v."id")<>jsonb_array_length(selected) OR
   EXISTS (SELECT 1 FROM "case_closure_documents" d WHERE d."closure_version_id"=v."id" AND (NOT selected ? d."content_version_id"::text OR NOT EXISTS (SELECT 1 FROM "material_references" r WHERE r."action_event_id"=v."audit_event_id" AND r."department_id"=target_department AND r."resource_type"='case' AND r."resource_id"=target_case AND r."purpose"='CASE_CLOSURE_DOCUMENT' AND r."material_id"=d."material_id" AND r."content_version_id"=d."content_version_id"))) OR
   NOT EXISTS (SELECT 1 FROM "case_closure_receipts" r WHERE r."case_id"=target_case AND r."department_id"=target_department AND r."actor_user_id"=v."recorded_by_user_id" AND r."result_snapshot"->>'closureVersionId'=v."id"::text)
  THEN RAISE EXCEPTION 'closure audit/reference/receipt mismatch' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION "check_case_closure_head_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW."id"<>OLD."id" OR NEW."case_id"<>OLD."case_id" OR NEW."department_id"<>OLD."department_id" OR NEW."finish_id" IS DISTINCT FROM OLD."finish_id" OR NEW."current_version_id" IS NULL OR
  NOT EXISTS (SELECT 1 FROM "case_closure_versions" v WHERE v."id"=NEW."current_version_id" AND v."closure_id"=OLD."id" AND v."case_id"=OLD."case_id" AND v."department_id"=OLD."department_id" AND v."finish_id" IS NOT DISTINCT FROM OLD."finish_id" AND v."prior_version_id" IS NOT DISTINCT FROM OLD."current_version_id")
 THEN RAISE EXCEPTION 'immutable closure identity or invalid head advance' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION "check_case_closure_upload_actor"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record; f record; is_correction boolean; entry_root record; expected_terminal integer;
BEGIN
 IF NEW."category"<>'CASE_CLOSURE_DOCUMENT' THEN RETURN NEW; END IF;
 -- Preserve existing expiry/private-key housekeeping; this cannot complete an upload.
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'status'-'pending_storage_key'-'updated_at')=(to_jsonb(OLD)-'status'-'pending_storage_key'-'updated_at') AND
  NEW."updated_at">=OLD."updated_at" AND ((OLD."status"='OPEN' AND NEW."status"='EXPIRED' AND OLD."expires_at"<=CURRENT_TIMESTAMP AND NEW."pending_storage_key" IS NOT DISTINCT FROM OLD."pending_storage_key") OR
  (OLD."pending_storage_key" IS NOT NULL AND NEW."pending_storage_key" IS NULL AND NEW."status"=OLD."status")) THEN RETURN NEW; END IF;
 SELECT * INTO c FROM "cases" WHERE "id"=NEW."owner_id" AND "department_id"=NEW."department_id" FOR UPDATE;
 SELECT * INTO f FROM "case_execution_finishes" WHERE "case_id"=NEW."owner_id" AND "department_id"=NEW."department_id";
 is_correction:=EXISTS (SELECT 1 FROM "case_closures" h WHERE h."case_id"=NEW."owner_id" AND h."department_id"=NEW."department_id");
 IF f."id" IS NULL AND c."id" IS NOT NULL THEN
  SELECT * INTO entry_root FROM "case_external_entries" WHERE "case_id"=c."id" AND "department_id"=c."department_id" AND "initial_stage"='WAITING_ARCHIVE';
  IF entry_root."id" IS NULL OR c."source_lead_id" IS NOT NULL OR c."source_notary_matter_id" IS NOT NULL OR c."certificate_id" IS NOT NULL
  THEN RAISE EXCEPTION 'closure upload lacks exact external root' USING ERRCODE='23514'; END IF;
  expected_terminal:=case_closure_terminal_version(c."id",c."department_id",NULL,1);
 ELSE
  IF f."id" IS NULL THEN RAISE EXCEPTION 'closure upload lacks finish' USING ERRCODE='23514'; END IF;
  expected_terminal:=case_closure_terminal_version(c."id",c."department_id",f."id",f."to_version");
 END IF;
 IF NEW."owner_type"<>'CASE' OR NEW."purpose"<>'CASE_CLOSURE_DOCUMENT' OR c."id" IS NULL OR c."stage"<>'WAITING_ARCHIVE' OR
  c."version"<>expected_terminal OR
  NOT case_closure_actor_authorized(NEW."actor_user_id",c."id",c."department_id",is_correction)
 THEN RAISE EXCEPTION 'closure upload actor or source forbidden' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION "check_case_archive_actor"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record; h record; closure_head record; f record; terminal integer; entry_root record;
BEGIN
 SELECT * INTO c FROM "cases" WHERE "id"=NEW."case_id" AND "department_id"=NEW."department_id" FOR UPDATE;
 SELECT * INTO h FROM "case_archives" WHERE "id"=NEW."archive_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
 SELECT * INTO closure_head FROM "case_closures" WHERE "id"=h."closure_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
 SELECT * INTO f FROM "case_execution_finishes" WHERE "id"=closure_head."finish_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
 IF c."id" IS NULL OR h."id" IS NULL OR closure_head."id" IS NULL OR
  closure_head."current_version_id" IS DISTINCT FROM h."closure_version_id" OR NEW."closure_version_id" IS DISTINCT FROM h."closure_version_id" OR
  c."version"<>NEW."from_version" OR NEW."archive_at">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date OR
  NOT case_archive_actor_authorized(NEW."recorded_by_user_id",NEW."case_id",NEW."department_id",NEW."kind"='CORRECT')
 THEN RAISE EXCEPTION 'archive actor or anchor forbidden' USING ERRCODE='23514'; END IF;
 IF f."id" IS NULL THEN
  SELECT * INTO entry_root FROM "case_external_entries" WHERE "case_id"=c."id" AND "department_id"=c."department_id" AND "initial_stage"='WAITING_ARCHIVE';
  IF entry_root."id" IS NULL OR closure_head."finish_id" IS NOT NULL OR closure_head."external_entry_id" IS DISTINCT FROM entry_root."id" OR
   c."source_lead_id" IS NOT NULL OR c."source_notary_matter_id" IS NOT NULL OR c."certificate_id" IS NOT NULL OR
   EXISTS (SELECT 1 FROM "case_execution_finishes" x WHERE x."case_id"=c."id" AND x."department_id"=c."department_id")
  THEN RAISE EXCEPTION 'archive lacks real external closure root' USING ERRCODE='23514'; END IF;
  terminal:=case_closure_source_terminal_version(c."id",c."department_id",NULL,1);
 ELSE
  terminal:=case_closure_source_terminal_version(c."id",c."department_id",f."id",f."to_version");
 END IF;
 IF NEW."kind"='ARCHIVE' THEN
  IF c."stage"<>'WAITING_ARCHIVE' OR NEW."prior_version_id" IS NOT NULL OR h."current_version_id" IS NOT NULL OR terminal<>NEW."from_version" OR
   EXISTS (SELECT 1 FROM "case_archive_versions" WHERE "archive_id"=h."id") THEN RAISE EXCEPTION 'invalid first archive' USING ERRCODE='23514'; END IF;
 ELSE
  IF c."stage"<>'ARCHIVED' OR h."current_version_id" IS DISTINCT FROM NEW."prior_version_id" OR
    case_archive_terminal_version(c."id",c."department_id",closure_head."id",h."closure_version_id",terminal)<>NEW."from_version" THEN RAISE EXCEPTION 'invalid archive correction' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION "check_case_archive_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; c record; h record; closure_head record; f record; v record; a record; terminal integer; entry_root record;
BEGIN
 IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; target_department:=NEW."department_id";
 ELSE target_case:=NEW."case_id"; target_department:=NEW."department_id"; END IF;
 SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
 SELECT * INTO h FROM "case_archives" WHERE "case_id"=target_case AND "department_id"=target_department;
 IF h."id" IS NULL THEN
  IF c."stage"='ARCHIVED' THEN
   SELECT * INTO entry_root FROM "case_external_entries" WHERE "case_id"=target_case AND "department_id"=target_department AND "initial_stage"='ARCHIVED';
   IF entry_root."id" IS NULL OR c."source_lead_id" IS NOT NULL OR c."source_notary_matter_id" IS NOT NULL OR c."certificate_id" IS NOT NULL OR
    c."version" IS DISTINCT FROM 1 OR EXISTS (SELECT 1 FROM "case_closures" x WHERE x."case_id"=target_case AND x."department_id"=target_department) OR
    EXISTS (SELECT 1 FROM "case_execution_finishes" x WHERE x."case_id"=target_case AND x."department_id"=target_department) OR
    EXISTS (SELECT 1 FROM "case_execution_filings" x WHERE x."case_id"=target_case AND x."department_id"=target_department) OR
    EXISTS (SELECT 1 FROM "case_execution_mailings" x WHERE x."case_id"=target_case AND x."department_id"=target_department) OR
    EXISTS (SELECT 1 FROM "case_execution_confirmations" x WHERE x."case_id"=target_case AND x."department_id"=target_department) OR
    EXISTS (SELECT 1 FROM "case_execution_submissions" x WHERE x."case_id"=target_case AND x."department_id"=target_department) OR
    EXISTS (SELECT 1 FROM "case_archive_versions" x WHERE x."case_id"=target_case AND x."department_id"=target_department)
   THEN RAISE EXCEPTION 'archived case without archive' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO closure_head FROM "case_closures" WHERE "id"=h."closure_id" AND "case_id"=target_case AND "department_id"=target_department;
 SELECT * INTO f FROM "case_execution_finishes" WHERE "id"=closure_head."finish_id" AND "case_id"=target_case AND "department_id"=target_department;
 IF closure_head."id" IS NULL OR closure_head."current_version_id" IS DISTINCT FROM h."closure_version_id" OR c."stage"<>'ARCHIVED' THEN RAISE EXCEPTION 'archive closure or stage mismatch' USING ERRCODE='23514'; END IF;
 IF f."id" IS NULL THEN
  SELECT * INTO entry_root FROM "case_external_entries" WHERE "case_id"=target_case AND "department_id"=target_department AND "initial_stage"='WAITING_ARCHIVE';
  IF entry_root."id" IS NULL OR closure_head."finish_id" IS NOT NULL OR closure_head."external_entry_id" IS DISTINCT FROM entry_root."id" OR
   c."source_lead_id" IS NOT NULL OR c."source_notary_matter_id" IS NOT NULL OR c."certificate_id" IS NOT NULL OR
   EXISTS (SELECT 1 FROM "case_execution_finishes" x WHERE x."case_id"=target_case AND x."department_id"=target_department)
  THEN RAISE EXCEPTION 'archive closure source mismatch' USING ERRCODE='23514'; END IF;
  terminal:=case_closure_source_terminal_version(target_case,target_department,NULL,1);
 ELSE
  terminal:=case_closure_source_terminal_version(target_case,target_department,f."id",f."to_version");
 END IF;
 IF c."version"<>case_archive_terminal_version(target_case,target_department,closure_head."id",h."closure_version_id",terminal) THEN RAISE EXCEPTION 'archive terminal mismatch' USING ERRCODE='23514'; END IF;
 FOR v IN SELECT * FROM "case_archive_versions" WHERE "archive_id"=h."id" LOOP
  SELECT * INTO a FROM "audit_events" WHERE "id"=v."audit_event_id";
  IF a."id" IS NULL OR a."actor_kind"<>'HUMAN' OR a."department_id"<>target_department OR a."resource_type"<>'CASE' OR a."resource_id"<>target_case OR a."actor_user_id"<>v."recorded_by_user_id" OR
   a."action" IS DISTINCT FROM (CASE WHEN v."kind"='ARCHIVE' THEN 'case.archived' ELSE 'case.archive.corrected' END) OR
   (a."internal_actor_user_id" IS DISTINCT FROM v."recorded_by_user_id" AND (v."kind"<>'ARCHIVE' OR NOT EXISTS (SELECT 1 FROM "lawyer_account_bindings" b WHERE b."id"=a."lawyer_account_binding_id" AND b."user_id"=v."recorded_by_user_id" AND b."department_id"=target_department))) OR
   a."details"->>'archiveId' IS DISTINCT FROM h."id"::text OR a."details"->>'archiveVersionId' IS DISTINCT FROM v."id"::text OR
   a."details"->>'closureId' IS DISTINCT FROM h."closure_id"::text OR a."details"->>'closureVersionId' IS DISTINCT FROM h."closure_version_id"::text OR
   a."details"->'priorVersionId' IS DISTINCT FROM COALESCE(to_jsonb(v."prior_version_id"),'null'::jsonb) OR a."details"->>'fromVersion' IS DISTINCT FROM v."from_version"::text OR a."details"->>'toVersion' IS DISTINCT FROM v."to_version"::text OR
   a."details"->'archiveAt' IS DISTINCT FROM to_jsonb(v."archive_at") OR a."details"->>'archiveType' IS DISTINCT FROM v."archive_type"::text OR a."details"->>'archiveReason' IS DISTINCT FROM v."archive_reason" OR
   a."details"->'correctionReason' IS DISTINCT FROM COALESCE(to_jsonb(v."correction_reason"),'null'::jsonb) OR
   NOT EXISTS (SELECT 1 FROM "case_archive_receipts" r WHERE r."case_id"=target_case AND r."department_id"=target_department AND r."actor_user_id"=v."recorded_by_user_id" AND r."result_snapshot"->>'archiveVersionId'=v."id"::text)
  THEN RAISE EXCEPTION 'archive audit or receipt mismatch' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END; $$;

-- Receipts must distinguish an explicit JSON null predecessor from an omitted
-- key. All other 150 receipt predicates remain the same.
CREATE OR REPLACE FUNCTION "check_case_execution_confirmation_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f record; c record;
BEGIN
  SELECT * INTO f FROM "case_execution_confirmations" WHERE "id" = (NEW."result_snapshot"->>'confirmationId')::uuid
    AND "case_id" = NEW."case_id" AND "department_id" = NEW."department_id"
    AND "confirmed_by_user_id" = NEW."actor_user_id";
  SELECT * INTO c FROM "cases" WHERE "id" = NEW."case_id" AND "department_id" = NEW."department_id";
  IF f."id" IS NULL OR NEW."request_fingerprint" !~ '^[0-9a-f]{64}$' OR
     NEW."result_snapshot"->>'id' IS DISTINCT FROM NEW."case_id"::text OR
     NOT NEW."result_snapshot" ? 'submissionId' OR
     NEW."result_snapshot"->'submissionId' IS DISTINCT FROM COALESCE(to_jsonb(f."submission_id"),'null'::jsonb) OR
     NEW."result_snapshot"->>'stage' IS DISTINCT FROM 'WAITING_EXECUTION_STAMP' OR
     NEW."result_snapshot"->>'version' IS DISTINCT FROM f."to_version"::text OR
     (NEW."result_snapshot"->>'confirmedAt')::timestamptz IS DISTINCT FROM f."confirmed_at" OR
     c."stage" <> 'WAITING_EXECUTION_STAMP' OR c."version" <> f."to_version" OR
     c."current_execution_submission_id" IS DISTINCT FROM f."submission_id" THEN
    RAISE EXCEPTION 'execution confirmation receipt mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION "check_case_execution_mailing_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m record;
BEGIN
  SELECT * INTO m FROM "case_execution_mailings" WHERE "id"=(NEW."result_snapshot"->>'mailingId')::uuid
    AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id" AND "recorded_by_user_id"=NEW."actor_user_id";
  IF m."id" IS NULL OR NEW."result_snapshot"->>'id' IS DISTINCT FROM NEW."case_id"::text OR
     NOT NEW."result_snapshot" ? 'confirmationId' OR
     NEW."result_snapshot"->'confirmationId' IS DISTINCT FROM COALESCE(to_jsonb(m."confirmation_id"),'null'::jsonb) OR
     NEW."result_snapshot"->>'stage' IS DISTINCT FROM 'WAITING_EXECUTION_FILING' OR
     NEW."result_snapshot"->>'version' IS DISTINCT FROM m."to_version"::text OR
     (NEW."result_snapshot"->>'mailedAt')::date IS DISTINCT FROM m."mailed_at" OR
     (NEW."result_snapshot"->>'recordedAt')::timestamptz IS DISTINCT FROM m."recorded_at" OR
     NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id"
       AND c."stage"='WAITING_EXECUTION_FILING' AND c."version"=m."to_version") OR
     (SELECT count(*) FROM "case_execution_mailing_versions" v WHERE v."mailing_id"=m."id") NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'execution mailing receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION "check_case_execution_filing_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM "case_execution_filings" WHERE "id"=(NEW."result_snapshot"->>'filingId')::uuid
    AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id" AND "submitted_by_user_id"=NEW."actor_user_id";
  IF f."id" IS NULL OR NEW."result_snapshot"->>'id' IS DISTINCT FROM NEW."case_id"::text OR
     NOT NEW."result_snapshot" ? 'mailingId' OR
     NEW."result_snapshot"->'mailingId' IS DISTINCT FROM COALESCE(to_jsonb(f."mailing_id"),'null'::jsonb) OR
     NEW."result_snapshot"->>'stage' IS DISTINCT FROM 'EXECUTING' OR
     NEW."result_snapshot"->>'version' IS DISTINCT FROM f."to_version"::text OR
     (NEW."result_snapshot"->>'submittedAt')::date IS DISTINCT FROM f."submitted_at" OR
     (NEW."result_snapshot"->>'recordedAt')::timestamptz IS DISTINCT FROM f."recorded_at" OR
     NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id"
       AND c."stage"='EXECUTING' AND c."version"=f."to_version") OR
     (SELECT count(*) FROM "case_execution_filing_versions" v WHERE v."filing_id"=f."id") NOT BETWEEN 1 AND 10 OR
     EXISTS (SELECT 1 FROM "case_execution_filing_versions" v WHERE v."filing_id"=f."id" AND NOT EXISTS
       (SELECT 1 FROM "material_references" r WHERE r."action_event_id"=f."audit_event_id" AND r."resource_type"='case'
         AND r."resource_id"=NEW."case_id" AND r."purpose"='EXECUTION_FILING_PROOF'
         AND r."material_id"=v."material_id" AND r."content_version_id"=v."content_version_id")) THEN
    RAISE EXCEPTION 'execution filing receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION "check_case_execution_finish_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM "case_execution_finishes" WHERE "id"=(NEW."result_snapshot"->>'finishId')::uuid
    AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id" AND "recorded_by_user_id"=NEW."actor_user_id";
  IF jsonb_typeof(NEW."result_snapshot") IS DISTINCT FROM 'object' OR
     (SELECT count(*) FROM jsonb_object_keys(NEW."result_snapshot"))<>7 OR
     NOT NEW."result_snapshot" ?& ARRAY['id','finishId','filingId','stage','version','finishedAt','recordedAt'] OR
     f."id" IS NULL OR NEW."result_snapshot"->>'id' IS DISTINCT FROM NEW."case_id"::text OR
     NEW."result_snapshot"->'filingId' IS DISTINCT FROM COALESCE(to_jsonb(f."filing_id"),'null'::jsonb) OR
     NEW."result_snapshot"->>'stage' IS DISTINCT FROM 'WAITING_ARCHIVE' OR
     NEW."result_snapshot"->>'version' IS DISTINCT FROM f."to_version"::text OR
     (NEW."result_snapshot"->>'finishedAt')::date IS DISTINCT FROM f."finished_at" OR
     (NEW."result_snapshot"->>'recordedAt')::timestamptz IS DISTINCT FROM f."recorded_at" OR
     NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id"
       AND c."stage"='WAITING_ARCHIVE' AND c."version"=f."to_version") OR
     (SELECT count(*) FROM "case_execution_finish_versions" v WHERE v."finish_id"=f."id") NOT BETWEEN 0 AND 10 OR
     (f."basis_note" IS NULL AND NOT EXISTS (SELECT 1 FROM "case_execution_finish_versions" v WHERE v."finish_id"=f."id")) OR
     EXISTS (SELECT 1 FROM "case_execution_finish_versions" v WHERE v."finish_id"=f."id" AND NOT EXISTS
       (SELECT 1 FROM "material_references" r WHERE r."action_event_id"=f."audit_event_id" AND r."resource_type"='case'
         AND r."resource_id"=NEW."case_id" AND r."purpose"='EXECUTION_FINISH_BASIS'
         AND r."material_id"=v."material_id" AND r."content_version_id"=v."content_version_id")) THEN
    RAISE EXCEPTION 'execution filing receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

-- Exact 150 source-neutral guards retained verbatim (unqualified heading).
CREATE OR REPLACE FUNCTION "check_case_execution_submission_receipt"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE fact record;
BEGIN
  SELECT s.* INTO fact FROM "case_execution_submissions" s
    WHERE s."id" = (NEW."result_snapshot"->>'submissionId')::uuid AND s."case_id" = NEW."case_id"
      AND s."department_id" = NEW."department_id" AND s."submitted_by_user_id" = NEW."actor_user_id";
  IF fact."id" IS NULL OR NEW."request_fingerprint" !~ '^[0-9a-f]{64}$' OR
     NEW."result_snapshot"->>'id' IS DISTINCT FROM NEW."case_id"::text OR
     NEW."result_snapshot"->>'stage' IS DISTINCT FROM 'WAITING_EXECUTION_CONFIRMATION' OR
     NEW."result_snapshot"->>'version' IS DISTINCT FROM fact."to_version"::text OR
     (NEW."result_snapshot"->>'submittedAt')::timestamptz IS DISTINCT FROM fact."submitted_at" OR
     NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id" = NEW."case_id" AND c."department_id" = NEW."department_id"
       AND c."current_execution_submission_id" = fact."id" AND c."stage" = 'WAITING_EXECUTION_CONFIRMATION'
       AND c."version" = fact."to_version") OR
     (SELECT count(*) FROM "case_execution_submission_versions" v WHERE v."submission_id" = fact."id") NOT BETWEEN 1 AND 10 OR
     EXISTS (SELECT 1 FROM "case_execution_submission_versions" v WHERE v."submission_id" = fact."id"
       AND NOT EXISTS (SELECT 1 FROM "material_references" r WHERE r."action_event_id" = fact."audit_event_id"
         AND r."resource_type" = 'case' AND r."resource_id" = NEW."case_id"
         AND r."purpose" = 'EXECUTION_APPLICATION' AND r."material_id" = v."material_id"
         AND r."content_version_id" = v."content_version_id")) THEN
    RAISE EXCEPTION 'execution receipt or frozen set mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION "case_closure_terminal_version"(target_case uuid, target_department uuid, target_finish uuid, finish_version integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE terminal integer; h record;
BEGIN
 terminal:=case_closure_source_terminal_version(target_case,target_department,target_finish,finish_version);
 SELECT * INTO h FROM "case_closures" WHERE "case_id"=target_case AND "department_id"=target_department;
 IF h."id" IS NULL THEN
  IF EXISTS (SELECT 1 FROM "case_archives" WHERE "case_id"=target_case AND "department_id"=target_department) THEN RAISE EXCEPTION 'archive without closure' USING ERRCODE='23514'; END IF;
  RETURN terminal;
 END IF;
 RETURN case_archive_terminal_version(target_case,target_department,h."id",h."current_version_id",terminal);
END; $function$;

CREATE OR REPLACE FUNCTION "check_case_closure_actor"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE c record;
BEGIN
 SELECT * INTO c FROM "cases" WHERE "id"=NEW."case_id" AND "department_id"=NEW."department_id" FOR UPDATE;
 IF c."id" IS NULL OR c."stage"<>'WAITING_ARCHIVE' OR c."version"<>NEW."from_version" OR NEW."close_at">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date OR
  NOT case_closure_actor_authorized(NEW."recorded_by_user_id",NEW."case_id",NEW."department_id",NEW."kind"='CORRECT')
 THEN RAISE EXCEPTION 'closure actor forbidden' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION "check_case_closure_document"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE selected jsonb;
BEGIN
 SELECT a."details"->'closeContentVersionIds' INTO selected FROM "case_closure_versions" v JOIN "audit_events" a ON a."id"=v."audit_event_id" WHERE v."id"=NEW."closure_version_id" AND v."case_id"=NEW."case_id" AND v."department_id"=NEW."department_id" FOR UPDATE OF v;
 IF jsonb_typeof(selected) IS DISTINCT FROM 'array' OR NOT selected ? NEW."content_version_id"::text OR
  EXISTS (SELECT 1 FROM "case_closure_receipts" r WHERE r."result_snapshot"->>'closureVersionId'=NEW."closure_version_id"::text) OR
  NOT EXISTS (SELECT 1 FROM "materials" m JOIN "content_versions" v ON v."material_id"=m."id" WHERE m."id"=NEW."material_id" AND v."id"=NEW."content_version_id" AND
   m."owner_type"='CASE' AND m."owner_id"=NEW."case_id" AND m."department_id"=NEW."department_id" AND m."status"='ACTIVE' AND v."status"='AVAILABLE' AND
   m."category"='CASE_CLOSURE_DOCUMENT' AND m."purpose"='CASE_CLOSURE_DOCUMENT' AND
   (m."current_version_id"=v."id" OR EXISTS (SELECT 1 FROM "case_closure_documents" prior WHERE prior."case_id"=NEW."case_id" AND prior."department_id"=NEW."department_id" AND prior."material_id"=m."id" AND prior."content_version_id"=v."id")) AND
   v."mime_type" IN ('application/pdf','image/jpeg','image/png') AND v."size_bytes"<=52428800)
 THEN RAISE EXCEPTION 'closure document version mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION "case_archive_terminal_version"(target_case uuid, target_department uuid, target_closure uuid, target_closure_version uuid, closure_version integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE h record; v record; terminal integer:=closure_version; expected_prior uuid; seen integer:=0;
BEGIN
 SELECT * INTO h FROM "case_archives" WHERE "case_id"=target_case AND "department_id"=target_department;
 IF h."id" IS NULL THEN RETURN closure_version; END IF;
 IF h."closure_id" IS DISTINCT FROM target_closure OR h."closure_version_id" IS DISTINCT FROM target_closure_version OR h."current_version_id" IS NULL THEN RAISE EXCEPTION 'invalid archive anchor' USING ERRCODE='23514'; END IF;
 FOR v IN SELECT * FROM "case_archive_versions" WHERE "archive_id"=h."id" AND "case_id"=target_case AND "department_id"=target_department ORDER BY "from_version" LOOP
  IF v."closure_version_id"<>target_closure_version OR v."from_version"<>terminal OR v."to_version"<>terminal+1 OR v."prior_version_id" IS DISTINCT FROM expected_prior OR
    (seen=0 AND v."kind"<>'ARCHIVE') OR (seen>0 AND v."kind"<>'CORRECT') THEN RAISE EXCEPTION 'broken archive chain' USING ERRCODE='23514'; END IF;
  terminal:=v."to_version"; expected_prior:=v."id"; seen:=seen+1;
 END LOOP;
 IF seen=0 OR expected_prior IS DISTINCT FROM h."current_version_id" THEN RAISE EXCEPTION 'nonterminal archive head' USING ERRCODE='23514'; END IF;
 RETURN terminal;
END; $function$;

CREATE OR REPLACE FUNCTION "check_case_archive_head_mutation"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF TG_OP='DELETE' OR NEW."id"<>OLD."id" OR NEW."case_id"<>OLD."case_id" OR NEW."department_id"<>OLD."department_id" OR NEW."closure_id"<>OLD."closure_id" OR NEW."closure_version_id"<>OLD."closure_version_id" OR NEW."current_version_id" IS NULL OR
  NOT EXISTS (SELECT 1 FROM "case_archive_versions" v WHERE v."id"=NEW."current_version_id" AND v."archive_id"=OLD."id" AND v."case_id"=OLD."case_id" AND v."department_id"=OLD."department_id" AND v."closure_version_id"=OLD."closure_version_id" AND v."prior_version_id" IS NOT DISTINCT FROM OLD."current_version_id")
 THEN RAISE EXCEPTION 'immutable archive identity or invalid head advance' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION "check_case_archive_receipt"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v record; h record;
BEGIN
 SELECT * INTO v FROM "case_archive_versions" WHERE "id"=(NEW."result_snapshot"->>'archiveVersionId')::uuid AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id" AND "recorded_by_user_id"=NEW."actor_user_id";
 SELECT * INTO h FROM "case_archives" WHERE "id"=v."archive_id";
 IF v."id" IS NULL OR jsonb_typeof(NEW."result_snapshot") IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(NEW."result_snapshot"))<>8 OR
  NOT NEW."result_snapshot" ?& ARRAY['id','archiveId','archiveVersionId','closureId','closureVersionId','stage','version','recordedAt'] OR
  NEW."result_snapshot"->>'id' IS DISTINCT FROM NEW."case_id"::text OR NEW."result_snapshot"->>'archiveId' IS DISTINCT FROM h."id"::text OR
  NEW."result_snapshot"->>'closureId' IS DISTINCT FROM h."closure_id"::text OR NEW."result_snapshot"->>'closureVersionId' IS DISTINCT FROM h."closure_version_id"::text OR
  NEW."result_snapshot"->>'stage' IS DISTINCT FROM 'ARCHIVED' OR jsonb_typeof(NEW."result_snapshot"->'version') IS DISTINCT FROM 'number' OR
  NEW."result_snapshot"->>'version' IS DISTINCT FROM v."to_version"::text OR
  NEW."result_snapshot"->>'recordedAt' IS DISTINCT FROM to_char(v."recorded_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') OR
  NEW."command"::text IS DISTINCT FROM v."kind"::text OR
  NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id" AND c."stage"='ARCHIVED' AND c."version"=v."to_version" AND h."current_version_id"=v."id")
 THEN RAISE EXCEPTION 'archive receipt mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $function$;

-- Exact 150 frozen version bodies and actor bodies with narrow external checks.
CREATE OR REPLACE FUNCTION "check_case_execution_submission_version"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE selected jsonb; fact_audit uuid;
BEGIN
  SELECT s."audit_event_id", a."details"->'executionApplicationContentVersionIds' INTO fact_audit, selected
    FROM "case_execution_submissions" s JOIN "audit_events" a ON a."id" = s."audit_event_id"
    WHERE s."id" = NEW."submission_id" AND s."case_id" = NEW."case_id"
      AND s."department_id" = NEW."department_id" FOR UPDATE OF s;
  IF fact_audit IS NULL OR jsonb_typeof(selected) IS DISTINCT FROM 'array' OR
     NOT selected ? NEW."content_version_id"::text OR NOT EXISTS (
       SELECT 1 FROM "materials" m JOIN "content_versions" v ON v."material_id" = m."id"
       WHERE m."id" = NEW."material_id" AND v."id" = NEW."content_version_id"
         AND m."department_id" = NEW."department_id" AND m."owner_type" = 'CASE'
         AND m."owner_id" = NEW."case_id" AND m."category" = 'EXECUTION_APPLICATION'
         AND m."purpose" = 'EXECUTION_APPLICATION' AND m."status" = 'ACTIVE' AND v."status" = 'AVAILABLE'
         AND v."mime_type" IN ('application/pdf','application/msword',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
         AND v."size_bytes" <= 52428800
         AND (m."current_version_id" = v."id" OR EXISTS (
           SELECT 1 FROM "case_execution_submission_versions" prior_v
           WHERE prior_v."case_id" = NEW."case_id" AND prior_v."department_id" = NEW."department_id"
             AND prior_v."material_id" = m."id" AND prior_v."content_version_id" = v."id"))) THEN
    RAISE EXCEPTION 'execution frozen version mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION "check_case_execution_mailing_version"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE selected jsonb;
BEGIN
  SELECT a."details"->'mailReceiptContentVersionIds' INTO selected
    FROM "case_execution_mailings" m JOIN "audit_events" a ON a."id"=m."audit_event_id"
    WHERE m."id"=NEW."mailing_id" AND m."case_id"=NEW."case_id" AND m."department_id"=NEW."department_id" FOR UPDATE OF m;
  IF jsonb_typeof(selected) IS DISTINCT FROM 'array' OR NOT selected ? NEW."content_version_id"::text OR
     NOT EXISTS (SELECT 1 FROM "materials" mat JOIN "content_versions" v ON v."material_id"=mat."id"
       WHERE mat."id"=NEW."material_id" AND v."id"=NEW."content_version_id"
         AND mat."department_id"=NEW."department_id" AND mat."owner_type"='CASE' AND mat."owner_id"=NEW."case_id"
         AND mat."category"='MAIL_RECEIPT' AND mat."purpose"='MAIL_RECEIPT' AND mat."status"='ACTIVE'
         AND v."status"='AVAILABLE' AND v."mime_type" IN ('application/pdf','image/jpeg','image/png')
         AND v."size_bytes"<=20971520 AND mat."current_version_id"=v."id") OR
     EXISTS (SELECT 1 FROM "case_execution_mailings" m JOIN "content_versions" v ON v."id"=NEW."content_version_id"
       WHERE m."id"=NEW."mailing_id" AND m."actor_type"='CLIENT' AND
         (v."uploaded_by"<>m."recorded_by_user_id" OR EXISTS (
           SELECT 1 FROM "material_references" r WHERE r."material_id"=NEW."material_id"
             AND r."content_version_id"=NEW."content_version_id" AND r."action_event_id" IS NOT NULL
             AND r."action_event_id"<>m."audit_event_id"))) THEN
    RAISE EXCEPTION 'execution mailing frozen version mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION "check_case_execution_filing_version"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE selected jsonb;
BEGIN
  SELECT a."details"->'executionFilingProofContentVersionIds' INTO selected
    FROM "case_execution_filings" f JOIN "audit_events" a ON a."id"=f."audit_event_id"
    WHERE f."id"=NEW."filing_id" AND f."case_id"=NEW."case_id" AND f."department_id"=NEW."department_id" FOR UPDATE OF f;
  IF jsonb_typeof(selected) IS DISTINCT FROM 'array' OR NOT selected ? NEW."content_version_id"::text OR
     NOT EXISTS (SELECT 1 FROM "materials" mat JOIN "content_versions" v ON v."material_id"=mat."id"
       WHERE mat."id"=NEW."material_id" AND v."id"=NEW."content_version_id"
         AND mat."department_id"=NEW."department_id" AND mat."owner_type"='CASE' AND mat."owner_id"=NEW."case_id"
         AND mat."category"='EXECUTION_FILING_PROOF' AND mat."purpose"='EXECUTION_FILING_PROOF'
         AND mat."status"='ACTIVE' AND v."status"='AVAILABLE'
         AND v."mime_type" IN ('application/pdf','image/jpeg','image/png') AND v."size_bytes"<=52428800
         AND mat."current_version_id"=v."id") THEN
    RAISE EXCEPTION 'execution filing frozen version mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION "check_case_execution_finish_version"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE selected jsonb;
BEGIN
  SELECT a."details"->'basisContentVersionIds' INTO selected
    FROM "case_execution_finishes" f JOIN "audit_events" a ON a."id"=f."audit_event_id"
    WHERE f."id"=NEW."finish_id" AND f."case_id"=NEW."case_id" AND f."department_id"=NEW."department_id" FOR UPDATE OF f;
  IF EXISTS (SELECT 1 FROM "case_execution_finish_receipts" r WHERE r."case_id"=NEW."case_id" AND r."department_id"=NEW."department_id") OR jsonb_typeof(selected) IS DISTINCT FROM 'array' OR NOT selected ? NEW."content_version_id"::text OR
     NOT EXISTS (SELECT 1 FROM "materials" mat JOIN "content_versions" v ON v."material_id"=mat."id"
       WHERE mat."id"=NEW."material_id" AND v."id"=NEW."content_version_id"
         AND mat."department_id"=NEW."department_id" AND mat."owner_type"='CASE' AND mat."owner_id"=NEW."case_id"
         AND mat."category"='EXECUTION_FINISH_BASIS' AND mat."purpose"='EXECUTION_FINISH_BASIS'
         AND mat."status"='ACTIVE' AND v."status"='AVAILABLE'
         AND v."mime_type" IN ('application/pdf','image/jpeg','image/png') AND v."size_bytes"<=52428800
         AND mat."current_version_id"=v."id") THEN
    RAISE EXCEPTION 'execution filing frozen version mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION "check_case_execution_mailing_actor"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."external_entry_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "cases" c JOIN "case_external_entries" e ON e."case_id"=c."id" AND e."department_id"=c."department_id"
    WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id" AND e."id"=NEW."external_entry_id"
      AND c."source_lead_id" IS NULL AND c."source_notary_matter_id" IS NULL AND c."certificate_id" IS NULL
      AND c."stage"='WAITING_EXECUTION_STAMP' AND c."version"=NEW."from_version" AND
      ((NEW."confirmation_id" IS NOT NULL AND EXISTS (SELECT 1 FROM "case_execution_confirmations" q
         WHERE q."id"=NEW."confirmation_id" AND q."case_id"=c."id" AND q."department_id"=c."department_id"
           AND q."external_entry_id"=e."id" AND q."to_version"=NEW."from_version")) OR
       (NEW."confirmation_id" IS NULL AND e."initial_stage"='WAITING_EXECUTION_STAMP' AND NEW."from_version"=1 AND
         NOT EXISTS (SELECT 1 FROM "case_execution_confirmations" q WHERE q."case_id"=c."id" AND q."department_id"=c."department_id") AND
         NOT EXISTS (SELECT 1 FROM "case_execution_submissions" s WHERE s."case_id"=c."id" AND s."department_id"=c."department_id")))
  ) THEN RAISE EXCEPTION 'external execution mailing source forbidden' USING ERRCODE='23514'; END IF;

  IF NEW."mailed_at">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date OR
    NOT EXISTS (SELECT 1 FROM "user_accounts" u WHERE u."id"=NEW."recorded_by_user_id"
      AND u."account_type"=NEW."actor_type" AND u."active") OR
    (NEW."actor_type"='CLIENT' AND NOT EXISTS (
      SELECT 1 FROM "customer_account_bindings" b JOIN "cases" c ON c."id"=NEW."case_id" AND c."department_id"=NEW."department_id"
      WHERE b."id"=NEW."customer_account_binding_id" AND b."user_id"=NEW."recorded_by_user_id"
        AND b."department_id"=NEW."department_id" AND b."customer_id"=c."customer_id" AND b."active")) OR
    (NEW."actor_type"='LAWYER' AND NOT EXISTS (
      SELECT 1 FROM "lawyer_account_bindings" b JOIN "case_lawyer_assignments" la
        ON la."lawyer_id"=b."profile_id" AND la."department_id"=b."department_id"
      WHERE b."id"=NEW."lawyer_account_binding_id" AND b."user_id"=NEW."recorded_by_user_id"
        AND b."department_id"=NEW."department_id" AND b."active" AND la."case_id"=NEW."case_id"
        AND la."role"='PRIMARY' AND la."ended_at" IS NULL)) THEN
    RAISE EXCEPTION 'execution mailing actor path mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION "check_case_execution_filing_actor"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."external_entry_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "cases" c JOIN "case_external_entries" e ON e."case_id"=c."id" AND e."department_id"=c."department_id"
    WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id" AND e."id"=NEW."external_entry_id"
      AND c."source_lead_id" IS NULL AND c."source_notary_matter_id" IS NULL AND c."certificate_id" IS NULL
      AND c."stage"='WAITING_EXECUTION_FILING' AND c."version"=NEW."from_version" AND
      ((NEW."mailing_id" IS NOT NULL AND EXISTS (SELECT 1 FROM "case_execution_mailings" m
         WHERE m."id"=NEW."mailing_id" AND m."case_id"=c."id" AND m."department_id"=c."department_id"
           AND m."external_entry_id"=e."id" AND m."to_version"=NEW."from_version")) OR
       (NEW."mailing_id" IS NULL AND e."initial_stage"='WAITING_EXECUTION_FILING' AND NEW."from_version"=1 AND
         NOT EXISTS (SELECT 1 FROM "case_execution_mailings" m WHERE m."case_id"=c."id" AND m."department_id"=c."department_id") AND
         NOT EXISTS (SELECT 1 FROM "case_execution_confirmations" q WHERE q."case_id"=c."id" AND q."department_id"=c."department_id") AND
         NOT EXISTS (SELECT 1 FROM "case_execution_submissions" s WHERE s."case_id"=c."id" AND s."department_id"=c."department_id")))
  ) THEN RAISE EXCEPTION 'external execution filing source forbidden' USING ERRCODE='23514'; END IF;

  IF NEW."submitted_at">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date OR
    NOT EXISTS (SELECT 1 FROM "user_accounts" u WHERE u."id"=NEW."submitted_by_user_id" AND u."active"
    AND (u."account_type"='INTERNAL' OR (u."account_type"='LAWYER' AND EXISTS
      (SELECT 1 FROM "lawyer_account_bindings" b JOIN "case_lawyer_assignments" la
        ON la."lawyer_id"=b."profile_id" AND la."department_id"=b."department_id"
        WHERE b."user_id"=u."id" AND b."department_id"=NEW."department_id" AND b."active"
          AND la."case_id"=NEW."case_id" AND la."role"='PRIMARY' AND la."ended_at" IS NULL)))) THEN
    RAISE EXCEPTION 'execution filing actor path mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION "check_case_execution_finish_actor"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."external_entry_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "cases" c JOIN "case_external_entries" e ON e."case_id"=c."id" AND e."department_id"=c."department_id"
    WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id" AND e."id"=NEW."external_entry_id"
      AND c."source_lead_id" IS NULL AND c."source_notary_matter_id" IS NULL AND c."certificate_id" IS NULL
      AND c."stage"='EXECUTING' AND c."version"=NEW."from_version" AND
      ((NEW."filing_id" IS NOT NULL AND EXISTS (SELECT 1 FROM "case_execution_filings" f
         WHERE f."id"=NEW."filing_id" AND f."case_id"=c."id" AND f."department_id"=c."department_id"
           AND f."external_entry_id"=e."id" AND f."to_version"=NEW."from_version")) OR
       (NEW."filing_id" IS NULL AND e."initial_stage"='EXECUTING' AND NEW."from_version"=1 AND
         NOT EXISTS (SELECT 1 FROM "case_execution_filings" f WHERE f."case_id"=c."id" AND f."department_id"=c."department_id") AND
         NOT EXISTS (SELECT 1 FROM "case_execution_mailings" m WHERE m."case_id"=c."id" AND m."department_id"=c."department_id") AND
         NOT EXISTS (SELECT 1 FROM "case_execution_confirmations" q WHERE q."case_id"=c."id" AND q."department_id"=c."department_id") AND
         NOT EXISTS (SELECT 1 FROM "case_execution_submissions" s WHERE s."case_id"=c."id" AND s."department_id"=c."department_id")))
  ) THEN RAISE EXCEPTION 'external execution finish source forbidden' USING ERRCODE='23514'; END IF;

  IF NEW."finished_at">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date OR
    NOT EXISTS (SELECT 1 FROM "user_accounts" u WHERE u."id"=NEW."recorded_by_user_id" AND u."active"
    AND (u."account_type"='INTERNAL' OR (u."account_type"='LAWYER' AND EXISTS
      (SELECT 1 FROM "lawyer_account_bindings" b JOIN "case_lawyer_assignments" la
        ON la."lawyer_id"=b."profile_id" AND la."department_id"=b."department_id"
        WHERE b."user_id"=u."id" AND b."department_id"=NEW."department_id" AND b."active"
          AND la."case_id"=NEW."case_id" AND la."role"='PRIMARY' AND la."ended_at" IS NULL)))) THEN
    RAISE EXCEPTION 'execution filing actor path mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $function$;

-- Five complete static execution final functions with exact external roots.
CREATE OR REPLACE FUNCTION "check_case_execution_submission_final"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; c record; e record; prior record; choice_record record;
        result_record record; selected jsonb; expected_source_version integer; entry_root record;
BEGIN
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id" = target_case AND "department_id" = target_department;
  SELECT * INTO entry_root FROM "case_external_entries" WHERE "case_id"=target_case AND "department_id"=target_department;
  SELECT * INTO e FROM "case_execution_submissions" WHERE "id" = c."current_execution_submission_id"
    AND "case_id" = target_case AND "department_id" = target_department;
  IF c."current_execution_submission_id" IS NULL AND entry_root."id" IS NOT NULL AND c."stage"='WAITING_EXECUTION_CONFIRMATION' THEN
    PERFORM ca018_assert_execution_phase_chain(target_case,target_department);
    RETURN NEW;
  END IF;
  IF c."current_execution_submission_id" IS NULL THEN
    IF c."stage" = 'WAITING_EXECUTION_CONFIRMATION' OR EXISTS (
      SELECT 1 FROM "case_execution_submissions" x WHERE x."case_id" = target_case
        AND x."department_id" = target_department AND x."trial_round_id" = c."current_trial_round_id") THEN
      RAISE EXCEPTION 'execution confirmation has no head' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF e."id" IS NULL OR NOT ((c."stage" = 'WAITING_EXECUTION_CONFIRMATION' AND c."version" = e."to_version" AND NOT EXISTS (
  SELECT 1 FROM "case_execution_confirmations" f WHERE f."case_id" = target_case AND f."department_id" = target_department)) OR
  (c."stage" IN ('WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED') AND EXISTS (
    SELECT 1 FROM "case_execution_confirmations" f WHERE f."case_id" = target_case AND f."department_id" = target_department
      AND f."submission_id" = e."id" AND f."from_version" = e."to_version" AND ((c."stage" = 'WAITING_EXECUTION_STAMP' AND f."to_version" = c."version" AND NOT EXISTS (SELECT 1 FROM "case_execution_mailings" mm WHERE mm."case_id"=target_case AND mm."department_id"=target_department)) OR
 (c."stage" = 'WAITING_EXECUTION_FILING' AND EXISTS (SELECT 1 FROM "case_execution_mailings" mm WHERE mm."case_id"=target_case AND mm."department_id"=target_department AND mm."confirmation_id"=f."id" AND mm."from_version"=f."to_version" AND mm."to_version"=c."version") AND NOT EXISTS (SELECT 1 FROM "case_execution_filings" ff WHERE ff."case_id"=target_case AND ff."department_id"=target_department)) OR
 (c."stage" IN ('EXECUTING','WAITING_ARCHIVE','ARCHIVED') AND EXISTS (SELECT 1 FROM "case_execution_mailings" mm JOIN "case_execution_filings" ff ON ff."mailing_id"=mm."id" AND ff."case_id"=mm."case_id" AND ff."department_id"=mm."department_id" WHERE mm."case_id"=target_case AND mm."department_id"=target_department AND mm."confirmation_id"=f."id" AND mm."from_version"=f."to_version" AND ff."from_version"=mm."to_version" AND ((c."stage"='EXECUTING' AND ff."to_version"=c."version" AND NOT EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department)) OR
 (c."stage" IN ('WAITING_ARCHIVE','ARCHIVED') AND EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department AND ef."filing_id"=ff."id" AND ef."from_version"=ff."to_version" AND case_closure_terminal_version(target_case,target_department,ef."id",ef."to_version")=c."version"))))))))) OR
       c."current_trial_round_id" IS DISTINCT FROM e."trial_round_id" OR
       c."current_judgment_next_step_id" IS DISTINCT FROM e."judgment_next_step_id" OR
       c."current_second_instance_result_id" IS DISTINCT FROM e."second_instance_result_id" OR
       e."id" IS DISTINCT FROM (SELECT x."id" FROM "case_execution_submissions" x
         WHERE x."case_id" = target_case AND x."department_id" = target_department
           AND x."trial_round_id" = e."trial_round_id" ORDER BY x."to_version" DESC LIMIT 1) THEN
      RAISE EXCEPTION 'execution head stage/version/source mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'case_execution_submissions' THEN
    IF EXISTS (SELECT 1 FROM "case_execution_confirmations" f WHERE f."case_id" = target_case AND f."department_id" = target_department) THEN
      RAISE EXCEPTION 'execution confirmation blocks resubmission' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO e FROM "case_execution_submissions" WHERE "id" = NEW."id";
    SELECT * INTO choice_record FROM "case_judgment_next_steps" s WHERE s."id" = e."judgment_next_step_id"
      AND s."case_id" = target_case AND s."department_id" = target_department
      AND s."trial_round_id" = e."trial_round_id" AND NOT EXISTS
        (SELECT 1 FROM "case_judgment_next_step_revocations" r WHERE r."choice_id" = s."id");
    IF choice_record."id" IS NULL THEN
      IF e."judgment_next_step_id" IS NOT NULL OR entry_root."id" IS NULL OR
         e."external_entry_id" IS DISTINCT FROM entry_root."id" OR
         c."source_lead_id" IS NOT NULL OR c."source_notary_matter_id" IS NOT NULL OR c."certificate_id" IS NOT NULL THEN
        RAISE EXCEPTION 'execution choice source missing' USING ERRCODE='23514'; END IF;
      IF entry_root."initial_stage"='WAITING_EXECUTION_DOCUMENTS' THEN
        IF e."second_instance_result_id" IS NOT NULL OR (e."prior_submission_id" IS NULL AND e."from_version" IS DISTINCT FROM 1) OR
           EXISTS (SELECT 1 FROM "case_second_instance_results" x WHERE x."case_id"=target_case AND x."department_id"=target_department)
        THEN RAISE EXCEPTION 'execution entry document seed mismatch' USING ERRCODE='23514'; END IF;
      ELSIF entry_root."initial_stage"='SECOND_INSTANCE' THEN
        SELECT * INTO result_record FROM "case_second_instance_results" r
         WHERE r."id"=e."second_instance_result_id" AND r."case_id"=target_case AND r."department_id"=target_department
           AND r."trial_round_id"=e."trial_round_id" AND r."choice_id" IS NULL AND
           r."external_entry_id"=entry_root."id" AND r."result" IN ('AFFIRM','CHANGE') AND
           NOT EXISTS (SELECT 1 FROM "case_second_instance_result_revocations" x WHERE x."result_id"=r."id");
        IF result_record."id" IS NULL OR result_record."id" IS DISTINCT FROM c."current_second_instance_result_id" OR
           (e."prior_submission_id" IS NULL AND e."from_version" IS DISTINCT FROM result_record."to_version")
        THEN RAISE EXCEPTION 'execution direct appeal result mismatch' USING ERRCODE='23514'; END IF;
      ELSE RAISE EXCEPTION 'execution choice source missing' USING ERRCODE='23514'; END IF;
      expected_source_version:=e."from_version";
    ELSIF choice_record."next" = 'EXECUTION' THEN
      IF e."second_instance_result_id" IS NOT NULL THEN
        RAISE EXCEPTION 'direct execution cannot have appeal result' USING ERRCODE = '23514';
      END IF;
      expected_source_version := choice_record."to_version";
    ELSE
      SELECT * INTO result_record FROM "case_second_instance_results" r WHERE r."id" = e."second_instance_result_id"
        AND r."case_id" = target_case AND r."department_id" = target_department
        AND r."trial_round_id" = e."trial_round_id" AND r."choice_id" = e."judgment_next_step_id"
        AND r."result" IN ('AFFIRM','CHANGE') AND NOT EXISTS
          (SELECT 1 FROM "case_second_instance_result_revocations" v WHERE v."result_id" = r."id");
      IF choice_record."next" <> 'APPEAL' OR result_record."id" IS NULL THEN
        RAISE EXCEPTION 'execution appeal result source missing' USING ERRCODE = '23514';
      END IF;
      expected_source_version := result_record."to_version";
    END IF;
    SELECT * INTO prior FROM "case_execution_submissions" WHERE "id" = e."prior_submission_id"
      AND "case_id" = target_case AND "department_id" = target_department;
    IF (e."prior_submission_id" IS NULL AND (e."change_reason" IS NOT NULL OR
         e."from_version" <> expected_source_version)) OR
       (e."prior_submission_id" IS NOT NULL AND (prior."id" IS NULL OR
         prior."id" = e."id" OR prior."to_version" <> e."from_version" OR
         prior."trial_round_id" <> e."trial_round_id" OR
         prior."external_entry_id" IS DISTINCT FROM e."external_entry_id" OR
         prior."judgment_next_step_id" IS DISTINCT FROM e."judgment_next_step_id" OR
         prior."second_instance_result_id" IS DISTINCT FROM e."second_instance_result_id" OR
         NULLIF(btrim(e."change_reason"), '') IS NULL OR
         prior."id" IS DISTINCT FROM (SELECT x."id" FROM "case_execution_submissions" x
           WHERE x."case_id" = target_case AND x."department_id" = target_department
             AND x."trial_round_id" = e."trial_round_id" AND x."id" <> e."id"
           ORDER BY x."to_version" DESC LIMIT 1) OR
         (SELECT array_agg(x."content_version_id" ORDER BY x."content_version_id")
           FROM "case_execution_submission_versions" x WHERE x."submission_id" = prior."id") IS NOT DISTINCT FROM
         (SELECT array_agg(x."content_version_id" ORDER BY x."content_version_id")
           FROM "case_execution_submission_versions" x WHERE x."submission_id" = e."id"))) THEN
      RAISE EXCEPTION 'execution submission version, predecessor or change mismatch' USING ERRCODE = '23514';
    END IF;
    SELECT a."details"->'executionApplicationContentVersionIds' INTO selected FROM "audit_events" a
      WHERE a."id" = e."audit_event_id" AND a."department_id" = target_department
        AND a."resource_type" = 'CASE' AND a."resource_id" = target_case
        AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = e."submitted_by_user_id"
        AND a."action" = 'case.execution.submitted'
        AND a."details"->>'submissionId' = e."id"::text
        AND a."details"->>'trialRoundId' = e."trial_round_id"::text
        AND a."details"->'judgmentNextStepId' IS NOT DISTINCT FROM COALESCE(to_jsonb(e."judgment_next_step_id"),'null'::jsonb)
        AND a."details"->>'secondInstanceResultId' IS NOT DISTINCT FROM e."second_instance_result_id"::text
        AND a."details"->>'priorSubmissionId' IS NOT DISTINCT FROM e."prior_submission_id"::text
        AND a."details"->>'changeReason' IS NOT DISTINCT FROM e."change_reason"
        AND a."details"->>'fromVersion' = e."from_version"::text
        AND a."details"->>'toVersion' = e."to_version"::text;
    IF jsonb_typeof(selected) IS DISTINCT FROM 'array' OR jsonb_array_length(selected) NOT BETWEEN 1 AND 10 OR
       (SELECT count(*) FROM "case_execution_submission_versions" v WHERE v."submission_id" = e."id") <> jsonb_array_length(selected) OR
       EXISTS (SELECT 1 FROM "case_execution_submission_versions" v WHERE v."submission_id" = e."id"
         AND NOT selected ? v."content_version_id"::text) OR
       NOT EXISTS (SELECT 1 FROM "case_execution_submission_receipts" r WHERE r."case_id" = target_case
         AND r."department_id" = target_department AND r."actor_user_id" = e."submitted_by_user_id"
         AND r."result_snapshot"->>'submissionId' = e."id"::text) THEN
      RAISE EXCEPTION 'execution audit, frozen set or receipt mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION "check_case_execution_confirmation_final"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; c record; f record; s record; a record; entry_root record;
BEGIN
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id" = target_case AND "department_id" = target_department;
  SELECT * INTO entry_root FROM "case_external_entries" WHERE "case_id"=target_case AND "department_id"=target_department;
  SELECT * INTO f FROM "case_execution_confirmations" WHERE "case_id" = target_case AND "department_id" = target_department;
  IF f."id" IS NULL AND entry_root."id" IS NOT NULL AND c."stage" IN ('WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED') THEN
    PERFORM ca018_assert_execution_phase_chain(target_case,target_department);
    RETURN NEW;
  END IF;
  IF f."id" IS NULL THEN
    IF c."stage" IN ('WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED') THEN
      RAISE EXCEPTION 'execution stamp has no confirmation' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO s FROM "case_execution_submissions" WHERE "id" = f."submission_id"
    AND "case_id" = target_case AND "department_id" = target_department;
  SELECT * INTO a FROM "audit_events" WHERE "id" = f."audit_event_id";
  IF NOT (s."id" IS NOT NULL OR (f."submission_id" IS NULL AND entry_root."initial_stage"='WAITING_EXECUTION_CONFIRMATION' AND
     f."external_entry_id" IS NOT DISTINCT FROM entry_root."id" AND entry_root."id" IS NOT NULL AND
     c."source_lead_id" IS NULL AND c."source_notary_matter_id" IS NULL AND c."certificate_id" IS NULL AND
     c."current_execution_submission_id" IS NULL AND c."current_judgment_next_step_id" IS NULL AND
     c."current_second_instance_result_id" IS NULL AND
     NOT EXISTS (SELECT 1 FROM "case_execution_submissions" x WHERE x."case_id"=target_case AND x."department_id"=target_department))) OR
     c."current_execution_submission_id" IS DISTINCT FROM s."id" OR
     NOT ((c."stage" = 'WAITING_EXECUTION_STAMP' AND c."version" = f."to_version" AND NOT EXISTS (SELECT 1 FROM "case_execution_mailings" mm WHERE mm."case_id"=target_case AND mm."department_id"=target_department)) OR
 (c."stage" = 'WAITING_EXECUTION_FILING' AND EXISTS (SELECT 1 FROM "case_execution_mailings" mm WHERE mm."case_id"=target_case AND mm."department_id"=target_department AND mm."confirmation_id"=f."id" AND mm."from_version"=f."to_version" AND mm."to_version"=c."version") AND NOT EXISTS (SELECT 1 FROM "case_execution_filings" ff WHERE ff."case_id"=target_case AND ff."department_id"=target_department)) OR
 (c."stage" IN ('EXECUTING','WAITING_ARCHIVE','ARCHIVED') AND EXISTS (SELECT 1 FROM "case_execution_mailings" mm JOIN "case_execution_filings" ff ON ff."mailing_id"=mm."id" AND ff."case_id"=mm."case_id" AND ff."department_id"=mm."department_id" WHERE mm."case_id"=target_case AND mm."department_id"=target_department AND mm."confirmation_id"=f."id" AND mm."from_version"=f."to_version" AND ff."from_version"=mm."to_version" AND ((c."stage"='EXECUTING' AND ff."to_version"=c."version" AND NOT EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department)) OR
 (c."stage" IN ('WAITING_ARCHIVE','ARCHIVED') AND EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department AND ef."filing_id"=ff."id" AND ef."from_version"=ff."to_version" AND case_closure_terminal_version(target_case,target_department,ef."id",ef."to_version")=c."version")))))) OR
     f."from_version" <> COALESCE(s."to_version",1) OR f."to_version" <> f."from_version" + 1 OR
     (s."id" IS NOT NULL AND c."current_trial_round_id" IS DISTINCT FROM s."trial_round_id") OR
     (s."id" IS NOT NULL AND c."current_judgment_next_step_id" IS DISTINCT FROM s."judgment_next_step_id") OR
     (s."id" IS NOT NULL AND c."current_second_instance_result_id" IS DISTINCT FROM s."second_instance_result_id") OR
     (s."id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "case_execution_submission_versions" v WHERE v."submission_id" = s."id")) OR
     (s."id" IS NULL AND (SELECT count(*) FROM "case_execution_confirmation_versions" v WHERE v."confirmation_id"=f."id") NOT BETWEEN 1 AND 10) OR
     s."id" IS DISTINCT FROM (SELECT x."id" FROM "case_execution_submissions" x
       WHERE x."case_id" = target_case AND x."department_id" = target_department ORDER BY x."to_version" DESC LIMIT 1) OR
     a."id" IS NULL OR a."department_id" <> target_department OR a."resource_type" <> 'CASE' OR
     a."resource_id" <> target_case OR a."actor_kind" <> 'HUMAN' OR
     a."actor_user_id" <> f."confirmed_by_user_id" OR a."action" <> 'case.execution.confirmed' OR
     a."details"->>'confirmationId' IS DISTINCT FROM f."id"::text OR
     a."details"->'submissionId' IS DISTINCT FROM COALESCE(to_jsonb(f."submission_id"),'null'::jsonb) OR
     a."details"->>'fromVersion' IS DISTINCT FROM f."from_version"::text OR
     a."details"->>'toVersion' IS DISTINCT FROM f."to_version"::text OR
     NOT EXISTS (SELECT 1 FROM "case_execution_confirmation_receipts" r WHERE r."case_id" = target_case
       AND r."department_id" = target_department AND r."actor_user_id" = f."confirmed_by_user_id"
       AND r."result_snapshot"->>'confirmationId' = f."id"::text) THEN
    RAISE EXCEPTION 'execution confirmation chain mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION "check_case_execution_mailing_final"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; c record; m record; conf record; audit record; selected jsonb; entry_root record;
BEGIN
  IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; target_department:=NEW."department_id";
  ELSE target_case:=NEW."case_id"; target_department:=NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
  SELECT * INTO entry_root FROM "case_external_entries" WHERE "case_id"=target_case AND "department_id"=target_department;
  SELECT * INTO m FROM "case_execution_mailings" WHERE "case_id"=target_case AND "department_id"=target_department;
  IF m."id" IS NULL AND entry_root."id" IS NOT NULL AND c."stage" IN ('WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED') THEN
    PERFORM ca018_assert_execution_phase_chain(target_case,target_department);
    RETURN NEW;
  END IF;
  IF m."id" IS NULL THEN
    IF c."stage" IN ('WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED') THEN
      RAISE EXCEPTION 'execution mailing missing' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO conf FROM "case_execution_confirmations" WHERE "id"=m."confirmation_id"
    AND "case_id"=target_case AND "department_id"=target_department;
  SELECT * INTO audit FROM "audit_events" WHERE "id"=m."audit_event_id";
  selected:=audit."details"->'mailReceiptContentVersionIds';
  IF NOT (conf."id" IS NOT NULL OR (m."confirmation_id" IS NULL AND entry_root."initial_stage"='WAITING_EXECUTION_STAMP' AND
     m."external_entry_id" IS NOT DISTINCT FROM entry_root."id" AND entry_root."id" IS NOT NULL AND
     c."source_lead_id" IS NULL AND c."source_notary_matter_id" IS NULL AND c."certificate_id" IS NULL AND
     c."current_execution_submission_id" IS NULL AND
     NOT EXISTS (SELECT 1 FROM "case_execution_confirmations" x WHERE x."case_id"=target_case AND x."department_id"=target_department) AND
     NOT EXISTS (SELECT 1 FROM "case_execution_submissions" x WHERE x."case_id"=target_case AND x."department_id"=target_department))) OR
     conf."submission_id" IS DISTINCT FROM c."current_execution_submission_id" OR
     m."from_version"<>COALESCE(conf."to_version",1) OR m."to_version"<>m."from_version"+1 OR
     NOT ((c."stage"='WAITING_EXECUTION_FILING' AND c."version"=m."to_version" AND NOT EXISTS
       (SELECT 1 FROM "case_execution_filings" f WHERE f."case_id"=target_case AND f."department_id"=target_department)) OR
       (c."stage" IN ('EXECUTING','WAITING_ARCHIVE','ARCHIVED') AND EXISTS (SELECT 1 FROM "case_execution_filings" f
         WHERE f."case_id"=target_case AND f."department_id"=target_department
           AND f."mailing_id"=m."id" AND f."from_version"=m."to_version" AND ((c."stage"='EXECUTING' AND f."to_version"=c."version" AND NOT EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department)) OR
 (c."stage" IN ('WAITING_ARCHIVE','ARCHIVED') AND EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department AND ef."filing_id"=f."id" AND ef."from_version"=f."to_version" AND case_closure_terminal_version(target_case,target_department,ef."id",ef."to_version")=c."version")))))) OR
     audit."id" IS NULL OR audit."department_id"<>target_department OR audit."resource_type"<>'CASE' OR
     audit."resource_id"<>target_case OR audit."actor_kind"<>'HUMAN' OR
     audit."actor_user_id"<>m."recorded_by_user_id" OR audit."action"<>'case.execution.mailed' OR
     (m."actor_type"='INTERNAL' AND audit."internal_actor_user_id" IS DISTINCT FROM m."recorded_by_user_id") OR
     (m."actor_type"='CLIENT' AND audit."customer_account_binding_id" IS DISTINCT FROM m."customer_account_binding_id") OR
     (m."actor_type"='LAWYER' AND audit."lawyer_account_binding_id" IS DISTINCT FROM m."lawyer_account_binding_id") OR
     audit."details"->>'actorType' IS DISTINCT FROM m."actor_type"::text OR
     audit."details"->>'mailingId' IS DISTINCT FROM m."id"::text OR
     audit."details"->'confirmationId' IS DISTINCT FROM COALESCE(to_jsonb(m."confirmation_id"),'null'::jsonb) OR
     audit."details"->>'fromVersion' IS DISTINCT FROM m."from_version"::text OR
     audit."details"->>'toVersion' IS DISTINCT FROM m."to_version"::text OR
     (audit."details"->>'mailedAt')::date IS DISTINCT FROM m."mailed_at" OR
     jsonb_typeof(selected) IS DISTINCT FROM 'array' OR jsonb_array_length(selected) NOT BETWEEN 1 AND 10 OR
     (SELECT count(*) FROM "case_execution_mailing_versions" v WHERE v."mailing_id"=m."id")<>jsonb_array_length(selected) OR
     EXISTS (SELECT 1 FROM "case_execution_mailing_versions" v WHERE v."mailing_id"=m."id"
       AND NOT selected ? v."content_version_id"::text) OR
     EXISTS (SELECT 1 FROM "case_execution_mailing_versions" v WHERE v."mailing_id"=m."id"
       AND NOT EXISTS (SELECT 1 FROM "material_references" r WHERE r."action_event_id"=m."audit_event_id"
         AND r."resource_type"='case' AND r."resource_id"=target_case AND r."purpose"='MAIL_RECEIPT'
         AND r."material_id"=v."material_id" AND r."content_version_id"=v."content_version_id")) OR
     NOT EXISTS (SELECT 1 FROM "case_execution_mailing_receipts" r WHERE r."case_id"=target_case
       AND r."department_id"=target_department AND r."actor_user_id"=m."recorded_by_user_id"
       AND r."result_snapshot"->>'mailingId'=m."id"::text) THEN
    RAISE EXCEPTION 'execution mailing chain/audit/receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION "check_case_execution_filing_final"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; c record; f record; m record; audit record; selected jsonb; entry_root record;
BEGIN
  IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; target_department:=NEW."department_id";
  ELSE target_case:=NEW."case_id"; target_department:=NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
  SELECT * INTO entry_root FROM "case_external_entries" WHERE "case_id"=target_case AND "department_id"=target_department;
  SELECT * INTO f FROM "case_execution_filings" WHERE "case_id"=target_case AND "department_id"=target_department;
  IF f."id" IS NULL AND entry_root."id" IS NOT NULL AND c."stage" IN ('EXECUTING','WAITING_ARCHIVE','ARCHIVED') THEN
    PERFORM ca018_assert_execution_phase_chain(target_case,target_department);
    RETURN NEW;
  END IF;
  IF f."id" IS NULL THEN
    IF c."stage" IN ('EXECUTING','WAITING_ARCHIVE','ARCHIVED') THEN RAISE EXCEPTION 'execution filing missing' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO m FROM "case_execution_mailings" WHERE "id"=f."mailing_id" AND "case_id"=target_case AND "department_id"=target_department;
  SELECT * INTO audit FROM "audit_events" WHERE "id"=f."audit_event_id";
  selected:=audit."details"->'executionFilingProofContentVersionIds';
  IF NOT (m."id" IS NOT NULL OR (f."mailing_id" IS NULL AND entry_root."initial_stage"='WAITING_EXECUTION_FILING' AND
     f."external_entry_id" IS NOT DISTINCT FROM entry_root."id" AND entry_root."id" IS NOT NULL AND
     c."source_lead_id" IS NULL AND c."source_notary_matter_id" IS NULL AND c."certificate_id" IS NULL AND
     NOT EXISTS (SELECT 1 FROM "case_execution_mailings" x WHERE x."case_id"=target_case AND x."department_id"=target_department) AND
     NOT EXISTS (SELECT 1 FROM "case_execution_confirmations" x WHERE x."case_id"=target_case AND x."department_id"=target_department) AND
     NOT EXISTS (SELECT 1 FROM "case_execution_submissions" x WHERE x."case_id"=target_case AND x."department_id"=target_department))) OR
     m."confirmation_id" IS DISTINCT FROM
       (SELECT x."id" FROM "case_execution_confirmations" x WHERE x."case_id"=target_case AND x."department_id"=target_department) OR
     NOT ((c."stage"='EXECUTING' AND c."version"=f."to_version" AND NOT EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department)) OR
 (c."stage" IN ('WAITING_ARCHIVE','ARCHIVED') AND EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department AND ef."filing_id"=f."id" AND ef."from_version"=f."to_version" AND case_closure_terminal_version(target_case,target_department,ef."id",ef."to_version")=c."version"))) OR
     f."from_version"<>COALESCE(m."to_version",1) OR f."to_version"<>f."from_version"+1 OR
     audit."id" IS NULL OR audit."department_id"<>target_department OR audit."resource_type"<>'CASE' OR
     audit."resource_id"<>target_case OR audit."actor_kind"<>'HUMAN' OR
     audit."actor_user_id"<>f."submitted_by_user_id" OR audit."action"<>'case.execution.filing.submitted' OR
     audit."details"->>'filingId' IS DISTINCT FROM f."id"::text OR
     audit."details"->'mailingId' IS DISTINCT FROM COALESCE(to_jsonb(f."mailing_id"),'null'::jsonb) OR
     audit."details"->>'fromVersion' IS DISTINCT FROM f."from_version"::text OR
     audit."details"->>'toVersion' IS DISTINCT FROM f."to_version"::text OR
     (audit."details"->>'submittedAt')::date IS DISTINCT FROM f."submitted_at" OR
     jsonb_typeof(selected) IS DISTINCT FROM 'array' OR jsonb_array_length(selected) NOT BETWEEN 1 AND 10 OR
     (SELECT count(*) FROM "case_execution_filing_versions" v WHERE v."filing_id"=f."id")<>jsonb_array_length(selected) OR
     EXISTS (SELECT 1 FROM "case_execution_filing_versions" v WHERE v."filing_id"=f."id"
       AND NOT selected ? v."content_version_id"::text) OR
     NOT EXISTS (SELECT 1 FROM "case_execution_filing_receipts" r WHERE r."case_id"=target_case
       AND r."department_id"=target_department AND r."actor_user_id"=f."submitted_by_user_id"
       AND r."result_snapshot"->>'filingId'=f."id"::text) OR
     EXISTS (SELECT 1 FROM "case_execution_filing_versions" v WHERE v."filing_id"=f."id"
       AND NOT EXISTS (SELECT 1 FROM "material_references" r WHERE r."action_event_id"=f."audit_event_id"
         AND r."resource_type"='case' AND r."resource_id"=target_case AND r."purpose"='EXECUTION_FILING_PROOF'
         AND r."material_id"=v."material_id" AND r."content_version_id"=v."content_version_id")) THEN
    RAISE EXCEPTION 'execution filing chain/audit/reference/receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION "check_case_execution_finish_final"()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE target_case uuid; target_department uuid; c record; f record; m record; audit record; selected jsonb; entry_root record;
BEGIN
  IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; target_department:=NEW."department_id";
  ELSE target_case:=NEW."case_id"; target_department:=NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
  SELECT * INTO entry_root FROM "case_external_entries" WHERE "case_id"=target_case AND "department_id"=target_department;
  SELECT * INTO f FROM "case_execution_finishes" WHERE "case_id"=target_case AND "department_id"=target_department;
  IF f."id" IS NULL AND entry_root."id" IS NOT NULL AND c."stage" IN ('WAITING_ARCHIVE','ARCHIVED') THEN
    PERFORM ca018_assert_execution_phase_chain(target_case,target_department);
    RETURN NEW;
  END IF;
  IF f."id" IS NULL THEN
    IF c."stage" IN ('WAITING_ARCHIVE','ARCHIVED') THEN RAISE EXCEPTION 'execution filing missing' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO m FROM "case_execution_filings" WHERE "id"=f."filing_id" AND "case_id"=target_case AND "department_id"=target_department;
  SELECT * INTO audit FROM "audit_events" WHERE "id"=f."audit_event_id";
  selected:=audit."details"->'basisContentVersionIds';
  IF NOT (m."id" IS NOT NULL OR (f."filing_id" IS NULL AND entry_root."initial_stage"='EXECUTING' AND
     f."external_entry_id" IS NOT DISTINCT FROM entry_root."id" AND entry_root."id" IS NOT NULL AND
     c."source_lead_id" IS NULL AND c."source_notary_matter_id" IS NULL AND c."certificate_id" IS NULL AND
     NOT EXISTS (SELECT 1 FROM "case_execution_filings" x WHERE x."case_id"=target_case AND x."department_id"=target_department) AND
     NOT EXISTS (SELECT 1 FROM "case_execution_mailings" x WHERE x."case_id"=target_case AND x."department_id"=target_department) AND
     NOT EXISTS (SELECT 1 FROM "case_execution_confirmations" x WHERE x."case_id"=target_case AND x."department_id"=target_department) AND
     NOT EXISTS (SELECT 1 FROM "case_execution_submissions" x WHERE x."case_id"=target_case AND x."department_id"=target_department))) OR
     m."mailing_id" IS DISTINCT FROM
       (SELECT x."id" FROM "case_execution_mailings" x WHERE x."case_id"=target_case AND x."department_id"=target_department) OR
     c."stage" NOT IN ('WAITING_ARCHIVE','ARCHIVED') OR c."version"<>case_closure_terminal_version(target_case,target_department,f."id",f."to_version") OR
     f."from_version"<>COALESCE(m."to_version",1) OR f."to_version"<>f."from_version"+1 OR
     audit."id" IS NULL OR audit."department_id"<>target_department OR audit."resource_type"<>'CASE' OR
     audit."resource_id"<>target_case OR audit."actor_kind"<>'HUMAN' OR
     audit."actor_user_id"<>f."recorded_by_user_id" OR audit."action"<>'case.execution.finished' OR
     audit."details"->>'finishId' IS DISTINCT FROM f."id"::text OR
     audit."details"->'filingId' IS DISTINCT FROM COALESCE(to_jsonb(f."filing_id"),'null'::jsonb) OR
     audit."details"->>'reason' IS DISTINCT FROM f."reason" OR
     audit."details"->'basisNote' IS DISTINCT FROM COALESCE(to_jsonb(f."basis_note"),'null'::jsonb) OR
     (audit."internal_actor_user_id" IS DISTINCT FROM f."recorded_by_user_id" AND NOT EXISTS
       (SELECT 1 FROM "lawyer_account_bindings" b WHERE b."id"=audit."lawyer_account_binding_id" AND b."user_id"=f."recorded_by_user_id" AND b."department_id"=target_department)) OR
     audit."details"->>'fromVersion' IS DISTINCT FROM f."from_version"::text OR
     audit."details"->>'toVersion' IS DISTINCT FROM f."to_version"::text OR
     (audit."details"->>'finishedAt')::date IS DISTINCT FROM f."finished_at" OR
     jsonb_typeof(selected) IS DISTINCT FROM 'array' OR jsonb_array_length(selected) NOT BETWEEN 0 AND 10 OR
     (f."basis_note" IS NULL AND jsonb_array_length(selected)=0) OR
     (SELECT count(*) FROM "case_execution_finish_versions" v WHERE v."finish_id"=f."id")<>jsonb_array_length(selected) OR
     EXISTS (SELECT 1 FROM "case_execution_finish_versions" v WHERE v."finish_id"=f."id"
       AND NOT selected ? v."content_version_id"::text) OR
     NOT EXISTS (SELECT 1 FROM "case_execution_finish_receipts" r WHERE r."case_id"=target_case
       AND r."department_id"=target_department AND r."actor_user_id"=f."recorded_by_user_id"
       AND r."result_snapshot"->>'finishId'=f."id"::text) OR
     EXISTS (SELECT 1 FROM "case_execution_finish_versions" v WHERE v."finish_id"=f."id"
       AND NOT EXISTS (SELECT 1 FROM "material_references" r WHERE r."action_event_id"=f."audit_event_id"
         AND r."resource_type"='case' AND r."resource_id"=target_case AND r."purpose"='EXECUTION_FINISH_BASIS'
         AND r."material_id"=v."material_id" AND r."content_version_id"=v."content_version_id")) THEN
    RAISE EXCEPTION 'execution filing chain/audit/reference/receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $function$;

COMMIT;
