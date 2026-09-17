CREATE TYPE "customer_profile_status" AS ENUM ('DRAFT');

CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "region" TEXT,
    "profile_status" "customer_profile_status" NOT NULL DEFAULT 'DRAFT',
    "department_id" UUID NOT NULL,
    "responsible_user_id" UUID NOT NULL,
    "team_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customers_department_id_updated_at_id_idx" ON "customers"("department_id", "updated_at", "id");
CREATE INDEX "customers_responsible_user_id_idx" ON "customers"("responsible_user_id");
CREATE INDEX "customers_team_id_idx" ON "customers"("team_id");
CREATE INDEX "audit_events_department_id_resource_type_resource_id_created_at_idx" ON "audit_events"("department_id", "resource_type", "resource_id", "created_at");
CREATE INDEX "audit_events_actor_user_id_created_at_idx" ON "audit_events"("actor_user_id", "created_at");

ALTER TABLE "customers" ADD CONSTRAINT "customers_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customers" ADD CONSTRAINT "customers_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
