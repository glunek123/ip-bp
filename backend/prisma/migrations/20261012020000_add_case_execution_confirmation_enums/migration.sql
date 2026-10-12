BEGIN;
ALTER TYPE "case_stage" ADD VALUE 'WAITING_EXECUTION_STAMP';
ALTER TYPE "permission_action" ADD VALUE 'case.execution.confirm';
COMMIT;
