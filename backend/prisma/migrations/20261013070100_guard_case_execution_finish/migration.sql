BEGIN;
ALTER TABLE "cases" DROP CONSTRAINT "cases_matching_state_check";
ALTER TABLE "cases" ADD CONSTRAINT "cases_matching_state_check" CHECK (
  "version" >= 1 AND (("stage" = 'PENDING_MATCH' AND "matched_at" IS NULL) OR
  ("stage" IN ('WAITING_COMPLAINT','WAITING_COMPLAINT_CONFIRMATION','WAITING_COMPLAINT_STAMP','WAITING_FILING','WAITING_FORMAL_ACCEPTANCE','WAITING_HEARING','WAITING_JUDGMENT','SECOND_INSTANCE','WAITING_EXECUTION_DOCUMENTS','WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE') AND "matched_at" IS NOT NULL))
);
ALTER TABLE "cases" DROP CONSTRAINT "cases_complaint_state_check";
ALTER TABLE "cases" ADD CONSTRAINT "cases_complaint_state_check" CHECK (
  ("stage" IN ('PENDING_MATCH','WAITING_COMPLAINT') AND "complaint_submitted_at" IS NULL AND "complaint_submitted_by_user_id" IS NULL AND "complaint_amount_state" IS NULL AND "complaint_amount" IS NULL AND "complaint_pending_reason" IS NULL) OR
  ("stage" IN ('WAITING_COMPLAINT_CONFIRMATION','WAITING_COMPLAINT_STAMP','WAITING_FILING','WAITING_FORMAL_ACCEPTANCE','WAITING_HEARING','WAITING_JUDGMENT','SECOND_INSTANCE','WAITING_EXECUTION_DOCUMENTS','WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE') AND "complaint_submitted_at" IS NOT NULL AND "complaint_submitted_by_user_id" IS NOT NULL AND "complaint_amount_state" IS NOT NULL AND
    (("complaint_amount_state" = 'KNOWN' AND "complaint_amount" IS NOT NULL AND "complaint_amount" >= 0 AND "complaint_pending_reason" IS NULL) OR
     ("complaint_amount_state" = 'PENDING' AND "complaint_amount" IS NULL AND "complaint_pending_reason" IS NOT NULL AND CHAR_LENGTH(BTRIM("complaint_pending_reason")) > 0)))
);

CREATE TABLE "case_execution_finishes" (
  "id" uuid PRIMARY KEY, "case_id" uuid NOT NULL, "department_id" uuid NOT NULL,
  "filing_id" uuid NOT NULL, "reason" varchar(2000) NOT NULL, "basis_note" varchar(2000), "from_version" integer NOT NULL, "to_version" integer NOT NULL,
  "finished_at" date NOT NULL, "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by_user_id" uuid NOT NULL, "audit_event_id" uuid NOT NULL,
  CONSTRAINT "case_execution_finishes_case_key" UNIQUE ("case_id"),
  CONSTRAINT "case_execution_finishes_filing_key" UNIQUE ("filing_id"),
  CONSTRAINT "case_execution_finishes_audit_key" UNIQUE ("audit_event_id"),
  CONSTRAINT "case_execution_finishes_identity_key" UNIQUE ("id","case_id","department_id"),
  CONSTRAINT "case_execution_finishes_case_department_key" UNIQUE ("case_id","department_id"),
  CONSTRAINT "case_execution_finishes_from_key" UNIQUE ("case_id","from_version"),
  CONSTRAINT "case_execution_finishes_to_key" UNIQUE ("case_id","to_version"),
  CONSTRAINT "case_execution_finishes_source_key" UNIQUE ("filing_id","case_id","department_id"),
  CONSTRAINT "case_execution_finishes_reason_check" CHECK (CHAR_LENGTH(BTRIM("reason")) BETWEEN 1 AND 2000),
  CONSTRAINT "case_execution_finishes_note_check" CHECK ("basis_note" IS NULL OR CHAR_LENGTH(BTRIM("basis_note")) BETWEEN 1 AND 2000),
  CONSTRAINT "case_execution_finishes_version_check" CHECK ("to_version" = "from_version" + 1),
  CONSTRAINT "case_execution_finishes_date_check" CHECK ("finished_at" <= ("recorded_at" AT TIME ZONE 'Asia/Shanghai')::date),
  CONSTRAINT "case_execution_finishes_case_fkey" FOREIGN KEY ("case_id","department_id") REFERENCES "cases"("id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_finishes_filing_fkey" FOREIGN KEY ("filing_id","case_id","department_id") REFERENCES "case_execution_filings"("id","case_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_finishes_actor_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_finishes_audit_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "case_execution_finish_versions" (
  "finish_id" uuid NOT NULL, "case_id" uuid NOT NULL, "department_id" uuid NOT NULL,
  "material_id" uuid NOT NULL, "content_version_id" uuid NOT NULL,
  CONSTRAINT "case_execution_finish_versions_pkey" PRIMARY KEY ("finish_id","content_version_id"),
  CONSTRAINT "case_execution_finish_versions_material_key" UNIQUE ("finish_id","material_id"),
  CONSTRAINT "case_execution_finish_versions_filing_fkey" FOREIGN KEY ("finish_id","case_id","department_id") REFERENCES "case_execution_finishes"("id","case_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_finish_versions_content_fkey" FOREIGN KEY ("material_id","content_version_id") REFERENCES "content_versions"("material_id","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "case_execution_finish_receipts" (
  "id" uuid PRIMARY KEY, "department_id" uuid NOT NULL, "actor_user_id" uuid NOT NULL,
  "case_id" uuid NOT NULL, "idempotency_key" varchar(128) NOT NULL,
  "request_fingerprint" char(64) NOT NULL, "result_snapshot" jsonb NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_execution_finish_receipts_actor_key" UNIQUE ("department_id","actor_user_id","idempotency_key"),
  CONSTRAINT "case_execution_finish_receipts_key_check" CHECK (CHAR_LENGTH(BTRIM("idempotency_key")) BETWEEN 1 AND 128 AND "idempotency_key" = BTRIM("idempotency_key")),
  CONSTRAINT "case_execution_finish_receipts_fingerprint_check" CHECK ("request_fingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "case_execution_finish_receipts_case_fkey" FOREIGN KEY ("case_id","department_id") REFERENCES "cases"("id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_finish_receipts_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- Only grants newly inserted from the preceding action change revision.
WITH requested AS (
  SELECT g."role_template_id", g."scope", a."action"::"permission_action" AS "action"
  FROM "role_grants" g JOIN "role_templates" t ON t."id" = g."role_template_id"
  CROSS JOIN (VALUES ('case.execution.finish')) a("action")
  WHERE g."action" = 'case.execution.filing.submit'::"permission_action"
), inserted AS (
  INSERT INTO "role_grants" ("id","role_template_id","action","scope")
  SELECT gen_random_uuid(),"role_template_id","action","scope" FROM requested
  ON CONFLICT ("role_template_id","action","scope") DO NOTHING RETURNING "role_template_id"
), changed AS (
  UPDATE "role_templates" SET "version" = "version" + 1,"updated_at" = CURRENT_TIMESTAMP
  WHERE "id" IN (SELECT DISTINCT "role_template_id" FROM inserted) RETURNING "id","department_id"
)
UPDATE "user_accounts" u SET "authorization_revision" = u."authorization_revision" + 1,"updated_at" = CURRENT_TIMESTAMP
WHERE u."active" AND EXISTS (
  SELECT 1 FROM "role_assignments" a JOIN changed t ON t."id" = a."role_template_id" AND t."department_id" = a."department_id"
  JOIN "department_memberships" m ON m."user_id" = a."user_id" AND m."department_id" = a."department_id" AND m."active"
  WHERE a."user_id" = u."id" AND a."active"
);


DO $migration$
DECLARE definition text; fn text; needle text;
BEGIN
  -- Fail closed if the supported predecessor's guard shape has changed.
  FOREACH fn IN ARRAY ARRAY['check_case_trial_round_foundation','check_case_judgment_final','check_case_judgment_next_step_final','check_case_second_instance_final','check_case_execution_submission_final','check_case_execution_confirmation_final','check_case_execution_mailing_final','check_case_execution_filing_final'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=current_schema() AND p.proname=fn AND p.pronargs=0;
    IF definition IS NULL OR position('EXECUTING' IN definition)=0 THEN RAISE EXCEPTION 'unknown predecessor guard %',fn USING ERRCODE='23514'; END IF;
    definition:=replace(definition,'''EXECUTING'')','''EXECUTING'',''WAITING_ARCHIVE'')');
    IF fn='check_case_judgment_final' THEN
      needle:='IF EXISTS (SELECT 1 FROM "case_execution_filings" ff';
      IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'unknown judgment version guard' USING ERRCODE='23514'; END IF;
      definition:=replace(definition,needle,
        'IF EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department) THEN' || E'\n' ||
        ' SELECT ef."to_version" INTO expected_version FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department;' || E'\n' ||
        ' expected_stage := ''WAITING_ARCHIVE'';' || E'\n' || 'ELSIF EXISTS (SELECT 1 FROM "case_execution_filings" ff');
    ELSIF fn IN ('check_case_execution_submission_final','check_case_execution_confirmation_final') THEN
      needle:='c."stage" = ''EXECUTING'' AND EXISTS (';
      IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'unknown execution head branch %',fn USING ERRCODE='23514'; END IF;
      definition:=replace(definition,needle,'c."stage" IN (''EXECUTING'',''WAITING_ARCHIVE'') AND EXISTS (');
      needle:='ff."to_version"=c."version"';
      IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'unknown execution version branch %',fn USING ERRCODE='23514'; END IF;
      definition:=replace(definition,needle,
        '((c."stage"=''EXECUTING'' AND ff."to_version"=c."version" AND NOT EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department)) OR' || E'\n' ||
        ' (c."stage"=''WAITING_ARCHIVE'' AND EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department AND ef."filing_id"=ff."id" AND ef."from_version"=ff."to_version" AND ef."to_version"=c."version")))');
    ELSIF fn='check_case_execution_mailing_final' THEN
      needle:='c."stage"=''EXECUTING'' AND EXISTS (';
      IF position(needle IN definition)=0 OR position('f."to_version"=c."version"' IN definition)=0 THEN RAISE EXCEPTION 'unknown mailing version guard' USING ERRCODE='23514'; END IF;
      definition:=replace(definition,needle,'c."stage" IN (''EXECUTING'',''WAITING_ARCHIVE'') AND EXISTS (');
      definition:=replace(definition,'f."to_version"=c."version"',
        '((c."stage"=''EXECUTING'' AND f."to_version"=c."version" AND NOT EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department)) OR' || E'\n' ||
        ' (c."stage"=''WAITING_ARCHIVE'' AND EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department AND ef."filing_id"=f."id" AND ef."from_version"=f."to_version" AND ef."to_version"=c."version")))');
    ELSIF fn='check_case_execution_filing_final' THEN
      needle:='c."stage"<>''EXECUTING'' OR c."version"<>f."to_version"';
      IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'unknown filing version guard' USING ERRCODE='23514'; END IF;
      definition:=replace(definition,'IF c."stage"=''EXECUTING'' THEN','IF c."stage" IN (''EXECUTING'',''WAITING_ARCHIVE'') THEN');
      definition:=replace(definition,needle,
        'NOT ((c."stage"=''EXECUTING'' AND c."version"=f."to_version" AND NOT EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department)) OR' || E'\n' ||
        ' (c."stage"=''WAITING_ARCHIVE'' AND EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department AND ef."filing_id"=f."id" AND ef."from_version"=f."to_version" AND ef."to_version"=c."version")))');
    END IF;
    EXECUTE definition;
  END LOOP;
  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=current_schema() AND p.proname='reject_case_judgment_audit_mutation' AND p.pronargs=0;
  IF definition IS NULL OR position('''case.execution.filing.submitted''' IN definition)=0 THEN RAISE EXCEPTION 'unknown audit guard' USING ERRCODE='23514'; END IF;
  EXECUTE replace(definition,'''case.execution.filing.submitted''','''case.execution.filing.submitted'',''case.execution.finished''');
  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=current_schema() AND p.proname='enforce_case_client_mailing_actor_path' AND p.pronargs=0;
  IF definition IS NULL OR position('''EXECUTION_FILING_PROOF'')' IN definition)=0 OR position('WHEN NEW."category" = ''EXECUTION_FILING_PROOF''' IN definition)=0 OR
     position('WHEN ''case.execution.filing.submitted''' IN definition)=0 THEN RAISE EXCEPTION 'unknown material/actor guard' USING ERRCODE='23514'; END IF;
  definition:=replace(definition,'''EXECUTION_FILING_PROOF'')','''EXECUTION_FILING_PROOF'',''EXECUTION_FINISH_BASIS'')');
  definition:=replace(definition,'WHEN NEW."category" = ''EXECUTION_FILING_PROOF'' THEN ''WAITING_EXECUTION_FILING''',
    'WHEN NEW."category" = ''EXECUTION_FILING_PROOF'' THEN ''WAITING_EXECUTION_FILING''' || E'\n' || ' WHEN NEW."category" = ''EXECUTION_FINISH_BASIS'' THEN ''EXECUTING''');
  definition:=replace(definition,'WHEN ''case.execution.filing.submitted'' THEN ''WAITING_EXECUTION_FILING,EXECUTING''',
    'WHEN ''case.execution.filing.submitted'' THEN ''WAITING_EXECUTION_FILING,EXECUTING''' || E'\n' || ' WHEN ''case.execution.finished'' THEN ''EXECUTING,WAITING_ARCHIVE''');
  EXECUTE definition;
END; $migration$;

ALTER TABLE "material_references" ADD CONSTRAINT "material_references_execution_finish_event_check"
  CHECK ("purpose" <> 'EXECUTION_FINISH_BASIS' OR "action_event_id" IS NOT NULL);
CREATE FUNCTION "check_case_execution_finish_version"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected jsonb;
BEGIN
  SELECT a."details"->'basisContentVersionIds' INTO selected
    FROM "case_execution_finishes" f JOIN "audit_events" a ON a."id"=f."audit_event_id"
    WHERE f."id"=NEW."finish_id" AND f."case_id"=NEW."case_id" AND f."department_id"=NEW."department_id" FOR UPDATE OF f;
  IF EXISTS (SELECT 1 FROM "case_execution_finish_receipts" r WHERE r."case_id"=NEW."case_id" AND r."department_id"=NEW."department_id") OR jsonb_typeof(selected) IS DISTINCT FROM 'array' OR NOT selected ? NEW."content_version_id"::text OR
     NOT EXISTS (SELECT 1 FROM "materials" mat JOIN "content_versions" v ON v."material_id"=mat."id"
       WHERE mat."id"=NEW."material_id" AND v."id"=NEW."content_version_id"
         AND mat."department_id"=NEW."department_id" AND mat."owner_type"='CASE' AND mat."owner_id"=NEW."case_id"
         AND mat."category"='EXECUTION_FINISH_BASIS' AND mat."purpose"='EXECUTION_FINISH_BASIS'
         AND mat."status"='ACTIVE' AND v."status"='AVAILABLE'
         AND v."mime_type" IN ('application/pdf','image/jpeg','image/png') AND v."size_bytes"<=52428800
         AND mat."current_version_id"=v."id") THEN
    RAISE EXCEPTION 'execution filing frozen version mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_execution_finish_versions_guard" BEFORE INSERT ON "case_execution_finish_versions"
  FOR EACH ROW EXECUTE FUNCTION "check_case_execution_finish_version"();

CREATE FUNCTION "check_case_execution_finish_actor"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."finished_at">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date OR
    NOT EXISTS (SELECT 1 FROM "user_accounts" u WHERE u."id"=NEW."recorded_by_user_id" AND u."active"
    AND (u."account_type"='INTERNAL' OR (u."account_type"='LAWYER' AND EXISTS
      (SELECT 1 FROM "lawyer_account_bindings" b JOIN "case_lawyer_assignments" la
        ON la."lawyer_id"=b."profile_id" AND la."department_id"=b."department_id"
        WHERE b."user_id"=u."id" AND b."department_id"=NEW."department_id" AND b."active"
          AND la."case_id"=NEW."case_id" AND la."role"='PRIMARY' AND la."ended_at" IS NULL)))) THEN
    RAISE EXCEPTION 'execution filing actor path mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_execution_finish_actor_guard" BEFORE INSERT ON "case_execution_finishes"
  FOR EACH ROW EXECUTE FUNCTION "check_case_execution_finish_actor"();

CREATE FUNCTION "check_case_execution_finish_reference"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fact_id uuid; event_action text;
BEGIN
  SELECT "action" INTO event_action FROM "audit_events" WHERE "id"=NEW."action_event_id";
  IF event_action='case.execution.finished' AND NEW."purpose"<>'EXECUTION_FINISH_BASIS' THEN
    RAISE EXCEPTION 'execution finish reference purpose mismatch' USING ERRCODE='23514'; END IF;
  IF NEW."purpose" <> 'EXECUTION_FINISH_BASIS' THEN RETURN NEW; END IF;
  IF NEW."resource_type" <> 'case' OR NEW."action_event_id" IS NULL THEN
    RAISE EXCEPTION 'execution filing reference source invalid' USING ERRCODE='23514'; END IF;
  SELECT f."id" INTO fact_id FROM "case_execution_finishes" f
    WHERE f."case_id"=NEW."resource_id" AND f."department_id"=NEW."department_id"
      AND f."audit_event_id"=NEW."action_event_id" FOR UPDATE OF f;
  IF fact_id IS NULL OR NOT EXISTS (SELECT 1 FROM "case_execution_finish_versions" v
    WHERE v."finish_id"=fact_id AND v."case_id"=NEW."resource_id" AND v."department_id"=NEW."department_id"
      AND v."material_id"=NEW."material_id" AND v."content_version_id"=NEW."content_version_id") OR
    EXISTS (SELECT 1 FROM "case_execution_finish_receipts" r WHERE r."case_id"=NEW."resource_id"
      AND r."department_id"=NEW."department_id" AND r."result_snapshot"->>'finishId'=fact_id::text) THEN
    RAISE EXCEPTION 'execution filing reference mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_execution_finish_reference_guard" BEFORE INSERT ON "material_references"
  FOR EACH ROW EXECUTE FUNCTION "check_case_execution_finish_reference"();
CREATE FUNCTION "reject_case_execution_finish_reference_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."purpose"='EXECUTION_FINISH_BASIS' OR
     EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id"=OLD."action_event_id" AND a."action"='case.execution.finished') OR
     (TG_OP='UPDATE' AND (NEW."purpose"='EXECUTION_FINISH_BASIS' OR EXISTS
       (SELECT 1 FROM "audit_events" a WHERE a."id"=NEW."action_event_id" AND a."action"='case.execution.finished'))) THEN
    RAISE EXCEPTION 'execution filing reference is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_execution_finish_reference_immutable" BEFORE UPDATE OR DELETE ON "material_references"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_execution_finish_reference_mutation"();

CREATE FUNCTION "check_case_execution_finish_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; c record; f record; m record; audit record; selected jsonb;
BEGIN
  IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; target_department:=NEW."department_id";
  ELSE target_case:=NEW."case_id"; target_department:=NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
  SELECT * INTO f FROM "case_execution_finishes" WHERE "case_id"=target_case AND "department_id"=target_department;
  IF f."id" IS NULL THEN
    IF c."stage"='WAITING_ARCHIVE' THEN RAISE EXCEPTION 'execution filing missing' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO m FROM "case_execution_filings" WHERE "id"=f."filing_id" AND "case_id"=target_case AND "department_id"=target_department;
  SELECT * INTO audit FROM "audit_events" WHERE "id"=f."audit_event_id";
  selected:=audit."details"->'basisContentVersionIds';
  IF m."id" IS NULL OR m."mailing_id" IS DISTINCT FROM
       (SELECT x."id" FROM "case_execution_mailings" x WHERE x."case_id"=target_case AND x."department_id"=target_department) OR
     c."stage"<>'WAITING_ARCHIVE' OR c."version"<>f."to_version" OR
     f."from_version"<>m."to_version" OR f."to_version"<>f."from_version"+1 OR
     audit."id" IS NULL OR audit."department_id"<>target_department OR audit."resource_type"<>'CASE' OR
     audit."resource_id"<>target_case OR audit."actor_kind"<>'HUMAN' OR
     audit."actor_user_id"<>f."recorded_by_user_id" OR audit."action"<>'case.execution.finished' OR
     audit."details"->>'finishId' IS DISTINCT FROM f."id"::text OR
     audit."details"->>'filingId' IS DISTINCT FROM f."filing_id"::text OR
     audit."details"->>'reason' IS DISTINCT FROM f."reason" OR
     audit."details"->'basisNote' IS DISTINCT FROM COALESCE(to_jsonb(f."basis_note"),'null'::jsonb) OR
     (audit."internal_actor_user_id" IS DISTINCT FROM f."recorded_by_user_id" AND NOT EXISTS
       (SELECT 1 FROM "lawyer_account_bindings" b WHERE b."id"=audit."lawyer_account_binding_id" AND b."user_id"=f."recorded_by_user_id" AND b."department_id"=target_department)) OR
     audit."details"->>'fromVersion' IS DISTINCT FROM f."from_version"::text OR
     audit."details"->>'toVersion' IS DISTINCT FROM f."to_version"::text OR
     (audit."details"->>'finishedAt')::date IS DISTINCT FROM f."finished_at" OR
     jsonb_typeof(selected) IS DISTINCT FROM 'array' OR jsonb_array_length(selected) NOT BETWEEN 0 AND 10 OR
     (f."basis_note" IS NULL AND jsonb_array_length(selected)=0) OR
     (SELECT count(*) FROM "case_execution_finish_versions" v WHERE v."finish_id"=f."id")<>jsonb_array_length(selected) OR
     EXISTS (SELECT 1 FROM "case_execution_finish_versions" v WHERE v."finish_id"=f."id"
       AND NOT selected ? v."content_version_id"::text) OR
     NOT EXISTS (SELECT 1 FROM "case_execution_finish_receipts" r WHERE r."case_id"=target_case
       AND r."department_id"=target_department AND r."actor_user_id"=f."recorded_by_user_id"
       AND r."result_snapshot"->>'finishId'=f."id"::text) OR
     EXISTS (SELECT 1 FROM "case_execution_finish_versions" v WHERE v."finish_id"=f."id"
       AND NOT EXISTS (SELECT 1 FROM "material_references" r WHERE r."action_event_id"=f."audit_event_id"
         AND r."resource_type"='case' AND r."resource_id"=target_case AND r."purpose"='EXECUTION_FINISH_BASIS'
         AND r."material_id"=v."material_id" AND r."content_version_id"=v."content_version_id")) THEN
    RAISE EXCEPTION 'execution filing chain/audit/reference/receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "case_execution_finish_head_guard" AFTER UPDATE OF "stage","version","current_execution_submission_id" ON "cases"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_execution_finish_final"();
CREATE CONSTRAINT TRIGGER "case_execution_finish_fact_guard" AFTER INSERT ON "case_execution_finishes"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_execution_finish_final"();

CREATE FUNCTION "check_case_execution_finish_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM "case_execution_finishes" WHERE "id"=(NEW."result_snapshot"->>'finishId')::uuid
    AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id" AND "recorded_by_user_id"=NEW."actor_user_id";
  IF jsonb_typeof(NEW."result_snapshot") IS DISTINCT FROM 'object' OR
     (SELECT count(*) FROM jsonb_object_keys(NEW."result_snapshot"))<>7 OR
     NOT NEW."result_snapshot" ?& ARRAY['id','finishId','filingId','stage','version','finishedAt','recordedAt'] OR
     f."id" IS NULL OR NEW."result_snapshot"->>'id' IS DISTINCT FROM NEW."case_id"::text OR
     NEW."result_snapshot"->>'filingId' IS DISTINCT FROM f."filing_id"::text OR
     NEW."result_snapshot"->>'stage' IS DISTINCT FROM 'WAITING_ARCHIVE' OR
     NEW."result_snapshot"->>'version' IS DISTINCT FROM f."to_version"::text OR
     (NEW."result_snapshot"->>'finishedAt')::date IS DISTINCT FROM f."finished_at" OR
     (NEW."result_snapshot"->>'recordedAt')::timestamptz IS DISTINCT FROM f."recorded_at" OR
     NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id"
       AND c."stage"='WAITING_ARCHIVE' AND c."version"=f."to_version") OR
     (SELECT count(*) FROM "case_execution_finish_versions" v WHERE v."finish_id"=f."id") NOT BETWEEN 0 AND 10 OR
     (f."basis_note" IS NULL AND NOT EXISTS (SELECT 1 FROM "case_execution_finish_versions" v WHERE v."finish_id"=f."id")) OR
     EXISTS (SELECT 1 FROM "case_execution_finish_versions" v WHERE v."finish_id"=f."id" AND NOT EXISTS
       (SELECT 1 FROM "material_references" r WHERE r."action_event_id"=f."audit_event_id" AND r."resource_type"='case'
         AND r."resource_id"=NEW."case_id" AND r."purpose"='EXECUTION_FINISH_BASIS'
         AND r."material_id"=v."material_id" AND r."content_version_id"=v."content_version_id")) THEN
    RAISE EXCEPTION 'execution filing receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_execution_finish_receipt_guard" BEFORE INSERT ON "case_execution_finish_receipts"
  FOR EACH ROW EXECUTE FUNCTION "check_case_execution_finish_receipt"();

CREATE TRIGGER "case_execution_finishes_immutable" BEFORE UPDATE OR DELETE ON "case_execution_finishes"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE TRIGGER "case_execution_finish_versions_immutable" BEFORE UPDATE OR DELETE ON "case_execution_finish_versions"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE TRIGGER "case_execution_finish_receipts_immutable" BEFORE UPDATE OR DELETE ON "case_execution_finish_receipts"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();

COMMIT;
