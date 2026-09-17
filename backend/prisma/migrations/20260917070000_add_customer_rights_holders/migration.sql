BEGIN;

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_id_department_id_key" UNIQUE ("id", "department_id");

CREATE TABLE "rights_holders" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "credit" TEXT,
  "address" TEXT,
  "legal_representative" TEXT,
  "duty" TEXT,
  "department_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "rights_holders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rights_holders_id_department_id_key" UNIQUE ("id", "department_id"),
  CONSTRAINT "rights_holders_name_nonblank_check"
    CHECK (NULLIF(BTRIM("name"), '') IS NOT NULL)
);

CREATE TABLE "customer_rights_holder_links" (
  "id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "rights_holder_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_rights_holder_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_rights_holder_links_id_department_id_key"
    UNIQUE ("id", "department_id"),
  CONSTRAINT "customer_rights_holder_links_customer_holder_key"
    UNIQUE ("customer_id", "rights_holder_id")
);

CREATE TABLE "rights_holder_command_receipts" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "result_holder_id" UUID NOT NULL,
  "result_link_id" UUID NOT NULL,
  "result_customer_id" UUID NOT NULL,
  "result_customer_version" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rights_holder_command_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rights_holder_command_receipts_department_actor_action_key"
    UNIQUE ("department_id", "actor_user_id", "action", "idempotency_key")
);

CREATE INDEX "rights_holders_department_id_updated_at_id_idx"
  ON "rights_holders"("department_id", "updated_at", "id");
CREATE INDEX "rights_holders_department_id_name_idx"
  ON "rights_holders"("department_id", "name");
CREATE INDEX "customer_rights_holder_links_department_id_rights_holder_id_idx"
  ON "customer_rights_holder_links"("department_id", "rights_holder_id");
CREATE INDEX "rights_holder_command_receipts_result_customer_id_department_id_idx"
  ON "rights_holder_command_receipts"("result_customer_id", "department_id");

ALTER TABLE "rights_holders"
  ADD CONSTRAINT "rights_holders_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_rights_holder_links"
  ADD CONSTRAINT "customer_rights_holder_links_customer_department_fkey"
  FOREIGN KEY ("customer_id", "department_id")
  REFERENCES "customers"("id", "department_id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "customer_rights_holder_links_holder_department_fkey"
  FOREIGN KEY ("rights_holder_id", "department_id")
  REFERENCES "rights_holders"("id", "department_id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "customer_rights_holder_links_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rights_holder_command_receipts"
  ADD CONSTRAINT "rights_holder_command_receipts_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "rights_holder_command_receipts_actor_department_fkey"
  FOREIGN KEY ("actor_user_id", "department_id")
  REFERENCES "department_memberships"("user_id", "department_id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "rights_holder_command_receipts_holder_department_fkey"
  FOREIGN KEY ("result_holder_id", "department_id")
  REFERENCES "rights_holders"("id", "department_id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "rights_holder_command_receipts_link_department_fkey"
  FOREIGN KEY ("result_link_id", "department_id")
  REFERENCES "customer_rights_holder_links"("id", "department_id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "rights_holder_command_receipts_customer_department_fkey"
  FOREIGN KEY ("result_customer_id", "department_id")
  REFERENCES "customers"("id", "department_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
