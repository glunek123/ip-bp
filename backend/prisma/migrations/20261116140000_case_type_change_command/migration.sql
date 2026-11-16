-- 案件类型同步更正的幂等命令。
ALTER TYPE "case_record_edit_command" ADD VALUE 'CASE_TYPE_CHANGE';
