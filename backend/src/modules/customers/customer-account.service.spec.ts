import { CustomerAccountService } from './customer-account.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 3,
};
const customer = {
  id: '33333333-3333-4333-8333-333333333333',
  departmentId: actor.departmentId,
  responsibleUserId: actor.userId,
  teamId: null,
  profileStatus: 'ADMITTED',
  name: '甲方企业',
};

function setup() {
  const transaction = {
    customer: { findFirst: jest.fn().mockResolvedValue(customer) },
    userAccount: {
      create: jest.fn().mockResolvedValue({
        id: '44444444-4444-4444-8444-444444444444',
        displayName: '客户审核人',
        active: true,
        authorizationRevision: 1,
      }),
      update: jest.fn().mockResolvedValue({
        id: '44444444-4444-4444-8444-444444444444',
        active: false,
        authorizationRevision: 2,
      }),
    },
    localCredential: { create: jest.fn() },
    customerAccountBinding: {
      create: jest.fn().mockResolvedValue({
        id: '55555555-5555-4555-8555-555555555555',
        userId: '44444444-4444-4444-8444-444444444444',
        customerId: customer.id,
        departmentId: actor.departmentId,
        active: true,
        version: 1,
      }),
      findFirst: jest.fn().mockResolvedValue({
        id: '55555555-5555-4555-8555-555555555555',
        userId: '44444444-4444-4444-8444-444444444444',
        customerId: customer.id,
        departmentId: actor.departmentId,
        active: true,
        version: 1,
        user: { active: true },
      }),
      update: jest.fn().mockResolvedValue({ active: false, version: 2 }),
    },
    authSession: { updateMany: jest.fn() },
    auditEvent: { create: jest.fn() },
  };
  const database = {
    customer: { findFirst: jest.fn().mockResolvedValue(customer) },
    customerAccountBinding: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(
      async (callback: (value: typeof transaction) => unknown) =>
        callback(transaction),
    ),
  };
  const access = { authorizeCustomer: jest.fn().mockResolvedValue(undefined) };
  const organization = {
    loadCurrentActorGrants: jest.fn().mockResolvedValue([
      { action: 'USER_MANAGE', scope: 'DEPARTMENT', teamId: null },
    ]),
  };
  const service = new CustomerAccountService(
    database as never,
    access as never,
    organization as never,
  );
  return { service, database, transaction, access, organization };
}

describe('CustomerAccountService', () => {
  it('creates a client-only account, credential, enterprise binding and audit atomically', async () => {
    const { service, transaction } = setup();

    const result = await service.create(actor, customer.id, {
      displayName: ' 客户审核人 ',
      username: ' CLIENT.A ',
      password: 'correct horse battery staple',
    });

    expect(transaction.userAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        displayName: '客户审核人',
        accountType: 'CLIENT',
      }),
      select: expect.any(Object),
    });
    expect(transaction.localCredential.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ username: 'client.a' }),
    });
    expect(transaction.customerAccountBinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId: customer.id,
        departmentId: actor.departmentId,
      }),
      select: expect.any(Object),
    });
    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'client-account.created' }),
    });
    expect(result).toMatchObject({
      displayName: '客户审核人',
      username: 'client.a',
      accountActive: true,
      bindingActive: true,
    });
  });

  it('rejects account management without department-wide USER_MANAGE', async () => {
    const { service, organization, transaction } = setup();
    organization.loadCurrentActorGrants.mockResolvedValue([
      { action: 'USER_MANAGE', scope: 'TEAM', teamId: null },
    ]);

    await expect(
      service.create(actor, customer.id, {
        displayName: '客户审核人',
        username: 'client.a',
        password: 'correct horse battery staple',
      }),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(transaction.userAccount.create).not.toHaveBeenCalled();
  });

  it('rejects binding a client account to a customer that is no longer admitted', async () => {
    const { service, transaction } = setup();
    transaction.customer.findFirst.mockResolvedValue({
      ...customer,
      profileStatus: 'DRAFT',
    });

    await expect(
      service.create(actor, customer.id, {
        displayName: '客户审核人',
        username: 'client.a',
        password: 'correct horse battery staple',
      }),
    ).rejects.toMatchObject({
      response: { code: 'CUSTOMER_NOT_ADMITTED' },
    });
  });

  it('deactivates both account and binding, revokes sessions and audits in one transaction', async () => {
    const { service, transaction } = setup();
    const result = await service.setStatus(
      actor,
      customer.id,
      '44444444-4444-4444-8444-444444444444',
      false,
    );

    expect(transaction.customerAccountBinding.update).toHaveBeenCalledWith({
      where: { id: '55555555-5555-4555-8555-555555555555' },
      data: { active: false, version: { increment: 1 } },
      select: expect.any(Object),
    });
    expect(transaction.userAccount.update).toHaveBeenCalledWith({
      where: { id: '44444444-4444-4444-8444-444444444444' },
      data: { active: false, authorizationRevision: { increment: 1 } },
      select: expect.any(Object),
    });
    expect(transaction.authSession.updateMany).toHaveBeenCalledWith({
      where: {
        userId: '44444444-4444-4444-8444-444444444444',
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(result).toMatchObject({
      accountActive: false,
      bindingActive: false,
    });
  });
});
