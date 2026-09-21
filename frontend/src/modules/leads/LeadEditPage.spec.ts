import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LeadEditPage from './LeadEditPage.vue';

const api = vi.hoisted(() => ({
  getLead: vi.fn(),
  getLeadFormContext: vi.fn(),
  getLeadEditContext: vi.fn(),
  updateLead: vi.fn(),
}));
vi.mock('../../api/leads', () => api);

const context = {
  customers: [
    { id: 'c', name: '客户', rightsHolders: [{ id: 'r', name: '主体' }] },
  ],
  dictionaries: {
    caseTypes: [{ value: 'CIVIL', label: '民事' }],
    infringementTypes: [{ value: 'TRADEMARK', label: '商标权' }],
    sources: [{ value: 'ONLINE', label: '线上' }],
    platforms: { ONLINE: [{ value: 'TAOBAO', label: '淘宝' }], OFFLINE: [] },
  },
};
const lead = {
  id: 'l',
  customerId: 'c',
  rightsHolderId: 'r',
  caseType: 'CIVIL',
  infringementTypes: ['TRADEMARK'],
  source: 'ONLINE',
  platform: 'TAOBAO',
  foundAt: '2026-09-21T04:00:00Z',
  shopName: '店铺',
  shopExternalId: null,
  needDisclose: false,
  remark: null,
  products: [
    {
      id: 'p',
      position: 1,
      title: '商品',
      url: null,
      quantity: 1,
      unitPrice: '1.00',
      commentCount: 0,
      estimatedAmount: '1.00',
    },
  ],
  leadScreenshotContentVersionIds: ['v'],
  version: 2,
  status: 'WAITING_PUSH',
  capabilities: { edit: true },
};

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/leads/:id/edit', component: LeadEditPage },
      { path: '/leads/:id', component: { template: '<div />' } },
      { path: '/leads', component: { template: '<div />' } },
    ],
  });
  await router.push('/leads/l/edit');
  await router.isReady();
  const wrapper = mount(LeadEditPage, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.resetAllMocks();
  api.getLead.mockResolvedValue(lead);
  api.getLeadFormContext.mockResolvedValue(context);
  api.getLeadEditContext.mockResolvedValue(context);
  api.updateLead.mockResolvedValue({ ...lead, version: 3 });
});

describe('LeadEditPage', () => {
  it('blocks editing when the backend capability is false', async () => {
    api.getLead.mockResolvedValue({ ...lead, capabilities: { edit: false } });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('当前线索不可编辑');
    expect(wrapper.find('form').exists()).toBe(false);
    expect(api.getLeadFormContext).not.toHaveBeenCalled();
    expect(api.getLeadEditContext).not.toHaveBeenCalled();
  });

  it('submits only editable fields with current version and existing screenshots', async () => {
    const wrapper = await mountPage();
    expect(api.getLeadEditContext).toHaveBeenCalledWith(
      'l',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(api.getLeadFormContext).not.toHaveBeenCalled();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.updateLead).toHaveBeenCalledWith(
      'l',
      expect.objectContaining({
        expectedVersion: 2,
        leadScreenshotContentVersionIds: ['v'],
      }),
    );
    expect(api.updateLead.mock.calls[0]?.[1]).not.toHaveProperty(
      'rightsHolderId',
    );
    expect(api.updateLead.mock.calls[0]?.[1]).not.toHaveProperty('customerId');
    expect(api.updateLead.mock.calls[0]?.[1]).not.toHaveProperty('status');
  });
});
