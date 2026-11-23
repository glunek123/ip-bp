-- 律师库：档案启停与来源枚举，以及律师库读写权限值。
-- 权限值单独迁移：PostgreSQL 不允许在同一事务内新增并使用枚举值。

CREATE TYPE "lawyer_profile_status" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "lawyer_profile_source" AS ENUM ('MANUAL', 'ACCOUNT_CREATE', 'LEGACY_MATCH');

ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'lawyer.profile.read';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'lawyer.profile.manage';
