BEGIN;

CREATE TABLE "notary_offices" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "status" "notary_office_status" NOT NULL DEFAULT 'ACTIVE',
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notary_offices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notary_offices_department_name_key" UNIQUE ("department_id", "name"),
  CONSTRAINT "notary_offices_id_department_key" UNIQUE ("id", "department_id"),
  CONSTRAINT "notary_offices_name_check" CHECK ("name" = BTRIM("name") AND CHAR_LENGTH("name") BETWEEN 1 AND 200)
);
CREATE INDEX "notary_offices_department_status_name_idx" ON "notary_offices"("department_id", "status", "name");
ALTER TABLE "notary_offices"
  ADD CONSTRAINT "notary_offices_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "notary_offices_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lead_products" ADD CONSTRAINT "lead_products_id_lead_id_key" UNIQUE ("id", "lead_id");

CREATE TABLE "notary_matters" (
  "id" UUID NOT NULL,
  "business_no" VARCHAR(100) NOT NULL,
  "department_id" UUID NOT NULL,
  "source_type" "notary_source_type" NOT NULL DEFAULT 'LEAD',
  "source_lead_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "rights_holder_id" UUID NOT NULL,
  "responsible_user_id" UUID NOT NULL,
  "notary_office_id" UUID NOT NULL,
  "stage" "notary_matter_stage" NOT NULL DEFAULT 'PENDING_EVIDENCE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "evidence_mode" "notary_evidence_mode" NOT NULL,
  "batch_purpose" VARCHAR(500) NOT NULL,
  "source_snapshot" JSONB NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "from_lead_version" INTEGER NOT NULL,
  "to_lead_version" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notary_matters_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notary_matters_business_no_key" UNIQUE ("business_no"),
  CONSTRAINT "notary_matters_id_lead_key" UNIQUE ("id", "source_lead_id"),
  CONSTRAINT "notary_matters_version_check" CHECK ("version" >= 1 AND "from_lead_version" >= 1 AND "to_lead_version" = "from_lead_version" + 1),
  CONSTRAINT "notary_matters_purpose_check" CHECK ("batch_purpose" = BTRIM("batch_purpose") AND CHAR_LENGTH("batch_purpose") BETWEEN 1 AND 500)
);
CREATE INDEX "notary_matters_department_source_lead_created_at_idx" ON "notary_matters"("department_id", "source_lead_id", "created_at");
ALTER TABLE "notary_matters"
  ADD CONSTRAINT "notary_matters_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "notary_matters_lead_identity_fkey" FOREIGN KEY ("source_lead_id", "customer_id", "department_id") REFERENCES "leads"("id", "customer_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "notary_matters_office_department_fkey" FOREIGN KEY ("notary_office_id", "department_id") REFERENCES "notary_offices"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "notary_matters_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "notary_matter_products" (
  "notary_matter_id" UUID NOT NULL,
  "source_lead_id" UUID NOT NULL,
  "lead_product_id" UUID NOT NULL,
  CONSTRAINT "notary_matter_products_pkey" PRIMARY KEY ("notary_matter_id", "lead_product_id"),
  CONSTRAINT "notary_matter_products_matter_lead_fkey" FOREIGN KEY ("notary_matter_id", "source_lead_id") REFERENCES "notary_matters"("id", "source_lead_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_matter_products_product_lead_fkey" FOREIGN KEY ("lead_product_id", "source_lead_id") REFERENCES "lead_products"("id", "lead_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "notary_matter_materials" (
  "notary_matter_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "material_id" UUID NOT NULL,
  "content_version_id" UUID NOT NULL,
  CONSTRAINT "notary_matter_materials_pkey" PRIMARY KEY ("notary_matter_id", "content_version_id"),
  CONSTRAINT "notary_matter_materials_notary_matter_id_fkey" FOREIGN KEY ("notary_matter_id") REFERENCES "notary_matters"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_matter_materials_material_department_fkey" FOREIGN KEY ("material_id", "department_id") REFERENCES "materials"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_matter_materials_content_version_fkey" FOREIGN KEY ("material_id", "content_version_id") REFERENCES "content_versions"("material_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "notary_matter_number_counters" (
  "business_date" DATE NOT NULL,
  "last_value" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notary_matter_number_counters_pkey" PRIMARY KEY ("business_date"),
  CONSTRAINT "notary_matter_number_counter_check" CHECK ("last_value" BETWEEN 0 AND 999)
);

CREATE FUNCTION protect_notary_matter_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TO_JSONB(NEW) - 'stage' - 'version') IS DISTINCT FROM (TO_JSONB(OLD) - 'stage' - 'version') THEN
    RAISE EXCEPTION 'notary source facts are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER protect_notary_matter_source BEFORE UPDATE OR DELETE ON "notary_matters" FOR EACH ROW EXECUTE FUNCTION protect_notary_matter_source();
CREATE FUNCTION reject_notary_matter_selection_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'notary source selections are immutable' USING ERRCODE = '55000';
END
$$;
CREATE TRIGGER reject_notary_matter_product_mutation BEFORE UPDATE OR DELETE ON "notary_matter_products" FOR EACH ROW EXECUTE FUNCTION reject_notary_matter_selection_mutation();
CREATE TRIGGER reject_notary_matter_material_mutation BEFORE UPDATE OR DELETE ON "notary_matter_materials" FOR EACH ROW EXECUTE FUNCTION reject_notary_matter_selection_mutation();

COMMIT;
