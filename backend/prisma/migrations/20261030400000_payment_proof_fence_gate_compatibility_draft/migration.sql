-- Closed draft: allow only the metadata-fence update made by an exact
-- transaction-local payment document trigger. All document and upload gates
-- remain closed. PostgreSQL behaviour and concurrency have not been tested.
BEGIN;
DO $extend$
DECLARE
 installed_body text;
 function_oid oid;
 original_body text := $original$
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
 fence_exception text := $fence$
   IF TG_RELID='materials'::regclass AND pg_trigger_depth()>=2 THEN
    IF NEW.payment_proof_frozen IS TRUE
     AND (to_jsonb(NEW)-'payment_proof_frozen')=(to_jsonb(OLD)-'payment_proof_frozen')
     AND OLD.owner_type::text='CASE' AND OLD.current_version_id IS NOT NULL
     AND (EXISTS (SELECT 1 FROM case_closure_payment_documents d
       WHERE d.material_id=OLD.id AND d.content_version_id=OLD.current_version_id
        AND d.case_id=OLD.owner_id AND d.department_id=OLD.department_id
        AND d.xmin=pg_current_xact_id()::text::xid)
      OR EXISTS (SELECT 1 FROM case_payment_proof_supplement_documents d
       WHERE d.material_id=OLD.id AND d.content_version_id=OLD.current_version_id
        AND d.case_id=OLD.owner_id AND d.department_id=OLD.department_id
        AND d.xmin=pg_current_xact_id()::text::xid)) THEN
     RETURN NEW;
    END IF;
   END IF;
$fence$;
 expected_body text;
BEGIN
 expected_body:=replace(replace(original_body,E'\r\n',E'\n'),E'\nBEGIN\n',E'\nBEGIN\n'||replace(housekeeping,E'\r\n',E'\n'));
 SELECT p.oid,p.prosrc INTO function_oid,installed_body FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname=current_schema() AND p.proname='guard_case_closure_payment_proof_draft'
  AND p.pronargs=0 AND p.prorettype='trigger'::regtype AND l.lanname='plpgsql' AND NOT p.prosecdef;
 IF function_oid IS NULL OR replace(installed_body,E'\r\n',E'\n') IS DISTINCT FROM expected_body
  OR NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='materials'::regclass
   AND t.tgname='case_closure_payment_proof_material_draft_gate' AND t.tgfoid=function_oid
   AND t.tgtype=23 AND t.tgenabled='O' AND NOT t.tgisinternal)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='upload_drafts'::regclass
   AND t.tgname='case_closure_payment_proof_upload_draft_gate' AND t.tgfoid=function_oid
   AND t.tgtype=23 AND t.tgenabled='O' AND NOT t.tgisinternal)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
   JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
   WHERE t.tgrelid='case_closure_payment_documents'::regclass
    AND t.tgname='aaaa_payment_proof_metadata_fence_draft' AND t.tgtype=5
    AND t.tgenabled='O' AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred
    AND n.nspname=current_schema() AND p.proname='freeze_payment_proof_document_metadata_draft'
    AND p.pronargs=0 AND p.prorettype='trigger'::regtype AND l.lanname='plpgsql' AND NOT p.prosecdef)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
   JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
   WHERE t.tgrelid='case_payment_proof_supplement_documents'::regclass
    AND t.tgname='aaaa_payment_proof_metadata_fence_draft' AND t.tgtype=5
    AND t.tgenabled='O' AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred
    AND n.nspname=current_schema() AND p.proname='freeze_payment_proof_document_metadata_draft'
    AND p.pronargs=0 AND p.prorettype='trigger'::regtype AND l.lanname='plpgsql' AND NOT p.prosecdef)
 THEN RAISE EXCEPTION 'unrecognized payment screenshot fence gates' USING ERRCODE='23514'; END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION %I.guard_case_closure_payment_proof_draft() RETURNS trigger LANGUAGE plpgsql AS %L',
  current_schema(),replace(expected_body,$needle$   IF TG_RELID='upload_drafts'::regclass THEN$needle$,
   fence_exception||$needle$   IF TG_RELID='upload_drafts'::regclass THEN$needle$));
END; $extend$;
COMMIT;
