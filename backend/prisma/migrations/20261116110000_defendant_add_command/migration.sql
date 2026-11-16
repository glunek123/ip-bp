-- 新增被告登记命令，供幂等收据使用。
ALTER TYPE "case_record_edit_command" ADD VALUE 'DEFENDANT_ADD';
