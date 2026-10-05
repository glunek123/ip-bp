BEGIN;
ALTER TYPE "user_account_type" ADD VALUE IF NOT EXISTS 'LAWYER';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'lawyer.account.manage';
COMMIT;
