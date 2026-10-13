BEGIN;
-- No grant, boundary, assignment or account backfill: access is explicitly granted separately.
CREATE TABLE "case_closures" (
 "id" uuid PRIMARY KEY, "case_id" uuid NOT NULL UNIQUE, "department_id" uuid NOT NULL,
 "finish_id" uuid NOT NULL UNIQUE, "current_version_id" uuid UNIQUE,
 UNIQUE ("id","case_id","department_id","finish_id"), UNIQUE ("case_id","department_id"),
 UNIQUE ("finish_id","case_id","department_id"), UNIQUE ("current_version_id","id","case_id","department_id","finish_id"),
 FOREIGN KEY ("case_id","department_id") REFERENCES "cases"("id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("finish_id","case_id","department_id") REFERENCES "case_execution_finishes"("id","case_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "case_closure_versions" (
 "id" uuid PRIMARY KEY, "closure_id" uuid NOT NULL, "case_id" uuid NOT NULL, "department_id" uuid NOT NULL, "finish_id" uuid NOT NULL,
 "kind" "case_closure_kind" NOT NULL, "prior_version_id" uuid UNIQUE,
 "from_version" integer NOT NULL, "to_version" integer NOT NULL,
 "close_at" date, "close_amount_state" "case_complaint_amount_state" NOT NULL, "close_amt" numeric(16,2),
 "note" varchar(2000), "correction_reason" varchar(500),
 "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "recorded_by_user_id" uuid NOT NULL, "audit_event_id" uuid NOT NULL UNIQUE,
 UNIQUE ("id","closure_id","case_id","department_id","finish_id"), UNIQUE ("id","case_id","department_id"),
 UNIQUE ("case_id","from_version"), UNIQUE ("case_id","to_version"),
 CHECK ("from_version">=1 AND "to_version"="from_version"+1),
 CHECK (("kind"='REGISTER' AND "prior_version_id" IS NULL AND "correction_reason" IS NULL) OR
        ("kind"='CORRECT' AND "prior_version_id" IS NOT NULL AND "correction_reason" IS NOT NULL AND CHAR_LENGTH(BTRIM("correction_reason")) BETWEEN 1 AND 500)),
 CHECK ("note" IS NULL OR CHAR_LENGTH(BTRIM("note")) BETWEEN 1 AND 2000),
 CHECK (("close_amount_state"='KNOWN' AND "close_amt" IS NOT NULL AND "close_amt">=0) OR ("close_amount_state"='PENDING' AND "close_amt" IS NULL)),
 CHECK ("close_at" IS NULL OR "close_at" <= ("recorded_at" AT TIME ZONE 'Asia/Shanghai')::date),
 FOREIGN KEY ("closure_id","case_id","department_id","finish_id") REFERENCES "case_closures"("id","case_id","department_id","finish_id") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY ("prior_version_id","closure_id","case_id","department_id","finish_id") REFERENCES "case_closure_versions"("id","closure_id","case_id","department_id","finish_id") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
ALTER TABLE "case_closures" ADD FOREIGN KEY ("current_version_id","id","case_id","department_id","finish_id")
 REFERENCES "case_closure_versions"("id","closure_id","case_id","department_id","finish_id") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE "case_closure_documents" (
 "closure_version_id" uuid NOT NULL, "case_id" uuid NOT NULL, "department_id" uuid NOT NULL,
 "material_id" uuid NOT NULL, "content_version_id" uuid NOT NULL,
 PRIMARY KEY ("closure_version_id","content_version_id"), UNIQUE ("closure_version_id","material_id"),
 FOREIGN KEY ("closure_version_id","case_id","department_id") REFERENCES "case_closure_versions"("id","case_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("material_id","content_version_id") REFERENCES "content_versions"("material_id","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "case_closure_receipts" (
 "id" uuid PRIMARY KEY, "department_id" uuid NOT NULL, "actor_user_id" uuid NOT NULL, "case_id" uuid NOT NULL,
 "command" "case_closure_command" NOT NULL, "idempotency_key" varchar(128) NOT NULL,
 "request_fingerprint" char(64) NOT NULL, "result_snapshot" jsonb NOT NULL, "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("department_id","actor_user_id","command","idempotency_key"),
 CHECK (CHAR_LENGTH(BTRIM("idempotency_key")) BETWEEN 1 AND 128 AND "idempotency_key"=BTRIM("idempotency_key")),
 CHECK ("request_fingerprint" ~ '^[a-f0-9]{64}$'),
 FOREIGN KEY ("case_id","department_id") REFERENCES "cases"("id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- The old finish terminal remains exact when no closure exists. Closure heads must
-- be the unique terminal of a chain beginning exactly at that finish.
CREATE FUNCTION "case_closure_terminal_version"(target_case uuid,target_department uuid,target_finish uuid,finish_version integer) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE h record; v record; terminal integer; expected_prior uuid; seen integer:=0;
BEGIN
 SELECT * INTO h FROM "case_closures" WHERE "case_id"=target_case AND "department_id"=target_department;
 IF h."id" IS NULL THEN RETURN finish_version; END IF;
 IF h."finish_id" IS DISTINCT FROM target_finish OR h."current_version_id" IS NULL THEN RAISE EXCEPTION 'invalid closure head' USING ERRCODE='23514'; END IF;
 terminal:=finish_version;
 FOR v IN SELECT * FROM "case_closure_versions" WHERE "closure_id"=h."id" AND "case_id"=target_case AND "department_id"=target_department ORDER BY "from_version" LOOP
  IF v."finish_id"<>target_finish OR v."from_version"<>terminal OR v."to_version"<>terminal+1 OR v."prior_version_id" IS DISTINCT FROM expected_prior OR
     (seen=0 AND v."kind"<>'REGISTER') OR (seen>0 AND v."kind"<>'CORRECT') THEN RAISE EXCEPTION 'broken closure chain' USING ERRCODE='23514'; END IF;
  terminal:=v."to_version"; expected_prior:=v."id"; seen:=seen+1;
 END LOOP;
 IF seen=0 OR expected_prior IS DISTINCT FROM h."current_version_id" THEN RAISE EXCEPTION 'nonterminal closure head' USING ERRCODE='23514'; END IF;
 RETURN terminal;
END; $$;

-- Rewrite only the supported predecessor's exact terminal expressions. Fail
-- closed on absent needles; no version >= shortcut and no historic row updates.
DO $migration$
DECLARE definition text; fn text; needle text;
BEGIN
 FOREACH fn IN ARRAY ARRAY['check_case_execution_submission_final','check_case_execution_confirmation_final','check_case_execution_mailing_final','check_case_execution_filing_final'] LOOP
  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname=fn AND p.pronargs=0;
  needle:='ef."to_version"=c."version"';
  IF definition IS NULL OR position(needle IN definition)=0 THEN RAISE EXCEPTION 'unknown finish terminal guard %',fn USING ERRCODE='23514'; END IF;
  EXECUTE replace(definition,needle,'case_closure_terminal_version(target_case,target_department,ef."id",ef."to_version")=c."version"');
 END LOOP;
 SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname='check_case_execution_finish_final' AND p.pronargs=0;
 needle:='c."version"<>f."to_version"';
 IF definition IS NULL OR position(needle IN definition)=0 THEN RAISE EXCEPTION 'unknown finish final guard' USING ERRCODE='23514'; END IF;
 EXECUTE replace(definition,needle,'c."version"<>case_closure_terminal_version(target_case,target_department,f."id",f."to_version")');
 SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname='check_case_judgment_final' AND p.pronargs=0;
 needle:='SELECT ef."to_version" INTO expected_version';
 IF definition IS NULL OR position(needle IN definition)=0 THEN RAISE EXCEPTION 'unknown judgment finish guard' USING ERRCODE='23514'; END IF;
 EXECUTE replace(definition,needle,'SELECT case_closure_terminal_version(target_case,target_department,ef."id",ef."to_version") INTO expected_version');
 SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname='reject_case_judgment_audit_mutation' AND p.pronargs=0;
 IF definition IS NULL OR position('''case.execution.finished''' IN definition)=0 THEN RAISE EXCEPTION 'unknown immutable audit guard' USING ERRCODE='23514'; END IF;
 EXECUTE replace(definition,'''case.execution.finished''','''case.execution.finished'',''case.closure.recorded'',''case.closure.corrected''');
 SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname='enforce_case_client_mailing_actor_path' AND p.pronargs=0;
 IF definition IS NULL OR position('''EXECUTION_FINISH_BASIS'')' IN definition)=0 OR position('WHEN NEW."category" = ''EXECUTION_FINISH_BASIS''' IN definition)=0 OR position('WHEN ''case.execution.finished''' IN definition)=0 THEN RAISE EXCEPTION 'unknown material actor guard' USING ERRCODE='23514'; END IF;
 definition:=replace(definition,'''EXECUTION_FINISH_BASIS'')','''EXECUTION_FINISH_BASIS'',''CASE_CLOSURE_DOCUMENT'')');
 definition:=replace(definition,'WHEN NEW."category" = ''EXECUTION_FINISH_BASIS'' THEN ''EXECUTING''','WHEN NEW."category" = ''EXECUTION_FINISH_BASIS'' THEN ''EXECUTING'' WHEN NEW."category" = ''CASE_CLOSURE_DOCUMENT'' THEN ''WAITING_ARCHIVE''');
 definition:=replace(definition,'WHEN ''case.execution.finished'' THEN ''EXECUTING,WAITING_ARCHIVE''','WHEN ''case.execution.finished'' THEN ''EXECUTING,WAITING_ARCHIVE'' WHEN ''case.closure.recorded'' THEN ''WAITING_ARCHIVE'' WHEN ''case.closure.corrected'' THEN ''WAITING_ARCHIVE''');
 EXECUTE definition;
END; $migration$;

CREATE FUNCTION "case_closure_actor_authorized"(target_actor uuid,target_case uuid,target_department uuid,is_correction boolean) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (SELECT 1 FROM "cases" c JOIN "user_accounts" u ON u."id"=target_actor AND u."active"
  WHERE c."id"=target_case AND c."department_id"=target_department AND
   ((u."account_type"='INTERNAL' AND EXISTS (
    SELECT 1 FROM "department_memberships" membership JOIN "role_assignments" a ON a."user_id"=membership."user_id" AND a."department_id"=membership."department_id" AND a."active"
    JOIN "role_templates" t ON t."id"=a."role_template_id" AND t."department_id"=a."department_id" AND t."active"
    JOIN "role_grants" g ON g."role_template_id"=t."id" AND g."action"=(CASE WHEN is_correction THEN 'case.closure.correct' ELSE 'case.closure.record' END)::"permission_action"
    JOIN "department_memberships" owner ON owner."user_id"=c."responsible_user_id" AND owner."department_id"=c."department_id"
    WHERE membership."user_id"=u."id" AND membership."department_id"=target_department AND membership."active" AND
     (g."scope"='DEPARTMENT' OR (g."scope"='SELF' AND c."responsible_user_id"=u."id") OR (g."scope"='TEAM' AND a."team_id"=owner."team_id"))
   )) OR (u."account_type"='LAWYER' AND NOT is_correction AND EXISTS (
    SELECT 1 FROM "lawyer_account_bindings" b JOIN "case_lawyer_assignments" a ON a."lawyer_id"=b."profile_id" AND a."department_id"=b."department_id"
    WHERE b."user_id"=u."id" AND b."department_id"=target_department AND b."active" AND a."case_id"=target_case AND a."role"='PRIMARY' AND a."ended_at" IS NULL
   ))));
$$;
CREATE FUNCTION "check_case_closure_actor"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record;
BEGIN
 SELECT * INTO c FROM "cases" WHERE "id"=NEW."case_id" AND "department_id"=NEW."department_id" FOR UPDATE;
 IF c."id" IS NULL OR c."stage"<>'WAITING_ARCHIVE' OR c."version"<>NEW."from_version" OR NEW."close_at">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date OR
  NOT case_closure_actor_authorized(NEW."recorded_by_user_id",NEW."case_id",NEW."department_id",NEW."kind"='CORRECT')
 THEN RAISE EXCEPTION 'closure actor forbidden' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "case_closure_actor_guard" BEFORE INSERT ON "case_closure_versions" FOR EACH ROW EXECUTE FUNCTION "check_case_closure_actor"();

CREATE FUNCTION "check_case_closure_upload_actor"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record; f record; is_correction boolean;
BEGIN
 IF NEW."category"<>'CASE_CLOSURE_DOCUMENT' THEN RETURN NEW; END IF;
 -- Preserve existing expiry/private-key housekeeping; this cannot complete an upload.
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'status'-'pending_storage_key'-'updated_at')=(to_jsonb(OLD)-'status'-'pending_storage_key'-'updated_at') AND
  NEW."updated_at">=OLD."updated_at" AND ((OLD."status"='OPEN' AND NEW."status"='EXPIRED' AND OLD."expires_at"<=CURRENT_TIMESTAMP AND NEW."pending_storage_key" IS NOT DISTINCT FROM OLD."pending_storage_key") OR
  (OLD."pending_storage_key" IS NOT NULL AND NEW."pending_storage_key" IS NULL AND NEW."status"=OLD."status")) THEN RETURN NEW; END IF;
 SELECT * INTO c FROM "cases" WHERE "id"=NEW."owner_id" AND "department_id"=NEW."department_id" FOR UPDATE;
 SELECT * INTO f FROM "case_execution_finishes" WHERE "case_id"=NEW."owner_id" AND "department_id"=NEW."department_id";
 is_correction:=EXISTS (SELECT 1 FROM "case_closures" h WHERE h."case_id"=NEW."owner_id" AND h."department_id"=NEW."department_id");
 IF NEW."owner_type"<>'CASE' OR NEW."purpose"<>'CASE_CLOSURE_DOCUMENT' OR c."id" IS NULL OR c."stage"<>'WAITING_ARCHIVE' OR f."id" IS NULL OR
  c."version"<>case_closure_terminal_version(c."id",c."department_id",f."id",f."to_version") OR
  NOT case_closure_actor_authorized(NEW."actor_user_id",c."id",c."department_id",is_correction)
 THEN RAISE EXCEPTION 'closure upload actor or source forbidden' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "case_closure_upload_actor_guard" BEFORE INSERT OR UPDATE ON "upload_drafts" FOR EACH ROW EXECUTE FUNCTION "check_case_closure_upload_actor"();

CREATE FUNCTION "check_case_closure_head_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW."id"<>OLD."id" OR NEW."case_id"<>OLD."case_id" OR NEW."department_id"<>OLD."department_id" OR NEW."finish_id"<>OLD."finish_id" OR NEW."current_version_id" IS NULL OR
  NOT EXISTS (SELECT 1 FROM "case_closure_versions" v WHERE v."id"=NEW."current_version_id" AND v."closure_id"=OLD."id" AND v."case_id"=OLD."case_id" AND v."department_id"=OLD."department_id" AND v."finish_id"=OLD."finish_id" AND v."prior_version_id" IS NOT DISTINCT FROM OLD."current_version_id")
 THEN RAISE EXCEPTION 'immutable closure identity or invalid head advance' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "case_closure_head_mutation_guard" BEFORE UPDATE OR DELETE ON "case_closures" FOR EACH ROW EXECUTE FUNCTION "check_case_closure_head_mutation"();

CREATE FUNCTION "check_case_closure_document"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected jsonb;
BEGIN
 SELECT a."details"->'closeContentVersionIds' INTO selected FROM "case_closure_versions" v JOIN "audit_events" a ON a."id"=v."audit_event_id" WHERE v."id"=NEW."closure_version_id" AND v."case_id"=NEW."case_id" AND v."department_id"=NEW."department_id" FOR UPDATE OF v;
 IF jsonb_typeof(selected) IS DISTINCT FROM 'array' OR NOT selected ? NEW."content_version_id"::text OR
  EXISTS (SELECT 1 FROM "case_closure_receipts" r WHERE r."result_snapshot"->>'closureVersionId'=NEW."closure_version_id"::text) OR
  NOT EXISTS (SELECT 1 FROM "materials" m JOIN "content_versions" v ON v."material_id"=m."id" WHERE m."id"=NEW."material_id" AND v."id"=NEW."content_version_id" AND
   m."owner_type"='CASE' AND m."owner_id"=NEW."case_id" AND m."department_id"=NEW."department_id" AND m."status"='ACTIVE' AND v."status"='AVAILABLE' AND
   m."category"='CASE_CLOSURE_DOCUMENT' AND m."purpose"='CASE_CLOSURE_DOCUMENT' AND
   (m."current_version_id"=v."id" OR EXISTS (SELECT 1 FROM "case_closure_documents" prior WHERE prior."case_id"=NEW."case_id" AND prior."department_id"=NEW."department_id" AND prior."material_id"=m."id" AND prior."content_version_id"=v."id")) AND
   v."mime_type" IN ('application/pdf','image/jpeg','image/png') AND v."size_bytes"<=52428800)
 THEN RAISE EXCEPTION 'closure document version mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "case_closure_document_guard" BEFORE INSERT ON "case_closure_documents" FOR EACH ROW EXECUTE FUNCTION "check_case_closure_document"();

CREATE FUNCTION "check_case_closure_reference"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v record; audit_action text;
BEGIN
 SELECT a."action" INTO audit_action FROM "audit_events" a WHERE a."id"=NEW."action_event_id";
 IF audit_action IN ('case.closure.recorded','case.closure.corrected') AND NEW."purpose"<>'CASE_CLOSURE_DOCUMENT' THEN RAISE EXCEPTION 'closure reference purpose mismatch' USING ERRCODE='23514'; END IF;
 IF NEW."purpose"<>'CASE_CLOSURE_DOCUMENT' THEN RETURN NEW; END IF;
 SELECT * INTO v FROM "case_closure_versions" WHERE "audit_event_id"=NEW."action_event_id" AND "case_id"=NEW."resource_id" AND "department_id"=NEW."department_id" FOR UPDATE;
 IF NEW."resource_type"<>'case' OR v."id" IS NULL OR NOT EXISTS (SELECT 1 FROM "case_closure_documents" d WHERE d."closure_version_id"=v."id" AND d."case_id"=v."case_id" AND d."department_id"=v."department_id" AND d."material_id"=NEW."material_id" AND d."content_version_id"=NEW."content_version_id") OR EXISTS (SELECT 1 FROM "case_closure_receipts" r WHERE r."result_snapshot"->>'closureVersionId'=v."id"::text) THEN RAISE EXCEPTION 'closure reference mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "case_closure_reference_guard" BEFORE INSERT ON "material_references" FOR EACH ROW EXECUTE FUNCTION "check_case_closure_reference"();
CREATE FUNCTION "reject_case_closure_reference_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."purpose"='CASE_CLOSURE_DOCUMENT' OR (TG_OP='UPDATE' AND NEW."purpose"='CASE_CLOSURE_DOCUMENT') OR EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id"=OLD."action_event_id" AND a."action" IN ('case.closure.recorded','case.closure.corrected')) THEN RAISE EXCEPTION 'immutable closure reference' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "case_closure_reference_immutable" BEFORE UPDATE OR DELETE ON "material_references" FOR EACH ROW EXECUTE FUNCTION "reject_case_closure_reference_mutation"();

CREATE FUNCTION "check_case_closure_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v record;
BEGIN
 SELECT * INTO v FROM "case_closure_versions" WHERE "id"=(NEW."result_snapshot"->>'closureVersionId')::uuid AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id" AND "recorded_by_user_id"=NEW."actor_user_id";
 IF v."id" IS NULL OR jsonb_typeof(NEW."result_snapshot") IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(NEW."result_snapshot"))<>7 OR
  NOT NEW."result_snapshot" ?& ARRAY['id','closureId','closureVersionId','finishId','stage','version','recordedAt'] OR
  NEW."result_snapshot"->>'id' IS DISTINCT FROM NEW."case_id"::text OR NEW."result_snapshot"->>'closureId' IS DISTINCT FROM v."closure_id"::text OR NEW."result_snapshot"->>'finishId' IS DISTINCT FROM v."finish_id"::text OR
  NEW."result_snapshot"->>'stage' IS DISTINCT FROM 'WAITING_ARCHIVE' OR NEW."result_snapshot"->>'version' IS DISTINCT FROM v."to_version"::text OR (NEW."result_snapshot"->>'recordedAt')::timestamptz IS DISTINCT FROM v."recorded_at" OR
  NEW."command"::text IS DISTINCT FROM (CASE WHEN v."kind"='REGISTER' THEN 'RECORD' ELSE 'CORRECT' END) OR
  NOT EXISTS (SELECT 1 FROM "cases" c JOIN "case_closures" h ON h."case_id"=c."id" AND h."department_id"=c."department_id" WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id" AND c."stage"='WAITING_ARCHIVE' AND c."version"=v."to_version" AND h."current_version_id"=v."id")
 THEN RAISE EXCEPTION 'closure receipt mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "case_closure_receipt_guard" BEFORE INSERT ON "case_closure_receipts" FOR EACH ROW EXECUTE FUNCTION "check_case_closure_receipt"();

CREATE FUNCTION "check_case_closure_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; c record; f record; h record; v record; a record; selected jsonb;
BEGIN
 IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; target_department:=NEW."department_id";
 ELSE target_case:=NEW."case_id"; target_department:=NEW."department_id"; END IF;
 SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
 SELECT * INTO h FROM "case_closures" WHERE "case_id"=target_case AND "department_id"=target_department;
 IF h."id" IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO f FROM "case_execution_finishes" WHERE "id"=h."finish_id" AND "case_id"=target_case AND "department_id"=target_department;
 IF f."id" IS NULL OR c."stage"<>'WAITING_ARCHIVE' OR c."version"<>case_closure_terminal_version(target_case,target_department,f."id",f."to_version") THEN RAISE EXCEPTION 'closure terminal mismatch' USING ERRCODE='23514'; END IF;
 FOR v IN SELECT * FROM "case_closure_versions" WHERE "closure_id"=h."id" LOOP
  SELECT * INTO a FROM "audit_events" WHERE "id"=v."audit_event_id";
  selected:=a."details"->'closeContentVersionIds';
  IF a."id" IS NULL OR a."actor_kind"<>'HUMAN' OR a."department_id"<>target_department OR a."resource_type"<>'CASE' OR a."resource_id"<>target_case OR a."actor_user_id"<>v."recorded_by_user_id" OR
   a."action" IS DISTINCT FROM (CASE WHEN v."kind"='REGISTER' THEN 'case.closure.recorded' ELSE 'case.closure.corrected' END) OR
   (a."internal_actor_user_id" IS DISTINCT FROM v."recorded_by_user_id" AND (v."kind"<>'REGISTER' OR NOT EXISTS (SELECT 1 FROM "lawyer_account_bindings" b WHERE b."id"=a."lawyer_account_binding_id" AND b."user_id"=v."recorded_by_user_id" AND b."department_id"=target_department))) OR
   a."details"->>'closureId' IS DISTINCT FROM h."id"::text OR a."details"->>'closureVersionId' IS DISTINCT FROM v."id"::text OR a."details"->>'finishId' IS DISTINCT FROM f."id"::text OR
   a."details"->'priorVersionId' IS DISTINCT FROM COALESCE(to_jsonb(v."prior_version_id"),'null'::jsonb) OR a."details"->>'fromVersion' IS DISTINCT FROM v."from_version"::text OR a."details"->>'toVersion' IS DISTINCT FROM v."to_version"::text OR
   a."details"->'closeAt' IS DISTINCT FROM COALESCE(to_jsonb(v."close_at"),'null'::jsonb) OR a."details"->>'closeAmountState' IS DISTINCT FROM v."close_amount_state"::text OR a."details"->'closeAmt' IS DISTINCT FROM COALESCE(to_jsonb(v."close_amt"::text),'null'::jsonb) OR
   a."details"->'note' IS DISTINCT FROM COALESCE(to_jsonb(v."note"),'null'::jsonb) OR a."details"->'correctionReason' IS DISTINCT FROM COALESCE(to_jsonb(v."correction_reason"),'null'::jsonb) OR
   jsonb_typeof(selected) IS DISTINCT FROM 'array' OR jsonb_array_length(selected) NOT BETWEEN 0 AND 10 OR
   (SELECT count(*) FROM "case_closure_documents" d WHERE d."closure_version_id"=v."id")<>jsonb_array_length(selected) OR
   EXISTS (SELECT 1 FROM "case_closure_documents" d WHERE d."closure_version_id"=v."id" AND (NOT selected ? d."content_version_id"::text OR NOT EXISTS (SELECT 1 FROM "material_references" r WHERE r."action_event_id"=v."audit_event_id" AND r."department_id"=target_department AND r."resource_type"='case' AND r."resource_id"=target_case AND r."purpose"='CASE_CLOSURE_DOCUMENT' AND r."material_id"=d."material_id" AND r."content_version_id"=d."content_version_id"))) OR
   NOT EXISTS (SELECT 1 FROM "case_closure_receipts" r WHERE r."case_id"=target_case AND r."department_id"=target_department AND r."actor_user_id"=v."recorded_by_user_id" AND r."result_snapshot"->>'closureVersionId'=v."id"::text)
  THEN RAISE EXCEPTION 'closure audit/reference/receipt mismatch' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "case_closure_case_final" AFTER UPDATE ON "cases" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_closure_final"();
CREATE CONSTRAINT TRIGGER "case_closure_head_final" AFTER INSERT OR UPDATE ON "case_closures" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_closure_final"();
CREATE CONSTRAINT TRIGGER "case_closure_version_final" AFTER INSERT ON "case_closure_versions" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_closure_final"();
CREATE CONSTRAINT TRIGGER "case_closure_document_final" AFTER INSERT ON "case_closure_documents" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_closure_final"();
CREATE CONSTRAINT TRIGGER "case_closure_receipt_final" AFTER INSERT ON "case_closure_receipts" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_closure_final"();
CREATE TRIGGER "case_closure_version_immutable" BEFORE UPDATE OR DELETE ON "case_closure_versions" FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE TRIGGER "case_closure_document_immutable" BEFORE UPDATE OR DELETE ON "case_closure_documents" FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE TRIGGER "case_closure_receipt_immutable" BEFORE UPDATE OR DELETE ON "case_closure_receipts" FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
COMMIT;
