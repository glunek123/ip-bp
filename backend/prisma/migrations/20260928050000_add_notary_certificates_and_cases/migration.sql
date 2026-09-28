BEGIN;

ALTER TYPE "material_category" ADD VALUE IF NOT EXISTS 'NOTARY_CERTIFICATE';
ALTER TYPE "material_category" ADD VALUE IF NOT EXISTS 'NOTARY_DISCLOSURE';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.read';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='case_stage' AND typnamespace=current_schema()::regnamespace) THEN
    CREATE TYPE "case_stage" AS ENUM ('PENDING_MATCH');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='certificate_fee_category' AND typnamespace=current_schema()::regnamespace) THEN
    CREATE TYPE "certificate_fee_category" AS ENUM ('NOTARY', 'INVESTIGATION', 'DISCLOSURE');
  END IF;
END $$;

COMMIT;
BEGIN;

ALTER TABLE "notary_issuance_decisions" ADD CONSTRAINT "notary_issuance_decisions_certificate_identity_key"
  UNIQUE ("id", "matter_id", "department_id", "decision");

CREATE TABLE "notary_certificates" (
  "id" UUID NOT NULL,
  "matter_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "issuance_decision_id" UUID NOT NULL,
  "issuance_decision_choice" "notary_issuance_choice" NOT NULL DEFAULT 'ISSUE',
  "notary_office_account_binding_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "certificate_no" VARCHAR(200) NOT NULL,
  "certificate_date" DATE NOT NULL,
  "need_disclose" BOOLEAN NOT NULL,
  "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "from_version" INTEGER NOT NULL,
  "to_version" INTEGER NOT NULL,
  CONSTRAINT "notary_certificates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notary_certificates_matter_id_key" UNIQUE ("matter_id"),
  CONSTRAINT "notary_certificates_matter_department_key" UNIQUE ("matter_id", "department_id"),
  CONSTRAINT "notary_certificates_issuance_decision_id_key" UNIQUE ("issuance_decision_id"),
  CONSTRAINT "notary_certificates_decision_identity_key" UNIQUE ("issuance_decision_id", "matter_id", "department_id", "issuance_decision_choice"),
  CONSTRAINT "notary_certificates_id_matter_department_key" UNIQUE ("id", "matter_id", "department_id"),
  CONSTRAINT "notary_certificates_number_check" CHECK ("certificate_no" = BTRIM("certificate_no") AND CHAR_LENGTH("certificate_no") BETWEEN 1 AND 200),
  CONSTRAINT "notary_certificates_version_check" CHECK ("from_version" >= 1 AND "to_version" = "from_version" + 1),
  CONSTRAINT "notary_certificates_issue_check" CHECK ("issuance_decision_choice" = 'ISSUE'),
  CONSTRAINT "notary_certificates_matter_fkey" FOREIGN KEY ("matter_id", "department_id") REFERENCES "notary_matters"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_certificates_decision_fkey" FOREIGN KEY ("issuance_decision_id", "matter_id", "department_id", "issuance_decision_choice") REFERENCES "notary_issuance_decisions"("id", "matter_id", "department_id", "decision") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_certificates_binding_fkey" FOREIGN KEY ("notary_office_account_binding_id", "actor_user_id", "department_id") REFERENCES "notary_office_account_bindings"("id", "user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "notary_certificates_department_issued_at_idx" ON "notary_certificates"("department_id", "issued_at");

CREATE TABLE "notary_certificate_fees" (
  "certificate_id" UUID NOT NULL,
  "category" "certificate_fee_category" NOT NULL,
  "state" "notary_sample_fee_state" NOT NULL,
  "amount" DECIMAL(18,2),
  CONSTRAINT "notary_certificate_fees_pkey" PRIMARY KEY ("certificate_id", "category"),
  CONSTRAINT "notary_certificate_fees_amount_check" CHECK (("state" = 'KNOWN' AND "amount" IS NOT NULL AND "amount" >= 0) OR ("state" = 'PENDING' AND "amount" IS NULL)),
  CONSTRAINT "notary_certificate_fees_certificate_fkey" FOREIGN KEY ("certificate_id") REFERENCES "notary_certificates"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_number_counters" (
  "business_date" DATE NOT NULL,
  "last_value" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "case_number_counters_pkey" PRIMARY KEY ("business_date"),
  CONSTRAINT "case_number_counters_positive_check" CHECK ("last_value" >= 0)
);

ALTER TABLE "notary_matters" ADD CONSTRAINT "notary_matters_case_source_identity_key"
  UNIQUE ("id", "source_lead_id", "customer_id", "rights_holder_id", "department_id");

CREATE TABLE "cases" (
  "id" UUID NOT NULL,
  "business_no" VARCHAR(100) NOT NULL,
  "department_id" UUID NOT NULL,
  "source_lead_id" UUID NOT NULL,
  "source_notary_matter_id" UUID NOT NULL,
  "certificate_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "rights_holder_id" UUID NOT NULL,
  "responsible_user_id" UUID NOT NULL,
  "stage" "case_stage" NOT NULL DEFAULT 'PENDING_MATCH',
  "court_case_no" VARCHAR(100),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cases_business_no_key" UNIQUE ("business_no"),
  CONSTRAINT "cases_id_department_key" UNIQUE ("id", "department_id"),
  CONSTRAINT "cases_source_notary_matter_id_key" UNIQUE ("source_notary_matter_id"),
  CONSTRAINT "cases_source_notary_matter_department_key" UNIQUE ("source_notary_matter_id", "department_id"),
  CONSTRAINT "cases_source_identity_key" UNIQUE ("source_notary_matter_id", "source_lead_id", "customer_id", "rights_holder_id", "department_id"),
  CONSTRAINT "cases_certificate_id_key" UNIQUE ("certificate_id"),
  CONSTRAINT "cases_certificate_matter_department_key" UNIQUE ("certificate_id", "source_notary_matter_id", "department_id"),
  CONSTRAINT "cases_department_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "cases_lead_fkey" FOREIGN KEY ("source_lead_id", "customer_id", "department_id") REFERENCES "leads"("id", "customer_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "cases_customer_fkey" FOREIGN KEY ("customer_id", "department_id") REFERENCES "customers"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "cases_rights_holder_fkey" FOREIGN KEY ("rights_holder_id", "department_id") REFERENCES "rights_holders"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "cases_matter_fkey" FOREIGN KEY ("source_notary_matter_id", "source_lead_id", "customer_id", "rights_holder_id", "department_id") REFERENCES "notary_matters"("id", "source_lead_id", "customer_id", "rights_holder_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "cases_owner_fkey" FOREIGN KEY ("responsible_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "cases_owner_user_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "cases_certificate_fkey" FOREIGN KEY ("certificate_id", "source_notary_matter_id", "department_id") REFERENCES "notary_certificates"("id", "matter_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "cases_department_created_at_idx" ON "cases"("department_id", "created_at", "id");

INSERT INTO "role_grants" ("id", "role_template_id", "action", "scope")
SELECT (
  SUBSTR(MD5("template"."id"::text || ':case.read'), 1, 8) || '-' ||
  SUBSTR(MD5("template"."id"::text || ':case.read'), 9, 4) || '-4' ||
  SUBSTR(MD5("template"."id"::text || ':case.read'), 14, 3) || '-8' ||
  SUBSTR(MD5("template"."id"::text || ':case.read'), 18, 3) || '-' ||
  SUBSTR(MD5("template"."id"::text || ':case.read'), 21, 12)
)::UUID, "template"."id", 'case.read'::"permission_action", 'DEPARTMENT'::"permission_scope"
FROM "role_templates" AS "template"
WHERE EXISTS (SELECT 1 FROM "role_grants" AS "grant" WHERE "grant"."role_template_id" = "template"."id" AND "grant"."action" = 'lead.read'::"permission_action")
ON CONFLICT ("role_template_id", "action", "scope") DO NOTHING;

CREATE FUNCTION reject_notary_certificate_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'confirmed notary certificate is immutable' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER reject_notary_certificate_mutation BEFORE UPDATE OR DELETE ON "notary_certificates" FOR EACH ROW EXECUTE FUNCTION reject_notary_certificate_mutation();
CREATE TRIGGER reject_notary_certificate_fee_mutation BEFORE UPDATE OR DELETE ON "notary_certificate_fees" FOR EACH ROW EXECUTE FUNCTION reject_notary_certificate_mutation();

COMMIT;
