-- Deferred case checks call every normal terminal predicate, including for
-- external-entry cases. Their SQL bodies all require an INNER JOIN to leads.
-- Keep each original predicate intact and skip its expensive plan only when
-- the case has no source lead, which makes that join impossible.
BEGIN;
DO $migration$
DECLARE spec record; predecessor record; original_name text;
BEGIN
 FOR spec IN SELECT * FROM (VALUES
  ('normal_pending_early_terminal','3442456a862912db77e631765aa4b208563f5b378d2768118e903279501a0479'),
  ('normal_prejudgment_early_terminal','1db52687908350cdb7e1c584845b08a8937718f70957df3c216a02f8e14d3ba1'),
  ('normal_initial_appeal_early_terminal','8238a04404a9b90d3fa28d75d51d98f2b235d6f80ae4882914023100240630f4'),
  ('normal_initial_execution_early_terminal','bd2d5b048816c712c7a6d9a8916277520bc25368b2da3ffa0b9106d697b80c53')
 ) AS expected(name,body_sha256) LOOP
  SELECT p.*,l.lanname INTO predecessor
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_language l ON l.oid=p.prolang
   WHERE n.nspname='public' AND p.proname=spec.name
    AND pg_get_function_identity_arguments(p.oid)='target_case uuid, target_department uuid';
  original_name:=spec.name||'_original_sql';
  IF predecessor.oid IS NULL OR predecessor.lanname<>'sql'
   OR predecessor.provolatile<>'s' OR predecessor.proisstrict
   OR predecessor.prosecdef OR predecessor.proparallel<>'u'
   OR predecessor.proconfig IS NOT NULL
   OR encode(sha256(convert_to(replace(predecessor.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>spec.body_sha256
   OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=original_name)
  THEN RAISE EXCEPTION 'unexpected normal early terminal predecessor %',spec.name USING ERRCODE='23514';
  END IF;
  EXECUTE format(
   'CREATE FUNCTION public.%I(target_case uuid,target_department uuid) RETURNS boolean LANGUAGE sql STABLE AS %L',
   original_name,predecessor.prosrc
  );
  EXECUTE format(
   'CREATE OR REPLACE FUNCTION public.%I(target_case uuid,target_department uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS %L',
   spec.name,format($body$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM public.cases c
   WHERE c.id=target_case AND c.department_id=target_department
    AND c.source_lead_id IS NOT NULL
 ) THEN RETURN false; END IF;
 RETURN public.%I(target_case,target_department);
END;
$body$,original_name)
  );
 END LOOP;
END;
$migration$;
COMMIT;
