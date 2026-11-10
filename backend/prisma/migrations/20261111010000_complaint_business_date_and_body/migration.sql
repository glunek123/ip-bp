-- 起诉状「上传日期」为运营手填的业务日期，与系统登记时刻分开保存。
ALTER TABLE "cases" ADD COLUMN "complaint_submitted_on" date;

-- 「确认诉状」允许在线预览并修改正文，保存确认时的正文快照。
ALTER TABLE "case_complaint_confirmations" ADD COLUMN "body_text" text;
