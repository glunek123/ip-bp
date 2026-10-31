-- Closed draft: adds an independent authorization guard; existing gates remain closed.
-- Source facts do not carry an authorization revision. This checks current locked
-- authorization, but cannot attest to the revision presented by the client.
BEGIN;
CREATE FUNCTION guard_early_closure_actor_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u user_accounts%ROWTYPE; member department_memberships%ROWTYPE; c cases%ROWTYPE; role_id uuid;
BEGIN
 IF current_setting('transaction_isolation') <> 'serializable' THEN
  RAISE EXCEPTION 'early closure authorization requires serializable transaction' USING ERRCODE='23514';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('organization:'||NEW.department_id::text,0)) THEN
  RAISE EXCEPTION 'early closure authorization facts busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO u FROM user_accounts WHERE id=NEW.recorded_by_user_id FOR SHARE NOWAIT;
 SELECT * INTO member FROM department_memberships WHERE user_id=NEW.recorded_by_user_id
  AND department_id=NEW.department_id FOR SHARE NOWAIT;
 PERFORM id FROM role_assignments WHERE user_id=NEW.recorded_by_user_id AND department_id=NEW.department_id ORDER BY id FOR SHARE NOWAIT;
 FOR role_id IN SELECT DISTINCT role_template_id FROM role_assignments
  WHERE user_id=NEW.recorded_by_user_id AND department_id=NEW.department_id ORDER BY role_template_id LOOP
  PERFORM id FROM role_templates WHERE id=role_id FOR SHARE NOWAIT;
  PERFORM id FROM role_grants WHERE role_template_id=role_id ORDER BY id FOR SHARE NOWAIT;
 END LOOP;
 PERFORM t.id FROM teams t WHERE t.id=member.team_id OR t.id IN
  (SELECT team_id FROM role_assignments WHERE user_id=NEW.recorded_by_user_id AND department_id=NEW.department_id)
  ORDER BY t.id FOR SHARE NOWAIT;
 SELECT * INTO c FROM cases WHERE id=NEW.case_id AND department_id=NEW.department_id FOR UPDATE NOWAIT;
 IF u.id IS NULL OR u.active IS NOT TRUE OR u.account_type <> 'INTERNAL'
  OR member.user_id IS NULL OR member.active IS NOT TRUE
  OR c.id IS NULL OR c.responsible_user_id IS DISTINCT FROM NEW.recorded_by_user_id
  OR case_record_edit_actor_authorized(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id,'case.read') IS NOT TRUE
  OR case_record_edit_actor_authorized(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id,'case.closure.record') IS NOT TRUE
  OR EXISTS (SELECT 1 FROM (VALUES ('case.read'::permission_action),('case.closure.record'::permission_action)) required(action)
   WHERE NOT EXISTS (SELECT 1 FROM role_assignments r JOIN role_templates t ON t.id=r.role_template_id
    AND t.department_id=r.department_id AND t.active JOIN role_grants g ON g.role_template_id=t.id AND g.action=required.action
    WHERE r.user_id=NEW.recorded_by_user_id AND r.department_id=NEW.department_id AND r.active
     AND (g.scope IN ('DEPARTMENT','SELF') OR (g.scope='TEAM' AND r.team_id=member.team_id
      AND EXISTS (SELECT 1 FROM teams team WHERE team.id=r.team_id AND team.department_id=NEW.department_id AND team.status='ACTIVE')))))
 THEN RAISE EXCEPTION 'early closure actor unauthorized' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER early_closure_actor_draft_guard BEFORE INSERT ON case_early_closures
 FOR EACH ROW EXECUTE FUNCTION guard_early_closure_actor_draft();
COMMIT;
