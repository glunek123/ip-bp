-- 1. Relax strict trigger guards while preserving data-assigning trigger behaviors
CREATE OR REPLACE FUNCTION public.classify_case_record_material_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW."is_repeatable_typed_reference" := COALESCE(NEW."is_repeatable_typed_reference", false);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_dual_actor_path()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    IF NEW."notary_office_account_binding_id" IS NULL AND NEW."internal_actor_user_id" IS NULL THEN
      IF TG_TABLE_NAME = 'notary_matter_opening' THEN
        NEW."internal_actor_user_id" := NEW."recorded_by_user_id";
      ELSE
        NEW."internal_actor_user_id" := NEW."actor_user_id";
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_case_archive_evidence_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."creation_xid" := pg_current_xact_id();
    NEW."captured_at" := COALESCE(NEW."captured_at", CURRENT_TIMESTAMP);
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_case_refund_inventory_version()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."creation_xid" := pg_current_xact_id();
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_early_closure_locked_source_draft()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.source_stage_locked := true;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.freeze_payment_proof_document_metadata_draft()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    UPDATE materials SET payment_proof_frozen = true WHERE id = NEW.material_id;
    UPDATE content_versions SET payment_proof_frozen = true WHERE id = NEW.content_version_id;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.capture_case_section_record_anchor()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    SELECT COALESCE(to_jsonb(c), '{}'::jsonb) INTO NEW."case_anchor_snapshot"
    FROM "cases" c
    WHERE c."id" = NEW."case_id" AND c."department_id" = NEW."department_id";
    NEW."case_anchor_snapshot" := COALESCE(NEW."case_anchor_snapshot", '{}'::jsonb);
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.customer_ever_admitted_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.ever_admitted := COALESCE(OLD.ever_admitted, false) OR COALESCE(NEW.ever_admitted, false) OR (NEW.profile_status = 'ADMITTED');
  ELSE
    NEW.ever_admitted := COALESCE(NEW.ever_admitted, false) OR (NEW.profile_status = 'ADMITTED');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.stamp_lawyer_profile_account_anchor()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

DO $relax$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND pg_get_function_result(p.oid) = 'trigger'
      AND p.proname NOT IN (
        'case_bump_responsibility_epoch',
        'customer_ever_admitted_guard',
        'stamp_lawyer_profile_account_anchor',
        'classify_case_record_material_reference',
        'enforce_dual_actor_path',
        'guard_case_archive_evidence_snapshot',
        'guard_case_refund_inventory_version',
        'guard_early_closure_locked_source_draft',
        'freeze_payment_proof_document_metadata_draft',
        'capture_case_section_record_anchor'
      )
  LOOP
    EXECUTE format(
      'CREATE OR REPLACE FUNCTION public.%I() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN IF TG_OP = ''DELETE'' THEN RETURN OLD; END IF; RETURN NEW; END; $fn$',
      r.proname
    );
  END LOOP;
END;
$relax$;

-- 2. Relax overly strict table CHECK constraints that block historical data updates
ALTER TABLE "cases" DROP CONSTRAINT IF EXISTS "cases_complaint_state_check";
ALTER TABLE "cases" DROP CONSTRAINT IF EXISTS "cases_matching_state_check";
ALTER TABLE "cases" DROP CONSTRAINT IF EXISTS "cases_matched_on_state_check";
ALTER TABLE "case_archive_versions" DROP CONSTRAINT IF EXISTS "case_archive_versions_check2";
ALTER TABLE "case_closure_versions" DROP CONSTRAINT IF EXISTS "case_closure_versions_check3";

-- 3. Create deletion_audit_logs table (permanent deletion log with date, role, account, snapshot)
CREATE TABLE IF NOT EXISTS "deletion_audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "department_id" uuid NOT NULL,
  "entity_type" varchar(40) NOT NULL,
  "entity_id" uuid NOT NULL,
  "business_no" varchar(100),
  "entity_title" varchar(300),
  "actor_user_id" uuid NOT NULL,
  "actor_username" varchar(100) NOT NULL,
  "actor_display_name" varchar(200) NOT NULL,
  "actor_roles" text[] NOT NULL DEFAULT '{}',
  "delete_reason" text,
  "snapshot" jsonb NOT NULL,
  "deleted_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "deletion_audit_logs_dept_type_deleted_idx"
  ON "deletion_audit_logs" ("department_id", "entity_type", "deleted_at" DESC);
CREATE INDEX IF NOT EXISTS "deletion_audit_logs_business_no_idx"
  ON "deletion_audit_logs" ("business_no");

-- 4. Create legacy_attachments table (31,916 Aliyun OSS attachment bindings)
CREATE TABLE IF NOT EXISTS "legacy_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "legacy_attachment_id" bigint NOT NULL,
  "owner_type" varchar(30) NOT NULL,
  "owner_id" uuid NOT NULL,
  "legacy_owner_id" varchar(50),
  "category_code" varchar(60) NOT NULL,
  "category_label" varchar(100) NOT NULL,
  "title" varchar(500) NOT NULL,
  "filename" varchar(500) NOT NULL,
  "extname" varchar(50),
  "size_bytes" bigint,
  "mime_type" varchar(150),
  "oss_path" varchar(500),
  "oss_url" varchar(1000) NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "legacy_attachments_owner_category_att_key"
  ON "legacy_attachments" ("owner_type", "owner_id", "category_code", "legacy_attachment_id");
CREATE INDEX IF NOT EXISTS "legacy_attachments_owner_idx"
  ON "legacy_attachments" ("owner_type", "owner_id");

-- 5. Add omitted historical columns on cases, case_legacy_products, lead_products, customers
ALTER TABLE "cases"
  ADD COLUMN IF NOT EXISTS "legacy_mediation_no" varchar(200),
  ADD COLUMN IF NOT EXISTS "legacy_hearing_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_pleadings_lawyer_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_execution_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_execution_no" varchar(200),
  ADD COLUMN IF NOT EXISTS "legacy_notarization_number" varchar(200),
  ADD COLUMN IF NOT EXISTS "legacy_notarization_type" varchar(200),
  ADD COLUMN IF NOT EXISTS "legacy_notarization_platform" varchar(100),
  ADD COLUMN IF NOT EXISTS "legacy_notary_office" varchar(200),
  ADD COLUMN IF NOT EXISTS "legacy_notarization_upload_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_forensics_issue_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_clue_source" varchar(200),
  ADD COLUMN IF NOT EXISTS "legacy_clue_found_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_clue_push_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_clue_confirm_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_clue_approve_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_clue_purchase_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_clue_check_opinion" varchar(500),
  ADD COLUMN IF NOT EXISTS "legacy_clue_check_note" text,
  ADD COLUMN IF NOT EXISTS "legacy_clue_notes" text,
  ADD COLUMN IF NOT EXISTS "legacy_forensics_open_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_forensics_confirm_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_forensics_approve_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_forensics_check_opinion" varchar(1000),
  ADD COLUMN IF NOT EXISTS "legacy_forensics_check_note" text,
  ADD COLUMN IF NOT EXISTS "legacy_forensics_check_result" varchar(500),
  ADD COLUMN IF NOT EXISTS "legacy_forensics_check_info" text,
  ADD COLUMN IF NOT EXISTS "legacy_sender_name" varchar(200),
  ADD COLUMN IF NOT EXISTS "legacy_sender_phone" varchar(200),
  ADD COLUMN IF NOT EXISTS "legacy_sender_address" varchar(500),
  ADD COLUMN IF NOT EXISTS "legacy_sender_tracking" varchar(500);

ALTER TABLE "case_legacy_products"
  ADD COLUMN IF NOT EXISTS "tort_notes" text,
  ADD COLUMN IF NOT EXISTS "order_specs" varchar(500),
  ADD COLUMN IF NOT EXISTS "order_amount" numeric(16,2),
  ADD COLUMN IF NOT EXISTS "order_express" varchar(100),
  ADD COLUMN IF NOT EXISTS "order_tracking" varchar(200),
  ADD COLUMN IF NOT EXISTS "order_status" varchar(100),
  ADD COLUMN IF NOT EXISTS "exhibit_number" varchar(200),
  ADD COLUMN IF NOT EXISTS "exhibit_shelf" varchar(200),
  ADD COLUMN IF NOT EXISTS "exhibit_outbound" varchar(200),
  ADD COLUMN IF NOT EXISTS "return_amount" numeric(16,2),
  ADD COLUMN IF NOT EXISTS "return_shipping" numeric(16,2);

ALTER TABLE "lead_products"
  ADD COLUMN IF NOT EXISTS "legacy_tort_id" varchar(50),
  ADD COLUMN IF NOT EXISTS "tort_notes" text,
  ADD COLUMN IF NOT EXISTS "order_specs" varchar(500),
  ADD COLUMN IF NOT EXISTS "order_amount" numeric(16,2),
  ADD COLUMN IF NOT EXISTS "order_express" varchar(100),
  ADD COLUMN IF NOT EXISTS "order_tracking" varchar(200),
  ADD COLUMN IF NOT EXISTS "order_status" varchar(100),
  ADD COLUMN IF NOT EXISTS "exhibit_number" varchar(200),
  ADD COLUMN IF NOT EXISTS "exhibit_shelf" varchar(200),
  ADD COLUMN IF NOT EXISTS "exhibit_outbound" varchar(200),
  ADD COLUMN IF NOT EXISTS "return_amount" numeric(16,2),
  ADD COLUMN IF NOT EXISTS "return_shipping" numeric(16,2);

ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "legacy_sales_owner" varchar(100),
  ADD COLUMN IF NOT EXISTS "legacy_operations_owner" varchar(100),
  ADD COLUMN IF NOT EXISTS "legacy_mailing_address" text,
  ADD COLUMN IF NOT EXISTS "legacy_cooperation_content" text,
  ADD COLUMN IF NOT EXISTS "legacy_cooperation_model" varchar(200),
  ADD COLUMN IF NOT EXISTS "legacy_cooperation_start" date,
  ADD COLUMN IF NOT EXISTS "legacy_cooperation_end" date,
  ADD COLUMN IF NOT EXISTS "legacy_expense_note" text,
  ADD COLUMN IF NOT EXISTS "legacy_delivery_standard" text;

-- 6. Upgrade cascade delete helpers (preserve deletion_audit_logs and deletion audit_events)
CREATE OR REPLACE FUNCTION public.delete_legacy_case(p_case_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);

  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.column_name = 'case_id'
      AND c.table_schema = 'public'
      AND c.table_name <> 'cases'
      AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('DELETE FROM %I WHERE case_id = %L', r.table_name, p_case_id);
  END LOOP;

  DELETE FROM case_filing_consolidation_sources WHERE source_case_id = p_case_id;
  DELETE FROM settlement_actual_facts WHERE source_case_id = p_case_id;
  DELETE FROM case_consolidations WHERE main_case_id = p_case_id;
  DELETE FROM legacy_attachments WHERE owner_type = 'CASE' AND owner_id = p_case_id;
  DELETE FROM audit_events WHERE resource_id = p_case_id AND action NOT LIKE '%.delete%';
  DELETE FROM business_number_aliases WHERE entity_id = p_case_id;
  DELETE FROM cases WHERE id = p_case_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_notary_matter_cascade(p_matter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);

  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.column_name IN ('matter_id', 'notary_matter_id', 'source_notary_matter_id', 'result_matter_id', 'source_evidence_matter_id')
      AND c.table_schema = 'public'
      AND c.table_name NOT IN ('notary_matters', 'cases')
      AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('DELETE FROM %I WHERE %I = %L', r.table_name, r.column_name, p_matter_id);
  END LOOP;

  DELETE FROM legacy_attachments WHERE owner_type = 'NOTARY_MATTER' AND owner_id = p_matter_id;
  DELETE FROM audit_events WHERE resource_id = p_matter_id AND action NOT LIKE '%.delete%';
  DELETE FROM business_number_aliases WHERE entity_id = p_matter_id;
  DELETE FROM notary_matters WHERE id = p_matter_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_lead_cascade(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);

  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.column_name IN ('lead_id', 'source_lead_id', 'result_lead_id')
      AND c.table_schema = 'public'
      AND c.table_name NOT IN ('leads', 'notary_matters', 'cases')
      AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('DELETE FROM %I WHERE %I = %L', r.table_name, r.column_name, p_lead_id);
  END LOOP;

  DELETE FROM legacy_attachments WHERE owner_type = 'LEAD' AND owner_id = p_lead_id;
  DELETE FROM audit_events WHERE resource_id = p_lead_id AND action NOT LIKE '%.delete%';
  DELETE FROM business_number_aliases WHERE entity_id = p_lead_id;
  DELETE FROM leads WHERE id = p_lead_id;
END;
$function$;
