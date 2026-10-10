-- PostgreSQL requires new enum values to be committed before constraints use them.
ALTER TYPE "case_stage" ADD VALUE IF NOT EXISTS 'SECOND_INSTANCE';
ALTER TYPE "case_stage" ADD VALUE IF NOT EXISTS 'WAITING_EXECUTION_DOCUMENTS';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.judgment.next_step';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.judgment.next_step.revoke';
CREATE TYPE "case_judgment_next_step_kind" AS ENUM ('APPEAL', 'EXECUTION');
CREATE TYPE "case_judgment_next_step_action" AS ENUM ('CHOOSE', 'REVOKE');
