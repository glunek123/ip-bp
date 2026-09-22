import type { LeadPlatform, LeadStatus } from '../../api/leads';

export const leadStatusCards: ReadonlyArray<{
  status: LeadStatus;
  label: string;
}> = [
  { status: 'WAITING_PUSH', label: '待推送' },
  { status: 'WAITING_REVIEW', label: '线索待审核' },
  { status: 'WAITING_EVIDENCE_DECISION', label: '线索待确认' },
  { status: 'ARCHIVED', label: '线索已归档' },
];

export const leadStatusLabels: Record<LeadStatus, string> = Object.fromEntries(
  leadStatusCards.map(({ status, label }) => [status, label]),
) as Record<LeadStatus, string>;

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
