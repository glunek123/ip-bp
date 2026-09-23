import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ClientLeadListPage from './ClientLeadListPage.vue';

const api = vi.hoisted(() => ({ listClientLeads: vi.fn() }));
vi.mock('../../api/client-leads', () => api);

const lead = {
  id: 'lead-1',
  businessNo: 'LD-20260922-001',
  rightsHolderName: '主体甲',
  shopName: '店铺甲',
  products: [{ id: 'product-1' }],
  pushedAt: '2026-09-22T02:00:00.000Z',
};

async function mountPage(path = '/client/leads') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/client/leads', component: ClientLeadListPage },
      { path: '/client/leads/:id', component: { template: '<div />' } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(ClientLeadListPage, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.listClientLeads.mockResolvedValue({
    items: [lead],
    total: 1,
    page: 1,
    pageSize: 20,
  });
});

describe('ClientLeadListPage', () => {
  it('renders only the enterprise review queue projection', async () => {
    const { wrapper } = await mountPage();
    expect(api.listClientLeads).toHaveBeenCalledWith(
      'PENDING',
      1,
      20,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(wrapper.get('[data-test="client-lead-row"]').text()).toContain(
      'LD-20260922-001',
    );
    expect(wrapper.text()).toContain('线索待审核');
    expect(wrapper.text()).toContain('主体甲');
    expect(wrapper.text()).toContain('企业线索审核');
    expect(wrapper.text()).not.toContain('Enterprise review');
    expect(
      wrapper
        .findAll('button')
        .some((button) => button.text().includes('确认侵权')),
    ).toBe(false);
  });

  it('loads the pending queue by default and switches to processed at page one', async () => {
    const { wrapper, router } = await mountPage(
      '/client/leads?view=pending&page=3',
    );
    expect(api.listClientLeads).toHaveBeenCalledWith(
      'PENDING',
      3,
      20,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(wrapper.text()).toContain('待我审核');
    expect(
      wrapper
        .get('[data-test="client-view-pending"]')
        .attributes('aria-current'),
    ).toBe('page');

    await wrapper.get('[data-test="client-view-processed"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe(
      '/client/leads?view=processed&page=1',
    );
    expect(api.listClientLeads).toHaveBeenLastCalledWith(
      'PROCESSED',
      1,
      20,
      expect.anything(),
    );
  });

  it('preserves the active queue when paging', async () => {
    api.listClientLeads.mockResolvedValue({
      items: [lead],
      total: 41,
      page: 1,
      pageSize: 20,
    });
    const { wrapper, router } = await mountPage(
      '/client/leads?view=processed&page=1',
    );

    await wrapper.get('[data-test="next-page"]').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe(
      '/client/leads?view=processed&page=2',
    );
    expect(api.listClientLeads).toHaveBeenLastCalledWith(
      'PROCESSED',
      2,
      20,
      expect.anything(),
    );
  });

  it('uses the processed queue label and queue-specific empty copy', async () => {
    api.listClientLeads.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    const { wrapper } = await mountPage('/client/leads?view=processed&page=1');
    expect(wrapper.text()).toContain('已处理');
    expect(
      wrapper
        .get('[data-test="client-view-processed"]')
        .attributes('aria-current'),
    ).toBe('page');
    expect(wrapper.text()).toContain('暂无已处理线索');
  });

  it('shows processed rows as confirmed and without a confirmation action', async () => {
    const { wrapper } = await mountPage('/client/leads?view=processed&page=1');
    expect(api.listClientLeads).toHaveBeenCalledWith(
      'PROCESSED',
      1,
      20,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(wrapper.get('[data-test="client-lead-row"]').text()).toContain(
      '已确认侵权',
    );
    expect(
      wrapper
        .findAll('button')
        .some((button) => button.text().includes('确认侵权')),
    ).toBe(false);
  });

  it('carries the active queue and page into the detail link', async () => {
    const { wrapper } = await mountPage('/client/leads?view=processed&page=2');
    expect(
      wrapper.get('[data-test="client-lead-row"] a').attributes('href'),
    ).toBe('/client/leads/lead-1?view=processed&page=2');
  });

  it('normalizes an invalid view to the pending queue', async () => {
    await mountPage('/client/leads?view=unknown&page=1');
    expect(api.listClientLeads).toHaveBeenCalledWith(
      'PENDING',
      1,
      20,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('keeps a load failure distinct from an empty queue', async () => {
    api.listClientLeads.mockRejectedValueOnce(new Error('offline'));
    const { wrapper } = await mountPage();
    expect(wrapper.text()).toContain('暂时无法加载');
    api.listClientLeads.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('暂无待审核线索');
  });
});
