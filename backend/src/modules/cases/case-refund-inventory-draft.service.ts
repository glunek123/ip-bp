import { randomUUID } from 'node:crypto';
import type { ActorContext } from '../../access-control/actor-context';

export type RefundInventoryItem = {
  itemId: string;
  party: 'COURT' | 'DEFENDANT';
  status:
    | 'UNKNOWN'
    | 'PENDING'
    | 'SUBMITTED'
    | 'RETURNED_UNSETTLED'
    | 'SETTLED'
    | 'RECEIVED'
    | 'CONVERTED_TO_COST';
  description: string;
  /** Missing/null is unknown, including legacy records. Never inferred as zero. */
  amount?: string | null;
};
export type RefundInventorySnapshot = {
  id: string;
  caseId: string;
  departmentId: string;
  revision: number;
  declaration: 'UNKNOWN' | 'COMPLETE' | 'NOT_APPLICABLE';
  items: readonly RefundInventoryItem[];
};
export type RefundInventoryDraftCommand = {
  caseId: string;
  expectedVersionId: string | null;
} & (
  | { kind: 'RECORD'; items: readonly RefundInventoryItem[] }
  | { kind: 'CONFIRM_COMPLETE' }
  | { kind: 'DECLARE_NOT_APPLICABLE'; items: readonly RefundInventoryItem[] }
);

function reject(code: string): never {
  throw new Error(code);
}

export function normalizeRefundAmount(
  amount: string | null | undefined,
): string | null {
  if (amount === null || amount === undefined) return null;
  if (
    typeof amount !== 'string' ||
    !/^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/u.test(amount)
  )
    reject('INVALID_REFUND_AMOUNT');
  const [whole, fraction = ''] = amount.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

function validateItems(items: readonly RefundInventoryItem[]): void {
  const ids = new Set<string>();
  for (const item of items) {
    normalizeRefundAmount(item.amount);
    if (!item.itemId || ids.has(item.itemId)) reject('INVALID_REFUND_ITEM_ID');
    ids.add(item.itemId);
    if (item.party !== 'COURT' && item.party !== 'DEFENDANT')
      reject('INVALID_REFUND_PARTY');
    if (
      ![
        'UNKNOWN',
        'PENDING',
        'SUBMITTED',
        'RETURNED_UNSETTLED',
        'SETTLED',
        'RECEIVED',
        'CONVERTED_TO_COST',
      ].includes(item.status)
    )
      reject('INVALID_REFUND_STATUS');
    if (item.party === 'COURT' && item.status === 'CONVERTED_TO_COST')
      reject('COURT_REFUND_CANNOT_CONVERT_TO_COST');
    if (!item.description.trim() || item.description.length > 1000)
      reject('INVALID_REFUND_DESCRIPTION');
  }
}

/** Item identity, party and description define scope. Status is deliberately excluded. */
function sameScope(
  before: readonly RefundInventoryItem[],
  after: readonly RefundInventoryItem[],
): boolean {
  if (before.length !== after.length) return false;
  const previous = new Map(before.map((item) => [item.itemId, item]));
  return after.every((item) => {
    const prior = previous.get(item.itemId);
    return (
      prior?.party === item.party &&
      prior.description === item.description &&
      normalizeRefundAmount(prior.amount) === normalizeRefundAmount(item.amount)
    );
  });
}

/** Pure planning only: no authorization, persistence or successful command receipt. */
export function planRefundInventoryDraft(
  previous: RefundInventorySnapshot | null,
  command: RefundInventoryDraftCommand,
): {
  declaration: RefundInventorySnapshot['declaration'];
  items: RefundInventoryItem[];
} {
  if (
    (previous?.id ?? null) !== command.expectedVersionId ||
    (previous && previous.caseId !== command.caseId)
  )
    reject('REFUND_INVENTORY_CHANGED');
  if (previous) validateItems(previous.items);
  if (command.kind === 'CONFIRM_COMPLETE') {
    if (
      !previous ||
      previous.items.length === 0 ||
      previous.declaration !== 'UNKNOWN'
    )
      reject('REFUND_INVENTORY_NOT_CONFIRMABLE');
    return {
      declaration: 'COMPLETE',
      items: previous.items.map((item) => ({ ...item })),
    };
  }
  validateItems(command.items);
  if (command.kind === 'DECLARE_NOT_APPLICABLE') {
    if (command.items.length !== 0)
      reject('REFUND_NOT_APPLICABLE_REQUIRES_EMPTY_INVENTORY');
    return { declaration: 'NOT_APPLICABLE', items: [] };
  }
  if (command.kind !== 'RECORD') reject('INVALID_REFUND_COMMAND');
  return {
    declaration:
      previous?.declaration === 'COMPLETE' &&
      sameScope(previous.items, command.items)
        ? 'COMPLETE'
        : 'UNKNOWN',
    items: command.items.map((item) => ({ ...item })),
  };
}

export function reviewRefundInventoryDraft(
  snapshot: RefundInventorySnapshot | null,
): 'PASSED' | 'BLOCKED' | 'UNKNOWN' {
  if (!snapshot) return 'UNKNOWN';
  validateItems(snapshot.items);
  if (snapshot.declaration === 'NOT_APPLICABLE') {
    if (snapshot.items.length !== 0) reject('INVALID_REFUND_SNAPSHOT');
    return 'PASSED';
  }
  if (snapshot.declaration !== 'COMPLETE' || snapshot.items.length === 0)
    return 'UNKNOWN';
  const amounts = snapshot.items.map((item) =>
    normalizeRefundAmount(item.amount),
  );
  const received = (item: RefundInventoryItem) =>
    item.status === 'RECEIVED' ||
    (item.party === 'DEFENDANT' && item.status === 'CONVERTED_TO_COST');
  if (
    snapshot.items.some(
      (item, i) =>
        amounts[i] !== null &&
        amounts[i] !== '0.00' &&
        item.status !== 'UNKNOWN' &&
        !received(item),
    )
  )
    return 'BLOCKED';
  if (
    snapshot.items.some(
      (item, i) =>
        amounts[i] === null ||
        (amounts[i] !== '0.00' && item.status === 'UNKNOWN'),
    )
  )
    return 'UNKNOWN';
  return 'PASSED';
}
/** Historical receipt verification only. Current readiness must use amount-aware review above. */
export function reviewRefundInventoryLegacy(
  snapshot: RefundInventorySnapshot | null,
): 'PASSED' | 'BLOCKED' | 'UNKNOWN' {
  if (!snapshot) return 'UNKNOWN';
  validateItems(snapshot.items);
  if (snapshot.declaration === 'NOT_APPLICABLE') {
    if (snapshot.items.length !== 0) reject('INVALID_REFUND_SNAPSHOT');
    return 'PASSED';
  }
  if (snapshot.declaration !== 'COMPLETE' || snapshot.items.length === 0)
    return 'UNKNOWN';
  if (
    snapshot.items.some(
      (item) =>
        !['UNKNOWN', 'RECEIVED', 'CONVERTED_TO_COST'].includes(item.status),
    )
  )
    return 'BLOCKED';
  return snapshot.items.some((item) => item.status === 'UNKNOWN')
    ? 'UNKNOWN'
    : 'PASSED';
}

export interface RefundInventoryDraftTransaction {
  /** Must enforce real active INTERNAL operator, department and case handling scope,
   * lock authorization facts plus case and check WAITING_ARCHIVE. No boolean grant.
   * This interface has no implementation and is not proof of authorization. */
  authorizeInternalOperatorAndLockCase(
    actor: ActorContext,
    caseId: string,
  ): Promise<void>;
  latest(caseId: string): Promise<RefundInventorySnapshot | null>;
  audit(input: {
    id: string;
    actor: ActorContext;
    caseId: string;
    versionId: string;
    action: 'CASE_REFUND_INVENTORY_RECORD' | 'CASE_REFUND_INVENTORY_CONFIRM';
    recordedAt: Date;
  }): Promise<void>;
  /** Insert parent plus every item atomically; preserve all old rows. */
  append(
    snapshot: RefundInventorySnapshot & {
      priorVersionId: string | null;
      recordedByUserId: string;
      recordedAt: Date;
      auditEventId: string;
    },
  ): Promise<void>;
}
export interface RefundInventoryDraftStore {
  /** Required: one serializable transaction; rollback every failed operation. */
  serializable<T>(
    work: (tx: RefundInventoryDraftTransaction) => Promise<T>,
  ): Promise<T>;
}

/** UNREGISTERED DRAFT. No real transaction adapter, API or DB write enablement.
 * Command receipts/idempotency and archive atomic source validation remain unimplemented.
 * Returned readiness describes this draft snapshot, never a completed archive command.
 */
export class CaseRefundInventoryDraftService {
  constructor(private readonly store: RefundInventoryDraftStore) {}

  execute(actor: ActorContext, command: RefundInventoryDraftCommand) {
    return this.store.serializable(async (tx) => {
      await tx.authorizeInternalOperatorAndLockCase(actor, command.caseId);
      const previous = await tx.latest(command.caseId);
      if (previous && previous.departmentId !== actor.departmentId)
        reject('INVALID_REFUND_SNAPSHOT');
      const planned = planRefundInventoryDraft(previous, command);
      const id = randomUUID();
      const auditEventId = randomUUID();
      const recordedAt = new Date();
      const snapshot: RefundInventorySnapshot = {
        ...planned,
        id,
        caseId: command.caseId,
        departmentId: actor.departmentId,
        revision: (previous?.revision ?? 0) + 1,
      };
      await tx.audit({
        id: auditEventId,
        actor,
        caseId: command.caseId,
        versionId: id,
        recordedAt,
        action:
          command.kind === 'RECORD'
            ? 'CASE_REFUND_INVENTORY_RECORD'
            : 'CASE_REFUND_INVENTORY_CONFIRM',
      });
      await tx.append({
        ...snapshot,
        priorVersionId: previous?.id ?? null,
        recordedByUserId: actor.userId,
        recordedAt,
        auditEventId,
      });
      return {
        draft: true as const,
        snapshot,
        readiness: reviewRefundInventoryDraft(snapshot),
      };
    });
  }
}
