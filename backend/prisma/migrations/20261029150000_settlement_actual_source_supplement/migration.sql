-- The number is optional. When present, it identifies a source only within
-- department + side + customer/lawyer; NULL never proves two records differ.
DROP INDEX "settlement_actual_facts_department_id_side_source_reference_key";
CREATE UNIQUE INDEX "settlement_actual_source_party_ref_key" ON "settlement_actual_facts"("department_id", "side", "party_id", "source_reference");

CREATE TABLE "settlement_actual_source_supplements" (
  "id" UUID NOT NULL,
  "fact_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "side" "settlement_side" NOT NULL,
  "party_id" UUID NOT NULL,
  "source_reference" VARCHAR(200) NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "audit_event_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "settlement_actual_source_supplements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "settlement_actual_source_supplements_canonical" CHECK (
    "source_reference" = btrim("source_reference") AND length("source_reference") > 0 AND
    "source_reference" !~ '^[[:space:]]|[[:space:]]$')
);
CREATE UNIQUE INDEX "settlement_actual_source_supplements_fact_id_key" ON "settlement_actual_source_supplements"("fact_id");
CREATE UNIQUE INDEX "settlement_actual_source_supplements_fact_id_department_id_side_key" ON "settlement_actual_source_supplements"("fact_id", "department_id", "side");
CREATE UNIQUE INDEX "settlement_actual_supplement_party_ref_key" ON "settlement_actual_source_supplements"("department_id", "side", "party_id", "source_reference");
CREATE UNIQUE INDEX "settlement_actual_source_supplements_department_id_actor_user_id_idempotency_key_key" ON "settlement_actual_source_supplements"("department_id", "actor_user_id", "idempotency_key");
CREATE UNIQUE INDEX "settlement_actual_source_supplements_audit_event_id_key" ON "settlement_actual_source_supplements"("audit_event_id");
ALTER TABLE "settlement_actual_source_supplements" ADD CONSTRAINT "settlement_actual_source_supplements_fact_fk" FOREIGN KEY ("fact_id", "department_id", "side") REFERENCES "settlement_actual_facts"("id", "department_id", "side") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "settlement_actual_source_supplements" ADD CONSTRAINT "settlement_actual_source_supplements_actor_fk" FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "settlement_actual_source_supplements" ADD CONSTRAINT "settlement_actual_source_supplements_audit_fk" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- A shared unique row, rather than a snapshot-dependent cross-table lookup,
-- is the identity arbiter for both original and later supplied numbers.
CREATE TABLE "settlement_actual_source_claims" (
  "fact_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "side" "settlement_side" NOT NULL,
  "party_id" UUID NOT NULL,
  "source_reference" VARCHAR(200) NOT NULL,
  CONSTRAINT "settlement_actual_source_claims_pkey" PRIMARY KEY ("fact_id"),
  CONSTRAINT "settlement_actual_source_claims_canonical" CHECK (
    "source_reference" = btrim("source_reference") AND length("source_reference") > 0 AND
    "source_reference" !~ '^[[:space:]]|[[:space:]]$')
);
CREATE UNIQUE INDEX "settlement_actual_source_claim_identity_key" ON "settlement_actual_source_claims"("department_id", "side", "party_id", "source_reference");
ALTER TABLE "settlement_actual_source_claims" ADD CONSTRAINT "settlement_actual_source_claims_fact_fk"
  FOREIGN KEY ("fact_id", "department_id", "side") REFERENCES "settlement_actual_facts"("id", "department_id", "side")
  ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
INSERT INTO "settlement_actual_source_claims"("fact_id","department_id","side","party_id","source_reference")
  SELECT "id","department_id","side","party_id","source_reference" FROM "settlement_actual_facts" WHERE "source_reference" IS NOT NULL;

CREATE FUNCTION guard_settlement_actual_claim_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM settlement_actual_facts f
      LEFT JOIN settlement_actual_source_supplements s ON s.fact_id=f.id
      WHERE f.id=NEW.fact_id AND f.department_id=NEW.department_id AND f.side=NEW.side AND f.party_id=NEW.party_id
        AND (f.source_reference=NEW.source_reference OR (f.source_reference IS NULL AND s.source_reference=NEW.source_reference))) THEN
    RAISE EXCEPTION 'settlement source claim lacks exact fact' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER settlement_actual_claim_final AFTER INSERT ON settlement_actual_source_claims
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_settlement_actual_claim_final();
CREATE TRIGGER settlement_actual_source_claim_append_only BEFORE UPDATE OR DELETE ON settlement_actual_source_claims
  FOR EACH ROW EXECUTE FUNCTION reject_settlement_actual_mutation();

CREATE FUNCTION guard_settlement_actual_claim_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE claim_fact_id UUID;
BEGIN
  IF TG_TABLE_NAME='settlement_actual_facts' THEN
    IF NEW.source_reference IS NULL THEN RETURN NEW; END IF;
    claim_fact_id := NEW.id;
  ELSE
    claim_fact_id := NEW.fact_id;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM settlement_actual_source_claims c
      WHERE c.fact_id=claim_fact_id
        AND c.department_id=NEW.department_id AND c.side=NEW.side AND c.party_id=NEW.party_id
        AND c.source_reference=NEW.source_reference AND xmin=pg_current_xact_id()::text::xid) THEN
    RAISE EXCEPTION 'settlement source claim missing' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER settlement_actual_claim_before_fact BEFORE INSERT ON settlement_actual_facts
  FOR EACH ROW EXECUTE FUNCTION guard_settlement_actual_claim_link();
CREATE TRIGGER settlement_actual_claim_before_supplement BEFORE INSERT ON settlement_actual_source_supplements
  FOR EACH ROW EXECUTE FUNCTION guard_settlement_actual_claim_link();

CREATE FUNCTION guard_settlement_actual_source_supplement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f settlement_actual_facts%ROWTYPE;
DECLARE a audit_events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM settlement_actual_facts WHERE id=NEW.fact_id AND department_id=NEW.department_id AND side=NEW.side FOR UPDATE;
  IF f.id IS NULL OR f.source_reference IS NOT NULL OR f.party_id<>NEW.party_id OR
     NOT EXISTS(SELECT 1 FROM cases c WHERE c.id=f.source_case_id AND c.department_id=NEW.department_id AND c.responsible_user_id=NEW.actor_user_id) OR
     NOT case_record_edit_actor_authorized(NEW.actor_user_id,f.source_case_id,NEW.department_id,'case.read') THEN
    RAISE EXCEPTION 'settlement source supplement unauthorized or inconsistent' USING ERRCODE='23514';
  END IF;
  SELECT * INTO a FROM audit_events WHERE id=NEW.audit_event_id AND xmin=pg_current_xact_id()::text::xid;
  IF a.id IS NULL OR a.department_id<>NEW.department_id OR a.actor_kind<>'HUMAN'
     OR a.actor_user_id IS DISTINCT FROM NEW.actor_user_id
     OR a.internal_actor_user_id IS DISTINCT FROM NEW.actor_user_id
     OR a.resource_type<>'SETTLEMENT_ACTUAL' OR a.resource_id<>NEW.fact_id
     OR a.action<>'settlement.actual.source-supplemented'
     OR a.details->>'supplementId' IS DISTINCT FROM NEW.id::text
     OR a.details->>'sourceReference' IS DISTINCT FROM NEW.source_reference
     OR a.details->>'side' IS DISTINCT FROM NEW.side::text
     OR a.details->>'partyId' IS DISTINCT FROM NEW.party_id::text
     OR a.details->>'idempotencyKey' IS DISTINCT FROM NEW.idempotency_key
     OR a.details->>'requestFingerprint' IS DISTINCT FROM NEW.request_fingerprint THEN
    RAISE EXCEPTION 'settlement source supplement audit mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER settlement_actual_source_supplement_guard BEFORE INSERT ON settlement_actual_source_supplements
  FOR EACH ROW EXECUTE FUNCTION guard_settlement_actual_source_supplement();
CREATE TRIGGER settlement_actual_source_supplement_append_only BEFORE UPDATE OR DELETE ON settlement_actual_source_supplements
  FOR EACH ROW EXECUTE FUNCTION reject_settlement_actual_mutation();

CREATE OR REPLACE FUNCTION guard_settlement_actual_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM settlement_actual_facts WHERE audit_event_id=OLD.id) OR
     EXISTS(SELECT 1 FROM case_settlement_actual_allocations WHERE audit_event_id=OLD.id) OR
     EXISTS(SELECT 1 FROM settlement_actual_source_supplements WHERE audit_event_id=OLD.id) THEN
    RAISE EXCEPTION 'settlement actual audit is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
