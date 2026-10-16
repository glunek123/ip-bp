-- Rename the receipt row variable so the material_references r alias resolves as a table row.
-- CREATE OR REPLACE preserves function identity, trigger bindings, owner and grants.
BEGIN;

CREATE OR REPLACE FUNCTION "check_execution_mailing_record_correction"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original "case_execution_mailings"%ROWTYPE; prior "case_execution_mailing_record_corrections"%ROWTYPE; a "audit_events"%ROWTYPE;
 receipt_row "case_section_record_edit_receipts"%ROWTYPE; current_case jsonb; before_values jsonb; after_values jsonb; before_files jsonb; after_files jsonb;
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
  SELECT * INTO receipt_row FROM "case_section_record_edit_receipts" WHERE "command"='EXECUTION_MAILING_CORRECTION' AND "department_id"=NEW."department_id" AND "case_id"=NEW."case_id" AND "actor_user_id"=NEW."recorded_by_user_id" AND "result_snapshot"->>'correctionId'=NEW."id"::text AND xmin=pg_current_xact_id()::text::xid;
  IF receipt_row."id" IS NULL OR receipt_row."result_snapshot" IS DISTINCT FROM jsonb_build_object('caseId',NEW."case_id",'correctionId',NEW."id",'recordedAt',to_char(NEW."recorded_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'mailingId',NEW."mailing_id",'mailingRevision',NEW."to_revision",'mailedAt',NEW."mailed_at") THEN RAISE EXCEPTION 'section correction receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION "check_execution_filing_record_correction"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original "case_execution_filings"%ROWTYPE; prior "case_execution_filing_record_corrections"%ROWTYPE; a "audit_events"%ROWTYPE;
 receipt_row "case_section_record_edit_receipts"%ROWTYPE; current_case jsonb; before_values jsonb; after_values jsonb; before_files jsonb; after_files jsonb;
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
  SELECT * INTO receipt_row FROM "case_section_record_edit_receipts" WHERE "command"='EXECUTION_FILING_CORRECTION' AND "department_id"=NEW."department_id" AND "case_id"=NEW."case_id" AND "actor_user_id"=NEW."recorded_by_user_id" AND "result_snapshot"->>'correctionId'=NEW."id"::text AND xmin=pg_current_xact_id()::text::xid;
  IF receipt_row."id" IS NULL OR receipt_row."result_snapshot" IS DISTINCT FROM jsonb_build_object('caseId',NEW."case_id",'correctionId',NEW."id",'recordedAt',to_char(NEW."recorded_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'filingId',NEW."filing_id",'filingRevision',NEW."to_revision",'submittedAt',NEW."submitted_at") THEN RAISE EXCEPTION 'section correction receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION "check_execution_finish_record_correction"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original "case_execution_finishes"%ROWTYPE; prior "case_execution_finish_record_corrections"%ROWTYPE; a "audit_events"%ROWTYPE;
 receipt_row "case_section_record_edit_receipts"%ROWTYPE; current_case jsonb; before_values jsonb; after_values jsonb; before_files jsonb; after_files jsonb;
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
  SELECT * INTO receipt_row FROM "case_section_record_edit_receipts" WHERE "command"='EXECUTION_FINISH_CORRECTION' AND "department_id"=NEW."department_id" AND "case_id"=NEW."case_id" AND "actor_user_id"=NEW."recorded_by_user_id" AND "result_snapshot"->>'correctionId'=NEW."id"::text AND xmin=pg_current_xact_id()::text::xid;
  IF receipt_row."id" IS NULL OR receipt_row."result_snapshot" IS DISTINCT FROM jsonb_build_object('caseId',NEW."case_id",'correctionId',NEW."id",'recordedAt',to_char(NEW."recorded_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'finishId',NEW."finish_id",'finishRevision',NEW."to_revision",'finishedAt',NEW."finished_at") THEN RAISE EXCEPTION 'section correction receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION "check_judgment_record_correction"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original "case_judgment_facts"%ROWTYPE; prior "case_judgment_record_corrections"%ROWTYPE; a "audit_events"%ROWTYPE;
 receipt_row "case_section_record_edit_receipts"%ROWTYPE; current_case jsonb; before_values jsonb; after_values jsonb; before_files jsonb; after_files jsonb;
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
  SELECT * INTO receipt_row FROM "case_section_record_edit_receipts" WHERE "command"='JUDGMENT_RECORD_CORRECTION' AND "department_id"=NEW."department_id" AND "case_id"=NEW."case_id" AND "actor_user_id"=NEW."recorded_by_user_id" AND "result_snapshot"->>'correctionId'=NEW."id"::text AND xmin=pg_current_xact_id()::text::xid;
  IF receipt_row."id" IS NULL OR receipt_row."result_snapshot" IS DISTINCT FROM jsonb_build_object('caseId',NEW."case_id",'correctionId',NEW."id",'recordedAt',to_char(NEW."recorded_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'judgmentId',NEW."judgment_id",'judgmentRevision',NEW."to_revision",'judgmentReceivedAt',NEW."judgment_received_at",'trialRoundId',NEW."trial_round_id") THEN RAISE EXCEPTION 'section correction receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION "check_closure_record_correction"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original "case_closure_versions"%ROWTYPE; prior "case_closure_record_corrections"%ROWTYPE; a "audit_events"%ROWTYPE;
 receipt_row "case_section_record_edit_receipts"%ROWTYPE; current_case jsonb; before_values jsonb; after_values jsonb; before_files jsonb; after_files jsonb;
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
  SELECT * INTO receipt_row FROM "case_section_record_edit_receipts" WHERE "command"='CLOSURE_RECORD_CORRECTION' AND "department_id"=NEW."department_id" AND "case_id"=NEW."case_id" AND "actor_user_id"=NEW."recorded_by_user_id" AND "result_snapshot"->>'correctionId'=NEW."id"::text AND xmin=pg_current_xact_id()::text::xid;
  IF receipt_row."id" IS NULL OR receipt_row."result_snapshot" IS DISTINCT FROM jsonb_build_object('caseId',NEW."case_id",'correctionId',NEW."id",'recordedAt',to_char(NEW."recorded_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'closureId',NEW."closure_id",'closureRevision',NEW."to_revision",'closeAt',NEW."close_at") THEN RAISE EXCEPTION 'section correction receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

COMMIT;
