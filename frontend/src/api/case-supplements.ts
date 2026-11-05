import { ApiError, requestJson, type RequestOptions } from './http';

export type CaseSupplementKind =
  | 'COURT_PREPAYMENT_NOTICE'
  | 'COURT_DISCLOSURE'
  | 'RECORD_RETRIEVAL_DOCUMENT'
  | 'PRESERVATION_DOCUMENT'
  | 'EXECUTION_FORMAL_ACCEPTANCE'
  | 'REFUND_SOURCE_LINK'
  | 'MANUAL_ANNOTATION';

export type CaseSupplementEntry = {
  id: string;
  priorEntryId: string | null;
  kind: CaseSupplementKind;
  trialRoundId: string | null;
  amount: string | null;
  text: string | null;
  eventDate: string | null;
  courtCaseNo: string | null;
  sourceType: string | null;
  sourceId: string | null;
  inventoryVersionId: string | null;
  inventoryItemId: string | null;
  materialId: string | null;
  contentVersionId: string | null;
  reason: string;
  recordedByUserId: string;
  recordedAt: string;
};

export type CaseSupplementWorkspace = {
  canEdit: boolean;
  entries: CaseSupplementEntry[];
  recorders: Array<{ id: string; displayName: string }>;
  sources: {
    executionFiling: { id: string; submittedOn: string } | null;
    trialRounds: Array<{ id: string; sequence: number }>;
    judgments: Array<{ id: string; trialRoundId: string; receivedOn: string }>;
    secondResults: Array<{
      id: string;
      trialRoundId: string;
      receivedOn: string;
    }>;
    refundItems: Array<{
      inventoryVersionId: string;
      inventoryItemId: string;
      description: string;
    }>;
    materials: Array<{
      materialId: string;
      contentVersionId: string;
      category: string;
      filename: string;
      linked: boolean;
      uploadReason: string | null;
      uploadedByUserId: string | null;
      uploadedAt: string | null;
    }>;
  };
};

export type CreateCaseSupplementInput = {
  kind: CaseSupplementKind;
  trialRoundId?: string;
  reason: string;
  idempotencyKey: string;
  expectedHeadId?: string;
  amount?: string;
  text?: string;
  eventDate?: string;
  courtCaseNo?: string;
  sourceType?: string;
  sourceId?: string;
  inventoryVersionId?: string;
  inventoryItemId?: string;
  materialId?: string;
  contentVersionId?: string;
};

const kinds: readonly CaseSupplementKind[] = [
  'COURT_PREPAYMENT_NOTICE',
  'COURT_DISCLOSURE',
  'RECORD_RETRIEVAL_DOCUMENT',
  'PRESERVATION_DOCUMENT',
  'EXECUTION_FORMAL_ACCEPTANCE',
  'REFUND_SOURCE_LINK',
  'MANUAL_ANNOTATION',
];
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
function isEntry(value: unknown): value is CaseSupplementEntry {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    nullableString(value.priorEntryId) &&
    kinds.some((kind) => kind === value.kind) &&
    nullableString(value.trialRoundId) &&
    nullableString(value.amount) &&
    nullableString(value.text) &&
    nullableString(value.eventDate) &&
    nullableString(value.courtCaseNo) &&
    nullableString(value.sourceType) &&
    nullableString(value.sourceId) &&
    nullableString(value.inventoryVersionId) &&
    nullableString(value.inventoryItemId) &&
    nullableString(value.materialId) &&
    nullableString(value.contentVersionId) &&
    typeof value.reason === 'string' &&
    typeof value.recordedByUserId === 'string' &&
    typeof value.recordedAt === 'string' &&
    validEntryShape(value)
  );
}
function validEntryShape(value: Record<string, unknown>): boolean {
  switch (value.kind) {
    case 'COURT_PREPAYMENT_NOTICE':
      return (
        typeof value.trialRoundId === 'string' &&
        typeof value.amount === 'string' &&
        value.text === null &&
        value.materialId === null
      );
    case 'COURT_DISCLOSURE':
      return (
        typeof value.trialRoundId === 'string' &&
        (typeof value.text === 'string' ||
          typeof value.materialId === 'string') &&
        (value.materialId === null) === (value.contentVersionId === null)
      );
    case 'RECORD_RETRIEVAL_DOCUMENT':
    case 'PRESERVATION_DOCUMENT':
      return (
        typeof value.materialId === 'string' &&
        typeof value.contentVersionId === 'string'
      );
    case 'EXECUTION_FORMAL_ACCEPTANCE':
      return (
        (typeof value.eventDate === 'string' ||
          typeof value.courtCaseNo === 'string' ||
          typeof value.materialId === 'string') &&
        value.sourceType === 'EXECUTION_FILING' &&
        typeof value.sourceId === 'string' &&
        (value.materialId === null) === (value.contentVersionId === null)
      );
    case 'REFUND_SOURCE_LINK':
      return (
        (value.sourceType === 'JUDGMENT' ||
          value.sourceType === 'SECOND_INSTANCE_RESULT') &&
        typeof value.sourceId === 'string' &&
        typeof value.inventoryVersionId === 'string' &&
        typeof value.inventoryItemId === 'string'
      );
    case 'MANUAL_ANNOTATION':
      return typeof value.text === 'string';
    default:
      return false;
  }
}
function isSource(
  value: unknown,
): value is { id: string; trialRoundId: string; receivedOn: string } {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    typeof value.trialRoundId === 'string' &&
    typeof value.receivedOn === 'string'
  );
}
function isWorkspace(value: unknown): value is CaseSupplementWorkspace {
  if (
    !record(value) ||
    typeof value.canEdit !== 'boolean' ||
    !Array.isArray(value.entries) ||
    !value.entries.every(isEntry) ||
    !Array.isArray(value.recorders) ||
    !value.recorders.every(
      (item: unknown) =>
        record(item) &&
        typeof item.id === 'string' &&
        typeof item.displayName === 'string',
    ) ||
    !record(value.sources)
  )
    return false;
  const sources = value.sources;
  return (
    (sources.executionFiling === null ||
      (record(sources.executionFiling) &&
        typeof sources.executionFiling.id === 'string' &&
        typeof sources.executionFiling.submittedOn === 'string')) &&
    Array.isArray(sources.trialRounds) &&
    sources.trialRounds.every(
      (item: unknown) =>
        record(item) &&
        typeof item.id === 'string' &&
        Number.isInteger(item.sequence),
    ) &&
    Array.isArray(sources.judgments) &&
    sources.judgments.every(isSource) &&
    Array.isArray(sources.secondResults) &&
    sources.secondResults.every(isSource) &&
    Array.isArray(sources.refundItems) &&
    sources.refundItems.every(
      (item: unknown) =>
        record(item) &&
        typeof item.inventoryVersionId === 'string' &&
        typeof item.inventoryItemId === 'string' &&
        typeof item.description === 'string',
    ) &&
    Array.isArray(sources.materials) &&
    sources.materials.every(
      (item: unknown) =>
        record(item) &&
        typeof item.materialId === 'string' &&
        typeof item.contentVersionId === 'string' &&
        typeof item.category === 'string' &&
        typeof item.filename === 'string' &&
        typeof item.linked === 'boolean' &&
        nullableString(item.uploadReason) &&
        nullableString(item.uploadedByUserId) &&
        nullableString(item.uploadedAt),
    )
  );
}

function invalidResponse(): never {
  throw new ApiError('补录资料响应无效', 200, 'INVALID_RESPONSE');
}

export async function getCaseSupplementalWorkspace(
  caseId: string,
  options: RequestOptions = {},
): Promise<CaseSupplementWorkspace> {
  const response = await requestJson(
    `/cases/${encodeURIComponent(caseId)}/supplemental-workspace`,
    { ...options, method: 'GET' },
  );
  if (!isWorkspace(response)) invalidResponse();
  return response;
}

export async function createCaseSupplement(
  caseId: string,
  input: CreateCaseSupplementInput,
  options: RequestOptions = {},
): Promise<CaseSupplementEntry> {
  const response = await requestJson(
    `/cases/${encodeURIComponent(caseId)}/supplemental-workspace`,
    { ...options, method: 'POST', body: input },
  );
  if (!isEntry(response)) invalidResponse();
  return response;
}

export async function getCaseSupplementRequest(
  caseId: string,
  key: string,
  options: RequestOptions = {},
): Promise<CaseSupplementEntry> {
  const response = await requestJson(
    `/cases/${encodeURIComponent(caseId)}/supplemental-workspace/requests/${encodeURIComponent(key)}`,
    { ...options, method: 'GET' },
  );
  if (!isEntry(response)) invalidResponse();
  return response;
}
