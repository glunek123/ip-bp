ALTER TABLE "cases" ADD COLUMN "acceptance_draft" JSONB;

ALTER TABLE "calendar_reminder_reads"
  DROP CONSTRAINT "calendar_reminder_reads_source_type_check",
  ADD CONSTRAINT "calendar_reminder_reads_source_type_check"
  CHECK ("source_type" IN (
    'MANUAL', 'FIRST_INSTANCE_HEARING', 'SECOND_INSTANCE_HEARING',
    'CUSTOMER_AGREEMENT_EXPIRY', 'FIRST_INSTANCE_JUDGMENT',
    'SECOND_INSTANCE_RESULT', 'CASE_PAYMENT_DUE'
  ));
