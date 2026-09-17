BEGIN;

ALTER TABLE "customers"
ADD COLUMN "normalized_name" TEXT,
ADD COLUMN "normalized_identity_number" TEXT;

UPDATE "customers"
SET
  "normalized_name" = regexp_replace(btrim(normalize("name", NFKC)), '\s+', ' ', 'g'),
  "normalized_identity_number" = CASE
    WHEN "identity_number" IS NULL THEN NULL
    ELSE upper(regexp_replace(btrim(normalize("identity_number", NFKC)), '\s+', ' ', 'g'))
  END;

ALTER TABLE "customers"
ALTER COLUMN "normalized_name" SET NOT NULL;

DROP INDEX "customers_department_id_identity_type_identity_number_key";

CREATE INDEX "customers_department_id_normalized_name_idx"
ON "customers"("department_id", "normalized_name");

CREATE UNIQUE INDEX "customers_department_id_identity_type_normalized_identity_number_key"
ON "customers"("department_id", "identity_type", "normalized_identity_number");

COMMIT;
