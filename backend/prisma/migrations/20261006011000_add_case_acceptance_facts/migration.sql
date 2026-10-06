BEGIN;
ALTER TABLE "cases" DROP CONSTRAINT "cases_matching_state_check";
ALTER TABLE "cases" ADD CONSTRAINT "cases_matching_state_check" CHECK (
  "version" >= 1 AND (("stage" = 'PENDING_MATCH' AND "matched_at" IS NULL) OR
  ("stage" IN ('WAITING_COMPLAINT', 'WAITING_COMPLAINT_CONFIRMATION', 'WAITING_COMPLAINT_STAMP', 'WAITING_FILING', 'WAITING_FORMAL_ACCEPTANCE', 'WAITING_HEARING') AND "matched_at" IS NOT NULL))
);
ALTER TABLE "cases" DROP CONSTRAINT "cases_complaint_state_check";
ALTER TABLE "cases" ADD CONSTRAINT "cases_complaint_state_check" CHECK (
  ("stage" IN ('PENDING_MATCH', 'WAITING_COMPLAINT') AND "complaint_submitted_at" IS NULL AND "complaint_submitted_by_user_id" IS NULL AND "complaint_amount_state" IS NULL AND "complaint_amount" IS NULL AND "complaint_pending_reason" IS NULL) OR
  ("stage" IN ('WAITING_COMPLAINT_CONFIRMATION', 'WAITING_COMPLAINT_STAMP', 'WAITING_FILING', 'WAITING_FORMAL_ACCEPTANCE', 'WAITING_HEARING') AND "complaint_submitted_at" IS NOT NULL AND "complaint_submitted_by_user_id" IS NOT NULL AND "complaint_amount_state" IS NOT NULL AND
    (("complaint_amount_state" = 'KNOWN' AND "complaint_amount" IS NOT NULL AND "complaint_amount" >= 0 AND "complaint_pending_reason" IS NULL) OR
     ("complaint_amount_state" = 'PENDING' AND "complaint_amount" IS NULL AND "complaint_pending_reason" IS NOT NULL AND CHAR_LENGTH(BTRIM("complaint_pending_reason")) > 0)))
);

CREATE TABLE "case_acceptances" (
  "id" UUID NOT NULL PRIMARY KEY,
  "department_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "accepted_at" DATE NOT NULL,
  "court_case_no" VARCHAR(100) NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by_user_id" UUID NOT NULL,
  "audit_event_id" UUID NOT NULL,
  CONSTRAINT "case_acceptances_case_id_key" UNIQUE ("case_id"),
  CONSTRAINT "case_acceptances_case_id_department_id_key" UNIQUE ("case_id", "department_id"),
  CONSTRAINT "case_acceptances_id_case_id_department_id_key" UNIQUE ("id", "case_id", "department_id"),
  CONSTRAINT "case_acceptances_audit_event_id_key" UNIQUE ("audit_event_id"),
  CONSTRAINT "case_acceptances_no_check" CHECK (CHAR_LENGTH(BTRIM("court_case_no")) BETWEEN 1 AND 100 AND "court_case_no" = BTRIM("court_case_no")),
  CONSTRAINT "case_acceptances_date_check" CHECK ("accepted_at" <= ("recorded_at" AT TIME ZONE 'Asia/Shanghai')::date),
  CONSTRAINT "case_acceptances_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_acceptances_actor_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_acceptances_audit_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "case_acceptance_versions" (
  "acceptance_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "material_id" UUID NOT NULL,
  "content_version_id" UUID NOT NULL,
  "category" "material_category" NOT NULL,
  CONSTRAINT "case_acceptance_versions_pkey" PRIMARY KEY ("acceptance_id", "content_version_id"),
  CONSTRAINT "case_acceptance_versions_category_check" CHECK ("category" IN ('ACCEPTANCE_NOTICE', 'PAYMENT_LIST', 'SERVICE_DOCUMENT')),
  CONSTRAINT "case_acceptance_versions_acceptance_fkey" FOREIGN KEY ("acceptance_id", "case_id", "department_id") REFERENCES "case_acceptances"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_acceptance_versions_content_fkey" FOREIGN KEY ("material_id", "content_version_id") REFERENCES "content_versions"("material_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "case_acceptance_receipts" (
  "id" UUID NOT NULL PRIMARY KEY,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_acceptance_receipts_department_actor_key" UNIQUE ("department_id", "actor_user_id", "idempotency_key"),
  CONSTRAINT "case_acceptance_receipts_key_check" CHECK (CHAR_LENGTH(BTRIM("idempotency_key")) BETWEEN 1 AND 128 AND "idempotency_key" = BTRIM("idempotency_key")),
  CONSTRAINT "case_acceptance_receipts_fingerprint_check" CHECK ("request_fingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "case_acceptance_receipts_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_acceptance_receipts_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE FUNCTION "check_case_acceptance_fact"() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "cases" c JOIN "case_filing_submissions" f
      ON f."case_id" = c."id" AND f."department_id" = c."department_id"
    WHERE c."id" = NEW."case_id" AND c."department_id" = NEW."department_id"
      AND c."stage" = 'WAITING_HEARING' AND c."court_case_no" = NEW."court_case_no"
      AND NEW."accepted_at" >= f."submitted_at"
  ) THEN
    RAISE EXCEPTION 'case must be filed and waiting for hearing with matching acceptance' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
      AND a."department_id" = NEW."department_id" AND a."resource_type" = 'CASE'
      AND a."resource_id" = NEW."case_id" AND a."actor_user_id" = NEW."recorded_by_user_id"
      AND a."action" = 'case.acceptance.registered'
  ) THEN
    RAISE EXCEPTION 'acceptance audit identity mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "case_acceptances_fact_guard" BEFORE INSERT ON "case_acceptances" FOR EACH ROW EXECUTE FUNCTION "check_case_acceptance_fact"();

CREATE FUNCTION "check_case_acceptance_version"() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "materials" m JOIN "content_versions" v ON v."material_id" = m."id"
    WHERE m."id" = NEW."material_id" AND v."id" = NEW."content_version_id"
      AND m."department_id" = NEW."department_id" AND m."owner_type" = 'CASE'
      AND m."owner_id" = NEW."case_id" AND m."category" = NEW."category"
      AND m."purpose" = NEW."category"::text AND m."status" = 'ACTIVE'
      AND v."status" = 'AVAILABLE' AND m."current_version_id" = v."id"
      AND v."size_bytes" <= 52428800
      AND v."mime_type" IN ('application/pdf','image/jpeg','image/png')
  ) THEN
    RAISE EXCEPTION 'acceptance material mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "case_acceptance_versions_guard" BEFORE INSERT ON "case_acceptance_versions" FOR EACH ROW EXECUTE FUNCTION "check_case_acceptance_version"();

CREATE FUNCTION "reject_case_acceptance_mutation"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'case acceptance fact is immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "case_acceptances_immutable" BEFORE UPDATE OR DELETE ON "case_acceptances" FOR EACH ROW EXECUTE FUNCTION "reject_case_acceptance_mutation"();
CREATE TRIGGER "case_acceptance_versions_immutable" BEFORE UPDATE OR DELETE ON "case_acceptance_versions" FOR EACH ROW EXECUTE FUNCTION "reject_case_acceptance_mutation"();
CREATE TRIGGER "case_acceptance_receipts_immutable" BEFORE UPDATE OR DELETE ON "case_acceptance_receipts" FOR EACH ROW EXECUTE FUNCTION "reject_case_acceptance_mutation"();
COMMIT;
