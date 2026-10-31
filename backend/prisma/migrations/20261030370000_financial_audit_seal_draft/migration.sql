-- Unexecuted additive draft. No history rewrite, grants or write-gate changes.
BEGIN;
-- Resource names alone do not establish a fact. Check the immutable source's
-- audit FK, complete resource identity and same-case department association.
-- Do not depend on current heads/stages: superseded versions remain history.
CREATE FUNCTION is_case_financial_source_audit_draft(a audit_events)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM case_early_closures e
  JOIN cases c ON c.id=e.case_id AND c.department_id=e.department_id
  WHERE e.audit_event_id=a.id AND a.department_id=e.department_id
   AND a.resource_type='CASE' AND a.resource_id=e.case_id
   AND a.action='case.early_closed'
 ) OR EXISTS (
  SELECT 1 FROM case_closure_payment_versions p
  JOIN case_closure_versions v ON v.id=p.closure_version_id
   AND v.case_id=p.case_id AND v.department_id=p.department_id
  JOIN cases c ON c.id=p.case_id AND c.department_id=p.department_id
  WHERE p.audit_event_id=a.id AND a.department_id=p.department_id
   AND a.resource_type='CASE_CLOSURE_PAYMENT_VERSION' AND a.resource_id=p.id
   AND a.action=CASE WHEN p.revision=1 THEN 'CASE_CLOSURE_PAYMENT_RECORD'
    WHEN p.state='VOID' THEN 'CASE_CLOSURE_PAYMENT_VOID' ELSE 'CASE_CLOSURE_PAYMENT_CORRECT' END
 ) OR EXISTS (
  SELECT 1 FROM case_refund_inventory_versions i
  JOIN cases c ON c.id=i.case_id AND c.department_id=i.department_id
  LEFT JOIN case_refund_inventory_versions prior ON prior.id=i.prior_version_id
   AND prior.case_id=i.case_id AND prior.department_id=i.department_id
  WHERE i.audit_event_id=a.id AND a.department_id=i.department_id
   AND a.resource_type='CASE_REFUND_INVENTORY_VERSION' AND a.resource_id=i.id
   AND a.action=CASE WHEN i.declaration='UNKNOWN'
    OR (i.declaration='COMPLETE' AND prior.declaration='COMPLETE')
    THEN 'CASE_REFUND_INVENTORY_RECORD' ELSE 'CASE_REFUND_INVENTORY_CONFIRM' END
 ) OR EXISTS (
  SELECT 1 FROM case_closure_settlement_update_receipts r
  JOIN case_closure_versions v ON v.id=r.closure_version_id
   AND v.case_id=r.case_id AND v.department_id=r.department_id
   AND v.audit_event_id=r.closure_audit_event_id
  JOIN cases c ON c.id=r.case_id AND c.department_id=r.department_id
  WHERE r.audit_event_id=a.id AND a.department_id=r.department_id
   AND a.resource_type='CASE_CLOSURE_SETTLEMENT_UPDATE' AND a.resource_id=r.id
   AND a.action='CASE_CLOSURE_SETTLEMENT_UPDATED'
 );
$$;

CREATE FUNCTION reject_case_financial_source_audit_mutation_draft()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF is_case_financial_source_audit_draft(OLD) THEN
  RAISE EXCEPTION 'linked financial source audit is immutable' USING ERRCODE='23514';
 END IF;
 -- Never let an UPDATE manufacture a protected audit from ordinary history.
 -- Separate branch avoids accessing NEW during DELETE. INSERT ordering is
 -- unchanged: commands create audit first, then immutable facts and receipts.
 IF TG_OP='UPDATE' THEN
  IF is_case_financial_source_audit_draft(NEW) THEN
   RAISE EXCEPTION 'ordinary audit cannot become linked financial source audit' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 RETURN OLD;
END;
$$;
CREATE TRIGGER case_financial_source_audit_seal_draft
 BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW
 EXECUTE FUNCTION reject_case_financial_source_audit_mutation_draft();
COMMIT;
