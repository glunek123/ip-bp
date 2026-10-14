BEGIN;
-- No real grants, boundaries, bindings or historic facts are changed.
ALTER TABLE "case_closures" ADD UNIQUE ("id","case_id","department_id");
CREATE TABLE "case_archives" (
 "id" uuid PRIMARY KEY, "case_id" uuid NOT NULL UNIQUE, "department_id" uuid NOT NULL,
 "closure_id" uuid NOT NULL UNIQUE, "closure_version_id" uuid NOT NULL, "current_version_id" uuid UNIQUE,
 UNIQUE ("id","case_id","department_id","closure_version_id"), UNIQUE ("case_id","department_id"),
 UNIQUE ("closure_id","case_id","department_id"), UNIQUE ("current_version_id","id","case_id","department_id","closure_version_id"),
 FOREIGN KEY ("case_id","department_id") REFERENCES "cases"("id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("closure_id","case_id","department_id") REFERENCES "case_closures"("id","case_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("closure_version_id","case_id","department_id") REFERENCES "case_closure_versions"("id","case_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "case_archive_versions" (
 "id" uuid PRIMARY KEY, "archive_id" uuid NOT NULL, "case_id" uuid NOT NULL, "department_id" uuid NOT NULL, "closure_version_id" uuid NOT NULL,
 "kind" "case_archive_kind" NOT NULL, "prior_version_id" uuid UNIQUE,
 "from_version" integer NOT NULL, "to_version" integer NOT NULL,
 "archive_at" date NOT NULL, "archive_type" "case_archive_type" NOT NULL, "archive_reason" varchar(2000) NOT NULL, "correction_reason" varchar(500),
 "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "recorded_by_user_id" uuid NOT NULL, "audit_event_id" uuid NOT NULL UNIQUE,
 UNIQUE ("id","archive_id","case_id","department_id","closure_version_id"), UNIQUE ("id","case_id","department_id"),
 UNIQUE ("case_id","from_version"), UNIQUE ("case_id","to_version"),
 CHECK ("from_version">=1 AND "to_version"="from_version"+1),
 CHECK (("kind"='ARCHIVE' AND "prior_version_id" IS NULL AND "correction_reason" IS NULL) OR
        ("kind"='CORRECT' AND "prior_version_id" IS NOT NULL AND "correction_reason" IS NOT NULL AND "correction_reason" ~ '[^[:space:]]')),
 CHECK ("archive_reason" ~ '[^[:space:]]'),
 CHECK ("archive_at">='0001-01-01'::date AND "archive_at" <= ("recorded_at" AT TIME ZONE 'Asia/Shanghai')::date),
 FOREIGN KEY ("archive_id","case_id","department_id","closure_version_id") REFERENCES "case_archives"("id","case_id","department_id","closure_version_id") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY ("prior_version_id","archive_id","case_id","department_id","closure_version_id") REFERENCES "case_archive_versions"("id","archive_id","case_id","department_id","closure_version_id") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
ALTER TABLE "case_archives" ADD FOREIGN KEY ("current_version_id","id","case_id","department_id","closure_version_id")
 REFERENCES "case_archive_versions"("id","archive_id","case_id","department_id","closure_version_id") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE "case_archive_receipts" (
 "id" uuid PRIMARY KEY, "department_id" uuid NOT NULL, "actor_user_id" uuid NOT NULL, "case_id" uuid NOT NULL,
 "command" "case_archive_command" NOT NULL, "idempotency_key" varchar(128) NOT NULL,
 "request_fingerprint" char(64) NOT NULL, "result_snapshot" jsonb NOT NULL, "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("department_id","actor_user_id","command","idempotency_key"),
 CHECK (CHAR_LENGTH(BTRIM("idempotency_key")) BETWEEN 1 AND 128 AND "idempotency_key"=BTRIM("idempotency_key")),
 CHECK ("request_fingerprint" ~ '^[a-f0-9]{64}$'),
 FOREIGN KEY ("case_id","department_id") REFERENCES "cases"("id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- Preserve the entire CA016 source helper, then extend its exact terminal once.
-- The archive helper never calls the wrapper, so there is no recursive loop.
ALTER FUNCTION "case_closure_terminal_version"(uuid,uuid,uuid,integer) RENAME TO "case_closure_source_terminal_version";
CREATE FUNCTION "case_archive_terminal_version"(target_case uuid,target_department uuid,target_closure uuid,target_closure_version uuid,closure_version integer) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE h record; v record; terminal integer:=closure_version; expected_prior uuid; seen integer:=0;
BEGIN
 SELECT * INTO h FROM "case_archives" WHERE "case_id"=target_case AND "department_id"=target_department;
 IF h."id" IS NULL THEN RETURN closure_version; END IF;
 IF h."closure_id" IS DISTINCT FROM target_closure OR h."closure_version_id" IS DISTINCT FROM target_closure_version OR h."current_version_id" IS NULL THEN RAISE EXCEPTION 'invalid archive anchor' USING ERRCODE='23514'; END IF;
 FOR v IN SELECT * FROM "case_archive_versions" WHERE "archive_id"=h."id" AND "case_id"=target_case AND "department_id"=target_department ORDER BY "from_version" LOOP
  IF v."closure_version_id"<>target_closure_version OR v."from_version"<>terminal OR v."to_version"<>terminal+1 OR v."prior_version_id" IS DISTINCT FROM expected_prior OR
    (seen=0 AND v."kind"<>'ARCHIVE') OR (seen>0 AND v."kind"<>'CORRECT') THEN RAISE EXCEPTION 'broken archive chain' USING ERRCODE='23514'; END IF;
  terminal:=v."to_version"; expected_prior:=v."id"; seen:=seen+1;
 END LOOP;
 IF seen=0 OR expected_prior IS DISTINCT FROM h."current_version_id" THEN RAISE EXCEPTION 'nonterminal archive head' USING ERRCODE='23514'; END IF;
 RETURN terminal;
END; $$;
CREATE FUNCTION "case_closure_terminal_version"(target_case uuid,target_department uuid,target_finish uuid,finish_version integer) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE terminal integer; h record;
BEGIN
 terminal:=case_closure_source_terminal_version(target_case,target_department,target_finish,finish_version);
 SELECT * INTO h FROM "case_closures" WHERE "case_id"=target_case AND "department_id"=target_department;
 IF h."id" IS NULL THEN
  IF EXISTS (SELECT 1 FROM "case_archives" WHERE "case_id"=target_case AND "department_id"=target_department) THEN RAISE EXCEPTION 'archive without closure' USING ERRCODE='23514'; END IF;
  RETURN terminal;
 END IF;
 RETURN case_archive_terminal_version(target_case,target_department,h."id",h."current_version_id",terminal);
END; $$;

-- Extend only supported predecessor stage guards. Exact terminal comparisons
-- remain intact; all old WAITING_ARCHIVE branches keep the same source chain.
DO $migration$
DECLARE definition text; fn text; constraint_name text;
BEGIN
 FOREACH constraint_name IN ARRAY ARRAY['cases_matching_state_check','cases_complaint_state_check'] LOOP
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='cases'::regclass AND conname=constraint_name;
  IF definition IS NULL OR position('''WAITING_ARCHIVE''::case_stage' IN definition)=0 THEN RAISE EXCEPTION 'unknown archive state constraint %',constraint_name USING ERRCODE='23514'; END IF;
  definition:=replace(definition,'''WAITING_ARCHIVE''::case_stage','''WAITING_ARCHIVE''::case_stage, ''ARCHIVED''::case_stage');
  EXECUTE format('ALTER TABLE "cases" DROP CONSTRAINT %I',constraint_name);
  EXECUTE format('ALTER TABLE "cases" ADD CONSTRAINT %I %s',constraint_name,definition);
 END LOOP;
 FOREACH fn IN ARRAY ARRAY['check_case_trial_round_foundation','check_case_judgment_final','check_case_judgment_next_step_final','check_case_second_instance_final','check_case_execution_submission_final','check_case_execution_confirmation_final','check_case_execution_mailing_final','check_case_execution_filing_final','check_case_execution_finish_final','check_case_closure_final'] LOOP
  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname=fn AND p.pronargs=0;
  IF definition IS NULL OR position('WAITING_ARCHIVE' IN definition)=0 THEN RAISE EXCEPTION 'unknown archive predecessor %',fn USING ERRCODE='23514'; END IF;
  definition:=replace(definition,'''WAITING_ARCHIVE'')','''WAITING_ARCHIVE'',''ARCHIVED'')');
  definition:=replace(definition,'c."stage"=''WAITING_ARCHIVE''','c."stage" IN (''WAITING_ARCHIVE'',''ARCHIVED'')');
  definition:=replace(definition,'c."stage"<>''WAITING_ARCHIVE''','c."stage" NOT IN (''WAITING_ARCHIVE'',''ARCHIVED'')');
  IF fn='check_case_judgment_final' THEN
   IF position('expected_stage := ''WAITING_ARCHIVE'';' IN definition)=0 THEN RAISE EXCEPTION 'unknown judgment closure stage' USING ERRCODE='23514'; END IF;
   definition:=replace(definition,'expected_stage := ''WAITING_ARCHIVE'';','expected_stage := CASE WHEN EXISTS (SELECT 1 FROM "case_archives" WHERE "case_id"=target_case AND "department_id"=target_department) THEN ''ARCHIVED''::case_stage ELSE ''WAITING_ARCHIVE''::case_stage END;');
  END IF;
  EXECUTE definition;
 END LOOP;
 SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname='reject_case_judgment_audit_mutation' AND p.pronargs=0;
 IF definition IS NULL OR position('''case.closure.corrected''' IN definition)=0 THEN RAISE EXCEPTION 'unknown archive immutable audit guard' USING ERRCODE='23514'; END IF;
 EXECUTE replace(definition,'''case.closure.corrected''','''case.closure.corrected'',''case.archived'',''case.archive.corrected''');
 -- Recognize the new human audit paths; no material category is introduced.
 SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname='enforce_case_client_mailing_actor_path' AND p.pronargs=0;
 IF definition IS NULL OR position('WHEN ''case.closure.corrected'' THEN ''WAITING_ARCHIVE''' IN definition)=0 THEN RAISE EXCEPTION 'unknown archive human actor guard' USING ERRCODE='23514'; END IF;
 EXECUTE replace(definition,'WHEN ''case.closure.corrected'' THEN ''WAITING_ARCHIVE''','WHEN ''case.closure.corrected'' THEN ''WAITING_ARCHIVE'' WHEN ''case.archived'' THEN ''WAITING_ARCHIVE,ARCHIVED'' WHEN ''case.archive.corrected'' THEN ''ARCHIVED''');
END; $migration$;

CREATE FUNCTION "case_archive_actor_authorized"(target_actor uuid,target_case uuid,target_department uuid,is_correction boolean) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (SELECT 1 FROM "cases" c JOIN "user_accounts" u ON u."id"=target_actor AND u."active"
  WHERE c."id"=target_case AND c."department_id"=target_department AND
   ((u."account_type"='INTERNAL' AND EXISTS (
    SELECT 1 FROM "department_memberships" membership JOIN "role_assignments" a ON a."user_id"=membership."user_id" AND a."department_id"=membership."department_id" AND a."active"
    JOIN "role_templates" t ON t."id"=a."role_template_id" AND t."department_id"=a."department_id" AND t."active"
    JOIN "role_grants" g ON g."role_template_id"=t."id" AND g."action"=(CASE WHEN is_correction THEN 'case.archive.correct' ELSE 'case.archive' END)::"permission_action"
    JOIN "department_memberships" owner ON owner."user_id"=c."responsible_user_id" AND owner."department_id"=c."department_id"
    WHERE membership."user_id"=u."id" AND membership."department_id"=target_department AND membership."active" AND
     (g."scope"='DEPARTMENT' OR (g."scope"='SELF' AND c."responsible_user_id"=u."id") OR (g."scope"='TEAM' AND a."team_id"=owner."team_id"))
   )) OR (u."account_type"='LAWYER' AND NOT is_correction AND EXISTS (
    SELECT 1 FROM "lawyer_account_bindings" b JOIN "case_lawyer_assignments" a ON a."lawyer_id"=b."profile_id" AND a."department_id"=b."department_id"
    WHERE b."user_id"=u."id" AND b."department_id"=target_department AND b."active" AND a."case_id"=target_case AND a."role"='PRIMARY' AND a."ended_at" IS NULL
   ))));
$$;
CREATE FUNCTION "check_case_archive_actor"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record; h record; closure_head record; f record; terminal integer;
BEGIN
 SELECT * INTO c FROM "cases" WHERE "id"=NEW."case_id" AND "department_id"=NEW."department_id" FOR UPDATE;
 SELECT * INTO h FROM "case_archives" WHERE "id"=NEW."archive_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
 SELECT * INTO closure_head FROM "case_closures" WHERE "id"=h."closure_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
 SELECT * INTO f FROM "case_execution_finishes" WHERE "id"=closure_head."finish_id" AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id";
 IF c."id" IS NULL OR h."id" IS NULL OR closure_head."id" IS NULL OR f."id" IS NULL OR
  closure_head."current_version_id" IS DISTINCT FROM h."closure_version_id" OR NEW."closure_version_id" IS DISTINCT FROM h."closure_version_id" OR
  c."version"<>NEW."from_version" OR NEW."archive_at">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date OR
  NOT case_archive_actor_authorized(NEW."recorded_by_user_id",NEW."case_id",NEW."department_id",NEW."kind"='CORRECT')
 THEN RAISE EXCEPTION 'archive actor or anchor forbidden' USING ERRCODE='23514'; END IF;
 terminal:=case_closure_source_terminal_version(c."id",c."department_id",f."id",f."to_version");
 IF NEW."kind"='ARCHIVE' THEN
  IF c."stage"<>'WAITING_ARCHIVE' OR NEW."prior_version_id" IS NOT NULL OR h."current_version_id" IS NOT NULL OR terminal<>NEW."from_version" OR
   EXISTS (SELECT 1 FROM "case_archive_versions" WHERE "archive_id"=h."id") THEN RAISE EXCEPTION 'invalid first archive' USING ERRCODE='23514'; END IF;
 ELSE
  IF c."stage"<>'ARCHIVED' OR h."current_version_id" IS DISTINCT FROM NEW."prior_version_id" OR
    case_archive_terminal_version(c."id",c."department_id",closure_head."id",h."closure_version_id",terminal)<>NEW."from_version" THEN RAISE EXCEPTION 'invalid archive correction' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "case_archive_actor_guard" BEFORE INSERT ON "case_archive_versions" FOR EACH ROW EXECUTE FUNCTION "check_case_archive_actor"();
CREATE FUNCTION "check_case_archive_head_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW."id"<>OLD."id" OR NEW."case_id"<>OLD."case_id" OR NEW."department_id"<>OLD."department_id" OR NEW."closure_id"<>OLD."closure_id" OR NEW."closure_version_id"<>OLD."closure_version_id" OR NEW."current_version_id" IS NULL OR
  NOT EXISTS (SELECT 1 FROM "case_archive_versions" v WHERE v."id"=NEW."current_version_id" AND v."archive_id"=OLD."id" AND v."case_id"=OLD."case_id" AND v."department_id"=OLD."department_id" AND v."closure_version_id"=OLD."closure_version_id" AND v."prior_version_id" IS NOT DISTINCT FROM OLD."current_version_id")
 THEN RAISE EXCEPTION 'immutable archive identity or invalid head advance' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "case_archive_head_mutation_guard" BEFORE UPDATE OR DELETE ON "case_archives" FOR EACH ROW EXECUTE FUNCTION "check_case_archive_head_mutation"();
CREATE FUNCTION "check_case_archive_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v record; h record;
BEGIN
 SELECT * INTO v FROM "case_archive_versions" WHERE "id"=(NEW."result_snapshot"->>'archiveVersionId')::uuid AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id" AND "recorded_by_user_id"=NEW."actor_user_id";
 SELECT * INTO h FROM "case_archives" WHERE "id"=v."archive_id";
 IF v."id" IS NULL OR jsonb_typeof(NEW."result_snapshot") IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(NEW."result_snapshot"))<>8 OR
  NOT NEW."result_snapshot" ?& ARRAY['id','archiveId','archiveVersionId','closureId','closureVersionId','stage','version','recordedAt'] OR
  NEW."result_snapshot"->>'id' IS DISTINCT FROM NEW."case_id"::text OR NEW."result_snapshot"->>'archiveId' IS DISTINCT FROM h."id"::text OR
  NEW."result_snapshot"->>'closureId' IS DISTINCT FROM h."closure_id"::text OR NEW."result_snapshot"->>'closureVersionId' IS DISTINCT FROM h."closure_version_id"::text OR
  NEW."result_snapshot"->>'stage' IS DISTINCT FROM 'ARCHIVED' OR jsonb_typeof(NEW."result_snapshot"->'version') IS DISTINCT FROM 'number' OR
  NEW."result_snapshot"->>'version' IS DISTINCT FROM v."to_version"::text OR
  NEW."result_snapshot"->>'recordedAt' IS DISTINCT FROM to_char(v."recorded_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') OR
  NEW."command"::text IS DISTINCT FROM v."kind"::text OR
  NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id" AND c."stage"='ARCHIVED' AND c."version"=v."to_version" AND h."current_version_id"=v."id")
 THEN RAISE EXCEPTION 'archive receipt mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "case_archive_receipt_guard" BEFORE INSERT ON "case_archive_receipts" FOR EACH ROW EXECUTE FUNCTION "check_case_archive_receipt"();
CREATE FUNCTION "check_case_archive_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; c record; h record; closure_head record; f record; v record; a record; terminal integer;
BEGIN
 IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; target_department:=NEW."department_id";
 ELSE target_case:=NEW."case_id"; target_department:=NEW."department_id"; END IF;
 SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
 SELECT * INTO h FROM "case_archives" WHERE "case_id"=target_case AND "department_id"=target_department;
 IF h."id" IS NULL THEN
  IF c."stage"='ARCHIVED' THEN RAISE EXCEPTION 'archived case without archive' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO closure_head FROM "case_closures" WHERE "id"=h."closure_id" AND "case_id"=target_case AND "department_id"=target_department;
 SELECT * INTO f FROM "case_execution_finishes" WHERE "id"=closure_head."finish_id" AND "case_id"=target_case AND "department_id"=target_department;
 IF closure_head."id" IS NULL OR f."id" IS NULL OR closure_head."current_version_id" IS DISTINCT FROM h."closure_version_id" OR c."stage"<>'ARCHIVED' THEN RAISE EXCEPTION 'archive closure or stage mismatch' USING ERRCODE='23514'; END IF;
 terminal:=case_closure_source_terminal_version(target_case,target_department,f."id",f."to_version");
 IF c."version"<>case_archive_terminal_version(target_case,target_department,closure_head."id",h."closure_version_id",terminal) THEN RAISE EXCEPTION 'archive terminal mismatch' USING ERRCODE='23514'; END IF;
 FOR v IN SELECT * FROM "case_archive_versions" WHERE "archive_id"=h."id" LOOP
  SELECT * INTO a FROM "audit_events" WHERE "id"=v."audit_event_id";
  IF a."id" IS NULL OR a."actor_kind"<>'HUMAN' OR a."department_id"<>target_department OR a."resource_type"<>'CASE' OR a."resource_id"<>target_case OR a."actor_user_id"<>v."recorded_by_user_id" OR
   a."action" IS DISTINCT FROM (CASE WHEN v."kind"='ARCHIVE' THEN 'case.archived' ELSE 'case.archive.corrected' END) OR
   (a."internal_actor_user_id" IS DISTINCT FROM v."recorded_by_user_id" AND (v."kind"<>'ARCHIVE' OR NOT EXISTS (SELECT 1 FROM "lawyer_account_bindings" b WHERE b."id"=a."lawyer_account_binding_id" AND b."user_id"=v."recorded_by_user_id" AND b."department_id"=target_department))) OR
   a."details"->>'archiveId' IS DISTINCT FROM h."id"::text OR a."details"->>'archiveVersionId' IS DISTINCT FROM v."id"::text OR
   a."details"->>'closureId' IS DISTINCT FROM h."closure_id"::text OR a."details"->>'closureVersionId' IS DISTINCT FROM h."closure_version_id"::text OR
   a."details"->'priorVersionId' IS DISTINCT FROM COALESCE(to_jsonb(v."prior_version_id"),'null'::jsonb) OR a."details"->>'fromVersion' IS DISTINCT FROM v."from_version"::text OR a."details"->>'toVersion' IS DISTINCT FROM v."to_version"::text OR
   a."details"->'archiveAt' IS DISTINCT FROM to_jsonb(v."archive_at") OR a."details"->>'archiveType' IS DISTINCT FROM v."archive_type"::text OR a."details"->>'archiveReason' IS DISTINCT FROM v."archive_reason" OR
   a."details"->'correctionReason' IS DISTINCT FROM COALESCE(to_jsonb(v."correction_reason"),'null'::jsonb) OR
   NOT EXISTS (SELECT 1 FROM "case_archive_receipts" r WHERE r."case_id"=target_case AND r."department_id"=target_department AND r."actor_user_id"=v."recorded_by_user_id" AND r."result_snapshot"->>'archiveVersionId'=v."id"::text)
  THEN RAISE EXCEPTION 'archive audit or receipt mismatch' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "case_archive_case_final" AFTER INSERT OR UPDATE ON "cases" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_archive_final"();
CREATE CONSTRAINT TRIGGER "case_archive_head_final" AFTER INSERT OR UPDATE ON "case_archives" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_archive_final"();
CREATE CONSTRAINT TRIGGER "case_archive_version_final" AFTER INSERT ON "case_archive_versions" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_archive_final"();
CREATE CONSTRAINT TRIGGER "case_archive_receipt_final" AFTER INSERT ON "case_archive_receipts" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_archive_final"();
CREATE TRIGGER "case_archive_version_immutable" BEFORE UPDATE OR DELETE ON "case_archive_versions" FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE TRIGGER "case_archive_receipt_immutable" BEFORE UPDATE OR DELETE ON "case_archive_receipts" FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
COMMIT;
