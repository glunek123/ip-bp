BEGIN;
DO $verify$ DECLARE spec record; p record; BEGIN
 FOR spec IN SELECT * FROM (VALUES ('guard_payment_proof_supplement_draft','','trigger','plpgsql','v','9f0b7bfe82145d876f326891b204dd18cf30748ec9c8fac80f085827239d3f35'),
('reject_payment_proof_supplement_mutation','','trigger','plpgsql','v','6d9985b6b6e25d006987501e4deec6298a81d232efc8fcdc44a131632c0f3737'),
('check_payment_proof_supplement_final_draft','','trigger','plpgsql','v','8889291286dd33562f3bfd7b8047fd3dc2fafb8983b50cbb7f7f52bc37ced80d'),
('reject_payment_proof_supplement_audit_mutation','','trigger','plpgsql','v','3ed4130f2d20b5d26d3c7ee4e3a55603ad7de63a880b1a903af6d12fa60a08e9'),
('assert_payment_proof_supplement_reference_draft','material_references','void','plpgsql','v','ef2d6288da2f69562148d0a56b3543d3c4e1e5b39f06147df060619bcdd5d6f2'),
('reject_payment_proof_supplement_reference_mutation','','trigger','plpgsql','v','769ff3bf0f92a8f988f2a1ce826c3c2ec0edb3fad62f80c118a8582eb6c858df'),
('check_payment_proof_supplement_references_final_draft','','trigger','plpgsql','v','67b4b40df89de2052cf76841c2eab1fa71a9a64079bdbb7c2f4fda0e0197f39a'),
('seal_original_payment_document_insert_draft','','trigger','plpgsql','v','ae01989a1a15d187c751f81f104aa8b0d31e76e97a59e7f1d71056af80c6cbc9'),
('check_original_payment_evidence_complete_draft','','trigger','plpgsql','v','52b6cb22f0abb97ebf4815cbd9ba482575f9a3282124bbf689cc78e50232a5b4'),
('payment_proof_fence_has_local_document_draft','uuid,uuid','boolean','sql','v','29f0a29f68fce2ac5756a42d85fa161f679664efac84cdf5ce7b58b39513762c'),
('guard_payment_proof_material_fence_draft','','trigger','plpgsql','v','b48a0ec63986c9b71488b2194bcee26e0cf4f028ace1887ff27b44c757f1a7da'),
('guard_payment_proof_content_fence_draft','','trigger','plpgsql','v','46562f29dd70089bf04a6a4e2babb1eb45fd36990feded9052a1718e7d417509'),
('freeze_payment_proof_document_metadata_draft','','trigger','plpgsql','v','eab4eca413493d8bb7a03090f6259adcc12d701bd13237e251b74bc80d6cdcdd'),
('guard_payment_proof_claimed_storage_draft','','trigger','plpgsql','v','5e005f2785f1f7c09a8d4ab76a2576c2539223d1067416f123d3b7c59d29b35a'),
('guard_payment_proof_storage_provenance_immutable_draft','','trigger','plpgsql','v','316b6e61f15748d8076bc4366f628a62d52229a18dbe4e796ac4f2eb15567e0b'),
('guard_payment_proof_reclassification_draft','','trigger','plpgsql','v','3b1dcaeebffa4e86b22ba7178f7652a993b44b5af8388ae6591580b659dcfa19'),
('guard_payment_proof_draft_reclassification_draft','','trigger','plpgsql','v','37928a8c9e08de24faca06e79044847a6b5470b23b76f0a2b1fe70c0afbfaaa3'),
('guard_payment_proof_reference_target_draft','','trigger','plpgsql','v','3ff9f2891ea6ad3d539abc73ce2deb30a9be1c418b4db5cadb3ac88e220128b3'),
('check_case_payment_evidence_reference','','trigger','plpgsql','v','d340c711b8f63d0cfd19ff5c7f54bf88e16786b5ae3956d59aafb7f441268fe7'),
('reject_case_payment_evidence_reference_mutation','','trigger','plpgsql','v','8a00d42ec9990fb2fc82742923bc763c7cb66263176b26956d311f1616171ddf'),
('guard_case_closure_payment_proof_draft','','trigger','plpgsql','v','e53014d052706b05543621e223b6ddf7456450ef8f27442fd3d33ed2cc8005df'),
('guard_case_closure_payment_draft','','trigger','plpgsql','v','f4c53f74ddcabe41e689d9ec3cfa51ec59997ff2d2809074e7ebd46a89071f10'),
('check_case_closure_payment_document_owner','','trigger','plpgsql','v','5685d75d2d35de9a3808de623bbd73520314ff29a1714ea942caefe82f5f7062'),
('check_case_closure_payment_version','','trigger','plpgsql','v','b5ed54691c2c97449193127f99f328b10ae013277abf63d29959456e9bfc183c'),
('reject_case_closure_payment_document_mutation','','trigger','plpgsql','v','87089af7d50d1bfe9f0083e66fe7f1a8eee35cc4b260cce01e9e318c29959a0f'),
('case_payment_proof_upload_eligible','uuid,uuid,uuid','boolean','plpgsql','s','08ac2782a49ff382701d691eebbc8d7adb2fea4dd9b3cf3aea3fef3d2f5deb14'),
('guard_early_initial_payment_record_gate','','trigger','plpgsql','v','2f0d6126174c8317d1179052cbb204455ef2cd7cfc6e3fea130028c95e9e54f8')) expected(name,args,result,lang,volatility,sha) LOOP
  SELECT f.*,l.lanname INTO p FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace JOIN pg_language l ON l.oid=f.prolang
   WHERE f.oid=to_regprocedure(format('%I.%I(%s)',current_schema(),spec.name,spec.args)) AND n.nspname=current_schema();
  IF p.oid IS NULL OR p.lanname IS DISTINCT FROM spec.lang OR p.prosecdef OR p.proconfig IS NOT NULL
   OR p.prorettype IS DISTINCT FROM spec.result::regtype::oid OR p.provolatile::text IS DISTINCT FROM spec.volatility
   OR encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex') IS DISTINCT FROM spec.sha THEN
   RAISE EXCEPTION 'unexpected proof prerequisite function %',spec.name USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR spec IN SELECT * FROM (VALUES ('case_payment_proof_supplements','payment_proof_supplement_draft_gate','guard_payment_proof_supplement_draft',31,false),
('case_payment_proof_supplement_documents','payment_proof_supplement_document_draft_gate','guard_payment_proof_supplement_draft',31,false),
('case_payment_proof_supplements','payment_proof_supplement_immutable','reject_payment_proof_supplement_mutation',27,false),
('case_payment_proof_supplement_documents','payment_proof_supplement_document_immutable','reject_payment_proof_supplement_mutation',27,false),
('case_payment_proof_supplements','payment_proof_supplement_complete','check_payment_proof_supplement_final_draft',5,true),
('case_payment_proof_supplement_documents','payment_proof_supplement_document_complete','check_payment_proof_supplement_final_draft',5,true),
('audit_events','payment_proof_supplement_audit_immutable','reject_payment_proof_supplement_audit_mutation',27,false),
('case_payment_proof_supplements','archive_snapshot_source_order','guard_archive_snapshot_source_order',31,false),
('case_payment_proof_supplement_documents','archive_snapshot_source_order','guard_archive_snapshot_source_order',31,false),
('material_references','payment_proof_supplement_reference_immutable','reject_payment_proof_supplement_reference_mutation',27,false),
('case_payment_proof_supplements','payment_proof_supplement_references_complete','check_payment_proof_supplement_references_final_draft',5,true),
('case_payment_proof_supplement_documents','payment_proof_supplement_document_references_complete','check_payment_proof_supplement_references_final_draft',5,true),
('case_closure_payment_documents','original_payment_document_insert_seal_draft','seal_original_payment_document_insert_draft',7,false),
('case_closure_payment_versions','original_payment_evidence_version_complete_draft','check_original_payment_evidence_complete_draft',5,true),
('case_closure_payment_documents','original_payment_evidence_document_complete_draft','check_original_payment_evidence_complete_draft',5,true),
('case_closure_payment_receipts','original_payment_evidence_receipt_complete_draft','check_original_payment_evidence_complete_draft',5,true),
('material_references','original_payment_evidence_reference_complete_draft','check_original_payment_evidence_complete_draft',5,true),
('materials','payment_proof_material_fence_draft','guard_payment_proof_material_fence_draft',31,false),
('content_versions','payment_proof_content_fence_draft','guard_payment_proof_content_fence_draft',31,false),
('case_closure_payment_documents','aaaa_payment_proof_metadata_fence_draft','freeze_payment_proof_document_metadata_draft',5,false),
('case_payment_proof_supplement_documents','aaaa_payment_proof_metadata_fence_draft','freeze_payment_proof_document_metadata_draft',5,false),
('content_versions','payment_proof_claimed_storage_draft','guard_payment_proof_claimed_storage_draft',7,false),
('content_versions','payment_proof_storage_provenance_immutable_draft','guard_payment_proof_storage_provenance_immutable_draft',19,false),
('materials','payment_proof_reclassification_draft','guard_payment_proof_reclassification_draft',19,false),
('upload_drafts','payment_proof_draft_reclassification_draft','guard_payment_proof_draft_reclassification_draft',19,false),
('material_references','payment_proof_reference_target_draft','guard_payment_proof_reference_target_draft',31,false),
('material_references','case_payment_evidence_reference_guard','check_case_payment_evidence_reference',7,false),
('material_references','case_payment_evidence_reference_immutable','reject_case_payment_evidence_reference_mutation',27,false),
('upload_drafts','case_closure_payment_proof_upload_draft_gate','guard_case_closure_payment_proof_draft',23,false),
('materials','case_closure_payment_proof_material_draft_gate','guard_case_closure_payment_proof_draft',23,false),
('case_closure_payment_versions','case_closure_payment_draft_guard','guard_early_initial_payment_record_gate',31,false),
('case_closure_payment_documents','case_closure_payment_document_draft_guard','guard_case_closure_payment_draft',31,false),
('case_closure_payment_documents','case_closure_payment_document_owner_guard','check_case_closure_payment_document_owner',7,false),
('case_closure_payment_versions','case_closure_payment_version_guard','check_case_closure_payment_version',31,false),
('case_closure_payment_documents','case_closure_payment_document_immutable','reject_case_closure_payment_document_mutation',27,false),
('case_closure_payment_receipts','closure_payment_receipt_draft_gate','guard_early_initial_payment_record_gate',31,false)) expected(tbl,name,fn,typ,deferred) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass(format('%I.%I',current_schema(),spec.tbl))
   AND t.tgname=spec.name AND t.tgfoid=to_regprocedure(format('%I.%I()',current_schema(),spec.fn))
   AND t.tgtype::integer=spec.typ AND t.tgenabled='O' AND NOT t.tgisinternal
   AND t.tgdeferrable=spec.deferred AND t.tginitdeferred=spec.deferred
   AND t.tgparentid=0 AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgargs=''::bytea AND t.tgattr::text='') THEN
   RAISE EXCEPTION 'unexpected proof prerequisite trigger %.%',spec.tbl,spec.name USING ERRCODE='23514'; END IF;
 END LOOP;
END; $verify$;
CREATE OR REPLACE FUNCTION guard_early_initial_payment_record_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p case_closure_payment_versions%ROWTYPE; v case_closure_versions%ROWTYPE;
 e case_early_closures%ROWTYPE; er case_early_closure_receipts%ROWTYPE; a audit_events%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'initial payment history is immutable' USING ERRCODE='23514';
 END IF;
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'initial payment requires serializable transaction' USING ERRCODE='23514';
 END IF;
 -- Separate branches: receipt-only fields must never be accessed on a version.
 IF TG_RELID='case_closure_payment_versions'::regclass THEN
  p:=NEW;
 ELSIF TG_RELID='case_closure_payment_receipts'::regclass THEN
  SELECT * INTO p FROM case_closure_payment_versions
   WHERE id=NEW.payment_version_id AND xmin=pg_current_xact_id()::text::xid;
 ELSE
  RAISE EXCEPTION 'unsupported initial payment gate target' USING ERRCODE='23514';
 END IF;
 SELECT * INTO v FROM case_closure_versions
  WHERE id=p.closure_version_id AND case_id=p.case_id AND department_id=p.department_id
   AND xmin=pg_current_xact_id()::text::xid;
 SELECT * INTO e FROM case_early_closures
  WHERE id=v.early_closure_id AND case_id=p.case_id AND department_id=p.department_id
   AND xmin=pg_current_xact_id()::text::xid;
 SELECT * INTO er FROM case_early_closure_receipts
  WHERE early_closure_id=e.id AND case_id=p.case_id AND department_id=p.department_id
   AND actor_user_id=p.recorded_by_user_id AND xmin=pg_current_xact_id()::text::xid;
 SELECT * INTO a FROM audit_events
  WHERE id=p.audit_event_id AND xmin=pg_current_xact_id()::text::xid;
 IF p.id IS NULL OR p.revision IS DISTINCT FROM 1 OR p.prior_version_id IS NOT NULL
  OR p.payment_id IS DISTINCT FROM p.id OR p.state IS DISTINCT FROM 'ACTIVE' OR p.reason IS NOT NULL
  OR v.id IS NULL OR v.kind NOT IN ('REGISTER','CORRECT')
  OR (v.kind='REGISTER' AND v.prior_version_id IS NOT NULL) OR (v.kind='CORRECT' AND v.prior_version_id IS NULL)
  OR (v.kind='REGISTER' AND (v.finish_id IS NOT NULL OR v.external_entry_id IS NOT NULL))
  OR v.payment_type IS NULL OR v.payment_type NOT IN ('ONE_TIME','INSTALLMENTS')
  OR ((v.close_amount_state='KNOWN' AND (v.close_amt>0 OR (v.kind='CORRECT' AND v.close_amt=0)))
    OR (v.close_amount_state='PENDING' AND v.close_amt IS NULL)) IS NOT TRUE
  OR a.id IS NULL OR (v.kind='REGISTER' AND (e.id IS NULL OR er.id IS NULL))
  OR p.recorded_by_user_id IS DISTINCT FROM v.recorded_by_user_id
  OR (v.kind='REGISTER' AND v.recorded_by_user_id IS DISTINCT FROM e.recorded_by_user_id)
  OR (v.kind='REGISTER' AND (v.from_version IS DISTINCT FROM e.to_version OR v.to_version IS DISTINCT FROM e.to_version+1))
  OR p.recorded_at IS DISTINCT FROM v.recorded_at OR (v.kind='REGISTER' AND v.recorded_at IS DISTINCT FROM e.recorded_at)
  OR p.paid_on>(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date
  OR NOT EXISTS (SELECT 1 FROM cases c JOIN case_closures h
    ON h.case_id=c.id AND h.department_id=c.department_id
    WHERE c.id=p.case_id AND c.department_id=p.department_id AND c.stage='WAITING_ARCHIVE'
     AND c.version=v.to_version AND h.id=v.closure_id AND h.current_version_id=v.id
     AND h.early_closure_id IS NOT DISTINCT FROM v.early_closure_id
     AND h.finish_id IS NOT DISTINCT FROM v.finish_id AND h.external_entry_id IS NOT DISTINCT FROM v.external_entry_id
     AND h.xmin=pg_current_xact_id()::text::xid)
  -- The real early RECORD adapter declares no screenshot as explicit JSON null.
  -- The original document gate remains closed, and 3036 checks the empty set.
  OR (a.details->'screenshotContentVersionId' IS DISTINCT FROM 'null'::jsonb
   AND jsonb_typeof(a.details->'screenshotContentVersionId') IS DISTINCT FROM 'string')
  OR jsonb_typeof(a.details->'caseId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(a.details->'closureVersionId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(a.details->'paymentVersionId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(a.details->'paidOn') IS DISTINCT FROM 'string'
  OR jsonb_typeof(a.details->'payer') IS DISTINCT FROM 'string'
  OR jsonb_typeof(a.details->'payee') IS DISTINCT FROM 'string'
  OR jsonb_typeof(a.details->'fingerprint') IS DISTINCT FROM 'string'
  OR a.details->>'caseId' IS DISTINCT FROM p.case_id::text
  OR a.details->>'closureVersionId' IS DISTINCT FROM v.id::text
  OR a.details->>'paymentVersionId' IS DISTINCT FROM p.id::text
  OR a.details->>'paidOn' IS DISTINCT FROM to_char(p.paid_on,'YYYY-MM-DD')
  OR (CASE WHEN jsonb_typeof(a.details->'amount')='string'
      AND a.details->>'amount' ~ '^\d{1,14}(\.\d{1,2})?$'
     THEN (a.details->>'amount')::numeric ELSE NULL END) IS DISTINCT FROM p.amount
  OR a.details->>'payer' IS DISTINCT FROM p.payer OR a.details->>'payee' IS DISTINCT FROM p.payee
  OR a.details->>'fingerprint' !~ '^[0-9a-f]{64}$'
  OR (v.kind='REGISTER' AND a.details->>'fingerprint' IS DISTINCT FROM er.request_fingerprint)
 THEN
  RAISE EXCEPTION 'payment requires exact screenshot-free atomic early source' USING ERRCODE='23514';
 END IF;
 -- 3003, 3007, 3024, 3034 and 3036 remain installed. They independently
 -- enforce actor/revision, current typed head, audit, receipt and evidence sets.
 IF TG_RELID='case_closure_payment_receipts'::regclass THEN
  IF NEW.case_id IS DISTINCT FROM p.case_id OR NEW.department_id IS DISTINCT FROM p.department_id
   OR NEW.actor_user_id IS DISTINCT FROM p.recorded_by_user_id
   OR NEW.audit_event_id IS DISTINCT FROM p.audit_event_id
   OR NEW.request_fingerprint IS DISTINCT FROM a.details->>'fingerprint' THEN
   RAISE EXCEPTION 'initial payment receipt requires exact early source fingerprint' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
-- Candidate only. Append after 3054 catalog verification; no historical rewrite.
CREATE FUNCTION guard_payment_proof_write_candidate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.category::text<>'CASE_CLOSURE_PAYMENT_PROOF' AND NEW.purpose<>'CASE_CLOSURE_PAYMENT_PROOF' THEN
  IF TG_OP='UPDATE' AND (OLD.category::text='CASE_CLOSURE_PAYMENT_PROOF' OR OLD.purpose='CASE_CLOSURE_PAYMENT_PROOF') THEN
   RAISE EXCEPTION 'proof classification cannot change' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.category::text<>'CASE_CLOSURE_PAYMENT_PROOF' OR NEW.purpose<>'CASE_CLOSURE_PAYMENT_PROOF'
  OR NEW.owner_type::text<>'CASE' THEN RAISE EXCEPTION 'proof classification mismatch' USING ERRCODE='23514'; END IF;
 IF TG_RELID='upload_drafts'::regclass THEN
  -- Preserve expiry and repeat cleanup without requiring a still-active actor.
  IF TG_OP='UPDATE' AND OLD.expires_at<=CURRENT_TIMESTAMP
   AND NEW.updated_at>=OLD.updated_at AND NEW.updated_at<=clock_timestamp()
   AND ((OLD.status='OPEN' AND NEW.status='EXPIRED'
    AND (to_jsonb(NEW)-'status'-'updated_at')=(to_jsonb(OLD)-'status'-'updated_at'))
    OR (OLD.status='EXPIRED' AND NEW.status='EXPIRED' AND OLD.pending_storage_key IS NOT NULL
     AND (to_jsonb(NEW)-'updated_at')=(to_jsonb(OLD)-'updated_at'))) THEN RETURN NEW; END IF;
  -- Failed physical upload may release only its private claim. It cannot finalize.
  IF TG_OP='UPDATE' AND OLD.pending_storage_key IS NOT NULL AND NEW.pending_storage_key IS NULL
   AND NEW.status=OLD.status AND NEW.updated_at>=OLD.updated_at
   AND (to_jsonb(NEW)-'pending_storage_key'-'updated_at')=(to_jsonb(OLD)-'pending_storage_key'-'updated_at')
   AND NOT EXISTS(SELECT 1 FROM content_versions WHERE source_upload_draft_id=OLD.id)
  THEN RETURN NEW; END IF;
  IF current_setting('transaction_isolation')<>'serializable'
   OR case_payment_proof_upload_eligible(NEW.actor_user_id,NEW.owner_id,NEW.department_id) IS NOT TRUE
   OR NEW.customer_account_binding_id IS NOT NULL OR NEW.notary_office_account_binding_id IS NOT NULL
   OR NEW.lawyer_account_binding_id IS NOT NULL OR NEW.expires_at<=CURRENT_TIMESTAMP
   OR NEW.declared_mime_type NOT IN ('image/jpeg','image/png') THEN
   RAISE EXCEPTION 'proof upload requires current internal actor and serializable transaction' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND NEW.status='OPEN' AND NEW.pending_storage_key IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status='OPEN' AND NEW.updated_at>=OLD.updated_at
   AND (to_jsonb(NEW)-'status'-'pending_storage_key'-'updated_at')=(to_jsonb(OLD)-'status'-'pending_storage_key'-'updated_at') THEN
   IF NEW.status='OPEN' AND OLD.pending_storage_key IS NULL AND NEW.pending_storage_key IS NOT NULL
    AND NEW.pending_storage_key ~ ('^'||NEW.department_id::text||'/[0-9a-f-]{36}/[0-9a-f-]{36}$') THEN RETURN NEW; END IF;
   IF NEW.status='FINALIZED' AND NEW.pending_storage_key IS NULL AND OLD.pending_storage_key IS NOT NULL
    AND (SELECT count(*) FROM content_versions v JOIN materials m ON m.id=v.material_id
     WHERE v.source_upload_draft_id=NEW.id AND v.storage_key=OLD.pending_storage_key
      AND v.uploaded_by=NEW.actor_user_id AND v.status='AVAILABLE' AND v.mime_type=NEW.declared_mime_type
      AND m.department_id=NEW.department_id AND m.owner_type='CASE' AND m.owner_id=NEW.owner_id
      AND m.category::text=NEW.category::text AND m.purpose=NEW.purpose AND m.current_version_id=v.id
      AND m.status='ACTIVE' AND m.deleted_at IS NULL
      AND v.xmin=pg_current_xact_id()::text::xid AND m.xmin=pg_current_xact_id()::text::xid)=1 THEN RETURN NEW; END IF;
  END IF;
 ELSE
  -- Only the installed AFTER document trigger may set the real metadata fence.
  IF TG_OP='UPDATE' AND pg_trigger_depth()>=2 AND NEW.payment_proof_frozen
   AND (to_jsonb(NEW)-'payment_proof_frozen')=(to_jsonb(OLD)-'payment_proof_frozen')
   AND payment_proof_fence_has_local_document_draft(OLD.id,OLD.current_version_id) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NOT OLD.payment_proof_frozen AND NOT NEW.payment_proof_frozen
   AND OLD.status='ACTIVE' AND NEW.status='DELETED' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
   AND NEW.version=OLD.version+1 AND NEW.updated_at>=OLD.updated_at
   AND (to_jsonb(NEW)-'status'-'deleted_at'-'version'-'updated_at')=(to_jsonb(OLD)-'status'-'deleted_at'-'version'-'updated_at')
   AND NOT EXISTS(SELECT 1 FROM material_references WHERE material_id=OLD.id)
   AND NOT EXISTS(SELECT 1 FROM case_closure_payment_documents WHERE material_id=OLD.id)
   AND NOT EXISTS(SELECT 1 FROM case_payment_proof_supplement_documents WHERE material_id=OLD.id) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND current_setting('transaction_isolation')='serializable'
   AND NOT OLD.payment_proof_frozen AND NOT NEW.payment_proof_frozen
   AND OLD.status='DELETED' AND NEW.status='ACTIVE' AND OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
   AND OLD.deleted_at+INTERVAL '90 days'>CURRENT_TIMESTAMP AND NEW.version=OLD.version+1
   AND NEW.updated_at>=OLD.updated_at
   AND (to_jsonb(NEW)-'status'-'deleted_at'-'version'-'updated_at')=(to_jsonb(OLD)-'status'-'deleted_at'-'version'-'updated_at')
   AND EXISTS(SELECT 1 FROM content_versions v WHERE v.id=OLD.current_version_id AND v.material_id=OLD.id AND v.status='AVAILABLE')
   AND NOT EXISTS(SELECT 1 FROM material_references WHERE material_id=OLD.id)
   AND NOT EXISTS(SELECT 1 FROM case_closure_payment_documents WHERE material_id=OLD.id)
   AND NOT EXISTS(SELECT 1 FROM case_payment_proof_supplement_documents WHERE material_id=OLD.id) THEN RETURN NEW; END IF;
  IF current_setting('transaction_isolation')='serializable' AND NEW.status='ACTIVE' AND NEW.deleted_at IS NULL
   AND NOT NEW.payment_proof_frozen THEN
   IF TG_OP='INSERT' AND NEW.current_version_id IS NULL AND EXISTS(
    SELECT 1 FROM upload_drafts d WHERE d.department_id=NEW.department_id AND d.owner_type='CASE'
     AND d.owner_id=NEW.owner_id AND d.category::text=NEW.category::text AND d.purpose=NEW.purpose
     AND d.status='OPEN' AND d.expires_at>CURRENT_TIMESTAMP
     AND d.pending_storage_key LIKE NEW.department_id::text||'/'||NEW.id::text||'/%'
     AND case_payment_proof_upload_eligible(d.actor_user_id,d.owner_id,d.department_id)) THEN RETURN NEW; END IF;
   IF TG_OP='UPDATE' AND OLD.current_version_id IS NULL AND NEW.current_version_id IS NOT NULL
    AND NEW.updated_at>=OLD.updated_at
    AND (to_jsonb(NEW)-'current_version_id'-'updated_at')=(to_jsonb(OLD)-'current_version_id'-'updated_at')
    AND EXISTS(SELECT 1 FROM content_versions v JOIN upload_drafts d ON d.id=v.source_upload_draft_id
     WHERE v.id=NEW.current_version_id AND v.material_id=NEW.id AND v.status='AVAILABLE'
      AND v.xmin=pg_current_xact_id()::text::xid AND d.status='OPEN' AND d.expires_at>CURRENT_TIMESTAMP
      AND d.pending_storage_key=v.storage_key AND d.actor_user_id=v.uploaded_by
      AND d.department_id=NEW.department_id AND d.owner_id=NEW.owner_id
      AND case_payment_proof_upload_eligible(d.actor_user_id,d.owner_id,d.department_id)) THEN RETURN NEW; END IF;
  END IF;
 END IF;
 RAISE EXCEPTION 'unsupported payment proof write transition' USING ERRCODE='23514';
END; $$;
DROP TRIGGER case_closure_payment_proof_upload_draft_gate ON upload_drafts;
CREATE TRIGGER case_closure_payment_proof_upload_draft_gate BEFORE INSERT OR UPDATE ON upload_drafts
 FOR EACH ROW EXECUTE FUNCTION guard_payment_proof_write_candidate();
DROP TRIGGER case_closure_payment_proof_material_draft_gate ON materials;
CREATE TRIGGER case_closure_payment_proof_material_draft_gate BEFORE INSERT OR UPDATE ON materials
 FOR EACH ROW EXECUTE FUNCTION guard_payment_proof_write_candidate();

CREATE FUNCTION guard_original_payment_document_write_candidate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('transaction_isolation')<>'serializable' OR NOT EXISTS(
  SELECT 1 FROM case_closure_payment_versions p JOIN audit_events a ON a.id=p.audit_event_id
  WHERE p.id=NEW.payment_version_id AND p.case_id=NEW.case_id AND p.department_id=NEW.department_id
   AND p.revision=1 AND p.state='ACTIVE' AND p.xmin=pg_current_xact_id()::text::xid
   AND a.xmin=pg_current_xact_id()::text::xid
   AND a.details->'screenshotContentVersionId'=to_jsonb(NEW.content_version_id::text)) THEN
  RAISE EXCEPTION 'original document requires exact atomic declared initial screenshot' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER case_closure_payment_document_draft_guard ON case_closure_payment_documents;
CREATE TRIGGER case_closure_payment_document_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON case_closure_payment_documents
 FOR EACH ROW EXECUTE FUNCTION guard_original_payment_document_write_candidate();

CREATE OR REPLACE FUNCTION guard_payment_proof_supplement_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'supplement requires immutable serializable insert' USING ERRCODE='23514'; END IF;
 IF TG_RELID='case_payment_proof_supplement_documents'::regclass THEN
 IF NOT EXISTS(
  SELECT 1 FROM case_payment_proof_supplements s WHERE s.id=NEW.supplement_id
   AND s.payment_version_id=NEW.payment_version_id AND s.case_id=NEW.case_id AND s.department_id=NEW.department_id
   AND s.xmin=pg_current_xact_id()::text::xid) THEN
  RAISE EXCEPTION 'supplement document requires transaction-local parent' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE FUNCTION check_payment_proof_committed_upload_candidate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM materials m JOIN content_versions v ON v.material_id=m.id
  JOIN upload_drafts u ON u.id=v.source_upload_draft_id
  WHERE m.id=NEW.material_id AND v.id=NEW.content_version_id AND m.current_version_id=v.id
   AND m.department_id=NEW.department_id AND m.owner_type='CASE' AND m.owner_id=NEW.case_id
   AND m.category::text='CASE_CLOSURE_PAYMENT_PROOF' AND m.purpose='CASE_CLOSURE_PAYMENT_PROOF'
   AND m.status='ACTIVE' AND m.deleted_at IS NULL AND m.payment_proof_frozen AND v.payment_proof_frozen
   AND v.status='AVAILABLE' AND v.mime_type IN ('image/jpeg','image/png') AND v.size_bytes BETWEEN 1 AND 20971520
   AND u.status='FINALIZED' AND u.pending_storage_key IS NULL
   AND u.department_id=m.department_id AND u.owner_type='CASE' AND u.owner_id=m.owner_id
   AND u.category::text='CASE_CLOSURE_PAYMENT_PROOF' AND u.purpose='CASE_CLOSURE_PAYMENT_PROOF'
   AND u.actor_user_id=v.uploaded_by AND u.original_filename=v.original_filename AND u.declared_mime_type=v.mime_type
   AND u.customer_account_binding_id IS NULL AND u.notary_office_account_binding_id IS NULL AND u.lawyer_account_binding_id IS NULL) THEN
  RAISE EXCEPTION 'proof document lacks real frozen finalized private upload' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER payment_original_committed_upload_complete AFTER INSERT ON case_closure_payment_documents
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_proof_committed_upload_candidate();
CREATE CONSTRAINT TRIGGER payment_supplement_committed_upload_complete AFTER INSERT ON case_payment_proof_supplement_documents
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_proof_committed_upload_candidate();

COMMIT;
