-- A correction may select a still-available version already frozen by an earlier judgment fact.
-- Preserve the original uniqueness rule for every other material purpose.
ALTER TABLE "material_references" DROP CONSTRAINT "material_references_resource_purpose_version_key";
ALTER TABLE "material_references" ADD CONSTRAINT "material_references_judgment_event_check"
  CHECK ("purpose" <> 'JUDGMENT' OR "action_event_id" IS NOT NULL);
CREATE UNIQUE INDEX "material_references_resource_purpose_version_key"
  ON "material_references"("resource_type", "resource_id", "purpose", "content_version_id")
  WHERE "purpose" <> 'JUDGMENT';
CREATE UNIQUE INDEX "material_references_resource_purpose_version_event_key"
  ON "material_references"("resource_type", "resource_id", "purpose", "content_version_id", "action_event_id");
