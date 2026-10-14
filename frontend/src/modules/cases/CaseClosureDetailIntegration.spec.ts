import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseClosureSession } from '../../api/cases';
import { ApiError } from '../../api/http';
import type {
  CaseDetail,
  CaseClosureResult,
  CaseClosureVersion,
  LawyerCaseDetail,
  RecordCaseClosureInput,
} from '../../api/cases';
import { useAuthStore } from '../../stores/auth';
import CaseDetailPage from './CaseDetailPage.vue';
import LawyerCaseDetailPage from './LawyerCaseDetailPage.vue';
import CaseClosurePanel from './CaseClosurePanel.vue';
import { workflowChangedEvent } from '../../app/workflow-events';

const api = vi.hoisted(() => ({
  getCase: vi.fn(),
  getLead: vi.fn(),
  getLawyerCase: vi.fn(),
  recordCaseClosure: vi.fn(),
  correctCaseClosure: vi.fn(),
  listOwnerMaterials: vi.fn(),
  uploadMaterialFile: vi.fn(),
  downloadMaterialVersion: vi.fn(),
}));
vi.mock('../../api/leads', () => ({ getLead: api.getLead }));
vi.mock('../../api/cases', async (original) => ({
  ...(await original<typeof import('../../api/cases')>()),
  getCase: api.getCase,
  getLawyerCase: api.getLawyerCase,
  recordCaseClosure: api.recordCaseClosure,
  correctCaseClosure: api.correctCaseClosure,
}));
vi.mock('../../api/materials', async (original) => ({
  ...(await original<typeof import('../../api/materials')>()),
  listOwnerMaterials: api.listOwnerMaterials,
  uploadMaterialFile: api.uploadMaterialFile,
  downloadMaterialVersion: api.downloadMaterialVersion,
}));

const finishId = '80000000-0000-4000-8000-000000000191';
const closureId = '80000000-0000-4000-8000-000000000201';
const versionId = '80000000-0000-4000-8000-000000000202';
const file = {
  materialId: '80000000-0000-4000-8000-000000000101',
  contentVersionId: '80000000-0000-4000-8000-000000000102',
  originalFilename: '真实结案资料.pdf',
  mimeType: 'application/pdf',
};
const receipt: CaseClosureResult = {
  id: 'case-a',
  closureId,
  closureVersionId: versionId,
  finishId,
  stage: 'WAITING_ARCHIVE',
  version: 20,
  recordedAt: '2026-10-13T10:00:00.000Z',
};
function base(): CaseDetail {
  return {
    id: 'case-a',
    businessNo: 'CA-20261013-001',
    stage: 'WAITING_ARCHIVE',
    version: 19,
    createdAt: '2026-10-01T00:00:00Z',
    owner: { id: 'operator-1', displayName: '运营甲' },
    sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
    sourceNotaryMatter: { id: 'matter-1', businessNo: 'NZ-1' },
    department: { id: 'department-1', name: '知产部' },
    customer: { id: 'customer-1', name: '客户甲' },
    rightsHolder: { id: 'rights-1', name: '权利人甲' },
    courtCaseNo: '（2026）沪0101民初123号',
    canMatch: false,
    canSubmitExecution: false,
    canConfirmExecution: false,
    canMailExecution: false,
    canSubmitExecutionFiling: false,
    canFinishExecution: false,
    canRecordClosure: true,
    canCorrectClosure: false,
    canArchive: false,
    canCorrectArchive: false,
    canSubmitComplaint: false,
    canConfirmComplaint: false,
    canMailComplaint: false,
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
    certificate: {
      certificateNo: 'Z-1',
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
    complaint: null,
    complaintConfirmation: null,
    complaintMailing: null,
    filingSubmission: null,
    acceptance: null,
    acceptances: [],
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
    executionConfirmation: null,
    executionMailing: null,
    executionFiling: {
      id: 'filing-1',
      mailingId: 'mailing-1',
      submittedAt: '2026-10-01',
      recordedAt: '2026-10-01T00:00:00Z',
      files: [],
    },
    executionFinish: {
      id: finishId,
      filingId: 'filing-1',
      finishedAt: '2026-10-01',
      reason: '真实执行结束',
      basisNote: '法院说明',
      recordedAt: '2026-10-01T00:00:00Z',
      files: [],
    },
    closure: null,
    archive: null,
  };
}
function registered(
  input: RecordCaseClosureInput,
  correction = false,
): CaseDetail {
  const original: CaseClosureVersion = {
    id: versionId,
    kind: 'REGISTER',
    priorVersionId: null,
    finishId,
    fromVersion: 19,
    toVersion: 20,
    closeAt: input.closeAt,
    closeAmountState: input.closeAmountState,
    closeAmt: input.closeAmt === '0' ? '0.00' : input.closeAmt,
    note: input.note,
    correctionReason: null,
    recordedAt: receipt.recordedAt,
    recordedByUserId: 'operator-1',
    files: input.closeContentVersionIds.length ? [file] : [],
  };
  const current: CaseClosureVersion = correction
    ? {
        ...original,
        id: '80000000-0000-4000-8000-000000000204',
        kind: 'CORRECT',
        priorVersionId: versionId,
        fromVersion: 20,
        toVersion: 21,
        correctionReason: '内部更正原因',
      }
    : original;
  return {
    ...base(),
    version: current.toVersion,
    canRecordClosure: false,
    canCorrectClosure: true,
    canArchive: false,
    canCorrectArchive: false,
    closure: {
      id: closureId,
      finishId,
      current,
      history: correction ? [original, current] : [original],
    },
  };
}
function lawyerProjection(item: CaseDetail): LawyerCaseDetail {
  const {
    owner,
    department,
    sourceLead,
    sourceNotaryMatter,
    fees,
    closure,
    ...rest
  } = item;
  void owner;
  void department;
  void sourceLead;
  void sourceNotaryMatter;
  void fees;
  const project = (entry: CaseClosureVersion) => {
    const { correctionReason, recordedByUserId, ...business } = entry;
    void correctionReason;
    void recordedByUserId;
    return business;
  };
  return {
    ...rest,
    canMatch: false,
    canCorrectHearing: false,
    canCorrectJudgment: false,
    canRevokeJudgmentNextStep: false,
    canRevokeSecondInstanceResult: false,
    canCorrectClosure: false,
    canArchive: false,
    canCorrectArchive: false,
    closure: closure
      ? {
          ...closure,
          current: project(closure.current),
          history: closure.history.map(project),
        }
      : null,
  };
}
const wrappers: VueWrapper[] = [];
async function open(
  audience: 'internal' | 'lawyer',
  existing?: ReturnType<typeof createPinia>,
) {
  const pinia = existing ?? createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore(pinia);
  if (!existing)
    auth.session = {
      principalType: audience === 'lawyer' ? 'LAWYER' : 'INTERNAL',
      user: { id: `${audience}-1`, displayName: '办理人', username: 'actor' },
      department:
        audience === 'internal' ? { id: 'department-1', name: '知产部' } : null,
      departments: [],
      customer: null,
      notaryOffice: null,
      authorizationRevision: 1,
      expiresAt: '2026-10-14T00:00:00Z',
      csrfToken: 'csrf',
    };
  const page = audience === 'lawyer' ? LawyerCaseDetailPage : CaseDetailPage;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/cases', component: { template: '<div />' } },
      { path: '/lawyer/cases', component: { template: '<div />' } },
      { path: '/cases/:id', component: page },
      { path: '/lawyer/cases/:id', component: page },
    ],
  });
  await router.push(`${audience === 'lawyer' ? '/lawyer' : ''}/cases/case-a`);
  await router.isReady();
  const wrapper = mount(page, {
    global: {
      plugins: [pinia, router],
      stubs: {
        ElDrawer: {
          props: ['modelValue'],
          template:
            '<div v-show="modelValue" role="dialog" class="case-workspace-editors"><slot /></div>',
        },
        CaseExecutionFinishPanel: true,
        CaseAcceptancePanel: true,
        CaseHearingPanel: true,
        CaseJudgmentPanel: true,
        CaseJudgmentNextStepPanel: true,
        CaseSecondInstancePanel: true,
        CaseExecutionSubmissionPanel: true,
        CaseExecutionConfirmationPanel: true,
        CaseExecutionMailingPanel: true,
        CaseExecutionFilingPanel: true,
      },
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  if (audience === 'internal') {
    const primary = wrapper.find('[data-test="workspace-primary-action"]');
    if (primary.exists()) await primary.trigger('click');
    for (const button of wrapper.findAll('[data-command]'))
      await button.trigger('click');
    if (primary.exists()) await primary.trigger('click');
    await flushPromises();
  }
  return { wrapper, auth, router, pinia };
}
beforeEach(() => {
  vi.clearAllMocks();
  api.getCase.mockResolvedValue(base());
  api.getLawyerCase.mockResolvedValue(lawyerProjection(base()));
  api.getLead.mockRejectedValue(new ApiError('来源不可读', 403, 'FORBIDDEN'));
  api.listOwnerMaterials.mockResolvedValue({ items: [] });
  api.uploadMaterialFile.mockResolvedValue(file);
  api.downloadMaterialVersion.mockResolvedValue(undefined);
  api.recordCaseClosure.mockResolvedValue(receipt);
});
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
});

describe('real CA-016 closure detail integration', () => {
  it.each(['internal', 'lawyer'] as const)(
    'saves ordinary nullable registration through the actual %s panel with one workflow event',
    async (audience) => {
      const { wrapper } = await open(audience);
      expect(wrapper.findComponent(CaseClosurePanel).exists()).toBe(true);
      expect(
        wrapper
          .get('.case-workspace-subtitle, [data-test="court-case-no"]')
          .text(),
      ).toContain(base().courtCaseNo);
      expect(wrapper.get('[data-test="closure-date"]').element).toHaveProperty(
        'value',
        '',
      );
      expect(wrapper.find('[data-test="closure-amount"]').exists()).toBe(false);
      const changed = vi.fn();
      window.addEventListener(workflowChangedEvent, changed);
      try {
        const input: RecordCaseClosureInput = {
          expectedVersion: 19,
          expectedFinishId: finishId,
          idempotencyKey: 'server-key',
          closeAt: null,
          closeAmountState: 'PENDING',
          closeAmt: null,
          note: null,
          closeContentVersionIds: [],
        };
        const payload = registered(input);
        if (audience === 'lawyer')
          api.getLawyerCase.mockResolvedValue(lawyerProjection(payload));
        else api.getCase.mockResolvedValue(payload);
        await wrapper.get('[data-test="closure-submit"]').trigger('click');
        await flushPromises();
        expect(api.recordCaseClosure).toHaveBeenCalledTimes(1);
        expect(api.recordCaseClosure).toHaveBeenCalledWith(
          'case-a',
          expect.objectContaining({
            expectedVersion: 19,
            expectedFinishId: finishId,
            closeAt: null,
            closeAmountState: 'PENDING',
            closeAmt: null,
            note: null,
            closeContentVersionIds: [],
          }),
          audience,
        );
        expect(changed).toHaveBeenCalledTimes(1);
        expect(wrapper.get('[data-test="closure-current"]').text()).toContain(
          '待定',
        );
        expect(wrapper.text()).toContain('案件实收：未登记');
        expect(wrapper.get('[data-test="closure-panel"]').text()).not.toContain(
          '已结清',
        );
      } finally {
        window.removeEventListener(workflowChangedEvent, changed);
      }
    },
  );
  it('uses exact closure material versions, real zero and internal complete correction anchor', async () => {
    api.getLead.mockRejectedValue(new ApiError('来源不可读', 403, 'FORBIDDEN'));
    api.listOwnerMaterials.mockResolvedValue({
      items: [
        {
          id: file.materialId,
          status: 'ACTIVE',
          category: 'CASE_CLOSURE_DOCUMENT',
          currentVersionId: file.contentVersionId,
          contentVersions: [
            {
              id: 'old-version',
              originalFilename: '旧稿.pdf',
              mimeType: 'application/pdf',
            },
            {
              id: file.contentVersionId,
              originalFilename: file.originalFilename,
              mimeType: file.mimeType,
            },
          ],
        },
        {
          id: 'other',
          status: 'ACTIVE',
          category: 'EXECUTION_FINISH_BASIS',
          currentVersionId: 'wrong',
          contentVersions: [
            {
              id: 'wrong',
              originalFilename: '执行依据.pdf',
              mimeType: 'application/pdf',
            },
          ],
        },
      ],
    });
    const { wrapper } = await open('internal');
    expect(wrapper.findAll('[data-test="closure-choice"]')).toHaveLength(1);
    await wrapper.get('[data-test="closure-choice"]').setValue(true);
    await wrapper.get('[data-test="closure-amount-state"]').setValue('KNOWN');
    await wrapper.get('[data-test="closure-amount"]').setValue('0');
    const input: RecordCaseClosureInput = {
      expectedVersion: 19,
      idempotencyKey: 'ignored',
      expectedFinishId: finishId,
      closeAt: null,
      closeAmountState: 'KNOWN',
      closeAmt: '0',
      note: null,
      closeContentVersionIds: [file.contentVersionId],
    };
    api.getCase.mockResolvedValue(registered(input));
    await wrapper.get('[data-test="closure-submit"]').trigger('click');
    await flushPromises();
    expect(api.recordCaseClosure).toHaveBeenLastCalledWith(
      'case-a',
      expect.objectContaining({
        closeAmt: '0',
        closeContentVersionIds: [file.contentVersionId],
      }),
      'internal',
    );
    expect(wrapper.get('[data-test="closure-current"]').text()).toContain(
      '0.00',
    );
    // Remount clears only the form's success lock; the current full version is read from the server.
    wrapper.unmount();
    const next = await open('internal');
    await next.wrapper.get('[data-test="closure-correct"]').trigger('click');
    await next.wrapper
      .get('[data-test="closure-reason"]')
      .setValue('  实际内部原因  ');
    api.correctCaseClosure.mockResolvedValue({
      ...receipt,
      closureVersionId: '80000000-0000-4000-8000-000000000204',
      version: 21,
    });
    api.getCase.mockResolvedValue(registered(input, true));
    await next.wrapper.get('[data-test="closure-submit"]').trigger('click');
    await flushPromises();
    expect(api.correctCaseClosure).toHaveBeenCalledWith(
      'case-a',
      expect.objectContaining({
        expectedVersion: 20,
        expectedFinishId: finishId,
        expectedClosureVersionId: versionId,
        closeAt: null,
        closeAmountState: 'KNOWN',
        closeAmt: '0.00',
        note: null,
        correctionReason: '  实际内部原因  ',
        closeContentVersionIds: [file.contentVersionId],
      }),
    );
    expect(
      next.wrapper.findAll('[data-test="closure-history-version"]'),
    ).toHaveLength(2);
  });
  it('retains unknown original body/key through same-case refresh, remount and a competing fact; retries only explicitly', async () => {
    api.recordCaseClosure.mockRejectedValue(
      new ApiError('unknown', 500, 'INTERNAL_ERROR'),
    );
    const { wrapper, pinia, auth } = await open('internal');
    await wrapper.get('[data-test="closure-note"]').setValue('  原始说明  ');
    await wrapper.get('[data-test="closure-submit"]').trigger('click');
    await flushPromises();
    const original = api.recordCaseClosure.mock
      .calls[0]![1] as RecordCaseClosureInput;
    await wrapper.get('[data-test="closure-refresh"]').trigger('click');
    await flushPromises();
    expect(api.recordCaseClosure).toHaveBeenCalledTimes(1);
    expect(caseClosureSession(auth, () => '').pending('case-a')).not.toBeNull();
    api.getCase.mockResolvedValue(registered(original));
    wrapper.unmount();
    expect(caseClosureSession(auth, () => '').pending('case-a')).not.toBeNull();
    const remounted = await open('internal', pinia);
    expect(
      remounted.wrapper.get('[data-test="closure-pending-summary"]').text(),
    ).toContain('原始说明');
    expect(api.recordCaseClosure).toHaveBeenCalledTimes(1);
    api.recordCaseClosure.mockResolvedValue(receipt);
    await remounted.wrapper.get('[data-test="closure-retry"]').trigger('click');
    await flushPromises();
    expect(api.recordCaseClosure.mock.calls[1]![1]).toEqual(original);
    expect(remounted.wrapper.find('[data-test="closure-retry"]').exists()).toBe(
      false,
    );
  });
  it.each(['internal', 'lawyer'] as const)(
    'clears sensitive pending and suppresses late submit after %s authorization revision changes',
    async (audience) => {
      let resolve!: (result: CaseClosureResult) => void;
      api.recordCaseClosure.mockImplementation(
        () =>
          new Promise<CaseClosureResult>((done) => {
            resolve = done;
          }),
      );
      const { wrapper, auth } = await open(audience);
      await wrapper.get('[data-test="closure-note"]').setValue('敏感旧稿');
      await wrapper.get('[data-test="closure-submit"]').trigger('click');
      await flushPromises();
      const denied = { ...base(), canRecordClosure: false };
      api.getCase.mockResolvedValue(denied);
      api.getLawyerCase.mockResolvedValue(lawyerProjection(denied));
      auth.session = { ...auth.session!, authorizationRevision: 2 };
      await flushPromises();
      const changed = vi.fn();
      window.addEventListener(workflowChangedEvent, changed);
      try {
        resolve(receipt);
        await flushPromises();
        expect(changed).not.toHaveBeenCalled();
        expect(wrapper.text()).not.toContain('敏感旧稿');
        expect(wrapper.find('[data-test="closure-retry"]').exists()).toBe(
          false,
        );
        expect(wrapper.find('[data-test="closure-form"]').exists()).toBe(false);
      } finally {
        window.removeEventListener(workflowChangedEvent, changed);
      }
    },
  );
  it('keeps lawyer closure history business-only and provides exact frozen download callback', async () => {
    const item = registered(
      {
        expectedVersion: 19,
        idempotencyKey: 'key',
        expectedFinishId: finishId,
        closeAt: null,
        closeAmountState: 'KNOWN',
        closeAmt: '0.00',
        note: '真实结案说明',
        closeContentVersionIds: [file.contentVersionId],
      },
      true,
    );
    api.getLawyerCase.mockResolvedValue(lawyerProjection(item));
    const { wrapper } = await open('lawyer');
    expect(wrapper.find('[data-test="closure-correct"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('内部更正原因');
    expect(
      wrapper.findAll('[data-test="closure-history-version"]'),
    ).toHaveLength(2);
    const signal = new AbortController().signal;
    await wrapper.getComponent(CaseClosurePanel).props('downloadClosureFile')(
      'case-a',
      file,
      signal,
    );
    expect(api.downloadMaterialVersion).toHaveBeenCalledWith(
      file.materialId,
      file.contentVersionId,
      signal,
    );
    await expect(
      wrapper.getComponent(CaseClosurePanel).props('correctClosure')('case-a', {
        expectedVersion: 21,
        idempotencyKey: 'forbidden-correction',
        expectedFinishId: finishId,
        expectedClosureVersionId: versionId,
        closeAt: null,
        closeAmountState: 'PENDING',
        closeAmt: null,
        note: null,
        closeContentVersionIds: [],
        correctionReason: 'forbidden',
      }),
    ).rejects.toMatchObject({ code: 'ACTION_FORBIDDEN' });
    expect(api.correctCaseClosure).not.toHaveBeenCalled();
  });

  it.each(['internal', 'lawyer'] as const)(
    'clears original pending after %s command permission rejection',
    async (audience) => {
      const { wrapper, auth } = await open(audience);
      const denied = { ...base(), canRecordClosure: false };
      api.getCase.mockResolvedValue(denied);
      api.getLawyerCase.mockResolvedValue(lawyerProjection(denied));
      api.recordCaseClosure.mockRejectedValue(
        new ApiError('revoked', 403, 'ACTION_FORBIDDEN'),
      );
      await wrapper.get('[data-test="closure-note"]').setValue('待清除敏感稿');
      await wrapper.get('[data-test="closure-submit"]').trigger('click');
      await flushPromises();
      expect(wrapper.text()).not.toContain('待清除敏感稿');
      expect(wrapper.find('[data-test="closure-retry"]').exists()).toBe(false);
      expect(caseClosureSession(auth, () => '').pending('case-a')).toBeNull();
      expect(api.recordCaseClosure).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['internal', 'lawyer'] as const)(
    'suppresses late %s closure upload and clears the original request on switching to a different case',
    async (audience) => {
      let uploaded!: (value: typeof file) => void;
      api.uploadMaterialFile.mockImplementation(
        () =>
          new Promise<typeof file>((resolve) => {
            uploaded = resolve;
          }),
      );
      const { wrapper, router, auth } = await open(audience);
      const upload = wrapper.get<HTMLInputElement>(
        '[data-test="closure-upload"]',
      );
      const uploadFile = new File(['closure bytes'], '结案资料.pdf', {
        type: 'application/pdf',
      });
      Object.defineProperty(upload.element, 'files', {
        value: [uploadFile],
        configurable: true,
      });
      await upload.trigger('change');
      await flushPromises();
      expect(api.uploadMaterialFile).toHaveBeenCalledWith({
        ownerType: 'CASE',
        ownerId: 'case-a',
        category: 'CASE_CLOSURE_DOCUMENT',
        purpose: 'CASE_CLOSURE_DOCUMENT',
        file: uploadFile,
      });
      caseClosureSession(auth, () => '').setPending('case-a', {
        command: 'RECORD',
        input: {
          expectedVersion: 19,
          idempotencyKey: 'unknown-key',
          expectedFinishId: finishId,
          closeAt: null,
          closeAmountState: 'PENDING',
          closeAmt: null,
          note: '旧案敏感稿',
          closeContentVersionIds: [],
        },
      });
      const next = {
        ...base(),
        id: 'case-b',
        businessNo: 'CA-B',
        canRecordClosure: false,
      };
      api.getCase.mockResolvedValue(next);
      api.getLawyerCase.mockResolvedValue(lawyerProjection(next));
      await router.push(
        `${audience === 'lawyer' ? '/lawyer' : ''}/cases/case-b`,
      );
      await flushPromises();
      uploaded(file);
      await flushPromises();
      expect(wrapper.text()).toContain('CA-B');
      expect(wrapper.text()).not.toContain(file.originalFilename);
      expect(wrapper.text()).not.toContain('旧案敏感稿');
      expect(caseClosureSession(auth, () => '').pending('case-a')).toBeNull();
      expect(api.recordCaseClosure).not.toHaveBeenCalled();
    },
  );
  it.each(['internal', 'lawyer'] as const)(
    'keeps %s unknown request in memory after unmount but wipes it if the account logs out',
    async (audience) => {
      api.recordCaseClosure.mockRejectedValue(
        new ApiError('unknown', 500, 'INTERNAL_ERROR'),
      );
      const { wrapper, auth } = await open(audience);
      await wrapper.get('[data-test="closure-submit"]').trigger('click');
      await flushPromises();
      wrapper.unmount();
      expect(
        caseClosureSession(auth, () => '').pending('case-a'),
      ).not.toBeNull();
      auth.session = null;
      expect(caseClosureSession(auth, () => '').pending('case-a')).toBeNull();
    },
  );
  it.each(['internal', 'lawyer'] as const)(
    'shows unregistered court number only for null on %s detail',
    async (audience) => {
      api.getCase.mockResolvedValue({ ...base(), courtCaseNo: null });
      api.getLawyerCase.mockResolvedValue({
        ...lawyerProjection(base()),
        courtCaseNo: null,
      });
      const { wrapper } = await open(audience);
      expect(
        wrapper
          .get('.case-workspace-subtitle, [data-test="court-case-no"]')
          .text(),
      ).toContain('未登记');
    },
  );
});
