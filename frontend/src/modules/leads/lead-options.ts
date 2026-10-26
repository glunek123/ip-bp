import type {
  InfringementType,
  LeadCaseType,
  LeadPlatform,
  LeadSource,
  LeadStatus,
} from '../../api/leads';

export const leadCaseTypeLabels: Record<LeadCaseType, string> = {
  CIVIL: '民事',
  CRIMINAL: '刑事',
  ADMINISTRATIVE: '行政',
  INVESTIGATION: '调查',
  NOTARIZATION: '公证',
  HEARING_REPRESENTATION: '代开庭',
};

export const leadInfringementTypeLabels: Record<InfringementType, string> = {
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
};

export const leadSourceLabels: Record<LeadSource, string> = {
  ONLINE: '线上',
  OFFLINE: '线下',
};

export const leadStatusCards: ReadonlyArray<{
  status: LeadStatus;
  label: string;
}> = [
  { status: 'WAITING_PUSH', label: '待推送' },
  { status: 'WAITING_REVIEW', label: '线索待审核' },
  { status: 'WAITING_EVIDENCE_DECISION', label: '线索待确认' },
  { status: 'ARCHIVED', label: '线索已归档' },
];

export const leadStatusLabels: Record<LeadStatus, string> = {
  WAITING_PUSH: '待推送',
  WAITING_REVIEW: '线索待审核',
  WAITING_EVIDENCE_DECISION: '线索待确认',
  TRANSFERRED_TO_NOTARY: '已移交公证',
  ARCHIVED: '线索已归档',
};

export const leadPlatformLabels: Record<LeadPlatform, string> = {
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
};

export function labelLeadPlatform(platform: LeadPlatform): string {
  return leadPlatformLabels[platform];
}

const leadBusinessLabels = new Map<string, string>([
  ...Object.entries(leadCaseTypeLabels),
  ...Object.entries(leadInfringementTypeLabels),
  ...Object.entries(leadSourceLabels),
  ...Object.entries(leadPlatformLabels),
]);

// The client-facing contract also accepts historical string values.
export function labelLeadBusinessValue(value: string): string {
  return leadBusinessLabels.get(value) ?? value;
}

export function decimalEstimate(
  quantity: string,
  commentCount: string,
  unitPrice: string,
): string | null {
  if (!/^\d+$/u.test(quantity) || !/^\d+$/u.test(commentCount)) return null;
  const money = /^(0|[1-9]\d{0,15})(?:\.(\d{1,2}))?$/u.exec(unitPrice);
  if (!money) return null;
  const basis = BigInt(quantity) > 0n ? BigInt(quantity) : BigInt(commentCount);
  const cents =
    BigInt(money[1] ?? '0') * 100n + BigInt((money[2] ?? '').padEnd(2, '0'));
  const total = basis * cents;
  return `${total / 100n}.${String(total % 100n).padStart(2, '0')}`;
}
