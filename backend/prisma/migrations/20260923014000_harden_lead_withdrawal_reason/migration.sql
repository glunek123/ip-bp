BEGIN;

-- The first history migration already protects length and outer spaces.
-- This forward refinement also rejects strings made only of whitespace.
ALTER TABLE "lead_withdrawal_applications"
  DROP CONSTRAINT "lead_withdrawal_applications_reason_check",
  ADD CONSTRAINT "lead_withdrawal_applications_reason_check"
    CHECK (
      "reason" = BTRIM("reason")
      AND "reason" ~ '[^[:space:]]'
      AND CHAR_LENGTH("reason") BETWEEN 1 AND 5000
    );

COMMIT;
