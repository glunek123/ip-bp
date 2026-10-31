-- Unexecuted internal composition binding; all writes remain blocked.
BEGIN;
CREATE TABLE case_settlement_update_child_links (
 kind varchar(16) NOT NULL CHECK(kind IN ('REFUND','ASSESSMENT')), child_version_id uuid NOT NULL, PRIMARY KEY(kind,child_version_id),
 case_id uuid NOT NULL, department_id uuid NOT NULL, actor_user_id uuid NOT NULL,
 parent_key varchar(128) NOT NULL, request_fingerprint char(64) NOT NULL CHECK(request_fingerprint ~ '^[0-9a-f]{64}$'),
 FOREIGN KEY(case_id,department_id) REFERENCES cases(id,department_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE FUNCTION check_refund_composition_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'refund composition links are immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS (
 SELECT 1 FROM (
 SELECT 'REFUND' AS kind, inventory_version_id AS child_version_id,case_id,department_id,actor_user_id,request_fingerprint,idempotency_key,xmin AS creation_xmin FROM case_refund_inventory_receipts
 UNION ALL SELECT 'ASSESSMENT',assessment_version_id,case_id,department_id,actor_user_id,request_fingerprint,idempotency_key,xmin FROM case_settlement_assessment_receipts
 ) child JOIN case_closure_settlement_update_receipts parent ON ((child.kind='REFUND' AND parent.refund_included AND parent.refund_version_id=child.child_version_id) OR (child.kind='ASSESSMENT' AND parent.assessment_included AND parent.assessment_version_id=child.child_version_id))
 JOIN audit_events a ON a.id=parent.audit_event_id
 WHERE child.child_version_id=NEW.child_version_id AND child.kind=NEW.kind AND child.case_id=NEW.case_id
 AND child.department_id=NEW.department_id AND child.actor_user_id=NEW.actor_user_id
 AND child.request_fingerprint=NEW.request_fingerprint
 AND child.creation_xmin=pg_current_xact_id()::text::xid
 AND child.idempotency_key=(CASE NEW.kind WHEN 'REFUND' THEN 'refund:' ELSE 'assessment:' END)||encode(sha256(convert_to(NEW.parent_key,'UTF8')),'hex')
 AND parent.case_id=NEW.case_id AND parent.department_id=NEW.department_id AND parent.actor_user_id=NEW.actor_user_id
 AND parent.idempotency_key=NEW.parent_key AND parent.request_fingerprint=NEW.request_fingerprint
 AND parent.xmin=pg_current_xact_id()::text::xid AND a.department_id=NEW.department_id
 AND a.actor_kind='HUMAN' AND a.actor_user_id=NEW.actor_user_id AND a.internal_actor_user_id=NEW.actor_user_id
 AND a.resource_type='CASE_CLOSURE_SETTLEMENT_UPDATE' AND a.resource_id=parent.id
 AND a.action='CASE_CLOSURE_SETTLEMENT_UPDATED' AND a.details=jsonb_build_object('requestFingerprint',NEW.request_fingerprint,'result',parent.result_snapshot)
 ) THEN RAISE EXCEPTION 'composed refund requires exact same-transaction parent receipt and audit' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER refund_composition_parent_final AFTER INSERT OR UPDATE OR DELETE ON case_settlement_update_child_links DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_refund_composition_parent();
CREATE TRIGGER refund_composition_draft_gate BEFORE INSERT OR UPDATE OR DELETE ON case_settlement_update_child_links FOR EACH ROW EXECUTE FUNCTION guard_case_refund_inventory_draft();
COMMIT;
