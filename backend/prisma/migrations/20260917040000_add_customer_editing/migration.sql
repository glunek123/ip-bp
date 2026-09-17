BEGIN;

ALTER TYPE "permission_action" ADD VALUE 'customer.edit-routine';

ALTER TABLE "customers"
ADD COLUMN "customer_type" TEXT,
ADD COLUMN "identity_type" TEXT,
ADD COLUMN "identity_number" TEXT,
ADD COLUMN "issuing_country_or_region" TEXT;

CREATE UNIQUE INDEX "customers_department_id_identity_type_identity_number_key"
ON "customers"("department_id", "identity_type", "identity_number");

COMMIT;
