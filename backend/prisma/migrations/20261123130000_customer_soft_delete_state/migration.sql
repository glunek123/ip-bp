-- 20261008040000 的 customers_deleted_state_check 要求被删客户仍是 DRAFT，使准入客户永远无法软删除。
-- 改为：未删除时三列必须同时为空；已删除时必须记录操作者，准入客户还必须记录原因。

BEGIN;

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_deleted_state_check;

ALTER TABLE customers ADD CONSTRAINT customers_deleted_state_check CHECK (
  (deleted_at IS NULL AND deleted_by_user_id IS NULL AND deletion_reason IS NULL)
  OR (
    deleted_at IS NOT NULL
    AND deleted_by_user_id IS NOT NULL
    AND (
      NOT ever_admitted
      OR (deletion_reason IS NOT NULL AND btrim(deletion_reason) <> '')
    )
  )
);

COMMIT;
