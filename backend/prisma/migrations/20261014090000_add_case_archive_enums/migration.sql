-- Enum values must commit before the transactional guards use them.
BEGIN;
ALTER TYPE "case_stage" ADD VALUE IF NOT EXISTS 'ARCHIVED';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.archive';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.archive.correct';
CREATE TYPE "case_archive_type" AS ENUM ('VOIDED','SETTLEMENT','MEDIATION','JUDGMENT_PERFORMED','EXECUTION_COLLECTED','EXECUTION_CLOSED');
CREATE TYPE "case_archive_kind" AS ENUM ('ARCHIVE','CORRECT');
CREATE TYPE "case_archive_command" AS ENUM ('ARCHIVE','CORRECT');
COMMIT;
