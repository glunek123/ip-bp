-- Commit enum additions before any table, function or value uses them.
BEGIN;
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.closure.record';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.closure.correct';
ALTER TYPE "material_category" ADD VALUE IF NOT EXISTS 'CASE_CLOSURE_DOCUMENT';
CREATE TYPE "case_closure_kind" AS ENUM ('REGISTER', 'CORRECT');
CREATE TYPE "case_closure_command" AS ENUM ('RECORD', 'CORRECT');
COMMIT;
