import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { AccessControlService } from '../../access-control/access-control.service';
import type { DeletionAuditService } from '../deletion-audit';
import { LeadNotaryDeleteService } from './lead-notary-delete.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};

describe('LeadNotaryDeleteService', () => {
  function fixture() {
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 'id-1' }]),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      lead: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'lead-1',
          businessNo: 'LD-1',
          status: 'WAITING_PUSH',
          version: 2,
          shopName: '测试店铺',
          creationChannel: 'MANUAL',
          createdAt: new Date('2026-11-20T00:00:00Z'),
          customer: { name: '测试客户' },
          _count: { notaryMatters: 0, cases: 0, products: 1 },
        }),
      },
      notaryMatter: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'matter-1',
          businessNo: 'NT-1',
          stage: 'PENDING_EVIDENCE',
          version: 3,
          createdAt: new Date('2026-11-21T00:00:00Z'),
          notaryOffice: { name: '测试公证处' },
          sourceLead: { businessNo: 'LD-1', shopName: '测试店铺' },
          case: null,
          _count: { feeRecords: 0, costs: 0, evidenceItems: 0 },
        }),
      },
    };
    const db = {
      $transaction: jest.fn(async (run: (c: unknown) => unknown) => run(tx)),
    };
    const access = {
      authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
    };
    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    const service = new LeadNotaryDeleteService(
      db as never,
      access as unknown as AccessControlService,
      audit as unknown as DeletionAuditService,
    );
    return { service, tx, access, audit };
  }

  it('deletes lead with deletion audit when no downstream exists', async () => {
    const f = fixture();
    await expect(
      f.service.removeLead(actor, 'lead-1', {
        reason: '重复录入',
        expectedVersion: 2,
      }),
    ).resolves.toEqual({ id: 'lead-1' });
    expect(f.audit.record).toHaveBeenCalledWith(
      f.tx,
      actor,
      expect.objectContaining({
        entityType: 'LEAD',
        entityId: 'lead-1',
        businessNo: 'LD-1',
        deleteReason: '重复录入',
      }),
    );
    expect(f.tx.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM leads'),
      'lead-1',
      actor.departmentId,
    );
  });

  it('blocks lead deletion when downstream notary matter or case exists', async () => {
    const f = fixture();
    f.tx.lead.findFirst.mockResolvedValueOnce({
      id: 'lead-1',
      businessNo: 'LD-1',
      status: 'TRANSFERRED_TO_NOTARY',
      version: 2,
      shopName: '测试店铺',
      creationChannel: 'MANUAL',
      createdAt: new Date('2026-11-20T00:00:00Z'),
      customer: { name: '测试客户' },
      _count: { notaryMatters: 1, cases: 0, products: 1 },
    });
    await expect(
      f.service.removeLead(actor, 'lead-1', { reason: '重复' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(f.audit.record).not.toHaveBeenCalled();
  });

  it('deletes notary matter with deletion audit and respects version conflict', async () => {
    const f = fixture();
    await expect(
      f.service.removeNotaryMatter(actor, 'matter-1', {
        reason: '误转公证',
        expectedVersion: 99,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      f.service.removeNotaryMatter(actor, 'matter-1', {
        reason: '误转公证',
        expectedVersion: 3,
      }),
    ).resolves.toEqual({ id: 'matter-1' });
    expect(f.audit.record).toHaveBeenCalledWith(
      f.tx,
      actor,
      expect.objectContaining({
        entityType: 'NOTARY_MATTER',
        entityId: 'matter-1',
        businessNo: 'NT-1',
        deleteReason: '误转公证',
      }),
    );
    expect(f.tx.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM notary_matters'),
      'matter-1',
      actor.departmentId,
    );
  });

  it('blocks external accounts', async () => {
    const f = fixture();
    await expect(
      f.service.removeLead(
        { ...actor, clientCustomerId: 'c1' },
        'lead-1',
        { reason: 'test' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
