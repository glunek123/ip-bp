ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.judgment.register';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.judgment.correct';
ALTER TYPE "material_category" ADD VALUE IF NOT EXISTS 'JUDGMENT';
CREATE TYPE "case_judgment_kind" AS ENUM ('REGISTER', 'CORRECT');
