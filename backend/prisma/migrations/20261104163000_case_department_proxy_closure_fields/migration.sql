-- A financial department grant cannot silently change the recorded closure
-- date or replace closure documents. Keep the original correction grant path.
BEGIN;
DO $preflight$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_trigger
  WHERE tgrelid='public.case_closure_settlement_update_receipts'::regclass
   AND tgname='closure_settlement_update_receipt_final'
   AND tgdeferrable AND tginitdeferred
 ) OR to_regprocedure('public.case_closure_actor_authorized(uuid,uuid,uuid,boolean)') IS NULL
 THEN RAISE EXCEPTION 'missing settlement correction predecessor' USING ERRCODE='23514';
 END IF;
END;
$preflight$;

CREATE FUNCTION public.check_proxy_settlement_closure_fields() RETURNS trigger
LANGUAGE plpgsql AS $guard$
DECLARE c public.cases%ROWTYPE;
 v public.case_closure_versions%ROWTYPE;
 prior public.case_closure_versions%ROWTYPE;
BEGIN
 SELECT * INTO c FROM public.cases
  WHERE id=NEW.case_id AND department_id=NEW.department_id;
 SELECT * INTO v FROM public.case_closure_versions
  WHERE id=NEW.closure_version_id AND case_id=NEW.case_id AND department_id=NEW.department_id
   AND recorded_by_user_id=NEW.actor_user_id;
 SELECT * INTO prior FROM public.case_closure_versions
  WHERE id=v.prior_version_id AND case_id=NEW.case_id AND department_id=NEW.department_id;
 IF c.id IS NULL OR v.id IS NULL OR prior.id IS NULL THEN
  RAISE EXCEPTION 'settlement closure field source missing' USING ERRCODE='23514';
 END IF;
 IF c.responsible_user_id=NEW.actor_user_id
  OR public.case_closure_actor_authorized(NEW.actor_user_id,NEW.case_id,NEW.department_id,true) IS TRUE
 THEN RETURN NEW; END IF;
 IF v.close_at IS DISTINCT FROM prior.close_at
  OR EXISTS (
   SELECT content_version_id FROM public.case_closure_documents
    WHERE closure_version_id=v.id AND case_id=NEW.case_id AND department_id=NEW.department_id
   EXCEPT ALL
   SELECT content_version_id FROM public.case_closure_documents
    WHERE closure_version_id=prior.id AND case_id=NEW.case_id AND department_id=NEW.department_id
  ) OR EXISTS (
   SELECT content_version_id FROM public.case_closure_documents
    WHERE closure_version_id=prior.id AND case_id=NEW.case_id AND department_id=NEW.department_id
   EXCEPT ALL
   SELECT content_version_id FROM public.case_closure_documents
    WHERE closure_version_id=v.id AND case_id=NEW.case_id AND department_id=NEW.department_id
  ) THEN
  RAISE EXCEPTION 'financial proxy cannot correct closure date or documents' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$guard$;

CREATE CONSTRAINT TRIGGER proxy_settlement_closure_fields_final
AFTER INSERT ON public.case_closure_settlement_update_receipts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.check_proxy_settlement_closure_fields();
COMMIT;
