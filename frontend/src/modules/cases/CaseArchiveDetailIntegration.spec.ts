import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseArchiveSession } from '../../api/cases';
import { ApiError } from '../../api/http';
import type {
  CaseDetail,
  CaseClosureResult,
  CaseClosureVersion,
  LawyerCaseDetail,
  RecordCaseClosureInput,
  CaseArchiveResult,
  CaseArchiveVersion,
  ArchiveCaseInput,
} from '../../api/cases';
import { useAuthStore } from '../../stores/auth';
import CaseDetailPage from './CaseDetailPage.vue';
import LawyerCaseDetailPage from './LawyerCaseDetailPage.vue';
import CaseClosurePanel from './CaseClosurePanel.vue';
import CaseArchivePanel from './CaseArchivePanel.vue';
import { workflowChangedEvent } from '../../app/workflow-events';

const api = vi.hoisted(() => ({
  getCase: vi.fn(),
  getLawyerCase: vi.fn(),
  recordCaseClosure: vi.fn(),
  correctCaseClosure: vi.fn(),
  archiveCase: vi.fn(),
  correctCaseArchive: vi.fn(),
  listOwnerMaterials: vi.fn(),
  uploadMaterialFile: vi.fn(),
  downloadMaterialVersion: vi.fn(),
}));
vi.mock('../../api/cases', async (original) => ({
  ...(await original<typeof import('../../api/cases')>()),
  getCase: api.getCase,
  getLawyerCase: api.getLawyerCase,
  recordCaseClosure: api.recordCaseClosure,
  correctCaseClosure: api.correctCaseClosure,
  archiveCase: api.archiveCase,
  correctCaseArchive: api.correctCaseArchive,
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
  return { wrapper, auth, router, pinia };
}
beforeEach(() => {
  vi.clearAllMocks();
  api.getCase.mockResolvedValue(ready());
  api.getLawyerCase.mockResolvedValue(lawyerReady());
  api.listOwnerMaterials.mockResolvedValue({ items: [] });
  api.uploadMaterialFile.mockResolvedValue(file);
  api.downloadMaterialVersion.mockResolvedValue(undefined);
  api.recordCaseClosure.mockResolvedValue(receipt);
});
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
});

const closureInput: RecordCaseClosureInput = {
  expectedVersion: 19,
  idempotencyKey: 'closure',
  expectedFinishId: finishId,
  closeAt: null,
  closeAmountState: 'PENDING',
  closeAmt: null,
  note: null,
  closeContentVersionIds: [file.contentVersionId],
};
function ready(): CaseDetail {
  return {
    ...registered(closureInput),
    canArchive: true,
    canCorrectClosure: false,
  };
}
const archiveReceipt: CaseArchiveResult = {
  id: 'case-a',
  archiveId: 'archive-1',
  archiveVersionId: 'archive-v1',
  closureId,
  closureVersionId: versionId,
  stage: 'ARCHIVED',
  version: 21,
  recordedAt: '2026-10-14T01:00:00Z',
};
function archived(correction = false): CaseDetail {
  const original: CaseArchiveVersion = {
    id: archiveReceipt.archiveVersionId,
    kind: 'ARCHIVE',
    priorVersionId: null,
    closureVersionId: versionId,
    fromVersion: 20,
    toVersion: 21,
    archiveAt: '2026-10-13',
    archiveType: 'EXECUTION_COLLECTED',
    archiveReason: ' 原文归档原因 ',
    correctionReason: null,
    recordedAt: archiveReceipt.recordedAt,
    recordedByUserId: 'operator-1',
  };
  const current: CaseArchiveVersion = correction
    ? {
        ...original,
        id: 'archive-v2',
        kind: 'CORRECT',
        priorVersionId: original.id,
        fromVersion: 21,
        toVersion: 22,
        correctionReason: ' 核实原因 ',
      }
    : original;
  return {
    ...ready(),
    stage: 'ARCHIVED',
    version: current.toVersion,
    canArchive: false,
    canCorrectArchive: true,
    archive: {
      id: archiveReceipt.archiveId,
      closureId,
      closureVersionId: versionId,
      current,
      history: correction ? [original, current] : [original],
    },
  };
}
function lawyerReady(item: CaseDetail = ready()): LawyerCaseDetail {
  const project = (entry: CaseArchiveVersion) => {
    const { correctionReason, recordedByUserId, ...business } = entry;
    void correctionReason;
    void recordedByUserId;
    return business;
  };
  return {
    ...lawyerProjection({ ...item, archive: null }),
    canArchive: item.canArchive,
    canCorrectArchive: false,
    archive: item.archive
      ? {
          ...item.archive,
          current: project(item.archive.current),
          history: item.archive.history.map(project),
        }
      : null,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fill(wrapper: VueWrapper) {
  await wrapper.get('[data-test="archive-date"]').setValue('2026-10-13');
  await wrapper
    .get('[data-test="archive-type"]')
    .setValue('EXECUTION_COLLECTED');
  await wrapper.get('[data-test="archive-reason"]').setValue(' 原文归档原因 ');
}
describe('actual CA017 archive detail integration', () => {
  it('retains the original request when a decoded receipt disagrees with the known closure head', async () => {
    api.archiveCase.mockResolvedValue({
      ...archiveReceipt,
      closureId: 'different-closure',
    });
    const { wrapper, auth } = await open('internal');
    await fill(wrapper);
    const changed = vi.fn();
    window.addEventListener(workflowChangedEvent, changed);
    try {
      await wrapper.get('[data-test="archive-form"]').trigger('submit');
      await flushPromises();
      expect(api.archiveCase).toHaveBeenCalledTimes(1);
      expect(changed).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="archive-retry"]').exists()).toBe(true);
      expect(
        caseArchiveSession(auth, () => '').pending('case-a'),
      ).not.toBeNull();
    } finally {
      window.removeEventListener(workflowChangedEvent, changed);
    }
  });
  it.each(['internal', 'lawyer'] as const)(
    'archives through real %s panel once and keeps old closure bytes readable',
    async (audience) => {
      api.archiveCase.mockResolvedValue(archiveReceipt);
      const { wrapper } = await open(audience);
      expect(wrapper.findComponent(CaseArchivePanel).exists()).toBe(true);
      expect(wrapper.get('[data-test="archive-date"]').element).toHaveProperty(
        'value',
        '',
      );
      await fill(wrapper);
      api.getCase.mockResolvedValue(archived());
      api.getLawyerCase.mockResolvedValue(lawyerReady(archived()));
      const changed = vi.fn();
      window.addEventListener(workflowChangedEvent, changed);
      try {
        await wrapper.get('[data-test="archive-form"]').trigger('submit');
        await flushPromises();
        expect(api.archiveCase).toHaveBeenCalledTimes(1);
        expect(api.archiveCase).toHaveBeenCalledWith(
          'case-a',
          expect.objectContaining({
            expectedVersion: 20,
            expectedClosureVersionId: versionId,
            archiveAt: '2026-10-13',
            archiveType: 'EXECUTION_COLLECTED',
            archiveReason: ' 原文归档原因 ',
          }),
          audience,
        );
        expect(changed).toHaveBeenCalledTimes(1);
        const panel = wrapper.findComponent(CaseArchivePanel);
        panel.vm.$emit('changed', archiveReceipt);
        await flushPromises();
        expect(changed).toHaveBeenCalledTimes(1);
        expect(wrapper.find('[data-test="archive-form"]').exists()).toBe(false);
        const closure = wrapper.findComponent(CaseClosurePanel);
        expect(closure.text()).toContain(file.originalFilename);
        expect(closure.find('[data-test="closure-correct"]').exists()).toBe(
          false,
        );
        await closure
          .get('[data-test="closure-history"]')
          .get('button')
          .trigger('click');
        await flushPromises();
        expect(api.downloadMaterialVersion).toHaveBeenCalledWith(
          file.materialId,
          file.contentVersionId,
          expect.any(AbortSignal),
        );
        expect(api.recordCaseClosure).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener(workflowChangedEvent, changed);
      }
    },
  );
  it('corrects only through internal endpoint with exact archive and closure anchors', async () => {
    api.getCase.mockResolvedValue(archived());
    const { wrapper } = await open('internal');
    const corrected = {
      ...archiveReceipt,
      archiveVersionId: 'archive-v2',
      version: 22,
    };
    api.correctCaseArchive.mockResolvedValue(corrected);
    await wrapper.get('[data-test="archive-correct"]').trigger('click');
    await wrapper
      .get('[data-test="archive-correction-reason"]')
      .setValue(' 核实原因 ');
    api.getCase.mockResolvedValue(archived(true));
    await wrapper.get('[data-test="archive-form"]').trigger('submit');
    await flushPromises();
    expect(api.correctCaseArchive).toHaveBeenCalledWith(
      'case-a',
      expect.objectContaining({
        expectedVersion: 21,
        expectedClosureVersionId: versionId,
        expectedArchiveVersionId: archiveReceipt.archiveVersionId,
        correctionReason: ' 核实原因 ',
      }),
    );
    expect(wrapper.find('[data-test="archive-history"]').text()).toContain(
      '核实原因',
    );
    expect(api.archiveCase).not.toHaveBeenCalled();
  });
  it('shows lawyer archive history without any correction action or internal audit fields', async () => {
    api.getLawyerCase.mockResolvedValue(lawyerReady(archived(true)));
    const { wrapper } = await open('lawyer');
    expect(wrapper.text()).toContain('原文归档原因');
    expect(wrapper.text()).not.toContain('核实原因');
    expect(wrapper.find('[data-test="archive-correct"]').exists()).toBe(false);
    await expect(
      wrapper.findComponent(CaseArchivePanel).props('correctArchive')(
        'case-a',
        {
          expectedVersion: 21,
          idempotencyKey: 'forbidden-correction',
          expectedClosureVersionId: versionId,
          expectedArchiveVersionId: archiveReceipt.archiveVersionId,
          archiveAt: '2026-10-13',
          archiveType: 'EXECUTION_COLLECTED',
          archiveReason: '原因',
          correctionReason: '核实',
        },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(api.correctCaseArchive).not.toHaveBeenCalled();
  });
  it.each(['internal', 'lawyer'] as const)(
    'retains %s unknown original request over refresh/remount with explicit original retry only',
    async (audience) => {
      api.archiveCase.mockRejectedValue(
        new ApiError('unknown', 500, 'INTERNAL_ERROR'),
      );
      const { wrapper, auth, pinia } = await open(audience);
      await fill(wrapper);
      await wrapper.get('[data-test="archive-form"]').trigger('submit');
      await flushPromises();
      const original = api.archiveCase.mock.calls[0]![1] as ArchiveCaseInput;
      expect(
        caseArchiveSession(auth, () => '').pending('case-a')?.input,
      ).toEqual(original);
      api.getCase.mockResolvedValue(archived());
      api.getLawyerCase.mockResolvedValue(lawyerReady(archived()));
      await wrapper.findComponent(CaseArchivePanel).vm.$emit('refresh');
      await flushPromises();
      expect(api.archiveCase).toHaveBeenCalledTimes(1);
      wrapper.unmount();
      const remounted = await open(audience, pinia);
      expect(remounted.wrapper.text()).toContain('原文归档原因');
      api.archiveCase.mockResolvedValue(archiveReceipt);
      await remounted.wrapper
        .get('[data-test="archive-retry"]')
        .trigger('click');
      await flushPromises();
      expect(api.archiveCase).toHaveBeenCalledTimes(2);
      expect(api.archiveCase.mock.calls[1]![1]).toEqual(original);
    },
  );
  it.each(['case', 'account', 'department', 'revision'] as const)(
    'isolates late archive result after %s changes',
    async (change) => {
      const pending = deferred<CaseArchiveResult>();
      api.archiveCase.mockReturnValue(pending.promise);
      const { wrapper, auth, router } = await open('internal');
      await fill(wrapper);
      await wrapper.get('[data-test="archive-form"]').trigger('submit');
      expect(api.archiveCase).toHaveBeenCalledTimes(1);
      const changed = vi.fn();
      window.addEventListener(workflowChangedEvent, changed);
      try {
        if (change === 'case') {
          api.getCase.mockResolvedValue({
            ...ready(),
            id: 'case-b',
            businessNo: 'CA-B',
            canArchive: false,
          });
          await router.push('/cases/case-b');
        } else {
          const session = auth.session!;
          auth.session = {
            ...session,
            user:
              change === 'account'
                ? { ...session.user, id: 'operator-2' }
                : session.user,
            department:
              change === 'department'
                ? { id: 'department-2', name: '二部' }
                : session.department,
            authorizationRevision:
              change === 'revision' ? 2 : session.authorizationRevision,
          };
        }
        await flushPromises();
        pending.resolve(archiveReceipt);
        await flushPromises();
        expect(changed).not.toHaveBeenCalled();
        expect(caseArchiveSession(auth, () => '').pending('case-a')).toBeNull();
        expect(wrapper.text()).not.toContain('原文归档原因');
      } finally {
        window.removeEventListener(workflowChangedEvent, changed);
      }
    },
  );
  it.each([401, 403])(
    'clears sensitive request and fresh-reads after %s denial',
    async (status) => {
      api.archiveCase.mockRejectedValue(
        new ApiError('denied', status, 'ACTION_FORBIDDEN'),
      );
      const { wrapper, auth } = await open('internal');
      await fill(wrapper);
      await wrapper.get('[data-test="archive-form"]').trigger('submit');
      await flushPromises();
      expect(caseArchiveSession(auth, () => '').pending('case-a')).toBeNull();
      expect(wrapper.text()).not.toContain('原文归档原因');
      expect(api.getCase).toHaveBeenCalledTimes(2);
    },
  );
});
