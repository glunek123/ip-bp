import { BadRequestException } from '@nestjs/common';
import {
  CaseExternalEntryKind,
  CaseStage,
  InfringementType,
  LeadCaseType,
  LeadPlatform,
} from '../../generated/prisma/enums';
import { parseCaseCsvRecords, CaseCsvParseError } from './case-csv-parser';

export const caseCsvHeaders = [
  '外录类型',
  '当前阶段',
  '到达日期',
  '来源',
  '原因',
  '客户编号',
  '权利主体',
  '被告类型',
  '被告姓名',
  '被告证件号',
  '被告电话',
  '被告地址',
  '律师',
  '法院',
  '法院案号',
  '受理日期',
  '二审受理日期',
  '平台',
  '店铺名称',
  '店铺外部编号',
  '案件类型',
  '侵权类型',
] as const;

export const caseCsvLabels = {
  entryKind: { EXTERNAL_TRANSFER: '外部移交', HISTORICAL_BACKFILL: '历史补录' },
  stage: {
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
  },
  defendantKind: { PERSON: '自然人', ORGANIZATION: '组织' },
  platform: {
    TAOBAO: '淘宝',
    TMALL: '天猫',
    PINDUODUO: '拼多多',
    JD: '京东',
    DOUYIN: '抖音',
    ALIBABA_1688: '1688',
    XIAOHONGSHU: '小红书',
    KUAISHOU: '快手',
    XIANYU: '闲鱼',
    WECHAT: '微信',
    MEITUAN: '美团',
    DIANPING: '大众点评',
    MAP: '地图',
    OTHER: '其他',
  },
  caseType: {
    CIVIL: '民事',
    CRIMINAL: '刑事',
    ADMINISTRATIVE: '行政',
    INVESTIGATION: '调查',
    NOTARIZATION: '公证',
    HEARING_REPRESENTATION: '代开庭',
  },
  infringement: {
    TRADEMARK: '商标权',
    SOFTWARE_COPYRIGHT: '软件著作权',
    ART_COPYRIGHT: '美术作品著作权',
    AUDIOVISUAL_COPYRIGHT: '视听作品著作权',
    TEXT_COPYRIGHT: '文字作品著作权',
    INVENTION_PATENT: '发明专利权',
    DESIGN_PATENT: '外观设计专利权',
    UTILITY_MODEL_PATENT: '实用新型专利权',
    UNFAIR_COMPETITION: '不正当竞争',
    NETWORK_DISSEMINATION: '信息网络传播权',
    PORTRAIT_RIGHT: '肖像权',
    OTHER: '其他',
  },
} satisfies {
  entryKind: Record<CaseExternalEntryKind, string>;
  stage: Record<CaseStage, string>;
  defendantKind: Record<'PERSON' | 'ORGANIZATION', string>;
  platform: Record<LeadPlatform, string>;
  caseType: Record<LeadCaseType, string>;
  infringement: Record<InfringementType, string>;
};

function escapeCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
export function caseCsvTemplate(): string {
  return '\uFEFF' + caseCsvHeaders.map(escapeCell).join(',') + '\r\n';
}

export type CaseCsvRecord = { rowNumber: number; cells: readonly string[] };
export function decodeCaseCsv(base64: string): {
  bytes: Uint8Array;
  records: CaseCsvRecord[];
} {
  if (
    typeof base64 !== 'string' ||
    base64.length < 1 ||
    base64.length > 87384 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      base64,
    )
  )
    throw new BadRequestException({ code: 'CASE_CSV_INVALID_BASE64' });
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > 65536 || bytes.toString('base64') !== base64)
    throw new BadRequestException({ code: 'CASE_CSV_BYTE_LIMIT' });
  let parsed;
  try {
    parsed = parseCaseCsvRecords(bytes, {
      maxBytes: 65536,
      maxRecords: 1001,
      maxColumns: caseCsvHeaders.length,
    });
  } catch (error) {
    if (error instanceof CaseCsvParseError)
      throw new BadRequestException({
        code: `CASE_CSV_${error.code}`,
        details: { line: error.line, column: error.column },
      });
    throw error;
  }
  if (
    parsed.length < 2 ||
    parsed[0].cells.length !== caseCsvHeaders.length ||
    parsed[0].cells.some((cell, index) => cell !== caseCsvHeaders[index])
  )
    throw new BadRequestException({ code: 'CASE_CSV_HEADER_INVALID' });
  return {
    bytes,
    records: parsed
      .slice(1)
      .map((record) => ({ rowNumber: record.startLine, cells: record.cells })),
  };
}
