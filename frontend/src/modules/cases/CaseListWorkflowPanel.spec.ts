import { flushPromises, mount } from '@vue/test-utils';
import { RouterView, createRouter, createMemoryHistory } from 'vue-router';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseDetail, CaseSummary } from '../../api/cases';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import CaseListPage from './CaseListPage.vue';
import { decodeCaseListRequest } from './CaseListWorkflowPanel.vue';

const api = vi.hoisted(() => ({
  getCase: vi.fn(),
  listCases: vi.fn(),
  getExternalEntryOptions: vi.fn(),
  chooseCaseJudgmentNextStep: vi.fn(),
  correctCaseJudgment: vi.fn(),
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
const wrappers: ReturnType<typeof mount>[] = [];
async function render() {
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
