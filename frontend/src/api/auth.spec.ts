import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSession, login, logout } from './auth';

afterEach(() => vi.unstubAllGlobals());

const session = {
  user: { id: 'user-1', displayName: '管理员', username: 'admin' },
  department: { id: 'department-1', name: '知产部' },
  departments: [{ id: 'department-1', name: '知产部' }],
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
