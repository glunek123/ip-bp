CREATE OR REPLACE FUNCTION "check_customer_right_asset_chain"() RETURNS TRIGGER AS $$
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
  IF TG_TABLE_NAME = 'customer_right_asset_versions' THEN
    IF NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id" AND a."department_id" = NEW."department_id"
      AND a."actor_user_id" = NEW."recorded_by_user_id" AND a."resource_type" = 'right-asset' AND a."resource_id" = NEW."asset_id"
      AND a."action" = CASE NEW."action" WHEN 'CREATE' THEN 'right-asset.created' WHEN 'REVISE' THEN 'right-asset.revised' ELSE 'right-asset.withdrawn' END) OR
      NOT EXISTS (SELECT 1 FROM "customer_right_asset_receipts" r WHERE r."result_version_id" = NEW."id" AND r."asset_id" = NEW."asset_id"
        AND r."customer_id" = NEW."customer_id" AND r."department_id" = NEW."department_id" AND r."action" = NEW."action"
        AND r."actor_user_id" = NEW."recorded_by_user_id") THEN
      RAISE EXCEPTION 'right asset version requires matching audit and receipt' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
