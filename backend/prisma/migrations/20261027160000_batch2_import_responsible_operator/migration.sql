BEGIN;

ALTER TABLE "lead_image_import_tasks" ADD COLUMN "retry_actor_user_id" UUID;
ALTER TABLE "lead_image_import_tasks"
  ADD CONSTRAINT "lead_image_import_tasks_retry_actor_membership_fkey"
  FOREIGN KEY ("retry_actor_user_id", "department_id")
  REFERENCES "department_memberships"("user_id", "department_id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Preserve the immutable receipt's original actor and audit while allowing a distinct,
-- active same-department responsible operator with an effective team.
CREATE OR REPLACE FUNCTION validate_lead_csv_import_receipt() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  request_item JSONB;
  result_item JSONB;
  request_input JSONB;
  result_lead JSONB;
  target_lead RECORD;
  request_product JSONB;
  target_product RECORD;
  item_index INTEGER := 0;
  product_index INTEGER;
BEGIN
  IF (SELECT count(*) FROM jsonb_object_keys(NEW."original_request")) <> 1
     OR (SELECT count(*) FROM jsonb_object_keys(NEW."result_snapshot")) <> 1 THEN
    RAISE EXCEPTION 'lead CSV receipt keys mismatch' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(NEW."original_request"->'items') < 1
     OR jsonb_array_length(NEW."original_request"->'items') > 20
     OR jsonb_array_length(NEW."original_request"->'items')
       <> jsonb_array_length(NEW."result_snapshot"->'items') THEN
    RAISE EXCEPTION 'lead CSV receipt cardinality mismatch' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(DISTINCT value->>'rowNumber')
      FROM jsonb_array_elements(NEW."original_request"->'items'))
       <> jsonb_array_length(NEW."original_request"->'items') THEN
    RAISE EXCEPTION 'duplicate CSV row' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(DISTINCT value->'lead'->>'id')
      FROM jsonb_array_elements(NEW."result_snapshot"->'items'))
       <> jsonb_array_length(NEW."result_snapshot"->'items') THEN
    RAISE EXCEPTION 'duplicate CSV result lead' USING ERRCODE = '23514';
  END IF;
  FOR request_item IN SELECT value FROM jsonb_array_elements(NEW."original_request"->'items') LOOP
    result_item := NEW."result_snapshot"->'items'->item_index;
    request_input := request_item->'input';
    result_lead := result_item->'lead';
    IF jsonb_typeof(request_item) IS DISTINCT FROM 'object'
       OR NOT (request_item ?& ARRAY['rowNumber', 'input'])
       OR request_item - ARRAY['rowNumber', 'input'] <> '{}'::jsonb
       OR jsonb_typeof(request_item->'rowNumber') IS DISTINCT FROM 'number'
       OR (request_item->>'rowNumber') !~ '^[0-9]+$'
       OR (request_item->>'rowNumber')::integer NOT BETWEEN 2 AND 2097153
       OR jsonb_typeof(request_input) IS DISTINCT FROM 'object'
       OR NOT (request_input ?& ARRAY['customerId', 'rightsHolderId', 'caseType',
         'infringementTypes', 'source', 'platform', 'foundAt', 'shopName',
         'needDisclose', 'products', 'leadScreenshotContentVersionIds'])
       OR request_input - ARRAY['customerId', 'rightsHolderId', 'caseType',
         'infringementTypes', 'source', 'platform', 'foundAt', 'shopName',
         'needDisclose', 'products', 'leadScreenshotContentVersionIds',
         'shopExternalId', 'remark'] <> '{}'::jsonb
       OR jsonb_typeof(request_input->'leadScreenshotContentVersionIds') IS DISTINCT FROM 'array'
       OR jsonb_array_length(request_input->'leadScreenshotContentVersionIds') <> 0
       OR request_input ? 'reservedLeadId'
       OR (request_input ? 'shopExternalId' AND
         jsonb_typeof(request_input->'shopExternalId') IS DISTINCT FROM 'string')
       OR (request_input ? 'remark' AND
         jsonb_typeof(request_input->'remark') IS DISTINCT FROM 'string')
       OR jsonb_typeof(result_item) IS DISTINCT FROM 'object'
       OR result_item - ARRAY['rowNumber', 'lead'] <> '{}'::jsonb
       OR result_item->>'rowNumber' IS DISTINCT FROM request_item->>'rowNumber'
       OR jsonb_typeof(result_lead) IS DISTINCT FROM 'object'
       OR NOT (result_lead ?& ARRAY['id','businessNo','customerId','rightsHolderId','responsibleUserId','departmentId','teamId','status','version','creationChannel','caseType','source','platform','foundAt','shopName','shopExternalId','needDisclose','remark','products','infringementTypes','leadScreenshotContentVersionIds','externalSourceRef','pushedAt'])
       OR jsonb_typeof(result_lead->'products') IS DISTINCT FROM 'array'
       OR jsonb_typeof(result_lead->'infringementTypes') IS DISTINCT FROM 'array'
       OR result_lead->'leadScreenshotContentVersionIds' <> '[]'::jsonb THEN
      RAISE EXCEPTION 'lead CSV receipt item shape mismatch' USING ERRCODE = '23514';
    END IF;
    SELECT "id", "business_no", "department_id", "customer_id", "rights_holder_id",
      "responsible_user_id", "team_id", "creation_channel", "status", "version",
      "case_type", "source", "platform", "found_at", "shop_name", "shop_external_id",
      "need_disclose", "remark", "external_source_ref", "pushed_at"
      INTO target_lead FROM "leads" WHERE "id" = (result_lead->>'id')::uuid;
    IF NOT FOUND OR target_lead."department_id" <> NEW."department_id"
       OR NOT EXISTS (SELECT 1 FROM "department_memberships" membership JOIN "user_accounts" owner ON owner."id" = membership."user_id" LEFT JOIN "teams" team ON team."id" = membership."team_id" WHERE membership."user_id" = target_lead."responsible_user_id" AND membership."department_id" = NEW."department_id" AND membership."active" AND owner."active" AND owner."account_type" = 'INTERNAL' AND membership."team_id" IS NOT DISTINCT FROM target_lead."team_id" AND (membership."team_id" IS NULL OR team."status" = 'ACTIVE'))
       OR target_lead."customer_id" IS DISTINCT FROM (request_input->>'customerId')::uuid
       OR target_lead."rights_holder_id" IS DISTINCT FROM (request_input->>'rightsHolderId')::uuid
       OR target_lead."creation_channel" <> 'CSV'
       OR target_lead."external_source_ref" IS NOT NULL
       OR target_lead."status" <> 'WAITING_PUSH' OR target_lead."version" <> 1
       OR target_lead."pushed_at" IS NOT NULL
       OR result_lead->>'id' IS DISTINCT FROM target_lead."id"::text
       OR result_lead->>'businessNo' IS DISTINCT FROM target_lead."business_no"
       OR result_lead->>'departmentId' IS DISTINCT FROM NEW."department_id"::text
       OR result_lead->>'responsibleUserId' IS DISTINCT FROM target_lead."responsible_user_id"::text
       OR result_lead->>'customerId' IS DISTINCT FROM target_lead."customer_id"::text
       OR result_lead->>'rightsHolderId' IS DISTINCT FROM target_lead."rights_holder_id"::text
       OR result_lead->>'status' IS DISTINCT FROM 'WAITING_PUSH'
       OR result_lead->>'creationChannel' IS DISTINCT FROM 'CSV'
       OR result_lead->>'version' IS DISTINCT FROM '1'
       OR result_lead->>'caseType' IS DISTINCT FROM request_input->>'caseType'
       OR result_lead->>'caseType' IS DISTINCT FROM target_lead."case_type"::text
       OR result_lead->>'source' IS DISTINCT FROM request_input->>'source'
       OR result_lead->>'source' IS DISTINCT FROM target_lead."source"::text
       OR result_lead->>'platform' IS DISTINCT FROM request_input->>'platform'
       OR result_lead->>'platform' IS DISTINCT FROM target_lead."platform"::text
       OR lead_csv_js_millis_timestamp(request_input->>'foundAt') IS DISTINCT FROM target_lead."found_at"
       OR (result_lead->>'foundAt')::timestamptz IS DISTINCT FROM target_lead."found_at"
       OR lead_csv_normalized_text(request_input->>'shopName') IS DISTINCT FROM target_lead."shop_name"
       OR result_lead->>'shopName' IS DISTINCT FROM target_lead."shop_name"
       OR lead_csv_normalized_text(request_input->>'shopExternalId') IS DISTINCT FROM target_lead."shop_external_id"
       OR result_lead->>'shopExternalId' IS DISTINCT FROM target_lead."shop_external_id"
       OR lead_csv_normalized_text(request_input->>'remark') IS DISTINCT FROM target_lead."remark"
       OR result_lead->>'remark' IS DISTINCT FROM target_lead."remark"
       OR request_input->'needDisclose' IS DISTINCT FROM to_jsonb(target_lead."need_disclose")
       OR result_lead->>'needDisclose' IS DISTINCT FROM target_lead."need_disclose"::text
       OR result_lead->>'teamId' IS DISTINCT FROM target_lead."team_id"::text
       OR result_lead->>'externalSourceRef' IS NOT NULL
       OR result_lead->>'pushedAt' IS NOT NULL
       OR result_lead->'products' IS DISTINCT FROM (
         SELECT jsonb_agg(jsonb_build_object(
           'id', product."id", 'position', product."position", 'url', product."url",
           'title', product."title", 'quantity', product."quantity",
           'unitPrice', product."unit_price"::text,
           'commentCount', product."comment_count",
           'estimatedAmount', product."estimated_amount"::text)
           ORDER BY product."position")
         FROM "lead_products" product WHERE product."lead_id" = target_lead."id"
       )
       OR result_lead->'infringementTypes' IS DISTINCT FROM (
         SELECT jsonb_agg(infringement."infringement_type" ORDER BY infringement."infringement_type")
         FROM "lead_infringements" infringement WHERE infringement."lead_id" = target_lead."id"
       ) THEN
      RAISE EXCEPTION 'lead CSV receipt does not match created lead' USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(request_input->'products') IS DISTINCT FROM 'array'
       OR jsonb_array_length(request_input->'products') NOT BETWEEN 1 AND 100
       OR jsonb_array_length(request_input->'products') IS DISTINCT FROM
         (SELECT count(*)::integer FROM "lead_products" WHERE "lead_id" = target_lead."id")
       OR jsonb_typeof(request_input->'infringementTypes') IS DISTINCT FROM 'array'
       OR jsonb_array_length(request_input->'infringementTypes') NOT BETWEEN 1 AND 12
       OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(request_input->'infringementTypes'))
         IS DISTINCT FROM jsonb_array_length(request_input->'infringementTypes')
       OR (SELECT jsonb_agg(value ORDER BY value)
           FROM jsonb_array_elements_text(request_input->'infringementTypes'))
         IS DISTINCT FROM (SELECT jsonb_agg("infringement_type"::text ORDER BY "infringement_type"::text)
           FROM "lead_infringements" WHERE "lead_id" = target_lead."id") THEN
      RAISE EXCEPTION 'lead CSV receipt request relations mismatch' USING ERRCODE = '23514';
    END IF;
    product_index := 0;
    FOR request_product IN SELECT value FROM jsonb_array_elements(request_input->'products') LOOP
      SELECT "url", "title", "quantity", "unit_price", "comment_count", "estimated_amount"
        INTO target_product FROM "lead_products"
        WHERE "lead_id" = target_lead."id" AND "position" = product_index + 1;
      IF NOT FOUND OR jsonb_typeof(request_product) IS DISTINCT FROM 'object'
         OR NOT (request_product ?& ARRAY['quantity', 'unitPrice', 'commentCount'])
         OR request_product - ARRAY['url', 'title', 'quantity', 'unitPrice', 'commentCount'] <> '{}'::jsonb
         OR (request_product ? 'url' AND jsonb_typeof(request_product->'url') IS DISTINCT FROM 'string')
         OR (request_product ? 'title' AND jsonb_typeof(request_product->'title') IS DISTINCT FROM 'string')
         OR jsonb_typeof(request_product->'unitPrice') IS DISTINCT FROM 'string'
         OR (request_product->>'unitPrice') !~ '^(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$'
         OR lead_csv_normalized_text(request_product->>'url') IS DISTINCT FROM target_product."url"
         OR lead_csv_normalized_text(request_product->>'title') IS DISTINCT FROM target_product."title"
         OR request_product->'quantity' IS DISTINCT FROM to_jsonb(target_product."quantity")
         OR (request_product->>'unitPrice')::numeric IS DISTINCT FROM target_product."unit_price"
         OR request_product->'commentCount' IS DISTINCT FROM to_jsonb(target_product."comment_count")
         OR target_product."estimated_amount" IS DISTINCT FROM
           (CASE WHEN target_product."quantity" > 0 THEN target_product."quantity"
             ELSE target_product."comment_count" END) * target_product."unit_price" THEN
        RAISE EXCEPTION 'lead CSV receipt request product mismatch' USING ERRCODE = '23514';
      END IF;
      product_index := product_index + 1;
    END LOOP;
    IF NOT EXISTS (
      SELECT 1 FROM "audit_events" event
      WHERE event."department_id" = NEW."department_id"
        AND event."actor_user_id" = NEW."actor_user_id"
        AND event."resource_type" = 'lead' AND event."resource_id" = target_lead."id"
        AND event."action" = 'lead.created'
        AND event."details"->>'businessNo' = target_lead."business_no"
        AND event."details"->>'version' = '1'
        AND event."details"->>'screenshotCount' = '0'
    ) THEN RAISE EXCEPTION 'lead CSV import audit missing' USING ERRCODE = '23514'; END IF;
    item_index := item_index + 1;
  END LOOP;
  RETURN NULL;
END
$$;

COMMIT;
