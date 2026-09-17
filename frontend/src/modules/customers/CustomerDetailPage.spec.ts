import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CustomerDetailPage from './CustomerDetailPage.vue';

const api = vi.hoisted(() => ({ getCustomer: vi.fn() }));
vi.mock('../../api/customers', () => api);

afterEach(() => vi.clearAllMocks());

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/customers/:id', component: CustomerDetailPage }],
  });
  await router.push('/customers/customer-1');
  await router.isReady();
  return mount(CustomerDetailPage, { global: { plugins: [router] } });
}

describe('CustomerDetailPage', () => {
  it('shows the draft status and folded shared history', async () => {
    api.getCustomer.mockResolvedValue({
      id: 'customer-1',
      name: '客户甲',
      category: null,
      region: null,
      profileStatus: 'draft',
      departmentId: 'department-1',
      responsibleUserId: 'user-1',
      version: 1,
      updatedAt: '2026-09-17T01:00:00.000Z',
      history: [
        {
          action: 'customer.draft-created',
          actorUserId: 'user-1',
          occurredAt: '2026-09-17T00:59:00.000Z',
        },
      ],
    });
    const wrapper = await mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('客户甲');
    expect(wrapper.text()).toContain('草稿');
    expect(wrapper.get('details').attributes('open')).toBeUndefined();
    expect(wrapper.text()).toContain('创建客户草稿');
  });

  it('shows a non-leaking unavailable state for 404', async () => {
    api.getCustomer.mockRejectedValue({ code: 'CUSTOMER_NOT_FOUND' });
    const wrapper = await mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('客户不存在或当前不可访问');
  });
});
