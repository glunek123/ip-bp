-- PostgreSQL enum additions must commit before the next migration uses them.
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'lead.withdraw.apply';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'client.lead.withdraw.confirm';
