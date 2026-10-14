BEGIN;
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.external-entry.create';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.external-entry.archive';
COMMIT;
