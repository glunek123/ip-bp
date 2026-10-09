BEGIN;

CREATE FUNCTION customer_settlement_receipt_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM customer_settlement_versions v
    WHERE v.id = NEW.result_version_id AND v.record_id = NEW.record_id
      AND v.customer_id = NEW.customer_id AND v.department_id = NEW.department_id
      AND v.action = NEW.action AND v.recorded_by_user_id = NEW.actor_user_id
  ) OR NOT EXISTS (
    SELECT 1 FROM customers c WHERE c.id = NEW.customer_id
      AND c.department_id = NEW.department_id
      AND c.version = NEW.result_customer_version
  ) THEN
    RAISE EXCEPTION 'settlement receipt does not match committed version and customer' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_settlement_receipt_insert BEFORE INSERT ON customer_settlement_receipts
  FOR EACH ROW EXECUTE FUNCTION customer_settlement_receipt_insert_guard();

COMMIT;
