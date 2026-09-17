DROP INDEX IF EXISTS "role_templates_id_department_id_key";
CREATE UNIQUE INDEX "role_templates_id_department_id_key"
ON "role_templates"("id", "department_id");

ALTER TABLE "role_assignments"
DROP CONSTRAINT "role_assignments_role_template_id_fkey";

ALTER TABLE "role_assignments"
ADD CONSTRAINT "role_assignments_role_template_id_department_id_fkey"
FOREIGN KEY ("role_template_id", "department_id")
REFERENCES "role_templates"("id", "department_id")
ON DELETE RESTRICT ON UPDATE CASCADE;
