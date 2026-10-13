import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import CaseListPage from './CaseListPage.vue';
import CaseDetailPage from './CaseDetailPage.vue';
import { workflowChangedEvent } from '../../app/workflow-events';

const api = vi.hoisted(() => ({
  listCases: vi.fn(),
  getCase: vi.fn(),
  matchCase: vi.fn(),
  listLawyerMatchCandidates: vi.fn(),
  submitComplaint: vi.fn(),
  confirmCaseComplaint: vi.fn(),
  uploadMaterialFile: vi.fn(),
  listOwnerMaterials: vi.fn(),
  downloadMaterialVersion: vi.fn(),
  listFilingCourts: vi.fn(),
  createFilingCourt: vi.fn(),
  submitCaseFiling: vi.fn(),
  scheduleCaseHearing: vi.fn(),
  correctCaseHearing: vi.fn(),
  registerCaseJudgment: vi.fn(),
  correctCaseJudgment: vi.fn(),
  chooseCaseJudgmentNextStep: vi.fn(),
  revokeCaseJudgmentNextStep: vi.fn(),
}));
vi.mock('../../api/cases', () => ({
  listCases: api.listCases,
  getCase: api.getCase,
  matchCase: api.matchCase,
  listLawyerMatchCandidates: api.listLawyerMatchCandidates,
  submitComplaint: api.submitComplaint,
  confirmCaseComplaint: api.confirmCaseComplaint,
  listFilingCourts: api.listFilingCourts,
  createFilingCourt: api.createFilingCourt,
  submitCaseFiling: api.submitCaseFiling,
  scheduleCaseHearing: api.scheduleCaseHearing,
  correctCaseHearing: api.correctCaseHearing,
  registerCaseJudgment: api.registerCaseJudgment,
  correctCaseJudgment: api.correctCaseJudgment,
  chooseCaseJudgmentNextStep: api.chooseCaseJudgmentNextStep,
  revokeCaseJudgmentNextStep: api.revokeCaseJudgmentNextStep,
  todayShanghai: () => '2026-09-29',
}));
vi.mock('../../api/materials', () => ({
  downloadMaterialVersion: api.downloadMaterialVersion,
  uploadMaterialFile: api.uploadMaterialFile,
  listOwnerMaterials: api.listOwnerMaterials,
}));

beforeEach(() => {
  vi.resetAllMocks();
  api.listCases.mockResolvedValue({
    items: [
      {
        id: 'case-1',
        businessNo: 'CA-1',
        stage: 'PENDING_MATCH',
        createdAt: '2026-09-28T00:00:00Z',
        version: 1,
        owner: { id: 'user-1', displayName: '负责人' },
        canMatch: true,
        canSubmitExecution: false,
        canConfirmExecution: false,
        canSubmitComplaint: false,
        canSubmitFiling: false,
        canRegisterAcceptance: false,
        canUploadAcceptanceMaterials: false,
        canScheduleHearing: false,
        canCorrectHearing: false,
        canRegisterJudgment: false,
        canCorrectJudgment: false,
        sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
        sourceNotaryMatter: { id: 'matter-1', businessNo: 'NZ-1' },
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
    counts: {
      PENDING_MATCH: 1,
      WAITING_COMPLAINT: 0,
      WAITING_COMPLAINT_CONFIRMATION: 0,
      WAITING_COMPLAINT_STAMP: 0,
      WAITING_FILING: 0,
      WAITING_FORMAL_ACCEPTANCE: 0,
      WAITING_HEARING: 0,
      WAITING_JUDGMENT: 0,
      SECOND_INSTANCE: 0,
      WAITING_EXECUTION_DOCUMENTS: 0,
      WAITING_EXECUTION_CONFIRMATION: 0,
      WAITING_EXECUTION_STAMP: 0,
      WAITING_EXECUTION_FILING: 0,
      EXECUTING: 0,
    },
  });
  api.listLawyerMatchCandidates.mockResolvedValue([]);
  api.getCase.mockResolvedValue({
    id: 'case-1',
    businessNo: 'CA-1',
    stage: 'PENDING_MATCH',
    createdAt: '2026-09-28T00:00:00Z',
    version: 1,
    canMatch: true,
    courtCaseNo: null,
    department: { id: 'department-1', name: '知产部' },
    customer: { id: 'customer-1', name: '客户甲' },
    rightsHolder: { id: 'holder-1', name: '权利人甲' },
    owner: { id: 'user-1', displayName: '负责人' },
    sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
    sourceNotaryMatter: { id: 'matter-1', businessNo: 'NZ-1' },
    certificate: {
      certificateNo: 'Z-100',
      certificateDate: '2026-09-28',
      issuedAt: '2026-09-28T00:00:00Z',
      needDisclose: false,
      files: [],
      disclosureFiles: [],
    },
    fees: [
      {
        category: 'SAMPLE',
        state: 'KNOWN',
        amount: '12.00',
        sourceType: 'NOTARY_MATTER_EVIDENCE',
        sourceId: 'evidence-1',
      },
    ],
    defendants: [],
    lawyers: [],
    matchedAt: null,
    matchedOn: null,
    canSubmitComplaint: false,
    canConfirmComplaint: false,
    canSubmitFiling: false,
    canRegisterAcceptance: false,
    canUploadAcceptanceMaterials: false,
    canScheduleHearing: false,
    canCorrectHearing: false,
    canRegisterJudgment: false,
    canCorrectJudgment: false,
    canSaveSecondInstance: false,
    canRegisterSecondInstanceResult: false,
    canRevokeSecondInstanceResult: false,
    canSubmitExecution: false,
    canChooseJudgmentNextStep: false,
    canRevokeJudgmentNextStep: false,
    complaint: null,
    complaintConfirmation: null,
    complaintMailing: null,
    filingSubmission: null,
    acceptance: null,
    acceptanceMaterials: {
      ACCEPTANCE_NOTICE: { available: [], frozen: [], later: [] },
      PAYMENT_LIST: { available: [], frozen: [], later: [] },
      SERVICE_DOCUMENT: { available: [], frozen: [], later: [] },
    },
    hearing: {
      currentArrangement: null,
      currentAdvance: null,
      arrangements: [],
      advances: [],
      corrections: [],
    },
    judgment: { current: null, history: [], availableFiles: [] },
    acceptances: [],
    secondInstance: {
      currentTrialRoundId: null,
      currentProgress: null,
      currentResult: null,
      rounds: [],
      progresses: [],
      results: [],
      revocations: [],
    },
    executionSubmission: { current: null, submissions: [], availableFiles: [] },
    canConfirmExecution: false,
    executionConfirmation: null,
    executionMailing: null,
    executionFiling: null,
  });
  api.listOwnerMaterials.mockResolvedValue({ items: [], total: 0 });
  api.listFilingCourts.mockResolvedValue([]);
  api.createFilingCourt.mockResolvedValue({ id: 'court-1', name: '真实法院' });
  api.submitCaseFiling.mockResolvedValue({});
  api.scheduleCaseHearing.mockResolvedValue({
    id: 'case-1',
    stage: 'WAITING_HEARING',
    version: 8,
    arrangementId: '80000000-0000-4000-8000-000000000001',
    hearingAt: '2026-10-05',
    recordedAt: '2026-10-06T01:00:00.000Z',
  });
  api.correctCaseHearing.mockResolvedValue({});
  api.registerCaseJudgment.mockResolvedValue({});
  api.correctCaseJudgment.mockResolvedValue({});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mountRoute(
  path: string,
  component: typeof CaseListPage | typeof CaseDetailPage,
) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/cases', component: CaseListPage },
      { path: '/cases/:id', component: CaseDetailPage },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(component, { global: { plugins: [pinia, router] } });
  await flushPromises();
  return wrapper;
}

function confirmationDetail(
  id: string,
  stage:
    | 'WAITING_COMPLAINT_CONFIRMATION'
    | 'WAITING_COMPLAINT_STAMP' = 'WAITING_COMPLAINT_CONFIRMATION',
  version = 3,
) {
  return {
    id,
    businessNo: `CA-${id}`,
    stage,
    createdAt: '2026-10-01T00:00:00Z',
    version,
    canMatch: false,
    canSubmitComplaint: false,
    canConfirmComplaint: stage === 'WAITING_COMPLAINT_CONFIRMATION',
    canMailComplaint: false,
    canMailExecution: false,
    canSubmitExecutionFiling: false,
    canSubmitFiling: false,
    canRegisterAcceptance: false,
    canUploadAcceptanceMaterials: false,
    canScheduleHearing: false,
    canCorrectHearing: false,
    canRegisterJudgment: false,
    canCorrectJudgment: false,
    courtCaseNo: null,
    department: { id: 'department-1', name: '知产部' },
    customer: { id: 'customer-1', name: '客户甲' },
    rightsHolder: { id: 'holder-1', name: '权利人甲' },
    owner: { id: 'user-1', displayName: '负责人' },
    sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
    sourceNotaryMatter: { id: 'matter-1', businessNo: 'NZ-1' },
    certificate: {
      certificateNo: 'Z-100',
      certificateDate: '2026-10-01',
      issuedAt: '2026-10-01T00:00:00Z',
      needDisclose: false,
      files: [],
      disclosureFiles: [],
    },
    fees: [],
    defendants: [],
    lawyers: [],
    matchedAt: null,
    matchedOn: null,
    complaint: {
      amountState: 'KNOWN',
      amount: '123.45',
      pendingReason: null,
      submittedAt: '2026-10-01T01:00:00Z',
      submittedByUserId: 'user-1',
      complaintFiles: [
        {
          materialId: `material-${id}`,
          contentVersionId: `version-${id}`,
          originalFilename: `${id}-诉状.pdf`,
          mimeType: 'application/pdf',
        },
      ],
      authorizationFiles: [],
    },
    complaintConfirmation:
      stage === 'WAITING_COMPLAINT_STAMP'
        ? {
            confirmedComplaintContentVersionId: `version-${id}`,
            complaintFile: {
              materialId: `material-${id}`,
              contentVersionId: `version-${id}`,
              originalFilename: `${id}-诉状.pdf`,
              mimeType: 'application/pdf',
            },
            amountState: 'KNOWN',
            amount: '123.45',
            pendingReason: null,
            confirmDisclose: false,
            changeNote: null,
            confirmedAt: '2026-10-02T02:00:00Z',
            confirmedByUserId: 'user-1',
          }
        : null,
    complaintMailing: null,
    filingSubmission: null,
    acceptance: null,
    acceptanceMaterials: {
      ACCEPTANCE_NOTICE: { available: [], frozen: [], later: [] },
      PAYMENT_LIST: { available: [], frozen: [], later: [] },
      SERVICE_DOCUMENT: { available: [], frozen: [], later: [] },
    },
    hearing: {
      currentArrangement: null,
      currentAdvance: null,
      arrangements: [],
      advances: [],
      corrections: [],
    },
    judgment: { current: null, history: [], availableFiles: [] },
    judgmentNextStep: { current: null, history: [], revocations: [] },
    acceptances: [],
    canSaveSecondInstance: false,
    canRegisterSecondInstanceResult: false,
    canRevokeSecondInstanceResult: false,
    canSubmitExecution: false,
    secondInstance: {
      currentTrialRoundId: null,
      currentProgress: null,
      currentResult: null,
      rounds: [],
      progresses: [],
      results: [],
      revocations: [],
    },
    executionSubmission: { current: null, submissions: [], availableFiles: [] },
    canConfirmExecution: false,
    executionConfirmation: null,
    executionMailing: null,
    executionFiling: null,
  };
}

function judgmentDetailWithChoiceCapability(id: string) {
  const detail = confirmationDetail(id);
  const file = {
    materialId: '70000000-0000-4000-8000-000000000001',
    contentVersionId: '70000000-0000-4000-8000-000000000002',
    originalFilename: '内部判决.pdf',
    mimeType: 'application/pdf',
  };
  const fact = {
    id: '70000000-0000-4000-8000-000000000003',
    kind: 'REGISTER' as const,
    priorFactId: null,
    judgmentReceivedAt: '2026-10-02',
    judgmentAmountState: 'KNOWN' as const,
    judgmentAmount: '42.50',
    paidLitigationFeeState: 'KNOWN' as const,
    paidLitigationFee: '0.00',
    fromVersion: 6,
    toVersion: 7,
    recordedAt: '2026-10-02T03:00:00Z',
    reason: null,
    recordedByUserId: '70000000-0000-4000-8000-000000000004',
    files: [file],
  };
  return {
    ...detail,
    stage: 'WAITING_JUDGMENT' as const,
    version: 7,
    canRegisterJudgment: false,
    canChooseJudgmentNextStep: true,
    judgment: { current: fact, history: [fact], availableFiles: [file] },
  };
}

async function mountRoutedDetail(path: string) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore(pinia);
  auth.session = {
    principalType: 'INTERNAL',
    user: { id: 'user-1', displayName: '负责人', username: 'owner' },
    department: { id: 'department-1', name: '知产部' },
    departments: [{ id: 'department-1', name: '知产部' }],
    customer: null,
    notaryOffice: null,
    authorizationRevision: 1,
    expiresAt: '2099-01-01T00:00:00Z',
    csrfToken: 'csrf',
  };
  auth.restored = true;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/cases', component: CaseListPage },
      { path: '/cases/:id', component: CaseDetailPage },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(
    { template: '<RouterView />' },
    {
      global: { plugins: [pinia, router] },
    },
  );
  await flushPromises();
  return { wrapper, router, auth };
}

async function createUnknownConfirmation(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('[data-test="confirm-disclose-false"]').setValue(true);
  await wrapper.get('[data-test="confirmation-review"]').trigger('click');
  await wrapper.get('[data-test="confirmation-submit"]').trigger('click');
  await flushPromises();
  return api.confirmCaseComplaint.mock.calls[0];
}

describe('case pages', () => {
  async function paginatedCases(total = 21) {
    const base = await api.listCases();
    const records = Array.from({ length: total }, (_, index) => ({
      ...base.items[0],
      id: `case-${index + 1}`,
      businessNo: `CA-${index + 1}`,
    }));
    api.listCases.mockImplementation((page: number, pageSize: number) =>
      Promise.resolve({
        ...base,
        items: records.slice((page - 1) * pageSize, page * pageSize),
        total: records.length,
        page,
        pageSize,
      }),
    );
    api.listCases.mockClear();
    return base;
  }

  it('pages 21 records, preserves exact links and disables the first and last boundaries', async () => {
    await paginatedCases();
    const wrapper = await mountRoute('/cases?view=department', CaseListPage);
    expect(wrapper.findAll('[data-test="case-list"] li')).toHaveLength(20);
    expect(
      wrapper.get('[data-test="previous-page"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('[data-test="next-page"]').trigger('click');
    await flushPromises();
    expect(api.listCases).toHaveBeenLastCalledWith(
      2,
      20,
      expect.objectContaining({ view: 'department' }),
    );
    expect(wrapper.findAll('[data-test="case-list"] li')).toHaveLength(1);
    expect(wrapper.get('[data-test="case-list"] a').attributes('href')).toBe(
      '/cases/case-21?view=department&page=2',
    );
    expect(wrapper.get('[data-test="case-list"]').text()).toContain('办理');
    expect(wrapper.text()).toContain('第 2 / 2 页');
    expect(
      wrapper.get('[data-test="next-page"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('[data-test="previous-page"]').trigger('click');
    await flushPromises();
    expect(api.listCases).toHaveBeenLastCalledWith(
      1,
      20,
      expect.objectContaining({ view: 'department' }),
    );
    wrapper.unmount();
  });

  it('restores URL pages on mount, refresh, back and forward', async () => {
    await paginatedCases();
    const wrapper = await mountRoute(
      '/cases?view=department&stage=WAITING_COMPLAINT&page=2',
      CaseListPage,
    );
    expect(api.listCases).toHaveBeenLastCalledWith(
      2,
      20,
      expect.objectContaining({ stage: 'WAITING_COMPLAINT' }),
    );
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '刷新')!
      .trigger('click');
    await flushPromises();
    expect(api.listCases.mock.calls.at(-1)?.[0]).toBe(2);
    await wrapper.get('[data-test="previous-page"]').trigger('click');
    await flushPromises();
    const router = wrapper.vm.$router;
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.query.page).toBe('2');
    expect(wrapper.text()).toContain('CA-21');
    router.forward();
    await flushPromises();
    expect(router.currentRoute.value.query.page).toBe('1');
    const url = '/cases?view=department&stage=WAITING_COMPLAINT&page=2';
    wrapper.unmount();
    const restored = await mountRoute(url, CaseListPage);
    expect(restored.text()).toContain('CA-21');
    restored.unmount();
  });

  it('opens the exact second-page case and returns from detail with the page preserved', async () => {
    await paginatedCases();
    const detail = await api.getCase();
    api.getCase.mockResolvedValue({
      ...detail,
      id: 'case-21',
      businessNo: 'CA-21',
    });
    api.getCase.mockClear();
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/cases', component: CaseListPage },
        { path: '/cases/:id', component: CaseDetailPage },
      ],
    });
    await router.push('/cases?view=department&page=2');
    await router.isReady();
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(RouterView, { global: { plugins: [pinia, router] } });
    await flushPromises();
    await wrapper.get('[data-test="case-list"] a').trigger('click');
    await flushPromises();
    expect(api.getCase).toHaveBeenCalledWith('case-21', expect.anything());
    const returnLink = wrapper.get('a');
    expect(returnLink.attributes('href')).toBe('/cases?view=department&page=2');
    await returnLink.trigger('click');
    await flushPromises();
    expect(api.listCases.mock.calls.at(-1)?.[0]).toBe(2);
    expect(wrapper.get('[data-test="case-list"]').text()).toContain('CA-21');
    wrapper.unmount();
  });

  it('moves to the new last page when the current final page becomes empty on refresh', async () => {
    const base = await paginatedCases();
    const wrapper = await mountRoute('/cases?page=2', CaseListPage);
    api.listCases
      .mockResolvedValueOnce({ ...base, items: [], total: 20, page: 2 })
      .mockResolvedValueOnce({ ...base, total: 20, page: 1 });
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '刷新')!
      .trigger('click');
    await flushPromises();
    expect(wrapper.vm.$route.query.page).toBe('1');
    expect(wrapper.text()).toContain('第 1 / 1 页');
    expect(
      wrapper.get('[data-test="next-page"]').attributes('disabled'),
    ).toBeDefined();
    wrapper.unmount();
  });

  it.each(['mine', 'department'] as const)(
    'resets page when switching from %s and restores the old scope on back',
    async (view) => {
      await paginatedCases();
      const wrapper = await mountRoute(
        `/cases?view=${view}&page=2`,
        CaseListPage,
      );
      const next = view === 'mine' ? 'department' : 'mine';
      await wrapper
        .findAll('button')
        .find(
          (button) =>
            button.text() === (next === 'mine' ? '我负责' : '本部门全部'),
        )!
        .trigger('click');
      await flushPromises();
      expect(api.listCases).toHaveBeenLastCalledWith(
        1,
        20,
        expect.objectContaining({ view: next }),
      );
      wrapper.vm.$router.back();
      await flushPromises();
      expect(api.listCases).toHaveBeenLastCalledWith(
        2,
        20,
        expect.objectContaining({ view }),
      );
      wrapper.unmount();
    },
  );

  it.each(['stage=WAITING_COMPLAINT', 'stageGroup=EXECUTION_PREPARATION'])(
    'resets an inherited page when %s changes',
    async (filter) => {
      await paginatedCases();
      const wrapper = await mountRoute(
        '/cases?view=department&page=2',
        CaseListPage,
      );
      await wrapper.vm.$router.push(`/cases?view=department&page=2&${filter}`);
      await flushPromises();
      expect(wrapper.vm.$route.query.page).toBe('1');
      expect(api.listCases.mock.calls.at(-1)?.[0]).toBe(1);
      expect(wrapper.text()).toContain('第 1 / 2 页');
      wrapper.unmount();
    },
  );

  it.each(['0', '-1', '1.5', 'abc', '9007199254740992', '2&page=3'])(
    'normalizes invalid page %s before requesting',
    async (page) => {
      await paginatedCases();
      const wrapper = await mountRoute(`/cases?page=${page}`, CaseListPage);
      expect(wrapper.vm.$route.query.page).toBe('1');
      expect(api.listCases.mock.calls.map((call) => call[0])).toEqual([1]);
      wrapper.unmount();
    },
  );

  it('recovers an out-of-range URL to the last available page', async () => {
    await paginatedCases();
    const wrapper = await mountRoute('/cases?page=8', CaseListPage);
    expect(api.listCases.mock.calls.map((call) => call[0])).toEqual([8, 2]);
    expect(wrapper.vm.$route.query.page).toBe('2');
    expect(wrapper.text()).toContain('CA-21');
    wrapper.unmount();
  });

  it('shows an empty result at page one with both boundaries disabled', async () => {
    await paginatedCases(0);
    const wrapper = await mountRoute('/cases?page=2', CaseListPage);
    expect(wrapper.vm.$route.query.page).toBe('1');
    expect(wrapper.text()).toContain('当前没有案件');
    expect(wrapper.text()).toContain('第 1 / 1 页');
    expect(
      wrapper.get('[data-test="previous-page"]').attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.get('[data-test="next-page"]').attributes('disabled'),
    ).toBeDefined();
    wrapper.unmount();
  });

  it('ignores a late old-page response after changing scope', async () => {
    const base = await paginatedCases();
    let resolveOld!: (value: unknown) => void;
    api.listCases.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    const wrapper = await mountRoute('/cases?page=2', CaseListPage);
    expect(wrapper.text()).toContain('正在读取案件');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '本部门全部')!
      .trigger('click');
    await flushPromises();
    expect(api.listCases.mock.calls[0]?.[2].signal.aborted).toBe(true);
    resolveOld({
      ...base,
      items: [{ ...base.items[0], businessNo: 'CA-stale' }],
      total: 80,
      page: 2,
    });
    await flushPromises();
    expect(wrapper.text()).not.toContain('CA-stale');
    expect(wrapper.text()).toContain('第 1 / 2 页');
    wrapper.unmount();
  });

  it('ignores a late previous-page success after URL navigation to the next page', async () => {
    const base = await paginatedCases();
    let resolveOld!: (value: unknown) => void;
    api.listCases.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    const wrapper = await mountRoute('/cases?page=1', CaseListPage);
    await wrapper.vm.$router.push('/cases?page=2');
    await flushPromises();
    resolveOld({
      ...base,
      items: [{ ...base.items[0], businessNo: 'CA-stale-page' }],
      total: 100,
    });
    await flushPromises();
    expect(wrapper.text()).toContain('CA-21');
    expect(wrapper.text()).not.toContain('CA-stale-page');
    expect(wrapper.text()).toContain('第 2 / 2 页');
    wrapper.unmount();
  });

  it('ignores a late old-page error and retries the current page after a failure', async () => {
    await paginatedCases();
    let rejectOld!: (reason: Error) => void;
    api.listCases.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectOld = reject;
      }),
    );
    const wrapper = await mountRoute('/cases?page=2', CaseListPage);
    await wrapper.vm.$router.push('/cases?page=1');
    await flushPromises();
    rejectOld(new ApiError('denied', 403, 'FORBIDDEN'));
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    api.listCases.mockRejectedValueOnce(
      new ApiError('denied', 403, 'FORBIDDEN'),
    );
    await wrapper.get('[data-test="next-page"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="case-list"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('当前账号无权读取案件');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '重新加载')!
      .trigger('click');
    await flushPromises();
    expect(api.listCases.mock.calls.at(-1)?.[0]).toBe(2);
    expect(wrapper.text()).toContain('CA-21');
    wrapper.unmount();
  });

  it('lists source identities and links to the internal read-only detail', async () => {
    const wrapper = await mountRoute('/cases', CaseListPage);
    expect(wrapper.get('[data-test="case-list"]').text()).toContain('LD-1');
    expect(wrapper.get('[data-test="case-list"]').text()).toContain('NZ-1');
    expect(wrapper.get('a[href="/cases/case-1"]').text()).toBe('CA-1');
  });

  it('loads the execution preparation group as one atomic-stage filter', async () => {
    const wrapper = await mountRoute(
      '/cases?view=department&stageGroup=EXECUTION_PREPARATION',
      CaseListPage,
    );
    expect(api.listCases).toHaveBeenCalledWith(
      1,
      20,
      expect.objectContaining({
        view: 'department',
        stageGroup: 'EXECUTION_PREPARATION',
      }),
    );
    const filter = api.listCases.mock.calls.at(-1)?.[2];
    expect(filter).not.toHaveProperty('stage');
    expect(wrapper.get('.page-head').text()).toContain('准备执行文书');
    expect(wrapper.get('a').attributes('href')).toContain(
      'stageGroup=EXECUTION_PREPARATION',
    );
  });

  it('labels an actionable complaint case as writable in the list', async () => {
    const base = await api.listCases();
    api.listCases.mockResolvedValueOnce({
      ...base,
      items: [
        {
          ...base.items[0],
          stage: 'WAITING_COMPLAINT',
          canMatch: false,
          canSubmitComplaint: true,
        },
      ],
    });
    const wrapper = await mountRoute('/cases', CaseListPage);
    expect(wrapper.get('[data-test="case-list"]').text()).toContain('办理');
    expect(wrapper.get('[data-test="case-list"]').text()).not.toContain('只读');
  });

  it('labels an execution-confirmation-only case as writable in the list', async () => {
    const base = await api.listCases();
    api.listCases.mockResolvedValueOnce({
      ...base,
      items: [
        {
          ...base.items[0],
          stage: 'WAITING_EXECUTION_CONFIRMATION',
          canSubmitExecution: false,
          canConfirmExecution: true,
        },
      ],
    });
    const wrapper = await mountRoute(
      '/cases?stage=WAITING_EXECUTION_CONFIRMATION',
      CaseListPage,
    );
    expect(wrapper.get('[data-test="case-list"]').text()).toContain('办理');
    expect(wrapper.get('[data-test="case-list"]').text()).not.toContain('只读');
  });

  it('shows one new case stage in the list using the formal acceptance label', async () => {
    const base = await api.listCases();
    api.listCases.mockResolvedValueOnce({
      ...base,
      items: [
        {
          ...base.items[0],
          stage: 'WAITING_FORMAL_ACCEPTANCE',
          canSubmitFiling: false,
        },
      ],
    });
    const wrapper = await mountRoute(
      '/cases?stage=WAITING_FORMAL_ACCEPTANCE',
      CaseListPage,
    );
    expect(wrapper.get('.page-head').text()).toContain('待正式立案');
    expect(wrapper.get('[data-test="case-list"]').text()).toContain(
      '待正式立案',
    );
  });

  it('labels WAITING_JUDGMENT without calling it a court judgment', async () => {
    const base = await api.listCases();
    api.listCases.mockResolvedValueOnce({
      ...base,
      items: [{ ...base.items[0], stage: 'WAITING_JUDGMENT' }],
    });
    const wrapper = await mountRoute(
      '/cases?stage=WAITING_JUDGMENT',
      CaseListPage,
    );
    expect(wrapper.get('.page-head').text()).toContain('待判决');
    expect(wrapper.get('[data-test="case-list"]').text()).toContain('待判决');
    expect(wrapper.text()).not.toContain('法院已判决');
  });

  it('labels both CA-009 stages in the internal case directory', async () => {
    const base = await api.listCases();
    for (const [stage, label] of [
      ['SECOND_INSTANCE', '二审'],
      ['WAITING_EXECUTION_DOCUMENTS', '待写执行材料'],
    ] as const) {
      api.listCases.mockResolvedValueOnce({
        ...base,
        items: [{ ...base.items[0], stage }],
      });
      const wrapper = await mountRoute(`/cases?stage=${stage}`, CaseListPage);
      expect(wrapper.get('.page-head').text()).toContain(label);
      expect(wrapper.get('[data-test="case-list"]').text()).toContain(label);
    }
  });

  it('parses and labels the execution confirmation stage and its action badge', async () => {
    const base = await api.listCases();
    api.listCases.mockResolvedValueOnce({
      ...base,
      items: [
        {
          ...base.items[0],
          id: 'execution-actionable',
          stage: 'WAITING_EXECUTION_CONFIRMATION',
          canMatch: false,
          canSubmitExecution: true,
        },
        {
          ...base.items[0],
          id: 'execution-readonly',
          stage: 'WAITING_EXECUTION_CONFIRMATION',
          canMatch: false,
          canSubmitExecution: false,
        },
      ],
    });

    const wrapper = await mountRoute(
      '/cases?stage=WAITING_EXECUTION_CONFIRMATION',
      CaseListPage,
    );

    expect(api.listCases).toHaveBeenLastCalledWith(
      1,
      20,
      expect.objectContaining({ stage: 'WAITING_EXECUTION_CONFIRMATION' }),
    );
    expect(wrapper.get('.page-head').text()).toContain('执行材料待确认');
    const rows = wrapper.findAll('[data-test="case-list"] li');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain('执行材料待确认');
    expect(rows[0]!.text()).toContain('办理');
    expect(rows[1]!.text()).toContain('只读');
  });

  it('shows the shared second-instance history on the internal case detail', async () => {
    const base = confirmationDetail('case-second-instance');
    const trialRoundId = '70000000-0000-4000-8000-000000000001';
    api.getCase.mockResolvedValueOnce({
      ...base,
      stage: 'SECOND_INSTANCE',
      judgmentNextStep: { current: null, history: [], revocations: [] },
      secondInstance: {
        currentTrialRoundId: null,
        currentProgress: null,
        currentResult: null,
        rounds: [
          {
            id: trialRoundId,
            sequence: 1,
            sourceResultId: null,
            revokedAt: null,
          },
        ],
        progresses: [],
        results: [],
        revocations: [],
      },
    });
    const wrapper = await mountRoute(
      '/cases/case-second-instance',
      CaseDetailPage,
    );
    expect(wrapper.find('[data-test="second-instance-panel"]').exists()).toBe(
      true,
    );
    expect(wrapper.text()).toContain('第1轮办理');
    expect(wrapper.text()).not.toContain('三审');
  });

  it('labels the execution confirmation stage on the internal case detail', async () => {
    api.getCase.mockResolvedValueOnce({
      ...(await api.getCase()),
      stage: 'WAITING_EXECUTION_CONFIRMATION',
    });
    const wrapper = await mountRoute('/cases/case-1', CaseDetailPage);
    expect(wrapper.get('.page-head').text()).toContain('执行材料待确认');
  });

  it('shows judgment registration on the internal detail only when authorized', async () => {
    const base = await api.getCase();
    api.getCase.mockResolvedValueOnce({
      ...base,
      stage: 'WAITING_JUDGMENT',
      canScheduleHearing: false,
      canCorrectHearing: false,
      canRegisterJudgment: true,
      canCorrectJudgment: false,
      acceptance: {
        acceptedAt: '2026-10-01',
        courtCaseNo: '甲0101民初1号',
        recordedAt: '2026-10-01T01:00:00Z',
        recordedByUserId: 'user-1',
      },
      judgment: { current: null, history: [], availableFiles: [] },
    });

    const wrapper = await mountRoute('/cases/case-1', CaseDetailPage);
    expect(wrapper.find('[data-test="case-judgment-panel"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="judgment-submit"]').exists()).toBe(true);
    expect(
      wrapper.find('[data-test="judgment-correction-form"]').exists(),
    ).toBe(false);
  });

  it('reads current case after a successful hearing command instead of trusting its receipt stage', async () => {
    api.getCase
      .mockResolvedValueOnce({
        ...confirmationDetail('case-1'),
        stage: 'WAITING_HEARING',
        canScheduleHearing: true,
        canCorrectHearing: false,
        acceptance: {
          acceptedAt: '2026-10-05',
          courtCaseNo: '甲0101民初1号',
          recordedAt: '2026-10-05T01:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        ...confirmationDetail('case-1'),
        stage: 'WAITING_JUDGMENT',
        version: 9,
        canScheduleHearing: false,
        canCorrectHearing: true,
        acceptance: {
          acceptedAt: '2026-10-05',
          courtCaseNo: '甲0101民初1号',
          recordedAt: '2026-10-05T01:00:00.000Z',
        },
      });
    const wrapper = await mountRoute('/cases/case-1', CaseDetailPage);
    await wrapper.get('[data-test="hearing-date"]').setValue('2026-10-05');
    await wrapper.get('[data-test="hearing-save"]').trigger('click');
    await flushPromises();

    expect(api.scheduleCaseHearing).toHaveBeenCalledTimes(1);
    expect(api.getCase).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('待判决');
    expect(
      wrapper.find('[data-test="hearing-correction-reason"]').exists(),
    ).toBe(true);
  });

  it('shows the filing form only for an authorized case awaiting filing', async () => {
    api.getCase.mockResolvedValueOnce({
      ...confirmationDetail('case-1', 'WAITING_COMPLAINT_STAMP', 5),
      stage: 'WAITING_FILING',
      canSubmitFiling: true,
      complaintMailing: null,
      filingSubmission: null,
    });
    const wrapper = await mountRoute('/cases/case-1', CaseDetailPage);
    expect(wrapper.find('[data-test="case-filing-panel"]').exists()).toBe(true);
    expect(api.listFilingCourts).toHaveBeenCalledWith('case-1');
  });

  it('shows the saved filing fact and confirmed amount read-only after submission', async () => {
    api.getCase.mockResolvedValueOnce({
      ...confirmationDetail('case-1', 'WAITING_COMPLAINT_STAMP', 6),
      stage: 'WAITING_FORMAL_ACCEPTANCE',
      canSubmitFiling: false,
      complaintMailing: null,
      filingSubmission: {
        court: { id: 'court-1', name: '甲市中级人民法院' },
        submittedAt: '2026-10-03',
        recordedAt: '2026-10-03T03:00:00Z',
        recordedByUserId: 'user-1',
        mediationNo: '诉调-001',
        evidenceFiles: [],
        screenshotFiles: [],
      },
    });
    const wrapper = await mountRoute('/cases/case-1', CaseDetailPage);
    expect(wrapper.text()).toContain('待正式立案');
    expect(wrapper.get('[data-test="case-filing-record"] h2').text()).toBe(
      '提交立案记录',
    );
    expect(wrapper.text()).toContain('甲市中级人民法院');
    expect(wrapper.text()).toContain('¥ 123.45');
    expect(wrapper.find('[data-test="case-filing-panel"]').exists()).toBe(
      false,
    );
  });

  it('uses sidebar scope and stage query and preserves them when opening a case', async () => {
    const wrapper = await mountRoute(
      '/cases?view=department&stage=WAITING_COMPLAINT',
      CaseListPage,
    );
    expect(api.listCases).toHaveBeenCalledWith(
      1,
      20,
      expect.objectContaining({
        view: 'department',
        stage: 'WAITING_COMPLAINT',
      }),
    );
    expect(wrapper.get('a').attributes('href')).toBe(
      '/cases/case-1?view=department&stage=WAITING_COMPLAINT',
    );
  });

  it.each(['mine', 'department'] as const)(
    'keeps the WAITING_FILING sidebar filter for the %s case list',
    async (view) => {
      const base = await api.listCases();
      api.listCases.mockResolvedValueOnce({
        ...base,
        items: [
          {
            ...base.items[0],
            id: `filing-${view}`,
            businessNo: `CA-FILING-${view}`,
            stage: 'WAITING_FILING',
          },
        ],
        total: 1,
        counts: { ...base.counts, WAITING_FILING: 1 },
      });
      const wrapper = await mountRoute(
        `/cases?view=${view}&stage=WAITING_FILING`,
        CaseListPage,
      );
      expect(api.listCases).toHaveBeenLastCalledWith(
        1,
        20,
        expect.objectContaining({ view, stage: 'WAITING_FILING' }),
      );
      expect(wrapper.get('.page-head').text()).toContain('待提交立案');
      expect(wrapper.get('[data-test="case-list"]').text()).toContain(
        `CA-FILING-${view}`,
      );
      expect(wrapper.findAll('li')).toHaveLength(1);
      wrapper.unmount();
    },
  );

  it('shows source, ownership, fee provenance and no invented court number', async () => {
    const wrapper = await mountRoute('/cases/case-1', CaseDetailPage);
    expect(wrapper.text()).toContain('客户甲');
    expect(wrapper.text()).toContain('来源公证事项：NZ-1');
    expect(wrapper.text()).toContain('来自公证事项取证记录');
    expect(wrapper.text()).toContain('法院案号：未登记');
    expect(wrapper.text()).not.toContain('/notary-portal/matters/');
  });

  it('uploads both complaint material groups separately, then confirms exact versions', async () => {
    const base = await api.getCase();
    const before = {
      ...base,
      stage: 'WAITING_COMPLAINT',
      canSubmitComplaint: true,
      version: 7,
    };
    const after = {
      ...base,
      stage: 'WAITING_COMPLAINT_CONFIRMATION',
      canSubmitComplaint: false,
      version: 8,
      complaint: {
        amountState: 'KNOWN',
        amount: '0',
        pendingReason: null,
        submittedAt: '2026-09-30T01:00:00Z',
        submittedByUserId: 'user-1',
        complaintFiles: [
          {
            materialId: 'complaint-material',
            contentVersionId: 'complaint-v1',
            originalFilename: '诉状.pdf',
            mimeType: 'application/pdf',
          },
        ],
        authorizationFiles: [
          {
            materialId: 'authorization-material',
            contentVersionId: 'authorization-v1',
            originalFilename: '授权书.pdf',
            mimeType: 'application/pdf',
          },
        ],
      },
    };
    api.getCase.mockReset();
    api.getCase.mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    api.uploadMaterialFile
      .mockResolvedValueOnce({
        materialId: 'complaint-material',
        contentVersionId: 'complaint-v1',
        originalFilename: '诉状.pdf',
        mimeType: 'application/pdf',
      })
      .mockResolvedValueOnce({
        materialId: 'authorization-material',
        contentVersionId: 'authorization-v1',
        originalFilename: '授权书.pdf',
        mimeType: 'application/pdf',
      });
    api.submitComplaint.mockResolvedValue(undefined);

    const wrapper = await mountRoute('/cases/case-1', CaseDetailPage);
    const form = wrapper.get('[data-test="complaint-submit-form"]');
    expect(form.text()).toContain('上传不会推进案件');
    expect(form.text()).not.toContain('确认诉状');
    await wrapper.get('[data-test="submit-complaint"]').trigger('click');
    expect(wrapper.text()).toContain('请至少上传 1 份起诉状和 1 份授权材料。');
    expect(api.submitComplaint).not.toHaveBeenCalled();

    for (const [index, filename] of ['诉状.pdf', '授权书.pdf'].entries()) {
      const input = wrapper.findAll('input[type="file"]')[index]!;
      Object.defineProperty(input.element, 'files', {
        configurable: true,
        value: [new File(['content'], filename, { type: 'application/pdf' })],
      });
      await input.trigger('change');
      await flushPromises();
    }
    expect(api.getCase).toHaveBeenCalledTimes(1);
    await wrapper
      .get('[data-test="complaint-submit-form"] input[inputmode="decimal"]')
      .setValue('0');
    await wrapper.get('[data-test="submit-complaint"]').trigger('click');
    await flushPromises();
    expect(api.submitComplaint).toHaveBeenCalledWith(
      'case-1',
      expect.objectContaining({
        expectedVersion: 7,
        amountState: 'KNOWN',
        amount: '0',
        complaintContentVersionIds: ['complaint-v1'],
        authorizationContentVersionIds: ['authorization-v1'],
      }),
    );
    expect(wrapper.get('.page-head').text()).toContain('诉状待确认');
    const submitted = wrapper.get('[data-test="complaint-read-only"]');
    expect(submitted.text()).toContain('标的额：¥ 0');
    expect(submitted.text()).toContain('诉状.pdf');
    expect(submitted.text()).toContain('授权书.pdf');
    expect(wrapper.find('[data-test="complaint-submit-form"]').exists()).toBe(
      false,
    );
  });

  it('saves defendants and lawyer, reloads detail, and confirms the real transition', async () => {
    const candidate = {
      lawyerAccountId: 'lawyer-account-1',
      username: 'lawyer.a',
      displayName: '律师甲',
      lawyerProfileId: 'lawyer-profile-1',
    };
    api.listLawyerMatchCandidates.mockResolvedValue([candidate]);
    api.matchCase.mockResolvedValue(undefined);
    const wrapper = await mountRoute('/cases/case-1', CaseDetailPage);
    const eventSpy = vi.spyOn(window, 'dispatchEvent');
    api.getCase.mockResolvedValueOnce({
      id: 'case-1',
      businessNo: 'CA-1',
      stage: 'WAITING_COMPLAINT',
      createdAt: '2026-09-28T00:00:00Z',
      version: 2,
      canMatch: false,
      owner: { id: 'user-1', displayName: '负责人' },
      courtCaseNo: null,
      department: { id: 'department-1', name: '知产部' },
      customer: { id: 'customer-1', name: '客户甲' },
      rightsHolder: { id: 'holder-1', name: '权利人甲' },
      sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
      sourceNotaryMatter: { id: 'matter-1', businessNo: 'NZ-1' },
      certificate: {
        certificateNo: 'Z-100',
        certificateDate: '2026-09-28',
        issuedAt: '2026-09-28T00:00:00Z',
        needDisclose: false,
        files: [],
        disclosureFiles: [],
      },
      fees: [],
      defendants: [
        {
          id: 'defendant-1',
          kind: 'PERSON',
          name: '被告甲',
          idNo: null,
          phone: null,
          address: null,
        },
      ],
      lawyers: [
        {
          id: 'case-lawyer-1',
          fullName: '律师甲',
          lawFirm: '甲律所',
          phone: '13900000000',
          role: 'PRIMARY',
          assignedAt: '2026-09-29T01:00:00Z',
        },
      ],
      matchedAt: '2026-09-29T01:00:00Z',
      matchedOn: '2026-09-28',
      canSaveSecondInstance: false,
      canRegisterSecondInstanceResult: false,
      canRevokeSecondInstanceResult: false,
      acceptances: [],
      canSubmitExecution: false,
      executionSubmission: {
        current: null,
        submissions: [],
        availableFiles: [],
      },
      secondInstance: {
        currentTrialRoundId: null,
        currentProgress: null,
        currentResult: null,
        rounds: [],
        progresses: [],
        results: [],
        revocations: [],
      },
    });
    const form = wrapper.get('[data-test="case-match-form"]');
    expect(
      (form.get('input[type="date"]').element as HTMLInputElement).value,
    ).toBe('2026-09-29');
    await form.get('input[type="date"]').setValue('2026-09-28');
    await form.findAll('input')[1]!.setValue('被告甲');
    const lawyerOption = form
      .findAll('option')
      .find((option) => option.text().includes('律师甲（lawyer.a）'))!;
    expect(lawyerOption).toBeDefined();
    await lawyerOption.setValue();
    await wrapper
      .findAll('[data-test="case-match-form"] button')
      .find((button) => button.text().includes('确认匹配'))!
      .trigger('click');
    await flushPromises();
    expect(api.matchCase).toHaveBeenCalledWith(
      'case-1',
      expect.objectContaining({
        expectedVersion: 1,
        defendants: [
          expect.objectContaining({ name: '被告甲', kind: 'PERSON' }),
        ],
        lawyerAccountId: candidate.lawyerAccountId,
        lawyerProfileId: candidate.lawyerProfileId,
        matchedOn: '2026-09-28',
      }),
    );
    expect(api.listLawyerMatchCandidates).toHaveBeenCalledWith('case-1', '', {
      signal: expect.any(AbortSignal),
    });
    expect(api.getCase).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('案件匹配已完成');
    expect(wrapper.get('.page-head').text()).toContain('待写诉状');
    expect(wrapper.text()).toContain('律师甲（甲律所）');
    expect(wrapper.text()).toContain('实际匹配日期：2026-09-28');
    expect(wrapper.find('[data-test="case-match-form"]').exists()).toBe(false);
    expect(eventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: workflowChangedEvent }),
    );
  });

  it('explains read-only access after matching as well as while awaiting matching', async () => {
    const pending = await api.getCase();
    api.getCase.mockResolvedValueOnce({
      ...pending,
      stage: 'WAITING_COMPLAINT',
      canMatch: false,
      matchedAt: '2026-09-29T01:00:00Z',
      matchedOn: null,
    });
    const wrapper = await mountRoute('/cases/case-1', CaseDetailPage);
    expect(wrapper.find('[data-test="case-match-form"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="case-read-only"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="case-read-only"]').text()).toContain(
      '查看案件和下载获准材料',
    );
    expect(wrapper.get('[data-test="case-read-only"]').text()).toContain(
      '匹配已完成',
    );
    expect(wrapper.text()).toContain('实际匹配日期：未记录');
    expect(wrapper.text()).toContain('系统登记时间');
  });

  it('does not expose matching controls when the case is not actionable', async () => {
    api.getCase.mockResolvedValueOnce({
      id: 'case-1',
      businessNo: 'CA-1',
      stage: 'PENDING_MATCH',
      createdAt: '2026-09-28T00:00:00Z',
      version: 1,
      canMatch: false,
      owner: { id: 'user-1', displayName: '同部门负责人' },
      courtCaseNo: null,
      department: { id: 'department-1', name: '知产部' },
      customer: { id: 'customer-1', name: '客户甲' },
      rightsHolder: { id: 'holder-1', name: '权利人甲' },
      sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
      sourceNotaryMatter: { id: 'matter-1', businessNo: 'NZ-1' },
      certificate: {
        certificateNo: 'Z-100',
        certificateDate: '2026-09-28',
        issuedAt: '2026-09-28T00:00:00Z',
        needDisclose: false,
        files: [],
        disclosureFiles: [],
      },
      fees: [],
      defendants: [],
      lawyers: [],
      matchedAt: null,
      matchedOn: null,
      canSaveSecondInstance: false,
      canRegisterSecondInstanceResult: false,
      canRevokeSecondInstanceResult: false,
      acceptances: [],
      canSubmitExecution: false,
      executionSubmission: {
        current: null,
        submissions: [],
        availableFiles: [],
      },
      secondInstance: {
        currentTrialRoundId: null,
        currentProgress: null,
        currentResult: null,
        rounds: [],
        progresses: [],
        results: [],
        revocations: [],
      },
    });
    const wrapper = await mountRoute('/cases/case-1', CaseDetailPage);
    expect(wrapper.find('[data-test="case-match-form"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="case-read-only"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="case-read-only"]').text()).toContain(
      '当前账号不能办理此案',
    );
  });

  it('keeps the original confirmation body and key when refresh remains pending', async () => {
    const pending = confirmationDetail('case-a');
    const refreshed = confirmationDetail(
      'case-a',
      'WAITING_COMPLAINT_CONFIRMATION',
      4,
    );
    api.getCase.mockResolvedValueOnce(pending).mockResolvedValueOnce(refreshed);
    api.confirmCaseComplaint
      .mockRejectedValueOnce(new ApiError('timeout', 0, 'NETWORK_ERROR'))
      .mockResolvedValueOnce({
        id: 'case-a',
        stage: 'WAITING_COMPLAINT_STAMP',
        version: 4,
        confirmedAt: '2026-10-02T02:00:00Z',
      });
    const { wrapper } = await mountRoutedDetail('/cases/case-a');

    const originalRequest = await createUnknownConfirmation(wrapper);
    await wrapper.get('[data-test="confirmation-check"]').trigger('click');
    await flushPromises();
    expect(
      wrapper.find('[data-test="complaint-confirmation-panel"]').exists(),
    ).toBe(true);
    await wrapper.get('[data-test="confirmation-retry"]').trigger('click');
    await flushPromises();

    expect(api.confirmCaseComplaint.mock.calls[1]).toEqual(originalRequest);
  });

  it('keeps the original confirmation body and key after a transient refresh failure', async () => {
    const pending = confirmationDetail('case-a');
    api.getCase
      .mockResolvedValueOnce(pending)
      .mockRejectedValueOnce(
        new ApiError('unavailable', 503, 'SERVICE_UNAVAILABLE'),
      );
    api.confirmCaseComplaint
      .mockRejectedValueOnce(new ApiError('timeout', 0, 'NETWORK_ERROR'))
      .mockResolvedValueOnce({
        id: 'case-a',
        stage: 'WAITING_COMPLAINT_STAMP',
        version: 4,
        confirmedAt: '2026-10-02T02:00:00Z',
      });
    const { wrapper } = await mountRoutedDetail('/cases/case-a');

    const originalRequest = await createUnknownConfirmation(wrapper);
    await wrapper.get('[data-test="confirmation-check"]').trigger('click');
    await flushPromises();
    expect(
      wrapper.find('[data-test="complaint-confirmation-panel"]').exists(),
    ).toBe(true);
    expect(wrapper.text()).toContain('详情读取失败');
    await wrapper.get('[data-test="confirmation-retry"]').trigger('click');
    await flushPromises();

    expect(api.confirmCaseComplaint.mock.calls[1]).toEqual(originalRequest);
  });

  it('locks confirmation after success while the same-case detail refresh is pending', async () => {
    let resolveRefresh!: (value: ReturnType<typeof confirmationDetail>) => void;
    api.getCase
      .mockResolvedValueOnce(confirmationDetail('case-a'))
      .mockReturnValueOnce(
        new Promise((resolve) => (resolveRefresh = resolve)) as ReturnType<
          typeof api.getCase
        >,
      );
    api.confirmCaseComplaint.mockResolvedValueOnce({
      id: 'case-a',
      stage: 'WAITING_COMPLAINT_STAMP',
      version: 4,
      confirmedAt: '2026-10-02T02:00:00Z',
    });
    const { wrapper } = await mountRoutedDetail('/cases/case-a');

    await wrapper.get('[data-test="confirm-disclose-false"]').setValue(true);
    await wrapper.get('[data-test="confirmation-review"]').trigger('click');
    await wrapper.get('[data-test="confirmation-submit"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain(
      '确认已成功，正在同步案件详情；暂不可再次确认。',
    );
    expect(wrapper.find('[data-test="confirmation-review"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-test="confirmation-form"]').exists()).toBe(
      false,
    );
    expect(api.confirmCaseComplaint).toHaveBeenCalledTimes(1);
    resolveRefresh(confirmationDetail('case-a'));
    await flushPromises();
    expect(wrapper.find('[data-test="confirmation-review"]').exists()).toBe(
      false,
    );
    expect(api.confirmCaseComplaint).toHaveBeenCalledTimes(1);
  });

  it('keeps successful confirmation locked after a transient detail failure until facts arrive', async () => {
    api.getCase
      .mockResolvedValueOnce(confirmationDetail('case-a'))
      .mockRejectedValueOnce(
        new ApiError('unavailable', 503, 'SERVICE_UNAVAILABLE'),
      )
      .mockResolvedValueOnce(
        confirmationDetail('case-a', 'WAITING_COMPLAINT_STAMP', 4),
      );
    api.confirmCaseComplaint.mockResolvedValueOnce({
      id: 'case-a',
      stage: 'WAITING_COMPLAINT_STAMP',
      version: 4,
      confirmedAt: '2026-10-02T02:00:00Z',
    });
    const { wrapper } = await mountRoutedDetail('/cases/case-a');

    await wrapper.get('[data-test="confirm-disclose-false"]').setValue(true);
    await wrapper.get('[data-test="confirmation-review"]').trigger('click');
    await wrapper.get('[data-test="confirmation-submit"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain(
      '确认已成功，正在同步案件详情；暂不可再次确认。',
    );
    expect(wrapper.text()).toContain('详情读取失败');
    expect(wrapper.find('[data-test="confirmation-review"]').exists()).toBe(
      false,
    );
    expect(api.confirmCaseComplaint).toHaveBeenCalledTimes(1);

    await wrapper
      .get('[data-test="confirmation-success-check"]')
      .trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('诉状确认记录');
    expect(
      wrapper.find('[data-test="confirmed-complaint-record"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-test="confirmation-review"]').exists()).toBe(
      false,
    );
    expect(api.confirmCaseComplaint).toHaveBeenCalledTimes(1);
  });

  it('clears retry state when refresh observes the confirmed server fact', async () => {
    const pending = confirmationDetail('case-a');
    const confirmed = confirmationDetail(
      'case-a',
      'WAITING_COMPLAINT_STAMP',
      4,
    );
    api.getCase.mockResolvedValueOnce(pending).mockResolvedValueOnce(confirmed);
    api.confirmCaseComplaint.mockRejectedValueOnce(
      new ApiError('timeout', 0, 'NETWORK_ERROR'),
    );
    const { wrapper } = await mountRoutedDetail('/cases/case-a');

    await createUnknownConfirmation(wrapper);
    await wrapper.get('[data-test="confirmation-check"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('CA-case-a');
    expect(wrapper.text()).toContain('诉状确认记录');
    expect(
      wrapper.find('[data-test="confirmed-complaint-record"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-test="confirmation-retry"]').exists()).toBe(
      false,
    );
  });

  it.each([403, 404])(
    'clears the previous case detail when refresh returns %i',
    async (status) => {
      api.getCase
        .mockResolvedValueOnce(confirmationDetail('case-a'))
        .mockRejectedValueOnce(
          new ApiError(
            'not accessible',
            status,
            status === 403 ? 'FORBIDDEN' : 'NOT_FOUND',
          ),
        );
      const { wrapper } = await mountRoutedDetail('/cases/case-a');

      await wrapper
        .findAll('button')
        .find((button) => button.text() === '刷新')!
        .trigger('click');
      await flushPromises();

      expect(wrapper.text()).not.toContain('CA-case-a');
      expect(
        wrapper.find('[data-test="complaint-confirmation-panel"]').exists(),
      ).toBe(false);
    },
  );

  it('clears judgment files and next-step projection when a choice is denied and refresh returns 403', async () => {
    api.getCase
      .mockResolvedValueOnce(judgmentDetailWithChoiceCapability('case-a'))
      .mockRejectedValueOnce(new ApiError('not accessible', 403, 'FORBIDDEN'));
    api.chooseCaseJudgmentNextStep.mockRejectedValueOnce(
      new ApiError('no longer authorized', 403, 'ACTION_FORBIDDEN'),
    );
    const { wrapper } = await mountRoutedDetail('/cases/case-a');
    const next = wrapper.get('[data-test="case-judgment-next-step-panel"]');
    expect(wrapper.text()).toContain('内部判决.pdf');

    await next.get('input[value="EXECUTION"]').setValue();
    await next.get('input[type="checkbox"]').setValue(true);
    await next.get('form').trigger('submit');
    await next.get('[data-confirm-choice]').trigger('click');
    await flushPromises();

    expect(api.chooseCaseJudgmentNextStep).toHaveBeenCalledTimes(1);
    expect(api.getCase).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).not.toContain('内部判决.pdf');
    expect(wrapper.find('[data-test="judgment-current"]').exists()).toBe(false);
    expect(
      wrapper.find('[data-test="case-judgment-next-step-panel"]').exists(),
    ).toBe(false);
    expect(wrapper.get('h1').text()).toBe('案件暂时无法读取');
  });

  it('loads route B in the reused RouterView and ignores a late detail response for A', async () => {
    let resolveA!: (value: ReturnType<typeof confirmationDetail>) => void;
    api.getCase
      .mockReturnValueOnce(
        new Promise((resolve) => (resolveA = resolve)) as ReturnType<
          typeof api.getCase
        >,
      )
      .mockResolvedValueOnce(confirmationDetail('case-b'));
    const { wrapper, router } = await mountRoutedDetail('/cases/case-a');

    await router.push('/cases/case-b');
    await flushPromises();
    expect(wrapper.text()).toContain('CA-case-b');
    resolveA(confirmationDetail('case-a'));
    await flushPromises();

    expect(router.currentRoute.value.params.id).toBe('case-b');
    expect(wrapper.text()).toContain('CA-case-b');
    expect(wrapper.text()).not.toContain('CA-case-a');
  });

  it('does not let a late confirmation POST for route A update route B', async () => {
    let resolvePost!: (value: unknown) => void;
    api.getCase
      .mockResolvedValueOnce(confirmationDetail('case-a'))
      .mockResolvedValueOnce(confirmationDetail('case-b'));
    api.confirmCaseComplaint.mockReturnValueOnce(
      new Promise((resolve) => (resolvePost = resolve)),
    );
    const { wrapper, router } = await mountRoutedDetail('/cases/case-a');

    await createUnknownConfirmation(wrapper);
    await router.push('/cases/case-b');
    await flushPromises();
    expect(wrapper.text()).toContain('CA-case-b');
    expect(wrapper.text()).not.toContain('CA-case-a');
    resolvePost({
      id: 'case-a',
      stage: 'WAITING_COMPLAINT_STAMP',
      version: 4,
      confirmedAt: '2026-10-02T02:00:00Z',
    });
    await flushPromises();

    expect(wrapper.text()).toContain('CA-case-b');
    expect(wrapper.text()).not.toContain('CA-case-a');
    expect(
      wrapper.find('[data-test="confirmed-complaint-record"]').exists(),
    ).toBe(false);
  });

  it('reloads and ignores a late detail response when authorization revision changes', async () => {
    let resolveOld!: (value: ReturnType<typeof confirmationDetail>) => void;
    const stale = confirmationDetail('case-a');
    stale.businessNo = 'CA-stale';
    const current = confirmationDetail('case-a');
    current.businessNo = 'CA-current';
    api.getCase
      .mockReturnValueOnce(
        new Promise((resolve) => (resolveOld = resolve)) as ReturnType<
          typeof api.getCase
        >,
      )
      .mockResolvedValueOnce(current);
    const { wrapper, auth } = await mountRoutedDetail('/cases/case-a');

    auth.session!.authorizationRevision = 2;
    await flushPromises();
    expect(wrapper.text()).toContain('CA-current');
    resolveOld(stale);
    await flushPromises();

    expect(wrapper.text()).toContain('CA-current');
    expect(wrapper.text()).not.toContain('CA-stale');
  });

  it('reloads and ignores a late detail response when the signed-in user changes', async () => {
    let resolveOld!: (value: ReturnType<typeof confirmationDetail>) => void;
    const stale = confirmationDetail('case-a');
    stale.businessNo = 'CA-stale-user';
    const current = confirmationDetail('case-a');
    current.businessNo = 'CA-current-user';
    api.getCase
      .mockReturnValueOnce(
        new Promise((resolve) => (resolveOld = resolve)) as ReturnType<
          typeof api.getCase
        >,
      )
      .mockResolvedValueOnce(current);
    const { wrapper, auth } = await mountRoutedDetail('/cases/case-a');

    auth.session!.user.id = 'user-2';
    await flushPromises();
    expect(wrapper.text()).toContain('CA-current-user');
    resolveOld(stale);
    await flushPromises();

    expect(wrapper.text()).toContain('CA-current-user');
    expect(wrapper.text()).not.toContain('CA-stale-user');
  });

  it('does not apply a late complaint upload from route A to route B', async () => {
    let resolveUpload!: (value: {
      materialId: string;
      contentVersionId: string;
      originalFilename: string;
      mimeType: string;
    }) => void;
    const caseA = {
      ...confirmationDetail('case-a'),
      stage: 'WAITING_COMPLAINT' as const,
      canSubmitComplaint: true,
      canConfirmComplaint: false,
      complaint: null,
    };
    const caseB = { ...caseA, id: 'case-b', businessNo: 'CA-case-b' };
    api.getCase.mockResolvedValueOnce(caseA).mockResolvedValueOnce(caseB);
    api.uploadMaterialFile.mockReturnValueOnce(
      new Promise((resolve) => (resolveUpload = resolve)),
    );
    const { wrapper, router } = await mountRoutedDetail('/cases/case-a');
    const input = wrapper.get(
      '[data-test="complaint-submit-form"] input[type="file"]',
    );
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['late'], 'late-A.pdf', { type: 'application/pdf' })],
    });

    await input.trigger('change');
    await router.push('/cases/case-b');
    await flushPromises();
    resolveUpload({
      materialId: 'material-a',
      contentVersionId: 'version-a-late',
      originalFilename: 'late-A.pdf',
      mimeType: 'application/pdf',
    });
    await flushPromises();

    expect(wrapper.text()).toContain('CA-case-b');
    expect(wrapper.text()).not.toContain('late-A.pdf');
  });

  it('does not apply a late matching response from route A to route B', async () => {
    let resolveMatch!: (value: undefined) => void;
    const caseA = {
      ...confirmationDetail('case-a'),
      stage: 'PENDING_MATCH' as const,
      canMatch: true,
    };
    const caseB = {
      ...confirmationDetail('case-b'),
      stage: 'PENDING_MATCH' as const,
      canMatch: true,
    };
    api.getCase.mockResolvedValueOnce(caseA).mockResolvedValueOnce(caseB);
    api.matchCase.mockReturnValueOnce(
      new Promise((resolve) => (resolveMatch = resolve)),
    );
    const { wrapper, router } = await mountRoutedDetail('/cases/case-a');
    const form = wrapper.get('[data-test="case-match-form"]');
    await form.findAll('input')[1]!.setValue('被告甲');
    await form.findAll('input')[5]!.setValue('律师甲');
    await form
      .findAll('button')
      .find((button) => button.text().includes('确认匹配并进入待写诉状'))!
      .trigger('click');

    await router.push('/cases/case-b');
    await flushPromises();
    resolveMatch(undefined);
    await flushPromises();

    expect(wrapper.text()).toContain('CA-case-b');
    expect(wrapper.text()).not.toContain('案件匹配已完成');
  });

  it('does not expose a late download failure from A in reused route B', async () => {
    let rejectDownload!: (reason: Error) => void;
    const caseA = confirmationDetail('case-a');
    const caseB = confirmationDetail('case-b');
    api.getCase.mockResolvedValueOnce(caseA).mockResolvedValueOnce(caseB);
    api.downloadMaterialVersion.mockReturnValueOnce(
      new Promise((_, reject) => (rejectDownload = reject)),
    );
    const { wrapper, router } = await mountRoutedDetail('/cases/case-a');

    await wrapper
      .findAll('button')
      .find((button) => button.text() === '下载')!
      .trigger('click');
    await router.push('/cases/case-b');
    await flushPromises();
    rejectDownload(new Error('download failed'));
    await flushPromises();

    expect(wrapper.text()).toContain('CA-case-b');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
});
