/**
 * 旧库（NocoBase）下拉字段的码值对照表。
 * 数据来源：旧库 ip_fields 表的 uiSchema.enum，非人工整理。
 */

export const legacyNotarizationTypeLabels: Record<string, string> = {
  '1': '网页公证',
  '2': '实物公证',
};

export const legacyNotarizationPlatformLabels: Record<string, string> = {
  '1': '法信云',
  '2': '数秦',
  '3': '坐标轴',
  '99': '其他',
};

export const legacyClueSourceLabels: Record<string, string> = {
  '1': '线上',
  '2': '线下',
};

export const legacyCaseTypeLabels: Record<string, string> = {
  '1': '民事',
  '2': '刑事',
  '3': '行政',
  '4': '公证',
};

export const legacyInfringementTypeLabels: Record<string, string> = {
  '1': '商标权',
  '2': '视听作品著作权',
  '3': '软件著作权',
  '4': '美术作品著作权',
  '5': '文字作品著作权',
  '6': '发明专利权',
  '7': '外观设计专利权',
  '8': '实用新型专利权',
  '9': '不正当竞争',
  '10': '信息网络传播权',
};

export const legacyPaymentTypeLabels: Record<string, string> = {
  '1': '运营',
  '2': '客户',
  '3': '律师',
};

export const legacyDisclosureTypeLabels: Record<string, string> = {
  '1': '法人',
  '2': '自然人',
};

export const legacyClueCheckOpinionLabels: Record<string, string> = {
  '1': '有',
  '2': '无',
};

export const legacyForensicsCheckOpinionLabels: Record<string, string> = {
  '1': '真货',
  '2': '假货',
  '3': '照片补拍',
};

export const legacyForensicsCheckResultLabels: Record<string, string> = {
  '1': '出证',
  '2': '退货',
};

export const legacyCustomerSettlementLabels: Record<string, string> = {
  '1': '已发账单',
  '2': '已回款',
};

export const legacyLawyerSettlementLabels: Record<string, string> = {
  '1': '已提交',
};

export const legacyArchiveTypeLabels: Record<string, string> = {
  '1': '链接已下架',
  '2': '无侵权信息',
  '3': '不取证',
  '4': '不发货-仅退款',
  '5': '收到货-不退货',
  '6': '收到货-退货退款',
  '7': '未收到货-仅退款',
  '8': '案件作废（包含撤诉）',
  '9': '调解结案',
  '10': '判决履行',
};

/** 码值翻译：命中返回中文，未命中原样返回，空值返回 null。 */
export function translateLegacy(
  map: Record<string, string>,
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined || value === '') return null;
  return map[value] ?? value;
}
