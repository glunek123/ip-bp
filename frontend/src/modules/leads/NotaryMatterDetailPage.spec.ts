import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NotaryMatterDetailPage from './NotaryMatterDetailPage.vue';

const api = vi.hoisted(() => ({ getNotaryMatter: vi.fn() }));
const materials = vi.hoisted(() => ({ downloadMaterialVersion: vi.fn() }));
vi.mock('../../api/notary', () => api);
vi.mock('../../api/materials', () => materials);

const matter = {
  id: 'matter-1',
  businessNo: 'NT-20260924-001',
  leadId: 'lead-1',
  leadStatus: 'TRANSFERRED_TO_NOTARY',
  leadVersion: 4,
  stage: 'PENDING_EVIDENCE',
  notaryOffice: { id: 'office-1', name: '广州市南方公证处' },
  selectedProductIds: ['product-1'],
  selectedContentVersionIds: ['content-1'],
  evidenceMode: 'ONLINE_PURCHASE',
  batchPurpose: '首批线上取证',
  createdAt: '2026-09-24T01:00:00.000Z',
  sourceLead: { id: 'lead-1', businessNo: 'LD-20260921-001' },
  selectedProducts: [
    {
      id: 'product-1',
      position: 1,
      url: null,
      title: '商品甲',
      quantity: 1,
      unitPrice: '9.00',
      commentCount: 1,
      estimatedAmount: '9.00',
    },
  ],
  selectedMaterials: [
    {
      materialId: 'material-1',
      contentVersionId: 'content-1',
      originalFilename: '截图.png',
      mimeType: 'image/png',
    },
  ],
};

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/notary-matters/:id', component: NotaryMatterDetailPage },
      { path: '/leads/:id', component: { template: '<div />' } },
    ],
  });
  await router.push('/notary-matters/matter-1');
  await router.isReady();
  const wrapper = mount(NotaryMatterDetailPage, {
    global: { plugins: [router] },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.resetAllMocks();
  api.getNotaryMatter.mockResolvedValue(matter);
  materials.downloadMaterialVersion.mockResolvedValue(undefined);
});

describe('NotaryMatterDetailPage', () => {
  it('shows persisted handoff snapshot and source lead, and downloads its selected attachment', async () => {
    const wrapper = await mountPage();
    expect(wrapper.get('[data-test="notary-matter-detail"]').text()).toContain(
      '首批线上取证',
    );
    expect(wrapper.text()).toContain('广州市南方公证处');
    expect(wrapper.text()).toContain('商品甲');
    expect(
      wrapper.get('[data-test="notary-matter-source-lead"]').attributes('href'),
    ).toBe('/leads/lead-1');
    await wrapper
      .get('[data-test="download-matter-material-content-1"]')
      .trigger('click');
    await flushPromises();
    expect(materials.downloadMaterialVersion).toHaveBeenCalledWith(
      'material-1',
      'content-1',
    );
  });
});
