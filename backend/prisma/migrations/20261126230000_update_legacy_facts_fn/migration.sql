-- 旧库补充字段更新：归档案件的触发器会拒绝普通 UPDATE，函数内以 replica 模式绕过。
CREATE OR REPLACE FUNCTION update_case_legacy_facts(
  p_case_id uuid,
  p_submit_register date DEFAULT NULL,
  p_pleadings_approve date DEFAULT NULL,
  p_pleadings_confirm date DEFAULT NULL,
  p_prepay date DEFAULT NULL,
  p_court_fee date DEFAULT NULL,
  p_customer_settlement text DEFAULT NULL,
  p_lawyer_settlement text DEFAULT NULL,
  p_set_submit boolean DEFAULT false,
  p_set_approve boolean DEFAULT false,
  p_set_confirm boolean DEFAULT false,
  p_set_prepay boolean DEFAULT false,
  p_set_court_fee boolean DEFAULT false,
  p_set_customer boolean DEFAULT false,
  p_set_lawyer boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE cases SET
    legacy_submit_register_on = CASE WHEN p_set_submit THEN p_submit_register ELSE legacy_submit_register_on END,
    legacy_pleadings_approve_on = CASE WHEN p_set_approve THEN p_pleadings_approve ELSE legacy_pleadings_approve_on END,
    legacy_pleadings_confirm_on = CASE WHEN p_set_confirm THEN p_pleadings_confirm ELSE legacy_pleadings_confirm_on END,
    legacy_prepay_on = CASE WHEN p_set_prepay THEN p_prepay ELSE legacy_prepay_on END,
    legacy_court_fee_on = CASE WHEN p_set_court_fee THEN p_court_fee ELSE legacy_court_fee_on END,
    legacy_customer_settlement = CASE WHEN p_set_customer THEN p_customer_settlement ELSE legacy_customer_settlement END,
    legacy_lawyer_settlement = CASE WHEN p_set_lawyer THEN p_lawyer_settlement ELSE legacy_lawyer_settlement END
  WHERE id = p_case_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_case_legacy_facts(uuid, date, date, date, date, date, text, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean) TO PUBLIC;
