import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/http';
import { useAuthStore } from '../stores/auth';
import App from './App.vue';

const api = vi.hoisted(() => ({
  logout: vi.fn(),
  getOrganizationManagementContext: vi.fn(),
}));

vi.mock('../api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/auth')>()),
  logout: api.logout,
}));
vi.mock('../api/organization', () => ({
  getOrganizationManagementContext: api.getOrganizationManagementContext,
}));

const session = {
  user: { id: 'user-1', displayName: '管理员', username: 'admin' },
  department: { id: 'department-1', name: '知产部' },
  departments: [{ id: 'department-1', name: '知产部' }],
  authorizationRevision: 1,
  expiresAt: '2026-09-18T00:00:00.000Z',
  csrfToken: 'csrf-token',
};

beforeEach(() => {
  vi.resetAllMocks();
  api.getOrganizationManagementContext.mockResolvedValue({});
});

async function mountApp() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore(pinia);
  auth.session = session;
  auth.restored = true;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: { template: '<div>登录页</div>' } },
      { path: '/customers', component: { template: '<div>客户页</div>' } },
      { path: '/leads', component: { template: '<div>线索页</div>' } },
      {
        path: '/settings/people-access',
        component: { template: '<div>人员页</div>' },
      },
    ],
  });
  await router.push('/customers');
  await router.isReady();
  const wrapper = mount(App, { global: { plugins: [pinia, router] } });
  return { auth, router, wrapper };
}

describe('application session controls', () => {
  it('shows personnel navigation only when management context is readable', async () => {
    const allowed = await mountApp();
    await flushPromises();
    expect(
      allowed.wrapper.find('[data-test="people-access-nav"]').exists(),
    ).toBe(true);

    api.getOrganizationManagementContext.mockRejectedValue(
      new ApiError('无权执行此管理操作', 403, 'MANAGEMENT_ACTION_FORBIDDEN'),
    );
    const denied = await mountApp();
    await flushPromises();
    expect(
      denied.wrapper.find('[data-test="people-access-nav"]').exists(),
    ).toBe(false);
  });

  it('keeps the signed-in UI and explains a failed logout', async () => {
    api.logout.mockRejectedValue(
      new ApiError('服务暂时不可用，请稍后重试', 503, 'HTTP_ERROR'),
    );
    const { auth, router, wrapper } = await mountApp();

    await wrapper.get('[data-test="logout"]').trigger('click');
    await flushPromises();

    expect(auth.session).toEqual(session);
    expect(router.currentRoute.value.path).toBe('/customers');
    expect(wrapper.get('[role="alert"]').text()).toContain(
      '服务暂时不可用，请稍后重试',
    );
  });

  it('clears the signed-in UI and opens login after logout succeeds', async () => {
    api.logout.mockResolvedValue(undefined);
    const { auth, router, wrapper } = await mountApp();

    await wrapper.get('[data-test="logout"]').trigger('click');
    await flushPromises();

    expect(auth.session).toBeNull();
    expect(router.currentRoute.value.path).toBe('/login');
    expect(wrapper.find('[data-test="logout"]').exists()).toBe(false);
  });

  it('keeps primary customer and lead navigation available to signed-in users', async () => {
    const { wrapper } = await mountApp();
    await flushPromises();
    expect(wrapper.get('[data-test="customer-nav"]').attributes('href')).toBe(
      '/customers',
    );
    expect(wrapper.get('[data-test="lead-nav"]').attributes('href')).toBe(
      '/leads',
    );
  });
});
