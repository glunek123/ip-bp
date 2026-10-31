-- DRAFT ONLY. No write gate is removed; this protocol is not archive authorization.
-- SQL does not certify the TypeScript free-form percentage parser/rounding rule.
-- AUTOMATIC formula outputs therefore remain UNKNOWN even if a client says PASSED.
BEGIN;
ALTER TABLE case_archive_evidence_snapshots
 DROP CONSTRAINT case_archive_evidence_snapshots_readiness_check,
 DROP CONSTRAINT case_archive_evidence_snapshots_payment_readiness_check,
 DROP CONSTRAINT case_archive_evidence_snapshots_refund_readiness_check,
 DROP CONSTRAINT case_archive_evidence_snapshots_customer_readiness_check,
 DROP CONSTRAINT case_archive_evidence_snapshots_lawyer_readiness_check;
ALTER TABLE case_archive_evidence_snapshots
 ADD CONSTRAINT archive_snapshot_readiness_values CHECK(readiness IN ('UNKNOWN','PASSED','BLOCKED','EXEMPT')),
 ADD CONSTRAINT archive_snapshot_payment_values CHECK(payment_readiness IN ('UNKNOWN','PASSED','BLOCKED','EXEMPT')),
 ADD CONSTRAINT archive_snapshot_refund_values CHECK(refund_readiness IN ('UNKNOWN','PASSED','BLOCKED','EXEMPT')),
 ADD CONSTRAINT archive_snapshot_customer_values CHECK(customer_readiness IN ('UNKNOWN','PASSED','BLOCKED','EXEMPT')),
 ADD CONSTRAINT archive_snapshot_lawyer_values CHECK(lawyer_readiness IN ('UNKNOWN','PASSED','BLOCKED','EXEMPT')),
 ADD COLUMN closure_amount numeric(16,2), ADD COLUMN paid_amount numeric,
 ADD COLUMN customer_required_amount numeric(30,2), ADD COLUMN lawyer_required_amount numeric(30,2),
 ADD COLUMN customer_allocated_amount numeric, ADD COLUMN lawyer_allocated_amount numeric;
-- Historic UNKNOWN-only snapshots, if any, are not backfilled or relabeled.
-- The existing validator proves exact source scope and bidirectional parent/child
-- set equality, locks cases in sorted order and requires current financial heads.
-- Mirrors settlement-calculation.ts money() + ROUND_HALF_UP to whole yuan for
-- nonnegative manual inputs. PostgreSQL numeric round is exact, not float round.
-- Invalid/unsupported inputs stay unknown instead of certifying an amount.
CREATE FUNCTION archive_verified_manual_whole_yuan(amount numeric) RETURNS numeric
LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT CASE WHEN amount>=0 AND amount<10000000000000000 AND amount=round(amount,2)
 THEN round(amount,0) ELSE NULL END
$$;
CREATE FUNCTION validate_archive_snapshot_readiness(snapshot_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s case_archive_evidence_snapshots%ROWTYPE; c case_closure_versions%ROWTYPE;
 r case_refund_inventory_versions%ROWTYPE; a case_settlement_assessment_versions%ROWTYPE;
 t case_settlement_terms%ROWTYPE; expected_inputs jsonb;
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
  -- Only explicit manual inputs are independently verifiable without reproducing
  -- the application formula language. Formula outputs are intentionally UNKNOWN.
  IF a.customer_source='MANUAL' AND t.customer_manual_amount IS NOT NULL AND a.customer_amount=archive_verified_manual_whole_yuan(t.customer_manual_amount) THEN
   required_customer:=archive_verified_manual_whole_yuan(t.customer_manual_amount);
   customer_state:=CASE WHEN required_customer=0 AND NOT EXISTS(SELECT 1 FROM case_archive_snapshot_allocations x JOIN case_settlement_actual_allocations v ON v.id=x.allocation_id WHERE x.snapshot_id=s.id AND v.side='CUSTOMER') THEN 'UNKNOWN' WHEN received>=required_customer THEN 'PASSED' ELSE 'BLOCKED' END;
  END IF;
  IF a.lawyer_source='MANUAL' AND t.lawyer_manual_amount IS NOT NULL AND a.lawyer_amount=archive_verified_manual_whole_yuan(t.lawyer_manual_amount) THEN
   required_lawyer:=archive_verified_manual_whole_yuan(t.lawyer_manual_amount);
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
CREATE FUNCTION check_archive_snapshot_readiness() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='case_archive_evidence_snapshots' THEN PERFORM validate_archive_snapshot_readiness(NEW.id);
 ELSE PERFORM validate_archive_snapshot_readiness(NEW.snapshot_id); END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER archive_snapshot_readiness_protocol AFTER INSERT ON case_archive_evidence_snapshots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_archive_snapshot_readiness();
CREATE CONSTRAINT TRIGGER archive_snapshot_payment_readiness_protocol AFTER INSERT ON case_archive_snapshot_payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_archive_snapshot_readiness();
CREATE CONSTRAINT TRIGGER archive_snapshot_allocation_readiness_protocol AFTER INSERT ON case_archive_snapshot_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_archive_snapshot_readiness();
COMMIT;

