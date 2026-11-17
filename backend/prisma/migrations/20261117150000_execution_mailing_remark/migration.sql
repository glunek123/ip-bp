-- 邮寄凭证改为选填备注：新增 remark 列，历史数据保持空值。
BEGIN;
ALTER TABLE "case_execution_mailings" ADD COLUMN "remark" varchar(1000);
COMMIT;
