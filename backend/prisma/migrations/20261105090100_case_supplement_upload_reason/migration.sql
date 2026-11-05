ALTER TABLE "upload_drafts" ADD COLUMN "case_supplement_reason" varchar(1000);
ALTER TABLE "upload_drafts" ADD CONSTRAINT "case_supplement_upload_reason_scope" CHECK (
  ("category" IN ('CASE_PRESERVATION_DOCUMENT', 'CASE_COURT_DISCLOSURE_ATTACHMENT', 'CASE_RECORD_RETRIEVAL_DOCUMENT', 'EXECUTION_FORMAL_DOCUMENT') AND "case_supplement_reason" IS NOT NULL AND length(btrim("case_supplement_reason")) > 0)
  OR
  ("category" NOT IN ('CASE_PRESERVATION_DOCUMENT', 'CASE_COURT_DISCLOSURE_ATTACHMENT', 'CASE_RECORD_RETRIEVAL_DOCUMENT', 'EXECUTION_FORMAL_DOCUMENT') AND "case_supplement_reason" IS NULL)
);
