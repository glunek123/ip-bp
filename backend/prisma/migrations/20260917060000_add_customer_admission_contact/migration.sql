BEGIN;

ALTER TABLE "customers"
  ADD COLUMN "admission_contact_name" TEXT,
  ADD COLUMN "admission_contact_phone" TEXT,
  ADD COLUMN "admission_contact_email" TEXT;

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_admission_contact_complete_check"
  CHECK (
    (
      "admission_contact_name" IS NULL
      AND "admission_contact_phone" IS NULL
      AND "admission_contact_email" IS NULL
    )
    OR (
      "admission_contact_name" IS NOT NULL
      AND (
        "admission_contact_phone" IS NOT NULL
        OR "admission_contact_email" IS NOT NULL
      )
    )
  );

COMMIT;
