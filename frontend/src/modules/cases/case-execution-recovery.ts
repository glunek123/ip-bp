import type { SubmitExecutionInput } from '../../api/cases';

export type ExecutionRecoveryIdentity = { actor: string; caseId: string };
type StoredExecutionCommand = {
  input: SubmitExecutionInput;
  status: 'sending' | 'unknown' | 'confirmed' | 'rejected';
  attempts: Set<symbol>;
};
type ExecutionUploadMarker = ExecutionRecoveryIdentity & { token: string };

const commands = new Map<string, StoredExecutionCommand>();
const unclearedUploads = new Set<string>();
const identityKey = ({ actor, caseId }: ExecutionRecoveryIdentity) =>
  `${actor}:${caseId}`;
const storageKey = ({ actor, caseId }: ExecutionRecoveryIdentity) =>
  `case-execution-upload:${encodeURIComponent(actor)}:${encodeURIComponent(caseId)}`;

export function pendingExecutionCommand(identity: ExecutionRecoveryIdentity) {
  const stored = commands.get(identityKey(identity));
  return stored?.status === 'sending' || stored?.status === 'unknown'
    ? stored.input
    : null;
}

export function beginExecutionCommand(
  identity: ExecutionRecoveryIdentity,
  input: SubmitExecutionInput,
) {
  const key = identityKey(identity);
  let stored = commands.get(key);
  if (stored && stored.input.idempotencyKey !== input.idempotencyKey) {
    if (stored.status === 'sending' || stored.status === 'unknown')
      throw new Error('原执行提交请求仍待核对');
    stored = undefined;
  }
  stored ??= { input, status: 'sending', attempts: new Set() };
  stored.status = 'sending';
  const attempt = Symbol();
  stored.attempts.add(attempt);
  commands.set(key, stored);
  return { input: stored.input, attempt };
}

export function settleExecutionCommand(
  identity: ExecutionRecoveryIdentity,
  attempt: symbol,
  outcome: 'confirmed' | 'unknown' | 'rejected',
) {
  const stored = commands.get(identityKey(identity));
  if (!stored || !stored.attempts.delete(attempt)) return;
  if (outcome === 'confirmed') stored.status = 'confirmed';
  else if (stored.status !== 'confirmed') {
    stored.status =
      stored.attempts.size > 0
        ? 'sending'
        : outcome === 'unknown'
          ? 'unknown'
          : 'rejected';
  }
}

export function clearExecutionCommand(identity: ExecutionRecoveryIdentity) {
  commands.delete(identityKey(identity));
}

export function beginExecutionUpload(
  identity: ExecutionRecoveryIdentity,
): ExecutionUploadMarker {
  const marker = { ...identity, token: globalThis.crypto.randomUUID() };
  const key = storageKey(identity);
  try {
    globalThis.sessionStorage.setItem(key, JSON.stringify(marker));
    unclearedUploads.delete(key);
  } catch (error) {
    unclearedUploads.add(key);
    throw error;
  }
  return marker;
}

export function readExecutionUpload(
  identity: ExecutionRecoveryIdentity,
): ExecutionUploadMarker | null {
  const key = storageKey(identity);
  try {
    const raw = globalThis.sessionStorage.getItem(key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      !('actor' in value) ||
      value.actor !== identity.actor ||
      !('caseId' in value) ||
      value.caseId !== identity.caseId ||
      !('token' in value) ||
      typeof value.token !== 'string'
    ) {
      unclearedUploads.add(key);
      return null;
    }
    return value as ExecutionUploadMarker;
  } catch {
    unclearedUploads.add(key);
    return null;
  }
}

export function hasUnclearedExecutionUpload(
  identity: ExecutionRecoveryIdentity,
) {
  return unclearedUploads.has(storageKey(identity));
}

export function clearExecutionUpload(marker: ExecutionUploadMarker) {
  const key = storageKey(marker);
  try {
    const current = readExecutionUpload(marker);
    if (current?.token !== marker.token) {
      if (unclearedUploads.has(key)) throw new Error('恢复标记不可读取');
      return;
    }
    globalThis.sessionStorage.removeItem(key);
    unclearedUploads.delete(key);
  } catch (error) {
    unclearedUploads.add(key);
    throw error;
  }
}
