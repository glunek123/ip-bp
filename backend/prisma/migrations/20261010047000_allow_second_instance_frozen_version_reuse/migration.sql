-- A later progress revision or corrected result may freeze an exact available
-- version again. Its audit event distinguishes the immutable reference.
ALTER TABLE "material_references" ADD CONSTRAINT "material_references_second_instance_event_check"
  CHECK ("purpose" NOT IN ('SECOND_INSTANCE_DOCUMENT','SECOND_INSTANCE_SERVICE','SECOND_INSTANCE_JUDGMENT') OR "action_event_id" IS NOT NULL);

DROP INDEX "material_references_resource_purpose_version_key";
CREATE UNIQUE INDEX "material_references_resource_purpose_version_key"
  ON "material_references"("resource_type", "resource_id", "purpose", "content_version_id")
  WHERE "purpose" NOT IN ('JUDGMENT','SECOND_INSTANCE_DOCUMENT','SECOND_INSTANCE_SERVICE','SECOND_INSTANCE_JUDGMENT');
