-- DRAFT ONLY. No historical receipts, registered adapter, or enabled replay.
-- Future adapter must authorize the CURRENT internal actor/scope before lookup,
-- compare canonical request fingerprint, and atomically persist assessment/audit/receipt.
-- Prospective audit envelope: full assessment snapshot plus requestFingerprint.
-- Existing unregistered coordinator does not yet emit that fingerprint: integration
-- is intentionally blocked, and this migration does not make it callable.
BEGIN;
CREATE TABLE "case_settlement_assessment_receipts" (
 "id" uuid PRIMARY KEY, "department_id" uuid NOT NULL, "actor_user_id" uuid NOT NULL,
 "case_id" uuid NOT NULL, "assessment_version_id" uuid NOT NULL UNIQUE,
 "audit_event_id" uuid NOT NULL UNIQUE,
 "idempotency_key" varchar(128) NOT NULL,
 "request_fingerprint" char(64) NOT NULL,
 "result_snapshot" jsonb NOT NULL,
 "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "settlement_assessment_receipt_actor_key" UNIQUE ("department_id","actor_user_id","idempotency_key"),
 CHECK (length("idempotency_key")>0 AND "idempotency_key" !~ '^[[:space:]]|[[:space:]]$'),
 CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$'),
 CHECK (jsonb_typeof("result_snapshot")='object'),
 FOREIGN KEY ("assessment_version_id","case_id","department_id") REFERENCES "case_settlement_assessment_versions"("id","case_id","department_id") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("actor_user_id","department_id") REFERENCES "department_memberships"("user_id","department_id") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE FUNCTION "check_case_settlement_assessment_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v "case_settlement_assessment_versions"%ROWTYPE; a "audit_events"%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'assessment command receipts are immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO v FROM "case_settlement_assessment_versions" WHERE "id"=NEW."assessment_version_id";
 SELECT * INTO a FROM "audit_events" WHERE "id"=NEW."audit_event_id";
 IF v."id" IS NULL OR v."case_id"<>NEW."case_id" OR v."department_id"<>NEW."department_id"
  OR v."recorded_by_user_id"<>NEW."actor_user_id" OR v."audit_event_id"<>NEW."audit_event_id"
  OR NEW."created_at"<v."recorded_at"
  OR a."id" IS NULL OR a."department_id"<>NEW."department_id" OR a."actor_kind"<>'HUMAN'
  OR a."actor_user_id" IS DISTINCT FROM NEW."actor_user_id"
  OR a."internal_actor_user_id" IS DISTINCT FROM NEW."actor_user_id"
  OR a."resource_type"<>'CASE_SETTLEMENT_ASSESSMENT_VERSION' OR a."resource_id"<>v."id"
  OR a."action"<>'CASE_SETTLEMENT_ASSESSMENT_RECORD'
  OR a."details"->>'requestFingerprint' IS DISTINCT FROM NEW."request_fingerprint"
  OR (a."details"-'requestFingerprint') IS DISTINCT FROM NEW."result_snapshot"
 THEN RAISE EXCEPTION 'assessment receipt requires exact assessment actor audit and request' USING ERRCODE='23514'; END IF;
 IF NEW."result_snapshot"->>'id' IS DISTINCT FROM v."id"::text
  OR NEW."result_snapshot"->>'caseId' IS DISTINCT FROM v."case_id"::text
  OR NEW."result_snapshot"->>'departmentId' IS DISTINCT FROM v."department_id"::text
  OR NEW."result_snapshot"->>'closureVersionId' IS DISTINCT FROM v."closure_version_id"::text
  OR NEW."result_snapshot"->>'termsVersion' IS DISTINCT FROM v."terms_version"::text
  OR NEW."result_snapshot"->>'priorVersionId' IS DISTINCT FROM v."prior_version_id"::text
  OR NEW."result_snapshot"->>'revision' IS DISTINCT FROM v."revision"::text
  OR NEW."result_snapshot"->>'declaration' IS DISTINCT FROM v."declaration"
  OR NEW."result_snapshot"->>'calculationRuleVersion' IS DISTINCT FROM v."calculation_rule_version"
  OR NEW."result_snapshot"->'calculationInputs' IS DISTINCT FROM v."calculation_inputs"
  OR NEW."result_snapshot"->>'customerAmount' IS DISTINCT FROM v."customer_amount"::text
  OR NEW."result_snapshot"->>'lawyerAmount' IS DISTINCT FROM v."lawyer_amount"::text
  OR NEW."result_snapshot"->>'auditEventId' IS DISTINCT FROM v."audit_event_id"::text
  OR NEW."result_snapshot"->>'recordedByUserId' IS DISTINCT FROM v."recorded_by_user_id"::text
  OR (NEW."result_snapshot"->>'recordedAt') IS NULL
  OR (NEW."result_snapshot"->>'recordedAt')::timestamptz IS DISTINCT FROM v."recorded_at"
 THEN RAISE EXCEPTION 'assessment receipt result has mismatched source' USING ERRCODE='23514'; END IF;
 IF v."declaration"='APPLICABLE' AND (
  jsonb_typeof(NEW."result_snapshot"->'calculationResult') IS DISTINCT FROM 'object'
  OR NEW."result_snapshot"#>>'{calculationResult,customerSource}' IS DISTINCT FROM v."customer_source"
  OR NEW."result_snapshot"#>>'{calculationResult,lawyerSource}' IS DISTINCT FROM v."lawyer_source"
  OR NEW."result_snapshot"#>>'{calculationResult,customerAmount}' IS DISTINCT FROM v."customer_amount"::text
  OR NEW."result_snapshot"#>>'{calculationResult,lawyerAmount}' IS DISTINCT FROM v."lawyer_amount"::text
 ) THEN RAISE EXCEPTION 'applicable assessment receipt requires exact calculation sources' USING ERRCODE='23514'; END IF;
 -- UNKNOWN/NOT_APPLICABLE makes no calculated-amount assertion; absent or JSON
 -- null calculationResult is allowed, but a fabricated calculated result is not.
 IF v."declaration" IN ('UNKNOWN','NOT_APPLICABLE')
  AND NEW."result_snapshot"->'calculationResult' IS NOT NULL
  AND NEW."result_snapshot"->'calculationResult'<>'null'::jsonb
 THEN RAISE EXCEPTION 'unassessed declaration cannot carry calculated results' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "case_settlement_assessment_receipt_consistency" BEFORE INSERT OR UPDATE OR DELETE ON "case_settlement_assessment_receipts" FOR EACH ROW EXECUTE FUNCTION "check_case_settlement_assessment_receipt"();
CREATE TRIGGER "case_settlement_assessment_receipt_draft_gate" BEFORE INSERT OR UPDATE OR DELETE ON "case_settlement_assessment_receipts" FOR EACH ROW EXECUTE FUNCTION "guard_case_settlement_assessment_draft"();
-- Audit rows are part of the immutable source, not a mutable receipt cache.
CREATE FUNCTION "guard_case_settlement_assessment_audit"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM "case_settlement_assessment_versions" WHERE "audit_event_id"=OLD."id")
  OR EXISTS (SELECT 1 FROM "case_settlement_assessment_receipts" WHERE "audit_event_id"=OLD."id")
 THEN RAISE EXCEPTION 'assessment source audit is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "case_settlement_assessment_audit_guard" BEFORE UPDATE OR DELETE ON "audit_events" FOR EACH ROW EXECUTE FUNCTION "guard_case_settlement_assessment_audit"();
COMMIT;
