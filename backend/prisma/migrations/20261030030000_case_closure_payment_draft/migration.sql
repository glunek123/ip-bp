-- DRAFT ONLY. Not executed. No historical payment import or public write path.
BEGIN;
CREATE TABLE "case_closure_payment_versions" (
 "id" uuid PRIMARY KEY, "payment_id" uuid NOT NULL, "revision" integer NOT NULL,
 "prior_version_id" uuid UNIQUE, "case_id" uuid NOT NULL, "department_id" uuid NOT NULL,
 "closure_version_id" uuid NOT NULL, "state" varchar(16) NOT NULL,
 "paid_on" date NOT NULL, "amount" decimal(16,2) NOT NULL,
 "payer" varchar(200) NOT NULL, "payee" varchar(200) NOT NULL, "reason" varchar(500),
 "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "recorded_by_user_id" uuid NOT NULL, "audit_event_id" uuid NOT NULL UNIQUE,
 UNIQUE ("payment_id","revision"), UNIQUE ("id","case_id","department_id"),
 UNIQUE ("id","payment_id","case_id","department_id"),
 CHECK ("state" IN ('ACTIVE','VOID') AND "revision">0 AND "amount">0),
 CHECK (btrim("payer")<>'' AND btrim("payee")<>''),
 CHECK (("revision"=1 AND "prior_version_id" IS NULL AND "state"='ACTIVE' AND "reason" IS NULL)
 OR ("revision">1 AND "prior_version_id" IS NOT NULL )),
 FOREIGN KEY ("case_id","department_id") REFERENCES "cases"("id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("closure_version_id","case_id","department_id") REFERENCES "case_closure_versions"("id","case_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("prior_version_id","payment_id","case_id","department_id") REFERENCES "case_closure_payment_versions"("id","payment_id","case_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("recorded_by_user_id","department_id") REFERENCES "department_memberships"("user_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX ON "case_closure_payment_versions"("case_id","department_id","payment_id","revision");
CREATE TABLE "case_closure_payment_documents" (
 "payment_version_id" uuid NOT NULL, "case_id" uuid NOT NULL, "department_id" uuid NOT NULL,
 "material_id" uuid NOT NULL, "content_version_id" uuid NOT NULL,
 "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("payment_version_id","content_version_id"),
 FOREIGN KEY ("payment_version_id","case_id","department_id") REFERENCES "case_closure_payment_versions"("id","case_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("material_id","department_id") REFERENCES "materials"("id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("material_id","content_version_id") REFERENCES "content_versions"("material_id","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
-- Closed until command authorization, version-chain, screenshot upload provenance and
-- ONE_TIME effective-count rules are implemented together. This is not an API gate.
CREATE FUNCTION "guard_case_closure_payment_draft"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'case closure payment persistence is draft and not enabled' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER "case_closure_payment_draft_guard" BEFORE INSERT OR UPDATE OR DELETE ON "case_closure_payment_versions" FOR EACH ROW EXECUTE FUNCTION "guard_case_closure_payment_draft"();
CREATE TRIGGER "case_closure_payment_document_draft_guard" BEFORE INSERT OR UPDATE OR DELETE ON "case_closure_payment_documents" FOR EACH ROW EXECUTE FUNCTION "guard_case_closure_payment_draft"();
CREATE FUNCTION "check_case_closure_payment_document_owner"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "materials" m JOIN "content_versions" v ON v."material_id"=m."id"
 WHERE m."id"=NEW."material_id" AND m."department_id"=NEW."department_id"
 AND m."owner_type"='CASE' AND m."owner_id"=NEW."case_id"
 AND v."id"=NEW."content_version_id" AND v."status"='AVAILABLE'
 AND m."deleted_at" IS NULL) THEN
 RAISE EXCEPTION 'payment screenshot must belong to the exact case and content version' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "case_closure_payment_document_owner_guard" BEFORE INSERT ON "case_closure_payment_documents" FOR EACH ROW EXECUTE FUNCTION "check_case_closure_payment_document_owner"();
-- Independent append-only invariant, retained when the draft gate is later replaced.
-- Draft audit contract: resource is this immutable version, action distinguishes
-- initial payment, correction and voiding. Authorization remains a separate gate.
CREATE FUNCTION "check_case_closure_payment_version"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous "case_closure_payment_versions"%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'payment versions are immutable' USING ERRCODE='23514';
 END IF;
 PERFORM 1 FROM "cases" WHERE "id"=NEW."case_id" AND "department_id"=NEW."department_id" FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'payment case missing' USING ERRCODE='23514'; END IF;
 IF NEW."revision">1 THEN
  SELECT * INTO previous FROM "case_closure_payment_versions" WHERE "id"=NEW."prior_version_id" FOR UPDATE;
  IF previous."id" IS NULL OR previous."payment_id"<>NEW."payment_id"
   OR previous."case_id"<>NEW."case_id" OR previous."department_id"<>NEW."department_id"
   OR previous."revision"+1<>NEW."revision" OR previous."state"<>'ACTIVE'
   OR NEW."recorded_at"<previous."recorded_at"
   OR EXISTS (SELECT 1 FROM "case_closure_payment_versions" n WHERE n."prior_version_id"=previous."id") THEN
   RAISE EXCEPTION 'payment requires latest active consecutive version' USING ERRCODE='23514';
  END IF;
 END IF;
 -- Unique(payment_id, revision) rejects concurrent roots; unique(prior_version_id)
 -- rejects forks even if a transaction snapshot predates a competing commit.
 IF NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id"=NEW."audit_event_id"
  AND a."department_id"=NEW."department_id" AND a."actor_kind"='HUMAN'
  AND a."actor_user_id"=NEW."recorded_by_user_id" AND a."internal_actor_user_id"=NEW."recorded_by_user_id"
  AND a."resource_type"='CASE_CLOSURE_PAYMENT_VERSION' AND a."resource_id"=NEW."id"
  AND a."action"=CASE WHEN NEW."revision"=1 THEN 'CASE_CLOSURE_PAYMENT_RECORD'
    WHEN NEW."state"='VOID' THEN 'CASE_CLOSURE_PAYMENT_VOID' ELSE 'CASE_CLOSURE_PAYMENT_CORRECT' END) THEN
  RAISE EXCEPTION 'payment requires exact internal actor audit' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "case_closure_payment_version_guard" BEFORE INSERT OR UPDATE OR DELETE ON "case_closure_payment_versions" FOR EACH ROW EXECUTE FUNCTION "check_case_closure_payment_version"();
-- Evidence links are append-only independently from the temporary draft gate.
CREATE FUNCTION "reject_case_closure_payment_document_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'payment evidence links are immutable' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER "case_closure_payment_document_immutable" BEFORE UPDATE OR DELETE ON "case_closure_payment_documents" FOR EACH ROW EXECUTE FUNCTION "reject_case_closure_payment_document_mutation"();
COMMIT;



