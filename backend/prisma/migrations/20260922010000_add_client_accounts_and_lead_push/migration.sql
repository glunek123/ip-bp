BEGIN;

ALTER TYPE "permission_action" ADD VALUE 'lead.push';
ALTER TYPE "permission_action" ADD VALUE 'client.lead.read';
CREATE TYPE "user_account_type" AS ENUM ('INTERNAL', 'CLIENT');

COMMIT;

BEGIN;

ALTER TABLE "user_accounts"
  ADD COLUMN "account_type" "user_account_type" NOT NULL DEFAULT 'INTERNAL';

CREATE TABLE "customer_account_bindings" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "customer_account_bindings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_account_bindings_user_id_key" UNIQUE ("user_id"),
  CONSTRAINT "customer_account_bindings_version_positive_check" CHECK ("version" >= 1)
);

CREATE INDEX "customer_account_bindings_customer_department_active_idx"
  ON "customer_account_bindings"("customer_id", "department_id", "active");

ALTER TABLE "customer_account_bindings"
  ADD CONSTRAINT "customer_account_bindings_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "customer_account_bindings_department_id_fkey"
    FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "customer_account_bindings_customer_department_fkey"
    FOREIGN KEY ("customer_id", "department_id") REFERENCES "customers"("id", "department_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "leads"
  ADD COLUMN "pushed_at" TIMESTAMPTZ(3),
  ADD COLUMN "pushed_by_user_id" UUID,
  ADD CONSTRAINT "leads_push_fields_paired_check" CHECK (
    ("pushed_at" IS NULL AND "pushed_by_user_id" IS NULL)
    OR ("pushed_at" IS NOT NULL AND "pushed_by_user_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "leads_pushed_by_user_id_fkey"
    FOREIGN KEY ("pushed_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION reject_client_internal_membership()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "user_accounts"
    WHERE "id" = NEW."user_id" AND "account_type" = 'CLIENT'
  ) THEN
    RAISE EXCEPTION 'client accounts cannot have internal memberships or role assignments'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "department_memberships_reject_client_account"
BEFORE INSERT OR UPDATE OF "user_id" ON "department_memberships"
FOR EACH ROW EXECUTE FUNCTION reject_client_internal_membership();

CREATE TRIGGER "role_assignments_reject_client_account"
BEFORE INSERT OR UPDATE OF "user_id" ON "role_assignments"
FOR EACH ROW EXECUTE FUNCTION reject_client_internal_membership();

CREATE OR REPLACE FUNCTION reject_internal_client_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "user_accounts"
    WHERE "id" = NEW."user_id" AND "account_type" = 'CLIENT'
  ) OR EXISTS (
    SELECT 1 FROM "department_memberships" WHERE "user_id" = NEW."user_id"
  ) OR EXISTS (
    SELECT 1 FROM "role_assignments" WHERE "user_id" = NEW."user_id"
  ) THEN
    RAISE EXCEPTION 'client binding requires a client-only account'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "customer_account_bindings_reject_internal_account"
BEFORE INSERT OR UPDATE OF "user_id" ON "customer_account_bindings"
FOR EACH ROW EXECUTE FUNCTION reject_internal_client_binding();

CREATE OR REPLACE FUNCTION enforce_user_account_type_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."account_type" = OLD."account_type" THEN
    RETURN NEW;
  END IF;
  IF NEW."account_type" = 'CLIENT' AND (
    EXISTS (SELECT 1 FROM "department_memberships" WHERE "user_id" = NEW."id")
    OR EXISTS (SELECT 1 FROM "role_assignments" WHERE "user_id" = NEW."id")
  ) THEN
    RAISE EXCEPTION 'internal account relationships prevent client conversion'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."account_type" = 'INTERNAL' AND EXISTS (
    SELECT 1 FROM "customer_account_bindings" WHERE "user_id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'client binding prevents internal conversion'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "user_accounts_enforce_account_type_change"
BEFORE UPDATE OF "account_type" ON "user_accounts"
FOR EACH ROW EXECUTE FUNCTION enforce_user_account_type_change();

LOCK TABLE "department_memberships", "role_assignments", "role_templates", "role_grants", "local_credentials", "user_accounts"
IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE "bootstrap_roles_to_upgrade" ON COMMIT DROP AS
SELECT "assignment"."role_template_id", "assignment"."user_id"
FROM "role_assignments" AS "assignment"
JOIN "role_templates" AS "role"
  ON "role"."id" = "assignment"."role_template_id"
 AND "role"."department_id" = "assignment"."department_id"
JOIN "department_memberships" AS "membership"
  ON "membership"."user_id" = "assignment"."user_id"
 AND "membership"."department_id" = "assignment"."department_id"
JOIN "local_credentials" AS "credential"
  ON "credential"."user_id" = "assignment"."user_id"
WHERE "assignment"."active" = true
  AND "assignment"."team_id" IS NULL
  AND "role"."active" = true
  AND "membership"."active" = true
  AND (
    SELECT COUNT(DISTINCT "local_membership"."user_id")
    FROM "department_memberships" AS "local_membership"
    JOIN "local_credentials" AS "local_credential"
      ON "local_credential"."user_id" = "local_membership"."user_id"
    WHERE "local_membership"."department_id" = "assignment"."department_id"
      AND "local_membership"."active" = true
  ) = 1
  AND (
    SELECT COUNT(*) FROM "role_assignments" AS "active_assignment"
    WHERE "active_assignment"."user_id" = "assignment"."user_id"
      AND "active_assignment"."department_id" = "assignment"."department_id"
      AND "active_assignment"."active" = true
  ) = 1
  AND NOT EXISTS (
    SELECT 1 FROM "role_assignments" AS "shared_assignment"
    WHERE "shared_assignment"."role_template_id" = "assignment"."role_template_id"
      AND "shared_assignment"."user_id" <> "assignment"."user_id"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('customer.read'::"permission_action"),
      ('customer.create-draft'::"permission_action"),
      ('customer.edit-routine'::"permission_action"),
      ('customer.admit'::"permission_action"),
      ('lead.read'::"permission_action"),
      ('lead.create'::"permission_action"),
      ('lead.edit'::"permission_action"),
      ('user.read'::"permission_action"),
      ('user.manage'::"permission_action"),
      ('team.read'::"permission_action"),
      ('team.manage'::"permission_action"),
      ('role.read'::"permission_action"),
      ('role.assign'::"permission_action"),
      ('role.manage'::"permission_action")
    ) AS "required"("action")
    WHERE NOT EXISTS (
      SELECT 1 FROM "role_grants" AS "grant"
      WHERE "grant"."role_template_id" = "assignment"."role_template_id"
        AND "grant"."action" = "required"."action"
        AND "grant"."scope" = 'DEPARTMENT'
    )
  );

INSERT INTO "role_grants"("id", "role_template_id", "action", "scope")
SELECT (
         SUBSTR(MD5("candidate"."role_template_id"::text || ':lead.push'), 1, 8) || '-' ||
         SUBSTR(MD5("candidate"."role_template_id"::text || ':lead.push'), 9, 4) || '-4' ||
         SUBSTR(MD5("candidate"."role_template_id"::text || ':lead.push'), 14, 3) || '-8' ||
         SUBSTR(MD5("candidate"."role_template_id"::text || ':lead.push'), 18, 3) || '-' ||
         SUBSTR(MD5("candidate"."role_template_id"::text || ':lead.push'), 21, 12)
       )::uuid,
       "candidate"."role_template_id", 'lead.push'::"permission_action", 'DEPARTMENT'
FROM "bootstrap_roles_to_upgrade" AS "candidate"
ON CONFLICT ("role_template_id", "action", "scope") DO NOTHING;

UPDATE "user_accounts" AS "account"
SET "authorization_revision" = "authorization_revision" + 1,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "account"."id" IN (
  SELECT "user_id" FROM "bootstrap_roles_to_upgrade"
);

COMMIT;
