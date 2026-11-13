CREATE UNIQUE INDEX IF NOT EXISTS "customer_rights_holder_links_customer_holder_key"
  ON "customer_rights_holder_links" ("customer_id", "rights_holder_id");
