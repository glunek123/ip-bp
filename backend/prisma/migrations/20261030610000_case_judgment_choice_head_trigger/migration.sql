-- Candidate only. Add one watched column; no function or fact path is changed.
BEGIN;
DO $verify$ BEGIN
 IF current_schema() IS DISTINCT FROM 'public' OR NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
  WHERE n.nspname='public' AND p.proname='check_case_judgment_final' AND p.pronargs=0 AND p.prokind='f'
   AND l.lanname='plpgsql' AND p.prorettype='trigger'::regtype AND p.provolatile='v' AND p.proparallel='u'
   AND NOT p.prosecdef AND p.proconfig IS NULL
   AND encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')='4256eb4a6e02b451b6c34d974012fffede83b868e52a9626e519b0771d919d58'
 ) THEN RAISE EXCEPTION 'unexpected judgment head validator baseline' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS (
  SELECT 1 FROM pg_trigger t WHERE t.tgrelid='public.cases'::regclass AND t.tgname='case_judgment_case_guard'
   AND t.tgfoid='public.check_case_judgment_final()'::regprocedure AND t.tgtype=17 AND t.tgenabled='O'
   AND t.tgconstraint<>0 AND t.tgdeferrable AND t.tginitdeferred AND t.tgqual IS NULL
   AND octet_length(t.tgargs)=0 AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
   AND (SELECT array_agg(a.attname::text ORDER BY u.ord) FROM unnest(t.tgattr::smallint[]) WITH ORDINALITY u(attnum,ord)
    JOIN pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=u.attnum)=ARRAY['stage','version','current_judgment_id']::text[]
 ) THEN RAISE EXCEPTION 'unexpected judgment case trigger baseline' USING ERRCODE='23514'; END IF;
END; $verify$;
DROP TRIGGER case_judgment_case_guard ON public.cases;
CREATE CONSTRAINT TRIGGER case_judgment_case_guard
 AFTER UPDATE OF stage,version,current_judgment_id,current_judgment_next_step_id ON public.cases
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_case_judgment_final();
COMMIT;
