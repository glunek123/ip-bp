import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, type Component, type PropType } from 'vue';
import { RouterView, createRouter, createMemoryHistory } from 'vue-router';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseDetail, CaseSummary, CaseFile } from '../../api/cases';
import type * as CaseApi from '../../api/cases';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import CaseListPage from './CaseListPage.vue';
import {
  decodeCaseListRequest,
  readCaseListRecordRecoveries,
} from './CaseListWorkflowPanel.vue';
import {
  caseSectionRecordStorageKey,
  type CaseSectionRecordKind,
  type CaseSectionRecordRequest,
} from './CaseSectionRecordCorrectionPanel.vue';
import { sectionRecordCommands } from './case-workspace-section-edits';

const api = vi.hoisted(() => ({
  getCase: vi.fn(),
  listCases: vi.fn(),
  getExternalEntryOptions: vi.fn(),
  chooseCaseJudgmentNextStep: vi.fn(),
  correctCaseJudgment: vi.fn(),
  correctCaseExecutionMailingRecord: vi.fn(),
  correctCaseExecutionFilingRecord: vi.fn(),
  correctCaseExecutionFinishRecord: vi.fn(),
  correctCaseHearingRecord: vi.fn(),
  correctCaseJudgmentRecord: vi.fn(),
  correctCaseClosureRecord: vi.fn(),
  saveSecondInstance: vi.fn(),
  submitComplaint: vi.fn(),
  matchCase: vi.fn(),
  listLawyerMatchCandidates: vi.fn(),
}));
vi.mock('../../api/cases', async (original) => ({
  ...(await original<typeof import('../../api/cases')>()),
  ...api,
}));
const materials = vi.hoisted(() => ({
  listOwnerMaterials: vi.fn(),
  uploadMaterialFile: vi.fn(),
}));
vi.mock('../../api/materials', async (original) => ({
  ...(await original<typeof import('../../api/materials')>()),
  ...materials,
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

function withJudgment(): CaseDetail {
  const item = structuredClone(baseItem);
  item.judgment.current = {
    id: 'judgment-1',
    trialRoundId: 'round-1',
    kind: 'REGISTER',
    priorFactId: null,
    judgmentReceivedAt: '2026-10-01',
    judgmentAmountState: 'PENDING',
    judgmentAmount: null,
    paidLitigationFeeState: 'PENDING',
    paidLitigationFee: null,
    fromVersion: 6,
    toVersion: 7,
    recordedAt: '2026-10-01T00:00:00Z',
    files: [],
  };
  return item;
}

function summary(detail = withJudgment()): CaseSummary {
  return {
    ...detail,
    canChooseJudgmentNextStep: true,
    displaySummary: {
      customerName: '合成客户',
      rightsHolderName: '合成权利人',
      source: { platform: null, shopName: null, shopExternalId: null },
      defendants: [],
      lawyers: [],
      court: null,
      courtCaseNo: null,
      claimAmount: {
        state: 'UNRECORDED',
        amount: null,
        sourceType: null,
        sourceId: null,
      },
      judgmentAmount: {
        state: 'PENDING',
        amount: null,
        sourceType: 'FIRST_INSTANCE_JUDGMENT',
        sourceId: 'judgment-1',
      },
      closureAmount: {
        state: 'UNRECORDED',
        amount: null,
        sourceType: null,
        sourceId: null,
      },
    },
  };
}
function list(items = [summary()]) {
  return { items, total: 40, page: 2, pageSize: 20, counts: {} };
}
const uid = (n: number) =>
  `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const file: CaseFile = {
  materialId: uid(20),
  contentVersionId: uid(21),
  originalFilename: '已冻结.pdf',
  mimeType: 'application/pdf',
};
const otherFile: CaseFile = {
  materialId: uid(22),
  contentVersionId: uid(23),
  originalFilename: '依据.pdf',
  mimeType: 'application/pdf',
};
function recordFixture(): CaseDetail {
  const item = structuredClone(baseItem);
  item.id = uid(1);
  item.stage = 'ARCHIVED';
  item.version = 42;
  const mailed = {
    mailedAt: '2026-10-01',
    mailReceiptContentVersionIds: [
      file.contentVersionId,
      otherFile.contentVersionId,
    ],
    files: [file, otherFile],
  };
  const filed = {
    submittedAt: '2026-10-02',
    executionFilingProofContentVersionIds: [file.contentVersionId],
    files: [file],
  };
  const finished = {
    finishedAt: '2026-10-03',
    reason: '执行已结束',
    basisNote: '原依据',
    basisContentVersionIds: [file.contentVersionId],
    files: [file],
  };
  const hearing = { hearingAt: '2026-10-04' };
  const judgment = {
    judgmentReceivedAt: '2026-10-05',
    judgmentAmountState: 'KNOWN' as const,
    judgmentAmount: '120.00',
    paidLitigationFeeState: 'PENDING' as const,
    paidLitigationFee: null,
    judgmentContentVersionIds: [file.contentVersionId],
    files: [file],
  };
  const closure = {
    closeAt: '2026-10-06',
    closeAmountState: 'KNOWN' as const,
    closeAmt: '100.00',
    note: '原说明',
    closeContentVersionIds: [file.contentVersionId],
    files: [file],
  };
  item.recordEdits = {
    canUpdateDefendantContact: false,
    canCorrectAcceptance: false,
    defendantContacts: [],
    acceptanceCorrections: [],
    executionMailings: [
      {
        mailingId: uid(2),
        mailingRevision: 2,
        canEdit: true,
        original: mailed,
        effective: mailed,
        history: [],
      },
    ],
    executionFilings: [
      {
        filingId: uid(3),
        filingRevision: 3,
        canEdit: true,
        original: filed,
        effective: filed,
        history: [],
      },
    ],
    executionFinishes: [
      {
        finishId: uid(4),
        finishRevision: 4,
        canEdit: true,
        original: finished,
        effective: finished,
        history: [],
      },
    ],
    hearings: [
      {
        arrangementId: uid(5),
        trialRoundId: uid(9),
        hearingRevision: 5,
        canEdit: true,
        original: hearing,
        effective: hearing,
        history: [],
      },
    ],
    judgments: [
      {
        judgmentId: uid(6),
        trialRoundId: uid(9),
        judgmentRevision: 6,
        canEdit: true,
        original: judgment,
        effective: judgment,
        history: [],
      },
    ],
    closures: [
      {
        closureId: uid(7),
        closureRevision: 0,
        canEdit: true,
        original: closure,
        effective: closure,
        history: [],
      },
    ],
  };
  item.closure = {
    id: uid(7),
    finishId: uid(4),
    current: {
      id: uid(8),
      kind: 'REGISTER',
      priorVersionId: null,
      finishId: uid(4),
      fromVersion: 40,
      toVersion: 41,
      ...closure,
      correctionReason: null,
      recordedAt: '2026-10-06T00:00:00Z',
      recordedByUserId: uid(10),
    },
    history: [],
  };
  item.secondInstance.rounds = [
    { id: uid(9), sequence: 1, sourceResultId: null, revokedAt: null },
  ];
  item.recordEdits.executionMailings![0]!.mailingRevision = 0;
  item.recordEdits.executionFilings![0]!.filingRevision = 0;
  item.recordEdits.executionFinishes![0]!.finishRevision = 0;
  item.recordEdits.hearings![0]!.hearingRevision = 0;
  item.recordEdits.judgments![0]!.judgmentRevision = 0;
  item.executionMailing = {
    id: uid(2),
    confirmationId: null,
    mailedAt: mailed.mailedAt,
    recordedAt: '2026-10-01T00:00:00Z',
    files: mailed.files,
  };
  item.executionFiling = {
    id: uid(3),
    mailingId: uid(2),
    submittedAt: filed.submittedAt,
    recordedAt: '2026-10-02T00:00:00Z',
    files: filed.files,
  };
  item.executionFinish = {
    id: uid(4),
    filingId: uid(3),
    finishedAt: finished.finishedAt,
    reason: finished.reason,
    basisNote: finished.basisNote,
    recordedAt: '2026-10-03T00:00:00Z',
    files: finished.files,
  };
  const arrangement = {
    id: uid(5),
    trialRoundId: uid(9),
    hearingAt: hearing.hearingAt,
    source: 'SCHEDULE' as const,
    recordedAt: '2026-10-04T00:00:00Z',
  };
  item.hearing.currentArrangement = arrangement;
  item.hearing.arrangements = [arrangement];
  const judgmentFact = {
    id: uid(6),
    trialRoundId: uid(9),
    kind: 'REGISTER' as const,
    priorFactId: null,
    judgmentReceivedAt: judgment.judgmentReceivedAt,
    judgmentAmountState: judgment.judgmentAmountState,
    judgmentAmount: judgment.judgmentAmount,
    paidLitigationFeeState: judgment.paidLitigationFeeState,
    paidLitigationFee: judgment.paidLitigationFee,
    fromVersion: 35,
    toVersion: 36,
    recordedAt: '2026-10-05T00:00:00Z',
    files: judgment.files,
  };
  item.judgment.current = judgmentFact;
  item.judgment.history = [judgmentFact];
  item.closure.history = [item.closure.current];
  return item;
}

const wrappers: ReturnType<typeof mount>[] = [];
async function render(recordPanel?: Component) {
  const pinia = createPinia();
  const auth = useAuthStore(pinia);
  auth.session = {
    principalType: 'INTERNAL',
    user: { id: 'user-1', username: 'synthetic', displayName: '合成运营' },
    department: { id: 'department-1', name: '合成部门' },
    departments: [{ id: 'department-1', name: '合成部门' }],
    customer: null,
    notaryOffice: null,
    authorizationRevision: 1,
    expiresAt: '2099-01-01T00:00:00Z',
    csrfToken: 'synthetic',
  };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/cases', component: CaseListPage },
      { path: '/other', component: { template: '<p>other</p>' } },
    ],
  });
  await router.push('/cases?view=department&stage=WAITING_JUDGMENT&page=2');
  await router.isReady();
  const wrapper = mount(RouterView, {
    global: {
      plugins: [pinia, router],
      stubs: {
        ...(recordPanel
          ? { CaseSectionRecordCorrectionPanel: recordPanel }
          : {}),
        ElDrawer: {
          props: ['modelValue'],
          template:
            '<section v-if="modelValue" role="dialog"><slot/><slot name="footer"/></section>',
        },
      },
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, router, auth };
}
async function choose(
  wrapper: ReturnType<typeof mount>,
  branch: 'APPEAL' | 'EXECUTION' = 'APPEAL',
) {
  await wrapper.get('[data-case-action="choose-next-step"]').trigger('click');
  await flushPromises();
  const panel = wrapper.get('[data-test="case-judgment-next-step-panel"]');
  await panel.get(`input[value="${branch}"]`).setValue();
  await panel.get('input[type="checkbox"]').setValue(true);
  await panel.get('form').trigger('submit');
  await panel.get('[data-confirm-choice]').trigger('click');
  await flushPromises();
}
beforeEach(() => {
  sessionStorage.clear();
  vi.resetAllMocks();
  api.listCases.mockResolvedValue(list());
  api.getCase.mockResolvedValue({
    ...withJudgment(),
    canChooseJudgmentNextStep: true,
  });
  api.getExternalEntryOptions.mockResolvedValue({ canCreate: false });
  api.chooseCaseJudgmentNextStep.mockResolvedValue({
    id: 'case-1',
    stage: 'SECOND_INSTANCE',
    version: 8,
  });
  materials.listOwnerMaterials.mockResolvedValue({ items: [], total: 0 });
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('case list workflow session', () => {
  it('reuses previously uploaded complaint materials without uploading or advancing before explicit submit', async () => {
    const detail = {
      ...baseItem,
      stage: 'WAITING_COMPLAINT' as const,
      canSubmitComplaint: true,
    };
    api.getCase.mockResolvedValue(detail);
    api.listCases.mockResolvedValue(
      list([{ ...summary(detail), canChooseJudgmentNextStep: false }]),
    );
    materials.listOwnerMaterials.mockResolvedValue({
      items: [
        {
          id: 'material-1',
          status: 'ACTIVE',
          category: 'COMPLAINT',
          currentVersionId: 'file-1',
          contentVersions: [
            {
              id: 'file-1',
              originalFilename: '原起诉状.pdf',
              mimeType: 'application/pdf',
            },
          ],
        },
        {
          id: 'material-2',
          status: 'ACTIVE',
          category: 'AUTHORIZATION',
          currentVersionId: 'file-2',
          contentVersions: [
            {
              id: 'file-2',
              originalFilename: '原授权.pdf',
              mimeType: 'application/pdf',
            },
          ],
        },
      ],
      total: 2,
    });
    api.submitComplaint.mockResolvedValue({
      id: 'case-1',
      stage: 'WAITING_COMPLAINT_CONFIRMATION',
      version: 8,
    });
    const { wrapper } = await render();
    await wrapper.get('[data-case-action="complaint"]').trigger('click');
    await flushPromises();
    expect(
      wrapper.get('[data-test="complaint-amount-choice"]').element,
    ).toHaveProperty('value', '');
    await wrapper
      .get('[data-test="complaint-amount-choice"]')
      .setValue('PENDING');
    expect(wrapper.text()).toContain('原起诉状.pdf');
    expect(wrapper.text()).toContain('原授权.pdf');
    expect(materials.uploadMaterialFile).not.toHaveBeenCalled();
    expect(api.submitComplaint).not.toHaveBeenCalled();
    const pendingReason = wrapper
      .findAll('label')
      .find((label) => label.text().includes('待补充原因'))!;
    await pendingReason.get('input').setValue('尚待核定标的额');
    await wrapper.get('[data-test="submit-complaint"]').trigger('click');
    await flushPromises();
    expect(api.submitComplaint).toHaveBeenCalledWith(
      'case-1',
      expect.objectContaining({
        complaintContentVersionIds: ['file-1'],
        authorizationContentVersionIds: ['file-2'],
        amountState: 'PENDING',
        amount: null,
        pendingReason: '尚待核定标的额',
      }),
    );
  });
  it('requires an explicit branch, posts from the row, and reloads once at the same page/filter', async () => {
    const { wrapper, router } = await render();
    await wrapper.get('[data-case-action="choose-next-step"]').trigger('click');
    await flushPromises();
    const panel = wrapper.get('[data-test="case-judgment-next-step-panel"]');
    expect(panel.findAll('input[type="radio"]:checked')).toHaveLength(0);
    expect(
      panel.get('button[type="submit"]').attributes('disabled'),
    ).toBeDefined();
    await panel.get('input[value="APPEAL"]').setValue();
    expect(
      panel.get('button[type="submit"]').attributes('disabled'),
    ).toBeDefined();
    await panel.get('input[data-plaintiff-appeals]').setValue(true);
    await panel.get('form').trigger('submit');
    api.listCases.mockResolvedValueOnce(
      list([{ ...summary(), id: 'case-2', businessNo: 'CA-2' }]),
    );
    await panel.get('[data-confirm-choice]').trigger('click');
    await flushPromises();
    expect(api.chooseCaseJudgmentNextStep).toHaveBeenCalledTimes(1);
    expect(api.chooseCaseJudgmentNextStep.mock.calls[0]).toEqual([
      'case-1',
      expect.objectContaining({
        next: 'APPEAL',
        plaintiffAppeals: true,
        defendantIds: [],
        judgmentId: 'judgment-1',
        expectedVersion: 7,
        idempotencyKey: expect.any(String),
      }),
    ]);
    expect(api.listCases).toHaveBeenCalledTimes(2);
    expect(api.listCases.mock.calls[1]).toEqual([
      2,
      20,
      expect.objectContaining({
        view: 'department',
        stage: 'WAITING_JUDGMENT',
      }),
    ]);
    expect(router.currentRoute.value.fullPath).toBe(
      '/cases?view=department&stage=WAITING_JUDGMENT&page=2',
    );
    expect(wrapper.find('[data-test="case-list-workflow"]').exists()).toBe(
      false,
    );
    expect(wrapper.get('tbody').text()).not.toContain('CA-1');
    expect(sessionStorage.length).toBe(0);
  });
  it('cancels without POST and Back/Forward cancels an idle drawer', async () => {
    const { wrapper, router } = await render();
    await wrapper.get('[data-case-action="choose-next-step"]').trigger('click');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '取消／返回列表')!
      .trigger('click');
    expect(api.chooseCaseJudgmentNextStep).not.toHaveBeenCalled();
    await router.push('/cases?view=department&stage=WAITING_JUDGMENT&page=1');
    await flushPromises();
    await wrapper.get('[data-case-action="choose-next-step"]').trigger('click');
    await flushPromises();
    router.back();
    await flushPromises();
    expect(wrapper.find('[data-test="case-list-workflow"]').exists()).toBe(
      false,
    );
    router.forward();
    await flushPromises();
    expect(wrapper.find('[data-test="case-list-workflow"]').exists()).toBe(
      false,
    );
  });
  it('blocks duplicate requests and navigation while sending, ignores a late result after authorization changes', async () => {
    let resolve!: (value: unknown) => void;
    api.chooseCaseJudgmentNextStep.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { wrapper, router, auth } = await render();
    await choose(wrapper, 'EXECUTION');
    expect(api.chooseCaseJudgmentNextStep).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-confirm-choice]').exists()).toBe(false);
    await wrapper.get('[data-case-action="choose-next-step"]').trigger('click');
    await router.push('/other');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/cases');
    expect(api.chooseCaseJudgmentNextStep).toHaveBeenCalledTimes(1);
    auth.session = { ...auth.session!, authorizationRevision: 2 };
    await flushPromises();
    const count = api.listCases.mock.calls.length;
    resolve({ id: 'case-1', stage: 'WAITING_EXECUTION_DOCUMENTS', version: 8 });
    await flushPromises();
    expect(api.listCases).toHaveBeenCalledTimes(count);
    expect(wrapper.find('[data-test="case-list-workflow"]').exists()).toBe(
      false,
    );
  });
  it('restores an unknown original command after remount and replays exactly its body/key', async () => {
    api.chooseCaseJudgmentNextStep.mockRejectedValueOnce(
      new ApiError('lost', 503, 'NETWORK_ERROR'),
    );
    const first = await render();
    await choose(first.wrapper, 'EXECUTION');
    const original = structuredClone(
      api.chooseCaseJudgmentNextStep.mock.calls[0],
    );
    expect(first.wrapper.find('[data-test="retry-original"]').exists()).toBe(
      true,
    );
    expect(api.listCases).toHaveBeenCalledTimes(1);
    first.wrapper.unmount();
    const second = await render();
    await second.wrapper
      .get('[data-case-action="choose-next-step"]')
      .trigger('click');
    await flushPromises();
    expect(second.wrapper.find('[data-test="retry-original"]').exists()).toBe(
      true,
    );
    expect(api.chooseCaseJudgmentNextStep).toHaveBeenCalledTimes(1);
    await second.wrapper.get('[data-test="retry-original"]').trigger('click');
    await flushPromises();
    expect(api.chooseCaseJudgmentNextStep.mock.calls[1]).toEqual(original);
    expect(sessionStorage.length).toBe(0);
  });
  it('recovers a committed unknown command even when the case has left the current filter', async () => {
    api.chooseCaseJudgmentNextStep.mockRejectedValueOnce(
      new ApiError('lost', 503, 'NETWORK_ERROR'),
    );
    const first = await render();
    await choose(first.wrapper, 'EXECUTION');
    first.wrapper.unmount();
    api.listCases.mockResolvedValue(
      list([{ ...summary(), id: 'case-2', businessNo: 'CA-2' }]),
    );
    api.getCase.mockResolvedValue({
      ...withJudgment(),
      stage: 'WAITING_EXECUTION_DOCUMENTS',
      canChooseJudgmentNextStep: false,
    });
    const second = await render();
    expect(second.wrapper.get('tbody').text()).not.toContain('CA-1');
    const recovery = second.wrapper.get('[aria-label="未确认的案件办理请求"]');
    await recovery.get('button').trigger('click');
    await flushPromises();
    await second.wrapper.get('[data-test="retry-original"]').trigger('click');
    await flushPromises();
    expect(api.chooseCaseJudgmentNextStep.mock.calls[1]).toEqual(
      api.chooseCaseJudgmentNextStep.mock.calls[0],
    );
  });
  it('preserves editing inputs on a rejected command and permits explicit retry without advancing', async () => {
    const detail = withJudgment();
    detail.canCorrectJudgment = true;
    detail.judgment.current!.files = [
      {
        materialId: 'material-1',
        contentVersionId: 'file-1',
        originalFilename: '判决.pdf',
        mimeType: 'application/pdf',
      },
    ];
    detail.judgment.history = [detail.judgment.current!];
    api.getCase.mockResolvedValue(detail);
    api.listCases.mockResolvedValue(
      list([{ ...summary(detail), canChooseJudgmentNextStep: false }]),
    );
    api.correctCaseJudgment
      .mockRejectedValueOnce(new ApiError('invalid', 400, 'VALIDATION_ERROR'))
      .mockResolvedValue({
        id: 'case-1',
        stage: 'WAITING_JUDGMENT',
        judgmentId: 'corrected',
        version: 8,
      });
    const { wrapper } = await render();
    await wrapper.get('[data-case-action="correct-judgment"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="judgment-date"]').element).toHaveProperty(
      'value',
      '2026-10-01',
    );
    await wrapper.get('[data-test="judgment-amount-state"]').setValue('KNOWN');
    await wrapper.get('[data-test="judgment-amount"]').setValue('42.50');
    await wrapper
      .get('[data-test="judgment-correction-reason"]')
      .setValue('核对原件金额');
    await wrapper.get('[data-test="judgment-correct"]').trigger('click');
    await flushPromises();
    expect(api.correctCaseJudgment).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-test="judgment-amount"]').element).toHaveProperty(
      'value',
      '42.50',
    );
    expect(api.listCases).toHaveBeenCalledTimes(1);
    expect(sessionStorage.length).toBe(0);
    await wrapper.get('[data-test="judgment-correct"]').trigger('click');
    await flushPromises();
    expect(api.correctCaseJudgment).toHaveBeenCalledTimes(2);
    expect(api.correctCaseJudgment.mock.calls[1][1]).toMatchObject({
      expectedVersion: 7,
      judgmentAmount: '42.50',
      reason: '核对原件金额',
      judgmentContentVersionIds: ['file-1'],
    });
    expect(api.chooseCaseJudgmentNextStep).not.toHaveBeenCalled();
  });
  it('saves second-instance progress in place without registering a result or acceptance', async () => {
    const detail = withJudgment();
    detail.stage = 'SECOND_INSTANCE';
    detail.canSaveSecondInstance = true;
    detail.judgmentNextStep.current = {
      id: 'choice-1',
      trialRoundId: 'round-1',
      judgmentId: 'judgment-1',
      next: 'APPEAL',
      plaintiffRightsHolderId: 'holder-1',
      plaintiffName: '权利人甲',
      defendants: [],
      executionReadinessConfirmed: false,
      fromVersion: 6,
      toVersion: 7,
      recordedAt: '2026-10-01T00:00:00Z',
    };
    detail.secondInstance.currentTrialRoundId = 'round-1';
    detail.secondInstance.rounds = [
      { id: 'round-1', sequence: 1, sourceResultId: null, revokedAt: null },
    ];
    api.getCase.mockResolvedValue(detail);
    api.listCases.mockResolvedValue(
      list([{ ...summary(detail), canChooseJudgmentNextStep: false }]),
    );
    api.saveSecondInstance.mockResolvedValue({
      id: 'case-1',
      stage: 'SECOND_INSTANCE',
      version: 8,
    });
    const { wrapper } = await render();
    await wrapper.get('[data-case-action="second-instance"]').trigger('click');
    await flushPromises();
    await wrapper
      .get('[data-test="second-instance-hearing-at"]')
      .setValue('2026-10-15');
    await wrapper
      .get('[data-test="second-instance-progress-form"]')
      .trigger('submit');
    await flushPromises();
    expect(api.saveSecondInstance).toHaveBeenCalledTimes(1);
    expect(api.saveSecondInstance.mock.calls[0][1]).toMatchObject({
      trialRoundId: 'round-1',
      choiceId: 'choice-1',
      expectedProgressId: null,
      progress: {
        hearingAt: '2026-10-15',
        hearingPlace: null,
        judgeName: null,
        documentContentVersionIds: [],
        serviceContentVersionIds: [],
      },
    });
    expect(api.saveSecondInstance.mock.calls[0][1]).not.toHaveProperty(
      'result',
    );
    expect(api.listCases).toHaveBeenCalledTimes(2);
  });
  it('does not expose another actor recovery and denies a fresh revoked operation before POST', async () => {
    api.getCase.mockResolvedValue({
      ...withJudgment(),
      canChooseJudgmentNextStep: false,
    });
    const { wrapper } = await render();
    await wrapper.get('[data-case-action="choose-next-step"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('该操作当前不可办理');
    expect(wrapper.find('input[value="APPEAL"]').exists()).toBe(false);
    expect(api.chooseCaseJudgmentNextStep).not.toHaveBeenCalled();
  });
  it('fails closed on inaccessible recovery storage without POST', async () => {
    const { wrapper } = await render();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    await wrapper.get('[data-case-action="choose-next-step"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('尚未发送新请求');
    expect(api.chooseCaseJudgmentNextStep).not.toHaveBeenCalled();
  });
  it('rejects malformed recovered branches and preserves valid null/array fields', () => {
    const envelope = {
      version: 1,
      actor: 'actor',
      caseId: 'case-1',
      action: 'choose-next-step',
      command: {
        kind: 'choice',
        input: {
          expectedVersion: 7,
          idempotencyKey: 'original',
          judgmentId: 'judgment-1',
          next: 'APPEAL',
          plaintiffAppeals: true,
          defendantIds: [],
        },
      },
    };
    expect(decodeCaseListRequest(envelope)).toEqual(envelope);
    expect(
      decodeCaseListRequest({
        ...envelope,
        command: {
          ...envelope.command,
          input: { ...envelope.command.input, next: 'EXECUTION' },
        },
      }),
    ).toBeNull();
    expect(
      decodeCaseListRequest({
        ...envelope,
        command: {
          ...envelope.command,
          input: { ...envelope.command.input, extra: true },
        },
      }),
    ).toBeNull();
  });
});

type RecordAdmission = (input: {
  caseId: string;
  request: CaseSectionRecordRequest;
  recovery: boolean;
}) => boolean;
const RecordPanelStub = defineComponent({
  props: {
    item: { type: Object as PropType<CaseDetail>, required: true },
    kind: { type: String as PropType<CaseSectionRecordKind>, required: true },
    actorKey: String,
    contextKey: String,
    initialTargetId: String,
    beforeSubmit: Function as PropType<RecordAdmission>,
  },
  emits: ['changed', 'state-change', 'refresh', 'cancel', 'access-lost'],
  template: '<section data-test="record-panel-contract" />',
});
const recordActor = 'INTERNAL:user-1:department-1';
function recordRequest(
  targetId = uid(5),
): Extract<CaseSectionRecordRequest, { kind: 'hearing' }> {
  return {
    kind: 'hearing',
    input: {
      arrangementId: targetId,
      trialRoundId: uid(9),
      expectedHearingRevision: 0,
      idempotencyKey: uid(30),
      hearingAt: '2026-10-07',
      reason: '核对原登记日期',
    },
  };
}
function retainRecord(request = recordRequest(), actor = recordActor) {
  const stored = { version: 1, actor, caseId: uid(1), request };
  const key = caseSectionRecordStorageKey(actor, uid(1), request);
  sessionStorage.setItem(key, JSON.stringify(stored));
  return { key, stored, raw: JSON.stringify(stored) };
}
async function openRecords(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('[data-case-record-edit]').trigger('click');
  await flushPromises();
}
describe('case list section record host contract', () => {
  beforeEach(() => {
    const detail = recordFixture();
    api.getCase.mockResolvedValue(detail);
    api.listCases.mockResolvedValue(
      list([{ ...summary(detail), canChooseJudgmentNextStep: false }]),
    );
  });

  it('freshly reads one detail and exposes only the six permitted record commands', async () => {
    const { wrapper } = await render(RecordPanelStub);
    expect(api.getCase).not.toHaveBeenCalled();
    await openRecords(wrapper);
    expect(api.getCase).toHaveBeenCalledTimes(1);
    expect(api.getCase.mock.calls[0]![0]).toBe(uid(1));
    const selector = wrapper.get('[data-test="case-list-record-kind"]');
    expect(
      selector.findAll('option').map((option) => option.attributes('value')),
    ).toEqual(['', ...sectionRecordCommands.map((command) => command.kind)]);
    expect(wrapper.findComponent(RecordPanelStub).exists()).toBe(false);
    for (const command of sectionRecordCommands) {
      await selector.setValue(command.kind);
      const child = wrapper.getComponent(RecordPanelStub);
      expect(child.props('kind')).toBe(command.kind);
      expect(child.props('actorKey')).toBe(recordActor);
      expect(child.props('contextKey')).toContain(':1');
    }
    expect(api.correctCaseJudgment).not.toHaveBeenCalled();
    expect(api.chooseCaseJudgmentNextStep).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('保存不会推进案件阶段');
  });

  it('uses fresh record canEdit permissions without falling back to old workflow corrections', async () => {
    const detail = recordFixture();
    detail.recordEdits!.hearings![0]!.canEdit = false;
    detail.recordEdits!.judgments![0]!.canEdit = false;
    detail.canCorrectJudgment = true;
    api.getCase.mockResolvedValue(detail);
    const { wrapper } = await render(RecordPanelStub);
    await openRecords(wrapper);
    const selector = wrapper.get('[data-test="case-list-record-kind"]');
    expect(selector.find('option[value="judgment"]').exists()).toBe(false);
    expect(selector.find('option[value="hearing"]').exists()).toBe(false);
    expect(api.correctCaseJudgment).not.toHaveBeenCalled();
  });

  it('shows an explicit empty state and permits cancellation without a POST', async () => {
    api.getCase.mockResolvedValue(baseItem);
    api.listCases.mockResolvedValue(
      list([{ ...summary(), canChooseJudgmentNextStep: false }]),
    );
    const { wrapper } = await render(RecordPanelStub);
    await openRecords(wrapper);
    expect(
      wrapper.get('[data-test="case-list-record-unavailable"]').text(),
    ).toContain('没有可更正');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '取消／返回列表')!
      .trigger('click');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(api.listCases).toHaveBeenCalledTimes(1);
  });

  it('admits synchronously once, blocks navigation while busy, and refreshes the original query once on success', async () => {
    const { wrapper, router } = await render(RecordPanelStub);
    await openRecords(wrapper);
    await wrapper
      .get('[data-test="case-list-record-kind"]')
      .setValue('hearing');
    const child = wrapper.getComponent(RecordPanelStub);
    const admit = child.props('beforeSubmit')!;
    const input = { caseId: uid(1), request: recordRequest(), recovery: false };
    expect(admit(input)).toBe(true);
    expect(admit(input)).toBe(false);
    child.vm.$emit('state-change', 'submitting');
    await router.push('/other');
    expect(router.currentRoute.value.path).toBe('/cases');
    child.vm.$emit('changed');
    child.vm.$emit('changed');
    child.vm.$emit('state-change', 'idle');
    await flushPromises();
    expect(api.listCases).toHaveBeenCalledTimes(2);
    expect(api.listCases.mock.calls[1]).toEqual([
      2,
      20,
      expect.objectContaining({
        view: 'department',
        stage: 'WAITING_JUDGMENT',
      }),
    ]);
    expect(router.currentRoute.value.query.page).toBe('2');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it('settles a local failure to idle and cancels the original drawer without refreshing', async () => {
    const { wrapper, router } = await render(RecordPanelStub);
    await openRecords(wrapper);
    await wrapper
      .get('[data-test="case-list-record-kind"]')
      .setValue('hearing');
    const child = wrapper.getComponent(RecordPanelStub);
    expect(
      child.props('beforeSubmit')!({
        caseId: uid(1),
        request: recordRequest(),
        recovery: false,
      }),
    ).toBe(true);
    child.vm.$emit('state-change', 'idle');
    await flushPromises();
    child.vm.$emit('cancel');
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(api.listCases).toHaveBeenCalledTimes(1);
    await router.push('/other');
    expect(router.currentRoute.value.path).toBe('/other');
  });

  it('keeps unknown requests frozen and admits only an identical explicit recovery', async () => {
    const { wrapper, router } = await render(RecordPanelStub);
    await openRecords(wrapper);
    await wrapper
      .get('[data-test="case-list-record-kind"]')
      .setValue('hearing');
    const child = wrapper.getComponent(RecordPanelStub);
    const admit = child.props('beforeSubmit')!;
    const request = recordRequest();
    expect(admit({ caseId: uid(1), request, recovery: false })).toBe(true);
    const retained = retainRecord(request);
    child.vm.$emit('state-change', 'unknown');
    await flushPromises();
    await router.push('/other');
    expect(router.currentRoute.value.path).toBe('/cases');
    expect(admit({ caseId: uid(1), request, recovery: false })).toBe(false);
    expect(
      admit({
        caseId: uid(1),
        request: {
          ...request,
          input: { ...request.input, idempotencyKey: uid(31) },
        },
        recovery: true,
      }),
    ).toBe(false);
    expect(admit({ caseId: uid(1), request, recovery: true })).toBe(true);
    expect(sessionStorage.getItem(retained.key)).toBe(retained.raw);
    child.vm.$emit('state-change', 'unknown');
    expect(api.listCases).toHaveBeenCalledTimes(1);
  });

  it('recovers every off-filter target with the stable actor after authorization revision changes', async () => {
    const first = retainRecord();
    const second = retainRecord(recordRequest(uid(11)));
    api.listCases.mockResolvedValue(list([]));
    const { wrapper, auth } = await render(RecordPanelStub);
    auth.session = { ...auth.session!, authorizationRevision: 2 };
    await flushPromises();
    const recoveries = wrapper
      .get('[aria-label="资料更正原请求恢复"]')
      .findAll('button');
    expect(recoveries).toHaveLength(2);
    await recoveries[1]!.trigger('click');
    await flushPromises();
    const child = wrapper.getComponent(RecordPanelStub);
    expect(child.props('initialTargetId')).toBe(uid(11));
    expect(child.props('actorKey')).toBe(recordActor);
    expect(child.props('contextKey')).toContain(':2');
    expect(
      child.props('beforeSubmit')!({
        caseId: uid(1),
        request: recordRequest(uid(11)),
        recovery: true,
      }),
    ).toBe(true);
    expect(sessionStorage.getItem(first.key)).toBe(first.raw);
    expect(sessionStorage.getItem(second.key)).toBe(second.raw);
  });

  it('ignores another actor and visibly blocks malformed or misplaced recovery records', async () => {
    retainRecord(recordRequest(), 'INTERNAL:other:department-1');
    expect(readCaseListRecordRecoveries(recordActor)).toEqual([]);
    const retained = retainRecord();
    sessionStorage.setItem(retained.key, retained.raw.replace(uid(5), uid(11)));
    expect(() => readCaseListRecordRecoveries(recordActor)).toThrow();
    const { wrapper } = await render(RecordPanelStub);
    expect(wrapper.get('[aria-label="资料更正原请求恢复"]').text()).toContain(
      '无法核对',
    );
    expect(
      wrapper.get('[data-case-record-edit]').attributes('disabled'),
    ).toBeDefined();
    expect(api.getCase).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(retained.key)).not.toBeNull();
  });

  it('allows a fresh session for another retained target after the selected request is known to have failed', async () => {
    const first = retainRecord();
    const second = retainRecord(recordRequest(uid(11)));
    const { wrapper } = await render(RecordPanelStub);
    await wrapper
      .get('[aria-label="资料更正原请求恢复"]')
      .findAll('button')[0]!
      .trigger('click');
    await flushPromises();
    const child = wrapper.getComponent(RecordPanelStub);
    expect(
      child.props('beforeSubmit')!({
        caseId: uid(1),
        request: recordRequest(),
        recovery: true,
      }),
    ).toBe(true);
    sessionStorage.removeItem(first.key);
    child.vm.$emit('state-change', 'idle');
    await flushPromises();
    child.vm.$emit('cancel');
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(api.listCases).toHaveBeenCalledTimes(1);
    const recoveries = wrapper
      .get('[aria-label="资料更正原请求恢复"]')
      .findAll('button');
    expect(recoveries).toHaveLength(1);
    await recoveries[0]!.trigger('click');
    await flushPromises();
    expect(wrapper.getComponent(RecordPanelStub).props('initialTargetId')).toBe(
      uid(11),
    );
    expect(sessionStorage.getItem(second.key)).toBe(second.raw);
  });

  it('invalidates stale events on auth changes and denies the active drawer on access loss', async () => {
    const { wrapper, auth } = await render(RecordPanelStub);
    await openRecords(wrapper);
    await wrapper
      .get('[data-test="case-list-record-kind"]')
      .setValue('hearing');
    const child = wrapper.getComponent(RecordPanelStub);
    expect(
      child.props('beforeSubmit')!({
        caseId: uid(1),
        request: recordRequest(),
        recovery: false,
      }),
    ).toBe(true);
    const retained = retainRecord();
    auth.session = { ...auth.session!, authorizationRevision: 2 };
    await flushPromises();
    child.vm.$emit('changed');
    await flushPromises();
    expect(sessionStorage.getItem(retained.key)).toBe(retained.raw);
    expect(api.listCases).toHaveBeenCalledTimes(2);
    await wrapper
      .get('[aria-label="资料更正原请求恢复"] button')
      .trigger('click');
    await flushPromises();
    wrapper.getComponent(RecordPanelStub).vm.$emit('access-lost');
    await flushPromises();
    expect(wrapper.text()).toContain('当前无法访问该记录');
    expect(sessionStorage.getItem(retained.key)).toBe(retained.raw);
    expect(api.listCases).toHaveBeenCalledTimes(2);
  });
});

const recordCommandsUnderTest = [
  {
    kind: 'execution-mailing',
    post: api.correctCaseExecutionMailingRecord,
    expected: {
      mailingId: uid(2),
      expectedMailingRevision: 0,
      mailReceiptContentVersionIds: [
        file.contentVersionId,
        otherFile.contentVersionId,
      ],
      reason: '列表核对资料',
    },
  },
  {
    kind: 'execution-filing',
    post: api.correctCaseExecutionFilingRecord,
    expected: {
      filingId: uid(3),
      expectedFilingRevision: 0,
      executionFilingProofContentVersionIds: [file.contentVersionId],
      reason: '列表核对资料',
    },
  },
  {
    kind: 'execution-finish',
    post: api.correctCaseExecutionFinishRecord,
    expected: {
      finishId: uid(4),
      expectedFinishRevision: 0,
      basisContentVersionIds: [file.contentVersionId],
      reason: '执行已结束',
      correctionReason: '列表核对资料',
    },
  },
  {
    kind: 'hearing',
    post: api.correctCaseHearingRecord,
    expected: {
      arrangementId: uid(5),
      trialRoundId: uid(9),
      expectedHearingRevision: 0,
      reason: '列表核对资料',
    },
  },
  {
    kind: 'judgment',
    post: api.correctCaseJudgmentRecord,
    expected: {
      judgmentId: uid(6),
      trialRoundId: uid(9),
      expectedJudgmentRevision: 0,
      judgmentContentVersionIds: [file.contentVersionId],
      reason: '列表核对资料',
    },
  },
  {
    kind: 'closure',
    post: api.correctCaseClosureRecord,
    expected: {
      closureId: uid(7),
      expectedClosureVersionId: uid(8),
      expectedClosureRevision: 0,
      closeContentVersionIds: [file.contentVersionId],
      correctionReason: '列表核对资料',
    },
  },
] as const;
async function editRecord(
  wrapper: ReturnType<typeof mount>,
  kind: CaseSectionRecordKind,
) {
  await openRecords(wrapper);
  await wrapper.get('[data-test="case-list-record-kind"]').setValue(kind);
  const panel = wrapper.get('[data-test="section-record-panel"]');
  await panel.get('[data-test="section-record-date"]').setValue('2026-10-07');
  await panel
    .get('[data-test="section-record-reason"]')
    .setValue('列表核对资料');
  return panel;
}
describe('case list with the original six record forms and adapters', () => {
  beforeEach(() => {
    const detail = recordFixture();
    api.getCase.mockResolvedValue(detail);
    api.listCases.mockResolvedValue(
      list([{ ...summary(detail), canChooseJudgmentNextStep: false }]),
    );
    api.correctCaseExecutionMailingRecord.mockImplementation(
      async (
        caseId: string,
        input: CaseApi.CorrectExecutionMailingRecordInput,
      ) => ({
        ...input,
        caseId,
        mailingRevision: input.expectedMailingRevision + 1,
      }),
    );
    api.correctCaseExecutionFilingRecord.mockImplementation(
      async (
        caseId: string,
        input: CaseApi.CorrectExecutionFilingRecordInput,
      ) => ({
        ...input,
        caseId,
        filingRevision: input.expectedFilingRevision + 1,
      }),
    );
    api.correctCaseExecutionFinishRecord.mockImplementation(
      async (
        caseId: string,
        input: CaseApi.CorrectExecutionFinishRecordInput,
      ) => ({
        ...input,
        caseId,
        finishRevision: input.expectedFinishRevision + 1,
      }),
    );
    api.correctCaseHearingRecord.mockImplementation(
      async (caseId: string, input: CaseApi.CorrectHearingRecordInput) => ({
        ...input,
        caseId,
        hearingRevision: input.expectedHearingRevision + 1,
      }),
    );
    api.correctCaseJudgmentRecord.mockImplementation(
      async (caseId: string, input: CaseApi.CorrectJudgmentRecordInput) => ({
        ...input,
        caseId,
        judgmentRevision: input.expectedJudgmentRevision + 1,
      }),
    );
    api.correctCaseClosureRecord.mockImplementation(
      async (caseId: string, input: CaseApi.CorrectClosureRecordInput) => ({
        ...input,
        caseId,
        closureRevision: input.expectedClosureRevision + 1,
      }),
    );
  });

  it.each(recordCommandsUnderTest)(
    'submits $kind using its exact target/revision/files while keeping the list query',
    async ({ kind, post, expected }) => {
      const { wrapper, router } = await render();
      const panel = await editRecord(wrapper, kind);
      await panel.get('[data-test="section-record-form"]').trigger('submit');
      await flushPromises();
      expect(post).toHaveBeenCalledTimes(1);
      expect(post.mock.calls[0]).toEqual([
        uid(1),
        expect.objectContaining({
          ...expected,
          idempotencyKey: expect.any(String),
        }),
        { signal: expect.any(AbortSignal) },
      ]);
      expect(post.mock.calls[0]![1]).not.toHaveProperty('expectedVersion');
      const getSignal = api.getCase.mock.calls[0]![1].signal;
      expect(post.mock.calls[0]![2].signal).not.toBe(getSignal);
      expect(api.correctCaseJudgment).not.toHaveBeenCalled();
      expect(api.chooseCaseJudgmentNextStep).not.toHaveBeenCalled();
      expect(api.listCases).toHaveBeenCalledTimes(2);
      expect(router.currentRoute.value.fullPath).toBe(
        '/cases?view=department&stage=WAITING_JUDGMENT&page=2',
      );
      expect(wrapper.find('[data-test="section-record-panel"]').exists()).toBe(
        false,
      );
      expect(sessionStorage.length).toBe(0);
    },
  );

  it('settles a known failure without advancing, keeps the editable form and permits a retry', async () => {
    api.correctCaseHearingRecord.mockRejectedValueOnce(
      new ApiError('核对原因', 400, 'VALIDATION_ERROR'),
    );
    const { wrapper } = await render();
    const panel = await editRecord(wrapper, 'hearing');
    await panel.get('[data-test="section-record-form"]').trigger('submit');
    await flushPromises();
    expect(api.listCases).toHaveBeenCalledTimes(1);
    expect(sessionStorage.length).toBe(0);
    expect(
      panel.get('[data-test="section-record-date"]').element,
    ).toHaveProperty('value', '2026-10-07');
    expect(
      panel.get('[data-test="section-record-save"]').attributes('disabled'),
    ).toBeUndefined();
    await panel.get('[data-test="section-record-form"]').trigger('submit');
    await flushPromises();
    expect(api.correctCaseHearingRecord).toHaveBeenCalledTimes(2);
    expect(api.listCases).toHaveBeenCalledTimes(2);
  });

  it('retains an unknown response and retries only the original body/key in the current W session', async () => {
    api.correctCaseJudgmentRecord.mockRejectedValueOnce(
      new ApiError('response lost', 0, 'NETWORK_ERROR'),
    );
    const { wrapper, router } = await render();
    const panel = await editRecord(wrapper, 'judgment');
    await panel.get('[data-test="section-record-form"]').trigger('submit');
    await flushPromises();
    expect(api.correctCaseJudgmentRecord).toHaveBeenCalledTimes(1);
    const original = api.correctCaseJudgmentRecord.mock.calls[0]![1];
    const stored = sessionStorage.getItem(sessionStorage.key(0)!);
    expect(stored).toContain(original.idempotencyKey);
    expect(
      wrapper.get('[data-test="case-list-record-kind"]').attributes('disabled'),
    ).toBeDefined();
    await panel.get('[data-test="section-record-form"]').trigger('submit');
    await router.push('/other');
    expect(router.currentRoute.value.path).toBe('/cases');
    expect(api.correctCaseJudgmentRecord).toHaveBeenCalledTimes(1);
    await panel.get('[data-test="section-record-retry"]').trigger('click');
    await flushPromises();
    expect(api.correctCaseJudgmentRecord).toHaveBeenCalledTimes(2);
    expect(api.correctCaseJudgmentRecord.mock.calls[1]![1]).toEqual(original);
    expect(api.listCases).toHaveBeenCalledTimes(2);
    expect(sessionStorage.length).toBe(0);
  });

  it('denies on POST permission loss and retains the exact request for the original actor', async () => {
    api.correctCaseHearingRecord.mockRejectedValueOnce(
      new ApiError('permission withdrawn', 403, 'FORBIDDEN'),
    );
    const { wrapper } = await render();
    const panel = await editRecord(wrapper, 'hearing');
    await panel.get('[data-test="section-record-form"]').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('当前无法访问该记录');
    expect(wrapper.find('[data-test="section-record-panel"]').exists()).toBe(
      false,
    );
    expect(api.listCases).toHaveBeenCalledTimes(1);
    expect(readCaseListRecordRecoveries(recordActor)).toEqual([
      { caseId: uid(1), kind: 'hearing', targetId: uid(5) },
    ]);
    expect(
      JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!).request.input,
    ).toEqual(api.correctCaseHearingRecord.mock.calls[0]![1]);
  });

  it('freshly reads after a 409 once W has settled and submits the new named revision', async () => {
    api.correctCaseHearingRecord.mockRejectedValueOnce(
      new ApiError('revision changed', 409, 'VERSION_CONFLICT'),
    );
    const { wrapper } = await render();
    const panel = await editRecord(wrapper, 'hearing');
    const fresh = recordFixture();
    fresh.recordEdits!.hearings![0]!.hearingRevision = 1;
    api.getCase.mockResolvedValue(fresh);
    await panel.get('[data-test="section-record-form"]').trigger('submit');
    await flushPromises();
    expect(api.getCase).toHaveBeenCalledTimes(2);
    expect(api.listCases).toHaveBeenCalledTimes(1);
    await wrapper
      .get('[data-test="section-record-date"]')
      .setValue('2026-10-08');
    await wrapper
      .get('[data-test="section-record-reason"]')
      .setValue('重新核对最新资料');
    await wrapper.get('[data-test="section-record-form"]').trigger('submit');
    await flushPromises();
    expect(api.correctCaseHearingRecord).toHaveBeenCalledTimes(2);
    expect(api.correctCaseHearingRecord.mock.calls[1]![1]).toMatchObject({
      expectedHearingRevision: 1,
      hearingAt: '2026-10-08',
    });
    expect(api.listCases).toHaveBeenCalledTimes(2);
  });

  it('restores the second off-filter target exactly and never sends automatically', async () => {
    retainRecord();
    const second = retainRecord(recordRequest(uid(11)));
    const detail = recordFixture();
    detail.recordEdits!.hearings!.push({
      ...detail.recordEdits!.hearings![0]!,
      arrangementId: uid(11),
    });
    api.getCase.mockResolvedValue(detail);
    api.listCases.mockResolvedValue(list([]));
    const { wrapper, router } = await render();
    await wrapper
      .get('[aria-label="资料更正原请求恢复"]')
      .findAll('button')[1]!
      .trigger('click');
    await flushPromises();
    expect(
      wrapper.get('[data-test="section-record-target"]').element,
    ).toHaveProperty('value', uid(11));
    expect(
      wrapper.get('[data-test="case-list-record-kind"]').attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.get('[data-test="section-record-target"]').attributes('disabled'),
    ).toBeDefined();
    expect(api.correctCaseHearingRecord).not.toHaveBeenCalled();
    await router.push('/other');
    expect(router.currentRoute.value.path).toBe('/cases');
    await wrapper.get('[data-test="section-record-retry"]').trigger('click');
    await flushPromises();
    expect(api.correctCaseHearingRecord.mock.calls[0]![1]).toEqual(
      second.stored.request.input,
    );
    expect(readCaseListRecordRecoveries(recordActor)).toEqual([
      { caseId: uid(1), kind: 'hearing', targetId: uid(5) },
    ]);
    expect(api.listCases).toHaveBeenCalledTimes(2);
    await wrapper
      .get('[aria-label="资料更正原请求恢复"] button')
      .trigger('click');
    await flushPromises();
    expect(
      wrapper.get('[data-test="section-record-target"]').element,
    ).toHaveProperty('value', uid(5));
  });

  it('preserves unknown body/key through re-mount and ignores a late response after authorization changes', async () => {
    let resolve!: (value: unknown) => void;
    api.correctCaseHearingRecord.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const first = await render();
    const panel = await editRecord(first.wrapper, 'hearing');
    await panel.get('[data-test="section-record-form"]').trigger('submit');
    await flushPromises();
    const original = api.correctCaseHearingRecord.mock.calls[0]!;
    const raw = sessionStorage.getItem(sessionStorage.key(0)!);
    expect(original[2].signal.aborted).toBe(false);
    first.auth.session = { ...first.auth.session!, authorizationRevision: 2 };
    await flushPromises();
    expect(original[2].signal.aborted).toBe(true);
    const count = api.listCases.mock.calls.length;
    resolve({ ...original[1], caseId: uid(1), hearingRevision: 1 });
    await flushPromises();
    expect(api.listCases).toHaveBeenCalledTimes(count);
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(raw);
    first.wrapper.unmount();
    api.listCases.mockResolvedValue(list([]));
    const second = await render();
    await second.wrapper
      .get('[aria-label="资料更正原请求恢复"] button')
      .trigger('click');
    await flushPromises();
    expect(api.correctCaseHearingRecord).toHaveBeenCalledTimes(1);
    await second.wrapper
      .get('[data-test="section-record-retry"]')
      .trigger('click');
    await flushPromises();
    expect(api.correctCaseHearingRecord.mock.calls[1]![1]).toEqual(original[1]);
    expect(sessionStorage.length).toBe(0);
  });
});
