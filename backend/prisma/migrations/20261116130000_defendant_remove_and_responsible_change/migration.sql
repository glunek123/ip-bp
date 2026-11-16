-- 被告移除与负责人变更的幂等命令。
ALTER TYPE "case_record_edit_command" ADD VALUE 'DEFENDANT_REMOVE';
ALTER TYPE "case_record_edit_command" ADD VALUE 'RESPONSIBLE_USER_CHANGE';
