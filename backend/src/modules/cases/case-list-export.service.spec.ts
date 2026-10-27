import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { CaseStage } from '../../generated/prisma/enums';
import { CaseListDisplayRecord } from './case-list-display-read';
import { CaseListExportInput } from './case-list-export.dto';
import { caseListTextWhere } from './case-list-query';
import {
  caseListExportCsv,
  CaseListExportService,
} from './case-list-export.service';

const actor: ActorContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 2,
};
const emptyInput = {} as CaseListExportInput;

function row(id = 'case-1'): CaseListDisplayRecord & {
  businessNo: string;
  stage: CaseStage;
} {
  return {
    id,
    businessNo: `CA-${id}`,
    stage: 'WAITING_HEARING',
    departmentId: actor.departmentId,
    customerId: 'customer',
    rightsHolderId: 'holder',
    sourceLeadId: 'lead',
    sourceNotaryMatterId: 'matter',
    certificateId: 'certificate',
    externalEntry: null,
    customer: {
      id: 'customer',
      departmentId: actor.departmentId,
      name: '客户',
    },
    rightsHolder: {
      id: 'holder',
      departmentId: actor.departmentId,
      name: '权利主体',
    },
    sourceLead: {
      id: 'lead',
      departmentId: actor.departmentId,
      customerId: 'customer',
      rightsHolderId: 'holder',
      platform: 'TMALL',
      shopName: '不应导出的店铺',
      shopExternalId: null,
    },
    sourceNotaryMatter: {
      id: 'matter',
      departmentId: actor.departmentId,
      customerId: 'customer',
      rightsHolderId: 'holder',
      sourceLeadId: 'lead',
    },
    defendants: [
      { id: 'defendant-1', name: '被告一' },
      { id: 'defendant-2', name: '被告二' },
    ],
    lawyers: [],
    filingSubmission: { courtId: 'court', courtName: '法院' },
    acceptance: null,
    courtCaseNo: '案号',
    complaintSubmittedAt: null,
    complaintAmountState: null,
    complaintAmount: null,
    complaintConfirmation: null,
    currentTrialRoundId: null,
    currentJudgmentNextStepId: null,
    currentJudgment: null,
    currentSecondInstanceResult: null,
    closure: null,
  };
}

function harness(rows: ReturnType<typeof row>[] = []) {
  const tx = {
    userAccount: {
      findUnique: jest.fn().mockResolvedValue({
        accountType: 'INTERNAL',
        active: true,
      }),
    },
    case: { findMany: jest.fn().mockResolvedValue(rows) },
    filingCourt: { findMany: jest.fn().mockResolvedValue([]) },
    auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit' }) },
  };
  const database = {
    $transaction: jest.fn(
      async (run: (reader: typeof tx) => Promise<unknown>) => run(tx),
    ),
  };
  const access = {
    authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CaseListExportService(
    database as unknown as DatabaseService,
    access as unknown as AccessControlService,
  );
  return { service, database, access, tx };
}

describe('case list CSV export', () => {
  it('exports selected IDs in request order and audits the explicit scope', async () => {
    const first = '11111111-1111-4111-8111-111111111111';
    const second = '33333333-3333-4333-8333-333333333333';
    const f = harness([row(second), row(first)]);
    const result = await f.service.exportSelection(actor, {
      view: 'department',
      ids: [first, second],
    });
    expect(result.csv.indexOf(`CA-${first}`)).toBeLessThan(
      result.csv.indexOf(`CA-${second}`),
    );
    expect(f.tx.case.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: [first, second] },
          departmentId: actor.departmentId,
        },
      }),
    );
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        details: {
          scope: 'selection',
          view: 'department',
          ids: [first, second],
          rowCount: 2,
          columnVersion: 1,
        },
      }),
    });
  });

  it('rejects incomplete selected scope rather than silently omitting a case', async () => {
    const f = harness([]);
    await expect(
      f.service.exportSelection(actor, {
        view: 'mine',
        ids: ['11111111-1111-4111-8111-111111111111'],
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('normalizes every special filter and uses the shared court mapping inside the authorized snapshot', async () => {
    const f = harness();
    f.tx.filingCourt.findMany
      .mockResolvedValueOnce([{ id: 'keyword-court' }])
      .mockResolvedValueOnce([{ id: 'named-court' }]);
    const query = {
      q: '北京',
      shopName: 'shop',
      defendantName: 'defendant',
      courtName: '上海',
      lawyerName: 'lawyer',
      caseType: 'CIVIL' as const,
    };
    await f.service.export(actor, {
      view: 'department',
      ...query,
      shopName: ' shop ',
      courtName: ' 上海 ',
    });
    expect(f.tx.case.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          departmentId: actor.departmentId,
          ...caseListTextWhere(query, ['keyword-court'], ['named-court']),
        },
        take: 1001,
      }),
    );
    expect(f.tx.filingCourt.findMany).toHaveBeenCalledTimes(2);
    expect(
      f.access.authorizeDepartmentAction.mock.invocationCallOrder[1],
    ).toBeLessThan(f.tx.filingCourt.findMany.mock.invocationCallOrder[0]!);
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          details: expect.objectContaining({
            filter: expect.objectContaining(query),
          }),
        }),
      }),
    );
  });

  it('does not query courts before rejecting an unauthorized export', async () => {
    const f = harness();
    f.access.authorizeDepartmentAction.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(
      f.service.export(actor, { view: 'department', courtName: 'court' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.tx.filingCourt.findMany).not.toHaveBeenCalled();
  });
  it('reports capability from current department grants without exporting or auditing', async () => {
    const granted = harness();
    await expect(granted.service.capability(actor)).resolves.toEqual({
      canExport: true,
    });
    expect(granted.access.authorizeDepartmentAction.mock.calls).toEqual([
      [actor, 'case.read', granted.tx],
      [actor, 'case.export', granted.tx],
    ]);
    expect(granted.tx.case.findMany).not.toHaveBeenCalled();
    expect(granted.tx.auditEvent.create).not.toHaveBeenCalled();

    const noExport = harness();
    noExport.access.authorizeDepartmentAction.mockImplementation(
      async (_actor, action) => {
        if (action === 'case.export') throw new ForbiddenException();
      },
    );
    await expect(noExport.service.capability(actor)).resolves.toEqual({
      canExport: false,
    });
    expect(noExport.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('does not turn unreadable, external or unexpected capability errors into false', async () => {
    const noRead = harness();
    noRead.access.authorizeDepartmentAction.mockRejectedValueOnce(
      new ForbiddenException(),
    );
    await expect(noRead.service.capability(actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(noRead.access.authorizeDepartmentAction).toHaveBeenCalledTimes(1);

    const external = harness();
    await expect(
      external.service.capability({ ...actor, clientCustomerId: 'customer' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(external.access.authorizeDepartmentAction).not.toHaveBeenCalled();

    const failed = harness();
    failed.access.authorizeDepartmentAction.mockImplementation(
      async (_actor, action) => {
        if (action === 'case.export') throw new Error('reader failed');
      },
    );
    await expect(failed.service.capability(actor)).rejects.toThrow(
      'reader failed',
    );
  });

  it('quotes seven fixed columns, prevents formulas after whitespace and preserves data bytes', () => {
    const csv = caseListExportCsv([
      {
        businessNo: '  =1',
        stage: 'WAITING_HEARING',
        customerName: '\t\r\n+evil',
        rightsHolderName: '"quoted",name',
        defendants: ['被告一', '被告二'],
        courtName: null,
        courtCaseNo: '\n@cmd',
      },
    ]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain(
      '"编号","阶段","客户","权利主体","被告","法院","法院案号"\r\n',
    );
    expect(csv).toContain('"\'  =1"');
    expect(csv).toContain('"\'\t\r\n+evil"');
    expect(csv).toContain('"""quoted"",name"');
    expect(csv).toContain('"被告一；被告二","","\'\n@cmd"');
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(caseListExportCsv([])).toBe(
      '\uFEFF"编号","阶段","客户","权利主体","被告","法院","法院案号"\r\n',
    );
  });

  it('reads and exports under one reader with both grants, exact scope and one audit', async () => {
    const setup = harness([row()]);
    const result = await setup.service.export(actor, {
      view: 'mine',
      stageGroup: 'COMPLAINT_PREPARATION',
      q: '  编号  ',
      rightsHolderName: ' 权利主体 ',
      sortBy: 'rightsHolderName',
      sortDirection: 'asc',
    });
    expect(setup.database.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'RepeatableRead', timeout: 15000 },
    );
    expect(setup.access.authorizeDepartmentAction.mock.calls).toEqual([
      [actor, 'case.read', setup.tx],
      [actor, 'case.export', setup.tx],
    ]);
    expect(setup.tx.case.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          departmentId: actor.departmentId,
          responsibleUserId: actor.userId,
          stage: {
            in: [
              'WAITING_COMPLAINT',
              'WAITING_COMPLAINT_CONFIRMATION',
              'WAITING_COMPLAINT_STAMP',
            ],
          },
          AND: expect.any(Array),
        }),
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 1001,
      }),
    );
    expect(result.csv).toContain(
      '"CA-case-1","待开庭","客户","权利主体","被告一；被告二","法院","案号"',
    );
    expect(result.csv).not.toContain('不应导出的店铺');
    expect(setup.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(setup.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        departmentId: actor.departmentId,
        action: 'case.list.exported',
        details: {
          scope: 'filter',
          filter: {
            view: 'mine',
            sortBy: 'createdAt',
            sortDirection: 'desc',
            stageGroup: 'COMPLAINT_PREPARATION',
            q: '编号',
            rightsHolderName: '权利主体',
          },
          rowCount: 1,
          columnVersion: 1,
        },
      }),
    });
  });

  it('returns a header and one audit for an empty authorized scope', async () => {
    const setup = harness();
    const result = await setup.service.export(actor, emptyInput);
    expect(result.csv).toBe(caseListExportCsv([]));
    expect(setup.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(
      setup.tx.auditEvent.create.mock.calls[0][0].data.details.rowCount,
    ).toBe(0);
  });

  it('allows 1000 rows, but rejects 1001 without a partial CSV or success audit', async () => {
    const setup = harness(
      Array.from({ length: 1000 }, (_, index) => row(String(index))),
    );
    const result = await setup.service.export(actor, emptyInput);
    expect(result.csv.match(/\r\n/g)?.length).toBe(1001);
    expect(setup.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    setup.tx.case.findMany.mockResolvedValueOnce(
      Array.from({ length: 1001 }, () => row()),
    );
    await expect(setup.service.export(actor, emptyInput)).rejects.toMatchObject(
      {
        response: { code: 'CASE_EXPORT_LIMIT_EXCEEDED' },
      },
    );
    expect(setup.tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('denies missing read/export, inactive and external actors before any rows', async () => {
    for (const denied of ['case.read', 'case.export'] as const) {
      const setup = harness([row()]);
      setup.access.authorizeDepartmentAction.mockImplementation(
        async (_actor, action) => {
          if (action === denied) throw new ForbiddenException();
        },
      );
      await expect(
        setup.service.export(actor, emptyInput),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(setup.tx.case.findMany).not.toHaveBeenCalled();
      expect(setup.tx.auditEvent.create).not.toHaveBeenCalled();
    }
    const inactive = harness();
    inactive.tx.userAccount.findUnique.mockResolvedValueOnce({
      accountType: 'INTERNAL',
      active: false,
    });
    await expect(
      inactive.service.export(actor, emptyInput),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const external = harness();
    await expect(
      external.service.export(
        { ...actor, clientCustomerId: 'customer' },
        emptyInput,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(external.tx.case.findMany).not.toHaveBeenCalled();
  });

  it('does not accept paging, actor anchors, unknown fields or conflicting stages', async () => {
    for (const input of [
      { page: 1 },
      { pageSize: 20 },
      { departmentId: actor.departmentId },
      { actorUserId: actor.userId },
      { ids: ['case-1'] },
      { unexpected: true },
      { stage: 'WAITING_HEARING', stageGroup: 'COMPLAINT_PREPARATION' },
      { q: 'a'.repeat(201) },
      { sortBy: 'unknown' },
      { caseType: 'UNKNOWN' },
      { caseType: ['CIVIL', 'CRIMINAL'] },
      { caseType: null },
    ]) {
      const setup = harness();
      await expect(
        setup.service.export(actor, input as CaseListExportInput),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(setup.database.$transaction).not.toHaveBeenCalled();
    }
  });

  it('uses the DTO string length boundary after trimming for every text filter', async () => {
    for (const key of [
      'q',
      'customerName',
      'rightsHolderName',
      'courtCaseNo',
      'shopName',
      'defendantName',
      'courtName',
      'lawyerName',
    ] as const) {
      for (const unit of ['字', '😀', '✈️']) {
        const accepted = harness();
        const value = unit.repeat(200);
        await accepted.service.export(actor, {
          view: 'department',
          [key]: `  ${value}  `,
        });
        expect(accepted.tx.case.findMany).toHaveBeenCalledTimes(1);
        expect(
          accepted.tx.auditEvent.create.mock.calls[0][0].data.details.filter[
            key
          ],
        ).toBe(value);

        const rejected = harness();
        await expect(
          rejected.service.export(actor, {
            view: 'department',
            [key]: unit.repeat(201),
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(rejected.database.$transaction).not.toHaveBeenCalled();
      }
    }
  });

  it('does not return a CSV if the audit write fails', async () => {
    const setup = harness([row()]);
    setup.tx.auditEvent.create.mockRejectedValueOnce(new Error('audit failed'));
    await expect(setup.service.export(actor, emptyInput)).rejects.toThrow(
      'audit failed',
    );
  });
});
