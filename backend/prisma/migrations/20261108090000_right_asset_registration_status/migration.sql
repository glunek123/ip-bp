BEGIN;

CREATE TYPE "customer_right_asset_status" AS ENUM ('VALID', 'INVALID');

ALTER TABLE "customer_right_assets"
  ALTER COLUMN "holder_id" DROP NOT NULL;

ALTER TABLE "customer_right_asset_versions"
  ALTER COLUMN "holder_id" DROP NOT NULL,
  ADD COLUMN "registration_date" DATE,
  ADD COLUMN "status" "customer_right_asset_status";

ALTER TABLE "customer_right_asset_versions"
  ADD CONSTRAINT "customer_right_asset_versions_registration_period_check"
  CHECK ("registration_date" IS NULL OR "valid_to" IS NULL OR "registration_date" <= "valid_to");

ALTER TABLE "customer_right_asset_versions"
  ADD CONSTRAINT "customer_right_asset_versions_owner_source_check"
  CHECK ("holder_id" IS NOT NULL OR "owner_text" IS NOT NULL);

ALTER TABLE "customer_right_asset_versions"
  ADD CONSTRAINT "customer_right_asset_versions_new_status_check"
  CHECK ("action" <> 'CREATE' OR "status" IS NOT NULL) NOT VALID;

COMMIT;
