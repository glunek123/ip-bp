ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.defendant-contact.update';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.acceptance.correct';

CREATE TYPE "case_record_edit_command" AS ENUM ('DEFENDANT_CONTACT_UPDATE', 'ACCEPTANCE_CORRECTION');
