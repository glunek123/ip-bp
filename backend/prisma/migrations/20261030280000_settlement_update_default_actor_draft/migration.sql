-- Forward draft. No write gate is removed and no role/account is modified.
BEGIN;
CREATE OR REPLACE FUNCTION check_case_closure_actor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record;
BEGIN
 SELECT * INTO c FROM cases WHERE id=NEW.case_id AND department_id=NEW.department_id FOR UPDATE;
 IF c.id IS NULL OR c.stage<>'WAITING_ARCHIVE' OR c.version<>NEW.from_version
  OR NEW.close_at>(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date THEN
  RAISE EXCEPTION 'closure actor forbidden' USING ERRCODE='23514';
 END IF;
 IF case_closure_actor_authorized(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id,NEW.kind='CORRECT') THEN
  RETURN NEW;
 END IF;
 IF NEW.kind<>'CORRECT' THEN
  RAISE EXCEPTION 'closure actor forbidden' USING ERRCODE='23514';
 END IF;
 -- Only provisional admission. The deferred trigger below requires the exact
 -- composed receipt before commit; ordinary correction/upload grants stay intact.
 PERFORM assert_case_financial_actor_draft(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id,
  NEW.audit_event_id,NEW.case_id,'CASE','case.closure.corrected',ARRAY['WAITING_ARCHIVE']);
 IF EXISTS(SELECT 1 FROM case_consolidation_members WHERE case_id=NEW.case_id AND NOT is_main) THEN
  RAISE EXCEPTION 'settlement update requires main case' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION check_settlement_update_default_actor_final_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF case_closure_actor_authorized(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id,NEW.kind='CORRECT') THEN
  RETURN NEW;
 END IF;
 PERFORM assert_case_financial_actor_draft(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id,
  NEW.audit_event_id,NEW.case_id,'CASE','case.closure.corrected',ARRAY['WAITING_ARCHIVE']);
 IF NEW.kind<>'CORRECT' OR NOT EXISTS (
  SELECT 1 FROM case_closure_settlement_update_receipts r
  WHERE r.closure_version_id=NEW.id AND r.closure_audit_event_id=NEW.audit_event_id
   AND r.case_id=NEW.case_id AND r.department_id=NEW.department_id
   AND r.actor_user_id=NEW.recorded_by_user_id
   AND r.xmin=pg_current_xact_id()::text::xid
 ) THEN
  RAISE EXCEPTION 'default closure actor requires atomic settlement update receipt' USING ERRCODE='23514';
 END IF;
 -- Existing receipt final guard (2700) independently checks all child facts,
 -- exact same-transaction closure/audit, version chain and amount provenance.
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER settlement_update_default_actor_final_draft
 AFTER INSERT ON case_closure_versions DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION check_settlement_update_default_actor_final_draft();
COMMIT;
