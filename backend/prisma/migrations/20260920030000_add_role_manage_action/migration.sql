BEGIN;

ALTER TYPE "permission_action" ADD VALUE 'role.manage';

COMMIT;
