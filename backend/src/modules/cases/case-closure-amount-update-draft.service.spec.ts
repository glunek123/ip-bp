import { Prisma } from '../../generated/prisma/client';
import type { DatabaseService } from '../../database/database.service';
import type { AccessControlService } from '../../access-control/access-control.service';
import type { OrganizationService } from '../../access-control/organization.service';
import { CaseClosureAmountUpdateDraftService } from './case-closure-amount-update-draft.service';
import { ClosureAmountUpdateInput } from './case-closure-amount-update.dto';

jest.mock('../../access-control/customer-actor-facts-lock', () => ({
  lockCustomerActorFacts: jest.fn(),
}));
const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const caseId = '33333333-3333-4333-8333-333333333333';
const closureId = '44444444-4444-4444-8444-444444444444';
const assessmentId = '55555555-5555-4555-8555-555555555555';
const value = (): ClosureAmountUpdateInput => ({
  idempotencyKey: 'amount-1',
  expectedClosureVersionId: closureId,
  expectedTermsVersion: 1,
  expectedAssessmentVersionId: null,
  customerAmount: { mode: 'MANUAL', amount: '12.34' },
  lawyerAmount: { mode: 'KEEP' },
});
function fixture() {
  const c = {
    stage: 'WAITING_ARCHIVE',
    responsibleUserId: actor.userId,
    responsibleMembership: { teamId: null },
    consolidationMembership: null,
    closure: { currentVersionId: closureId },
  };
  let receipt: unknown = null;
  const tx = {
    $queryRawUnsafe: jest.fn(async (sql: string) =>
      sql.includes('FROM case_closure_amount_update_receipts')
        ? receipt
          ? [receipt]
          : []
        : sql.includes('FROM case_settlement_assessment_versions')
          ? []
          : [{ id: caseId }],
    ),
    $executeRawUnsafe: jest.fn(async (sql: string, ...args: unknown[]) => {
      if (sql.startsWith('INSERT INTO case_closure_amount_update_receipts'))
        receipt = {
          case_id: args[3],
          request_fingerprint: args[5],
          closure_version_id: args[6],
          terms_version: args[7],
          assessment_version_id: args[8],
          audit_event_id: args[9],
          result_snapshot: JSON.parse(args[10] as string),
          valid: true,
        };
      return 1;
    }),
    case: { findFirst: jest.fn<Promise<typeof c | null>, []>(async () => c) },
    caseSettlementTerms: {
      findUnique: jest.fn(async () => ({
        version: 1,
        departmentId: actor.departmentId,
        customerManualAmount: new Prisma.Decimal('1.00'),
        lawyerManualAmount: null,
      })),
      update: jest.fn(async () => ({ version: 2 })),
      create: jest.fn(),
    },
    auditEvent: { create: jest.fn() },
  };
  const access = { authorizeCase: jest.fn() };
  const assessments = {
    executeInTransaction: jest.fn(async () => ({
      id: assessmentId,
      caseId,
      departmentId: actor.departmentId,
      recordedByUserId: actor.userId,
      closureVersionId: closureId,
      termsVersion: 2,
      priorVersionId: null,
      declaration: 'UNKNOWN' as const,
    })),
  };
  const db = {
    $transaction: jest.fn(async (f: (tx: unknown) => Promise<unknown>) =>
      f(tx),
    ),
  };
  const service = new CaseClosureAmountUpdateDraftService(
    db as unknown as DatabaseService,
    access as unknown as AccessControlService,
    {} as OrganizationService,
    assessments as never,
  );
  return { service, tx, c, access, assessments, db };
}
describe('independent closure amount update draft', () => {
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
    f.db.$transaction.mockRejectedValueOnce(error);
    await f.service.update(actor, caseId, value());
    expect(f.db.$transaction).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['40001', 3],
    ['23514', 1],
    ['23505', 1],
  ] as const)(
    'preserves original adapter error %s and the transaction attempt limit',
    async (originalCode, attempts) => {
      const f = fixture();
      const error = {
        code: 'P2010',
        meta: { driverAdapterError: { cause: { originalCode } } },
      };
      f.db.$transaction.mockRejectedValue(error);
      await expect(f.service.update(actor, caseId, value())).rejects.toBe(
        error,
      );
      expect(f.db.$transaction).toHaveBeenCalledTimes(attempts);
    },
  );

  it('writes amount and assessment together without a closure correction and replays the original result', async () => {
    const f = fixture();
    const first = await f.service.update(actor, caseId, value());
    expect(first.change.after.customerManualAmount).toBe('12.34');
    expect(f.assessments.executeInTransaction).toHaveBeenCalledWith(
      f.tx,
      actor,
      expect.objectContaining({
        declaration: 'UNKNOWN',
        idempotencyKey: expect.stringMatching(/^amount-assessment:/u),
      }),
    );
    expect(f.tx.caseSettlementTerms.update).toHaveBeenCalledTimes(1);
    expect(await f.service.update(actor, caseId, value())).toEqual(first);
    expect(f.tx.caseSettlementTerms.update).toHaveBeenCalledTimes(1);
    expect(f.access.authorizeCase).toHaveBeenCalledTimes(2);
  });
  it('rejects changed payload under the same key and checks current authorization on replay', async () => {
    const f = fixture();
    await f.service.update(actor, caseId, value());
    const changed = value();
    changed.customerAmount.amount = '12.35';
    await expect(f.service.update(actor, caseId, changed)).rejects.toThrow();
    f.access.authorizeCase.mockRejectedValueOnce(new Error('revoked'));
    await expect(f.service.update(actor, caseId, value())).rejects.toThrow(
      'revoked',
    );
  });
  it('rejects non-owner, stale assessment, and no-op requests before writes', async () => {
    const f = fixture();
    f.c.responsibleUserId = assessmentId;
    await expect(f.service.update(actor, caseId, value())).rejects.toThrow();
    f.c.responsibleUserId = actor.userId;
    const stale = value();
    stale.expectedAssessmentVersionId = assessmentId;
    await expect(f.service.update(actor, caseId, stale)).rejects.toThrow();
    const noop = value();
    noop.customerAmount = { mode: 'KEEP' };
    await expect(f.service.update(actor, caseId, noop)).rejects.toThrow();
    expect(f.tx.caseSettlementTerms.update).not.toHaveBeenCalled();
  });
  it('rejects an assessment that does not bind the new terms version', async () => {
    const f = fixture();
    f.assessments.executeInTransaction.mockResolvedValueOnce({
      id: assessmentId,
      caseId,
      departmentId: actor.departmentId,
      recordedByUserId: actor.userId,
      closureVersionId: closureId,
      termsVersion: 1,
      priorVersionId: null,
      declaration: 'UNKNOWN',
    });
    await expect(f.service.update(actor, caseId, value())).rejects.toThrow();
    expect(
      f.tx.$executeRawUnsafe.mock.calls.some(([sql]) =>
        sql.startsWith('INSERT INTO case_closure_amount_update_receipts'),
      ),
    ).toBe(false);
  });
});

it.each(['lock', 'projection'] as const)(
  'returns404 when amount update scoped case %s is missing without access, receipt lookup or writes',
  async (missing) => {
    const f = fixture();
    if (missing === 'lock')
      f.tx.$queryRawUnsafe.mockImplementation(async (sql: string) =>
        sql.startsWith('SELECT id FROM cases') ? [] : [{ id: actor.userId }],
      );
    else f.tx.case.findFirst.mockResolvedValueOnce(null);
    await expect(
      f.service.update(actor, caseId, value()),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: 'CASE_NOT_FOUND' },
    });
    if (missing === 'lock') expect(f.tx.case.findFirst).not.toHaveBeenCalled();
    else expect(f.tx.case.findFirst).toHaveBeenCalledTimes(1);
    expect(f.access.authorizeCase).not.toHaveBeenCalled();
    expect(
      f.tx.$queryRawUnsafe.mock.calls.some(([sql]) =>
        sql.includes('FROM case_closure_amount_update_receipts'),
      ),
    ).toBe(false);
    expect(f.tx.caseSettlementTerms.findUnique).not.toHaveBeenCalled();
    expect(f.tx.caseSettlementTerms.update).not.toHaveBeenCalled();
    expect(f.assessments.executeInTransaction).not.toHaveBeenCalled();
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(f.tx.$executeRawUnsafe).not.toHaveBeenCalled();
  },
);
