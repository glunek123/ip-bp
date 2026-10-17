import type { EvidenceStatus, PaperStatus } from './evidence-rules';
import type { CaseStage } from '../../generated/prisma/enums';

const stageLabels: Record<CaseStage, string> = {
  PENDING_MATCH: '待匹配',
  WAITING_COMPLAINT: '待写诉状',
  WAITING_COMPLAINT_CONFIRMATION: '诉状待确认',
  WAITING_COMPLAINT_STAMP: '诉状待盖章',
  WAITING_FILING: '待提交立案',
  WAITING_FORMAL_ACCEPTANCE: '待正式立案',
  WAITING_HEARING: '待开庭',
  WAITING_JUDGMENT: '待判决',
  SECOND_INSTANCE: '二审',
  WAITING_EXECUTION_DOCUMENTS: '待写执行材料',
  WAITING_EXECUTION_CONFIRMATION: '执行材料待确认',
  WAITING_EXECUTION_STAMP: '执行材料待盖章',
  WAITING_EXECUTION_FILING: '待申请执行',
  EXECUTING: '强制执行中',
  WAITING_ARCHIVE: '待归档',
  ARCHIVED: '已归档',
};

const evidenceLabels: Record<EvidenceStatus, string> = {
  UNDELIVERED: '未交付',
  IN_STOCK: '在库',
  MAILED_TO_LAWYER: '已邮寄律师',
  DESTROYED: '已销毁',
};
const paperLabels: Record<PaperStatus, string> = {
  NOT_ISSUED: '未出纸质证',
  MAILED_TO_LAWYER: '纸质证邮寄律师',
};

export type ExportEvidenceRow = {
  id: string;
  shopName: string | null;
  stage: string | null;
  lawyerName: string | null;
  displayCode: string | null;
  shelfLocation: string | null;
  status: EvidenceStatus;
  remark: string | null;
  paperCertificates: readonly {
    id: string;
    number: string | null;
    status: PaperStatus;
  }[];
};

const heading = [
  '店铺名',
  '案件进展',
  '办案律师',
  '公证书编号',
  '公证书状态',
  '证物编号',
  '货架号',
  '证物状态',
  '备注',
];

function cell(value: string | null): string {
  let safe = value ?? '—';
  if (/^[\s\uFEFF]*[=+\-@\t\r]/u.test(safe)) safe = `'${safe}`;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** Only server-authorized selected rows are passed to this function. */
export function selectedEvidenceCsv(
  rows: readonly ExportEvidenceRow[],
): string {
  const lines = [heading.map(cell).join(',')];
  for (const row of rows) {
    const papers = row.paperCertificates.length
      ? row.paperCertificates
      : [null];
    for (const paper of papers) {
      lines.push(
        [
          row.shopName,
          Object.entries(stageLabels).find(
            ([stage]) => stage === row.stage,
          )?.[1] ?? row.stage,
          row.lawyerName,
          paper ? `${paper.number ?? '—'} [${paper.id}]` : null,
          paper ? paperLabels[paper.status] : null,
          row.displayCode,
          row.shelfLocation,
          evidenceLabels[row.status],
          row.remark,
        ]
          .map(cell)
          .join(','),
      );
    }
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
