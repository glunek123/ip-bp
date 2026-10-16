BEGIN;

CREATE TABLE "lead_batch_push_receipts" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "original_request" JSONB NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_batch_push_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_batch_push_receipts_department_actor_key" UNIQUE ("department_id", "actor_user_id", "idempotency_key"),
  CONSTRAINT "lead_batch_push_receipts_fingerprint_check" CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "lead_batch_push_receipts_request_check" CHECK (
    COALESCE(jsonb_typeof("original_request") = 'object' AND "original_request" ? 'items'
      AND jsonb_typeof("original_request"->'items') = 'array'
      AND jsonb_array_length("original_request"->'items') BETWEEN 1 AND 20, FALSE)
  ),
  CONSTRAINT "lead_batch_push_receipts_result_check" CHECK (
    COALESCE(jsonb_typeof("result_snapshot") = 'object' AND "result_snapshot" ? 'items'
      AND jsonb_typeof("result_snapshot"->'items') = 'array'
      AND jsonb_array_length("result_snapshot"->'items') BETWEEN 1 AND 20, FALSE)
  )
);

ALTER TABLE "lead_batch_push_receipts"
  ADD CONSTRAINT "lead_batch_push_receipts_department_fkey"
    FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "lead_batch_push_receipts_actor_department_fkey"
    FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_lead_batch_push_receipt_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lead batch push receipts are immutable' USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER reject_lead_batch_push_receipt_mutation
BEFORE UPDATE OR DELETE ON "lead_batch_push_receipts"
FOR EACH ROW EXECUTE FUNCTION reject_lead_batch_push_receipt_mutation();

CREATE FUNCTION validate_lead_batch_push_receipt() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE request_item JSONB; result_item JSONB; target_lead RECORD; item_index BIGINT := 0;
BEGIN
  IF jsonb_array_length(NEW."original_request"->'items') <> jsonb_array_length(NEW."result_snapshot"->'items') THEN
    RAISE EXCEPTION 'lead batch receipt cardinality mismatch' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(DISTINCT lower(value->>'leadId')) FROM jsonb_array_elements(NEW."original_request"->'items'))
      <> jsonb_array_length(NEW."original_request"->'items') THEN
    RAISE EXCEPTION 'duplicate lead batch target' USING ERRCODE = '23514';
  END IF;
  FOR request_item IN SELECT value FROM jsonb_array_elements(NEW."original_request"->'items') LOOP
    result_item := NEW."result_snapshot"->'items'->item_index::INTEGER;
    IF jsonb_typeof(request_item) <> 'object' OR NOT (request_item ?& ARRAY['leadId','expectedVersion'])
       OR jsonb_typeof(request_item->'leadId') <> 'string'
       OR jsonb_typeof(request_item->'expectedVersion') <> 'number'
       OR jsonb_typeof(result_item) <> 'object'
       OR NOT (result_item ?& ARRAY['id','businessNo','status','version','pushedAt','pushedByUserId','pushedByDisplayName'])
       OR jsonb_typeof(result_item->'id') <> 'string'
       OR jsonb_typeof(result_item->'businessNo') <> 'string'
       OR jsonb_typeof(result_item->'status') <> 'string'
       OR jsonb_typeof(result_item->'version') <> 'number'
       OR jsonb_typeof(result_item->'pushedAt') <> 'string'
       OR jsonb_typeof(result_item->'pushedByUserId') <> 'string'
       OR jsonb_typeof(result_item->'pushedByDisplayName') <> 'string' THEN
      RAISE EXCEPTION 'lead batch receipt item shape mismatch' USING ERRCODE = '23514';
    END IF;
    SELECT "id", "business_no", "department_id", "status", "version", "pushed_at", "pushed_by_user_id"
      INTO target_lead FROM "leads" WHERE "id" = (request_item->>'leadId')::uuid;
    IF NOT FOUND OR target_lead."department_id" <> NEW."department_id"
       OR target_lead."status" <> 'WAITING_REVIEW'
       OR target_lead."version" <> (request_item->>'expectedVersion')::integer + 1
       OR target_lead."pushed_by_user_id" <> NEW."actor_user_id"
       OR target_lead."pushed_at" IS NULL
       OR result_item->>'id' <> target_lead."id"::text
       OR result_item->>'businessNo' <> target_lead."business_no"
       OR result_item->>'status' <> 'WAITING_REVIEW'
       OR result_item->>'version' <> target_lead."version"::text
       OR result_item->>'pushedByUserId' <> NEW."actor_user_id"::text
       OR (result_item->>'pushedAt')::timestamptz <> target_lead."pushed_at" THEN
      RAISE EXCEPTION 'lead batch receipt does not match pushed lead' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "audit_events" event
      WHERE event."department_id" = NEW."department_id"
        AND event."actor_user_id" = NEW."actor_user_id"
        AND event."resource_type" = 'lead' AND event."resource_id" = target_lead."id"
        AND event."action" = 'lead.pushed'
        AND event."details" = jsonb_build_object('fromVersion', (request_item->>'expectedVersion')::integer,
          'toVersion', (request_item->>'expectedVersion')::integer + 1)
    ) THEN RAISE EXCEPTION 'lead batch push audit missing' USING ERRCODE = '23514'; END IF;
    item_index := item_index + 1;
  END LOOP;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "lead_batch_push_receipt_integrity"
AFTER INSERT ON "lead_batch_push_receipts"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_lead_batch_push_receipt();

COMMIT;
