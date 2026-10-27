import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CustomerListPage from './CustomerListPage.vue';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import { pinia } from '../../app/pinia';

const api = vi.hoisted(() => ({
  listCustomers: vi.fn(),
  createCustomerDraft: vi.fn(),
  findCustomerDuplicates: vi.fn(),
}));
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
  it('shows business IDs and labels null or legacy IDs as pending', async () => {
    api.listCustomers.mockResolvedValue({
      items: [
        { ...summary, businessId: '001' },
        { ...summary, id: 'customer-2', name: '客户乙', businessId: null },
        { ...summary, id: 'customer-3', name: '客户丙' },
      ],
      total: 3,
      page: 1,
      pageSize: 20,
      capabilities: { createDraft: false },
    });
    const { wrapper } = mountListPage();
    await flushPromises();

    const rows = wrapper.findAll('.customer-row');
    expect(rows[0]!.text()).toContain('客户ID 001');
    expect(rows[1]!.text()).toContain('客户ID 待编号');
    expect(rows[2]!.text()).toContain('客户ID 待编号');
    wrapper.unmount();
  });

  it('clears the prior identity projection and ignores its late response', async () => {
    const auth = useAuthStore(pinia);
    let resolveOld: ((value: unknown) => void) | undefined;
    api.listCustomers.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const { wrapper } = mountListPage();
    const signal = api.listCustomers.mock.calls.at(-1)?.[2]
      .signal as AbortSignal;
    api.listCustomers.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      capabilities: { createDraft: false },
    });
    auth.session = {
      principalType: 'INTERNAL',
      user: { id: 'new-user', displayName: '运营乙', username: 'b' },
      department: { id: 'new-department', name: '乙部门' },
      departments: [],
      customer: null,
      notaryOffice: null,
      authorizationRevision: 2,
      expiresAt: '2099-01-01T00:00:00.000Z',
      csrfToken: 'new-csrf',
    };
    await flushPromises();
    expect(signal.aborted).toBe(true);
    resolveOld?.({
      items: [summary],
      total: 1,
      page: 1,
      pageSize: 20,
      capabilities: { createDraft: true },
    });
    await flushPromises();
    expect(wrapper.text()).not.toContain('客户甲');
    expect(wrapper.find('[data-test="create-customer"]').exists()).toBe(false);
    wrapper.unmount();
  });
  it('paginates beyond twenty customers and applies and clears route filters', async () => {
    api.listCustomers.mockImplementation(async (page: number) => ({
      items: [{ ...summary, name: `第${page}页客户` }],
      total: 21,
      page,
      pageSize: 20,
      capabilities: { createDraft: false },
    }));
    const { wrapper, router } = mountListPage();
    await router.push('/customers');
    await flushPromises();
    await wrapper.get('[data-test="customer-next"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.page).toBe('2');
    expect(wrapper.text()).toContain('第2页客户');
    await wrapper.get('[data-test="customer-query"]').setValue(' 证件甲 ');
    await wrapper.get('[data-test="customer-cooperation"]').setValue('PAUSED');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(router.currentRoute.value.query).toMatchObject({
      q: '证件甲',
      cooperationStatus: 'PAUSED',
      page: '1',
    });
    expect(api.listCustomers).toHaveBeenLastCalledWith(
      1,
      20,
      expect.anything(),
      { q: '证件甲', cooperationStatus: 'PAUSED' },
    );
    await wrapper.get('[data-test="customer-next"]').trigger('click');
    await flushPromises();
    expect(api.listCustomers).toHaveBeenLastCalledWith(
      2,
      20,
      expect.anything(),
      { q: '证件甲', cooperationStatus: 'PAUSED' },
    );
    await wrapper.get('[data-test="customer-clear"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ page: '1' });
    wrapper.unmount();
  });

  it('aborts a pending list when repeated query values become invalid and recovers', async () => {
    let resolveOld: ((value: unknown) => void) | undefined;
    api.listCustomers.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const { wrapper, router } = mountListPage();
    const signal = api.listCustomers.mock.calls.at(-1)?.[2]
      .signal as AbortSignal;
    await router.push('/customers?q=a&q=b');
    await flushPromises();
    expect(signal.aborted).toBe(true);
    resolveOld?.({
      items: [summary],
      total: 1,
      page: 1,
      pageSize: 20,
      capabilities: { createDraft: true },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('客户关键词无效');
    expect(wrapper.text()).not.toContain('客户甲');
    api.listCustomers.mockResolvedValue({
      items: [summary],
      total: 1,
      page: 1,
      pageSize: 20,
      capabilities: { createDraft: false },
    });
    await router.push('/customers?q=');
    await flushPromises();
    expect(wrapper.text()).toContain('客户甲');
    wrapper.unmount();
  });
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

  it('shows a permission message instead of a connection failure for 403', async () => {
    api.listCustomers.mockRejectedValueOnce(
      new ApiError('权限不足', 403, 'FORBIDDEN'),
    );
    const { wrapper } = mountListPage();
    await flushPromises();
    expect(wrapper.text()).toContain('当前账号无权查看客户列表');
    expect(wrapper.text()).not.toContain('连接失败');
    expect(wrapper.find('[data-test="retry"]').exists()).toBe(false);
    wrapper.unmount();
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
