import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CustomerListPage from './CustomerListPage.vue';
import { useAuthStore } from '../../stores/auth';
import { pinia } from '../../app/pinia';

const api = vi.hoisted(() => ({ listCustomers: vi.fn() }));
vi.mock('../../api/customers', () => api);

afterEach(() => {
  vi.clearAllMocks();
  useAuthStore(pinia).session = null;
});

const summary = {
  id: 'customer-1',
  name: '客户甲',
  customerType: null,
  identityType: null,
  identityNumber: null,
  issuingCountryOrRegion: null,
  category: null,
  region: null,
  profileStatus: 'draft' as const,
  cooperationStatus: 'COOPERATING' as const,
  departmentId: 'department-1',
  responsibleUserId: 'user-1',
  version: 1,
  updatedAt: '2026-09-17T01:00:00.000Z',
};

function createListRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/customers', component: CustomerListPage },
      { path: '/customers/deleted-drafts', component: { template: '<div />' } },
    ],
  });
}

function mountListPage() {
  const router = createListRouter();
  const wrapper = mount(CustomerListPage, {
    global: {
      plugins: [router],
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  });
  return { router, wrapper };
}

describe('CustomerListPage', () => {
  it('shows and consumes a confirmed access-loss notice for its original actor', async () => {
    useAuthStore(pinia).session = {
      principalType: 'INTERNAL',
      user: { id: 'user-1', displayName: '运营甲', username: 'operator-a' },
      department: { id: 'department-1', name: '甲部门' },
      departments: [{ id: 'department-1', name: '甲部门' }],
      customer: null,
      notaryOffice: null,
      authorizationRevision: 1,
      expiresAt: '2026-10-09T10:00:00.000Z',
      csrfToken: 'csrf',
    };
    api.listCustomers.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      capabilities: { createDraft: false },
    });
    const router = createListRouter();
    await router.push({
      path: '/customers',
      state: {
        customerMaintenanceNotice: {
          type: 'access-revoked-after-confirmed-maintenance',
          userId: 'user-1',
          departmentId: 'department-1',
          authorizationRevision: 1,
        },
      },
    });
    const wrapper = mount(CustomerListPage, { global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.get('[data-test="maintenance-success-notice"]').text()).toBe(
      '维护已成功，当前账号已无法继续查看客户资料。',
    );
    expect(router.options.history.state.customerMaintenanceNotice).toBeNull();
    wrapper.unmount();
  });

  it('does not treat a query parameter as maintenance success', async () => {
    useAuthStore(pinia).session = {
      principalType: 'INTERNAL',
      user: { id: 'user-2', displayName: '运营乙', username: 'operator-b' },
      department: { id: 'department-1', name: '甲部门' },
      departments: [{ id: 'department-1', name: '甲部门' }],
      customer: null,
      notaryOffice: null,
      authorizationRevision: 1,
      expiresAt: '2026-10-09T10:00:00.000Z',
      csrfToken: 'csrf',
    };
    api.listCustomers.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      capabilities: { createDraft: false },
    });
    const router = createListRouter();
    await router.push('/customers?maintenanceSuccess=1');
    const wrapper = mount(CustomerListPage, { global: { plugins: [router] } });
    await flushPromises();
    expect(
      wrapper.find('[data-test="maintenance-success-notice"]').exists(),
    ).toBe(false);
    wrapper.unmount();
  });

  it('clears a confirmed maintenance notice when the current actor does not match', async () => {
    useAuthStore(pinia).session = {
      principalType: 'INTERNAL',
      user: { id: 'user-2', displayName: '运营乙', username: 'operator-b' },
      department: { id: 'department-1', name: '甲部门' },
      departments: [{ id: 'department-1', name: '甲部门' }],
      customer: null,
      notaryOffice: null,
      authorizationRevision: 1,
      expiresAt: '2026-10-09T10:00:00.000Z',
      csrfToken: 'csrf',
    };
    api.listCustomers.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      capabilities: { createDraft: false },
    });
    const router = createListRouter();
    await router.push({
      path: '/customers',
      state: {
        customerMaintenanceNotice: {
          type: 'access-revoked-after-confirmed-maintenance',
          userId: 'user-1',
          departmentId: 'department-1',
          authorizationRevision: 1,
        },
      },
    });
    const wrapper = mount(CustomerListPage, { global: { plugins: [router] } });
    await flushPromises();
    expect(
      wrapper.find('[data-test="maintenance-success-notice"]').exists(),
    ).toBe(false);
    expect(router.options.history.state.customerMaintenanceNotice).toBeNull();
    wrapper.unmount();
  });

  it('clears the visible success notice when the current actor changes', async () => {
    const auth = useAuthStore(pinia);
    auth.session = {
      principalType: 'INTERNAL',
      user: { id: 'user-1', displayName: '运营甲', username: 'operator-a' },
      department: { id: 'department-1', name: '甲部门' },
      departments: [{ id: 'department-1', name: '甲部门' }],
      customer: null,
      notaryOffice: null,
      authorizationRevision: 1,
      expiresAt: '2026-10-09T10:00:00.000Z',
      csrfToken: 'csrf',
    };
    api.listCustomers.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      capabilities: { createDraft: false },
    });
    const router = createListRouter();
    await router.push({
      path: '/customers',
      state: {
        customerMaintenanceNotice: {
          type: 'access-revoked-after-confirmed-maintenance',
          userId: 'user-1',
          departmentId: 'department-1',
          authorizationRevision: 1,
        },
      },
    });
    const wrapper = mount(CustomerListPage, { global: { plugins: [router] } });
    await flushPromises();
    expect(
      wrapper.find('[data-test="maintenance-success-notice"]').exists(),
    ).toBe(true);
    auth.session = {
      ...auth.session!,
      user: { id: 'user-2', displayName: '运营乙', username: 'operator-b' },
    };
    await flushPromises();
    expect(
      wrapper.find('[data-test="maintenance-success-notice"]').exists(),
    ).toBe(false);
    wrapper.unmount();
  });

  it('separates loading and empty states', async () => {
    let resolve!: (value: unknown) => void;
    api.listCustomers.mockReturnValue(new Promise((done) => (resolve = done)));
    const { wrapper } = mountListPage();
    expect(wrapper.text()).toContain('正在读取客户');
    resolve({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      capabilities: { createDraft: true },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('还没有客户记录');
    expect(wrapper.find('.workspace-header').exists()).toBe(false);
    expect(wrapper.find('.workspace-shell').exists()).toBe(false);
    expect(wrapper.find('.page-view').exists()).toBe(true);
  });

  it('shows a readable failure and retries', async () => {
    api.listCustomers
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        items: [summary],
        total: 1,
        page: 1,
        pageSize: 20,
        capabilities: { createDraft: true },
      });
    const { wrapper } = mountListPage();
    await flushPromises();
    expect(wrapper.text()).toContain('客户列表暂时无法加载');
    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('客户甲');
  });

  it('hides creation when the server does not grant the action', async () => {
    api.listCustomers.mockResolvedValue({
      items: [summary],
      total: 1,
      page: 1,
      pageSize: 20,
      capabilities: { createDraft: false },
    });
    const { wrapper } = mountListPage();
    await flushPromises();
    expect(wrapper.text()).toContain('客户甲');
    expect(wrapper.find('[data-test="create-customer"]').exists()).toBe(false);
  });

  it('shows the admitted status returned by the server', async () => {
    api.listCustomers.mockResolvedValue({
      items: [{ ...summary, profileStatus: 'admitted' }],
      total: 1,
      page: 1,
      pageSize: 20,
      capabilities: { createDraft: true },
    });
    const { wrapper } = mountListPage();
    await flushPromises();
    expect(wrapper.get('.status-chip').text()).toBe('已准入');
  });

  it('shows the current cooperation state from the server', async () => {
    api.listCustomers.mockResolvedValue({
      items: [{ ...summary, cooperationStatus: 'PAUSED' }],
      total: 1,
      page: 1,
      pageSize: 20,
      capabilities: { createDraft: true },
    });
    const { wrapper } = mountListPage();
    await flushPromises();
    expect(wrapper.get('[data-test="cooperation-status"]').text()).toBe(
      '已暂停合作',
    );
  });
});
