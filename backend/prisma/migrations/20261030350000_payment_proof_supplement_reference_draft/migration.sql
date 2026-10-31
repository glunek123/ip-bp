-- CLOSED DRAFT. Independent supplement resource; original payment documents,
-- receipts, ordinary reference uniqueness and all write gates remain unchanged.
BEGIN;
CREATE FUNCTION assert_payment_proof_supplement_reference_draft(r material_references)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF r.resource_type<>'case-payment-proof-supplement' OR r.purpose<>'CASE_CLOSURE_PAYMENT_PROOF'
  OR r.asset_version_id IS NOT NULL OR r.action_event_id IS NULL THEN
  RAISE EXCEPTION 'supplement reference resource or purpose mismatch' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM case_payment_proof_supplements s
 JOIN case_payment_proof_supplement_documents d ON d.supplement_id=s.id
  AND d.payment_version_id=s.payment_version_id AND d.case_id=s.case_id AND d.department_id=s.department_id
 JOIN case_closure_payment_versions p ON p.id=s.payment_version_id AND p.payment_id=s.payment_id
  AND p.case_id=s.case_id AND p.department_id=s.department_id
 JOIN audit_events a ON a.id=s.audit_event_id
 JOIN materials m ON m.id=d.material_id AND m.department_id=s.department_id
 JOIN content_versions v ON v.id=d.content_version_id AND v.material_id=m.id
 WHERE s.id=r.resource_id AND s.department_id=r.department_id
  AND d.material_id=r.material_id AND d.content_version_id=r.content_version_id
  AND a.id=r.action_event_id AND a.department_id=s.department_id
  AND a.resource_type='CASE_PAYMENT_PROOF_SUPPLEMENT' AND a.resource_id=s.id
  AND a.action='CASE_PAYMENT_PROOF_SUPPLEMENTED' AND a.actor_kind='HUMAN'
  AND a.actor_user_id=s.actor_user_id AND a.internal_actor_user_id=s.actor_user_id
  AND a.customer_account_binding_id IS NULL AND a.lawyer_account_binding_id IS NULL
  AND a.notary_office_account_binding_id IS NULL
  AND p.state='ACTIVE' AND NOT EXISTS(SELECT 1 FROM case_closure_payment_versions n WHERE n.prior_version_id=p.id)
  AND m.owner_type='CASE' AND m.owner_id=s.case_id AND m.status='ACTIVE' AND m.deleted_at IS NULL
  AND m.category::text='CASE_CLOSURE_PAYMENT_PROOF' AND m.purpose='CASE_CLOSURE_PAYMENT_PROOF'
  AND m.current_version_id=v.id AND v.status='AVAILABLE' AND v.mime_type IN ('image/png','image/jpeg')
  AND v.size_bytes BETWEEN 1 AND 20971520
  AND s.xmin=pg_current_xact_id()::text::xid AND d.xmin=pg_current_xact_id()::text::xid
  AND a.xmin=pg_current_xact_id()::text::xid
 FOR SHARE OF s,d,p,a,m,v;
 IF NOT FOUND THEN RAISE EXCEPTION 'supplement reference lacks exact same-transaction event audit and document' USING ERRCODE='23514'; END IF;
 -- Reuse the event final guard for current closure, eligibility, exact result
 -- and audit details. Its deferred triggers also run at transaction end.
END; $$;

-- Fail closed on unexpected installed function text/identity. Only insert a
-- narrowly scoped branch; retain every original ordinary guard byte.
DO $extend$
DECLARE old_body text; function_oid oid; expected_body text := $original$
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
END; $original$; branch text := $branch$
 IF NEW.resource_type='case-payment-proof-supplement' OR EXISTS(
  SELECT 1 FROM audit_events WHERE id=NEW.action_event_id AND action='CASE_PAYMENT_PROOF_SUPPLEMENTED') THEN
  PERFORM assert_payment_proof_supplement_reference_draft(NEW);
  RETURN NEW;
 END IF;
$branch$;
BEGIN
 SELECT p.oid,p.prosrc INTO function_oid,old_body FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname=current_schema() AND p.proname='check_case_payment_evidence_reference'
  AND p.pronargs=0 AND p.prorettype='trigger'::regtype AND l.lanname='plpgsql' AND NOT p.prosecdef;
 IF function_oid IS NULL OR replace(old_body,E'\r\n',E'\n') IS DISTINCT FROM replace(expected_body,E'\r\n',E'\n')
  OR NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='material_references'::regclass
   AND t.tgname='case_payment_evidence_reference_guard' AND t.tgfoid=function_oid
   AND t.tgtype=7 AND t.tgenabled='O' AND NOT t.tgisinternal)
 THEN RAISE EXCEPTION 'unrecognized original payment reference guard' USING ERRCODE='23514'; END IF;
 old_body:=replace(old_body,E'\r\n',E'\n');
 EXECUTE format('CREATE OR REPLACE FUNCTION %I.check_case_payment_evidence_reference() RETURNS trigger LANGUAGE plpgsql AS %L',
  current_schema(),replace(old_body,E'\nBEGIN\n',E'\nBEGIN\n'||branch));
END; $extend$;

CREATE FUNCTION reject_payment_proof_supplement_reference_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.resource_type='case-payment-proof-supplement' OR EXISTS(
  SELECT 1 FROM audit_events WHERE id=OLD.action_event_id AND action='CASE_PAYMENT_PROOF_SUPPLEMENTED') THEN
  RAISE EXCEPTION 'supplement references are immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.resource_type='case-payment-proof-supplement' OR EXISTS(
   SELECT 1 FROM audit_events WHERE id=NEW.action_event_id AND action='CASE_PAYMENT_PROOF_SUPPLEMENTED') THEN
   RAISE EXCEPTION 'reference cannot be retargeted to supplement' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 RETURN OLD;
END; $$;
CREATE TRIGGER payment_proof_supplement_reference_immutable BEFORE UPDATE OR DELETE ON material_references
 FOR EACH ROW EXECUTE FUNCTION reject_payment_proof_supplement_reference_mutation();

CREATE FUNCTION check_payment_proof_supplement_references_final_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_supplement_id uuid;
BEGIN
 IF TG_TABLE_NAME='case_payment_proof_supplements' THEN target_supplement_id:=NEW.id;
 ELSE target_supplement_id:=NEW.supplement_id; END IF;
 IF EXISTS(SELECT 1 FROM case_payment_proof_supplement_documents d
  JOIN case_payment_proof_supplements s ON s.id=d.supplement_id
  WHERE s.id=target_supplement_id AND NOT EXISTS(SELECT 1 FROM material_references r
   WHERE r.resource_type='case-payment-proof-supplement' AND r.resource_id=s.id
    AND r.purpose='CASE_CLOSURE_PAYMENT_PROOF' AND r.department_id=s.department_id
    AND r.material_id=d.material_id AND r.content_version_id=d.content_version_id
    AND r.action_event_id=s.audit_event_id AND r.asset_version_id IS NULL
    AND r.xmin=pg_current_xact_id()::text::xid)) THEN
  RAISE EXCEPTION 'supplement requires complete same-transaction material references' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER payment_proof_supplement_references_complete AFTER INSERT ON case_payment_proof_supplements
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_proof_supplement_references_final_draft();
CREATE CONSTRAINT TRIGGER payment_proof_supplement_document_references_complete AFTER INSERT ON case_payment_proof_supplement_documents
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_proof_supplement_references_final_draft();
COMMIT;
