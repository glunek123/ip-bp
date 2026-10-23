import { ForbiddenException } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { NotaryListExportService } from './notary-list-export.service';
import { Prisma } from '../../generated/prisma/client';

const actor: ActorContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const matterId = '33333333-3333-4333-8333-333333333333';
const otherId = '44444444-4444-4444-8444-444444444444';
const mixedCaseId = 'a3333333-3333-4333-8333-333333333333';
const readScope = {
  departmentId: actor.departmentId,
  responsibleUserId: actor.userId,
};
const exportScope = {
  departmentId: actor.departmentId,
  teamId: { in: ['team-1'] },
};
const row = {
  id: matterId,
  businessNo: 'NT-001',
  stage: 'PENDING_EVIDENCE',
  createdAt: new Date('2026-09-30T01:02:03.000Z'),
  rightsHolderId: 'holder-1',
  sourceLead: {
    businessNo: 'LD-001',
    platform: 'TAOBAO',
    shopName: '店铺',
    shopExternalId: null,
    pushedAt: new Date('2026-09-20T16:00:00Z'),
  },
  evidence: null,
  evidenceCorrections: [],
  opening: null,
  openingSenderCorrections: [],
  certificate: null,
  notaryOffice: { name: '示例公证处' },
};

function fixture() {
  const tx = {
    rightsHolder: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'holder-1', name: '权利主体' }]),
    },
    userAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
    },
    notaryMatter: { findMany: jest.fn().mockResolvedValue([row]) },
    auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
  const database = {
    $transaction: jest.fn((run: (reader: typeof tx) => Promise<unknown>) =>
      run(tx),
    ),
  };
  const access = {
    buildLeadScope: jest
      .fn()
      .mockImplementation((_actor: ActorContext, action: string) =>
        Promise.resolve(action === 'lead.read' ? readScope : exportScope),
      ),
  };
  const service = new NotaryListExportService(
    database as unknown as DatabaseService,
    access as unknown as AccessControlService,
  );
  return { service, database, tx, access };
}

describe('NotaryListExportService', () => {
  it('loads unique same-department holders once and maps repeated and different holders in row order', async () => {
    const { service, tx } = fixture();
    tx.notaryMatter.findMany.mockResolvedValueOnce([
      row,
      { ...row, id: otherId, businessNo: 'NT-002', rightsHolderId: 'holder-2' },
      { ...row, id: mixedCaseId, businessNo: 'NT-003' },
    ]);
    tx.rightsHolder.findMany.mockResolvedValueOnce([
      { id: 'holder-2', name: '第二主体' },
      { id: 'holder-1', name: '权利主体' },
    ]);
    const { csv } = await service.export(actor, {
      mode: 'FILTERED',
      expectedCount: 3,
    });
    expect(
      csv
        .split('\r\n')
        .slice(1, 4)
        .map((line) => line.split(',').slice(0, 2)),
    ).toEqual([
      ['NT-001', '权利主体'],
      ['NT-002', '第二主体'],
      ['NT-003', '权利主体'],
    ]);
    expect(tx.rightsHolder.findMany).toHaveBeenCalledTimes(1);
    expect(tx.rightsHolder.findMany).toHaveBeenCalledWith({
      where: {
        departmentId: actor.departmentId,
        id: { in: ['holder-1', 'holder-2'] },
      },
      select: { id: true, name: true },
    });
  });

  it('rejects missing holders before generating an audit', async () => {
    const { service, tx } = fixture();
    tx.rightsHolder.findMany.mockResolvedValueOnce([]);
    await expect(
      service.export(actor, { mode: 'FILTERED', expectedCount: 1 }),
    ).rejects.toMatchObject({ response: { code: 'INTERNAL_ERROR' } });
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      'positive',
      [
        {
          category: 'DISCLOSURE',
          state: 'KNOWN',
          amount: new Prisma.Decimal('19.25'),
        },
      ],
      '19.25',
    ],
    [
      'zero',
      [
        {
          category: 'DISCLOSURE',
          state: 'KNOWN',
          amount: new Prisma.Decimal('0'),
        },
      ],
      '0.00',
    ],
    [
      'pending',
      [{ category: 'DISCLOSURE', state: 'PENDING', amount: null }],
      '',
    ],
    ['unrecorded', [], ''],
  ])(
    'exports disclosure %s using the actual certificate fact',
    async (_label, fees, expected) => {
      const { service, tx } = fixture();
      tx.notaryMatter.findMany.mockResolvedValueOnce([
        {
          ...row,
          certificate: {
            certificateNo: '证一',
            certificateDate: new Date('2026-03-03'),
            fees,
          },
        },
      ] as unknown as (typeof row)[]);
      const { csv } = await service.export(actor, {
        mode: 'FILTERED',
        expectedCount: 1,
      });
      expect(csv.split('\r\n')[1]?.split(',')[14]).toBe(expected);
      expect(tx.notaryMatter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            certificate: {
              select: expect.objectContaining({
                fees: expect.objectContaining({
                  where: {
                    category: { in: ['NOTARY', 'INVESTIGATION', 'DISCLOSURE'] },
                  },
                }),
              }),
            },
          }),
        }),
      );
    },
  );

  it('uses effective corrections and paired ordered logistics, preserving zero and unknown fees', async () => {
    const { service, tx } = fixture();
    tx.notaryMatter.findMany.mockResolvedValueOnce([
      {
        ...row,
        evidence: {
          evidenceAt: new Date('2026-01-01'),
          sampleFeeState: 'KNOWN',
          sampleFeeAmount: new Prisma.Decimal('0'),
          logistics: [{ companyValue: '旧公司', trackingValue: '旧单号' }],
        },
        evidenceCorrections: [
          {
            evidenceAt: new Date('2026-02-02'),
            logistics: [
              { companyValue: '公司一', trackingValue: '单一' },
              { companyValue: null, trackingValue: '单二' },
            ],
          },
        ],
        opening: {
          senderName: '旧发货人',
          senderPhone: '旧电话',
          senderAddress: '旧地址',
        },
        openingSenderCorrections: [
          {
            senderName: '=新发货人',
            senderPhone: null,
            senderAddress: '新地址',
          },
        ],
        certificate: {
          certificateNo: '证一',
          certificateDate: new Date('2026-03-03'),
          fees: [
            {
              category: 'NOTARY',
              state: 'KNOWN',
              amount: new Prisma.Decimal('12.34'),
            },
            { category: 'INVESTIGATION', state: 'PENDING', amount: null },
            {
              category: 'DISCLOSURE',
              state: 'KNOWN',
              amount: new Prisma.Decimal('0'),
            },
          ],
        },
      },
    ] as unknown as (typeof row)[]);
    const { csv } = await service.export(actor, {
      mode: 'SELECTED',
      matterIds: [matterId],
      expectedCount: 1,
    });
    expect(csv).toContain(
      '2026-09-21,2026-02-02,"\'=新发货人",,新地址,12.34,,0.00,0.00,"公司一\n","单一\n单二",示例公证处,证一,2026-03-03',
    );
    expect(csv).not.toContain('旧');
    expect(tx.notaryMatter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          evidenceCorrections: expect.objectContaining({
            orderBy: { revision: 'desc' },
            take: 1,
            include: { logistics: { orderBy: { position: 'asc' } } },
          }),
          openingSenderCorrections: expect.objectContaining({
            orderBy: { revision: 'desc' },
            take: 1,
          }),
        }),
      }),
    );
  });

  it('rechecks authorization at download after a successful preview', async () => {
    const { service, access, tx } = fixture();
    await service.preview(actor, { mode: 'FILTERED' });
    access.buildLeadScope.mockRejectedValueOnce(new ForbiddenException());
    await expect(
      service.export(actor, { mode: 'FILTERED', expectedCount: 1 }),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });
  it('requires both current grants and intersects their source-lead scopes', async () => {
    const { service, tx, access, database } = fixture();
    await expect(
      service.preview(actor, { mode: 'SELECTED', matterIds: [matterId] }),
    ).resolves.toEqual({ count: 1, maxRows: 1000 });
    expect(access.buildLeadScope).toHaveBeenCalledWith(actor, 'lead.read', tx);
    expect(access.buildLeadScope).toHaveBeenCalledWith(
      actor,
      'notary.list.export',
      tx,
    );
    expect(tx.notaryMatter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          departmentId: actor.departmentId,
          id: { in: [matterId] },
          AND: [{ sourceLead: readScope }, { sourceLead: exportScope }],
        },
        take: 1001,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
    );
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
    expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('rejects absent export grant and external accounts', async () => {
    const { service, tx, access } = fixture();
    access.buildLeadScope.mockRejectedValueOnce(new ForbiddenException());
    await expect(
      service.preview(actor, { mode: 'SELECTED', matterIds: [matterId] }),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    tx.userAccount.findUnique.mockResolvedValueOnce({
      accountType: 'NOTARY_OFFICE',
      active: true,
    });
    await expect(
      service.preview(actor, { mode: 'SELECTED', matterIds: [matterId] }),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    await expect(
      service.preview(
        { ...actor, clientCustomerId: 'client' },
        { mode: 'SELECTED', matterIds: [matterId] },
      ),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(tx.notaryMatter.findMany).not.toHaveBeenCalled();
  });

  it('rejects selected IDs that are absent or outside either scope as a whole', async () => {
    const { service, tx } = fixture();
    await expect(
      service.preview(actor, {
        mode: 'SELECTED',
        matterIds: [matterId, otherId],
      }),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects case-equivalent duplicate IDs at the service boundary without querying', async () => {
    const { service, database } = fixture();
    const matterIds = [mixedCaseId, mixedCaseId.toUpperCase()];
    await expect(
      service.preview(actor, { mode: 'SELECTED', matterIds }),
    ).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });
    await expect(
      service.export(actor, { mode: 'SELECTED', matterIds, expectedCount: 2 }),
    ).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it('rejects empty and over-limit results and filters by stage', async () => {
    const { service, tx } = fixture();
    tx.notaryMatter.findMany.mockResolvedValueOnce([]);
    await expect(
      service.preview(actor, { mode: 'FILTERED', stage: 'ARCHIVED' }),
    ).rejects.toMatchObject({ response: { code: 'EXPORT_EMPTY' } });
    expect(tx.notaryMatter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ stage: 'ARCHIVED' }),
      }),
    );
    tx.notaryMatter.findMany.mockResolvedValueOnce(
      Array.from({ length: 1001 }, () => row),
    );
    await expect(
      service.preview(actor, { mode: 'FILTERED' }),
    ).rejects.toMatchObject({ response: { code: 'EXPORT_LIMIT_EXCEEDED' } });
  });

  it('rejects stale expectedCount and never audits it', async () => {
    const { service, tx } = fixture();
    await expect(
      service.export(actor, {
        mode: 'SELECTED',
        matterIds: [matterId],
        expectedCount: 2,
      }),
    ).rejects.toMatchObject({ response: { code: 'EXPORT_SCOPE_CHANGED' } });
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('returns scope-changed when a filtered export becomes empty or exceeds the bound after preview', async () => {
    const { service, tx } = fixture();
    tx.notaryMatter.findMany.mockResolvedValueOnce([]);
    await expect(
      service.export(actor, { mode: 'FILTERED', expectedCount: 1 }),
    ).rejects.toMatchObject({ response: { code: 'EXPORT_SCOPE_CHANGED' } });
    tx.notaryMatter.findMany.mockResolvedValueOnce(
      Array.from({ length: 1001 }, () => row),
    );
    await expect(
      service.export(actor, { mode: 'FILTERED', expectedCount: 1 }),
    ).rejects.toMatchObject({ response: { code: 'EXPORT_SCOPE_CHANGED' } });
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('writes exactly twenty ordered BOM CSV columns and actual IDs to the audit in the transaction', async () => {
    const { service, tx } = fixture();
    tx.notaryMatter.findMany.mockResolvedValueOnce([
      {
        ...row,
        id: otherId,
        businessNo: '\t=cmd',
        sourceLead: { ...row.sourceLead, shopName: '"x\ny"' },
        notaryOffice: { name: '  +SUM(1)' },
      },
      row,
    ]);
    const result = await service.export(actor, {
      mode: 'FILTERED',
      stage: 'PENDING_EVIDENCE',
      expectedCount: 2,
    });
    expect(result.csv.split('\r\n')[0]).toBe(
      '\uFEFF公证编号,权利主体,平台,店铺名,店铺ID,案件进展,推送日期,取证日期,发货人,发货电话,发货地址,公证费,调查费,样品费,披露费,快递公司,快递单号,公证处,公证书编号,出证日期',
    );
    expect(result.csv).toContain('"\t\'=cmd",权利主体,淘宝,"""x\ny"""');
    expect(result.csv).toContain('"  \'+SUM(1)"');
    expect(result.csv).toContain(
      'NT-001,权利主体,淘宝,店铺,,待取证,2026-09-21,,,,,,,,,,,示例公证处,,\r\n',
    );
    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: actor.userId,
        internalActorUserId: actor.userId,
        action: 'notary.list.export.generated',
        resourceType: 'notary-list-export',
        resourceId: expect.any(String),
        details: {
          mode: 'FILTERED',
          stage: 'PENDING_EVIDENCE',
          actualIds: [otherId, matterId],
          count: 2,
        },
      }),
    });
  });

  it('rejects the file when audit insertion fails', async () => {
    const { service, tx } = fixture();
    tx.auditEvent.create.mockRejectedValueOnce(new Error('audit failed'));
    await expect(
      service.export(actor, {
        mode: 'SELECTED',
        matterIds: [matterId],
        expectedCount: 1,
      }),
    ).rejects.toThrow('audit failed');
  });
});
