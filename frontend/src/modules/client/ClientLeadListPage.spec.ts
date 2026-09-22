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

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/client/leads', component: ClientLeadListPage },
      { path: '/client/leads/:id', component: { template: '<div />' } },
    ],
  });
  await router.push('/client/leads');
  await router.isReady();
  const wrapper = mount(ClientLeadListPage, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
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
    const wrapper = await mountPage();
    expect(wrapper.get('[data-test="client-lead-row"]').text()).toContain(
      'LD-20260922-001',
    );
    expect(wrapper.text()).toContain('线索待审核');
    expect(wrapper.text()).toContain('主体甲');
    expect(wrapper.text()).toContain('企业线索审核');
    expect(wrapper.text()).not.toContain('Enterprise review');
    expect(wrapper.text()).not.toContain('确认侵权');
  });

  it('keeps a load failure distinct from an empty queue', async () => {
    api.listClientLeads.mockRejectedValueOnce(new Error('offline'));
    const wrapper = await mountPage();
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
