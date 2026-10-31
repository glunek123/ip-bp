CREATE TABLE "settlement_actual_facts" (
  "id" UUID NOT NULL,
  "source_case_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "side" "settlement_side" NOT NULL,
  "amount" DECIMAL(30,2) NOT NULL,
  "occurred_on" DATE NOT NULL,
  "party_id" UUID NOT NULL,
  "source_reference" VARCHAR(200),
  "note" VARCHAR(500),
  "actor_user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "audit_event_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "settlement_actual_facts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "settlement_actual_facts_positive_amount" CHECK ("amount" > 0),
  CONSTRAINT "settlement_actual_facts_source_canonical" CHECK (
    "source_reference" IS NULL OR
    ("source_reference" = btrim("source_reference") AND length("source_reference") > 0 AND
     "source_reference" !~ '^[[:space:]]|[[:space:]]$'))
);
CREATE UNIQUE INDEX "settlement_actual_facts_id_department_id_side_key" ON "settlement_actual_facts"("id", "department_id", "side");
CREATE UNIQUE INDEX "settlement_actual_facts_department_id_side_source_reference_key" ON "settlement_actual_facts"("department_id", "side", "source_reference");
CREATE UNIQUE INDEX "settlement_actual_facts_department_id_actor_user_id_idempotency_key_key" ON "settlement_actual_facts"("department_id", "actor_user_id", "idempotency_key");
CREATE UNIQUE INDEX "settlement_actual_facts_audit_event_id_key" ON "settlement_actual_facts"("audit_event_id");
CREATE INDEX "settlement_actual_facts_department_id_side_occurred_on_idx" ON "settlement_actual_facts"("department_id", "side", "occurred_on");
ALTER TABLE "settlement_actual_facts" ADD CONSTRAINT "settlement_actual_facts_actor_fk" FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "settlement_actual_facts" ADD CONSTRAINT "settlement_actual_facts_source_case_fk" FOREIGN KEY ("source_case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "settlement_actual_facts" ADD CONSTRAINT "settlement_actual_facts_audit_fk" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "case_settlement_actual_allocations" (
  "id" UUID NOT NULL,
  "fact_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "side" "settlement_side" NOT NULL,
  "amount" DECIMAL(30,2) NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "audit_event_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_settlement_actual_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_settlement_actual_allocations_positive_amount" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "case_settlement_actual_allocations_department_id_actor_user_id_idempotency_key_key" ON "case_settlement_actual_allocations"("department_id", "actor_user_id", "idempotency_key");
CREATE UNIQUE INDEX "case_settlement_actual_allocations_audit_event_id_key" ON "case_settlement_actual_allocations"("audit_event_id");
CREATE INDEX "case_settlement_actual_allocations_case_id_department_id_side_idx" ON "case_settlement_actual_allocations"("case_id", "department_id", "side");
CREATE INDEX "case_settlement_actual_allocations_fact_id_department_id_idx" ON "case_settlement_actual_allocations"("fact_id", "department_id");
ALTER TABLE "case_settlement_actual_allocations" ADD CONSTRAINT "case_settlement_actual_allocations_fact_fk" FOREIGN KEY ("fact_id", "department_id", "side") REFERENCES "settlement_actual_facts"("id", "department_id", "side") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "case_settlement_actual_allocations" ADD CONSTRAINT "case_settlement_actual_allocations_case_fk" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "case_settlement_actual_allocations" ADD CONSTRAINT "case_settlement_actual_allocations_actor_fk" FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "case_settlement_actual_allocations" ADD CONSTRAINT "case_settlement_actual_allocations_audit_fk" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Serialize all allocation writes for a source, including direct SQL callers.
CREATE FUNCTION guard_settlement_actual_allocation() RETURNS trigger AS $$
DECLARE source_amount DECIMAL(30,2);
DECLARE allocated_amount DECIMAL(30,2);
BEGIN
  SELECT amount INTO source_amount FROM settlement_actual_facts
  WHERE id = NEW.fact_id AND department_id = NEW.department_id AND side = NEW.side
  FOR UPDATE;
  IF source_amount IS NULL THEN RAISE EXCEPTION 'settlement source missing' USING ERRCODE = '23503'; END IF;
  SELECT COALESCE(SUM(amount), 0) INTO allocated_amount
  FROM case_settlement_actual_allocations WHERE fact_id = NEW.fact_id;
  IF allocated_amount + NEW.amount > source_amount THEN
    RAISE EXCEPTION 'settlement source amount exceeded' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER guard_settlement_actual_allocation_before_insert
  BEFORE INSERT ON case_settlement_actual_allocations
  FOR EACH ROW EXECUTE FUNCTION guard_settlement_actual_allocation();

CREATE FUNCTION reject_settlement_actual_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'settlement actual facts are append-only' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER settlement_actual_facts_append_only
  BEFORE UPDATE OR DELETE ON settlement_actual_facts
  FOR EACH ROW EXECUTE FUNCTION reject_settlement_actual_mutation();
CREATE TRIGGER case_settlement_actual_allocations_append_only
  BEFORE UPDATE OR DELETE ON case_settlement_actual_allocations
  FOR EACH ROW EXECUTE FUNCTION reject_settlement_actual_mutation();

-- The new facts must point to a transaction-local, exact audit row. This is
-- additive: older audit actions and their existing guards keep their rules.
CREATE FUNCTION guard_settlement_actual_fact_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a audit_events%ROWTYPE;
DECLARE source_customer UUID;
BEGIN
  SELECT customer_id INTO source_customer FROM cases
    WHERE id=NEW.source_case_id AND department_id=NEW.department_id AND responsible_user_id=NEW.actor_user_id;
  IF source_customer IS NULL OR NOT case_record_edit_actor_authorized(NEW.actor_user_id,NEW.source_case_id,NEW.department_id,'case.read') THEN
    RAISE EXCEPTION 'settlement actual actor unauthorized' USING ERRCODE='23514';
  END IF;
  IF (NEW.side='CUSTOMER' AND NEW.party_id<>source_customer) OR
     (NEW.side='LAWYER' AND NOT EXISTS (
       SELECT 1 FROM case_lawyer_assignments l WHERE l.case_id=NEW.source_case_id
       AND l.department_id=NEW.department_id AND l.lawyer_id=NEW.party_id AND l.ended_at IS NULL)) THEN
    RAISE EXCEPTION 'settlement actual party mismatch' USING ERRCODE='23514';
  END IF;
  SELECT * INTO a FROM audit_events WHERE id=NEW.audit_event_id AND xmin=pg_current_xact_id()::text::xid;
  IF a.id IS NULL OR a.department_id<>NEW.department_id OR a.actor_kind<>'HUMAN'
     OR a.actor_user_id IS DISTINCT FROM NEW.actor_user_id
     OR a.internal_actor_user_id IS DISTINCT FROM NEW.actor_user_id
     OR a.resource_type<>'SETTLEMENT_ACTUAL' OR a.resource_id<>NEW.id
     OR a.action<>'settlement.actual.created'
     OR a.details->>'caseId' IS DISTINCT FROM NEW.source_case_id::text
     OR a.details->>'side' IS DISTINCT FROM NEW.side::text
     OR a.details->>'partyId' IS DISTINCT FROM NEW.party_id::text
     OR (a.details->>'amount')::numeric IS DISTINCT FROM NEW.amount
     OR a.details->>'occurredOn' IS DISTINCT FROM NEW.occurred_on::text
     OR a.details->>'sourceReference' IS DISTINCT FROM NEW.source_reference
     OR a.details->>'idempotencyKey' IS DISTINCT FROM NEW.idempotency_key
     OR a.details->>'requestFingerprint' IS DISTINCT FROM NEW.request_fingerprint THEN
    RAISE EXCEPTION 'settlement actual audit mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER settlement_actual_fact_insert_guard BEFORE INSERT ON settlement_actual_facts
  FOR EACH ROW EXECUTE FUNCTION guard_settlement_actual_fact_insert();

CREATE FUNCTION guard_settlement_actual_allocation_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a audit_events%ROWTYPE;
DECLARE f settlement_actual_facts%ROWTYPE;
DECLARE target_customer UUID;
BEGIN
  SELECT * INTO f FROM settlement_actual_facts WHERE id=NEW.fact_id AND department_id=NEW.department_id AND side=NEW.side;
  SELECT customer_id INTO target_customer FROM cases
    WHERE id=NEW.case_id AND department_id=NEW.department_id AND responsible_user_id=NEW.actor_user_id;
  IF f.id IS NULL OR target_customer IS NULL OR
     NOT case_record_edit_actor_authorized(NEW.actor_user_id,NEW.case_id,NEW.department_id,'case.read') THEN
    RAISE EXCEPTION 'settlement allocation actor unauthorized' USING ERRCODE='23514';
  END IF;
  IF (NEW.side='CUSTOMER' AND f.party_id<>target_customer) OR
     (NEW.side='LAWYER' AND NOT EXISTS (
       SELECT 1 FROM case_lawyer_assignments l WHERE l.case_id=NEW.case_id
       AND l.department_id=NEW.department_id AND l.lawyer_id=f.party_id AND l.ended_at IS NULL)) THEN
    RAISE EXCEPTION 'settlement allocation party mismatch' USING ERRCODE='23514';
  END IF;
  SELECT * INTO a FROM audit_events WHERE id=NEW.audit_event_id AND xmin=pg_current_xact_id()::text::xid;
  IF a.id IS NULL OR a.department_id<>NEW.department_id OR a.actor_kind<>'HUMAN'
     OR a.actor_user_id IS DISTINCT FROM NEW.actor_user_id
     OR a.internal_actor_user_id IS DISTINCT FROM NEW.actor_user_id
     OR a.resource_type<>'CASE' OR a.resource_id<>NEW.case_id
     OR a.action<>'settlement.actual.allocated'
     OR a.details->>'allocationId' IS DISTINCT FROM NEW.id::text
     OR a.details->>'factId' IS DISTINCT FROM NEW.fact_id::text
     OR a.details->>'side' IS DISTINCT FROM NEW.side::text
     OR a.details->>'partyId' IS DISTINCT FROM f.party_id::text
     OR a.details->>'sourceReference' IS DISTINCT FROM f.source_reference
     OR (a.details->>'amount')::numeric IS DISTINCT FROM NEW.amount
     OR a.details->>'idempotencyKey' IS DISTINCT FROM NEW.idempotency_key
     OR a.details->>'requestFingerprint' IS DISTINCT FROM NEW.request_fingerprint THEN
    RAISE EXCEPTION 'settlement allocation audit mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER settlement_actual_allocation_identity_guard BEFORE INSERT ON case_settlement_actual_allocations
  FOR EACH ROW EXECUTE FUNCTION guard_settlement_actual_allocation_identity();

CREATE FUNCTION guard_settlement_actual_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM settlement_actual_facts WHERE audit_event_id=OLD.id) OR
     EXISTS(SELECT 1 FROM case_settlement_actual_allocations WHERE audit_event_id=OLD.id) THEN
    RAISE EXCEPTION 'settlement actual audit is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER settlement_actual_audit_immutable BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION guard_settlement_actual_audit_mutation();
