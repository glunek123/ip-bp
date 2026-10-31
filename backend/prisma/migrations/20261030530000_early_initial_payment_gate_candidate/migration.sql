-- Local 3053 candidate: no DB execution or production authorization is implied.
-- Requires the unchanged 3052 baseline. Permanent payment and evidence guards
-- are checked by exact function-body digest and exact enabled trigger shape.
BEGIN;
DO $verify$ DECLARE spec record; installed record; BEGIN
 FOR spec IN SELECT * FROM (VALUES
  ('guard_case_closure_payment_draft','','trigger','f4c53f74ddcabe41e689d9ec3cfa51ec59997ff2d2809074e7ebd46a89071f10'),
  ('check_case_closure_payment_version','','trigger','b5ed54691c2c97449193127f99f328b10ae013277abf63d29959456e9bfc183c'),
  ('check_case_closure_effective_payment_type','','trigger','d47703bc5daf0a68b87a54e6bd014b8c3b3bddccba058e8ab736c84b2d8f800e'),
  ('check_case_closure_payment_receipt','','trigger','15d949757e50b31f57572d821eaf9b7117861c8059a382c59356cdc178c06850'),
  ('guard_case_financial_actor_draft','','trigger','3b0ab62af4d87a6a3882193a77c51c5b6a537616547b7693b9f5705dcd6e6c27'),
  ('assert_case_financial_actor_draft','uuid,uuid,uuid,uuid,uuid,text,text,text[]','void','d5f368ecd4ecfbcb5b4d5042af81ba7d1ecf639ac910527a3778fbac128caadd'),
  ('check_early_closure_initial_payment_actor_draft','','trigger','9b5cc99a3262ed616e38b2085f1810f89b859a6cba8e501b343983086937de32'),
  ('seal_original_payment_document_insert_draft','','trigger','ae01989a1a15d187c751f81f104aa8b0d31e76e97a59e7f1d71056af80c6cbc9'),
  ('check_original_payment_evidence_complete_draft','','trigger','52b6cb22f0abb97ebf4815cbd9ba482575f9a3282124bbf689cc78e50232a5b4'),
  ('guard_early_closure_actor_draft','','trigger','cc3113633dd7a5bc785c9a413adee44dd20edd7cc195678562cb1cde940ff1a0'),
  ('check_early_closure_source_authorization_revision_draft','','trigger','30f03717687b3cd1f17edeaa44b6cc377c8d19fe3cd7a0aa552b25c7bb3e0f42'),
  ('check_early_closure_register_receipt_final_draft','','trigger','dd5e026f059add01b8fbcc689c27d6a3753370f310acddfe22a5ff01d0ffcf36'),
  ('guard_early_zero_source_gate','','trigger','ed0b0581ecc7f91b7f774f0ff9484ada84fda4d5c5d08f099de8f8c096bacc5d'),
  ('check_early_zero_source_final','','trigger','369966b0064276f1fa4ae41ee96d4a6e088cb8fd6b8d1ae543af07acfc265999'),
  ('guard_zero_typed_closure_gate','','trigger','a4c0f431bd7e637bc07517e0d71a0b4f31e56964b19a974b09192f2d019b623b'),
  ('guard_zero_archive_snapshot_gate','','trigger','d8858d7116d7e3743d211e7e067db91a7e881917fcbe887b55a5bf42d5df1013')
 ) expected(function_name,arguments,return_type,body_sha256) LOOP
  SELECT p.oid,p.prosrc,l.lanname,p.prorettype,p.prosecdef,p.proconfig INTO installed
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
   WHERE p.oid=to_regprocedure(format('%I.%I(%s)',current_schema(),spec.function_name,spec.arguments))
    AND n.nspname=current_schema();
  IF installed.oid IS NULL OR installed.lanname IS DISTINCT FROM 'plpgsql' OR installed.prosecdef OR installed.proconfig IS NOT NULL
   OR installed.prorettype IS DISTINCT FROM spec.return_type::regtype::oid
   OR encode(sha256(convert_to(replace(installed.prosrc,E'\r\n',E'\n'),'UTF8')),'hex') IS DISTINCT FROM spec.body_sha256 THEN
   RAISE EXCEPTION 'unexpected initial-payment prerequisite function %',spec.function_name USING ERRCODE='23514';
  END IF;
 END LOOP;
 FOR spec IN SELECT * FROM (VALUES
  ('case_early_closures','case_early_closures_structure_guard','guard_early_zero_source_gate',31,false),
  ('case_early_closure_receipts','case_early_closure_receipts_structure_guard','guard_early_zero_source_gate',31,false),
  ('case_early_closures','early_zero_source_final','check_early_zero_source_final',5,true),
  ('case_early_closures','early_closure_actor_draft_guard','guard_early_closure_actor_draft',7,false),
  ('case_early_closures','early_closure_source_authorization_revision_draft','check_early_closure_source_authorization_revision_draft',7,false),
  ('case_early_closures','early_closure_register_receipt_final_draft','check_early_closure_register_receipt_final_draft',5,true),
  ('case_closure_versions','closure_payment_type_draft_guard','guard_zero_typed_closure_gate',23,false),
  ('case_closures','closure_payment_effective_count','check_case_closure_effective_payment_type',21,true),
  ('case_closure_payment_versions','closure_payment_version_effective_count','check_case_closure_effective_payment_type',5,true),
  ('case_closure_payment_versions','case_closure_payment_draft_guard','guard_case_closure_payment_draft',31,false),
  ('case_closure_payment_documents','case_closure_payment_document_draft_guard','guard_case_closure_payment_draft',31,false),
  ('case_closure_payment_receipts','closure_payment_receipt_draft_gate','guard_case_closure_payment_draft',31,false),
  ('case_closure_payment_versions','case_closure_payment_version_guard','check_case_closure_payment_version',31,false),
  ('case_closure_payment_receipts','closure_payment_receipt_consistency','check_case_closure_payment_receipt',31,false),
  ('case_closure_payment_versions','case_closure_payment_actor_draft_guard','guard_case_financial_actor_draft',31,false),
  ('case_closure_payment_versions','early_closure_initial_payment_actor_draft','check_early_closure_initial_payment_actor_draft',7,false),
  ('case_closure_payment_versions','early_closure_initial_payment_actor_final_draft','check_early_closure_initial_payment_actor_draft',5,true),
  ('case_closure_payment_documents','original_payment_document_insert_seal_draft','seal_original_payment_document_insert_draft',7,false),
  ('case_closure_payment_versions','original_payment_evidence_version_complete_draft','check_original_payment_evidence_complete_draft',5,true),
  ('case_closure_payment_receipts','original_payment_evidence_receipt_complete_draft','check_original_payment_evidence_complete_draft',5,true),
  ('case_closure_payment_documents','original_payment_evidence_document_complete_draft','check_original_payment_evidence_complete_draft',5,true),
  ('material_references','original_payment_evidence_reference_complete_draft','check_original_payment_evidence_complete_draft',5,true),
  ('case_archive_evidence_snapshots','case_archive_snapshot_draft_gate','guard_zero_archive_snapshot_gate',31,false),
  ('case_archive_snapshot_payments','case_archive_snapshot_payment_draft_gate','guard_zero_archive_snapshot_gate',31,false),
  ('case_archive_snapshot_allocations','case_archive_snapshot_allocation_draft_gate','guard_zero_archive_snapshot_gate',31,false)
 ) expected(table_name,trigger_name,function_name,trigger_type,is_deferred) LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
   WHERE t.tgrelid=to_regclass(format('%I.%I',current_schema(),spec.table_name))
    AND t.tgname=spec.trigger_name AND t.tgfoid=to_regprocedure(format('%I.%I()',current_schema(),spec.function_name))
    AND t.tgtype::integer=spec.trigger_type AND t.tgenabled='O' AND NOT t.tgisinternal
    AND t.tgdeferrable=spec.is_deferred AND t.tginitdeferred=spec.is_deferred
    AND t.tgparentid=0 AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgargs=''::bytea AND t.tgattr::text='') THEN
   RAISE EXCEPTION 'unexpected initial-payment prerequisite trigger %.%',spec.table_name,spec.trigger_name USING ERRCODE='23514';
  END IF;
 END LOOP;
END; $verify$;

-- Review candidate only. This file is assembled with exact catalog preconditions
-- by build-3053-initial-early-payment-gate.cjs; it is not a standalone migration.
-- No screenshot upload/document, actual-receipt or invoice gate is opened.

CREATE FUNCTION guard_early_typed_closure_register_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.payment_type IN ('ONE_TIME','INSTALLMENTS')
   AND ((NEW.close_amount_state='KNOWN' AND NEW.close_amt>=0)
     OR (NEW.close_amount_state='PENDING' AND NEW.close_amt IS NULL))
   AND NEW.kind='REGISTER' AND NEW.prior_version_id IS NULL
   AND NEW.finish_id IS NULL AND NEW.external_entry_id IS NULL
   AND EXISTS (SELECT 1 FROM case_early_closures e
    WHERE e.id=NEW.early_closure_id AND e.case_id=NEW.case_id AND e.department_id=NEW.department_id
     AND e.recorded_by_user_id=NEW.recorded_by_user_id AND e.to_version=NEW.from_version
     AND NEW.to_version=NEW.from_version+1 AND e.xmin=pg_current_xact_id()::text::xid)
  THEN RETURN NEW; END IF;
 END IF;
 IF NEW.payment_type IS NOT NULL THEN
  RAISE EXCEPTION 'typed closure requires an atomic early register command' USING ERRCODE='23514';
 END IF;
 -- Retain the pre-existing untyped historical branches. The permanent typed
 -- count guard still prevents erasing a previously selected payment type.
 RETURN NEW;
END; $$;

CREATE FUNCTION guard_early_initial_payment_record_gate() RETURNS trigger LANGUAGE plpgsql AS $$
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
  OR v.id IS NULL OR v.kind IS DISTINCT FROM 'REGISTER' OR v.prior_version_id IS NOT NULL
  OR v.finish_id IS NOT NULL OR v.external_entry_id IS NOT NULL
  OR v.payment_type IS NULL OR v.payment_type NOT IN ('ONE_TIME','INSTALLMENTS')
  OR ((v.close_amount_state='KNOWN' AND v.close_amt>0)
    OR (v.close_amount_state='PENDING' AND v.close_amt IS NULL)) IS NOT TRUE
  OR e.id IS NULL OR er.id IS NULL OR a.id IS NULL
  OR p.recorded_by_user_id IS DISTINCT FROM e.recorded_by_user_id
  OR v.recorded_by_user_id IS DISTINCT FROM e.recorded_by_user_id
  OR v.from_version IS DISTINCT FROM e.to_version OR v.to_version IS DISTINCT FROM e.to_version+1
  OR p.recorded_at IS DISTINCT FROM e.recorded_at OR v.recorded_at IS DISTINCT FROM e.recorded_at
  OR p.paid_on>(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date
  OR NOT EXISTS (SELECT 1 FROM cases c JOIN case_closures h
    ON h.case_id=c.id AND h.department_id=c.department_id
    WHERE c.id=p.case_id AND c.department_id=p.department_id AND c.stage='WAITING_ARCHIVE'
     AND c.version=v.to_version AND h.id=v.closure_id AND h.early_closure_id=e.id
     AND h.finish_id IS NULL AND h.external_entry_id IS NULL AND h.current_version_id=v.id
     AND h.xmin=pg_current_xact_id()::text::xid)
  -- The real early RECORD adapter declares no screenshot as explicit JSON null.
  -- The original document gate remains closed, and 3036 checks the empty set.
  OR a.details->'screenshotContentVersionId' IS DISTINCT FROM 'null'::jsonb
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
  OR a.details->>'fingerprint' IS DISTINCT FROM er.request_fingerprint
 THEN
  RAISE EXCEPTION 'payment requires exact screenshot-free atomic early source' USING ERRCODE='23514';
 END IF;
 -- 3003, 3007, 3024, 3034 and 3036 remain installed. They independently
 -- enforce actor/revision, current typed head, audit, receipt and evidence sets.
 IF TG_RELID='case_closure_payment_receipts'::regclass THEN
  IF NEW.case_id IS DISTINCT FROM p.case_id OR NEW.department_id IS DISTINCT FROM p.department_id
   OR NEW.actor_user_id IS DISTINCT FROM p.recorded_by_user_id
   OR NEW.audit_event_id IS DISTINCT FROM p.audit_event_id
   OR NEW.request_fingerprint IS DISTINCT FROM er.request_fingerprint THEN
   RAISE EXCEPTION 'initial payment receipt requires exact early source fingerprint' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION validate_early_initial_payment_source(target_source uuid,target_case uuid,target_department uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE e case_early_closures%ROWTYPE; h case_closures%ROWTYPE; v case_closure_versions%ROWTYPE;
 er case_early_closure_receipts%ROWTYPE; payment_count bigint;
 payment_ids jsonb; payment_amounts jsonb; declared_closure_amount jsonb;
BEGIN
 SELECT * INTO e FROM case_early_closures
  WHERE id=target_source AND case_id=target_case AND department_id=target_department
   AND xmin=pg_current_xact_id()::text::xid;
 IF e.id IS NULL THEN
  RAISE EXCEPTION 'initial payment set requires same-transaction early source' USING ERRCODE='23514';
 END IF;
 SELECT * INTO h FROM case_closures
  WHERE early_closure_id=e.id AND case_id=e.case_id AND department_id=e.department_id
   AND xmin=pg_current_xact_id()::text::xid;
 SELECT * INTO v FROM case_closure_versions
  WHERE id=h.current_version_id AND closure_id=h.id AND case_id=e.case_id AND department_id=e.department_id
   AND xmin=pg_current_xact_id()::text::xid;
 SELECT * INTO er FROM case_early_closure_receipts
  WHERE early_closure_id=e.id AND case_id=e.case_id AND department_id=e.department_id
   AND actor_user_id=e.recorded_by_user_id AND xmin=pg_current_xact_id()::text::xid;
 IF h.id IS NULL OR v.id IS NULL OR er.id IS NULL
  OR h.finish_id IS NOT NULL OR h.external_entry_id IS NOT NULL
  OR v.early_closure_id IS DISTINCT FROM e.id OR v.kind IS DISTINCT FROM 'REGISTER'
  OR v.prior_version_id IS NOT NULL OR v.finish_id IS NOT NULL OR v.external_entry_id IS NOT NULL
  OR v.recorded_by_user_id IS DISTINCT FROM e.recorded_by_user_id
  OR v.from_version IS DISTINCT FROM e.to_version OR v.to_version IS DISTINCT FROM e.to_version+1
  OR v.payment_type IS NULL OR v.payment_type NOT IN ('ONE_TIME','INSTALLMENTS')
  OR ((v.close_amount_state='KNOWN' AND v.close_amt>=0)
    OR (v.close_amount_state='PENDING' AND v.close_amt IS NULL)) IS NOT TRUE
  OR NOT EXISTS (SELECT 1 FROM cases c WHERE c.id=e.case_id AND c.department_id=e.department_id
    AND c.stage='WAITING_ARCHIVE' AND c.version=v.to_version)
 THEN
  RAISE EXCEPTION 'early source requires exact same-transaction typed register' USING ERRCODE='23514';
 END IF;
 SELECT count(*) INTO payment_count FROM case_closure_payment_versions
  WHERE case_id=e.case_id AND department_id=e.department_id;
 IF payment_count>100 OR (v.payment_type='ONE_TIME' AND payment_count>1)
  OR (v.close_amount_state='KNOWN' AND v.close_amt=0 AND payment_count<>0)
  OR EXISTS (SELECT 1 FROM case_closure_payment_versions p0
   WHERE p0.case_id=e.case_id AND p0.department_id=e.department_id AND (
    p0.xmin IS DISTINCT FROM pg_current_xact_id()::text::xid OR p0.closure_version_id IS DISTINCT FROM v.id
    OR p0.recorded_by_user_id IS DISTINCT FROM e.recorded_by_user_id
    OR p0.revision IS DISTINCT FROM 1 OR p0.prior_version_id IS NOT NULL OR p0.state IS DISTINCT FROM 'ACTIVE'
    OR p0.payment_id IS DISTINCT FROM p0.id OR p0.reason IS NOT NULL)) THEN
  RAISE EXCEPTION 'early source payment set is not an atomic initial record set' USING ERRCODE='23514';
 END IF;
 -- Nonzero and PENDING closure may legitimately have no received payment yet.
 -- No payment or financial fact is fabricated to make a closure pass.
 IF payment_count=0 THEN RETURN; END IF;

 SELECT pr.result_snapshot#>'{review,effectivePaymentVersionIds}',
   pr.result_snapshot#>'{review,effectiveAmounts}',pr.result_snapshot#>'{review,closureAmount}'
  INTO payment_ids,payment_amounts,declared_closure_amount
 FROM case_closure_payment_versions pv JOIN case_closure_payment_receipts pr ON pr.payment_version_id=pv.id
 WHERE pv.case_id=e.case_id AND pv.department_id=e.department_id ORDER BY pv.id LIMIT 1;
 IF jsonb_typeof(payment_ids) IS DISTINCT FROM 'array' OR jsonb_typeof(payment_amounts) IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'initial payment requires complete declared payment arrays' USING ERRCODE='23514';
 END IF;
 IF jsonb_array_length(payment_ids)<>payment_count OR jsonb_array_length(payment_amounts)<>payment_count
  OR EXISTS (SELECT 1 FROM jsonb_array_elements(payment_ids) ids(value) WHERE jsonb_typeof(value) IS DISTINCT FROM 'string')
  OR EXISTS (SELECT 1 FROM jsonb_array_elements(payment_amounts) amounts(value) WHERE jsonb_typeof(value) IS DISTINCT FROM 'string')
  OR EXISTS (SELECT 1 FROM jsonb_array_elements(payment_ids) ids(value) GROUP BY value HAVING count(*)<>1)
  OR (v.close_amount_state='PENDING' AND declared_closure_amount IS DISTINCT FROM 'null'::jsonb)
  OR (v.close_amount_state='KNOWN' AND CASE
   WHEN jsonb_typeof(declared_closure_amount)='string' AND declared_closure_amount#>>'{}' ~ '^\d{1,14}(\.\d{1,2})?$'
    THEN (declared_closure_amount#>>'{}')::numeric ELSE NULL END IS DISTINCT FROM v.close_amt) THEN
  RAISE EXCEPTION 'initial payment declarations differ from typed closure and payment count' USING ERRCODE='23514';
 END IF;
 -- Validate the complete set in one relational query. Every source/child event
 -- invokes this validator; do not cache success across later INSERT statements.
 IF EXISTS (
  SELECT 1 FROM jsonb_array_elements_text(payment_ids) WITH ORDINALITY ids(value,ordinality)
  JOIN jsonb_array_elements_text(payment_amounts) WITH ORDINALITY amounts(value,ordinality)
   ON amounts.ordinality=ids.ordinality
  LEFT JOIN case_closure_payment_versions fact ON fact.id::text=ids.value
   AND fact.case_id=e.case_id AND fact.department_id=e.department_id
  LEFT JOIN case_closure_payment_receipts receipt ON receipt.payment_version_id=fact.id
   AND receipt.xmin=pg_current_xact_id()::text::xid
  LEFT JOIN audit_events audit ON audit.id=fact.audit_event_id
   AND audit.xmin=pg_current_xact_id()::text::xid
  WHERE fact.id IS NULL OR receipt.id IS NULL OR audit.id IS NULL
   OR CASE WHEN amounts.value ~ '^\d{1,14}(\.\d{1,2})?$'
     THEN amounts.value::numeric ELSE NULL END IS DISTINCT FROM fact.amount
   -- Numeric equality protects the fact, lexical equality preserves the exact
   -- original request accepted by the real service's receipt replay.
   OR audit.details->'amount' IS DISTINCT FROM to_jsonb(amounts.value)
   OR receipt.case_id IS DISTINCT FROM e.case_id OR receipt.department_id IS DISTINCT FROM e.department_id
   OR receipt.actor_user_id IS DISTINCT FROM e.recorded_by_user_id
   OR receipt.audit_event_id IS DISTINCT FROM fact.audit_event_id
   OR receipt.request_fingerprint IS DISTINCT FROM er.request_fingerprint
   -- Match JSON.stringify({command:'early-closure-payment',key,index}) exactly.
   OR receipt.idempotency_key IS DISTINCT FROM encode(sha256(convert_to(
    '{"command":"early-closure-payment","key":'||to_json(er.idempotency_key)::text||
     ',"index":'||(ids.ordinality-1)::text||'}','UTF8')),'hex')
   OR receipt.result_snapshot IS DISTINCT FROM jsonb_build_object(
    'versionId',fact.id,'stage','WAITING_ARCHIVE','reviewRequired',true,'review',jsonb_build_object(
     'caseId',e.case_id,'stage','WAITING_ARCHIVE','closureVersionId',v.id,
     'closureAmount',declared_closure_amount,'effectivePaymentVersionIds',payment_ids,
     'effectiveAmounts',payment_amounts,'financialReadiness','UNKNOWN'))
 ) THEN
  RAISE EXCEPTION 'initial payment receipt is not the exact ordered early command result' USING ERRCODE='23514';
 END IF;
 RETURN;
END; $$;

CREATE FUNCTION check_early_initial_payment_source_final() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_id uuid; source_case uuid; source_department uuid;
BEGIN
 IF TG_RELID='case_early_closures'::regclass THEN
  source_id:=NEW.id; source_case:=NEW.case_id; source_department:=NEW.department_id;
 ELSIF TG_RELID='case_closure_payment_versions'::regclass THEN
  source_case:=NEW.case_id; source_department:=NEW.department_id;
  SELECT v.early_closure_id INTO source_id FROM case_closure_versions v
   WHERE v.id=NEW.closure_version_id AND v.case_id=source_case AND v.department_id=source_department
    AND v.xmin=pg_current_xact_id()::text::xid;
 ELSIF TG_RELID='case_closure_payment_receipts'::regclass THEN
  source_case:=NEW.case_id; source_department:=NEW.department_id;
  SELECT v.early_closure_id INTO source_id FROM case_closure_payment_versions p
   JOIN case_closure_versions v ON v.id=p.closure_version_id AND v.case_id=p.case_id AND v.department_id=p.department_id
   WHERE p.id=NEW.payment_version_id AND p.case_id=source_case AND p.department_id=source_department
    AND p.xmin=pg_current_xact_id()::text::xid AND v.xmin=pg_current_xact_id()::text::xid;
 ELSE
  RAISE EXCEPTION 'unsupported initial payment set trigger target' USING ERRCODE='23514';
 END IF;
 PERFORM validate_early_initial_payment_source(source_id,source_case,source_department);
 RETURN NEW;
END; $$;
-- Replace only the zero-only source/typed selectors and initial version/receipt
-- gates. Existing permanent guards and the document gate remain installed.
DROP TRIGGER early_zero_source_final ON case_early_closures;
CREATE CONSTRAINT TRIGGER early_initial_payment_source_final AFTER INSERT ON case_early_closures
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_early_initial_payment_source_final();
DROP TRIGGER closure_payment_type_draft_guard ON case_closure_versions;
CREATE TRIGGER closure_payment_type_draft_guard BEFORE INSERT OR UPDATE ON case_closure_versions
 FOR EACH ROW EXECUTE FUNCTION guard_early_typed_closure_register_gate();
DROP TRIGGER case_closure_payment_draft_guard ON case_closure_payment_versions;
CREATE TRIGGER case_closure_payment_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON case_closure_payment_versions
 FOR EACH ROW EXECUTE FUNCTION guard_early_initial_payment_record_gate();
DROP TRIGGER closure_payment_receipt_draft_gate ON case_closure_payment_receipts;
CREATE TRIGGER closure_payment_receipt_draft_gate BEFORE INSERT OR UPDATE OR DELETE ON case_closure_payment_receipts
 FOR EACH ROW EXECUTE FUNCTION guard_early_initial_payment_record_gate();

-- Recheck child events as well as the parent. A parent-only deferred trigger
-- can otherwise be drained IMMEDIATE while the set is still empty.
CREATE CONSTRAINT TRIGGER early_initial_payment_version_set_final AFTER INSERT ON case_closure_payment_versions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_early_initial_payment_source_final();
CREATE CONSTRAINT TRIGGER early_initial_payment_receipt_set_final AFTER INSERT ON case_closure_payment_receipts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_early_initial_payment_source_final();
COMMIT;
