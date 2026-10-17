-- EF001 enum preparation commits as its own migration before the original1000.
-- A BEGIN later in the same whole script would not commit these new labels.
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.execution.feedback.record';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.execution.feedback.correct';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.execution.supplement.submit';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.execution.supplement.correct';
ALTER TYPE "material_category" ADD VALUE IF NOT EXISTS 'EXECUTION_SUPPLEMENT';
