BEGIN;

ALTER TYPE "permission_action" ADD VALUE 'customer.admit';
ALTER TYPE "permission_action" ADD VALUE 'lead.read';
ALTER TYPE "permission_action" ADD VALUE 'lead.create';
ALTER TYPE "permission_action" ADD VALUE 'lead.edit';

COMMIT;
