ALTER TABLE "notary_matters"
  ALTER COLUMN "evidence_mode" DROP NOT NULL,
  ALTER COLUMN "batch_purpose" DROP NOT NULL;

ALTER TABLE "notary_matters" DROP CONSTRAINT "notary_matters_purpose_check";
ALTER TABLE "notary_matters" ADD CONSTRAINT "notary_matters_purpose_check"
  CHECK ("batch_purpose" IS NULL OR (
    "batch_purpose" = BTRIM("batch_purpose")
    AND CHAR_LENGTH("batch_purpose") BETWEEN 1 AND 500
  ));
