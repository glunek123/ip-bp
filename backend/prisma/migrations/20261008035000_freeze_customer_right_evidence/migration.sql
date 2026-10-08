BEGIN;

ALTER TABLE "customer_right_asset_versions"
  ADD COLUMN "evidence_content_version_ids" UUID[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT "customer_right_asset_versions_evidence_limit_check"
    CHECK (cardinality("evidence_content_version_ids") <= 10);
ALTER TABLE "customer_right_asset_versions"
  ADD CONSTRAINT "customer_right_asset_versions_id_department_key" UNIQUE ("id", "department_id");

ALTER TABLE "material_references" ADD COLUMN "asset_version_id" UUID;
ALTER TABLE "material_references"
  ADD CONSTRAINT "material_references_asset_version_department_fkey"
    FOREIGN KEY ("asset_version_id", "department_id")
    REFERENCES "customer_right_asset_versions"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "material_references_right_asset_shape_check" CHECK (
    ("purpose" = 'CUSTOMER_RIGHT_EVIDENCE' AND "resource_type" = 'right_asset_version'
      AND "asset_version_id" IS NOT NULL AND "resource_id" = "asset_version_id" AND "action_event_id" IS NOT NULL)
    OR ("purpose" <> 'CUSTOMER_RIGHT_EVIDENCE' AND "asset_version_id" IS NULL)
  );
CREATE INDEX "material_references_asset_version_idx" ON "material_references"("asset_version_id")
  WHERE "asset_version_id" IS NOT NULL;

CREATE FUNCTION "check_customer_right_evidence_material"() RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'materials' AND TG_OP = 'UPDATE' AND
    EXISTS (SELECT 1 FROM "material_references" r WHERE r."material_id" = OLD."id" AND r."asset_version_id" IS NOT NULL) AND
    (NEW."owner_type", NEW."owner_id", NEW."department_id", NEW."category", NEW."purpose", NEW."status")
      IS DISTINCT FROM (OLD."owner_type", OLD."owner_id", OLD."department_id", OLD."category", OLD."purpose", OLD."status") THEN
    RAISE EXCEPTION 'frozen right evidence material identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."category" = 'CUSTOMER_RIGHT_EVIDENCE' THEN
    IF NEW."owner_type" <> 'CUSTOMER' OR NEW."purpose" <> 'CUSTOMER_RIGHT_EVIDENCE'
      OR NOT EXISTS (SELECT 1 FROM "customers" c WHERE c."id" = NEW."owner_id" AND c."department_id" = NEW."department_id") THEN
      RAISE EXCEPTION 'right evidence requires matching customer owner, department and purpose' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "materials_customer_right_evidence_guard" BEFORE INSERT OR UPDATE ON "materials"
  FOR EACH ROW EXECUTE FUNCTION "check_customer_right_evidence_material"();
CREATE TRIGGER "upload_drafts_customer_right_evidence_guard" BEFORE INSERT OR UPDATE ON "upload_drafts"
  FOR EACH ROW EXECUTE FUNCTION "check_customer_right_evidence_material"();

CREATE FUNCTION "check_customer_right_evidence_reference"() RETURNS TRIGGER AS $$
DECLARE version_row RECORD;
BEGIN
  IF NEW."purpose" <> 'CUSTOMER_RIGHT_EVIDENCE' THEN RETURN NEW; END IF;
  SELECT v."id", v."customer_id", v."department_id", v."audit_event_id", v."evidence_content_version_ids"
    INTO version_row FROM "customer_right_asset_versions" v WHERE v."id" = NEW."asset_version_id";
  IF version_row."id" IS NULL OR version_row."department_id" <> NEW."department_id"
    OR version_row."audit_event_id" <> NEW."action_event_id"
    OR NOT (NEW."content_version_id" = ANY(version_row."evidence_content_version_ids"))
    OR NOT EXISTS (
      SELECT 1 FROM "materials" m JOIN "content_versions" cv ON cv."material_id" = m."id"
      WHERE m."id" = NEW."material_id" AND cv."id" = NEW."content_version_id"
        AND m."owner_type" = 'CUSTOMER' AND m."owner_id" = version_row."customer_id"
        AND m."department_id" = version_row."department_id"
        AND m."category" = 'CUSTOMER_RIGHT_EVIDENCE' AND m."purpose" = 'CUSTOMER_RIGHT_EVIDENCE'
        AND m."status" = 'ACTIVE' AND cv."status" = 'AVAILABLE'
        AND cv."mime_type" IN ('application/pdf', 'image/jpeg', 'image/png')
        AND cv."size_bytes" <= 20971520
    ) THEN
    RAISE EXCEPTION 'right evidence reference does not match asset version and customer material' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "material_references_right_evidence_insert_guard" BEFORE INSERT ON "material_references"
  FOR EACH ROW EXECUTE FUNCTION "check_customer_right_evidence_reference"();

CREATE FUNCTION "reject_customer_right_evidence_reference_mutation"() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."purpose" = 'CUSTOMER_RIGHT_EVIDENCE' OR (TG_OP = 'UPDATE' AND NEW."purpose" = 'CUSTOMER_RIGHT_EVIDENCE') THEN
    RAISE EXCEPTION 'frozen right evidence reference is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "material_references_right_evidence_immutable" BEFORE UPDATE OR DELETE ON "material_references"
  FOR EACH ROW EXECUTE FUNCTION "reject_customer_right_evidence_reference_mutation"();

CREATE FUNCTION "check_customer_right_evidence_set"() RETURNS TRIGGER AS $$
DECLARE expected_count INTEGER;
BEGIN
  SELECT COUNT(DISTINCT selected) INTO expected_count FROM unnest(NEW."evidence_content_version_ids") AS selected;
  IF expected_count <> cardinality(NEW."evidence_content_version_ids") OR
    (SELECT COUNT(*) FROM "material_references" r WHERE r."asset_version_id" = NEW."id") <> expected_count OR
    EXISTS (
      SELECT 1 FROM unnest(NEW."evidence_content_version_ids") AS selected
      WHERE NOT EXISTS (SELECT 1 FROM "material_references" r
        WHERE r."asset_version_id" = NEW."id" AND r."content_version_id" = selected)
    ) THEN
    RAISE EXCEPTION 'right evidence frozen set differs from asset version' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "customer_right_asset_evidence_set_guard"
  AFTER INSERT ON "customer_right_asset_versions" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "check_customer_right_evidence_set"();

CREATE FUNCTION "reject_frozen_customer_right_evidence_content_mutation"() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "material_references" r
    WHERE r."content_version_id" = OLD."id" AND r."asset_version_id" IS NOT NULL) THEN
    RAISE EXCEPTION 'frozen right evidence content is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "content_versions_right_evidence_immutable" BEFORE UPDATE OR DELETE ON "content_versions"
  FOR EACH ROW EXECUTE FUNCTION "reject_frozen_customer_right_evidence_content_mutation"();

COMMIT;
