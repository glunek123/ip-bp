import type {
  batchFees,
  createCaseFeeEntries,
  createFee,
  createSettlementBill,
  launchSettlement,
  updateCaseSettlementTerms,
  updateFeeProof,
  cancelSettlementBill,
} from '../../api/settlements';
type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(
  value: RecordValue,
  required: string[],
  optional: string[] = [],
): boolean {
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every(
      (key) => required.includes(key) || optional.includes(key),
    )
  );
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function version(value: unknown, min = 1): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= min
  );
}
function side(value: unknown): boolean {
  return value === 'CUSTOMER' || value === 'LAWYER';
}
function key(value: unknown): value is string {
  return text(value) && value.trim().length > 0 && value.length <= 128;
}
function day(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}
function money(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^(0|[1-9]\d{0,15})(?:\.\d{1,2})?$/u.test(value)
  );
}
function note(value: unknown): boolean {
  return (
    value === undefined || (typeof value === 'string' && value.length <= 500)
  );
}
function ids(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(text) &&
    new Set(value).size === value.length
  );
}
export function isPendingLaunch(
  value: unknown,
): value is Parameters<typeof launchSettlement>[1] {
  return (
    record(value) &&
    keys(
      value,
      [
        'side',
        'amount',
        'launchDate',
        'expectedTermsVersion',
        'idempotencyKey',
      ],
      ['note', 'lawyerId'],
    ) &&
    side(value.side) &&
    money(value.amount) &&
    day(value.launchDate) &&
    version(value.expectedTermsVersion) &&
    key(value.idempotencyKey) &&
    note(value.note) &&
    (value.lawyerId === undefined || text(value.lawyerId))
  );
}
export function isPendingTerms(
  value: unknown,
): value is Parameters<typeof updateCaseSettlementTerms>[1] {
  if (
    !record(value) ||
    !keys(
      value,
      ['side', 'expectedTermsVersion', 'idempotencyKey'],
      [
        'customerFormula',
        'lawyerMode',
        'lawyerBaseFee',
        'lawyerSplitPercent',
        'manualAmount',
      ],
    ) ||
    !side(value.side) ||
    !version(value.expectedTermsVersion, 0) ||
    !key(value.idempotencyKey) ||
    !(
      value.manualAmount === undefined ||
      value.manualAmount === null ||
      money(value.manualAmount)
    )
  )
    return false;
  return value.side === 'CUSTOMER'
    ? typeof value.customerFormula === 'string' &&
        value.customerFormula.length <= 500 &&
        value.lawyerMode === undefined &&
        value.lawyerBaseFee === undefined &&
        value.lawyerSplitPercent === undefined
    : value.customerFormula === undefined &&
        ['FULL_RISK', 'HALF_RISK', 'FIXED_FEE'].includes(
          String(value.lawyerMode),
        ) &&
        money(value.lawyerBaseFee) &&
        typeof value.lawyerSplitPercent === 'string' &&
        /^(?:100(?:\.0{1,16})?|\d{1,2}(?:\.\d{1,16})?)$/u.test(
          value.lawyerSplitPercent,
        );
}
export function isPendingBill(
  value: unknown,
): value is Parameters<typeof createSettlementBill>[0] {
  return (
    record(value) &&
    keys(
      value,
      ['side', 'billDate', 'launchIds', 'idempotencyKey'],
      ['note'],
    ) &&
    side(value.side) &&
    day(value.billDate) &&
    ids(value.launchIds) &&
    key(value.idempotencyKey) &&
    note(value.note)
  );
}
export type PendingCancel = {
  id: string;
  body: Parameters<typeof cancelSettlementBill>[1];
};
export function isPendingCancel(value: unknown): value is PendingCancel {
  return (
    record(value) &&
    keys(value, ['id', 'body']) &&
    text(value.id) &&
    record(value.body) &&
    keys(value.body, ['idempotencyKey'], ['reason']) &&
    key(value.body.idempotencyKey) &&
    note(value.body.reason)
  );
}
export function isPendingFee(
  value: unknown,
): value is Parameters<typeof createFee>[0] {
  return (
    record(value) &&
    keys(
      value,
      [
        'caseId',
        'type',
        'direction',
        'amount',
        'status',
        'feeDate',
        'idempotencyKey',
      ],
      ['note'],
    ) &&
    text(value.caseId) &&
    text(value.type) &&
    (value.direction === '收入' || value.direction === '支出') &&
    money(value.amount) &&
    text(value.status) &&
    day(value.feeDate) &&
    key(value.idempotencyKey) &&
    note(value.note)
  );
}
export type PendingFeeBatch = {
  command: 'launch' | 'delete';
  body: Parameters<typeof batchFees>[1];
};
export function isPendingFeeBatch(value: unknown): value is PendingFeeBatch {
  return (
    record(value) &&
    keys(value, ['command', 'body']) &&
    (value.command === 'launch' || value.command === 'delete') &&
    record(value.body) &&
    keys(value.body, ['ids', 'idempotencyKey']) &&
    ids(value.body.ids) &&
    key(value.body.idempotencyKey)
  );
}
export type PendingFeeProof = {
  feeId: string;
  body: Parameters<typeof updateFeeProof>[1];
};
export function isPendingFeeProof(value: unknown): value is PendingFeeProof {
  return (
    record(value) &&
    keys(value, ['feeId', 'body']) &&
    text(value.feeId) &&
    record(value.body) &&
    keys(value.body, [
      'expectedVersion',
      'materialId',
      'contentVersionId',
      'idempotencyKey',
    ]) &&
    version(value.body.expectedVersion) &&
    key(value.body.idempotencyKey) &&
    ((value.body.materialId === null && value.body.contentVersionId === null) ||
      (text(value.body.materialId) && text(value.body.contentVersionId)))
  );
}
export function isPendingCaseFees(
  value: unknown,
): value is Parameters<typeof createCaseFeeEntries>[0] {
  return (
    record(value) &&
    keys(value, ['caseId', 'rows', 'idempotencyKey']) &&
    text(value.caseId) &&
    key(value.idempotencyKey) &&
    Array.isArray(value.rows) &&
    value.rows.length > 0 &&
    value.rows.every(
      (row) => isPendingFee(row) && row.caseId === value.caseId,
    ) &&
    new Set(value.rows.map((row) => row.idempotencyKey)).size ===
      value.rows.length
  );
}
function storageKey(scope: string, kind: string): string {
  return `dev-cor.financial-pending.v1:${scope}:${kind}`;
}
export function loadFinancialPending<T>(
  scope: string,
  kind: string,
  validate: (value: unknown) => value is T,
): T | null {
  const raw = globalThis.sessionStorage.getItem(storageKey(scope, kind));
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('原请求记录无法解析，请核对后再提交');
  }
  if (!validate(value)) throw new Error('原请求记录不完整，请核对后再提交');
  return value;
}
export function storeFinancialPending<T>(
  scope: string,
  kind: string,
  body: T,
): void {
  const stored = globalThis.sessionStorage.getItem(storageKey(scope, kind));
  const encoded = JSON.stringify(body);
  if (stored !== null && stored !== encoded)
    throw new Error('已有未确认的原请求，请先恢复并核对');
  try {
    globalThis.sessionStorage.setItem(storageKey(scope, kind), encoded);
  } catch {
    throw new Error('无法保留原请求，请恢复浏览器会话存储后重试');
  }
}
export function clearFinancialPending<T>(
  scope: string,
  kind: string,
  body: T,
): void {
  if (
    globalThis.sessionStorage.getItem(storageKey(scope, kind)) ===
    JSON.stringify(body)
  )
    globalThis.sessionStorage.removeItem(storageKey(scope, kind));
}
