ALTER TYPE "user_account_type" ADD VALUE IF NOT EXISTS 'NOTARY';

BEGIN;

CREATE TABLE "notary_office_account_bindings" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "notary_office_id" UUID NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "notary_office_account_bindings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notary_office_account_bindings_user_id_key" UNIQUE ("user_id"),
  CONSTRAINT "notary_office_account_bindings_id_user_department_key" UNIQUE ("id", "user_id", "department_id"),
  CONSTRAINT "notary_office_account_bindings_version_check" CHECK ("version" >= 1),
  CONSTRAINT "notary_office_account_bindings_user_fkey" FOREIGN KEY ("user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_office_account_bindings_department_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_office_account_bindings_office_department_fkey" FOREIGN KEY ("notary_office_id", "department_id") REFERENCES "notary_offices"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "notary_office_account_bindings_office_department_active_idx" ON "notary_office_account_bindings"("notary_office_id", "department_id", "active");

CREATE FUNCTION enforce_notary_binding_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."user_id", NEW."department_id", NEW."notary_office_id") IS DISTINCT FROM
      (OLD."user_id", OLD."department_id", OLD."notary_office_id") THEN
    RAISE EXCEPTION 'notary account binding identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "user_accounts" WHERE "id" = NEW."user_id" AND "account_type" = 'NOTARY') THEN
    RAISE EXCEPTION 'notary binding requires a notary account' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "notary_binding_identity" BEFORE INSERT OR UPDATE ON "notary_office_account_bindings"
  FOR EACH ROW EXECUTE FUNCTION enforce_notary_binding_identity();

CREATE OR REPLACE FUNCTION reject_client_internal_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "user_accounts" WHERE "id" = NEW."user_id" AND "account_type" <> 'INTERNAL') THEN
    RAISE EXCEPTION 'external accounts cannot have internal memberships or role assignments' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_user_account_type_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."account_type" IS DISTINCT FROM OLD."account_type" THEN
    RAISE EXCEPTION 'account type is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION assert_client_account_binding_cardinality(target_user_id UUID) RETURNS void LANGUAGE plpgsql AS $$
DECLARE account_kind "user_account_type"; binding_count BIGINT;
BEGIN
  SELECT "account_type" INTO account_kind FROM "user_accounts" WHERE "id" = target_user_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT COUNT(*) INTO binding_count FROM "customer_account_bindings" WHERE "user_id" = target_user_id;
  IF (account_kind = 'CLIENT' AND binding_count <> 1) OR (account_kind <> 'CLIENT' AND binding_count <> 0) THEN
    RAISE EXCEPTION 'client binding cardinality invalid' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION assert_notary_account_binding_cardinality(target_user_id UUID) RETURNS void LANGUAGE plpgsql AS $$
DECLARE account_kind "user_account_type"; binding_count BIGINT;
BEGIN
  SELECT "account_type" INTO account_kind FROM "user_accounts" WHERE "id" = target_user_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT COUNT(*) INTO binding_count FROM "notary_office_account_bindings" WHERE "user_id" = target_user_id;
  IF (account_kind = 'NOTARY' AND binding_count <> 1) OR (account_kind <> 'NOTARY' AND binding_count <> 0) THEN
    RAISE EXCEPTION 'notary binding cardinality invalid' USING ERRCODE = '23514';
  END IF;
END;
$$;
CREATE FUNCTION enforce_user_notary_binding_cardinality() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM assert_notary_account_binding_cardinality(NEW."id"); RETURN NEW; END;
$$;
CREATE CONSTRAINT TRIGGER "user_accounts_notary_binding_cardinality" AFTER INSERT OR UPDATE OF "account_type" ON "user_accounts"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_user_notary_binding_cardinality();
CREATE FUNCTION enforce_binding_notary_account_cardinality() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM assert_notary_account_binding_cardinality(OLD."user_id"); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM assert_notary_account_binding_cardinality(NEW."user_id"); END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE CONSTRAINT TRIGGER "notary_office_account_bindings_cardinality" AFTER INSERT OR UPDATE OR DELETE ON "notary_office_account_bindings"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_binding_notary_account_cardinality();

-- Retain the historical internal membership FK through a dedicated nullable column.
-- Existing internal callers keep writing actor_user_id; the trigger fills that column.
ALTER TABLE "upload_drafts" DROP CONSTRAINT "upload_drafts_actor_department_fkey";
ALTER TABLE "notary_matter_opening" DROP CONSTRAINT "notary_matter_opening_actor_department_fkey";
ALTER TABLE "notary_matter_command_receipts" DROP CONSTRAINT "notary_matter_receipts_actor_department_fkey";
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_actor_user_id_department_id_fkey";

ALTER TABLE "upload_drafts" ADD COLUMN "internal_actor_user_id" UUID, ADD COLUMN "notary_office_account_binding_id" UUID;
ALTER TABLE "notary_matter_opening" ADD COLUMN "internal_actor_user_id" UUID, ADD COLUMN "notary_office_account_binding_id" UUID;
ALTER TABLE "notary_matter_command_receipts" ADD COLUMN "internal_actor_user_id" UUID, ADD COLUMN "notary_office_account_binding_id" UUID;
ALTER TABLE "audit_events" ADD COLUMN "internal_actor_user_id" UUID, ADD COLUMN "notary_office_account_binding_id" UUID;

UPDATE "upload_drafts" SET "internal_actor_user_id" = "actor_user_id";
-- The existing opening fact is immutable to ordinary updates. This migration
-- only adds the equivalent historical actor FK; both trigger changes and the
-- backfill are transactional, so a failure restores the original trigger.
ALTER TABLE "notary_matter_opening" DISABLE TRIGGER reject_notary_opening_update_delete;
UPDATE "notary_matter_opening" SET "internal_actor_user_id" = "recorded_by_user_id";
ALTER TABLE "notary_matter_opening" ENABLE TRIGGER reject_notary_opening_update_delete;
UPDATE "notary_matter_command_receipts" SET "internal_actor_user_id" = "actor_user_id";
UPDATE "audit_events" SET "internal_actor_user_id" = "actor_user_id";

CREATE FUNCTION enforce_dual_actor_path() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE identity_user_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'notary_matter_opening' THEN identity_user_id := NEW."recorded_by_user_id";
  ELSE identity_user_id := NEW."actor_user_id"; END IF;
  IF NEW."notary_office_account_binding_id" IS NULL THEN
    NEW."internal_actor_user_id" := identity_user_id;
  ELSE
    IF NEW."internal_actor_user_id" IS NOT NULL THEN
      RAISE EXCEPTION 'exactly one actor path is required' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "upload_drafts_dual_actor" BEFORE INSERT OR UPDATE ON "upload_drafts" FOR EACH ROW EXECUTE FUNCTION enforce_dual_actor_path();
CREATE TRIGGER "notary_matter_opening_dual_actor" BEFORE INSERT ON "notary_matter_opening" FOR EACH ROW EXECUTE FUNCTION enforce_dual_actor_path();
CREATE TRIGGER "notary_matter_receipts_dual_actor" BEFORE INSERT OR UPDATE ON "notary_matter_command_receipts" FOR EACH ROW EXECUTE FUNCTION enforce_dual_actor_path();
CREATE TRIGGER "audit_events_dual_actor" BEFORE INSERT OR UPDATE ON "audit_events" FOR EACH ROW EXECUTE FUNCTION enforce_dual_actor_path();

DO $$
DECLARE table_name TEXT; identity_column TEXT; prefix TEXT;
BEGIN
  FOR table_name, identity_column, prefix IN SELECT * FROM (VALUES
    ('upload_drafts', 'actor_user_id', 'upload_drafts'),
    ('notary_matter_opening', 'recorded_by_user_id', 'notary_matter_opening'),
    ('notary_matter_command_receipts', 'actor_user_id', 'notary_matter_receipts'),
    ('audit_events', 'actor_user_id', 'audit_events')
  ) AS v(t, c, p) LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ((internal_actor_user_id IS NOT NULL) <> (notary_office_account_binding_id IS NOT NULL))', table_name, prefix || '_actor_path_check');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (internal_actor_user_id IS NULL OR internal_actor_user_id = %I)', table_name, prefix || '_internal_actor_identity_check', identity_column);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (internal_actor_user_id, department_id) REFERENCES department_memberships(user_id, department_id) ON DELETE RESTRICT ON UPDATE RESTRICT', table_name, prefix || '_internal_actor_fkey');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (notary_office_account_binding_id, %I, department_id) REFERENCES notary_office_account_bindings(id, user_id, department_id) ON DELETE RESTRICT ON UPDATE RESTRICT', table_name, prefix || '_notary_actor_fkey', identity_column);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES user_accounts(id) ON DELETE RESTRICT ON UPDATE RESTRICT', table_name, prefix || '_actor_user_fkey', identity_column);
  END LOOP;
END;
$$;

COMMIT;
