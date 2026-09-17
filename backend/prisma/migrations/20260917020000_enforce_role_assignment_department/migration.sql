BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "role_assignments" assignment
    JOIN "role_templates" template ON template."id" = assignment."role_template_id"
    WHERE assignment."department_id" <> template."department_id"
  ) THEN
    RAISE EXCEPTION 'cross-department role assignments must be corrected before migration';
  END IF;
END $$;

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

COMMIT;
