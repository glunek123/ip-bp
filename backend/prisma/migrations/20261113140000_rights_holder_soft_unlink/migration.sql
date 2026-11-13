ALTER TABLE "customer_rights_holder_links"
  ADD COLUMN IF NOT EXISTS "unlinked_at" TIMESTAMPTZ(3);

ALTER TABLE "customer_rights_holder_links"
  DROP CONSTRAINT IF EXISTS "customer_rights_holder_links_customer_holder_key";
ALTER TABLE "customer_rights_holder_links"
  DROP CONSTRAINT IF EXISTS "customer_rights_holder_links_customer_id_rights_holder_id_department_id_key";

CREATE UNIQUE INDEX IF NOT EXISTS "customer_rights_holder_links_active_key"
  ON "customer_rights_holder_links" ("customer_id", "rights_holder_id")
  WHERE "unlinked_at" IS NULL;
