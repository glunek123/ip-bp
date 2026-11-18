-- 结案可从强制执行中发起（并推进到待归档）。
BEGIN;
CREATE OR REPLACE FUNCTION public.check_case_closure_actor()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE c record;
BEGIN
 SELECT * INTO c FROM cases WHERE id=NEW.case_id AND department_id=NEW.department_id FOR UPDATE;
 IF c.id IS NULL OR c.stage NOT IN ('WAITING_ARCHIVE','EXECUTING') OR c.version<>NEW.from_version
  OR NEW.close_at>(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date THEN
  RAISE EXCEPTION 'closure actor forbidden' USING ERRCODE='23514';
 END IF;
 IF public.case_early_closure_initial_version_authorized(NEW,false) IS TRUE THEN RETURN NEW; END IF;
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
END; $function$;
COMMIT;
