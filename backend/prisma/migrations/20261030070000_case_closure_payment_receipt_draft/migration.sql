-- DRAFT ONLY; independent command namespace, no historical backfill or enabled writes.
BEGIN;
CREATE TABLE "case_closure_payment_receipts" (
 "id" uuid PRIMARY KEY, "department_id" uuid NOT NULL, "actor_user_id" uuid NOT NULL,
 "case_id" uuid NOT NULL, "payment_version_id" uuid NOT NULL UNIQUE,
 "audit_event_id" uuid NOT NULL UNIQUE, "idempotency_key" varchar(128) NOT NULL,
 "request_fingerprint" char(64) NOT NULL, "result_snapshot" jsonb NOT NULL,
 "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("payment_version_id","case_id","department_id"),
 CONSTRAINT "closure_payment_receipt_actor_key" UNIQUE ("department_id","actor_user_id","idempotency_key"),
 CHECK (length("idempotency_key")>0 AND "idempotency_key" !~ '^\s|\s$'),
 CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$'),
 CHECK (jsonb_typeof("result_snapshot")='object'),
 FOREIGN KEY ("payment_version_id","case_id","department_id") REFERENCES "case_closure_payment_versions"("id","case_id","department_id") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("actor_user_id","department_id") REFERENCES "department_memberships"("user_id","department_id") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX ON "case_closure_payment_receipts"("case_id","department_id");
CREATE FUNCTION "check_case_closure_payment_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "case_closure_payment_versions"%ROWTYPE; a "audit_events"%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'payment command receipts are immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO p FROM "case_closure_payment_versions" WHERE "id"=NEW."payment_version_id";
 SELECT * INTO a FROM "audit_events" WHERE "id"=NEW."audit_event_id";
 IF p."id" IS NULL OR p."case_id"<>NEW."case_id" OR p."department_id"<>NEW."department_id"
  OR p."recorded_by_user_id"<>NEW."actor_user_id" OR p."audit_event_id"<>NEW."audit_event_id"
  OR NEW."created_at"<p."recorded_at"
  OR a."id" IS NULL OR a."department_id"<>NEW."department_id"
  OR a."actor_kind"<>'HUMAN' OR a."actor_user_id" IS DISTINCT FROM NEW."actor_user_id"
  OR a."internal_actor_user_id" IS DISTINCT FROM NEW."actor_user_id"
  OR (a."details"->>'fingerprint') IS DISTINCT FROM NEW."request_fingerprint"
  OR (a."details"->'result') IS DISTINCT FROM NEW."result_snapshot"
  OR a."resource_type"<>'CASE_CLOSURE_PAYMENT_VERSION' OR a."resource_id"<>p."id"
  OR a."action"<>(CASE WHEN p."revision"=1 THEN 'CASE_CLOSURE_PAYMENT_RECORD'
   WHEN p."state"='VOID' THEN 'CASE_CLOSURE_PAYMENT_VOID' ELSE 'CASE_CLOSURE_PAYMENT_CORRECT' END)
 THEN RAISE EXCEPTION 'payment receipt requires exact payment actor and audit' USING ERRCODE='23514'; END IF;
 IF (NEW."result_snapshot"->>'versionId') IS DISTINCT FROM p."id"::text
  OR (NEW."result_snapshot"#>>'{review,caseId}') IS DISTINCT FROM NEW."case_id"::text
  OR (NEW."result_snapshot"#>>'{review,closureVersionId}') IS DISTINCT FROM p."closure_version_id"::text
  OR (NEW."result_snapshot"->>'stage') IS DISTINCT FROM (NEW."result_snapshot"#>>'{review,stage}')
  OR coalesce(NEW."result_snapshot"->>'stage','') NOT IN ('WAITING_ARCHIVE','ARCHIVED')
  OR jsonb_typeof(NEW."result_snapshot"->'reviewRequired') IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(NEW."result_snapshot"#>'{review,effectivePaymentVersionIds}') IS DISTINCT FROM 'array'
  OR jsonb_typeof(NEW."result_snapshot"#>'{review,effectiveAmounts}') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'payment receipt result has mismatched source' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "closure_payment_receipt_consistency" BEFORE INSERT OR UPDATE OR DELETE ON "case_closure_payment_receipts" FOR EACH ROW EXECUTE FUNCTION "check_case_closure_payment_receipt"();
CREATE TRIGGER "closure_payment_receipt_draft_gate" BEFORE INSERT OR UPDATE OR DELETE ON "case_closure_payment_receipts" FOR EACH ROW EXECUTE FUNCTION "guard_case_closure_payment_draft"();
COMMIT;


