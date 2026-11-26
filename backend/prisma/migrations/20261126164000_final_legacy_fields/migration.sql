ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "legacy_clue_source" varchar(200);
ALTER TABLE "cases"
  ADD COLUMN IF NOT EXISTS "legacy_submit_register_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_pleadings_approve_on" date,
  ADD COLUMN IF NOT EXISTS "legacy_pleadings_confirm_on" date;
ALTER TABLE "notary_matters"
  ADD COLUMN IF NOT EXISTS "legacy_forensics_check_opinion" varchar(1000),
  ADD COLUMN IF NOT EXISTS "legacy_forensics_check_note" varchar(1000),
  ADD COLUMN IF NOT EXISTS "legacy_forensics_check_result" varchar(500),
  ADD COLUMN IF NOT EXISTS "legacy_forensics_check_info" varchar(1000);
