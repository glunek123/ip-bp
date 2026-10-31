BEGIN;

DO $preflight$ BEGIN

 IF to_regclass('public.case_refund_inventory_item_amounts') IS NOT NULL THEN RAISE EXCEPTION 'refund amount protocol already exists' USING ERRCODE='23514'; END IF;

 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.validate_case_refund_inventory_snapshot(uuid)') AND NOT p.prosecdef AND p.proconfig IS NULL AND encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')='57f84355a172528f08b0e203c4cd332fd1e6fc086d50623ff839d09628698f20') THEN RAISE EXCEPTION 'unexpected268 baseline validate_case_refund_inventory_snapshot' USING ERRCODE='23514'; END IF;

 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.check_case_refund_inventory_receipt()') AND NOT p.prosecdef AND p.proconfig IS NULL AND encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')='94a86a91b8e49714fe45a95cc2ee868f540b80fa25fd7c7daf1c9c0dfabab698') THEN RAISE EXCEPTION 'unexpected268 baseline check_case_refund_inventory_receipt' USING ERRCODE='23514'; END IF;

 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.validate_archive_snapshot_readiness(uuid)') AND NOT p.prosecdef AND p.proconfig IS NULL AND encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')='cb53b32232e24d1802764d0eead03dee23919812243a99e22b87032a1aa94711') THEN RAISE EXCEPTION 'unexpected268 baseline validate_archive_snapshot_readiness' USING ERRCODE='23514'; END IF;

 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.check_new_archive_required_financial_snapshot_draft()') AND NOT p.prosecdef AND p.proconfig IS NULL AND encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')='f1ea323f3ca7478c4c6ecd583bd5324559237574da8290fd9d41a82076043c64') THEN RAISE EXCEPTION 'unexpected268 baseline check_new_archive_required_financial_snapshot_draft' USING ERRCODE='23514'; END IF;

 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.assert_payment_financial_review_3059(case_closure_payment_versions,audit_events,jsonb)') AND NOT p.prosecdef AND p.proconfig IS NULL AND encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')='b4cdefe35bbc8f547aadc4757b71f7229f81534db22942268d2d266f67650599') THEN RAISE EXCEPTION 'unexpected268 baseline assert_payment_financial_review_3059' USING ERRCODE='23514'; END IF;

 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.assert_payment_correction_3059(case_closure_payment_versions,boolean)') AND NOT p.prosecdef AND p.proconfig IS NULL AND encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')='a6e97803588bf0e70707a02869c69f63f818259e1b22580f7c9c302aa28cb369') THEN RAISE EXCEPTION 'unexpected268 baseline assert_payment_correction_3059' USING ERRCODE='23514'; END IF;

END; $preflight$;

-- Append-only amount sidecar. Original item rows, legacy JSON, fingerprints and snapshot rows are not altered/backfilled.
CREATE TABLE public.case_refund_inventory_item_amounts (
 inventory_version_id uuid NOT NULL,item_id uuid NOT NULL,amount numeric(16,2),
 PRIMARY KEY(inventory_version_id,item_id),CHECK(amount IS NULL OR (amount>=0 AND amount<100000000000000)),
 FOREIGN KEY(inventory_version_id,item_id) REFERENCES public.case_refund_inventory_items(inventory_version_id,item_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE FUNCTION public.guard_refund_item_amount_268() RETURNS trigger LANGUAGE plpgsql AS $amount$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'refund item amount history is immutable' USING ERRCODE='23514'; END IF;
 IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'refund item amount requires serializable command' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM case_refund_inventory_items i JOIN case_refund_inventory_versions v ON v.id=i.inventory_version_id
  WHERE i.inventory_version_id=NEW.inventory_version_id AND i.item_id=NEW.item_id AND i.xmin=pg_current_xact_id()::text::xid
   AND v.creation_xid=pg_current_xact_id() AND v.xmin=pg_current_xact_id()::text::xid)
  OR EXISTS(SELECT 1 FROM case_refund_inventory_receipts r WHERE r.inventory_version_id=NEW.inventory_version_id)
 THEN RAISE EXCEPTION 'refund amount requires unsealed transaction-local item' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $amount$;
CREATE TRIGGER refund_item_amount_immutable_268 BEFORE INSERT OR UPDATE OR DELETE ON case_refund_inventory_item_amounts
 FOR EACH ROW EXECUTE FUNCTION guard_refund_item_amount_268();
CREATE TRIGGER archive_snapshot_source_order BEFORE INSERT OR UPDATE OR DELETE ON case_refund_inventory_item_amounts
 FOR EACH ROW EXECUTE FUNCTION guard_archive_snapshot_source_order();
CREATE TRIGGER payment_correction_source_seal_3059 BEFORE INSERT OR UPDATE OR DELETE ON case_refund_inventory_item_amounts
 FOR EACH ROW EXECUTE FUNCTION seal_payment_correction_sources_3059();
CREATE FUNCTION public.refund_inventory_items_projection_268(target_version uuid,with_amount boolean) RETURNS jsonb LANGUAGE sql STABLE AS $items$
 SELECT coalesce(jsonb_agg(jsonb_build_object('itemId',i.item_id,'party',i.party,'status',i.status,'description',i.description)
  || CASE WHEN with_amount THEN jsonb_build_object('amount',a.amount::numeric(16,2)::text) ELSE '{}'::jsonb END ORDER BY i.item_id::text),'[]'::jsonb)
 FROM case_refund_inventory_items i LEFT JOIN case_refund_inventory_item_amounts a ON a.inventory_version_id=i.inventory_version_id AND a.item_id=i.item_id
 WHERE i.inventory_version_id=target_version
$items$;
CREATE FUNCTION public.refund_inventory_readiness_268(target_version uuid) RETURNS jsonb LANGUAGE plpgsql STABLE AS $refund$
DECLARE v case_refund_inventory_versions%ROWTYPE; count_items bigint; unknown_amount bigint; unknown_status bigint; blocked bigint; positive_items bigint;
 state text; reason text;
BEGIN
 SELECT * INTO v FROM case_refund_inventory_versions WHERE id=target_version;
 SELECT count(*),count(*) FILTER(WHERE a.amount IS NULL),count(*) FILTER(WHERE a.amount>0 AND i.status='UNKNOWN'),
 count(*) FILTER(WHERE a.amount>0),count(*) FILTER(WHERE a.amount>0 AND i.status<>'UNKNOWN' AND NOT(i.status='RECEIVED' OR (i.party='DEFENDANT' AND i.status='CONVERTED_TO_COST')))
 INTO count_items,unknown_amount,unknown_status,positive_items,blocked FROM case_refund_inventory_items i
 LEFT JOIN case_refund_inventory_item_amounts a ON a.inventory_version_id=i.inventory_version_id AND a.item_id=i.item_id WHERE i.inventory_version_id=target_version;
 IF v.id IS NULL THEN state:='UNKNOWN';reason:='REFUND_INVENTORY_MISSING';
 ELSIF v.declaration='NOT_APPLICABLE' THEN
  IF count_items=0 THEN state:='PASSED';reason:='REFUND_EXPLICITLY_NOT_APPLICABLE'; ELSE state:='UNKNOWN';reason:='INVALID_REFUND_INVENTORY'; END IF;
 ELSIF v.declaration<>'COMPLETE' OR count_items=0 THEN state:='UNKNOWN';reason:='REFUND_COMPLETENESS_UNCONFIRMED';
 ELSIF blocked>0 THEN state:='BLOCKED';reason:='REFUND_ITEMS_NOT_RECEIVED_OR_COSTED';
 ELSIF unknown_amount>0 THEN state:='UNKNOWN';reason:='REFUND_AMOUNT_UNKNOWN';
 ELSIF unknown_status>0 THEN state:='UNKNOWN';reason:='REFUND_ITEM_STATUS_UNKNOWN';
 ELSE state:='PASSED';reason:=CASE WHEN positive_items=0 THEN 'REFUND_ALL_AMOUNTS_ZERO' ELSE 'ALL_REFUND_ITEMS_RECEIVED_OR_COSTED' END; END IF;
 RETURN jsonb_build_object('state',state,'reason',reason);
END; $refund$;

CREATE OR REPLACE FUNCTION "validate_case_refund_inventory_snapshot"(version_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE inventory "case_refund_inventory_versions"%ROWTYPE;
BEGIN
 SELECT * INTO STRICT inventory FROM "case_refund_inventory_versions" WHERE "id"=version_id;
 IF inventory.creation_xid=pg_current_xact_id() AND EXISTS(SELECT 1 FROM case_refund_inventory_items i
  WHERE i.inventory_version_id=inventory.id AND NOT EXISTS(SELECT 1 FROM case_refund_inventory_item_amounts a WHERE a.inventory_version_id=i.inventory_version_id AND a.item_id=i.item_id))
 THEN RAISE EXCEPTION 'new refund item requires explicit amount sidecar, NULL means unknown' USING ERRCODE='23514'; END IF;
 IF inventory."declaration"='NOT_APPLICABLE' AND EXISTS
  (SELECT 1 FROM "case_refund_inventory_items" i WHERE i."inventory_version_id"=inventory."id") THEN
  RAISE EXCEPTION 'not applicable refund inventory must contain zero items' USING ERRCODE='23514';
 END IF;
 IF inventory."declaration"='COMPLETE' THEN
  IF NOT EXISTS (SELECT 1 FROM "case_refund_inventory_items" i WHERE i."inventory_version_id"=inventory."id") THEN
   RAISE EXCEPTION 'empty refund inventory needs explicit not applicable declaration' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
   (SELECT i.item_id,i.party,i.description,a.amount FROM case_refund_inventory_items i LEFT JOIN case_refund_inventory_item_amounts a ON a.inventory_version_id=i.inventory_version_id AND a.item_id=i.item_id WHERE i.inventory_version_id=inventory.id
    EXCEPT SELECT i.item_id,i.party,i.description,a.amount FROM case_refund_inventory_items i LEFT JOIN case_refund_inventory_item_amounts a ON a.inventory_version_id=i.inventory_version_id AND a.item_id=i.item_id WHERE i.inventory_version_id=inventory.prior_version_id)
   UNION ALL
   (SELECT i.item_id,i.party,i.description,a.amount FROM case_refund_inventory_items i LEFT JOIN case_refund_inventory_item_amounts a ON a.inventory_version_id=i.inventory_version_id AND a.item_id=i.item_id WHERE i.inventory_version_id=inventory.prior_version_id
    EXCEPT SELECT i.item_id,i.party,i.description,a.amount FROM case_refund_inventory_items i LEFT JOIN case_refund_inventory_item_amounts a ON a.inventory_version_id=i.inventory_version_id AND a.item_id=i.item_id WHERE i.inventory_version_id=inventory.id)
  ) THEN
   RAISE EXCEPTION 'inventory changes require a new UNKNOWN version before confirmation' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN;
END; $$;

CREATE FUNCTION public.check_refund_item_amount_complete_268() RETURNS trigger LANGUAGE plpgsql AS $complete$
BEGIN PERFORM validate_case_refund_inventory_snapshot(NEW.inventory_version_id);RETURN NEW;END; $complete$;
CREATE CONSTRAINT TRIGGER refund_item_amount_complete_268 AFTER INSERT ON case_refund_inventory_item_amounts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_refund_item_amount_complete_268();

CREATE OR REPLACE FUNCTION "check_case_refund_inventory_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v "case_refund_inventory_versions"%ROWTYPE; a "audit_events"%ROWTYPE;
 expected_items jsonb; supplied_items jsonb; readiness text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'refund receipts are immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO STRICT v FROM "case_refund_inventory_versions" WHERE "id"=NEW."inventory_version_id";
 SELECT * INTO STRICT a FROM "audit_events" WHERE "id"=NEW."audit_event_id";
 IF v."case_id"<>NEW."case_id" OR v."department_id"<>NEW."department_id"
  OR v."recorded_by_user_id"<>NEW."actor_user_id" OR v."audit_event_id"<>NEW."audit_event_id"
  OR NEW."created_at"<v."recorded_at" OR a."department_id"<>NEW."department_id"
  OR a."actor_kind"<>'HUMAN' OR a."actor_user_id" IS DISTINCT FROM NEW."actor_user_id"
  OR a."internal_actor_user_id" IS DISTINCT FROM NEW."actor_user_id"
  OR a."resource_type"<>'CASE_REFUND_INVENTORY_VERSION' OR a."resource_id"<>v."id"
  OR a."action" NOT IN ('CASE_REFUND_INVENTORY_RECORD','CASE_REFUND_INVENTORY_CONFIRM')
  OR (a."details"->>'requestFingerprint') IS DISTINCT FROM NEW."request_fingerprint"::text THEN
  RAISE EXCEPTION 'refund receipt requires exact inventory actor and audit' USING ERRCODE='23514';
 END IF;
 PERFORM "validate_case_refund_inventory_snapshot"(v."id");
 expected_items := refund_inventory_items_projection_268(v.id,true);
 IF jsonb_typeof(NEW."result_snapshot"#>'{snapshot,items}') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'refund receipt items missing' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(jsonb_agg(value ORDER BY value->>'itemId'),'[]'::jsonb) INTO supplied_items
 FROM jsonb_array_elements(NEW."result_snapshot"#>'{snapshot,items}');
 readiness := refund_inventory_readiness_268(v.id)->>'state';
 IF supplied_items IS DISTINCT FROM expected_items OR NEW."result_snapshot" IS DISTINCT FROM jsonb_build_object(
  'draft',true,'readiness',readiness,'snapshot',jsonb_build_object('id',v."id",'caseId',v."case_id",'departmentId',v."department_id",'revision',v."revision",'declaration',v."declaration",'items',NEW."result_snapshot"#>'{snapshot,items}')) THEN
  RAISE EXCEPTION 'refund receipt result must match exact immutable snapshot' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION validate_archive_snapshot_readiness_legacy_268(snapshot_id uuid) RETURNS void LANGUAGE plpgsql AS $$
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
  AND a.calculation_inputs=expected_inputs AND a.calculation_rule_version IN ('settlement-calculation-v1-whole-yuan-half-up','settlement-calculation-v2-manual-cents-auto-whole-yuan-half-up');
 IF source_exact AND a.declaration='NOT_APPLICABLE' AND a.customer_amount IS NULL AND a.lawyer_amount IS NULL THEN
  customer_state:='PASSED'; lawyer_state:='PASSED';
 ELSIF source_exact AND a.declaration='APPLICABLE' THEN
  IF a.calculation_rule_version='settlement-calculation-v1-whole-yuan-half-up' THEN
   verified_outputs:=archive_verified_settlement_outputs(expected_inputs);
  ELSE
   verified_outputs:=archive_verified_settlement_outputs_v2(expected_inputs);
  END IF;
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

CREATE OR REPLACE FUNCTION validate_archive_snapshot_readiness(snapshot_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s case_archive_evidence_snapshots%ROWTYPE; c case_closure_versions%ROWTYPE;
 r case_refund_inventory_versions%ROWTYPE; a case_settlement_assessment_versions%ROWTYPE;
 t case_settlement_terms%ROWTYPE; expected_inputs jsonb; verified_outputs jsonb; zero_outputs jsonb;
 payment_state text:='UNKNOWN'; refund_state text:='UNKNOWN'; customer_state text:='UNKNOWN'; lawyer_state text:='UNKNOWN'; overall_state text:='UNKNOWN';
 required_closure numeric; paid numeric; received numeric; invoiced numeric;
 required_customer numeric; required_lawyer numeric;
 refund_count bigint; refund_unknown bigint; refund_blocked bigint; source_exact boolean:=false;
BEGIN
 PERFORM validate_case_archive_evidence_snapshot(snapshot_id);
 SELECT * INTO STRICT s FROM case_archive_evidence_snapshots WHERE id=snapshot_id;
 IF s.creation_xid IS DISTINCT FROM pg_current_xact_id() AND s.closure_amount=0 AND
 ROW(s.readiness,s.payment_readiness,s.refund_readiness,s.customer_readiness,s.lawyer_readiness)=ROW('EXEMPT'::varchar,'EXEMPT'::varchar,'EXEMPT'::varchar,'EXEMPT'::varchar,'EXEMPT'::varchar) THEN
  PERFORM validate_archive_snapshot_readiness_legacy_268(snapshot_id);RETURN;
 END IF;
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
 refund_state:=refund_inventory_readiness_268(r.id)->>'state';
 expected_inputs:=jsonb_build_object('closureAmount',c.close_amt::text,'closureAmountState',c.close_amount_state::text,
  'fallbackClaimAmount',NULL,'customerFormula',t.customer_formula,'lawyerMode',t.lawyer_mode::text,
  'lawyerBaseFee',t.lawyer_base_fee::text,'lawyerSplitPercent',t.lawyer_split_percent::text,
  'customerManualAmount',t.customer_manual_amount::text,'lawyerManualAmount',t.lawyer_manual_amount::text);
 source_exact:=a.id IS NOT NULL AND a.closure_version_id=c.id AND a.terms_version IS NOT DISTINCT FROM t.version
  AND a.calculation_inputs=expected_inputs AND a.calculation_rule_version IN ('settlement-calculation-v1-whole-yuan-half-up','settlement-calculation-v2-manual-cents-auto-whole-yuan-half-up');
 IF source_exact AND a.declaration='NOT_APPLICABLE' AND a.customer_amount IS NULL AND a.lawyer_amount IS NULL THEN
  customer_state:='PASSED'; lawyer_state:='PASSED';
 ELSIF source_exact AND a.declaration='APPLICABLE' THEN
  zero_outputs:=payment_settlement_outputs_3059(expected_inputs,a.calculation_rule_version);
  IF a.customer_amount=0 AND a.customer_source=zero_outputs->>'customerSource' AND (zero_outputs->>'customerAmount')::numeric=0 THEN required_customer:=0;customer_state:='PASSED'; END IF;
  IF a.lawyer_amount=0 AND a.lawyer_source=zero_outputs->>'lawyerSource' AND (zero_outputs->>'lawyerAmount')::numeric=0 THEN required_lawyer:=0;lawyer_state:='PASSED'; END IF;
  IF a.calculation_rule_version='settlement-calculation-v1-whole-yuan-half-up' THEN
   verified_outputs:=archive_verified_settlement_outputs(expected_inputs);
  ELSE
   verified_outputs:=archive_verified_settlement_outputs_v2(expected_inputs);
  END IF;
  -- Verify supported canonical formula outputs independently, never client values.
  -- Unsupported formula language remains UNKNOWN.
  IF verified_outputs IS NOT NULL AND a.customer_source=verified_outputs->>'customerSource' AND a.customer_amount=(verified_outputs->>'customerAmount')::numeric THEN
   required_customer:=(verified_outputs->>'customerAmount')::numeric;
   customer_state:=CASE WHEN received>=required_customer THEN 'PASSED' ELSE 'BLOCKED' END;
  END IF;
  IF verified_outputs IS NOT NULL AND a.lawyer_source=verified_outputs->>'lawyerSource' AND a.lawyer_amount=(verified_outputs->>'lawyerAmount')::numeric THEN
   required_lawyer:=(verified_outputs->>'lawyerAmount')::numeric;
   lawyer_state:=CASE WHEN invoiced>=required_lawyer THEN 'PASSED' ELSE 'BLOCKED' END;
  END IF;
 END IF;
 IF required_closure=0 THEN
  payment_state:='EXEMPT';customer_state:='EXEMPT';lawyer_state:='EXEMPT';
  overall_state:=CASE refund_state WHEN 'PASSED' THEN 'PASSED' WHEN 'BLOCKED' THEN 'BLOCKED' ELSE 'UNKNOWN' END;
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

CREATE OR REPLACE FUNCTION check_new_archive_required_financial_snapshot_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s case_archive_evidence_snapshots%ROWTYPE;
BEGIN
 IF NEW.kind IS DISTINCT FROM 'ARCHIVE' THEN RETURN NEW; END IF;
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'new archive requires serializable financial verification' USING ERRCODE='23514';
 END IF;
 SELECT * INTO s FROM case_archive_evidence_snapshots
 WHERE archive_version_id=NEW.id AND case_id=NEW.case_id AND department_id=NEW.department_id
  AND closure_version_id=NEW.closure_version_id
  AND creation_xid=pg_current_xact_id() AND xmin=pg_current_xact_id()::text::xid
 FOR SHARE;
 IF s.id IS NULL THEN
  RAISE EXCEPTION 'new archive requires same-transaction exact financial snapshot' USING ERRCODE='23514';
 END IF;
 -- Revalidate the complete immutable child sets and authoritative current heads
 -- even when this trigger runs before the snapshot's queued deferred triggers.
 PERFORM validate_archive_snapshot_readiness(s.id);
 IF s.closure_amount=0 THEN
  IF ROW(s.readiness,s.payment_readiness,s.refund_readiness,s.customer_readiness,s.lawyer_readiness)
   IS DISTINCT FROM ROW('PASSED'::varchar,'EXEMPT'::varchar,'PASSED'::varchar,'EXEMPT'::varchar,'EXEMPT'::varchar) THEN
   RAISE EXCEPTION 'known zero archive requires verified refund and exact payment/settlement exemptions' USING ERRCODE='23514';
  END IF;
 ELSIF s.closure_amount IS NULL OR s.closure_amount<0 OR
  ROW(s.readiness,s.payment_readiness,s.refund_readiness,s.customer_readiness,s.lawyer_readiness)
   IS DISTINCT FROM ROW('PASSED'::varchar,'PASSED'::varchar,'PASSED'::varchar,'PASSED'::varchar,'PASSED'::varchar) THEN
  RAISE EXCEPTION 'new archive financial verification is unknown or incomplete' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION assert_payment_financial_review_3059(p case_closure_payment_versions,a audit_events,result jsonb)
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
 refund_state:=refund_inventory_readiness_268(inv.id)->>'state';refund_reason:=refund_inventory_readiness_268(inv.id)->>'reason';
 IF v.close_amount_state='KNOWN' AND v.close_amt=0 THEN
  customer_state:='EXEMPT';lawyer_state:='EXEMPT';customer_reason:='EXPLICIT_ZERO_CLOSURE_AMOUNT';lawyer_reason:=customer_reason;
 ELSE
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
    customer_state:=CASE WHEN ass.customer_amount IS NULL THEN 'UNKNOWN' WHEN received>=ass.customer_amount THEN 'PASSED' ELSE 'BLOCKED' END;
    lawyer_state:=CASE WHEN ass.lawyer_amount IS NULL THEN 'UNKNOWN' WHEN invoiced>=ass.lawyer_amount THEN 'PASSED' ELSE 'BLOCKED' END;
    customer_reason:=CASE customer_state WHEN 'PASSED' THEN CASE WHEN ass.customer_amount=0 THEN 'CUSTOMER_REQUIRED_AMOUNT_ZERO' ELSE 'CUSTOMER_RECEIPTS_REACHED' END WHEN 'BLOCKED' THEN 'CUSTOMER_RECEIPTS_INSUFFICIENT' ELSE 'SETTLEMENT_AMOUNT_UNKNOWN' END;
    lawyer_reason:=CASE lawyer_state WHEN 'PASSED' THEN CASE WHEN ass.lawyer_amount=0 THEN 'LAWYER_REQUIRED_AMOUNT_ZERO' ELSE 'LAWYER_INVOICES_REACHED' END WHEN 'BLOCKED' THEN 'LAWYER_INVOICES_INSUFFICIENT' ELSE 'SETTLEMENT_AMOUNT_UNKNOWN' END;
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

CREATE OR REPLACE FUNCTION assert_payment_correction_3059(p case_closure_payment_versions, final_check boolean)
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
   (v.close_amt>0 AND (SELECT coalesce(sum(value::numeric),0) FROM jsonb_array_elements_text(amounts))<v.close_amt)
     OR r.result_snapshot#>>'{review,financialReadiness}' IS DISTINCT FROM 'PASSED');
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

CREATE OR REPLACE VIEW case_refund_inventory_readiness_draft AS
SELECT v.id AS inventory_version_id,v.case_id,v.department_id,v.revision,refund_inventory_readiness_268(v.id)->>'state' AS readiness
FROM case_refund_inventory_versions v WHERE NOT EXISTS(SELECT 1 FROM case_refund_inventory_versions next WHERE next.prior_version_id=v.id);
COMMIT;
