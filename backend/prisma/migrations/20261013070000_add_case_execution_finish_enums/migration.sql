-- Deploy and commit before the following transactional DDL uses these values.
ALTER TYPE "case_stage" ADD VALUE 'WAITING_ARCHIVE';
ALTER TYPE "permission_action" ADD VALUE 'case.execution.finish';
ALTER TYPE "material_category" ADD VALUE 'EXECUTION_FINISH_BASIS';
