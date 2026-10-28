-- Current editable projections never overwrite source snapshots or evidence.
-- Existing rows keep their current legacy display until explicitly captured.
CREATE TABLE "notary_routine_profiles" (
    "matter_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "shop_name" VARCHAR(200) NOT NULL,
    "shop_external_id" VARCHAR(100),
    "products" JSONB NOT NULL,
    CONSTRAINT "notary_routine_profiles_pkey" PRIMARY KEY ("matter_id"),
    CONSTRAINT "notary_routine_profiles_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "notary_routine_profiles_shop_name_check" CHECK (length(btrim("shop_name")) > 0),
    CONSTRAINT "notary_routine_profiles_products_check" CHECK (jsonb_typeof("products") = 'array'),
    CONSTRAINT "notary_routine_profiles_matter_department_fkey"
      FOREIGN KEY ("matter_id", "department_id") REFERENCES "notary_matters"("id", "department_id")
      ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "notary_routine_profiles_department_id_shop_name_idx"
    ON "notary_routine_profiles"("department_id", "shop_name");
CREATE UNIQUE INDEX "notary_routine_profiles_matter_id_department_id_key"
    ON "notary_routine_profiles"("matter_id", "department_id");

CREATE TABLE "case_routine_profiles" (
    "case_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "shop_name" VARCHAR(200),
    "shop_external_id" VARCHAR(100),
    "remark" TEXT,
    "products" JSONB NOT NULL,
    CONSTRAINT "case_routine_profiles_pkey" PRIMARY KEY ("case_id"),
    CONSTRAINT "case_routine_profiles_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "case_routine_profiles_shop_name_check" CHECK ("shop_name" IS NULL OR length(btrim("shop_name")) > 0),
    CONSTRAINT "case_routine_profiles_remark_check" CHECK ("remark" IS NULL OR length("remark") <= 5000),
    CONSTRAINT "case_routine_profiles_products_check" CHECK (jsonb_typeof("products") = 'array'),
    CONSTRAINT "case_routine_profiles_case_department_fkey"
      FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id")
      ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "case_routine_profiles_department_id_shop_name_idx"
    ON "case_routine_profiles"("department_id", "shop_name");
CREATE UNIQUE INDEX "case_routine_profiles_case_id_department_id_key"
    ON "case_routine_profiles"("case_id", "department_id");
