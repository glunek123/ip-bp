import { NotaryOfficeAccountService } from './notary-office-account.service';

const actor = {
  userId: '10000000-0000-4000-8000-000000000001',
  departmentId: '20000000-0000-4000-8000-000000000001',
  authorizationRevision: 1,
};
const officeId = '30000000-0000-4000-8000-000000000001';
const accountId = '40000000-0000-4000-8000-000000000001';

function fixture() {
  const tx = {
    userAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
      create: jest
        .fn()
        .mockResolvedValue({
          id: accountId,
          displayName: '公证员',
          active: true,
        }),
      update: jest
        .fn()
        .mockResolvedValue({
          id: accountId,
          displayName: '公证员',
          active: false,
        }),
    },
    notaryOffice: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: officeId, status: 'ACTIVE' }),
    },
    localCredential: { create: jest.fn() },
    notaryOfficeAccountBinding: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest
        .fn()
        .mockResolvedValue({
          id: '50000000-0000-4000-8000-000000000001',
          active: true,
          version: 1,
        }),
      update: jest.fn().mockResolvedValue({ active: false, version: 2 }),
    },
    authSession: { updateMany: jest.fn() },
    auditEvent: { create: jest.fn() },
  };
  const db = {
    ...tx,
    $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const access = { authorizeDepartmentAction: jest.fn() };
  return {
    tx,
    db,
    access,
    service: new NotaryOfficeAccountService(db as never, access as never),
  };
}

describe('NotaryOfficeAccountService', () => {
  it('creates a real notary account, credential, binding and audit atomically', async () => {
    const f = fixture();
    const result = await f.service.create(actor, officeId, {
      displayName: '公证员',
      username: 'notary.a',
      password: 'correct horse battery staple',
    });
    expect(result).toMatchObject({
      id: accountId,
      username: 'notary.a',
      bindingActive: true,
      bindingVersion: 1,
    });
    expect(f.access.authorizeDepartmentAction).toHaveBeenCalledWith(
      actor,
      'notary.office.manage',
      f.tx,
    );
    expect(f.tx.userAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ accountType: 'NOTARY' }),
      select: expect.any(Object),
    });
    expect(f.tx.localCredential.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: accountId,
        username: 'notary.a',
        passwordHash: expect.stringMatching(/^scrypt\$v2\$/),
      }),
    });
    expect(f.tx.notaryOfficeAccountBinding.create).toHaveBeenCalledWith({
      data: {
        userId: accountId,
        departmentId: actor.departmentId,
        notaryOfficeId: officeId,
      },
      select: expect.any(Object),
    });
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('rejects creation when office is inactive without writing an account', async () => {
    const f = fixture();
    f.tx.notaryOffice.findFirst.mockResolvedValue({
      id: officeId,
      status: 'INACTIVE',
    });
    await expect(
      f.service.create(actor, officeId, {
        displayName: '公证员',
        username: 'notary.a',
        password: 'correct horse battery staple',
      }),
    ).rejects.toMatchObject({ response: { code: 'OFFICE_INACTIVE' } });
    expect(f.tx.userAccount.create).not.toHaveBeenCalled();
  });

  it('rejects external principals before permission lookup', async () => {
    const f = fixture();
    await expect(
      f.service.list({ ...actor, notaryOfficeId: officeId }, officeId),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.access.authorizeDepartmentAction).not.toHaveBeenCalled();
  });

  it('revokes sessions, increments version and audits a status change in one transaction', async () => {
    const f = fixture();
    f.tx.notaryOfficeAccountBinding.findFirst.mockResolvedValue({
      id: '50000000-0000-4000-8000-000000000001',
      userId: accountId,
      active: true,
      version: 1,
      user: {
        accountType: 'NOTARY',
        active: true,
        displayName: '公证员',
        localCredential: { username: 'notary.a' },
      },
    });
    const result = await f.service.setStatus(actor, officeId, accountId, false);
    expect(result).toMatchObject({
      accountActive: false,
      bindingActive: false,
      bindingVersion: 2,
    });
    expect(f.tx.authSession.updateMany).toHaveBeenCalledWith({
      where: { userId: accountId, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });
});
