BEGIN;
ALTER TABLE "customer_account_bindings" ADD CONSTRAINT "customer_account_bindings_mailing_identity_key" UNIQUE ("id", "user_id", "department_id");
ALTER TABLE "cases" DROP CONSTRAINT "cases_matching_state_check";
ALTER TABLE "cases" ADD CONSTRAINT "cases_matching_state_check" CHECK (
  "version" >= 1 AND (
    ("stage" = 'PENDING_MATCH' AND "matched_at" IS NULL) OR
    ("stage" IN ('WAITING_COMPLAINT', 'WAITING_COMPLAINT_CONFIRMATION', 'WAITING_COMPLAINT_STAMP', 'WAITING_FILING') AND "matched_at" IS NOT NULL)
  )
);
ALTER TABLE "cases" DROP CONSTRAINT "cases_complaint_state_check";
ALTER TABLE "cases" ADD CONSTRAINT "cases_complaint_state_check" CHECK (
  ("stage" IN ('PENDING_MATCH', 'WAITING_COMPLAINT') AND "complaint_submitted_at" IS NULL AND "complaint_submitted_by_user_id" IS NULL AND "complaint_amount_state" IS NULL AND "complaint_amount" IS NULL AND "complaint_pending_reason" IS NULL)
  OR
  ("stage" IN ('WAITING_COMPLAINT_CONFIRMATION', 'WAITING_COMPLAINT_STAMP', 'WAITING_FILING') AND "complaint_submitted_at" IS NOT NULL AND "complaint_submitted_by_user_id" IS NOT NULL AND "complaint_amount_state" IS NOT NULL AND (("complaint_amount_state" = 'KNOWN' AND "complaint_amount" IS NOT NULL AND "complaint_amount" >= 0 AND "complaint_pending_reason" IS NULL) OR ("complaint_amount_state" = 'PENDING' AND "complaint_amount" IS NULL AND "complaint_pending_reason" IS NOT NULL AND CHAR_LENGTH(BTRIM("complaint_pending_reason")) > 0)))
);

CREATE TABLE "case_complaint_mailings" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "mailed_at" DATE NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by_user_id" UUID NOT NULL,
  "actor_type" "user_account_type" NOT NULL,
  "customer_account_binding_id" UUID,
  "audit_event_id" UUID NOT NULL,
  CONSTRAINT "case_complaint_mailings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_complaint_mailings_case_id_key" UNIQUE ("case_id"),
  CONSTRAINT "case_complaint_mailings_case_id_department_id_key" UNIQUE ("case_id", "department_id"),
  CONSTRAINT "case_complaint_mailings_id_case_id_department_id_key" UNIQUE ("id", "case_id", "department_id"),
  CONSTRAINT "case_complaint_mailings_audit_event_id_key" UNIQUE ("audit_event_id"),
  CONSTRAINT "case_complaint_mailings_actor_check" CHECK (
    ("actor_type" = 'INTERNAL' AND "customer_account_binding_id" IS NULL) OR
    ("actor_type" = 'CLIENT' AND "customer_account_binding_id" IS NOT NULL)
  ),
  CONSTRAINT "case_complaint_mailings_date_check" CHECK ("mailed_at" <= ("recorded_at" AT TIME ZONE 'Asia/Shanghai')::date),
  CONSTRAINT "case_complaint_mailings_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_complaint_mailings_actor_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_complaint_mailings_binding_fkey" FOREIGN KEY ("customer_account_binding_id", "recorded_by_user_id", "department_id") REFERENCES "customer_account_bindings"("id", "user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_complaint_mailings_audit_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_complaint_mailing_versions" (
  "mailing_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "material_id" UUID NOT NULL,
  "content_version_id" UUID NOT NULL,
  CONSTRAINT "case_complaint_mailing_versions_pkey" PRIMARY KEY ("mailing_id", "content_version_id"),
  CONSTRAINT "case_complaint_mailing_versions_mailing_fkey" FOREIGN KEY ("mailing_id", "case_id", "department_id") REFERENCES "case_complaint_mailings"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_complaint_mailing_versions_content_fkey" FOREIGN KEY ("material_id", "content_version_id") REFERENCES "content_versions"("material_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_complaint_mailing_receipts" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_complaint_mailing_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_complaint_mailing_receipts_department_id_actor_user_id_idempotency_key_key" UNIQUE ("department_id", "actor_user_id", "idempotency_key"),
  CONSTRAINT "case_complaint_mailing_receipts_key_check" CHECK (CHAR_LENGTH(BTRIM("idempotency_key")) BETWEEN 1 AND 128 AND "idempotency_key" = BTRIM("idempotency_key")),
  CONSTRAINT "case_complaint_mailing_receipts_fingerprint_check" CHECK ("request_fingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "case_complaint_mailing_receipts_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_complaint_mailing_receipts_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE FUNCTION "check_case_complaint_mailing_fact"() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "cases" c JOIN "case_complaint_confirmations" cc ON cc."case_id" = c."id" AND cc."department_id" = c."department_id"
    WHERE c."id" = NEW."case_id" AND c."department_id" = NEW."department_id" AND c."stage" = 'WAITING_FILING'
  ) THEN
    RAISE EXCEPTION 'case must be confirmed and waiting for filing' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "user_accounts" u WHERE u."id" = NEW."recorded_by_user_id" AND u."account_type" = NEW."actor_type"
  ) THEN
    RAISE EXCEPTION 'mailing actor type mismatch' USING ERRCODE = '23514';
  END IF;
  IF NEW."actor_type" = 'CLIENT' AND NOT EXISTS (
    SELECT 1 FROM "customer_account_bindings" b JOIN "cases" c ON c."id" = NEW."case_id"
    WHERE b."id" = NEW."customer_account_binding_id" AND b."user_id" = NEW."recorded_by_user_id"
      AND b."department_id" = NEW."department_id" AND b."customer_id" = c."customer_id"
  ) THEN
    RAISE EXCEPTION 'mailing client identity mismatch' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id" AND a."department_id" = NEW."department_id"
      AND a."resource_type" = 'CASE' AND a."resource_id" = NEW."case_id"
      AND a."actor_user_id" = NEW."recorded_by_user_id" AND a."action" = 'case.complaint.mailed'
  ) THEN
    RAISE EXCEPTION 'mailing audit identity mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "case_complaint_mailings_fact_guard" BEFORE INSERT ON "case_complaint_mailings"
  FOR EACH ROW EXECUTE FUNCTION "check_case_complaint_mailing_fact"();

CREATE FUNCTION "check_case_complaint_mailing_version"() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "materials" m JOIN "content_versions" v ON v."material_id" = m."id"
    WHERE m."id" = NEW."material_id" AND v."id" = NEW."content_version_id"
      AND m."department_id" = NEW."department_id" AND m."owner_type" = 'CASE'
      AND m."owner_id" = NEW."case_id" AND m."category" = 'MAIL_RECEIPT' AND m."purpose" = 'MAIL_RECEIPT'
  ) THEN
    RAISE EXCEPTION 'mailing receipt material mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "case_complaint_mailing_versions_guard" BEFORE INSERT ON "case_complaint_mailing_versions"
  FOR EACH ROW EXECUTE FUNCTION "check_case_complaint_mailing_version"();

CREATE FUNCTION "reject_case_complaint_mailing_mutation"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'case complaint mailing is immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "case_complaint_mailings_immutable" BEFORE UPDATE OR DELETE ON "case_complaint_mailings"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_complaint_mailing_mutation"();
CREATE TRIGGER "case_complaint_mailing_versions_immutable" BEFORE UPDATE OR DELETE ON "case_complaint_mailing_versions"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_complaint_mailing_mutation"();
CREATE TRIGGER "case_complaint_mailing_receipts_immutable" BEFORE UPDATE OR DELETE ON "case_complaint_mailing_receipts"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_complaint_mailing_mutation"();
COMMIT;
