import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { MaterialService } from '../materials';
import { LeadService } from './lead.service';

const actor: ActorContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const ids = [
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
];

function fixture() {
  const records = ids.map((id) => ({
    id,
    departmentId: actor.departmentId,
    responsibleUserId: actor.userId,
    teamId: null,
    businessNo: id.slice(0, 8),
    status: 'WAITING_PUSH',
    version: 1,
    products: [{ id: 'product' }],
    customer: {
      profileStatus: 'ADMITTED',
      clientAccountBindings: [{ id: 'binding' }],
    },
  }));
  const tx = {
    $queryRawUnsafe: jest.fn().mockResolvedValue(ids.map((id) => ({ id }))),
    leadBatchPushReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    lead: {
      findMany: jest.fn().mockResolvedValue(records),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    userAccount: {
      findUnique: jest.fn().mockResolvedValue({ displayName: 'Operator' }),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const database = {
    $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) =>
      callback(tx),
    ),
    leadBatchPushReceipt: { findUnique: jest.fn().mockResolvedValue(null) },
  } as unknown as DatabaseService;
  const access = {
    authorizeLead: jest.fn().mockResolvedValue(undefined),
  } as unknown as AccessControlService;
  return {
    service: new LeadService(database, access, {} as MaterialService),
    tx,
    access,
    database,
  };
}

describe('LeadService batch push', () => {
  it('writes updates, audits and one receipt only after full preflight, preserving request order', async () => {
    const f = fixture();
    const result = await f.service.pushBatch(actor, 'batch-key', {
      items: [
        { leadId: ids[1]!, expectedVersion: 1 },
        { leadId: ids[0]!, expectedVersion: 1 },
      ],
    });
    expect(result.items.map((item) => item.id)).toEqual([ids[1], ids[0]]);
    expect(f.tx.lead.updateMany).toHaveBeenCalledTimes(2);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(2);
    expect(f.tx.leadBatchPushReceipt.create).toHaveBeenCalledTimes(1);
  });

  it('preflights every target and performs zero writes if one target is invalid', async () => {
    const f = fixture();
    f.tx.lead.findMany.mockResolvedValueOnce([
      {
        id: ids[0],
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
        teamId: null,
        businessNo: 'LD-1',
        status: 'WAITING_PUSH',
        version: 1,
        products: [],
        customer: {
          profileStatus: 'ADMITTED',
          clientAccountBindings: [{ id: 'binding' }],
        },
      },
      {
        id: ids[1],
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
        teamId: null,
        businessNo: 'LD-2',
        status: 'WAITING_PUSH',
        version: 1,
        products: [{ id: 'product' }],
        customer: {
          profileStatus: 'ADMITTED',
          clientAccountBindings: [{ id: 'binding' }],
        },
      },
    ]);
    await expect(
      f.service.pushBatch(actor, 'batch-key', {
        items: ids.map((leadId) => ({ leadId, expectedVersion: 1 })),
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'BATCH_PUSH_REJECTED',
        details: { failures: [{ index: 0, code: 'LEAD_PRODUCTS_REQUIRED' }] },
      },
    });
    expect(f.tx.lead.updateMany).not.toHaveBeenCalled();
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(f.tx.leadBatchPushReceipt.create).not.toHaveBeenCalled();
  });

  it('replays the immutable success after leads have advanced beyond the push stage', async () => {
    const f = fixture();
    const input = {
      items: ids.map((leadId) => ({ leadId, expectedVersion: 1 })),
    };
    const first = await f.service.pushBatch(actor, 'batch-key', input);
    const receipt = f.tx.leadBatchPushReceipt.create.mock.calls[0]?.[0]?.data;
    f.tx.leadBatchPushReceipt.findUnique.mockResolvedValueOnce({
      ...receipt,
      createdAt: new Date('2026-10-16T00:00:00.000Z'),
    });
    f.tx.lead.findMany.mockResolvedValueOnce(
      ids.map((id) => ({
        id,
        businessNo: id.slice(0, 8),
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
        teamId: null,
      })),
    );
    f.tx.lead.updateMany.mockClear();
    f.tx.auditEvent.create.mockClear();
    await expect(
      f.service.pushBatch(actor, 'batch-key', input),
    ).resolves.toEqual(first);
    expect(f.tx.lead.updateMany).not.toHaveBeenCalled();
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('propagates receipt failure so the enclosing transaction rolls back every write', async () => {
    const f = fixture();
    f.tx.leadBatchPushReceipt.create.mockRejectedValueOnce(
      new Error('receipt write failed'),
    );
    await expect(
      f.service.pushBatch(actor, 'batch-key', {
        items: ids.map((leadId) => ({ leadId, expectedVersion: 1 })),
      }),
    ).rejects.toThrow('receipt write failed');
    expect(f.tx.lead.updateMany).toHaveBeenCalledTimes(2);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(2);
  });

  it('rechecks original receipt targets before fingerprint comparison and returns actual revoked indexes', async () => {
    const f = fixture();
    const receipt = {
      departmentId: actor.departmentId,
      actorUserId: actor.userId,
      idempotencyKey: 'batch-key',
      createdAt: new Date('2026-10-16T00:00:00.000Z'),
      originalRequest: {
        items: ids.map((leadId) => ({ leadId, expectedVersion: 1 })),
      },
      requestFingerprint: '0'.repeat(64),
      resultSnapshot: { items: [] },
    };
    f.tx.leadBatchPushReceipt.findUnique.mockResolvedValueOnce(receipt);
    f.tx.lead.findMany.mockResolvedValueOnce(
      ids.map((id) => ({
        id,
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
        teamId: null,
      })),
    );
    (f.access.authorizeLead as jest.Mock)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ForbiddenException('revoked'));
    try {
      await f.service.pushBatch(actor, 'batch-key', {
        items: [{ leadId: ids[0]!, expectedVersion: 2 }],
      });
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'BATCH_PUSH_REJECTED',
        details: { failures: [{ index: 1, code: 'NOT_AVAILABLE' }] },
      });
    }
    expect(f.tx.leadBatchPushReceipt.create).not.toHaveBeenCalled();
  });
});
