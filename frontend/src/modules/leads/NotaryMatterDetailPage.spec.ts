import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import NotaryMatterDetailPage from './NotaryMatterDetailPage.vue';

const api = vi.hoisted(() => ({
  getNotaryMatter: vi.fn(),
  recordNotaryEvidence: vi.fn(),
  recordNotaryOpening: vi.fn(),
}));
const materials = vi.hoisted(() => ({
  downloadMaterialVersion: vi.fn(),
  uploadMaterialFile: vi.fn(),
}));
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
  capabilities: { recordEvidence: true, recordOpening: false },
  evidence: null,
  opening: null,
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
  api.recordNotaryOpening.mockResolvedValue({});
  materials.downloadMaterialVersion.mockResolvedValue(undefined);
  materials.uploadMaterialFile.mockResolvedValue({
    materialId: 'photo-1',
    contentVersionId: 'photo-v1',
    originalFilename: '开箱.jpg',
    purpose: 'NOTARY_OPENING_PHOTO',
    mimeType: 'image/jpeg',
    sizeBytes: 5,
    sha256: 'a'.repeat(64),
  });
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
    api.getNotaryMatter.mockResolvedValueOnce({
      ...matter,
      stage: 'WAITING_UNBOX',
      version: 3,
      capabilities: { recordEvidence: false, recordOpening: true },
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
      capabilities: { recordEvidence: false, recordOpening: false },
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

  it('uploads real opening photos, submits stable content ids and reloads persisted downloads', async () => {
    api.getNotaryMatter.mockResolvedValueOnce({
      ...matter,
      stage: 'WAITING_UNBOX',
      capabilities: { recordEvidence: false, recordOpening: true },
      evidence: {
        evidenceAt: '2026-09-24',
        sampleFeeState: 'PENDING',
        sampleFeeAmount: null,
        recordedAt: '2026-09-24T01:00:00.000Z',
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
    const wrapper = await mountPage();
    const file = new File(['photo'], '开箱.jpg', { type: 'image/jpeg' });
    Object.defineProperty(
      wrapper.get('[data-test="opening-photo-files"]').element,
      'files',
      { value: [file] },
    );
    await wrapper.get('[data-test="opening-photo-files"]').trigger('change');
    await flushPromises();
    expect(materials.uploadMaterialFile).toHaveBeenCalledWith({
      ownerType: 'NOTARY_MATTER',
      ownerId: 'matter-1',
      category: 'NOTARY_OPENING',
      purpose: 'NOTARY_OPENING_PHOTO',
      file,
    });
    await wrapper.get('[data-test="opening-sender-name"]').setValue('寄件人甲');
    api.recordNotaryOpening.mockResolvedValueOnce({
      id: 'matter-1',
      stage: 'UNBOX_REVIEW',
      version: 4,
      opening: {},
    });
    api.getNotaryMatter.mockResolvedValueOnce({
      ...matter,
      stage: 'UNBOX_REVIEW',
      version: 4,
      capabilities: { recordEvidence: false, recordOpening: false },
      evidence: {
        evidenceAt: '2026-09-24',
        sampleFeeState: 'PENDING',
        sampleFeeAmount: null,
        recordedAt: '2026-09-24T01:00:00.000Z',
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
      opening: {
        senderName: '寄件人甲',
        senderPhone: null,
        senderAddress: null,
        recordedAt: '2026-09-24T02:00:00.000Z',
        recordedByUserId: 'user-1',
        photos: [
          {
            materialId: 'photo-1',
            contentVersionId: 'photo-v1',
            originalFilename: '开箱.jpg',
            mimeType: 'image/jpeg',
          },
        ],
      },
    });
    await wrapper.get('[data-test="record-opening"]').trigger('submit');
    await flushPromises();
    expect(api.recordNotaryOpening).toHaveBeenCalledWith(
      'matter-1',
      {
        expectedVersion: 2,
        contentVersionIds: ['photo-v1'],
        senderName: '寄件人甲',
      },
      expect.any(String),
    );
    expect(wrapper.get('[data-test="saved-opening"]').text()).toContain(
      '开箱.jpg',
    );
    await wrapper
      .get('[data-test="download-opening-photo-photo-v1"]')
      .trigger('click');
    expect(materials.downloadMaterialVersion).toHaveBeenCalledWith(
      'photo-1',
      'photo-v1',
    );
  });

  it('rejects opening photos outside supported MIME types and the 20 MB and 50 file limits', async () => {
    api.getNotaryMatter.mockResolvedValueOnce({
      ...matter,
      stage: 'WAITING_UNBOX',
      capabilities: { recordEvidence: false, recordOpening: true },
      evidence: {},
    });
    const wrapper = await mountPage();
    const invalid = new File(['text'], 'note.txt', { type: 'text/plain' });
    Object.defineProperty(
      wrapper.get('[data-test="opening-photo-files"]').element,
      'files',
      { configurable: true, value: [invalid] },
    );
    await wrapper.get('[data-test="opening-photo-files"]').trigger('change');
    await flushPromises();
    expect(materials.uploadMaterialFile).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('仅支持 JPEG、PNG 或 WEBP');

    const oversized = new File(['photo'], 'large.png', { type: 'image/png' });
    Object.defineProperty(oversized, 'size', { value: 20 * 1024 * 1024 + 1 });
    Object.defineProperty(
      wrapper.get('[data-test="opening-photo-files"]').element,
      'files',
      { value: [oversized] },
    );
    await wrapper.get('[data-test="opening-photo-files"]').trigger('change');
    expect(wrapper.text()).toContain('单张开箱照片不能超过 20 MB');

    const valid = new File(['photo'], 'valid.png', { type: 'image/png' });
    Object.defineProperty(
      wrapper.get('[data-test="opening-photo-files"]').element,
      'files',
      { value: Array(51).fill(valid) },
    );
    await wrapper.get('[data-test="opening-photo-files"]').trigger('change');
    expect(wrapper.text()).toContain('开箱照片最多上传 50 张');
    expect(materials.uploadMaterialFile).not.toHaveBeenCalled();
  });

  it('keeps uploaded content ids and reuses the opening idempotency key after a failed submit', async () => {
    api.getNotaryMatter.mockResolvedValueOnce({
      ...matter,
      stage: 'WAITING_UNBOX',
      capabilities: { recordEvidence: false, recordOpening: true },
      evidence: {
        evidenceAt: '2026-09-24',
        sampleFeeState: 'PENDING',
        sampleFeeAmount: null,
        recordedAt: '2026-09-24T01:00:00.000Z',
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
    const wrapper = await mountPage();
    const file = new File(['photo'], '开箱.jpg', { type: 'image/jpeg' });
    Object.defineProperty(
      wrapper.get('[data-test="opening-photo-files"]').element,
      'files',
      { value: [file] },
    );
    await wrapper.get('[data-test="opening-photo-files"]').trigger('change');
    await flushPromises();
    api.recordNotaryOpening.mockRejectedValueOnce(
      new Error('temporary failure'),
    );
    const submit = wrapper
      .get('[data-test="record-opening"]')
      .trigger('submit');
    await submit;
    await flushPromises();
    await wrapper.get('[data-test="record-opening"]').trigger('submit');
    await flushPromises();
    const calls = api.recordNotaryOpening.mock.calls;
    expect(calls[0]?.[1].contentVersionIds).toEqual(['photo-v1']);
    expect(calls[1]?.[1].contentVersionIds).toEqual(['photo-v1']);
    expect(calls[1]?.[2]).toBe(calls[0]?.[2]);
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
