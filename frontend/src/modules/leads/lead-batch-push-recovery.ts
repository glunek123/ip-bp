import type { LeadBatchPushItem } from '../../api/leads';

export type FrozenLeadBatchPush = {
  identity: string;
  idempotencyKey: string;
  items: LeadBatchPushItem[];
  uncertain?: boolean;
};

const storageKey = 'lead-batch-push-pending-v1';

function stableIdentity(identity: string): string | null {
  const match = /^([^:]+):([^:]+):([^:]+)(?::[^:]*)?$/u.exec(identity);
  return match ? `${match[1]}:${match[2]}:${match[3]}` : null;
}

function isFrozenAttempt(
  value: unknown,
  storageIdentity: string,
): value is FrozenLeadBatchPush {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const attempt = value as Record<string, unknown>;
  if (
    attempt.identity !== storageIdentity ||
    typeof attempt.idempotencyKey !== 'string' ||
    attempt.idempotencyKey.length < 1 ||
    attempt.idempotencyKey.length > 128 ||
    !Array.isArray(attempt.items) ||
    attempt.items.length < 1 ||
    attempt.items.length > 20 ||
    (attempt.uncertain !== undefined && typeof attempt.uncertain !== 'boolean')
  )
    return false;
  const normalized = new Set<string>();
  for (const entry of attempt.items) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      return false;
    const item = entry as Record<string, unknown>;
    if (
      Object.keys(item).length !== 2 ||
      typeof item.leadId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
        item.leadId,
      ) ||
      !Number.isSafeInteger(item.expectedVersion) ||
      (item.expectedVersion as number) < 1
    )
      return false;
    const id = item.leadId.toLowerCase();
    if (normalized.has(id)) return false;
    normalized.add(id);
  }
  return true;
}

export function readPendingLeadBatchPush(): Record<
  string,
  FrozenLeadBatchPush
> | null {
  try {
    const raw = globalThis.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return null;
    const pending: Record<string, FrozenLeadBatchPush> = {};
    for (const [identity, value] of Object.entries(parsed)) {
      if (!isFrozenAttempt(value, identity)) return null;
      const stable = stableIdentity(identity);
      if (!stable) return null;
      const normalized =
        stable === identity
          ? value
          : { ...value, identity: stable, uncertain: true };
      const existing = pending[stable];
      if (
        existing &&
        (existing.idempotencyKey !== normalized.idempotencyKey ||
          JSON.stringify(existing.items) !== JSON.stringify(normalized.items))
      )
        return null;
      pending[stable] = normalized;
    }
    return pending;
  } catch {
    return null;
  }
}

export function savePendingLeadBatchPush(
  value: Record<string, FrozenLeadBatchPush>,
): boolean {
  try {
    if (
      !Object.entries(value).every(([identity, attempt]) =>
        isFrozenAttempt(attempt, identity),
      )
    )
      return false;
    globalThis.localStorage.setItem(storageKey, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingLeadBatchPush(
  attempt: FrozenLeadBatchPush,
): boolean {
  const pending = readPendingLeadBatchPush();
  if (pending === null) return false;
  const current = pending[attempt.identity];
  if (!current || !sameLeadBatchPush(current, attempt)) return false;
  delete pending[attempt.identity];
  return savePendingLeadBatchPush(pending);
}

export function sameLeadBatchPush(
  a: FrozenLeadBatchPush,
  b: FrozenLeadBatchPush,
): boolean {
  return (
    a.identity === b.identity &&
    a.idempotencyKey === b.idempotencyKey &&
    JSON.stringify(a.items) === JSON.stringify(b.items)
  );
}
