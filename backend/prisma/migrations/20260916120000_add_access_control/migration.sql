CREATE TYPE "permission_action" AS ENUM ('customer.read', 'customer.create-draft');

CREATE TYPE "permission_scope" AS ENUM ('SELF', 'TEAM', 'DEPARTMENT');

CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_accounts" (
    "id" UUID NOT NULL,
    "external_subject" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "authorization_revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "user_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "department_memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "team_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "department_memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "role_templates" (
    "id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "role_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "role_grants" (
    "id" UUID NOT NULL,
    "role_template_id" UUID NOT NULL,
    "action" "permission_action" NOT NULL,
    "scope" "permission_scope" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "role_grants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "role_assignments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "role_template_id" UUID NOT NULL,
    "team_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_accounts_external_subject_key" ON "user_accounts"("external_subject");
CREATE UNIQUE INDEX "department_memberships_user_id_department_id_key" ON "department_memberships"("user_id", "department_id");
CREATE INDEX "department_memberships_department_id_active_idx" ON "department_memberships"("department_id", "active");
CREATE UNIQUE INDEX "role_templates_department_id_name_key" ON "role_templates"("department_id", "name");
CREATE UNIQUE INDEX "role_grants_role_template_id_action_scope_key" ON "role_grants"("role_template_id", "action", "scope");
CREATE UNIQUE INDEX "role_assignments_user_id_department_id_role_template_id_team_id_key" ON "role_assignments"("user_id", "department_id", "role_template_id", "team_id");
CREATE INDEX "role_assignments_user_id_department_id_active_idx" ON "role_assignments"("user_id", "department_id", "active");

ALTER TABLE "department_memberships" ADD CONSTRAINT "department_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "department_memberships" ADD CONSTRAINT "department_memberships_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role_templates" ADD CONSTRAINT "role_templates_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_role_template_id_fkey" FOREIGN KEY ("role_template_id") REFERENCES "role_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_role_template_id_fkey" FOREIGN KEY ("role_template_id") REFERENCES "role_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
