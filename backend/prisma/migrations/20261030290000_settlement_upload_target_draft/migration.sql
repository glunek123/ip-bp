-- Internal provenance only. All existing upload/command gates remain unchanged.
BEGIN;
CREATE TABLE case_settlement_upload_targets (
 id uuid PRIMARY KEY, upload_draft_id uuid NOT NULL UNIQUE, case_id uuid NOT NULL, department_id uuid NOT NULL,
 actor_user_id uuid NOT NULL, authorization_revision integer NOT NULL CHECK(authorization_revision>=0), expected_closure_version_id uuid NOT NULL,
 purpose varchar(100) NOT NULL CHECK(purpose='CLOSURE_SETTLEMENT_UPDATE_DOCUMENT'),
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(id,upload_draft_id,department_id,actor_user_id,case_id),
 FOREIGN KEY(case_id,department_id) REFERENCES cases(id,department_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(actor_user_id,department_id) REFERENCES department_memberships(user_id,department_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(expected_closure_version_id,case_id,department_id) REFERENCES case_closure_versions(id,case_id,department_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(upload_draft_id) REFERENCES upload_drafts(id) ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE upload_drafts ADD COLUMN settlement_update_upload_target_id uuid;
ALTER TABLE upload_drafts ADD CONSTRAINT settlement_update_upload_target_identity_fk
 FOREIGN KEY(settlement_update_upload_target_id,id,department_id,actor_user_id,owner_id)
 REFERENCES case_settlement_upload_targets(id,upload_draft_id,department_id,actor_user_id,case_id)
 ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE FUNCTION settlement_update_document_upload_eligible(target_actor uuid,target_case uuid,target_department uuid,target_closure uuid,target_revision integer)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE c record; h record; e record; f record; source_version integer;
BEGIN
 SELECT * INTO c FROM cases WHERE id=target_case AND department_id=target_department;
 SELECT * INTO h FROM case_closures WHERE case_id=target_case AND department_id=target_department;
 IF c.id IS NULL OR c.stage<>'WAITING_ARCHIVE' OR c.responsible_user_id IS DISTINCT FROM target_actor
  OR h.id IS NULL OR h.current_version_id IS DISTINCT FROM target_closure
  OR NOT EXISTS(SELECT 1 FROM user_accounts u JOIN department_memberships m ON m.user_id=u.id
   WHERE u.id=target_actor AND u.active AND u.account_type='INTERNAL' AND u.authorization_revision=target_revision AND m.active AND m.department_id=target_department)
  OR NOT EXISTS(SELECT 1 FROM role_assignments r JOIN role_templates template ON template.id=r.role_template_id AND template.department_id=r.department_id AND template.active
   JOIN role_grants g ON g.role_template_id=template.id AND g.action='case.read'
   JOIN department_memberships membership ON membership.user_id=r.user_id AND membership.department_id=r.department_id AND membership.active
   WHERE r.user_id=target_actor AND r.department_id=target_department AND r.active
    AND (g.scope IN ('SELF','DEPARTMENT') OR (g.scope='TEAM' AND r.team_id=membership.team_id AND EXISTS(
     SELECT 1 FROM teams team WHERE team.id=r.team_id AND team.department_id=target_department AND team.status='ACTIVE'))))
  OR case_record_edit_actor_authorized(target_actor,target_case,target_department,'case.read') IS NOT TRUE THEN RETURN false; END IF;
 IF h.early_closure_id IS NOT NULL THEN
  SELECT * INTO e FROM case_early_closures WHERE id=h.early_closure_id AND case_id=target_case AND department_id=target_department;
  IF e.id IS NULL OR h.finish_id IS NOT NULL OR h.external_entry_id IS NOT NULL THEN RETURN false; END IF;
  source_version:=e.to_version;
 ELSIF h.finish_id IS NOT NULL THEN
  SELECT * INTO f FROM case_execution_finishes WHERE id=h.finish_id AND case_id=target_case AND department_id=target_department;
  IF f.id IS NULL THEN RETURN false; END IF; source_version:=f.to_version;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM case_external_entries root WHERE root.id=h.external_entry_id AND root.case_id=target_case
   AND root.department_id=target_department AND root.initial_stage='WAITING_ARCHIVE') OR
   c.source_lead_id IS NOT NULL OR c.source_notary_matter_id IS NOT NULL OR c.certificate_id IS NOT NULL THEN RETURN false; END IF;
  source_version:=1;
 END IF;
 RETURN case_closure_source_terminal_version(target_case,target_department,h.finish_id,source_version)=c.version;
END; $$;
CREATE FUNCTION lock_settlement_upload_actor_current(target_actor uuid,target_department uuid,target_case uuid,target_revision integer)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE role_id uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'settlement upload authorization requires serializable scope' USING ERRCODE='23514'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('organization:'||target_department::text,0)) THEN
  RAISE EXCEPTION 'settlement upload authorization facts busy' USING ERRCODE='55P03'; END IF;
 PERFORM id FROM user_accounts WHERE id=target_actor FOR SHARE NOWAIT;
 PERFORM user_id FROM department_memberships WHERE user_id=target_actor AND department_id=target_department FOR SHARE NOWAIT;
 PERFORM id FROM role_assignments WHERE user_id=target_actor AND department_id=target_department ORDER BY id FOR SHARE NOWAIT;
 FOR role_id IN SELECT DISTINCT role_template_id FROM role_assignments WHERE user_id=target_actor AND department_id=target_department ORDER BY role_template_id LOOP
  PERFORM id FROM role_templates WHERE id=role_id FOR SHARE NOWAIT;
  PERFORM id FROM role_grants WHERE role_template_id=role_id ORDER BY id FOR SHARE NOWAIT;
 END LOOP;
 PERFORM team.id FROM teams team WHERE team.id IN(SELECT team_id FROM department_memberships WHERE user_id=target_actor AND department_id=target_department
  UNION SELECT team_id FROM role_assignments WHERE user_id=target_actor AND department_id=target_department) ORDER BY team.id FOR SHARE NOWAIT;
 PERFORM id FROM cases WHERE id=target_case AND department_id=target_department FOR UPDATE NOWAIT;
 IF NOT EXISTS(SELECT 1 FROM user_accounts u JOIN department_memberships m ON m.user_id=u.id WHERE u.id=target_actor
  AND u.active AND u.account_type='INTERNAL' AND u.authorization_revision=target_revision AND m.department_id=target_department AND m.active)
  OR NOT EXISTS(SELECT 1 FROM role_assignments r JOIN role_templates template ON template.id=r.role_template_id AND template.department_id=r.department_id AND template.active
   JOIN role_grants g ON g.role_template_id=template.id AND g.action='case.read'
   JOIN department_memberships member ON member.user_id=r.user_id AND member.department_id=r.department_id AND member.active
   WHERE r.user_id=target_actor AND r.department_id=target_department AND r.active
   AND (g.scope IN ('SELF','DEPARTMENT') OR (g.scope='TEAM' AND r.team_id=member.team_id AND EXISTS(
    SELECT 1 FROM teams team WHERE team.id=r.team_id AND team.department_id=target_department AND team.status='ACTIVE')))) THEN
  RAISE EXCEPTION 'settlement upload actor stale or inactive' USING ERRCODE='23514'; END IF;
END; $$;
CREATE FUNCTION check_settlement_upload_target_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM lock_settlement_upload_actor_current(NEW.actor_user_id,NEW.department_id,NEW.case_id,NEW.authorization_revision);
 IF settlement_update_document_upload_eligible(NEW.actor_user_id,NEW.case_id,NEW.department_id,NEW.expected_closure_version_id,NEW.authorization_revision) IS NOT TRUE THEN
  RAISE EXCEPTION 'settlement upload target current case source or actor forbidden' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER settlement_upload_target_source_guard BEFORE INSERT ON case_settlement_upload_targets FOR EACH ROW EXECUTE FUNCTION check_settlement_upload_target_source();
CREATE FUNCTION guard_settlement_upload_target_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'settlement document upload targets remain draft and immutable' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER settlement_upload_target_draft_gate BEFORE INSERT OR UPDATE OR DELETE ON case_settlement_upload_targets FOR EACH ROW EXECUTE FUNCTION guard_settlement_upload_target_draft();
CREATE FUNCTION reject_settlement_upload_target_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable settlement upload target' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER settlement_upload_target_immutable BEFORE UPDATE OR DELETE ON case_settlement_upload_targets FOR EACH ROW EXECUTE FUNCTION reject_settlement_upload_target_mutation();
CREATE FUNCTION check_settlement_upload_target_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.settlement_update_upload_target_id IS NULL THEN
  IF TG_OP='UPDATE' AND OLD.settlement_update_upload_target_id IS NOT NULL THEN
   RAISE EXCEPTION 'settlement upload target cannot be removed' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND NEW.settlement_update_upload_target_id IS DISTINCT FROM OLD.settlement_update_upload_target_id THEN
  RAISE EXCEPTION 'settlement upload target cannot be retargeted' USING ERRCODE='23514'; END IF;
 IF NEW.owner_type<>'CASE' OR NEW.category<>'CASE_CLOSURE_DOCUMENT' OR NEW.purpose<>'CASE_CLOSURE_DOCUMENT'
  OR NEW.customer_account_binding_id IS NOT NULL OR NEW.lawyer_account_binding_id IS NOT NULL OR NEW.notary_office_account_binding_id IS NOT NULL THEN
  RAISE EXCEPTION 'settlement upload target category or actor invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER settlement_upload_target_identity_guard BEFORE INSERT OR UPDATE ON upload_drafts FOR EACH ROW EXECUTE FUNCTION check_settlement_upload_target_identity();
CREATE FUNCTION check_settlement_upload_target_reverse_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM upload_drafts d WHERE d.id=NEW.upload_draft_id AND d.settlement_update_upload_target_id=NEW.id
  AND d.department_id=NEW.department_id AND d.actor_user_id=NEW.actor_user_id AND d.owner_id=NEW.case_id
  AND d.owner_type='CASE' AND d.category='CASE_CLOSURE_DOCUMENT' AND d.purpose='CASE_CLOSURE_DOCUMENT') THEN
  RAISE EXCEPTION 'settlement upload target missing exact reverse draft binding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER settlement_upload_target_reverse_final AFTER INSERT ON case_settlement_upload_targets
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_settlement_upload_target_reverse_final();
COMMIT;
