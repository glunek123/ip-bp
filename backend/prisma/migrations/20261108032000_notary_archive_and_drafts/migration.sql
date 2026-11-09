BEGIN;

CREATE TYPE "notary_archive_type" AS ENUM (
  'LINK_REMOVED', 'NO_INFRINGEMENT_INFORMATION', 'NO_EVIDENCE',
  'NOT_SHIPPED_REFUND_ONLY', 'RECEIVED_KEEP', 'RECEIVED_RETURN_REFUND'
);

ALTER TABLE "notary_return_archives"
  ALTER COLUMN "issuance_decision_id" DROP NOT NULL,
  ALTER COLUMN "issuance_decision_choice" DROP NOT NULL,
  ALTER COLUMN "return_choice" DROP NOT NULL,
  ADD COLUMN "from_stage" "notary_matter_stage",
  ADD COLUMN "archive_type" "notary_archive_type",
  ADD COLUMN "archive_date" DATE,
  ADD COLUMN "notary_fee_amount" DECIMAL(18, 2),
  ADD COLUMN "sample_fee_amount" DECIMAL(18, 2),
  ADD CONSTRAINT "notary_return_archives_stage_facts_check" CHECK (
    (
      (("from_stage" IS NULL OR "from_stage" = 'WAITING_RETURN')
        AND "return_choice" IS NOT NULL AND "issuance_decision_id" IS NOT NULL
        AND "issuance_decision_choice" IS NOT DISTINCT FROM 'NO_ISSUE')
      OR
      ("from_stage" IS NOT NULL AND "from_stage" NOT IN ('ARCHIVED', 'WAITING_RETURN')
        AND "return_choice" IS NULL AND "issuance_decision_id" IS NULL
        AND "issuance_decision_choice" IS NULL AND "sample_fee_amount" IS NOT NULL)
    )
    AND (
      ("from_stage" IS NULL AND "archive_type" IS NULL AND "archive_date" IS NULL
        AND "notary_fee_amount" IS NULL AND "sample_fee_amount" IS NULL)
      OR
      ("from_stage" IS NOT NULL AND "archive_type" IS NOT NULL
        AND "archive_date" IS NOT NULL AND "notary_fee_amount" IS NOT NULL
        AND "notary_fee_amount" >= 0 AND ("sample_fee_amount" IS NULL OR "sample_fee_amount" >= 0))
    )
  );

ALTER TABLE "notary_certificates"
  ADD COLUMN "sample_fee_amount" DECIMAL(18, 2) CHECK ("sample_fee_amount" >= 0),
  ADD COLUMN "disclosure_info" TEXT,
  ADD CONSTRAINT "notary_certificates_disclosure_info_check" CHECK (
    "disclosure_info" IS NULL OR ("need_disclose" AND char_length("disclosure_info") BETWEEN 1 AND 2000)
  );

CREATE TABLE "notary_evidence_drafts" (
  "matter_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "matter_version" INTEGER NOT NULL CHECK ("matter_version" > 0),
  "payload" JSONB NOT NULL,
  CONSTRAINT "notary_evidence_drafts_pkey" PRIMARY KEY ("matter_id", "actor_user_id"),
  CONSTRAINT "notary_evidence_drafts_matter_id_department_id_fkey"
    FOREIGN KEY ("matter_id", "department_id") REFERENCES "notary_matters" ("id", "department_id")
    ON DELETE CASCADE ON UPDATE RESTRICT
);

COMMIT;
