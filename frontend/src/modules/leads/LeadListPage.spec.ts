import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LeadListPage from './LeadListPage.vue';

const api = vi.hoisted(() => ({ listLeads: vi.fn() }));
vi.mock('../../api/leads', () => api);

const result = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
  counts: {
    WAITING_PUSH: 7,
    WAITING_REVIEW: 3,
    WAITING_EVIDENCE_DECISION: 2,
    ARCHIVED: 1,
  },
  capabilities: { create: true },
};

const summary = {
  id: 'lead-1',
  businessNo: 'LD-20260921-001',
  shopName: '测试店铺',
  status: 'WAITING_PUSH',
  platform: 'TAOBAO',
  foundAt: '2026-09-20T03:00:00Z',
  products: [
    {
      id: 'product-1',
      position: 1,
      url: 'https://example.com/product-1',
      title: '测试商品',
      quantity: 1,
      unitPrice: '10.00',
      commentCount: 0,
      estimatedAmount: '10.00',
    },
  ],
  updatedAt: '2026-09-21T04:00:00Z',
};

async function mountWithRoute(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/leads', component: LeadListPage },
      { path: '/leads/new', component: { template: '<div />' } },
      { path: '/leads/:id', component: { template: '<div />' } },
      { path: '/customers', component: { template: '<div />' } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(LeadListPage, { global: { plugins: [router] } });
  await flushPromises();
  return { router, wrapper };
}

afterEach(() => vi.resetAllMocks());

describe('LeadListPage', () => {
  it('leaves workflow counters to the shared shell and keeps an empty state', async () => {
    api.listLeads.mockResolvedValue(result);
    const { wrapper } = await mountWithRoute('/leads');
    expect(wrapper.findAll('[data-test="lead-counter"]')).toHaveLength(0);
    expect(wrapper.text()).toContain('还没有线索记录');
  });

  it('renders the compact lead table with platform and product count', async () => {
    api.listLeads.mockResolvedValue({ ...result, items: [summary], total: 1 });
    const { wrapper } = await mountWithRoute('/leads');

    expect(wrapper.get('[data-test="lead-row"]').text()).toContain(
      'LD-20260921-001',
    );
    expect(wrapper.get('[data-test="lead-row"]').text()).toContain('淘宝');
    expect(wrapper.get('[data-test="lead-product-count"]').text()).toBe('1');
    expect(wrapper.find('table.demo-table').exists()).toBe(true);
  });

  it('keeps failure distinct from empty and retries', async () => {
    api.listLeads
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        ...result,
        items: [summary],
        total: 1,
      });
    const { wrapper } = await mountWithRoute('/leads');
    expect(wrapper.text()).toContain('线索列表暂时无法加载');
    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('LD-20260921-001');
  });

  it('paginates beyond 20 records and preserves the status filter in the route', async () => {
    api.listLeads.mockImplementation(
      async (
        page: number,
        pageSize: number,
        _options: unknown,
        status?: string,
      ) => ({
        ...result,
        items: [summary],
        total: 41,
        page,
        pageSize,
        counts: { ...result.counts, WAITING_PUSH: 41 },
        status,
      }),
    );
    const { router, wrapper } = await mountWithRoute(
      '/leads?page=2&status=WAITING_PUSH',
    );

    expect(api.listLeads).toHaveBeenLastCalledWith(
      2,
      20,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      'WAITING_PUSH',
    );
    expect(wrapper.text()).toContain('第 2 / 3 页');
    await wrapper.get('[data-test="next-page"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query).toMatchObject({
      page: '3',
      status: 'WAITING_PUSH',
    });
    expect(api.listLeads).toHaveBeenLastCalledWith(
      3,
      20,
      expect.any(Object),
      'WAITING_PUSH',
    );
  });

  it('retries and remounts the exact page restored from route query', async () => {
    api.listLeads
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        ...result,
        items: [summary],
        total: 21,
        page: 2,
      });
    const { wrapper } = await mountWithRoute('/leads?page=2');
    expect(wrapper.text()).toContain('线索列表暂时无法加载');

    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(api.listLeads).toHaveBeenNthCalledWith(
      2,
      2,
      20,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      undefined,
    );
    expect(wrapper.text()).toContain('第 2 / 2 页');
  });
});
