import { ApiError } from '../api/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  session: null as null | {
    principalType: 'INTERNAL' | 'CLIENT';
    user: { id: string };
  },
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

  it('protects the personnel management route', async () => {
    await router.push('/settings/people-access');

    expect(router.currentRoute.value.fullPath).toBe(
      '/login?returnTo=/settings/people-access',
    );
  });

  it.each(['/leads', '/leads/new', '/leads/lead-1', '/leads/lead-1/edit'])(
    'protects the lead route %s',
    async (path) => {
      await router.push(path);

      expect(router.currentRoute.value.fullPath).toBe(
        `/login?returnTo=${path}`,
      );
    },
  );

  it('keeps client and internal routes separated by principal type', async () => {
    auth.session = {
      principalType: 'CLIENT',
      user: { id: 'client-user' },
    };
    await router.push('/customers');
    expect(router.currentRoute.value.path).toBe('/client/leads');

    await router.push('/client/leads/lead-1');
    expect(router.currentRoute.value.path).toBe('/client/leads/lead-1');

    auth.session = {
      principalType: 'INTERNAL',
      user: { id: 'operator-user' },
    };
    await router.push('/client/leads');
    expect(router.currentRoute.value.path).toBe('/customers');
  });

  it('opens the correct home when an authenticated principal visits login', async () => {
    auth.session = {
      principalType: 'CLIENT',
      user: { id: 'client-user' },
    };
    await router.push('/login');
    expect(router.currentRoute.value.path).toBe('/client/leads');
  });
});
