BEGIN;
ALTER TABLE "case_execution_confirmations" ADD CONSTRAINT "case_execution_confirmations_identity_key" UNIQUE ("id","case_id","department_id");
-- Draft migration; apply only after 00_enums.sql is committed and deployed.
ALTER TABLE "cases" DROP CONSTRAINT "cases_matching_state_check";
ALTER TABLE "cases" ADD CONSTRAINT "cases_matching_state_check" CHECK (
  "version" >= 1 AND (("stage" = 'PENDING_MATCH' AND "matched_at" IS NULL) OR
  ("stage" IN ('WAITING_COMPLAINT','WAITING_COMPLAINT_CONFIRMATION','WAITING_COMPLAINT_STAMP','WAITING_FILING','WAITING_FORMAL_ACCEPTANCE','WAITING_HEARING','WAITING_JUDGMENT','SECOND_INSTANCE','WAITING_EXECUTION_DOCUMENTS','WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING') AND "matched_at" IS NOT NULL))
);
ALTER TABLE "cases" DROP CONSTRAINT "cases_complaint_state_check";
ALTER TABLE "cases" ADD CONSTRAINT "cases_complaint_state_check" CHECK (
  ("stage" IN ('PENDING_MATCH','WAITING_COMPLAINT') AND "complaint_submitted_at" IS NULL AND "complaint_submitted_by_user_id" IS NULL AND "complaint_amount_state" IS NULL AND "complaint_amount" IS NULL AND "complaint_pending_reason" IS NULL) OR
  ("stage" IN ('WAITING_COMPLAINT_CONFIRMATION','WAITING_COMPLAINT_STAMP','WAITING_FILING','WAITING_FORMAL_ACCEPTANCE','WAITING_HEARING','WAITING_JUDGMENT','SECOND_INSTANCE','WAITING_EXECUTION_DOCUMENTS','WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING') AND "complaint_submitted_at" IS NOT NULL AND "complaint_submitted_by_user_id" IS NOT NULL AND "complaint_amount_state" IS NOT NULL AND
    (("complaint_amount_state" = 'KNOWN' AND "complaint_amount" IS NOT NULL AND "complaint_amount" >= 0 AND "complaint_pending_reason" IS NULL) OR
     ("complaint_amount_state" = 'PENDING' AND "complaint_amount" IS NULL AND "complaint_pending_reason" IS NOT NULL AND CHAR_LENGTH(BTRIM("complaint_pending_reason")) > 0)))
);

CREATE TABLE "case_execution_mailings" (
  "id" uuid PRIMARY KEY, "case_id" uuid NOT NULL, "department_id" uuid NOT NULL,
  "confirmation_id" uuid NOT NULL, "from_version" integer NOT NULL, "to_version" integer NOT NULL,
  "mailed_at" date NOT NULL, "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by_user_id" uuid NOT NULL, "actor_type" "user_account_type" NOT NULL,
  "customer_account_binding_id" uuid, "lawyer_account_binding_id" uuid, "audit_event_id" uuid NOT NULL,
  CONSTRAINT "case_execution_mailings_case_key" UNIQUE ("case_id"),
  CONSTRAINT "case_execution_mailings_confirmation_key" UNIQUE ("confirmation_id"),
  CONSTRAINT "case_execution_mailings_audit_key" UNIQUE ("audit_event_id"),
  CONSTRAINT "case_execution_mailings_identity_key" UNIQUE ("id","case_id","department_id"),
  CONSTRAINT "case_execution_mailings_case_department_key" UNIQUE ("case_id","department_id"),
  CONSTRAINT "case_execution_mailings_from_key" UNIQUE ("case_id","from_version"),
  CONSTRAINT "case_execution_mailings_to_key" UNIQUE ("case_id","to_version"),
  CONSTRAINT "case_execution_mailings_version_check" CHECK ("to_version" = "from_version" + 1),
  CONSTRAINT "case_execution_mailings_date_check" CHECK ("mailed_at" <= ("recorded_at" AT TIME ZONE 'Asia/Shanghai')::date),
  CONSTRAINT "case_execution_mailings_actor_check" CHECK (
    ("actor_type" = 'INTERNAL' AND "customer_account_binding_id" IS NULL AND "lawyer_account_binding_id" IS NULL) OR
    ("actor_type" = 'CLIENT' AND "customer_account_binding_id" IS NOT NULL AND "lawyer_account_binding_id" IS NULL) OR
    ("actor_type" = 'LAWYER' AND "customer_account_binding_id" IS NULL AND "lawyer_account_binding_id" IS NOT NULL)),
  CONSTRAINT "case_execution_mailings_case_fkey" FOREIGN KEY ("case_id","department_id") REFERENCES "cases"("id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_mailings_confirmation_fkey" FOREIGN KEY ("confirmation_id","case_id","department_id") REFERENCES "case_execution_confirmations"("id","case_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_mailings_actor_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_mailings_customer_binding_fkey" FOREIGN KEY ("customer_account_binding_id","recorded_by_user_id","department_id") REFERENCES "customer_account_bindings"("id","user_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_mailings_lawyer_binding_fkey" FOREIGN KEY ("lawyer_account_binding_id","recorded_by_user_id","department_id") REFERENCES "lawyer_account_bindings"("id","user_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_mailings_audit_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "case_execution_mailing_versions" (
  "mailing_id" uuid NOT NULL, "case_id" uuid NOT NULL, "department_id" uuid NOT NULL,
  "material_id" uuid NOT NULL, "content_version_id" uuid NOT NULL,
  CONSTRAINT "case_execution_mailing_versions_pkey" PRIMARY KEY ("mailing_id","content_version_id"),
  CONSTRAINT "case_execution_mailing_versions_material_key" UNIQUE ("mailing_id","material_id"),
  CONSTRAINT "case_execution_mailing_versions_mailing_fkey" FOREIGN KEY ("mailing_id","case_id","department_id") REFERENCES "case_execution_mailings"("id","case_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_mailing_versions_content_fkey" FOREIGN KEY ("material_id","content_version_id") REFERENCES "content_versions"("material_id","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "case_execution_mailing_receipts" (
  "id" uuid PRIMARY KEY, "department_id" uuid NOT NULL, "actor_user_id" uuid NOT NULL,
  "case_id" uuid NOT NULL, "idempotency_key" varchar(128) NOT NULL,
  "request_fingerprint" char(64) NOT NULL, "result_snapshot" jsonb NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_execution_mailing_receipts_actor_key" UNIQUE ("department_id","actor_user_id","idempotency_key"),
  CONSTRAINT "case_execution_mailing_receipts_key_check" CHECK (CHAR_LENGTH(BTRIM("idempotency_key")) BETWEEN 1 AND 128 AND "idempotency_key" = BTRIM("idempotency_key")),
  CONSTRAINT "case_execution_mailing_receipts_fingerprint_check" CHECK ("request_fingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "case_execution_mailing_receipts_case_fkey" FOREIGN KEY ("case_id","department_id") REFERENCES "cases"("id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_mailing_receipts_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_execution_filings" (
  "id" uuid PRIMARY KEY, "case_id" uuid NOT NULL, "department_id" uuid NOT NULL,
  "mailing_id" uuid NOT NULL, "from_version" integer NOT NULL, "to_version" integer NOT NULL,
  "submitted_at" date NOT NULL, "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitted_by_user_id" uuid NOT NULL, "audit_event_id" uuid NOT NULL,
  CONSTRAINT "case_execution_filings_case_key" UNIQUE ("case_id"),
  CONSTRAINT "case_execution_filings_mailing_key" UNIQUE ("mailing_id"),
  CONSTRAINT "case_execution_filings_audit_key" UNIQUE ("audit_event_id"),
  CONSTRAINT "case_execution_filings_identity_key" UNIQUE ("id","case_id","department_id"),
  CONSTRAINT "case_execution_filings_case_department_key" UNIQUE ("case_id","department_id"),
  CONSTRAINT "case_execution_filings_from_key" UNIQUE ("case_id","from_version"),
  CONSTRAINT "case_execution_filings_to_key" UNIQUE ("case_id","to_version"),
  CONSTRAINT "case_execution_filings_version_check" CHECK ("to_version" = "from_version" + 1),
  CONSTRAINT "case_execution_filings_date_check" CHECK ("submitted_at" <= ("recorded_at" AT TIME ZONE 'Asia/Shanghai')::date),
  CONSTRAINT "case_execution_filings_case_fkey" FOREIGN KEY ("case_id","department_id") REFERENCES "cases"("id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_filings_mailing_fkey" FOREIGN KEY ("mailing_id","case_id","department_id") REFERENCES "case_execution_mailings"("id","case_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_filings_actor_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_filings_audit_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "case_execution_filing_versions" (
  "filing_id" uuid NOT NULL, "case_id" uuid NOT NULL, "department_id" uuid NOT NULL,
  "material_id" uuid NOT NULL, "content_version_id" uuid NOT NULL,
  CONSTRAINT "case_execution_filing_versions_pkey" PRIMARY KEY ("filing_id","content_version_id"),
  CONSTRAINT "case_execution_filing_versions_material_key" UNIQUE ("filing_id","material_id"),
  CONSTRAINT "case_execution_filing_versions_filing_fkey" FOREIGN KEY ("filing_id","case_id","department_id") REFERENCES "case_execution_filings"("id","case_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_filing_versions_content_fkey" FOREIGN KEY ("material_id","content_version_id") REFERENCES "content_versions"("material_id","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "case_execution_filing_receipts" (
  "id" uuid PRIMARY KEY, "department_id" uuid NOT NULL, "actor_user_id" uuid NOT NULL,
  "case_id" uuid NOT NULL, "idempotency_key" varchar(128) NOT NULL,
  "request_fingerprint" char(64) NOT NULL, "result_snapshot" jsonb NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_execution_filing_receipts_actor_key" UNIQUE ("department_id","actor_user_id","idempotency_key"),
  CONSTRAINT "case_execution_filing_receipts_key_check" CHECK (CHAR_LENGTH(BTRIM("idempotency_key")) BETWEEN 1 AND 128 AND "idempotency_key" = BTRIM("idempotency_key")),
  CONSTRAINT "case_execution_filing_receipts_fingerprint_check" CHECK ("request_fingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "case_execution_filing_receipts_case_fkey" FOREIGN KEY ("case_id","department_id") REFERENCES "cases"("id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_execution_filing_receipts_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- Only grants newly inserted from the preceding action change revision.
WITH requested AS (
  SELECT g."role_template_id", g."scope", a."action"::"permission_action" AS "action"
  FROM "role_grants" g JOIN "role_templates" t ON t."id" = g."role_template_id" AND t."active"
  CROSS JOIN (VALUES ('case.execution.mail'),('case.execution.filing.submit')) a("action")
  WHERE g."action" = 'case.execution.confirm'::"permission_action"
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

-- Append within the same transaction as 01_facts.sql when promoted to a real migration.
DO $migration$
DECLARE definition text; needle text; replacement text;
BEGIN
  -- Every older head guard must continue to run at the two new terminal stages.
  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=current_schema() AND p.proname='check_case_trial_round_foundation' AND p.pronargs=0;
  needle := '''WAITING_EXECUTION_CONFIRMATION'',''WAITING_EXECUTION_STAMP'')';
  IF definition IS NULL OR position(needle IN definition)=0 THEN RAISE EXCEPTION 'unknown trial foundation guard' USING ERRCODE='23514'; END IF;
  EXECUTE replace(definition,needle,'''WAITING_EXECUTION_CONFIRMATION'',''WAITING_EXECUTION_STAMP'',''WAITING_EXECUTION_FILING'',''EXECUTING'')');

  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=current_schema() AND p.proname='check_case_judgment_final' AND p.pronargs=0;
  IF definition IS NULL OR position('expected_stage := ''WAITING_EXECUTION_STAMP'';' IN definition)=0 OR
     position('''WAITING_EXECUTION_CONFIRMATION'', ''WAITING_EXECUTION_STAMP'') THEN' IN definition)=0 THEN
    RAISE EXCEPTION 'unknown judgment head guard' USING ERRCODE='23514'; END IF;
  definition := replace(definition,'''WAITING_EXECUTION_CONFIRMATION'', ''WAITING_EXECUTION_STAMP'') THEN',
    '''WAITING_EXECUTION_CONFIRMATION'', ''WAITING_EXECUTION_STAMP'', ''WAITING_EXECUTION_FILING'', ''EXECUTING'') THEN');
  definition := replace(definition,'expected_stage := ''WAITING_EXECUTION_STAMP'';',
    'IF EXISTS (SELECT 1 FROM "case_execution_filings" ff WHERE ff."case_id"=target_case AND ff."department_id"=target_department) THEN' || E'\n' ||
    ' SELECT ff."to_version" INTO expected_version FROM "case_execution_filings" ff WHERE ff."case_id"=target_case AND ff."department_id"=target_department;' || E'\n' ||
    ' expected_stage := ''EXECUTING'';' || E'\n' ||
    'ELSIF EXISTS (SELECT 1 FROM "case_execution_mailings" mm WHERE mm."case_id"=target_case AND mm."department_id"=target_department) THEN' || E'\n' ||
    ' SELECT mm."to_version" INTO expected_version FROM "case_execution_mailings" mm WHERE mm."case_id"=target_case AND mm."department_id"=target_department;' || E'\n' ||
    ' expected_stage := ''WAITING_EXECUTION_FILING'';' || E'\n' ||
    'ELSE expected_stage := ''WAITING_EXECUTION_STAMP''; END IF;');
  EXECUTE definition;

  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=current_schema() AND p.proname='check_case_judgment_next_step_final' AND p.pronargs=0;
  needle := '''WAITING_EXECUTION_CONFIRMATION'',''WAITING_EXECUTION_STAMP'')';
  IF definition IS NULL OR position(needle IN definition)=0 THEN RAISE EXCEPTION 'unknown judgment choice guard' USING ERRCODE='23514'; END IF;
  EXECUTE replace(definition,needle,'''WAITING_EXECUTION_CONFIRMATION'',''WAITING_EXECUTION_STAMP'',''WAITING_EXECUTION_FILING'',''EXECUTING'')');

  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=current_schema() AND p.proname='check_case_second_instance_final' AND p.pronargs=0;
  needle := 'c."stage" NOT IN (''WAITING_EXECUTION_DOCUMENTS'',''WAITING_EXECUTION_CONFIRMATION'',''WAITING_EXECUTION_STAMP'')';
  IF definition IS NULL OR position(needle IN definition)=0 THEN RAISE EXCEPTION 'unknown second-instance head guard' USING ERRCODE='23514'; END IF;
  EXECUTE replace(definition,needle,'c."stage" NOT IN (''WAITING_EXECUTION_DOCUMENTS'',''WAITING_EXECUTION_CONFIRMATION'',''WAITING_EXECUTION_STAMP'',''WAITING_EXECUTION_FILING'',''EXECUTING'')');

  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=current_schema() AND p.proname='check_case_execution_submission_final' AND p.pronargs=0;
  needle := 'f."to_version" = c."version"';
  -- 136 embeds the confirmation terminal inside the older submission guard.
  IF definition IS NULL OR position('c."stage" = ''WAITING_EXECUTION_STAMP''' IN definition)=0 OR
     position(needle IN definition)=0 THEN
    RAISE EXCEPTION 'unknown execution submission head guard' USING ERRCODE='23514'; END IF;
  definition := replace(definition,
    'c."stage" = ''WAITING_EXECUTION_STAMP'' AND EXISTS (',
    'c."stage" IN (''WAITING_EXECUTION_STAMP'',''WAITING_EXECUTION_FILING'',''EXECUTING'') AND EXISTS (');
  definition := replace(definition,
    'f."to_version" = c."version"',
    '((c."stage" = ''WAITING_EXECUTION_STAMP'' AND f."to_version" = c."version" AND NOT EXISTS (SELECT 1 FROM "case_execution_mailings" mm WHERE mm."case_id"=target_case AND mm."department_id"=target_department)) OR' || E'\n' ||
    ' (c."stage" = ''WAITING_EXECUTION_FILING'' AND EXISTS (SELECT 1 FROM "case_execution_mailings" mm WHERE mm."case_id"=target_case AND mm."department_id"=target_department AND mm."confirmation_id"=f."id" AND mm."from_version"=f."to_version" AND mm."to_version"=c."version") AND NOT EXISTS (SELECT 1 FROM "case_execution_filings" ff WHERE ff."case_id"=target_case AND ff."department_id"=target_department)) OR' || E'\n' ||
    ' (c."stage" = ''EXECUTING'' AND EXISTS (SELECT 1 FROM "case_execution_mailings" mm JOIN "case_execution_filings" ff ON ff."mailing_id"=mm."id" AND ff."case_id"=mm."case_id" AND ff."department_id"=mm."department_id" WHERE mm."case_id"=target_case AND mm."department_id"=target_department AND mm."confirmation_id"=f."id" AND mm."from_version"=f."to_version" AND ff."from_version"=mm."to_version" AND ff."to_version"=c."version")))');
  IF definition IS NULL OR position('case_execution_mailings' IN definition)=0 THEN RAISE EXCEPTION 'submission guard replacement failed' USING ERRCODE='23514'; END IF;
  EXECUTE definition;

  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=current_schema() AND p.proname='check_case_execution_confirmation_final' AND p.pronargs=0;
  needle := 'c."stage" <> ''WAITING_EXECUTION_STAMP'' OR c."version" <> f."to_version"';
  IF definition IS NULL OR position(needle IN definition)=0 THEN RAISE EXCEPTION 'unknown confirmation head guard' USING ERRCODE='23514'; END IF;
  definition := replace(definition,
    'IF c."stage" = ''WAITING_EXECUTION_STAMP'' THEN',
    'IF c."stage" IN (''WAITING_EXECUTION_STAMP'',''WAITING_EXECUTION_FILING'',''EXECUTING'') THEN');
  definition := replace(definition,needle,
    'NOT ((c."stage" = ''WAITING_EXECUTION_STAMP'' AND c."version" = f."to_version" AND NOT EXISTS (SELECT 1 FROM "case_execution_mailings" mm WHERE mm."case_id"=target_case AND mm."department_id"=target_department)) OR' || E'\n' ||
    ' (c."stage" = ''WAITING_EXECUTION_FILING'' AND EXISTS (SELECT 1 FROM "case_execution_mailings" mm WHERE mm."case_id"=target_case AND mm."department_id"=target_department AND mm."confirmation_id"=f."id" AND mm."from_version"=f."to_version" AND mm."to_version"=c."version") AND NOT EXISTS (SELECT 1 FROM "case_execution_filings" ff WHERE ff."case_id"=target_case AND ff."department_id"=target_department)) OR' || E'\n' ||
    ' (c."stage" = ''EXECUTING'' AND EXISTS (SELECT 1 FROM "case_execution_mailings" mm JOIN "case_execution_filings" ff ON ff."mailing_id"=mm."id" AND ff."case_id"=mm."case_id" AND ff."department_id"=mm."department_id" WHERE mm."case_id"=target_case AND mm."department_id"=target_department AND mm."confirmation_id"=f."id" AND mm."from_version"=f."to_version" AND ff."from_version"=mm."to_version" AND ff."to_version"=c."version")))');
  EXECUTE definition;

  -- Actor-path function is shared by upload_drafts and audit_events. Extend exact
  -- category/action lists, leaving every preexisting branch in place.
  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=current_schema() AND p.proname='enforce_case_client_mailing_actor_path' AND p.pronargs=0;
  IF definition IS NULL OR position('WHEN ''case.execution.confirmed'' THEN ''WAITING_EXECUTION_CONFIRMATION,WAITING_EXECUTION_STAMP''' IN definition)=0 OR
     position('''EXECUTION_APPLICATION'')' IN definition)=0 OR
     position('NEW."action" <> ''case.complaint.mailed''' IN definition)=0 OR
     position('binding_record."stage" <> ''WAITING_FILING''' IN definition)=0 OR
     position('binding_record."stage" <> ''WAITING_COMPLAINT_STAMP''' IN definition)=0 THEN
    RAISE EXCEPTION 'unknown case actor guard' USING ERRCODE='23514'; END IF;
  definition := replace(definition,'''EXECUTION_APPLICATION'')','''EXECUTION_APPLICATION'', ''EXECUTION_FILING_PROOF'')');
  definition := replace(definition,
    'WHEN NEW."category" = ''EXECUTION_APPLICATION'' THEN ''WAITING_EXECUTION_DOCUMENTS,WAITING_EXECUTION_CONFIRMATION''',
    'WHEN NEW."category" = ''EXECUTION_APPLICATION'' THEN ''WAITING_EXECUTION_DOCUMENTS,WAITING_EXECUTION_CONFIRMATION''' || E'\n' ||
    '        WHEN NEW."category" = ''EXECUTION_FILING_PROOF'' THEN ''WAITING_EXECUTION_FILING''');
  definition := replace(definition,
    'WHEN ''case.execution.confirmed'' THEN ''WAITING_EXECUTION_CONFIRMATION,WAITING_EXECUTION_STAMP''',
    'WHEN ''case.execution.confirmed'' THEN ''WAITING_EXECUTION_CONFIRMATION,WAITING_EXECUTION_STAMP''' || E'\n' ||
    '          WHEN ''case.execution.mailed'' THEN ''WAITING_EXECUTION_STAMP,WAITING_EXECUTION_FILING''' || E'\n' ||
    '          WHEN ''case.execution.filing.submitted'' THEN ''WAITING_EXECUTION_FILING,EXECUTING''');
  -- Client MAIL_RECEIPT draft at the new stage; client audit at either side of the command update.
  definition := replace(definition,
    'binding_record."stage" <> ''WAITING_COMPLAINT_STAMP''',
    'binding_record."stage" NOT IN (''WAITING_COMPLAINT_STAMP'',''WAITING_EXECUTION_STAMP'')');
  definition := replace(definition,
    'NEW."action" <> ''case.complaint.mailed''',
    'NEW."action" NOT IN (''case.complaint.mailed'',''case.execution.mailed'')');
  definition := replace(definition,
    'binding_record."stage" <> ''WAITING_FILING''',
    '((NEW."action" = ''case.complaint.mailed'' AND binding_record."stage" <> ''WAITING_FILING'') OR' || E'\n' ||
    '          (NEW."action" = ''case.execution.mailed'' AND binding_record."stage" NOT IN (''WAITING_EXECUTION_STAMP'',''WAITING_EXECUTION_FILING'')))');
  EXECUTE definition;
END; $migration$;

CREATE OR REPLACE FUNCTION "reject_case_judgment_audit_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."action" IN ('case.judgment.registered','case.judgment.corrected','case.judgment.next_step',
      'case.judgment.next_step.revoke','case.second_instance.save','case.second_instance.result',
      'case.second_instance.result.revoke','case.execution.submitted','case.execution.confirmed',
      'case.execution.mailed','case.execution.filing.submitted') OR
     (TG_OP='UPDATE' AND NEW."action" IN ('case.judgment.registered','case.judgment.corrected',
      'case.judgment.next_step','case.judgment.next_step.revoke','case.second_instance.save',
      'case.second_instance.result','case.second_instance.result.revoke','case.execution.submitted',
      'case.execution.confirmed','case.execution.mailed','case.execution.filing.submitted')) THEN
    RAISE EXCEPTION 'judgment/second-instance/execution audit is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;

-- Append within the same transaction as 01/02 when promoted to a real migration.
ALTER TABLE "material_references" ADD CONSTRAINT "material_references_execution_filing_event_check"
  CHECK ("purpose" <> 'EXECUTION_FILING_PROOF' OR "action_event_id" IS NOT NULL);
DROP INDEX "material_references_resource_purpose_version_key";
CREATE UNIQUE INDEX "material_references_resource_purpose_version_key"
  ON "material_references"("resource_type","resource_id","purpose","content_version_id")
  WHERE "purpose" NOT IN ('JUDGMENT','SECOND_INSTANCE_DOCUMENT','SECOND_INSTANCE_SERVICE','SECOND_INSTANCE_JUDGMENT','EXECUTION_APPLICATION','EXECUTION_FILING_PROOF');

CREATE FUNCTION "check_case_execution_mailing_version"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected jsonb;
BEGIN
  SELECT a."details"->'mailReceiptContentVersionIds' INTO selected
    FROM "case_execution_mailings" m JOIN "audit_events" a ON a."id"=m."audit_event_id"
    WHERE m."id"=NEW."mailing_id" AND m."case_id"=NEW."case_id" AND m."department_id"=NEW."department_id" FOR UPDATE OF m;
  IF jsonb_typeof(selected) IS DISTINCT FROM 'array' OR NOT selected ? NEW."content_version_id"::text OR
     NOT EXISTS (SELECT 1 FROM "materials" mat JOIN "content_versions" v ON v."material_id"=mat."id"
       WHERE mat."id"=NEW."material_id" AND v."id"=NEW."content_version_id"
         AND mat."department_id"=NEW."department_id" AND mat."owner_type"='CASE' AND mat."owner_id"=NEW."case_id"
         AND mat."category"='MAIL_RECEIPT' AND mat."purpose"='MAIL_RECEIPT' AND mat."status"='ACTIVE'
         AND v."status"='AVAILABLE' AND v."mime_type" IN ('application/pdf','image/jpeg','image/png')
         AND v."size_bytes"<=20971520 AND mat."current_version_id"=v."id") OR
     EXISTS (SELECT 1 FROM "case_execution_mailings" m JOIN "content_versions" v ON v."id"=NEW."content_version_id"
       WHERE m."id"=NEW."mailing_id" AND m."actor_type"='CLIENT' AND
         (v."uploaded_by"<>m."recorded_by_user_id" OR EXISTS (
           SELECT 1 FROM "material_references" r WHERE r."material_id"=NEW."material_id"
             AND r."content_version_id"=NEW."content_version_id" AND r."action_event_id" IS NOT NULL
             AND r."action_event_id"<>m."audit_event_id"))) THEN
    RAISE EXCEPTION 'execution mailing frozen version mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_execution_mailing_versions_guard" BEFORE INSERT ON "case_execution_mailing_versions"
  FOR EACH ROW EXECUTE FUNCTION "check_case_execution_mailing_version"();

-- Check mutable identity/assignment at insertion; immutable facts keep historical validity
-- after an account is disabled or an assignment ends.
CREATE FUNCTION "check_case_execution_mailing_actor"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."mailed_at">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date OR
    NOT EXISTS (SELECT 1 FROM "user_accounts" u WHERE u."id"=NEW."recorded_by_user_id"
      AND u."account_type"=NEW."actor_type" AND u."active") OR
    (NEW."actor_type"='CLIENT' AND NOT EXISTS (
      SELECT 1 FROM "customer_account_bindings" b JOIN "cases" c ON c."id"=NEW."case_id" AND c."department_id"=NEW."department_id"
      WHERE b."id"=NEW."customer_account_binding_id" AND b."user_id"=NEW."recorded_by_user_id"
        AND b."department_id"=NEW."department_id" AND b."customer_id"=c."customer_id" AND b."active")) OR
    (NEW."actor_type"='LAWYER' AND NOT EXISTS (
      SELECT 1 FROM "lawyer_account_bindings" b JOIN "case_lawyer_assignments" la
        ON la."lawyer_id"=b."profile_id" AND la."department_id"=b."department_id"
      WHERE b."id"=NEW."lawyer_account_binding_id" AND b."user_id"=NEW."recorded_by_user_id"
        AND b."department_id"=NEW."department_id" AND b."active" AND la."case_id"=NEW."case_id"
        AND la."role"='PRIMARY' AND la."ended_at" IS NULL)) THEN
    RAISE EXCEPTION 'execution mailing actor path mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_execution_mailing_actor_guard" BEFORE INSERT ON "case_execution_mailings"
  FOR EACH ROW EXECUTE FUNCTION "check_case_execution_mailing_actor"();

CREATE FUNCTION "check_case_execution_filing_version"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected jsonb;
BEGIN
  SELECT a."details"->'executionFilingProofContentVersionIds' INTO selected
    FROM "case_execution_filings" f JOIN "audit_events" a ON a."id"=f."audit_event_id"
    WHERE f."id"=NEW."filing_id" AND f."case_id"=NEW."case_id" AND f."department_id"=NEW."department_id" FOR UPDATE OF f;
  IF jsonb_typeof(selected) IS DISTINCT FROM 'array' OR NOT selected ? NEW."content_version_id"::text OR
     NOT EXISTS (SELECT 1 FROM "materials" mat JOIN "content_versions" v ON v."material_id"=mat."id"
       WHERE mat."id"=NEW."material_id" AND v."id"=NEW."content_version_id"
         AND mat."department_id"=NEW."department_id" AND mat."owner_type"='CASE' AND mat."owner_id"=NEW."case_id"
         AND mat."category"='EXECUTION_FILING_PROOF' AND mat."purpose"='EXECUTION_FILING_PROOF'
         AND mat."status"='ACTIVE' AND v."status"='AVAILABLE'
         AND v."mime_type" IN ('application/pdf','image/jpeg','image/png') AND v."size_bytes"<=52428800
         AND mat."current_version_id"=v."id") THEN
    RAISE EXCEPTION 'execution filing frozen version mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_execution_filing_versions_guard" BEFORE INSERT ON "case_execution_filing_versions"
  FOR EACH ROW EXECUTE FUNCTION "check_case_execution_filing_version"();

CREATE FUNCTION "check_case_execution_filing_actor"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."submitted_at">(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date OR
    NOT EXISTS (SELECT 1 FROM "user_accounts" u WHERE u."id"=NEW."submitted_by_user_id" AND u."active"
    AND (u."account_type"='INTERNAL' OR (u."account_type"='LAWYER' AND EXISTS
      (SELECT 1 FROM "lawyer_account_bindings" b JOIN "case_lawyer_assignments" la
        ON la."lawyer_id"=b."profile_id" AND la."department_id"=b."department_id"
        WHERE b."user_id"=u."id" AND b."department_id"=NEW."department_id" AND b."active"
          AND la."case_id"=NEW."case_id" AND la."role"='PRIMARY' AND la."ended_at" IS NULL)))) THEN
    RAISE EXCEPTION 'execution filing actor path mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_execution_filing_actor_guard" BEFORE INSERT ON "case_execution_filings"
  FOR EACH ROW EXECUTE FUNCTION "check_case_execution_filing_actor"();

CREATE FUNCTION "check_case_execution_filing_reference"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fact_id uuid;
BEGIN
  IF NEW."purpose" <> 'EXECUTION_FILING_PROOF' THEN RETURN NEW; END IF;
  IF NEW."resource_type" <> 'case' OR NEW."action_event_id" IS NULL THEN
    RAISE EXCEPTION 'execution filing reference source invalid' USING ERRCODE='23514'; END IF;
  SELECT f."id" INTO fact_id FROM "case_execution_filings" f
    WHERE f."case_id"=NEW."resource_id" AND f."department_id"=NEW."department_id"
      AND f."audit_event_id"=NEW."action_event_id" FOR UPDATE OF f;
  IF fact_id IS NULL OR NOT EXISTS (SELECT 1 FROM "case_execution_filing_versions" v
    WHERE v."filing_id"=fact_id AND v."case_id"=NEW."resource_id" AND v."department_id"=NEW."department_id"
      AND v."material_id"=NEW."material_id" AND v."content_version_id"=NEW."content_version_id") OR
    EXISTS (SELECT 1 FROM "case_execution_filing_receipts" r WHERE r."case_id"=NEW."resource_id"
      AND r."department_id"=NEW."department_id" AND r."result_snapshot"->>'filingId'=fact_id::text) THEN
    RAISE EXCEPTION 'execution filing reference mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_execution_filing_reference_guard" BEFORE INSERT ON "material_references"
  FOR EACH ROW EXECUTE FUNCTION "check_case_execution_filing_reference"();
CREATE FUNCTION "reject_case_execution_filing_reference_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."purpose"='EXECUTION_FILING_PROOF' OR (TG_OP='UPDATE' AND NEW."purpose"='EXECUTION_FILING_PROOF') THEN
    RAISE EXCEPTION 'execution filing reference is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_execution_filing_reference_immutable" BEFORE UPDATE OR DELETE ON "material_references"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_execution_filing_reference_mutation"();

CREATE FUNCTION "check_case_execution_mailing_reference"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_action text; fact_id uuid;
BEGIN
  SELECT a."action" INTO event_action FROM "audit_events" a WHERE a."id"=NEW."action_event_id";
  IF event_action<>'case.execution.mailed' THEN RETURN NEW; END IF;
  IF NEW."purpose"<>'MAIL_RECEIPT' OR NEW."resource_type"<>'case' THEN
    RAISE EXCEPTION 'execution mailing reference purpose invalid' USING ERRCODE='23514'; END IF;
  SELECT m."id" INTO fact_id FROM "case_execution_mailings" m
    WHERE m."audit_event_id"=NEW."action_event_id" AND m."case_id"=NEW."resource_id"
      AND m."department_id"=NEW."department_id" FOR UPDATE OF m;
  IF fact_id IS NULL OR NOT EXISTS (SELECT 1 FROM "case_execution_mailing_versions" v
    WHERE v."mailing_id"=fact_id AND v."case_id"=NEW."resource_id" AND v."department_id"=NEW."department_id"
      AND v."material_id"=NEW."material_id" AND v."content_version_id"=NEW."content_version_id") OR
    EXISTS (SELECT 1 FROM "case_execution_mailing_receipts" r WHERE r."case_id"=NEW."resource_id"
      AND r."department_id"=NEW."department_id" AND r."result_snapshot"->>'mailingId'=fact_id::text) THEN
    RAISE EXCEPTION 'execution mailing reference mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_execution_mailing_reference_guard" BEFORE INSERT ON "material_references"
  FOR EACH ROW EXECUTE FUNCTION "check_case_execution_mailing_reference"();
CREATE FUNCTION "reject_case_execution_mailing_reference_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id"=OLD."action_event_id" AND a."action"='case.execution.mailed') OR
     (TG_OP='UPDATE' AND EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id"=NEW."action_event_id" AND a."action"='case.execution.mailed')) THEN
    RAISE EXCEPTION 'execution mailing reference is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_execution_mailing_reference_immutable" BEFORE UPDATE OR DELETE ON "material_references"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_execution_mailing_reference_mutation"();

CREATE FUNCTION "check_case_execution_mailing_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; c record; m record; conf record; audit record; selected jsonb;
BEGIN
  IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; target_department:=NEW."department_id";
  ELSE target_case:=NEW."case_id"; target_department:=NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
  SELECT * INTO m FROM "case_execution_mailings" WHERE "case_id"=target_case AND "department_id"=target_department;
  IF m."id" IS NULL THEN
    IF c."stage" IN ('WAITING_EXECUTION_FILING','EXECUTING') THEN
      RAISE EXCEPTION 'execution mailing missing' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO conf FROM "case_execution_confirmations" WHERE "id"=m."confirmation_id"
    AND "case_id"=target_case AND "department_id"=target_department;
  SELECT * INTO audit FROM "audit_events" WHERE "id"=m."audit_event_id";
  selected:=audit."details"->'mailReceiptContentVersionIds';
  IF conf."id" IS NULL OR conf."submission_id" IS DISTINCT FROM c."current_execution_submission_id" OR
     m."from_version"<>conf."to_version" OR m."to_version"<>m."from_version"+1 OR
     NOT ((c."stage"='WAITING_EXECUTION_FILING' AND c."version"=m."to_version" AND NOT EXISTS
       (SELECT 1 FROM "case_execution_filings" f WHERE f."case_id"=target_case AND f."department_id"=target_department)) OR
       (c."stage"='EXECUTING' AND EXISTS (SELECT 1 FROM "case_execution_filings" f
         WHERE f."case_id"=target_case AND f."department_id"=target_department
           AND f."mailing_id"=m."id" AND f."from_version"=m."to_version" AND f."to_version"=c."version"))) OR
     audit."id" IS NULL OR audit."department_id"<>target_department OR audit."resource_type"<>'CASE' OR
     audit."resource_id"<>target_case OR audit."actor_kind"<>'HUMAN' OR
     audit."actor_user_id"<>m."recorded_by_user_id" OR audit."action"<>'case.execution.mailed' OR
     (m."actor_type"='INTERNAL' AND audit."internal_actor_user_id" IS DISTINCT FROM m."recorded_by_user_id") OR
     (m."actor_type"='CLIENT' AND audit."customer_account_binding_id" IS DISTINCT FROM m."customer_account_binding_id") OR
     (m."actor_type"='LAWYER' AND audit."lawyer_account_binding_id" IS DISTINCT FROM m."lawyer_account_binding_id") OR
     audit."details"->>'actorType' IS DISTINCT FROM m."actor_type"::text OR
     audit."details"->>'mailingId' IS DISTINCT FROM m."id"::text OR
     audit."details"->>'confirmationId' IS DISTINCT FROM m."confirmation_id"::text OR
     audit."details"->>'fromVersion' IS DISTINCT FROM m."from_version"::text OR
     audit."details"->>'toVersion' IS DISTINCT FROM m."to_version"::text OR
     (audit."details"->>'mailedAt')::date IS DISTINCT FROM m."mailed_at" OR
     jsonb_typeof(selected) IS DISTINCT FROM 'array' OR jsonb_array_length(selected) NOT BETWEEN 1 AND 10 OR
     (SELECT count(*) FROM "case_execution_mailing_versions" v WHERE v."mailing_id"=m."id")<>jsonb_array_length(selected) OR
     EXISTS (SELECT 1 FROM "case_execution_mailing_versions" v WHERE v."mailing_id"=m."id"
       AND NOT selected ? v."content_version_id"::text) OR
     EXISTS (SELECT 1 FROM "case_execution_mailing_versions" v WHERE v."mailing_id"=m."id"
       AND NOT EXISTS (SELECT 1 FROM "material_references" r WHERE r."action_event_id"=m."audit_event_id"
         AND r."resource_type"='case' AND r."resource_id"=target_case AND r."purpose"='MAIL_RECEIPT'
         AND r."material_id"=v."material_id" AND r."content_version_id"=v."content_version_id")) OR
     NOT EXISTS (SELECT 1 FROM "case_execution_mailing_receipts" r WHERE r."case_id"=target_case
       AND r."department_id"=target_department AND r."actor_user_id"=m."recorded_by_user_id"
       AND r."result_snapshot"->>'mailingId'=m."id"::text) THEN
    RAISE EXCEPTION 'execution mailing chain/audit/receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "case_execution_mailing_head_guard" AFTER UPDATE OF "stage","version","current_execution_submission_id" ON "cases"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_execution_mailing_final"();
CREATE CONSTRAINT TRIGGER "case_execution_mailing_fact_guard" AFTER INSERT ON "case_execution_mailings"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_execution_mailing_final"();

CREATE FUNCTION "check_case_execution_filing_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; c record; f record; m record; audit record; selected jsonb;
BEGIN
  IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; target_department:=NEW."department_id";
  ELSE target_case:=NEW."case_id"; target_department:=NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id"=target_case AND "department_id"=target_department;
  SELECT * INTO f FROM "case_execution_filings" WHERE "case_id"=target_case AND "department_id"=target_department;
  IF f."id" IS NULL THEN
    IF c."stage"='EXECUTING' THEN RAISE EXCEPTION 'execution filing missing' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO m FROM "case_execution_mailings" WHERE "id"=f."mailing_id" AND "case_id"=target_case AND "department_id"=target_department;
  SELECT * INTO audit FROM "audit_events" WHERE "id"=f."audit_event_id";
  selected:=audit."details"->'executionFilingProofContentVersionIds';
  IF m."id" IS NULL OR m."confirmation_id" IS DISTINCT FROM
       (SELECT x."id" FROM "case_execution_confirmations" x WHERE x."case_id"=target_case AND x."department_id"=target_department) OR
     c."stage"<>'EXECUTING' OR c."version"<>f."to_version" OR
     f."from_version"<>m."to_version" OR f."to_version"<>f."from_version"+1 OR
     audit."id" IS NULL OR audit."department_id"<>target_department OR audit."resource_type"<>'CASE' OR
     audit."resource_id"<>target_case OR audit."actor_kind"<>'HUMAN' OR
     audit."actor_user_id"<>f."submitted_by_user_id" OR audit."action"<>'case.execution.filing.submitted' OR
     audit."details"->>'filingId' IS DISTINCT FROM f."id"::text OR
     audit."details"->>'mailingId' IS DISTINCT FROM f."mailing_id"::text OR
     audit."details"->>'fromVersion' IS DISTINCT FROM f."from_version"::text OR
     audit."details"->>'toVersion' IS DISTINCT FROM f."to_version"::text OR
     (audit."details"->>'submittedAt')::date IS DISTINCT FROM f."submitted_at" OR
     jsonb_typeof(selected) IS DISTINCT FROM 'array' OR jsonb_array_length(selected) NOT BETWEEN 1 AND 10 OR
     (SELECT count(*) FROM "case_execution_filing_versions" v WHERE v."filing_id"=f."id")<>jsonb_array_length(selected) OR
     EXISTS (SELECT 1 FROM "case_execution_filing_versions" v WHERE v."filing_id"=f."id"
       AND NOT selected ? v."content_version_id"::text) OR
     NOT EXISTS (SELECT 1 FROM "case_execution_filing_receipts" r WHERE r."case_id"=target_case
       AND r."department_id"=target_department AND r."actor_user_id"=f."submitted_by_user_id"
       AND r."result_snapshot"->>'filingId'=f."id"::text) OR
     EXISTS (SELECT 1 FROM "case_execution_filing_versions" v WHERE v."filing_id"=f."id"
       AND NOT EXISTS (SELECT 1 FROM "material_references" r WHERE r."action_event_id"=f."audit_event_id"
         AND r."resource_type"='case' AND r."resource_id"=target_case AND r."purpose"='EXECUTION_FILING_PROOF'
         AND r."material_id"=v."material_id" AND r."content_version_id"=v."content_version_id")) THEN
    RAISE EXCEPTION 'execution filing chain/audit/reference/receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "case_execution_filing_head_guard" AFTER UPDATE OF "stage","version","current_execution_submission_id" ON "cases"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_execution_filing_final"();
CREATE CONSTRAINT TRIGGER "case_execution_filing_fact_guard" AFTER INSERT ON "case_execution_filings"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_execution_filing_final"();

CREATE FUNCTION "check_case_execution_mailing_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m record;
BEGIN
  SELECT * INTO m FROM "case_execution_mailings" WHERE "id"=(NEW."result_snapshot"->>'mailingId')::uuid
    AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id" AND "recorded_by_user_id"=NEW."actor_user_id";
  IF m."id" IS NULL OR NEW."result_snapshot"->>'id' IS DISTINCT FROM NEW."case_id"::text OR
     NEW."result_snapshot"->>'confirmationId' IS DISTINCT FROM m."confirmation_id"::text OR
     NEW."result_snapshot"->>'stage' IS DISTINCT FROM 'WAITING_EXECUTION_FILING' OR
     NEW."result_snapshot"->>'version' IS DISTINCT FROM m."to_version"::text OR
     (NEW."result_snapshot"->>'mailedAt')::date IS DISTINCT FROM m."mailed_at" OR
     (NEW."result_snapshot"->>'recordedAt')::timestamptz IS DISTINCT FROM m."recorded_at" OR
     NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id"
       AND c."stage"='WAITING_EXECUTION_FILING' AND c."version"=m."to_version") OR
     (SELECT count(*) FROM "case_execution_mailing_versions" v WHERE v."mailing_id"=m."id") NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'execution mailing receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_execution_mailing_receipt_guard" BEFORE INSERT ON "case_execution_mailing_receipts"
  FOR EACH ROW EXECUTE FUNCTION "check_case_execution_mailing_receipt"();
CREATE FUNCTION "check_case_execution_filing_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM "case_execution_filings" WHERE "id"=(NEW."result_snapshot"->>'filingId')::uuid
    AND "case_id"=NEW."case_id" AND "department_id"=NEW."department_id" AND "submitted_by_user_id"=NEW."actor_user_id";
  IF f."id" IS NULL OR NEW."result_snapshot"->>'id' IS DISTINCT FROM NEW."case_id"::text OR
     NEW."result_snapshot"->>'mailingId' IS DISTINCT FROM f."mailing_id"::text OR
     NEW."result_snapshot"->>'stage' IS DISTINCT FROM 'EXECUTING' OR
     NEW."result_snapshot"->>'version' IS DISTINCT FROM f."to_version"::text OR
     (NEW."result_snapshot"->>'submittedAt')::date IS DISTINCT FROM f."submitted_at" OR
     (NEW."result_snapshot"->>'recordedAt')::timestamptz IS DISTINCT FROM f."recorded_at" OR
     NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id"=NEW."case_id" AND c."department_id"=NEW."department_id"
       AND c."stage"='EXECUTING' AND c."version"=f."to_version") OR
     (SELECT count(*) FROM "case_execution_filing_versions" v WHERE v."filing_id"=f."id") NOT BETWEEN 1 AND 10 OR
     EXISTS (SELECT 1 FROM "case_execution_filing_versions" v WHERE v."filing_id"=f."id" AND NOT EXISTS
       (SELECT 1 FROM "material_references" r WHERE r."action_event_id"=f."audit_event_id" AND r."resource_type"='case'
         AND r."resource_id"=NEW."case_id" AND r."purpose"='EXECUTION_FILING_PROOF'
         AND r."material_id"=v."material_id" AND r."content_version_id"=v."content_version_id")) THEN
    RAISE EXCEPTION 'execution filing receipt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_execution_filing_receipt_guard" BEFORE INSERT ON "case_execution_filing_receipts"
  FOR EACH ROW EXECUTE FUNCTION "check_case_execution_filing_receipt"();

CREATE TRIGGER "case_execution_mailings_immutable" BEFORE UPDATE OR DELETE ON "case_execution_mailings"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE TRIGGER "case_execution_mailing_versions_immutable" BEFORE UPDATE OR DELETE ON "case_execution_mailing_versions"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE TRIGGER "case_execution_mailing_receipts_immutable" BEFORE UPDATE OR DELETE ON "case_execution_mailing_receipts"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE TRIGGER "case_execution_filings_immutable" BEFORE UPDATE OR DELETE ON "case_execution_filings"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE TRIGGER "case_execution_filing_versions_immutable" BEFORE UPDATE OR DELETE ON "case_execution_filing_versions"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();
CREATE TRIGGER "case_execution_filing_receipts_immutable" BEFORE UPDATE OR DELETE ON "case_execution_filing_receipts"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_judgment_mutation"();

COMMIT;
