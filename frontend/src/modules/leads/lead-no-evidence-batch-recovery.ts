import {
  isLeadNoEvidenceBatchInput,
  type LeadNoEvidenceBatchInput,
} from '../../api/lead-no-evidence-batch';

export type FrozenLeadNoEvidenceBatch = {
  identity: string;
  idempotencyKey: string;
  input: LeadNoEvidenceBatchInput;
};
const storageKey = 'lead-no-evidence-batch-pending-v1';
function valid(
  value: unknown,
  identity: string,
): value is FrozenLeadNoEvidenceBatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    /^[^:]+:INTERNAL:[^:]+$/u.test(identity) &&
    Object.keys(candidate).length === 3 &&
    candidate.identity === identity &&
    typeof candidate.idempotencyKey === 'string' &&
    candidate.idempotencyKey.trim().length > 0 &&
    candidate.idempotencyKey.trim().length <= 128 &&
    !/[\r\n]/u.test(candidate.idempotencyKey) &&
    isLeadNoEvidenceBatchInput(candidate.input)
  );
}
export function readPendingLeadNoEvidenceBatches(): Record<
  string,
  FrozenLeadNoEvidenceBatch
> | null {
  try {
    const raw = globalThis.localStorage.getItem(storageKey);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return null;
    if (
      !Object.entries(parsed).every(([identity, attempt]) =>
        valid(attempt, identity),
      )
    )
      return null;
    return parsed as Record<string, FrozenLeadNoEvidenceBatch>;
  } catch {
    return null;
  }
}
export function savePendingLeadNoEvidenceBatches(
  value: Record<string, FrozenLeadNoEvidenceBatch>,
): boolean {
  try {
    if (
      !Object.entries(value).every(([identity, attempt]) =>
        valid(attempt, identity),
      )
    )
      return false;
    globalThis.localStorage.setItem(storageKey, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function sameLeadNoEvidenceBatch(
  a: FrozenLeadNoEvidenceBatch,
  b: FrozenLeadNoEvidenceBatch,
): boolean {
  return (
    a.identity === b.identity &&
    a.idempotencyKey === b.idempotencyKey &&
    JSON.stringify(a.input) === JSON.stringify(b.input)
  );
}
export function clearPendingLeadNoEvidenceBatch(
  attempt: FrozenLeadNoEvidenceBatch,
): boolean {
  const stored = readPendingLeadNoEvidenceBatches();
  if (
    !stored ||
    !stored[attempt.identity] ||
    !sameLeadNoEvidenceBatch(stored[attempt.identity]!, attempt)
  )
    return false;
  delete stored[attempt.identity];
  return savePendingLeadNoEvidenceBatches(stored);
}
