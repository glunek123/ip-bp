BEGIN;

ALTER TABLE "cases" ADD COLUMN "current_hearing_arrangement_id" UUID;
ALTER TABLE "cases" ADD COLUMN "current_hearing_advance_id" UUID;
ALTER TABLE "cases" DROP CONSTRAINT "cases_matching_state_check";
ALTER TABLE "cases" ADD CONSTRAINT "cases_matching_state_check" CHECK (
  "version" >= 1 AND (("stage" = 'PENDING_MATCH' AND "matched_at" IS NULL) OR
  ("stage" IN ('WAITING_COMPLAINT', 'WAITING_COMPLAINT_CONFIRMATION', 'WAITING_COMPLAINT_STAMP', 'WAITING_FILING', 'WAITING_FORMAL_ACCEPTANCE', 'WAITING_HEARING', 'WAITING_JUDGMENT') AND "matched_at" IS NOT NULL))
);
ALTER TABLE "cases" DROP CONSTRAINT "cases_complaint_state_check";
ALTER TABLE "cases" ADD CONSTRAINT "cases_complaint_state_check" CHECK (
  ("stage" IN ('PENDING_MATCH', 'WAITING_COMPLAINT') AND "complaint_submitted_at" IS NULL AND "complaint_submitted_by_user_id" IS NULL AND "complaint_amount_state" IS NULL AND "complaint_amount" IS NULL AND "complaint_pending_reason" IS NULL) OR
  ("stage" IN ('WAITING_COMPLAINT_CONFIRMATION', 'WAITING_COMPLAINT_STAMP', 'WAITING_FILING', 'WAITING_FORMAL_ACCEPTANCE', 'WAITING_HEARING', 'WAITING_JUDGMENT') AND "complaint_submitted_at" IS NOT NULL AND "complaint_submitted_by_user_id" IS NOT NULL AND "complaint_amount_state" IS NOT NULL AND
    (("complaint_amount_state" = 'KNOWN' AND "complaint_amount" IS NOT NULL AND "complaint_amount" >= 0 AND "complaint_pending_reason" IS NULL) OR
     ("complaint_amount_state" = 'PENDING' AND "complaint_amount" IS NULL AND "complaint_pending_reason" IS NOT NULL AND CHAR_LENGTH(BTRIM("complaint_pending_reason")) > 0)))
);

ALTER TABLE "audit_events" ALTER COLUMN "actor_user_id" DROP NOT NULL;
ALTER TABLE "audit_events" ADD COLUMN "actor_kind" "audit_actor_kind" NOT NULL DEFAULT 'HUMAN';
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_actor_path_check";
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_path_check" CHECK (
  ("actor_kind" = 'HUMAN' AND "actor_user_id" IS NOT NULL AND
   num_nonnulls("internal_actor_user_id", "notary_office_account_binding_id", "customer_account_binding_id", "lawyer_account_binding_id") = 1 AND
   "action" <> 'case.hearing.auto_advanced') OR
  ("actor_kind" = 'SYSTEM' AND "actor_user_id" IS NULL AND
   num_nonnulls("internal_actor_user_id", "notary_office_account_binding_id", "customer_account_binding_id", "lawyer_account_binding_id") = 0 AND
   "resource_type" = 'CASE' AND "action" = 'case.hearing.auto_advanced')
);

CREATE TABLE "case_hearing_arrangements" (
  "id" UUID PRIMARY KEY,
  "department_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "hearing_at" DATE,
  "source" "case_hearing_source" NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by_user_id" UUID NOT NULL,
  "from_version" INTEGER NOT NULL,
  "to_version" INTEGER NOT NULL,
  "audit_event_id" UUID NOT NULL UNIQUE,
  CONSTRAINT "case_hearing_arrangements_version_check" CHECK ("from_version" >= 1 AND "to_version" = "from_version" + 1),
  CONSTRAINT "case_hearing_arrangements_identity_key" UNIQUE ("id", "case_id", "department_id"),
  CONSTRAINT "case_hearing_arrangements_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_hearing_arrangements_actor_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_hearing_arrangements_audit_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "case_hearing_arrangements_case_recorded_idx" ON "case_hearing_arrangements"("case_id", "recorded_at", "id");

CREATE TABLE "case_hearing_advances" (
  "id" UUID PRIMARY KEY,
  "department_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "arrangement_id" UUID NOT NULL UNIQUE,
  "due_at" TIMESTAMPTZ(3) NOT NULL,
  "executed_at" TIMESTAMPTZ(3) NOT NULL,
  "from_version" INTEGER NOT NULL,
  "to_version" INTEGER NOT NULL,
  "audit_event_id" UUID NOT NULL UNIQUE,
  CONSTRAINT "case_hearing_advances_version_check" CHECK ("from_version" >= 1 AND "to_version" = "from_version" + 1),
  CONSTRAINT "case_hearing_advances_time_check" CHECK ("executed_at" >= "due_at"),
  CONSTRAINT "case_hearing_advances_identity_key" UNIQUE ("id", "case_id", "department_id"),
  CONSTRAINT "case_hearing_advances_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_hearing_advances_arrangement_fkey" FOREIGN KEY ("arrangement_id", "case_id", "department_id") REFERENCES "case_hearing_arrangements"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_hearing_advances_audit_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_hearing_corrections" (
  "id" UUID PRIMARY KEY,
  "department_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "prior_arrangement_id" UUID NOT NULL,
  "prior_advance_id" UUID NOT NULL,
  "new_arrangement_id" UUID NOT NULL UNIQUE,
  "reason" VARCHAR(500) NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by_user_id" UUID NOT NULL,
  "from_version" INTEGER NOT NULL,
  "to_version" INTEGER NOT NULL,
  "result_stage" "case_stage" NOT NULL,
  "audit_event_id" UUID NOT NULL UNIQUE,
  CONSTRAINT "case_hearing_corrections_reason_check" CHECK (CHAR_LENGTH(BTRIM("reason")) BETWEEN 1 AND 500 AND "reason" = BTRIM("reason")),
  CONSTRAINT "case_hearing_corrections_version_check" CHECK ("from_version" >= 1 AND "to_version" = "from_version" + 1),
  CONSTRAINT "case_hearing_corrections_stage_check" CHECK ("result_stage" IN ('WAITING_HEARING', 'WAITING_JUDGMENT')),
  CONSTRAINT "case_hearing_corrections_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_hearing_corrections_prior_arrangement_fkey" FOREIGN KEY ("prior_arrangement_id", "case_id", "department_id") REFERENCES "case_hearing_arrangements"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_hearing_corrections_prior_advance_fkey" FOREIGN KEY ("prior_advance_id", "case_id", "department_id") REFERENCES "case_hearing_advances"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_hearing_corrections_new_arrangement_fkey" FOREIGN KEY ("new_arrangement_id", "case_id", "department_id") REFERENCES "case_hearing_arrangements"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_hearing_corrections_actor_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_hearing_corrections_audit_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "case_hearing_corrections_case_recorded_idx" ON "case_hearing_corrections"("case_id", "recorded_at", "id");

CREATE TABLE "case_hearing_receipts" (
  "id" UUID PRIMARY KEY,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_hearing_receipts_key" UNIQUE ("department_id", "actor_user_id", "action", "idempotency_key"),
  CONSTRAINT "case_hearing_receipts_action_check" CHECK ("action" IN ('SCHEDULE', 'CORRECT')),
  CONSTRAINT "case_hearing_receipts_key_check" CHECK (CHAR_LENGTH(BTRIM("idempotency_key")) BETWEEN 1 AND 128 AND "idempotency_key" = BTRIM("idempotency_key")),
  CONSTRAINT "case_hearing_receipts_fingerprint_check" CHECK ("request_fingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "case_hearing_receipts_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_hearing_receipts_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

ALTER TABLE "cases" ADD CONSTRAINT "cases_current_hearing_arrangement_fkey"
  FOREIGN KEY ("current_hearing_arrangement_id", "id", "department_id") REFERENCES "case_hearing_arrangements"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "cases" ADD CONSTRAINT "cases_current_hearing_advance_fkey"
  FOREIGN KEY ("current_hearing_advance_id", "id", "department_id") REFERENCES "case_hearing_advances"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The existing upload_drafts trigger is unchanged. Its audit_events arm leaves
-- a SYSTEM event's four empty identity paths empty; this check binds it to a
-- real advance at transaction commit.
CREATE FUNCTION "check_case_hearing_system_audit"() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."actor_kind" = 'SYSTEM' AND NOT EXISTS (
    SELECT 1 FROM "case_hearing_advances" h
    JOIN "case_hearing_arrangements" ar ON ar."id" = h."arrangement_id"
    WHERE h."audit_event_id" = NEW."id" AND h."department_id" = NEW."department_id"
      AND h."case_id" = NEW."resource_id" AND ar."case_id" = h."case_id"
      AND ar."department_id" = h."department_id"
      AND h."id"::text = NEW."details"->>'advanceId'
      AND h."arrangement_id"::text = NEW."details"->>'arrangementId'
      AND h."due_at" = (NEW."details"->>'dueAt')::timestamptz
      AND h."executed_at" = (NEW."details"->>'executedAt')::timestamptz
  ) THEN
    RAISE EXCEPTION 'system audit requires matching hearing advance' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "audit_events_hearing_system_fact_guard"
  AFTER INSERT OR UPDATE ON "audit_events" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "check_case_hearing_system_audit"();

CREATE FUNCTION "check_case_hearing_fact"() RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'case_hearing_arrangements' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "cases" c JOIN "case_acceptances" ac ON ac."case_id" = c."id" AND ac."department_id" = c."department_id"
      WHERE c."id" = NEW."case_id" AND c."department_id" = NEW."department_id"
        AND c."current_hearing_arrangement_id" = NEW."id" AND c."version" = NEW."to_version"
        AND c."stage" IN ('WAITING_HEARING', 'WAITING_JUDGMENT')
        AND (NEW."hearing_at" IS NULL OR NEW."hearing_at" >= ac."accepted_at")
    ) THEN
      RAISE EXCEPTION 'hearing arrangement case or accepted date mismatch' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
      AND a."department_id" = NEW."department_id" AND a."resource_type" = 'CASE'
      AND a."resource_id" = NEW."case_id" AND a."actor_kind" = 'HUMAN'
      AND a."actor_user_id" = NEW."recorded_by_user_id"
      AND a."action" = CASE WHEN NEW."source" = 'SCHEDULE' THEN 'case.hearing.scheduled' ELSE 'case.hearing.corrected' END
      AND a."details"->>'arrangementId' = NEW."id"::text
      AND a."details"->>'fromVersion' = NEW."from_version"::text
      AND a."details"->>'toVersion' = NEW."to_version"::text
      AND a."details"->>'hearingAt' IS NOT DISTINCT FROM NEW."hearing_at"::text
    ) THEN
      RAISE EXCEPTION 'hearing arrangement audit mismatch' USING ERRCODE = '23514';
    END IF;
    IF NEW."source" = 'CORRECTION' AND NOT EXISTS (
      SELECT 1 FROM "case_hearing_corrections" x WHERE x."new_arrangement_id" = NEW."id"
        AND x."case_id" = NEW."case_id" AND x."department_id" = NEW."department_id"
        AND x."audit_event_id" = NEW."audit_event_id"
    ) THEN
      RAISE EXCEPTION 'corrected arrangement requires correction fact' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'case_hearing_advances' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "cases" c JOIN "case_hearing_arrangements" ar
        ON ar."id" = NEW."arrangement_id" AND ar."case_id" = c."id" AND ar."department_id" = c."department_id"
      JOIN "audit_events" a ON a."id" = NEW."audit_event_id"
      WHERE c."id" = NEW."case_id" AND c."department_id" = NEW."department_id"
        AND c."stage" = 'WAITING_JUDGMENT' AND c."version" = NEW."to_version"
        AND c."current_hearing_arrangement_id" = ar."id" AND c."current_hearing_advance_id" = NEW."id"
        AND ar."hearing_at" IS NOT NULL
        AND NEW."due_at" = ((ar."hearing_at" + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')
        AND NEW."from_version" = ar."to_version"
        AND a."actor_kind" = 'SYSTEM' AND a."department_id" = c."department_id"
        AND a."resource_type" = 'CASE' AND a."resource_id" = c."id"
        AND a."action" = 'case.hearing.auto_advanced'
    ) THEN
      RAISE EXCEPTION 'hearing advance source or audit mismatch' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM "cases" c JOIN "case_hearing_advances" h ON h."id" = NEW."prior_advance_id"
      JOIN "case_hearing_arrangements" ar ON ar."id" = NEW."new_arrangement_id"
      JOIN "audit_events" a ON a."id" = NEW."audit_event_id"
      WHERE c."id" = NEW."case_id" AND c."department_id" = NEW."department_id"
        AND c."current_hearing_arrangement_id" = ar."id" AND c."version" = NEW."to_version"
        AND c."stage" = NEW."result_stage"
        AND (NEW."result_stage" = 'WAITING_JUDGMENT' AND c."current_hearing_advance_id" = h."id" OR
             NEW."result_stage" = 'WAITING_HEARING' AND c."current_hearing_advance_id" IS NULL)
        AND h."case_id" = c."id" AND h."department_id" = c."department_id"
        AND ar."case_id" = c."id" AND ar."department_id" = c."department_id"
        AND ar."source" = 'CORRECTION' AND ar."audit_event_id" = a."id"
        AND ar."recorded_by_user_id" = NEW."recorded_by_user_id"
        AND (NEW."result_stage" = 'WAITING_JUDGMENT') =
          (ar."hearing_at" IS NOT NULL AND ar."hearing_at" < (NEW."recorded_at" AT TIME ZONE 'Asia/Shanghai')::date)
        AND NEW."from_version" = CASE
          WHEN NEW."prior_arrangement_id" = h."arrangement_id" THEN h."to_version"
          ELSE (SELECT prior."to_version" FROM "case_hearing_arrangements" prior WHERE prior."id" = NEW."prior_arrangement_id") END
        AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
        AND a."department_id" = c."department_id" AND a."resource_type" = 'CASE'
        AND a."resource_id" = c."id" AND a."action" = 'case.hearing.corrected'
    ) THEN
      RAISE EXCEPTION 'hearing correction source or audit mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "case_hearing_arrangements_guard" AFTER INSERT ON "case_hearing_arrangements"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_hearing_fact"();
CREATE CONSTRAINT TRIGGER "case_hearing_advances_guard" AFTER INSERT ON "case_hearing_advances"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_hearing_fact"();
CREATE CONSTRAINT TRIGGER "case_hearing_corrections_guard" AFTER INSERT ON "case_hearing_corrections"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_hearing_fact"();

CREATE FUNCTION "reject_case_hearing_mutation"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'case hearing fact is immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "case_hearing_arrangements_immutable" BEFORE UPDATE OR DELETE ON "case_hearing_arrangements" FOR EACH ROW EXECUTE FUNCTION "reject_case_hearing_mutation"();
CREATE TRIGGER "case_hearing_advances_immutable" BEFORE UPDATE OR DELETE ON "case_hearing_advances" FOR EACH ROW EXECUTE FUNCTION "reject_case_hearing_mutation"();
CREATE TRIGGER "case_hearing_corrections_immutable" BEFORE UPDATE OR DELETE ON "case_hearing_corrections" FOR EACH ROW EXECUTE FUNCTION "reject_case_hearing_mutation"();
CREATE TRIGGER "case_hearing_receipts_immutable" BEFORE UPDATE OR DELETE ON "case_hearing_receipts" FOR EACH ROW EXECUTE FUNCTION "reject_case_hearing_mutation"();

CREATE FUNCTION "reject_case_hearing_audit_mutation"() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."action" IN ('case.hearing.scheduled', 'case.hearing.corrected', 'case.hearing.auto_advanced')
    OR (TG_OP = 'UPDATE' AND NEW."action" IN ('case.hearing.scheduled', 'case.hearing.corrected', 'case.hearing.auto_advanced')) THEN
    RAISE EXCEPTION 'case hearing audit is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "case_hearing_audit_immutable" BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_hearing_audit_mutation"();
COMMIT;
