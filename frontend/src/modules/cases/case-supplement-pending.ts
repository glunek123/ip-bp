import type {
  CaseSupplementKind,
  CreateCaseSupplementInput,
} from '../../api/case-supplements';

export type PendingCaseSupplement = {
  actorKey: string;
  caseId: string;
  input: CreateCaseSupplementInput;
};
const prefix = 'case-supplement-pending:v1:';
const identity = (actorKey: string, caseId: string) =>
  prefix + [actorKey, caseId.toLowerCase()].map(encodeURIComponent).join(':');
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
const optional = (value: unknown) =>
  value === undefined || typeof value === 'string';
const kinds: readonly CaseSupplementKind[] = [
  'COURT_PREPAYMENT_NOTICE',
  'COURT_DISCLOSURE',
  'RECORD_RETRIEVAL_DOCUMENT',
  'PRESERVATION_DOCUMENT',
  'EXECUTION_FORMAL_ACCEPTANCE',
  'REFUND_SOURCE_LINK',
  'MANUAL_ANNOTATION',
];
const fields = [
  'kind',
  'reason',
  'idempotencyKey',
  'expectedHeadId',
  'trialRoundId',
  'amount',
  'text',
  'eventDate',
  'courtCaseNo',
  'sourceType',
  'sourceId',
  'inventoryVersionId',
  'inventoryItemId',
  'materialId',
  'contentVersionId',
];

export function validPendingCaseSupplement(
  value: unknown,
  actorKey: string,
  caseId: string,
): value is PendingCaseSupplement {
  if (
    !record(value) ||
    value.actorKey !== actorKey ||
    value.caseId !== caseId ||
    !record(value.input)
  )
    return false;
  const input = value.input;
  return (
    Object.keys(value).length === 3 &&
    Object.keys(input).every((key) => fields.includes(key)) &&
    kinds.some((kind) => kind === input.kind) &&
    typeof input.reason === 'string' &&
    input.reason.trim().length > 0 &&
    uuid(input.idempotencyKey) &&
    (!Object.hasOwn(input, 'expectedHeadId') || uuid(input.expectedHeadId)) &&
    optional(input.trialRoundId) &&
    optional(input.amount) &&
    optional(input.text) &&
    optional(input.eventDate) &&
    optional(input.courtCaseNo) &&
    optional(input.sourceType) &&
    optional(input.sourceId) &&
    optional(input.inventoryVersionId) &&
    optional(input.inventoryItemId) &&
    optional(input.materialId) &&
    optional(input.contentVersionId)
  );
}

export function getPendingCaseSupplement(
  actorKey: string,
  caseId: string,
): PendingCaseSupplement | 'damaged' | null {
  try {
    const raw = localStorage.getItem(identity(actorKey, caseId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return validPendingCaseSupplement(parsed, actorKey, caseId)
      ? parsed
      : 'damaged';
  } catch {
    return 'damaged';
  }
}
export function setPendingCaseSupplement(value: PendingCaseSupplement) {
  const key = identity(value.actorKey, value.caseId);
  if (localStorage.getItem(key) !== null)
    throw new Error('Pending case supplement already exists');
  localStorage.setItem(key, JSON.stringify(value));
}
export function clearPendingCaseSupplement(
  actorKey: string,
  caseId: string,
  key: string,
) {
  const stored = getPendingCaseSupplement(actorKey, caseId);
  if (stored && stored !== 'damaged' && stored.input.idempotencyKey === key)
    localStorage.removeItem(identity(actorKey, caseId));
}
