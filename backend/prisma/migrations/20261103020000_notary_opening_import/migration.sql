BEGIN;

CREATE TABLE "notary_opening_import_batches" (
  "id" UUID NOT NULL PRIMARY KEY,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "zip_sha256" CHAR(64) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'READY',
  "recognition_mode" VARCHAR(16) NOT NULL DEFAULT 'DISABLED',
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notary_opening_import_batches_status_check" CHECK ("status" IN ('READY','CANCELLED')),
  CONSTRAINT "notary_opening_import_batches_mode_check" CHECK ("recognition_mode" IN ('DISABLED','MOCK')),
  CONSTRAINT "notary_opening_import_batches_actor_department_fkey" FOREIGN KEY ("actor_user_id","department_id") REFERENCES "department_memberships"("user_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_opening_import_batches_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "notary_opening_import_batches_id_department_key" ON "notary_opening_import_batches"("id","department_id");
CREATE UNIQUE INDEX "notary_opening_import_batches_actor_key" ON "notary_opening_import_batches"("department_id","actor_user_id","idempotency_key");
CREATE INDEX "notary_opening_import_batches_expiry_idx" ON "notary_opening_import_batches"("expires_at","status");

CREATE TABLE "notary_opening_import_items" (
  "id" UUID NOT NULL PRIMARY KEY,
  "batch_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "folder_name" VARCHAR(200) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "status" VARCHAR(16) NOT NULL DEFAULT 'READY',
  "tracking_candidate" VARCHAR(100),
  "tracking_no" VARCHAR(100),
  "recognition_status" VARCHAR(16) NOT NULL DEFAULT 'DISABLED',
  "sender_candidate" JSONB,
  "match_status" VARCHAR(16) NOT NULL DEFAULT 'UNMATCHED',
  "suggested_matter_id" UUID,
  "selected_matter_id" UUID,
  "confirmed_key" VARCHAR(128),
  CONSTRAINT "notary_opening_import_items_revision_check" CHECK ("revision" >= 1 AND "position" >= 1),
  CONSTRAINT "notary_opening_import_items_status_check" CHECK ("status" IN ('READY','CONFLICT','COMMITTED')),
  CONSTRAINT "notary_opening_import_items_recognition_check" CHECK ("recognition_status" IN ('DISABLED','SUCCEEDED','FAILED')),
  CONSTRAINT "notary_opening_import_items_match_check" CHECK ("match_status" IN ('UNMATCHED','SUGGESTED','AMBIGUOUS','CONFLICT')),
  CONSTRAINT "notary_opening_import_items_batch_department_fkey" FOREIGN KEY ("batch_id","department_id") REFERENCES "notary_opening_import_batches"("id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "notary_opening_import_items_selected_matter_fkey" FOREIGN KEY ("selected_matter_id","department_id") REFERENCES "notary_matters"("id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "notary_opening_import_items_batch_position_key" ON "notary_opening_import_items"("batch_id","position");
CREATE UNIQUE INDEX "notary_opening_import_items_batch_folder_key" ON "notary_opening_import_items"("batch_id","folder_name");
CREATE UNIQUE INDEX "notary_opening_import_items_identity_key" ON "notary_opening_import_items"("id","batch_id","department_id");
CREATE INDEX "notary_opening_import_items_selected_idx" ON "notary_opening_import_items"("department_id","selected_matter_id","status");
CREATE UNIQUE INDEX "notary_opening_import_items_active_target_key" ON "notary_opening_import_items"("batch_id","selected_matter_id") WHERE "selected_matter_id" IS NOT NULL AND "status" <> 'COMMITTED';

CREATE TABLE "notary_opening_import_photos" (
  "id" UUID NOT NULL PRIMARY KEY,
  "item_id" UUID NOT NULL,
  "batch_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "filename" VARCHAR(200) NOT NULL,
  "storage_key" VARCHAR(500) NOT NULL,
  "material_id" UUID NOT NULL,
  "content_version_id" UUID NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  CONSTRAINT "notary_opening_import_photos_size_check" CHECK ("size_bytes" BETWEEN 1 AND 20971520),
  CONSTRAINT "notary_opening_import_photos_mime_check" CHECK ("mime_type" IN ('image/jpeg','image/png','image/webp')),
  CONSTRAINT "notary_opening_import_photos_item_fkey" FOREIGN KEY ("item_id","batch_id","department_id") REFERENCES "notary_opening_import_items"("id","batch_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "notary_opening_import_photos_item_filename_key" ON "notary_opening_import_photos"("item_id","filename");
CREATE UNIQUE INDEX "notary_opening_import_photos_storage_key_key" ON "notary_opening_import_photos"("storage_key");
CREATE UNIQUE INDEX "notary_opening_import_photos_material_id_key" ON "notary_opening_import_photos"("material_id");
CREATE UNIQUE INDEX "notary_opening_import_photos_content_version_id_key" ON "notary_opening_import_photos"("content_version_id");

COMMIT;
