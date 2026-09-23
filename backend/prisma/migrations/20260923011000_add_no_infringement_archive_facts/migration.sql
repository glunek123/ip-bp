BEGIN;
CREATE TYPE "lead_archive_type" AS ENUM ('NO_INFRINGEMENT');
ALTER TABLE "lead_review_decisions"
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "archive_type" "lead_archive_type",
  ADD COLUMN "archived_at" TIMESTAMPTZ(3),
  ADD CONSTRAINT "lead_review_decisions_result_archive_check" CHECK (
    ("result" = 'INFRINGEMENT' AND "reason" IS NULL
      AND "archive_type" IS NULL AND "archived_at" IS NULL)
    OR
    ("result" = 'NO_INFRINGEMENT' AND "reason" IS NOT NULL
      AND "reason" = BTRIM("reason")
      AND CHAR_LENGTH("reason") BETWEEN 1 AND 5000
      AND "archive_type" IS NOT NULL
      AND "archive_type" = 'NO_INFRINGEMENT' AND "archived_at" IS NOT NULL)
  );
COMMIT;
