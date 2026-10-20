import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from '../../stores/auth';
import { ApiError } from '../../api/http';
import NotaryMatterListPage from './NotaryMatterListPage.vue';
import type { NotaryMatterListItem } from '../../api/notary';
import {
  defaultNotaryListPreference,
  type NotaryListPreference,
} from '../../api/notary-list-preference';

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
  fees: {
    notary: { state: 'UNRECORDED', amount: null },
    investigation: { state: 'UNRECORDED', amount: null },
    sample: { state: 'UNRECORDED', amount: null },
  },
  capabilities: {
    recordEvidence: false,
    recordOpening: false,
    reviewOpening: false,
    decideIssuance: false,
    archiveReturn: false,
  },
} satisfies Pick<
  NotaryMatterListItem,
  | 'sourceSummary'
  | 'transferredAt'
  | 'evidenceAt'
  | 'openingSummary'
  | 'certificateSummary'
  | 'linkedCase'
  | 'fees'
  | 'capabilities'
>;

const businessHeaders = [
  '权利主体',
  '平台',
  '店铺名',
  '店铺ID',
  '推送日期',
  '取证日期',
  '开箱照片',
  '公证书编号',
  '发货人',
  '发货电话',
  '发货地址',
  '公证费',
  '调查费',
  '样品费',
];
const defaultHeaders = ['选择', '操作', '案件进展', ...businessHeaders];
function preferenceWithLegacyOrder(
  order: Array<
    'businessNo' | 'stage' | 'sourceLead' | 'notaryOffice' | 'createdAt'
  >,
  hidden: NotaryListPreference['hidden'] = [],
): NotaryListPreference {
  return {
    order: [
      'businessNo',
      'stage',
      ...defaultNotaryListPreference.order.filter(
        (column) =>
          ![
            'businessNo',
            'stage',
            'sourceLead',
            'notaryOffice',
            'createdAt',
          ].includes(column),
      ),
      ...order.slice(2),
    ],
    hidden,
  };
}

const api = vi.hoisted(() => ({
  listNotaryMatters: vi.fn(),
  getNotaryMatter: vi.fn(),
  decideNotaryIssuance: vi.fn(),
}));
const batchApi = vi.hoisted(() => ({ archive: vi.fn() }));
const workflow = vi.hoisted(() => ({ notify: vi.fn() }));
const exportApi = vi.hoisted(() => ({ preview: vi.fn(), download: vi.fn() }));
const preferenceApi = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock('../../api/notary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/notary')>()),
  listNotaryMatters: api.listNotaryMatters,
  getNotaryMatter: api.getNotaryMatter,
  decideNotaryIssuance: api.decideNotaryIssuance,
}));
vi.mock('../../api/notary-return-archive-batch', () => ({
  archiveNotaryReturnBatch: batchApi.archive,
}));
vi.mock('../../app/workflow-events', () => ({
  notifyWorkflowChanged: workflow.notify,
}));
vi.mock('../../api/notary-list-preference', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../api/notary-list-preference')
  >()),
  getNotaryListPreference: preferenceApi.get,
  saveNotaryListPreference: preferenceApi.save,
}));
vi.mock('../../api/notary-list-export', () => ({
  previewNotaryListExport: exportApi.preview,
  exportNotaryList: exportApi.download,
}));

const result = {
  items: [
    {
      ...sourceProjection,
      id: 'matter-1',
      businessNo: 'NT-001',
      stage: 'PENDING_EVIDENCE',
      createdAt: '2026-09-24T01:00:00.000Z',
      sourceLead: { id: 'lead-1', businessNo: 'LD-001' },
      notaryOffice: { id: 'office-1', name: '测试公证处' },
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
  counts: {
    PENDING_EVIDENCE: 1,
    WAITING_UNBOX: 0,
    UNBOX_REVIEW: 0,
    ISSUANCE_DECISION: 0,
    ARCHIVED: 0,
  },
};

async function mountPage(path: string) {
  setActivePinia(createPinia());
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
  auth.restored = true;
  if (!preferenceApi.get.getMockImplementation())
    preferenceApi.get.mockResolvedValue(defaultNotaryListPreference);
  preferenceApi.save.mockImplementation((preference) =>
    Promise.resolve(preference),
  );
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/notary-matters', component: NotaryMatterListPage },
      { path: '/notary-matters/:id', component: { template: '<div />' } },
      { path: '/leads/:id', component: { template: '<div />' } },
      { path: '/cases/:id', component: { template: '<div />' } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(NotaryMatterListPage, {
    global: {
      plugins: [router],
      stubs: {
        ElDrawer: {
          props: ['modelValue'],
          template:
            '<section v-if="modelValue"><slot/><slot name="footer"/></section>',
        },
        NotaryBatchOpeningPanel: {
          props: ['matterIds'],
          emits: ['close'],
          setup: () => ({ canLeave: () => true }),
          template:
            '<section data-test="batch-opening-panel">{{ matterIds.join(",") }}<button data-test="batch-opening-close" @click="$emit(\'close\', [\'matter-1\'])" /></section>',
        },
      },
    },
  });
  await flushPromises();
  return { wrapper, router, auth };
}

afterEach(() => vi.resetAllMocks());

describe('NotaryMatterListPage', () => {
  it('clicks a real list action, chooses a destination and refreshes the same page/query once', async () => {
    const item = {
      ...result.items[0],
      stage: 'ISSUANCE_DECISION',
      capabilities: { ...sourceProjection.capabilities, decideIssuance: true },
    };
    api.listNotaryMatters.mockResolvedValue({
      ...result,
      items: [item],
      total: 23,
      page: 2,
    });
    api.getNotaryMatter.mockResolvedValue({
      ...item,
      version: 5,
      certificateFiles: [],
      evidence: null,
      opening: null,
      reviewDecision: null,
      issuanceDecision: null,
      returnArchive: null,
      selectedProducts: [],
      selectedMaterials: [],
    });
    api.decideNotaryIssuance.mockResolvedValue({});
    const { wrapper, router } = await mountPage(
      '/notary-matters?stage=ISSUANCE_DECISION&page=2',
    );
    await wrapper.get('[data-test="matter-action"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/notary-matters');
    expect(api.getNotaryMatter).toHaveBeenCalledWith(
      'matter-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(
      wrapper.findAll('input[name="issuance-decision"]:checked'),
    ).toHaveLength(0);
    await wrapper.get('[data-test="issuance-decision-no-issue"]').setValue();
    await wrapper
      .get('[data-test="issuance-decision-section"] form')
      .trigger('submit');
    await flushPromises();
    expect(api.decideNotaryIssuance).toHaveBeenCalledWith(
      'matter-1',
      { decision: 'NO_ISSUE', expectedVersion: 5 },
      expect.any(String),
    );
    expect(api.listNotaryMatters).toHaveBeenCalledTimes(2);
    expect(api.listNotaryMatters.mock.calls[1]?.[0]).toBe(2);
    expect(router.currentRoute.value.query).toEqual({
      stage: 'ISSUANCE_DECISION',
      page: '2',
    });
    wrapper.unmount();
  });
  it('aborts old list and preference reads after an authorization revision change', async () => {
    let resolveList: ((value: unknown) => void) | undefined;
    let resolvePreference: ((value: unknown) => void) | undefined;
    api.listNotaryMatters
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveList = resolve;
          }),
      )
      .mockResolvedValueOnce({ ...result, items: [], total: 0 });
    preferenceApi.get
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePreference = resolve;
          }),
      )
      .mockResolvedValueOnce(defaultNotaryListPreference);
    const { wrapper, auth } = await mountPage('/notary-matters');
    const listSignal = api.listNotaryMatters.mock.calls[0]?.[2]
      ?.signal as AbortSignal;
    const preferenceSignal = preferenceApi.get.mock.calls[0]?.[0]
      ?.signal as AbortSignal;
    auth.session = { ...auth.session!, authorizationRevision: 2 };
    await flushPromises();
    resolveList?.(result);
    resolvePreference?.(
      preferenceWithLegacyOrder([
        'businessNo',
        'stage',
        'sourceLead',
        'notaryOffice',
        'createdAt',
      ]),
    );
    await flushPromises();
    expect(listSignal.aborted).toBe(true);
    expect(preferenceSignal.aborted).toBe(true);
    expect(wrapper.find('[data-test="matter-row"]').exists()).toBe(false);
    expect(api.listNotaryMatters).toHaveBeenCalledTimes(2);
    expect(preferenceApi.get).toHaveBeenCalledTimes(2);
    expect(preferenceApi.save).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('renders the seventeen Demo columns from the exact source and preserves business dates', async () => {
    api.listNotaryMatters.mockResolvedValue({
      ...result,
      items: [
        {
          ...result.items[0],
          createdAt: '2026-09-24T18:00:00.000Z',
          transferredAt: '2026-09-25',
          evidenceAt: '2026-09-26',
        },
      ],
    });
    const { wrapper } = await mountPage('/notary-matters');
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual(
      defaultHeaders,
    );
    const row = wrapper.get('[data-test="matter-row"]');
    expect(row.get('[data-column="rightsHolder"]').text()).toContain(
      '来源权利主体',
    );
    expect(row.get('[data-column="platform"]').text()).toBe('淘宝');
    expect(row.get('[data-column="shopExternalId"]').text()).toBe('TB-001');
    expect(row.get('[data-column="transferredAt"]').text()).toBe('2026-09-25');
    expect(row.get('[data-column="evidenceAt"]').text()).toBe('2026-09-26');
    expect(row.get('.notary-business-no').text()).toBe('NT-001');
    expect(wrapper.findAll('colgroup col')).toHaveLength(17);
    expect(wrapper.get('.business-list-scroll').attributes('tabindex')).toBe(
      '0',
    );
    expect(row.get('summary').attributes('aria-label')).toContain(
      '来源权利主体',
    );
  });

  it.each([
    [{ state: 'UNRECORDED', amount: null }, '未登记'],
    [{ state: 'PENDING', amount: null }, '待定'],
    [{ state: 'KNOWN', amount: '0.00' }, '¥ 0.00'],
    [{ state: 'KNOWN', amount: '99999999999999.99' }, '¥ 99999999999999.99'],
  ])('keeps the fee fact %j distinct', async (fee, label) => {
    api.listNotaryMatters.mockResolvedValue({
      ...result,
      items: [
        {
          ...result.items[0],
          fees: { notary: fee, investigation: fee, sample: fee },
        },
      ],
    });
    const { wrapper } = await mountPage('/notary-matters');
    const row = wrapper.get('[data-test="matter-row"]');
    for (const column of ['notaryFee', 'investigationFee', 'sampleFee'])
      expect(row.get(`[data-column="${column}"]`).text()).toBe(label);
  });

  it.each([
    ['PENDING_MATCH', '待匹配'],
    ['ARCHIVED', '已归档'],
  ] as const)(
    'links only a real frozen opening count and authorized %s case',
    async (stage, label) => {
      api.listNotaryMatters.mockResolvedValue({
        ...result,
        items: [
          {
            ...result.items[0],
            openingSummary: {
              photoCount: 3,
              senderName: '真实寄件人',
              senderPhone: '13800000000',
              senderAddress: '来源登记地址',
            },
            certificateSummary: {
              id: 'certificate-1',
              certificateNo: '（2026）真实公证字第001号',
              certificateDate: '2026-09-27',
              issuedAt: '2026-09-27T01:00:00.000Z',
              needDisclose: false,
            },
            linkedCase: {
              id: 'case-1',
              businessNo: 'CA-001',
              stage,
            },
          },
        ],
      });
      const { wrapper } = await mountPage('/notary-matters');
      expect(
        wrapper.get('[data-test="opening-photos-link"]').attributes('href'),
      ).toBe('/notary-matters/matter-1#saved-opening');
      expect(wrapper.get('[data-test="opening-photos-link"]').text()).toBe(
        '3 张 · 查看',
      );
      expect(wrapper.text()).not.toContain('OCR');
      expect(wrapper.get('[data-test="linked-case"]').attributes('href')).toBe(
        '/cases/case-1',
      );
      expect(wrapper.get('[data-test="linked-case"]').text()).toContain(
        '已流转诉讼 · ' + label,
      );
      expect(wrapper.get('tbody [data-column="certificateNo"]').text()).toBe(
        '（2026）真实公证字第001号',
      );
    },
  );

  it('shows no photo or case link and no invented certificate action without a fact or capability', async () => {
    api.listNotaryMatters.mockResolvedValue({
      ...result,
      items: [
        {
          ...result.items[0],
          stage: 'WAITING_CERTIFICATE',
          capabilities: {
            recordEvidence: false,
            recordOpening: false,
            reviewOpening: false,
            decideIssuance: false,
            archiveReturn: false,
          },
        },
      ],
    });
    const { wrapper } = await mountPage('/notary-matters');
    expect(wrapper.find('[data-test="opening-photos-link"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-test="linked-case"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="matter-action"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('暂无可见案件');
    expect(wrapper.text()).not.toContain('填写出证');
  });

  it.each([
    ['recordEvidence', 'evidence-form', '登记取证'],
    ['recordOpening', 'opening-form', '登记开箱'],
    ['reviewOpening', 'review-form', '审核开箱'],
    ['decideIssuance', 'issuance-form', '决定是否出证'],
    ['archiveReturn', 'return-archive-form', '办理退货归档'],
  ])(
    'names the server-authorized %s next step as an in-place button',
    async (capability, _anchor, label) => {
      const capabilities = {
        recordEvidence: false,
        recordOpening: false,
        reviewOpening: false,
        decideIssuance: false,
        archiveReturn: false,
        [capability]: true,
      };
      api.listNotaryMatters.mockResolvedValue({
        ...result,
        items: [{ ...result.items[0], capabilities }],
      });
      const { wrapper } = await mountPage('/notary-matters');
      expect(wrapper.findAll('[data-test="matter-action"]')).toHaveLength(1);
      expect(
        wrapper.get('[data-test="matter-action"]').attributes('href'),
      ).toBeUndefined();
      expect(wrapper.get('[data-test="matter-action"]').text()).toBe(label);
    },
  );

  it('keeps the transfer hint when no stage is selected', async () => {
    api.listNotaryMatters.mockResolvedValue({ ...result, items: [], total: 0 });
    const { wrapper } = await mountPage('/notary-matters');
    expect(wrapper.text()).toContain('当前没有公证事项');
    expect(wrapper.text()).toContain('线索确认取证并移交后');
  });

  it('explains the selected empty stage without repeating the transfer hint', async () => {
    api.listNotaryMatters.mockResolvedValue({ ...result, items: [], total: 0 });
    const { wrapper } = await mountPage('/notary-matters?stage=WAITING_RETURN');
    expect(wrapper.text()).toContain('「待退货」暂无记录');
    expect(wrapper.text()).toContain('可在侧栏切换其他阶段');
    expect(wrapper.text()).not.toContain('线索确认取证并移交后');
  });

  it('uses the sidebar stage filter without repeating it above the list', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    const { wrapper } = await mountPage(
      '/notary-matters?stage=PENDING_EVIDENCE',
    );

    expect(wrapper.find('nav[aria-label="公证阶段筛选"]').exists()).toBe(false);
    expect(api.listNotaryMatters).toHaveBeenCalledWith(
      1,
      20,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      'PENDING_EVIDENCE',
    );
    expect(wrapper.get('[data-test="matter-row"]').text()).toContain('待取证');
  });

  it('shows each matter separately and preserves its source lead link', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    preferenceApi.get.mockResolvedValue(
      preferenceWithLegacyOrder([
        'businessNo',
        'stage',
        'sourceLead',
        'notaryOffice',
        'createdAt',
      ]),
    );
    const { wrapper } = await mountPage(
      '/notary-matters?stage=PENDING_EVIDENCE',
    );
    expect(api.listNotaryMatters).toHaveBeenCalledWith(
      1,
      20,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      'PENDING_EVIDENCE',
    );
    expect(wrapper.get('[data-test="matter-row"]').text()).toContain('NT-001');
    expect(wrapper.get('[data-test="matter-link"]').attributes('href')).toBe(
      '/notary-matters/matter-1',
    );
    expect(
      wrapper.get('[data-test="source-lead-link"]').attributes('href'),
    ).toBe('/leads/lead-1');
  });

  it('opens the batch form for selected matters and refreshes the list after success', async () => {
    const waiting = {
      ...result,
      items: [{ ...result.items[0], stage: 'WAITING_RETURN' }],
      counts: { ...result.counts, WAITING_RETURN: 1 },
    };
    api.listNotaryMatters.mockResolvedValue(waiting);
    api.getNotaryMatter.mockResolvedValue({
      id: 'matter-1',
      businessNo: 'NT-001',
      stage: 'WAITING_RETURN',
      version: 5,
      capabilities: { archiveReturn: true },
      evidence: { sampleFeeState: 'KNOWN', sampleFeeAmount: '10.00' },
      issuanceDecision: { decision: 'NO_ISSUE' },
    });
    batchApi.archive.mockResolvedValue({ batchId: 'batch-1', items: [] });
    const { wrapper } = await mountPage('/notary-matters?stage=WAITING_RETURN');

    await wrapper.get('[data-test="select-matter"]').setValue(true);
    await wrapper.get('[data-test="batch-archive-open"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('样品费事实：10.00 元');

    await wrapper.get('[data-test="choice-matter-1"]').setValue('KEEP');
    await wrapper.get('[data-test="reason-matter-1"]').setValue('完成退货处理');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(batchApi.archive).toHaveBeenCalledTimes(1);
    expect(api.listNotaryMatters).toHaveBeenCalledTimes(2);
    expect(wrapper.get('[data-test="selected-count"]').text()).toContain(
      '0 项',
    );
    expect(workflow.notify).toHaveBeenCalledTimes(1);
  });

  it('opens the separate per-matter unboxing workflow from the existing selection', async () => {
    api.listNotaryMatters.mockResolvedValue({
      ...result,
      items: [{ ...result.items[0], stage: 'WAITING_UNBOX' }],
    });
    const { wrapper } = await mountPage('/notary-matters?stage=WAITING_UNBOX');
    await wrapper.get('[data-test="select-matter"]').setValue(true);
    await wrapper.get('[data-test="batch-opening-open"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="batch-opening-panel"]').exists()).toBe(
      true,
    );
    expect(wrapper.get('[data-test="batch-opening-panel"]').text()).toContain(
      'matter-1',
    );
    expect(wrapper.find('[data-test="batch-opening-close"]').exists()).toBe(
      true,
    );
  });

  it('keeps unprocessed selections and refreshes after closing a partly successful opening batch', async () => {
    const second = {
      ...result.items[0],
      id: 'matter-2',
      businessNo: 'NT-002',
      stage: 'WAITING_UNBOX' as const,
    };
    api.listNotaryMatters.mockResolvedValue({
      ...result,
      items: [{ ...result.items[0], stage: 'WAITING_UNBOX' }, second],
      total: 2,
    });
    const { wrapper } = await mountPage('/notary-matters?stage=WAITING_UNBOX');
    await wrapper.get('[data-test="select-page"]').setValue(true);
    await wrapper.get('[data-test="batch-opening-open"]').trigger('click');
    await wrapper.get('[data-test="batch-opening-close"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="selected-count"]').text()).toContain(
      '1 项',
    );
    expect(wrapper.text()).toContain('其余事项仍保留');
    expect(api.listNotaryMatters).toHaveBeenCalledTimes(2);
    expect(api.listNotaryMatters.mock.calls[1]?.[3]).toBe('WAITING_UNBOX');
  });

  it('shows a recoverable action when the pending request uses the same actor at an older authorization revision', async () => {
    api.listNotaryMatters.mockResolvedValue({
      ...result,
      items: [{ ...result.items[0], stage: 'WAITING_UNBOX' }],
    });
    api.getNotaryMatter.mockResolvedValue({
      id: 'matter-1',
      businessNo: 'NT-001',
      stage: 'WAITING_UNBOX',
      version: 5,
      capabilities: { recordOpening: true },
    });
    const oldKey = `notary-list-request:${JSON.stringify(['user-1:INTERNAL:department-1:0', 'matter-1', 'opening-form'])}`;
    sessionStorage.setItem(
      oldKey,
      JSON.stringify({
        command: {
          kind: 'opening',
          input: { expectedVersion: 4, contentVersionIds: ['photo-v1'] },
        },
        key: 'old-auth-revision-key',
      }),
    );
    const { wrapper } = await mountPage('/notary-matters');
    expect(wrapper.findAll('[data-test="notary-resume-request"]')).toHaveLength(
      1,
    );
    await wrapper.get('[data-test="notary-resume-request"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="notary-workflow-retry"]').exists()).toBe(
      true,
    );
    expect(api.getNotaryMatter).toHaveBeenCalledWith(
      'matter-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    wrapper.unmount();
  });

  it.each(['identity', 'department', 'stage'])(
    'preserves an unknown batch across %s change and restores only its original request',
    async (change) => {
      const waiting = {
        ...result,
        items: [{ ...result.items[0], stage: 'WAITING_RETURN' }],
        counts: { ...result.counts, WAITING_RETURN: 1 },
      };
      api.listNotaryMatters.mockResolvedValue(waiting);
      api.getNotaryMatter.mockResolvedValue({
        id: 'matter-1',
        businessNo: 'NT-001',
        stage: 'WAITING_RETURN',
        version: 5,
        capabilities: { archiveReturn: true },
        evidence: { sampleFeeState: 'KNOWN', sampleFeeAmount: '10.00' },
        issuanceDecision: { decision: 'NO_ISSUE' },
      });
      batchApi.archive
        .mockRejectedValueOnce(new TypeError('network disconnected'))
        .mockResolvedValueOnce({ batchId: 'batch-1', items: [] });
      const { wrapper, router, auth } = await mountPage(
        '/notary-matters?stage=WAITING_RETURN',
      );
      await wrapper.get('[data-test="select-matter"]').setValue(true);
      await wrapper.get('[data-test="batch-archive-open"]').trigger('click');
      await flushPromises();
      await wrapper.get('[data-test="choice-matter-1"]').setValue('KEEP');
      await wrapper.get('[data-test="reason-matter-1"]').setValue('原请求原因');
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      const originalCall = batchApi.archive.mock.calls[0];
      expect(
        wrapper.get('[data-test="batch-archive-open"]').attributes('disabled'),
      ).toBeDefined();

      if (change === 'stage')
        await router.push({ query: { stage: 'ARCHIVED' } });
      else
        auth.session = {
          ...auth.session!,
          ...(change === 'identity'
            ? { user: { ...auth.session!.user, id: 'user-2' } }
            : { department: { id: 'department-2', name: '另一部门' } }),
        };
      await flushPromises();
      expect(wrapper.find('[data-test="batch-message"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain('原请求原因');
      expect(wrapper.find('[data-test="batch-resume"]').exists()).toBe(false);
      expect(
        wrapper.get('[data-test="batch-archive-open"]').attributes('disabled'),
      ).toBeDefined();

      if (change === 'stage')
        await router.push({ query: { stage: 'WAITING_RETURN' } });
      else
        auth.session = {
          ...auth.session!,
          ...(change === 'identity'
            ? { user: { ...auth.session!.user, id: 'user-1' } }
            : { department: { id: 'department-1', name: '知产部' } }),
        };
      await flushPromises();
      expect(wrapper.find('[data-test="batch-resume"]').exists()).toBe(true);
      expect(batchApi.archive).toHaveBeenCalledTimes(1);
      await wrapper.get('[data-test="batch-resume"]').trigger('click');
      expect(batchApi.archive).toHaveBeenCalledTimes(1);
      await wrapper.get('.return-archive-batch header button').trigger('click');
      expect(wrapper.find('[data-test="batch-resume"]').exists()).toBe(true);
      await wrapper.get('[data-test="batch-resume"]').trigger('click');
      await wrapper.get('[data-test="batch-retry"]').trigger('click');
      await flushPromises();
      expect(batchApi.archive.mock.calls[1]).toEqual(originalCall);
      expect(workflow.notify).toHaveBeenCalledTimes(1);
      expect(wrapper.find('[data-test="batch-resume"]').exists()).toBe(false);
    },
  );

  it('keeps a changed-scope in-flight result unresolved and allows a new scoped batch', async () => {
    const waiting = {
      ...result,
      items: [{ ...result.items[0], stage: 'WAITING_RETURN' }],
      counts: { ...result.counts, WAITING_RETURN: 1 },
    };
    api.listNotaryMatters.mockResolvedValue(waiting);
    api.getNotaryMatter.mockResolvedValue({
      id: 'matter-1',
      businessNo: 'NT-001',
      stage: 'WAITING_RETURN',
      version: 5,
      capabilities: { archiveReturn: true },
      evidence: { sampleFeeState: 'KNOWN', sampleFeeAmount: '10.00' },
      issuanceDecision: { decision: 'NO_ISSUE' },
    });
    let resolveFirst!: (value: { batchId: string; items: [] }) => void;
    batchApi.archive
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve)),
      )
      .mockRejectedValueOnce(new TypeError('new scope unknown'));
    const { wrapper, auth } = await mountPage(
      '/notary-matters?stage=WAITING_RETURN',
    );
    await wrapper.get('[data-test="select-matter"]').setValue(true);
    await wrapper.get('[data-test="batch-archive-open"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="choice-matter-1"]').setValue('KEEP');
    await wrapper.get('[data-test="reason-matter-1"]').setValue('原账号事实');
    await wrapper.get('form').trigger('submit');
    const originalCall = batchApi.archive.mock.calls[0];
    auth.session = {
      ...auth.session!,
      user: { ...auth.session!.user, id: 'user-2' },
    };
    await flushPromises();
    resolveFirst({ batchId: 'batch-1', items: [] });
    await flushPromises();
    expect(workflow.notify).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain('原账号事实');
    await wrapper.get('[data-test="select-matter"]').setValue(true);
    await wrapper.get('[data-test="batch-archive-open"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="choice-matter-1"]').setValue('KEEP');
    await wrapper.get('[data-test="reason-matter-1"]').setValue('新账号事实');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(batchApi.archive.mock.calls[1]).not.toEqual(originalCall);
    expect(wrapper.text()).not.toContain('原账号事实');
    await wrapper.get('header button').trigger('click');
    auth.session = {
      ...auth.session!,
      user: { ...auth.session!.user, id: 'user-1' },
    };
    await flushPromises();
    expect(wrapper.find('[data-test="batch-resume"]').exists()).toBe(true);
  });

  it('clears a restored request after a deterministic rejection so facts can be reloaded', async () => {
    const waiting = {
      ...result,
      items: [{ ...result.items[0], stage: 'WAITING_RETURN' }],
      counts: { ...result.counts, WAITING_RETURN: 1 },
    };
    api.listNotaryMatters.mockResolvedValue(waiting);
    api.getNotaryMatter.mockResolvedValue({
      id: 'matter-1',
      businessNo: 'NT-001',
      stage: 'WAITING_RETURN',
      version: 5,
      capabilities: { archiveReturn: true },
      evidence: { sampleFeeState: 'KNOWN', sampleFeeAmount: '10.00' },
      issuanceDecision: { decision: 'NO_ISSUE' },
    });
    batchApi.archive
      .mockRejectedValueOnce(new TypeError('network disconnected'))
      .mockRejectedValueOnce(new ApiError('版本冲突', 409, 'VERSION_CONFLICT'));
    const { wrapper } = await mountPage('/notary-matters?stage=WAITING_RETURN');
    await wrapper.get('[data-test="select-matter"]').setValue(true);
    await wrapper.get('[data-test="batch-archive-open"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="choice-matter-1"]').setValue('KEEP');
    await wrapper.get('[data-test="reason-matter-1"]').setValue('原请求原因');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    await wrapper.get('.return-archive-batch header button').trigger('click');
    await wrapper.get('[data-test="batch-resume"]').trigger('click');
    await wrapper.get('[data-test="batch-retry"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('请重新读取事项后再提交');
    expect(wrapper.find('[data-test="batch-resume"]').exists()).toBe(false);
    await wrapper.get('.return-archive-batch header button').trigger('click');
    expect(
      wrapper.get('[data-test="batch-archive-open"]').attributes('disabled'),
    ).toBeUndefined();
  });

  it('does not disguise a failed query as an empty list', async () => {
    api.listNotaryMatters
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(result);
    const { wrapper } = await mountPage('/notary-matters');
    expect(wrapper.text()).toContain('公证事项列表暂时无法加载');
    await wrapper.get('[data-test="retry"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('[data-test="matter-row"]')).toHaveLength(1);
  });

  it('keeps the stage filter while paging through matters', async () => {
    api.listNotaryMatters.mockResolvedValue({ ...result, total: 21, page: 1 });
    const { wrapper, router } = await mountPage(
      '/notary-matters?stage=PENDING_EVIDENCE',
    );
    await wrapper.get('[data-test="next-page"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query).toMatchObject({
      stage: 'PENDING_EVIDENCE',
      page: '2',
    });
    expect(api.listNotaryMatters).toHaveBeenLastCalledWith(
      2,
      20,
      expect.any(Object),
      'PENDING_EVIDENCE',
    );
  });

  it('filters and labels the newly added archived stage', async () => {
    api.listNotaryMatters.mockResolvedValue({
      ...result,
      items: [{ ...result.items[0], stage: 'ARCHIVED' }],
      counts: { ...result.counts, ARCHIVED: 1 },
    });
    const { wrapper } = await mountPage('/notary-matters?stage=ARCHIVED');
    expect(api.listNotaryMatters).toHaveBeenCalledWith(
      1,
      20,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      'ARCHIVED',
    );
    expect(wrapper.get('[data-test="matter-row"]').text()).toContain('已归档');
  });

  it('opens all seventeen optional settings and keeps selection, operations and progress fixed', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    const { wrapper } = await mountPage('/notary-matters');
    await wrapper.get('[data-test="column-settings-toggle"]').trigger('click');
    expect(wrapper.text()).toContain('始终显示');
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual(
      defaultHeaders,
    );
    expect(wrapper.findAll('[data-test="column-option"]')).toHaveLength(17);
    expect(wrapper.find('[data-column-key="businessNo"]').exists()).toBe(false);
    expect(wrapper.find('[data-column-key="stage"]').exists()).toBe(false);
  });

  it('applies a reordered and hidden business column only after saving', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    const { wrapper } = await mountPage('/notary-matters');
    await wrapper.get('[data-test="column-settings-toggle"]').trigger('click');
    await wrapper.get('[data-column-key="rightsHolder"]').setValue(false);
    await wrapper.get('[aria-label="上移平台"]').trigger('click');
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual(
      defaultHeaders,
    );
    await wrapper.get('[data-test="save-columns"]').trigger('click');
    await flushPromises();
    const nextOrder = [...defaultNotaryListPreference.order];
    [nextOrder[2], nextOrder[3]] = [nextOrder[3]!, nextOrder[2]!];
    expect(preferenceApi.save).toHaveBeenCalledWith(
      {
        order: nextOrder,
        hidden: [...defaultNotaryListPreference.hidden, 'rightsHolder'],
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual(
      defaultHeaders.filter((header) => header !== '权利主体'),
    );
  });

  it('cancels a draft without making a preference request', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    const { wrapper } = await mountPage('/notary-matters');
    await wrapper.get('[data-test="column-settings-toggle"]').trigger('click');
    await wrapper.get('[data-column-key="rightsHolder"]').setValue(false);
    await wrapper.get('[data-test="cancel-columns"]').trigger('click');
    expect(preferenceApi.save).not.toHaveBeenCalled();
    expect(wrapper.findAll('thead th')).toHaveLength(17);
  });

  it('keeps the saved columns and draft after a save failure', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    preferenceApi.save.mockRejectedValueOnce(new Error('offline'));
    const { wrapper } = await mountPage('/notary-matters');
    await wrapper.get('[data-test="column-settings-toggle"]').trigger('click');
    await wrapper.get('[data-column-key="rightsHolder"]').setValue(false);
    await wrapper.get('[data-test="save-columns"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('thead th')).toHaveLength(17);
    expect(
      wrapper.get('[data-column-key="rightsHolder"]').element,
    ).toMatchObject({ checked: false });
    expect(
      wrapper.get('[data-test="column-preference-status"]').text(),
    ).toContain('草稿仍保留');
  });

  it('persists restore-defaults through the preference API', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    preferenceApi.get.mockResolvedValue(
      preferenceWithLegacyOrder(
        ['businessNo', 'stage', 'createdAt', 'notaryOffice', 'sourceLead'],
        ['sourceLead'],
      ),
    );
    const { wrapper } = await mountPage('/notary-matters');
    await wrapper.get('[data-test="column-settings-toggle"]').trigger('click');
    await wrapper.get('[data-test="reset-columns"]').trigger('click');
    await flushPromises();
    expect(preferenceApi.save).toHaveBeenCalledWith(
      defaultNotaryListPreference,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual(
      defaultHeaders,
    );
  });

  it('keeps the default list usable and locks editing when preference loading fails', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    preferenceApi.get.mockRejectedValueOnce(new Error('offline'));
    const { wrapper } = await mountPage('/notary-matters');
    expect(wrapper.findAll('[data-test="matter-row"]')).toHaveLength(1);
    expect(wrapper.findAll('thead th')).toHaveLength(17);
    expect(
      wrapper
        .get('[data-test="column-settings-toggle"]')
        .attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.get('[data-test="column-preference-status"]').text(),
    ).toContain('读取失败');
    preferenceApi.get.mockResolvedValueOnce(defaultNotaryListPreference);
    await wrapper.get('[data-test="retry-preference"]').trigger('click');
    await flushPromises();
    expect(
      wrapper
        .get('[data-test="column-settings-toggle"]')
        .attributes('disabled'),
    ).toBeUndefined();
  });

  it('renders an already expanded legacy preference without overwriting it', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    preferenceApi.get.mockResolvedValue(
      preferenceWithLegacyOrder(
        ['businessNo', 'stage', 'createdAt', 'notaryOffice', 'sourceLead'],
        ['sourceLead'],
      ),
    );
    const { wrapper } = await mountPage('/notary-matters');
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual([
      ...defaultHeaders,
      '创建时间',
      '公证处',
    ]);
    expect(preferenceApi.save).not.toHaveBeenCalled();
  });

  it('ignores a delayed preference response from the previous account', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    let resolveFirst: ((value: unknown) => void) | undefined;
    preferenceApi.get
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(
        preferenceWithLegacyOrder(
          ['businessNo', 'stage', 'createdAt', 'notaryOffice', 'sourceLead'],
          ['sourceLead'],
        ),
      );
    const { wrapper, auth } = await mountPage('/notary-matters');
    auth.session = {
      ...auth.session!,
      user: { ...auth.session!.user, id: 'user-2' },
    };
    await flushPromises();
    resolveFirst?.(defaultNotaryListPreference);
    await flushPromises();
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual([
      ...defaultHeaders,
      '创建时间',
      '公证处',
    ]);
    expect(api.listNotaryMatters).toHaveBeenCalledTimes(2);
  });

  it('aborts and ignores a save response after the signed-in account changes', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    const { wrapper, auth } = await mountPage('/notary-matters');
    let resolveSave: ((value: unknown) => void) | undefined;
    preferenceApi.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    preferenceApi.get.mockResolvedValueOnce(
      preferenceWithLegacyOrder(
        ['businessNo', 'stage', 'createdAt', 'sourceLead', 'notaryOffice'],
        ['sourceLead'],
      ),
    );
    await wrapper.get('[data-test="column-settings-toggle"]').trigger('click');
    await wrapper.get('[data-column-key="rightsHolder"]').setValue(false);
    await wrapper.get('[data-test="save-columns"]').trigger('click');
    await flushPromises();
    const saveOptions = preferenceApi.save.mock.calls[0]?.[1] as
      { signal: AbortSignal } | undefined;
    auth.session = {
      ...auth.session!,
      user: { ...auth.session!.user, id: 'user-2' },
    };
    await flushPromises();
    resolveSave?.(defaultNotaryListPreference);
    await flushPromises();
    expect(saveOptions?.signal.aborted).toBe(true);
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual([
      ...defaultHeaders,
      '创建时间',
      '公证处',
    ]);
    expect(
      wrapper.get('[data-test="column-preference-status"]').text(),
    ).toContain('个人列设置已加载');
  });
  it('requires an explicit scope and a successful preview before download', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    exportApi.preview.mockResolvedValue({ count: 1, maxRows: 1000 });
    exportApi.download.mockResolvedValue({
      blob: new Blob(['csv']),
      filename: 'list.csv',
      mimeType: 'text/csv',
    });
    const createUrl = vi.fn(() => 'blob:export');
    const revokeUrl = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: createUrl,
      revokeObjectURL: revokeUrl,
    });
    const { wrapper } = await mountPage(
      '/notary-matters?stage=PENDING_EVIDENCE',
    );

    expect(wrapper.findAll('thead th').map((cell) => cell.text())[0]).toContain(
      '选择',
    );
    await wrapper.get('[data-test="select-matter"]').setValue(true);
    await wrapper.get('[data-test="export-open"]').trigger('click');
    expect(wrapper.find('[data-test="export-confirm"]').exists()).toBe(false);
    await wrapper.get('[data-test="export-mode-selected"]').setValue(true);
    await wrapper.get('[data-test="export-preview"]').trigger('click');
    await flushPromises();
    expect(exportApi.preview).toHaveBeenCalledWith(
      { mode: 'SELECTED', matterIds: ['matter-1'] },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(wrapper.text()).toContain('1 条');
    await wrapper.get('[data-test="export-confirm"]').trigger('click');
    await flushPromises();
    expect(exportApi.download).toHaveBeenCalledWith(
      { mode: 'SELECTED', matterIds: ['matter-1'] },
      1,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(createUrl).toHaveBeenCalledOnce();
    expect(revokeUrl).toHaveBeenCalledWith('blob:export');
  });

  it('keeps selected IDs across pages and clears them when the stage changes', async () => {
    api.listNotaryMatters.mockImplementation((page: number) =>
      Promise.resolve({
        ...result,
        items: [{ ...result.items[0], id: `matter-${page}` }],
        total: 21,
        page,
      }),
    );
    const { wrapper, router } = await mountPage(
      '/notary-matters?stage=PENDING_EVIDENCE',
    );
    await wrapper.get('[data-test="select-matter"]').setValue(true);
    await wrapper.get('[data-test="next-page"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="select-matter"]').setValue(true);
    expect(wrapper.text()).toContain('已选择 2 项');
    await router.push({ query: { stage: 'WAITING_RETURN' } });
    await flushPromises();
    expect(wrapper.text()).toContain('已选择 0 项');
  });

  it('ignores a delayed export response after the account changes', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    exportApi.preview.mockResolvedValue({ count: 1, maxRows: 1000 });
    let resolveDownload: ((value: unknown) => void) | undefined;
    exportApi.download.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDownload = resolve;
        }),
    );
    const createUrl = vi.fn(() => 'blob:stale');
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: createUrl,
      revokeObjectURL: vi.fn(),
    });
    const { wrapper, auth } = await mountPage('/notary-matters');
    await wrapper.get('[data-test="select-matter"]').setValue(true);
    await wrapper.get('[data-test="export-open"]').trigger('click');
    await wrapper.get('[data-test="export-mode-selected"]').setValue(true);
    await wrapper.get('[data-test="export-preview"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="export-confirm"]').trigger('click');
    await flushPromises();
    auth.session = {
      ...auth.session!,
      user: { ...auth.session!.user, id: 'user-2' },
    };
    await flushPromises();
    resolveDownload?.({
      blob: new Blob(['stale']),
      filename: 'stale.csv',
      mimeType: 'text/csv',
    });
    await flushPromises();
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('shows authorization and limit errors without presenting a download action', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    exportApi.preview.mockRejectedValueOnce(
      new ApiError('当前账号无权导出', 403, 'FORBIDDEN'),
    );
    const { wrapper } = await mountPage('/notary-matters');
    await wrapper.get('[data-test="select-matter"]').setValue(true);
    await wrapper.get('[data-test="export-open"]').trigger('click');
    await wrapper.get('[data-test="export-mode-selected"]').setValue(true);
    await wrapper.get('[data-test="export-preview"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="export-status"]').text()).toContain(
      '当前账号无权导出',
    );
    expect(wrapper.find('[data-test="export-confirm"]').exists()).toBe(false);

    exportApi.preview.mockRejectedValueOnce(
      new ApiError('超出上限', 400, 'EXPORT_LIMIT_EXCEEDED'),
    );
    await wrapper.get('[data-test="export-preview"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="export-status"]').text()).toContain(
      '超过 1000 条',
    );
    expect(wrapper.find('[data-test="export-confirm"]').exists()).toBe(false);
  });

  it('prevents duplicate previews and cancels an in-flight request', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    let resolvePreview: ((value: unknown) => void) | undefined;
    exportApi.preview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    );
    const { wrapper } = await mountPage('/notary-matters');
    await wrapper.get('[data-test="select-matter"]').setValue(true);
    await wrapper.get('[data-test="export-open"]').trigger('click');
    await wrapper.get('[data-test="export-mode-selected"]').setValue(true);
    await wrapper.get('[data-test="export-preview"]').trigger('click');
    await wrapper.get('[data-test="export-preview"]').trigger('click');
    expect(exportApi.preview).toHaveBeenCalledOnce();
    const options = exportApi.preview.mock.calls[0]?.[1] as
      { signal: AbortSignal } | undefined;
    await wrapper.get('[data-test="export-cancel"]').trigger('click');
    expect(options?.signal.aborted).toBe(true);
    resolvePreview?.({ count: 1, maxRows: 1000 });
    await flushPromises();
    expect(wrapper.find('[data-test="export-confirm"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="selected-count"]').text()).toContain(
      '已选择 1 项',
    );
    await wrapper.get('[data-test="clear-selection"]').trigger('click');
    expect(wrapper.get('[data-test="selected-count"]').text()).toContain(
      '已选择 0 项',
    );
  });

  it('aborts a pending preview when its scope changes and ignores its late response', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    let resolveOldPreview: ((value: unknown) => void) | undefined;
    exportApi.preview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOldPreview = resolve;
        }),
    );
    const { wrapper } = await mountPage('/notary-matters');
    await wrapper.get('[data-test="select-matter"]').setValue(true);
    await wrapper.get('[data-test="export-open"]').trigger('click');
    await wrapper.get('[data-test="export-mode-selected"]').setValue(true);
    await wrapper.get('[data-test="export-preview"]').trigger('click');

    const oldOptions = exportApi.preview.mock.calls[0]?.[1] as
      { signal: AbortSignal } | undefined;
    await wrapper.get('[data-test="export-mode-filtered"]').setValue(true);
    await flushPromises();
    expect(oldOptions?.signal.aborted).toBe(true);

    exportApi.preview.mockResolvedValueOnce({ count: 2, maxRows: 1000 });
    await wrapper.get('[data-test="export-preview"]').trigger('click');
    await flushPromises();
    expect(exportApi.preview).toHaveBeenCalledTimes(2);
    expect(wrapper.get('[data-test="export-preview-count"]').text()).toContain(
      '共 2 条',
    );

    resolveOldPreview?.({ count: 1, maxRows: 1000 });
    await flushPromises();
    expect(wrapper.get('[data-test="export-preview-count"]').text()).toContain(
      '共 2 条',
    );
    expect(wrapper.get('[data-test="export-confirm"]').text()).toContain(
      '确认下载 2 条',
    );
  });

  it('requires another preview after the server reports a changed row count', async () => {
    api.listNotaryMatters.mockResolvedValue(result);
    exportApi.preview.mockResolvedValue({ count: 1, maxRows: 1000 });
    exportApi.download.mockRejectedValue(
      new ApiError('事项数量已变化，请重新预览', 409, 'EXPORT_SCOPE_CHANGED'),
    );
    const { wrapper } = await mountPage('/notary-matters');
    await wrapper.get('[data-test="select-matter"]').setValue(true);
    await wrapper.get('[data-test="export-open"]').trigger('click');
    await wrapper.get('[data-test="export-mode-selected"]').setValue(true);
    await wrapper.get('[data-test="export-preview"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="export-confirm"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="export-status"]').text()).toContain(
      '事项数量已变化，请重新预览后下载。',
    );
    expect(wrapper.find('[data-test="export-confirm"]').exists()).toBe(false);
  });
});
