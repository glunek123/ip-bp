-- Keep the litigation history readable and immutable after a real early
-- closure source is recorded. The 120000 source INSERT gate stays in place.
BEGIN;

CREATE FUNCTION "case_early_closure_stop_litigation"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_case uuid;
  target_department uuid;
  locked_case uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_case := OLD."case_id";
    target_department := OLD."department_id";
  ELSE
    target_case := NEW."case_id";
    target_department := NEW."department_id";
  END IF;

  -- Serializes with a future early-closure source writer, which must lock
  -- the same cases row before inserting its fact. Also covers the old owner
  -- of a row whose case/department is being changed.
  IF TG_OP = 'UPDATE' AND
     (OLD."case_id" IS DISTINCT FROM NEW."case_id" OR
      OLD."department_id" IS DISTINCT FROM NEW."department_id") THEN
    PERFORM 1 FROM "cases" WHERE "id" = OLD."case_id" AND
      "department_id" = OLD."department_id" FOR UPDATE;
    IF EXISTS (SELECT 1 FROM "case_early_closures" WHERE
      "case_id" = OLD."case_id" AND "department_id" = OLD."department_id") THEN
      RAISE EXCEPTION 'litigation fact cannot change after early closure'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  SELECT "id" INTO locked_case FROM "cases" WHERE "id" = target_case AND
    "department_id" = target_department FOR UPDATE;
  IF locked_case IS NULL THEN
    RAISE EXCEPTION 'litigation fact case is missing' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "case_early_closures" WHERE
    "case_id" = target_case AND "department_id" = target_department) THEN
    RAISE EXCEPTION 'litigation fact cannot change after early closure'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

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
    'case_execution_finishes', 'case_execution_finish_versions', 'case_execution_finish_receipts'
  ] LOOP
    IF to_regclass(format('%I.%I', current_schema(), table_name)) IS NULL THEN
      RAISE EXCEPTION 'missing litigation fact table %', table_name USING ERRCODE = '23514';
    END IF;
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION "case_early_closure_stop_litigation"()',
      'early_closure_stop_' || table_name, table_name
    );
  END LOOP;
END;
$stop$;

COMMIT;
