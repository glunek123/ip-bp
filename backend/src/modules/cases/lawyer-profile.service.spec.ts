import { LawyerProfileService } from './lawyer-profile.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const profileId = '33333333-3333-4333-8333-333333333333';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: profileId,
    departmentId: actor.departmentId,
    boundUserId: null,
    fullName: '顾言',
    lawFirm: '远泽律师事务所',
    phone: '13800000000',
    email: 'guyan@example.com',
    barNumber: '13301202010000001',
    lawFirmCreditCode: '91330100MA2XXXXXXX',
    region: '浙江省杭州市',
    address: null,
    status: 'ACTIVE',
    source: 'MANUAL',
    version: 2,
    createdAt: new Date('2026-11-20T00:00:00Z'),
    updatedAt: new Date('2026-11-20T00:00:00Z'),
    accountBinding: null,
    _count: { assignments: 3 },
    ...overrides,
  };
}

function fixture() {
  const tx = {
    userAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ active: true, accountType: 'INTERNAL' }),
    },
    lawyerProfile: {
      findFirst: jest.fn().mockResolvedValue(row()),
      findMany: jest.fn().mockResolvedValue([row()]),
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn().mockResolvedValue({ id: profileId }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const db = {
    ...tx,
    $transaction: jest.fn(async (work: (client: typeof tx) => unknown) =>
      work(tx),
    ),
  };
  const access = {
    authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
  };
  const accounts = { createForProfile: jest.fn().mockResolvedValue({}) };
  return {
    tx,
    access,
    accounts,
    service: new LawyerProfileService(
      db as never,
      access as never,
      accounts as never,
    ),
  };
}

describe('LawyerProfileService', () => {
  it('lists only the current department and keeps the account filter explicit', async () => {
    const f = fixture();
    const result = await f.service.list(actor, {
      page: 1,
      pageSize: 20,
      account: 'WITHOUT_ACCOUNT',
      status: 'ACTIVE',
    });
    expect(f.tx.lawyerProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          departmentId: actor.departmentId,
          status: 'ACTIVE',
          accountBinding: { is: null },
        }),
      }),
    );
    expect(result.items[0]).toMatchObject({
      id: profileId,
      hasAccount: false,
      assignmentCount: 3,
      barNumber: '13301202010000001',
    });
  });

  it('reports a stopped account as not usable but keeps the binding visible', async () => {
    const f = fixture();
    f.tx.lawyerProfile.findMany.mockResolvedValue([
      row({
        accountBinding: {
          userId: '44444444-4444-4444-8444-444444444444',
          active: true,
          user: {
            active: false,
            localCredential: { username: 'guyan' },
          },
        },
      }),
    ]);
    const result = await f.service.list(actor, { page: 1, pageSize: 20 });
    expect(result.items[0]).toMatchObject({
      hasAccount: false,
      account: {
        accountId: '44444444-4444-4444-8444-444444444444',
        username: 'guyan',
        active: false,
      },
    });
  });

  it('creates a manual profile inside the department', async () => {
    const f = fixture();
    await f.service.create(actor, {
      fullName: ' 林岸 ',
      lawFirm: '海城律所',
      barNumber: '13301202010000002',
    });
    expect(f.tx.lawyerProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        departmentId: actor.departmentId,
        fullName: '林岸',
        lawFirm: '海城律所',
        barNumber: '13301202010000002',
        email: null,
        region: null,
        source: 'MANUAL',
      }),
      select: { id: true },
    });
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'lawyer-profile.created' }),
      }),
    );
  });

  it('rejects a stale version before updating', async () => {
    const f = fixture();
    await expect(
      f.service.update(actor, profileId, {
        phone: '13900000000',
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT' },
    });
    expect(f.tx.lawyerProfile.updateMany).not.toHaveBeenCalled();
  });

  it('clears an optional field when null is sent', async () => {
    const f = fixture();
    await f.service.update(actor, profileId, {
      email: null,
      expectedVersion: 2,
    });
    expect(f.tx.lawyerProfile.updateMany).toHaveBeenCalledWith({
      where: {
        id: profileId,
        departmentId: actor.departmentId,
        version: 2,
      },
      data: { email: null, version: { increment: 1 } },
    });
  });

  it('stops a profile so assignment candidates drop it', async () => {
    const f = fixture();
    await f.service.setStatus(actor, profileId, false, 2);
    expect(f.tx.lawyerProfile.updateMany).toHaveBeenCalledWith({
      where: {
        id: profileId,
        departmentId: actor.departmentId,
        version: 2,
      },
      data: { status: 'INACTIVE', version: { increment: 1 } },
    });
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'lawyer-profile.status-changed',
        }),
      }),
    );
  });

  it('does not write when the profile is already in the requested state', async () => {
    const f = fixture();
    await f.service.setStatus(actor, profileId, true, 2);
    expect(f.tx.lawyerProfile.updateMany).not.toHaveBeenCalled();
  });

  it('opens an account through the account service after checking the profile', async () => {
    const f = fixture();
    await f.service.openAccount(actor, profileId, {
      username: 'guyan',
      password: 'Valid-password-2026!',
    });
    expect(f.accounts.createForProfile).toHaveBeenCalledWith(actor, profileId, {
      username: 'guyan',
      password: 'Valid-password-2026!',
    });
  });

  it('refuses cross-department profiles before any write', async () => {
    const f = fixture();
    f.tx.lawyerProfile.findFirst.mockResolvedValue(null);
    await expect(
      f.service.update(actor, profileId, {
        phone: '13900000000',
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    expect(f.tx.lawyerProfile.updateMany).not.toHaveBeenCalled();
  });
});
