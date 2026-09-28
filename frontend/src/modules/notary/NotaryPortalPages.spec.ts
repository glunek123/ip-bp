import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NotaryPortalListPage from './NotaryPortalListPage.vue';
import NotaryPortalDetailPage from './NotaryPortalDetailPage.vue';

const api = vi.hoisted(() => ({
  listNotaryPortalMatters: vi.fn(),
  getNotaryPortalMatter: vi.fn(),
  recordNotaryPortalOpening: vi.fn(),
  listOwnerMaterials: vi.fn(),
  uploadMaterialFile: vi.fn(),
  downloadMaterialVersion: vi.fn(),
}));
vi.mock('../../api/notary-portal', () => ({
  listNotaryPortalMatters: api.listNotaryPortalMatters,
  getNotaryPortalMatter: api.getNotaryPortalMatter,
  recordNotaryPortalOpening: api.recordNotaryPortalOpening,
}));
vi.mock('../../api/materials', () => ({
  listOwnerMaterials: api.listOwnerMaterials,
  uploadMaterialFile: api.uploadMaterialFile,
  downloadMaterialVersion: api.downloadMaterialVersion,
}));

beforeEach(() => {
  vi.resetAllMocks();
  api.listNotaryPortalMatters.mockResolvedValue({
    items: [
      {
        id: 'matter-1',
        businessNo: 'NZ-001',
        stage: 'WAITING_UNBOX',
        version: 2,
        createdAt: '2026-09-28T00:00:00Z',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 100,
  });
  api.getNotaryPortalMatter.mockResolvedValue({
    id: 'matter-1',
    businessNo: 'NZ-001',
    stage: 'UNBOX_REVIEW',
    version: 3,
    createdAt: '2026-09-28T00:00:00Z',
    evidence: { evidenceAt: '2026-09-27', logistics: [] },
    opening: {
      senderName: null,
      senderPhone: null,
      senderAddress: null,
      recordedAt: '2026-09-28T00:00:00Z',
      recordedByUserId: 'notary-user',
      photos: [
        {
          materialId: 'material-1',
          contentVersionId: 'version-1',
          originalFilename: 'box.jpg',
          mimeType: 'image/jpeg',
        },
      ],
    },
    capabilities: { recordOpening: false },
  });
  api.listOwnerMaterials.mockResolvedValue({ items: [], total: 0 });
});

async function mountRoute(
  path: string,
  component: typeof NotaryPortalListPage | typeof NotaryPortalDetailPage,
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/notary-portal/matters', component: NotaryPortalListPage },
      { path: '/notary-portal/matters/:id', component: NotaryPortalDetailPage },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(component, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('notary portal pages', () => {
  it('lists only the current portal queue with a direct detail link', async () => {
    const wrapper = await mountRoute(
      '/notary-portal/matters',
      NotaryPortalListPage,
    );
    expect(wrapper.get('[data-test="notary-portal-row"]').text()).toBe(
      'NZ-001',
    );
    expect(wrapper.text()).not.toContain('客户');
    expect(
      wrapper.get('[data-test="notary-portal-row"]').attributes('href'),
    ).toBe('/notary-portal/matters/matter-1');
  });

  it('shows the saved opening after reload without internal or future actions', async () => {
    const wrapper = await mountRoute(
      '/notary-portal/matters/matter-1',
      NotaryPortalDetailPage,
    );
    expect(wrapper.get('[data-test="notary-saved-opening"]').text()).toContain(
      'box.jpg',
    );
    expect(wrapper.text()).toContain('2026-09-27');
    expect(wrapper.text()).not.toContain('客户');
    expect(wrapper.text()).not.toContain('费用');
    expect(wrapper.find('[data-test="notary-opening-submit"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).not.toContain('出证');
    expect(api.getNotaryPortalMatter).toHaveBeenCalledWith(
      'matter-1',
      expect.any(Object),
    );
  });
});
