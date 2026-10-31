import type { DatabaseService } from '../../database/database.service';
import type { AccessControlService } from '../../access-control/access-control.service';
import type { OrganizationService } from '../../access-control/organization.service';
import type { MaterialService } from '../materials';
import { CasePaymentProofSupplementTransactionDraftService } from './case-payment-proof-supplement-transaction-draft.service';
import { lockCustomerActorFacts } from '../../access-control/customer-actor-facts-lock';
jest.mock('../../access-control/customer-actor-facts-lock', () => ({
  lockCustomerActorFacts: jest.fn(),
}));
const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 4,
};
const caseId = '33333333-3333-4333-8333-333333333333';
const closureId = '44444444-4444-4444-8444-444444444444';
const paymentId = '55555555-5555-4555-8555-555555555555';
const paymentVersionId = '66666666-6666-4666-8666-666666666666';
const image = '77777777-7777-4777-8777-777777777777';
const image2 = '88888888-8888-4888-8888-888888888888';
const now = new Date('2026-10-29T01:02:03.123Z');
const value = () => ({
  expectedClosureVersionId: closureId,
  paymentId,
  expectedPaymentVersionId: paymentVersionId,
  contentVersionIds: [image],
  idempotencyKey: 'proof-1',
});
function fixture() {
  const c = {
    responsibleUserId: actor.userId,
    responsibleMembership: { teamId: null },
    stage: 'WAITING_ARCHIVE',
    closure: { currentVersionId: closureId },
  };
  let stored: Record<string, unknown> | null = null;
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('FROM user_accounts')) return [{ id: actor.userId }];
    if (sql.includes('FROM cases WHERE')) return [{ id: caseId }];
    if (sql.includes('FROM case_payment_proof_supplements s LEFT'))
      return stored ? [stored] : [];
    if (sql.includes('SELECT p.id')) return [{ id: paymentVersionId }];
    if (sql.includes(' AS eligible')) return [{ eligible: true }];
    if (sql.includes('UNION ALL')) return [];
    if (sql.includes('CURRENT_TIMESTAMP')) return [{ recordedAt: now }];
    throw new Error(`Unexpected query: ${sql}`);
  });
  const execute = jest.fn(async (sql: string, ...args: unknown[]) => {
    void sql;
    void args;
    return 1;
  });
  const audit = jest.fn(
    async ({ data }: { data: Record<string, unknown> }) => data,
  );
  const tx = {
    $queryRawUnsafe: query,
    $executeRawUnsafe: execute,
    case: { findFirst: jest.fn(async () => c) },
    auditEvent: { create: audit },
  };
  const transaction = jest.fn(
    async (fn: (client: typeof tx) => Promise<unknown>, options: unknown) => {
      void options;
      return fn(tx);
    },
  );
  const access = { authorizeCase: jest.fn(async () => undefined) };
  const materials = {
    assertAvailableVersions: jest.fn(
      async (
        _tx: unknown,
        _actor: unknown,
        input: { contentVersionIds: string[] },
      ) =>
        input.contentVersionIds.map((contentVersionId) => ({
          materialId: image2,
          contentVersionId,
        })),
    ),
    freezeCasePaymentProofSupplementReferencesDraft: jest.fn(
      async () => undefined,
    ),
  };
  const service = new CasePaymentProofSupplementTransactionDraftService(
    { $transaction: transaction } as unknown as DatabaseService,
    access as unknown as AccessControlService,
    {} as OrganizationService,
    materials as unknown as MaterialService,
  );
  const capture = async () => {
    const result = await service.supplement(actor, caseId, value());
    const insert = execute.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO case_payment_proof_supplements'),
    )!;
    stored = {
      ...result,
      requestFingerprint: insert[10],
      authorizationRevision: actor.authorizationRevision,
      recordedAt: now,
      resultSnapshot: result,
      auditDetails: audit.mock.calls[0]![0].data.details,
      immutableValid: true,
    };
    return result;
  };
  return {
    service,
    c,
    query,
    execute,
    audit,
    transaction,
    access,
    materials,
    capture,
    getStored: () => stored!,
    setStored: (s: Record<string, unknown>) => {
      stored = s;
    },
  };
}
describe('closed payment proof supplement transaction draft', () => {
  it('retries the actual adapter originalCode serialization failure before writing', async () => {
    const f = fixture();
    const error = {
      code: 'P2010',
      meta: {
        driverAdapterError: {
          cause: { originalCode: '40001', kind: 'TransactionWriteConflict' },
        },
      },
    };
    f.transaction.mockRejectedValueOnce(error);
    await f.service.supplement(actor, caseId, value());
    expect(f.transaction).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['40001', 3],
    ['23514', 1],
    ['23505', 3],
  ] as const)(
    'preserves original adapter error %s and the transaction attempt limit',
    async (originalCode, attempts) => {
      const f = fixture();
      const error = {
        code: 'P2010',
        meta: { driverAdapterError: { cause: { originalCode } } },
      };
      f.transaction.mockRejectedValue(error);
      await expect(f.service.supplement(actor, caseId, value())).rejects.toBe(
        error,
      );
      expect(f.transaction).toHaveBeenCalledTimes(attempts);
    },
  );

  beforeEach(() => jest.clearAllMocks());
  it.each(['WAITING_ARCHIVE', 'ARCHIVED'])(
    'composes exact independent event at %s without changing original payment',
    async (stage) => {
      const f = fixture();
      f.c.stage = stage;
      const result = await f.service.supplement(actor, caseId, {
        ...value(),
        contentVersionIds: [image2.toUpperCase(), image.toUpperCase()],
      });
      expect(result).toMatchObject({
        caseId,
        paymentId,
        paymentVersionId,
        closureVersionId: closureId,
        stage,
        contentVersionIds: [image, image2],
        recordedAt: now.toISOString(),
      });
      expect(f.transaction.mock.calls[0]?.[1]).toEqual({
        isolationLevel: 'Serializable',
      });
      expect(lockCustomerActorFacts).toHaveBeenCalled();
      expect(f.access.authorizeCase).toHaveBeenCalledWith(
        actor,
        'case.read',
        expect.objectContaining({ responsibleUserId: actor.userId }),
        expect.anything(),
      );
      expect(
        f.materials.freezeCasePaymentProofSupplementReferencesDraft,
      ).toHaveBeenCalledWith(
        expect.anything(),
        actor,
        caseId,
        paymentVersionId,
        result.id,
        expect.any(Array),
        expect.any(String),
      );
      expect(f.execute.mock.calls.at(-1)?.[0]).toBe(
        'SET CONSTRAINTS ALL IMMEDIATE',
      );
      expect(
        f.execute.mock.calls.every(
          ([sql]) =>
            !/UPDATE|DELETE|INSERT INTO case_closure_payment_/u.test(sql),
        ),
      ).toBe(true);
    },
  );
  it('replays immutable response after current heads advance and never revalidates mutable material availability', async () => {
    const f = fixture();
    const original = await f.capture();
    f.c.closure.currentVersionId = image2;
    f.c.stage = 'ARCHIVED';
    f.materials.assertAvailableVersions.mockClear();
    f.execute.mockClear();
    await expect(f.service.supplement(actor, caseId, value())).resolves.toEqual(
      original,
    );
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.materials.assertAvailableVersions).not.toHaveBeenCalled();
    expect(f.access.authorizeCase).toHaveBeenCalledTimes(2);
  });
  it('rejects a changed request using an existing key', async () => {
    const f = fixture();
    await f.capture();
    await expect(
      f.service.supplement(actor, caseId, {
        ...value(),
        contentVersionIds: [image2],
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
  });
  it.each(['resultSnapshot', 'auditDetails', 'immutableValid', 'recordedAt'])(
    'rejects corrupted immutable %s',
    async (field) => {
      const f = fixture();
      await f.capture();
      f.setStored({
        ...f.getStored(),
        [field]: field === 'immutableValid' ? false : null,
      });
      await expect(
        f.service.supplement(actor, caseId, value()),
      ).rejects.toMatchObject({ response: { code: 'INVALID_RECEIPT' } });
    },
  );
  it('reauthorizes before returning a receipt', async () => {
    const f = fixture();
    await f.capture();
    f.access.authorizeCase.mockRejectedValueOnce(new Error('revoked'));
    await expect(f.service.supplement(actor, caseId, value())).rejects.toThrow(
      'revoked',
    );
  });
  it('rejects a changed owner before replay', async () => {
    const f = fixture();
    await f.capture();
    f.c.responsibleUserId = image;
    await expect(
      f.service.supplement(actor, caseId, value()),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
  });
  it.each(['stage', 'closure'])(
    'rejects stale current %s before writes',
    async (field) => {
      const f = fixture();
      if (field === 'stage') f.c.stage = 'WAITING_MATCH';
      else f.c.closure.currentVersionId = image;
      await expect(
        f.service.supplement(actor, caseId, value()),
      ).rejects.toThrow();
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
  it('rejects duplicate case-variant image IDs before entering a transaction', async () => {
    const f = fixture();
    await expect(
      f.service.supplement(actor, caseId, {
        ...value(),
        contentVersionIds: [image, image.toUpperCase()],
      }),
    ).rejects.toThrow();
    expect(f.transaction).not.toHaveBeenCalled();
  });
  it.each([
    ['FROM user_accounts', [], 'ACTION_FORBIDDEN'],
    ['SELECT p.id', [], 'PAYMENT_VERSION_CONFLICT'],
    [' AS eligible', [{ eligible: false }], 'ACTION_FORBIDDEN'],
    ['UNION ALL', [{ id: image }], 'PROOF_ALREADY_LINKED'],
    ['CURRENT_TIMESTAMP', [], 'INVALID_TRANSACTION_CLOCK'],
  ])(
    'rejects invalid database precondition %s before writing',
    async (fragment, rows, code) => {
      const f = fixture();
      const original = f.query.getMockImplementation()!;
      f.query.mockImplementation(async (sql) =>
        sql.includes(String(fragment)) ? rows : original(sql),
      );
      await expect(
        f.service.supplement(actor, caseId, value()),
      ).rejects.toMatchObject({ response: { code } });
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
  it('propagates reference failure without returning a successful response', async () => {
    const f = fixture();
    f.materials.freezeCasePaymentProofSupplementReferencesDraft.mockRejectedValueOnce(
      new Error('reference rejected'),
    );
    await expect(f.service.supplement(actor, caseId, value())).rejects.toThrow(
      'reference rejected',
    );
    expect(
      f.execute.mock.calls.some(
        ([sql]) => sql === 'SET CONSTRAINTS ALL IMMEDIATE',
      ),
    ).toBe(false);
  });
  it('propagates deferred completeness failure', async () => {
    const f = fixture();
    f.execute.mockImplementation(async (sql) => {
      if (sql === 'SET CONSTRAINTS ALL IMMEDIATE')
        throw new Error('incomplete');
      return 1;
    });
    await expect(f.service.supplement(actor, caseId, value())).rejects.toThrow(
      'incomplete',
    );
  });
});
