BEGIN;
ALTER TABLE "customer_rights_holder_links" ADD CONSTRAINT "customer_rights_holder_links_owner_key" UNIQUE ("customer_id", "rights_holder_id", "department_id");

CREATE TABLE "customer_right_assets" (
  "id" UUID PRIMARY KEY,
  "customer_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "holder_id" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "withdrawn" BOOLEAN NOT NULL DEFAULT FALSE,
  "current_version_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_right_assets_identity_key" UNIQUE ("id", "customer_id", "department_id"),
  CONSTRAINT "customer_right_assets_current_identity_key" UNIQUE ("current_version_id", "id", "customer_id", "department_id"),
  CONSTRAINT "customer_right_assets_customer_fkey" FOREIGN KEY ("customer_id", "department_id") REFERENCES "customers"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "customer_right_assets_holder_fkey" FOREIGN KEY ("customer_id", "holder_id", "department_id") REFERENCES "customer_rights_holder_links"("customer_id", "rights_holder_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "customer_right_assets_version_check" CHECK ("version" >= 1)
);
CREATE INDEX "customer_right_assets_list_idx" ON "customer_right_assets"("customer_id", "department_id", "updated_at" DESC, "id");

CREATE TABLE "customer_right_asset_versions" (
  "id" UUID PRIMARY KEY,
  "asset_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "action" "customer_right_asset_action" NOT NULL,
  "type" "customer_right_asset_type" NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "number" VARCHAR(200),
  "category" VARCHAR(200) NOT NULL,
  "holder_id" UUID NOT NULL,
  "owner_text" VARCHAR(200),
  "trademark_class" VARCHAR(100),
  "valid_from" DATE,
  "valid_to" DATE,
  "validity_mode" "customer_right_asset_validity_mode" NOT NULL,
  "withdraw_reason" VARCHAR(500),
  "recorded_by_user_id" UUID NOT NULL,
  "audit_event_id" UUID NOT NULL UNIQUE,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_right_asset_versions_identity_key" UNIQUE ("id", "asset_id", "customer_id", "department_id"),
  CONSTRAINT "customer_right_asset_versions_sequence_key" UNIQUE ("asset_id", "version"),
  CONSTRAINT "customer_right_asset_versions_asset_fkey" FOREIGN KEY ("asset_id", "customer_id", "department_id") REFERENCES "customer_right_assets"("id", "customer_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "customer_right_asset_versions_customer_fkey" FOREIGN KEY ("customer_id", "department_id") REFERENCES "customers"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "customer_right_asset_versions_holder_fkey" FOREIGN KEY ("customer_id", "holder_id", "department_id") REFERENCES "customer_rights_holder_links"("customer_id", "rights_holder_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "customer_right_asset_versions_actor_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "customer_right_asset_versions_audit_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "customer_right_asset_versions_fields_check" CHECK (
    "version" >= 1 AND "name" = BTRIM("name") AND CHAR_LENGTH("name") BETWEEN 1 AND 200 AND
    "category" = BTRIM("category") AND CHAR_LENGTH("category") BETWEEN 1 AND 200 AND
    ("number" IS NULL OR ("number" = BTRIM("number") AND CHAR_LENGTH("number") BETWEEN 1 AND 200)) AND
    ("owner_text" IS NULL OR ("owner_text" = BTRIM("owner_text") AND CHAR_LENGTH("owner_text") BETWEEN 1 AND 200)) AND
    ("trademark_class" IS NULL OR ("trademark_class" = BTRIM("trademark_class") AND CHAR_LENGTH("trademark_class") BETWEEN 1 AND 100)) AND
    ("valid_from" IS NULL OR "valid_to" IS NULL OR "valid_from" <= "valid_to") AND
    (("validity_mode" = 'FIXED' AND "valid_to" IS NOT NULL) OR ("validity_mode" IN ('LONG_TERM', 'UNKNOWN') AND "valid_to" IS NULL)) AND
    (("action" = 'WITHDRAW' AND "withdraw_reason" IS NOT NULL AND "withdraw_reason" = BTRIM("withdraw_reason") AND CHAR_LENGTH("withdraw_reason") BETWEEN 1 AND 500) OR ("action" <> 'WITHDRAW' AND "withdraw_reason" IS NULL))
  )
);
CREATE INDEX "customer_right_asset_versions_history_idx" ON "customer_right_asset_versions"("customer_id", "department_id", "asset_id", "version" DESC);

ALTER TABLE "customer_right_assets" ADD CONSTRAINT "customer_right_assets_current_version_fkey"
  FOREIGN KEY ("current_version_id", "id", "customer_id", "department_id") REFERENCES "customer_right_asset_versions"("id", "asset_id", "customer_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "customer_right_asset_receipts" (
  "id" UUID PRIMARY KEY,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "asset_id" UUID NOT NULL,
  "result_version_id" UUID NOT NULL,
  "action" "customer_right_asset_action" NOT NULL,
  "idempotency_key" VARCHAR(200) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "result_customer_version" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_right_asset_receipts_key" UNIQUE ("department_id", "actor_user_id", "action", "idempotency_key"),
  CONSTRAINT "customer_right_asset_receipts_customer_fkey" FOREIGN KEY ("customer_id", "department_id") REFERENCES "customers"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "customer_right_asset_receipts_asset_fkey" FOREIGN KEY ("asset_id", "customer_id", "department_id") REFERENCES "customer_right_assets"("id", "customer_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "customer_right_asset_receipts_version_fkey" FOREIGN KEY ("result_version_id", "asset_id", "customer_id", "department_id") REFERENCES "customer_right_asset_versions"("id", "asset_id", "customer_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "customer_right_asset_receipts_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "customer_right_asset_receipts_fields_check" CHECK ("idempotency_key" = BTRIM("idempotency_key") AND CHAR_LENGTH("idempotency_key") BETWEEN 1 AND 200 AND "request_fingerprint" ~ '^[a-f0-9]{64}$' AND "result_customer_version" >= 2)
);
CREATE INDEX "customer_right_asset_receipts_asset_idx" ON "customer_right_asset_receipts"("asset_id", "customer_id", "department_id");

CREATE FUNCTION "reject_customer_right_asset_history_mutation"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'right asset version or receipt is immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "customer_right_asset_versions_immutable" BEFORE UPDATE OR DELETE ON "customer_right_asset_versions" FOR EACH ROW EXECUTE FUNCTION "reject_customer_right_asset_history_mutation"();
CREATE TRIGGER "customer_right_asset_receipts_immutable" BEFORE UPDATE OR DELETE ON "customer_right_asset_receipts" FOR EACH ROW EXECUTE FUNCTION "reject_customer_right_asset_history_mutation"();

CREATE FUNCTION "check_customer_right_asset_chain"() RETURNS TRIGGER AS $$
DECLARE target_id UUID; target_customer UUID; target_department UUID; current_asset RECORD; latest_version RECORD; count_versions INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'customer_right_assets' THEN
    target_id := NEW."id"; target_customer := NEW."customer_id"; target_department := NEW."department_id";
  ELSE
    target_id := NEW."asset_id"; target_customer := NEW."customer_id"; target_department := NEW."department_id";
  END IF;
  SELECT * INTO current_asset FROM "customer_right_assets" WHERE "id" = target_id AND "customer_id" = target_customer AND "department_id" = target_department;
  SELECT COUNT(*) INTO count_versions FROM "customer_right_asset_versions" WHERE "asset_id" = target_id;
  SELECT * INTO latest_version FROM "customer_right_asset_versions" WHERE "asset_id" = target_id ORDER BY "version" DESC LIMIT 1;
  IF current_asset."id" IS NULL OR count_versions <> current_asset."version" OR
     latest_version."id" IS DISTINCT FROM current_asset."current_version_id" OR
     latest_version."version" IS DISTINCT FROM current_asset."version" OR
     latest_version."holder_id" IS DISTINCT FROM current_asset."holder_id" OR
     (latest_version."action" = 'WITHDRAW') IS DISTINCT FROM current_asset."withdrawn" OR
     (SELECT COUNT(*) FROM "customer_right_asset_versions" WHERE "asset_id" = target_id AND "action" = 'CREATE') <> 1 OR
     EXISTS (SELECT 1 FROM "customer_right_asset_versions" v WHERE v."asset_id" = target_id AND
       ((v."version" = 1 AND v."action" <> 'CREATE') OR (v."version" > 1 AND v."action" = 'CREATE') OR
        (v."version" < current_asset."version" AND v."action" = 'WITHDRAW'))) THEN
    RAISE EXCEPTION 'right asset current pointer or version chain mismatch' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'customer_right_asset_versions' AND (
    NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id" AND a."department_id" = NEW."department_id"
      AND a."actor_user_id" = NEW."recorded_by_user_id" AND a."resource_type" = 'right-asset' AND a."resource_id" = NEW."asset_id"
      AND a."action" = CASE NEW."action" WHEN 'CREATE' THEN 'right-asset.created' WHEN 'REVISE' THEN 'right-asset.revised' ELSE 'right-asset.withdrawn' END) OR
    NOT EXISTS (SELECT 1 FROM "customer_right_asset_receipts" r WHERE r."result_version_id" = NEW."id" AND r."asset_id" = NEW."asset_id"
      AND r."customer_id" = NEW."customer_id" AND r."department_id" = NEW."department_id" AND r."action" = NEW."action"
      AND r."actor_user_id" = NEW."recorded_by_user_id")) THEN
    RAISE EXCEPTION 'right asset version requires matching audit and receipt' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "customer_right_asset_asset_guard" AFTER INSERT OR UPDATE ON "customer_right_assets"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_customer_right_asset_chain"();
CREATE CONSTRAINT TRIGGER "customer_right_asset_version_guard" AFTER INSERT ON "customer_right_asset_versions"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_customer_right_asset_chain"();
COMMIT;
