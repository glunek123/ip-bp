import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
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
  capabilities: { edit: true, push: false },
};

async function mountPage(path = '/leads/l/edit') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/leads/:id/edit', component: LeadEditPage },
      { path: '/leads/:id', component: { template: '<div />' } },
      { path: '/leads', component: { template: '<div />' } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(RouterView, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.getLead.mockResolvedValue(lead);
  api.getLeadFormContext.mockResolvedValue(context);
  api.getLeadEditContext.mockResolvedValue(context);
  api.updateLead.mockResolvedValue({ ...lead, version: 3 });
});

describe('LeadEditPage', () => {
  it('warns before leaving after an edit and stays when cancelled', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { wrapper, router } = await mountPage();

    await wrapper.get('input[name="shopName"]').setValue('修改后的店铺');
    await router.push('/leads/l');

    expect(router.currentRoute.value.path).toBe('/leads/l/edit');
    expect(confirm).toHaveBeenCalled();
  });

  it('blocks editing when the backend capability is false', async () => {
    api.getLead.mockResolvedValue({
      ...lead,
      capabilities: { edit: false, push: false },
    });
    const { wrapper } = await mountPage();
    expect(wrapper.text()).toContain('当前线索不可编辑');
    expect(wrapper.find('form').exists()).toBe(false);
    expect(api.getLeadFormContext).not.toHaveBeenCalled();
    expect(api.getLeadEditContext).not.toHaveBeenCalled();
  });

  it('submits only editable fields with current version and existing screenshots', async () => {
    const { wrapper, router } = await mountPage();
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
    expect(router.currentRoute.value.fullPath).toBe('/leads/l');
  });

  it('returns to the validated list page and filter on cancel and after save', async () => {
    const returnPath = '/leads?page=4&status=WAITING_PUSH';
    const { wrapper, router } = await mountPage(
      `/leads/l/edit?returnTo=${encodeURIComponent(returnPath)}`,
    );
    expect(wrapper.get('[data-test="edit-return"]').attributes('href')).toBe(
      returnPath,
    );
    expect(wrapper.get('[data-test="edit-return"]').text()).toBe(
      '返回线索列表',
    );
    await wrapper.get('[data-test="edit-cancel"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe(returnPath);

    const second = await mountPage(
      `/leads/l/edit?returnTo=${encodeURIComponent(returnPath)}`,
    );
    await second.wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(second.router.currentRoute.value.fullPath).toBe(returnPath);
  });

  it.each([
    'https://evil.example/leads?page=2',
    '//evil.example/leads?page=2',
    '/leads/another-case',
    '/leads?page=0',
    '/leads?page=2&page=3',
    '/leads?status=NOT_A_STATUS',
    '/leads?status=TRANSFERRED_TO_NOTARY',
    '/leads?next=https%3A%2F%2Fevil.example',
  ])(
    'falls back to the existing detail route for an unsafe return target: %s',
    async (target) => {
      const { wrapper, router } = await mountPage(
        `/leads/l/edit?returnTo=${encodeURIComponent(target)}`,
      );
      expect(wrapper.get('[data-test="edit-return"]').attributes('href')).toBe(
        '/leads/l',
      );
      expect(wrapper.get('[data-test="edit-return"]').text()).toBe(
        '返回线索详情',
      );
      await wrapper.get('[data-test="edit-cancel"]').trigger('click');
      await flushPromises();
      expect(router.currentRoute.value.fullPath).toBe('/leads/l');
    },
  );
});
