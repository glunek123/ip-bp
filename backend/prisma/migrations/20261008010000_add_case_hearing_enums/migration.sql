BEGIN;
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.hearing.schedule';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.hearing.correct';
ALTER TYPE "case_stage" ADD VALUE IF NOT EXISTS 'WAITING_JUDGMENT';
CREATE TYPE "case_hearing_source" AS ENUM ('SCHEDULE', 'CORRECTION');
CREATE TYPE "audit_actor_kind" AS ENUM ('HUMAN', 'SYSTEM');
COMMIT;
