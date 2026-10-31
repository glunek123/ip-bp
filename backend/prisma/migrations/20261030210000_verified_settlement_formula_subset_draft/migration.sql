-- DRAFT ONLY. Gates stay closed. Formula subset is deliberately narrower than JS.
-- Recognizes exactly one unambiguous canonical percentage expression. Other text,
-- multi-match expressions, unsupported Unicode whitespace stay UNKNOWN.
BEGIN;
CREATE FUNCTION archive_decimal36_nonnegative(n numeric) RETURNS numeric LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE exponent integer; fraction text;
BEGIN
 IF n<0 THEN RETURN NULL; END IF;
 IF n=0 THEN RETURN 0; END IF;
 IF n>=1 THEN exponent:=length(trunc(n)::text)-1;
 ELSE fraction:=split_part(n::text,'.',2); exponent:=-(length(fraction)-length(ltrim(fraction,'0')))-1;
 END IF;
 RETURN round(n,35-exponent);
END; $$;
CREATE FUNCTION archive_verified_formula_subset(formula text) RETURNS numeric LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE matched text[]; raw text;
BEGIN
 -- Both JS preferred and fallback select this sole candidate. No extra numbers,
 -- separators other than literal space/*/multiplication sign, or suffix accepted.
 matched:=regexp_match(formula COLLATE "C",'^(?:客户结算金额=)?(?:结案金额[ *×]{0,8})?([0-9]+(?:[.][0-9]+)?)[ ]*%$');
 IF matched IS NULL THEN RETURN NULL; END IF;
 raw:=matched[1];
 IF raw COLLATE "C" !~ '^(?:100(?:[.]0{1,16})?|[0-9]{1,2}(?:[.][0-9]{1,16})?)$' THEN RETURN NULL; END IF;
 RETURN raw::numeric;
END; $$;
CREATE FUNCTION archive_verified_settlement_outputs(inputs jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE field text; value text; basis numeric; cp numeric; split numeric; base numeric;
 customer numeric; lawyer numeric; customer_source text:='AUTOMATIC'; lawyer_source text:='AUTOMATIC';
BEGIN
 IF jsonb_typeof(inputs)<>'object' OR coalesce(inputs->>'closureAmountState','') NOT IN ('KNOWN','PENDING')
  OR ((inputs->>'closureAmountState'='KNOWN') IS DISTINCT FROM (inputs->>'closureAmount' IS NOT NULL))
  OR inputs->>'fallbackClaimAmount' IS NOT NULL THEN RETURN NULL; END IF;
 FOREACH field IN ARRAY ARRAY['closureAmount','lawyerBaseFee','customerManualAmount','lawyerManualAmount'] LOOP
  value:=inputs->>field;
  IF value IS NOT NULL AND (jsonb_typeof(inputs->field)<>'string' OR value COLLATE "C" !~ '^(?:0|[1-9][0-9]{0,15})(?:[.][0-9]{1,2})?$') THEN RETURN NULL; END IF;
 END LOOP;
 IF inputs->>'customerFormula' IS NOT NULL THEN
  IF jsonb_typeof(inputs->'customerFormula')<>'string' THEN RETURN NULL; END IF;
  cp:=archive_verified_formula_subset(inputs->>'customerFormula');
  IF cp IS NULL THEN RETURN NULL; END IF;
 END IF;
 value:=inputs->>'lawyerSplitPercent';
 IF value IS NOT NULL THEN
  IF jsonb_typeof(inputs->'lawyerSplitPercent')<>'string' OR value COLLATE "C" !~ '^(?:100(?:[.]0{1,16})?|[0-9]{1,2}(?:[.][0-9]{1,16})?)$' THEN RETURN NULL; END IF;
  split:=value::numeric;
 END IF;
 basis:=(inputs->>'closureAmount')::numeric; base:=(inputs->>'lawyerBaseFee')::numeric;
 IF inputs->>'lawyerMode' IS NOT NULL THEN
  IF inputs->>'lawyerMode' NOT IN ('FULL_RISK','HALF_RISK','FIXED_FEE') OR split IS NULL OR base IS NULL THEN RETURN NULL; END IF;
 END IF;
 IF basis IS NOT NULL AND cp IS NOT NULL THEN customer:=round(archive_decimal36_nonnegative(archive_decimal36_nonnegative(basis*cp)*0.01),0); END IF;
 IF inputs->>'lawyerMode'='FIXED_FEE' THEN lawyer:=round(base,0);
 ELSIF basis IS NOT NULL AND inputs->>'lawyerMode' IN ('FULL_RISK','HALF_RISK') THEN
  lawyer:=archive_decimal36_nonnegative(archive_decimal36_nonnegative(basis*split)*0.01);
  IF inputs->>'lawyerMode'='HALF_RISK' THEN lawyer:=archive_decimal36_nonnegative(base+lawyer); END IF;
  lawyer:=round(lawyer,0);
 END IF;
 IF inputs->>'customerManualAmount' IS NOT NULL THEN customer:=round((inputs->>'customerManualAmount')::numeric,0); customer_source:='MANUAL'; END IF;
 IF inputs->>'lawyerManualAmount' IS NOT NULL THEN lawyer:=round((inputs->>'lawyerManualAmount')::numeric,0); lawyer_source:='MANUAL'; END IF;
 RETURN jsonb_build_object('customerAmount',customer,'lawyerAmount',lawyer,'customerSource',customer_source,'lawyerSource',lawyer_source);
END; $$;
CREATE OR REPLACE FUNCTION validate_archive_snapshot_readiness(snapshot_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s case_archive_evidence_snapshots%ROWTYPE; c case_closure_versions%ROWTYPE;
 r case_refund_inventory_versions%ROWTYPE; a case_settlement_assessment_versions%ROWTYPE;
 t case_settlement_terms%ROWTYPE; expected_inputs jsonb; verified_outputs jsonb;
 payment_state text:='UNKNOWN'; refund_state text:='UNKNOWN'; customer_state text:='UNKNOWN'; lawyer_state text:='UNKNOWN'; overall_state text:='UNKNOWN';
 required_closure numeric; paid numeric; received numeric; invoiced numeric;
 required_customer numeric; required_lawyer numeric;
 refund_count bigint; refund_unknown bigint; refund_blocked bigint; source_exact boolean:=false;
BEGIN
 PERFORM validate_case_archive_evidence_snapshot(snapshot_id);
 SELECT * INTO STRICT s FROM case_archive_evidence_snapshots WHERE id=snapshot_id;
 SELECT * INTO STRICT c FROM case_closure_versions WHERE id=s.closure_version_id AND case_id=s.case_id AND department_id=s.department_id FOR SHARE;
 SELECT * INTO r FROM case_refund_inventory_versions WHERE id=s.refund_inventory_version_id AND case_id=s.case_id AND department_id=s.department_id FOR SHARE;
 SELECT * INTO a FROM case_settlement_assessment_versions WHERE id=s.settlement_assessment_version_id AND case_id=s.case_id AND department_id=s.department_id FOR SHARE;
 SELECT * INTO t FROM case_settlement_terms WHERE case_id=s.case_id AND department_id=s.department_id FOR UPDATE;
 -- Child sets were checked against authority immediately above. Aggregate each
 -- allocation ID once, not fact.amount; do not add original cases' required sums.
 SELECT coalesce(sum(p.amount),0) INTO paid FROM case_archive_snapshot_payments x
 JOIN case_closure_payment_versions p ON p.id=x.payment_version_id
 WHERE x.snapshot_id=s.id AND p.case_id=s.case_id AND p.department_id=s.department_id;
 SELECT coalesce(sum(v.amount) FILTER(WHERE v.side='CUSTOMER'),0),
        coalesce(sum(v.amount) FILTER(WHERE v.side='LAWYER'),0)
 INTO received,invoiced FROM case_archive_snapshot_allocations x
 JOIN case_settlement_actual_allocations v ON v.id=x.allocation_id
 JOIN settlement_actual_facts f ON f.id=v.fact_id AND f.department_id=v.department_id AND f.side=v.side
 WHERE x.snapshot_id=s.id AND v.department_id=s.department_id AND v.case_id=ANY(s.source_case_ids);
 IF c.close_amount_state='KNOWN' AND c.close_amt IS NOT NULL THEN
  required_closure:=c.close_amt;
  payment_state:=CASE WHEN paid>=required_closure THEN 'PASSED' ELSE 'BLOCKED' END;
 END IF;
 SELECT count(*),count(*) FILTER(WHERE status='UNKNOWN'),
 count(*) FILTER(WHERE status NOT IN ('UNKNOWN','RECEIVED','CONVERTED_TO_COST'))
 INTO refund_count,refund_unknown,refund_blocked FROM case_refund_inventory_items
 WHERE inventory_version_id=r.id AND case_id=s.case_id AND department_id=s.department_id;
 IF r.declaration='NOT_APPLICABLE' AND refund_count=0 THEN refund_state:='PASSED';
 ELSIF r.declaration='COMPLETE' AND refund_count>0 THEN
  refund_state:=CASE WHEN refund_blocked>0 THEN 'BLOCKED' WHEN refund_unknown>0 THEN 'UNKNOWN' ELSE 'PASSED' END;
 END IF;
 expected_inputs:=jsonb_build_object('closureAmount',c.close_amt::text,'closureAmountState',c.close_amount_state::text,
  'fallbackClaimAmount',NULL,'customerFormula',t.customer_formula,'lawyerMode',t.lawyer_mode::text,
  'lawyerBaseFee',t.lawyer_base_fee::text,'lawyerSplitPercent',t.lawyer_split_percent::text,
  'customerManualAmount',t.customer_manual_amount::text,'lawyerManualAmount',t.lawyer_manual_amount::text);
 source_exact:=a.id IS NOT NULL AND a.closure_version_id=c.id AND a.terms_version IS NOT DISTINCT FROM t.version
  AND a.calculation_inputs=expected_inputs AND a.calculation_rule_version='settlement-calculation-v1-whole-yuan-half-up';
 IF source_exact AND a.declaration='NOT_APPLICABLE' AND a.customer_amount IS NULL AND a.lawyer_amount IS NULL THEN
  customer_state:='PASSED'; lawyer_state:='PASSED';
 ELSIF source_exact AND a.declaration='APPLICABLE' THEN
  verified_outputs:=archive_verified_settlement_outputs(expected_inputs);
  -- Verify supported canonical formula outputs independently, never client values.
  -- Unsupported formula language remains UNKNOWN.
  IF verified_outputs IS NOT NULL AND a.customer_source=verified_outputs->>'customerSource' AND a.customer_amount=(verified_outputs->>'customerAmount')::numeric THEN
   required_customer:=(verified_outputs->>'customerAmount')::numeric;
   customer_state:=CASE WHEN required_customer=0 AND NOT EXISTS(SELECT 1 FROM case_archive_snapshot_allocations x JOIN case_settlement_actual_allocations v ON v.id=x.allocation_id WHERE x.snapshot_id=s.id AND v.side='CUSTOMER') THEN 'UNKNOWN' WHEN received>=required_customer THEN 'PASSED' ELSE 'BLOCKED' END;
  END IF;
  IF verified_outputs IS NOT NULL AND a.lawyer_source=verified_outputs->>'lawyerSource' AND a.lawyer_amount=(verified_outputs->>'lawyerAmount')::numeric THEN
   required_lawyer:=(verified_outputs->>'lawyerAmount')::numeric;
   lawyer_state:=CASE WHEN required_lawyer=0 AND NOT EXISTS(SELECT 1 FROM case_archive_snapshot_allocations x JOIN case_settlement_actual_allocations v ON v.id=x.allocation_id WHERE x.snapshot_id=s.id AND v.side='LAWYER') THEN 'UNKNOWN' WHEN invoiced>=required_lawyer THEN 'PASSED' ELSE 'BLOCKED' END;
  END IF;
 END IF;
 IF required_closure=0 THEN
  payment_state:='EXEMPT'; refund_state:='EXEMPT'; customer_state:='EXEMPT'; lawyer_state:='EXEMPT'; overall_state:='EXEMPT';
 ELSIF 'BLOCKED'=ANY(ARRAY[payment_state,refund_state,customer_state,lawyer_state]) THEN overall_state:='BLOCKED';
 ELSIF payment_state='PASSED' AND refund_state='PASSED' AND customer_state='PASSED' AND lawyer_state='PASSED' THEN overall_state:='PASSED';
 END IF;
 -- Null-safe equality binds declared states and all copied amounts to authority.
 -- Clients can neither substitute an assessment amount nor omit a child row.
 IF ROW(s.readiness,s.payment_readiness,s.refund_readiness,s.customer_readiness,s.lawyer_readiness,
   s.closure_amount,s.paid_amount,s.customer_required_amount,s.lawyer_required_amount,s.customer_allocated_amount,s.lawyer_allocated_amount)
 IS DISTINCT FROM ROW(overall_state,payment_state,refund_state,customer_state,lawyer_state,
   required_closure,paid,required_customer,required_lawyer,received,invoiced)
 THEN RAISE EXCEPTION 'archive snapshot readiness or amount lacks authoritative source' USING ERRCODE='23514'; END IF;
END; $$;
COMMIT;

