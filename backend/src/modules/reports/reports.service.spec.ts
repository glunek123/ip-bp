import { ForbiddenException } from '@nestjs/common';
import { CaseReportsSourceService, CaseReportsSnapshot } from '../cases';
import type { ReportView } from '../../access-control/access-control.service';
import { ReportsService, reportsCsv } from './reports.service';
import {
  AccessControlService,
  AccessControlSnapshot,
} from '../../access-control/access-control.service';
import { Prisma } from '../../generated/prisma/client';
import { DatabaseService } from '../../database/database.service';
import { CustomerReportsSourceService } from '../customers';
import { NotaryReportsSourceService } from '../leads';

const actor = {
  userId: 'user',
  departmentId: 'department',
  authorizationRevision: 3,
};
const base: CaseReportsSnapshot = {
  generatedAt: '2026-10-21T08:00:00.000Z',
  totalCases: 5,
  inProgressCases: 3,
  archivedClaims: [
    { state: 'KNOWN', amount: '1000' },
    { state: 'KNOWN', amount: '3000' },
  ],
};
function compose(source: unknown) {
  const tx = {};
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
  const customers = {
    assertExportable: jest
      .fn()
      .mockRejectedValue(new ForbiddenException({ code: 'ACTION_FORBIDDEN' })),
    count: jest.fn().mockResolvedValue(12),
  };
  const notaries = {
    assertExportable: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(5),
  };
  return {
    tx,
    database,
    customers,
    notaries,
    service: new ReportsService(
      source as CaseReportsSourceService,
      database as unknown as DatabaseService,
      customers as unknown as CustomerReportsSourceService,
      notaries as unknown as NotaryReportsSourceService,
    ),
  };
}
function fixture(snapshot: CaseReportsSnapshot = base) {
  const source = {
    canRead: jest.fn().mockResolvedValue(true),
    snapshot: jest.fn().mockResolvedValue(snapshot),
  };
  return {
    source,
    ...compose(source),
  };
}
describe('ReportsService', () => {
  describe('reports cross-domain real authorization integration', () => {
    const grants: AccessControlSnapshot['grants'] = [
      { action: 'case.read', scope: 'department' },
      { action: 'report.amount.read', scope: 'department' },
      { action: 'report.export', scope: 'department' },
      { action: 'customer.read', scope: 'department' },
      { action: 'lead.read', scope: 'department' },
    ];
    function realFixture(rights = grants) {
      const row = (
        id: string,
        stage: 'ARCHIVED' | 'WAITING_COMPLAINT',
        amount: string | null,
      ) => ({
        id,
        stage,
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
        customerId: 'customer',
        rightsHolderId: 'holder',
        customer: { id: 'customer', departmentId: actor.departmentId },
        rightsHolder: { id: 'holder', departmentId: actor.departmentId },
        sourceLeadId: null,
        sourceNotaryMatterId: null,
        certificateId: null,
        sourceLead: null,
        sourceNotaryMatter: null,
        externalEntry: {
          caseId: id,
          departmentId: actor.departmentId,
          known: { caseType: 'CIVIL', platform: 'JD', courtId: null },
        },
        acceptance: null,
        filingSubmission: null,
        complaintSubmittedAt: new Date('2026-10-20T00:00:00Z'),
        complaintAmountState: amount === null ? 'PENDING' : 'KNOWN',
        complaintAmount: amount === null ? null : new Prisma.Decimal(amount),
        complaintConfirmation: null,
      });
      const tx = {
        userAccount: {
          findUnique: jest.fn().mockResolvedValue({
            active: true,
            accountType: 'INTERNAL',
            authorizationRevision: 3,
          }),
        },
        case: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              row('a', 'ARCHIVED', '100.10'),
              row('b', 'WAITING_COMPLAINT', null),
            ]),
        },
        filingCourt: { findMany: jest.fn().mockResolvedValue([]) },
        customer: { count: jest.fn().mockResolvedValue(12) },
        notaryMatter: { count: jest.fn().mockResolvedValue(5) },
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
      const loadSnapshot = jest.fn().mockResolvedValue({
        active: true,
        authorizationRevision: 3,
        grants: rights,
      });
      const access = new AccessControlService({ loadSnapshot });
      const cases = new CaseReportsSourceService(
        database as unknown as DatabaseService,
        access,
      );
      const customers = new CustomerReportsSourceService(access),
        notaries = new NotaryReportsSourceService(access);
      return {
        tx,
        database,
        loadSnapshot,
        service: new ReportsService(
          cases,
          database as unknown as DatabaseService,
          customers,
          notaries,
        ),
      };
    }
    it('exposes ordered export views without counting foreign domains, then exports all true sources in one caller RR transaction', async () => {
      const { service, tx, database, loadSnapshot } = realFixture();
      await expect(service.center(actor)).resolves.toMatchObject({
        view: 'department',
        exportViews: ['mine', 'department'],
      });
      expect(tx.customer.count).not.toHaveBeenCalled();
      expect(tx.notaryMatter.count).not.toHaveBeenCalled();
      database.$transaction.mockClear();
      const result = await service.export(actor, 'department');
      expect(result.csv).toContain('"案件总数","2"');
      expect(result.csv).toContain('"客户总数","12"');
      expect(result.csv).toContain('"公证在办","5"');
      expect(result.csv).toContain('"累计标的额","100.10"');
      expect(database.$transaction).toHaveBeenCalledTimes(1);
      expect(database.$transaction.mock.calls[0][1]).toEqual({
        isolationLevel: 'RepeatableRead',
        timeout: 15000,
      });
      for (const call of loadSnapshot.mock.calls)
        expect(call).toEqual([actor.userId, actor.departmentId, tx]);
      expect(tx.customer.count).toHaveBeenCalledWith({
        where: { departmentId: actor.departmentId, deletedAt: null },
      });
      expect(tx.notaryMatter.count).toHaveBeenCalledWith({
        where: {
          departmentId: actor.departmentId,
          stage: { not: 'ARCHIVED' },
          sourceLead: { departmentId: actor.departmentId },
        },
      });
      expect(Object.keys(tx)).toEqual([
        'userAccount',
        'case',
        'filingCourt',
        'customer',
        'notaryMatter',
      ]);
    });
    it.each([
      'case.read',
      'report.amount.read',
      'report.export',
      'customer.read',
      'lead.read',
    ] as const)(
      'denies export without %s before any source data read',
      async (action) => {
        const { service, tx } = realFixture(
          grants.filter((grant) => grant.action !== action),
        );
        await expect(service.export(actor, 'department')).rejects.toMatchObject(
          { status: 403, response: { code: 'ACTION_FORBIDDEN' } },
        );
        expect(tx.case.findMany).not.toHaveBeenCalled();
        expect(tx.customer.count).not.toHaveBeenCalled();
        expect(tx.notaryMatter.count).not.toHaveBeenCalled();
      },
    );
    it.each(['customer.read', 'lead.read'] as const)(
      'keeps a SELF %s domain from enabling the department button or POST, while mine stays authorized',
      async (action) => {
        const rights = grants.map((grant) =>
          grant.action === action
            ? { ...grant, scope: 'self' as const }
            : grant,
        );
        const { service, tx } = realFixture(rights);
        await expect(service.center(actor)).resolves.toMatchObject({
          view: 'department',
          exportViews: ['mine'],
        });
        tx.case.findMany.mockClear();
        await expect(service.export(actor, 'department')).rejects.toMatchObject(
          { status: 403, response: { code: 'ACTION_FORBIDDEN' } },
        );
        expect(tx.case.findMany).not.toHaveBeenCalled();
        await expect(service.export(actor, 'mine')).resolves.toHaveProperty(
          'csv',
        );
        expect(tx.case.findMany.mock.calls[0][0].where).toEqual({
          departmentId: actor.departmentId,
          responsibleUserId: actor.userId,
        });
      },
    );
    it.each(['report.amount.read', 'report.export'] as const)(
      'does not combine SELF %s with other department grants into a department export',
      async (action) => {
        const { service } = realFixture(
          grants.map((grant) =>
            grant.action === action
              ? { ...grant, scope: 'self' as const }
              : grant,
          ),
        );
        await expect(service.center(actor, 'mine')).resolves.toMatchObject({
          exportViews: ['mine'],
        });
        await expect(service.export(actor, 'department')).rejects.toMatchObject(
          { status: 403, response: { code: 'ACTION_FORBIDDEN' } },
        );
        await expect(service.export(actor, 'mine')).resolves.toHaveProperty(
          'csv',
        );
      },
    );
    it('rechecks revoked export grants instead of trusting a previous center capability', async () => {
      const { service, loadSnapshot, tx } = realFixture();
      await expect(service.center(actor)).resolves.toMatchObject({
        exportViews: ['mine', 'department'],
      });
      loadSnapshot.mockResolvedValue({
        active: true,
        authorizationRevision: 3,
        grants: grants.filter((grant) => grant.action !== 'report.export'),
      });
      await expect(service.center(actor)).resolves.toMatchObject({
        exportViews: [],
      });
      tx.case.findMany.mockClear();
      await expect(service.export(actor, 'mine')).rejects.toMatchObject({
        status: 403,
        response: { code: 'ACTION_FORBIDDEN' },
      });
      expect(tx.case.findMany).not.toHaveBeenCalled();
    });
    it('does not hide unexpected capability store failures as a disabled export button', async () => {
      const { service, loadSnapshot } = realFixture();
      const failure = new Error('unexpected scope store failure');
      loadSnapshot
        .mockResolvedValueOnce({
          active: true,
          authorizationRevision: 3,
          grants,
        })
        .mockRejectedValue(failure);
      await expect(service.center(actor)).rejects.toBe(failure);
    });
  });
  describe('reports CSV composition', () => {
    const exportBase = {
      ...base,
      view: 'mine',
      availableViews: ['mine'],
      exportViews: [],
      totalCases: 3,
      inProgressCases: 1,
      allClaims: [...base.archivedClaims, { state: 'PENDING', amount: null }],
      distributionCases: [
        { caseType: 'CIVIL', platform: 'JD', court: null },
        { caseType: 'CIVIL', platform: 'JD', court: null },
        { caseType: null, platform: null, court: null },
      ],
      stageCounts: [
        { value: 'WAITING_COMPLAINT', count: 1 },
        { value: 'ARCHIVED', count: 2 },
      ],
    };
    function csvFixture() {
      const source = {
        exportSnapshot: jest.fn().mockResolvedValue(exportBase),
      };
      const f = compose(source);
      f.customers.assertExportable.mockResolvedValue(undefined);
      return { ...f, source };
    }
    it('generates only Demo columns, two distributions and four summaries from one RR snapshot', async () => {
      const { service, source, database, tx, customers, notaries } =
        csvFixture();
      await expect(service.export(actor, 'mine')).resolves.toEqual({
        filename: '案件报表_2026-10-21.csv',
        csv:
          '\uFEFF"维度","项目","数值"\r\n' +
          '"阶段分布","待写诉状","1"\r\n"阶段分布","已归档","2"\r\n' +
          '"类型分布","民事","2"\r\n"类型分布","未登记","1"\r\n' +
          '"汇总","案件总数","3"\r\n"汇总","客户总数","12"\r\n' +
          '"汇总","累计标的额","4000.00"\r\n"汇总","公证在办","5"\r\n',
      });
      expect(database.$transaction).toHaveBeenCalledTimes(1);
      expect(database.$transaction.mock.calls[0][1]).toEqual({
        isolationLevel: 'RepeatableRead',
        timeout: 15000,
      });
      expect(source.exportSnapshot).toHaveBeenCalledWith(actor, 'mine', tx);
      expect(customers.count).toHaveBeenCalledWith(actor, 'mine', tx);
      expect(notaries.count).toHaveBeenCalledWith(actor, 'mine', tx);
      expect(
        notaries.assertExportable.mock.invocationCallOrder[0],
      ).toBeLessThan(source.exportSnapshot.mock.invocationCallOrder[0]);
    });
    it('does not replace an unknown aggregate with zero and preserves a real known zero', async () => {
      const { service, source } = csvFixture();
      const unknown = { state: 'PENDING', amount: null };
      source.exportSnapshot.mockResolvedValue({
        ...exportBase,
        allClaims: [unknown, unknown, unknown],
        archivedClaims: [unknown, unknown],
      });
      expect((await service.export(actor, 'mine')).csv).toContain(
        '"累计标的额","暂无数据"',
      );
      source.exportSnapshot.mockResolvedValue({
        ...exportBase,
        allClaims: [{ state: 'KNOWN', amount: '0' }, unknown, unknown],
        archivedClaims: [unknown, unknown],
      });
      expect((await service.export(actor, 'mine')).csv).toContain(
        '"累计标的额","0.00"',
      );
    });
    it('retains authorized empty summaries and uses the Shanghai calendar date of the snapshot', async () => {
      const { service, source, customers, notaries } = csvFixture();
      customers.count.mockResolvedValue(0);
      notaries.count.mockResolvedValue(0);
      source.exportSnapshot.mockResolvedValue({
        ...exportBase,
        generatedAt: '2026-10-21T16:30:00.000Z',
        totalCases: 0,
        inProgressCases: 0,
        allClaims: [],
        archivedClaims: [],
        distributionCases: [],
        stageCounts: [],
      });
      const result = await service.export(actor, 'mine');
      expect(result.filename).toBe('案件报表_2026-10-22.csv');
      expect(result.csv).toBe(
        '\uFEFF"维度","项目","数值"\r\n"汇总","案件总数","0"\r\n"汇总","客户总数","0"\r\n"汇总","累计标的额","暂无数据"\r\n"汇总","公证在办","0"\r\n',
      );
    });
    it.each(['customers', 'notaries'] as const)(
      'fails a missing %s permission before reading any aggregate',
      async (owner) => {
        const f = csvFixture();
        f[owner].assertExportable.mockRejectedValue(
          new ForbiddenException({ code: 'ACTION_FORBIDDEN' }),
        );
        await expect(f.service.export(actor, 'mine')).rejects.toMatchObject({
          status: 403,
          response: { code: 'ACTION_FORBIDDEN' },
        });
        expect(f.source.exportSnapshot).not.toHaveBeenCalled();
        expect(f.customers.count).not.toHaveBeenCalled();
        expect(f.notaries.count).not.toHaveBeenCalled();
      },
    );
    it('propagates a later owner-count failure without returning a partial CSV', async () => {
      const f = csvFixture();
      const failure = new Error('count failed');
      f.notaries.count.mockRejectedValue(failure);
      await expect(f.service.export(actor, 'mine')).rejects.toBe(failure);
    });
    it.each([
      {
        stageCounts: [
          { value: 'ARCHIVED', count: 3 },
          { value: 'ARCHIVED', count: 1 },
        ],
      },
      { stageCounts: [{ value: 'ARCHIVED', count: -1 }] },
      { stageCounts: [{ value: 'INVALID', count: 3 }] },
      { stageCounts: [{ value: 'ARCHIVED', count: 2 }] },
    ])(
      'rejects inconsistent stage distributions rather than exporting partial data',
      async ({ stageCounts }) => {
        const f = csvFixture();
        f.source.exportSnapshot.mockResolvedValue({
          ...exportBase,
          stageCounts,
        });
        await expect(f.service.export(actor, 'mine')).rejects.toMatchObject({
          status: 500,
          response: { code: 'REPORT_SOURCE_INVALID' },
        });
      },
    );
    it('retains BOM, CRLF, quote/comma/newline escaping and neutralizes spreadsheet formulas', () => {
      expect(
        reportsCsv([
          ['=1', '  +2', '\t@cmd'],
          ['a,b', '"quoted"', 'line1\r\nline2'],
        ]),
      ).toBe(
        '\uFEFF"维度","项目","数值"\r\n"\'=1","\'  +2","\'\t@cmd"\r\n"a,b","""quoted""","line1\r\nline2"\r\n',
      );
    });
  });
  describe('reports center', () => {
    const centerBase = {
      ...base,
      view: 'mine' as const,
      availableViews: ['mine'] as ReportView[],
      exportViews: [] as ReportView[],
      totalCases: 3,
      inProgressCases: 1,
      allClaims: [
        ...base.archivedClaims,
        { state: 'PENDING' as const, amount: null },
      ],
      distributionCases: [
        { caseType: 'CIVIL', platform: 'JD', court: null },
        { caseType: 'CIVIL', platform: 'JD', court: null },
        { caseType: null, platform: null, court: null },
      ],
    };
    function centerFixture(snapshot = centerBase) {
      const source = {
        centerSnapshotInTransaction: jest.fn().mockResolvedValue(snapshot),
      };
      return {
        source,
        ...compose(source),
      };
    }
    it('builds all center fields from the same authorized mine cohort and keeps average distinct from cumulative money', async () => {
      const { service, source } = centerFixture();
      await expect(service.center(actor, 'mine')).resolves.toEqual({
        metric: 'ARCHIVED_CASE_AVERAGE_CLAIM_AMOUNT',
        currency: 'CNY',
        period: 'ALL_TIME',
        definitionVersion: 'RP001-2',
        generatedAt: base.generatedAt,
        view: 'mine',
        scope: 'SELF',
        availableViews: ['mine'],
        exportViews: [],
        totalCases: 3,
        archivedCases: 2,
        inProgressCases: 1,
        status: 'VALUE',
        amount: '2000.00',
        reason: null,
        distributions: {
          types: [
            { value: 'CIVIL', count: 2 },
            { value: null, count: 1 },
          ],
          platforms: [
            { value: 'JD', count: 2 },
            { value: null, count: 1 },
          ],
          courts: [],
          unrecordedCourtCases: 3,
        },
        money: {
          total: { status: 'VALUE', amount: '4000.00' },
          knownCases: 2,
          unknownCases: 1,
          buckets: [
            { lowerInclusive: '0.00', upperExclusive: '100000.00', count: 2 },
            {
              lowerInclusive: '100000.00',
              upperExclusive: '300000.00',
              count: 0,
            },
            {
              lowerInclusive: '300000.00',
              upperExclusive: '500000.00',
              count: 0,
            },
            { lowerInclusive: '500000.00', upperExclusive: null, count: 0 },
          ],
        },
        closureRate: { status: 'VALUE', percent: '67' },
      });
      expect(source.centerSnapshotInTransaction).toHaveBeenCalledWith(
        actor,
        'mine',
        expect.any(Object),
      );
    });
    it('keeps each empty-cohort status and zero bucket without inventing money or a percentage', async () => {
      const { service } = centerFixture({
        ...centerBase,
        totalCases: 0,
        inProgressCases: 0,
        allClaims: [],
        archivedClaims: [],
        distributionCases: [],
      });
      const result = await service.center(actor);
      expect(result).toMatchObject({
        status: 'NO_RECORDS',
        amount: null,
        reason: 'NO_ARCHIVED_CASES',
        money: {
          total: { status: 'NO_RECORDS', amount: null },
          knownCases: 0,
          unknownCases: 0,
        },
        distributions: {
          types: [],
          platforms: [],
          courts: [],
          unrecordedCourtCases: 0,
        },
        closureRate: { status: 'NO_RECORDS', percent: null },
      });
      expect(result.money.buckets.map((row) => row.count)).toEqual([
        0, 0, 0, 0,
      ]);
    });
    it('retains unavailable mean and all-unknown cumulative states independently of nonzero closure rate', async () => {
      const unknown = { state: 'PENDING' as const, amount: null };
      const { service } = centerFixture({
        ...centerBase,
        archivedClaims: [unknown, unknown],
        allClaims: [unknown, unknown, unknown],
      });
      await expect(service.center(actor)).resolves.toMatchObject({
        status: 'UNAVAILABLE',
        amount: null,
        reason: 'NO_KNOWN_AMOUNT',
        money: {
          total: { status: 'NO_KNOWN_AMOUNT', amount: null },
          knownCases: 0,
          unknownCases: 3,
        },
        closureRate: { status: 'VALUE', percent: '67' },
      });
    });
    it('uses the actual authorized server view and never enables export from a read permission', async () => {
      const { service, source } = centerFixture();
      source.centerSnapshotInTransaction.mockResolvedValue({
        ...centerBase,
        view: 'department',
        availableViews: ['mine', 'department'],
      });
      await expect(service.center(actor)).resolves.toMatchObject({
        view: 'department',
        scope: 'DEPARTMENT',
        availableViews: ['mine', 'department'],
        exportViews: [],
      });
      expect(source.centerSnapshotInTransaction).toHaveBeenCalledWith(
        actor,
        undefined,
        expect.any(Object),
      );
    });
    it('propagates a forbidden explicit view and unexpected source failure', async () => {
      const { service, source } = centerFixture();
      const failure = new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
      source.centerSnapshotInTransaction.mockRejectedValue(failure);
      await expect(service.center(actor, 'department')).rejects.toBe(failure);
      const unexpected = new Error('store failed');
      source.centerSnapshotInTransaction.mockRejectedValue(unexpected);
      await expect(service.center(actor)).rejects.toBe(unexpected);
    });
    it.each(['count', 'money', 'distribution'] as const)(
      'rejects damaged %s source without publishing partial statistics',
      async (kind) => {
        const { service, source } = centerFixture();
        source.centerSnapshotInTransaction.mockResolvedValue({
          ...centerBase,
          ...(kind === 'count' ? { totalCases: 4 } : {}),
          ...(kind === 'money'
            ? {
                allClaims: [
                  ...base.archivedClaims,
                  { state: 'KNOWN', amount: 'NaN' },
                ],
              }
            : {}),
          ...(kind === 'distribution'
            ? {
                distributionCases: [
                  ...centerBase.distributionCases.slice(0, 2),
                  { caseType: 'INVALID', platform: null, court: null },
                ],
              }
            : {}),
        });
        await expect(service.center(actor)).rejects.toMatchObject({
          status: 500,
          response: { code: 'REPORT_SOURCE_INVALID' },
        });
      },
    );
  });
  it('returns only the fixed definition and authorized counts with the average', async () => {
    const { source, service } = fixture();
    await expect(service.overview(actor)).resolves.toEqual({
      metric: 'ARCHIVED_CASE_AVERAGE_CLAIM_AMOUNT',
      currency: 'CNY',
      scope: 'DEPARTMENT',
      period: 'ALL_TIME',
      definitionVersion: 'RP001-1',
      generatedAt: base.generatedAt,
      totalCases: 5,
      inProgressCases: 3,
      archivedCases: 2,
      status: 'VALUE',
      amount: '2000.00',
      reason: null,
    });
    expect(source.snapshot).toHaveBeenCalledWith(actor);
  });
  it('keeps non-archived case counts when there are no archived cases', async () => {
    const { service } = fixture({
      ...base,
      inProgressCases: 5,
      archivedClaims: [],
    });
    await expect(service.overview(actor)).resolves.toMatchObject({
      totalCases: 5,
      inProgressCases: 5,
      archivedCases: 0,
      status: 'NO_RECORDS',
      amount: null,
      reason: 'NO_ARCHIVED_CASES',
    });
  });
  it('distinguishes existing archives with no known amount from a real zero', async () => {
    const { source, service } = fixture({
      ...base,
      archivedClaims: [
        { state: 'PENDING', amount: null },
        { state: 'UNRECORDED', amount: null },
      ],
    });
    await expect(service.overview(actor)).resolves.toMatchObject({
      archivedCases: 2,
      status: 'UNAVAILABLE',
      amount: null,
      reason: 'NO_KNOWN_AMOUNT',
    });
    source.snapshot.mockResolvedValue({
      ...base,
      archivedClaims: [
        { state: 'KNOWN', amount: '0' },
        { state: 'PENDING', amount: null },
      ],
    });
    await expect(service.overview(actor)).resolves.toMatchObject({
      status: 'VALUE',
      amount: '0.00',
      reason: null,
    });
  });
  it('does not convert authorization failures into successful no-data results', async () => {
    const { source, service } = fixture();
    source.snapshot.mockRejectedValue(
      new ForbiddenException({ code: 'ACTION_FORBIDDEN' }),
    );
    await expect(service.overview(actor)).rejects.toThrow(ForbiddenException);
  });
  it('maps invalid decimal sources to the stable public error', async () => {
    const { service } = fixture({
      ...base,
      archivedClaims: [{ state: 'KNOWN', amount: 'NaN' }],
    });
    await expect(service.overview(actor)).rejects.toMatchObject({
      response: { code: 'REPORT_SOURCE_INVALID' },
    });
  });
  it('returns capability without requesting an overview', async () => {
    const { source, service } = fixture();
    source.canRead.mockResolvedValue(false);
    await expect(service.capability(actor)).resolves.toEqual({
      canRead: false,
    });
    expect(source.snapshot).not.toHaveBeenCalled();
  });
});
