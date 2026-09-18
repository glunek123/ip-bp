import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { hashPassword } from './password';

const department = {
  id: '10000000-0000-4000-8000-000000000001',
  name: '知产部',
};
const userId = '20000000-0000-4000-8000-000000000001';

function createDatabase() {
  const transaction = {
    authThrottle: {
      deleteMany: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    localCredential: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    authSession: { create: jest.fn() },
  };
  return {
    authSession: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    departmentMembership: { findUnique: jest.fn() },
    $transaction: jest.fn(
      async (callback: (value: typeof transaction) => unknown) =>
        callback(transaction),
    ),
    transaction,
  };
}

describe('AuthService', () => {
  it('creates a 12-hour opaque session for one active department', async () => {
    const database = createDatabase();
    database.transaction.localCredential.findUnique.mockResolvedValue({
      userId,
      username: 'admin',
      passwordHash: await hashPassword('correct horse battery staple'),
      user: {
        id: userId,
        displayName: '管理员',
        active: true,
        authorizationRevision: 3,
        memberships: [{ departmentId: department.id, department }],
      },
    });
    const auth = new AuthService(
      database as never,
      { getOrThrow: () => 'a'.repeat(64) } as unknown as ConfigService,
    );

    const result = await auth.login(
      { username: ' ADMIN ', password: 'correct horse battery staple' },
      '127.0.0.1',
    );

    expect(result.sessionToken).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(result.view).toMatchObject({
      user: { id: userId, displayName: '管理员', username: 'admin' },
      department,
      departments: [department],
      authorizationRevision: 3,
    });
    expect(database.transaction.authSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId,
        departmentId: department.id,
        tokenDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        csrfDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    });
    expect(database.transaction.authThrottle.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ kind: 'USERNAME' }),
    });
  });

  it('does not reveal whether the username or password was wrong', async () => {
    const database = createDatabase();
    database.transaction.localCredential.findUnique.mockResolvedValue(null);
    const auth = new AuthService(
      database as never,
      { getOrThrow: () => 'a'.repeat(64) } as unknown as ConfigService,
    );

    await expect(
      auth.login(
        { username: 'unknown', password: 'wrong password value' },
        '127.0.0.1',
      ),
    ).rejects.toMatchObject({
      response: { code: 'AUTHENTICATION_FAILED' },
      status: 401,
    });
    expect(database.transaction.$executeRaw).toHaveBeenCalledTimes(2);
    expect(database.transaction.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('requires a department choice before establishing a session', async () => {
    const database = createDatabase();
    database.transaction.localCredential.findUnique.mockResolvedValue({
      userId,
      username: 'admin',
      passwordHash: await hashPassword('correct horse battery staple'),
      user: {
        id: userId,
        displayName: '管理员',
        active: true,
        authorizationRevision: 1,
        memberships: [
          { departmentId: department.id, department },
          {
            departmentId: '10000000-0000-4000-8000-000000000002',
            department: {
              id: '10000000-0000-4000-8000-000000000002',
              name: '品维部',
            },
          },
        ],
      },
    });
    const auth = new AuthService(
      database as never,
      { getOrThrow: () => 'a'.repeat(64) } as unknown as ConfigService,
    );

    await expect(
      auth.login(
        { username: 'admin', password: 'correct horse battery staple' },
        '127.0.0.1',
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'DEPARTMENT_REQUIRED',
        details: {
          departments: [
            department,
            expect.objectContaining({ name: '品维部' }),
          ],
        },
      },
    });
    expect(database.transaction.authSession.create).not.toHaveBeenCalled();
  });

  it('returns retry details when a serialized login bucket is blocked', async () => {
    const database = createDatabase();
    database.transaction.authThrottle.findFirst.mockResolvedValue({
      blockedUntil: new Date(Date.now() + 30_000),
    });
    const auth = new AuthService(
      database as never,
      { getOrThrow: () => 'a'.repeat(64) } as unknown as ConfigService,
    );

    await expect(
      auth.login(
        { username: 'admin', password: 'correct horse battery staple' },
        '127.0.0.1',
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'LOGIN_RATE_LIMITED',
        details: { retryAfterSeconds: expect.any(Number) },
      },
      status: 429,
    });
    expect(
      database.transaction.localCredential.findUnique,
    ).not.toHaveBeenCalled();
  });

  it('re-reads account and membership state for every session request', async () => {
    const database = createDatabase();
    database.authSession.findUnique.mockResolvedValue({
      id: '30000000-0000-4000-8000-000000000001',
      userId,
      departmentId: department.id,
      csrfDigest: 'a'.repeat(64),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 10_000),
      user: { active: true, authorizationRevision: 9 },
    });
    database.departmentMembership.findUnique.mockResolvedValue({
      active: true,
    });
    const auth = new AuthService(
      database as never,
      { getOrThrow: () => 'a'.repeat(64) } as unknown as ConfigService,
    );

    await expect(auth.resolveSession('token')).resolves.toEqual({
      actor: { userId, departmentId: department.id, authorizationRevision: 9 },
      authentication: {
        kind: 'session',
        sessionId: '30000000-0000-4000-8000-000000000001',
        csrfDigest: 'a'.repeat(64),
      },
    });
    expect(database.authSession.update).toHaveBeenCalledWith({
      where: { id: '30000000-0000-4000-8000-000000000001' },
      data: expect.objectContaining({ authorizationRevision: 9 }),
    });
  });

  it.each([
    ['revoked', new Date(), new Date(Date.now() + 10_000), true],
    ['expired', null, new Date(Date.now() - 1), true],
    ['inactive account', null, new Date(Date.now() + 10_000), false],
  ])(
    'rejects a %s session before authorizing it',
    async (_, revokedAt, expiresAt, active) => {
      const database = createDatabase();
      database.authSession.findUnique.mockResolvedValue({
        id: '30000000-0000-4000-8000-000000000001',
        userId,
        departmentId: department.id,
        csrfDigest: 'a'.repeat(64),
        revokedAt,
        expiresAt,
        user: { active, authorizationRevision: 1 },
      });
      const auth = new AuthService(
        database as never,
        { getOrThrow: () => 'a'.repeat(64) } as unknown as ConfigService,
      );

      await expect(auth.resolveSession('token')).resolves.toBeNull();
      expect(database.departmentMembership.findUnique).not.toHaveBeenCalled();
    },
  );

  it('rejects a disabled membership on the next request', async () => {
    const database = createDatabase();
    database.authSession.findUnique.mockResolvedValue({
      id: '30000000-0000-4000-8000-000000000001',
      userId,
      departmentId: department.id,
      csrfDigest: 'a'.repeat(64),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 10_000),
      user: { active: true, authorizationRevision: 1 },
    });
    database.departmentMembership.findUnique.mockResolvedValue({
      active: false,
    });
    const auth = new AuthService(
      database as never,
      { getOrThrow: () => 'a'.repeat(64) } as unknown as ConfigService,
    );

    await expect(auth.resolveSession('token')).resolves.toBeNull();
  });
});
