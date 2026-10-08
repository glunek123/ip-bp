BEGIN;
-- Forward-only extension of the existing shared audit/upload identity function.
-- Only the lawyer CASE schedule audit dispatch is added; upload paths stay unchanged.
CREATE OR REPLACE FUNCTION "enforce_case_client_mailing_actor_path"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE binding_record RECORD; target_case_id UUID; expected_stage TEXT;
BEGIN
  IF NEW."lawyer_account_binding_id" IS NOT NULL THEN
    IF num_nonnulls(NEW."internal_actor_user_id", NEW."notary_office_account_binding_id", NEW."customer_account_binding_id") <> 0 THEN
      RAISE EXCEPTION 'exactly one actor path is required' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'upload_drafts' THEN
      IF NEW."owner_type" <> 'CASE' OR NEW."category" NOT IN ('COMPLAINT', 'AUTHORIZATION', 'MAIL_RECEIPT', 'FILING_EVIDENCE', 'FILING_SCREENSHOT', 'ACCEPTANCE_NOTICE', 'PAYMENT_LIST', 'SERVICE_DOCUMENT', 'JUDGMENT') OR NEW."purpose" <> NEW."category"::text THEN
        RAISE EXCEPTION 'lawyer draft owner or category invalid' USING ERRCODE = '23514';
      END IF;
      IF TG_OP = 'UPDATE' AND OLD."lawyer_account_binding_id" IS NOT NULL AND
         (to_jsonb(NEW) - 'status' - 'pending_storage_key' - 'updated_at') =
         (to_jsonb(OLD) - 'status' - 'pending_storage_key' - 'updated_at') AND
         NEW."updated_at" >= OLD."updated_at" AND (
           (OLD."status" = 'OPEN' AND NEW."status" = 'EXPIRED' AND OLD."expires_at" <= CURRENT_TIMESTAMP
             AND NEW."pending_storage_key" IS NOT DISTINCT FROM OLD."pending_storage_key") OR
           (OLD."pending_storage_key" IS NOT NULL AND NEW."pending_storage_key" IS NULL
             AND NEW."status" = OLD."status")
         ) THEN
        RETURN NEW;
      END IF;
      target_case_id := NEW."owner_id";
      expected_stage := CASE
        WHEN NEW."category" = 'COMPLAINT' THEN 'WAITING_COMPLAINT,WAITING_COMPLAINT_CONFIRMATION'
        WHEN NEW."category" = 'AUTHORIZATION' THEN 'WAITING_COMPLAINT'
        WHEN NEW."category" = 'MAIL_RECEIPT' THEN 'WAITING_COMPLAINT_STAMP'
        WHEN NEW."category" IN ('ACCEPTANCE_NOTICE', 'PAYMENT_LIST', 'SERVICE_DOCUMENT') THEN 'WAITING_FORMAL_ACCEPTANCE,WAITING_HEARING'
        WHEN NEW."category" = 'JUDGMENT' THEN 'WAITING_JUDGMENT'
        ELSE 'WAITING_FILING' END;
    ELSIF TG_TABLE_NAME = 'audit_events' THEN
      IF NEW."resource_type" = 'CASE' THEN
        target_case_id := NEW."resource_id";
        expected_stage := CASE NEW."action"
          WHEN 'case.complaint.submitted' THEN 'WAITING_COMPLAINT_CONFIRMATION'
          WHEN 'case.complaint.confirmed' THEN 'WAITING_COMPLAINT_STAMP'
          WHEN 'case.complaint.mailed' THEN 'WAITING_FILING'
          WHEN 'case.filing.submitted' THEN 'WAITING_FORMAL_ACCEPTANCE'
          WHEN 'case.acceptance.registered' THEN 'WAITING_HEARING'
          WHEN 'case.hearing.scheduled' THEN 'WAITING_HEARING'
          WHEN 'case.judgment.registered' THEN 'WAITING_JUDGMENT'
          ELSE NULL END;
        IF expected_stage IS NULL THEN
          RAISE EXCEPTION 'lawyer audit action invalid' USING ERRCODE = '23514';
        END IF;
      ELSIF NEW."resource_type" = 'material' AND NEW."action" IN ('material.deleted', 'material.restored') THEN
        SELECT m."owner_id" INTO target_case_id FROM "materials" m
          WHERE m."id" = NEW."resource_id" AND m."department_id" = NEW."department_id"
            AND m."owner_type" = 'CASE' AND EXISTS (
              SELECT 1 FROM "content_versions" v WHERE v."id" = m."current_version_id" AND v."uploaded_by" = NEW."actor_user_id"
            );
        IF target_case_id IS NULL THEN RAISE EXCEPTION 'lawyer material audit invalid' USING ERRCODE = '23514'; END IF;
      ELSE
        RAISE EXCEPTION 'lawyer audit resource invalid' USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'unsupported lawyer actor table' USING ERRCODE = '23514';
    END IF;
    SELECT b."id", b."active", c."stage" INTO binding_record
    FROM "lawyer_account_bindings" b
    JOIN "user_accounts" u ON u."id" = b."user_id" AND u."account_type" = 'LAWYER' AND u."active"
    JOIN "case_lawyer_assignments" a ON a."lawyer_id" = b."profile_id" AND a."department_id" = b."department_id"
      AND a."case_id" = target_case_id AND a."role" = 'PRIMARY' AND a."ended_at" IS NULL
    JOIN "cases" c ON c."id" = a."case_id" AND c."department_id" = a."department_id"
    WHERE b."id" = NEW."lawyer_account_binding_id" AND b."user_id" = NEW."actor_user_id"
      AND b."department_id" = NEW."department_id";
    IF binding_record."id" IS NULL OR NOT binding_record."active" OR
       (TG_OP = 'INSERT' AND expected_stage IS NOT NULL AND binding_record."stage"::text <> ALL(string_to_array(expected_stage, ','))) THEN
      RAISE EXCEPTION 'lawyer actor assignment or stage invalid' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."customer_account_binding_id" IS NULL THEN
    IF NEW."notary_office_account_binding_id" IS NULL THEN
      NEW."internal_actor_user_id" := NEW."actor_user_id";
    ELSIF NEW."internal_actor_user_id" IS NOT NULL THEN
      RAISE EXCEPTION 'exactly one actor path is required' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."internal_actor_user_id" IS NOT NULL OR NEW."notary_office_account_binding_id" IS NOT NULL THEN
    RAISE EXCEPTION 'exactly one actor path is required' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'upload_drafts' THEN
    IF NEW."owner_type" <> 'CASE' OR NEW."category" <> 'MAIL_RECEIPT' OR NEW."purpose" <> 'MAIL_RECEIPT' THEN
      RAISE EXCEPTION 'client actor is limited to CASE mailing receipts' USING ERRCODE = '23514';
    END IF;
    SELECT b."id", b."active", c."stage" INTO binding_record
    FROM "customer_account_bindings" b
    JOIN "user_accounts" u ON u."id" = b."user_id" AND u."account_type" = 'CLIENT'
    JOIN "cases" c ON c."id" = NEW."owner_id" AND c."department_id" = b."department_id" AND c."customer_id" = b."customer_id"
    WHERE b."id" = NEW."customer_account_binding_id" AND b."user_id" = NEW."actor_user_id" AND b."department_id" = NEW."department_id";
    IF binding_record."id" IS NULL OR (TG_OP = 'INSERT' AND (NOT binding_record."active" OR binding_record."stage" <> 'WAITING_COMPLAINT_STAMP')) THEN
      RAISE EXCEPTION 'client mailing draft identity or stage mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'audit_events' THEN
    IF NEW."resource_type" <> 'CASE' OR NEW."action" <> 'case.complaint.mailed' THEN
      RAISE EXCEPTION 'client actor is limited to CASE mailing audit' USING ERRCODE = '23514';
    END IF;
    SELECT b."id", b."active", c."stage" INTO binding_record
    FROM "customer_account_bindings" b
    JOIN "user_accounts" u ON u."id" = b."user_id" AND u."account_type" = 'CLIENT'
    JOIN "cases" c ON c."id" = NEW."resource_id" AND c."department_id" = b."department_id" AND c."customer_id" = b."customer_id"
    WHERE b."id" = NEW."customer_account_binding_id" AND b."user_id" = NEW."actor_user_id" AND b."department_id" = NEW."department_id";
    IF binding_record."id" IS NULL OR (TG_OP = 'INSERT' AND (NOT binding_record."active" OR binding_record."stage" <> 'WAITING_FILING')) THEN
      RAISE EXCEPTION 'client mailing audit identity or stage mismatch' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported client actor table' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
COMMIT;
