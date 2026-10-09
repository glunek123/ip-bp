import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, expect, it, vi } from 'vitest';
import CustomerDeletedDraftsPage from './CustomerDeletedDraftsPage.vue';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import { pinia } from '../../app/pinia';

const api = vi.hoisted(() => ({
  listDeletedCustomerDrafts: vi.fn(),
  restoreCustomerDraft: vi.fn(),
}));
vi.mock('../../api/customers', () => api);

afterEach(() => {
  vi.resetAllMocks();
  useAuthStore(pinia).session = null;
  globalThis.sessionStorage.clear();
});

it('keeps the exact restore request after CONTACT_BUSY and retries the same key', async () => {
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
  api.listDeletedCustomerDrafts.mockResolvedValue({
    items: [
      {
        id: 'customer-1',
        name: '已删除草稿',
        version: 2,
        deletedAt: '2026-10-09T01:00:00.000Z',
        deletionReason: null,
        capabilities: { restoreDraft: true },
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  });
  api.restoreCustomerDraft
    .mockRejectedValueOnce(new ApiError('busy', 409, 'CUSTOMER_CONTACT_BUSY'))
    .mockResolvedValueOnce({});
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/customers', component: { template: '<div>客户列表</div>' } },
      { path: '/customers/deleted', component: CustomerDeletedDraftsPage },
    ],
  });
  await router.push('/customers/deleted');
  await router.isReady();
  const wrapper = mount(CustomerDeletedDraftsPage, {
    global: { plugins: [router] },
  });
  try {
    await flushPromises();
    await wrapper
      .get('[data-test="deleted-draft-row"] button')
      .trigger('click');
    await wrapper
      .get('[data-test="restore-draft-confirm"] input')
      .setValue('原恢复原因');
    await wrapper.get('[data-test="restore-draft-submit"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('结果尚不确定');
    expect(wrapper.get('[data-test="restore-draft-submit"]').text()).toContain(
      '按原请求重试',
    );
    expect(globalThis.sessionStorage.length).toBe(1);
    await wrapper.get('[data-test="restore-draft-submit"]').trigger('click');
    await flushPromises();
    expect(api.restoreCustomerDraft).toHaveBeenCalledTimes(2);
    expect(api.restoreCustomerDraft.mock.calls[1]).toEqual(
      api.restoreCustomerDraft.mock.calls[0],
    );
    expect(globalThis.sessionStorage.length).toBe(0);
  } finally {
    wrapper.unmount();
  }
});
