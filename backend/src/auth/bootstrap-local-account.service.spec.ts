import { bootstrapLocalAccount } from './bootstrap-local-account.service';

describe('bootstrapLocalAccount', () => {
  it('creates the first local account and every current fixed grant atomically', async () => {
    const transaction = {
      localCredential: { count: jest.fn().mockResolvedValue(0) },
      userAccount: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'user-1' }),
      },
      roleTemplate: {
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'role-1' }),
      },
      department: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'department-1' }),
      },
      localCredentialCreate: jest.fn(),
      roleGrant: { createMany: jest.fn() },
      departmentMembership: { create: jest.fn() },
      roleAssignment: { create: jest.fn() },
      localCredentialModel: { create: jest.fn() },
    };
    const database = {
      localCredential: { count: jest.fn().mockResolvedValue(0) },
      userAccount: { count: jest.fn().mockResolvedValue(0) },
      roleTemplate: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
        callback({
          ...transaction,
          localCredential: {
            count: transaction.localCredential.count,
            create: transaction.localCredentialModel.create,
          },
        }),
      ),
    };

    await expect(
      bootstrapLocalAccount(database as never, {
        departmentName: '知产部',
        username: 'Admin.User',
        displayName: '系统管理员',
        password: 'correct horse battery staple',
      }),
    ).resolves.toEqual({ username: 'admin.user', departmentName: '知产部' });
    expect(transaction.userAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        displayName: '系统管理员',
        externalSubject: expect.stringMatching(/^local:/),
      }),
    });
    expect(transaction.roleGrant.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          action: 'CUSTOMER_READ',
          scope: 'DEPARTMENT',
        }),
        expect.objectContaining({
          action: 'CUSTOMER_CREATE_DRAFT',
          scope: 'DEPARTMENT',
        }),
        expect.objectContaining({
          action: 'CUSTOMER_EDIT_ROUTINE',
          scope: 'DEPARTMENT',
        }),
        expect.objectContaining({ action: 'USER_READ', scope: 'DEPARTMENT' }),
        expect.objectContaining({ action: 'USER_MANAGE', scope: 'DEPARTMENT' }),
        expect.objectContaining({ action: 'TEAM_READ', scope: 'DEPARTMENT' }),
        expect.objectContaining({ action: 'TEAM_MANAGE', scope: 'DEPARTMENT' }),
        expect.objectContaining({ action: 'ROLE_READ', scope: 'DEPARTMENT' }),
        expect.objectContaining({ action: 'ROLE_ASSIGN', scope: 'DEPARTMENT' }),
      ]),
    });
  });

  it('refuses to run after any local credential exists', async () => {
    const database = {
      localCredential: { count: jest.fn().mockResolvedValue(1) },
      userAccount: { count: jest.fn().mockResolvedValue(0) },
      roleTemplate: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(),
    };
    await expect(
      bootstrapLocalAccount(database as never, {
        departmentName: '知产部',
        username: 'admin',
        displayName: '系统管理员',
        password: 'correct horse battery staple',
      }),
    ).rejects.toThrow('LOCAL_ACCOUNT_ALREADY_INITIALIZED');
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'a local external subject',
      userAccounts: 1,
      administratorRoles: 0,
    },
    {
      label: 'a system administrator role in any department',
      userAccounts: 0,
      administratorRoles: 1,
    },
  ])('refuses partial initialization containing $label', async (partial) => {
    const database = {
      localCredential: { count: jest.fn().mockResolvedValue(0) },
      userAccount: {
        count: jest.fn().mockResolvedValue(partial.userAccounts),
      },
      roleTemplate: {
        count: jest.fn().mockResolvedValue(partial.administratorRoles),
      },
      $transaction: jest.fn(),
    };

    await expect(
      bootstrapLocalAccount(database as never, {
        departmentName: '知产部',
        username: 'admin',
        displayName: '系统管理员',
        password: 'correct horse battery staple',
      }),
    ).rejects.toThrow('LOCAL_ACCOUNT_PARTIAL_INITIALIZATION');
    expect(database.userAccount.count).toHaveBeenCalledWith({
      where: { externalSubject: { startsWith: 'local:' } },
    });
    expect(database.roleTemplate.count).toHaveBeenCalledWith({
      where: { name: '系统管理员' },
    });
    expect(database.$transaction).not.toHaveBeenCalled();
  });
});
