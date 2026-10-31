-- Closed forward draft. No history scan/backfill and no gate is removed.
-- Original evidence is assembled before its receipt; later proof uses 3033/3035.
BEGIN;
CREATE FUNCTION seal_original_payment_document_insert_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p record;
BEGIN
 SELECT *,xmin AS creation_xmin INTO p FROM case_closure_payment_versions
  WHERE id=NEW.payment_version_id AND case_id=NEW.case_id AND department_id=NEW.department_id FOR UPDATE;
 IF p.id IS NULL OR p.creation_xmin IS DISTINCT FROM pg_current_xact_id()::text::xid
  OR p.state<>'ACTIVE' OR EXISTS (SELECT 1 FROM case_closure_payment_receipts r WHERE r.payment_version_id=p.id)
 THEN RAISE EXCEPTION 'original payment evidence is sealed or not transaction-local' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER original_payment_document_insert_seal_draft BEFORE INSERT ON case_closure_payment_documents
 FOR EACH ROW EXECUTE FUNCTION seal_original_payment_document_insert_draft();

CREATE FUNCTION check_original_payment_evidence_complete_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_payment uuid; p record; a record; r record; document_ids uuid[]; declared_screenshot jsonb;
BEGIN
 IF TG_TABLE_NAME='material_references' THEN
  -- Supplement references retain their independent 3033/3035 contract.
  IF NEW.resource_type<>'case-closure-payment-version' THEN RETURN NEW; END IF;
  target_payment:=NEW.resource_id;
 ELSIF TG_TABLE_NAME='case_closure_payment_versions' THEN target_payment:=NEW.id;
 ELSE target_payment:=NEW.payment_version_id; END IF;
 SELECT *,xmin AS creation_xmin INTO p FROM case_closure_payment_versions WHERE id=target_payment FOR UPDATE;
 IF p.id IS NULL OR p.creation_xmin IS DISTINCT FROM pg_current_xact_id()::text::xid THEN
  RAISE EXCEPTION 'original payment evidence requires transaction-local payment' USING ERRCODE='23514'; END IF;
 SELECT *,xmin AS creation_xmin INTO a FROM audit_events WHERE id=p.audit_event_id FOR SHARE;
 SELECT *,xmin AS creation_xmin INTO r FROM case_closure_payment_receipts WHERE payment_version_id=p.id FOR SHARE;
 IF a.id IS NULL OR r.id IS NULL OR a.creation_xmin IS DISTINCT FROM pg_current_xact_id()::text::xid
  OR r.creation_xmin IS DISTINCT FROM pg_current_xact_id()::text::xid
  OR r.case_id IS DISTINCT FROM p.case_id OR r.department_id IS DISTINCT FROM p.department_id
  OR r.actor_user_id IS DISTINCT FROM p.recorded_by_user_id OR r.audit_event_id IS DISTINCT FROM a.id
  OR a.department_id IS DISTINCT FROM p.department_id OR a.actor_kind IS DISTINCT FROM 'HUMAN'
  OR a.actor_user_id IS DISTINCT FROM p.recorded_by_user_id OR a.internal_actor_user_id IS DISTINCT FROM p.recorded_by_user_id
  OR a.customer_account_binding_id IS NOT NULL OR a.lawyer_account_binding_id IS NOT NULL OR a.notary_office_account_binding_id IS NOT NULL
  OR a.resource_type IS DISTINCT FROM 'CASE_CLOSURE_PAYMENT_VERSION' OR a.resource_id IS DISTINCT FROM p.id
  OR a.action IS DISTINCT FROM (CASE WHEN p.revision=1 THEN 'CASE_CLOSURE_PAYMENT_RECORD'
    WHEN p.state='VOID' THEN 'CASE_CLOSURE_PAYMENT_VOID' ELSE 'CASE_CLOSURE_PAYMENT_CORRECT' END)
  OR a.details->>'fingerprint' IS DISTINCT FROM r.request_fingerprint
  OR a.details->'result' IS DISTINCT FROM r.result_snapshot
 THEN RAISE EXCEPTION 'original payment requires exact transaction-local audit and receipt' USING ERRCODE='23514'; END IF;
 SELECT coalesce(array_agg(d.content_version_id ORDER BY d.content_version_id),ARRAY[]::uuid[])
  INTO document_ids FROM case_closure_payment_documents d WHERE d.payment_version_id=p.id;
 declared_screenshot:=a.details->'screenshotContentVersionId';
 IF p.revision=1 THEN
  -- Both real RECORD adapters emit an explicit JSON null or one canonical UUID.
  -- Equality of documents/references alone must not authorize undeclared evidence.
  IF declared_screenshot IS NULL
   OR (declared_screenshot='null'::jsonb AND cardinality(document_ids)<>0)
   OR (declared_screenshot<>'null'::jsonb AND (
    jsonb_typeof(declared_screenshot) IS DISTINCT FROM 'string'
    OR cardinality(document_ids)<>1
    OR declared_screenshot IS DISTINCT FROM to_jsonb(document_ids[1]::text)
   )) THEN RAISE EXCEPTION 'original payment screenshot set differs from record audit declaration' USING ERRCODE='23514'; END IF;
 ELSE
  -- CORRECT/VOID adapter appends no original screenshots and emits no such key.
  IF a.details ? 'screenshotContentVersionId' OR cardinality(document_ids)<>0 THEN
   RAISE EXCEPTION 'payment correction and void cannot carry original screenshots' USING ERRCODE='23514'; END IF;
 END IF;
 -- Lock the same material/content rows used by cleanup before testing availability.
 PERFORM m.id FROM case_closure_payment_documents d JOIN materials m ON m.id=d.material_id
  JOIN content_versions v ON v.id=d.content_version_id AND v.material_id=m.id
  WHERE d.payment_version_id=p.id ORDER BY m.id,v.id FOR SHARE OF m,v;
 IF EXISTS (SELECT 1 FROM case_closure_payment_documents d WHERE d.payment_version_id=p.id AND (
  p.state<>'ACTIVE' OR d.case_id<>p.case_id OR d.department_id<>p.department_id OR d.xmin<>pg_current_xact_id()::text::xid
  OR NOT EXISTS (SELECT 1 FROM materials m JOIN content_versions v ON v.material_id=m.id
    JOIN upload_drafts u ON u.id=v.source_upload_draft_id
    WHERE m.id=d.material_id AND m.department_id=p.department_id AND m.owner_type='CASE' AND m.owner_id=p.case_id
     AND m.status='ACTIVE' AND m.deleted_at IS NULL AND m.category::text='CASE_CLOSURE_PAYMENT_PROOF'
     AND m.purpose='CASE_CLOSURE_PAYMENT_PROOF' AND m.current_version_id=v.id AND v.id=d.content_version_id
     AND v.status='AVAILABLE' AND v.mime_type IN ('image/jpeg','image/png') AND v.size_bytes BETWEEN 1 AND 20971520
     AND u.department_id=p.department_id AND u.owner_type='CASE' AND u.owner_id=p.case_id
     AND u.category::text='CASE_CLOSURE_PAYMENT_PROOF' AND u.purpose='CASE_CLOSURE_PAYMENT_PROOF'
     AND u.status='FINALIZED' AND u.actor_user_id=v.uploaded_by)
  OR NOT EXISTS (SELECT 1 FROM material_references ref WHERE ref.resource_type='case-closure-payment-version'
    AND ref.resource_id=p.id AND ref.department_id=p.department_id AND ref.purpose='CASE_CLOSURE_PAYMENT_PROOF'
    AND ref.material_id=d.material_id AND ref.content_version_id=d.content_version_id
    AND ref.action_event_id=p.audit_event_id AND ref.asset_version_id IS NULL
    AND ref.xmin=pg_current_xact_id()::text::xid)
 )) OR EXISTS (SELECT 1 FROM material_references ref WHERE ref.resource_type='case-closure-payment-version'
  AND ref.resource_id=p.id AND (
   ref.department_id<>p.department_id OR ref.purpose<>'CASE_CLOSURE_PAYMENT_PROOF'
   OR ref.action_event_id IS DISTINCT FROM p.audit_event_id OR ref.asset_version_id IS NOT NULL
   OR ref.xmin<>pg_current_xact_id()::text::xid
   OR NOT EXISTS (SELECT 1 FROM case_closure_payment_documents d WHERE d.payment_version_id=p.id
    AND d.case_id=p.case_id AND d.department_id=p.department_id
    AND d.material_id=ref.material_id AND d.content_version_id=ref.content_version_id)
 )) THEN RAISE EXCEPTION 'original payment document and reference sets are not exact and complete' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER original_payment_evidence_version_complete_draft AFTER INSERT ON case_closure_payment_versions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_original_payment_evidence_complete_draft();
CREATE CONSTRAINT TRIGGER original_payment_evidence_document_complete_draft AFTER INSERT ON case_closure_payment_documents
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_original_payment_evidence_complete_draft();
CREATE CONSTRAINT TRIGGER original_payment_evidence_receipt_complete_draft AFTER INSERT ON case_closure_payment_receipts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_original_payment_evidence_complete_draft();
CREATE CONSTRAINT TRIGGER original_payment_evidence_reference_complete_draft AFTER INSERT ON material_references
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_original_payment_evidence_complete_draft();
COMMIT;
