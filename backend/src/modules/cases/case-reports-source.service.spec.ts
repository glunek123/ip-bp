import { ArgumentsHost, ForbiddenException, Logger } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { HttpExceptionFilter } from '../../common/http-exception.filter';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import { CaseReportsSourceService } from './case-reports-source.service';

const actor = {
  userId: 'user',
  departmentId: 'department',
  authorizationRevision: 3,
};
type Row = {
  complaintSubmittedAt: Date | null;
  complaintAmountState: 'KNOWN' | 'PENDING' | null;
  complaintAmount: Prisma.Decimal | null;
  complaintConfirmation: {
    amountState: 'KNOWN' | 'PENDING';
    amount: Prisma.Decimal | null;
  } | null;
};
const known = (): Row => ({
  complaintSubmittedAt: new Date('2026-10-01T00:00:00Z'),
  complaintAmountState: 'KNOWN',
  complaintAmount: new Prisma.Decimal('999.00'),
  complaintConfirmation: null,
});
function fixture(
  account = { active: true, accountType: 'INTERNAL', authorizationRevision: 3 },
) {
  const tx = {
    userAccount: { findUnique: jest.fn().mockResolvedValue(account) },
    case: {
      count: jest.fn().mockResolvedValue(8),
      findMany: jest.fn().mockResolvedValue([known()]),
    },
  };
  const database = {
    $transaction: jest.fn(
      (
        run: (reader: typeof tx) => Promise<unknown>,
        options: { isolationLevel: string; timeout: number },
      ) => {
        void options;
        return run(tx);
      },
    ),
  };
  const access = {
    authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
  };
  return {
    tx,
    database,
    access,
    service: new CaseReportsSourceService(
      database as unknown as DatabaseService,
      access as unknown as AccessControlService,
    ),
  };
}

describe('CaseReportsSourceService', () => {
  it.each([
    {
      name: 'missing grant',
      snapshot: { active: true, authorizationRevision: 3, grants: [] },
    },
    { name: 'inactive membership', snapshot: null },
  ])('normalizes real ACL rejection: $name', async ({ snapshot }) => {
    const { database, tx } = fixture();
    const loadSnapshot = jest.fn().mockResolvedValue(snapshot);
    const realAccess = new AccessControlService({ loadSnapshot });
    // Reproduce the real lower-layer class and payload, not the desired report code.
    await expect(
      realAccess.authorizeDepartmentAction(actor, 'case.read'),
    ).rejects.toMatchObject({
      response: { code: 'CUSTOMER_ACTION_FORBIDDEN' },
    });
    const service = new CaseReportsSourceService(
      database as unknown as DatabaseService,
      realAccess,
    );
    await expect(service.canRead(actor)).resolves.toBe(false);
    await expect(service.snapshot(actor)).rejects.toMatchObject({
      status: 403,
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(loadSnapshot).toHaveBeenLastCalledWith(
      actor.userId,
      actor.departmentId,
      tx,
    );
    expect(tx.case.count).not.toHaveBeenCalled();
    expect(tx.case.findMany).not.toHaveBeenCalled();
  });

  it('preserves non-forbidden ACL failures without disguising them as denial', async () => {
    const { service, tx, access } = fixture();
    const failure = new Error('simulated access store failure');
    access.authorizeDepartmentAction.mockRejectedValue(failure);
    await expect(service.canRead(actor)).rejects.toBe(failure);
    await expect(service.snapshot(actor)).rejects.toBe(failure);
    expect(tx.case.count).not.toHaveBeenCalled();
    expect(tx.case.findMany).not.toHaveBeenCalled();
  });

  it('uses the shared filter public INTERNAL_ERROR for damaged report sources', async () => {
    const { service, tx } = fixture();
    tx.case.findMany.mockResolvedValue([{ ...known(), complaintAmount: null }]);
    const failure: unknown = await service.snapshot(actor).then(
      () => {
        throw new Error('Expected a damaged report source');
      },
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({
      response: { code: 'REPORT_SOURCE_INVALID' },
    });
    const json = jest.fn();
    const response = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnValue({ json }),
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          requestId: 'report-request',
          method: 'GET',
          url: '/api/v1/reports/overview',
        }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      new HttpExceptionFilter().catch(failure, host);
      expect(response.status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({
        code: 'INTERNAL_ERROR',
        message: '服务内部错误',
        requestId: 'report-request',
      });
    } finally {
      log.mockRestore();
    }
  });

  it('authorizes before any case read and keeps total and all archived facts in one repeatable snapshot', async () => {
    const { service, tx, access, database } = fixture();
    tx.case.findMany.mockResolvedValue([
      {
        ...known(),
        complaintConfirmation: { amountState: 'PENDING', amount: null },
      },
      known(),
      {
        complaintSubmittedAt: null,
        complaintAmountState: null,
        complaintAmount: null,
        complaintConfirmation: null,
      },
      {
        ...known(),
        complaintConfirmation: {
          amountState: 'KNOWN',
          amount: new Prisma.Decimal('30'),
        },
      },
    ]);
    const result = await service.snapshot(actor);
    expect(result).toMatchObject({
      totalCases: 8,
      inProgressCases: 4,
      archivedClaims: [
        { state: 'PENDING', amount: null },
        { state: 'KNOWN', amount: '999.00' },
        { state: 'UNRECORDED', amount: null },
        { state: 'KNOWN', amount: '30.00' },
      ],
    });
    expect(new Date(result.generatedAt).toISOString()).toBe(result.generatedAt);
    expect(database.$transaction).toHaveBeenCalledTimes(1);
    expect(database.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'RepeatableRead',
      timeout: 15000,
    });
    expect(access.authorizeDepartmentAction).toHaveBeenCalledWith(
      actor,
      'case.read',
      tx,
    );
    expect(
      access.authorizeDepartmentAction.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.case.count.mock.invocationCallOrder[0]);
    expect(tx.case.count).toHaveBeenCalledWith({
      where: { departmentId: actor.departmentId },
    });
    expect(tx.case.findMany.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        where: { departmentId: actor.departmentId, stage: 'ARCHIVED' },
      }),
    );
    expect(tx.case.findMany.mock.calls[0][0]).not.toHaveProperty('take');
  });

  it('reads capability without reading any cases', async () => {
    const { service, tx } = fixture();
    await expect(service.canRead(actor)).resolves.toBe(true);
    expect(tx.case.count).not.toHaveBeenCalled();
    expect(tx.case.findMany).not.toHaveBeenCalled();
  });

  it.each([
    { clientCustomerId: 'customer' },
    { lawyerAccountId: actor.userId },
    { notaryOfficeId: 'office' },
  ])(
    'rejects external actor contexts even with an internal-looking account',
    async (external) => {
      const { service, tx, access } = fixture();
      await expect(service.canRead({ ...actor, ...external })).resolves.toBe(
        false,
      );
      await expect(service.snapshot({ ...actor, ...external })).rejects.toThrow(
        ForbiddenException,
      );
      expect(tx.case.count).not.toHaveBeenCalled();
      expect(access.authorizeDepartmentAction).not.toHaveBeenCalled();
    },
  );

  it.each([
    { active: false, accountType: 'INTERNAL', authorizationRevision: 3 },
    { active: true, accountType: 'CLIENT', authorizationRevision: 3 },
    { active: true, accountType: 'LAWYER', authorizationRevision: 3 },
    { active: true, accountType: 'INTERNAL', authorizationRevision: 4 },
  ])(
    'rejects inactive, non-internal or stale accounts before reading counts',
    async (account) => {
      const { service, tx } = fixture(account);
      await expect(service.snapshot(actor)).rejects.toThrow(ForbiddenException);
      expect(tx.case.count).not.toHaveBeenCalled();
      expect(tx.case.findMany).not.toHaveBeenCalled();
    },
  );

  it('does not substitute an account role for a current department case.read grant', async () => {
    const { service, tx, access } = fixture();
    access.authorizeDepartmentAction.mockRejectedValue(
      new ForbiddenException({ code: 'ACTION_FORBIDDEN' }),
    );
    await expect(service.canRead(actor)).resolves.toBe(false);
    await expect(service.snapshot(actor)).rejects.toThrow(ForbiddenException);
    expect(tx.case.count).not.toHaveBeenCalled();
  });

  it('rechecks the account and grant on the next read', async () => {
    const { service, tx } = fixture();
    await service.snapshot(actor);
    tx.userAccount.findUnique.mockResolvedValue({
      active: true,
      accountType: 'INTERNAL',
      authorizationRevision: 4,
    });
    await expect(service.snapshot(actor)).rejects.toThrow(ForbiddenException);
    expect(tx.case.findMany).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...known(), complaintAmount: null },
    {
      ...known(),
      complaintAmountState: 'PENDING',
      complaintAmount: new Prisma.Decimal('0'),
    },
    { ...known(), complaintAmount: new Prisma.Decimal('-1') },
    { ...known(), complaintAmount: new Prisma.Decimal('0.001') },
    { ...known(), complaintAmount: new Prisma.Decimal('NaN') },
    { ...known(), complaintSubmittedAt: null },
  ])(
    'fails damaged sources rather than silently excluding them',
    async (row) => {
      const { service, tx } = fixture();
      tx.case.findMany.mockResolvedValue([row]);
      await expect(service.snapshot(actor)).rejects.toMatchObject({
        response: { code: 'REPORT_SOURCE_INVALID' },
      });
    },
  );

  it('rejects impossible cohort counts rather than publishing mixed totals', async () => {
    const { service, tx } = fixture();
    tx.case.count.mockResolvedValue(0);
    await expect(service.snapshot(actor)).rejects.toMatchObject({
      response: { code: 'REPORT_SOURCE_INVALID' },
    });
  });
});
