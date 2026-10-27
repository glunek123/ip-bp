-- Source-only draft. Do not apply without the separately authorized PostgreSQL migration review.
BEGIN;

CREATE TABLE "case_csv_import_receipts" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "department_id" uuid NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "request_fingerprint" char(64) NOT NULL,
  "file_fingerprint" char(64) NOT NULL,
  "row_numbers" jsonb NOT NULL,
  "result_snapshot" jsonb NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_csv_import_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_csv_import_receipts_department_id_actor_user_id_idempotency_key_key"
    UNIQUE ("department_id", "actor_user_id", "idempotency_key"),
  CONSTRAINT "case_csv_import_receipts_id_department_id_file_fingerprint_key"
    UNIQUE ("id", "department_id", "file_fingerprint"),
  CONSTRAINT "case_csv_import_receipts_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_csv_import_receipts_actor_user_id_department_id_fkey"
    FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_csv_import_receipt_shape" CHECK (
    length("idempotency_key") BETWEEN 1 AND 128 AND
    length(btrim("idempotency_key")) = length("idempotency_key") AND
    "request_fingerprint" ~ '^[0-9a-f]{64}$' AND
    "file_fingerprint" ~ '^[0-9a-f]{64}$' AND
    jsonb_typeof("row_numbers") = 'array' AND
    jsonb_array_length("row_numbers") BETWEEN 1 AND 20 AND
    jsonb_typeof("result_snapshot") = 'object'
  )
);

CREATE TABLE "case_csv_imported_rows" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "department_id" uuid NOT NULL,
  "file_fingerprint" char(64) NOT NULL,
  "row_number" integer NOT NULL,
  "case_id" uuid NOT NULL,
  "receipt_id" uuid NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_csv_imported_rows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_csv_imported_rows_department_id_file_fingerprint_row_number_key"
    UNIQUE ("department_id", "file_fingerprint", "row_number"),
  CONSTRAINT "case_csv_imported_rows_case_id_department_id_key"
    UNIQUE ("case_id", "department_id"),
  CONSTRAINT "case_csv_imported_rows_row_number_check" CHECK ("row_number" >= 2),
  CONSTRAINT "case_csv_imported_rows_case_id_department_id_fkey"
    FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_csv_imported_rows_receipt_id_department_id_file_fingerprint_fkey"
    FOREIGN KEY ("receipt_id", "department_id", "file_fingerprint")
    REFERENCES "case_csv_import_receipts"("id", "department_id", "file_fingerprint") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "case_csv_imported_rows_receipt_id_idx" ON "case_csv_imported_rows"("receipt_id");

CREATE TABLE "case_early_archive_batch_receipts" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "department_id" uuid NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "request_fingerprint" char(64) NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_early_archive_batch_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_early_archive_batch_receipts_department_id_actor_user_id_idempotency_key_key"
    UNIQUE ("department_id", "actor_user_id", "idempotency_key"),
  CONSTRAINT "case_early_archive_batch_receipts_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_early_archive_batch_receipts_actor_user_id_department_id_fkey"
    FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_early_archive_batch_receipt_shape" CHECK (
    length("idempotency_key") BETWEEN 1 AND 128 AND
    length(btrim("idempotency_key")) = length("idempotency_key") AND
    "request_fingerprint" ~ '^[0-9a-f]{64}$'
  )
);

CREATE FUNCTION "case_v6_receipt_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'v6 case batch or CSV receipt is immutable' USING ERRCODE = '23514';
END; $$;
CREATE TRIGGER "case_csv_import_receipts_immutable" BEFORE UPDATE OR DELETE ON "case_csv_import_receipts"
  FOR EACH ROW EXECUTE FUNCTION "case_v6_receipt_immutable"();
CREATE TRIGGER "case_csv_imported_rows_immutable" BEFORE UPDATE OR DELETE ON "case_csv_imported_rows"
  FOR EACH ROW EXECUTE FUNCTION "case_v6_receipt_immutable"();
CREATE TRIGGER "case_early_archive_batch_receipts_immutable" BEFORE UPDATE OR DELETE ON "case_early_archive_batch_receipts"
  FOR EACH ROW EXECUTE FUNCTION "case_v6_receipt_immutable"();

CREATE FUNCTION "case_v6_batch_receipt_actor_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account_type text; account_active boolean; membership_active boolean;
BEGIN
  SELECT account."account_type", account."active" INTO account_type, account_active FROM "user_accounts" AS account WHERE account."id" = NEW."actor_user_id";
  SELECT membership."active" INTO membership_active FROM "department_memberships" AS membership
    WHERE membership."user_id" = NEW."actor_user_id" AND membership."department_id" = NEW."department_id";
  IF account_type IS DISTINCT FROM 'INTERNAL' OR account_active IS DISTINCT FROM true OR
     membership_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'v6 case batch or CSV actor is not active internal department member' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "case_csv_import_receipts_actor_guard" BEFORE INSERT ON "case_csv_import_receipts"
  FOR EACH ROW EXECUTE FUNCTION "case_v6_batch_receipt_actor_guard"();
CREATE TRIGGER "case_early_archive_batch_receipts_actor_guard" BEFORE INSERT ON "case_early_archive_batch_receipts"
  FOR EACH ROW EXECUTE FUNCTION "case_v6_batch_receipt_actor_guard"();

-- The CSV receipt and all row links must arrive in the same transaction. Each
-- imported case must be a real external entry created by this actor in this
-- department, with no fabricated lead/notary source. The immutable snapshot
-- binds the chosen row numbers, mapped party IDs and single-case results.
CREATE FUNCTION "case_csv_import_final_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt "case_csv_import_receipts"%ROWTYPE; link record; total integer; numbers jsonb; item jsonb; mapped jsonb;
BEGIN
  IF TG_TABLE_NAME = 'case_csv_import_receipts' THEN receipt := NEW;
  ELSE SELECT * INTO receipt FROM "case_csv_import_receipts" WHERE "id" = NEW."receipt_id"; END IF;
  IF receipt."id" IS NULL THEN RAISE EXCEPTION 'CSV receipt missing' USING ERRCODE = '23514'; END IF;
  numbers := receipt."row_numbers";
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(numbers) AS n(value)
             WHERE jsonb_typeof(n.value) <> 'number' OR n.value::text !~ '^([2-9]|[1-9][0-9]{1,4})$') OR
     (SELECT count(DISTINCT n.value) FROM jsonb_array_elements(numbers) AS n(value)) <> jsonb_array_length(numbers) OR
     jsonb_typeof(receipt."result_snapshot"->'items') IS DISTINCT FROM 'array' OR
     jsonb_typeof(receipt."result_snapshot"->'rowInputs') IS DISTINCT FROM 'array' OR
     jsonb_typeof(receipt."result_snapshot"->'duplicateConfirmations') IS DISTINCT FROM 'array' OR
     jsonb_array_length(receipt."result_snapshot"->'items') <> jsonb_array_length(numbers) OR
     jsonb_array_length(receipt."result_snapshot"->'rowInputs') <> jsonb_array_length(numbers) OR
     jsonb_array_length(receipt."result_snapshot"->'duplicateConfirmations') > jsonb_array_length(numbers) THEN
    RAISE EXCEPTION 'CSV receipt row snapshot invalid' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO total FROM "case_csv_imported_rows" WHERE "receipt_id" = receipt."id";
  IF total <> jsonb_array_length(numbers) THEN
    RAISE EXCEPTION 'CSV receipt row links incomplete' USING ERRCODE = '23514';
  END IF;
  FOR link IN
    SELECT r."row_number", r."case_id", c."customer_id", c."rights_holder_id", c."responsible_user_id",
      c."source_lead_id", c."source_notary_matter_id", c."certificate_id",
      e."id" AS entry_id, e."entry_kind", e."initial_stage", e."stage_reached_on", e."source", e."reason",
      single_receipt."actor_user_id" AS single_actor, single_receipt."idempotency_key" AS single_key
    FROM "case_csv_imported_rows" r
    JOIN "cases" c ON c."id" = r."case_id" AND c."department_id" = r."department_id"
    LEFT JOIN "case_external_entries" e ON e."case_id" = c."id" AND e."department_id" = c."department_id"
    LEFT JOIN "case_external_entry_receipts" single_receipt ON single_receipt."case_id" = c."id" AND single_receipt."department_id" = c."department_id"
    WHERE r."receipt_id" = receipt."id" AND r."department_id" = receipt."department_id" AND r."file_fingerprint" = receipt."file_fingerprint"
  LOOP
    SELECT n.value INTO item FROM jsonb_array_elements(receipt."result_snapshot"->'items') AS n(value)
      WHERE n.value->>'rowNumber' = link."row_number"::text;
    SELECT n.value INTO mapped FROM jsonb_array_elements(receipt."result_snapshot"->'rowInputs') AS n(value)
      WHERE n.value->>'rowNumber' = link."row_number"::text;
    IF NOT (receipt."row_numbers" @> jsonb_build_array(link."row_number")) OR
       link."entry_id" IS NULL OR link."single_actor" IS DISTINCT FROM receipt."actor_user_id" OR
       link."responsible_user_id" IS DISTINCT FROM receipt."actor_user_id" OR
       link."source_lead_id" IS NOT NULL OR link."source_notary_matter_id" IS NOT NULL OR link."certificate_id" IS NOT NULL OR
       item->>'id' IS DISTINCT FROM link."case_id"::text OR item->>'entryId' IS DISTINCT FROM link."entry_id"::text OR
       mapped->'input'->>'customerId' IS DISTINCT FROM link."customer_id"::text OR
       mapped->'input'->>'rightsHolderId' IS DISTINCT FROM link."rights_holder_id"::text OR
       mapped->'input'->>'idempotencyKey' IS DISTINCT FROM link."single_key" OR
       mapped->'input'->>'entryKind' IS DISTINCT FROM link."entry_kind"::text OR
       mapped->'input'->>'initialStage' IS DISTINCT FROM link."initial_stage"::text OR
       mapped->'input'->>'stageReachedOn' IS DISTINCT FROM to_char(link."stage_reached_on", 'YYYY-MM-DD') OR
       mapped->'input'->>'source' IS DISTINCT FROM link."source" OR
       mapped->'input'->>'reason' IS DISTINCT FROM link."reason" THEN
      RAISE EXCEPTION 'CSV row is not bound to its external case source' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "case_csv_import_receipts_final" AFTER INSERT ON "case_csv_import_receipts"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "case_csv_import_final_guard"();
CREATE CONSTRAINT TRIGGER "case_csv_imported_rows_final" AFTER INSERT ON "case_csv_imported_rows"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "case_csv_import_final_guard"();

COMMIT;
