BEGIN;

CREATE TABLE "lead_no_evidence_batch_receipts" (
  "id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "original_request" JSONB NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_no_evidence_batch_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_no_evidence_batch_receipts_department_actor_key"
    UNIQUE ("department_id", "actor_user_id", "idempotency_key"),
  CONSTRAINT "lead_no_evidence_batch_receipts_values_check" CHECK (
    length("idempotency_key") BETWEEN 1 AND 128
    AND "idempotency_key" = btrim("idempotency_key")
    AND "request_fingerprint" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "lead_no_evidence_batch_receipts_request_check" CHECK (
    CASE WHEN jsonb_typeof("original_request") = 'object'
      AND jsonb_typeof("original_request"->'items') = 'array'
    THEN "original_request" - 'items' = '{}'::jsonb
      AND jsonb_array_length("original_request"->'items') BETWEEN 1 AND 20
    ELSE FALSE END
  ),
  CONSTRAINT "lead_no_evidence_batch_receipts_result_check" CHECK (
    CASE WHEN jsonb_typeof("result_snapshot") = 'object'
      AND jsonb_typeof("result_snapshot"->'items') = 'array'
    THEN "result_snapshot" - 'items' = '{}'::jsonb
      AND jsonb_array_length("result_snapshot"->'items') BETWEEN 1 AND 20
    ELSE FALSE END
  ),
  CONSTRAINT "lead_no_evidence_batch_receipts_department_fkey"
    FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lead_no_evidence_batch_receipts_actor_department_fkey"
    FOREIGN KEY ("actor_user_id", "department_id")
    REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE FUNCTION reject_lead_no_evidence_batch_receipt_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lead no evidence batch receipts are immutable' USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER reject_lead_no_evidence_batch_receipt_mutation
BEFORE UPDATE OR DELETE ON "lead_no_evidence_batch_receipts"
FOR EACH ROW EXECUTE FUNCTION reject_lead_no_evidence_batch_receipt_mutation();

CREATE FUNCTION validate_lead_no_evidence_batch_receipt() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  request_item JSONB;
  result_item JSONB;
  target_lead RECORD;
  decision RECORD;
  item_index INTEGER := 0;
BEGIN
  IF jsonb_array_length(NEW."original_request"->'items') <> jsonb_array_length(NEW."result_snapshot"->'items')
    OR (SELECT count(DISTINCT lower(value->>'leadId')) FROM jsonb_array_elements(NEW."original_request"->'items'))
      <> jsonb_array_length(NEW."original_request"->'items') THEN
    RAISE EXCEPTION 'lead no evidence batch cardinality or duplicate mismatch' USING ERRCODE = '23514';
  END IF;
  FOR request_item IN SELECT value FROM jsonb_array_elements(NEW."original_request"->'items') LOOP
    result_item := NEW."result_snapshot"->'items'->item_index;
    IF jsonb_typeof(request_item) IS DISTINCT FROM 'object'
      OR NOT (request_item ?& ARRAY['leadId','expectedVersion','reason'])
      OR request_item - ARRAY['leadId','expectedVersion','reason'] <> '{}'::jsonb
      OR jsonb_typeof(request_item->'leadId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(request_item->'expectedVersion') IS DISTINCT FROM 'number'
      OR jsonb_typeof(request_item->'reason') IS DISTINCT FROM 'string'
      OR (request_item->>'expectedVersion') !~ '^[1-9][0-9]*$'
      OR jsonb_typeof(result_item) IS DISTINCT FROM 'object'
      OR NOT (result_item ?& ARRAY['id','leadId','status','version','result','reason','decidedByDisplayName','decidedAt','archiveType','archivedAt'])
      OR result_item - ARRAY['id','leadId','status','version','result','reason','decidedByDisplayName','decidedAt','archiveType','archivedAt'] <> '{}'::jsonb
      OR jsonb_typeof(result_item->'id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(result_item->'leadId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(result_item->'status') IS DISTINCT FROM 'string'
      OR jsonb_typeof(result_item->'version') IS DISTINCT FROM 'number'
      OR jsonb_typeof(result_item->'result') IS DISTINCT FROM 'string'
      OR jsonb_typeof(result_item->'reason') IS DISTINCT FROM 'string'
      OR jsonb_typeof(result_item->'decidedByDisplayName') IS DISTINCT FROM 'string'
      OR jsonb_typeof(result_item->'decidedAt') IS DISTINCT FROM 'string'
      OR jsonb_typeof(result_item->'archiveType') IS DISTINCT FROM 'string'
      OR jsonb_typeof(result_item->'archivedAt') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'lead no evidence batch item shape mismatch' USING ERRCODE = '23514';
    END IF;

    SELECT * INTO target_lead FROM "leads" WHERE "id" = (request_item->>'leadId')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'lead no evidence batch target missing' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO decision FROM "lead_evidence_decisions" WHERE "id" = (result_item->>'id')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'lead no evidence batch decision missing' USING ERRCODE = '23514';
    END IF;
    IF request_item->>'leadId' <> target_lead."id"::text
      OR target_lead."department_id" <> NEW."department_id"
      OR target_lead."status" <> 'ARCHIVED'
      OR target_lead."version" <> (request_item->>'expectedVersion')::integer + 1
      OR decision."lead_id" <> target_lead."id"
      OR decision."customer_id" <> target_lead."customer_id"
      OR decision."department_id" <> NEW."department_id"
      OR decision."actor_user_id" <> NEW."actor_user_id"
      OR decision."original_review_decision_id" IS DISTINCT FROM target_lead."active_review_decision_id"
      OR decision."original_review_result" <> 'INFRINGEMENT'
      OR decision."from_version" <> (request_item->>'expectedVersion')::integer
      OR decision."to_version" <> target_lead."version"
      OR decision."reason" <> request_item->>'reason'
      OR result_item <> jsonb_build_object(
        'id', decision."id"::text, 'leadId', target_lead."id"::text, 'status', 'ARCHIVED',
        'version', decision."to_version", 'result', 'NO_EVIDENCE', 'reason', decision."reason",
        'decidedByDisplayName', decision."actor_display_name_snapshot",
        'decidedAt', result_item->>'decidedAt', 'archiveType', 'NO_EVIDENCE', 'archivedAt', result_item->>'decidedAt')
      OR (result_item->>'decidedAt')::timestamptz IS DISTINCT FROM decision."decided_at"
      OR decision."archived_at" IS DISTINCT FROM decision."decided_at" THEN
      RAISE EXCEPTION 'lead no evidence batch does not match decision' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "lead_command_receipts" receipt
      WHERE receipt."department_id" = NEW."department_id" AND receipt."actor_user_id" = NEW."actor_user_id"
        AND receipt."action" = 'evidence_decide'
        AND receipt."idempotency_key" = 'batch-no-evidence:' || NEW."id"::text || ':' || item_index::text
        AND receipt."result_lead_id" = target_lead."id"
        AND receipt."result_lead_version" = decision."to_version" AND receipt."result_snapshot" = result_item
    ) THEN
      RAISE EXCEPTION 'lead no evidence batch typed receipt missing' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "audit_events" event
      WHERE event."department_id" = NEW."department_id" AND event."actor_user_id" = NEW."actor_user_id"
        AND event."resource_type" = 'lead' AND event."resource_id" = target_lead."id"
        AND event."action" = 'lead.evidence_decided'
        AND event."details" = jsonb_build_object('evidenceDecisionId', decision."id"::text,
          'originalReviewDecisionId', decision."original_review_decision_id"::text, 'result', 'NO_EVIDENCE',
          'fromVersion', decision."from_version", 'toVersion', decision."to_version")
    ) THEN
      RAISE EXCEPTION 'lead no evidence batch audit missing' USING ERRCODE = '23514';
    END IF;
    item_index := item_index + 1;
  END LOOP;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER lead_no_evidence_batch_receipt_integrity
AFTER INSERT ON "lead_no_evidence_batch_receipts"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_lead_no_evidence_batch_receipt();

COMMIT;
