BEGIN;

-- A missing historical business date remains unknown; matched_at is the
-- server-recorded completion timestamp and must not be used as a backfill.
ALTER TABLE "cases" ADD COLUMN "matched_on" DATE;
ALTER TABLE "cases" ADD CONSTRAINT "cases_matched_on_state_check"
  CHECK ("matched_on" IS NULL OR "stage" <> 'PENDING_MATCH');

ALTER TABLE "lawyer_profiles" ALTER COLUMN "law_firm" DROP NOT NULL;
ALTER TABLE "lawyer_profiles" DROP CONSTRAINT "lawyer_profiles_firm_check";
ALTER TABLE "lawyer_profiles" ADD CONSTRAINT "lawyer_profiles_firm_check"
  CHECK ("law_firm" IS NULL OR
    ("law_firm" = BTRIM("law_firm") AND CHAR_LENGTH("law_firm") BETWEEN 1 AND 200));

COMMIT;
