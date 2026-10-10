BEGIN;

CREATE TABLE "case_trial_rounds" (
  "id" uuid NOT NULL PRIMARY KEY,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "revoked_at" timestamptz(3),
  CONSTRAINT "case_trial_rounds_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "case_trial_rounds_case_sequence_key" UNIQUE ("case_id", "department_id", "sequence"),
  CONSTRAINT "case_trial_rounds_id_case_department_key" UNIQUE ("id", "case_id", "department_id"),
  CONSTRAINT "case_trial_rounds_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

ALTER TABLE "cases" ADD COLUMN "current_trial_round_id" uuid;
ALTER TABLE "cases" ADD COLUMN "current_acceptance_id" uuid;
ALTER TABLE "case_acceptances" ADD COLUMN "trial_round_id" uuid;
ALTER TABLE "case_hearing_arrangements" ADD COLUMN "trial_round_id" uuid;
ALTER TABLE "case_hearing_advances" ADD COLUMN "trial_round_id" uuid;
ALTER TABLE "case_judgment_facts" ADD COLUMN "trial_round_id" uuid;
ALTER TABLE "case_judgment_next_steps" ADD COLUMN "trial_round_id" uuid;

-- Existing immutable facts gain only their structural round identifier.
ALTER TABLE "case_acceptances" DISABLE TRIGGER USER;
ALTER TABLE "case_hearing_arrangements" DISABLE TRIGGER USER;
ALTER TABLE "case_hearing_advances" DISABLE TRIGGER USER;
ALTER TABLE "case_judgment_facts" DISABLE TRIGGER USER;
ALTER TABLE "case_judgment_next_steps" DISABLE TRIGGER USER;

-- A prior accepted case has exactly one historic trial chain. No business date,
-- actor, audit, frozen content or receipt is rewritten by this structural backfill.
INSERT INTO "case_trial_rounds" ("id", "case_id", "department_id", "sequence")
SELECT gen_random_uuid(), a."case_id", a."department_id", 1 FROM "case_acceptances" a;
UPDATE "case_acceptances" a SET "trial_round_id" = r."id"
FROM "case_trial_rounds" r WHERE r."case_id" = a."case_id" AND r."department_id" = a."department_id";
UPDATE "case_hearing_arrangements" f SET "trial_round_id" = r."id"
FROM "case_trial_rounds" r WHERE r."case_id" = f."case_id" AND r."department_id" = f."department_id";
UPDATE "case_hearing_advances" f SET "trial_round_id" = r."id"
FROM "case_trial_rounds" r WHERE r."case_id" = f."case_id" AND r."department_id" = f."department_id";
UPDATE "case_judgment_facts" f SET "trial_round_id" = r."id"
FROM "case_trial_rounds" r WHERE r."case_id" = f."case_id" AND r."department_id" = f."department_id";
UPDATE "case_judgment_next_steps" f SET "trial_round_id" = r."id"
FROM "case_trial_rounds" r WHERE r."case_id" = f."case_id" AND r."department_id" = f."department_id";
UPDATE "cases" c SET "current_trial_round_id" = r."id", "current_acceptance_id" = a."id"
FROM "case_trial_rounds" r JOIN "case_acceptances" a
  ON a."case_id" = r."case_id" AND a."department_id" = r."department_id"
WHERE c."id" = r."case_id" AND c."department_id" = r."department_id";
ALTER TABLE "case_acceptances" ENABLE TRIGGER USER;
ALTER TABLE "case_hearing_arrangements" ENABLE TRIGGER USER;
ALTER TABLE "case_hearing_advances" ENABLE TRIGGER USER;
ALTER TABLE "case_judgment_facts" ENABLE TRIGGER USER;
ALTER TABLE "case_judgment_next_steps" ENABLE TRIGGER USER;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "cases" c WHERE
      (c."stage" IN ('WAITING_HEARING','WAITING_JUDGMENT','SECOND_INSTANCE','WAITING_EXECUTION_DOCUMENTS')
        AND c."current_acceptance_id" IS NULL) OR
      (c."current_acceptance_id" IS NULL AND (c."current_hearing_arrangement_id" IS NOT NULL OR
        c."current_hearing_advance_id" IS NOT NULL OR c."current_judgment_id" IS NOT NULL OR
        c."current_judgment_next_step_id" IS NOT NULL))
  ) OR EXISTS (
    SELECT 1 FROM "case_hearing_arrangements" WHERE "trial_round_id" IS NULL
  ) OR EXISTS (
    SELECT 1 FROM "case_hearing_advances" WHERE "trial_round_id" IS NULL
  ) OR EXISTS (
    SELECT 1 FROM "case_judgment_facts" WHERE "trial_round_id" IS NULL
  ) OR EXISTS (
    SELECT 1 FROM "case_judgment_next_steps" WHERE "trial_round_id" IS NULL
  ) THEN RAISE EXCEPTION 'case trial round backfill found an invalid prior chain' USING ERRCODE = '23514'; END IF;
END $$;

ALTER TABLE "case_acceptances" ALTER COLUMN "trial_round_id" SET NOT NULL;
ALTER TABLE "case_hearing_arrangements" ALTER COLUMN "trial_round_id" SET NOT NULL;
ALTER TABLE "case_hearing_advances" ALTER COLUMN "trial_round_id" SET NOT NULL;
ALTER TABLE "case_judgment_facts" ALTER COLUMN "trial_round_id" SET NOT NULL;
ALTER TABLE "case_judgment_next_steps" ALTER COLUMN "trial_round_id" SET NOT NULL;
ALTER TABLE "case_acceptances" DROP CONSTRAINT "case_acceptances_case_id_key";
ALTER TABLE "case_acceptances" DROP CONSTRAINT "case_acceptances_case_id_department_id_key";
ALTER TABLE "case_acceptances" ADD CONSTRAINT "case_acceptances_round_case_department_key" UNIQUE ("trial_round_id", "case_id", "department_id");
ALTER TABLE "case_acceptances" ADD CONSTRAINT "case_acceptances_id_case_department_round_key" UNIQUE ("id", "case_id", "department_id", "trial_round_id");
ALTER TABLE "case_acceptances" ADD CONSTRAINT "case_acceptances_case_department_round_key" UNIQUE ("case_id", "department_id", "trial_round_id");
ALTER TABLE "case_acceptances" ADD CONSTRAINT "case_acceptances_round_fkey" FOREIGN KEY ("trial_round_id", "case_id", "department_id") REFERENCES "case_trial_rounds"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "case_hearing_arrangements" ADD CONSTRAINT "case_hearing_arrangements_round_fkey" FOREIGN KEY ("trial_round_id", "case_id", "department_id") REFERENCES "case_trial_rounds"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "case_hearing_arrangements" ADD CONSTRAINT "case_hearing_arrangements_id_case_department_round_key" UNIQUE ("id", "case_id", "department_id", "trial_round_id");
ALTER TABLE "case_hearing_advances" ADD CONSTRAINT "case_hearing_advances_round_fkey" FOREIGN KEY ("trial_round_id", "case_id", "department_id") REFERENCES "case_trial_rounds"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "case_hearing_advances" ADD CONSTRAINT "case_hearing_advances_id_case_department_round_key" UNIQUE ("id", "case_id", "department_id", "trial_round_id");
ALTER TABLE "case_hearing_advances" ADD CONSTRAINT "case_hearing_advances_arrangement_round_fkey" FOREIGN KEY ("arrangement_id", "case_id", "department_id", "trial_round_id") REFERENCES "case_hearing_arrangements"("id", "case_id", "department_id", "trial_round_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "case_judgment_facts" ADD CONSTRAINT "case_judgment_facts_round_fkey" FOREIGN KEY ("trial_round_id", "case_id", "department_id") REFERENCES "case_trial_rounds"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "case_judgment_facts" ADD CONSTRAINT "case_judgment_facts_id_case_department_round_key" UNIQUE ("id", "case_id", "department_id", "trial_round_id");
ALTER TABLE "case_judgment_facts" ADD CONSTRAINT "case_judgment_facts_prior_round_fkey" FOREIGN KEY ("prior_fact_id", "case_id", "department_id", "trial_round_id") REFERENCES "case_judgment_facts"("id", "case_id", "department_id", "trial_round_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
DROP INDEX "case_judgment_one_root";
CREATE UNIQUE INDEX "case_judgment_one_root_per_round" ON "case_judgment_facts"("trial_round_id") WHERE "kind" = 'REGISTER';
ALTER TABLE "case_judgment_next_steps" ADD CONSTRAINT "case_judgment_next_steps_round_fkey" FOREIGN KEY ("trial_round_id", "case_id", "department_id") REFERENCES "case_trial_rounds"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "case_judgment_next_steps" ADD CONSTRAINT "case_judgment_next_steps_id_case_department_round_key" UNIQUE ("id", "case_id", "department_id", "trial_round_id");
ALTER TABLE "case_judgment_next_steps" ADD CONSTRAINT "case_judgment_next_steps_judgment_round_fkey" FOREIGN KEY ("judgment_id", "case_id", "department_id", "trial_round_id") REFERENCES "case_judgment_facts"("id", "case_id", "department_id", "trial_round_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "cases" ADD CONSTRAINT "cases_current_trial_round_fkey" FOREIGN KEY ("current_trial_round_id", "id", "department_id") REFERENCES "case_trial_rounds"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "cases" ADD CONSTRAINT "cases_current_acceptance_fkey" FOREIGN KEY ("current_acceptance_id", "id", "department_id") REFERENCES "case_acceptances"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "cases" ADD CONSTRAINT "cases_current_acceptance_round_fkey" FOREIGN KEY ("current_acceptance_id", "id", "department_id", "current_trial_round_id") REFERENCES "case_acceptances"("id", "case_id", "department_id", "trial_round_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "cases" ADD CONSTRAINT "cases_current_hearing_round_fkey" FOREIGN KEY ("current_hearing_arrangement_id", "id", "department_id", "current_trial_round_id") REFERENCES "case_hearing_arrangements"("id", "case_id", "department_id", "trial_round_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "cases" ADD CONSTRAINT "cases_current_advance_round_fkey" FOREIGN KEY ("current_hearing_advance_id", "id", "department_id", "current_trial_round_id") REFERENCES "case_hearing_advances"("id", "case_id", "department_id", "trial_round_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "cases" ADD CONSTRAINT "cases_current_judgment_round_fkey" FOREIGN KEY ("current_judgment_id", "id", "department_id", "current_trial_round_id") REFERENCES "case_judgment_facts"("id", "case_id", "department_id", "trial_round_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "cases" ADD CONSTRAINT "cases_current_choice_round_fkey" FOREIGN KEY ("current_judgment_next_step_id", "id", "department_id", "current_trial_round_id") REFERENCES "case_judgment_next_steps"("id", "case_id", "department_id", "trial_round_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "cases" ADD CONSTRAINT "cases_current_trial_round_id_id_department_id_key" UNIQUE ("current_trial_round_id", "id", "department_id");
ALTER TABLE "cases" ADD CONSTRAINT "cases_current_acceptance_id_id_department_id_key" UNIQUE ("current_acceptance_id", "id", "department_id");

-- This foundation deliberately admits only an initial round. Task 2 must
-- replace this guard with one backed by immutable REMAND/result-revocation facts.
CREATE FUNCTION "check_case_trial_round_foundation"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; c record; r record;
BEGIN
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSIF TG_TABLE_NAME = 'case_trial_rounds' THEN target_case := NEW."case_id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT * INTO c FROM "cases" WHERE "id" = target_case AND "department_id" = target_department;
  IF c."current_trial_round_id" IS NULL THEN
    IF c."current_acceptance_id" IS NOT NULL OR c."stage" IN
      ('WAITING_HEARING','WAITING_JUDGMENT','SECOND_INSTANCE','WAITING_EXECUTION_DOCUMENTS') THEN
      RAISE EXCEPTION 'accepted case has no active trial round' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO r FROM "case_trial_rounds" WHERE "id" = c."current_trial_round_id"
      AND "case_id" = target_case AND "department_id" = target_department;
    IF r."sequence" <> 1 OR r."revoked_at" IS NOT NULL OR
      c."current_acceptance_id" IS NULL OR
      NOT EXISTS (SELECT 1 FROM "case_acceptances" a WHERE a."id" = c."current_acceptance_id"
        AND a."trial_round_id" = r."id" AND a."case_id" = target_case AND a."department_id" = target_department
        AND a."court_case_no" = c."court_case_no") THEN
      RAISE EXCEPTION 'initial trial round or acceptance mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'case_trial_rounds' AND (NEW."sequence" <> 1 OR NEW."revoked_at" IS NOT NULL OR
      c."current_trial_round_id" IS DISTINCT FROM NEW."id") THEN
    RAISE EXCEPTION 'new trial round requires a verified remand result' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME IN ('case_acceptances','case_hearing_arrangements','case_hearing_advances',
      'case_judgment_facts','case_judgment_next_steps') AND
    NEW."trial_round_id" IS DISTINCT FROM c."current_trial_round_id" THEN
    RAISE EXCEPTION 'new case fact must belong to the current trial round' USING ERRCODE = '23514';
  END IF;
  IF (c."current_hearing_arrangement_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_hearing_arrangements" x WHERE x."id" = c."current_hearing_arrangement_id"
        AND x."trial_round_id" = c."current_trial_round_id")) OR
     (c."current_hearing_advance_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_hearing_advances" x WHERE x."id" = c."current_hearing_advance_id"
        AND x."trial_round_id" = c."current_trial_round_id")) OR
     (c."current_judgment_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_judgment_facts" x WHERE x."id" = c."current_judgment_id"
        AND x."trial_round_id" = c."current_trial_round_id")) OR
     (c."current_judgment_next_step_id" IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM "case_judgment_next_steps" x WHERE x."id" = c."current_judgment_next_step_id"
        AND x."trial_round_id" = c."current_trial_round_id")) THEN
    RAISE EXCEPTION 'case current pointer crosses trial rounds' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "case_trial_round_case_guard" AFTER INSERT OR UPDATE OF
  "stage", "current_trial_round_id", "current_acceptance_id", "court_case_no",
  "current_hearing_arrangement_id", "current_hearing_advance_id", "current_judgment_id", "current_judgment_next_step_id"
  ON "cases" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_trial_round_foundation"();
CREATE CONSTRAINT TRIGGER "case_trial_round_round_guard" AFTER INSERT ON "case_trial_rounds"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_trial_round_foundation"();
CREATE CONSTRAINT TRIGGER "case_trial_round_acceptance_guard" AFTER INSERT ON "case_acceptances"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_trial_round_foundation"();
CREATE CONSTRAINT TRIGGER "case_trial_round_hearing_guard" AFTER INSERT ON "case_hearing_arrangements"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_trial_round_foundation"();
CREATE CONSTRAINT TRIGGER "case_trial_round_advance_guard" AFTER INSERT ON "case_hearing_advances"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_trial_round_foundation"();
CREATE CONSTRAINT TRIGGER "case_trial_round_judgment_guard" AFTER INSERT ON "case_judgment_facts"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_trial_round_foundation"();
CREATE CONSTRAINT TRIGGER "case_trial_round_choice_guard" AFTER INSERT ON "case_judgment_next_steps"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_trial_round_foundation"();

CREATE FUNCTION "reject_case_trial_round_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trial round is immutable until a verified result revocation' USING ERRCODE = '23514';
END; $$;
CREATE TRIGGER "case_trial_rounds_immutable" BEFORE UPDATE OR DELETE ON "case_trial_rounds"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_trial_round_mutation"();

COMMIT;
