import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/http';
import { useAuthStore } from './auth';

const api = vi.hoisted(() => ({
  getSession: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));
const http = vi.hoisted(() => ({ setCsrfToken: vi.fn() }));

vi.mock('../api/auth', () => api);
vi.mock('../api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/http')>()),
  setCsrfToken: http.setCsrfToken,
}));

const session = {
  principalType: 'INTERNAL' as const,
  user: { id: 'user-1', displayName: '管理员', username: 'admin' },
  department: { id: 'department-1', name: '知产部' },
  departments: [{ id: 'department-1', name: '知产部' }],
  customer: null,
  authorizationRevision: 1,
  expiresAt: '2026-09-18T00:00:00.000Z',
  csrfToken: 'csrf-token',
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
});

describe('auth store', () => {
  it('restores an existing session only once', async () => {
    api.getSession.mockResolvedValue(session);
    const store = useAuthStore();

    await store.restore();
    await store.restore();

    expect(store.session).toEqual(session);
    expect(store.restored).toBe(true);
    expect(api.getSession).toHaveBeenCalledOnce();
  });

  it('treats only an explicit unauthorized response as anonymous', async () => {
    api.getSession.mockRejectedValue(
      new ApiError('请登录', 401, 'UNAUTHORIZED'),
    );
    const store = useAuthStore();

    await expect(store.restore()).resolves.toBeUndefined();

    expect(store.session).toBeNull();
    expect(store.restored).toBe(true);
    expect(http.setCsrfToken).toHaveBeenCalledWith(null);
  });

  it.each([
    ['a network failure', new ApiError('无法连接服务', 0, 'NETWORK_ERROR')],
    [
      'a server failure',
      new ApiError('服务暂时不可用', 503, 'SERVICE_UNAVAILABLE'),
    ],
    [
      'an invalid response',
      new ApiError('服务返回了无效的登录信息', 200, 'INVALID_RESPONSE'),
    ],
  ])('keeps restore retryable after %s', async (_label, error) => {
    api.getSession.mockRejectedValueOnce(error).mockResolvedValueOnce(session);
    const store = useAuthStore();

    await expect(store.restore()).rejects.toBe(error);
    expect(store.session).toBeNull();
    expect(store.restored).toBe(false);
    expect(http.setCsrfToken).not.toHaveBeenCalled();

    await expect(store.restore()).resolves.toBeUndefined();
    expect(store.session).toEqual(session);
    expect(store.restored).toBe(true);
    expect(api.getSession).toHaveBeenCalledTimes(2);
  });

  it('keeps local authentication state when logout fails', async () => {
    api.login.mockResolvedValue(session);
    api.logout.mockRejectedValue(new Error('offline'));
    const store = useAuthStore();
    await store.login('admin', 'correct horse battery staple');

    await expect(store.logout()).rejects.toThrow('offline');

    expect(store.session).toEqual(session);
    expect(store.restored).toBe(true);
    expect(http.setCsrfToken).not.toHaveBeenCalled();
  });

  it('clears local authentication state after logout succeeds', async () => {
    api.login.mockResolvedValue(session);
    api.logout.mockResolvedValue(undefined);
    const store = useAuthStore();
    await store.login('admin', 'correct horse battery staple');

    await store.logout();

    expect(store.session).toBeNull();
    expect(store.restored).toBe(true);
    expect(http.setCsrfToken).toHaveBeenCalledWith(null);
  });
});
