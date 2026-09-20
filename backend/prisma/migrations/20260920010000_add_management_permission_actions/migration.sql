BEGIN;

ALTER TYPE "permission_action" ADD VALUE 'user.read';
ALTER TYPE "permission_action" ADD VALUE 'user.manage';
ALTER TYPE "permission_action" ADD VALUE 'team.read';
ALTER TYPE "permission_action" ADD VALUE 'team.manage';
ALTER TYPE "permission_action" ADD VALUE 'role.read';
ALTER TYPE "permission_action" ADD VALUE 'role.assign';

COMMIT;
