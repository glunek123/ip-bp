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
    filingCourt: { findMany: jest.fn().mockResolvedValue([]) },
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
    buildReportScope: jest.fn().mockResolvedValue({
      view: 'department',
      availableViews: ['mine', 'department'],
      where: { departmentId: actor.departmentId },
    }),
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
  const courtId = (n: number) =>
    '00000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
  const centerRow = (id: string, stage = 'ARCHIVED') => ({
    ...known(),
    id,
    departmentId: actor.departmentId,
    responsibleUserId: actor.userId,
    customerId: 'customer',
    rightsHolderId: 'holder',
    stage,
    sourceLeadId: 'lead-' + id,
    sourceNotaryMatterId: 'matter-' + id,
    certificateId: 'certificate-' + id,
    customer: { id: 'customer', departmentId: actor.departmentId },
    rightsHolder: { id: 'holder', departmentId: actor.departmentId },
    sourceLead: {
      id: 'lead-' + id,
      departmentId: actor.departmentId,
      customerId: 'customer',
      rightsHolderId: 'holder',
      caseType: 'CIVIL',
      platform: 'TMALL',
    },
    sourceNotaryMatter: {
      id: 'matter-' + id,
      departmentId: actor.departmentId,
      customerId: 'customer',
      rightsHolderId: 'holder',
      sourceLeadId: 'lead-' + id,
    },
    externalEntry: null,
    acceptance: null,
    filingSubmission: null,
  });
  const externalRow = (id: string, court: string | null = null) => ({
    ...centerRow(id),
    sourceLeadId: null,
    sourceNotaryMatterId: null,
    certificateId: null,
    sourceLead: null,
    sourceNotaryMatter: null,
    externalEntry: {
      caseId: id,
      departmentId: actor.departmentId,
      known: { caseType: 'CRIMINAL', platform: 'JD', courtId: court },
    },
  });

  it('center snapshot reads the complete authorized cohort and effective court sources in one transaction', async () => {
    const { service, tx, access, database } = fixture();
    tx.case.findMany.mockResolvedValue([
      {
        ...centerRow('a'),
        acceptance: {
          caseId: 'a',
          departmentId: actor.departmentId,
          courtId: courtId(1),
          court: {
            id: courtId(1),
            departmentId: actor.departmentId,
            name: '受理法院',
          },
        },
        filingSubmission: {
          caseId: 'a',
          departmentId: actor.departmentId,
          courtId: courtId(2),
          courtName: '旧提交法院',
        },
      },
      {
        ...centerRow('b', 'WAITING_COMPLAINT'),
        filingSubmission: {
          caseId: 'b',
          departmentId: actor.departmentId,
          courtId: courtId(2),
          courtName: '提交法院',
        },
      },
      {
        ...externalRow('c', courtId(3).toUpperCase()),
        complaintConfirmation: { amountState: 'PENDING', amount: null },
      },
      {
        ...externalRow('d'),
        stage: 'WAITING_COMPLAINT',
        externalEntry: {
          caseId: 'd',
          departmentId: actor.departmentId,
          known: { caseType: null, platform: null, courtId: null },
        },
      },
    ]);
    tx.filingCourt.findMany.mockResolvedValue([
      { id: courtId(3), departmentId: actor.departmentId, name: '登记法院' },
    ]);
    await expect(service.centerSnapshot(actor)).resolves.toMatchObject({
      totalCases: 4,
      inProgressCases: 2,
      archivedClaims: [
        { state: 'KNOWN', amount: '999.00' },
        { state: 'PENDING', amount: null },
      ],
      distributionCases: [
        {
          caseType: 'CIVIL',
          platform: 'TMALL',
          court: { id: courtId(1), name: '受理法院' },
        },
        {
          caseType: 'CIVIL',
          platform: 'TMALL',
          court: { id: courtId(2), name: '提交法院' },
        },
        {
          caseType: 'CRIMINAL',
          platform: 'JD',
          court: { id: courtId(3), name: '登记法院' },
        },
        { caseType: null, platform: null, court: null },
      ],
    });
    expect(database.$transaction).toHaveBeenCalledTimes(1);
    expect(database.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'RepeatableRead',
      timeout: 15000,
    });
    expect(tx.case.count).not.toHaveBeenCalled();
    const query = tx.case.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ departmentId: actor.departmentId });
    expect(query).not.toHaveProperty('take');
    expect(query).not.toHaveProperty('skip');
    expect(access.buildReportScope.mock.invocationCallOrder[0]).toBeLessThan(
      tx.case.findMany.mock.invocationCallOrder[0],
    );
    expect(tx.filingCourt.findMany).toHaveBeenCalledWith({
      where: { departmentId: actor.departmentId, id: { in: [courtId(3)] } },
      select: { id: true, name: true, departmentId: true },
    });
  });

  it('center snapshot permits an intentionally unknown acceptance court to fall back to its effective submission', async () => {
    const { service, tx } = fixture();
    tx.case.findMany.mockResolvedValue([
      {
        ...centerRow('a'),
        acceptance: {
          caseId: 'a',
          departmentId: actor.departmentId,
          courtId: null,
          court: null,
        },
        filingSubmission: {
          caseId: 'a',
          departmentId: actor.departmentId,
          courtId: courtId(2),
          courtName: '提交法院',
        },
      },
    ]);
    const snapshot = await service.centerSnapshot(actor);
    expect(snapshot.distributionCases[0].court).toEqual({
      id: courtId(2),
      name: '提交法院',
    });
    expect(tx.filingCourt.findMany).not.toHaveBeenCalled();
  });

  it('center snapshot blocks ACL rejection before any collection or court query', async () => {
    const { service, tx, access } = fixture();
    access.buildReportScope.mockRejectedValue(
      new ForbiddenException({ code: 'CUSTOMER_ACTION_FORBIDDEN' }),
    );
    await expect(service.centerSnapshot(actor)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(tx.case.findMany).not.toHaveBeenCalled();
    expect(tx.filingCourt.findMany).not.toHaveBeenCalled();
  });

  it('center snapshot represents a genuine empty cohort without any directory query', async () => {
    const { service, tx } = fixture();
    tx.case.findMany.mockResolvedValue([]);
    await expect(service.centerSnapshot(actor)).resolves.toMatchObject({
      totalCases: 0,
      inProgressCases: 0,
      archivedClaims: [],
      distributionCases: [],
    });
    expect(tx.filingCourt.findMany).not.toHaveBeenCalled();
  });

  it.each([
    { ...centerRow('bad'), departmentId: 'other' },
    {
      ...centerRow('bad'),
      externalEntry: {
        caseId: 'bad',
        departmentId: actor.departmentId,
        known: { caseType: null, platform: null, courtId: null },
      },
    },
    {
      ...centerRow('bad'),
      sourceLead: { ...centerRow('bad').sourceLead, customerId: 'other' },
    },
    {
      ...centerRow('bad'),
      sourceLead: { ...centerRow('bad').sourceLead, caseType: 'UNAPPROVED' },
    },
    {
      ...externalRow('bad'),
      externalEntry: {
        caseId: 'bad',
        departmentId: actor.departmentId,
        known: { platform: null, courtId: null },
      },
    },
    {
      ...centerRow('bad'),
      acceptance: {
        caseId: 'bad',
        departmentId: actor.departmentId,
        courtId: courtId(1),
        court: null,
      },
    },
  ])(
    'center snapshot rejects contradictory origins, malformed dimensions and broken preferred court facts',
    async (row) => {
      const { service, tx } = fixture();
      tx.case.findMany.mockResolvedValue([row]);
      await expect(service.centerSnapshot(actor)).rejects.toMatchObject({
        response: { code: 'REPORT_SOURCE_INVALID' },
      });
    },
  );

  it.each([
    { courts: [] },
    { courts: [{ id: courtId(3), name: '越界法院', departmentId: 'other' }] },
    {
      courts: [
        {
          id: courtId(4),
          name: '未请求法院',
          departmentId: actor.departmentId,
        },
      ],
    },
  ])(
    'center snapshot does not turn an invalid registered court into an unrecorded court',
    async ({ courts }) => {
      const { service, tx } = fixture();
      tx.case.findMany.mockResolvedValue([externalRow('a', courtId(3))]);
      tx.filingCourt.findMany.mockResolvedValue(courts);
      await expect(service.centerSnapshot(actor)).rejects.toMatchObject({
        response: { code: 'REPORT_SOURCE_INVALID' },
      });
    },
  );

  it('center snapshot rejects duplicate source rows rather than double-counting a case', async () => {
    const { service, tx } = fixture();
    tx.case.findMany.mockResolvedValue([centerRow('a'), centerRow('a')]);
    await expect(service.centerSnapshot(actor)).rejects.toMatchObject({
      response: { code: 'REPORT_SOURCE_INVALID' },
    });
  });

  describe('reports center real scope integration', () => {
    it('exports stages and money from the caller reader with export authorization and no nested transaction', async () => {
      const { service, tx, access, database } = fixture();
      tx.case.findMany.mockResolvedValue([
        centerRow('a'),
        centerRow('b', 'WAITING_COMPLAINT'),
        centerRow('c', 'WAITING_COMPLAINT'),
      ]);
      const result = await service.exportSnapshot(
        actor,
        'department',
        tx as unknown as Prisma.TransactionClient,
      );
      expect(result.stageCounts).toEqual([
        { value: 'WAITING_COMPLAINT', count: 2 },
        { value: 'ARCHIVED', count: 1 },
      ]);
      expect(result.totalCases).toBe(3);
      expect(result.allClaims).toHaveLength(3);
      expect(access.buildReportScope).toHaveBeenCalledWith(
        actor,
        'department',
        'export',
        tx,
      );
      expect(database.$transaction).not.toHaveBeenCalled();
    });
    it('keeps a read-only money grant from entering the caller-reader export snapshot', async () => {
      const { database, tx } = fixture();
      const access = new AccessControlService({
        loadSnapshot: jest.fn().mockResolvedValue({
          active: true,
          authorizationRevision: 3,
          grants: [
            { action: 'case.read', scope: 'department' },
            { action: 'report.amount.read', scope: 'department' },
          ],
        }),
      });
      const service = new CaseReportsSourceService(
        database as unknown as DatabaseService,
        access,
      );
      await expect(
        service.exportSnapshot(
          actor,
          'mine',
          tx as unknown as Prisma.TransactionClient,
        ),
      ).rejects.toMatchObject({
        status: 403,
        response: { code: 'ACTION_FORBIDDEN' },
      });
      expect(tx.case.findMany).not.toHaveBeenCalled();
      expect(database.$transaction).not.toHaveBeenCalled();
    });
    function authorized(amount: 'self' | 'department' | null) {
      const f = fixture();
      const grants = [
        { action: 'case.read' as const, scope: 'department' as const },
        ...(amount
          ? [{ action: 'report.amount.read' as const, scope: amount }]
          : []),
        { action: 'report.export' as const, scope: 'department' as const },
      ];
      const loadSnapshot = jest
        .fn()
        .mockResolvedValue({ active: true, authorizationRevision: 3, grants });
      const access = new AccessControlService({ loadSnapshot });
      f.tx.case.findMany.mockResolvedValue([centerRow('own')]);
      return {
        ...f,
        loadSnapshot,
        service: new CaseReportsSourceService(
          f.database as unknown as DatabaseService,
          access,
        ),
      };
    }
    it('keeps legacy overview and explicit department center closed when only self amount is granted, despite department export', async () => {
      const { service, tx, loadSnapshot } = authorized('self');
      await expect(service.canRead(actor)).resolves.toBe(true);
      await expect(service.snapshot(actor)).rejects.toMatchObject({
        status: 403,
        response: { code: 'ACTION_FORBIDDEN' },
      });
      await expect(
        service.centerSnapshot(actor, 'department'),
      ).rejects.toMatchObject({
        status: 403,
        response: { code: 'ACTION_FORBIDDEN' },
      });
      expect(tx.case.count).not.toHaveBeenCalled();
      expect(tx.case.findMany).not.toHaveBeenCalled();
      expect(tx.filingCourt.findMany).not.toHaveBeenCalled();
      expect(loadSnapshot).toHaveBeenLastCalledWith(
        actor.userId,
        actor.departmentId,
        tx,
      );
    });
    it('uses one shared mine predicate and snapshot for every money/distribution fact, with export still closed', async () => {
      const { service, tx, loadSnapshot } = authorized('self');
      await expect(service.centerSnapshot(actor)).resolves.toMatchObject({
        view: 'mine',
        availableViews: ['mine'],
        exportViews: [],
        totalCases: 1,
        allClaims: [{ state: 'KNOWN', amount: '999.00' }],
        archivedClaims: [{ state: 'KNOWN', amount: '999.00' }],
        distributionCases: [
          { caseType: 'CIVIL', platform: 'TMALL', court: null },
        ],
      });
      expect(tx.case.findMany.mock.calls[0][0].where).toEqual({
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
      });
      expect(loadSnapshot).toHaveBeenCalledTimes(1);
      expect(loadSnapshot).toHaveBeenCalledWith(
        actor.userId,
        actor.departmentId,
        tx,
      );
    });
    it('reads the full department and exposes the two ordered views only when department amount is granted', async () => {
      const { service, tx } = authorized('department');
      await expect(service.centerSnapshot(actor)).resolves.toMatchObject({
        view: 'department',
        availableViews: ['mine', 'department'],
        exportViews: [],
      });
      expect(tx.case.findMany.mock.calls[0][0].where).toEqual({
        departmentId: actor.departmentId,
      });
    });
    it('does not infer a report amount permission from case.read or report.export', async () => {
      const { service, tx } = authorized(null);
      await expect(service.canRead(actor)).resolves.toBe(false);
      await expect(service.centerSnapshot(actor)).rejects.toMatchObject({
        status: 403,
        response: { code: 'ACTION_FORBIDDEN' },
      });
      await expect(service.snapshot(actor)).rejects.toThrow(ForbiddenException);
      expect(tx.case.findMany).not.toHaveBeenCalled();
    });
    it('rechecks grants rather than caching a previous successful capability or center', async () => {
      const { service, tx, loadSnapshot } = authorized('self');
      await service.centerSnapshot(actor, 'mine');
      loadSnapshot.mockResolvedValue({
        active: true,
        authorizationRevision: 3,
        grants: [{ action: 'case.read', scope: 'department' }],
      });
      await expect(service.centerSnapshot(actor, 'mine')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.canRead(actor)).resolves.toBe(false);
      expect(tx.case.findMany).toHaveBeenCalledTimes(1);
    });
    it('rejects a non-owner returned to a mine query without publishing any of its facts', async () => {
      const { service, tx } = authorized('self');
      tx.case.findMany.mockResolvedValue([
        { ...centerRow('not-own'), responsibleUserId: 'other-user' },
      ]);
      await expect(service.centerSnapshot(actor, 'mine')).rejects.toMatchObject(
        { status: 500, response: { code: 'REPORT_SOURCE_INVALID' } },
      );
      expect(tx.filingCourt.findMany).not.toHaveBeenCalled();
    });
  });

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
    access.buildReportScope.mockRejectedValue(failure);
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
    expect(access.buildReportScope).toHaveBeenCalledWith(
      actor,
      'department',
      'read',
      tx,
    );
    expect(access.buildReportScope.mock.invocationCallOrder[0]).toBeLessThan(
      tx.case.count.mock.invocationCallOrder[0],
    );
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
      expect(access.buildReportScope).not.toHaveBeenCalled();
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
    access.buildReportScope.mockRejectedValue(
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
