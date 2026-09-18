import { ApiError } from '../api/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  session: null as null | { user: { id: string } },
  restore: vi.fn(),
}));

vi.mock('../stores/auth', () => ({ useAuthStore: () => auth }));

import { router } from './router';

beforeEach(async () => {
  auth.session = null;
  vi.resetAllMocks();
  auth.restore.mockResolvedValue(undefined);
  await router.push('/health');
});

describe('authentication routing', () => {
  it('does not run session restoration before entering a public page', async () => {
    await router.push('/login');

    expect(router.currentRoute.value.path).toBe('/login');
    expect(auth.restore).not.toHaveBeenCalled();
  });

  it('shows the connection page when protected-route restoration fails', async () => {
    auth.restore.mockRejectedValue(
      new ApiError('无法连接服务', 0, 'NETWORK_ERROR'),
    );

    await router.push('/customers/customer-1?tab=history');

    expect(router.currentRoute.value.path).toBe('/health');
  });

  it('keeps the protected destination as a safe login return path', async () => {
    await router.push('/customers/customer-1?tab=history');

    expect(router.currentRoute.value.fullPath).toBe(
      '/login?returnTo=/customers/customer-1?tab=history',
    );
  });
});
