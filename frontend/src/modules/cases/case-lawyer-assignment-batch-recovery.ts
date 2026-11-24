import {
  validAssignCaseLawyerResult,
  type AssignCaseLawyerInput,
  type AssignCaseLawyerResult,
} from '../../api/case-lawyer-assignment';
import { filingActorIdentity } from './case-filing-batch-recovery';
export { filingActorIdentity };
export type LawyerAssignmentBatchState =
  | 'PREPARED'
  | 'SENT'
  | 'UNKNOWN'
  | 'ASSIGNED'
  | 'NO_CHANGE'
  | 'SKIPPED'
  | 'REASSIGNED'
  | 'FAILED'
  | 'BLOCKED';
export type LawyerAssignmentBatchItem = {
  caseId: string;
  businessNo: string;
  state: LawyerAssignmentBatchState;
  input: AssignCaseLawyerInput;
  result?: AssignCaseLawyerResult;
  note?: string;
};
export type LawyerAssignmentBatch = {
  identity: string;
  batchId: string;
  target: {
    lawyerAccountId: string | null;
    lawyerProfileId: string;
    displayName: string;
    username: string | null;
  };
  items: LawyerAssignmentBatchItem[];
};
export type LawyerAssignmentBatchRead =
  | { state: 'missing' }
  | { state: 'blocked' }
  | { state: 'valid'; batch: LawyerAssignmentBatch };
const key = (identity: string) =>
  `case-lawyer-assignment-batch-v1:${encodeURIComponent(identity)}`;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const obj = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function validBatch(
  value: unknown,
  identity: string,
): value is LawyerAssignmentBatch {
  if (
    !obj(value) ||
    value.identity !== identity ||
    typeof value.batchId !== 'string' ||
    !uuid.test(value.batchId) ||
    !obj(value.target) ||
    (value.target.lawyerAccountId !== null &&
      (typeof value.target.lawyerAccountId !== 'string' ||
        !uuid.test(value.target.lawyerAccountId))) ||
    typeof value.target.lawyerProfileId !== 'string' ||
    !uuid.test(value.target.lawyerProfileId) ||
    typeof value.target.displayName !== 'string' ||
    !value.target.displayName ||
    (value.target.username !== null &&
      typeof value.target.username !== 'string') ||
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > 20
  )
    return false;
  const target = value.target as Record<string, unknown>;
  const seen = new Set<string>();
  return value.items.every((entry) => {
    if (
      !obj(entry) ||
      typeof entry.caseId !== 'string' ||
      !uuid.test(entry.caseId) ||
      seen.has(entry.caseId) ||
      typeof entry.businessNo !== 'string' ||
      !entry.businessNo ||
      ![
        'PREPARED',
        'SENT',
        'UNKNOWN',
        'ASSIGNED',
        'NO_CHANGE',
        'SKIPPED',
        'FAILED',
        'BLOCKED',
      ].includes(String(entry.state)) ||
      !obj(entry.input) ||
      !Number.isSafeInteger(entry.input.expectedVersion) ||
      (entry.input.expectedVersion as number) < 1 ||
      typeof entry.input.idempotencyKey !== 'string' ||
      !entry.input.idempotencyKey ||
      entry.input.idempotencyKey.length > 128 ||
      entry.input.lawyerProfileId !== target.lawyerProfileId ||
      (target.lawyerAccountId === null
        ? entry.input.lawyerAccountId !== undefined
        : entry.input.lawyerAccountId !== target.lawyerAccountId) ||
      (entry.note !== undefined && typeof entry.note !== 'string')
    )
      return false;
    if (['ASSIGNED', 'NO_CHANGE', 'SKIPPED'].includes(String(entry.state))) {
      if (
        !validAssignCaseLawyerResult(
          entry.result,
          entry.caseId,
          entry.input as AssignCaseLawyerInput,
        ) ||
        entry.result.outcome !== entry.state
      )
        return false;
    } else if (entry.result !== undefined) return false;
    seen.add(entry.caseId);
    return true;
  });
}
export function readLawyerAssignmentBatch(
  identity: string,
): LawyerAssignmentBatchRead {
  try {
    const raw = globalThis.localStorage.getItem(key(identity));
    if (raw === null) return { state: 'missing' };
    const value: unknown = JSON.parse(raw);
    return validBatch(value, identity)
      ? { state: 'valid', batch: value }
      : { state: 'blocked' };
  } catch {
    return { state: 'blocked' };
  }
}
export function saveLawyerAssignmentBatch(
  batch: LawyerAssignmentBatch,
): boolean {
  if (!validBatch(batch, batch.identity)) return false;
  try {
    const old = readLawyerAssignmentBatch(batch.identity);
    if (
      old.state === 'blocked' ||
      (old.state === 'valid' && old.batch.batchId !== batch.batchId)
    )
      return false;
    globalThis.localStorage.setItem(key(batch.identity), JSON.stringify(batch));
    return true;
  } catch {
    return false;
  }
}
/** 本地记录已无法核对时按身份直接清除，避免列表长期停在只读提示。 */
export function discardLawyerAssignmentBatch(identity: string): boolean {
  try {
    globalThis.localStorage.removeItem(key(identity));
    return true;
  } catch {
    return false;
  }
}
export function clearLawyerAssignmentBatch(
  batch: LawyerAssignmentBatch,
): boolean {
  try {
    const old = readLawyerAssignmentBatch(batch.identity);
    if (old.state !== 'valid' || old.batch.batchId !== batch.batchId)
      return false;
    globalThis.localStorage.removeItem(key(batch.identity));
    return true;
  } catch {
    return false;
  }
}
