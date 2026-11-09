ALTER TABLE "notary_opening_review_decisions"
  DROP CONSTRAINT "notary_opening_review_decisions_result_check";

ALTER TABLE "notary_opening_review_decisions"
  ADD CONSTRAINT "notary_opening_review_decisions_result_check" CHECK (
    ("result" = 'INFRINGEMENT' AND "reason" IS NULL AND "archived_at" IS NULL)
    OR (
      "result" = 'NO_INFRINGEMENT'
      AND (
        ("reason" IS NULL AND "archived_at" IS NULL)
        OR (
          "reason" IS NOT NULL
          AND "reason" = BTRIM("reason")
          AND CHAR_LENGTH("reason") BETWEEN 1 AND 2000
        )
      )
    )
  );

ALTER TABLE "notary_issuance_decisions"
  DROP CONSTRAINT "notary_issuance_decisions_review_result_check";

ALTER TABLE "notary_issuance_decisions"
  ADD COLUMN "opening_remark" TEXT;

ALTER TABLE "notary_issuance_decisions"
  ADD CONSTRAINT "notary_issuance_decisions_opening_remark_check" CHECK (
    "opening_remark" IS NULL
    OR (
      "opening_remark" = BTRIM("opening_remark")
      AND CHAR_LENGTH("opening_remark") BETWEEN 1 AND 2000
    )
  );
