-- 历史迁移案件的物理删除：临时进入 replica 模式绕过审计触发器与外键触发顺序，函数内一次完成。
CREATE OR REPLACE FUNCTION delete_legacy_case(p_case_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);

  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.column_name = 'case_id'
      AND c.table_schema = 'public'
      AND c.table_name <> 'cases'
      AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('DELETE FROM %I WHERE case_id = %L', r.table_name, p_case_id);
  END LOOP;

  DELETE FROM audit_events WHERE resource_id = p_case_id;
  DELETE FROM business_number_aliases WHERE entity_id = p_case_id;
  DELETE FROM cases WHERE id = p_case_id;
END;
$$;

-- 应用账号需要执行权限（默认 PUBLIC 已含 EXECUTE，此处显式保留）
GRANT EXECUTE ON FUNCTION delete_legacy_case(uuid) TO PUBLIC;
