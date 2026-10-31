-- Upload authorization only; no stage changes or early-closure facts are written.
BEGIN;
CREATE FUNCTION case_early_closure_upload_authorized(target_actor uuid,target_case uuid,target_department uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (SELECT 1 FROM "cases" c JOIN "user_accounts" u
  ON u."id"=target_actor AND u."active" AND u."account_type"='INTERNAL'
  JOIN "department_memberships" m ON m."user_id"=u."id" AND m."department_id"=c."department_id" AND m."active"
  WHERE c."id"=target_case AND c."department_id"=target_department AND c."responsible_user_id"=target_actor
  AND c."stage" IN ('PENDING_MATCH', 'WAITING_COMPLAINT', 'WAITING_COMPLAINT_CONFIRMATION', 'WAITING_COMPLAINT_STAMP', 'WAITING_FILING', 'WAITING_FORMAL_ACCEPTANCE', 'WAITING_HEARING', 'WAITING_JUDGMENT', 'SECOND_INSTANCE', 'WAITING_EXECUTION_DOCUMENTS', 'WAITING_EXECUTION_CONFIRMATION', 'WAITING_EXECUTION_STAMP', 'WAITING_EXECUTION_FILING', 'EXECUTING')
  AND NOT EXISTS (SELECT 1 FROM "case_closures" h WHERE h."case_id"=c."id" AND h."department_id"=c."department_id")
  AND NOT EXISTS (SELECT 1 FROM "case_early_closures" e WHERE e."case_id"=c."id" AND e."department_id"=c."department_id")
  AND NOT EXISTS (SELECT 1 FROM "case_early_archives" e WHERE e."case_id"=c."id" AND e."department_id"=c."department_id")
  AND case_closure_actor_authorized(target_actor,target_case,target_department,false));
$$;
DO $patch$
DECLARE definition text;
 needle text := ' SELECT * INTO f FROM "case_execution_finishes" WHERE "case_id"=NEW."owner_id" AND "department_id"=NEW."department_id";';
 branch text := $body$
 IF c."id" IS NOT NULL AND NEW."owner_type"='CASE' AND NEW."purpose"='CASE_CLOSURE_DOCUMENT'
  AND NEW."lawyer_account_binding_id" IS NULL AND NEW."customer_account_binding_id" IS NULL
  AND NEW."notary_office_account_binding_id" IS NULL
  AND case_early_closure_upload_authorized(NEW."actor_user_id",c."id",c."department_id") THEN
  RETURN NEW;
 END IF;
$body$;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname=current_schema() AND p.proname='check_case_closure_upload_actor' AND p.pronargs=0;
 IF definition IS NULL OR position('conflicting early source' IN definition)=0 OR
  (length(definition)-length(replace(definition,needle,'')))<>length(needle) OR
  position('case_early_closure_upload_authorized' IN definition)>0 THEN
  RAISE EXCEPTION 'closure preupload guard changed' USING ERRCODE='23514';
 END IF;
 EXECUTE replace(definition,needle,branch || needle);
END;
$patch$;
COMMIT;
