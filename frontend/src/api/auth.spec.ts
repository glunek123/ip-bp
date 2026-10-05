import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSession, login, logout } from './auth';

afterEach(() => vi.unstubAllGlobals());

const session = {
  principalType: 'INTERNAL',
  user: { id: 'user-1', displayName: '管理员', username: 'admin' },
  department: { id: 'department-1', name: '知产部' },
  departments: [{ id: 'department-1', name: '知产部' }],
  customer: null,
  notaryOffice: null,
  authorizationRevision: 1,
  expiresAt: '2026-09-18T00:00:00.000Z',
  csrfToken: 'csrf-token',
};

describe('auth API', () => {
  it('logs in and restores a validated session', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(session))),
      );
    vi.stubGlobal('fetch', fetch);
    await expect(
      login('admin', 'correct horse battery staple'),
    ).resolves.toEqual(session);
    await expect(getSession()).resolves.toEqual(session);
  });

  it('accepts a client session without exposing an internal department', async () => {
    const clientSession = {
      ...session,
      principalType: 'CLIENT',
      department: null,
      departments: [],
      customer: { id: 'customer-1', name: '甲方企业' },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(clientSession))),
    );

    await expect(
      login('client.a', 'correct horse battery staple'),
    ).resolves.toEqual(clientSession);
  });

  it('accepts a strictly isolated notary session', async () => {
    const notarySession = {
      ...session,
      principalType: 'NOTARY',
      department: null,
      departments: [],
      customer: null,
      notaryOffice: { id: 'office-1', name: '南方公证处' },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(notarySession))),
    );
    await expect(
      login('notary.user', 'correct horse battery staple'),
    ).resolves.toEqual(notarySession);
  });

  it('accepts a strictly isolated lawyer session', async () => {
    const lawyerSession = {
      ...session,
      principalType: 'LAWYER',
      department: null,
      departments: [],
      customer: null,
      notaryOffice: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(lawyerSession))),
    );

    await expect(
      login('lawyer.user', 'correct horse battery staple'),
    ).resolves.toEqual(lawyerSession);
  });

  it('rejects a lawyer session that contains a client identity', async () => {
    const invalid = {
      ...session,
      principalType: 'LAWYER',
      department: null,
      departments: [],
      customer: { id: 'customer-1', name: '甲方企业' },
      notaryOffice: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(invalid))),
    );

    await expect(getSession()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects a notary session with an internal department', async () => {
    const invalid = {
      ...session,
      principalType: 'NOTARY',
      notaryOffice: { id: 'office-1', name: '南方公证处' },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(invalid))),
    );
    await expect(getSession()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('sends logout with the CSRF token established by login', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(session)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    await login('admin', 'correct horse battery staple');
    await logout();
    expect(fetch.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-token' }),
      }),
    );
  });
});
