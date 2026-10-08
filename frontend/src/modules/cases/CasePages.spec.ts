import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
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
  it('lists source identities and links to the internal read-only detail', async () => {
    const wrapper = await mountRoute('/cases', CaseListPage);
    expect(wrapper.get('[data-test="case-list"]').text()).toContain('LD-1');
    expect(wrapper.get('[data-test="case-list"]').text()).toContain('NZ-1');
    expect(wrapper.get('a[href="/cases/case-1"]').text()).toBe('CA-1');
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
