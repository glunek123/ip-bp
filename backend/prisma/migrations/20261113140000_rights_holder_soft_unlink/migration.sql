ALTER TABLE "customer_rights_holder_links" ADD COLUMN "unlinked_at" TIMESTAMPTZ(3);

DROP INDEX IF EXISTS "customer_rights_holder_links_customer_id_rights_holder_id_department_id_key";
DROP INDEX IF EXISTS "customer_rights_holder_links_customer_holder_key";
DROP INDEX IF EXISTS "customer_rights_holder_links_owner_key";

CREATE UNIQUE INDEX "customer_rights_holder_links_active_key"
  ON "customer_rights_holder_links" ("customer_id", "rights_holder_id")
  WHERE "unlinked_at" IS NULL;
