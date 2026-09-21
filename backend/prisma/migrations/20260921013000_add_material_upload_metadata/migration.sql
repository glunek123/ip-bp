BEGIN;

ALTER TABLE "upload_drafts"
  ADD COLUMN "purpose" VARCHAR(100) NOT NULL,
  ADD COLUMN "original_filename" VARCHAR(200) NOT NULL,
  ADD COLUMN "declared_mime_type" VARCHAR(100) NOT NULL,
  ADD CONSTRAINT "upload_drafts_metadata_nonblank_check" CHECK (
    NULLIF(BTRIM("purpose"), '') IS NOT NULL
    AND NULLIF(BTRIM("original_filename"), '') IS NOT NULL
    AND NULLIF(BTRIM("declared_mime_type"), '') IS NOT NULL
  );

ALTER TABLE "materials"
  ADD COLUMN "purpose" VARCHAR(100) NOT NULL,
  ADD CONSTRAINT "materials_purpose_nonblank_check" CHECK (
    NULLIF(BTRIM("purpose"), '') IS NOT NULL
  );

COMMIT;
