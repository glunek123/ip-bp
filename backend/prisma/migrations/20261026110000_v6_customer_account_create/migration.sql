-- Separately assignable creation capability; no existing role or account is granted it.
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'customer.account.create';
