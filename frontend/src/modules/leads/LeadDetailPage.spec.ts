import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LeadDetailPage from './LeadDetailPage.vue';

const leadApi = vi.hoisted(() => ({ getLead: vi.fn() }));
const customerApi = vi.hoisted(() => ({ getCustomer: vi.fn() }));
const holderApi = vi.hoisted(() => ({ getCustomerRightsHolder: vi.fn() }));
const materialApi = vi.hoisted(() => ({
  listOwnerMaterials: vi.fn(),
  downloadMaterialVersion: vi.fn(),
}));
vi.mock('../../api/leads', () => leadApi);
vi.mock('../../api/customers', () => customerApi);
vi.mock('../../api/rights-holders', () => holderApi);
vi.mock('../../api/materials', () => materialApi);

const lead = {
  id: 'lead-1',
  businessNo: 'LD-20260921-001',
  customerId: 'customer-1',
  rightsHolderId: 'holder-1',
  status: 'WAITING_PUSH',
  caseType: 'CIVIL',
  infringementTypes: ['TRADEMARK'],
  source: 'ONLINE',
  platform: 'TAOBAO',
  foundAt: '2026-09-21T04:00:00Z',
  shopName: '测试店铺',
  shopExternalId: null,
  needDisclose: true,
  remark: '备注',
  products: [
    {
      id: 'p',
      position: 1,
      title: '商品甲',
      url: null,
      quantity: 2,
      unitPrice: '3.00',
      commentCount: 0,
      estimatedAmount: '6.00',
    },
  ],
  leadScreenshotContentVersionIds: ['version-1'],
  version: 1,
  createdAt: '2026-09-21T04:00:00Z',
  updatedAt: '2026-09-21T04:00:00Z',
  capabilities: { edit: true },
  departmentId: 'd',
  responsibleUserId: 'u',
  teamId: null,
  creationChannel: 'MANUAL',
  externalSourceRef: null,
};

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/leads/:id', component: LeadDetailPage },
      { path: '/leads/:id/edit', component: { template: '<div />' } },
      { path: '/leads', component: { template: '<div />' } },
    ],
  });
  await router.push('/leads/lead-1');
  await router.isReady();
  const wrapper = mount(LeadDetailPage, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.resetAllMocks();
  leadApi.getLead.mockResolvedValue(lead);
  customerApi.getCustomer.mockResolvedValue({
    id: 'customer-1',
    name: '客户甲',
  });
  holderApi.getCustomerRightsHolder.mockResolvedValue({
    id: 'holder-1',
    name: '主体甲',
  });
  materialApi.listOwnerMaterials.mockResolvedValue({
    items: [
      {
        id: 'material-1',
        status: 'ACTIVE',
        currentVersionId: 'version-1',
        contentVersions: [
          { id: 'version-1', originalFilename: '侵权截图.png' },
        ],
      },
    ],
    total: 1,
  });
  materialApi.downloadMaterialVersion.mockResolvedValue(undefined);
});

describe('LeadDetailPage', () => {
  it('renders real detail fields, record information and no push action', async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('客户甲');
    expect(wrapper.text()).toContain('主体甲');
    expect(wrapper.text()).toContain('测试店铺');
    expect(wrapper.text()).toContain('商品甲');
    expect(wrapper.text()).toContain('6.00');
    expect(wrapper.text()).toContain('侵权截图.png');
    expect(wrapper.text()).toContain('版本 1');
    expect(wrapper.find('[data-test="push-lead"]').exists()).toBe(false);
    expect(
      wrapper
        .findAll('button')
        .some((button) => button.text().includes('推送')),
    ).toBe(false);
    expect(materialApi.listOwnerMaterials).toHaveBeenCalledWith(
      'LEAD',
      'lead-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await wrapper
      .get('[data-test="download-screenshot-version-1"]')
      .trigger('click');
    expect(materialApi.downloadMaterialVersion).toHaveBeenCalledWith(
      'material-1',
      'version-1',
    );
  });

  it('shows edit only from the server capability and supports refresh', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="edit-lead"]').exists()).toBe(true);
    leadApi.getLead.mockResolvedValueOnce({
      ...lead,
      capabilities: { edit: false },
    });
    await wrapper.get('[data-test="refresh"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="edit-lead"]').exists()).toBe(false);
  });
});
