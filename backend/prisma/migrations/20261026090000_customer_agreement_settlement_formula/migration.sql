-- Record the customer's agreement text without evaluating it or changing case terms.
ALTER TABLE "customer_agreement_versions"
  ADD COLUMN "settlement_formula" VARCHAR(500);

ALTER TABLE "customer_agreement_versions"
  ADD CONSTRAINT "customer_agreement_settlement_formula_text"
  CHECK (
    "settlement_formula" IS NULL OR (
      "settlement_formula" = btrim("settlement_formula") AND
      char_length("settlement_formula") BETWEEN 1 AND 500
    )
  );
