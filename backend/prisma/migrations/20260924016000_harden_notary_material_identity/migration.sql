BEGIN;

ALTER TABLE "notary_matters"
  ADD CONSTRAINT "notary_matters_id_department_key" UNIQUE ("id", "department_id");

ALTER TABLE "notary_matter_materials"
  DROP CONSTRAINT "notary_matter_materials_notary_matter_id_fkey",
  ADD CONSTRAINT "notary_matter_materials_matter_department_fkey"
    FOREIGN KEY ("notary_matter_id", "department_id")
    REFERENCES "notary_matters"("id", "department_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

COMMIT;
