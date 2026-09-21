BEGIN;

-- A legacy receipt can only be reconstructed from the current customer when the
-- aggregate has not changed since that receipt was written. Never fabricate a
-- historical response by combining current fields with an older receipt version.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "customer_admission_receipts" AS receipt
    LEFT JOIN "customers" AS customer
      ON customer."id" = receipt."result_customer_id"
      AND customer."department_id" = receipt."department_id"
    WHERE customer."id" IS NULL
      OR customer."version" <> receipt."result_customer_version"
  ) THEN
    RAISE EXCEPTION
      'cannot backfill customer admission receipt snapshots: current customer version does not match receipt version; restore or remove unsupported legacy receipts before retrying';
  END IF;
END $$;

-- Align historical customer identities with the single application canonical form
-- before future writes rely on the department/type/number unique constraint.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "customers"
    WHERE "identity_type" IS NOT NULL
      AND "identity_number" IS NOT NULL
    GROUP BY
      "department_id",
      "identity_type",
      regexp_replace(
        upper(btrim(normalize("identity_number", NFKC))),
        '[[:space:]-]+',
        '',
        'g'
      )
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'cannot canonicalize customer identity numbers: duplicate department/type/number values exist';
  END IF;
END $$;

UPDATE "customers"
SET "identity_number" = upper(
      regexp_replace(
        btrim(normalize("identity_number", NFKC)),
        '[[:space:]]+',
        ' ',
        'g'
      )
    ),
    "normalized_identity_number" = regexp_replace(
      upper(btrim(normalize("identity_number", NFKC))),
      '[[:space:]-]+',
      '',
      'g'
    )
WHERE "identity_number" IS NOT NULL;

ALTER TABLE "customer_admission_receipts"
  ADD COLUMN "result_snapshot" JSONB;

UPDATE "customer_admission_receipts" AS receipt
SET "result_snapshot" = jsonb_build_object(
  'id', customer."id"::text,
  'name', customer."name",
  'customerType', customer."customer_type",
  'identityType', customer."identity_type",
  'identityNumber', customer."identity_number",
  'issuingCountryOrRegion', customer."issuing_country_or_region",
  'category', customer."category",
  'region', customer."region",
  'admissionContactName', customer."admission_contact_name",
  'admissionContactPhone', customer."admission_contact_phone",
  'admissionContactEmail', customer."admission_contact_email",
  'identityValidFrom', CASE
    WHEN customer."identity_valid_from" IS NULL THEN NULL
    ELSE to_char(customer."identity_valid_from", 'YYYY-MM-DD')
  END,
  'identityValidTo', CASE
    WHEN customer."identity_valid_to" IS NULL THEN NULL
    ELSE to_char(customer."identity_valid_to", 'YYYY-MM-DD')
  END,
  'identityValidityMode', customer."identity_validity_mode"::text,
  'admittedAt', CASE
    WHEN customer."admitted_at" IS NULL THEN NULL
    ELSE to_char(customer."admitted_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  END,
  'profileStatus', lower(customer."profile_status"::text),
  'departmentId', customer."department_id"::text,
  'responsibleUserId', customer."responsible_user_id"::text,
  'version', receipt."result_customer_version",
  'updatedAt', to_char(customer."updated_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
)
FROM "customers" AS customer
WHERE customer."id" = receipt."result_customer_id"
  AND customer."department_id" = receipt."department_id";

ALTER TABLE "customer_admission_receipts"
  ALTER COLUMN "result_snapshot" SET NOT NULL;

COMMIT;
