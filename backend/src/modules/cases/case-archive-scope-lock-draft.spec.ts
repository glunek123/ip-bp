import type { Prisma } from '../../generated/prisma/client';
import type { AccessControlService } from '../../access-control/access-control.service';
import type { OrganizationService } from '../../access-control/organization.service';
import { currentLawyerBindingId } from '../../access-control/lawyer-case-access';
import { lockCustomerActorFacts } from '../../access-control/customer-actor-facts-lock';
import {
  lockArchiveCaseScopeDraft,
  readArchiveFinancialAggregateDraft,
  prepareArchiveFinancialDraft,
} from './case-archive-scope-lock-draft';
import { readPaymentFinancialReview } from './case-closure-payment-financial-prisma-draft';
jest.mock('./case-closure-payment-financial-prisma-draft', () => ({
  readPaymentFinancialReview: jest.fn(async () => ({
    state: 'PASSED',
    refund: { state: 'PASSED', reason: 'REFUND_EXPLICITLY_NOT_APPLICABLE' },
    customer: { state: 'PASSED', reason: 'CUSTOMER_RECEIPTS_REACHED' },
    lawyer: { state: 'PASSED', reason: 'LAWYER_INVOICES_REACHED' },
    sources: {
      refundVersionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      assessmentVersionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      countedCaseIds: ['private-original'],
      allocationIds: ['private-allocation'],
    },
  })),
}));

jest.mock('../../access-control/customer-actor-facts-lock', () => ({
  lockCustomerActorFacts: jest.fn(async () => undefined),
}));
jest.mock('../../access-control/lawyer-case-access', () => ({
  currentLawyerBindingId: jest.fn(async () => 'binding'),
}));
const id = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const actor = {
  userId: id('1'),
  departmentId: id('2'),
  authorizationRevision: 1,
};
const main = id('b');
const original = id('a');
const consolidation = id('c');
function setup() {
  const state = {
    lawyer: false,
    memberMain: true,
    crossDepartment: false,
    missingOriginal: false,
    changed: false,
    isolation: 'serializable',
    closureAmount: '100.00' as string | null,
    paymentType: 'ONE_TIME' as string | null,
    required: '100' as string | null,
  };
  let discoveries = 0;
  const tx = {
    userAccount: {
      findUnique: jest.fn(async () => ({
        active: true,
        accountType: state.lawyer ? 'LAWYER' : 'INTERNAL',
        authorizationRevision: 1,
      })),
    },
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('');
      if (sql.includes('current_setting'))
        return [{ isolation: state.isolation }];
      if (sql.includes('WITH basis AS'))
        return [
          {
            closure_version_id: id('e'),
            closure_amount: state.closureAmount,
            payment_type: state.paymentType,
            customer_required: state.required,
            lawyer_required: state.required,
          },
        ];
      if (sql.includes('SELECT h.id FROM case_closures'))
        return [{ id: id('d') }];
      if (sql.includes('SELECT case_id FROM case_settlement_terms')) return [];
      if (sql.includes('SELECT p.id,p.amount::text'))
        return [{ id: id('4'), amount: '100.00' }];
      if (sql.includes('SELECT id,side::text,amount::text'))
        return [
          { id: id('5'), side: 'CUSTOMER', amount: '100.00' },
          { id: id('6'), side: 'LAWYER', amount: '100.00' },
        ];
      if (sql.includes('SELECT consolidation_id,is_main')) {
        discoveries++;
        return [{ consolidation_id: consolidation, is_main: state.memberMain }];
      }
      if (sql.includes('SELECT id FROM case_consolidations'))
        return [{ id: consolidation }];
      if (sql.includes('SELECT case_id,department_id,is_main'))
        return [
          {
            case_id: original,
            department_id: state.crossDepartment ? id('3') : actor.departmentId,
            is_main: false,
          },
          { case_id: main, department_id: actor.departmentId, is_main: true },
          ...(state.changed && discoveries > 1
            ? [
                {
                  case_id: id('d'),
                  department_id: actor.departmentId,
                  is_main: false,
                },
              ]
            : []),
        ];
      if (sql.includes('FOR UPDATE OF c'))
        return [original, main]
          .filter((c) => !state.missingOriginal || c !== original)
          .map((c) => ({
            id: c,
            department_id: actor.departmentId,
            responsible_user_id: id('9'),
            team_id: null,
          }));
      throw new Error('Unexpected SQL');
    }),
    $executeRaw: jest.fn(async (...args: unknown[]) => {
      void args;
      return 1;
    }),
  };
  const access = {
    authorizeDepartmentAction: jest.fn(async () => undefined),
    authorizeCase: jest.fn(async () => undefined),
  };
  const run = () =>
    lockArchiveCaseScopeDraft(
      tx as unknown as Prisma.TransactionClient,
      { ...actor, ...(state.lawyer ? { lawyerAccountId: actor.userId } : {}) },
      main,
      access as unknown as AccessControlService,
      {} as OrganizationService,
    );
  return { state, tx, access, run };
}
describe('unregistered formal archive scope prerequisite', () => {
  beforeEach(() => jest.clearAllMocks());
  it('preserves case.archive scope without requiring original ownership and locks sorted cases', async () => {
    const { run, tx, access } = setup();
    await expect(run()).resolves.toEqual({ purpose: 'ARCHIVE_AGGREGATE_ONLY' });
    expect(access.authorizeDepartmentAction).not.toHaveBeenCalled();
    expect(access.authorizeCase).toHaveBeenCalledWith(
      actor,
      'case.archive',
      expect.objectContaining({ responsibleUserId: id('9') }),
      tx,
    );
    const calls = tx.$queryRaw.mock.calls.map(([strings]) => strings.join(''));
    expect(
      calls.findIndex((sql) => sql.includes('SELECT consolidation_id,is_main')),
    ).toBeLessThan(calls.findIndex((sql) => sql.includes('FOR UPDATE OF c')));
    expect(calls.find((sql) => sql.includes('FOR UPDATE OF c'))).toContain(
      'ORDER BY c.id',
    );
    const caseLock = calls.find((sql) => sql.includes('FOR UPDATE OF c'));
    expect(caseLock).toContain('FOR UPDATE OF c NOWAIT');
    expect(caseLock).toContain('FOR SHARE OF m NOWAIT');
    expect(lockCustomerActorFacts).toHaveBeenCalled();
  });
  it('preserves the current main PRIMARY binding without requiring original assignments', async () => {
    const { run, state, access, tx } = setup();
    state.lawyer = true;
    await expect(run()).resolves.toMatchObject({
      purpose: 'ARCHIVE_AGGREGATE_ONLY',
      lawyerBindingId: 'binding',
    });
    expect(currentLawyerBindingId).toHaveBeenNthCalledWith(
      1,
      tx,
      { ...actor, lawyerAccountId: actor.userId },
      main,
      true,
    );
    expect(currentLawyerBindingId).toHaveBeenCalledTimes(1);
    expect(access.authorizeCase).not.toHaveBeenCalled();
  });
  it('rejects a lawyer missing main-case authority', async () => {
    const { run, state } = setup();
    state.lawyer = true;
    jest
      .mocked(currentLawyerBindingId)
      .mockRejectedValueOnce(new Error('ACTION_FORBIDDEN'));
    await expect(run()).rejects.toThrow('ACTION_FORBIDDEN');
  });
  it.each(['crossDepartment', 'missingOriginal', 'changed'] as const)(
    'rejects inconsistent or changing scope: %s',
    async (kind) => {
      const { run, state } = setup();
      state[kind] = true;
      await expect(run()).rejects.toThrow();
    },
  );
  it('rejects original-case handling and nonserializable composition', async () => {
    const first = setup();
    first.state.memberMain = false;
    await expect(first.run()).rejects.toThrow('ARCHIVE_REQUIRES_MAIN_CASE');
    const second = setup();
    second.state.isolation = 'read committed';
    await expect(second.run()).rejects.toThrow('ARCHIVE_REQUIRES_SERIALIZABLE');
  });
  it('does not read funds when the original main archive authorization refuses', async () => {
    const { run, access } = setup();
    access.authorizeCase.mockRejectedValueOnce(new Error('ACTION_FORBIDDEN'));
    await expect(run()).rejects.toThrow('ACTION_FORBIDDEN');
    expect(readPaymentFinancialReview).not.toHaveBeenCalled();
  });
  it('aggregates verified originals internally but returns no original IDs or details', async () => {
    const { run, tx } = setup();
    const scope = await run();
    const result = await readArchiveFinancialAggregateDraft(
      tx as unknown as Prisma.TransactionClient,
      actor,
      scope,
    );
    expect(readPaymentFinancialReview).toHaveBeenCalledWith(tx, actor, main, [
      original,
      main,
    ]);
    expect(result).toMatchObject({
      state: 'PASSED',
      customer: { reason: 'CUSTOMER_RECEIPTS_REACHED' },
    });
    expect(result).not.toHaveProperty('sources');
    expect(JSON.stringify(scope)).not.toContain(original);
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('rejects copied capabilities, another transaction and changed actor before financial reads', async () => {
    const { run, tx } = setup();
    const scope = await run();
    await expect(
      readArchiveFinancialAggregateDraft(
        tx as unknown as Prisma.TransactionClient,
        actor,
        { ...scope },
      ),
    ).rejects.toThrow('ARCHIVE_SCOPE_CAPABILITY_INVALID');
    await expect(
      readArchiveFinancialAggregateDraft(
        {} as Prisma.TransactionClient,
        actor,
        scope,
      ),
    ).rejects.toThrow('ARCHIVE_SCOPE_CAPABILITY_INVALID');
    await expect(
      readArchiveFinancialAggregateDraft(
        tx as unknown as Prisma.TransactionClient,
        { ...actor, userId: id('8') },
        scope,
      ),
    ).rejects.toThrow('ARCHIVE_SCOPE_CAPABILITY_INVALID');
    expect(readPaymentFinancialReview).not.toHaveBeenCalled();
  });
  it('assembles exact evidence in the locked transaction before validating constraints', async () => {
    const { run, tx } = setup();
    const scope = await run();
    const prepared = await prepareArchiveFinancialDraft(
      tx as unknown as Prisma.TransactionClient,
      actor,
      scope,
    );
    expect(prepared.state).toBe('PASSED');
    const metadataSql = tx.$queryRaw.mock.calls
      .map((call) => (call[0] as TemplateStringsArray).join(''))
      .find((sql) => sql.includes('WITH basis AS'));
    expect(metadataSql).toContain('CASE a.calculation_rule_version');
    expect(metadataSql).toContain(
      "WHEN 'settlement-calculation-v1-whole-yuan-half-up' THEN archive_verified_settlement_outputs(b.inputs)",
    );
    expect(metadataSql).toContain(
      "WHEN 'settlement-calculation-v2-manual-cents-auto-whole-yuan-half-up' THEN archive_verified_settlement_outputs_v2(b.inputs)",
    );
    expect(metadataSql).toContain('ELSE NULL END AS outputs');
    expect(JSON.stringify(prepared)).not.toContain(original);
    await prepared.persist(id('7'), id('e'));
    const statements = tx.$executeRaw.mock.calls.map((call) =>
      (call[0] as TemplateStringsArray).join(''),
    );
    expect(statements[0]).toContain('DEFERRED');
    expect(statements[1]).toContain(
      'INSERT INTO case_archive_evidence_snapshots',
    );
    expect(statements[2]).toContain(
      'INSERT INTO case_archive_snapshot_payments',
    );
    expect(
      statements.filter((s) =>
        s.includes('INSERT INTO case_archive_snapshot_allocations'),
      ),
    ).toHaveLength(2);
    expect(statements[statements.length - 1]).toContain('IMMEDIATE');
  });
  it('keeps an unverified SQL formula output unknown and cannot persist it', async () => {
    const { run, tx, state } = setup();
    state.required = null;
    const prepared = await prepareArchiveFinancialDraft(
      tx as unknown as Prisma.TransactionClient,
      actor,
      await run(),
    );
    expect(prepared.customer).toMatchObject({
      state: 'UNKNOWN',
      reason: 'SQL_SETTLEMENT_RULE_UNVERIFIED',
    });
    await expect(prepared.persist(id('7'), id('e'))).rejects.toThrow(
      'ARCHIVE_FINANCIAL_SOURCE_UNKNOWN',
    );
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
  it('propagates the closed snapshot gate without adding children or returning success', async () => {
    const { run, tx } = setup();
    const prepared = await prepareArchiveFinancialDraft(
      tx as unknown as Prisma.TransactionClient,
      actor,
      await run(),
    );
    tx.$executeRaw
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('snapshot gate closed'));
    await expect(prepared.persist(id('7'), id('e'))).rejects.toThrow(
      'snapshot gate closed',
    );
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
  });
});

it('new zero closure snapshot is not permitted to hide an unresolved refund', async () => {
  const { run, tx, state } = setup();
  state.closureAmount = '0.00';
  (readPaymentFinancialReview as jest.Mock).mockResolvedValueOnce({
    state: 'UNKNOWN',
    refund: { state: 'UNKNOWN', reason: 'REFUND_AMOUNT_UNKNOWN' },
    customer: { state: 'EXEMPT', reason: 'EXPLICIT_ZERO_CLOSURE_AMOUNT' },
    lawyer: { state: 'EXEMPT', reason: 'EXPLICIT_ZERO_CLOSURE_AMOUNT' },
    sources: {
      refundVersionId: id('f'),
      assessmentVersionId: null,
      allocationIds: [],
      countedCaseIds: [id('1')],
    },
  });
  const prepared = await prepareArchiveFinancialDraft(
    tx as unknown as Prisma.TransactionClient,
    actor,
    await run(),
  );
  expect(prepared.refund.state).toBe('UNKNOWN');
  expect(prepared.payment.state).toBe('EXEMPT');
  expect(prepared.state).toBe('UNKNOWN');
  await expect(prepared.persist(id('7'), id('e'))).rejects.toThrow(
    'ARCHIVE_FINANCIAL_SOURCE_UNKNOWN',
  );
  expect(tx.$executeRaw).not.toHaveBeenCalled();
});
