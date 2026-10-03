BEGIN;
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.complaint.mail';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'client.case.read';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'client.case.complaint.mail';
ALTER TYPE "case_stage" ADD VALUE IF NOT EXISTS 'WAITING_FILING';
ALTER TYPE "material_category" ADD VALUE IF NOT EXISTS 'MAIL_RECEIPT';
COMMIT;
