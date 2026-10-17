BEGIN;

-- CreateEnum
CREATE TYPE "evidence_source_kind" AS ENUM ('CASE', 'NOTARY_MATTER');

-- CreateEnum
CREATE TYPE "evidence_item_status" AS ENUM ('UNDELIVERED', 'IN_STOCK', 'MAILED_TO_LAWYER', 'DESTROYED');

-- CreateEnum
CREATE TYPE "evidence_paper_status" AS ENUM ('NOT_ISSUED', 'MAILED_TO_LAWYER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "permission_action" ADD VALUE 'evidence.read';
ALTER TYPE "permission_action" ADD VALUE 'evidence.edit';
ALTER TYPE "permission_action" ADD VALUE 'evidence.bulk-status';
ALTER TYPE "permission_action" ADD VALUE 'evidence.export';

-- CreateTable
CREATE TABLE "evidence_group_versions" (
    "id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "source_kind" "evidence_source_kind" NOT NULL,
    "source_id" UUID NOT NULL,
    "case_id" UUID,
    "source_notary_matter_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "source_initialized_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "evidence_group_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_items" (
    "id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "case_id" UUID,
    "source_notary_matter_id" UUID,
    "source_kind" "evidence_source_kind" NOT NULL,
    "source_id" UUID NOT NULL,
    "display_code" VARCHAR(200),
    "name" VARCHAR(200),
    "kind" VARCHAR(100),
    "collected_on" DATE,
    "provenance" VARCHAR(500),
    "shelf_location" VARCHAR(200),
    "keeper_user_id" UUID,
    "status" "evidence_item_status" NOT NULL DEFAULT 'UNDELIVERED',
    "remark" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "removed_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "evidence_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_paper_certificates" (
    "id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "case_id" UUID,
    "source_notary_matter_id" UUID,
    "source_kind" "evidence_source_kind" NOT NULL,
    "source_id" UUID NOT NULL,
    "source_certificate_id" UUID,
    "number" VARCHAR(200),
    "issued_on" DATE,
    "office_name" VARCHAR(200),
    "pages" INTEGER,
    "content_version_id" UUID,
    "content_material_id" UUID,
    "status" "evidence_paper_status" NOT NULL DEFAULT 'NOT_ISSUED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "removed_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "evidence_paper_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_audit_events" (
    "id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "internal_actor_user_id" UUID,
    "notary_office_account_binding_id" UUID,
    "operation" VARCHAR(50) NOT NULL,
    "group_id" UUID,
    "item_id" UUID,
    "paper_certificate_id" UUID,
    "before_snapshot" JSONB,
    "after_snapshot" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_command_receipts" (
    "id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "command" VARCHAR(30) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "result_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_command_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evidence_group_versions_department_id_case_id_idx" ON "evidence_group_versions"("department_id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_group_versions_department_id_source_kind_source_id_key" ON "evidence_group_versions"("department_id", "source_kind", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_group_versions_id_department_id_key" ON "evidence_group_versions"("id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_group_versions_id_department_id_source_kind_source_key" ON "evidence_group_versions"("id", "department_id", "source_kind", "source_id");

-- CreateIndex
CREATE INDEX "evidence_items_department_id_case_id_status_created_at_id_idx" ON "evidence_items"("department_id", "case_id", "status", "created_at", "id");

-- CreateIndex
CREATE INDEX "evidence_items_department_id_source_kind_source_id_status_idx" ON "evidence_items"("department_id", "source_kind", "source_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_items_id_department_id_key" ON "evidence_items"("id", "department_id");

-- CreateIndex
CREATE INDEX "evidence_paper_certificates_department_id_case_id_created_a_idx" ON "evidence_paper_certificates"("department_id", "case_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "evidence_paper_certificates_department_id_source_kind_sourc_idx" ON "evidence_paper_certificates"("department_id", "source_kind", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_paper_certificates_id_department_id_key" ON "evidence_paper_certificates"("id", "department_id");

-- CreateIndex
CREATE INDEX "evidence_audit_events_department_id_group_id_created_at_idx" ON "evidence_audit_events"("department_id", "group_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_command_receipts_department_id_actor_user_id_idemp_key" ON "evidence_command_receipts"("department_id", "actor_user_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "evidence_group_versions" ADD CONSTRAINT "evidence_group_versions_case_id_department_id_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "evidence_group_versions" ADD CONSTRAINT "evidence_group_versions_source_notary_matter_id_department_fkey" FOREIGN KEY ("source_notary_matter_id", "department_id") REFERENCES "notary_matters"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_group_id_department_id_source_kind_source_i_fkey" FOREIGN KEY ("group_id", "department_id", "source_kind", "source_id") REFERENCES "evidence_group_versions"("id", "department_id", "source_kind", "source_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_case_id_department_id_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_source_notary_matter_id_department_id_fkey" FOREIGN KEY ("source_notary_matter_id", "department_id") REFERENCES "notary_matters"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "evidence_paper_certificates" ADD CONSTRAINT "evidence_paper_certificates_group_id_department_id_source__fkey" FOREIGN KEY ("group_id", "department_id", "source_kind", "source_id") REFERENCES "evidence_group_versions"("id", "department_id", "source_kind", "source_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "evidence_paper_certificates" ADD CONSTRAINT "evidence_paper_certificates_case_id_department_id_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "evidence_paper_certificates" ADD CONSTRAINT "evidence_paper_certificates_source_notary_matter_id_depart_fkey" FOREIGN KEY ("source_notary_matter_id", "department_id") REFERENCES "notary_matters"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "evidence_paper_certificates" ADD CONSTRAINT "evidence_paper_certificates_source_certificate_id_source_n_fkey" FOREIGN KEY ("source_certificate_id", "source_notary_matter_id", "department_id") REFERENCES "notary_certificates"("id", "matter_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "evidence_paper_certificates" ADD CONSTRAINT "evidence_paper_certificates_content_material_id_content_ve_fkey" FOREIGN KEY ("content_material_id", "content_version_id") REFERENCES "content_versions"("material_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "evidence_paper_certificates" ADD CONSTRAINT "evidence_paper_certificates_content_material_id_department_fkey" FOREIGN KEY ("content_material_id", "department_id") REFERENCES "materials"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "evidence_audit_events" ADD CONSTRAINT "evidence_audit_events_group_id_department_id_fkey" FOREIGN KEY ("group_id", "department_id") REFERENCES "evidence_group_versions"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "evidence_audit_events" ADD CONSTRAINT "evidence_audit_events_item_id_department_id_fkey" FOREIGN KEY ("item_id", "department_id") REFERENCES "evidence_items"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "evidence_audit_events" ADD CONSTRAINT "evidence_audit_events_paper_certificate_id_department_id_fkey" FOREIGN KEY ("paper_certificate_id", "department_id") REFERENCES "evidence_paper_certificates"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Typed source identity stays stable when a notary matter becomes a case.
CREATE UNIQUE INDEX "evidence_group_case_scope_key" ON "evidence_group_versions"("id", "department_id", "case_id");
-- Deferred NO ACTION permits a legal null-to-real-case backfill of the group
-- and every child in either statement order inside the same transaction.
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_item_group_case_fk" FOREIGN KEY ("group_id", "department_id", "case_id") REFERENCES "evidence_group_versions"("id", "department_id", "case_id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "evidence_paper_certificates" ADD CONSTRAINT "evidence_paper_group_case_fk" FOREIGN KEY ("group_id", "department_id", "case_id") REFERENCES "evidence_group_versions"("id", "department_id", "case_id") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "evidence_group_versions" ADD CONSTRAINT "evidence_group_source_check" CHECK (
  "version" > 0 AND ("source_initialized_at" IS NULL OR "source_kind" = 'NOTARY_MATTER') AND (
    ("source_kind" = 'CASE' AND "case_id" IS NOT NULL AND "source_id" = "case_id" AND "source_notary_matter_id" IS NULL)
    OR ("source_kind" = 'NOTARY_MATTER' AND "source_notary_matter_id" IS NOT NULL AND "source_id" = "source_notary_matter_id")
  )
);
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_item_source_check" CHECK (
  "version" > 0 AND (
    ("source_kind" = 'CASE' AND "case_id" IS NOT NULL AND "source_id" = "case_id" AND "source_notary_matter_id" IS NULL)
    OR ("source_kind" = 'NOTARY_MATTER' AND "source_notary_matter_id" IS NOT NULL AND "source_id" = "source_notary_matter_id")
  )
);
ALTER TABLE "evidence_paper_certificates" ADD CONSTRAINT "evidence_paper_source_check" CHECK (
  "version" > 0 AND ("pages" IS NULL OR "pages" > 0)
  AND ("source_certificate_id" IS NULL OR "source_notary_matter_id" IS NOT NULL)
  AND (("content_version_id" IS NULL AND "content_material_id" IS NULL)
    OR ("content_version_id" IS NOT NULL AND "content_material_id" IS NOT NULL))
  AND (
    ("source_kind" = 'CASE' AND "case_id" IS NOT NULL AND "source_id" = "case_id" AND "source_notary_matter_id" IS NULL)
    OR ("source_kind" = 'NOTARY_MATTER' AND "source_notary_matter_id" IS NOT NULL AND "source_id" = "source_notary_matter_id")
  )
);
ALTER TABLE "evidence_command_receipts" ADD CONSTRAINT "evidence_receipt_values_check" CHECK (
  "command" IN ('EDIT_GROUP', 'BULK_STATUS')
  AND LENGTH(BTRIM("idempotency_key")) > 0
  AND "request_fingerprint" ~ '^[a-f0-9]{64}$'
);

ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_item_creator_user_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_item_editor_user_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_item_keeper_membership_fk" FOREIGN KEY ("keeper_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "evidence_paper_certificates" ADD CONSTRAINT "evidence_paper_creator_user_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "evidence_paper_certificates" ADD CONSTRAINT "evidence_paper_editor_user_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "evidence_audit_events" ADD CONSTRAINT "evidence_audit_actor_user_fk" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "evidence_audit_events" ADD CONSTRAINT "evidence_audit_internal_actor_fk" FOREIGN KEY ("internal_actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "evidence_audit_events" ADD CONSTRAINT "evidence_audit_notary_actor_fk" FOREIGN KEY ("notary_office_account_binding_id", "actor_user_id", "department_id") REFERENCES "notary_office_account_bindings"("id", "user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "evidence_audit_events" ADD CONSTRAINT "evidence_audit_actor_proof_check" CHECK (
  ("internal_actor_user_id" IS NOT NULL AND "internal_actor_user_id" = "actor_user_id" AND "notary_office_account_binding_id" IS NULL)
  OR ("internal_actor_user_id" IS NULL AND "notary_office_account_binding_id" IS NOT NULL AND "group_id" IS NOT NULL)
);
ALTER TABLE "evidence_command_receipts" ADD CONSTRAINT "evidence_receipt_actor_membership_fk" FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION "guard_evidence_source_identity"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.department_id, NEW.source_kind, NEW.source_id, NEW.source_notary_matter_id)
      IS DISTINCT FROM ROW(OLD.id, OLD.department_id, OLD.source_kind, OLD.source_id, OLD.source_notary_matter_id)
      OR (OLD.case_id IS NOT NULL AND NEW.case_id IS DISTINCT FROM OLD.case_id)
      OR NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'Evidence source identity or revision is invalid' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.source_kind = 'CASE' AND EXISTS (
    SELECT 1 FROM "cases" c WHERE c.id = NEW.case_id AND c.department_id = NEW.department_id AND c.source_notary_matter_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Notary-backed cases use their original notary evidence group' USING ERRCODE = '23514';
  END IF;
  IF NEW.source_kind = 'NOTARY_MATTER' AND NEW.case_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "cases" c WHERE c.id = NEW.case_id AND c.department_id = NEW.department_id
      AND c.source_notary_matter_id = NEW.source_notary_matter_id
  ) THEN
    RAISE EXCEPTION 'Evidence case does not belong to its notary source' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "evidence_group_source_guard" BEFORE INSERT OR UPDATE ON "evidence_group_versions" FOR EACH ROW EXECUTE FUNCTION "guard_evidence_source_identity"();
CREATE TRIGGER "evidence_item_source_guard" BEFORE INSERT OR UPDATE ON "evidence_items" FOR EACH ROW EXECUTE FUNCTION "guard_evidence_source_identity"();
CREATE TRIGGER "evidence_paper_source_guard" BEFORE INSERT OR UPDATE ON "evidence_paper_certificates" FOR EACH ROW EXECUTE FUNCTION "guard_evidence_source_identity"();

-- MATCH SIMPLE composite FKs do not compare a null case_id. Inspect the final
-- group plus both child collections with IS DISTINCT FROM, including removed
-- history, at transaction end so null cannot bypass group membership.
CREATE FUNCTION "assert_evidence_group_case_alignment"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  checked_group UUID;
  checked_department UUID;
  expected_case UUID;
BEGIN
  checked_department := NEW.department_id;
  IF TG_TABLE_NAME = 'evidence_group_versions' THEN
    checked_group := NEW.id;
  ELSE
    checked_group := NEW.group_id;
  END IF;
  SELECT g.case_id INTO expected_case FROM "evidence_group_versions" g
    WHERE g.id = checked_group AND g.department_id = checked_department FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evidence group is missing' USING ERRCODE = '23503';
  END IF;
  IF EXISTS (SELECT 1 FROM "evidence_items" i
      WHERE i.group_id = checked_group AND i.department_id = checked_department
        AND i.case_id IS DISTINCT FROM expected_case)
    OR EXISTS (SELECT 1 FROM "evidence_paper_certificates" p
      WHERE p.group_id = checked_group AND p.department_id = checked_department
        AND p.case_id IS DISTINCT FROM expected_case) THEN
    RAISE EXCEPTION 'Evidence child case does not match its group' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "evidence_group_case_alignment" AFTER INSERT OR UPDATE ON "evidence_group_versions" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "assert_evidence_group_case_alignment"();
CREATE CONSTRAINT TRIGGER "evidence_item_case_alignment" AFTER INSERT OR UPDATE ON "evidence_items" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "assert_evidence_group_case_alignment"();
CREATE CONSTRAINT TRIGGER "evidence_paper_case_alignment" AFTER INSERT OR UPDATE ON "evidence_paper_certificates" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "assert_evidence_group_case_alignment"();

CREATE FUNCTION "guard_evidence_source_initialized"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.source_initialized_at IS NOT NULL AND NEW.source_initialized_at IS DISTINCT FROM OLD.source_initialized_at THEN
    RAISE EXCEPTION 'Evidence source initialization cannot be cleared or replaced' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "evidence_source_initialized_guard" BEFORE UPDATE ON "evidence_group_versions" FOR EACH ROW EXECUTE FUNCTION "guard_evidence_source_initialized"();

CREATE FUNCTION "guard_evidence_notary_audit_actor"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.notary_office_account_binding_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "evidence_group_versions" g JOIN "notary_certificates" c
      ON c.matter_id = g.source_id AND c.department_id = g.department_id
    WHERE g.id = NEW.group_id AND g.department_id = NEW.department_id AND g.source_kind = 'NOTARY_MATTER'
      AND c.actor_user_id = NEW.actor_user_id AND c.notary_office_account_binding_id = NEW.notary_office_account_binding_id
  ) THEN
    RAISE EXCEPTION 'Notary evidence initialization actor does not match its certificate source' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "evidence_notary_audit_actor_guard" BEFORE INSERT ON "evidence_audit_events" FOR EACH ROW EXECUTE FUNCTION "guard_evidence_notary_audit_actor"();

CREATE FUNCTION "guard_evidence_child_identity"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.group_id, NEW.created_at, NEW.created_by_user_id)
    IS DISTINCT FROM ROW(OLD.group_id, OLD.created_at, OLD.created_by_user_id) THEN
    RAISE EXCEPTION 'Evidence item identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "evidence_item_identity_guard" BEFORE UPDATE ON "evidence_items" FOR EACH ROW EXECUTE FUNCTION "guard_evidence_child_identity"();
CREATE TRIGGER "evidence_paper_identity_guard" BEFORE UPDATE ON "evidence_paper_certificates" FOR EACH ROW EXECUTE FUNCTION "guard_evidence_child_identity"();

CREATE FUNCTION "guard_evidence_paper_content"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.content_version_id IS NOT NULL
    AND ROW(NEW.content_version_id, NEW.content_material_id) IS DISTINCT FROM ROW(OLD.content_version_id, OLD.content_material_id) THEN
    RAISE EXCEPTION 'Referenced paper content version is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.content_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "materials" m JOIN "content_versions" cv ON cv.material_id = m.id
    WHERE cv.id = NEW.content_version_id AND m.id = NEW.content_material_id
      AND m.department_id = NEW.department_id AND m.category = 'NOTARY_CERTIFICATE'
      AND ((m.owner_type = 'CASE' AND m.owner_id = NEW.case_id)
        OR (m.owner_type = 'NOTARY_MATTER' AND m.owner_id = NEW.source_notary_matter_id))
  ) THEN
    RAISE EXCEPTION 'Paper content does not belong to the evidence source' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "evidence_paper_content_guard" BEFORE INSERT OR UPDATE ON "evidence_paper_certificates" FOR EACH ROW EXECUTE FUNCTION "guard_evidence_paper_content"();

CREATE FUNCTION "guard_evidence_history_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Evidence history and receipts are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "evidence_audit_immutable" BEFORE UPDATE OR DELETE ON "evidence_audit_events" FOR EACH ROW EXECUTE FUNCTION "guard_evidence_history_immutable"();
CREATE TRIGGER "evidence_receipt_immutable" BEFORE UPDATE OR DELETE ON "evidence_command_receipts" FOR EACH ROW EXECUTE FUNCTION "guard_evidence_history_immutable"();

-- One-time conversion of real issued sources into new ledger identities.
-- Original certificates, cases, evidence, audits, and frozen references are read only.
CREATE TEMP TABLE "evidence_import_sources_1300" ON COMMIT DROP AS
SELECT gen_random_uuid() AS group_id, gen_random_uuid() AS item_id, gen_random_uuid() AS paper_id,
  nc.department_id, nc.matter_id, nc.id AS certificate_id, c.id AS case_id,
  nc.actor_user_id, nc.notary_office_account_binding_id, nc.certificate_no, nc.certificate_date,
  ne.evidence_at, NULLIF(l.shop_name, '') AS item_name, office.name AS office_name,
  nm.version AS source_version, nc.to_version AS issuance_version,
  (SELECT COALESCE(jsonb_agg(a.id ORDER BY a.id), '[]'::jsonb)
   FROM "audit_events" a WHERE a.department_id = nc.department_id
     AND a.resource_type = 'notary_matter' AND a.resource_id = nc.matter_id
     AND a.action = 'notary.certificate_issued' AND a.details->>'certificateId' = nc.id::text) AS original_audit_ids,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'materialId', f.material_id, 'contentVersionId', f.content_version_id, 'filename', f.original_filename
    ) ORDER BY f.content_version_id), '[]'::jsonb)
   FROM (
     SELECT DISTINCT mr.material_id, mr.content_version_id, cv.original_filename
     FROM "material_references" mr
     JOIN "audit_events" a ON a.id = mr.action_event_id AND a.department_id = mr.department_id
     JOIN "materials" m ON m.id = mr.material_id AND m.department_id = mr.department_id
     JOIN "content_versions" cv ON cv.id = mr.content_version_id AND cv.material_id = mr.material_id
     WHERE mr.department_id = nc.department_id AND mr.resource_type = 'notary_matter' AND mr.resource_id = nc.matter_id
       AND a.action = 'notary.certificate_issued' AND a.details->>'certificateId' = nc.id::text
       AND m.category = 'NOTARY_CERTIFICATE'
   ) f) AS electronic_files
FROM "notary_certificates" nc
JOIN "notary_matters" nm ON nm.id = nc.matter_id AND nm.department_id = nc.department_id
JOIN "notary_matter_evidence" ne ON ne.matter_id = nm.id AND ne.department_id = nm.department_id
JOIN "cases" c ON c.certificate_id = nc.id AND c.source_notary_matter_id = nm.id AND c.department_id = nm.department_id
JOIN "leads" l ON l.id = nm.source_lead_id AND l.department_id = nm.department_id
JOIN "notary_offices" office ON office.id = nm.notary_office_id AND office.department_id = nm.department_id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "evidence_import_sources_1300"
    WHERE jsonb_array_length(original_audit_ids) <> 1 OR jsonb_array_length(electronic_files) NOT BETWEEN 1 AND 10) THEN
    RAISE EXCEPTION 'Issued evidence source lacks its exact frozen certificate file set' USING ERRCODE = '23514';
  END IF;
END;
$$;

INSERT INTO "evidence_group_versions" (
  "id", "department_id", "source_kind", "source_id", "case_id", "source_notary_matter_id", "version", "source_initialized_at", "updated_at"
) SELECT group_id, department_id, 'NOTARY_MATTER', matter_id, case_id, matter_id, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "evidence_import_sources_1300";

INSERT INTO "evidence_items" (
  "id", "department_id", "group_id", "case_id", "source_notary_matter_id", "source_kind", "source_id", "name", "collected_on", "provenance", "status", "version", "created_by_user_id", "updated_by_user_id", "created_at", "updated_at"
) SELECT item_id, department_id, group_id, case_id, matter_id, 'NOTARY_MATTER', matter_id,
  item_name, evidence_at, 'notary.certificate_issued', 'UNDELIVERED', 1, actor_user_id, actor_user_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "evidence_import_sources_1300";

INSERT INTO "evidence_paper_certificates" (
  "id", "department_id", "group_id", "case_id", "source_notary_matter_id", "source_kind", "source_id", "source_certificate_id", "number", "issued_on", "office_name", "status", "version", "created_by_user_id", "updated_by_user_id", "created_at", "updated_at"
) SELECT paper_id, department_id, group_id, case_id, matter_id, 'NOTARY_MATTER', matter_id,
  certificate_id, certificate_no, certificate_date, office_name, 'NOT_ISSUED', 1, actor_user_id, actor_user_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "evidence_import_sources_1300";

INSERT INTO "evidence_audit_events" (
  "id", "department_id", "actor_user_id", "notary_office_account_binding_id", "operation", "group_id", "item_id", "paper_certificate_id", "before_snapshot", "after_snapshot", "created_at"
) SELECT gen_random_uuid(), department_id, actor_user_id, notary_office_account_binding_id, 'IMPORT_NOTARY_SOURCE',
  group_id, item_id, paper_id, NULL,
  jsonb_build_object('sourceKind', 'NOTARY_MATTER', 'sourceId', matter_id, 'caseId', case_id,
    'sourceCertificateId', certificate_id, 'sourceVersion', source_version, 'issuanceVersion', issuance_version,
    'originalAuditEventIds', original_audit_ids, 'electronicFiles', electronic_files,
    'itemStatus', 'UNDELIVERED', 'paperStatus', 'NOT_ISSUED', 'migration', '20261016130000_evidence_demo_alignment'),
  CURRENT_TIMESTAMP
FROM "evidence_import_sources_1300";

COMMIT;
