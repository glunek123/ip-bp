BEGIN;

ALTER TABLE "notary_return_archives"
  DROP CONSTRAINT "notary_return_archives_reason_check",
  ADD CONSTRAINT "notary_return_archives_reason_check" CHECK (
    CHAR_LENGTH("archive_reason") BETWEEN 1 AND 5000
    AND "archive_reason" ~ '[^[:space:]]'
    AND "archive_reason" !~ '^[[:space:]]|[[:space:]]$'
  );

ALTER TABLE "notary_return_amounts"
  DROP CONSTRAINT "notary_return_amounts_party_check",
  ADD CONSTRAINT "notary_return_amounts_party_check" CHECK (
    (("state" = 'KNOWN' AND "amount" > 0) = ("party_kind" IS NOT NULL))
    AND COALESCE("party_kind" = 'OTHER', FALSE) = ("party_name" IS NOT NULL)
    AND (
      "party_name" IS NULL OR (
        CHAR_LENGTH("party_name") BETWEEN 1 AND 200
        AND "party_name" ~ '[^[:space:]]'
        AND "party_name" !~ '^[[:space:]]|[[:space:]]$'
      )
    )
  );

COMMIT;
