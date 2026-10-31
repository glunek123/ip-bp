import { ApiError, getJson, type RequestOptions } from './http';

export type ArchiveCheckState = 'PASSED' | 'BLOCKED' | 'UNKNOWN' | 'EXEMPT';
export type ArchiveChecks = Record<
  'payment' | 'refund' | 'customer' | 'lawyer',
  { state: ArchiveCheckState; reason: string }
>;
export type CaseArchiveReadiness = {
  caseVersion: number;
  closureVersionId: string;
  checkedAt: string;
  state: 'PASSED' | 'BLOCKED' | 'UNKNOWN';
  checks: ArchiveChecks;
};
const invalid = (): never => {
  throw new ApiError('归档核查数据无效，请重新核查', 200, 'INVALID_RESPONSE');
};
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    return invalid();
  return value as Record<string, unknown>;
}
export function decodeArchiveChecks(value: unknown): ArchiveChecks {
  const row = object(value, ['payment', 'refund', 'customer', 'lawyer']);
  function check(value: unknown): ArchiveChecks['payment'] {
    const item = object(value, ['state', 'reason']);
    const state = item.state;
    if (
      state !== 'PASSED' &&
      state !== 'BLOCKED' &&
      state !== 'UNKNOWN' &&
      state !== 'EXEMPT'
    )
      return invalid();
    if (
      typeof item.reason !== 'string' ||
      !/^[A-Z][A-Z0-9_]{0,100}$/u.test(item.reason)
    )
      return invalid();
    return { state, reason: item.reason };
  }
  return {
    payment: check(row.payment),
    refund: check(row.refund),
    customer: check(row.customer),
    lawyer: check(row.lawyer),
  };
}
export function decodeCaseArchiveReadiness(
  value: unknown,
): CaseArchiveReadiness {
  const row = object(value, [
    'caseVersion',
    'closureVersionId',
    'checkedAt',
    'state',
    'checks',
  ]);
  if (
    typeof row.caseVersion !== 'number' ||
    !Number.isSafeInteger(row.caseVersion) ||
    row.caseVersion < 1 ||
    typeof row.closureVersionId !== 'string' ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(
      row.closureVersionId,
    ) ||
    typeof row.checkedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(row.checkedAt) ||
    !Number.isFinite(Date.parse(row.checkedAt))
  )
    return invalid();
  if (
    row.state !== 'PASSED' &&
    row.state !== 'BLOCKED' &&
    row.state !== 'UNKNOWN'
  )
    return invalid();
  const checks = decodeArchiveChecks(row.checks);
  const states = Object.values(checks).map((check) => check.state);
  const expected = states.includes('BLOCKED')
    ? 'BLOCKED'
    : states.includes('UNKNOWN')
      ? 'UNKNOWN'
      : 'PASSED';
  if (row.state !== expected) return invalid();
  return {
    caseVersion: row.caseVersion,
    closureVersionId: row.closureVersionId,
    checkedAt: row.checkedAt,
    state: row.state,
    checks,
  };
}
export async function getCaseArchiveReadiness(
  caseId: string,
  lawyer = false,
  options: RequestOptions = {},
): Promise<CaseArchiveReadiness> {
  return decodeCaseArchiveReadiness(
    await getJson(
      `${lawyer ? '/lawyer' : ''}/cases/${encodeURIComponent(caseId)}/archive-readiness`,
      options,
    ),
  );
}

const reasons: Record<string, string> = {
  CLOSURE_AMOUNT_UNKNOWN: '结案金额尚未确认',
  PAYMENT_TYPE_UNKNOWN: '付款方式尚未确认',
  ONE_TIME_MULTIPLE_EFFECTIVE_PAYMENTS: '一次性付款存在多笔有效记录，请核对',
  CLOSURE_PAYMENT_REACHED: '有效付款已达到结案金额',
  CLOSURE_PAYMENT_INCOMPLETE: '有效付款尚未达到结案金额',
  EXPLICIT_ZERO_CLOSURE_AMOUNT: '已明确结案金额为零，免校验',
  ASSESSMENT_MISSING: '尚未登记结算评估',
  SETTLEMENT_DECLARATION_UNKNOWN: '是否涉及结算尚未确认',
  ASSESSMENT_SOURCE_STALE: '结算评估来源已变化',
  ASSESSMENT_RULE_UNSUPPORTED: '结算计算规则尚不支持核验',
  ASSESSMENT_INPUTS_CHANGED: '结算计算依据已变化',
  SETTLEMENT_EXPLICITLY_NOT_APPLICABLE: '已明确不涉及结算',
  INVALID_NOT_APPLICABLE_AMOUNTS: '不涉及结算的金额记录不一致',
  INVALID_SETTLEMENT_CALCULATION: '结算计算无法核验',
  ASSESSMENT_RESULT_UNVERIFIED: '结算评估结果尚未核实',
  ALLOCATION_ID_CONFLICT: '资金分配记录不一致',
  INVALID_ALLOCATION_AMOUNT: '资金分配金额无法核验',
  CUSTOMER_REQUIRED_AMOUNT_ZERO: '客户应结金额明确为0，无需登记回款',
  LAWYER_REQUIRED_AMOUNT_ZERO: '律师应结金额明确为0，无需登记发票',
  SETTLEMENT_AMOUNT_UNKNOWN: '应结金额尚未确认',
  REFUND_AMOUNT_UNKNOWN: '部分诉讼退费金额待确认',
  REFUND_ALL_AMOUNTS_ZERO: '诉讼退费金额均明确为0，无需回款',
  CUSTOMER_RECEIPTS_REACHED: '实际客户回款已足额',
  LAWYER_INVOICES_REACHED: '实际律师开票已足额',
  CUSTOMER_RECEIPTS_INSUFFICIENT: '实际客户回款不足',
  LAWYER_INVOICES_INSUFFICIENT: '实际律师开票不足',
  SETTLEMENT_AMOUNT_OR_ZERO_EVIDENCE_UNKNOWN: '结算金额或零金额凭据尚未确认',
  REFUND_INVENTORY_MISSING: '尚未登记退费清单',
  INVALID_REFUND_INVENTORY: '退费清单无法核验',
  REFUND_EXPLICITLY_NOT_APPLICABLE: '无诉讼退费（0元）',
  REFUND_ITEMS_NOT_RECEIVED_OR_COSTED: '退费尚未全部到账或转成本',
  ALL_REFUND_ITEMS_RECEIVED_OR_COSTED: '退费已全部到账或按规则转成本',
  REFUND_COMPLETENESS_UNCONFIRMED: '退费清单完整性尚未确认',
  REFUND_ITEM_STATUS_UNKNOWN: '部分退费状态尚未确认',
  SOURCE_SCOPE_UNAUTHORIZED: '相关账目当前无法核查，请联系有权限的人员',
  CLOSURE_SOURCE_MISSING: '缺少当前结案来源',
  SQL_SETTLEMENT_RULE_UNVERIFIED: '结算计算规则尚未完成核验',
};
export function archiveCheckReason(reason: string): string {
  return reasons[reason] ?? '核查原因暂无法识别，请重新核查或联系管理员';
}
