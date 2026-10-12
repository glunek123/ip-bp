-- Prisma requires the complete scoped source key for these one-to-one relations.
-- Existing single-source uniqueness already protects the business cardinality.
BEGIN;
CREATE UNIQUE INDEX "case_execution_mailings_confirmation_case_department_key"
  ON "case_execution_mailings" ("confirmation_id", "case_id", "department_id");
CREATE UNIQUE INDEX "case_execution_filings_mailing_case_department_key"
  ON "case_execution_filings" ("mailing_id", "case_id", "department_id");
COMMIT;
