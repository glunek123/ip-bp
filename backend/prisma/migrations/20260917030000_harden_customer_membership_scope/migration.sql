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

  IF EXISTS (
    SELECT 1
    FROM "customers" customer
    LEFT JOIN "department_memberships" membership
      ON membership."user_id" = customer."responsible_user_id"
     AND membership."department_id" = customer."department_id"
    WHERE membership."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'customer responsibility must reference a department membership';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "audit_events" event
    LEFT JOIN "department_memberships" membership
      ON membership."user_id" = event."actor_user_id"
     AND membership."department_id" = event."department_id"
    WHERE membership."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'audit actors must reference a department membership';
  END IF;
END $$;

ALTER TABLE "customers"
DROP CONSTRAINT "customers_responsible_user_id_fkey";

ALTER TABLE "customers"
ADD CONSTRAINT "customers_responsible_user_id_department_id_fkey"
FOREIGN KEY ("responsible_user_id", "department_id")
REFERENCES "department_memberships"("user_id", "department_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_events"
DROP CONSTRAINT "audit_events_actor_user_id_fkey";

ALTER TABLE "audit_events"
ADD CONSTRAINT "audit_events_actor_user_id_department_id_fkey"
FOREIGN KEY ("actor_user_id", "department_id")
REFERENCES "department_memberships"("user_id", "department_id")
ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "role_assignments_user_id_department_id_role_template_id_team_id_key";

CREATE UNIQUE INDEX "role_assignments_user_id_department_id_role_template_id_team_id_key"
ON "role_assignments"("user_id", "department_id", "role_template_id", "team_id")
NULLS NOT DISTINCT;

COMMIT;
