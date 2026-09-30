import { ForbiddenException } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { NotaryListExportService } from './notary-list-export.service';

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
  sourceLead: { businessNo: 'LD-001' },
  notaryOffice: { name: '示例公证处' },
};

function fixture() {
  const tx = {
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

  it('writes five ordered BOM CSV columns and actual IDs to the audit in the transaction', async () => {
    const { service, tx } = fixture();
    tx.notaryMatter.findMany.mockResolvedValueOnce([
      {
        ...row,
        id: otherId,
        businessNo: '\t=cmd',
        sourceLead: { businessNo: '"x\ny"' },
        notaryOffice: { name: '  +SUM(1)' },
      },
      row,
    ]);
    const result = await service.export(actor, {
      mode: 'FILTERED',
      stage: 'PENDING_EVIDENCE',
      expectedCount: 2,
    });
    expect(result.csv).toBe(
      '\uFEFF公证事项编号,阶段,来源线索编号,公证处,创建时间\r\n"\t\'=cmd",待取证,"""x\ny""","  \'+SUM(1)",2026-09-30T01:02:03.000Z\r\nNT-001,待取证,LD-001,示例公证处,2026-09-30T01:02:03.000Z\r\n',
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
