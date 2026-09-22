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
  listLeads: vi.fn(),
}));

vi.mock('../api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/auth')>()),
  logout: api.logout,
}));
vi.mock('../api/organization', () => ({
  getOrganizationManagementContext: api.getOrganizationManagementContext,
}));
vi.mock('../api/leads', () => ({
  listLeads: api.listLeads,
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

const clientSession = {
  principalType: 'CLIENT' as const,
  user: { id: 'client-1', displayName: '甲公司审核员', username: 'client-a' },
  department: null,
  departments: [],
  customer: { id: 'customer-1', name: '甲公司' },
  authorizationRevision: 1,
  expiresAt: '2026-09-18T00:00:00.000Z',
  csrfToken: 'csrf-token',
};

beforeEach(() => {
  vi.resetAllMocks();
  api.getOrganizationManagementContext.mockResolvedValue({});
  api.listLeads.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 1,
    counts: {
      WAITING_PUSH: 0,
      WAITING_REVIEW: 0,
      WAITING_EVIDENCE_DECISION: 0,
      ARCHIVED: 0,
    },
    capabilities: { create: false },
  });
});

async function mountApp(signedIn = true) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore(pinia);
  auth.session = signedIn ? session : null;
  auth.restored = true;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: { template: '<div>登录页</div>' } },
      { path: '/customers', component: { template: '<div>客户页</div>' } },
      { path: '/leads', component: { template: '<div>线索页</div>' } },
      {
        path: '/client/leads',
        component: { template: '<div>客户线索页</div>' },
      },
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
  it('wraps authenticated routes in the shared application shell', async () => {
    const { wrapper } = await mountApp();
    await flushPromises();

    expect(wrapper.get('[data-test="app-shell"]')).toBeDefined();
  });

  it('renders public routes without the authenticated shell', async () => {
    const { router, wrapper } = await mountApp(false);
    await router.push('/login');
    await flushPromises();

    expect(wrapper.text()).toContain('登录页');
    expect(wrapper.find('[data-test="app-shell"]').exists()).toBe(false);
  });

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

  it('shows only the client review navigation for a client principal', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const auth = useAuthStore(pinia);
    auth.session = clientSession;
    auth.restored = true;
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/client/leads',
          component: { template: '<div>客户线索页</div>' },
        },
      ],
    });
    await router.push('/client/leads');
    await router.isReady();
    const wrapper = mount(App, { global: { plugins: [pinia, router] } });
    await flushPromises();

    expect(wrapper.get('[data-test="client-lead-nav"]')).toBeDefined();
    expect(wrapper.find('[data-test="customer-nav"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="lead-nav"]').exists()).toBe(false);
    expect(api.getOrganizationManagementContext).not.toHaveBeenCalled();
  });
});
