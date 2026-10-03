BEGIN;
ALTER TABLE "cases" DROP CONSTRAINT "cases_matching_state_check";
ALTER TABLE "cases" ADD CONSTRAINT "cases_matching_state_check" CHECK (
  "version" >= 1 AND (("stage" = 'PENDING_MATCH' AND "matched_at" IS NULL) OR
  ("stage" IN ('WAITING_COMPLAINT', 'WAITING_COMPLAINT_CONFIRMATION', 'WAITING_COMPLAINT_STAMP', 'WAITING_FILING', 'WAITING_FORMAL_ACCEPTANCE') AND "matched_at" IS NOT NULL))
);
ALTER TABLE "cases" DROP CONSTRAINT "cases_complaint_state_check";
ALTER TABLE "cases" ADD CONSTRAINT "cases_complaint_state_check" CHECK (
  ("stage" IN ('PENDING_MATCH', 'WAITING_COMPLAINT') AND "complaint_submitted_at" IS NULL AND "complaint_submitted_by_user_id" IS NULL AND "complaint_amount_state" IS NULL AND "complaint_amount" IS NULL AND "complaint_pending_reason" IS NULL) OR
  ("stage" IN ('WAITING_COMPLAINT_CONFIRMATION', 'WAITING_COMPLAINT_STAMP', 'WAITING_FILING', 'WAITING_FORMAL_ACCEPTANCE') AND "complaint_submitted_at" IS NOT NULL AND "complaint_submitted_by_user_id" IS NOT NULL AND "complaint_amount_state" IS NOT NULL AND
    (("complaint_amount_state" = 'KNOWN' AND "complaint_amount" IS NOT NULL AND "complaint_amount" >= 0 AND "complaint_pending_reason" IS NULL) OR
     ("complaint_amount_state" = 'PENDING' AND "complaint_amount" IS NULL AND "complaint_pending_reason" IS NOT NULL AND CHAR_LENGTH(BTRIM("complaint_pending_reason")) > 0)))
);

CREATE TABLE "filing_courts" (
  "id" UUID NOT NULL PRIMARY KEY,
  "department_id" UUID NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "filing_courts_id_department_id_key" UNIQUE ("id", "department_id"),
  CONSTRAINT "filing_courts_department_id_name_key" UNIQUE ("department_id", "name"),
  CONSTRAINT "filing_courts_name_check" CHECK (CHAR_LENGTH(BTRIM("name")) BETWEEN 1 AND 200 AND "name" = BTRIM("name")),
  CONSTRAINT "filing_courts_department_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "case_filing_submissions" (
  "id" UUID NOT NULL PRIMARY KEY,
  "department_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "court_id" UUID NOT NULL,
  "court_name" VARCHAR(200) NOT NULL,
  "submitted_at" DATE NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by_user_id" UUID NOT NULL,
  "mediation_no" VARCHAR(100),
  "audit_event_id" UUID NOT NULL,
  CONSTRAINT "case_filing_submissions_case_id_key" UNIQUE ("case_id"),
  CONSTRAINT "case_filing_submissions_case_id_department_id_key" UNIQUE ("case_id", "department_id"),
  CONSTRAINT "case_filing_submissions_id_case_id_department_id_key" UNIQUE ("id", "case_id", "department_id"),
  CONSTRAINT "case_filing_submissions_audit_event_id_key" UNIQUE ("audit_event_id"),
  CONSTRAINT "case_filing_submissions_date_check" CHECK ("submitted_at" <= ("recorded_at" AT TIME ZONE 'Asia/Shanghai')::date),
  CONSTRAINT "case_filing_submissions_mediation_no_check" CHECK ("mediation_no" IS NULL OR (CHAR_LENGTH(BTRIM("mediation_no")) BETWEEN 1 AND 100 AND "mediation_no" = BTRIM("mediation_no"))),
  CONSTRAINT "case_filing_submissions_court_name_check" CHECK (CHAR_LENGTH(BTRIM("court_name")) BETWEEN 1 AND 200),
  CONSTRAINT "case_filing_submissions_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_filing_submissions_court_fkey" FOREIGN KEY ("court_id", "department_id") REFERENCES "filing_courts"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_filing_submissions_actor_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_filing_submissions_audit_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "case_filing_versions" (
  "submission_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "material_id" UUID NOT NULL,
  "content_version_id" UUID NOT NULL,
  "category" "material_category" NOT NULL,
  CONSTRAINT "case_filing_versions_pkey" PRIMARY KEY ("submission_id", "content_version_id"),
  CONSTRAINT "case_filing_versions_category_check" CHECK ("category" IN ('FILING_EVIDENCE', 'FILING_SCREENSHOT')),
  CONSTRAINT "case_filing_versions_submission_fkey" FOREIGN KEY ("submission_id", "case_id", "department_id") REFERENCES "case_filing_submissions"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_filing_versions_content_fkey" FOREIGN KEY ("material_id", "content_version_id") REFERENCES "content_versions"("material_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "case_filing_receipts" (
  "id" UUID NOT NULL PRIMARY KEY,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_filing_receipts_department_id_actor_user_id_idempotency_key_key" UNIQUE ("department_id", "actor_user_id", "idempotency_key"),
  CONSTRAINT "case_filing_receipts_key_check" CHECK (CHAR_LENGTH(BTRIM("idempotency_key")) BETWEEN 1 AND 128 AND "idempotency_key" = BTRIM("idempotency_key")),
  CONSTRAINT "case_filing_receipts_fingerprint_check" CHECK ("request_fingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "case_filing_receipts_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_filing_receipts_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE FUNCTION "check_case_filing_fact"() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "cases" c JOIN "case_complaint_mailings" m ON m."case_id" = c."id" AND m."department_id" = c."department_id" WHERE c."id" = NEW."case_id" AND c."department_id" = NEW."department_id" AND c."stage" = 'WAITING_FORMAL_ACCEPTANCE') THEN
    RAISE EXCEPTION 'case must be mailed and waiting for formal acceptance' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "filing_courts" f WHERE f."id" = NEW."court_id" AND f."department_id" = NEW."department_id" AND f."name" = NEW."court_name") THEN
    RAISE EXCEPTION 'filing court snapshot mismatch' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "user_accounts" u WHERE u."id" = NEW."recorded_by_user_id" AND u."account_type" = 'INTERNAL') THEN
    RAISE EXCEPTION 'filing actor must be internal' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id" AND a."department_id" = NEW."department_id" AND a."resource_type" = 'CASE' AND a."resource_id" = NEW."case_id" AND a."actor_user_id" = NEW."recorded_by_user_id" AND a."action" = 'case.filing.submitted') THEN
    RAISE EXCEPTION 'filing audit identity mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "case_filing_submissions_fact_guard" BEFORE INSERT ON "case_filing_submissions" FOR EACH ROW EXECUTE FUNCTION "check_case_filing_fact"();

CREATE FUNCTION "check_case_filing_version"() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "materials" m JOIN "content_versions" v ON v."material_id" = m."id" WHERE m."id" = NEW."material_id" AND v."id" = NEW."content_version_id" AND m."department_id" = NEW."department_id" AND m."owner_type" = 'CASE' AND m."owner_id" = NEW."case_id" AND m."category" = NEW."category" AND m."purpose" = NEW."category"::text AND m."status" = 'ACTIVE' AND v."status" = 'AVAILABLE' AND m."current_version_id" = v."id" AND ((NEW."category" = 'FILING_EVIDENCE' AND v."size_bytes" <= 52428800 AND v."mime_type" IN ('application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png')) OR (NEW."category" = 'FILING_SCREENSHOT' AND v."size_bytes" <= 20971520 AND v."mime_type" IN ('application/pdf','image/jpeg','image/png')))) THEN
    RAISE EXCEPTION 'filing material mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "case_filing_versions_guard" BEFORE INSERT ON "case_filing_versions" FOR EACH ROW EXECUTE FUNCTION "check_case_filing_version"();

CREATE FUNCTION "reject_case_filing_mutation"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'case filing fact is immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "case_filing_submissions_immutable" BEFORE UPDATE OR DELETE ON "case_filing_submissions" FOR EACH ROW EXECUTE FUNCTION "reject_case_filing_mutation"();
CREATE TRIGGER "case_filing_versions_immutable" BEFORE UPDATE OR DELETE ON "case_filing_versions" FOR EACH ROW EXECUTE FUNCTION "reject_case_filing_mutation"();
CREATE TRIGGER "case_filing_receipts_immutable" BEFORE UPDATE OR DELETE ON "case_filing_receipts" FOR EACH ROW EXECUTE FUNCTION "reject_case_filing_mutation"();
COMMIT;
