-- Unexecuted, forward-only contract. No historical rows are filled and no gates are opened.
BEGIN;
CREATE TABLE case_closure_settlement_update_receipts (
 id uuid PRIMARY KEY, case_id uuid NOT NULL, department_id uuid NOT NULL, actor_user_id uuid NOT NULL,
 idempotency_key varchar(128) NOT NULL CHECK (length(idempotency_key)>0 AND idempotency_key !~ '^[[:space:]]|[[:space:]]$'),
 request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
 closure_version_id uuid NOT NULL UNIQUE, closure_audit_event_id uuid NOT NULL UNIQUE,
 refund_included boolean NOT NULL, refund_version_id uuid,
 assessment_included boolean NOT NULL, assessment_version_id uuid,
 audit_event_id uuid NOT NULL UNIQUE, result_snapshot jsonb NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT closure_settlement_update_actor_key UNIQUE(department_id,actor_user_id,idempotency_key),
 UNIQUE(id,case_id,department_id),
 CHECK(refund_included=(refund_version_id IS NOT NULL)), CHECK(assessment_included=(assessment_version_id IS NOT NULL)),
 FOREIGN KEY(case_id,department_id) REFERENCES cases(id,department_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(actor_user_id,department_id) REFERENCES department_memberships(user_id,department_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(closure_version_id,case_id,department_id) REFERENCES case_closure_versions(id,case_id,department_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(closure_audit_event_id) REFERENCES audit_events(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(refund_version_id,case_id,department_id) REFERENCES case_refund_inventory_versions(id,case_id,department_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(assessment_version_id,case_id,department_id) REFERENCES case_settlement_assessment_versions(id,case_id,department_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(audit_event_id) REFERENCES audit_events(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE case_closure_settlement_update_payments (
 receipt_id uuid NOT NULL, case_id uuid NOT NULL, department_id uuid NOT NULL,
 position integer NOT NULL CHECK(position>=0), payment_version_id uuid NOT NULL UNIQUE, audit_event_id uuid NOT NULL UNIQUE,
 PRIMARY KEY(receipt_id,position),
 FOREIGN KEY(receipt_id,case_id,department_id) REFERENCES case_closure_settlement_update_receipts(id,case_id,department_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(payment_version_id,case_id,department_id) REFERENCES case_closure_payment_versions(id,case_id,department_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(audit_event_id) REFERENCES audit_events(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE FUNCTION guard_closure_settlement_update_receipt_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'closure settlement update receipts remain draft and immutable' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER closure_settlement_update_receipt_gate BEFORE INSERT OR UPDATE OR DELETE ON case_closure_settlement_update_receipts FOR EACH ROW EXECUTE FUNCTION guard_closure_settlement_update_receipt_draft();
CREATE TRIGGER closure_settlement_update_payment_gate BEFORE INSERT OR UPDATE OR DELETE ON case_closure_settlement_update_payments FOR EACH ROW EXECUTE FUNCTION guard_closure_settlement_update_receipt_draft();
CREATE FUNCTION reject_closure_settlement_update_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable closure settlement update receipt or child' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER closure_settlement_update_receipt_immutable BEFORE UPDATE OR DELETE ON case_closure_settlement_update_receipts FOR EACH ROW EXECUTE FUNCTION reject_closure_settlement_update_mutation();
CREATE TRIGGER closure_settlement_update_payment_immutable BEFORE UPDATE OR DELETE ON case_closure_settlement_update_payments FOR EACH ROW EXECUTE FUNCTION reject_closure_settlement_update_mutation();
CREATE FUNCTION check_closure_settlement_update_receipt_final() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; v record; a record; payment_ids jsonb; expected jsonb;
BEGIN
 IF TG_TABLE_NAME='case_closure_settlement_update_payments' THEN
  SELECT * INTO r FROM case_closure_settlement_update_receipts WHERE id=NEW.receipt_id;
 ELSE SELECT * INTO r FROM case_closure_settlement_update_receipts WHERE id=NEW.id; END IF;
 SELECT *,xmin AS creation_xmin INTO v FROM case_closure_versions WHERE id=r.closure_version_id;
 SELECT *,xmin AS creation_xmin INTO a FROM audit_events WHERE id=r.audit_event_id;
 IF r.id IS NULL OR v.id IS NULL OR v.kind<>'CORRECT' OR v.case_id<>r.case_id OR v.department_id<>r.department_id OR
  v.audit_event_id<>r.closure_audit_event_id OR v.recorded_by_user_id<>r.actor_user_id OR
  v.creation_xmin<>pg_current_xact_id()::text::xid OR r.created_at<v.recorded_at OR NOT EXISTS(
   SELECT 1 FROM cases c JOIN case_closures h ON h.case_id=c.id AND h.department_id=c.department_id
   WHERE c.id=r.case_id AND c.department_id=r.department_id AND c.stage='WAITING_ARCHIVE'
    AND c.version=v.to_version AND h.current_version_id=v.id) OR NOT EXISTS(
   SELECT 1 FROM case_closure_receipts cr WHERE cr.case_id=r.case_id AND cr.department_id=r.department_id
    AND cr.actor_user_id=r.actor_user_id AND cr.command='CORRECT' AND cr.idempotency_key=r.idempotency_key
    AND cr.request_fingerprint=r.request_fingerprint AND cr.result_snapshot->>'closureVersionId'=v.id::text
 ) THEN RAISE EXCEPTION 'settlement update lacks exact closure correction' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM case_closure_settlement_update_payments link JOIN case_closure_payment_versions p ON p.id=link.payment_version_id
  WHERE link.receipt_id=r.id AND (p.closure_version_id<>v.id OR p.case_id<>r.case_id OR p.department_id<>r.department_id
   OR p.revision<>1 OR p.state<>'ACTIVE' OR p.prior_version_id IS NOT NULL OR p.payment_id<>p.id
   OR p.recorded_by_user_id<>r.actor_user_id OR p.audit_event_id<>link.audit_event_id OR p.xmin<>pg_current_xact_id()::text::xid
   OR NOT EXISTS(SELECT 1 FROM case_closure_payment_receipts child WHERE child.payment_version_id=p.id
    AND child.case_id=r.case_id AND child.department_id=r.department_id AND child.actor_user_id=r.actor_user_id
    AND child.audit_event_id=p.audit_event_id AND child.request_fingerprint=r.request_fingerprint))) THEN
   RAISE EXCEPTION 'settlement update payment child mismatch' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM case_closure_payment_versions WHERE closure_version_id=v.id)<>(SELECT count(*) FROM case_closure_settlement_update_payments WHERE receipt_id=r.id) THEN
  RAISE EXCEPTION 'settlement update payment set incomplete' USING ERRCODE='23514'; END IF;
 IF r.refund_included AND NOT EXISTS(SELECT 1 FROM case_refund_inventory_versions child JOIN case_refund_inventory_receipts cr ON cr.inventory_version_id=child.id
  WHERE child.id=r.refund_version_id AND child.case_id=r.case_id AND child.department_id=r.department_id
   AND child.recorded_by_user_id=r.actor_user_id AND child.xmin=pg_current_xact_id()::text::xid
   AND cr.actor_user_id=r.actor_user_id AND cr.request_fingerprint=r.request_fingerprint) THEN
  RAISE EXCEPTION 'settlement update refund child mismatch' USING ERRCODE='23514'; END IF;
 IF r.assessment_included AND NOT EXISTS(SELECT 1 FROM case_settlement_assessment_versions child JOIN case_settlement_assessment_receipts cr ON cr.assessment_version_id=child.id
  WHERE child.id=r.assessment_version_id AND child.case_id=r.case_id AND child.department_id=r.department_id
   AND child.closure_version_id=v.id AND child.recorded_by_user_id=r.actor_user_id AND child.xmin=pg_current_xact_id()::text::xid
   AND cr.actor_user_id=r.actor_user_id AND cr.request_fingerprint=r.request_fingerprint) THEN
  RAISE EXCEPTION 'settlement update assessment child mismatch' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM case_closure_settlement_update_payments WHERE receipt_id=r.id
  GROUP BY receipt_id HAVING min(position)<>0 OR max(position)<>count(*)-1) THEN
  RAISE EXCEPTION 'settlement update payment order is not consecutive' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(payment_version_id ORDER BY position),'[]'::jsonb) INTO payment_ids FROM case_closure_settlement_update_payments WHERE receipt_id=r.id;
 expected:=jsonb_build_object('id',r.case_id,'stage','WAITING_ARCHIVE','version',v.to_version,'closureId',v.closure_id,'closureVersionId',v.id,
  'recordedAt',to_char(v.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'paymentVersionIds',payment_ids,'refundInventoryVersionId',r.refund_version_id,'settlementAssessmentVersionId',r.assessment_version_id);
 IF r.result_snapshot IS DISTINCT FROM expected OR a.id IS NULL OR a.department_id<>r.department_id OR a.actor_kind<>'HUMAN'
  OR a.actor_user_id IS DISTINCT FROM r.actor_user_id OR a.internal_actor_user_id IS DISTINCT FROM r.actor_user_id
  OR a.customer_account_binding_id IS NOT NULL OR a.lawyer_account_binding_id IS NOT NULL OR a.notary_office_account_binding_id IS NOT NULL
  OR a.resource_type<>'CASE_CLOSURE_SETTLEMENT_UPDATE' OR a.resource_id<>r.id OR a.action<>'CASE_CLOSURE_SETTLEMENT_UPDATED'
  OR a.creation_xmin<>pg_current_xact_id()::text::xid OR a.details IS DISTINCT FROM jsonb_build_object('requestFingerprint',r.request_fingerprint,'result',expected)
 THEN RAISE EXCEPTION 'settlement update exact audit or response mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER closure_settlement_update_receipt_final AFTER INSERT ON case_closure_settlement_update_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_closure_settlement_update_receipt_final();
CREATE CONSTRAINT TRIGGER closure_settlement_update_payment_final AFTER INSERT ON case_closure_settlement_update_payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_closure_settlement_update_receipt_final();
COMMIT;
