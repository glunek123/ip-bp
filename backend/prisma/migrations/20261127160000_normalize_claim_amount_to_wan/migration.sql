-- 标的额单位统一为「万元」。
--
-- 背景：旧库（NocoBase）迁入的案件标的额本身就是万元（0.1~800），另有 4 条误按元填写的
-- 异常大额记录已在导入时换算；原生案件的标的额按「元」录入，与历史数据口径不一致，
-- 报表的 10/30/50 万元分档因此无法按同一口径统计。
--
-- 本迁移只换算原生案件（线索或公证来源）的存量标的额：case_complaint_confirmations.amount、
-- case_filing_submissions.claim_amount、cases.complaint_amount（案件级冗余镜像）。
-- 历史外录案件的标的额已是万元，原值保留。
--
-- 口径来源：docs/spec/v0.1/modules/reports.md 中「10／30／50万元分档」的既有定义。

UPDATE cases c
SET complaint_amount = c.complaint_amount / 10000
WHERE c.complaint_amount IS NOT NULL
  AND (c.source_lead_id IS NOT NULL OR c.source_notary_matter_id IS NOT NULL);

UPDATE case_complaint_confirmations cc
SET amount = cc.amount / 10000
FROM cases c
WHERE c.id = cc.case_id
  AND cc.amount IS NOT NULL
  AND (c.source_lead_id IS NOT NULL OR c.source_notary_matter_id IS NOT NULL);

UPDATE case_filing_submissions fs
SET claim_amount = fs.claim_amount / 10000
FROM cases c
WHERE c.id = fs.case_id
  AND fs.claim_amount IS NOT NULL
  AND (c.source_lead_id IS NOT NULL OR c.source_notary_matter_id IS NOT NULL);
