import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import NotaryMatterDetailPage from './NotaryMatterDetailPage.vue';

const api = vi.hoisted(() => ({
  getNotaryMatter: vi.fn(),
  recordNotaryEvidence: vi.fn(),
}));
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
  version: 2,
  capabilities: { recordEvidence: true },
  evidence: null,
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
  api.recordNotaryEvidence.mockResolvedValue({});
  materials.downloadMaterialVersion.mockResolvedValue(undefined);
});

describe('NotaryMatterDetailPage', () => {
  it('marks every initially required evidence choice before submission', async () => {
    const wrapper = await mountPage();
    expect(wrapper.findAll('.required-mark')).toHaveLength(4);
    await wrapper
      .get('[data-test="logistics-company-state-0"]')
      .setValue('PRESENT');
    expect(wrapper.findAll('.required-mark')).toHaveLength(5);
  });

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

  it('records explicit online evidence and logistics, then renders the saved record read only', async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('提交后事项将进入待开箱');
    await wrapper.get('[data-test="evidence-date"]').setValue('2026-09-24');
    await wrapper.get('[data-test="sample-fee-state"]').setValue('KNOWN');
    await wrapper.get('[data-test="sample-fee-amount"]').setValue('0.00');
    await wrapper
      .get('[data-test="logistics-company-state-0"]')
      .setValue('PRESENT');
    await wrapper
      .get('[data-test="logistics-company-value-0"]')
      .setValue('顺丰');
    await wrapper
      .get('[data-test="logistics-tracking-state-0"]')
      .setValue('NONE');
    const savedEvidence = {
      evidenceAt: '2026-09-24',
      sampleFeeState: 'KNOWN',
      sampleFeeAmount: '0.00',
      recordedAt: '2026-09-24T02:00:00.000Z',
      recordedByUserId: 'user-1',
      logistics: [
        {
          id: 'logistics-1',
          companyState: 'PRESENT',
          companyValue: '顺丰',
          trackingState: 'NONE',
          trackingValue: null,
        },
      ],
    };
    api.recordNotaryEvidence.mockResolvedValueOnce({
      id: 'matter-1',
      stage: 'WAITING_UNBOX',
      version: 3,
      evidence: savedEvidence,
    });
    await wrapper.get('[data-test="record-evidence"]').trigger('submit');
    await flushPromises();
    expect(api.recordNotaryEvidence).toHaveBeenCalledWith(
      'matter-1',
      {
        evidenceAt: '2026-09-24',
        sampleFeeState: 'KNOWN',
        sampleFeeAmount: '0.00',
        logistics: [
          {
            companyState: 'PRESENT',
            companyValue: '顺丰',
            trackingState: 'NONE',
            trackingValue: null,
          },
        ],
        expectedVersion: 2,
      },
      expect.any(String),
    );
    expect(wrapper.text()).toContain('等待开箱');
    expect(wrapper.text()).toContain('顺丰');
    expect(wrapper.text()).not.toContain('顺丰快递');
    expect(wrapper.find('[data-test="evidence-date"]').exists()).toBe(false);
    api.getNotaryMatter.mockResolvedValueOnce({
      ...matter,
      stage: 'WAITING_UNBOX',
      version: 3,
      capabilities: { recordEvidence: false },
      evidence: savedEvidence,
    });
    await wrapper.get('[data-test="refresh-matter"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="saved-evidence"]').text()).toContain(
      '顺丰',
    );
    expect(wrapper.find('[data-test="evidence-date"]').exists()).toBe(false);
  });

  it('requires explicit company and tracking states and does not submit invalid rows', async () => {
    const wrapper = await mountPage();
    await wrapper.get('[data-test="record-evidence"]').trigger('submit');
    await flushPromises();
    expect(api.recordNotaryEvidence).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('请选择取证日期');
    expect(wrapper.text()).toContain('请选择快递公司状态');
    expect(wrapper.text()).toContain('请选择快递单号状态');
  });

  it('reuses a key only while the submitted evidence payload stays unchanged', async () => {
    const wrapper = await mountPage();
    await wrapper.get('[data-test="evidence-date"]').setValue('2026-09-24');
    await wrapper.get('[data-test="sample-fee-state"]').setValue('PENDING');
    await wrapper
      .get('[data-test="logistics-company-state-0"]')
      .setValue('NONE');
    await wrapper
      .get('[data-test="logistics-tracking-state-0"]')
      .setValue('NONE');
    api.recordNotaryEvidence
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({
        id: 'matter-1',
        stage: 'WAITING_UNBOX',
        version: 3,
        evidence: {
          evidenceAt: '2026-09-25',
          sampleFeeState: 'PENDING',
          sampleFeeAmount: null,
          recordedAt: '2026-09-24T02:00:00.000Z',
          recordedByUserId: 'user-1',
          logistics: [
            {
              id: 'logistics-1',
              companyState: 'NONE',
              companyValue: null,
              trackingState: 'NONE',
              trackingValue: null,
            },
          ],
        },
      });

    await wrapper.get('[data-test="record-evidence"]').trigger('submit');
    await flushPromises();
    await wrapper.get('[data-test="record-evidence"]').trigger('submit');
    await flushPromises();
    await wrapper.get('[data-test="evidence-date"]').setValue('2026-09-25');
    await wrapper.get('[data-test="record-evidence"]').trigger('submit');
    await flushPromises();

    const keys = api.recordNotaryEvidence.mock.calls.map((call) => call[2]);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it.each(['IDEMPOTENCY_CONFLICT', 'INVALID_STATE'])(
    'gives refresh guidance for %s',
    async (code) => {
      const wrapper = await mountPage();
      await wrapper.get('[data-test="evidence-date"]').setValue('2026-09-24');
      await wrapper.get('[data-test="sample-fee-state"]').setValue('PENDING');
      await wrapper
        .get('[data-test="logistics-company-state-0"]')
        .setValue('NONE');
      await wrapper
        .get('[data-test="logistics-tracking-state-0"]')
        .setValue('NONE');
      api.recordNotaryEvidence.mockRejectedValueOnce(
        new ApiError('conflict', 409, code),
      );
      await wrapper.get('[data-test="record-evidence"]').trigger('submit');
      await flushPromises();
      expect(wrapper.text()).toContain('请刷新后再试');
    },
  );
});
