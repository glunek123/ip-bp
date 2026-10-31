import { ConflictException, ForbiddenException } from '@nestjs/common';
import { CaseArchiveReadinessService } from './case-archive-readiness.service';
import {
  lockArchiveCaseScopeDraft,
  prepareArchiveFinancialDraft,
} from './case-archive-scope-lock-draft';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { AccessControlService } from '../../access-control/access-control.service';
import { OrganizationService } from '../../access-control/organization.service';
import { Prisma } from '../../generated/prisma/client';

jest.mock('./case-archive-scope-lock-draft', () => ({
  lockArchiveCaseScopeDraft: jest.fn(),
  prepareArchiveFinancialDraft: jest.fn(),
}));
const id = '00000000-0000-4000-8000-000000000001';
const actor = {
  userId: id,
  departmentId: id,
  authorizationRevision: 2,
} as ActorContext;
function fixture() {
  const tx = {
    case: {
      findUnique: jest.fn().mockResolvedValue({
        version: 7,
        stage: 'WAITING_ARCHIVE',
        closure: { currentVersionId: id },
        archive: null,
      }),
    },
  };
  const transaction = jest
    .fn()
    .mockImplementation((callback: (value: typeof tx) => Promise<unknown>) =>
      callback(tx),
    );
  const access = {} as AccessControlService;
  const organization = {} as OrganizationService;
  const service = new CaseArchiveReadinessService(
    { $transaction: transaction } as unknown as DatabaseService,
    access,
    organization,
  );
  const scope = { purpose: 'ARCHIVE_AGGREGATE_ONLY' as const };
  const persist = jest.fn();
  jest.mocked(lockArchiveCaseScopeDraft).mockResolvedValue(scope);
  jest.mocked(prepareArchiveFinancialDraft).mockResolvedValue({
    state: 'UNKNOWN',
    payment: { state: 'PASSED', reason: 'CLOSURE_PAYMENT_REACHED' },
    refund: { state: 'UNKNOWN', reason: 'REFUND_INVENTORY_MISSING' },
    customer: { state: 'BLOCKED', reason: 'CUSTOMER_RECEIPTS_INSUFFICIENT' },
    lawyer: { state: 'EXEMPT', reason: 'EXPLICIT_ZERO_CLOSURE_AMOUNT' },
    persist,
  });
  return { service, tx, transaction, access, organization, scope, persist };
}
describe('CaseArchiveReadinessService', () => {
  beforeEach(() => jest.clearAllMocks());
  it.each(['55P03', '40P01', '40001'])(
    'reports a transient readiness lock conflict %s as 409',
    async (code) => {
      const f = fixture();
      f.transaction.mockRejectedValue({
        code: 'P2010',
        meta: { driverAdapterError: { cause: { originalCode: code } } },
      });
      await expect(f.service.read(actor, id)).rejects.toMatchObject({
        status: 409,
        response: { code: 'ARCHIVE_READINESS_BUSY' },
      });
      expect(f.transaction).toHaveBeenCalledTimes(1);
      expect(f.persist).not.toHaveBeenCalled();
    },
  );
  it.each([undefined, id])(
    'uses the actual same-transaction archive authorization and preparation for lawyer %s',
    async (lawyerAccountId) => {
      const f = fixture();
      const identity = {
        ...actor,
        ...(lawyerAccountId ? { lawyerAccountId } : {}),
      };
      const result = await f.service.read(identity, id);
      expect(f.transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      expect(lockArchiveCaseScopeDraft).toHaveBeenCalledWith(
        f.tx,
        identity,
        id,
        f.access,
        f.organization,
      );
      expect(prepareArchiveFinancialDraft).toHaveBeenCalledWith(
        f.tx,
        identity,
        f.scope,
      );
      expect(result).toEqual({
        caseVersion: 7,
        closureVersionId: id,
        checkedAt: expect.any(String),
        state: 'UNKNOWN',
        checks: {
          payment: { state: 'PASSED', reason: 'CLOSURE_PAYMENT_REACHED' },
          refund: { state: 'UNKNOWN', reason: 'REFUND_INVENTORY_MISSING' },
          customer: {
            state: 'BLOCKED',
            reason: 'CUSTOMER_RECEIPTS_INSUFFICIENT',
          },
          lawyer: { state: 'EXEMPT', reason: 'EXPLICIT_ZERO_CLOSURE_AMOUNT' },
        },
      });
      expect(Number.isNaN(Date.parse(result.checkedAt))).toBe(false);
      expect(f.persist).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain('persist');
    },
  );
  it('does not read source facts after authorization denial', async () => {
    const f = fixture();
    jest
      .mocked(lockArchiveCaseScopeDraft)
      .mockRejectedValue(new Error('ACTION_FORBIDDEN'));
    await expect(f.service.read(actor, id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(f.tx.case.findUnique).not.toHaveBeenCalled();
    expect(prepareArchiveFinancialDraft).not.toHaveBeenCalled();
  });
  it('does not evaluate already archived cases or alter historical behavior', async () => {
    const f = fixture();
    f.tx.case.findUnique.mockResolvedValue({
      version: 7,
      stage: 'ARCHIVED',
      closure: { currentVersionId: id },
      archive: null,
    });
    await expect(f.service.read(actor, id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prepareArchiveFinancialDraft).not.toHaveBeenCalled();
    expect(f.persist).not.toHaveBeenCalled();
  });
  it('fails closed when source preparation cannot establish readiness', async () => {
    const f = fixture();
    jest
      .mocked(prepareArchiveFinancialDraft)
      .mockRejectedValue(new Error('ARCHIVE_FINANCIAL_SOURCE_UNKNOWN'));
    await expect(f.service.read(actor, id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(f.persist).not.toHaveBeenCalled();
  });
});
