-- Unexecuted forward draft. Only expiry and persistent cleanup rotation are
-- admitted; creation, finalization and all material writes remain closed.
BEGIN;
DO $extend$
DECLARE installed_body text; function_oid oid;
 expected_body text := $original$
BEGIN
 IF NEW.category::text='CASE_CLOSURE_PAYMENT_PROOF' OR NEW.purpose='CASE_CLOSURE_PAYMENT_PROOF' THEN
  RAISE EXCEPTION 'payment screenshot upload contract is draft and not enabled' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $original$;
 housekeeping text := $housekeeping$
 IF TG_OP='UPDATE' THEN
  IF OLD.category::text='CASE_CLOSURE_PAYMENT_PROOF' OR OLD.purpose='CASE_CLOSURE_PAYMENT_PROOF' THEN
   IF TG_RELID='upload_drafts'::regclass THEN
    IF OLD.expires_at<=CURRENT_TIMESTAMP
     AND NEW.updated_at>=OLD.updated_at AND NEW.updated_at<=clock_timestamp()
     AND ((OLD.status='OPEN' AND NEW.status='EXPIRED'
       AND (to_jsonb(NEW)-'status'-'updated_at')=(to_jsonb(OLD)-'status'-'updated_at'))
      OR (OLD.status='EXPIRED' AND NEW.status='EXPIRED' AND OLD.pending_storage_key IS NOT NULL
       AND (to_jsonb(NEW)-'updated_at')=(to_jsonb(OLD)-'updated_at'))) THEN
     RETURN NEW;
    END IF;
   END IF;
   -- Also block retargeting an old proof away from its gated classification.
   RAISE EXCEPTION 'payment screenshot upload contract is draft and not enabled' USING ERRCODE='23514';
  END IF;
 END IF;
$housekeeping$;
BEGIN
 SELECT p.oid,p.prosrc INTO function_oid,installed_body FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname=current_schema() AND p.proname='guard_case_closure_payment_proof_draft'
  AND p.pronargs=0 AND p.prorettype='trigger'::regtype AND l.lanname='plpgsql' AND NOT p.prosecdef;
 IF function_oid IS NULL
  OR replace(installed_body,E'\r\n',E'\n') IS DISTINCT FROM replace(expected_body,E'\r\n',E'\n')
  OR NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='upload_drafts'::regclass
   AND t.tgname='case_closure_payment_proof_upload_draft_gate' AND t.tgfoid=function_oid
   AND t.tgtype=23 AND t.tgenabled='O' AND NOT t.tgisinternal)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='materials'::regclass
   AND t.tgname='case_closure_payment_proof_material_draft_gate' AND t.tgfoid=function_oid
   AND t.tgtype=23 AND t.tgenabled='O' AND NOT t.tgisinternal)
 THEN RAISE EXCEPTION 'unrecognized payment screenshot draft gates' USING ERRCODE='23514'; END IF;
 installed_body:=replace(installed_body,E'\r\n',E'\n');
 EXECUTE format('CREATE OR REPLACE FUNCTION %I.guard_case_closure_payment_proof_draft() RETURNS trigger LANGUAGE plpgsql AS %L',
  current_schema(),replace(installed_body,E'\nBEGIN\n',E'\nBEGIN\n'||housekeeping));
END; $extend$;
COMMIT;
