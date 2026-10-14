import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseDetail } from '../../api/cases';
import type { LeadDetail } from '../../api/leads';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import CaseDetailPage from './CaseDetailPage.vue';
import App from '../../app/App.vue';
import CaseWorkspaceFiles from './CaseWorkspaceFiles.vue';
import CaseDetailsSections from './CaseDetailsSections.vue';
import CaseComplaintSubmissionForm from './CaseComplaintSubmissionForm.vue';
import CaseHearingPanel from './CaseHearingPanel.vue';
import CaseAcceptanceCorrectionPanel from './CaseAcceptanceCorrectionPanel.vue';
import CaseDefendantContactPanel from './CaseDefendantContactPanel.vue';
import { ElDrawer } from 'element-plus/es/components/drawer/index.mjs';

const api = vi.hoisted(() => ({
  getCase: vi.fn(),
  getLead: vi.fn(),
  listOwnerMaterials: vi.fn(),
  downloadMaterialVersion: vi.fn(),
  submitComplaint: vi.fn(),
  matchCase: vi.fn(),
  listLawyerMatchCandidates: vi.fn(),
  scheduleCaseHearing: vi.fn(),
  registerCaseAcceptance: vi.fn(),
  uploadMaterialFile: vi.fn(),
  listFilingCourts: vi.fn(),
}));
vi.mock('../../api/cases', async (original) => ({
  ...(await original<typeof import('../../api/cases')>()),
  getCase: api.getCase,
  submitComplaint: api.submitComplaint,
  matchCase: api.matchCase,
  listLawyerMatchCandidates: api.listLawyerMatchCandidates,
  scheduleCaseHearing: api.scheduleCaseHearing,
  registerCaseAcceptance: api.registerCaseAcceptance,
  listFilingCourts: api.listFilingCourts,
}));
vi.mock('../../api/leads', () => ({ getLead: api.getLead }));
vi.mock('../../api/materials', async (original) => ({
  ...(await original<typeof import('../../api/materials')>()),
  listOwnerMaterials: api.listOwnerMaterials,
  downloadMaterialVersion: api.downloadMaterialVersion,
  uploadMaterialFile: api.uploadMaterialFile,
}));
const baseItem: CaseDetail = {
  id: 'case-1',
  businessNo: 'CA-1',
  stage: 'WAITING_JUDGMENT',
  createdAt: '2026-09-28T00:00:00.000Z',
  version: 7,
  owner: { id: 'user-1', displayName: '负责人' },
  canMatch: false,
  canSubmitComplaint: false,
  canConfirmComplaint: false,
  canMailComplaint: false,
  canMailExecution: false,
  canSubmitExecutionFiling: false,
  canFinishExecution: false,
  canRecordClosure: false,
  canCorrectClosure: false,
  canArchive: false,
  canCorrectArchive: false,
  canSubmitFiling: false,
  canRegisterAcceptance: false,
  canUploadAcceptanceMaterials: false,
  canScheduleHearing: false,
  canCorrectHearing: false,
  canRegisterJudgment: false,
  canCorrectJudgment: false,
  canChooseJudgmentNextStep: false,
  canRevokeJudgmentNextStep: false,
  canSaveSecondInstance: false,
  canRegisterSecondInstanceResult: false,
  canRevokeSecondInstanceResult: false,
  canSubmitExecution: false,
  executionSubmission: { current: null, submissions: [], availableFiles: [] },
  canConfirmExecution: false,
  executionConfirmation: null,
  executionMailing: null,
  executionFiling: null,
  executionFinish: null,
  closure: null,
  archive: null,
  sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
  sourceNotaryMatter: { id: 'matter-1', businessNo: 'NZ-1' },
  courtCaseNo: '（2026）甲0101民初1号',
  department: { id: 'department-1', name: '知产部' },
  customer: { id: 'customer-1', name: '客户甲' },
  rightsHolder: { id: 'holder-1', name: '权利人甲' },
  certificate: {
    certificateNo: 'Z-100',
    certificateDate: '2026-09-28',
    issuedAt: '2026-09-28T00:00:00.000Z',
    needDisclose: false,
    files: [],
    disclosureFiles: [],
  },
  fees: [],
  defendants: [],
  lawyers: [],
  matchedAt: null,
  matchedOn: null,
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
  judgmentNextStep: { current: null, history: [], revocations: [] },
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
};
const sourceLead = {
  id: 'lead-1',
  businessNo: 'LD-20260921-001',
  customerId: 'customer-1',
  rightsHolderId: 'holder-1',
  displayNames: {
    customerName: '客户甲',
    rightsHolderName: '主体甲',
    responsibleUserName: '运营甲',
  },
  status: 'WAITING_PUSH',
  caseType: 'CIVIL',
  infringementTypes: ['TRADEMARK'],
  source: 'ONLINE',
  platform: 'TAOBAO',
  foundAt: '2026-09-21T04:00:00Z',
  shopName: '测试店铺',
  shopExternalId: null,
  needDisclose: true,
  remark: '备注',
  products: [
    {
      id: 'p',
      position: 1,
      title: '商品甲',
      url: null,
      quantity: 2,
      unitPrice: '3.00',
      commentCount: 0,
      estimatedAmount: '6.00',
    },
  ],
  leadScreenshotContentVersionIds: ['version-1'],
  version: 1,
  pushedAt: null,
  pushedByUserId: null,
  pushedByDisplayName: null,
  reviewDecision: null,
  createdAt: '2026-09-21T04:00:00Z',
  updatedAt: '2026-09-21T04:00:00Z',
  capabilities: {
    edit: true,
    push: true,
    withdrawApply: false,
    evidenceDecide: false,
    transferToNotary: false,
    createEvidenceBatch: false,
  },
  notaryMatters: [],
  pendingWithdrawalApplication: null,
  evidenceDecision: null,
  history: [],
  departmentId: 'd',
  responsibleUserId: 'u',
  teamId: null,
  creationChannel: 'MANUAL',
  externalSourceRef: null,
} satisfies LeadDetail;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const wrappers: VueWrapper[] = [];
async function render(
  item = structuredClone(baseItem),
  path = '/cases/case-1',
  realDrawer = false,
) {
  api.getCase.mockResolvedValue(item);
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore(pinia);
  auth.session = {
    principalType: 'INTERNAL',
    user: { id: 'operator-1', username: 'actor', displayName: '办理人' },
    department: { id: 'department-1', name: '知产部' },
    departments: [],
    customer: null,
    notaryOffice: null,
    authorizationRevision: 1,
    expiresAt: '2026-10-15T00:00:00Z',
    csrfToken: 'csrf',
  };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/cases', component: { template: '<div />' } },
      { path: '/cases/:id', component: CaseDetailPage },
      { path: '/leads/:id/edit', component: { template: '<div />' } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(CaseDetailPage, {
    attachTo: document.body,
    global: {
      plugins: [pinia, router],
      stubs: realDrawer
        ? {}
        : {
            ElDrawer: {
              props: ['modelValue'],
              template:
                '<div v-show="modelValue" role="dialog" class="case-workspace-editors"><slot /></div>',
            },
          },
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, router, auth };
}
async function renderSpa(item: CaseDetail, realDrawer = false) {
  api.getCase.mockResolvedValue(item);
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore(pinia);
  auth.session = {
    principalType: 'INTERNAL',
    user: { id: 'operator-1', username: 'actor', displayName: 'Operator' },
    department: { id: 'department-1', name: 'Legal' },
    departments: [],
    customer: null,
    notaryOffice: null,
    authorizationRevision: 1,
    expiresAt: '2026-10-15T00:00:00Z',
    csrfToken: 'csrf',
  };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/cases',
        component: { template: '<div data-test="case-list-route" />' },
      },
      {
        path: '/calendar',
        component: { template: '<div data-test="calendar-route" />' },
      },
      {
        path: '/cases/:id',
        component: CaseDetailPage,
        props: true,
        meta: { caseWorkspace: true },
      },
    ],
  });
  await router.push('/cases/case-1');
  await router.isReady();
  const wrapper = mount(App, {
    attachTo: document.body,
    global: {
      plugins: [pinia, router],
      stubs: realDrawer
        ? {
            AppShell: { template: '<main><slot /></main>' },
          }
        : {
            AppShell: { template: '<main><slot /></main>' },
            ElDrawer: {
              props: ['modelValue'],
              template:
                '<div v-show="modelValue" role="dialog" class="case-workspace-editors"><slot /></div>',
            },
          },
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, router, auth };
}
async function tab(wrapper: VueWrapper, key: string) {
  await wrapper.get(`[data-workspace-tab="${key}"]`).trigger('click');
  await flushPromises();
}

it.each([
  [
    'case-info',
    'defendant-contact-update',
    'case-defendant-contact-panel',
    'defendant-contact-cancel',
  ],
  [
    'first-instance',
    'acceptance-correction',
    'case-acceptance-correction-panel',
    'acceptance-correction-cancel',
  ],
])(
  'closes the edit drawer when cancelling %s record edits',
  async (section, command, panel, cancel) => {
    const item = structuredClone(baseItem);
    const defendantId = '10000000-0000-4000-8000-000000000001';
    const acceptanceId = '20000000-0000-4000-8000-000000000001';
    const roundId = '30000000-0000-4000-8000-000000000001';
    item.defendants = [
      {
        id: defendantId,
        kind: 'PERSON',
        name: 'Defendant',
        idNo: null,
        phone: '100',
        address: 'Address',
      },
    ];
    item.acceptances = [
      {
        id: acceptanceId,
        trialRoundId: roundId,
        acceptedAt: '2026-10-01',
        courtCaseNo: 'Case no',
        court: null,
        files: [],
        recordedAt: '2026-10-01T00:00:00Z',
        recordedByUserId: 'operator-1',
      },
    ];
    item.acceptance = item.acceptances[0]!;
    item.recordEdits = {
      canUpdateDefendantContact: true,
      canCorrectAcceptance: true,
      defendantContacts: [{ defendantId, contactRevision: 0, history: [] }],
      acceptanceCorrections: [
        {
          acceptanceId,
          trialRoundId: roundId,
          acceptanceRevision: 0,
          originalAcceptedAt: '2026-10-01',
          originalCourtCaseNo: 'Case no',
          history: [],
        },
      ],
    };
    const { wrapper } = await render(item);

    await wrapper
      .get(`[data-section="${section}"] .case-workspace-section__edit`)
      .trigger('click');
    await wrapper.get('[data-test="workspace-command"]').setValue(command);
    await flushPromises();
    expect(wrapper.find(`[data-test="${panel}"]`).exists()).toBe(true);
    const drawer = wrapper.get('.case-workspace-editors');
    expect(drawer.isVisible()).toBe(true);
    await wrapper.get(`[data-test="${cancel}"]`).trigger('click');
    await flushPromises();
    const editedPanel =
      panel === 'case-defendant-contact-panel'
        ? wrapper.getComponent(CaseDefendantContactPanel)
        : wrapper.getComponent(CaseAcceptanceCorrectionPanel);
    expect(editedPanel.emitted('cancel')).toHaveLength(1);
    expect(wrapper.getComponent(ElDrawer).props('modelValue')).toBe(false);
  },
);

beforeEach(() => {
  vi.resetAllMocks();
  api.getLead.mockRejectedValue(new ApiError('来源无权', 403, 'FORBIDDEN'));
  api.listOwnerMaterials.mockResolvedValue({ items: [], total: 0 });
  api.downloadMaterialVersion.mockResolvedValue(undefined);
  api.listLawyerMatchCandidates.mockResolvedValue([]);
  api.listFilingCourts.mockResolvedValue([]);
});
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  document.body.innerHTML = '';
});

describe('UI002 real case workspace host', () => {
  it('does not offer an empty prior matching editor after a confirmed POST and SPA return', async () => {
    const item = structuredClone(baseItem);
    item.stage = 'PENDING_MATCH';
    item.canMatch = true;
    api.listLawyerMatchCandidates.mockResolvedValue([
      {
        lawyerAccountId: 'account-1',
        lawyerProfileId: 'profile-1',
        displayName: 'Lawyer',
        username: 'lawyer',
      },
    ]);
    api.matchCase.mockResolvedValue(undefined);
    const { wrapper, router } = await renderSpa(item);
    const ahead = {
      ...item,
      stage: 'WAITING_COMPLAINT' as const,
      version: 8,
      canMatch: false,
      matchedAt: '2026-10-14T01:00:00Z',
      matchedOn: '',
    };
    api.getCase.mockImplementation(async () => ({
      ...ahead,
      matchedOn: api.matchCase.mock.calls[0]?.[1].matchedOn ?? '',
    }));
    await wrapper
      .get('[data-test="workspace-primary-action"]')
      .trigger('click');
    await wrapper
      .get('[data-test="case-match-form"]')
      .findAll('input')[1]!
      .setValue('Defendant');
    await wrapper
      .get('[data-test="case-match-form"]')
      .findAll('button')
      .find((button) => button.text().includes('确认匹配'))!
      .trigger('click');
    await flushPromises();
    expect(api.matchCase).toHaveBeenCalledTimes(1);
    expect(
      wrapper
        .find('[data-test="workspace-prior-editor"][data-command="match"]')
        .exists(),
    ).toBe(false);
    await router.push('/calendar');
    await router.push('/cases/case-1');
    await flushPromises();
    expect(
      wrapper
        .find('[data-test="workspace-prior-editor"][data-command="match"]')
        .exists(),
    ).toBe(false);
  });
  it('does not offer an empty prior complaint editor after a confirmed POST and SPA return', async () => {
    const item = structuredClone(baseItem);
    item.stage = 'WAITING_COMPLAINT';
    item.canSubmitComplaint = true;
    api.listOwnerMaterials.mockResolvedValue({
      items: ['COMPLAINT', 'AUTHORIZATION'].map((category) => ({
        id: `material-${category}`,
        ownerType: 'CASE',
        ownerId: item.id,
        category,
        purpose: category,
        currentVersionId: `version-${category}`,
        status: 'ACTIVE',
        version: 1,
        deletedAt: null,
        createdAt: '2026-10-14T00:00:00Z',
        updatedAt: '2026-10-14T00:00:00Z',
        contentVersions: [
          {
            id: `version-${category}`,
            materialId: `material-${category}`,
            originalFilename: `${category}.pdf`,
            mimeType: 'application/pdf',
            sizeBytes: 8,
            sha256: 'a'.repeat(64),
            status: 'AVAILABLE',
            createdAt: '2026-10-14T00:00:00Z',
          },
        ],
      })),
      total: 2,
    });
    api.submitComplaint.mockResolvedValue(undefined);
    const { wrapper, router } = await renderSpa(item);
    const ahead: CaseDetail = {
      ...item,
      stage: 'WAITING_COMPLAINT_CONFIRMATION',
      version: 8,
      canSubmitComplaint: false,
      complaint: {
        amountState: 'KNOWN',
        amount: '12.30',
        pendingReason: null,
        submittedAt: '2026-10-14T01:00:00Z',
        submittedByUserId: 'operator-1',
        complaintFiles: [],
        authorizationFiles: [],
      },
    };
    api.getCase.mockResolvedValue(ahead);
    await wrapper
      .get('[data-test="workspace-primary-action"]')
      .trigger('click');
    await wrapper
      .getComponent(CaseComplaintSubmissionForm)
      .get('input[inputmode="decimal"]')
      .setValue('12.30');
    await wrapper.get('[data-test="submit-complaint"]').trigger('click');
    await flushPromises();
    expect(api.submitComplaint).toHaveBeenCalledTimes(1);
    expect(
      wrapper
        .find('[data-test="workspace-prior-editor"][data-command="complaint"]')
        .exists(),
    ).toBe(false);
    await router.push('/calendar');
    await router.push('/cases/case-1');
    await flushPromises();
    expect(
      wrapper
        .find('[data-test="workspace-prior-editor"][data-command="complaint"]')
        .exists(),
    ).toBe(false);
  });
  it('recovers an in-flight matching intent across real SPA routes without accepting its late response', async () => {
    const item = structuredClone(baseItem);
    item.stage = 'PENDING_MATCH';
    item.canMatch = true;
    api.listLawyerMatchCandidates.mockResolvedValue([
      {
        lawyerAccountId: 'lawyer-account',
        lawyerProfileId: 'lawyer-profile',
        displayName: 'Lawyer',
        username: 'lawyer',
      },
    ]);
    const late = deferred<void>();
    api.matchCase
      .mockReturnValueOnce(late.promise)
      .mockRejectedValueOnce(new ApiError('unknown', 0, 'NETWORK_ERROR'));
    const other = { ...item, id: 'case-2', businessNo: 'CA-2' };
    const { wrapper, router } = await renderSpa(item);
    api.getCase.mockImplementation(async (id: string) =>
      id === 'case-2' ? other : item,
    );
    await wrapper
      .get('[data-test="workspace-primary-action"]')
      .trigger('click');
    await wrapper
      .get('[data-test="case-match-form"]')
      .findAll('input')[1]!
      .setValue('Defendant');
    await wrapper
      .get('[data-test="case-match-form"]')
      .findAll('button')
      .find((button) => button.text().includes('确认匹配'))!
      .trigger('click');
    const original = JSON.parse(
      JSON.stringify(api.matchCase.mock.calls[0]![1]),
    );
    await router.push('/calendar');
    await flushPromises();
    expect(wrapper.find('[data-test="calendar-route"]').exists()).toBe(true);
    await router.push('/cases/case-2');
    await flushPromises();
    expect(wrapper.text()).not.toContain('CA-1');
    late.resolve(undefined);
    await flushPromises();
    expect(wrapper.text()).not.toContain('Defendant');
    await router.push('/cases');
    await router.push('/cases/case-1');
    await flushPromises();
    expect(api.matchCase).toHaveBeenCalledTimes(1);
    await wrapper
      .get('[data-test="workspace-primary-action"]')
      .trigger('click');
    await wrapper.get('[data-test="match-retry-original"]').trigger('click');
    await flushPromises();
    expect(api.matchCase.mock.calls[1]).toEqual(['case-1', original]);
  });
  it('keeps an unsent lawyer selection after the case is revalidated on SPA return', async () => {
    const item = structuredClone(baseItem);
    item.stage = 'PENDING_MATCH';
    item.canMatch = true;
    api.listLawyerMatchCandidates.mockResolvedValue([
      {
        lawyerAccountId: 'account-1',
        lawyerProfileId: 'profile-1',
        displayName: 'First',
        username: 'first',
      },
      {
        lawyerAccountId: 'account-2',
        lawyerProfileId: 'profile-2',
        displayName: 'Second',
        username: 'second',
      },
    ]);
    const { wrapper, router } = await renderSpa(item);
    await wrapper
      .get('[data-test="workspace-primary-action"]')
      .trigger('click');
    await flushPromises();
    const select = wrapper
      .get('[data-test="case-match-form"]')
      .findAll('select')
      .at(-1)!.element as HTMLSelectElement;
    expect(select.options.length).toBe(3);
    select.selectedIndex = 2;
    await wrapper
      .get('[data-test="case-match-form"]')
      .findAll('select')
      .at(-1)!
      .trigger('change');
    expect(
      (
        wrapper.get('[data-test="case-match-form"]').findAll('select').at(-1)!
          .element as HTMLSelectElement
      ).selectedIndex,
    ).toBe(2);
    await router.push('/calendar');
    await router.push('/cases/case-1');
    await flushPromises();
    await wrapper
      .get('[data-test="workspace-primary-action"]')
      .trigger('click');
    expect(
      (
        wrapper.get('[data-test="case-match-form"]').findAll('select').at(-1)!
          .element as HTMLSelectElement
      ).selectedIndex,
    ).toBe(2);
  });
  it('recovers the original complaint body and key after visiting the case list', async () => {
    const item = structuredClone(baseItem);
    item.stage = 'WAITING_COMPLAINT';
    item.canSubmitComplaint = true;
    api.listOwnerMaterials.mockResolvedValue({
      items: ['COMPLAINT', 'AUTHORIZATION'].map((category) => ({
        id: `material-${category}`,
        ownerType: 'CASE',
        ownerId: item.id,
        category,
        purpose: category,
        currentVersionId: `version-${category}`,
        status: 'ACTIVE',
        version: 1,
        deletedAt: null,
        createdAt: '2026-10-14T00:00:00Z',
        updatedAt: '2026-10-14T00:00:00Z',
        contentVersions: [
          {
            id: `version-${category}`,
            materialId: `material-${category}`,
            originalFilename: `${category}.pdf`,
            mimeType: 'application/pdf',
            sizeBytes: 8,
            sha256: 'a'.repeat(64),
            status: 'AVAILABLE',
            createdAt: '2026-10-14T00:00:00Z',
          },
        ],
      })),
      total: 2,
    });
    api.submitComplaint.mockRejectedValue(
      new ApiError('unknown', 0, 'NETWORK_ERROR'),
    );
    const { wrapper, router } = await renderSpa(item);
    await wrapper
      .get('[data-test="workspace-primary-action"]')
      .trigger('click');
    await wrapper
      .getComponent(CaseComplaintSubmissionForm)
      .get('input[inputmode="decimal"]')
      .setValue('12.30');
    await wrapper.get('[data-test="submit-complaint"]').trigger('click');
    await flushPromises();
    const original = JSON.parse(
      JSON.stringify(api.submitComplaint.mock.calls[0]![1]),
    );
    await router.push('/cases');
    await flushPromises();
    api.getCase.mockResolvedValue({ ...item, version: 8 });
    await router.push('/cases/case-1');
    await flushPromises();
    expect(api.submitComplaint).toHaveBeenCalledTimes(1);
    await wrapper
      .get('[data-test="workspace-primary-action"]')
      .trigger('click');
    await wrapper
      .get('[data-test="complaint-retry-original"]')
      .trigger('click');
    await flushPromises();
    expect(api.submitComplaint.mock.calls[1]).toEqual(['case-1', original]);
  });
  it('retains the hearing panel unknown request across a SPA calendar visit and a newer GET', async () => {
    const item = structuredClone(baseItem);
    item.stage = 'WAITING_HEARING';
    item.canScheduleHearing = true;
    item.acceptance = {
      id: 'acceptance-1',
      trialRoundId: 'round-1',
      acceptedAt: '2026-10-05',
      courtCaseNo: 'Court-1',
      court: null,
      recordedAt: '2026-10-05T01:00:00Z',
      recordedByUserId: 'user-1',
      files: [],
    };
    const late = deferred<void>();
    api.scheduleCaseHearing
      .mockReturnValueOnce(late.promise)
      .mockRejectedValueOnce(new ApiError('unknown', 0, 'TIMEOUT'));
    const { wrapper, router } = await renderSpa(item);
    await wrapper
      .get('[data-test="workspace-primary-action"]')
      .trigger('click');
    await wrapper
      .getComponent(CaseHearingPanel)
      .get('[data-test="hearing-date"]')
      .setValue('2026-10-05');
    await wrapper.get('[data-test="hearing-save"]').trigger('click');
    await flushPromises();
    const original = api.scheduleCaseHearing.mock.calls[0];
    await router.push('/calendar');
    await flushPromises();
    late.resolve(undefined);
    await flushPromises();
    api.getCase.mockResolvedValue({
      ...item,
      version: 8,
      stage: 'WAITING_JUDGMENT',
      canScheduleHearing: false,
      canRegisterJudgment: true,
    });
    await router.push('/cases/case-1');
    await flushPromises();
    await wrapper
      .get('[data-test="workspace-primary-action"]')
      .trigger('click');
    await wrapper.get('[data-test="workspace-prior-editor"]').trigger('click');
    expect(wrapper.find('[data-test="hearing-retry"]').exists()).toBe(true);
    await wrapper.get('[data-test="hearing-retry"]').trigger('click');
    await flushPromises();
    expect(api.scheduleCaseHearing.mock.calls[1]).toEqual(original);
  });
  it('retains an acceptance POST intent sent before leaving and replays its exact request after GET advances', async () => {
    const item = structuredClone(baseItem);
    item.stage = 'WAITING_FORMAL_ACCEPTANCE';
    item.canRegisterAcceptance = true;
    item.filingSubmission = {
      court: { id: 'court-1', name: 'Court' },
      submittedAt: '2026-10-03',
      recordedAt: '2026-10-03T03:00:00Z',
      recordedByUserId: 'user-1',
      mediationNo: null,
      evidenceFiles: [],
      screenshotFiles: [],
    };
    const late = deferred<void>();
    api.registerCaseAcceptance
      .mockReturnValueOnce(late.promise)
      .mockRejectedValueOnce(new ApiError('unknown', 0, 'TIMEOUT'));
    const { wrapper, router } = await renderSpa(item);
    await wrapper
      .get('[data-test="workspace-primary-action"]')
      .trigger('click');
    await wrapper
      .get('[data-test="acceptance-accepted-at"]')
      .setValue('2026-10-05');
    await wrapper
      .get('[data-test="acceptance-court-case-no"]')
      .setValue('Court-1');
    await wrapper.get('[data-test="acceptance-register"]').trigger('click');
    await flushPromises();
    const original = api.registerCaseAcceptance.mock.calls[0];
    await router.push('/calendar');
    await flushPromises();
    late.resolve(undefined);
    await flushPromises();
    api.getCase.mockResolvedValue({
      ...item,
      version: 8,
      stage: 'WAITING_HEARING',
      canRegisterAcceptance: false,
    });
    await router.push('/cases/case-1');
    await flushPromises();
    expect(api.registerCaseAcceptance).toHaveBeenCalledTimes(1);
    await wrapper.get('[data-test="workspace-prior-editor"]').trigger('click');
    await wrapper.get('[data-test="acceptance-retry"]').trigger('click');
    await flushPromises();
    expect(api.registerCaseAcceptance.mock.calls[1]).toEqual(original);
  });
  it('stops a second acceptance material upload after leaving the cached case', async () => {
    const item = structuredClone(baseItem);
    item.stage = 'WAITING_FORMAL_ACCEPTANCE';
    item.canUploadAcceptanceMaterials = true;
    const late = deferred<{
      materialId: string;
      contentVersionId: string;
      originalFilename: string;
      mimeType: string;
    }>();
    api.uploadMaterialFile.mockReturnValueOnce(late.promise);
    const { wrapper, router } = await renderSpa(item);
    await wrapper
      .get('[data-test="workspace-primary-action"]')
      .trigger('click');
    const input = wrapper.get(
      '[data-test="acceptance-material-input-ACCEPTANCE_NOTICE"]',
    );
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [
        new File(['first'], 'first.pdf', { type: 'application/pdf' }),
        new File(['second'], 'second.pdf', { type: 'application/pdf' }),
      ],
    });
    await input.trigger('change');
    expect(api.uploadMaterialFile).toHaveBeenCalledTimes(1);
    await router.push('/calendar');
    await flushPromises();
    late.resolve({
      materialId: 'material-1',
      contentVersionId: 'version-1',
      originalFilename: 'first.pdf',
      mimeType: 'application/pdf',
    });
    await flushPromises();
    expect(api.uploadMaterialFile).toHaveBeenCalledTimes(1);
  });
  it('hides the teleported case editor on SPA departure', async () => {
    const item = structuredClone(baseItem);
    item.stage = 'PENDING_MATCH';
    item.canMatch = true;
    const { wrapper, router } = await renderSpa(item, true);
    await wrapper
      .get('[data-test="workspace-primary-action"]')
      .trigger('click');
    await flushPromises();
    expect(
      document.body.querySelector('.case-workspace-editors'),
    ).not.toBeNull();
    await router.push('/calendar');
    await flushPromises();
    const drawer = document.body.querySelector('.case-workspace-editors');
    expect(
      drawer === null ||
        getComputedStyle(drawer.closest('.el-overlay')!).display === 'none',
    ).toBe(true);
  });
  it('cancels a material listing on departure and reloads only after return GET authorizes the case', async () => {
    const item = structuredClone(baseItem);
    const pending = deferred<{ items: []; total: number }>();
    api.listOwnerMaterials
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ items: [], total: 0 });
    const { wrapper, router } = await renderSpa(item);
    await tab(wrapper, 'files');
    const signal: AbortSignal = api.listOwnerMaterials.mock.calls[0]![2].signal;
    expect(signal.aborted).toBe(false);
    await router.push('/calendar');
    await flushPromises();
    expect(signal.aborted).toBe(true);
    expect(api.listOwnerMaterials).toHaveBeenCalledTimes(1);
    pending.resolve({ items: [], total: 0 });
    await flushPromises();
    const authorized = deferred<CaseDetail>();
    api.getCase.mockReturnValueOnce(authorized.promise);
    await router.push('/cases/case-1');
    await flushPromises();
    expect(api.listOwnerMaterials).toHaveBeenCalledTimes(1);
    authorized.resolve(item);
    await flushPromises();
    expect(api.listOwnerMaterials).toHaveBeenCalledTimes(2);
  });
  it('does not list old complaint versions on an inactive authorization change and reads after return GET', async () => {
    const item = structuredClone(baseItem);
    item.stage = 'WAITING_COMPLAINT_CONFIRMATION';
    item.canConfirmComplaint = true;
    item.complaint = {
      amountState: 'KNOWN',
      amount: '12.30',
      pendingReason: null,
      submittedAt: '2026-10-14T01:00:00Z',
      submittedByUserId: 'operator-1',
      complaintFiles: [],
      authorizationFiles: [],
    };
    const { wrapper, router, auth } = await renderSpa(item);
    await wrapper
      .get('[data-test="workspace-primary-action"]')
      .trigger('click');
    await flushPromises();
    const beforeDeparture = api.listOwnerMaterials.mock.calls.length;
    expect(beforeDeparture).toBeGreaterThan(0);
    await router.push('/calendar');
    await flushPromises();
    auth.session = { ...auth.session!, authorizationRevision: 2 };
    expect(api.listOwnerMaterials).toHaveBeenCalledTimes(beforeDeparture);
    await flushPromises();
    const authorized = deferred<CaseDetail>();
    api.getCase.mockReturnValueOnce(authorized.promise);
    await router.push('/cases/case-1');
    await flushPromises();
    expect(api.listOwnerMaterials).toHaveBeenCalledTimes(beforeDeparture);
    authorized.resolve(item);
    await flushPromises();
    expect(api.listOwnerMaterials.mock.calls.length).toBeGreaterThan(
      beforeDeparture,
    );
  });
  it('waits for the parent GET before listing complaint versions on an active authorization change', async () => {
    const item = structuredClone(baseItem);
    item.stage = 'WAITING_COMPLAINT_CONFIRMATION';
    item.canConfirmComplaint = true;
    item.complaint = {
      amountState: 'KNOWN',
      amount: '12.30',
      pendingReason: null,
      submittedAt: '2026-10-14T01:00:00Z',
      submittedByUserId: 'operator-1',
      complaintFiles: [],
      authorizationFiles: [],
    };
    const { wrapper, auth } = await renderSpa(item);
    await wrapper
      .get('[data-test="workspace-primary-action"]')
      .trigger('click');
    await flushPromises();
    const beforeRevision = api.listOwnerMaterials.mock.calls.length;
    const authorized = deferred<CaseDetail>();
    api.getCase.mockReturnValue(authorized.promise);
    auth.session = { ...auth.session!, authorizationRevision: 2 };
    expect(api.listOwnerMaterials).toHaveBeenCalledTimes(beforeRevision);
    await flushPromises();
    expect(api.listOwnerMaterials).toHaveBeenCalledTimes(beforeRevision);
    authorized.resolve(item);
    await flushPromises();
    expect(api.listOwnerMaterials.mock.calls.length).toBeGreaterThan(
      beforeRevision,
    );
  });
  it('reloads filing courts after an interrupted read and authorized SPA return', async () => {
    const item = structuredClone(baseItem);
    item.stage = 'WAITING_FILING';
    item.canSubmitFiling = true;
    const late = deferred<Array<{ id: string; name: string }>>();
    api.listFilingCourts
      .mockReturnValueOnce(late.promise)
      .mockResolvedValue([{ id: 'court-1', name: 'Court One' }]);
    const { wrapper, router } = await renderSpa(item);
    await wrapper
      .get('[data-test="workspace-primary-action"]')
      .trigger('click');
    expect(api.listFilingCourts).toHaveBeenCalledTimes(1);
    await router.push('/calendar');
    late.resolve([]);
    await flushPromises();
    await router.push('/cases/case-1');
    await flushPromises();
    expect(api.listFilingCourts).toHaveBeenCalledTimes(2);
    await wrapper
      .get('[data-test="workspace-primary-action"]')
      .trigger('click');
    expect(wrapper.text()).toContain('Court One');
  });
  it('clears cached case facts and pending controls when return GET is forbidden', async () => {
    const item = structuredClone(baseItem);
    item.stage = 'PENDING_MATCH';
    item.canMatch = true;
    const { wrapper, router } = await renderSpa(item);
    await router.push('/cases');
    api.getCase.mockRejectedValueOnce(
      new ApiError('forbidden', 403, 'FORBIDDEN'),
    );
    await router.push('/cases/case-1');
    await flushPromises();
    expect(wrapper.text()).not.toContain('CA-1');
    expect(
      wrapper.find('[data-test="workspace-primary-action"]').exists(),
    ).toBe(false);
  });

  it('drops a retained case instance when authorization revision changes away from it', async () => {
    const item = structuredClone(baseItem);
    item.stage = 'PENDING_MATCH';
    item.canMatch = true;
    const { wrapper, router, auth } = await renderSpa(item);
    await router.push('/cases');
    auth.session = { ...auth.session!, authorizationRevision: 2 };
    await flushPromises();
    const fresh = { ...item, canMatch: false, businessNo: 'CA-1-new' };
    api.getCase.mockResolvedValue(fresh);
    await router.push('/cases/case-1');
    await flushPromises();
    expect(wrapper.text()).toContain('CA-1-new');
    expect(
      wrapper.find('[data-test="workspace-primary-action"]').exists(),
    ).toBe(false);
  });
  it('keeps authorized second-result revocation available after the stage advances and prioritizes the current stage command', async () => {
    const item = structuredClone(baseItem);
    item.stage = 'WAITING_EXECUTION_DOCUMENTS';
    item.canSubmitExecution = true;
    item.canRevokeSecondInstanceResult = true;
    item.secondInstance.currentResult = {
      id: 'result-1',
      trialRoundId: 'round-1',
      choiceId: 'choice-1',
      judgmentId: 'judgment-1',
      progressId: null,
      result: 'AFFIRM',
      resultReceivedAt: '2026-10-01',
      paidLitigationFeeState: 'KNOWN',
      paidLitigationFee: '0.00',
      judgmentAmountState: 'KNOWN',
      judgmentAmount: '42.50',
      fromVersion: 6,
      toVersion: 7,
      recordedAt: '2026-10-01T00:00:00Z',
      files: [],
      childTrialRoundId: null,
      revocationId: null,
    };
    const { wrapper } = await render(item);
    expect(wrapper.get('[data-test="workspace-primary-action"]').text()).toBe(
      '提交执行材料',
    );
    expect(wrapper.get('[data-command="second-instance"]').text()).toBe(
      '撤销二审结果',
    );
    expect(
      wrapper
        .get('[data-section="second-instance"] .case-workspace-section__edit')
        .attributes('disabled'),
    ).toBeUndefined();
    await wrapper.get('[data-command="second-instance"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="second-instance-panel"]').text()).toContain(
      '撤销',
    );
    expect(api.matchCase).not.toHaveBeenCalled();
    expect(api.submitComplaint).not.toHaveBeenCalled();
  });
  it('retains one complaint form and its original body/key across closing, tabs, folding and a newer case version', async () => {
    const item = structuredClone(baseItem);
    item.stage = 'WAITING_COMPLAINT';
    item.canSubmitComplaint = true;
    api.listOwnerMaterials.mockResolvedValue({
      items: ['COMPLAINT', 'AUTHORIZATION'].map((category) => ({
        id: `material-${category}`,
        ownerType: 'CASE',
        ownerId: item.id,
        category,
        purpose: category,
        currentVersionId: `version-${category}`,
        status: 'ACTIVE',
        version: 1,
        deletedAt: null,
        createdAt: '2026-10-14T00:00:00Z',
        updatedAt: '2026-10-14T00:00:00Z',
        contentVersions: [
          {
            id: `version-${category}`,
            materialId: `material-${category}`,
            originalFilename: `${category}.pdf`,
            mimeType: 'application/pdf',
            sizeBytes: 8,
            sha256: 'a'.repeat(64),
            status: 'AVAILABLE',
            createdAt: '2026-10-14T00:00:00Z',
          },
        ],
      })),
      total: 2,
    });
    api.submitComplaint.mockRejectedValue(
      new ApiError('提交结果未知', 0, 'NETWORK_ERROR'),
    );
    const { wrapper } = await render(item);
    await wrapper
      .get('[data-section="first-instance"] .case-workspace-section__edit')
      .trigger('click');
    await flushPromises();
    expect(
      wrapper
        .get('[data-section="first-instance"] [aria-expanded]')
        .attributes('aria-expanded'),
    ).toBe('false');
    const form = wrapper.getComponent(CaseComplaintSubmissionForm);
    await form.get('input[inputmode="decimal"]').setValue('12.30');
    await form.get('[data-test="submit-complaint"]').trigger('click');
    await flushPromises();
    const original = JSON.parse(
      JSON.stringify(api.submitComplaint.mock.calls[0]![1]),
    );
    wrapper.getComponent(ElDrawer).vm.$emit('update:modelValue', false);
    await flushPromises();
    await tab(wrapper, 'files');
    await tab(wrapper, 'fees');
    await tab(wrapper, 'details');
    await wrapper
      .get('[data-section="first-instance"] [aria-expanded]')
      .trigger('click');
    await wrapper
      .get('[data-section="first-instance"] [aria-expanded]')
      .trigger('click');
    api.getCase.mockResolvedValue({ ...item, version: 8 });
    await wrapper.get('[data-test="case-refresh"]').trigger('click');
    await flushPromises();
    await wrapper
      .get('[data-test="workspace-primary-action"]')
      .trigger('click');
    await flushPromises();
    expect(wrapper.getComponent(CaseComplaintSubmissionForm).element).toBe(
      form.element,
    );
    expect(wrapper.findAllComponents(CaseComplaintSubmissionForm)).toHaveLength(
      1,
    );
    expect(api.submitComplaint).toHaveBeenCalledTimes(1);
    await wrapper
      .get('[data-test="complaint-retry-original"]')
      .trigger('click');
    await flushPromises();
    expect(api.submitComplaint).toHaveBeenCalledTimes(2);
    expect(api.submitComplaint.mock.calls[1]).toEqual(['case-1', original]);
    expect(original.expectedVersion).toBe(7);
    expect(form.get('input[inputmode="decimal"]').element).toHaveProperty(
      'value',
      '12.30',
    );
  });
  it('ignores a late matching result after a newer case version and retries only the original intent', async () => {
    const item = structuredClone(baseItem);
    item.stage = 'PENDING_MATCH';
    item.canMatch = true;
    api.listLawyerMatchCandidates.mockResolvedValue([
      {
        lawyerAccountId: 'lawyer-account',
        lawyerProfileId: 'lawyer-profile',
        displayName: '律师甲',
        username: 'lawyer',
      },
    ]);
    const late = deferred<void>();
    api.matchCase.mockReturnValueOnce(late.promise);
    const { wrapper } = await render(item);
    await wrapper
      .get('[data-test="workspace-primary-action"]')
      .trigger('click');
    await flushPromises();
    const form = wrapper.get('[data-test="case-match-form"]');
    await form.findAll('input')[1]!.setValue('真实被告');
    await form
      .findAll('button')
      .find((button) => button.text().includes('确认匹配'))!
      .trigger('click');
    const original = JSON.parse(
      JSON.stringify(api.matchCase.mock.calls[0]![1]),
    );
    api.getCase.mockResolvedValue({ ...item, version: 8 });
    await wrapper.get('[data-test="case-refresh"]').trigger('click');
    await flushPromises();
    late.resolve(undefined);
    await flushPromises();
    expect(api.getCase).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).not.toContain('案件匹配已完成');
    expect(api.matchCase).toHaveBeenCalledTimes(1);
    api.matchCase.mockRejectedValueOnce(
      new ApiError('仍未知', 0, 'NETWORK_ERROR'),
    );
    await wrapper.get('[data-test="match-retry-original"]').trigger('click');
    await flushPromises();
    expect(api.matchCase.mock.calls[1]).toEqual(['case-1', original]);
    expect(original.expectedVersion).toBe(7);
  });
  it('connects all three actual subpages, defaults eight sections closed, and filters the return query', async () => {
    const { wrapper, router } = await render(
      undefined,
      '/cases/case-1?view=department&page=2&stage=WAITING_JUDGMENT&tab=files&customerId=other',
    );
    expect(wrapper.findComponent(CaseDetailsSections).exists()).toBe(true);
    expect(wrapper.findComponent(CaseWorkspaceFiles).exists()).toBe(true);
    expect(
      wrapper
        .findAll('.case-workspace-section')
        .map((section) => section.attributes('data-section')),
    ).toEqual([
      'case-info',
      'lead-info',
      'first-instance',
      'second-instance',
      'judgment',
      'execution',
      'closure-info',
      'timeline',
    ]);
    expect(
      wrapper
        .findAll('[aria-expanded]')
        .every((button) => button.attributes('aria-expanded') === 'false'),
    ).toBe(true);
    expect(wrapper.get('a').attributes('href')).toBe(
      '/cases?view=department&page=2&stage=WAITING_JUDGMENT',
    );
    await tab(wrapper, 'fees');
    expect(router.currentRoute.value.query.tab).toBe('fees');
    expect(
      wrapper.get('[data-workspace-tab="fees"]').attributes('aria-selected'),
    ).toBe('true');
    expect(
      wrapper.get('.case-workspace-fees[role="tabpanel"]').isVisible(),
    ).toBe(true);
    expect(wrapper.text()).toContain('尚未登记案件收付明细');
    expect(api.getCase).toHaveBeenCalledTimes(1);
    expect(api.submitComplaint).not.toHaveBeenCalled();
  });
  it('normalizes invalid tabs and connects keyboard navigation without a write', async () => {
    const { wrapper, router } = await render(
      undefined,
      '/cases/case-1?tab=invalid',
    );
    expect(router.currentRoute.value.query.tab).toBe('details');
    await wrapper
      .get('[data-workspace-tab="details"]')
      .trigger('keydown', { key: 'End' });
    await flushPromises();
    expect(router.currentRoute.value.query.tab).toBe('fees');
    await wrapper
      .get('[data-workspace-tab="fees"]')
      .trigger('keydown', { key: 'ArrowRight' });
    await flushPromises();
    expect(router.currentRoute.value.query.tab).toBe('details');
    expect(api.getCase).toHaveBeenCalledTimes(1);
  });
  it('retains expansion on same-case refresh and resets on authorization revision or case changes', async () => {
    const { wrapper, auth, router } = await render();
    await wrapper
      .get('[data-section="case-info"] [aria-expanded]')
      .trigger('click');
    await wrapper.get('[data-test="case-refresh"]').trigger('click');
    await flushPromises();
    expect(
      wrapper
        .get('[data-section="case-info"] [aria-expanded]')
        .attributes('aria-expanded'),
    ).toBe('true');
    auth.session = { ...auth.session!, authorizationRevision: 2 };
    await flushPromises();
    expect(
      wrapper
        .findAll('[aria-expanded]')
        .every((button) => button.attributes('aria-expanded') === 'false'),
    ).toBe(true);
    await wrapper
      .get('[data-section="case-info"] [aria-expanded]')
      .trigger('click');
    api.getCase.mockResolvedValue({
      ...baseItem,
      id: 'case-2',
      businessNo: 'CA-2',
    });
    await router.push('/cases/case-2');
    await flushPromises();
    expect(wrapper.get('.case-workspace-title').text()).toBe('CA-2');
    expect(
      wrapper
        .findAll('[aria-expanded]')
        .every((button) => button.attributes('aria-expanded') === 'false'),
    ).toBe(true);
  });
  it.each([403, 404])(
    'clears all three subpages and editors when case reading returns %s',
    async (status) => {
      const item = structuredClone(baseItem);
      item.certificate.files = [
        {
          materialId: 'm-secret',
          contentVersionId: 'v-secret',
          originalFilename: '秘密证书.pdf',
          mimeType: 'application/pdf',
        },
      ];
      item.canRegisterJudgment = true;
      const { wrapper } = await render(item);
      await wrapper
        .get('[data-test="workspace-primary-action"]')
        .trigger('click');
      await flushPromises();
      api.getCase.mockRejectedValue(
        new ApiError('案件不可读', status, 'FORBIDDEN'),
      );
      await wrapper.get('[data-test="case-refresh"]').trigger('click');
      await flushPromises();
      expect(wrapper.findComponent(CaseDetailsSections).exists()).toBe(false);
      expect(wrapper.findComponent(CaseWorkspaceFiles).exists()).toBe(false);
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain('秘密证书.pdf');
      expect(wrapper.text()).not.toContain('CA-1');
    },
  );
  it('treats a denied material pool as a local failure while keeping authorized precise files', async () => {
    api.listOwnerMaterials.mockRejectedValue(
      new ApiError('材料无权', 403, 'FORBIDDEN'),
    );
    const item = structuredClone(baseItem);
    item.stage = 'WAITING_COMPLAINT';
    item.canSubmitComplaint = true;
    item.certificate.files = [
      {
        materialId: 'm1',
        contentVersionId: 'v-old',
        originalFilename: '授权证书.pdf',
        mimeType: 'application/pdf',
      },
    ];
    const { wrapper } = await render(item);
    expect(wrapper.get('.case-workspace-title').text()).toBe('CA-1');
    await tab(wrapper, 'files');
    expect(wrapper.getComponent(CaseWorkspaceFiles).text()).toContain(
      '授权证书.pdf',
    );
    expect(wrapper.getComponent(CaseWorkspaceFiles).text()).toContain(
      '无访问权限',
    );
  });
  it.each([403, 404])(
    'removes only the file version rejected with %s and retains the other subpages',
    async (status) => {
      const item = structuredClone(baseItem);
      item.certificate.files = ['old', 'other'].map((version) => ({
        materialId: `m-${version}`,
        contentVersionId: `v-${version}`,
        originalFilename: `${version}.pdf`,
        mimeType: 'application/pdf',
      }));
      const { wrapper } = await render(item);
      await tab(wrapper, 'files');
      api.downloadMaterialVersion.mockRejectedValueOnce(
        new ApiError('文件失效', status, 'FORBIDDEN'),
      );
      const files = wrapper.getComponent(CaseWorkspaceFiles);
      await files
        .findAll('button')
        .find((button) => button.text() === '下载此版本')!
        .trigger('click');
      await flushPromises();
      expect(api.downloadMaterialVersion).toHaveBeenCalledWith(
        'm-old',
        'v-old',
        expect.any(AbortSignal),
      );
      expect(files.text()).not.toContain('old.pdf');
      expect(files.text()).toContain('other.pdf');
      expect(wrapper.findComponent(CaseDetailsSections).exists()).toBe(true);
    },
  );
  it('isolates late case and source-lead responses when the route changes', async () => {
    const { wrapper, router } = await render();
    const late = deferred<CaseDetail>();
    const lateLead = deferred<LeadDetail>();
    api.getCase.mockReturnValueOnce(late.promise);
    await wrapper.get('[data-test="case-refresh"]').trigger('click');
    api.getCase.mockResolvedValue({
      ...baseItem,
      id: 'case-2',
      businessNo: 'CA-2',
      sourceLead: { id: 'lead-2', businessNo: 'LD-2' },
    });
    api.getLead.mockReturnValueOnce(lateLead.promise);
    await router.push('/cases/case-2');
    await flushPromises();
    api.getCase.mockResolvedValue({
      ...baseItem,
      id: 'case-3',
      businessNo: 'CA-3',
    });
    await router.push('/cases/case-3');
    await flushPromises();
    late.resolve({ ...baseItem, businessNo: '迟到的旧案件' });
    lateLead.resolve(sourceLead);
    await flushPromises();
    expect(wrapper.text()).not.toContain('迟到的旧案件');
    expect(wrapper.text()).not.toContain('测试店铺');
    expect(wrapper.get('.case-workspace-title').text()).toBe('CA-3');
  });
  it('opens source edit only from its actual edit capability, without expanding the section', async () => {
    api.getLead.mockResolvedValue(sourceLead);
    const { wrapper, router } = await render();
    const section = wrapper.get('[data-section="lead-info"]');
    await section.get('.case-workspace-section__edit').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/leads/lead-1/edit');
    expect(section.get('[aria-expanded]').attributes('aria-expanded')).toBe(
      'false',
    );
    expect(api.matchCase).not.toHaveBeenCalled();
  });
  it('keeps source access denial explicit and all case edit entries controlled', async () => {
    const { wrapper } = await render();
    expect(wrapper.get('[data-section="lead-info"]').text()).toContain('无权');
    expect(
      wrapper
        .get('[data-section="lead-info"] .case-workspace-section__edit')
        .attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.find('[data-test="workspace-primary-action"]').exists(),
    ).toBe(false);
    expect(
      wrapper
        .get('[data-section="case-info"] .case-workspace-section__edit')
        .attributes('disabled'),
    ).toBeDefined();
    await wrapper
      .get('[data-section="timeline"] .case-workspace-section__view')
      .trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="dialog"]').text()).toContain(
      '不能修改或删除审计',
    );
    expect(wrapper.get('[role="dialog"]').text()).toContain(
      '手工时间轴保存和完整案件收付尚未提供',
    );
  });
  it('places the density class on the actual teleported drawer root', async () => {
    const item = structuredClone(baseItem);
    item.canRegisterJudgment = true;
    const { wrapper } = await render(item, '/cases/case-1', true);
    await wrapper
      .get('[data-test="workspace-primary-action"]')
      .trigger('click');
    await flushPromises();
    const dialog = document.body.querySelector('.el-drawer[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.classList.contains('case-workspace-editors')).toBe(true);
    expect(wrapper.element.contains(dialog)).toBe(false);
    expect(api.matchCase).not.toHaveBeenCalled();
  });
});
