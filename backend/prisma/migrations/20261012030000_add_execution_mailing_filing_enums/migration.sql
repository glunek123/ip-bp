-- Run as a separate committed migration before the table/guard migration.
BEGIN;
ALTER TYPE "case_stage" ADD VALUE 'WAITING_EXECUTION_FILING';
ALTER TYPE "case_stage" ADD VALUE 'EXECUTING';
ALTER TYPE "permission_action" ADD VALUE 'case.execution.mail';
ALTER TYPE "permission_action" ADD VALUE 'case.execution.filing.submit';
ALTER TYPE "permission_action" ADD VALUE 'client.case.execution.mail';
ALTER TYPE "material_category" ADD VALUE 'EXECUTION_FILING_PROOF';
COMMIT;
