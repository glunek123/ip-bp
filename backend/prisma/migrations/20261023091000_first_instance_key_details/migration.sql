-- Nullable first-instance details. No backfill, date inference or workflow change.
ALTER TABLE "case_acceptances" ADD COLUMN "payment_due_at" DATE;
ALTER TABLE "case_acceptance_corrections" ADD COLUMN "payment_due_at" DATE;
ALTER TABLE "case_hearing_arrangements" ADD COLUMN "hearing_place" VARCHAR(500), ADD COLUMN "judge_name" VARCHAR(200);
ALTER TABLE "case_hearing_record_corrections" ADD COLUMN "hearing_place" VARCHAR(500), ADD COLUMN "judge_name" VARCHAR(200);

-- Existing guards still enforce the original action, actor, anchors and receipt.
-- This additive guard binds only the new nullable values to that same audit.
CREATE FUNCTION "check_first_instance_key_details_audit"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE details jsonb;
BEGIN
  SELECT a."details" INTO details FROM "audit_events" a WHERE a."id"=NEW."audit_event_id";
  IF TG_TABLE_NAME='case_acceptances' THEN
    IF coalesce(details->'paymentDueAt','null'::jsonb) IS DISTINCT FROM coalesce(to_jsonb(NEW."payment_due_at"),'null'::jsonb) THEN
      RAISE EXCEPTION 'acceptance payment deadline audit mismatch' USING ERRCODE='23514';
    END IF;
  ELSE
    IF coalesce(details->'hearingPlace','null'::jsonb) IS DISTINCT FROM coalesce(to_jsonb(NEW."hearing_place"),'null'::jsonb) OR
       coalesce(details->'judgeName','null'::jsonb) IS DISTINCT FROM coalesce(to_jsonb(NEW."judge_name"),'null'::jsonb) THEN
      RAISE EXCEPTION 'hearing key details audit mismatch' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "acceptance_key_details_audit" AFTER INSERT ON "case_acceptances" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_first_instance_key_details_audit"();
CREATE CONSTRAINT TRIGGER "hearing_key_details_audit" AFTER INSERT ON "case_hearing_arrangements" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_first_instance_key_details_audit"();

CREATE OR REPLACE FUNCTION "check_case_acceptance_correction_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root record; c record; a record; r record; current_case record; revision integer:=0; accepted_date date; court_no varchar; prior_id uuid; payment_date date;
BEGIN
  SELECT * INTO root FROM "case_acceptances" WHERE "id"=NEW."acceptance_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id" AND "trial_round_id"=NEW."trial_round_id";
  SELECT * INTO current_case FROM "cases" WHERE "id"=NEW."case_id" AND "department_id"=NEW."department_id";
  IF root."id" IS NULL OR current_case."id" IS NULL THEN RAISE EXCEPTION 'missing acceptance correction root' USING ERRCODE='23514'; END IF;
  accepted_date:=root."accepted_at"; court_no:=root."court_case_no"; payment_date:=root."payment_due_at";
  FOR c IN SELECT * FROM "case_acceptance_corrections" WHERE "acceptance_id"=root."id" ORDER BY "to_revision" LOOP
    SELECT * INTO a FROM "audit_events" WHERE "id"=c."audit_event_id";
    SELECT * INTO r FROM "case_record_edit_receipts" WHERE "command"='ACCEPTANCE_CORRECTION' AND "case_id"=root."case_id" AND "department_id"=root."department_id" AND "actor_user_id"=c."recorded_by_user_id" AND "result_snapshot"->>'correctionId'=c."id"::text;
    IF c."from_revision"<>revision OR c."to_revision"<>revision+1 OR c."prior_correction_id" IS DISTINCT FROM prior_id OR
      (c."accepted_at"=accepted_date AND c."court_case_no"=court_no AND c."payment_due_at" IS NOT DISTINCT FROM payment_date) OR
      a."id" IS NULL OR a."department_id"<>root."department_id" OR a."resource_type"<>'CASE' OR a."resource_id"<>root."case_id" OR a."actor_user_id"<>c."recorded_by_user_id" OR a."internal_actor_user_id" IS DISTINCT FROM c."recorded_by_user_id" OR a."action"<>'case.acceptance.corrected' OR
      a."details"->>'acceptanceId' IS DISTINCT FROM root."id"::text OR a."details"->>'trialRoundId' IS DISTINCT FROM root."trial_round_id"::text OR a."details"->>'correctionId' IS DISTINCT FROM c."id"::text OR a."details"->>'fromRevision' IS DISTINCT FROM c."from_revision"::text OR a."details"->>'toRevision' IS DISTINCT FROM c."to_revision"::text OR
      a."details"->'priorCorrectionId' IS DISTINCT FROM coalesce(to_jsonb(c."prior_correction_id"),'null'::jsonb) OR a."details"->>'beforeAcceptedAt' IS DISTINCT FROM accepted_date::text OR a."details"->>'beforeCourtCaseNo' IS DISTINCT FROM court_no OR a."details"->>'acceptedAt' IS DISTINCT FROM c."accepted_at"::text OR a."details"->>'courtCaseNo' IS DISTINCT FROM c."court_case_no" OR a."details"->>'reason' IS DISTINCT FROM c."reason" OR
      (a."details" ? 'paymentDueAt' AND (a."details"->'paymentDueAt' IS DISTINCT FROM coalesce(to_jsonb(c."payment_due_at"),'null'::jsonb) OR a."details"->'beforePaymentDueAt' IS DISTINCT FROM coalesce(to_jsonb(payment_date),'null'::jsonb))) OR
      (NOT (a."details" ? 'paymentDueAt') AND c."payment_due_at" IS DISTINCT FROM payment_date) OR
      (c."id"=NEW."id" AND NOT case_record_edit_actor_authorized(c."recorded_by_user_id",root."case_id",root."department_id",'case.acceptance.correct')) OR
      r."id" IS NULL OR r."result_snapshot"->>'caseId' IS DISTINCT FROM root."case_id"::text OR r."result_snapshot"->>'acceptanceId' IS DISTINCT FROM root."id"::text OR r."result_snapshot"->>'acceptanceRevision' IS DISTINCT FROM c."to_revision"::text OR r."result_snapshot"->>'acceptedAt' IS DISTINCT FROM c."accepted_at"::text OR r."result_snapshot"->>'courtCaseNo' IS DISTINCT FROM c."court_case_no" THEN
      RAISE EXCEPTION 'broken acceptance correction chain' USING ERRCODE='23514';
    END IF;
    revision:=c."to_revision"; accepted_date:=c."accepted_at"; court_no:=c."court_case_no"; prior_id:=c."id"; payment_date:=c."payment_due_at";
  END LOOP;
  IF current_case."current_acceptance_id"=root."id" AND current_case."court_case_no" IS DISTINCT FROM court_no THEN
    RAISE EXCEPTION 'current acceptance case number mismatch' USING ERRCODE='23514';
  END IF;
  IF accepted_date < (SELECT "submitted_at" FROM "case_filing_submissions" WHERE "case_id"=root."case_id" AND "department_id"=root."department_id") OR
    EXISTS (SELECT 1 FROM "case_hearing_arrangements" h WHERE h."case_id"=root."case_id" AND h."trial_round_id"=root."trial_round_id" AND case_section_hearing_date(h."id")<accepted_date) OR
    EXISTS (SELECT 1 FROM "case_judgment_facts" j WHERE j."case_id"=root."case_id" AND j."trial_round_id"=root."trial_round_id" AND case_section_judgment_date(j."id")<accepted_date) OR
    EXISTS (SELECT 1 FROM "case_second_instance_progresses" p WHERE p."case_id"=root."case_id" AND p."trial_round_id"=root."trial_round_id" AND p."hearing_at"<accepted_date) OR
    EXISTS (SELECT 1 FROM "case_second_instance_results" s WHERE s."case_id"=root."case_id" AND s."trial_round_id"=root."trial_round_id" AND s."result_received_at"<accepted_date) OR
    (EXISTS (SELECT 1 FROM "case_execution_submissions" e WHERE e."case_id"=root."case_id" AND e."trial_round_id"=root."trial_round_id") AND (
      EXISTS (SELECT 1 FROM "case_execution_mailings" m WHERE m."case_id"=root."case_id" AND case_section_execution_mailing_date(m."id")<accepted_date) OR
      EXISTS (SELECT 1 FROM "case_execution_filings" f WHERE f."case_id"=root."case_id" AND case_section_execution_filing_date(f."id")<accepted_date) OR
      EXISTS (SELECT 1 FROM "case_execution_finishes" f WHERE f."case_id"=root."case_id" AND case_section_execution_finish_date(f."id")<accepted_date) OR
      EXISTS (SELECT 1 FROM "case_closure_versions" v WHERE v."case_id"=root."case_id" AND case_section_closure_version_date(v."id")<accepted_date) OR
      EXISTS (SELECT 1 FROM "case_archive_versions" v WHERE v."case_id"=root."case_id" AND v."archive_at"<accepted_date)
    )) THEN RAISE EXCEPTION 'acceptance correction conflicts with subsequent date' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION "check_hearing_record_correction"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original "case_hearing_arrangements"%ROWTYPE; prior "case_hearing_record_corrections"%ROWTYPE; a "audit_events"%ROWTYPE;
 r "case_section_record_edit_receipts"%ROWTYPE; current_case jsonb; before_values jsonb; after_values jsonb; before_files jsonb; after_files jsonb;
BEGIN
  SELECT * INTO original FROM "case_hearing_arrangements" WHERE "id"=NEW."arrangement_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
  SELECT to_jsonb(c) INTO current_case FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id" FOR UPDATE;
  IF original."id" IS NULL OR current_case IS DISTINCT FROM NEW."case_anchor_snapshot" THEN RAISE EXCEPTION 'section correction changed workflow anchors' USING ERRCODE='23514'; END IF;

  IF NOT case_record_edit_actor_authorized(NEW."recorded_by_user_id",NEW."case_id",NEW."department_id",'case.hearing.correct') THEN RAISE EXCEPTION 'section correction operator unauthorized' USING ERRCODE='23514'; END IF;
  IF NEW."from_revision"=0 THEN
    before_values:=jsonb_build_object('hearingAt',original."hearing_at",'hearingPlace',original."hearing_place",'judgeName',original."judge_name");

  ELSE
    SELECT * INTO prior FROM "case_hearing_record_corrections" WHERE "id"=NEW."prior_correction_id" AND "arrangement_id"=NEW."arrangement_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
    IF prior."id" IS NULL OR prior."to_revision"<>NEW."from_revision" THEN RAISE EXCEPTION 'broken section correction chain' USING ERRCODE='23514'; END IF;
    before_values:=jsonb_build_object('hearingAt',prior."hearing_at",'hearingPlace',prior."hearing_place",'judgeName',prior."judge_name");

  END IF;
  after_values:=jsonb_build_object('hearingAt',NEW."hearing_at",'hearingPlace',NEW."hearing_place",'judgeName',NEW."judge_name");

  IF before_values=after_values THEN RAISE EXCEPTION 'section correction has no change' USING ERRCODE='23514'; END IF;

  SELECT * INTO a FROM "audit_events" WHERE "id"=NEW."audit_event_id" AND xmin=pg_current_xact_id()::text::xid;
  IF a."id" IS NULL OR a."department_id"<>NEW."department_id" OR a."resource_type"<>'CASE' OR a."resource_id"<>NEW."case_id" OR a."actor_user_id" IS DISTINCT FROM NEW."recorded_by_user_id" OR a."internal_actor_user_id" IS DISTINCT FROM NEW."recorded_by_user_id" OR a."action"<>'case.hearing.record-corrected' OR
    NOT (a."details" @> jsonb_build_object('correctionId',NEW."id",'arrangementId',NEW."arrangement_id",'fromRevision',NEW."from_revision",'toRevision',NEW."to_revision",'correctionReason',NEW."correction_reason",'trialRoundId',NEW."trial_round_id")) OR a."details"->'before' IS DISTINCT FROM before_values OR a."details"->'after' IS DISTINCT FROM after_values
  THEN RAISE EXCEPTION 'section correction audit mismatch' USING ERRCODE='23514'; END IF;
  SELECT * INTO r FROM "case_section_record_edit_receipts" WHERE "command"='HEARING_RECORD_CORRECTION' AND "department_id"=NEW."department_id" AND "case_id"=NEW."case_id" AND "actor_user_id"=NEW."recorded_by_user_id" AND "result_snapshot"->>'correctionId'=NEW."id"::text AND xmin=pg_current_xact_id()::text::xid;
  IF r."id" IS NULL OR r."result_snapshot" IS DISTINCT FROM jsonb_build_object('caseId',NEW."case_id",'correctionId',NEW."id",'recordedAt',to_char(NEW."recorded_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'arrangementId',NEW."arrangement_id",'hearingRevision',NEW."to_revision",'hearingAt',NEW."hearing_at",'trialRoundId',NEW."trial_round_id") THEN RAISE EXCEPTION 'section correction receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

-- Keep the external source anchors; compare the append-only effective acceptance number.
CREATE OR REPLACE FUNCTION "ca018_assert_external_trial_round"(target_case uuid,target_department uuid)
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
      a."external_entry_id" IS DISTINCT FROM e."id" OR case_effective_acceptance_no(a."id") IS DISTINCT FROM c."court_case_no")
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
