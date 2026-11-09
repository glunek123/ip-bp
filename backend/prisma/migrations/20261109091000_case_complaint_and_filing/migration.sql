ALTER TABLE "case_complaint_mailings"
  ADD COLUMN "remark" VARCHAR(1000);

ALTER TABLE "case_complaint_confirmations"
  ALTER COLUMN "confirm_disclose" DROP NOT NULL;

ALTER TABLE "case_filing_submissions"
  ADD COLUMN "claim_amount" DECIMAL(16,2);
