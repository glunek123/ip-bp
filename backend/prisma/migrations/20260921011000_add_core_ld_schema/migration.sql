BEGIN;

ALTER TYPE "customer_profile_status" ADD VALUE 'ADMITTED';

COMMIT;

BEGIN;

CREATE TYPE "identity_validity_mode" AS ENUM ('FIXED', 'LONG_TERM', 'NOT_STATED');
CREATE TYPE "upload_draft_status" AS ENUM ('OPEN', 'FINALIZED', 'EXPIRED');
CREATE TYPE "material_owner_type" AS ENUM ('CUSTOMER', 'LEAD_DRAFT', 'LEAD');
CREATE TYPE "material_category" AS ENUM ('CUSTOMER_IDENTITY', 'LEAD_SCREENSHOT');
CREATE TYPE "material_status" AS ENUM ('ACTIVE', 'DELETED');
CREATE TYPE "content_version_status" AS ENUM ('AVAILABLE', 'DELETED', 'PURGED');
CREATE TYPE "lead_status" AS ENUM ('WAITING_PUSH', 'WAITING_REVIEW', 'WAITING_EVIDENCE_DECISION', 'ARCHIVED');
CREATE TYPE "lead_case_type" AS ENUM ('CIVIL', 'CRIMINAL', 'ADMINISTRATIVE', 'INVESTIGATION', 'NOTARIZATION', 'HEARING_REPRESENTATION');
CREATE TYPE "infringement_type" AS ENUM ('TRADEMARK', 'SOFTWARE_COPYRIGHT', 'ART_COPYRIGHT', 'AUDIOVISUAL_COPYRIGHT', 'TEXT_COPYRIGHT', 'INVENTION_PATENT', 'DESIGN_PATENT', 'UTILITY_MODEL_PATENT', 'UNFAIR_COMPETITION', 'NETWORK_DISSEMINATION', 'PORTRAIT_RIGHT', 'OTHER');
CREATE TYPE "lead_source" AS ENUM ('ONLINE', 'OFFLINE');
CREATE TYPE "lead_platform" AS ENUM ('TAOBAO', 'TMALL', 'PINDUODUO', 'JD', 'DOUYIN', 'ALIBABA_1688', 'XIAOHONGSHU', 'KUAISHOU', 'XIANYU', 'WECHAT', 'MEITUAN', 'DIANPING', 'MAP', 'OTHER');
CREATE TYPE "lead_creation_channel" AS ENUM ('MANUAL', 'OCR', 'CRAWLER', 'CSV', 'HISTORICAL');

ALTER TABLE "customers"
  ADD COLUMN "identity_valid_from" DATE,
  ADD COLUMN "identity_valid_to" DATE,
  ADD COLUMN "identity_validity_mode" "identity_validity_mode",
  ADD COLUMN "admitted_at" TIMESTAMPTZ(3);

UPDATE "customers"
SET "customer_type" = 'ENTERPRISE'
WHERE LOWER("customer_type") = 'enterprise';

UPDATE "customers"
SET "identity_type" = 'BUSINESS_LICENSE'
WHERE LOWER("identity_type") IN ('credit-code', 'credit_code');

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_version_positive_check"
    CHECK ("version" >= 1),
  ADD CONSTRAINT "customers_admitted_fields_compatible_check"
    CHECK (
      "profile_status" <> 'ADMITTED'
      OR (
        "customer_type" IN (
          'ENTERPRISE', 'SOLE_PROPRIETOR', 'NATURAL_PERSON',
          'PUBLIC_INSTITUTION', 'SOCIAL_ORGANIZATION', 'OTHER_ORGANIZATION'
        )
        AND "identity_type" IN (
          'BUSINESS_LICENSE', 'VERIFIED_E_BUSINESS_LICENSE', 'NATIONAL_ID',
          'PASSPORT', 'OTHER_VALID_ID', 'ORGANIZATION_REGISTRATION_CERTIFICATE'
        )
        AND (
          ("customer_type" IN ('ENTERPRISE', 'SOLE_PROPRIETOR')
            AND "identity_type" IN ('BUSINESS_LICENSE', 'VERIFIED_E_BUSINESS_LICENSE'))
          OR ("customer_type" = 'NATURAL_PERSON'
            AND "identity_type" IN ('NATIONAL_ID', 'PASSPORT', 'OTHER_VALID_ID'))
          OR ("customer_type" IN ('PUBLIC_INSTITUTION', 'SOCIAL_ORGANIZATION', 'OTHER_ORGANIZATION')
            AND "identity_type" = 'ORGANIZATION_REGISTRATION_CERTIFICATE')
        )
        AND NULLIF(BTRIM("name"), '') IS NOT NULL
        AND NULLIF(BTRIM("identity_number"), '') IS NOT NULL
        AND NULLIF(BTRIM("normalized_identity_number"), '') IS NOT NULL
        AND NULLIF(BTRIM("admission_contact_name"), '') IS NOT NULL
        AND (
          NULLIF(BTRIM("admission_contact_phone"), '') IS NOT NULL
          OR NULLIF(BTRIM("admission_contact_email"), '') IS NOT NULL
        )
        AND "identity_validity_mode" IS NOT NULL
        AND (
          ("identity_validity_mode" = 'FIXED'
            AND "identity_valid_to" IS NOT NULL
            AND ("identity_valid_from" IS NULL OR "identity_valid_to" >= "identity_valid_from"))
          OR ("identity_validity_mode" IN ('LONG_TERM', 'NOT_STATED')
            AND "identity_valid_to" IS NULL)
        )
        AND "admitted_at" IS NOT NULL
      )
    );

CREATE TABLE "upload_drafts" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "owner_type" "material_owner_type" NOT NULL,
  "owner_id" UUID NOT NULL,
  "category" "material_category" NOT NULL,
  "status" "upload_draft_status" NOT NULL DEFAULT 'OPEN',
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "upload_drafts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "materials" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "owner_type" "material_owner_type" NOT NULL,
  "owner_id" UUID NOT NULL,
  "category" "material_category" NOT NULL,
  "current_version_id" UUID,
  "status" "material_status" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "deleted_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "materials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "materials_id_department_id_key" UNIQUE ("id", "department_id"),
  CONSTRAINT "materials_version_positive_check" CHECK ("version" >= 1),
  CONSTRAINT "materials_deleted_at_status_check"
    CHECK (("status" = 'ACTIVE' AND "deleted_at" IS NULL) OR "status" = 'DELETED')
);

CREATE TABLE "content_versions" (
  "id" UUID NOT NULL,
  "material_id" UUID NOT NULL,
  "storage_key" VARCHAR(500) NOT NULL,
  "original_filename" VARCHAR(200) NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "uploaded_by" UUID NOT NULL,
  "derived_from_version_id" UUID,
  "status" "content_version_status" NOT NULL DEFAULT 'AVAILABLE',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "content_versions_material_id_id_key" UNIQUE ("material_id", "id"),
  CONSTRAINT "content_versions_storage_key_key" UNIQUE ("storage_key"),
  CONSTRAINT "content_versions_metadata_nonblank_check" CHECK (
    NULLIF(BTRIM("storage_key"), '') IS NOT NULL
    AND NULLIF(BTRIM("original_filename"), '') IS NOT NULL
    AND NULLIF(BTRIM("mime_type"), '') IS NOT NULL
    AND "sha256" ~ '^[0-9A-Fa-f]{64}$'
  ),
  CONSTRAINT "content_versions_size_nonnegative_check" CHECK ("size_bytes" >= 0)
);

ALTER TABLE "materials"
  ADD CONSTRAINT "materials_current_version_fkey"
  FOREIGN KEY ("id", "current_version_id")
  REFERENCES "content_versions"("material_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "material_references" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "resource_type" VARCHAR(100) NOT NULL,
  "resource_id" UUID NOT NULL,
  "purpose" VARCHAR(100) NOT NULL,
  "material_id" UUID NOT NULL,
  "content_version_id" UUID NOT NULL,
  "action_event_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "material_references_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "material_references_resource_purpose_version_key"
    UNIQUE ("resource_type", "resource_id", "purpose", "content_version_id"),
  CONSTRAINT "material_references_names_nonblank_check" CHECK (
    NULLIF(BTRIM("resource_type"), '') IS NOT NULL
    AND NULLIF(BTRIM("purpose"), '') IS NOT NULL
  )
);

CREATE TABLE "customer_admission_receipts" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "result_customer_id" UUID NOT NULL,
  "result_customer_version" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_admission_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_admission_receipts_department_actor_key"
    UNIQUE ("department_id", "actor_user_id", "idempotency_key"),
  CONSTRAINT "customer_admission_receipts_values_check" CHECK (
    NULLIF(BTRIM("idempotency_key"), '') IS NOT NULL
    AND "request_fingerprint" ~ '^[0-9A-Fa-f]{64}$'
    AND "result_customer_version" >= 1
  )
);

CREATE TABLE "leads" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "business_no" VARCHAR(100) NOT NULL,
  "customer_id" UUID NOT NULL,
  "rights_holder_id" UUID NOT NULL,
  "responsible_user_id" UUID NOT NULL,
  "team_id" UUID,
  "status" "lead_status" NOT NULL DEFAULT 'WAITING_PUSH',
  "case_type" "lead_case_type" NOT NULL,
  "source" "lead_source" NOT NULL,
  "platform" "lead_platform" NOT NULL,
  "found_at" TIMESTAMPTZ(3) NOT NULL,
  "shop_name" VARCHAR(200) NOT NULL,
  "shop_external_id" VARCHAR(100),
  "need_disclose" BOOLEAN NOT NULL,
  "remark" TEXT,
  "creation_channel" "lead_creation_channel" NOT NULL DEFAULT 'MANUAL',
  "external_source_ref" VARCHAR(100),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "leads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leads_id_department_id_key" UNIQUE ("id", "department_id"),
  CONSTRAINT "leads_business_no_key" UNIQUE ("business_no"),
  CONSTRAINT "leads_department_id_creation_channel_external_source_ref_key"
    UNIQUE ("department_id", "creation_channel", "external_source_ref"),
  CONSTRAINT "leads_nonblank_fields_check" CHECK (
    NULLIF(BTRIM("business_no"), '') IS NOT NULL
    AND NULLIF(BTRIM("shop_name"), '') IS NOT NULL
    AND ("shop_external_id" IS NULL OR NULLIF(BTRIM("shop_external_id"), '') IS NOT NULL)
    AND ("remark" IS NULL OR NULLIF(BTRIM("remark"), '') IS NOT NULL)
    AND ("external_source_ref" IS NULL OR NULLIF(BTRIM("external_source_ref"), '') IS NOT NULL)
  ),
  CONSTRAINT "leads_version_positive_check" CHECK ("version" >= 1),
  CONSTRAINT "leads_source_platform_compatible_check" CHECK (
    ("source" = 'ONLINE' AND "platform" IN (
      'TAOBAO', 'TMALL', 'PINDUODUO', 'JD', 'DOUYIN', 'ALIBABA_1688',
      'XIAOHONGSHU', 'KUAISHOU', 'XIANYU', 'WECHAT', 'OTHER'
    ))
    OR ("source" = 'OFFLINE' AND "platform" IN ('MEITUAN', 'DIANPING', 'MAP', 'OTHER'))
  ),
  CONSTRAINT "leads_external_source_compatible_check" CHECK (
    ("creation_channel" = 'MANUAL' AND "external_source_ref" IS NULL)
    OR ("creation_channel" <> 'MANUAL' AND NULLIF(BTRIM("external_source_ref"), '') IS NOT NULL)
  )
);

CREATE TABLE "lead_products" (
  "id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "url" VARCHAR(2048),
  "title" VARCHAR(200),
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "unit_price" DECIMAL(18,2) NOT NULL,
  "comment_count" INTEGER NOT NULL DEFAULT 0,
  "estimated_amount" DECIMAL(18,2) NOT NULL,
  CONSTRAINT "lead_products_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_products_lead_id_position_key" UNIQUE ("lead_id", "position"),
  CONSTRAINT "lead_products_identity_check" CHECK (
    "position" >= 1
    AND (NULLIF(BTRIM("url"), '') IS NOT NULL OR NULLIF(BTRIM("title"), '') IS NOT NULL)
    AND ("url" IS NULL OR NULLIF(BTRIM("url"), '') IS NOT NULL)
    AND ("title" IS NULL OR NULLIF(BTRIM("title"), '') IS NOT NULL)
  ),
  CONSTRAINT "lead_products_nonnegative_check" CHECK (
    "quantity" >= 0
    AND "comment_count" >= 0
    AND "unit_price" >= 0
    AND "estimated_amount" >= 0
  )
);

CREATE TABLE "lead_infringements" (
  "id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "infringement_type" "infringement_type" NOT NULL,
  CONSTRAINT "lead_infringements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_infringements_lead_id_infringement_type_key"
    UNIQUE ("lead_id", "infringement_type")
);

CREATE TABLE "lead_number_counters" (
  "business_date" DATE NOT NULL,
  "last_value" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "lead_number_counters_pkey" PRIMARY KEY ("business_date"),
  CONSTRAINT "lead_number_counters_range_check" CHECK ("last_value" BETWEEN 0 AND 999)
);

CREATE TABLE "lead_command_receipts" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "action" VARCHAR(100) NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "result_lead_id" UUID NOT NULL,
  "result_lead_version" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_command_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_command_receipts_department_actor_action_key"
    UNIQUE ("department_id", "actor_user_id", "action", "idempotency_key"),
  CONSTRAINT "lead_command_receipts_values_check" CHECK (
    NULLIF(BTRIM("action"), '') IS NOT NULL
    AND NULLIF(BTRIM("idempotency_key"), '') IS NOT NULL
    AND "request_fingerprint" ~ '^[0-9A-Fa-f]{64}$'
    AND "result_lead_version" >= 1
  )
);

CREATE INDEX "upload_drafts_department_id_owner_type_owner_id_status_idx"
  ON "upload_drafts"("department_id", "owner_type", "owner_id", "status");
CREATE INDEX "upload_drafts_status_expires_at_idx"
  ON "upload_drafts"("status", "expires_at");
CREATE INDEX "materials_department_id_owner_type_owner_id_status_idx"
  ON "materials"("department_id", "owner_type", "owner_id", "status");
CREATE INDEX "content_versions_material_id_status_created_at_idx"
  ON "content_versions"("material_id", "status", "created_at");
CREATE INDEX "content_versions_sha256_idx" ON "content_versions"("sha256");
CREATE INDEX "material_references_department_id_resource_type_resource_id_idx"
  ON "material_references"("department_id", "resource_type", "resource_id");
CREATE INDEX "material_references_material_id_idx" ON "material_references"("material_id");
CREATE INDEX "customer_admission_receipts_customer_department_idx"
  ON "customer_admission_receipts"("result_customer_id", "department_id");
CREATE INDEX "leads_department_id_status_updated_at_id_idx"
  ON "leads"("department_id", "status", "updated_at", "id");
CREATE INDEX "leads_responsible_user_id_idx" ON "leads"("responsible_user_id");
CREATE INDEX "leads_team_id_idx" ON "leads"("team_id");
CREATE INDEX "lead_command_receipts_result_lead_id_department_id_idx"
  ON "lead_command_receipts"("result_lead_id", "department_id");

ALTER TABLE "upload_drafts"
  ADD CONSTRAINT "upload_drafts_department_id_fkey"
    FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "upload_drafts_actor_department_fkey"
    FOREIGN KEY ("actor_user_id", "department_id")
    REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "materials"
  ADD CONSTRAINT "materials_department_id_fkey"
    FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "content_versions"
  ADD CONSTRAINT "content_versions_material_id_fkey"
    FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "content_versions_uploaded_by_fkey"
    FOREIGN KEY ("uploaded_by") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "content_versions_derived_from_version_id_fkey"
    FOREIGN KEY ("derived_from_version_id") REFERENCES "content_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "material_references"
  ADD CONSTRAINT "material_references_department_id_fkey"
    FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "material_references_material_department_fkey"
    FOREIGN KEY ("material_id", "department_id")
    REFERENCES "materials"("id", "department_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "material_references_content_material_fkey"
    FOREIGN KEY ("material_id", "content_version_id")
    REFERENCES "content_versions"("material_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "material_references_action_event_id_fkey"
    FOREIGN KEY ("action_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_admission_receipts"
  ADD CONSTRAINT "customer_admission_receipts_department_id_fkey"
    FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "customer_admission_receipts_actor_department_fkey"
    FOREIGN KEY ("actor_user_id", "department_id")
    REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "customer_admission_receipts_customer_department_fkey"
    FOREIGN KEY ("result_customer_id", "department_id")
    REFERENCES "customers"("id", "department_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_department_id_fkey"
    FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "leads_customer_department_fkey"
    FOREIGN KEY ("customer_id", "department_id")
    REFERENCES "customers"("id", "department_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "leads_rights_holder_department_fkey"
    FOREIGN KEY ("rights_holder_id", "department_id")
    REFERENCES "rights_holders"("id", "department_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "leads_team_department_fkey"
    FOREIGN KEY ("team_id", "department_id")
    REFERENCES "teams"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "leads_responsible_department_fkey"
    FOREIGN KEY ("responsible_user_id", "department_id")
    REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lead_products"
  ADD CONSTRAINT "lead_products_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lead_infringements"
  ADD CONSTRAINT "lead_infringements_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lead_command_receipts"
  ADD CONSTRAINT "lead_command_receipts_department_id_fkey"
    FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "lead_command_receipts_actor_department_fkey"
    FOREIGN KEY ("actor_user_id", "department_id")
    REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "lead_command_receipts_lead_department_fkey"
    FOREIGN KEY ("result_lead_id", "department_id")
    REFERENCES "leads"("id", "department_id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
