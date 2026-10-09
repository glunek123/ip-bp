import { createHash } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { CustomerLifecycleService } from './customer-lifecycle.service';

const actor: ActorContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const id = '33333333-3333-4333-8333-333333333333';

describe('CustomerLifecycleService legacy receipt projection', () => {
  const input = { expectedVersion: 1, reason: '清理空草稿' };
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        action: 'DELETE',
        id,
        expectedVersion: 1,
        reason: input.reason,
      }),
    )
    .digest('hex');
  const snapshot = {
    id,
    name: '历史草稿',
    profileStatus: 'draft',
    departmentId: actor.departmentId,
    responsibleUserId: actor.userId,
    version: 2,
    updatedAt: '2026-09-20T00:00:00.000Z',
  };

  function fixture() {
    const receiptFindUnique = jest.fn().mockResolvedValue({
      requestFingerprint: fingerprint,
      action: 'DELETE',
      customerId: id,
      resultSnapshot: snapshot,
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id }]),
      customer: {
        findFirst: jest.fn().mockResolvedValue({
          id,
          departmentId: actor.departmentId,
          version: 5,
        }),
        updateMany: jest.fn(),
      },
      customerDraftLifecycleReceipt: { findUnique: receiptFindUnique },
    };
    const database = {
      $transaction: jest.fn(
        async (callback: (transaction: typeof tx) => unknown) => callback(tx),
      ),
    } as unknown as DatabaseService;
    const buildCustomerScope = jest
      .fn()
      .mockResolvedValue({ departmentId: actor.departmentId });
    const access = { buildCustomerScope } as unknown as AccessControlService;
    return {
      service: new CustomerLifecycleService(database, access),
      tx,
      buildCustomerScope,
    };
  }

  it('replays a legacy result with the then-implicit COOPERATING status and no write', async () => {
    const { service, tx } = fixture();
    await expect(
      service.deleteDraft(actor, id, 'legacy-key', input),
    ).resolves.toEqual({
      ...snapshot,
      cooperationStatus: 'COOPERATING',
    });
    expect(tx.customer.updateMany).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveProperty('cooperationStatus');
  });

  it('checks current authorization before reading a legacy receipt', async () => {
    const { service, tx, buildCustomerScope } = fixture();
    buildCustomerScope.mockRejectedValue(new ForbiddenException('revoked'));
    await expect(
      service.deleteDraft(actor, id, 'legacy-key', input),
    ).rejects.toThrow(ForbiddenException);
    expect(tx.customerDraftLifecycleReceipt.findUnique).not.toHaveBeenCalled();
  });
});
