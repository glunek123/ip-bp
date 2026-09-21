BEGIN;

ALTER TABLE "upload_drafts"
  ADD COLUMN "pending_storage_key" VARCHAR(500),
  ADD CONSTRAINT "upload_drafts_pending_storage_key_nonblank_check"
    CHECK (
      "pending_storage_key" IS NULL
      OR NULLIF(BTRIM("pending_storage_key"), '') IS NOT NULL
    );

CREATE UNIQUE INDEX "upload_drafts_pending_storage_key_key"
  ON "upload_drafts"("pending_storage_key");

COMMIT;
