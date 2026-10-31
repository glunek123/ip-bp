-- Draft: post-closure supplementary uploads only. The early-source INSERT gate remains.
BEGIN;
DO $guard$
DECLARE actual text;
BEGIN
 SELECT p.prosrc INTO actual FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname=current_schema() AND p.proname='check_case_closure_upload_actor' AND p.pronargs=0;
 -- Normalize only CRLF; all remaining predecessor bytes must still match.
 IF replace(actual,E'\r\n',E'\n') IS DISTINCT FROM replace($expected$
DECLARE c record; f record; is_correction boolean; entry_root "case_external_entries"%ROWTYPE; expected_terminal integer;
BEGIN
 IF NEW."category"<>'CASE_CLOSURE_DOCUMENT' THEN RETURN NEW; END IF;
 -- Preserve existing expiry/private-key housekeeping; this cannot complete an upload.
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'status'-'pending_storage_key'-'updated_at')=(to_jsonb(OLD)-'status'-'pending_storage_key'-'updated_at') AND
  NEW."updated_at">=OLD."updated_at" AND ((OLD."status"='OPEN' AND NEW."status"='EXPIRED' AND OLD."expires_at"<=CURRENT_TIMESTAMP AND NEW."pending_storage_key" IS NOT DISTINCT FROM OLD."pending_storage_key") OR
  (OLD."pending_storage_key" IS NOT NULL AND NEW."pending_storage_key" IS NULL AND NEW."status"=OLD."status")) THEN RETURN NEW; END IF;
 SELECT * INTO c FROM "cases" WHERE "id"=NEW."owner_id" AND "department_id"=NEW."department_id" FOR UPDATE;
 SELECT * INTO f FROM "case_execution_finishes" WHERE "case_id"=NEW."owner_id" AND "department_id"=NEW."department_id";
 is_correction:=EXISTS (SELECT 1 FROM "case_closures" h WHERE h."case_id"=NEW."owner_id" AND h."department_id"=NEW."department_id");
 IF f."id" IS NULL AND c."id" IS NOT NULL THEN
  SELECT * INTO entry_root FROM "case_external_entries" WHERE "case_id"=c."id" AND "department_id"=c."department_id" AND "initial_stage"='WAITING_ARCHIVE';
  IF entry_root."id" IS NULL OR c."source_lead_id" IS NOT NULL OR c."source_notary_matter_id" IS NOT NULL OR c."certificate_id" IS NOT NULL
  THEN RAISE EXCEPTION 'closure upload lacks exact external root' USING ERRCODE='23514'; END IF;
  expected_terminal:=case_closure_terminal_version(c."id",c."department_id",NULL,1);
 ELSE
  IF f."id" IS NULL THEN RAISE EXCEPTION 'closure upload lacks finish' USING ERRCODE='23514'; END IF;
  expected_terminal:=case_closure_terminal_version(c."id",c."department_id",f."id",f."to_version");
 END IF;
 IF NEW."owner_type"<>'CASE' OR NEW."purpose"<>'CASE_CLOSURE_DOCUMENT' OR c."id" IS NULL OR c."stage"<>'WAITING_ARCHIVE' OR
  c."version"<>expected_terminal OR
  NOT case_closure_actor_authorized(NEW."actor_user_id",c."id",c."department_id",is_correction)
 THEN RAISE EXCEPTION 'closure upload actor or source forbidden' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $expected$,E'\r\n',E'\n') THEN
  RAISE EXCEPTION 'closure upload guard changed' USING ERRCODE='23514';
 END IF;
END;
$guard$;
CREATE OR REPLACE FUNCTION "check_case_closure_upload_actor"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record; f record; is_correction boolean; entry_root "case_external_entries"%ROWTYPE; expected_terminal integer;
BEGIN
 IF NEW."category"<>'CASE_CLOSURE_DOCUMENT' THEN RETURN NEW; END IF;
 -- Preserve existing expiry/private-key housekeeping; this cannot complete an upload.
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'status'-'pending_storage_key'-'updated_at')=(to_jsonb(OLD)-'status'-'pending_storage_key'-'updated_at') AND
  NEW."updated_at">=OLD."updated_at" AND ((OLD."status"='OPEN' AND NEW."status"='EXPIRED' AND OLD."expires_at"<=CURRENT_TIMESTAMP AND NEW."pending_storage_key" IS NOT DISTINCT FROM OLD."pending_storage_key") OR
  (OLD."pending_storage_key" IS NOT NULL AND NEW."pending_storage_key" IS NULL AND NEW."status"=OLD."status")) THEN RETURN NEW; END IF;
 SELECT * INTO c FROM "cases" WHERE "id"=NEW."owner_id" AND "department_id"=NEW."department_id" FOR UPDATE;
 SELECT * INTO f FROM "case_execution_finishes" WHERE "case_id"=NEW."owner_id" AND "department_id"=NEW."department_id";
 is_correction:=EXISTS (SELECT 1 FROM "case_closures" h WHERE h."case_id"=NEW."owner_id" AND h."department_id"=NEW."department_id");
 IF EXISTS (SELECT 1 FROM "case_early_closures" e WHERE e."case_id"=NEW."owner_id" AND e."department_id"=NEW."department_id") THEN
  IF c."id" IS NULL OR f."id" IS NOT NULL THEN
   RAISE EXCEPTION 'closure upload has conflicting early source' USING ERRCODE='23514';
  END IF;
  SELECT e."to_version" INTO expected_terminal FROM "case_early_closures" e
   WHERE e."case_id"=c."id" AND e."department_id"=c."department_id";
  expected_terminal:=case_closure_source_terminal_version(c."id",c."department_id",NULL,expected_terminal);
 ELSE
 IF f."id" IS NULL AND c."id" IS NOT NULL THEN
  SELECT * INTO entry_root FROM "case_external_entries" WHERE "case_id"=c."id" AND "department_id"=c."department_id" AND "initial_stage"='WAITING_ARCHIVE';
  IF entry_root."id" IS NULL OR c."source_lead_id" IS NOT NULL OR c."source_notary_matter_id" IS NOT NULL OR c."certificate_id" IS NOT NULL
  THEN RAISE EXCEPTION 'closure upload lacks exact external root' USING ERRCODE='23514'; END IF;
  expected_terminal:=case_closure_terminal_version(c."id",c."department_id",NULL,1);
 ELSE
  IF f."id" IS NULL THEN RAISE EXCEPTION 'closure upload lacks finish' USING ERRCODE='23514'; END IF;
  expected_terminal:=case_closure_terminal_version(c."id",c."department_id",f."id",f."to_version");
 END IF;
 END IF;
 IF NEW."owner_type"<>'CASE' OR NEW."purpose"<>'CASE_CLOSURE_DOCUMENT' OR c."id" IS NULL OR c."stage"<>'WAITING_ARCHIVE' OR
  c."version"<>expected_terminal OR
  NOT case_closure_actor_authorized(NEW."actor_user_id",c."id",c."department_id",is_correction)
 THEN RAISE EXCEPTION 'closure upload actor or source forbidden' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
COMMIT;
