-- Closed draft. This protects only receipts for the new command. It does not
-- provide a reverse guard for legacy terms writes or enable any business gate.
BEGIN;
CREATE TABLE case_closure_amount_update_receipts (
 id uuid PRIMARY KEY, department_id uuid NOT NULL, actor_user_id uuid NOT NULL,
 case_id uuid NOT NULL, idempotency_key varchar(128) NOT NULL,
 request_fingerprint char(64) NOT NULL, closure_version_id uuid NOT NULL,
 terms_version integer NOT NULL CHECK (terms_version>0), assessment_version_id uuid NOT NULL UNIQUE,
 audit_event_id uuid NOT NULL UNIQUE, result_snapshot jsonb NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(department_id,actor_user_id,idempotency_key),
 CHECK(length(idempotency_key)>0 AND idempotency_key=btrim(idempotency_key)),
 CHECK(request_fingerprint ~ '^[0-9a-f]{64}$'), CHECK(jsonb_typeof(result_snapshot)='object'),
 FOREIGN KEY(case_id,department_id) REFERENCES cases(id,department_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY(actor_user_id,department_id) REFERENCES department_memberships(user_id,department_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY(closure_version_id,case_id,department_id) REFERENCES case_closure_versions(id,case_id,department_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY(assessment_version_id,case_id,department_id) REFERENCES case_settlement_assessment_versions(id,case_id,department_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY(audit_event_id) REFERENCES audit_events(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE FUNCTION guard_closure_amount_receipt_closed_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'closure amount receipt is draft and not enabled' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER closure_amount_receipt_closed_draft BEFORE INSERT OR UPDATE OR DELETE ON case_closure_amount_update_receipts
 FOR EACH ROW EXECUTE FUNCTION guard_closure_amount_receipt_closed_draft();
CREATE FUNCTION guard_closure_amount_receipt_immutable_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'closure amount receipt is immutable' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER closure_amount_receipt_immutable_draft BEFORE UPDATE OR DELETE ON case_closure_amount_update_receipts
 FOR EACH ROW EXECUTE FUNCTION guard_closure_amount_receipt_immutable_draft();
CREATE FUNCTION check_closure_amount_receipt_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a audit_events%ROWTYPE; v case_settlement_assessment_versions%ROWTYPE;
 ar case_settlement_assessment_receipts%ROWTYPE; t case_settlement_terms%ROWTYPE; child_key text;
BEGIN
 SELECT * INTO a FROM audit_events WHERE id=NEW.audit_event_id AND xmin=pg_current_xact_id()::text::xid;
 SELECT * INTO v FROM case_settlement_assessment_versions WHERE id=NEW.assessment_version_id AND xmin=pg_current_xact_id()::text::xid;
 SELECT * INTO ar FROM case_settlement_assessment_receipts WHERE assessment_version_id=NEW.assessment_version_id AND xmin=pg_current_xact_id()::text::xid;
 SELECT * INTO t FROM case_settlement_terms WHERE case_id=NEW.case_id AND department_id=NEW.department_id AND xmin=pg_current_xact_id()::text::xid;
 child_key:='amount-assessment:'||encode(sha256(convert_to('['||to_json(NEW.department_id::text)::text||','||to_json(NEW.actor_user_id::text)::text||','||to_json(NEW.idempotency_key::text)::text||']','UTF8')),'hex');
 IF NOT EXISTS(SELECT 1 FROM cases c JOIN case_closures h ON h.case_id=c.id AND h.department_id=c.department_id
   WHERE c.id=NEW.case_id AND c.department_id=NEW.department_id AND c.stage='WAITING_ARCHIVE' AND h.current_version_id=NEW.closure_version_id)
  OR a.id IS NULL OR a.department_id IS DISTINCT FROM NEW.department_id OR a.actor_kind::text IS DISTINCT FROM 'HUMAN'
  OR a.actor_user_id IS DISTINCT FROM NEW.actor_user_id OR a.internal_actor_user_id IS DISTINCT FROM NEW.actor_user_id
  OR a.customer_account_binding_id IS NOT NULL OR a.lawyer_account_binding_id IS NOT NULL OR a.notary_office_account_binding_id IS NOT NULL
  OR a.resource_type IS DISTINCT FROM 'CASE' OR a.resource_id IS DISTINCT FROM NEW.case_id OR a.action IS DISTINCT FROM 'case.closure.settlement_amounts.updated'
  OR a.details->>'requestFingerprint' IS DISTINCT FROM NEW.request_fingerprint OR a.details->>'parentIdempotencyKey' IS DISTINCT FROM NEW.idempotency_key
  OR v.id IS NULL OR v.case_id IS DISTINCT FROM NEW.case_id OR v.department_id IS DISTINCT FROM NEW.department_id
  OR v.closure_version_id IS DISTINCT FROM NEW.closure_version_id OR v.terms_version IS DISTINCT FROM NEW.terms_version OR v.recorded_by_user_id IS DISTINCT FROM NEW.actor_user_id
  OR ar.id IS NULL OR ar.case_id IS DISTINCT FROM NEW.case_id OR ar.department_id IS DISTINCT FROM NEW.department_id
  OR ar.actor_user_id IS DISTINCT FROM NEW.actor_user_id OR ar.idempotency_key IS DISTINCT FROM child_key OR ar.audit_event_id IS DISTINCT FROM v.audit_event_id
  OR NOT EXISTS(SELECT 1 FROM audit_events aa WHERE aa.id=v.audit_event_id AND aa.xmin=pg_current_xact_id()::text::xid)
  OR t.case_id IS NULL OR t.version IS DISTINCT FROM NEW.terms_version
  OR NEW.result_snapshot->>'caseId' IS DISTINCT FROM NEW.case_id::text OR NEW.result_snapshot->>'closureVersionId' IS DISTINCT FROM NEW.closure_version_id::text
  OR NEW.result_snapshot->>'assessmentVersionId' IS DISTINCT FROM NEW.assessment_version_id::text OR NEW.result_snapshot->'termsVersion' IS DISTINCT FROM to_jsonb(NEW.terms_version)
  OR NEW.result_snapshot#>>'{change,auditEventId}' IS DISTINCT FROM NEW.audit_event_id::text
  OR a.details->'before' IS DISTINCT FROM NEW.result_snapshot#>'{change,before}' OR a.details->'after' IS DISTINCT FROM NEW.result_snapshot#>'{change,after}'
  OR NEW.result_snapshot#>'{change,after,version}' IS DISTINCT FROM to_jsonb(NEW.terms_version)
  OR NEW.terms_version IS DISTINCT FROM coalesce((NEW.result_snapshot#>>'{change,before,version}')::integer,0)+1
  OR NEW.result_snapshot IS DISTINCT FROM jsonb_build_object('caseId',NEW.case_id,'closureVersionId',NEW.closure_version_id,'assessmentVersionId',NEW.assessment_version_id,'termsVersion',NEW.terms_version,'change',jsonb_build_object('auditEventId',NEW.audit_event_id,'before',a.details->'before','after',a.details->'after'))
  OR t.customer_manual_amount IS DISTINCT FROM (NEW.result_snapshot#>>'{change,after,customerManualAmount}')::numeric
  OR t.lawyer_manual_amount IS DISTINCT FROM (NEW.result_snapshot#>>'{change,after,lawyerManualAmount}')::numeric
  OR v.calculation_inputs->'customerManualAmount' IS DISTINCT FROM NEW.result_snapshot#>'{change,after,customerManualAmount}'
  OR v.calculation_inputs->'lawyerManualAmount' IS DISTINCT FROM NEW.result_snapshot#>'{change,after,lawyerManualAmount}'
 THEN RAISE EXCEPTION 'closure amount receipt source mismatch' USING ERRCODE='23514'; END IF;
 PERFORM assert_case_financial_actor_draft(NEW.actor_user_id,NEW.case_id,NEW.department_id,NEW.audit_event_id,NEW.case_id,'CASE','case.closure.settlement_amounts.updated',ARRAY['WAITING_ARCHIVE']);
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER closure_amount_receipt_final_draft AFTER INSERT ON case_closure_amount_update_receipts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_closure_amount_receipt_draft();
CREATE FUNCTION seal_closure_amount_audit_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM case_closure_amount_update_receipts WHERE audit_event_id=OLD.id) THEN
  RAISE EXCEPTION 'closure amount audit is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER closure_amount_audit_seal_draft BEFORE UPDATE OR DELETE ON audit_events
 FOR EACH ROW EXECUTE FUNCTION seal_closure_amount_audit_draft();
COMMIT;

