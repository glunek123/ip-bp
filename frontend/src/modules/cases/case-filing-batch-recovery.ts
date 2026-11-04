import type {
  CaseFile,
  SubmitCaseFilingInput,
  SubmitCaseFilingResult,
} from '../../api/cases';

export type FilingBatchState =
  'PREPARED' | 'SENT' | 'UNKNOWN' | 'COMMITTED' | 'FAILED' | 'BLOCKED';
export type FilingBatchItem = {
  caseId: string;
  businessNo: string;
  state: FilingBatchState;
  input: SubmitCaseFilingInput;
  courtName: string;
  evidenceFiles: CaseFile[];
  screenshotFiles: CaseFile[];
  result?: SubmitCaseFilingResult;
  note?: string;
};
export type FilingBatch = {
  identity: string;
  batchId: string;
  createdAt: string;
  items: FilingBatchItem[];
};
export type FilingBatchRead =
  | { state: 'missing' }
  | { state: 'valid'; batch: FilingBatch }
  | { state: 'blocked' };
const storageKey = (identity: string) =>
  `case-filing-batch-v2:${encodeURIComponent(identity)}`;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function filingActorIdentity(actorKey: string): string | null {
  const parts = actorKey.split(':');
  return parts.length >= 3 && parts.slice(0, 3).every(Boolean)
    ? parts.slice(0, 3).join(':')
    : null;
}
function validInput(value: unknown): value is SubmitCaseFilingInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(item.expectedVersion) &&
    (item.expectedVersion as number) >= 1 &&
    typeof item.idempotencyKey === 'string' &&
    item.idempotencyKey.length > 0 &&
    item.idempotencyKey.length <= 128 &&
    item.idempotencyKey.trim() === item.idempotencyKey &&
    typeof item.courtId === 'string' &&
    uuid.test(item.courtId) &&
    typeof item.submittedAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/u.test(item.submittedAt) &&
    Array.isArray(item.filingEvidenceContentVersionIds) &&
    item.filingEvidenceContentVersionIds.every(
      (id) => typeof id === 'string' && uuid.test(id),
    ) &&
    (item.filingScreenshotContentVersionIds === undefined ||
      (Array.isArray(item.filingScreenshotContentVersionIds) &&
        item.filingScreenshotContentVersionIds.every(
          (id) => typeof id === 'string' && uuid.test(id),
        ))) &&
    (item.consolidationSourceContentVersionIds === undefined ||
      (Array.isArray(item.consolidationSourceContentVersionIds) &&
        item.consolidationSourceContentVersionIds.every(
          (id) => typeof id === 'string' && uuid.test(id),
        ))) &&
    (item.mediationNo === undefined || typeof item.mediationNo === 'string')
  );
}
function validFile(value: unknown): value is CaseFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const file = value as Record<string, unknown>;
  return (
    typeof file.materialId === 'string' &&
    uuid.test(file.materialId) &&
    typeof file.contentVersionId === 'string' &&
    uuid.test(file.contentVersionId) &&
    typeof file.originalFilename === 'string' &&
    !!file.originalFilename &&
    typeof file.mimeType === 'string'
  );
}
function validResult(
  value: unknown,
  caseId: string,
  input: SubmitCaseFilingInput,
): value is SubmitCaseFilingResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return (
    result.id === caseId &&
    result.stage === 'WAITING_FORMAL_ACCEPTANCE' &&
    Number.isSafeInteger(result.version) &&
    result.version === input.expectedVersion + 1 &&
    result.submittedAt === input.submittedAt &&
    typeof result.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(result.recordedAt))
  );
}
function validBatch(value: unknown, identity: string): value is FilingBatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const batch = value as Record<string, unknown>;
  if (
    batch.identity !== identity ||
    typeof batch.batchId !== 'string' ||
    !uuid.test(batch.batchId) ||
    typeof batch.createdAt !== 'string' ||
    Number.isNaN(Date.parse(batch.createdAt)) ||
    !Array.isArray(batch.items) ||
    batch.items.length < 1 ||
    batch.items.length > 20
  )
    return false;
  const seen = new Set<string>();
  return batch.items.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      return false;
    const item = entry as Record<string, unknown>;
    if (
      typeof item.caseId !== 'string' ||
      !uuid.test(item.caseId) ||
      seen.has(item.caseId) ||
      typeof item.businessNo !== 'string' ||
      !item.businessNo ||
      ![
        'PREPARED',
        'SENT',
        'UNKNOWN',
        'COMMITTED',
        'FAILED',
        'BLOCKED',
      ].includes(String(item.state)) ||
      (item.note !== undefined && typeof item.note !== 'string') ||
      !validInput(item.input) ||
      typeof item.courtName !== 'string' ||
      !item.courtName ||
      !Array.isArray(item.evidenceFiles) ||
      !item.evidenceFiles.every(validFile) ||
      !Array.isArray(item.screenshotFiles) ||
      !item.screenshotFiles.every(validFile) ||
      JSON.stringify(
        item.evidenceFiles.map((file: CaseFile) => file.contentVersionId),
      ) !==
        JSON.stringify(
          (item.input as SubmitCaseFilingInput).filingEvidenceContentVersionIds,
        ) ||
      JSON.stringify(
        item.screenshotFiles.map((file: CaseFile) => file.contentVersionId),
      ) !==
        JSON.stringify(
          (item.input as SubmitCaseFilingInput)
            .filingScreenshotContentVersionIds ?? [],
        ) ||
      (item.state === 'COMMITTED'
        ? !validResult(
            item.result,
            item.caseId,
            item.input as SubmitCaseFilingInput,
          )
        : item.result !== undefined)
    )
      return false;
    seen.add(item.caseId);
    return true;
  });
}
export function readFilingBatchState(identity: string): FilingBatchRead {
  try {
    const raw = globalThis.localStorage.getItem(storageKey(identity));
    if (raw === null) return { state: 'missing' };
    const value: unknown = JSON.parse(raw);
    return validBatch(value, identity)
      ? { state: 'valid', batch: value }
      : { state: 'blocked' };
  } catch {
    return { state: 'blocked' };
  }
}
export function readFilingBatch(identity: string): FilingBatch | null {
  const state = readFilingBatchState(identity);
  return state.state === 'valid' ? state.batch : null;
}
export function saveFilingBatch(batch: FilingBatch): boolean {
  if (!validBatch(batch, batch.identity)) return false;
  try {
    const previous = readFilingBatchState(batch.identity);
    if (
      previous.state === 'blocked' ||
      (previous.state === 'valid' && previous.batch.batchId !== batch.batchId)
    )
      return false;
    globalThis.localStorage.setItem(
      storageKey(batch.identity),
      JSON.stringify(batch),
    );
    return true;
  } catch {
    return false;
  }
}
export function clearFilingBatch(batch: FilingBatch): boolean {
  try {
    const previous = readFilingBatchState(batch.identity);
    if (previous.state !== 'valid' || previous.batch.batchId !== batch.batchId)
      return false;
    globalThis.localStorage.removeItem(storageKey(batch.identity));
    return true;
  } catch {
    return false;
  }
}
