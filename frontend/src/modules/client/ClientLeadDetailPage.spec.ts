import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ClientLeadDetailPage from './ClientLeadDetailPage.vue';

const leadApi = vi.hoisted(() => ({ getClientLead: vi.fn() }));
const materialApi = vi.hoisted(() => ({
  listOwnerMaterials: vi.fn(),
  downloadMaterialVersion: vi.fn(),
}));
vi.mock('../../api/client-leads', () => leadApi);
vi.mock('../../api/materials', () => materialApi);

const lead = {
  id: 'lead-1',
  businessNo: 'LD-20260922-001',
  status: 'WAITING_REVIEW',
  caseType: 'CIVIL',
  infringementTypes: ['TRADEMARK'],
  source: 'ONLINE',
  platform: 'TAOBAO',
  foundAt: '2026-09-22T01:00:00.000Z',
  shopName: '店铺甲',
  shopExternalId: null,
  rightsHolderName: '主体甲',
  products: [
    {
      id: 'p',
      position: 1,
      title: '商品甲',
      url: null,
      quantity: 1,
      unitPrice: '10.00',
      commentCount: 0,
      estimatedAmount: '10.00',
    },
  ],
  leadScreenshotContentVersionIds: ['version-current'],
  pushedAt: '2026-09-22T02:00:00.000Z',
};

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/client/leads/:id', component: ClientLeadDetailPage },
      { path: '/client/leads', component: { template: '<div />' } },
    ],
  });
  await router.push('/client/leads/lead-1');
  await router.isReady();
  const wrapper = mount(ClientLeadDetailPage, {
    global: { plugins: [router] },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.resetAllMocks();
  leadApi.getClientLead.mockResolvedValue(lead);
  materialApi.listOwnerMaterials.mockResolvedValue({
    items: [
      {
        id: 'material-1',
        status: 'ACTIVE',
        contentVersions: [
          { id: 'version-old', originalFilename: '旧截图.png' },
          { id: 'version-current', originalFilename: '当前截图.png' },
        ],
      },
    ],
    total: 1,
  });
  materialApi.downloadMaterialVersion.mockResolvedValue(undefined);
});

describe('ClientLeadDetailPage', () => {
  it('shows the redacted read-only detail and only current allowed attachments', async () => {
    const wrapper = await mountPage();
    expect(wrapper.get('[data-test="client-lead-facts"]').text()).toContain(
      '主体甲',
    );
    expect(wrapper.get('[data-test="client-lead-products"]').text()).toContain(
      '商品甲',
    );
    expect(
      wrapper.get('[data-test="client-lead-attachments"]').text(),
    ).toContain('当前截图.png');
    expect(wrapper.text()).not.toContain('旧截图.png');
    expect(wrapper.text()).not.toContain('确认侵权');
    expect(wrapper.text()).not.toContain('备注');

    await wrapper
      .get('[data-test="download-screenshot-version-current"]')
      .trigger('click');
    expect(materialApi.downloadMaterialVersion).toHaveBeenCalledWith(
      'material-1',
      'version-current',
    );
  });
});
