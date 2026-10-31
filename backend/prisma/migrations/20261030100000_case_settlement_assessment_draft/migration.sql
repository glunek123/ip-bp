-- DRAFT ONLY. No history import, API, or enabled write path.
-- This captures inputs prospectively. It does not certify the calculation or
-- authorize archive: a later reviewed command must recompute outputs using the
-- recorded rule, enforce current terms/closure, and serialize all source writes.
BEGIN;
CREATE TABLE "case_settlement_assessment_versions" (
 "id" uuid PRIMARY KEY, "case_id" uuid NOT NULL, "department_id" uuid NOT NULL,
 "revision" integer NOT NULL CHECK ("revision">0), "prior_version_id" uuid UNIQUE,
 "closure_version_id" uuid NOT NULL, "terms_version" integer,
 "declaration" varchar(20) NOT NULL CHECK ("declaration" IN ('UNKNOWN','APPLICABLE','NOT_APPLICABLE')),
 -- Includes nulls: absent values must never silently become zero.
 "calculation_inputs" jsonb NOT NULL,
 "calculation_rule_version" varchar(80) NOT NULL CHECK (length(btrim("calculation_rule_version"))>0),
 "customer_source" varchar(16) NOT NULL CHECK ("customer_source" IN ('AUTOMATIC','MANUAL')),
 "lawyer_source" varchar(16) NOT NULL CHECK ("lawyer_source" IN ('AUTOMATIC','MANUAL')),
 "customer_amount" numeric(30,2), "lawyer_amount" numeric(30,2),
 "recorded_by_user_id" uuid NOT NULL, "audit_event_id" uuid NOT NULL UNIQUE,
 "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("case_id","revision"), UNIQUE ("id","case_id","department_id"),
 CHECK (("revision"=1 AND "prior_version_id" IS NULL) OR ("revision">1 AND "prior_version_id" IS NOT NULL)),
 CHECK ("terms_version" IS NULL OR "terms_version">0),
 CHECK ("customer_amount" IS NULL OR "customer_amount">=0),
 CHECK ("lawyer_amount" IS NULL OR "lawyer_amount">=0),
 CHECK ("declaration"<>'APPLICABLE' OR ("customer_amount" IS NOT NULL AND "lawyer_amount" IS NOT NULL)),
 CHECK ("declaration"<>'UNKNOWN' OR ("customer_amount" IS NULL AND "lawyer_amount" IS NULL)),
 CHECK ("declaration"<>'NOT_APPLICABLE' OR ("customer_amount" IS NULL AND "lawyer_amount" IS NULL)),
 CHECK (jsonb_typeof("calculation_inputs")='object'),
 FOREIGN KEY ("case_id","department_id") REFERENCES "cases"("id","department_id") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("closure_version_id","case_id","department_id") REFERENCES "case_closure_versions"("id","case_id","department_id") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("prior_version_id","case_id","department_id") REFERENCES "case_settlement_assessment_versions"("id","case_id","department_id") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("recorded_by_user_id","department_id") REFERENCES "department_memberships"("user_id","department_id") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE FUNCTION "guard_case_settlement_assessment_version"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous "case_settlement_assessment_versions"%ROWTYPE;
 c "case_closure_versions"%ROWTYPE; t "case_settlement_terms"%ROWTYPE;
 expected jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'settlement assessment history is immutable' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM "cases" WHERE "id"=NEW."case_id" AND "department_id"=NEW."department_id" FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'settlement assessment case missing' USING ERRCODE='23514'; END IF;
 SELECT * INTO c FROM "case_closure_versions" WHERE "id"=NEW."closure_version_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
 SELECT * INTO t FROM "case_settlement_terms" WHERE "case_id"=NEW."case_id" AND "department_id"=NEW."department_id" FOR UPDATE;
 -- Only closure-backed assessments: no fallback claim amount is invented.
 expected := jsonb_build_object(
  'closureAmount',c."close_amt"::text,'closureAmountState',c."close_amount_state"::text,
  'fallbackClaimAmount',NULL,'customerFormula',t."customer_formula",
  'lawyerMode',t."lawyer_mode"::text,'lawyerBaseFee',t."lawyer_base_fee"::text,
  'lawyerSplitPercent',t."lawyer_split_percent"::text,
  'customerManualAmount',t."customer_manual_amount"::text,'lawyerManualAmount',t."lawyer_manual_amount"::text);
 IF c."id" IS NULL OR NEW."terms_version" IS DISTINCT FROM t."version"
  OR NEW."calculation_inputs" IS DISTINCT FROM expected
  OR NEW."customer_source"<>(CASE WHEN t."customer_manual_amount" IS NULL THEN 'AUTOMATIC' ELSE 'MANUAL' END)
  OR NEW."lawyer_source"<>(CASE WHEN t."lawyer_manual_amount" IS NULL THEN 'AUTOMATIC' ELSE 'MANUAL' END)
 THEN RAISE EXCEPTION 'settlement assessment requires exact complete input copy' USING ERRCODE='23514'; END IF;
 IF NEW."revision">1 THEN
  SELECT * INTO previous FROM "case_settlement_assessment_versions" WHERE "id"=NEW."prior_version_id" FOR UPDATE;
  IF previous."id" IS NULL OR previous."case_id"<>NEW."case_id" OR previous."department_id"<>NEW."department_id"
   OR previous."revision"+1<>NEW."revision" OR previous."recorded_at">NEW."recorded_at"
   OR EXISTS (SELECT 1 FROM "case_settlement_assessment_versions" n WHERE n."prior_version_id"=previous."id")
  THEN RAISE EXCEPTION 'settlement assessment requires latest consecutive version' USING ERRCODE='23514'; END IF;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id"=NEW."audit_event_id"
  AND a."department_id"=NEW."department_id" AND a."actor_kind"='HUMAN'
  AND a."actor_user_id"=NEW."recorded_by_user_id" AND a."internal_actor_user_id"=NEW."recorded_by_user_id"
  AND a."resource_type"='CASE_SETTLEMENT_ASSESSMENT_VERSION' AND a."resource_id"=NEW."id"
  AND a."action"='CASE_SETTLEMENT_ASSESSMENT_RECORD'
  AND a."details"->>'declaration'=NEW."declaration")
 THEN RAISE EXCEPTION 'settlement assessment requires explicit declaration audit' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "case_settlement_assessment_guard" BEFORE INSERT OR UPDATE OR DELETE ON "case_settlement_assessment_versions" FOR EACH ROW EXECUTE FUNCTION "guard_case_settlement_assessment_version"();
CREATE FUNCTION "guard_case_settlement_assessment_draft"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'settlement assessment persistence is draft and not enabled' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER "case_settlement_assessment_draft_gate" BEFORE INSERT OR UPDATE OR DELETE ON "case_settlement_assessment_versions" FOR EACH ROW EXECUTE FUNCTION "guard_case_settlement_assessment_draft"();
COMMIT;
