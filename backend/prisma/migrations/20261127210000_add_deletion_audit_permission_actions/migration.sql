-- 新增删除留痕相关权限位。
-- 注意：PostgreSQL 不允许在同一事务里使用刚加入的枚举值，
-- 因此授权语句拆到下一个迁移执行。

BEGIN;

ALTER TYPE "permission_action" ADD VALUE 'case.delete';
ALTER TYPE "permission_action" ADD VALUE 'deletion.audit.read';

COMMIT;
