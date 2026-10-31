-- DRAFT: metadata is outside the immutable business snapshot. Historical receipts without metadata remain valid.
-- New version writes require current revision through 2400; replay must authorize current actor separately.
BEGIN;
CREATE OR REPLACE FUNCTION "check_case_settlement_assessment_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
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
  OR (a."details"-'requestFingerprint'-'authorizationRevision') IS DISTINCT FROM NEW."result_snapshot"
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

COMMIT;
