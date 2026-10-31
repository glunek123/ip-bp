import {
  CaseRefundInventoryDraftService,
  planRefundInventoryDraft,
  reviewRefundInventoryDraft,
  type RefundInventoryDraftTransaction,
  type RefundInventoryItem,
  type RefundInventorySnapshot,
} from './case-refund-inventory-draft.service';

const item: RefundInventoryItem = {
  itemId: 'item-1',
  party: 'COURT',
  status: 'SETTLED',
  description: '一审退费',
  amount: '800.00',
};
const complete: RefundInventorySnapshot = {
  id: 'version-1',
  caseId: 'case-1',
  departmentId: 'department-1',
  revision: 1,
  declaration: 'COMPLETE',
  items: [item],
};

describe('refund inventory unregistered coordination draft', () => {
  it('appends a new snapshot and audit in the transaction without changing the old snapshot', async () => {
    const order: string[] = [];
    const tx: RefundInventoryDraftTransaction = {
      authorizeInternalOperatorAndLockCase: async () => {
        order.push('authorize');
      },
      latest: async () => {
        order.push('read');
        return complete;
      },
      audit: async (audit) => {
        order.push('audit');
        expect(audit.action).toBe('CASE_REFUND_INVENTORY_RECORD');
      },
      append: async (snapshot) => {
        order.push('append');
        expect(snapshot.priorVersionId).toBe(complete.id);
        expect(snapshot.revision).toBe(2);
        expect(snapshot.declaration).toBe('COMPLETE');
        expect(snapshot.recordedByUserId).toBe('actor');
        expect(snapshot.auditEventId).toBeTruthy();
      },
    };
    const service = new CaseRefundInventoryDraftService({
      serializable: async (work) => work(tx),
    });
    const result = await service.execute(
      {
        userId: 'actor',
        departmentId: complete.departmentId,
        authorizationRevision: 1,
      },
      {
        kind: 'RECORD',
        caseId: complete.caseId,
        expectedVersionId: complete.id,
        items: [{ ...item, status: 'RECEIVED' }],
      },
    );
    expect(order).toEqual(['authorize', 'read', 'audit', 'append']);
    expect(result.draft).toBe(true);
    expect(result.readiness).toBe('PASSED');
    expect(complete.items[0]?.status).toBe('SETTLED');
  });
  it('retains completeness for status-only changes and evaluates the latest state', () => {
    const planned = planRefundInventoryDraft(complete, {
      kind: 'RECORD',
      caseId: complete.caseId,
      expectedVersionId: complete.id,
      items: [{ ...item, status: 'RECEIVED' }],
    });
    expect(planned.declaration).toBe('COMPLETE');
    expect(reviewRefundInventoryDraft(complete)).toBe('BLOCKED');
    expect(reviewRefundInventoryDraft({ ...complete, ...planned })).toBe(
      'PASSED',
    );
    expect(complete.items[0]?.status).toBe('SETTLED');
  });

  it.each<{ items: RefundInventoryItem[] }>([
    { items: [] },
    { items: [item, { ...item, itemId: 'item-2' }] },
    { items: [{ ...item, party: 'DEFENDANT' }] },
    { items: [{ ...item, description: '另一项退费' }] },
    { items: [{ ...item, itemId: 'replacement' }] },
  ])('invalidates completeness after item scope changes: %j', ({ items }) => {
    expect(
      planRefundInventoryDraft(complete, {
        kind: 'RECORD',
        caseId: complete.caseId,
        expectedVersionId: complete.id,
        items,
      }).declaration,
    ).toBe('UNKNOWN');
  });

  it('does not treat received items as proof that the inventory is complete', () => {
    const snapshot = {
      ...complete,
      declaration: 'UNKNOWN' as const,
      items: [{ ...item, status: 'RECEIVED' as const }],
    };
    expect(reviewRefundInventoryDraft(snapshot)).toBe('UNKNOWN');
    const planned = planRefundInventoryDraft(snapshot, {
      kind: 'CONFIRM_COMPLETE',
      caseId: snapshot.caseId,
      expectedVersionId: snapshot.id,
    });
    expect(reviewRefundInventoryDraft({ ...snapshot, ...planned })).toBe(
      'PASSED',
    );
  });

  it('allows defendant cost conversion and rejects court cost conversion', () => {
    const defendant: RefundInventoryItem = {
      ...item,
      party: 'DEFENDANT',
      status: 'CONVERTED_TO_COST',
    };
    expect(
      reviewRefundInventoryDraft({ ...complete, items: [defendant] }),
    ).toBe('PASSED');
    expect(() =>
      reviewRefundInventoryDraft({
        ...complete,
        items: [{ ...defendant, party: 'COURT' }],
      }),
    ).toThrow('COURT_REFUND_CANNOT_CONVERT_TO_COST');
  });

  it('requires an explicit empty not-applicable declaration', () => {
    expect(reviewRefundInventoryDraft(null)).toBe('UNKNOWN');
    expect(
      reviewRefundInventoryDraft({
        ...complete,
        declaration: 'UNKNOWN',
        items: [],
      }),
    ).toBe('UNKNOWN');
    expect(() =>
      planRefundInventoryDraft(complete, {
        kind: 'DECLARE_NOT_APPLICABLE',
        caseId: complete.caseId,
        expectedVersionId: complete.id,
        items: [item],
      }),
    ).toThrow('REFUND_NOT_APPLICABLE_REQUIRES_EMPTY_INVENTORY');
    const planned = planRefundInventoryDraft(complete, {
      kind: 'DECLARE_NOT_APPLICABLE',
      caseId: complete.caseId,
      expectedVersionId: complete.id,
      items: [],
    });
    expect(reviewRefundInventoryDraft({ ...complete, ...planned })).toBe(
      'PASSED',
    );
    expect(() =>
      planRefundInventoryDraft(
        { ...complete, declaration: 'UNKNOWN', items: [] },
        {
          kind: 'CONFIRM_COMPLETE',
          caseId: complete.caseId,
          expectedVersionId: complete.id,
        },
      ),
    ).toThrow('REFUND_INVENTORY_NOT_CONFIRMABLE');
  });

  it('blocks stale versions, duplicated items and unresolved item statuses', () => {
    expect(() =>
      planRefundInventoryDraft(complete, {
        kind: 'RECORD',
        caseId: complete.caseId,
        expectedVersionId: 'stale',
        items: [item],
      }),
    ).toThrow('REFUND_INVENTORY_CHANGED');
    expect(() =>
      planRefundInventoryDraft(complete, {
        kind: 'RECORD',
        caseId: complete.caseId,
        expectedVersionId: complete.id,
        items: [item, item],
      }),
    ).toThrow('INVALID_REFUND_ITEM_ID');
    expect(
      reviewRefundInventoryDraft({
        ...complete,
        items: [{ ...item, status: 'UNKNOWN' }],
      }),
    ).toBe('UNKNOWN');
  });

  it('authorizes and locks before reading or persisting any snapshot', async () => {
    const tx: RefundInventoryDraftTransaction = {
      authorizeInternalOperatorAndLockCase: jest
        .fn()
        .mockRejectedValue(new Error('FORBIDDEN')),
      latest: jest.fn(),
      audit: jest.fn(),
      append: jest.fn(),
    };
    const service = new CaseRefundInventoryDraftService({
      serializable: async (work) => work(tx),
    });
    await expect(
      service.execute(
        {
          userId: 'actor',
          departmentId: complete.departmentId,
          authorizationRevision: 1,
        },
        {
          kind: 'RECORD',
          caseId: complete.caseId,
          expectedVersionId: complete.id,
          items: [item],
        },
      ),
    ).rejects.toThrow('FORBIDDEN');
    expect(tx.latest).not.toHaveBeenCalled();
    expect(tx.audit).not.toHaveBeenCalled();
    expect(tx.append).not.toHaveBeenCalled();
  });
});

it('keeps legacy missing amount unknown and confirms explicit zero without fictional receipt', () => {
  expect(
    reviewRefundInventoryDraft({
      ...complete,
      items: [{ ...item, amount: undefined, status: 'RECEIVED' }],
    }),
  ).toBe('UNKNOWN');
  expect(
    reviewRefundInventoryDraft({
      ...complete,
      items: [{ ...item, amount: '0.00', status: 'PENDING' }],
    }),
  ).toBe('PASSED');
  expect(
    reviewRefundInventoryDraft({
      ...complete,
      items: [{ ...item, amount: '0.01', status: 'PENDING' }],
    }),
  ).toBe('BLOCKED');
  expect(
    planRefundInventoryDraft(complete, {
      caseId: 'case-1',
      expectedVersionId: 'version-1',
      kind: 'RECORD',
      items: [{ ...item, amount: '12.34' }],
    }).declaration,
  ).toBe('UNKNOWN');
  expect(item.amount).toBe('800.00');
});
