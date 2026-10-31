-- DRAFT: no API activation and no historical data rewrite.
-- An explicit REGISTER_CASE_ACTUAL declaration asserts one atomic full allocation.
-- CREATE_ACTUAL / ALLOCATE_ACTUAL and historical audits retain their existing rules.
BEGIN;

CREATE FUNCTION guard_settlement_actual_registration_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only registerForCase emits allocationId on a created audit. Presence,
  -- including JSON null, is a declaration and cannot silently lose its marker.
  IF NEW.action='settlement.actual.created' AND NEW.details ? 'allocationId'
    AND NEW.details->>'command' IS DISTINCT FROM 'REGISTER_CASE_ACTUAL' THEN
    RAISE EXCEPTION 'created allocation declaration requires atomic command marker' USING ERRCODE='23514';
  END IF;
  IF NEW.details->>'command' IS DISTINCT FROM 'REGISTER_CASE_ACTUAL' THEN RETURN NULL; END IF;
  IF NEW.action NOT IN ('settlement.actual.created','settlement.actual.allocated') OR NOT EXISTS (
    SELECT 1
    FROM settlement_actual_facts f
    JOIN case_settlement_actual_allocations v ON v.fact_id=f.id
    JOIN audit_events fa ON fa.id=f.audit_event_id
    JOIN audit_events va ON va.id=v.audit_event_id
    WHERE (NEW.id=fa.id OR NEW.id=va.id)
      AND f.xmin=pg_current_xact_id()::text::xid
      AND v.xmin=pg_current_xact_id()::text::xid
      AND fa.xmin=pg_current_xact_id()::text::xid
      AND va.xmin=pg_current_xact_id()::text::xid
      AND v.case_id=f.source_case_id AND v.department_id=f.department_id
      AND v.side=f.side AND v.amount=f.amount
      AND v.actor_user_id=f.actor_user_id
      AND v.idempotency_key=f.idempotency_key
      AND v.request_fingerprint=f.request_fingerprint
      AND fa.action='settlement.actual.created'
      AND fa.resource_type='SETTLEMENT_ACTUAL' AND fa.resource_id=f.id
      AND va.action='settlement.actual.allocated'
      AND va.resource_type='CASE' AND va.resource_id=v.case_id
      AND fa.department_id=f.department_id AND va.department_id=f.department_id
      AND fa.actor_kind='HUMAN' AND va.actor_kind='HUMAN'
      AND fa.actor_user_id=f.actor_user_id AND va.actor_user_id=f.actor_user_id
      AND fa.internal_actor_user_id=f.actor_user_id AND va.internal_actor_user_id=f.actor_user_id
      AND fa.details->>'command'='REGISTER_CASE_ACTUAL'
      AND va.details->>'command'='REGISTER_CASE_ACTUAL'
      AND fa.details->>'allocationId'=v.id::text
      AND fa.details->>'caseId'=f.source_case_id::text
      AND va.details->>'allocationId'=v.id::text
      AND va.details->>'factId'=f.id::text
      AND (fa.details->>'amount')::numeric=f.amount
      AND (va.details->>'amount')::numeric=v.amount
      AND fa.details->>'idempotencyKey'=f.idempotency_key
      AND va.details->>'idempotencyKey'=v.idempotency_key
      AND fa.details->>'requestFingerprint'=f.request_fingerprint
      AND va.details->>'requestFingerprint'=v.request_fingerprint
  ) THEN
    RAISE EXCEPTION 'atomic actual registration requires exact transaction-local fact and full case allocation' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER settlement_actual_registration_final
  AFTER INSERT ON audit_events DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION guard_settlement_actual_registration_final();

-- Protect declarations even before a fact exists. An UPDATE cannot add a marker
-- without the INSERT constraint, or remove one to evade the deferred check.
CREATE FUNCTION guard_settlement_actual_registration_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.details->>'command'='REGISTER_CASE_ACTUAL' THEN
    RAISE EXCEPTION 'atomic actual registration declaration is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.details->>'command'='REGISTER_CASE_ACTUAL'
      OR (NEW.action='settlement.actual.created' AND NEW.details ? 'allocationId') THEN
      RAISE EXCEPTION 'atomic actual registration declaration requires insert' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END; $$;
CREATE TRIGGER settlement_actual_registration_audit_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION guard_settlement_actual_registration_audit_mutation();

COMMIT;
