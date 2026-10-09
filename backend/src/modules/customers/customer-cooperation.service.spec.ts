import { ForbiddenException } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { OrganizationService } from '../../access-control/organization.service';
import { DatabaseService } from '../../database/database.service';
import { CustomerCooperationService } from './customer-cooperation.service';

const actor: ActorContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const customerId = '33333333-3333-4333-8333-333333333333';
const targetUserId = '44444444-4444-4444-8444-444444444444';
const when = new Date('2026-10-09T01:00:00.000Z');

function fixture() {
  const customer = {
    id: customerId,
    departmentId: actor.departmentId,
    responsibleUserId: actor.userId,
    teamId: '55555555-5555-4555-8555-555555555555',
    version: 1,
    cooperationStatus: 'COOPERATING' as const,
    deletedAt: null,
  };
  const factCreate = jest.fn().mockResolvedValue({
    id: '66666666-6666-4666-8666-666666666666',
    toVersion: 2,
    occurredAt: when,
  });
  const receiptFindUnique = jest.fn().mockResolvedValue(null);
  const receiptCreate = jest.fn().mockResolvedValue({});
  const auditCreate = jest
    .fn()
    .mockResolvedValue({ id: '77777777-7777-4777-8777-777777777777' });
  const customerFindFirst = jest.fn().mockResolvedValue(customer);
  const queryRaw = jest.fn().mockResolvedValue([{ id: customerId }]);
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const tx = {
    $queryRaw: queryRaw,
    customer: { findFirst: customerFindFirst, updateMany },
    customerMaintenanceReceipt: {
      findUnique: receiptFindUnique,
      create: receiptCreate,
    },
    customerMaintenanceFact: { create: factCreate },
    auditEvent: { create: auditCreate },
    departmentMembership: {
      findUnique: jest.fn().mockResolvedValue({
        active: true,
        teamId: null,
        team: null,
        user: { active: true, accountType: 'INTERNAL' },
      }),
    },
  };
  const transaction = jest.fn(async (callback: (value: typeof tx) => unknown) =>
    callback(tx),
  );
  const access = {
    buildCustomerScope: jest
      .fn()
      .mockResolvedValue({ departmentId: actor.departmentId }),
    canAuthorizeCustomer: jest
      .fn()
      .mockImplementation(
        async (_actor, _action, facts) =>
          facts.responsibleUserId === actor.userId,
      ),
  };
  const organization = {
    lockDepartment: jest.fn().mockResolvedValue(undefined),
    loadCurrentActorGrants: jest.fn().mockResolvedValue([]),
  };
  const service = new CustomerCooperationService(
    { $transaction: transaction } as unknown as DatabaseService,
    access as unknown as AccessControlService,
    organization as unknown as OrganizationService,
  );
  return {
    service,
    tx,
    access,
    organization,
    transaction,
    customer,
    receiptFindUnique,
    receiptCreate,
    factCreate,
    auditCreate,
    updateMany,
    customerFindFirst,
    queryRaw,
  };
}

describe('CustomerCooperationService', () => {
  it('transfers a SELF customer, keeps customer team, and returns success after losing read', async () => {
    const f = fixture();
    await expect(
      f.service.transferResponsible(actor, customerId, 'transfer-key', {
        expectedVersion: 1,
        targetUserId,
        reason: ' 调整分工 ',
      }),
    ).resolves.toEqual({
      customerId,
      action: 'responsible-transfer',
      resultVersion: 2,
      occurredAt: when.toISOString(),
      canReadAfter: false,
    });
    expect(f.organization.lockDepartment).toHaveBeenCalledWith(
      f.tx,
      actor.departmentId,
    );
    expect(f.organization.loadCurrentActorGrants).not.toHaveBeenCalled();
    expect(f.queryRaw.mock.calls.length).toBeGreaterThan(1);
    expect(f.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: customerId,
        version: 1,
        responsibleUserId: actor.userId,
      }),
      data: { responsibleUserId: targetUserId, version: { increment: 1 } },
    });
    expect(f.factCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'TRANSFER',
        fromResponsibleUserId: actor.userId,
        toResponsibleUserId: targetUserId,
        reason: '调整分工',
        fromVersion: 1,
        toVersion: 2,
      }),
    });
    expect(f.receiptCreate).toHaveBeenCalledTimes(1);
  });

  it('replays an old fact after the target becomes ineligible without redoing writes', async () => {
    const f = fixture();
    f.customerFindFirst.mockResolvedValue({
      ...f.customer,
      responsibleUserId: targetUserId,
      version: 4,
    });
    const input = { expectedVersion: 1, targetUserId, reason: '调整分工' };
    // Obtain the canonical fingerprint from a first success in an independent fixture.
    const initial = fixture();
    await initial.service.transferResponsible(
      actor,
      customerId,
      'same-key',
      input,
    );
    const fingerprint =
      initial.receiptCreate.mock.calls[0]?.[0]?.data.requestFingerprint;
    f.receiptFindUnique.mockResolvedValue({
      customerId,
      action: 'TRANSFER',
      requestFingerprint: fingerprint,
      fact: { toVersion: 2, occurredAt: when },
    });
    f.tx.departmentMembership.findUnique.mockRejectedValue(
      new Error('target must not be checked'),
    );

    await expect(
      f.service.transferResponsible(actor, customerId, 'same-key', input),
    ).resolves.toMatchObject({ resultVersion: 2, canReadAfter: false });
    expect(f.tx.departmentMembership.findUnique).not.toHaveBeenCalled();
    expect(f.updateMany).not.toHaveBeenCalled();
    expect(f.auditCreate).not.toHaveBeenCalled();
    expect(f.factCreate).not.toHaveBeenCalled();
    expect(f.receiptCreate).not.toHaveBeenCalled();
  });

  it('checks current read and action before consulting a receipt', async () => {
    const f = fixture();
    f.access.buildCustomerScope.mockRejectedValue(
      new ForbiddenException('revoked'),
    );
    await expect(
      f.service.changeCooperation(actor, customerId, 'old-key', {
        expectedVersion: 1,
        action: 'pause',
        reason: '暂停',
      }),
    ).rejects.toMatchObject({ response: { code: 'CUSTOMER_NOT_FOUND' } });
    expect(f.receiptFindUnique).not.toHaveBeenCalled();
    expect(f.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['pause', 'PAUSE', 'PAUSED'],
    ['terminate', 'TERMINATE', 'TERMINATED'],
  ] as const)(
    'records %s as a versioned fact',
    async (action, factAction, status) => {
      const f = fixture();
      await f.service.changeCooperation(actor, customerId, `${action}-key`, {
        expectedVersion: 1,
        action,
        reason: ' 业务原因 ',
      });
      expect(f.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          cooperationStatus: 'COOPERATING',
          version: 1,
        }),
        data: { cooperationStatus: status, version: { increment: 1 } },
      });
      expect(f.factCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: factAction,
          fromCooperationStatus: 'COOPERATING',
          toCooperationStatus: status,
          reason: '业务原因',
        }),
      });
    },
  );

  it('rejects an invalid transition without any write', async () => {
    const f = fixture();
    await expect(
      f.service.changeCooperation(actor, customerId, 'resume-key', {
        expectedVersion: 1,
        action: 'resume',
      }),
    ).rejects.toMatchObject({
      response: { code: 'CUSTOMER_COOPERATION_STATE_CONFLICT' },
    });
    expect(f.updateMany).not.toHaveBeenCalled();
    expect(f.auditCreate).not.toHaveBeenCalled();
  });

  it('propagates a fact failure from the same transaction', async () => {
    const f = fixture();
    f.factCreate.mockRejectedValue(new Error('fact failed'));
    await expect(
      f.service.changeCooperation(actor, customerId, 'pause-key', {
        expectedVersion: 1,
        action: 'pause',
        reason: '暂停',
      }),
    ).rejects.toThrow('fact failed');
    expect(f.receiptCreate).not.toHaveBeenCalled();
  });
});
