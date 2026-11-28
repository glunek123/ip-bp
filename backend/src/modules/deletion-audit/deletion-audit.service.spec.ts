import { ForbiddenException } from '@nestjs/common';
import { DeletionAuditService } from './deletion-audit.service';
import type { AccessControlService } from '../../access-control/access-control.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};

describe('DeletionAuditService', () => {
  function fixture() {
    const tx = {
      userAccount: {
        findUnique: jest.fn().mockResolvedValue({
          displayName: '运营甲',
          externalSubject: 'zhichan',
          localCredential: { username: 'zhichan' },
        }),
      },
      roleAssignment: {
        findMany: jest.fn().mockResolvedValue([
          { roleTemplate: { name: 'UAT知产运营' } },
          { roleTemplate: { name: 'UAT品维运营' } },
        ]),
      },
      deletionAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const db = {
      $transaction: jest.fn(async (queries: readonly unknown[]) => Promise.all(queries)),
      deletionAuditLog: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'log-1',
            entityType: 'CASE',
            entityId: 'case-1',
            businessNo: 'CA-1',
            entityTitle: 'CA-1',
            actorUserId: actor.userId,
            actorUsername: 'zhichan',
            actorDisplayName: '运营甲',
            actorRoles: ['UAT品维运营', 'UAT知产运营'],
            deleteReason: '误创建重复案件',
            snapshot: { businessNo: 'CA-1' },
            deletedAt: new Date('2026-11-27T12:00:00Z'),
          },
        ]),
      },
    };
    const access = {
      authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
    };
    const service = new DeletionAuditService(
      db as never,
      access as unknown as AccessControlService,
    );
    return { service, db, tx, access };
  }

  it('records the operator account, name, roles, time and deleted summary', async () => {
    const f = fixture();
    await f.service.record(f.tx as never, actor, {
      entityType: 'CASE',
      entityId: 'case-1',
      businessNo: 'CA-1',
      entityTitle: 'CA-1',
      deleteReason: '误创建重复案件',
      snapshot: { businessNo: 'CA-1', stage: 'WAITING_COMPLAINT' },
    });
    expect(f.tx.deletionAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        departmentId: actor.departmentId,
        entityType: 'CASE',
        entityId: 'case-1',
        businessNo: 'CA-1',
        actorUserId: actor.userId,
        actorUsername: 'zhichan',
        actorDisplayName: '运营甲',
        actorRoles: ['UAT品维运营', 'UAT知产运营'],
        deleteReason: '误创建重复案件',
        snapshot: { businessNo: 'CA-1', stage: 'WAITING_COMPLAINT' },
      }),
    });
  });

  it('falls back to the external subject when the account has no local credential', async () => {
    const f = fixture();
    f.tx.userAccount.findUnique.mockResolvedValueOnce({
      displayName: '运营甲',
      externalSubject: 'ops-42',
      localCredential: null,
    });
    await f.service.record(f.tx as never, actor, {
      entityType: 'CASE',
      entityId: 'case-1',
      snapshot: {},
    });
    expect(f.tx.deletionAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorUsername: 'ops-42' }),
    });
  });

  it('lists only the current department logs and requires the read permission', async () => {
    const f = fixture();
    const result = await f.service.list(actor, {
      entityType: 'CASE',
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-30T00:00:00.000Z',
    });
    expect(f.access.authorizeDepartmentAction).toHaveBeenCalledWith(
      actor,
      'deletion.audit.read',
    );
    expect(f.db.deletionAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          departmentId: actor.departmentId,
          entityType: 'CASE',
          deletedAt: {
            gte: new Date('2026-11-01T00:00:00.000Z'),
            lte: new Date('2026-11-30T00:00:00.000Z'),
          },
        },
        orderBy: { deletedAt: 'desc' },
      }),
    );
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.items[0]).toMatchObject({
      entityType: 'CASE',
      actorUsername: 'zhichan',
      actorRoles: ['UAT品维运营', 'UAT知产运营'],
      deleteReason: '误创建重复案件',
    });
  });

  it('refuses the log query with DELETION_AUDIT_FORBIDDEN without the read permission', async () => {
    const f = fixture();
    f.access.authorizeDepartmentAction.mockRejectedValueOnce(
      new ForbiddenException({ code: 'FORBIDDEN' }),
    );
    await expect(f.service.list(actor, {})).rejects.toMatchObject({
      response: { code: 'DELETION_AUDIT_FORBIDDEN' },
    });
    expect(f.db.deletionAuditLog.findMany).not.toHaveBeenCalled();
  });
});
