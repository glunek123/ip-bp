BEGIN;

ALTER TABLE "lead_csv_import_receipts"
  ADD COLUMN "remote_fingerprint" CHAR(64);
ALTER TABLE "lead_csv_import_receipts"
  ADD CONSTRAINT "lead_csv_remote_fingerprint_check"
    CHECK ("remote_fingerprint" IS NULL OR "remote_fingerprint" ~ '^[0-9a-f]{64}$');

ALTER TABLE "content_versions" ADD COLUMN "source_upload_draft_id" UUID;
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_source_upload_draft_fk"
  FOREIGN KEY ("source_upload_draft_id") REFERENCES "upload_drafts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX "content_versions_source_upload_draft_id_key" ON "content_versions"("source_upload_draft_id");

CREATE TABLE "lead_image_import_tasks" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "row_number" INTEGER NOT NULL,
  "product_number" INTEGER NOT NULL,
  "url" VARCHAR(2048) NOT NULL,
  "url_sha256" CHAR(64) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "generation" INTEGER NOT NULL DEFAULT 0,
  "lease_until" TIMESTAMPTZ(3),
  "upload_draft_id" UUID,
  "content_version_id" UUID,
  "failure_code" VARCHAR(60),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_image_import_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_image_import_tasks_numbers_check" CHECK ("row_number" BETWEEN 2 AND 2097153 AND "product_number" BETWEEN 1 AND 100),
  CONSTRAINT "lead_image_import_tasks_status_check" CHECK ("status" IN ('PENDING','LEASED','ATTACHED','FAILED')),
  CONSTRAINT "lead_image_import_tasks_attempt_check" CHECK ("attempt_count" BETWEEN 0 AND 5),
  CONSTRAINT "lead_image_import_tasks_generation_check" CHECK ("generation" >= 0),
  CONSTRAINT "lead_image_import_tasks_url_hash_check" CHECK ("url_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "lead_image_import_tasks_unique_url" UNIQUE ("lead_id", "product_id", "url_sha256")
);
CREATE INDEX "lead_image_import_tasks_queue_idx" ON "lead_image_import_tasks"("status", "lease_until", "created_at");
CREATE INDEX "lead_image_import_tasks_actor_idx" ON "lead_image_import_tasks"("department_id", "actor_user_id", "created_at");
CREATE UNIQUE INDEX "lead_image_import_tasks_upload_draft_id_key" ON "lead_image_import_tasks"("upload_draft_id");
ALTER TABLE "lead_image_import_tasks"
  ADD CONSTRAINT "lead_image_import_tasks_lead_fk" FOREIGN KEY ("lead_id", "department_id") REFERENCES "leads"("id", "department_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "lead_image_import_tasks_product_fk" FOREIGN KEY ("product_id", "lead_id") REFERENCES "lead_products"("id", "lead_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "lead_image_import_tasks_actor_fk" FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "lead_image_import_tasks_content_fk" FOREIGN KEY ("content_version_id") REFERENCES "content_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_image_import_tasks"
  ADD CONSTRAINT "lead_image_import_tasks_upload_draft_fk" FOREIGN KEY ("upload_draft_id") REFERENCES "upload_drafts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

COMMIT;
