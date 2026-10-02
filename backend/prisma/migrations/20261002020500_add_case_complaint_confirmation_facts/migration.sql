BEGIN;
ALTER TABLE "cases" DROP CONSTRAINT "cases_matching_state_check";
ALTER TABLE "cases" ADD CONSTRAINT "cases_matching_state_check" CHECK (
  "version" >= 1 AND (
    ("stage" = 'PENDING_MATCH' AND "matched_at" IS NULL) OR
    ("stage" IN ('WAITING_COMPLAINT', 'WAITING_COMPLAINT_CONFIRMATION', 'WAITING_COMPLAINT_STAMP') AND "matched_at" IS NOT NULL)
  )
);
ALTER TABLE "cases" DROP CONSTRAINT "cases_complaint_state_check";
ALTER TABLE "cases" ADD CONSTRAINT "cases_complaint_state_check" CHECK (
  ("stage" IN ('PENDING_MATCH', 'WAITING_COMPLAINT') AND "complaint_submitted_at" IS NULL AND "complaint_submitted_by_user_id" IS NULL AND "complaint_amount_state" IS NULL AND "complaint_amount" IS NULL AND "complaint_pending_reason" IS NULL)
  OR
  ("stage" IN ('WAITING_COMPLAINT_CONFIRMATION', 'WAITING_COMPLAINT_STAMP') AND "complaint_submitted_at" IS NOT NULL AND "complaint_submitted_by_user_id" IS NOT NULL AND "complaint_amount_state" IS NOT NULL AND (("complaint_amount_state" = 'KNOWN' AND "complaint_amount" IS NOT NULL AND "complaint_amount" >= 0 AND "complaint_pending_reason" IS NULL) OR ("complaint_amount_state" = 'PENDING' AND "complaint_amount" IS NULL AND "complaint_pending_reason" IS NOT NULL AND CHAR_LENGTH(BTRIM("complaint_pending_reason")) > 0)))
);

CREATE TABLE "case_complaint_confirmations" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "confirmed_complaint_content_version_id" UUID NOT NULL,
  "amount_state" "case_complaint_amount_state" NOT NULL,
  "amount" DECIMAL(16,2),
  "pending_reason" VARCHAR(500),
  "change_note" VARCHAR(500),
  "confirm_disclose" BOOLEAN NOT NULL,
  "confirmed_by_user_id" UUID NOT NULL,
  "confirmed_at" TIMESTAMPTZ(3) NOT NULL,
  "audit_event_id" UUID NOT NULL,
  CONSTRAINT "case_complaint_confirmations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_complaint_confirmations_case_id_key" UNIQUE ("case_id"),
  CONSTRAINT "case_complaint_confirmations_case_id_department_id_key" UNIQUE ("case_id", "department_id"),
  CONSTRAINT "case_complaint_confirmations_audit_event_id_key" UNIQUE ("audit_event_id"),
  CONSTRAINT "case_complaint_confirmations_amount_check" CHECK (
    ("amount_state" = 'KNOWN' AND "amount" IS NOT NULL AND "amount" >= 0 AND "pending_reason" IS NULL)
    OR ("amount_state" = 'PENDING' AND "amount" IS NULL AND "pending_reason" IS NOT NULL AND CHAR_LENGTH(BTRIM("pending_reason")) BETWEEN 1 AND 500)
  ),
  CONSTRAINT "case_complaint_confirmations_change_note_check" CHECK (
    "change_note" IS NULL OR ("change_note" = BTRIM("change_note") AND CHAR_LENGTH("change_note") BETWEEN 1 AND 500)
  ),
  CONSTRAINT "case_complaint_confirmations_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_complaint_confirmations_content_version_fkey" FOREIGN KEY ("confirmed_complaint_content_version_id") REFERENCES "content_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_complaint_confirmations_actor_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_complaint_confirmations_audit_event_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_complaint_confirmation_receipts" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_complaint_confirmation_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_complaint_confirmation_receipts_department_id_actor_user_id_idempotency_key_key" UNIQUE ("department_id", "actor_user_id", "idempotency_key"),
  CONSTRAINT "case_complaint_confirmation_receipts_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_complaint_confirmation_receipts_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE FUNCTION "check_case_complaint_confirmation_stage"() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "cases" AS c
    WHERE c."id" = NEW."case_id" AND c."department_id" = NEW."department_id"
      AND c."stage" = 'WAITING_COMPLAINT_STAMP'
      AND c."complaint_submitted_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'case must be submitted and waiting for complaint stamp' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "audit_events" AS a
    WHERE a."id" = NEW."audit_event_id" AND a."department_id" = NEW."department_id"
      AND a."resource_type" = 'CASE' AND a."resource_id" = NEW."case_id"
      AND a."actor_user_id" = NEW."confirmed_by_user_id"
      AND a."action" = 'case.complaint.confirmed'
  ) THEN
    RAISE EXCEPTION 'confirmation audit identity mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "case_complaint_confirmations_stage_guard"
  BEFORE INSERT ON "case_complaint_confirmations"
  FOR EACH ROW EXECUTE FUNCTION "check_case_complaint_confirmation_stage"();

CREATE FUNCTION "reject_case_complaint_confirmation_mutation"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'case complaint confirmation fact is immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "case_complaint_confirmations_immutable"
  BEFORE UPDATE OR DELETE ON "case_complaint_confirmations"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_complaint_confirmation_mutation"();
COMMIT;
