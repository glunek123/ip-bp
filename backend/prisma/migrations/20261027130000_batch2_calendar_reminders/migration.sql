ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.refund.application.record';

ALTER TABLE "cases" ADD COLUMN "responsibility_epoch" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "cases" ADD CONSTRAINT "cases_responsibility_epoch_check" CHECK ("responsibility_epoch" >= 0);
CREATE FUNCTION "case_bump_responsibility_epoch"() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."responsible_user_id" IS DISTINCT FROM OLD."responsible_user_id" THEN
    NEW."responsibility_epoch" := OLD."responsibility_epoch" + 1;
  ELSE
    NEW."responsibility_epoch" := OLD."responsibility_epoch";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "cases_responsibility_epoch_trigger"
BEFORE UPDATE ON "cases" FOR EACH ROW EXECUTE FUNCTION "case_bump_responsibility_epoch"();

CREATE TABLE "calendar_manual_items" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "owner_user_id" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "event_date" DATE NOT NULL,
  "note" VARCHAR(1000),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "calendar_manual_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "calendar_manual_items_owner_fkey" FOREIGN KEY ("owner_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "calendar_manual_items_version_check" CHECK ("version" > 0)
);
CREATE INDEX "calendar_manual_items_department_id_owner_user_id_event_date_idx" ON "calendar_manual_items"("department_id", "owner_user_id", "event_date");

CREATE TABLE "calendar_reminder_reads" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "owner_user_id" UUID NOT NULL,
  "source_type" VARCHAR(40) NOT NULL,
  "source_id" UUID NOT NULL,
  "source_epoch" VARCHAR(80) NOT NULL,
  "event_date" DATE NOT NULL,
  "read_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "calendar_reminder_reads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "calendar_reminder_reads_owner_fkey" FOREIGN KEY ("owner_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "calendar_reminder_reads_source_type_check" CHECK ("source_type" IN ('MANUAL', 'FIRST_INSTANCE_HEARING', 'SECOND_INSTANCE_HEARING', 'CUSTOMER_AGREEMENT_EXPIRY', 'FIRST_INSTANCE_JUDGMENT', 'SECOND_INSTANCE_RESULT'))
);
CREATE UNIQUE INDEX "calendar_reminder_read_unique" ON "calendar_reminder_reads"("department_id", "owner_user_id", "source_type", "source_id", "source_epoch", "event_date");

CREATE TABLE "case_refund_applications" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "source_type" VARCHAR(40) NOT NULL,
  "source_id" UUID NOT NULL,
  "applicant_user_id" UUID NOT NULL,
  "application_date" DATE NOT NULL,
  "note" VARCHAR(1000),
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_refund_applications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_refund_applications_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_refund_applications_applicant_fkey" FOREIGN KEY ("applicant_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_refund_applications_source_type_check" CHECK ("source_type" IN ('FIRST_INSTANCE_JUDGMENT', 'SECOND_INSTANCE_RESULT'))
);
CREATE UNIQUE INDEX "case_refund_application_source_unique" ON "case_refund_applications"("department_id", "source_type", "source_id");
CREATE INDEX "case_refund_applications_department_id_case_id_idx" ON "case_refund_applications"("department_id", "case_id");

CREATE FUNCTION "guard_case_refund_application_source"() RETURNS TRIGGER AS $$
DECLARE
  registered_at TIMESTAMPTZ;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'A registered refund application is immutable' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM "cases"
    WHERE "id" = NEW."case_id" AND "department_id" = NEW."department_id"
      AND "responsible_user_id" = NEW."applicant_user_id" FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Applicant is not the current case owner' USING ERRCODE = '23514';
  END IF;
  IF NEW."source_type" = 'FIRST_INSTANCE_JUDGMENT' THEN
    SELECT fact."recorded_at" INTO registered_at
      FROM "case_judgment_facts" fact
      JOIN "case_trial_rounds" round ON round."id" = fact."trial_round_id"
      WHERE fact."id" = NEW."source_id" AND fact."case_id" = NEW."case_id"
        AND fact."department_id" = NEW."department_id" AND fact."kind" = 'REGISTER'
        AND round."revoked_at" IS NULL;
  ELSIF NEW."source_type" = 'SECOND_INSTANCE_RESULT' THEN
    SELECT result."recorded_at" INTO registered_at
      FROM "case_second_instance_results" result
      JOIN "case_trial_rounds" round ON round."id" = result."trial_round_id"
      WHERE result."id" = NEW."source_id" AND result."case_id" = NEW."case_id"
        AND result."department_id" = NEW."department_id" AND round."revoked_at" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "case_second_instance_result_revocations" revocation
          WHERE revocation."result_id" = result."id");
  END IF;
  IF registered_at IS NULL OR NEW."application_date" > (now() AT TIME ZONE 'Asia/Shanghai')::date THEN
    RAISE EXCEPTION 'Refund application has no current formal judgment source or invalid application date'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "case_refund_applications_source_guard"
BEFORE INSERT OR UPDATE ON "case_refund_applications"
FOR EACH ROW EXECUTE FUNCTION "guard_case_refund_application_source"();
