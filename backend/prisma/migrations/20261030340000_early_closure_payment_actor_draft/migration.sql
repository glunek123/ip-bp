-- Forward draft only. No gate is removed or existing actor function replaced.
-- The real adapter moves to WAITING_ARCHIVE and sets the head before payments.
-- Keep 2400 for ordinary pending/archive payments; add exact initial-source binding.
BEGIN;
CREATE FUNCTION check_early_closure_initial_payment_actor_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v record; e record; c cases; source_case cases; waiting_case cases; final_case cases;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'payment history is immutable' USING ERRCODE='23514'; END IF;
 SELECT *,xmin AS creation_xmin INTO v FROM case_closure_versions WHERE id=NEW.closure_version_id
  AND case_id=NEW.case_id AND department_id=NEW.department_id;
 -- Later independent payments keep the unchanged 2400 authorization branch.
 IF v.id IS NULL OR v.early_closure_id IS NULL OR v.kind<>'REGISTER'
  OR v.creation_xmin IS DISTINCT FROM pg_current_xact_id()::text::xid THEN RETURN NEW; END IF;
 PERFORM assert_case_financial_actor_draft(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id,
  NEW.audit_event_id,NEW.id,'CASE_CLOSURE_PAYMENT_VERSION','CASE_CLOSURE_PAYMENT_RECORD',ARRAY['WAITING_ARCHIVE']);
 SELECT * INTO c FROM cases WHERE id=NEW.case_id AND department_id=NEW.department_id FOR UPDATE;
 SELECT *,xmin AS creation_xmin INTO e FROM case_early_closures WHERE id=v.early_closure_id
  AND case_id=NEW.case_id AND department_id=NEW.department_id;
 IF e.id IS NULL OR e.creation_xmin IS DISTINCT FROM pg_current_xact_id()::text::xid
  OR NEW.revision<>1 OR NEW.state<>'ACTIVE' OR NEW.prior_version_id IS NOT NULL
  OR NEW.recorded_by_user_id IS DISTINCT FROM e.recorded_by_user_id
  OR v.recorded_by_user_id IS DISTINCT FROM e.recorded_by_user_id
  OR v.from_version IS DISTINCT FROM e.to_version OR v.to_version IS DISTINCT FROM e.to_version+1
  OR c.stage<>'WAITING_ARCHIVE' OR c.version IS DISTINCT FROM v.to_version
  OR case_record_edit_actor_authorized(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id,'case.closure.record') IS NOT TRUE
  OR NOT EXISTS (SELECT 1 FROM case_closures h WHERE h.id=v.closure_id AND h.case_id=NEW.case_id
    AND h.department_id=NEW.department_id AND h.early_closure_id=e.id AND h.current_version_id=v.id
    AND h.xmin=pg_current_xact_id()::text::xid)
  OR NOT EXISTS (SELECT 1 FROM audit_events a WHERE a.id=NEW.audit_event_id AND a.xmin=pg_current_xact_id()::text::xid)
 THEN RAISE EXCEPTION 'initial payment requires exact early closure actor and transaction' USING ERRCODE='23514'; END IF;
 IF TG_WHEN='AFTER' THEN
  source_case:=c; source_case.stage:=e.from_stage; source_case.version:=e.from_version;
  waiting_case:=c; waiting_case.version:=e.to_version;
  final_case:=c;
  -- Existing predicates preserve the allowed source stages and exact source/
  -- closure audits, receipts, fingerprints, versions and historical branches.
  IF case_early_closure_transition(source_case,waiting_case) IS NOT TRUE
   OR case_early_closure_register_transition(waiting_case,final_case) IS NOT TRUE
   OR NOT EXISTS (SELECT 1 FROM case_closure_payment_receipts r JOIN case_early_closure_receipts er
     ON er.early_closure_id=e.id AND er.case_id=NEW.case_id AND er.department_id=NEW.department_id
     AND er.actor_user_id=NEW.recorded_by_user_id
     WHERE r.payment_version_id=NEW.id AND r.case_id=NEW.case_id AND r.department_id=NEW.department_id
      AND r.actor_user_id=NEW.recorded_by_user_id AND r.audit_event_id=NEW.audit_event_id
      AND r.request_fingerprint=er.request_fingerprint
      AND r.xmin=pg_current_xact_id()::text::xid AND er.xmin=pg_current_xact_id()::text::xid)
  THEN RAISE EXCEPTION 'initial payment requires complete atomic early closure receipts' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER early_closure_initial_payment_actor_draft BEFORE INSERT ON case_closure_payment_versions
 FOR EACH ROW EXECUTE FUNCTION check_early_closure_initial_payment_actor_draft();
CREATE CONSTRAINT TRIGGER early_closure_initial_payment_actor_final_draft AFTER INSERT ON case_closure_payment_versions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_early_closure_initial_payment_actor_draft();
COMMIT;
