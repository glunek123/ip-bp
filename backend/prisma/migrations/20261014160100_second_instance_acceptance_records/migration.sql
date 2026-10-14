BEGIN;

CREATE TABLE "case_second_instance_acceptance_changes" (
  "id" uuid PRIMARY KEY,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "trial_round_id" uuid NOT NULL,
  "choice_id" uuid NOT NULL,
  "prior_change_id" uuid UNIQUE,
  "from_revision" integer NOT NULL,
  "to_revision" integer NOT NULL,
  "accepted_at" date,
  "court_case_no" varchar(100),
  "reason" varchar(500),
  "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by_user_id" uuid NOT NULL,
  "audit_event_id" uuid NOT NULL UNIQUE,
  CONSTRAINT "second_acceptance_from_revision_key" UNIQUE ("choice_id", "case_id", "department_id", "from_revision"),
  CONSTRAINT "second_acceptance_to_revision_key" UNIQUE ("choice_id", "case_id", "department_id", "to_revision"),
  CONSTRAINT "second_acceptance_prior_composite_key" UNIQUE ("prior_change_id", "choice_id", "case_id", "department_id", "trial_round_id"),
  UNIQUE ("id", "choice_id", "case_id", "department_id", "trial_round_id"),
  CHECK ("from_revision" >= 0 AND "to_revision" = "from_revision" + 1),
  CHECK ("court_case_no" IS NULL OR ("court_case_no" = btrim("court_case_no") AND length("court_case_no") BETWEEN 1 AND 100)),
  CHECK (("from_revision" = 0 AND "reason" IS NULL AND ("accepted_at" IS NOT NULL OR "court_case_no" IS NOT NULL)) OR
         ("from_revision" > 0 AND "reason" = btrim("reason") AND length("reason") BETWEEN 1 AND 500)),
  CHECK ("accepted_at" IS NULL OR "accepted_at" <= ("recorded_at" AT TIME ZONE 'Asia/Shanghai')::date),
  FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("choice_id", "case_id", "department_id", "trial_round_id") REFERENCES "case_judgment_next_steps"("id", "case_id", "department_id", "trial_round_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("prior_change_id", "choice_id", "case_id", "department_id", "trial_round_id") REFERENCES "case_second_instance_acceptance_changes"("id", "choice_id", "case_id", "department_id", "trial_round_id") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "case_record_edit_second_acceptance_fact_receipt_key"
  ON "case_record_edit_receipts" (("result_snapshot"->>'changeId'))
  WHERE "command"='SECOND_INSTANCE_ACCEPTANCE_SAVE';

DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=current_schema() AND p.proname='reject_case_judgment_audit_mutation' AND p.pronargs=0;
  IF definition IS NULL OR position('''case.acceptance.corrected''' IN definition)=0 THEN
    RAISE EXCEPTION 'unknown immutable audit guard' USING ERRCODE='23514';
  END IF;
  EXECUTE replace(definition,'''case.acceptance.corrected''','''case.acceptance.corrected'',''case.second-instance-acceptance.updated''');
END;
$migration$;

CREATE FUNCTION "case_effective_second_acceptance_date"(target_choice uuid) RETURNS date LANGUAGE sql STABLE AS $$
  SELECT c."accepted_at" FROM "case_second_instance_acceptance_changes" c
  WHERE c."choice_id"=target_choice ORDER BY c."to_revision" DESC LIMIT 1
$$;

CREATE FUNCTION "case_second_child_acceptance_date_valid"(target_round uuid, candidate date)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(candidate >= case_effective_second_acceptance_date(parent."choice_id"), true)
  FROM "case_trial_rounds" child
  LEFT JOIN "case_second_instance_results" parent ON parent."id"=child."source_result_id"
  WHERE child."id"=target_round
$$;

CREATE FUNCTION "check_case_second_child_acceptance_date"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_round uuid; candidate date;
BEGIN
  IF TG_TABLE_NAME='case_acceptances' THEN
    target_round:=NEW."trial_round_id";
    candidate:=case_effective_acceptance_date(NEW."id");
  ELSE
    target_round:=NEW."trial_round_id";
    candidate:=case_effective_acceptance_date(NEW."acceptance_id");
  END IF;
  IF case_second_child_acceptance_date_valid(target_round,candidate) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'remand acceptance precedes second acceptance' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "case_second_child_acceptance_root_guard" AFTER INSERT ON "case_acceptances"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_second_child_acceptance_date"();
CREATE CONSTRAINT TRIGGER "case_second_child_acceptance_correction_guard" AFTER INSERT ON "case_acceptance_corrections"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_second_child_acceptance_date"();

CREATE FUNCTION "check_case_second_acceptance_dates"(target_choice uuid, target_case uuid, target_department uuid, target_round uuid, candidate date)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE source_received date;
BEGIN
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
END; $$;

CREATE FUNCTION "check_case_second_acceptance_change_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE change_record record; previous record; root record; case_record record; audit_record record; revision integer:=0; prior_id uuid; prior_date date; prior_no varchar;
BEGIN
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
END; $$;
CREATE CONSTRAINT TRIGGER "case_second_acceptance_change_guard" AFTER INSERT ON "case_second_instance_acceptance_changes"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_second_acceptance_change_final"();

CREATE FUNCTION "check_case_second_acceptance_dependent_date"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE first_date date; second_date date; business_date date;
BEGIN
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
END; $$;
CREATE CONSTRAINT TRIGGER "case_second_progress_acceptance_date_guard" AFTER INSERT ON "case_second_instance_progresses"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_second_acceptance_dependent_date"();
CREATE CONSTRAINT TRIGGER "case_second_result_acceptance_date_guard" AFTER INSERT ON "case_second_instance_results"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_second_acceptance_dependent_date"();

CREATE FUNCTION "check_case_second_acceptance_blocks_choice_revoke"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "case_second_instance_acceptance_changes" c WHERE c."choice_id"=NEW."choice_id") THEN
    RAISE EXCEPTION 'second acceptance blocks appeal revoke' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "case_second_acceptance_choice_revoke_guard" AFTER INSERT ON "case_judgment_next_step_revocations"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_second_acceptance_blocks_choice_revoke"();

CREATE OR REPLACE FUNCTION "check_case_record_edit_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE contact record; acceptance record; second_acceptance record; expected jsonb;
BEGIN
  IF NEW."command"='DEFENDANT_CONTACT_UPDATE' THEN
    SELECT * INTO contact FROM "case_defendant_contact_changes" c WHERE c."id"::text=NEW."result_snapshot"->>'changeId' AND c."case_id"=NEW."case_id" AND c."department_id"=NEW."department_id" AND c."recorded_by_user_id"=NEW."actor_user_id";
    IF contact."id" IS NULL THEN RAISE EXCEPTION 'contact receipt lacks exact fact' USING ERRCODE='23514'; END IF;
    expected:=jsonb_build_object('caseId',contact."case_id",'defendantId',contact."defendant_id",'changeId',contact."id",'contactRevision',contact."to_revision",
      'phone',contact."phone",'address',contact."address",'recordedAt',to_char(contact."recorded_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  ELSIF NEW."command"='ACCEPTANCE_CORRECTION' THEN
    SELECT * INTO acceptance FROM "case_acceptance_corrections" c WHERE c."id"::text=NEW."result_snapshot"->>'correctionId' AND c."case_id"=NEW."case_id" AND c."department_id"=NEW."department_id" AND c."recorded_by_user_id"=NEW."actor_user_id";
    IF acceptance."id" IS NULL THEN RAISE EXCEPTION 'acceptance receipt lacks exact fact' USING ERRCODE='23514'; END IF;
    expected:=jsonb_build_object('caseId',acceptance."case_id",'acceptanceId',acceptance."acceptance_id",'correctionId',acceptance."id",'acceptanceRevision',acceptance."to_revision",
      'acceptedAt',acceptance."accepted_at",'courtCaseNo',acceptance."court_case_no",'recordedAt',to_char(acceptance."recorded_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  ELSIF NEW."command"='SECOND_INSTANCE_ACCEPTANCE_SAVE' THEN
    SELECT * INTO second_acceptance FROM "case_second_instance_acceptance_changes" c WHERE c."id"::text=NEW."result_snapshot"->>'changeId' AND c."case_id"=NEW."case_id" AND c."department_id"=NEW."department_id" AND c."recorded_by_user_id"=NEW."actor_user_id";
    IF second_acceptance."id" IS NULL THEN RAISE EXCEPTION 'second acceptance receipt lacks exact fact' USING ERRCODE='23514'; END IF;
    expected:=jsonb_build_object('caseId',second_acceptance."case_id",'choiceId',second_acceptance."choice_id",'trialRoundId',second_acceptance."trial_round_id",'changeId',second_acceptance."id",'acceptanceRevision',second_acceptance."to_revision",
      'acceptedAt',second_acceptance."accepted_at",'courtCaseNo',second_acceptance."court_case_no",'recordedAt',to_char(second_acceptance."recorded_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  ELSE RAISE EXCEPTION 'unknown record edit command' USING ERRCODE='23514';
  END IF;
  IF NEW."result_snapshot" IS DISTINCT FROM expected THEN RAISE EXCEPTION 'record edit receipt does not match its fact' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER "case_second_acceptance_changes_immutable" BEFORE UPDATE OR DELETE ON "case_second_instance_acceptance_changes"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_acceptance_mutation"();

COMMIT;
