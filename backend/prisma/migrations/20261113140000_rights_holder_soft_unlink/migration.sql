ALTER TABLE "customer_rights_holder_links"
  ADD COLUMN IF NOT EXISTS "unlinked_at" TIMESTAMPTZ(3);
