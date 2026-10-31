-- Eligibility preparation only. 0600 still rejects every proof upload.
BEGIN;
CREATE FUNCTION case_payment_proof_upload_eligible(target_actor uuid,target_case uuid,target_department uuid)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE c cases%ROWTYPE; h case_closures%ROWTYPE;
BEGIN
 SELECT * INTO c FROM cases WHERE id=target_case AND department_id=target_department;
 IF c.id IS NULL OR c.responsible_user_id IS DISTINCT FROM target_actor OR NOT EXISTS (
  SELECT 1 FROM user_accounts u JOIN department_memberships m ON m.user_id=u.id
  WHERE u.id=target_actor AND u.active AND u.account_type='INTERNAL' AND m.active AND m.department_id=target_department
 ) OR case_record_edit_actor_authorized(target_actor,target_case,target_department,'case.read') IS NOT TRUE THEN RETURN false; END IF;
 IF case_early_closure_upload_authorized(target_actor,target_case,target_department) IS TRUE THEN RETURN true; END IF;
 IF c.stage NOT IN ('WAITING_ARCHIVE','ARCHIVED') THEN RETURN false; END IF;
 SELECT * INTO h FROM case_closures WHERE case_id=c.id AND department_id=c.department_id;
 IF h.id IS NULL OR h.current_version_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM case_closure_versions v WHERE v.id=h.current_version_id AND v.closure_id=h.id
   AND v.case_id=c.id AND v.department_id=c.department_id
 ) THEN RETURN false; END IF;
 IF c.stage='ARCHIVED' AND NOT EXISTS (
  SELECT 1 FROM case_archives a WHERE a.case_id=c.id AND a.department_id=c.department_id
   AND a.closure_id=h.id AND a.closure_version_id=h.current_version_id AND a.current_version_id IS NOT NULL
 ) THEN RETURN false; END IF;
 -- Own-case internal handling uses the existing case.read operational grant.
 -- This is file eligibility only: payment correction still needs its locked command authorization.
 RETURN true;
END; $$;
COMMIT;
