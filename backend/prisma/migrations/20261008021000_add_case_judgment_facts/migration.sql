BEGIN;
ALTER TABLE "cases" ADD COLUMN "current_judgment_id" UUID;

CREATE TABLE "case_judgment_facts" (
  "id" UUID PRIMARY KEY,
  "department_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "kind" "case_judgment_kind" NOT NULL,
  "prior_fact_id" UUID UNIQUE,
  "judgment_received_at" DATE NOT NULL,
  "judgment_amount_state" "case_complaint_amount_state" NOT NULL,
  "judgment_amount" DECIMAL(16,2),
  "paid_litigation_fee_state" "case_complaint_amount_state" NOT NULL,
  "paid_litigation_fee" DECIMAL(16,2),
  "reason" VARCHAR(500),
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by_user_id" UUID NOT NULL,
  "from_version" INTEGER NOT NULL,
  "to_version" INTEGER NOT NULL,
  "audit_event_id" UUID NOT NULL UNIQUE,
  CONSTRAINT "case_judgment_facts_identity_key" UNIQUE ("id", "case_id", "department_id"),
  CONSTRAINT "case_judgment_facts_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_judgment_facts_prior_fkey" FOREIGN KEY ("prior_fact_id", "case_id", "department_id") REFERENCES "case_judgment_facts"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_judgment_facts_actor_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_judgment_facts_audit_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_judgment_facts_kind_check" CHECK (("kind" = 'REGISTER' AND "prior_fact_id" IS NULL AND "reason" IS NULL) OR ("kind" = 'CORRECT' AND "prior_fact_id" IS NOT NULL AND "reason" IS NOT NULL AND "reason" = BTRIM("reason") AND CHAR_LENGTH("reason") BETWEEN 1 AND 500)),
  CONSTRAINT "case_judgment_facts_amount_check" CHECK (
    (("judgment_amount_state" = 'KNOWN' AND "judgment_amount" IS NOT NULL AND "judgment_amount" >= 0) OR ("judgment_amount_state" = 'PENDING' AND "judgment_amount" IS NULL)) AND
    (("paid_litigation_fee_state" = 'KNOWN' AND "paid_litigation_fee" IS NOT NULL AND "paid_litigation_fee" >= 0) OR ("paid_litigation_fee_state" = 'PENDING' AND "paid_litigation_fee" IS NULL))
  ),
  CONSTRAINT "case_judgment_facts_version_check" CHECK ("from_version" >= 1 AND "to_version" = "from_version" + 1)
);
CREATE UNIQUE INDEX "case_judgment_one_root" ON "case_judgment_facts"("case_id") WHERE "kind" = 'REGISTER';
CREATE UNIQUE INDEX "case_judgment_one_version" ON "case_judgment_facts"("case_id", "to_version");
CREATE INDEX "case_judgment_history_order" ON "case_judgment_facts"("case_id", "to_version");

CREATE TABLE "case_judgment_versions" (
  "fact_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "material_id" UUID NOT NULL,
  "content_version_id" UUID NOT NULL,
  CONSTRAINT "case_judgment_versions_pkey" PRIMARY KEY ("fact_id", "content_version_id"),
  CONSTRAINT "case_judgment_versions_fact_fkey" FOREIGN KEY ("fact_id", "case_id", "department_id") REFERENCES "case_judgment_facts"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_judgment_versions_content_fkey" FOREIGN KEY ("material_id", "content_version_id") REFERENCES "content_versions"("material_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_judgment_receipts" (
  "id" UUID PRIMARY KEY,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "action" "case_judgment_kind" NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_judgment_receipts_key" UNIQUE ("department_id", "actor_user_id", "action", "idempotency_key"),
  CONSTRAINT "case_judgment_receipts_key_check" CHECK (CHAR_LENGTH(BTRIM("idempotency_key")) BETWEEN 1 AND 128 AND "idempotency_key" = BTRIM("idempotency_key")),
  CONSTRAINT "case_judgment_receipts_fingerprint_check" CHECK ("request_fingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "case_judgment_receipts_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_judgment_receipts_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

ALTER TABLE "cases" ADD CONSTRAINT "cases_current_judgment_fkey"
  FOREIGN KEY ("current_judgment_id", "id", "department_id") REFERENCES "case_judgment_facts"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION "reject_case_judgment_mutation"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'judgment fact, version, receipt, or audit is immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "case_judgment_facts_immutable" BEFORE UPDATE OR DELETE ON "case_judgment_facts" FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE TRIGGER "case_judgment_versions_immutable" BEFORE UPDATE OR DELETE ON "case_judgment_versions" FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE TRIGGER "case_judgment_receipts_immutable" BEFORE UPDATE OR DELETE ON "case_judgment_receipts" FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE FUNCTION "reject_case_judgment_audit_mutation"() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."action" IN ('case.judgment.registered', 'case.judgment.corrected') OR
     (TG_OP = 'UPDATE' AND NEW."action" IN ('case.judgment.registered', 'case.judgment.corrected')) THEN
    RAISE EXCEPTION 'judgment audit is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "case_judgment_audit_immutable" BEFORE UPDATE OR DELETE ON "audit_events" FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_audit_mutation"();

-- Validate the final chain after all fact, pointer, frozen version and receipt writes.
CREATE FUNCTION "check_case_judgment_final"() RETURNS TRIGGER AS $$
DECLARE target_case UUID; target_department UUID; current_record RECORD; latest_id UUID; root_count INTEGER; fact_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'cases' THEN
    target_case := NEW."id"; target_department := NEW."department_id";
  ELSE
    target_case := NEW."case_id"; target_department := NEW."department_id";
  END IF;
  SELECT c."id", c."stage", c."version", c."current_judgment_id" INTO current_record
    FROM "cases" c WHERE c."id" = target_case AND c."department_id" = target_department;
  SELECT COUNT(*), COUNT(*) FILTER (WHERE "kind" = 'REGISTER') INTO fact_count, root_count
    FROM "case_judgment_facts" WHERE "case_id" = target_case AND "department_id" = target_department;
  IF fact_count = 0 THEN
    IF current_record."current_judgment_id" IS NOT NULL THEN
      RAISE EXCEPTION 'judgment pointer without fact' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT f."id" INTO latest_id FROM "case_judgment_facts" f
    WHERE f."case_id" = target_case AND f."department_id" = target_department
    ORDER BY f."to_version" DESC LIMIT 1;
  IF current_record."stage" <> 'WAITING_JUDGMENT' OR root_count <> 1 OR
     current_record."current_judgment_id" IS DISTINCT FROM latest_id OR
     (SELECT "to_version" FROM "case_judgment_facts" WHERE "id" = latest_id) <> current_record."version" THEN
    RAISE EXCEPTION 'judgment chain or case stage mismatch' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'case_judgment_facts' THEN
    IF NEW."judgment_received_at" < (SELECT "accepted_at" FROM "case_acceptances" WHERE "case_id" = target_case AND "department_id" = target_department) OR
       NEW."judgment_received_at" > (NEW."recorded_at" AT TIME ZONE 'Asia/Shanghai')::date OR
       (NEW."kind" = 'REGISTER' AND NEW."prior_fact_id" IS NOT NULL) OR
       (NEW."kind" = 'CORRECT' AND NOT EXISTS (
          SELECT 1 FROM "case_judgment_facts" prior WHERE prior."id" = NEW."prior_fact_id"
            AND prior."case_id" = NEW."case_id" AND prior."department_id" = NEW."department_id"
            AND prior."to_version" = NEW."from_version")) OR
       NOT EXISTS (
         SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
           AND a."department_id" = NEW."department_id" AND a."resource_type" = 'CASE' AND a."resource_id" = NEW."case_id"
           AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
           AND a."action" = CASE WHEN NEW."kind" = 'REGISTER' THEN 'case.judgment.registered' ELSE 'case.judgment.corrected' END
           AND a."details"->>'judgmentId' = NEW."id"::text
           AND a."details"->>'fromVersion' = NEW."from_version"::text
           AND a."details"->>'toVersion' = NEW."to_version"::text
           AND a."details"->>'judgmentReceivedAt' = NEW."judgment_received_at"::text
           AND a."details"->>'judgmentAmountState' = NEW."judgment_amount_state"::text
           AND a."details"->>'judgmentAmount' IS NOT DISTINCT FROM NEW."judgment_amount"::text
           AND a."details"->>'paidLitigationFeeState' = NEW."paid_litigation_fee_state"::text
           AND a."details"->>'paidLitigationFee' IS NOT DISTINCT FROM NEW."paid_litigation_fee"::text
           AND a."details"->>'priorFactId' IS NOT DISTINCT FROM NEW."prior_fact_id"::text
           AND a."details"->>'reason' IS NOT DISTINCT FROM NEW."reason"
       ) OR NOT EXISTS (
         SELECT 1 FROM "case_judgment_receipts" r WHERE r."case_id" = NEW."case_id"
           AND r."department_id" = NEW."department_id" AND r."actor_user_id" = NEW."recorded_by_user_id"
           AND r."action" = NEW."kind" AND r."result_snapshot"->>'judgmentId' = NEW."id"::text
       ) THEN
      RAISE EXCEPTION 'judgment fact or audit mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "case_judgment_fact_guard" AFTER INSERT ON "case_judgment_facts"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_judgment_final"();
CREATE CONSTRAINT TRIGGER "case_judgment_case_guard" AFTER UPDATE OF "stage", "version", "current_judgment_id" ON "cases"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_judgment_final"();

CREATE FUNCTION "check_case_judgment_version"() RETURNS TRIGGER AS $$
DECLARE selected_ids JSONB;
BEGIN
  SELECT a."details"->'judgmentContentVersionIds' INTO selected_ids
    FROM "case_judgment_facts" f JOIN "audit_events" a ON a."id" = f."audit_event_id"
    WHERE f."id" = NEW."fact_id" AND f."case_id" = NEW."case_id" AND f."department_id" = NEW."department_id"
    FOR UPDATE OF f;
  IF jsonb_typeof(selected_ids) IS DISTINCT FROM 'array' OR NOT (selected_ids ? NEW."content_version_id"::text) OR
     EXISTS (SELECT 1 FROM "case_judgment_receipts" r WHERE r."result_snapshot"->>'judgmentId' = NEW."fact_id"::text) OR
     NOT EXISTS (
       SELECT 1 FROM "materials" m JOIN "content_versions" v ON v."material_id" = m."id"
       WHERE m."id" = NEW."material_id" AND v."id" = NEW."content_version_id"
         AND m."department_id" = NEW."department_id" AND m."owner_type" = 'CASE' AND m."owner_id" = NEW."case_id"
         AND m."category" = 'JUDGMENT' AND m."purpose" = 'JUDGMENT' AND m."status" = 'ACTIVE'
         AND v."status" = 'AVAILABLE' AND v."size_bytes" <= 52428800
         AND v."mime_type" IN ('application/pdf','image/jpeg','image/png')
         AND (m."current_version_id" = v."id" OR EXISTS (
           SELECT 1 FROM "case_judgment_versions" old WHERE old."material_id" = m."id"
             AND old."content_version_id" = v."id" AND old."case_id" = NEW."case_id"))
     ) THEN
    RAISE EXCEPTION 'judgment frozen version mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "case_judgment_versions_guard" BEFORE INSERT ON "case_judgment_versions" FOR EACH ROW EXECUTE FUNCTION "check_case_judgment_version"();

CREATE FUNCTION "check_case_judgment_receipt"() RETURNS TRIGGER AS $$
DECLARE fact_record RECORD; selected_ids JSONB;
BEGIN
  SELECT f.*, a."details"->'judgmentContentVersionIds' AS selected INTO fact_record
    FROM "case_judgment_facts" f JOIN "audit_events" a ON a."id" = f."audit_event_id"
    WHERE f."id" = (NEW."result_snapshot"->>'judgmentId')::uuid
      AND f."case_id" = NEW."case_id" AND f."department_id" = NEW."department_id"
      AND f."kind" = NEW."action" AND f."recorded_by_user_id" = NEW."actor_user_id"
    FOR UPDATE OF f;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'judgment receipt requires a matching fact' USING ERRCODE = '23514';
  END IF;
  selected_ids := fact_record.selected;
  IF fact_record."id" IS NULL OR jsonb_typeof(selected_ids) IS DISTINCT FROM 'array' OR
     jsonb_array_length(selected_ids) NOT BETWEEN 1 AND 10 OR
     NEW."result_snapshot"->>'id' IS DISTINCT FROM NEW."case_id"::text OR
     NEW."result_snapshot"->>'stage' IS DISTINCT FROM 'WAITING_JUDGMENT' OR
     NEW."result_snapshot"->>'version' IS DISTINCT FROM fact_record."to_version"::text OR
     (NEW."result_snapshot"->>'recordedAt')::timestamptz IS DISTINCT FROM fact_record."recorded_at" OR
     (SELECT COUNT(*) FROM "case_judgment_versions" v WHERE v."fact_id" = fact_record."id") <> jsonb_array_length(selected_ids) OR
     EXISTS (SELECT 1 FROM jsonb_array_elements_text(selected_ids) AS chosen("id") WHERE NOT EXISTS (
       SELECT 1 FROM "case_judgment_versions" v WHERE v."fact_id" = fact_record."id" AND v."content_version_id"::text = chosen."id")) OR
     (SELECT COUNT(*) FROM "material_references" r WHERE r."action_event_id" = fact_record."audit_event_id"
       AND r."resource_type" = 'case' AND r."resource_id" = NEW."case_id" AND r."purpose" = 'JUDGMENT') <> jsonb_array_length(selected_ids) OR
     EXISTS (SELECT 1 FROM "case_judgment_versions" v WHERE v."fact_id" = fact_record."id" AND NOT EXISTS (
       SELECT 1 FROM "material_references" r WHERE r."action_event_id" = fact_record."audit_event_id"
         AND r."resource_type" = 'case' AND r."resource_id" = NEW."case_id" AND r."purpose" = 'JUDGMENT'
         AND r."material_id" = v."material_id" AND r."content_version_id" = v."content_version_id")) THEN
    RAISE EXCEPTION 'judgment receipt requires exact frozen versions' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "case_judgment_receipts_guard" BEFORE INSERT ON "case_judgment_receipts" FOR EACH ROW EXECUTE FUNCTION "check_case_judgment_receipt"();

CREATE FUNCTION "check_hearing_without_judgment"() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "case_judgment_facts" f WHERE f."case_id" = NEW."case_id" AND f."department_id" = NEW."department_id") THEN
    RAISE EXCEPTION 'hearing correction after judgment' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "case_hearing_correction_no_judgment" AFTER INSERT ON "case_hearing_corrections"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_hearing_without_judgment"();
COMMIT;
