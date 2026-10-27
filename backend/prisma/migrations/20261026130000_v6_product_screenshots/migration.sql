-- Source-only draft. Apply only after the separately authorized PostgreSQL review.
CREATE TABLE "lead_product_screenshots" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "content_version_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lead_product_screenshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lead_product_screenshots_content_version_id_key"
    ON "lead_product_screenshots"("content_version_id");
CREATE INDEX "lead_product_screenshots_lead_id_department_id_idx"
    ON "lead_product_screenshots"("lead_id", "department_id");
CREATE UNIQUE INDEX "lead_product_screenshots_material_id_content_version_id_key"
    ON "lead_product_screenshots"("material_id", "content_version_id");

ALTER TABLE "lead_product_screenshots" ADD CONSTRAINT "lead_product_screenshots_lead_id_department_id_fkey"
    FOREIGN KEY ("lead_id", "department_id") REFERENCES "leads"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "lead_product_screenshots" ADD CONSTRAINT "lead_product_screenshots_product_id_lead_id_fkey"
    FOREIGN KEY ("product_id", "lead_id") REFERENCES "lead_products"("id", "lead_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "lead_product_screenshots" ADD CONSTRAINT "lead_product_screenshots_material_id_department_id_fkey"
    FOREIGN KEY ("material_id", "department_id") REFERENCES "materials"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "lead_product_screenshots" ADD CONSTRAINT "lead_product_screenshots_material_id_content_version_id_fkey"
    FOREIGN KEY ("material_id", "content_version_id") REFERENCES "content_versions"("material_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- A foreign key verifies identities, but cannot verify the material's current
-- Lead owner, category, purpose, or attachable version status. This trigger is
-- evaluated only when the current product association is written. Later
-- material deletion/restoration does not mutate a historical reference.
CREATE FUNCTION "guard_lead_product_screenshot"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM "leads" AS l
      JOIN "materials" AS m
        ON m."owner_id" = l."id"
       AND m."department_id" = l."department_id"
      JOIN "content_versions" AS cv
        ON cv."material_id" = m."id"
       AND cv."id" = NEW."content_version_id"
     WHERE m."id" = NEW."material_id"
       AND l."id" = NEW."lead_id"
       AND l."department_id" = NEW."department_id"
       AND l."status" <> 'ARCHIVED'
       AND m."department_id" = NEW."department_id"
       AND m."owner_type" = 'LEAD'
       AND m."owner_id" = NEW."lead_id"
       AND m."category" = 'LEAD_SCREENSHOT'
       AND m."purpose" = 'LEAD_SCREENSHOT'
       AND m."status" = 'ACTIVE'
       AND cv."status" = 'AVAILABLE'
     FOR SHARE OF l, m, cv
  ) THEN
    RAISE EXCEPTION 'Product screenshot material does not match its Lead or available version'
      USING ERRCODE = '23514', CONSTRAINT = 'lead_product_screenshots_material_guard';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "lead_product_screenshots_material_guard"
BEFORE INSERT OR UPDATE ON "lead_product_screenshots"
FOR EACH ROW EXECUTE FUNCTION "guard_lead_product_screenshot"();

-- Legacy lead-level screenshot references remain unassigned until a user identifies the product.
