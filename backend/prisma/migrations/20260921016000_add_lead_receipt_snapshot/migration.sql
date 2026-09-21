DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "lead_command_receipts" receipt
    LEFT JOIN "leads" lead
      ON lead."id" = receipt."result_lead_id"
     AND lead."department_id" = receipt."department_id"
    WHERE lead."id" IS NULL
       OR lead."version" <> receipt."result_lead_version"
  ) THEN
    RAISE EXCEPTION 'cannot backfill lead receipt snapshot: current lead version does not match receipt version';
  END IF;
END $$;

ALTER TABLE "lead_command_receipts"
ADD COLUMN "result_snapshot" JSONB;

UPDATE "lead_command_receipts" receipt
SET "result_snapshot" = jsonb_build_object(
  'id', lead."id",
  'businessNo', lead."business_no",
  'departmentId', lead."department_id",
  'customerId', lead."customer_id",
  'rightsHolderId', lead."rights_holder_id",
  'responsibleUserId', lead."responsible_user_id",
  'teamId', lead."team_id",
  'status', lead."status",
  'caseType', lead."case_type",
  'infringementTypes', COALESCE((
    SELECT jsonb_agg(i."infringement_type" ORDER BY i."infringement_type")
    FROM "lead_infringements" i WHERE i."lead_id" = lead."id"
  ), '[]'::jsonb),
  'source', lead."source",
  'platform', lead."platform",
  'foundAt', lead."found_at",
  'shopName', lead."shop_name",
  'shopExternalId', lead."shop_external_id",
  'needDisclose', lead."need_disclose",
  'remark', lead."remark",
  'creationChannel', lead."creation_channel",
  'externalSourceRef', lead."external_source_ref",
  'products', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', p."id", 'position', p."position", 'url', p."url", 'title', p."title",
      'quantity', p."quantity", 'unitPrice', to_char(p."unit_price", 'FM9999999999999990.00'),
      'commentCount', p."comment_count", 'estimatedAmount', to_char(p."estimated_amount", 'FM9999999999999990.00')
    ) ORDER BY p."position")
    FROM "lead_products" p WHERE p."lead_id" = lead."id"
  ), '[]'::jsonb),
  'leadScreenshotContentVersionIds', COALESCE((
    SELECT jsonb_agg(reference."content_version_id" ORDER BY reference."created_at", reference."id")
    FROM "material_references" reference
    WHERE reference."resource_type" = 'lead'
      AND reference."resource_id" = lead."id"
      AND reference."purpose" = 'LEAD_SCREENSHOT'
      AND reference."action_event_id" IS NULL
  ), '[]'::jsonb),
  'version', lead."version",
  'createdAt', lead."created_at",
  'updatedAt', lead."updated_at"
)
FROM "leads" lead
WHERE lead."id" = receipt."result_lead_id"
  AND lead."department_id" = receipt."department_id";

ALTER TABLE "lead_command_receipts"
ALTER COLUMN "result_snapshot" SET NOT NULL;
