import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSession, login, logout } from './auth';

afterEach(() => vi.unstubAllGlobals());

const session = {
  principalType: 'INTERNAL',
  user: { id: 'user-1', displayName: '管理员', username: 'admin' },
  department: { id: 'department-1', name: '知产部' },
  departments: [{ id: 'department-1', name: '知产部' }],
  customer: null,
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
