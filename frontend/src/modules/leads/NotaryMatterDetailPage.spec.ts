import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import NotaryMatterDetailPage from './NotaryMatterDetailPage.vue';
import type { NotaryMatterDetail } from '../../api/notary';
import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from '../../stores/auth';

const sourceProjection = {
  sourceSummary: {
    customer: { id: 'customer-1', name: '来源客户' },
    rightsHolder: { id: 'holder-1', name: '来源权利主体' },
    platform: 'TAOBAO',
    shopName: '来源店铺',
    shopExternalId: 'TB-001',
  },
  transferredAt: '2026-09-24',
  evidenceAt: null,
  openingSummary: null,
  certificateSummary: null,
  linkedCase: null,
  certificateFiles: [],
  fees: {
    notary: { state: 'UNRECORDED', amount: null },
    investigation: { state: 'UNRECORDED', amount: null },
    sample: { state: 'UNRECORDED', amount: null },
  },
} satisfies Pick<
  NotaryMatterDetail,
  | 'sourceSummary'
  | 'transferredAt'
  | 'evidenceAt'
  | 'openingSummary'
  | 'certificateSummary'
  | 'linkedCase'
  | 'fees'
  | 'certificateFiles'
>;

const api = vi.hoisted(() => ({
  getNotaryMatter: vi.fn(),
  recordNotaryEvidence: vi.fn(),
  recordNotaryOpening: vi.fn(),
  reviewNotaryOpening: vi.fn(),
  decideNotaryIssuance: vi.fn(),
  archiveNotaryReturn: vi.fn(),
  correctNotaryEvidence: vi.fn(),
  correctNotaryOpeningSender: vi.fn(),
}));
const materials = vi.hoisted(() => ({
  downloadMaterialVersion: vi.fn(),
  uploadMaterialFile: vi.fn(),
  listOwnerMaterials: vi.fn(),
  deleteMaterial: vi.fn(),
}));
const workflow = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock('../../app/workflow-events', () => ({
  notifyWorkflowChanged: workflow.notify,
}));
vi.mock('../../api/notary', () => api);
vi.mock('../../api/materials', () => materials);

const matter = {
  ...sourceProjection,
  id: 'matter-1',
  businessNo: 'NT-20260924-001',
  leadId: 'lead-1',
  leadStatus: 'TRANSFERRED_TO_NOTARY',
  leadVersion: 4,
  stage: 'PENDING_EVIDENCE',
  version: 2,
  capabilities: {
    recordEvidence: true,
    recordOpening: false,
    reviewOpening: false,
    decideIssuance: false,
    archiveReturn: false,
  },
  evidence: null,
  opening: null,
  reviewDecision: null,
  issuanceDecision: null,
  returnArchive: null,
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

describe('notary workflow handoff guidance', () => {
  it.each([
    ['PENDING_EVIDENCE', '运营', 'recordEvidence', '#evidence-form'],
    ['WAITING_UNBOX', '公证处', 'recordOpening', '#opening-form'],
    ['UNBOX_REVIEW', '客户', 'reviewOpening', '#review-form'],
    ['ISSUANCE_DECISION', '运营', 'decideIssuance', '#issuance-form'],
    ['WAITING_RETURN', '不出证', 'archiveReturn', '#return-archive-form'],
  ])(
    'shows the real %s responsibility and existing form only when offered',
    async (stage, responsible, capability, anchor) => {
      api.getNotaryMatter.mockResolvedValue({
        ...matter,
        stage,
        capabilities: { [capability!]: true },
      });
      const wrapper = await mountPage();
      expect(wrapper.get('[data-test="notary-workflow"]').text()).toContain(
        responsible,
      );
      expect(
        wrapper.get('[data-test="notary-workflow-action"]').attributes('href'),
      ).toContain(anchor);
      api.getNotaryMatter.mockResolvedValue({
        ...matter,
        stage,
        capabilities: {},
      });
      await wrapper.get('[data-test="refresh-matter"]').trigger('click');
      await flushPromises();
      expect(
        wrapper.find('[data-test="notary-workflow-action"]').exists(),
      ).toBe(false);
    },
  );

  it('hands waiting certificate to the notary without an operator certificate action', async () => {
    api.getNotaryMatter.mockResolvedValue({
      ...matter,
      stage: 'WAITING_CERTIFICATE',
      capabilities: {},
    });
    const wrapper = await mountPage();
    expect(wrapper.get('[data-test="notary-workflow"]').text()).toContain(
      '下一步登记真实公证书',
    );
    expect(wrapper.find('[data-test="notary-workflow-action"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-test="certificate-submit"]').exists()).toBe(
      false,
    );
  });

  it('opens the full certificate form for an authorized internal proxy', async () => {
    api.getNotaryMatter.mockResolvedValue({
      ...matter,
      stage: 'WAITING_CERTIFICATE',
      disclosureRequired: false,
      capabilities: { proxyIssueCertificate: true },
    });
    const wrapper = await mountPage();
    expect(
      wrapper.get('[data-test="notary-workflow-action"]').attributes('href'),
    ).toContain('#certificate');
    expect(
      wrapper.find('#certificate [data-test="certificate-form"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-test="certificate-number"]').exists()).toBe(
      true,
    );
  });

  it('prominently links only the projected exact case and removes it after lost visibility', async () => {
    api.getNotaryMatter.mockResolvedValue({
      ...matter,
      stage: 'ARCHIVED',
      linkedCase: {
        id: 'exact-case',
        businessNo: 'CA-EXACT',
        stage: 'PENDING_MATCH',
      },
      capabilities: {},
    });
    const wrapper = await mountPage();
    expect(wrapper.get('[data-test="linked-case"]').attributes('href')).toBe(
      '/cases/exact-case',
    );
    expect(wrapper.get('[data-test="notary-workflow"]').text()).toContain(
      '下一步由运营',
    );
    api.getNotaryMatter.mockResolvedValue({
      ...matter,
      stage: 'ARCHIVED',
      linkedCase: null,
      capabilities: {},
    });
    await wrapper.get('[data-test="refresh-matter"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="linked-case"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="notary-case-summary"]').text()).toContain(
      '暂无可见案件',
    );
    expect(wrapper.get('[data-test="notary-workflow"]').text()).not.toContain(
      '已出证',
    );
  });
});

const firstEvidence = {
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
};

function openingMaterial(id: string, versionId: string, filename: string) {
  return {
    id,
    ownerType: 'NOTARY_MATTER',
    ownerId: 'matter-1',
    category: 'NOTARY_OPENING_PHOTO',
    purpose: 'NOTARY_OPENING_PHOTO',
    currentVersionId: versionId,
    status: 'ACTIVE',
    version: 4,
    deletedAt: null,
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
    contentVersions: [
      {
        id: versionId,
        materialId: id,
        originalFilename: filename,
        mimeType: 'image/jpeg',
        sizeBytes: 5,
        sha256: 'a'.repeat(64),
        status: 'AVAILABLE',
        createdAt: '2026-09-24T00:00:00.000Z',
      },
    ],
  };
}

function uploadedOpeningPhoto(id: string, versionId: string, filename: string) {
  return {
    materialId: id,
    contentVersionId: versionId,
    originalFilename: filename,
    purpose: 'NOTARY_OPENING_PHOTO',
    mimeType: 'image/jpeg',
    sizeBytes: 5,
    sha256: 'a'.repeat(64),
  };
}

async function selectOpeningFile(
  wrapper: Awaited<ReturnType<typeof mountPage>>,
  filename: string,
) {
  const file = new File(['photo'], filename, { type: 'image/jpeg' });
  Object.defineProperty(
    wrapper.get('[data-test="opening-photo-files"]').element,
    'files',
    { configurable: true, value: [file] },
  );
  await wrapper.get('[data-test="opening-photo-files"]').trigger('change');
  await flushPromises();
}

async function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore();
  auth.session = {
    principalType: 'INTERNAL',
    user: { id: 'user-1', displayName: '运营', username: 'operator' },
    department: { id: 'department-1', name: '知产部' },
    departments: [{ id: 'department-1', name: '知产部' }],
    customer: null,
    notaryOffice: null,
    authorizationRevision: 1,
    expiresAt: '2099-01-01T00:00:00.000Z',
    csrfToken: 'csrf-token',
  };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/notary-matters/:id', component: NotaryMatterDetailPage },
      { path: '/leads/:id', component: { template: '<div />' } },
      { path: '/cases/:id', component: { template: '<div />' } },
    ],
  });
  await router.push('/notary-matters/matter-1');
  await router.isReady();
  const wrapper = mount(NotaryMatterDetailPage, {
    global: { plugins: [router, pinia] },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  globalThis.sessionStorage.clear();
  vi.resetAllMocks();
  api.getNotaryMatter.mockResolvedValue(matter);
  api.recordNotaryEvidence.mockResolvedValue({});
  api.recordNotaryOpening.mockResolvedValue({});
  api.reviewNotaryOpening.mockResolvedValue({});
  materials.downloadMaterialVersion.mockResolvedValue(undefined);
  materials.listOwnerMaterials.mockResolvedValue({ items: [], total: 0 });
  materials.deleteMaterial.mockResolvedValue({
    id: 'photo-1',
    status: 'DELETED',
    version: 2,
  });
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
  it('shows record correction history on archived details without offering a new correction', async () => {
    api.getNotaryMatter.mockResolvedValue({
      ...matter,
      stage: 'ARCHIVED',
      capabilities: {
        recordEvidence: false,
        recordOpening: false,
        reviewOpening: false,
        decideIssuance: false,
        archiveReturn: false,
      },
      recordEdits: {
        evidence: {
          canCorrect: false,
          revision: 1,
          original: { evidenceAt: '2026-10-01', logistics: [] },
          effective: { evidenceAt: '2026-10-02', logistics: [] },
          history: [
            {
              correctionId: 'c-1',
              revision: 1,
              correctionReason: '日期录入错误',
              actorUserId: 'operator-1',
              recordedAt: '2026-10-03T00:00:00Z',
              before: { evidenceAt: '2026-10-01', logistics: [] },
              after: { evidenceAt: '2026-10-02', logistics: [] },
            },
          ],
        },
        openingSender: null,
      },
    });
    const wrapper = await mountPage();
    expect(
      wrapper.get('[data-test="notary-record-corrections"]').text(),
    ).toContain('日期录入错误');
    expect(wrapper.find('[data-test="correct-evidence"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('keeps the correction panel and draft visible while refreshed facts arrive after a 409', async () => {
    const logistics = [
      {
        id: 'log-1',
        companyState: 'PRESENT',
        companyValue: '顺丰',
        trackingState: 'PRESENT',
        trackingValue: 'SF1',
      },
    ];
    const recordEdits = {
      evidence: {
        canCorrect: true,
        revision: 0,
        original: { evidenceAt: '2026-10-01', logistics },
        effective: { evidenceAt: '2026-10-01', logistics },
        history: [],
      },
      openingSender: null,
    };
    const current = {
      ...matter,
      capabilities: {
        recordEvidence: true,
        recordOpening: false,
        reviewOpening: false,
        decideIssuance: false,
        archiveReturn: false,
      },
      evidence: {
        evidenceAt: '2026-10-01',
        sampleFeeState: 'PENDING',
        sampleFeeAmount: null,
        recordedAt: '2026-10-02T00:00:00Z',
        recordedByUserId: 'operator-1',
        logistics,
      },
      recordEdits,
    };
    api.getNotaryMatter
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...current, version: 3 });
    api.correctNotaryEvidence.mockRejectedValueOnce(
      new ApiError('stale', 409, 'VERSION_CONFLICT'),
    );
    const wrapper = await mountPage();
    await wrapper
      .get('[data-test="notary-record-corrections"] textarea')
      .setValue('保留冲突原因');
    await wrapper
      .get('[data-test="notary-record-corrections"] input[type="date"]')
      .setValue('2026-10-02');
    await wrapper.get('[data-test="correct-evidence"]').trigger('click');
    await flushPromises();
    expect(api.getNotaryMatter).toHaveBeenCalledTimes(2);
    expect(
      wrapper.find('[data-test="notary-record-corrections"]').exists(),
    ).toBe(true);
    expect(
      wrapper.get<HTMLTextAreaElement>(
        '[data-test="notary-record-corrections"] textarea',
      ).element.value,
    ).toBe('保留冲突原因');
    expect(wrapper.get('[data-test="correction-message"]').text()).toContain(
      '事项状态或版本已变化',
    );
    expect(api.correctNotaryEvidence).toHaveBeenCalledWith(
      'matter-1',
      expect.objectContaining({
        expectedVersion: 2,
        correctionReason: '保留冲突原因',
        evidenceAt: '2026-10-02',
      }),
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    wrapper.unmount();
  });

  it('clears the submitted correction draft after a successful write and fresh read', async () => {
    const before = [
      {
        id: 'log-1',
        companyState: 'PRESENT',
        companyValue: '顺丰',
        trackingState: 'PRESENT',
        trackingValue: 'SF1',
      },
    ];
    const after = [
      {
        id: 'log-2',
        companyState: 'PRESENT',
        companyValue: '中通',
        trackingState: 'PRESENT',
        trackingValue: 'ZT2',
      },
    ];
    const makeEdits = (revision: number, rows: typeof before) => ({
      evidence: {
        canCorrect: true,
        revision,
        original: { evidenceAt: '2026-10-01', logistics: before },
        effective: {
          evidenceAt: revision ? '2026-10-02' : '2026-10-01',
          logistics: rows,
        },
        history: [],
      },
      openingSender: null,
    });
    api.getNotaryMatter
      .mockResolvedValueOnce({
        ...matter,
        evidence: {
          evidenceAt: '2026-10-01',
          sampleFeeState: 'PENDING',
          sampleFeeAmount: null,
          recordedAt: '2026-10-02T00:00:00Z',
          recordedByUserId: 'operator-1',
          logistics: before,
        },
        recordEdits: makeEdits(0, before),
      })
      .mockResolvedValueOnce({
        ...matter,
        version: 3,
        evidence: {
          evidenceAt: '2026-10-02',
          sampleFeeState: 'PENDING',
          sampleFeeAmount: null,
          recordedAt: '2026-10-03T00:00:00Z',
          recordedByUserId: 'operator-1',
          logistics: after,
        },
        recordEdits: makeEdits(1, after),
      });
    api.correctNotaryEvidence.mockResolvedValueOnce({
      matterId: 'matter-1',
      correctionId: 'c-success',
      kind: 'EVIDENCE',
      revision: 1,
      recordedAt: '2026-10-03T00:00:00Z',
    });
    const wrapper = await mountPage();
    await wrapper
      .get('[data-test="notary-record-corrections"] textarea')
      .setValue('修正物流');
    await wrapper
      .get('[data-test="notary-record-corrections"] input[type="date"]')
      .setValue('2026-10-02');
    await wrapper
      .get('[data-test="notary-record-corrections"] input[maxlength="200"]')
      .setValue('中通');
    await wrapper
      .get('[data-test="notary-record-corrections"] input[maxlength="100"]')
      .setValue('ZT2');
    await wrapper.get('[data-test="correct-evidence"]').trigger('click');
    await flushPromises();
    expect(
      wrapper.get<HTMLTextAreaElement>(
        '[data-test="notary-record-corrections"] textarea',
      ).element.value,
    ).toBe('');
    expect(
      wrapper.get('[data-test="notary-record-corrections"]').text(),
    ).toContain('中通');
    expect(api.correctNotaryEvidence).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('locks correction and workflow writes through a 409 fact refresh without invalidating the next write', async () => {
    const logistics = [
      {
        id: 'log-1',
        companyState: 'PRESENT' as const,
        companyValue: '顺丰',
        trackingState: 'PRESENT' as const,
        trackingValue: 'SF1',
      },
    ];
    const current = {
      ...matter,
      capabilities: {
        recordEvidence: true,
        recordOpening: false,
        reviewOpening: false,
        decideIssuance: false,
        archiveReturn: false,
      },
      evidence: {
        evidenceAt: '2026-10-01',
        sampleFeeState: 'PENDING',
        sampleFeeAmount: null,
        recordedAt: '2026-10-02T00:00:00Z',
        recordedByUserId: 'operator-1',
        logistics,
      },
      recordEdits: {
        evidence: {
          canCorrect: true,
          revision: 0,
          original: { evidenceAt: '2026-10-01', logistics },
          effective: { evidenceAt: '2026-10-01', logistics },
          history: [],
        },
        openingSender: null,
      },
    } as NotaryMatterDetail;
    let resolveRefresh: (fresh: NotaryMatterDetail) => void = () => {};
    const refresh = new Promise<NotaryMatterDetail>((resolve) => {
      resolveRefresh = resolve;
    });
    api.getNotaryMatter
      .mockResolvedValueOnce(current)
      .mockReturnValueOnce(refresh)
      .mockResolvedValueOnce({ ...current, version: 4 });
    api.correctNotaryEvidence
      .mockRejectedValueOnce(new ApiError('stale', 409, 'VERSION_CONFLICT'))
      .mockReturnValueOnce(new Promise(() => {}));
    const wrapper = await mountPage();
    await wrapper
      .get('[data-test="notary-record-corrections"] textarea')
      .setValue('冲突后保留');
    await wrapper.get('[data-test="correct-evidence"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="correction-refreshing"]').exists()).toBe(
      true,
    );
    await wrapper.get('[data-test="correct-evidence"]').trigger('click');
    expect(api.correctNotaryEvidence).toHaveBeenCalledTimes(1);
    expect(
      wrapper
        .get('[data-test="notary-record-corrections"] .correction-form')
        .attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.findAll('fieldset').some((fieldset) => fieldset.element.disabled),
    ).toBe(true);

    resolveRefresh({ ...current, version: 3 });
    await flushPromises();
    expect(wrapper.find('[data-test="correction-refreshing"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.get<HTMLTextAreaElement>(
        '[data-test="notary-record-corrections"] textarea',
      ).element.value,
    ).toBe('冲突后保留');
    await wrapper.get('[data-test="correct-evidence"]').trigger('click');
    expect(api.correctNotaryEvidence).toHaveBeenCalledTimes(2);
    expect(
      sessionStorage.getItem(
        `notary-record-correction:${JSON.stringify(['user-1:INTERNAL:department-1', 'matter-1'])}`,
      ),
    ).toContain('冲突后保留');
    wrapper.unmount();
  });

  it('blocks new writes after a failed fact read until explicit reread succeeds', async () => {
    const logistics = [
      {
        id: 'log-1',
        companyState: 'PRESENT' as const,
        companyValue: '顺丰',
        trackingState: 'PRESENT' as const,
        trackingValue: 'SF1',
      },
    ];
    const current = {
      ...matter,
      capabilities: {
        recordEvidence: true,
        recordOpening: false,
        reviewOpening: false,
        decideIssuance: false,
        archiveReturn: false,
      },
      evidence: {
        evidenceAt: '2026-10-01',
        sampleFeeState: 'PENDING',
        sampleFeeAmount: null,
        recordedAt: '2026-10-02T00:00:00Z',
        recordedByUserId: 'operator-1',
        logistics,
      },
      recordEdits: {
        evidence: {
          canCorrect: true,
          revision: 0,
          original: { evidenceAt: '2026-10-01', logistics },
          effective: { evidenceAt: '2026-10-01', logistics },
          history: [],
        },
        openingSender: null,
      },
    } as NotaryMatterDetail;
    api.getNotaryMatter
      .mockResolvedValueOnce(current)
      .mockRejectedValueOnce(new Error('temporary read failure'))
      .mockResolvedValueOnce(current);
    api.correctNotaryEvidence.mockRejectedValueOnce(
      new ApiError('stale', 409, 'VERSION_CONFLICT'),
    );
    const wrapper = await mountPage();
    await wrapper
      .get('[data-test="notary-record-corrections"] textarea')
      .setValue('读取失败后保留');
    await wrapper.get('[data-test="correct-evidence"]').trigger('click');
    await flushPromises();
    expect(
      wrapper.find('[data-test="correction-refresh-error"]').exists(),
    ).toBe(true);
    await wrapper.get('[data-test="correct-evidence"]').trigger('click');
    expect(api.correctNotaryEvidence).toHaveBeenCalledTimes(1);
    await wrapper
      .get('[data-test="retry-correction-refresh"]')
      .trigger('click');
    await flushPromises();
    expect(
      wrapper.find('[data-test="correction-refresh-error"]').exists(),
    ).toBe(false);
    expect(
      wrapper.get<HTMLTextAreaElement>(
        '[data-test="notary-record-corrections"] textarea',
      ).element.value,
    ).toBe('读取失败后保留');
    wrapper.unmount();
  });

  it('aborts a correction fact read when authorization context changes', async () => {
    const logistics = [
      {
        id: 'log-1',
        companyState: 'PRESENT' as const,
        companyValue: '顺丰',
        trackingState: 'PRESENT' as const,
        trackingValue: 'SF1',
      },
    ];
    const current = {
      ...matter,
      evidence: {
        evidenceAt: '2026-10-01',
        sampleFeeState: 'PENDING',
        sampleFeeAmount: null,
        recordedAt: '2026-10-02T00:00:00Z',
        recordedByUserId: 'operator-1',
        logistics,
      },
      recordEdits: {
        evidence: {
          canCorrect: true,
          revision: 0,
          original: { evidenceAt: '2026-10-01', logistics },
          effective: { evidenceAt: '2026-10-01', logistics },
          history: [],
        },
        openingSender: null,
      },
    } as NotaryMatterDetail;
    let resolveRefresh: (fresh: NotaryMatterDetail) => void = () => {};
    const refresh = new Promise<NotaryMatterDetail>((resolve) => {
      resolveRefresh = resolve;
    });
    api.getNotaryMatter
      .mockResolvedValueOnce(current)
      .mockReturnValueOnce(refresh)
      .mockResolvedValueOnce(current);
    api.correctNotaryEvidence.mockRejectedValueOnce(
      new ApiError('stale', 409, 'VERSION_CONFLICT'),
    );
    const wrapper = await mountPage();
    await wrapper
      .get('[data-test="notary-record-corrections"] textarea')
      .setValue('切换身份时取消读取');
    await wrapper.get('[data-test="correct-evidence"]').trigger('click');
    await flushPromises();
    const signal = api.getNotaryMatter.mock.calls[1]?.[1]
      ?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    useAuthStore().session = {
      ...useAuthStore().session!,
      authorizationRevision: 2,
    };
    await flushPromises();
    expect(signal.aborted).toBe(true);
    resolveRefresh(current);
    await flushPromises();
    wrapper.unmount();
  });

  it('keeps the saved frozen opening and its download visible while reviewing', async () => {
    api.getNotaryMatter.mockResolvedValue({
      ...matter,
      stage: 'UNBOX_REVIEW',
      capabilities: { reviewOpening: true },
      opening: {
        senderName: '寄件人甲',
        senderPhone: null,
        senderAddress: null,
        recordedAt: '2026-10-15T00:00:00Z',
        recordedByUserId: 'user-1',
        photos: [
          {
            materialId: 'photo-1',
            contentVersionId: 'photo-v1',
            originalFilename: '审核照片.jpg',
            mimeType: 'image/jpeg',
          },
        ],
      },
    });
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="opening-review-form"]').exists()).toBe(
      true,
    );
    expect(wrapper.get('[data-test="saved-opening"]').text()).toContain(
      '审核照片.jpg',
    );
    await wrapper
      .get('[data-test="download-opening-photo-photo-v1"]')
      .trigger('click');
    await flushPromises();
    expect(materials.downloadMaterialVersion).toHaveBeenCalledWith(
      'photo-1',
      'photo-v1',
      expect.any(AbortSignal),
    );
    wrapper.unmount();
  });
  it('scrolls and focuses a real form anchor without reloading the same matter', async () => {
    const wrapper = await mountPage();
    const target = wrapper.get('#evidence-form').element;
    const scroll = vi.fn();
    Object.defineProperty(target, 'scrollIntoView', {
      value: scroll,
      configurable: true,
    });
    const focus = vi.spyOn(target as HTMLElement, 'focus');
    await wrapper.vm.$router.push('/notary-matters/matter-1#evidence-form');
    await flushPromises();
    expect(scroll).toHaveBeenCalledWith({ block: 'start' });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(api.getNotaryMatter).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it.each(['route', 'identity', 'department', 'revision'])(
    'clears the previous source and rejects a late read after a %s change',
    async (change) => {
      let resolveFirst: ((value: unknown) => void) | undefined;
      api.getNotaryMatter.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      );
      const wrapper = await mountPage();
      const firstOptions = api.getNotaryMatter.mock.calls[0]?.[1] as {
        signal: AbortSignal;
      };
      api.getNotaryMatter.mockResolvedValueOnce({
        ...matter,
        id: change === 'route' ? 'matter-2' : matter.id,
        businessNo: 'NT-新上下文',
        sourceSummary: {
          ...sourceProjection.sourceSummary,
          shopName: '新上下文店铺',
        },
      });
      const auth = useAuthStore();
      if (change === 'route')
        await wrapper.vm.$router.push('/notary-matters/matter-2');
      else if (change === 'identity')
        auth.session = {
          ...auth.session!,
          user: { ...auth.session!.user, id: 'user-2' },
        };
      else if (change === 'department')
        auth.session = {
          ...auth.session!,
          department: { id: 'department-2', name: '另一部门' },
        };
      else auth.session = { ...auth.session!, authorizationRevision: 2 };
      await flushPromises();
      resolveFirst?.(matter);
      await flushPromises();
      expect(firstOptions.signal.aborted).toBe(true);
      expect(wrapper.text()).toContain('新上下文店铺');
      expect(wrapper.text()).not.toContain('来源店铺');
      expect(api.getNotaryMatter).toHaveBeenCalledTimes(2);
      wrapper.unmount();
    },
  );

  it('aborts exact-version downloads and discards their late errors on authorization revision change', async () => {
    let rejectDownload: ((error: Error) => void) | undefined;
    materials.downloadMaterialVersion.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectDownload = reject;
        }),
    );
    const wrapper = await mountPage();
    await wrapper
      .get('[data-test="download-matter-material-content-1"]')
      .trigger('click');
    const signal = materials.downloadMaterialVersion.mock
      .calls[0]?.[2] as AbortSignal;
    useAuthStore().session = {
      ...useAuthStore().session!,
      authorizationRevision: 2,
    };
    await flushPromises();
    rejectDownload?.(new Error('old-context failure'));
    await flushPromises();
    expect(signal.aborted).toBe(true);
    expect(wrapper.text()).not.toContain('附件下载失败');
    wrapper.unmount();
  });

  it('aborts a staged opening-material read and ignores old photos after switching matters', async () => {
    let resolveMaterials: ((value: unknown) => void) | undefined;
    api.getNotaryMatter.mockResolvedValueOnce({
      ...matter,
      stage: 'WAITING_UNBOX',
      capabilities: { recordEvidence: false, recordOpening: true },
    });
    materials.listOwnerMaterials.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMaterials = resolve;
        }),
    );
    const wrapper = await mountPage();
    const signal = materials.listOwnerMaterials.mock.calls[0]?.[2]
      ?.signal as AbortSignal;
    api.getNotaryMatter.mockResolvedValueOnce({
      ...matter,
      id: 'matter-2',
      businessNo: 'NT-新事项',
    });
    await wrapper.vm.$router.push('/notary-matters/matter-2');
    await flushPromises();
    resolveMaterials?.({
      items: [openingMaterial('old-photo', 'old-version', '旧事项照片.jpg')],
      total: 1,
    });
    await flushPromises();
    expect(signal.aborted).toBe(true);
    expect(wrapper.text()).not.toContain('旧事项照片.jpg');
    expect(wrapper.text()).toContain('NT-新事项');
    wrapper.unmount();
  });

  it('ignores a late successful issuance submission after navigation to another matter', async () => {
    let resolveSubmission: ((value: unknown) => void) | undefined;
    api.getNotaryMatter.mockResolvedValueOnce({
      ...matter,
      stage: 'ISSUANCE_DECISION',
      capabilities: {
        recordEvidence: false,
        recordOpening: false,
        decideIssuance: true,
      },
    });
    api.decideNotaryIssuance.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSubmission = resolve;
        }),
    );
    const wrapper = await mountPage();
    await wrapper.get('[data-test="issuance-decision-issue"]').setValue(true);
    await wrapper
      .get('[data-test="issuance-decision-section"] form')
      .trigger('submit');
    api.getNotaryMatter.mockResolvedValueOnce({
      ...matter,
      id: 'matter-2',
      businessNo: 'NT-新事项',
    });
    await wrapper.vm.$router.push('/notary-matters/matter-2');
    await flushPromises();
    resolveSubmission?.({});
    await flushPromises();
    expect(wrapper.text()).toContain('NT-新事项');
    expect(wrapper.text()).not.toContain('决定已保存');
    expect(api.getNotaryMatter).toHaveBeenCalledTimes(2);
    expect(api.decideNotaryIssuance.mock.calls[0]?.[0]).toBe('matter-1');
    expect(workflow.notify).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('shows exact source names, business dates and unrecorded fees without a case or certificate', async () => {
    const wrapper = await mountPage();
    const summary = wrapper.get('[data-test="notary-matter-detail"]');
    for (const value of [
      '来源客户',
      '来源权利主体',
      '来源店铺',
      '淘宝',
      'TB-001',
      '2026-09-24',
    ])
      expect(summary.text()).toContain(value);
    expect(
      wrapper
        .get('[data-test="notary-fee-summary"]')
        .findAll('dd')
        .map((cell) => cell.text()),
    ).toEqual(['未登记', '未登记', '未登记']);
    expect(wrapper.get('[data-test="notary-case-summary"]').text()).toContain(
      '暂无可见案件',
    );
    expect(wrapper.find('[data-test="linked-case"]').exists()).toBe(false);
    expect(
      wrapper.get('[data-test="notary-certificate-summary"]').text(),
    ).toContain('未登记公证书');
  });

  it.each([
    ['WAITING_COMPLAINT', '待写诉状'],
    ['ARCHIVED', '已归档'],
  ] as const)(
    'keeps fees and frozen files distinct for a linked %s case',
    async (stage, label) => {
      api.getNotaryMatter.mockResolvedValueOnce({
        ...matter,
        stage: 'ARCHIVED',
        capabilities: { recordEvidence: false, recordOpening: false },
        evidenceAt: '2026-09-25',
        fees: {
          notary: { state: 'KNOWN', amount: '0.00' },
          investigation: { state: 'PENDING', amount: null },
          sample: { state: 'KNOWN', amount: '12345678901234.56' },
        },
        certificateSummary: {
          id: 'certificate-1',
          certificateNo: '真实公证书001',
          certificateDate: '2026-09-26',
          issuedAt: '2026-09-26T01:00:00.000Z',
          needDisclose: true,
        },
        certificateFiles: [
          {
            materialId: 'certificate-material',
            contentVersionId: 'certificate-frozen',
            originalFilename: '真实公证书.pdf',
            mimeType: 'application/pdf',
            purpose: 'NOTARY_CERTIFICATE',
          },
          {
            materialId: 'disclosure-material',
            contentVersionId: 'disclosure-frozen',
            originalFilename: '披露.pdf',
            mimeType: 'application/pdf',
            purpose: 'NOTARY_DISCLOSURE',
          },
        ],
        linkedCase: {
          id: 'case-1',
          businessNo: 'CA-真实001',
          stage,
        },
      });
      const wrapper = await mountPage();
      expect(
        wrapper
          .get('[data-test="notary-fee-summary"]')
          .findAll('dd')
          .map((cell) => cell.text()),
      ).toEqual(['0.00 元', '待定', '12345678901234.56 元']);
      expect(
        wrapper.get('[data-test="notary-certificate-summary"]').text(),
      ).toContain('本事项已出证归档');
      expect(
        wrapper.get('[data-test="notary-certificate-summary"]').text(),
      ).toContain('披露材料：披露.pdf');
      expect(wrapper.get('[data-test="notary-case-summary"]').text()).toContain(
        '已流转诉讼 · ' + label,
      );
      expect(wrapper.get('[data-test="linked-case"]').attributes('href')).toBe(
        '/cases/case-1',
      );
      await wrapper
        .get('[data-test="download-certificate-certificate-frozen"]')
        .trigger('click');
      await wrapper
        .get('[data-test="download-certificate-disclosure-frozen"]')
        .trigger('click');
      await flushPromises();
      expect(materials.downloadMaterialVersion.mock.calls).toEqual([
        ['certificate-material', 'certificate-frozen', expect.any(AbortSignal)],
        ['disclosure-material', 'disclosure-frozen', expect.any(AbortSignal)],
      ]);
      expect(materials.listOwnerMaterials).not.toHaveBeenCalled();
    },
  );

  it('keeps certificate download failures visible', async () => {
    api.getNotaryMatter.mockResolvedValueOnce({
      ...matter,
      stage: 'ARCHIVED',
      certificateSummary: {
        id: 'certificate-1',
        certificateNo: '真实公证書001',
        certificateDate: '2026-09-26',
        issuedAt: '2026-09-26T01:00:00.000Z',
        needDisclose: false,
      },
      certificateFiles: [
        {
          materialId: 'material-1',
          contentVersionId: 'frozen-1',
          originalFilename: '公证书.pdf',
          mimeType: 'application/pdf',
          purpose: 'NOTARY_CERTIFICATE',
        },
      ],
    });
    materials.downloadMaterialVersion.mockRejectedValueOnce(
      new Error('forbidden'),
    );
    const wrapper = await mountPage();
    await wrapper
      .get('[data-test="download-certificate-frozen-1"]')
      .trigger('click');
    await flushPromises();
    expect(
      wrapper.get('[data-test="notary-certificate-summary"]').text(),
    ).toContain('附件下载失败');
  });

  it('does not show the return form when the server capability is false', async () => {
    api.getNotaryMatter.mockResolvedValueOnce({
      ...matter,
      stage: 'WAITING_RETURN',
      capabilities: {
        recordEvidence: false,
        recordOpening: false,
        reviewOpening: false,
        decideIssuance: false,
        archiveReturn: false,
      },
    });
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="return-archive-form"]').exists()).toBe(
      false,
    );
    expect(api.archiveNotaryReturn).not.toHaveBeenCalled();
  });

  it('does not open a draft photo read or form without the server opening capability', async () => {
    api.getNotaryMatter.mockResolvedValueOnce({
      ...matter,
      stage: 'WAITING_UNBOX',
      capabilities: { recordEvidence: false, recordOpening: false },
    });
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="opening-form"]').exists()).toBe(false);
    expect(materials.listOwnerMaterials).not.toHaveBeenCalled();
    expect(api.recordNotaryOpening).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('shows the server-authorized return archive form and reloads the saved record', async () => {
    const waitingReturn = {
      ...matter,
      stage: 'WAITING_RETURN',
      version: 5,
      capabilities: {
        recordEvidence: false,
        recordOpening: false,
        reviewOpening: false,
        decideIssuance: false,
        archiveReturn: true,
      },
      evidence: firstEvidence,
      opening: {
        senderName: null,
        senderPhone: null,
        senderAddress: null,
        recordedAt: '2026-09-24T02:00:00.000Z',
        recordedByUserId: 'user-1',
        photos: [],
      },
      reviewDecision: {
        result: 'INFRINGEMENT',
        reason: null,
        actorKind: 'CLIENT',
        actorDisplayName: '客户审核员',
        decidedAt: '2026-09-24T03:00:00.000Z',
        archivedAt: null,
      },
      issuanceDecision: {
        decision: 'NO_ISSUE',
        actorDisplayName: '运营甲',
        decidedAt: '2026-09-24T04:00:00.000Z',
      },
    };
    const archived = {
      ...waitingReturn,
      stage: 'ARCHIVED',
      version: 6,
      capabilities: { ...waitingReturn.capabilities, archiveReturn: false },
      returnArchive: {
        returnChoice: 'KEEP',
        archiveReason: '客户自行保留商品',
        archivedAt: '2026-09-29T03:00:00.000Z',
        actorDisplayName: '运营甲',
        refund: {
          state: 'PENDING',
          amount: null,
          partyKind: null,
          partyName: null,
        },
        freight: {
          state: 'PENDING',
          amount: null,
          partyKind: null,
          partyName: null,
        },
      },
    };
    api.getNotaryMatter
      .mockResolvedValueOnce(waitingReturn)
      .mockResolvedValueOnce(archived);
    api.archiveNotaryReturn
      .mockRejectedValueOnce(new ApiError('temporary', 500, 'NETWORK_ERROR'))
      .mockResolvedValueOnce({});
    const wrapper = await mountPage();
    expect(wrapper.get('[data-test="return-archive-form"]').text()).toContain(
      '提交后事项将不可逆地归档；本操作不会发起付款。',
    );
    expect(
      wrapper.find('[data-test="return-archive-refund-amount"]').exists(),
    ).toBe(false);
    await wrapper.get('[data-test="return-archive-return"]').setValue('RETURN');
    expect(wrapper.find('[data-test="return-refund-fields"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="return-freight-fields"]').exists()).toBe(
      true,
    );
    await wrapper
      .get('[data-test="return-archive-refund-only"]')
      .setValue('REFUND_ONLY');
    expect(wrapper.find('[data-test="return-refund-fields"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="return-freight-fields"]').exists()).toBe(
      false,
    );
    await wrapper.get('[data-test="return-archive-keep"]').setValue('KEEP');
    expect(wrapper.find('[data-test="return-refund-fields"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-test="return-freight-fields"]').exists()).toBe(
      false,
    );
    await wrapper
      .get('[data-test="return-archive-reason"]')
      .setValue('客户自行保留商品');
    await wrapper
      .get('[data-test="return-archive-form"] form')
      .trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('使用相同请求键重试');
    await wrapper.get('[data-test="notary-workflow-retry"]').trigger('click');
    await flushPromises();
    expect(api.archiveNotaryReturn).toHaveBeenCalledWith(
      'matter-1',
      {
        returnChoice: 'KEEP',
        archiveReason: '客户自行保留商品',
        expectedVersion: 5,
      },
      expect.any(String),
    );
    expect(api.archiveNotaryReturn.mock.calls[1]?.[2]).toBe(
      api.archiveNotaryReturn.mock.calls[0]?.[2],
    );
    expect(wrapper.get('[data-test="return-archive-record"]').text()).toContain(
      '待定',
    );
    expect(api.getNotaryMatter).toHaveBeenCalledTimes(2);
  });

  it('preserves 2501 emoji in the 5000-codepoint reason and rejects longer reasons explicitly', async () => {
    const waitingReturn = {
      ...matter,
      stage: 'WAITING_RETURN',
      version: 5,
      capabilities: {
        recordEvidence: false,
        recordOpening: false,
        reviewOpening: false,
        decideIssuance: false,
        archiveReturn: true,
      },
      evidence: firstEvidence,
      opening: {
        senderName: null,
        senderPhone: null,
        senderAddress: null,
        recordedAt: '2026-09-24T02:00:00.000Z',
        recordedByUserId: 'user-1',
        photos: [],
      },
      reviewDecision: {
        result: 'INFRINGEMENT',
        reason: null,
        actorKind: 'CLIENT',
        actorDisplayName: '客户审核员',
        decidedAt: '2026-09-24T03:00:00.000Z',
        archivedAt: null,
      },
      issuanceDecision: {
        decision: 'NO_ISSUE',
        actorDisplayName: '运营甲',
        decidedAt: '2026-09-24T04:00:00.000Z',
      },
    };
    const archived = {
      ...waitingReturn,
      stage: 'ARCHIVED',
      version: 6,
      capabilities: { ...waitingReturn.capabilities, archiveReturn: false },
      returnArchive: {
        returnChoice: 'KEEP',
        archiveReason: '😀'.repeat(2501),
        archivedAt: '2026-09-29T03:00:00.000Z',
        actorDisplayName: '运营甲',
        refund: null,
        freight: null,
      },
    };
    api.getNotaryMatter
      .mockResolvedValueOnce(waitingReturn)
      .mockResolvedValueOnce(archived)
      .mockResolvedValueOnce(waitingReturn);
    api.archiveNotaryReturn.mockResolvedValue({});
    api.correctNotaryEvidence.mockResolvedValue({});
    api.correctNotaryOpeningSender.mockResolvedValue({});

    const wrapper = await mountPage();
    const reason = '😀'.repeat(2501);
    const textarea = wrapper.get('[data-test="return-archive-reason"]');
    expect(textarea.attributes('maxlength')).toBeUndefined();
    await wrapper.get('[data-test="return-archive-keep"]').setValue('KEEP');
    await textarea.setValue(reason);
    await wrapper
      .get('[data-test="return-archive-form"] form')
      .trigger('submit');
    await flushPromises();

    expect(api.archiveNotaryReturn).toHaveBeenCalledWith(
      'matter-1',
      { returnChoice: 'KEEP', archiveReason: reason, expectedVersion: 5 },
      expect.any(String),
    );

    const tooLongReason = '😀'.repeat(5001);
    const tooLongPage = await mountPage();
    await tooLongPage.get('[data-test="return-archive-keep"]').setValue('KEEP');
    await tooLongPage
      .get('[data-test="return-archive-reason"]')
      .setValue(tooLongReason);
    await tooLongPage
      .get('[data-test="return-archive-form"] form')
      .trigger('submit');
    await flushPromises();
    expect(tooLongPage.get('[data-test="return-archive-error"]').text()).toBe(
      '归档原因不能超过 5000 字',
    );
    expect(api.archiveNotaryReturn).toHaveBeenCalledTimes(1);
  });

  it('offers explicit issuance choices only when permitted and displays the persisted result', async () => {
    const pending = {
      ...matter,
      stage: 'ISSUANCE_DECISION',
      version: 5,
      capabilities: {
        recordEvidence: false,
        recordOpening: false,
        reviewOpening: false,
        decideIssuance: true,
      },
      evidence: firstEvidence,
      opening: {
        senderName: null,
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
      reviewDecision: {
        result: 'INFRINGEMENT',
        reason: null,
        actorKind: 'CLIENT',
        actorDisplayName: '客户审核员',
        decidedAt: '2026-09-24T03:00:00.000Z',
        archivedAt: null,
      },
      issuanceDecision: null,
    };
    const saved = {
      ...pending,
      stage: 'WAITING_CERTIFICATE',
      version: 6,
      capabilities: { ...pending.capabilities, decideIssuance: false },
      issuanceDecision: {
        decision: 'ISSUE',
        actorDisplayName: '运营甲',
        decidedAt: '2026-09-24T04:00:00.000Z',
      },
    };
    api.getNotaryMatter
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(saved);
    api.decideNotaryIssuance.mockResolvedValue({});
    const wrapper = await mountPage();
    expect(
      wrapper.get('[data-test="issuance-decision-section"]').text(),
    ).toContain('出证 → 待出证');
    expect(
      wrapper.get('[data-test="issuance-decision-section"]').text(),
    ).toContain('不出证 → 待退货');
    await wrapper.get('[data-test="issuance-decision-issue"]').setValue();
    await wrapper
      .get('[data-test="issuance-decision-section"] form')
      .trigger('submit');
    await flushPromises();
    expect(api.decideNotaryIssuance).toHaveBeenCalledWith(
      'matter-1',
      { decision: 'ISSUE', expectedVersion: 5 },
      expect.any(String),
    );
    expect(
      wrapper.get('[data-test="issuance-decision-record"]').text(),
    ).toContain('运营甲');
    expect(
      wrapper.get('[data-test="issuance-decision-record"]').text(),
    ).toContain('待出证');
    expect(
      wrapper.get('[data-test="issuance-decision-record"]').text(),
    ).toContain('同意出证');
    expect(
      wrapper.get('[data-test="issuance-decision-record"]').text(),
    ).not.toContain('ISSUE');
  });

  it('offers no default opening result and requires a reason for no infringement', async () => {
    api.getNotaryMatter.mockResolvedValue({
      ...matter,
      stage: 'UNBOX_REVIEW',
      version: 4,
      capabilities: {
        recordEvidence: false,
        recordOpening: false,
        reviewOpening: true,
      },
      evidence: firstEvidence,
      opening: {
        senderName: null,
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
      reviewDecision: null,
    });
    const wrapper = await mountPage();
    expect(
      wrapper.findAll('[data-test^="opening-review-result"]:checked'),
    ).toHaveLength(0);
    expect(wrapper.get('[data-test="opening-review-form"]').text()).toContain(
      '侵权后进入开箱待确认，由运营决定是否出证',
    );
    expect(wrapper.get('[data-test="opening-review-form"]').text()).toContain(
      '不侵权将立即归档，普通入口不能撤回',
    );
    await wrapper
      .get('[data-test="opening-review-result-no-infringement"]')
      .setValue(true);
    await wrapper.get('[data-test="opening-review-form"]').trigger('submit');
    expect(
      wrapper.get('[data-test="opening-review-reason-error"]').text(),
    ).toContain('请填写不侵权原因');
    expect(api.reviewNotaryOpening).not.toHaveBeenCalled();
  });

  it('locks an uncertain submission key and reloads the persisted decision after success', async () => {
    const pending = {
      ...matter,
      stage: 'UNBOX_REVIEW',
      version: 4,
      capabilities: {
        recordEvidence: false,
        recordOpening: false,
        reviewOpening: true,
      },
      evidence: firstEvidence,
      opening: {
        senderName: null,
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
      reviewDecision: null,
    };
    const saved = {
      ...pending,
      stage: 'ARCHIVED',
      version: 5,
      capabilities: { ...pending.capabilities, reviewOpening: false },
      reviewDecision: {
        result: 'NO_INFRINGEMENT',
        reason: '经核对未发现侵权',
        actorKind: 'INTERNAL',
        actorDisplayName: '运营甲',
        decidedAt: '2026-09-24T03:00:00.000Z',
        archivedAt: '2026-09-24T03:00:00.000Z',
      },
    };
    api.getNotaryMatter
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(saved);
    let resolveReview!: (value: unknown) => void;
    api.reviewNotaryOpening.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveReview = resolve;
      }),
    );
    const wrapper = await mountPage();
    await wrapper
      .get('[data-test="opening-review-result-no-infringement"]')
      .setValue(true);
    await wrapper
      .get('[data-test="opening-review-reason"]')
      .setValue('经核对未发现侵权');
    await wrapper.get('[data-test="opening-review-form"]').trigger('submit');
    expect(
      wrapper.get('[data-test="opening-review-submit"]').attributes('disabled'),
    ).toBeDefined();
    resolveReview({});
    await flushPromises();
    expect(api.reviewNotaryOpening).toHaveBeenCalledWith(
      'matter-1',
      {
        result: 'NO_INFRINGEMENT',
        reason: '经核对未发现侵权',
        expectedVersion: 4,
      },
      expect.any(String),
    );
    expect(api.getNotaryMatter).toHaveBeenCalledTimes(2);
    expect(wrapper.get('[data-test="opening-review-record"]').text()).toContain(
      '经核对未发现侵权',
    );
  });

  it('keeps the opening decision read only without review capability', async () => {
    api.getNotaryMatter.mockResolvedValue({
      ...matter,
      stage: 'ISSUANCE_DECISION',
      capabilities: {
        recordEvidence: false,
        recordOpening: false,
        reviewOpening: false,
      },
      evidence: firstEvidence,
      opening: {
        senderName: null,
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
      reviewDecision: {
        result: 'INFRINGEMENT',
        reason: null,
        actorKind: 'CLIENT',
        actorDisplayName: '客户审核员',
        decidedAt: '2026-09-24T03:00:00.000Z',
        archivedAt: null,
      },
    });
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="opening-review-form"]').exists()).toBe(
      false,
    );
    expect(wrapper.get('[data-test="opening-review-record"]').text()).toContain(
      '客户审核员',
    );
    await wrapper
      .get('[data-test="download-opening-photo-photo-v1"]')
      .trigger('click');
    expect(materials.downloadMaterialVersion).toHaveBeenCalledWith(
      'photo-1',
      'photo-v1',
      expect.any(AbortSignal),
    );
  });

  it('reuses the same idempotency key after a network-uncertain retry', async () => {
    const pending = {
      ...matter,
      stage: 'UNBOX_REVIEW',
      version: 4,
      capabilities: {
        recordEvidence: false,
        recordOpening: false,
        reviewOpening: true,
      },
      evidence: firstEvidence,
      opening: {
        senderName: null,
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
      reviewDecision: null,
    };
    const saved = {
      ...pending,
      stage: 'ISSUANCE_DECISION',
      version: 5,
      capabilities: { ...pending.capabilities, reviewOpening: false },
      reviewDecision: {
        result: 'INFRINGEMENT',
        reason: null,
        actorKind: 'INTERNAL',
        actorDisplayName: '运营甲',
        decidedAt: '2026-09-24T03:00:00.000Z',
        archivedAt: null,
      },
    };
    api.getNotaryMatter
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(saved);
    api.reviewNotaryOpening
      .mockRejectedValueOnce(new ApiError('offline', 0, 'NETWORK_ERROR'))
      .mockResolvedValueOnce({});
    const wrapper = await mountPage();
    await wrapper.get('[data-test="opening-review-result"]').setValue(true);
    await wrapper.get('[data-test="opening-review-form"]').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('提交结果暂时未知');
    expect(
      wrapper.get('[data-test="opening-review-result"]').attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.get('[data-test="notary-workflow-retry"]').attributes('disabled'),
    ).toBeUndefined();
    expect(wrapper.get('[data-test="notary-workflow-retry"]').text()).toContain(
      '使用相同请求键重试',
    );
    expect(
      wrapper.findAll('[data-test^="opening-review-result"]:checked'),
    ).toHaveLength(1);
    await wrapper.get('[data-test="notary-workflow-retry"]').trigger('click');
    await flushPromises();
    expect(api.reviewNotaryOpening.mock.calls[1]?.[2]).toBe(
      api.reviewNotaryOpening.mock.calls[0]?.[2],
    );
    expect(wrapper.get('[data-test="opening-review-record"]').text()).toContain(
      '确认侵权',
    );
  });

  it.each([
    ['VERSION_CONFLICT', '事项状态或版本已变化'],
    ['INVALID_STATE', '事项状态或版本已变化'],
    ['IDEMPOTENCY_CONFLICT', '审核请求与已提交内容冲突'],
    ['ACTION_FORBIDDEN', '当前账号无权审核此事项'],
    ['RESOURCE_NOT_FOUND', '事项不存在或当前不可访问'],
    ['TIMEOUT', '提交结果暂时未知'],
  ])(
    'maps opening review error %s to stable feedback',
    async (code, message) => {
      const pending = {
        ...matter,
        stage: 'UNBOX_REVIEW',
        version: 4,
        capabilities: {
          recordEvidence: false,
          recordOpening: false,
          reviewOpening: true,
        },
        evidence: firstEvidence,
        opening: {
          senderName: null,
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
        reviewDecision: null,
      };
      api.getNotaryMatter.mockResolvedValue(pending);
      api.reviewNotaryOpening.mockRejectedValue(
        new ApiError(
          'raw',
          code === 'TIMEOUT'
            ? 0
            : code === 'ACTION_FORBIDDEN'
              ? 403
              : code === 'RESOURCE_NOT_FOUND'
                ? 404
                : 409,
          code,
        ),
      );
      const wrapper = await mountPage();
      await wrapper.get('[data-test="opening-review-result"]').setValue(true);
      await wrapper.get('[data-test="opening-review-form"]').trigger('submit');
      await flushPromises();
      expect(wrapper.text()).toContain(message);
    },
  );

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
      expect.any(AbortSignal),
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
    expect(wrapper.get('[data-test="saved-evidence"] li').text()).toBe(
      '快递公司：顺丰；快递单号：无',
    );
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

  it('locks unknown evidence and retries only its original key and payload', async () => {
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
    expect(api.recordNotaryEvidence).toHaveBeenCalledTimes(1);
    await wrapper.get('[data-test="evidence-date"]').setValue('2026-09-25');
    await wrapper.get('[data-test="notary-workflow-retry"]').trigger('click');
    await flushPromises();
    const calls = api.recordNotaryEvidence.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[1]?.[1].evidenceAt).toBe('2026-09-24');
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
    materials.listOwnerMaterials.mockResolvedValueOnce({
      items: [openingMaterial('photo-1', 'photo-v1', '开箱.jpg')],
      total: 1,
    });
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
      category: 'NOTARY_OPENING_PHOTO',
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
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
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
      expect.any(AbortSignal),
    );
  });

  it('deletes an uploaded mistake before selecting a replacement and submits only the retained version', async () => {
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
    const first = openingMaterial('photo-1', 'photo-v1', '误传.jpg');
    const second = openingMaterial('photo-2', 'photo-v2', '正确.jpg');
    materials.listOwnerMaterials.mockResolvedValueOnce({ items: [], total: 0 });
    materials.uploadMaterialFile
      .mockResolvedValueOnce(
        uploadedOpeningPhoto('photo-1', 'photo-v1', '误传.jpg'),
      )
      .mockResolvedValueOnce(
        uploadedOpeningPhoto('photo-2', 'photo-v2', '正确.jpg'),
      );
    materials.listOwnerMaterials
      .mockResolvedValueOnce({ items: [first], total: 1 })
      .mockResolvedValueOnce({ items: [second], total: 1 });
    const wrapper = await mountPage();
    await selectOpeningFile(wrapper, '误传.jpg');
    expect(
      wrapper.get('[data-test="opening-staged-row-photo-v1"]').text(),
    ).toContain('误传.jpg');
    await wrapper
      .get('[data-test="delete-opening-photo-photo-1"]')
      .trigger('click');
    await flushPromises();
    expect(materials.deleteMaterial).toHaveBeenCalledWith('photo-1', 4);
    expect(
      wrapper.find('[data-test="opening-staged-row-photo-v1"]').exists(),
    ).toBe(false);

    await selectOpeningFile(wrapper, '正确.jpg');
    api.getNotaryMatter.mockResolvedValueOnce({
      ...matter,
      stage: 'UNBOX_REVIEW',
      version: 4,
      capabilities: { recordEvidence: false, recordOpening: false },
      evidence: firstEvidence,
      opening: {
        senderName: null,
        senderPhone: null,
        senderAddress: null,
        recordedAt: '2026-09-24T02:00:00.000Z',
        recordedByUserId: 'user-1',
        photos: [{ ...second.contentVersions[0], materialId: 'photo-2' }],
      },
    });
    await wrapper.get('[data-test="record-opening"]').trigger('submit');
    await flushPromises();
    expect(
      api.recordNotaryOpening.mock.calls[0]?.[1].contentVersionIds,
    ).toEqual(['photo-v2']);
  });

  it('restores active photos on refresh without selecting them and permits deletion and a new upload', async () => {
    api.getNotaryMatter.mockResolvedValueOnce({
      ...matter,
      stage: 'WAITING_UNBOX',
      capabilities: { recordEvidence: false, recordOpening: true },
      evidence: firstEvidence,
    });
    const restored = openingMaterial(
      'restored-1',
      'restored-v1',
      '刷新恢复.jpg',
    );
    materials.listOwnerMaterials.mockResolvedValueOnce({
      items: [restored],
      total: 1,
    });
    const wrapper = await mountPage();
    expect(
      wrapper.get('[data-test="opening-staged-row-restored-v1"]').text(),
    ).toContain('刷新恢复.jpg');
    expect(
      (
        wrapper.get('[data-test="select-opening-photo-restored-v1"]')
          .element as HTMLInputElement
      ).checked,
    ).toBe(false);
    api.getNotaryMatter.mockResolvedValueOnce({
      ...matter,
      stage: 'WAITING_UNBOX',
      capabilities: { recordEvidence: false, recordOpening: true },
      evidence: firstEvidence,
    });
    materials.listOwnerMaterials.mockResolvedValueOnce({
      items: [restored],
      total: 1,
    });
    await wrapper.get('[data-test="refresh-matter"]').trigger('click');
    await flushPromises();
    expect(
      wrapper.find('[data-test="opening-staged-row-restored-v1"]').exists(),
    ).toBe(true);
    expect(
      (
        wrapper.get('[data-test="select-opening-photo-restored-v1"]')
          .element as HTMLInputElement
      ).checked,
    ).toBe(false);
    await wrapper
      .get('[data-test="delete-opening-photo-restored-1"]')
      .trigger('click');
    await flushPromises();
    expect(materials.deleteMaterial).toHaveBeenCalledWith('restored-1', 4);
    expect(
      wrapper.find('[data-test="opening-staged-row-restored-v1"]').exists(),
    ).toBe(false);
    materials.uploadMaterialFile.mockResolvedValueOnce(
      uploadedOpeningPhoto('new-1', 'new-v1', '补传.jpg'),
    );
    materials.listOwnerMaterials.mockResolvedValueOnce({
      items: [openingMaterial('new-1', 'new-v1', '补传.jpg')],
      total: 1,
    });
    await selectOpeningFile(wrapper, '补传.jpg');
    expect(
      wrapper.get('[data-test="opening-staged-row-new-v1"]').text(),
    ).toContain('补传.jpg');
  });

  it('keeps a failed-delete row and disables delete, selection and upload while deletion is pending', async () => {
    api.getNotaryMatter.mockResolvedValueOnce({
      ...matter,
      stage: 'WAITING_UNBOX',
      capabilities: { recordEvidence: false, recordOpening: true },
      evidence: firstEvidence,
    });
    materials.listOwnerMaterials.mockResolvedValueOnce({
      items: [openingMaterial('photo-1', 'photo-v1', '待删.jpg')],
      total: 1,
    });
    let rejectDelete: ((error: Error) => void) | undefined;
    materials.deleteMaterial.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectDelete = reject;
      }),
    );
    const wrapper = await mountPage();
    await wrapper
      .get('[data-test="delete-opening-photo-photo-1"]')
      .trigger('click');
    expect(
      wrapper
        .get('[data-test="delete-opening-photo-photo-1"]')
        .attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper
        .get('[data-test="select-opening-photo-photo-v1"]')
        .attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.get('[data-test="opening-photo-files"]').attributes('disabled'),
    ).toBeDefined();
    rejectDelete?.(new Error('delete rejected'));
    await flushPromises();
    expect(
      wrapper.find('[data-test="opening-staged-row-photo-v1"]').exists(),
    ).toBe(true);
    expect(
      wrapper.get('[data-test="opening-delete-error-photo-1"]').text(),
    ).toContain('删除失败');
  });

  it('allows an unuploaded failed row to be removed locally', async () => {
    api.getNotaryMatter.mockResolvedValueOnce({
      ...matter,
      stage: 'WAITING_UNBOX',
      capabilities: { recordEvidence: false, recordOpening: true },
      evidence: firstEvidence,
    });
    materials.uploadMaterialFile.mockRejectedValueOnce(
      new Error('upload failed'),
    );
    const wrapper = await mountPage();
    await selectOpeningFile(wrapper, '失败照片.jpg');
    const removeButton = wrapper.find(
      '[data-test^="remove-local-opening-photo-"]',
    );
    expect(removeButton.exists()).toBe(true);
    await removeButton.trigger('click');
    expect(
      wrapper.get('[data-test="opening-staged-materials"]').text(),
    ).toContain('暂无待提交开箱照片');
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
    materials.listOwnerMaterials.mockResolvedValueOnce({
      items: [openingMaterial('photo-1', 'photo-v1', '开箱.jpg')],
      total: 1,
    });
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
    await wrapper.get('[data-test="notary-workflow-retry"]').trigger('click');
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
