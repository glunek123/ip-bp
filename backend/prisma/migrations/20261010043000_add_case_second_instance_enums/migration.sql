ALTER TYPE "material_category" ADD VALUE 'SECOND_INSTANCE_DOCUMENT';
ALTER TYPE "material_category" ADD VALUE 'SECOND_INSTANCE_SERVICE';
ALTER TYPE "material_category" ADD VALUE 'SECOND_INSTANCE_JUDGMENT';
ALTER TYPE "permission_action" ADD VALUE 'case.second_instance.save';
ALTER TYPE "permission_action" ADD VALUE 'case.second_instance.result';
ALTER TYPE "permission_action" ADD VALUE 'case.second_instance.result.revoke';
CREATE TYPE "case_second_instance_result_kind" AS ENUM ('REMAND', 'CHANGE', 'AFFIRM');
CREATE TYPE "case_second_instance_action" AS ENUM ('SAVE', 'RESULT', 'REVOKE');
