ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.consolidate';

CREATE TABLE "case_consolidations" (
  "id" UUID PRIMARY KEY,
  "department_id" UUID NOT NULL,
  "main_case_id" UUID NOT NULL UNIQUE,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  UNIQUE ("id", "department_id"),
  UNIQUE ("main_case_id", "department_id"),
  FOREIGN KEY ("main_case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("created_by_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_consolidation_members" (
  "consolidation_id" UUID NOT NULL,
  "case_id" UUID NOT NULL UNIQUE,
  "department_id" UUID NOT NULL,
  "is_main" BOOLEAN NOT NULL,
  "original_version" INTEGER NOT NULL CHECK ("original_version" > 0),
  "defendant_kind" "case_party_kind" NOT NULL,
  "defendant_name" VARCHAR(200) NOT NULL CHECK (length(btrim("defendant_name")) > 0),
  "defendant_id_no" VARCHAR(100) NOT NULL CHECK (length(btrim("defendant_id_no")) > 0),
  PRIMARY KEY ("consolidation_id", "case_id"),
  UNIQUE ("case_id", "department_id"),
  FOREIGN KEY ("consolidation_id", "department_id") REFERENCES "case_consolidations"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "case_consolidation_members_consolidation_id_is_main_idx" ON "case_consolidation_members"("consolidation_id", "is_main");

CREATE TABLE "case_consolidation_receipts" (
  "id" UUID PRIMARY KEY,
  "consolidation_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL CHECK (length("idempotency_key") BETWEEN 1 AND 128 AND btrim("idempotency_key") = "idempotency_key"),
  "request_fingerprint" CHAR(64) NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  UNIQUE ("department_id", "actor_user_id", "idempotency_key"),
  FOREIGN KEY ("consolidation_id", "department_id") REFERENCES "case_consolidations"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "case_filing_consolidation_sources" (
  "submission_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "source_case_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "material_id" UUID NOT NULL,
  "content_version_id" UUID NOT NULL,
  "category" "material_category" NOT NULL,
  PRIMARY KEY ("submission_id", "content_version_id"),
  FOREIGN KEY ("submission_id", "case_id", "department_id") REFERENCES "case_filing_submissions"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("source_case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("material_id", "department_id") REFERENCES "materials"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("material_id", "content_version_id") REFERENCES "content_versions"("material_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ("source_case_id" <> "case_id")
);
CREATE INDEX "case_filing_consolidation_sources_source_case_id_department_id_idx" ON "case_filing_consolidation_sources"("source_case_id", "department_id");
CREATE INDEX "case_filing_consolidation_sources_case_id_department_id_idx" ON "case_filing_consolidation_sources"("case_id", "department_id");

CREATE FUNCTION guard_case_consolidation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'case consolidation history is immutable' USING ERRCODE = '55000';
END
$$;
CREATE TRIGGER "case_consolidation_root_immutable" BEFORE UPDATE OR DELETE ON "case_consolidations" FOR EACH ROW EXECUTE FUNCTION guard_case_consolidation_immutable();
CREATE TRIGGER "case_consolidation_member_immutable" BEFORE UPDATE OR DELETE ON "case_consolidation_members" FOR EACH ROW EXECUTE FUNCTION guard_case_consolidation_immutable();
CREATE TRIGGER "case_consolidation_receipt_immutable" BEFORE UPDATE OR DELETE ON "case_consolidation_receipts" FOR EACH ROW EXECUTE FUNCTION guard_case_consolidation_immutable();
CREATE TRIGGER "case_filing_consolidation_source_immutable" BEFORE UPDATE OR DELETE ON "case_filing_consolidation_sources" FOR EACH ROW EXECUTE FUNCTION guard_case_consolidation_immutable();

CREATE FUNCTION guard_case_filing_consolidation_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "case_consolidations" root
    JOIN "case_consolidation_members" member ON member."consolidation_id" = root."id"
    JOIN "cases" source ON source."id" = member."case_id"
    JOIN "materials" material ON material."id" = NEW."material_id"
    JOIN "content_versions" version ON version."id" = NEW."content_version_id" AND version."material_id" = material."id"
    WHERE root."main_case_id" = NEW."case_id" AND root."department_id" = NEW."department_id"
      AND member."case_id" = NEW."source_case_id" AND NOT member."is_main"
      AND material."department_id" = NEW."department_id" AND material."status" = 'ACTIVE'
      AND version."status" = 'AVAILABLE' AND material."category" = NEW."category"
      AND material."category" <> 'FEE_PROOF'
      AND ((material."owner_type" = 'CASE' AND material."owner_id" = source."id")
        OR (material."owner_type" = 'LEAD' AND material."owner_id" = source."source_lead_id")
        OR (material."owner_type" = 'NOTARY_MATTER' AND material."owner_id" = source."source_notary_matter_id"))
  ) THEN
    RAISE EXCEPTION 'filing source must belong to a readable consolidation member' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "guard_case_filing_consolidation_source" BEFORE INSERT ON "case_filing_consolidation_sources" FOR EACH ROW EXECUTE FUNCTION guard_case_filing_consolidation_source();

CREATE FUNCTION guard_merged_case_progress() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."stage" IS DISTINCT FROM OLD."stage" OR NEW."version" IS DISTINCT FROM OLD."version")
    AND EXISTS (
      SELECT 1 FROM "case_consolidation_members" member
      JOIN "case_consolidations" root ON root."id" = member."consolidation_id"
      WHERE member."case_id" = OLD."id" AND root."main_case_id" <> OLD."id"
    ) THEN
    RAISE EXCEPTION 'merged child cannot progress independently' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "guard_merged_case_progress" BEFORE UPDATE OF "stage", "version" ON "cases" FOR EACH ROW EXECUTE FUNCTION guard_merged_case_progress();

CREATE FUNCTION check_case_consolidation_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root_id UUID; root RECORD; member_count INTEGER; main_count INTEGER; mismatch_count INTEGER; receipt_count INTEGER; shop_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'case_consolidations' THEN
    root_id := NEW."id";
  ELSIF TG_TABLE_NAME IN ('case_consolidation_members', 'case_consolidation_receipts') THEN
    root_id := NEW."consolidation_id";
  ELSE
    RAISE EXCEPTION 'unexpected consolidation integrity target' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO root FROM "case_consolidations" WHERE "id" = root_id;
  SELECT count(*), count(*) FILTER (WHERE "case_id" = root."main_case_id" AND "is_main")
    INTO member_count, main_count FROM "case_consolidation_members" WHERE "consolidation_id" = root_id;
  IF member_count NOT BETWEEN 2 AND 20 OR main_count <> 1 THEN
    RAISE EXCEPTION 'consolidation needs two to twenty cases and one main case' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO mismatch_count FROM "case_consolidation_members" member
    JOIN "cases" record ON record."id" = member."case_id"
    JOIN "cases" main ON main."id" = root."main_case_id"
    WHERE member."consolidation_id" = root_id
      AND (member."department_id" <> root."department_id"
        OR member."is_main" <> (member."case_id" = root."main_case_id")
        OR record."customer_id" <> main."customer_id"
        OR record."rights_holder_id" <> main."rights_holder_id"
        OR record."stage" <> 'PENDING_MATCH'
        OR record."version" <> member."original_version" + 1);
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'consolidation members have inconsistent source facts' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO receipt_count FROM "case_consolidation_receipts"
    WHERE "consolidation_id" = root_id AND "department_id" = root."department_id";
  IF receipt_count <> 1 THEN
    RAISE EXCEPTION 'consolidation requires one immutable receipt' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "case_consolidation_members" member
    JOIN "case_consolidation_members" main
      ON main."consolidation_id" = member."consolidation_id" AND main."is_main"
    WHERE member."consolidation_id" = root_id
      AND (member."defendant_kind", member."defendant_name", member."defendant_id_no")
        IS DISTINCT FROM (main."defendant_kind", main."defendant_name", main."defendant_id_no")
  ) THEN
    RAISE EXCEPTION 'consolidation defendant identity differs' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "case_consolidation_members" member
    JOIN "case_defendants" defendant ON defendant."case_id" = member."case_id"
      AND defendant."department_id" = member."department_id"
    WHERE member."consolidation_id" = root_id
      AND (defendant."kind", defendant."name", defendant."id_no")
        IS DISTINCT FROM (member."defendant_kind", member."defendant_name", member."defendant_id_no")
  ) OR EXISTS (
    SELECT 1 FROM "case_consolidation_members" member
    JOIN "case_defendants" defendant ON defendant."case_id" = member."case_id"
      AND defendant."department_id" = member."department_id"
    WHERE member."consolidation_id" = root_id
    GROUP BY member."case_id" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'consolidation conflicts with existing defendant' USING ERRCODE = '23514';
  END IF;
  SELECT count(DISTINCT (
    COALESCE(lead."platform"::text, entry."known"->>'platform'),
    COALESCE(btrim(lead."shop_external_id"), btrim(entry."known"->>'shopExternalId'))
  )) INTO shop_count
  FROM "case_consolidation_members" member
  JOIN "cases" record ON record."id" = member."case_id"
  LEFT JOIN "leads" lead ON lead."id" = record."source_lead_id"
  LEFT JOIN "case_external_entries" entry ON entry."case_id" = record."id"
  WHERE member."consolidation_id" = root_id;
  IF shop_count <> 1 OR EXISTS (
    SELECT 1 FROM "case_consolidation_members" member
    JOIN "cases" record ON record."id" = member."case_id"
    LEFT JOIN "leads" lead ON lead."id" = record."source_lead_id"
    LEFT JOIN "case_external_entries" entry ON entry."case_id" = record."id"
    WHERE member."consolidation_id" = root_id AND (
      COALESCE(lead."platform"::text, entry."known"->>'platform', '') = '' OR
      COALESCE(btrim(lead."shop_external_id"), btrim(entry."known"->>'shopExternalId'), '') = ''
    )
  ) THEN
    RAISE EXCEPTION 'consolidation shop identity differs or is incomplete' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER "case_consolidation_root_integrity" AFTER INSERT ON "case_consolidations" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_consolidation_integrity();
CREATE CONSTRAINT TRIGGER "case_consolidation_member_integrity" AFTER INSERT ON "case_consolidation_members" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_consolidation_integrity();
CREATE CONSTRAINT TRIGGER "case_consolidation_receipt_integrity" AFTER INSERT ON "case_consolidation_receipts" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_consolidation_integrity();
