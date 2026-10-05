BEGIN;

CREATE TABLE "lawyer_account_bindings" (
  "id" UUID NOT NULL PRIMARY KEY,
  "user_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "profile_id" UUID NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "lawyer_account_bindings_profile_id_key" UNIQUE ("profile_id"),
  CONSTRAINT "lawyer_account_bindings_id_user_department_key" UNIQUE ("id", "user_id", "department_id"),
  CONSTRAINT "lawyer_account_bindings_profile_department_key" UNIQUE ("profile_id", "department_id"),
  CONSTRAINT "lawyer_account_bindings_version_check" CHECK ("version" >= 1),
  CONSTRAINT "lawyer_account_bindings_user_fkey" FOREIGN KEY ("user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "lawyer_account_bindings_department_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "lawyer_account_bindings_profile_department_fkey" FOREIGN KEY ("profile_id", "department_id") REFERENCES "lawyer_profiles"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "lawyer_account_bindings_user_department_active_idx" ON "lawyer_account_bindings"("user_id", "department_id", "active");

CREATE FUNCTION "enforce_lawyer_binding_identity"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account_kind "user_account_type";
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."user_id", NEW."department_id", NEW."profile_id") IS DISTINCT FROM
      (OLD."user_id", OLD."department_id", OLD."profile_id") THEN
    RAISE EXCEPTION 'lawyer binding identity is immutable' USING ERRCODE = '23514';
  END IF;
  SELECT u."account_type" INTO account_kind FROM "user_accounts" u
    WHERE u."id" = NEW."user_id" FOR UPDATE;
  IF account_kind IS DISTINCT FROM 'LAWYER' THEN
    RAISE EXCEPTION 'lawyer binding requires a lawyer account' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "lawyer_account_bindings" b
    WHERE b."user_id" = NEW."user_id" AND b."department_id" <> NEW."department_id" AND b."id" <> NEW."id"
  ) THEN
    RAISE EXCEPTION 'lawyer account cannot span departments' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "lawyer_account_bindings_identity" BEFORE INSERT OR UPDATE ON "lawyer_account_bindings"
  FOR EACH ROW EXECUTE FUNCTION "enforce_lawyer_binding_identity"();

CREATE FUNCTION "assert_lawyer_account_binding_cardinality"(target_user_id UUID) RETURNS void LANGUAGE plpgsql AS $$
DECLARE account_kind "user_account_type"; binding_count BIGINT; department_count BIGINT;
BEGIN
  SELECT "account_type" INTO account_kind FROM "user_accounts" WHERE "id" = target_user_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT COUNT(*), COUNT(DISTINCT "department_id") INTO binding_count, department_count
    FROM "lawyer_account_bindings" WHERE "user_id" = target_user_id;
  IF (account_kind = 'LAWYER' AND (binding_count < 1 OR department_count <> 1)) OR
     (account_kind <> 'LAWYER' AND binding_count <> 0) THEN
    RAISE EXCEPTION 'lawyer binding cardinality invalid' USING ERRCODE = '23514';
  END IF;
END;
$$;
CREATE FUNCTION "enforce_user_lawyer_binding_cardinality"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM "assert_lawyer_account_binding_cardinality"(NEW."id"); RETURN NEW; END;
$$;
CREATE CONSTRAINT TRIGGER "user_accounts_lawyer_binding_cardinality" AFTER INSERT OR UPDATE OF "account_type" ON "user_accounts"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "enforce_user_lawyer_binding_cardinality"();
CREATE FUNCTION "enforce_binding_lawyer_account_cardinality"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM "assert_lawyer_account_binding_cardinality"(OLD."user_id"); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM "assert_lawyer_account_binding_cardinality"(NEW."user_id"); END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE CONSTRAINT TRIGGER "lawyer_account_bindings_cardinality" AFTER INSERT OR UPDATE OR DELETE ON "lawyer_account_bindings"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "enforce_binding_lawyer_account_cardinality"();

WITH copied AS (
  INSERT INTO "role_grants" ("id", "role_template_id", "action", "scope")
  SELECT (
    SUBSTR(MD5(g."role_template_id"::text || ':lawyer.account.manage:department'), 1, 8) || '-' ||
    SUBSTR(MD5(g."role_template_id"::text || ':lawyer.account.manage:department'), 9, 4) || '-4' ||
    SUBSTR(MD5(g."role_template_id"::text || ':lawyer.account.manage:department'), 14, 3) || '-8' ||
    SUBSTR(MD5(g."role_template_id"::text || ':lawyer.account.manage:department'), 18, 3) || '-' ||
    SUBSTR(MD5(g."role_template_id"::text || ':lawyer.account.manage:department'), 21, 12)
  )::UUID, g."role_template_id", 'lawyer.account.manage'::"permission_action", 'DEPARTMENT'::"permission_scope"
  FROM "role_grants" g
  WHERE g."action" = 'user.manage'::"permission_action" AND g."scope" = 'DEPARTMENT'::"permission_scope"
  ON CONFLICT ("role_template_id", "action", "scope") DO NOTHING
  RETURNING "role_template_id"
), affected_templates AS (
  UPDATE "role_templates" SET "version" = "version" + 1, "updated_at" = CURRENT_TIMESTAMP
  WHERE "id" IN (SELECT DISTINCT "role_template_id" FROM copied)
  RETURNING "id"
)
UPDATE "user_accounts" SET "authorization_revision" = "authorization_revision" + 1, "updated_at" = CURRENT_TIMESTAMP
WHERE "id" IN (
  SELECT a."user_id" FROM "role_assignments" a
  JOIN affected_templates t ON t."id" = a."role_template_id"
  WHERE a."active"
);

ALTER TABLE "upload_drafts" ADD COLUMN "lawyer_account_binding_id" UUID;
ALTER TABLE "audit_events" ADD COLUMN "lawyer_account_binding_id" UUID;
ALTER TABLE "case_complaint_mailings" ADD COLUMN "lawyer_account_binding_id" UUID;

ALTER TABLE "upload_drafts" DROP CONSTRAINT "upload_drafts_actor_path_check";
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_actor_path_check";
ALTER TABLE "upload_drafts" ADD CONSTRAINT "upload_drafts_actor_path_check"
  CHECK (num_nonnulls("internal_actor_user_id", "notary_office_account_binding_id", "customer_account_binding_id", "lawyer_account_binding_id") = 1);
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_path_check"
  CHECK (num_nonnulls("internal_actor_user_id", "notary_office_account_binding_id", "customer_account_binding_id", "lawyer_account_binding_id") = 1);
ALTER TABLE "upload_drafts" ADD CONSTRAINT "upload_drafts_lawyer_actor_fkey"
  FOREIGN KEY ("lawyer_account_binding_id", "actor_user_id", "department_id")
  REFERENCES "lawyer_account_bindings"("id", "user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_lawyer_actor_fkey"
  FOREIGN KEY ("lawyer_account_binding_id", "actor_user_id", "department_id")
  REFERENCES "lawyer_account_bindings"("id", "user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE OR REPLACE FUNCTION "enforce_case_client_mailing_actor_path"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE binding_record RECORD; case_id UUID; expected_stage TEXT;
BEGIN
  IF NEW."lawyer_account_binding_id" IS NOT NULL THEN
    IF num_nonnulls(NEW."internal_actor_user_id", NEW."notary_office_account_binding_id", NEW."customer_account_binding_id") <> 0 THEN
      RAISE EXCEPTION 'exactly one actor path is required' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'upload_drafts' THEN
      IF NEW."owner_type" <> 'CASE' OR NEW."category" NOT IN ('COMPLAINT', 'AUTHORIZATION', 'MAIL_RECEIPT', 'FILING_EVIDENCE', 'FILING_SCREENSHOT') OR NEW."purpose" <> NEW."category"::text THEN
        RAISE EXCEPTION 'lawyer draft owner or category invalid' USING ERRCODE = '23514';
      END IF;
      case_id := NEW."owner_id";
      expected_stage := CASE
        WHEN NEW."category" = 'COMPLAINT' THEN 'WAITING_COMPLAINT,WAITING_COMPLAINT_CONFIRMATION'
        WHEN NEW."category" = 'AUTHORIZATION' THEN 'WAITING_COMPLAINT'
        WHEN NEW."category" = 'MAIL_RECEIPT' THEN 'WAITING_COMPLAINT_STAMP'
        ELSE 'WAITING_FILING' END;
    ELSIF TG_TABLE_NAME = 'audit_events' THEN
      IF NEW."resource_type" = 'CASE' THEN
        case_id := NEW."resource_id";
        expected_stage := CASE NEW."action"
          WHEN 'case.complaint.submitted' THEN 'WAITING_COMPLAINT_CONFIRMATION'
          WHEN 'case.complaint.confirmed' THEN 'WAITING_COMPLAINT_STAMP'
          WHEN 'case.complaint.mailed' THEN 'WAITING_FILING'
          WHEN 'case.filing.submitted' THEN 'WAITING_FORMAL_ACCEPTANCE'
          ELSE NULL END;
        IF expected_stage IS NULL THEN
          RAISE EXCEPTION 'lawyer audit action invalid' USING ERRCODE = '23514';
        END IF;
      ELSIF NEW."resource_type" = 'material' AND NEW."action" IN ('material.deleted', 'material.restored') THEN
        SELECT m."owner_id" INTO case_id FROM "materials" m
          WHERE m."id" = NEW."resource_id" AND m."department_id" = NEW."department_id"
            AND m."owner_type" = 'CASE' AND EXISTS (
              SELECT 1 FROM "content_versions" v WHERE v."id" = m."current_version_id" AND v."uploaded_by" = NEW."actor_user_id"
            );
        IF case_id IS NULL THEN RAISE EXCEPTION 'lawyer material audit invalid' USING ERRCODE = '23514'; END IF;
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
      AND a."case_id" = case_id AND a."role" = 'PRIMARY' AND a."ended_at" IS NULL
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

ALTER TABLE "case_complaint_mailings" DROP CONSTRAINT "case_complaint_mailings_actor_check";
ALTER TABLE "case_complaint_mailings" ADD CONSTRAINT "case_complaint_mailings_actor_check" CHECK (
  ("actor_type" = 'INTERNAL' AND "customer_account_binding_id" IS NULL AND "lawyer_account_binding_id" IS NULL) OR
  ("actor_type" = 'CLIENT' AND "customer_account_binding_id" IS NOT NULL AND "lawyer_account_binding_id" IS NULL) OR
  ("actor_type" = 'LAWYER' AND "customer_account_binding_id" IS NULL AND "lawyer_account_binding_id" IS NOT NULL)
);
ALTER TABLE "case_complaint_mailings" ADD CONSTRAINT "case_complaint_mailings_lawyer_binding_fkey"
  FOREIGN KEY ("lawyer_account_binding_id", "recorded_by_user_id", "department_id")
  REFERENCES "lawyer_account_bindings"("id", "user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE OR REPLACE FUNCTION "check_case_complaint_mailing_fact"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "cases" c JOIN "case_complaint_confirmations" cc ON cc."case_id" = c."id" AND cc."department_id" = c."department_id"
    WHERE c."id" = NEW."case_id" AND c."department_id" = NEW."department_id" AND c."stage" = 'WAITING_FILING') THEN
    RAISE EXCEPTION 'case must be confirmed and waiting for filing' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "user_accounts" u WHERE u."id" = NEW."recorded_by_user_id" AND u."account_type" = NEW."actor_type") THEN
    RAISE EXCEPTION 'mailing actor type mismatch' USING ERRCODE = '23514';
  END IF;
  IF NEW."actor_type" = 'CLIENT' AND NOT EXISTS (
    SELECT 1 FROM "customer_account_bindings" b JOIN "cases" c ON c."id" = NEW."case_id"
    WHERE b."id" = NEW."customer_account_binding_id" AND b."user_id" = NEW."recorded_by_user_id"
      AND b."department_id" = NEW."department_id" AND b."customer_id" = c."customer_id") THEN
    RAISE EXCEPTION 'mailing client identity mismatch' USING ERRCODE = '23514';
  END IF;
  IF NEW."actor_type" = 'LAWYER' AND NOT EXISTS (
    SELECT 1 FROM "lawyer_account_bindings" b
    JOIN "case_lawyer_assignments" a ON a."lawyer_id" = b."profile_id" AND a."department_id" = b."department_id"
    WHERE b."id" = NEW."lawyer_account_binding_id" AND b."user_id" = NEW."recorded_by_user_id"
      AND b."department_id" = NEW."department_id" AND b."active" AND a."case_id" = NEW."case_id"
      AND a."role" = 'PRIMARY' AND a."ended_at" IS NULL) THEN
    RAISE EXCEPTION 'mailing lawyer identity mismatch' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id" AND a."department_id" = NEW."department_id"
    AND a."resource_type" = 'CASE' AND a."resource_id" = NEW."case_id"
    AND a."actor_user_id" = NEW."recorded_by_user_id" AND a."action" = 'case.complaint.mailed'
    AND (NEW."actor_type" <> 'LAWYER' OR a."lawyer_account_binding_id" = NEW."lawyer_account_binding_id")) THEN
    RAISE EXCEPTION 'mailing audit identity mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "check_case_filing_fact"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "cases" c JOIN "case_complaint_mailings" m ON m."case_id" = c."id" AND m."department_id" = c."department_id"
    WHERE c."id" = NEW."case_id" AND c."department_id" = NEW."department_id" AND c."stage" = 'WAITING_FORMAL_ACCEPTANCE') THEN
    RAISE EXCEPTION 'case must be mailed and waiting for formal acceptance' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "filing_courts" f WHERE f."id" = NEW."court_id" AND f."department_id" = NEW."department_id" AND f."name" = NEW."court_name") THEN
    RAISE EXCEPTION 'filing court snapshot mismatch' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "user_accounts" u WHERE u."id" = NEW."recorded_by_user_id" AND u."account_type" IN ('INTERNAL', 'LAWYER')) THEN
    RAISE EXCEPTION 'filing actor type invalid' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id" AND a."department_id" = NEW."department_id"
    AND a."resource_type" = 'CASE' AND a."resource_id" = NEW."case_id" AND a."actor_user_id" = NEW."recorded_by_user_id"
    AND a."action" = 'case.filing.submitted') THEN
    RAISE EXCEPTION 'filing audit identity mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
