BEGIN;

-- Only CASE mailing drafts and their success audit may use a customer binding.
-- The existing dual-actor function remains attached to all other tables.
ALTER TABLE "upload_drafts" ADD COLUMN "customer_account_binding_id" UUID;
ALTER TABLE "audit_events" ADD COLUMN "customer_account_binding_id" UUID;

ALTER TABLE "upload_drafts" DROP CONSTRAINT "upload_drafts_actor_path_check";
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_actor_path_check";
ALTER TABLE "upload_drafts" ADD CONSTRAINT "upload_drafts_actor_path_check"
  CHECK (num_nonnulls("internal_actor_user_id", "notary_office_account_binding_id", "customer_account_binding_id") = 1);
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_path_check"
  CHECK (num_nonnulls("internal_actor_user_id", "notary_office_account_binding_id", "customer_account_binding_id") = 1);
ALTER TABLE "upload_drafts" ADD CONSTRAINT "upload_drafts_customer_actor_fkey"
  FOREIGN KEY ("customer_account_binding_id", "actor_user_id", "department_id")
  REFERENCES "customer_account_bindings"("id", "user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_customer_actor_fkey"
  FOREIGN KEY ("customer_account_binding_id", "actor_user_id", "department_id")
  REFERENCES "customer_account_bindings"("id", "user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION "enforce_case_client_mailing_actor_path"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE binding_record RECORD;
BEGIN
  IF NEW."customer_account_binding_id" IS NULL THEN
    -- Preserve the pre-existing internal/notary behavior on these two tables.
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
    JOIN "cases" c ON c."id" = NEW."owner_id" AND c."department_id" = b."department_id"
      AND c."customer_id" = b."customer_id"
    WHERE b."id" = NEW."customer_account_binding_id"
      AND b."user_id" = NEW."actor_user_id" AND b."department_id" = NEW."department_id";
    IF binding_record."id" IS NULL OR
      (TG_OP = 'INSERT' AND (NOT binding_record."active" OR binding_record."stage" <> 'WAITING_COMPLAINT_STAMP')) THEN
      RAISE EXCEPTION 'client mailing draft identity or stage mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'audit_events' THEN
    IF NEW."resource_type" <> 'CASE' OR NEW."action" <> 'case.complaint.mailed' THEN
      RAISE EXCEPTION 'client actor is limited to CASE mailing audit' USING ERRCODE = '23514';
    END IF;
    SELECT b."id", b."active", c."stage" INTO binding_record
    FROM "customer_account_bindings" b
    JOIN "user_accounts" u ON u."id" = b."user_id" AND u."account_type" = 'CLIENT'
    JOIN "cases" c ON c."id" = NEW."resource_id" AND c."department_id" = b."department_id"
      AND c."customer_id" = b."customer_id"
    WHERE b."id" = NEW."customer_account_binding_id"
      AND b."user_id" = NEW."actor_user_id" AND b."department_id" = NEW."department_id";
    IF binding_record."id" IS NULL OR
      (TG_OP = 'INSERT' AND (NOT binding_record."active" OR binding_record."stage" <> 'WAITING_FILING')) THEN
      RAISE EXCEPTION 'client mailing audit identity or stage mismatch' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported client actor table' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER "upload_drafts_dual_actor" ON "upload_drafts";
DROP TRIGGER "audit_events_dual_actor" ON "audit_events";
CREATE TRIGGER "upload_drafts_case_client_actor" BEFORE INSERT OR UPDATE ON "upload_drafts"
  FOR EACH ROW EXECUTE FUNCTION "enforce_case_client_mailing_actor_path"();
CREATE TRIGGER "audit_events_case_client_actor" BEFORE INSERT OR UPDATE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "enforce_case_client_mailing_actor_path"();

COMMIT;
