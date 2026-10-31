import type { DatabaseService } from '../../database/database.service';
import {
  AccessControlService,
  type AccessControlSnapshot,
} from '../../access-control/access-control.service';
import type { OrganizationService } from '../../access-control/organization.service';
import {
  SettlementAssessmentPostgresDraft,
  createAssessmentCompositionContext,
} from './settlement-assessment-postgres-draft';
import { lockCustomerActorFacts } from '../../access-control/customer-actor-facts-lock';
import { Prisma } from '../../generated/prisma/client';
import { createHash } from 'node:crypto';

jest.mock('../../access-control/customer-actor-facts-lock', () => ({
  lockCustomerActorFacts: jest.fn(async () => undefined),
}));
const actor = {
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  departmentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  authorizationRevision: 1,
};
const command = {
  caseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  declaration: 'APPLICABLE' as const,
  idempotencyKey: 'request',
};
function setup(snapshot?: AccessControlSnapshot) {
  const state: { owner: string; receipts: unknown[]; formula: string } = {
    owner: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    receipts: [],
    formula: '结案金额 × 70%',
  };
  const tx = {
    userAccount: {
      findUnique: jest.fn(async () => ({
        active: true,
        accountType: 'INTERNAL',
      })),
    },
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('');
      if (sql.includes('FROM cases'))
        return [
          {
            responsible_user_id: state.owner,
            stage: 'WAITING_ARCHIVE',
            team_id: 'team-a',
          },
        ];
      if (sql.includes('FROM case_settlement_assessment_receipts'))
        return state.receipts;
      if (sql.includes('FROM case_closures'))
        return [
          {
            id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            amount: '1000.00',
            state: 'KNOWN',
          },
        ];
      if (sql.includes('FROM case_settlement_terms'))
        return [
          {
            version: 3,
            customer_formula: state.formula,
            lawyer_mode: 'FULL_RISK',
            lawyer_base_fee: '0.00',
            lawyer_split_percent: '30',
            customer_manual_amount: null,
            lawyer_manual_amount: null,
          },
        ];
      return [];
    }),
    $executeRaw: jest.fn(async (...args: unknown[]) => {
      void args;
      return 1;
    }),
  };
  const transaction = jest.fn(
    async (work: (reader: typeof tx) => Promise<unknown>) => work(tx),
  );
  const access = {
    authorizeDepartmentAction: jest.fn(async () => undefined),
    authorizeCase: jest.fn(async () => undefined),
  };
  const service = new SettlementAssessmentPostgresDraft(
    { $transaction: transaction } as unknown as DatabaseService,
    snapshot
      ? new AccessControlService({ loadSnapshot: async () => snapshot })
      : (access as unknown as AccessControlService),
    {} as OrganizationService,
  );
  return { service, tx, state, access, transaction };
}

describe('unregistered PostgreSQL assessment adapter (transaction doubles only)', () => {
  beforeEach(() => jest.clearAllMocks());
  it.each(['self', 'team', 'department'] as const)(
    'accepts %s case-read scope for standalone and composed assessment and denies replay after revocation',
    async (scope) => {
      const snapshot: AccessControlSnapshot = {
        active: true,
        authorizationRevision: 1,
        grants: [
          {
            action: 'case.read',
            scope,
            ...(scope === 'team' ? { teamId: 'team-a' } : {}),
          },
        ],
      };
      const f = setup(snapshot);
      const result = await f.service.execute(actor, command);
      const audit = f.tx.$executeRaw.mock.calls[0].find(
        (item) => typeof item === 'string' && item.startsWith('{'),
      );
      f.state.receipts = [
        {
          case_id: command.caseId,
          request_fingerprint: JSON.parse(String(audit)).requestFingerprint,
          result_snapshot: result,
        },
      ];
      await expect(f.service.execute(actor, command)).resolves.toEqual(result);
      f.tx.$queryRaw.mockClear();
      snapshot.grants = [];
      await expect(f.service.execute(actor, command)).rejects.toThrow();
      expect(
        f.tx.$queryRaw.mock.calls.some(([sql]) =>
          sql.join('').includes('FROM case_settlement_assessment_receipts'),
        ),
      ).toBe(false);
      snapshot.grants = [
        {
          action: 'case.read',
          scope,
          ...(scope === 'team' ? { teamId: 'team-a' } : {}),
        },
      ];
      f.state.receipts = [];
      const composition = createAssessmentCompositionContext({
        requestFingerprint: 'c'.repeat(64),
        parentIdempotencyKey: 'parent-scoped',
        expectedAssessmentVersionId: null,
        expectedTermsVersion: 3,
      });
      await expect(
        f.service.executeInTransaction(
          f.tx as unknown as Prisma.TransactionClient,
          actor,
          command,
          composition,
        ),
      ).resolves.toMatchObject({ caseId: command.caseId });
      snapshot.grants = [];
      f.tx.$queryRaw.mockClear();
      await expect(
        f.service.executeInTransaction(
          f.tx as unknown as Prisma.TransactionClient,
          actor,
          command,
          composition,
        ),
      ).rejects.toThrow();
      expect(
        f.tx.$queryRaw.mock.calls.some(([sql]) =>
          sql.join('').includes('FROM case_settlement_assessment_receipts'),
        ),
      ).toBe(false);
    },
  );
  it('recomputes under serializable transaction then writes exact audit, assessment and receipt', async () => {
    const { service, tx, transaction } = setup();
    const result = await service.execute(actor, command);
    expect(result).toMatchObject({
      customerAmount: '700.00',
      lawyerAmount: '300.00',
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(lockCustomerActorFacts).toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(3);
    const calls = tx.$executeRaw.mock.calls;
    expect((calls[0][0] as TemplateStringsArray).join('')).toContain(
      'INSERT INTO audit_events',
    );
    expect((calls[1][0] as TemplateStringsArray).join('')).toContain(
      'INSERT INTO case_settlement_assessment_versions',
    );
    expect((calls[2][0] as TemplateStringsArray).join('')).toContain(
      'INSERT INTO case_settlement_assessment_receipts',
    );
    const audit = calls[0].find(
      (item) => typeof item === 'string' && item.startsWith('{'),
    );
    expect(JSON.parse(String(audit))).toMatchObject({
      ...result,
      requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });
  it('reauthorizes before replay and does not recompute an exact receipt', async () => {
    const { service, tx, state, access } = setup();
    const result = await service.execute(actor, command);
    const audit = tx.$executeRaw.mock.calls[0].find(
      (item) => typeof item === 'string' && item.startsWith('{'),
    );
    const fingerprint: unknown = JSON.parse(String(audit)).requestFingerprint;
    state.receipts = [
      {
        case_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        request_fingerprint: fingerprint,
        result_snapshot: result,
      },
    ];
    tx.$executeRaw.mockClear();
    tx.$queryRaw.mockClear();
    access.authorizeCase.mockClear();
    await expect(service.execute(actor, command)).resolves.toEqual(result);
    expect(access.authorizeCase).toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(
      tx.$queryRaw.mock.calls.some(([strings]) =>
        strings.join('').includes('FROM case_closures'),
      ),
    ).toBe(false);
  });
  it('denies receipt lookup after scope loss and rejects mismatched requests', async () => {
    const { service, tx, state } = setup();
    state.owner = 'other';
    await expect(service.execute(actor, command)).rejects.toThrow(
      'ACTION_FORBIDDEN',
    );
    expect(tx.$queryRaw.mock.calls).toHaveLength(1);
    state.owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    state.receipts = [
      {
        case_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        request_fingerprint: 'different',
      },
    ];
    await expect(service.execute(actor, command)).rejects.toThrow(
      'IDEMPOTENCY_CONFLICT',
    );
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
  it('records explicit not-applicable despite invalid legacy formulas without a formal amount', async () => {
    const { service, state } = setup();
    state.formula = 'old text';
    await expect(
      service.execute(actor, { ...command, declaration: 'NOT_APPLICABLE' }),
    ).resolves.toMatchObject({
      calculationInputs: { customerFormula: 'old text' },
      calculationResult: null,
      customerAmount: null,
      lawyerAmount: null,
    });
  });
  it('propagates the database gate failure and never writes a success receipt', async () => {
    const { service, tx } = setup();
    tx.$executeRaw
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('draft and not enabled'));
    await expect(service.execute(actor, command)).rejects.toThrow(
      'draft and not enabled',
    );
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
  });
  it('canonicalizes uppercase IDs before the first fingerprint, query and snapshot', async () => {
    const { service, tx } = setup();
    const result = await service.execute(
      {
        ...actor,
        userId: actor.userId.toUpperCase(),
        departmentId: actor.departmentId.toUpperCase(),
      },
      { ...command, caseId: command.caseId.toUpperCase() },
    );
    expect(result).toMatchObject({
      caseId: command.caseId,
      departmentId: actor.departmentId,
      recordedByUserId: actor.userId,
    });
    const rawValues = tx.$queryRaw.mock.calls.flatMap((call) => call.slice(1));
    expect(rawValues).not.toContain(command.caseId.toUpperCase());
  });
  it('replays the same key across mixed UUID casing', async () => {
    const { service, tx, state } = setup();
    const result = await service.execute(actor, {
      ...command,
      caseId: command.caseId.toUpperCase(),
    });
    const audit = tx.$executeRaw.mock.calls[0].find(
      (item) => typeof item === 'string' && item.startsWith('{'),
    );
    const fingerprint: unknown = JSON.parse(String(audit)).requestFingerprint;
    state.receipts = [
      {
        case_id: command.caseId,
        request_fingerprint: fingerprint,
        result_snapshot: result,
      },
    ];
    tx.$executeRaw.mockClear();
    await expect(service.execute(actor, command)).resolves.toEqual(result);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
  it('rejects malformed incoming IDs before authorization or database access', async () => {
    const { service, transaction } = setup();
    await expect(
      service.execute(actor, { ...command, caseId: 'invalid' }),
    ).rejects.toThrow('INVALID_ASSESSMENT_ID');
    expect(transaction).not.toHaveBeenCalled();
  });
  it('retries P2034 with fresh authorization and eventually stops after three failures', async () => {
    const first = setup();
    const failure = () =>
      new Prisma.PrismaClientKnownRequestError('serialization', {
        code: 'P2034',
        clientVersion: 'test',
      });
    first.transaction.mockImplementationOnce(async (work) => {
      await work(first.tx);
      throw failure();
    });
    await expect(first.service.execute(actor, command)).resolves.toMatchObject({
      caseId: command.caseId,
    });
    expect(first.transaction).toHaveBeenCalledTimes(2);
    expect(first.access.authorizeCase).toHaveBeenCalledTimes(2);
    const exhausted = setup();
    exhausted.transaction.mockRejectedValue(failure());
    await expect(
      exhausted.service.execute(actor, command),
    ).rejects.toMatchObject({ code: 'P2034' });
    expect(exhausted.transaction).toHaveBeenCalledTimes(3);
  });
  it.each(['55P03', '40001', '40P01'])(
    'retries exact structured %s failures with fresh authorization',
    async (code) => {
      const f = setup();
      const error = new Prisma.PrismaClientKnownRequestError(
        'opaque database error',
        { code: 'P2010', clientVersion: 'test', meta: { code } },
      );
      f.transaction.mockImplementationOnce(async (work) => {
        await work(f.tx);
        throw error;
      });
      await expect(f.service.execute(actor, command)).resolves.toMatchObject({
        caseId: command.caseId,
      });
      expect(f.transaction).toHaveBeenCalledTimes(2);
      expect(lockCustomerActorFacts).toHaveBeenCalledTimes(2);
      expect(f.access.authorizeCase).toHaveBeenCalledTimes(2);
    },
  );
  it('retries NOWAIT actor-lock refusal before reaching permission or receipt reads', async () => {
    const f = setup();
    jest.mocked(lockCustomerActorFacts).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('opaque', {
        code: 'P2010',
        clientVersion: 'test',
        meta: { code: '55P03' },
      }),
    );
    await expect(f.service.execute(actor, command)).resolves.toMatchObject({
      caseId: command.caseId,
    });
    expect(f.transaction).toHaveBeenCalledTimes(2);
    expect(lockCustomerActorFacts).toHaveBeenCalledTimes(2);
    expect(f.access.authorizeCase).toHaveBeenCalledTimes(1);
  });
  it.each(['55P03', '40001', '40P01'])(
    'stops after three structured %s failures',
    async (code) => {
      const f = setup();
      const error = new Prisma.PrismaClientKnownRequestError('opaque', {
        code: 'P2010',
        clientVersion: 'test',
        meta: { code },
      });
      f.tx.$queryRaw.mockRejectedValue(error);
      await expect(f.service.execute(actor, command)).rejects.toBe(error);
      expect(f.transaction).toHaveBeenCalledTimes(3);
      expect(lockCustomerActorFacts).toHaveBeenCalledTimes(3);
      expect(f.tx.$executeRaw).not.toHaveBeenCalled();
    },
  );
  it.each([
    new Error('55P03 P2034 serialization failure'),
    new Prisma.PrismaClientKnownRequestError('55P03', {
      code: 'P2010',
      clientVersion: 'test',
      meta: { code: '23514' },
    }),
    new Prisma.PrismaClientKnownRequestError('40001', {
      code: 'P2010',
      clientVersion: 'test',
      meta: { code: '55P03 extra' },
    }),
    new Prisma.PrismaClientKnownRequestError('P2034', {
      code: 'P2010',
      clientVersion: 'test',
    }),
    new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    }),
  ])(
    'never retries by error text or unrelated database codes: %s',
    async (error) => {
      const f = setup();
      f.transaction.mockRejectedValue(error);
      await expect(f.service.execute(actor, command)).rejects.toBe(error);
      expect(f.transaction).toHaveBeenCalledTimes(1);
    },
  );
  it('reuses the supplied transaction and still authorizes, computes and persists all three records', async () => {
    const { service, tx, transaction, access } = setup();
    const result = await service.executeInTransaction(
      tx as unknown as Prisma.TransactionClient,
      actor,
      command,
    );
    expect(result).toMatchObject({
      customerAmount: '700.00',
      lawyerAmount: '300.00',
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(access.authorizeCase).toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(3);
  });
  it('propagates combination failures without a nested transaction or local retry', async () => {
    const { service, tx, transaction } = setup();
    tx.$executeRaw
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('ASSESSMENT_GATE_CLOSED'));
    const compose = async () => {
      await service.executeInTransaction(
        tx as unknown as Prisma.TransactionClient,
        actor,
        command,
      );
      throw new Error('must not reach the next combined step');
    };
    await expect(compose()).rejects.toThrow('ASSESSMENT_GATE_CLOSED');
    expect(transaction).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
  });
  it('leaves later combined-step failures to the outer transaction owner', async () => {
    const { service, tx, transaction } = setup();
    const compose = async () => {
      await service.executeInTransaction(
        tx as unknown as Prisma.TransactionClient,
        actor,
        command,
      );
      throw new Error('LATER_COMBINED_STEP_FAILED');
    };
    await expect(compose()).rejects.toThrow('LATER_COMBINED_STEP_FAILED');
    expect(transaction).not.toHaveBeenCalled();
    // A double proves propagation only; actual rollback remains a PostgreSQL test.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(3);
  });
  it('uses a server-created total hash and stable child key in a composed transaction', async () => {
    const { service, tx, transaction } = setup();
    const context = createAssessmentCompositionContext({
      requestFingerprint: 'a'.repeat(64),
      parentIdempotencyKey: 'parent',
      expectedAssessmentVersionId: null,
      expectedTermsVersion: 3,
    });
    const same = createAssessmentCompositionContext({
      requestFingerprint: 'a'.repeat(64),
      parentIdempotencyKey: 'parent',
      expectedAssessmentVersionId: null,
      expectedTermsVersion: 3,
    });
    expect(same.childIdempotencyKey).toBe(context.childIdempotencyKey);
    expect(context.childIdempotencyKey).toBe(
      'assessment:' +
        createHash('sha256').update('parent', 'utf8').digest('hex'),
    );
    expect(Object.isFrozen(context)).toBe(true);
    await service.executeInTransaction(
      tx as unknown as Prisma.TransactionClient,
      actor,
      command,
      context,
    );
    const audit = tx.$executeRaw.mock.calls[0].find(
      (item) => typeof item === 'string' && item.startsWith('{'),
    );
    expect(JSON.parse(String(audit)).requestFingerprint).toBe('a'.repeat(64));
    const receipt = tx.$executeRaw.mock.calls[2];
    expect(receipt).toContain(context.childIdempotencyKey);
    expect(receipt).toContain('a'.repeat(64));
    const link = tx.$executeRaw.mock.calls[3];
    expect((link[0] as TemplateStringsArray).join('')).toContain(
      'INSERT INTO case_settlement_update_child_links',
    );
    expect((link[0] as TemplateStringsArray).join('')).toContain(
      "'ASSESSMENT'",
    );
    expect(link).toContain('parent');
    expect(link).toContain('a'.repeat(64));
    expect(transaction).not.toHaveBeenCalled();
  });
  it.each(['assessment', 'terms'] as const)(
    'rejects a locked %s version conflict before any write',
    async (kind) => {
      const { service, tx } = setup();
      const context = createAssessmentCompositionContext({
        requestFingerprint: 'a'.repeat(64),
        parentIdempotencyKey: 'parent',
        expectedAssessmentVersionId:
          kind === 'assessment' ? 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' : null,
        expectedTermsVersion: kind === 'terms' ? null : 3,
      });
      await expect(
        service.executeInTransaction(
          tx as unknown as Prisma.TransactionClient,
          actor,
          command,
          context,
        ),
      ).rejects.toThrow('VERSION_CONFLICT');
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    },
  );
  it('rejects copied client contexts and leaves standalone fingerprinting unchanged', async () => {
    const { service, tx } = setup();
    const context = createAssessmentCompositionContext({
      requestFingerprint: 'a'.repeat(64),
      parentIdempotencyKey: 'parent',
      expectedAssessmentVersionId: null,
      expectedTermsVersion: 3,
    });
    await expect(
      service.executeInTransaction(
        tx as unknown as Prisma.TransactionClient,
        actor,
        command,
        { ...context },
      ),
    ).rejects.toThrow('INVALID_ASSESSMENT_COMPOSITION');
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    await service.execute(actor, { ...command, ...{ composition: context } });
    const audit = tx.$executeRaw.mock.calls[0].find(
      (item) => typeof item === 'string' && item.startsWith('{'),
    );
    expect(JSON.parse(String(audit)).requestFingerprint).not.toBe(
      'a'.repeat(64),
    );
    expect(tx.$executeRaw.mock.calls[2]).toContain(command.idempotencyKey);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(3);
  });
  it('propagates missing-parent link failure to the outer rollback boundary', async () => {
    const { service, tx, transaction } = setup();
    const context = createAssessmentCompositionContext({
      requestFingerprint: 'a'.repeat(64),
      parentIdempotencyKey: 'parent',
      expectedAssessmentVersionId: null,
      expectedTermsVersion: 3,
    });
    tx.$executeRaw
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(
        new Error('COMPOSITION_LINK_GATE_OR_PARENT_FAILURE'),
      );
    await expect(
      service.executeInTransaction(
        tx as unknown as Prisma.TransactionClient,
        actor,
        command,
        context,
      ),
    ).rejects.toThrow('COMPOSITION_LINK_GATE_OR_PARENT_FAILURE');
    expect(transaction).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(4);
  });
  it('requires parent-level replay instead of reusing an old composed child', async () => {
    const { service, tx, state, access } = setup();
    const context = createAssessmentCompositionContext({
      requestFingerprint: 'a'.repeat(64),
      parentIdempotencyKey: 'parent',
      expectedAssessmentVersionId: null,
      expectedTermsVersion: 3,
    });
    const result = await service.executeInTransaction(
      tx as unknown as Prisma.TransactionClient,
      actor,
      command,
      context,
    );
    state.receipts = [
      {
        case_id: command.caseId,
        request_fingerprint: context.requestFingerprint,
        result_snapshot: result,
      },
    ];
    tx.$executeRaw.mockClear();
    access.authorizeCase.mockClear();
    await expect(
      service.executeInTransaction(
        tx as unknown as Prisma.TransactionClient,
        actor,
        command,
        context,
      ),
    ).rejects.toThrow('COMPOSED_ASSESSMENT_REQUIRES_PARENT_REPLAY');
    expect(access.authorizeCase).toHaveBeenCalled();
    expect(access.authorizeDepartmentAction).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});
