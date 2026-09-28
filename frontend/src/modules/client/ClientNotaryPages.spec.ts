import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import ClientNotaryListPage from './ClientNotaryListPage.vue';
import ClientNotaryDetailPage from './ClientNotaryDetailPage.vue';

const api = vi.hoisted(() => ({
  listClientNotaryMatters: vi.fn(),
  getClientNotaryMatter: vi.fn(),
  reviewClientNotaryOpening: vi.fn(),
  downloadMaterialVersion: vi.fn(),
}));
vi.mock('../../api/client-notary', () => ({
  listClientNotaryMatters: api.listClientNotaryMatters,
  getClientNotaryMatter: api.getClientNotaryMatter,
  reviewClientNotaryOpening: api.reviewClientNotaryOpening,
}));
vi.mock('../../api/materials', () => ({
  downloadMaterialVersion: api.downloadMaterialVersion,
}));

const list = {
  items: [
    {
      id: 'matter-1',
      businessNo: 'NT-001',
      stage: 'UNBOX_REVIEW',
      version: 2,
      createdAt: '2026-09-24T01:00:00.000Z',
      sourceLeadBusinessNo: 'LD-001',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
};
const pending = {
  id: 'matter-1',
  businessNo: 'NT-001',
  stage: 'UNBOX_REVIEW',
  version: 2,
  createdAt: '2026-09-24T01:00:00.000Z',
  sourceLead: { id: 'lead-1', businessNo: 'LD-001' },
  selectedProducts: [
    {
      id: 'product-1',
      position: 1,
      title: '商品甲',
      url: null,
      quantity: 1,
      unitPrice: '9.00',
      commentCount: 0,
      estimatedAmount: '9.00',
    },
  ],
  opening: {
    recordedAt: '2026-09-24T02:00:00.000Z',
    photos: [
      {
        materialId: 'photo-1',
        contentVersionId: 'photo-v1',
        originalFilename: '开箱.jpg',
        mimeType: 'image/jpeg',
      },
    ],
  },
  reviewDecision: null,
  capabilities: { reviewOpening: true },
};

beforeEach(() => {
  vi.resetAllMocks();
  api.listClientNotaryMatters.mockResolvedValue(list);
  api.getClientNotaryMatter.mockResolvedValue(pending);
  api.reviewClientNotaryOpening.mockResolvedValue({});
  api.downloadMaterialVersion.mockResolvedValue(undefined);
});

async function mountPage(
  path: string,
  component: typeof ClientNotaryListPage | typeof ClientNotaryDetailPage,
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/client/notary-matters', component: ClientNotaryListPage },
      { path: '/client/notary-matters/:id', component: ClientNotaryDetailPage },
      { path: '/client/leads/:id', component: { template: '<div />' } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(component, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('client notary pages', () => {
  it('loads the pending queue and passes sourceLeadId for multi-batch history', async () => {
    await mountPage('/client/notary-matters', ClientNotaryListPage);
    expect(api.listClientNotaryMatters).toHaveBeenCalledWith(
      1,
      20,
      expect.any(Object),
      undefined,
    );
    await mountPage(
      '/client/notary-matters?sourceLeadId=lead-1',
      ClientNotaryListPage,
    );
    expect(api.listClientNotaryMatters).toHaveBeenLastCalledWith(
      1,
      20,
      expect.any(Object),
      'lead-1',
    );
  });

  it('shows the minimal client detail, no default result, and downloads the frozen photo', async () => {
    const wrapper = await mountPage(
      '/client/notary-matters/matter-1',
      ClientNotaryDetailPage,
    );
    expect(wrapper.text()).toContain('商品甲');
    expect(
      wrapper.findAll('[data-test="client-review-result"]:checked'),
    ).toHaveLength(0);
    expect(wrapper.text()).toContain(
      '侵权后进入开箱待确认，由运营决定是否出证',
    );
    expect(wrapper.text()).toContain('不侵权将立即归档，普通入口不能撤回');
    expect(wrapper.text()).not.toContain('物流');
    await wrapper
      .get('[data-test="download-client-opening-photo-photo-v1"]')
      .trigger('click');
    expect(api.downloadMaterialVersion).toHaveBeenCalledWith(
      'photo-1',
      'photo-v1',
    );
  });

  it('requires the no-infringement reason and persists the selected decision', async () => {
    const saved = {
      ...pending,
      stage: 'ARCHIVED',
      version: 3,
      capabilities: { reviewOpening: false },
      reviewDecision: {
        result: 'NO_INFRINGEMENT',
        reason: '未发现侵权',
        actorKind: 'CLIENT',
        actorDisplayName: '客户审核员',
        decidedAt: '2026-09-24T03:00:00.000Z',
        archivedAt: '2026-09-24T03:00:00.000Z',
      },
    };
    api.getClientNotaryMatter
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(saved);
    const wrapper = await mountPage(
      '/client/notary-matters/matter-1',
      ClientNotaryDetailPage,
    );
    await wrapper
      .get('[data-test="client-review-result-no-infringement"]')
      .setValue(true);
    await wrapper
      .get('[data-test="client-opening-review-form"]')
      .trigger('submit');
    expect(wrapper.text()).toContain('请填写不侵权原因');
    expect(api.reviewClientNotaryOpening).not.toHaveBeenCalled();
    await wrapper
      .get('[data-test="client-opening-review-reason"]')
      .setValue('未发现侵权');
    await wrapper
      .get('[data-test="client-opening-review-form"]')
      .trigger('submit');
    await flushPromises();
    expect(api.reviewClientNotaryOpening).toHaveBeenCalledWith(
      'matter-1',
      { result: 'NO_INFRINGEMENT', reason: '未发现侵权', expectedVersion: 2 },
      expect.any(String),
    );
    expect(api.getClientNotaryMatter).toHaveBeenCalledTimes(2);
    expect(wrapper.get('[data-test="client-review-record"]').text()).toContain(
      '未发现侵权',
    );
  });

  it('shows a persisted decision read only when review capability is false', async () => {
    api.getClientNotaryMatter.mockResolvedValue({
      ...pending,
      stage: 'ISSUANCE_DECISION',
      capabilities: { reviewOpening: false },
      reviewDecision: {
        result: 'INFRINGEMENT',
        reason: null,
        actorKind: 'INTERNAL',
        actorDisplayName: '运营甲',
        decidedAt: '2026-09-24T03:00:00.000Z',
        archivedAt: null,
      },
    });
    const wrapper = await mountPage(
      '/client/notary-matters/matter-1',
      ClientNotaryDetailPage,
    );
    expect(
      wrapper.find('[data-test="client-opening-review-form"]').exists(),
    ).toBe(false);
    expect(wrapper.get('[data-test="client-review-record"]').text()).toContain(
      '运营甲',
    );
  });

  it('retains the same request key after a timeout and reports stable permission errors', async () => {
    api.reviewClientNotaryOpening
      .mockRejectedValueOnce(new ApiError('timeout', 0, 'TIMEOUT'))
      .mockResolvedValueOnce({});
    const saved = {
      ...pending,
      stage: 'ISSUANCE_DECISION',
      version: 3,
      capabilities: { reviewOpening: false },
      reviewDecision: {
        result: 'INFRINGEMENT',
        reason: null,
        actorKind: 'CLIENT',
        actorDisplayName: '客户审核员',
        decidedAt: '2026-09-24T03:00:00.000Z',
        archivedAt: null,
      },
    };
    api.getClientNotaryMatter
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(saved);
    const wrapper = await mountPage(
      '/client/notary-matters/matter-1',
      ClientNotaryDetailPage,
    );
    await wrapper.get('[data-test="client-review-result"]').setValue(true);
    await wrapper
      .get('[data-test="client-opening-review-form"]')
      .trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('提交结果暂时未知');
    await wrapper
      .get('[data-test="client-opening-review-form"]')
      .trigger('submit');
    await flushPromises();
    expect(api.reviewClientNotaryOpening.mock.calls[1]?.[2]).toBe(
      api.reviewClientNotaryOpening.mock.calls[0]?.[2],
    );
    expect(wrapper.get('[data-test="client-review-record"]').text()).toContain(
      '确认侵权',
    );

    api.getClientNotaryMatter.mockResolvedValue(pending);
    api.reviewClientNotaryOpening.mockRejectedValueOnce(
      new ApiError('forbidden', 403, 'ACTION_FORBIDDEN'),
    );
    const denied = await mountPage(
      '/client/notary-matters/matter-1',
      ClientNotaryDetailPage,
    );
    await denied.get('[data-test="client-review-result"]').setValue(true);
    await denied
      .get('[data-test="client-opening-review-form"]')
      .trigger('submit');
    await flushPromises();
    expect(denied.text()).toContain('当前账号无权审核此事项');
  });
});
