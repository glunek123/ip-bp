-- Independent guards; existing upload/payment draft gates remain enabled.
BEGIN;
CREATE FUNCTION check_case_payment_evidence_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment_action text;
BEGIN
 SELECT action INTO payment_action FROM audit_events WHERE id=NEW.action_event_id;
 IF NEW.purpose<>'CASE_CLOSURE_PAYMENT_PROOF' AND NEW.resource_type<>'case-closure-payment-version'
  AND COALESCE(payment_action,'') NOT IN ('CASE_CLOSURE_PAYMENT_RECORD','CASE_CLOSURE_PAYMENT_CORRECT','CASE_CLOSURE_PAYMENT_VOID') THEN RETURN NEW; END IF;
 IF NEW.purpose<>'CASE_CLOSURE_PAYMENT_PROOF' OR NEW.resource_type<>'case-closure-payment-version' OR NEW.asset_version_id IS NOT NULL THEN
  RAISE EXCEPTION 'payment evidence resource or purpose mismatch' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM case_closure_payment_versions p JOIN audit_events a ON a.id=p.audit_event_id
 JOIN case_closure_payment_documents d ON d.payment_version_id=p.id AND d.case_id=p.case_id AND d.department_id=p.department_id
 JOIN materials m ON m.id=d.material_id AND m.department_id=d.department_id
 JOIN content_versions v ON v.id=d.content_version_id AND v.material_id=m.id
 WHERE p.id=NEW.resource_id AND p.department_id=NEW.department_id AND p.state='ACTIVE'
 AND d.material_id=NEW.material_id AND d.content_version_id=NEW.content_version_id
 AND a.id=NEW.action_event_id AND a.resource_type='CASE_CLOSURE_PAYMENT_VERSION' AND a.resource_id=p.id
 AND a.department_id=p.department_id AND a.actor_kind='HUMAN' AND a.actor_user_id=p.recorded_by_user_id
 AND a.internal_actor_user_id=p.recorded_by_user_id AND a.customer_account_binding_id IS NULL
 AND a.notary_office_account_binding_id IS NULL AND a.lawyer_account_binding_id IS NULL
 AND a.action=CASE WHEN p.revision=1 THEN 'CASE_CLOSURE_PAYMENT_RECORD' ELSE 'CASE_CLOSURE_PAYMENT_CORRECT' END
 AND m.owner_type='CASE' AND m.owner_id=p.case_id AND m.status='ACTIVE' AND m.deleted_at IS NULL
 AND m.category::text='CASE_CLOSURE_PAYMENT_PROOF' AND m.purpose='CASE_CLOSURE_PAYMENT_PROOF'
 AND m.current_version_id=v.id AND v.status='AVAILABLE' AND v.mime_type IN ('image/png','image/jpeg')
 AND v.size_bytes BETWEEN 1 AND 20971520
 AND p.xmin=pg_current_xact_id()::text::xid
 AND a.xmin=pg_current_xact_id()::text::xid
 AND d.xmin=pg_current_xact_id()::text::xid
 FOR SHARE OF p,a,d,m,v;
 IF NOT FOUND THEN RAISE EXCEPTION 'payment evidence lacks exact payment audit and material version' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER case_payment_evidence_reference_guard BEFORE INSERT ON material_references FOR EACH ROW EXECUTE FUNCTION check_case_payment_evidence_reference();
CREATE FUNCTION reject_case_payment_evidence_reference_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.purpose='CASE_CLOSURE_PAYMENT_PROOF' OR OLD.resource_type='case-closure-payment-version'
  OR EXISTS (SELECT 1 FROM audit_events WHERE id=OLD.action_event_id AND action IN ('CASE_CLOSURE_PAYMENT_RECORD','CASE_CLOSURE_PAYMENT_CORRECT','CASE_CLOSURE_PAYMENT_VOID')) THEN
  RAISE EXCEPTION 'payment evidence reference is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.purpose='CASE_CLOSURE_PAYMENT_PROOF' OR NEW.resource_type='case-closure-payment-version'
   OR EXISTS (SELECT 1 FROM audit_events WHERE id=NEW.action_event_id AND action IN ('CASE_CLOSURE_PAYMENT_RECORD','CASE_CLOSURE_PAYMENT_CORRECT','CASE_CLOSURE_PAYMENT_VOID')) THEN
   RAISE EXCEPTION 'payment evidence reference cannot be retargeted' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 RETURN OLD;
END; $$;
CREATE TRIGGER case_payment_evidence_reference_immutable BEFORE UPDATE OR DELETE ON material_references FOR EACH ROW EXECUTE FUNCTION reject_case_payment_evidence_reference_mutation();
COMMIT;
