-- Unexecuted target-only actor branch; target 2900 gate stays closed.
BEGIN;
DO $actor$
DECLARE definition text;
 needle text := ' SELECT * INTO f FROM "case_execution_finishes" WHERE "case_id"=NEW."owner_id" AND "department_id"=NEW."department_id";';
 branch text := $body$
 IF NEW.settlement_update_upload_target_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM case_settlement_upload_targets t WHERE t.id=NEW.settlement_update_upload_target_id
   AND t.upload_draft_id=NEW.id AND t.case_id=NEW.owner_id AND t.department_id=NEW.department_id AND t.actor_user_id=NEW.actor_user_id
   AND NEW.owner_type='CASE' AND NEW.purpose='CASE_CLOSURE_DOCUMENT' AND t.purpose='CLOSURE_SETTLEMENT_UPDATE_DOCUMENT'
   AND settlement_update_document_upload_eligible(NEW.actor_user_id,t.case_id,t.department_id,t.expected_closure_version_id,t.authorization_revision)) THEN
   RAISE EXCEPTION 'settlement target upload actor forbidden' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
$body$;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname=current_schema() AND p.proname='check_case_closure_upload_actor' AND p.pronargs=0;
 IF definition IS NULL OR position('case_early_closure_upload_authorized' IN definition)=0
  OR position('settlement_update_upload_target_id' IN definition)>0
  OR (length(definition)-length(replace(definition,needle,'')))<>length(needle) THEN
  RAISE EXCEPTION 'settlement upload actor predecessor changed' USING ERRCODE='23514'; END IF;
 EXECUTE replace(definition,needle,branch||needle);
END; $actor$;
COMMIT;
