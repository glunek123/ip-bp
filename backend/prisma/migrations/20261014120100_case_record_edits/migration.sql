BEGIN;

ALTER TABLE "case_defendants" ADD COLUMN "contact_revision" integer NOT NULL DEFAULT 0;
ALTER TABLE "case_defendants" ADD CONSTRAINT "case_defendants_contact_revision_check" CHECK ("contact_revision" >= 0);

CREATE TABLE "case_defendant_contact_changes" (
  "id" uuid PRIMARY KEY,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "defendant_id" uuid NOT NULL,
  "from_revision" integer NOT NULL,
  "to_revision" integer NOT NULL,
  "before_phone" varchar(100),
  "before_address" varchar(500),
  "phone" varchar(100),
  "address" varchar(500),
  "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by_user_id" uuid NOT NULL,
  "audit_event_id" uuid NOT NULL UNIQUE,
  CONSTRAINT "case_contact_from_revision_key" UNIQUE ("defendant_id", "case_id", "department_id", "from_revision"),
  CONSTRAINT "case_contact_to_revision_key" UNIQUE ("defendant_id", "case_id", "department_id", "to_revision"),
  CHECK ("from_revision" >= 0 AND "to_revision" = "from_revision" + 1),
  CHECK ("phone" IS DISTINCT FROM "before_phone" OR "address" IS DISTINCT FROM "before_address"),
  CHECK ("phone" IS NULL OR ("phone" = btrim("phone") AND "phone" <> '')),
  CHECK ("address" IS NULL OR ("address" = btrim("address") AND "address" <> '')),
  FOREIGN KEY ("defendant_id", "case_id", "department_id") REFERENCES "case_defendants"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_acceptance_corrections" (
  "id" uuid PRIMARY KEY,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "acceptance_id" uuid NOT NULL,
  "trial_round_id" uuid NOT NULL,
  "prior_correction_id" uuid UNIQUE,
  "from_revision" integer NOT NULL,
  "to_revision" integer NOT NULL,
  "accepted_at" date NOT NULL,
  "court_case_no" varchar(100) NOT NULL,
  "reason" varchar(500) NOT NULL,
  "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by_user_id" uuid NOT NULL,
  "audit_event_id" uuid NOT NULL UNIQUE,
  UNIQUE ("id", "acceptance_id", "case_id", "department_id", "trial_round_id"),
  CONSTRAINT "case_acceptance_correct_from_revision_key" UNIQUE ("acceptance_id", "case_id", "department_id", "from_revision"),
  CONSTRAINT "case_acceptance_correct_to_revision_key" UNIQUE ("acceptance_id", "case_id", "department_id", "to_revision"),
  CHECK ("from_revision" >= 0 AND "to_revision" = "from_revision" + 1),
  CHECK ("court_case_no" = btrim("court_case_no") AND length("court_case_no") BETWEEN 1 AND 100),
  CHECK ("reason" = btrim("reason") AND length("reason") BETWEEN 1 AND 500),
  CHECK ("accepted_at" <= ("recorded_at" AT TIME ZONE 'Asia/Shanghai')::date),
  FOREIGN KEY ("acceptance_id", "case_id", "department_id", "trial_round_id") REFERENCES "case_acceptances"("id", "case_id", "department_id", "trial_round_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("prior_correction_id", "acceptance_id", "case_id", "department_id", "trial_round_id") REFERENCES "case_acceptance_corrections"("id", "acceptance_id", "case_id", "department_id", "trial_round_id") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_record_edit_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "department_id" uuid NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "command" "case_record_edit_command" NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "request_fingerprint" char(64) NOT NULL,
  "result_snapshot" jsonb NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("department_id", "actor_user_id", "command", "idempotency_key"),
  CHECK (length(btrim("idempotency_key")) BETWEEN 1 AND 128 AND "idempotency_key" = btrim("idempotency_key")),
  CHECK ("request_fingerprint" ~ '^[a-f0-9]{64}$'),
  FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "case_record_edit_contact_fact_receipt_key" ON "case_record_edit_receipts" (("result_snapshot"->>'changeId')) WHERE "command"='DEFENDANT_CONTACT_UPDATE';
CREATE UNIQUE INDEX "case_record_edit_acceptance_fact_receipt_key" ON "case_record_edit_receipts" (("result_snapshot"->>'correctionId')) WHERE "command"='ACCEPTANCE_CORRECTION';

CREATE FUNCTION "case_effective_acceptance_date"(target_acceptance uuid) RETURNS date LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT c."accepted_at" FROM "case_acceptance_corrections" c WHERE c."acceptance_id" = a."id" ORDER BY c."to_revision" DESC LIMIT 1), a."accepted_at")
  FROM "case_acceptances" a WHERE a."id" = target_acceptance
$$;
CREATE FUNCTION "case_effective_acceptance_no"(target_acceptance uuid) RETURNS varchar LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT c."court_case_no" FROM "case_acceptance_corrections" c WHERE c."acceptance_id" = a."id" ORDER BY c."to_revision" DESC LIMIT 1), a."court_case_no")
  FROM "case_acceptances" a WHERE a."id" = target_acceptance
$$;

-- Preserve all previous chain guards and only replace their exact acceptance lookup.
DO $migration$
DECLARE definition text; fn text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname='check_case_trial_round_foundation' AND p.pronargs=0;
  IF definition IS NULL OR (length(definition)-length(replace(definition,'a."court_case_no" = c."court_case_no"',''))) / length('a."court_case_no" = c."court_case_no"') <> 2 THEN
    RAISE EXCEPTION 'unknown trial round acceptance guard' USING ERRCODE='23514';
  END IF;
  EXECUTE replace(definition,'a."court_case_no" = c."court_case_no"','case_effective_acceptance_no(a."id") = c."court_case_no"');
  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname='check_case_hearing_fact' AND p.pronargs=0;
  IF definition IS NULL OR position('ac."accepted_at"' IN definition)=0 THEN RAISE EXCEPTION 'unknown hearing acceptance guard' USING ERRCODE='23514'; END IF;
  EXECUTE replace(definition,'ac."accepted_at"','case_effective_acceptance_date(ac."id")');
  FOREACH fn IN ARRAY ARRAY['check_case_judgment_final','check_case_second_instance_final'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname=fn AND p.pronargs=0;
    IF definition IS NULL OR position('a."accepted_at"' IN definition)=0 THEN RAISE EXCEPTION 'unknown % acceptance guard',fn USING ERRCODE='23514'; END IF;
    EXECUTE replace(definition,'a."accepted_at"','case_effective_acceptance_date(a."id")');
  END LOOP;
  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname='reject_case_judgment_audit_mutation' AND p.pronargs=0;
  IF definition IS NULL OR position('''case.archive.corrected''' IN definition)=0 THEN RAISE EXCEPTION 'unknown immutable audit guard' USING ERRCODE='23514'; END IF;
  EXECUTE replace(definition,'''case.archive.corrected''','''case.archive.corrected'',''case.defendant-contact.updated'',''case.acceptance.corrected''');
END;
$migration$;

CREATE FUNCTION "case_record_edit_actor_authorized"(target_actor uuid,target_case uuid,target_department uuid,target_action "permission_action") RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "cases" c JOIN "user_accounts" u ON u."id"=target_actor AND u."active" AND u."account_type"='INTERNAL'
    WHERE c."id"=target_case AND c."department_id"=target_department AND EXISTS (
      SELECT 1 FROM "department_memberships" membership
      JOIN "role_assignments" assignment ON assignment."user_id"=membership."user_id" AND assignment."department_id"=membership."department_id" AND assignment."active"
      JOIN "role_templates" template ON template."id"=assignment."role_template_id" AND template."department_id"=assignment."department_id" AND template."active"
      JOIN "role_grants" action_grant ON action_grant."role_template_id"=template."id" AND action_grant."action"=target_action
      JOIN "department_memberships" owner ON owner."user_id"=c."responsible_user_id" AND owner."department_id"=c."department_id"
      WHERE membership."user_id"=target_actor AND membership."department_id"=target_department AND membership."active" AND
        (action_grant."scope"='DEPARTMENT' OR (action_grant."scope"='SELF' AND c."responsible_user_id"=target_actor) OR (action_grant."scope"='TEAM' AND assignment."team_id"=owner."team_id"))
    )
  )
$$;

-- Existing defendants have a stable identity. Only the contact command may
-- advance the three contact fields; cleanup can still use its existing
-- isolated-table TRUNCATE path without a production bypass flag.
CREATE FUNCTION "reject_case_defendant_identity_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'case defendant identity is immutable' USING ERRCODE='23514';
  END IF;
  IF (to_jsonb(NEW)-'phone'-'address'-'contact_revision') IS DISTINCT FROM (to_jsonb(OLD)-'phone'-'address'-'contact_revision') OR
    NEW."contact_revision"<>OLD."contact_revision"+1 OR
    (NEW."phone" IS NOT DISTINCT FROM OLD."phone" AND NEW."address" IS NOT DISTINCT FROM OLD."address")
  THEN RAISE EXCEPTION 'case defendant identity is immutable and contacts require a revision' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_defendant_identity_immutable" BEFORE UPDATE OR DELETE ON "case_defendants" FOR EACH ROW EXECUTE FUNCTION "reject_case_defendant_identity_mutation"();

CREATE FUNCTION "check_case_defendant_contact_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_defendant uuid; target_case uuid; target_department uuid; new_change_id uuid; d record; c record; a record; r record; prior_phone varchar; prior_address varchar; revision integer:=0;
BEGIN
  IF TG_TABLE_NAME='case_defendants' THEN
    target_defendant:=NEW."id"; target_case:=NEW."case_id"; target_department:=NEW."department_id";
    SELECT "id" INTO new_change_id FROM "case_defendant_contact_changes" WHERE "defendant_id"=NEW."id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id" AND "to_revision"=NEW."contact_revision";
  ELSE target_defendant:=NEW."defendant_id"; target_case:=NEW."case_id"; target_department:=NEW."department_id"; new_change_id:=NEW."id"; END IF;
  SELECT * INTO d FROM "case_defendants" WHERE "id"=target_defendant AND "case_id"=target_case AND "department_id"=target_department;
  IF d."id" IS NULL THEN RAISE EXCEPTION 'missing defendant contact root' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='case_defendants' AND (
    NEW."contact_revision"<>OLD."contact_revision"+1 OR
    NOT EXISTS (SELECT 1 FROM "case_defendant_contact_changes" x WHERE x."defendant_id"=target_defendant AND x."case_id"=target_case AND x."department_id"=target_department AND x."to_revision"=NEW."contact_revision" AND x."before_phone" IS NOT DISTINCT FROM OLD."phone" AND x."before_address" IS NOT DISTINCT FROM OLD."address" AND x."phone" IS NOT DISTINCT FROM NEW."phone" AND x."address" IS NOT DISTINCT FROM NEW."address")
  ) THEN RAISE EXCEPTION 'invalid defendant contact transition' USING ERRCODE='23514'; END IF;
  FOR c IN SELECT * FROM "case_defendant_contact_changes" WHERE "defendant_id"=target_defendant AND "case_id"=target_case AND "department_id"=target_department ORDER BY "to_revision" LOOP
    SELECT * INTO a FROM "audit_events" WHERE "id"=c."audit_event_id";
    SELECT * INTO r FROM "case_record_edit_receipts" WHERE "command"='DEFENDANT_CONTACT_UPDATE' AND "case_id"=target_case AND "department_id"=target_department AND "actor_user_id"=c."recorded_by_user_id" AND "result_snapshot"->>'changeId'=c."id"::text;
    IF c."from_revision"<>revision OR c."to_revision"<>revision+1 OR (revision>0 AND (c."before_phone" IS DISTINCT FROM prior_phone OR c."before_address" IS DISTINCT FROM prior_address)) OR
      a."id" IS NULL OR a."department_id"<>target_department OR a."resource_type"<>'CASE' OR a."resource_id"<>target_case OR a."actor_user_id"<>c."recorded_by_user_id" OR a."internal_actor_user_id" IS DISTINCT FROM c."recorded_by_user_id" OR a."action"<>'case.defendant-contact.updated' OR
      a."details"->>'defendantId' IS DISTINCT FROM target_defendant::text OR a."details"->>'changeId' IS DISTINCT FROM c."id"::text OR a."details"->>'fromRevision' IS DISTINCT FROM c."from_revision"::text OR a."details"->>'toRevision' IS DISTINCT FROM c."to_revision"::text OR
      a."details"->'beforePhone' IS DISTINCT FROM coalesce(to_jsonb(c."before_phone"),'null'::jsonb) OR a."details"->'beforeAddress' IS DISTINCT FROM coalesce(to_jsonb(c."before_address"),'null'::jsonb) OR a."details"->'phone' IS DISTINCT FROM coalesce(to_jsonb(c."phone"),'null'::jsonb) OR a."details"->'address' IS DISTINCT FROM coalesce(to_jsonb(c."address"),'null'::jsonb) OR
      (c."id"=new_change_id AND NOT case_record_edit_actor_authorized(c."recorded_by_user_id",target_case,target_department,'case.defendant-contact.update')) OR
      r."id" IS NULL OR r."result_snapshot"->>'caseId' IS DISTINCT FROM target_case::text OR r."result_snapshot"->>'defendantId' IS DISTINCT FROM target_defendant::text OR r."result_snapshot"->>'contactRevision' IS DISTINCT FROM c."to_revision"::text OR r."result_snapshot"->'phone' IS DISTINCT FROM coalesce(to_jsonb(c."phone"),'null'::jsonb) OR r."result_snapshot"->'address' IS DISTINCT FROM coalesce(to_jsonb(c."address"),'null'::jsonb) THEN
      RAISE EXCEPTION 'broken defendant contact chain' USING ERRCODE='23514';
    END IF;
    revision:=c."to_revision"; prior_phone:=c."phone"; prior_address:=c."address";
  END LOOP;
  IF d."contact_revision"<>revision OR (revision>0 AND (d."phone" IS DISTINCT FROM prior_phone OR d."address" IS DISTINCT FROM prior_address)) THEN
    RAISE EXCEPTION 'defendant contact projection mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "case_defendant_contact_current_guard" AFTER UPDATE OF "phone","address","contact_revision" ON "case_defendants" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_defendant_contact_final"();
CREATE CONSTRAINT TRIGGER "case_defendant_contact_change_guard" AFTER INSERT ON "case_defendant_contact_changes" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_defendant_contact_final"();

CREATE FUNCTION "check_case_acceptance_correction_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root record; c record; a record; r record; current_case record; revision integer:=0; accepted_date date; court_no varchar; prior_id uuid;
BEGIN
  SELECT * INTO root FROM "case_acceptances" WHERE "id"=NEW."acceptance_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id" AND "trial_round_id"=NEW."trial_round_id";
  SELECT * INTO current_case FROM "cases" WHERE "id"=NEW."case_id" AND "department_id"=NEW."department_id";
  IF root."id" IS NULL OR current_case."id" IS NULL THEN RAISE EXCEPTION 'missing acceptance correction root' USING ERRCODE='23514'; END IF;
  accepted_date:=root."accepted_at"; court_no:=root."court_case_no";
  FOR c IN SELECT * FROM "case_acceptance_corrections" WHERE "acceptance_id"=root."id" ORDER BY "to_revision" LOOP
    SELECT * INTO a FROM "audit_events" WHERE "id"=c."audit_event_id";
    SELECT * INTO r FROM "case_record_edit_receipts" WHERE "command"='ACCEPTANCE_CORRECTION' AND "case_id"=root."case_id" AND "department_id"=root."department_id" AND "actor_user_id"=c."recorded_by_user_id" AND "result_snapshot"->>'correctionId'=c."id"::text;
    IF c."from_revision"<>revision OR c."to_revision"<>revision+1 OR c."prior_correction_id" IS DISTINCT FROM prior_id OR
      (c."accepted_at"=accepted_date AND c."court_case_no"=court_no) OR
      a."id" IS NULL OR a."department_id"<>root."department_id" OR a."resource_type"<>'CASE' OR a."resource_id"<>root."case_id" OR a."actor_user_id"<>c."recorded_by_user_id" OR a."internal_actor_user_id" IS DISTINCT FROM c."recorded_by_user_id" OR a."action"<>'case.acceptance.corrected' OR
      a."details"->>'acceptanceId' IS DISTINCT FROM root."id"::text OR a."details"->>'trialRoundId' IS DISTINCT FROM root."trial_round_id"::text OR a."details"->>'correctionId' IS DISTINCT FROM c."id"::text OR a."details"->>'fromRevision' IS DISTINCT FROM c."from_revision"::text OR a."details"->>'toRevision' IS DISTINCT FROM c."to_revision"::text OR
      a."details"->'priorCorrectionId' IS DISTINCT FROM coalesce(to_jsonb(c."prior_correction_id"),'null'::jsonb) OR a."details"->>'beforeAcceptedAt' IS DISTINCT FROM accepted_date::text OR a."details"->>'beforeCourtCaseNo' IS DISTINCT FROM court_no OR a."details"->>'acceptedAt' IS DISTINCT FROM c."accepted_at"::text OR a."details"->>'courtCaseNo' IS DISTINCT FROM c."court_case_no" OR a."details"->>'reason' IS DISTINCT FROM c."reason" OR
      (c."id"=NEW."id" AND NOT case_record_edit_actor_authorized(c."recorded_by_user_id",root."case_id",root."department_id",'case.acceptance.correct')) OR
      r."id" IS NULL OR r."result_snapshot"->>'caseId' IS DISTINCT FROM root."case_id"::text OR r."result_snapshot"->>'acceptanceId' IS DISTINCT FROM root."id"::text OR r."result_snapshot"->>'acceptanceRevision' IS DISTINCT FROM c."to_revision"::text OR r."result_snapshot"->>'acceptedAt' IS DISTINCT FROM c."accepted_at"::text OR r."result_snapshot"->>'courtCaseNo' IS DISTINCT FROM c."court_case_no" THEN
      RAISE EXCEPTION 'broken acceptance correction chain' USING ERRCODE='23514';
    END IF;
    revision:=c."to_revision"; accepted_date:=c."accepted_at"; court_no:=c."court_case_no"; prior_id:=c."id";
  END LOOP;
  IF current_case."current_acceptance_id"=root."id" AND current_case."court_case_no" IS DISTINCT FROM court_no THEN
    RAISE EXCEPTION 'current acceptance case number mismatch' USING ERRCODE='23514';
  END IF;
  IF accepted_date < (SELECT "submitted_at" FROM "case_filing_submissions" WHERE "case_id"=root."case_id" AND "department_id"=root."department_id") OR
    EXISTS (SELECT 1 FROM "case_hearing_arrangements" h WHERE h."case_id"=root."case_id" AND h."trial_round_id"=root."trial_round_id" AND h."hearing_at"<accepted_date) OR
    EXISTS (SELECT 1 FROM "case_judgment_facts" j WHERE j."case_id"=root."case_id" AND j."trial_round_id"=root."trial_round_id" AND j."judgment_received_at"<accepted_date) OR
    EXISTS (SELECT 1 FROM "case_second_instance_progresses" p WHERE p."case_id"=root."case_id" AND p."trial_round_id"=root."trial_round_id" AND p."hearing_at"<accepted_date) OR
    EXISTS (SELECT 1 FROM "case_second_instance_results" s WHERE s."case_id"=root."case_id" AND s."trial_round_id"=root."trial_round_id" AND s."result_received_at"<accepted_date) OR
    (EXISTS (SELECT 1 FROM "case_execution_submissions" e WHERE e."case_id"=root."case_id" AND e."trial_round_id"=root."trial_round_id") AND (
      EXISTS (SELECT 1 FROM "case_execution_mailings" m WHERE m."case_id"=root."case_id" AND m."mailed_at"<accepted_date) OR
      EXISTS (SELECT 1 FROM "case_execution_filings" f WHERE f."case_id"=root."case_id" AND f."submitted_at"<accepted_date) OR
      EXISTS (SELECT 1 FROM "case_execution_finishes" f WHERE f."case_id"=root."case_id" AND f."finished_at"<accepted_date) OR
      EXISTS (SELECT 1 FROM "case_closure_versions" v WHERE v."case_id"=root."case_id" AND v."close_at"<accepted_date) OR
      EXISTS (SELECT 1 FROM "case_archive_versions" v WHERE v."case_id"=root."case_id" AND v."archive_at"<accepted_date)
    )) THEN RAISE EXCEPTION 'acceptance correction conflicts with subsequent date' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "case_acceptance_correction_guard" AFTER INSERT ON "case_acceptance_corrections" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_acceptance_correction_final"();

CREATE FUNCTION "check_case_record_edit_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE contact record; acceptance record; expected jsonb;
BEGIN
  IF NEW."command"='DEFENDANT_CONTACT_UPDATE' THEN
    SELECT * INTO contact FROM "case_defendant_contact_changes" c WHERE c."id"::text=NEW."result_snapshot"->>'changeId' AND c."case_id"=NEW."case_id" AND c."department_id"=NEW."department_id" AND c."recorded_by_user_id"=NEW."actor_user_id";
    IF contact."id" IS NULL THEN RAISE EXCEPTION 'contact receipt lacks exact fact' USING ERRCODE='23514'; END IF;
    expected:=jsonb_build_object(
      'caseId',contact."case_id",'defendantId',contact."defendant_id",'changeId',contact."id",'contactRevision',contact."to_revision",
      'phone',contact."phone",'address',contact."address",
      'recordedAt',to_char(contact."recorded_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
  ELSE
    SELECT * INTO acceptance FROM "case_acceptance_corrections" c WHERE c."id"::text=NEW."result_snapshot"->>'correctionId' AND c."case_id"=NEW."case_id" AND c."department_id"=NEW."department_id" AND c."recorded_by_user_id"=NEW."actor_user_id";
    IF acceptance."id" IS NULL THEN RAISE EXCEPTION 'acceptance receipt lacks exact fact' USING ERRCODE='23514'; END IF;
    expected:=jsonb_build_object(
      'caseId',acceptance."case_id",'acceptanceId',acceptance."acceptance_id",'correctionId',acceptance."id",'acceptanceRevision',acceptance."to_revision",
      'acceptedAt',acceptance."accepted_at",'courtCaseNo',acceptance."court_case_no",
      'recordedAt',to_char(acceptance."recorded_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
  END IF;
  IF NEW."result_snapshot" IS DISTINCT FROM expected THEN RAISE EXCEPTION 'record edit receipt does not match its fact' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "case_record_edit_receipt_guard" AFTER INSERT ON "case_record_edit_receipts" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_record_edit_receipt"();

CREATE TRIGGER "case_defendant_contact_changes_immutable" BEFORE UPDATE OR DELETE ON "case_defendant_contact_changes" FOR EACH ROW EXECUTE FUNCTION "reject_case_acceptance_mutation"();
CREATE TRIGGER "case_acceptance_corrections_immutable" BEFORE UPDATE OR DELETE ON "case_acceptance_corrections" FOR EACH ROW EXECUTE FUNCTION "reject_case_acceptance_mutation"();
CREATE TRIGGER "case_record_edit_receipts_immutable" BEFORE UPDATE OR DELETE ON "case_record_edit_receipts" FOR EACH ROW EXECUTE FUNCTION "reject_case_acceptance_mutation"();

COMMIT;
