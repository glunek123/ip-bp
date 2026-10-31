BEGIN;
DO $verify$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(format('%I.guard_early_initial_payment_record_gate()',current_schema())) AND n.nspname=current_schema() AND l.lanname='plpgsql' AND NOT p.prosecdef AND p.proconfig IS NULL AND p.prorettype='trigger'::regtype AND p.provolatile='v' AND encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')='1ee3e8f8bdc7b58f9118a3d74037bd302567a4b323c2f00774773c2c0bd4138a') THEN RAISE EXCEPTION 'unexpected 3059 payment gate baseline' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='case_closure_payment_versions'::regclass AND tgname='case_closure_payment_draft_guard' AND tgfoid='guard_early_initial_payment_record_gate()'::regprocedure AND tgtype=31 AND tgenabled='O') OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='case_closure_payment_receipts'::regclass AND tgname='closure_payment_receipt_draft_gate' AND tgfoid='guard_early_initial_payment_record_gate()'::regprocedure AND tgtype=31 AND tgenabled='O') THEN RAISE EXCEPTION 'unexpected 3059 payment triggers' USING ERRCODE='23514'; END IF;
END; $verify$;
-- Candidate only; no installed migration is changed. Parent will compile and review.
-- Same percentage selection as customerPercentFromFormula, scoped to payment
-- review only. Archive's deliberately narrower parser stays unchanged.
CREATE FUNCTION payment_settlement_outputs_3059(inputs jsonb,rule text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE formula text; matched text[]; raw text; normalized jsonb:=inputs;
BEGIN
 IF inputs->>'customerFormula' IS NOT NULL THEN
  -- ECMAScript WhiteSpace + LineTerminator, normalized one code point to one
  -- literal space before the two ASCII-digit expressions are evaluated.
  formula:=translate(inputs->>'customerFormula',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF',repeat(' ',25));
  matched:=regexp_match(formula COLLATE "C",'结案金额[^0-9%]{0,8}([0-9]+(?:[.][0-9]+)?)[ ]*%');
  IF matched IS NULL THEN matched:=regexp_match(formula COLLATE "C",'([0-9]+(?:[.][0-9]+)?)[ ]*%'); END IF;
  IF matched IS NULL THEN RETURN NULL; END IF; raw:=matched[1];
  IF raw COLLATE "C" !~ '^(?:100(?:[.]0{1,16})?|[0-9]{1,2}(?:[.][0-9]{1,16})?)$' THEN RETURN NULL; END IF;
  normalized:=jsonb_set(inputs,'{customerFormula}',to_jsonb(raw||'%'));
 END IF;
 IF rule='settlement-calculation-v1-whole-yuan-half-up' THEN RETURN archive_verified_settlement_outputs(normalized);
 ELSIF rule='settlement-calculation-v2-manual-cents-auto-whole-yuan-half-up' THEN RETURN archive_verified_settlement_outputs_v2(normalized);
 ELSE RETURN NULL; END IF;
END; $$;
CREATE FUNCTION assert_payment_financial_review_3059(p case_closure_payment_versions,a audit_events,result jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v case_closure_versions%ROWTYPE; t case_settlement_terms%ROWTYPE;
 inv case_refund_inventory_versions%ROWTYPE; ass case_settlement_assessment_versions%ROWTYPE;
 scope_ids uuid[]; allocation_ids jsonb; internal_sources jsonb; inputs jsonb; outputs jsonb;
 refund_state text; refund_reason text; customer_state text; customer_reason text; lawyer_state text; lawyer_reason text;
 same_reason text; combined text; received numeric; invoiced numeric; customer_count bigint; lawyer_count bigint;
BEGIN
 SELECT cv.* INTO v FROM case_closures h JOIN case_closure_versions cv ON cv.id=h.current_version_id
  AND cv.case_id=h.case_id AND cv.department_id=h.department_id WHERE h.case_id=p.case_id AND h.department_id=p.department_id;
 SELECT * INTO t FROM case_settlement_terms WHERE case_id=p.case_id AND department_id=p.department_id;
 scope_ids:=ARRAY[p.case_id];
 IF EXISTS(SELECT 1 FROM case_consolidation_members m WHERE m.case_id=p.case_id AND m.department_id=p.department_id AND m.is_main) THEN
  SELECT array_agg(m.case_id ORDER BY m.case_id) INTO scope_ids FROM case_consolidations h
   JOIN case_consolidation_members m ON m.consolidation_id=h.id AND m.department_id=h.department_id
   WHERE h.main_case_id=p.case_id AND h.department_id=p.department_id;
 END IF;
 IF scope_ids IS NULL OR cardinality(scope_ids)=0 OR NOT p.case_id=ANY(scope_ids)
  OR (SELECT count(*) FROM cases WHERE id=ANY(scope_ids) AND department_id=p.department_id)<>cardinality(scope_ids)
 THEN RAISE EXCEPTION 'payment review source scope invalid' USING ERRCODE='23514'; END IF;
 SELECT * INTO inv FROM case_refund_inventory_versions WHERE case_id=p.case_id AND department_id=p.department_id ORDER BY revision DESC LIMIT 1;
 SELECT * INTO ass FROM case_settlement_assessment_versions WHERE case_id=p.case_id AND department_id=p.department_id ORDER BY revision DESC LIMIT 1;
 SELECT coalesce(jsonb_agg(x.id::text ORDER BY x.id),'[]'::jsonb),
  coalesce(sum(x.amount) FILTER(WHERE x.side='CUSTOMER'),0),coalesce(sum(x.amount) FILTER(WHERE x.side='LAWYER'),0),
  count(*) FILTER(WHERE x.side='CUSTOMER'),count(*) FILTER(WHERE x.side='LAWYER')
 INTO allocation_ids,received,invoiced,customer_count,lawyer_count
 FROM case_settlement_actual_allocations x JOIN settlement_actual_facts f ON f.id=x.fact_id AND f.department_id=x.department_id AND f.side=x.side
 WHERE x.case_id=ANY(scope_ids) AND x.department_id=p.department_id;
 internal_sources:=jsonb_build_object('refundVersionId',inv.id,'assessmentVersionId',ass.id,'allocationIds',allocation_ids,'countedCaseIds',to_jsonb(scope_ids));
 IF a.details->'internalFinancialSources' IS DISTINCT FROM internal_sources THEN
  RAISE EXCEPTION 'payment review requires exact current financial sources' USING ERRCODE='23514'; END IF;
 inputs:=jsonb_build_object('closureAmount',v.close_amt::text,'closureAmountState',v.close_amount_state::text,'fallbackClaimAmount',NULL,
  'customerFormula',t.customer_formula,'lawyerMode',t.lawyer_mode::text,'lawyerBaseFee',t.lawyer_base_fee::text,
  'lawyerSplitPercent',t.lawyer_split_percent::text,'customerManualAmount',t.customer_manual_amount::text,'lawyerManualAmount',t.lawyer_manual_amount::text);
 IF v.close_amount_state='KNOWN' AND v.close_amt=0 THEN
  refund_state:='EXEMPT';customer_state:='EXEMPT';lawyer_state:='EXEMPT';
  refund_reason:='EXPLICIT_ZERO_CLOSURE_AMOUNT';customer_reason:=refund_reason;lawyer_reason:=refund_reason;
 ELSE
  IF inv.id IS NULL THEN refund_state:='UNKNOWN';refund_reason:='REFUND_INVENTORY_MISSING';
  ELSIF inv.declaration='NOT_APPLICABLE' THEN
   IF EXISTS(SELECT 1 FROM case_refund_inventory_items WHERE inventory_version_id=inv.id) THEN refund_state:='UNKNOWN';refund_reason:='INVALID_REFUND_INVENTORY';
   ELSE refund_state:='PASSED';refund_reason:='REFUND_EXPLICITLY_NOT_APPLICABLE'; END IF;
  ELSIF inv.declaration<>'COMPLETE' OR NOT EXISTS(SELECT 1 FROM case_refund_inventory_items WHERE inventory_version_id=inv.id) THEN
   refund_state:='UNKNOWN';refund_reason:='REFUND_COMPLETENESS_UNCONFIRMED';
  ELSIF EXISTS(SELECT 1 FROM case_refund_inventory_items WHERE inventory_version_id=inv.id AND status NOT IN ('UNKNOWN','RECEIVED','CONVERTED_TO_COST')) THEN
   refund_state:='BLOCKED';refund_reason:='REFUND_ITEMS_NOT_RECEIVED_OR_COSTED';
  ELSIF EXISTS(SELECT 1 FROM case_refund_inventory_items WHERE inventory_version_id=inv.id AND status='UNKNOWN') THEN
   refund_state:='UNKNOWN';refund_reason:='REFUND_ITEM_STATUS_UNKNOWN';
  ELSE refund_state:='PASSED';refund_reason:='ALL_REFUND_ITEMS_RECEIVED_OR_COSTED'; END IF;
  IF ass.id IS NULL THEN same_reason:='ASSESSMENT_MISSING';
  ELSIF ass.declaration='UNKNOWN' THEN same_reason:='SETTLEMENT_DECLARATION_UNKNOWN';
  ELSIF ass.closure_version_id IS DISTINCT FROM v.id OR ass.terms_version IS DISTINCT FROM t.version THEN same_reason:='ASSESSMENT_SOURCE_STALE';
  ELSIF ass.calculation_rule_version NOT IN ('settlement-calculation-v1-whole-yuan-half-up','settlement-calculation-v2-manual-cents-auto-whole-yuan-half-up') THEN same_reason:='ASSESSMENT_RULE_UNSUPPORTED';
  ELSIF ass.calculation_inputs IS DISTINCT FROM inputs THEN same_reason:='ASSESSMENT_INPUTS_CHANGED';
  ELSIF ass.declaration='NOT_APPLICABLE' THEN
   IF ass.customer_amount IS NOT NULL OR ass.lawyer_amount IS NOT NULL THEN same_reason:='INVALID_NOT_APPLICABLE_AMOUNTS';
   ELSE customer_state:='PASSED';lawyer_state:='PASSED';customer_reason:='SETTLEMENT_EXPLICITLY_NOT_APPLICABLE';lawyer_reason:=customer_reason; END IF;
  ELSE
   outputs:=payment_settlement_outputs_3059(inputs,ass.calculation_rule_version);
   IF outputs IS NULL THEN
    same_reason:='INVALID_SETTLEMENT_CALCULATION';
   ELSIF (outputs->>'customerAmount')::numeric IS DISTINCT FROM ass.customer_amount
    OR (outputs->>'lawyerAmount')::numeric IS DISTINCT FROM ass.lawyer_amount
    OR outputs->>'customerSource' IS DISTINCT FROM ass.customer_source OR outputs->>'lawyerSource' IS DISTINCT FROM ass.lawyer_source THEN same_reason:='ASSESSMENT_RESULT_UNVERIFIED';
   ELSE
    customer_state:=CASE WHEN ass.customer_amount IS NULL OR (ass.customer_amount=0 AND customer_count=0) THEN 'UNKNOWN' WHEN received>=ass.customer_amount THEN 'PASSED' ELSE 'BLOCKED' END;
    lawyer_state:=CASE WHEN ass.lawyer_amount IS NULL OR (ass.lawyer_amount=0 AND lawyer_count=0) THEN 'UNKNOWN' WHEN invoiced>=ass.lawyer_amount THEN 'PASSED' ELSE 'BLOCKED' END;
    customer_reason:=CASE customer_state WHEN 'PASSED' THEN 'CUSTOMER_RECEIPTS_REACHED' WHEN 'BLOCKED' THEN 'CUSTOMER_RECEIPTS_INSUFFICIENT' ELSE 'SETTLEMENT_AMOUNT_OR_ZERO_EVIDENCE_UNKNOWN' END;
    lawyer_reason:=CASE lawyer_state WHEN 'PASSED' THEN 'LAWYER_INVOICES_REACHED' WHEN 'BLOCKED' THEN 'LAWYER_INVOICES_INSUFFICIENT' ELSE 'SETTLEMENT_AMOUNT_OR_ZERO_EVIDENCE_UNKNOWN' END;
   END IF;
  END IF;
  IF same_reason IS NOT NULL THEN customer_state:='UNKNOWN';lawyer_state:='UNKNOWN';customer_reason:=same_reason;lawyer_reason:=same_reason; END IF;
 END IF;
 combined:=CASE WHEN 'BLOCKED'=ANY(ARRAY[refund_state,customer_state,lawyer_state]) THEN 'BLOCKED'
  WHEN 'UNKNOWN'=ANY(ARRAY[refund_state,customer_state,lawyer_state]) THEN 'UNKNOWN' ELSE 'PASSED' END;
 IF result#>>'{review,financialReadiness}' IS DISTINCT FROM combined OR result#>'{review,financialItems}' IS DISTINCT FROM
  jsonb_build_object('refund',jsonb_build_object('state',refund_state,'reason',refund_reason),
   'customer',jsonb_build_object('state',customer_state,'reason',customer_reason),'lawyer',jsonb_build_object('state',lawyer_state,'reason',lawyer_reason))
 THEN RAISE EXCEPTION 'payment review differs from current financial facts' USING ERRCODE='23514'; END IF;
END; $$;

CREATE FUNCTION seal_payment_correction_sources_3059() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- One command per transaction. Later transactions remain free to correct
 -- amounts, allocate money or archive; historical receipts stay historical.
 IF EXISTS(SELECT 1 FROM case_closure_payment_versions p WHERE p.revision>1 AND p.xmin=pg_current_xact_id()::text::xid) THEN
  RAISE EXCEPTION 'payment correction financial sources sealed in this transaction' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
DO $seals$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['cases','case_closures','case_closure_versions','case_refund_inventory_versions','case_refund_inventory_items',
  'case_settlement_assessment_versions','case_settlement_terms','case_settlement_actual_allocations','settlement_actual_facts',
  'case_consolidations','case_consolidation_members'] LOOP
  EXECUTE format('CREATE TRIGGER payment_correction_source_seal_3059 BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION seal_payment_correction_sources_3059()',tbl);
 END LOOP;
END; $seals$;

CREATE FUNCTION assert_payment_correction_3059(p case_closure_payment_versions, final_check boolean)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE prior case_closure_payment_versions%ROWTYPE; a audit_events%ROWTYPE;
 r case_closure_payment_receipts%ROWTYPE; c cases%ROWTYPE; v case_closure_versions%ROWTYPE;
 ids jsonb; amounts jsonb; expected_review_required boolean;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR p.revision<=1 THEN
  RAISE EXCEPTION 'payment correction requires serializable append revision' USING ERRCODE='23514';
 END IF;
 SELECT * INTO c FROM cases WHERE id=p.case_id AND department_id=p.department_id FOR UPDATE;
 SELECT cv.* INTO v FROM case_closures h JOIN case_closure_versions cv
  ON cv.id=h.current_version_id AND cv.case_id=h.case_id AND cv.department_id=h.department_id
  WHERE h.case_id=p.case_id AND h.department_id=p.department_id;
 SELECT * INTO prior FROM case_closure_payment_versions WHERE id=p.prior_version_id;
 SELECT * INTO a FROM audit_events WHERE id=p.audit_event_id AND xmin=pg_current_xact_id()::text::xid;
 IF c.id IS NULL OR c.stage::text NOT IN ('WAITING_ARCHIVE','ARCHIVED') OR v.id IS NULL
  OR p.closure_version_id IS DISTINCT FROM v.id OR p.state NOT IN ('ACTIVE','VOID')
  OR prior.id IS NULL OR prior.case_id IS DISTINCT FROM p.case_id OR prior.department_id IS DISTINCT FROM p.department_id
  OR prior.payment_id IS DISTINCT FROM p.payment_id OR prior.revision+1 IS DISTINCT FROM p.revision
  OR prior.state IS DISTINCT FROM 'ACTIVE' OR p.recorded_at<prior.recorded_at
  OR p.paid_on>(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date
  OR a.id IS NULL OR a.details->>'caseId' IS DISTINCT FROM p.case_id::text
  OR a.details->>'priorVersionId' IS DISTINCT FROM prior.id::text OR a.details->>'versionId' IS DISTINCT FROM p.id::text
  OR a.details->>'paymentId' IS DISTINCT FROM p.payment_id::text
  OR a.details->>'kind' IS DISTINCT FROM (CASE WHEN p.state='VOID' THEN 'VOID' ELSE 'CORRECT' END)
  OR a.details->'reason' IS DISTINCT FROM coalesce(to_jsonb(p.reason),'null'::jsonb)
  OR a.details->>'recordedAt' IS DISTINCT FROM to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  OR a.details->>'fingerprint' !~ '^[0-9a-f]{64}$'
  OR (p.state='VOID' AND (p.paid_on,p.amount,p.payer,p.payee) IS DISTINCT FROM (prior.paid_on,prior.amount,prior.payer,prior.payee))
  OR (p.state='ACTIVE' AND (a.details->>'paidOn' IS DISTINCT FROM to_char(p.paid_on,'YYYY-MM-DD')
    OR a.details->>'amount' IS DISTINCT FROM p.amount::text OR a.details->>'payer' IS DISTINCT FROM p.payer
    OR a.details->>'payee' IS DISTINCT FROM p.payee))
  OR (p.state='VOID' AND a.details ?| ARRAY['paidOn','amount','payer','payee'])
 THEN RAISE EXCEPTION 'payment correction requires exact prior current closure and audit' USING ERRCODE='23514'; END IF;
 PERFORM assert_case_financial_actor_draft(p.recorded_by_user_id,p.case_id,p.department_id,p.audit_event_id,
  p.id,'CASE_CLOSURE_PAYMENT_VERSION',CASE WHEN p.state='VOID' THEN 'CASE_CLOSURE_PAYMENT_VOID' ELSE 'CASE_CLOSURE_PAYMENT_CORRECT' END,
  ARRAY['WAITING_ARCHIVE','ARCHIVED']);
 -- One independently receipted revision command per case in one transaction.
 -- This fence remains immediate after SET CONSTRAINTS has drained an earlier receipt.
 IF EXISTS(SELECT 1 FROM case_closure_payment_versions x WHERE x.case_id=p.case_id AND x.department_id=p.department_id
   AND x.revision>1 AND x.id<>p.id AND x.xmin=pg_current_xact_id()::text::xid) THEN
  RAISE EXCEPTION 'payment correction command already sealed in this transaction' USING ERRCODE='23514';
 END IF;
 IF NOT final_check THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM case_closure_payment_versions x WHERE x.id=p.id AND x.xmin=pg_current_xact_id()::text::xid)
  OR EXISTS(SELECT 1 FROM case_closure_payment_versions n WHERE n.prior_version_id=p.id)
  OR EXISTS(SELECT 1 FROM case_closure_payment_versions n WHERE n.prior_version_id=prior.id AND n.id<>p.id)
 THEN RAISE EXCEPTION 'payment correction requires transaction local latest head' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM case_closure_payment_receipts WHERE payment_version_id=p.id AND xmin=pg_current_xact_id()::text::xid;
 SELECT coalesce(jsonb_agg(to_jsonb(x.id::text) ORDER BY x.payment_id),'[]'::jsonb),
  coalesce(jsonb_agg(to_jsonb(x.amount::text) ORDER BY x.payment_id),'[]'::jsonb) INTO ids,amounts
  FROM case_closure_payment_versions x WHERE x.case_id=p.case_id AND x.department_id=p.department_id
   AND x.state='ACTIVE' AND NOT EXISTS(SELECT 1 FROM case_closure_payment_versions n WHERE n.prior_version_id=x.id);
 PERFORM assert_payment_financial_review_3059(p,a,r.result_snapshot);
 expected_review_required:=c.stage::text='ARCHIVED' AND
  (v.close_amount_state<>'KNOWN' OR v.close_amt IS NULL OR
   (v.close_amt>0 AND ((SELECT coalesce(sum(value::numeric),0) FROM jsonb_array_elements_text(amounts))<v.close_amt
     OR r.result_snapshot#>>'{review,financialReadiness}' IS DISTINCT FROM 'PASSED')));
 IF r.id IS NULL OR r.case_id IS DISTINCT FROM p.case_id OR r.department_id IS DISTINCT FROM p.department_id
  OR r.actor_user_id IS DISTINCT FROM p.recorded_by_user_id OR r.audit_event_id IS DISTINCT FROM a.id
  OR r.created_at IS DISTINCT FROM p.recorded_at OR r.request_fingerprint IS DISTINCT FROM a.details->>'fingerprint'
  OR r.result_snapshot IS DISTINCT FROM a.details->'result'
  OR r.result_snapshot->>'stage' IS DISTINCT FROM c.stage::text
  OR r.result_snapshot#>>'{review,stage}' IS DISTINCT FROM c.stage::text
  OR r.result_snapshot#>>'{review,caseId}' IS DISTINCT FROM p.case_id::text
  OR r.result_snapshot#>>'{review,closureVersionId}' IS DISTINCT FROM v.id::text
  OR r.result_snapshot#>'{review,closureAmount}' IS DISTINCT FROM
    (CASE WHEN v.close_amount_state='KNOWN' THEN to_jsonb(v.close_amt::text) ELSE 'null'::jsonb END)
  OR r.result_snapshot#>'{review,effectivePaymentVersionIds}' IS DISTINCT FROM ids
  OR r.result_snapshot#>'{review,effectiveAmounts}' IS DISTINCT FROM amounts
  OR r.result_snapshot->'reviewRequired' IS DISTINCT FROM to_jsonb(expected_review_required)
 THEN RAISE EXCEPTION 'payment correction requires exact final receipt and effective set' USING ERRCODE='23514'; END IF;
END; $$;
CREATE FUNCTION check_payment_correction_final_3059() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p case_closure_payment_versions%ROWTYPE;
BEGIN
 IF TG_RELID='case_closure_payment_versions'::regclass THEN p:=NEW;
 ELSE SELECT * INTO p FROM case_closure_payment_versions WHERE id=NEW.payment_version_id; END IF;
 IF p.revision>1 THEN PERFORM assert_payment_correction_3059(p,true); END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER payment_correction_final_3059 AFTER INSERT ON case_closure_payment_versions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_correction_final_3059();
CREATE CONSTRAINT TRIGGER payment_correction_receipt_final_3059 AFTER INSERT ON case_closure_payment_receipts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_correction_final_3059();

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
 IF p.revision>1 THEN
  PERFORM assert_payment_correction_3059(p,false);
  RETURN NEW;
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
DO $verify_dispatch$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(format('%I.check_early_initial_payment_source_final()',current_schema())) AND NOT p.prosecdef AND p.proconfig IS NULL AND p.prorettype='trigger'::regtype AND p.provolatile='v' AND encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')='a1b9511afcbdf8926d5f924633be876bda3b9cfe7398796a6aa0d8c6753eb6d2') THEN RAISE EXCEPTION 'unexpected payment child dispatch baseline' USING ERRCODE='23514'; END IF;
END; $verify_dispatch$;
CREATE OR REPLACE FUNCTION check_early_initial_payment_source_final() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE correction_payment case_closure_payment_versions%ROWTYPE; source_id uuid; source_case uuid; source_department uuid; version_id uuid; version_kind text;
BEGIN
 IF TG_RELID='case_early_closures'::regclass THEN
  PERFORM validate_early_initial_payment_source(NEW.id,NEW.case_id,NEW.department_id);
  RETURN NEW;
 ELSIF TG_RELID='case_closure_payment_versions'::regclass THEN
  IF NEW.revision>1 THEN PERFORM assert_payment_correction_3059(NEW,true); RETURN NEW; END IF;
  source_case:=NEW.case_id; source_department:=NEW.department_id;
  SELECT v.id,v.kind,v.early_closure_id INTO version_id,version_kind,source_id FROM case_closure_versions v
   WHERE v.id=NEW.closure_version_id AND v.case_id=source_case AND v.department_id=source_department AND v.xmin=pg_current_xact_id()::text::xid;
 ELSIF TG_RELID='case_closure_payment_receipts'::regclass THEN
  SELECT * INTO correction_payment FROM case_closure_payment_versions WHERE id=NEW.payment_version_id;
  IF correction_payment.revision>1 THEN PERFORM assert_payment_correction_3059(correction_payment,true); RETURN NEW; END IF;
  source_case:=NEW.case_id; source_department:=NEW.department_id;
  SELECT v.id,v.kind,v.early_closure_id INTO version_id,version_kind,source_id FROM case_closure_payment_versions p
   JOIN case_closure_versions v ON v.id=p.closure_version_id AND v.case_id=p.case_id AND v.department_id=p.department_id
   WHERE p.id=NEW.payment_version_id AND p.case_id=source_case AND p.department_id=source_department
    AND p.xmin=pg_current_xact_id()::text::xid AND v.xmin=pg_current_xact_id()::text::xid;
 ELSE RAISE EXCEPTION 'unsupported payment set trigger target' USING ERRCODE='23514'; END IF;
 IF version_kind='REGISTER' THEN
  PERFORM validate_early_initial_payment_source(source_id,source_case,source_department);
 ELSIF version_kind='CORRECT' THEN
  PERFORM validate_settlement_update_payment_set(version_id,source_case,source_department);
 ELSE RAISE EXCEPTION 'payment set has no admitted command context' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
COMMIT;
