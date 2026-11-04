import { createHash } from 'node:crypto';
import type { AccessControlSnapshot } from '../../access-control/access-control.service';
import { AccessControlService } from '../../access-control/access-control.service';
import { Prisma } from '../../generated/prisma/client';
import { OrganizationService } from '../../access-control/organization.service';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CaseRefundInventoryPrismaDraft,
  normalizeRefundDraftCommand,
  validateRefundSnapshotInTransaction,
  createRefundCompositionContext,
} from './case-refund-inventory-prisma-draft';

const source = readFileSync(
  resolve(
    process.cwd(),
    'src/modules/cases/case-refund-inventory-prisma-draft.ts',
  ),
  'utf8',
);
describe('unregistered refund Prisma transaction draft static boundaries', () => {
  it('limits nonowner refund work to a verified parent composition and department grant', async () => {
    const actor = {
      userId: 'aaaaaaaa-0000-0000-0000-000000000001',
      departmentId: 'aaaaaaaa-0000-0000-0000-000000000002',
      authorizationRevision: 1,
    };
    const caseId = 'aaaaaaaa-0000-0000-0000-000000000004';
    const command = {
      kind: 'CONFIRM_COMPLETE' as const,
      caseId,
      expectedVersionId: 'aaaaaaaa-0000-0000-0000-000000000005',
    };
    const grants: AccessControlSnapshot['grants'] = [
      { action: 'case.read', scope: 'department' },
      { action: 'case.closure.settlement.update', scope: 'department' },
    ];
    const access = new AccessControlService({
      loadSnapshot: jest.fn().mockImplementation(async () => ({
        active: true,
        authorizationRevision: 1,
        membershipTeamId: null,
        membershipTeamActive: false,
        grants,
      })),
    });
    const receiptReached = new Error('RECEIPT_LOOKUP');
    const query = jest
      .fn()
      .mockImplementation((parts: TemplateStringsArray) => {
        const sql = parts.join('');
        if (sql.includes('FROM case_refund_inventory_receipts'))
          throw receiptReached;
        if (sql.includes('SELECT active,account_type'))
          return [
            {
              active: true,
              account_type: 'INTERNAL',
              authorization_revision: 1,
            },
          ];
        if (sql.includes('SELECT m.active'))
          return [{ active: true, team_id: null }];
        if (sql.includes('SELECT id,responsible_user_id FROM cases'))
          return [{ id: caseId, responsible_user_id: 'other-owner' }];
        return [];
      });
    const db = { $queryRaw: query } as unknown as Prisma.TransactionClient;
    const adapter = new CaseRefundInventoryPrismaDraft(
      { $transaction: jest.fn() },
      { lockDepartment: jest.fn() } as unknown as OrganizationService,
      access,
    );
    const parent = createRefundCompositionContext(db, {
      fingerprint: 'a'.repeat(64),
      idempotencyKey: 'parent-key',
      caseId,
      actorUserId: actor.userId,
      departmentId: actor.departmentId,
    });
    await expect(
      adapter.executeInTransaction(db, actor, command, 'child'),
    ).rejects.not.toBe(receiptReached);
    await expect(
      adapter.executeInTransaction(
        db,
        actor,
        command,
        parent.idempotencyKey,
        parent.context,
      ),
    ).rejects.toBe(receiptReached);
    grants.pop();
    await expect(
      adapter.executeInTransaction(
        db,
        actor,
        command,
        parent.idempotencyKey,
        parent.context,
      ),
    ).rejects.not.toBe(receiptReached);
  });
  it.each(['self', 'team', 'department', 'revoked'] as const)(
    'checks current %s case scope before looking up an old key',
    async (scope) => {
      const actor = {
        userId: 'aaaaaaaa-0000-0000-0000-000000000001',
        departmentId: 'aaaaaaaa-0000-0000-0000-000000000002',
        authorizationRevision: 1,
      };
      const teamId = 'aaaaaaaa-0000-0000-0000-000000000003';
      const snapshot: AccessControlSnapshot = {
        active: true,
        authorizationRevision: 1,
        membershipTeamId: teamId,
        membershipTeamActive: true,
        grants:
          scope === 'revoked'
            ? []
            : [
                {
                  action: 'case.read',
                  scope,
                  ...(scope === 'team' ? { teamId } : {}),
                },
              ],
      };
      const access = new AccessControlService({
        loadSnapshot: jest.fn().mockResolvedValue(snapshot),
      });
      const receiptReached = new Error('RECEIPT_LOOKUP');
      const query = jest
        .fn()
        .mockImplementation((parts: TemplateStringsArray) => {
          const sql = parts.join('');
          if (sql.includes('FROM case_refund_inventory_receipts'))
            throw receiptReached;
          if (sql.includes('SELECT active,account_type'))
            return [
              {
                active: true,
                account_type: 'INTERNAL',
                authorization_revision: 1,
              },
            ];
          if (sql.includes('SELECT m.active'))
            return [{ active: true, team_id: teamId }];
          if (sql.includes('SELECT id,responsible_user_id FROM cases'))
            return [{ id: 'case', responsible_user_id: actor.userId }];
          return [];
        });
      const db = { $queryRaw: query } as unknown as Prisma.TransactionClient;
      const adapter = new CaseRefundInventoryPrismaDraft(
        { $transaction: jest.fn() },
        { lockDepartment: jest.fn() } as unknown as OrganizationService,
        access,
      );
      const promise = adapter.executeInTransaction(
        db,
        actor,
        {
          kind: 'CONFIRM_COMPLETE',
          caseId: 'aaaaaaaa-0000-0000-0000-000000000004',
          expectedVersionId: 'aaaaaaaa-0000-0000-0000-000000000005',
        },
        'old-key',
      );
      if (scope === 'revoked') {
        await expect(promise).rejects.not.toBe(receiptReached);
        expect(
          query.mock.calls.some(([parts]) =>
            parts.join('').includes('FROM case_refund_inventory_receipts'),
          ),
        ).toBe(false);
      } else await expect(promise).rejects.toBe(receiptReached);
    },
  );
  it('retries only recognized lock contention at most three times and keeps authorization before case locks', async () => {
    const busy = new Prisma.PrismaClientKnownRequestError('busy', {
      code: 'P2010',
      clientVersion: 'test',
      meta: { code: '55P03' },
    });
    const transaction = jest.fn().mockRejectedValue(busy);
    const adapter = new CaseRefundInventoryPrismaDraft(
      { $transaction: transaction },
      { lockDepartment: jest.fn() } as unknown as OrganizationService,
      { authorizeCase: jest.fn() } as unknown as AccessControlService,
    );
    const actor = {
      userId: 'actor',
      departmentId: 'department',
      authorizationRevision: 1,
    };
    const command = {
      kind: 'CONFIRM_COMPLETE' as const,
      caseId: 'case',
      expectedVersionId: 'version',
    };
    await expect(adapter.execute(actor, command, 'key')).rejects.toBe(busy);
    expect(transaction).toHaveBeenCalledTimes(3);
    transaction.mockClear().mockRejectedValue(new Error('55P03'));
    await expect(adapter.execute(actor, command, 'key')).rejects.toThrow(
      '55P03',
    );
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(
      source.indexOf(
        'await lockCustomerActorFacts(db, this.organization, actor)',
      ),
    ).toBeLessThan(
      source.indexOf('SELECT active,account_type,authorization_revision'),
    );
  });
  it('creates stable internal child keys and rejects malformed total fingerprints', () => {
    const factory = jest.fn().mockImplementation((db) =>
      createRefundCompositionContext(db, {
        fingerprint: 'a'.repeat(64),
        idempotencyKey: 'parent',
        caseId: 'CASE',
        actorUserId: 'ACTOR',
        departmentId: 'DEPARTMENT',
      }),
    );
    expect(factory({}).idempotencyKey).toBe(factory({}).idempotencyKey);
    const invalid = jest.fn().mockImplementation((db) =>
      createRefundCompositionContext(db, {
        fingerprint: 'untrusted',
        idempotencyKey: 'parent',
        caseId: 'case',
        actorUserId: 'actor',
        departmentId: 'department',
      }),
    );
    expect(() => invalid({})).toThrow('INVALID_REFUND_COMPOSITION_CONTEXT');
    expect(source).toContain('compositionTokens.get(compositionContext)');
    expect(source).toContain('composition.db !== db');
    expect(source).toContain('composition?.fingerprint ??');
    expect(source).toContain('INSERT INTO case_settlement_update_child_links');
    expect(source).toContain('await bindParent(snapshot.id, true)');
    expect(source).toContain("fail('INVALID_REFUND_COMPOSITION_BINDING')");
    expect(source).toContain(".update(parent.idempotencyKey, 'utf8')");
  });
  it('casts validation void to text and propagates validation failure unchanged', async () => {
    const failure = new Error('INVENTORY_INVALID');
    const query = jest.fn().mockRejectedValue(failure);
    await expect(
      validateRefundSnapshotInTransaction({ $queryRaw: query }, 'version'),
    ).rejects.toBe(failure);
    expect(query).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining('::text AS validated')]),
      'version',
    );
    expect(source).toContain(
      'await validateRefundSnapshotInTransaction(db, s.id)',
    );
  });
  it('delegates standalone execution to the same transaction entry and propagates composition failures', async () => {
    const token = { transaction: 'existing' };
    const transaction = jest.fn().mockImplementation((work) => work(token));
    const adapter = new CaseRefundInventoryPrismaDraft(
      {
        $transaction: transaction,
      },
      { lockDepartment: jest.fn() } as unknown as OrganizationService,
      { authorizeCase: jest.fn() } as unknown as AccessControlService,
    );
    const failure = new Error('COMPOSED_WRITE_FAILED');
    const entry = jest
      .spyOn(adapter, 'executeInTransaction')
      .mockRejectedValue(failure);
    const actor = {
      userId: 'actor',
      departmentId: 'department',
      authorizationRevision: 1,
    };
    const command = {
      kind: 'CONFIRM_COMPLETE' as const,
      caseId: 'case',
      expectedVersionId: 'version',
    };
    await expect(adapter.execute(actor, command, 'key')).rejects.toBe(failure);
    expect(entry).toHaveBeenCalledWith(token, actor, command, 'key');
    expect(transaction).toHaveBeenCalledTimes(1);
    const inner = source.slice(source.indexOf('async executeInTransaction('));
    expect(inner).not.toContain('$transaction(');
    expect(inner).not.toContain('SET CONSTRAINTS ALL');
    expect(inner).toContain('await authorize();');
  });
  it('groups replay snapshot extraction before removing items', () => {
    expect(source).toContain(
      "((r.result_snapshot->'snapshot') - 'items')=jsonb_build_object(",
    );
    expect(source).not.toContain("r.result_snapshot->'snapshot'-'items'");
  });
  it('canonicalizes first write and replay identically and rejects case-only duplicate items', () => {
    const command = {
      kind: 'RECORD' as const,
      caseId: 'ABCDEFAB-0000-0000-0000-000000000001',
      expectedVersionId: 'ABCDEFAB-0000-0000-0000-000000000002',
      items: [
        {
          itemId: 'ABCDEFAB-0000-0000-0000-000000000003',
          party: 'COURT' as const,
          status: 'UNKNOWN' as const,
          description: '退费',
        },
      ],
    };
    const normalized = normalizeRefundDraftCommand(command);
    expect(normalized.caseId).toBe(command.caseId.toLowerCase());
    expect(normalized.expectedVersionId).toBe(
      command.expectedVersionId.toLowerCase(),
    );
    expect(normalizeRefundDraftCommand(normalized)).toEqual(normalized);
    expect(() =>
      normalizeRefundDraftCommand({
        ...command,
        items: [
          command.items[0]!,
          {
            ...command.items[0]!,
            itemId: command.items[0]!.itemId.toLowerCase(),
          },
        ],
      }),
    ).toThrow('INVALID_REFUND_ITEM_ID');
  });
  it('locks current actor, membership and own case before receipt replay', () => {
    expect(source).toContain(
      'user.authorization_revision !== actor.authorizationRevision',
    );
    expect(source).toContain("user.account_type !== 'INTERNAL'");
    expect(source).toContain("if (!composition) fail('ACTION_FORBIDDEN')");
    expect(source.indexOf('await authorize();')).toBeLessThan(
      source.indexOf('const receipts ='),
    );
    expect(source.indexOf('const receipts =')).toBeLessThan(
      source.indexOf("cases?.stage !== 'WAITING_ARCHIVE'"),
    );
    expect(source).not.toContain('case.refund.application.record');
  });
  it('uses one serializable transaction for audit, full snapshot, sealed receipt and bounded retry', () => {
    expect(source).toContain('Prisma.TransactionIsolationLevel.Serializable');
    expect(source).toContain('requestFingerprint: fingerprint');
    expect(source).toContain('new CaseRefundInventoryDraftService');
    expect(source).toContain('INSERT INTO case_refund_inventory_receipts');
    expect(source).toContain('clock_timestamp()');
    expect(source).toContain('attempt < 2');
    expect(source).not.toContain('$queryRawUnsafe');
    expect(source).not.toContain('$executeRawUnsafe');
  });
  it('strictly decodes snapshots and recomputes receipt readiness without registering an API', () => {
    expect(source).toContain('decodeSnapshot(result.snapshot)');
    expect(source).toContain('result.readiness !== receiptReadiness');
    expect(source).toContain("fail('IDEMPOTENCY_CONFLICT')");
    expect(source).not.toContain('@Injectable');
    expect(source).not.toContain('@Controller');
  });
});

it('canonicalizes refund cents without turning omitted amounts into zero during legacy identity extraction', () => {
  const b = {
    caseId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
    expectedVersionId: null,
    kind: 'RECORD' as const,
    items: [
      {
        itemId: 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB',
        party: 'COURT' as const,
        status: 'PENDING' as const,
        description: '退费',
        amount: '12.3',
      },
    ],
  };
  expect(normalizeRefundDraftCommand(b)).toMatchObject({
    items: [{ amount: '12.30' }],
  });
  expect(() =>
    normalizeRefundDraftCommand({
      ...b,
      items: [{ ...b.items[0]!, amount: '-0.01' }],
    }),
  ).toThrow('INVALID_REFUND_AMOUNT');
  expect(source).toContain('INSERT INTO case_refund_inventory_item_amounts');
  expect(source).toContain("'refund-item-amounts-v1'");
});

function amountAdapterFixture(
  receipt?: { request_fingerprint: string; result_snapshot: unknown },
  sidecarAbsent = true,
) {
  const actor = {
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    departmentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    authorizationRevision: 1,
  };
  const query = jest.fn(async (parts: TemplateStringsArray) => {
    const sql = parts.join('');
    if (sql.includes('SELECT active,account_type'))
      return [
        { active: true, account_type: 'INTERNAL', authorization_revision: 1 },
      ];
    if (sql.includes('SELECT m.active'))
      return [{ active: true, team_id: null }];
    if (sql.includes('SELECT id,responsible_user_id FROM cases'))
      return [{ id: 'case', responsible_user_id: actor.userId }];
    if (sql.includes('SELECT clock_timestamp'))
      return [{ recorded_at: new Date('2026-10-31T00:00:00.000Z') }];
    if (
      sql.includes('FROM case_refund_inventory_receipts r') &&
      sql.includes(
        'NOT EXISTS(SELECT 1 FROM case_refund_inventory_item_amounts',
      )
    )
      return sidecarAbsent ? [{ valid: true }] : [];
    if (sql.includes('FROM case_refund_inventory_receipts r JOIN'))
      return [{ valid: true }];
    if (sql.includes('FROM case_refund_inventory_receipts'))
      return receipt ? [receipt] : [];
    return [];
  });
  const db = {
    $queryRaw: query,
    $executeRaw: jest.fn(
      async (_parts: TemplateStringsArray, ..._values: unknown[]) => {
        void _parts;
        void _values;
        return 1;
      },
    ),
    case: { findUnique: jest.fn(async () => ({ stage: 'WAITING_ARCHIVE' })) },
    auditEvent: { create: jest.fn(async () => ({})) },
  };
  const adapter = new CaseRefundInventoryPrismaDraft(
    { $transaction: jest.fn() },
    { lockDepartment: jest.fn() } as unknown as OrganizationService,
    { authorizeCase: jest.fn() } as unknown as AccessControlService,
  );
  return { actor, db, adapter };
}
it('every new missing amount is persisted as NULL sidecar and explicit NULL result, not pseudo legacy', async () => {
  const f = amountAdapterFixture(),
    command = {
      caseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      expectedVersionId: null,
      kind: 'RECORD' as const,
      items: [
        {
          itemId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          party: 'COURT' as const,
          status: 'RECEIVED' as const,
          description: '退费',
        },
      ],
    };
  const result = await f.adapter.executeInTransaction(
    f.db as unknown as Prisma.TransactionClient,
    f.actor,
    command,
    'new-key',
  );
  expect(result.snapshot.items[0]).toHaveProperty('amount', null);
  expect(result.readiness).toBe('UNKNOWN');
  const sidecar = f.db.$executeRaw.mock.calls.find((call) =>
    String(call[0]).includes('case_refund_inventory_item_amounts'),
  );
  expect(sidecar).toBeDefined();
});

it('only existing no-sidecar legacy receipt replays exact original amountless body/key without adding fields', async () => {
  const caseId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    prior = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    item = {
      itemId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      party: 'COURT' as const,
      status: 'RECEIVED' as const,
      description: '退费',
    },
    command = {
      caseId,
      expectedVersionId: prior,
      kind: 'RECORD' as const,
      items: [item],
    },
    fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          caseId,
          prior,
          'RECORD',
          [[item.itemId, item.party, item.status, item.description]],
        ]),
      )
      .digest('hex'),
    old = {
      draft: true,
      snapshot: {
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        caseId,
        departmentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        revision: 2,
        declaration: 'COMPLETE',
        items: [item],
      },
      readiness: 'PASSED',
    };
  const f = amountAdapterFixture({
    request_fingerprint: fingerprint,
    result_snapshot: old,
  });
  const before = JSON.stringify(old);
  expect(
    await f.adapter.executeInTransaction(
      f.db as unknown as Prisma.TransactionClient,
      f.actor,
      command,
      'old-key',
    ),
  ).toEqual(old);
  expect(JSON.stringify(old)).toBe(before);
  expect(f.db.$executeRaw).not.toHaveBeenCalled();
  await expect(
    f.adapter.executeInTransaction(
      f.db as unknown as Prisma.TransactionClient,
      f.actor,
      { ...command, items: [{ ...item, amount: null }] },
      'old-key',
    ),
  ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  const sealed = amountAdapterFixture(
    { request_fingerprint: fingerprint, result_snapshot: old },
    false,
  );
  await expect(
    sealed.adapter.executeInTransaction(
      sealed.db as unknown as Prisma.TransactionClient,
      sealed.actor,
      command,
      'old-key',
    ),
  ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
});
