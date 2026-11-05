CREATE TYPE "case_supplement_kind" AS ENUM (
  'COURT_PREPAYMENT_NOTICE', 'COURT_DISCLOSURE', 'RECORD_RETRIEVAL_DOCUMENT',
  'PRESERVATION_DOCUMENT', 'EXECUTION_FORMAL_ACCEPTANCE', 'REFUND_SOURCE_LINK',
  'MANUAL_ANNOTATION'
);

ALTER TYPE "material_category" ADD VALUE 'CASE_PRESERVATION_DOCUMENT';
ALTER TYPE "material_category" ADD VALUE 'CASE_COURT_DISCLOSURE_ATTACHMENT';
ALTER TYPE "material_category" ADD VALUE 'CASE_RECORD_RETRIEVAL_DOCUMENT';
ALTER TYPE "material_category" ADD VALUE 'EXECUTION_FORMAL_DOCUMENT';

CREATE TABLE "case_supplement_entries" (
  "id" uuid PRIMARY KEY,
  "prior_entry_id" uuid UNIQUE,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "kind" "case_supplement_kind" NOT NULL,
  "trial_round_id" uuid,
  "amount" decimal(16,2),
  "text" text,
  "event_date" date,
  "court_case_no" varchar(100),
  "source_type" varchar(40),
  "source_id" uuid,
  "inventory_version_id" uuid,
  "inventory_item_id" uuid,
  "material_id" uuid,
  "content_version_id" uuid,
  "reason" varchar(1000) NOT NULL CHECK (length(btrim("reason")) > 0),
  "recorded_by_user_id" uuid NOT NULL,
  "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idempotency_key" varchar(128) NOT NULL,
  "request_fingerprint" char(64) NOT NULL,
  "audit_event_id" uuid NOT NULL UNIQUE REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  UNIQUE ("id", "case_id", "department_id", "kind"),
  UNIQUE ("department_id", "recorded_by_user_id", "idempotency_key"),
  FOREIGN KEY ("prior_entry_id", "case_id", "department_id", "kind") REFERENCES "case_supplement_entries"("id", "case_id", "department_id", "kind") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("trial_round_id", "case_id", "department_id") REFERENCES "case_trial_rounds"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("recorded_by_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("material_id", "content_version_id") REFERENCES "content_versions"("material_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("inventory_version_id", "inventory_item_id") REFERENCES "case_refund_inventory_items"("inventory_version_id", "item_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (("material_id" IS NULL) = ("content_version_id" IS NULL)),
  CHECK ("kind" IN ('EXECUTION_FORMAL_ACCEPTANCE', 'REFUND_SOURCE_LINK') OR "source_type" IS NULL),
  CHECK ("kind" = 'REFUND_SOURCE_LINK' OR "inventory_item_id" IS NULL),
  CHECK (
    ("kind" = 'COURT_PREPAYMENT_NOTICE' AND "trial_round_id" IS NOT NULL AND "amount" IS NOT NULL AND "amount" >= 0 AND "text" IS NULL AND "event_date" IS NULL AND "court_case_no" IS NULL AND "source_id" IS NULL AND "inventory_version_id" IS NULL AND "material_id" IS NULL)
    OR ("kind" = 'COURT_DISCLOSURE' AND "trial_round_id" IS NOT NULL AND ("text" IS NOT NULL OR "material_id" IS NOT NULL) AND ("text" IS NULL OR length(btrim("text")) > 0) AND "amount" IS NULL AND "event_date" IS NULL AND "court_case_no" IS NULL AND "source_id" IS NULL AND "inventory_version_id" IS NULL)
    OR ("kind" IN ('RECORD_RETRIEVAL_DOCUMENT', 'PRESERVATION_DOCUMENT') AND "trial_round_id" IS NULL AND "material_id" IS NOT NULL AND "amount" IS NULL AND "text" IS NULL AND "event_date" IS NULL AND "court_case_no" IS NULL AND "source_id" IS NULL AND "inventory_version_id" IS NULL)
    OR ("kind" = 'EXECUTION_FORMAL_ACCEPTANCE' AND "trial_round_id" IS NULL AND ("event_date" IS NOT NULL OR "court_case_no" IS NOT NULL OR "material_id" IS NOT NULL) AND ("court_case_no" IS NULL OR length(btrim("court_case_no")) > 0) AND "source_type" = 'EXECUTION_FILING' AND "source_id" IS NOT NULL AND "amount" IS NULL AND "text" IS NULL AND "inventory_version_id" IS NULL)
    OR ("kind" = 'REFUND_SOURCE_LINK' AND "trial_round_id" IS NULL AND "source_type" IN ('JUDGMENT', 'SECOND_INSTANCE_RESULT') AND "source_id" IS NOT NULL AND "inventory_version_id" IS NOT NULL AND "inventory_item_id" IS NOT NULL AND "amount" IS NULL AND "text" IS NULL AND "event_date" IS NULL AND "court_case_no" IS NULL AND "material_id" IS NULL)
    OR ("kind" = 'MANUAL_ANNOTATION' AND "trial_round_id" IS NULL AND "text" IS NOT NULL AND length(btrim("text")) > 0 AND "amount" IS NULL AND "event_date" IS NULL AND "court_case_no" IS NULL AND "source_id" IS NULL AND "inventory_version_id" IS NULL AND "material_id" IS NULL)
  )
);
CREATE INDEX "case_supplement_entries_case_order_idx" ON "case_supplement_entries"("case_id", "department_id", "recorded_at", "id");
CREATE UNIQUE INDEX "case_supplement_notice_root_unique" ON "case_supplement_entries"("case_id", "department_id", "kind", "trial_round_id") WHERE "prior_entry_id" IS NULL AND "kind" = 'COURT_PREPAYMENT_NOTICE';
CREATE UNIQUE INDEX "case_supplement_formal_root_unique" ON "case_supplement_entries"("case_id", "department_id", "kind", "source_id") WHERE "prior_entry_id" IS NULL AND "kind" = 'EXECUTION_FORMAL_ACCEPTANCE';
CREATE UNIQUE INDEX "case_supplement_refund_root_unique" ON "case_supplement_entries"("case_id", "department_id", "kind", "inventory_version_id", "inventory_item_id") WHERE "prior_entry_id" IS NULL AND "kind" = 'REFUND_SOURCE_LINK';

CREATE FUNCTION "case_supplement_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'case supplements are append-only' USING ERRCODE = '23514';
END; $$;
CREATE TRIGGER "case_supplement_immutable_guard" BEFORE UPDATE OR DELETE ON "case_supplement_entries" FOR EACH ROW EXECUTE FUNCTION "case_supplement_immutable"();
