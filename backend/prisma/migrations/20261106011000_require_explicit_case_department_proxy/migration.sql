BEGIN;
DO $guard$ DECLARE p record;
BEGIN
 SELECT f.*,l.lanname INTO p FROM pg_proc f
 JOIN pg_namespace n ON n.oid=f.pronamespace
 JOIN pg_language l ON l.oid=f.prolang
 WHERE n.nspname='public' AND f.proname='case_department_proxy_action_authorized'
  AND pg_get_function_identity_arguments(f.oid)=
   'target_actor uuid, target_case uuid, target_department uuid, target_action permission_action';
 IF p.oid IS NULL OR p.lanname<>'plpgsql' OR p.provolatile<>'s'
  OR p.prosecdef OR p.proconfig IS NOT NULL
  OR encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')
   <> '74778952877ef86ecc40262609d51fde8899b68e42eb848499b9b920ffde91b3'
 THEN RAISE EXCEPTION 'unexpected department proxy authorization predecessor' USING ERRCODE='23514'; END IF;
END; $guard$;

CREATE OR REPLACE FUNCTION public.case_department_proxy_action_authorized(
 target_actor uuid,target_case uuid,target_department uuid,target_action permission_action
) RETURNS boolean LANGUAGE plpgsql STABLE AS $proxy$
BEGIN
 RETURN target_action IN ('case.routine.edit','case.closure.settlement.update','case.closure.record','case.archive')
  AND EXISTS (
   SELECT 1 FROM public.cases c
   JOIN public.user_accounts u ON u.id=target_actor AND u.active AND u.account_type='INTERNAL'
   JOIN public.department_memberships m ON m.user_id=u.id AND m.department_id=c.department_id AND m.active
   JOIN public.role_assignments r ON r.user_id=u.id AND r.department_id=c.department_id AND r.active
   JOIN public.role_templates t ON t.id=r.role_template_id AND t.department_id=r.department_id AND t.active
   JOIN public.role_grants g ON g.role_template_id=t.id AND g.action=target_action AND g.scope='DEPARTMENT'
   WHERE c.id=target_case AND c.department_id=target_department
  )
  AND EXISTS (
   SELECT 1 FROM public.cases c
   JOIN public.user_accounts u ON u.id=target_actor AND u.active AND u.account_type='INTERNAL'
   JOIN public.department_memberships m ON m.user_id=u.id AND m.department_id=c.department_id AND m.active
   JOIN public.role_assignments r ON r.user_id=u.id AND r.department_id=c.department_id AND r.active
   JOIN public.role_templates t ON t.id=r.role_template_id AND t.department_id=r.department_id AND t.active
   JOIN public.role_grants g ON g.role_template_id=t.id AND g.action='case.department.proxy' AND g.scope='DEPARTMENT'
   WHERE c.id=target_case AND c.department_id=target_department
  );
END;
$proxy$;
COMMIT;
