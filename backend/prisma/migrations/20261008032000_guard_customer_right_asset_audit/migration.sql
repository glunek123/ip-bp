CREATE FUNCTION "reject_customer_right_asset_audit_mutation"() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."action" IN ('right-asset.created', 'right-asset.revised', 'right-asset.withdrawn') OR
     (TG_OP = 'UPDATE' AND NEW."action" IN ('right-asset.created', 'right-asset.revised', 'right-asset.withdrawn')) THEN
    RAISE EXCEPTION 'right asset audit is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "customer_right_asset_audit_immutable" BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "reject_customer_right_asset_audit_mutation"();
