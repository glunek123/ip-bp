export type Option<T extends string> = Readonly<{ value: T; label: string }>;

export const CASE_TYPE_OPTIONS = [
  { value: 'CIVIL', label: '民事' },
  { value: 'CRIMINAL', label: '刑事' },
  { value: 'ADMINISTRATIVE', label: '行政' },
  { value: 'INVESTIGATION', label: '调查' },
  { value: 'NOTARIZATION', label: '公证' },
  { value: 'HEARING_REPRESENTATION', label: '代开庭' },
] as const;

export const INFRINGEMENT_TYPE_OPTIONS = [
  { value: 'TRADEMARK', label: '商标权' },
  { value: 'SOFTWARE_COPYRIGHT', label: '软件著作权' },
  { value: 'ART_COPYRIGHT', label: '美术作品著作权' },
  { value: 'AUDIOVISUAL_COPYRIGHT', label: '视听作品著作权' },
  { value: 'TEXT_COPYRIGHT', label: '文字作品著作权' },
  { value: 'INVENTION_PATENT', label: '发明专利权' },
  { value: 'DESIGN_PATENT', label: '外观设计专利权' },
  { value: 'UTILITY_MODEL_PATENT', label: '实用新型专利权' },
  { value: 'UNFAIR_COMPETITION', label: '不正当竞争' },
  { value: 'NETWORK_DISSEMINATION', label: '信息网络传播权' },
  { value: 'PORTRAIT_RIGHT', label: '肖像权' },
  { value: 'OTHER', label: '其他' },
] as const;

export const SOURCE_OPTIONS = [
  { value: 'ONLINE', label: '线上' },
  { value: 'OFFLINE', label: '线下' },
] as const;

export const PLATFORM_OPTIONS = {
  ONLINE: [
    { value: 'TAOBAO', label: '淘宝' },
    { value: 'TMALL', label: '天猫' },
    { value: 'PINDUODUO', label: '拼多多' },
    { value: 'JD', label: '京东' },
    { value: 'DOUYIN', label: '抖音' },
    { value: 'ALIBABA_1688', label: '1688' },
    { value: 'XIAOHONGSHU', label: '小红书' },
    { value: 'KUAISHOU', label: '快手' },
    { value: 'XIANYU', label: '闲鱼' },
    { value: 'WECHAT', label: '微信' },
    { value: 'OTHER', label: '其他' },
  ],
  OFFLINE: [
    { value: 'MEITUAN', label: '美团' },
    { value: 'DIANPING', label: '大众点评' },
    { value: 'MAP', label: '地图' },
    { value: 'OTHER', label: '其他' },
  ],
} as const;

export const LEAD_STATUSES = [
  'WAITING_PUSH',
  'WAITING_REVIEW',
  'WAITING_EVIDENCE_DECISION',
  'TRANSFERRED_TO_NOTARY',
  'ARCHIVED',
] as const;

export type LeadCaseType = (typeof CASE_TYPE_OPTIONS)[number]['value'];
export type InfringementType =
  (typeof INFRINGEMENT_TYPE_OPTIONS)[number]['value'];
export type LeadSource = (typeof SOURCE_OPTIONS)[number]['value'];
export type LeadPlatform =
  (typeof PLATFORM_OPTIONS)[keyof typeof PLATFORM_OPTIONS][number]['value'];
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const CASE_TYPES = CASE_TYPE_OPTIONS.map(({ value }) => value);
export const INFRINGEMENT_TYPES = INFRINGEMENT_TYPE_OPTIONS.map(
  ({ value }) => value,
);
export const SOURCES = SOURCE_OPTIONS.map(({ value }) => value);
export const PLATFORMS = [
  ...new Set(
    [...PLATFORM_OPTIONS.ONLINE, ...PLATFORM_OPTIONS.OFFLINE].map(
      ({ value }) => value,
    ),
  ),
];
