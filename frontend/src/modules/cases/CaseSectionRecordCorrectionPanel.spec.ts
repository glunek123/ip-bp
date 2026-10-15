import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseDetail, CaseFile } from '../../api/cases';
import { ApiError } from '../../api/http';
import type {
  CaseSectionRecordUploadTarget,
  CaseSectionRecordUploadedMaterial,
} from '../../api/materials';
import { reactive } from 'vue';
import { createListWorkflowContext } from '../../app/list-workflow-context';
import Panel, {
  caseSectionRecordStorageKey,
  decodeCaseSectionRecordRequest,
  readCaseSectionRecordRequests,
  submitCaseSectionRecordRequest,
  type CaseSectionRecordKind,
  type CaseSectionRecordRequest,
} from './CaseSectionRecordCorrectionPanel.vue';
const api = vi.hoisted(() => ({
  mailing: vi.fn(),
  filing: vi.fn(),
  finish: vi.fn(),
  hearing: vi.fn(),
  judgment: vi.fn(),
  closure: vi.fn(),
  download: vi.fn(),
  upload:
    vi.fn<typeof import('../../api/materials').uploadCaseSectionRecordFile>(),
  genericUpload: vi.fn(),
}));
vi.mock('../../api/cases', async (original) => ({
  ...(await original<typeof import('../../api/cases')>()),
  correctCaseExecutionMailingRecord: api.mailing,
  correctCaseExecutionFilingRecord: api.filing,
  correctCaseExecutionFinishRecord: api.finish,
  correctCaseHearingRecord: api.hearing,
  correctCaseJudgmentRecord: api.judgment,
  correctCaseClosureRecord: api.closure,
}));
vi.mock('../../api/materials', async (original) => ({
  ...(await original<typeof import('../../api/materials')>()),
  downloadMaterialVersion: api.download,
  uploadCaseSectionRecordFile: api.upload,
  uploadMaterialFile: api.genericUpload,
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
function fixture(): CaseDetail {
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
const kinds: CaseSectionRecordKind[] = [
  'execution-mailing',
  'execution-filing',
  'execution-finish',
  'hearing',
  'judgment',
  'closure',
];
const wrappers: VueWrapper[] = [];
function render(
  kind: CaseSectionRecordKind,
  item = fixture(),
  submitRequest = vi
    .fn<NonNullable<InstanceType<typeof Panel>['$props']['submitRequest']>>()
    .mockResolvedValue(undefined),
  host: Partial<
    Pick<
      InstanceType<typeof Panel>['$props'],
      | 'initialTargetId'
      | 'beforeSubmit'
      | 'onState-change'
      | 'onChanged'
      | 'contextKey'
      | 'beforeUpload'
      | 'onUpload-state-change'
    >
  > = {},
) {
  const wrapper = mount(Panel, {
    props: {
      item,
      kind,
      actorKey: 'INTERNAL:actor:department',
      contextKey: 'auth-revision-1',
      submitRequest,
      ...host,
    },
  });
  wrappers.push(wrapper);
  return { wrapper, submitRequest };
}
async function change(wrapper: VueWrapper, date = '2026-10-07') {
  await wrapper.get('[data-test="section-record-date"]').setValue(date);
  await wrapper
    .get('[data-test="section-record-reason"]')
    .setValue('  更正登记日期  ');
}
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
});

describe('exact section record corrections', () => {
  const uploadKinds = [
    'execution-mailing',
    'execution-filing',
    'execution-finish',
    'judgment',
    'closure',
  ] as const;
  const uploadTargets: Record<
    (typeof uploadKinds)[number],
    CaseSectionRecordUploadTarget
  > = {
    'execution-mailing': {
      kind: 'EXECUTION_MAILING',
      targetId: uid(2),
      expectedRevision: 0,
    },
    'execution-filing': {
      kind: 'EXECUTION_FILING',
      targetId: uid(3),
      expectedRevision: 0,
    },
    'execution-finish': {
      kind: 'EXECUTION_FINISH',
      targetId: uid(4),
      expectedRevision: 0,
    },
    judgment: {
      kind: 'JUDGMENT',
      targetId: uid(6),
      expectedRevision: 0,
      trialRoundId: uid(9),
    },
    closure: {
      kind: 'CLOSURE',
      targetId: uid(7),
      expectedRevision: 0,
      expectedClosureVersionId: uid(8),
    },
  };
  const purposes = {
    EXECUTION_MAILING: 'MAIL_RECEIPT',
    EXECUTION_FILING: 'EXECUTION_FILING_PROOF',
    EXECUTION_FINISH: 'EXECUTION_FINISH_BASIS',
    JUDGMENT: 'JUDGMENT',
    CLOSURE: 'CASE_CLOSURE_DOCUMENT',
  } as const;
  const newFile = () =>
    new File(['%PDF-1.7\n现场材料'], '现场.pdf', { type: 'application/pdf' });
  function uploaded(
    target: CaseSectionRecordUploadTarget,
  ): CaseSectionRecordUploadedMaterial {
    return {
      materialId: uid(200),
      contentVersionId: uid(201),
      originalFilename: '现场.pdf',
      mimeType: 'application/pdf',
      purpose: purposes[target.kind],
      sizeBytes: newFile().size,
      sha256: 'a'.repeat(64),
      recordCorrection: target,
    };
  }
  async function selectUpload(
    wrapper: VueWrapper,
    file = newFile(),
  ): Promise<void> {
    const input = wrapper.get<HTMLInputElement>(
      '[data-test="section-record-upload"]',
    );
    Object.defineProperty(input.element, 'files', {
      value: [file],
      configurable: true,
    });
    await input.trigger('change');
  }
  function uploadDeferred() {
    let resolve!: (value: CaseSectionRecordUploadedMaterial) => void;
    const promise = new Promise<CaseSectionRecordUploadedMaterial>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }
  it.each(uploadKinds)(
    'prepares an ARCHIVED %s attachment through its exact upload target without auto-saving or advancing, then saves only the confirmed version',
    async (kind) => {
      const item = fixture();
      const before = structuredClone(item);
      const target = uploadTargets[kind];
      const beforeUpload = vi.fn(() => true);
      const beforeSubmit = vi.fn(() => true);
      const phases: string[] = [];
      const { wrapper, submitRequest } = render(kind, item, undefined, {
        beforeUpload,
        beforeSubmit,
        'onUpload-state-change': (phase) => phases.push(phase),
      });
      api.upload.mockResolvedValue(uploaded(target));
      await selectUpload(wrapper);
      await flushPromises();
      expect(beforeUpload).toHaveBeenCalledExactlyOnceWith({
        caseId: item.id,
        target,
      });
      expect(api.upload).toHaveBeenCalledWith(
        item.id,
        target,
        expect.any(File),
        { signal: expect.any(AbortSignal) },
      );
      expect(api.genericUpload).not.toHaveBeenCalled();
      expect(beforeSubmit).not.toHaveBeenCalled();
      expect(submitRequest).not.toHaveBeenCalled();
      expect(wrapper.emitted('changed')).toBeUndefined();
      expect(wrapper.emitted('refresh')).toBeUndefined();
      expect(phases).toEqual(['idle', 'uploading', 'idle']);
      expect(wrapper.emitted('state-change')).toEqual([['idle']]);
      expect(sessionStorage.length).toBe(0);
      expect(item).toEqual(before);
      expect(
        wrapper.get<HTMLInputElement>(
          `[data-test="section-record-file-${uid(201)}"]`,
        ).element.checked,
      ).toBe(true);
      expect(
        wrapper.get('[data-test="section-record-upload-notice"]').text(),
      ).toContain('尚未保存');
      await wrapper
        .get('[data-test="section-record-reason"]')
        .setValue('新增现场文件');
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(beforeSubmit).toHaveBeenCalledTimes(1);
      const request = submitRequest.mock.calls[0]![1];
      let ids: string[] = [];
      switch (request.kind) {
        case 'execution-mailing':
          ids = request.input.mailReceiptContentVersionIds;
          break;
        case 'execution-filing':
          ids = request.input.executionFilingProofContentVersionIds;
          break;
        case 'execution-finish':
          ids = request.input.basisContentVersionIds;
          break;
        case 'judgment':
          ids = request.input.judgmentContentVersionIds;
          break;
        case 'closure':
          ids = request.input.closeContentVersionIds;
          break;
        case 'hearing':
          throw new Error('no hearing uploads');
      }
      expect(ids.at(-1)).toBe(uid(201));
      expect(ids[0]).toBe(file.contentVersionId);
      expect(request.input).not.toHaveProperty('expectedVersion');
      expect(item.stage).toBe('ARCHIVED');
      expect(item.version).toBe(42);
    },
  );
  it('uses a separate real W preparation admission and settles it to idle without success, refresh or business pending', async () => {
    const item = fixture();
    const host = createListWorkflowContext(async () => item);
    await host.sync({
      recordId: item.id,
      actorKey: 'actor-auth-1',
      actionKey: 'edit-section-records',
      title: '资料更正',
    });
    const session = host.state.value.session!;
    const wait = uploadDeferred();
    const phases: string[] = [];
    const { wrapper, submitRequest } = render('closure', item, undefined, {
      beforeUpload: () => session.beginSubmit(),
      'onUpload-state-change': (phase) => {
        phases.push(phase);
        if (phase === 'idle') session.endSubmit('failed');
      },
    });
    api.upload.mockImplementation(() => {
      expect(host.state.value.requestState).toBe('submitting');
      return wait.promise;
    });
    await selectUpload(wrapper);
    expect(host.canLeave()).toBe(false);
    expect(
      wrapper.get('[data-test="section-record-save"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('form').trigger('submit');
    expect(submitRequest).not.toHaveBeenCalled();
    wait.resolve(uploaded(uploadTargets.closure));
    await flushPromises();
    expect(phases).toEqual(['idle', 'uploading', 'idle']);
    expect(host.state.value.status).toBe('ready');
    expect(host.canLeave()).toBe(true);
    expect(wrapper.emitted('changed')).toBeUndefined();
    expect(wrapper.emitted('refresh')).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
    await wrapper.get('[data-test="section-record-cancel"]').trigger('click');
    expect(submitRequest).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'denies a file preparation gate (throws=%s) without upload, confirmed versions or business requests',
    async (throws) => {
      const beforeUpload = vi.fn(() => {
        if (throws) throw new Error('no admission');
        return false;
      });
      const { wrapper, submitRequest } = render(
        'closure',
        fixture(),
        undefined,
        { beforeUpload },
      );
      await selectUpload(wrapper);
      await flushPromises();
      expect(beforeUpload).toHaveBeenCalledTimes(1);
      expect(api.upload).not.toHaveBeenCalled();
      expect(submitRequest).not.toHaveBeenCalled();
      expect(wrapper.emitted('upload-state-change')).toEqual([['idle']]);
      expect(sessionStorage.length).toBe(0);
      expect(
        wrapper.find(`[data-test="section-record-file-${uid(201)}"]`).exists(),
      ).toBe(false);
    },
  );
  it('settles accepted file preparation if a synchronous permission preflight rejects before upload starts', async () => {
    const item = reactive(fixture());
    const host = createListWorkflowContext(async () => item);
    await host.sync({
      recordId: item.id,
      actorKey: 'actor-auth-1',
      actionKey: 'edit-section-records',
      title: '资料更正',
    });
    const session = host.state.value.session!;
    const phases: string[] = [];
    const { wrapper } = render('closure', item, undefined, {
      beforeUpload: () => {
        const admitted = session.beginSubmit();
        item.recordEdits!.closures![0]!.canEdit = false;
        return admitted;
      },
      'onUpload-state-change': (phase) => {
        phases.push(phase);
        if (phase === 'idle') session.endSubmit('failed');
      },
    });
    await selectUpload(wrapper);
    expect(api.upload).not.toHaveBeenCalled();
    expect(phases).toEqual(['idle', 'idle']);
    expect(host.canLeave()).toBe(true);
    expect(host.state.value.status).toBe('ready');
    expect(sessionStorage.length).toBe(0);
  });
  it('keeps uploads unavailable while an original business request is unknown', async () => {
    const { wrapper, submitRequest } = render('closure');
    submitRequest.mockRejectedValue(
      new ApiError('unknown', 0, 'NETWORK_ERROR'),
    );
    await change(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(
      wrapper.get('[data-test="section-record-upload"]').attributes('disabled'),
    ).toBeDefined();
    await selectUpload(wrapper);
    expect(api.upload).not.toHaveBeenCalled();
    expect(
      readCaseSectionRecordRequests('INTERNAL:actor:department', uid(1)),
    ).toHaveLength(1);
  });
  it('registers the upload controller before synchronous prep observers can unmount the panel, so no upload starts afterward', async () => {
    const mounted: { wrapper?: VueWrapper } = {};
    const { wrapper } = render('closure', fixture(), undefined, {
      'onUpload-state-change': (phase) => {
        if (phase === 'uploading') mounted.wrapper?.unmount();
      },
    });
    mounted.wrapper = wrapper;
    await selectUpload(wrapper);
    await flushPromises();
    expect(api.upload).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
    expect(wrapper.emitted('changed')).toBeUndefined();
  });
  it.each([0, 500, 409, 403])(
    'does not confirm an upload result or auto-retry/save after status %s',
    async (status) => {
      const { wrapper, submitRequest } = render('closure');
      api.upload.mockRejectedValue(
        new ApiError(
          'upload result',
          status,
          status === 0 ? 'NETWORK_ERROR' : 'VERSION_CONFLICT',
        ),
      );
      await selectUpload(wrapper);
      await flushPromises();
      expect(api.upload).toHaveBeenCalledTimes(1);
      expect(submitRequest).not.toHaveBeenCalled();
      expect(sessionStorage.length).toBe(0);
      expect(wrapper.emitted('changed')).toBeUndefined();
      expect(wrapper.emitted('refresh')).toBeUndefined();
      expect(
        wrapper.find(`[data-test="section-record-file-${uid(201)}"]`).exists(),
      ).toBe(false);
      expect(wrapper.emitted('upload-state-change')).toEqual([
        ['idle'],
        ['uploading'],
        ['idle'],
      ]);
    },
  );
  it.each([
    'cancel',
    'revision',
    'closure-version',
    'identity',
    'unmount',
  ] as const)(
    'ignores late upload success after %s and never creates a business pending request',
    async (boundary) => {
      const { wrapper, submitRequest } = render('closure');
      const wait = uploadDeferred();
      api.upload.mockReturnValue(wait.promise);
      await selectUpload(wrapper);
      const signal = api.upload.mock.calls[0]![3]!.signal!;
      if (boundary === 'cancel')
        await wrapper
          .get('[data-test="section-record-upload-cancel"]')
          .trigger('click');
      else if (boundary === 'unmount') wrapper.unmount();
      else if (boundary === 'identity')
        await wrapper.setProps({
          actorKey: 'INTERNAL:other:department',
          contextKey: 'other-auth',
        });
      else {
        const item = fixture();
        if (boundary === 'revision')
          item.recordEdits!.closures![0]!.closureRevision = 1;
        else item.closure!.current.id = uid(88);
        await wrapper.setProps({ item });
      }
      expect(signal.aborted).toBe(true);
      wait.resolve(uploaded(uploadTargets.closure));
      await flushPromises();
      expect(submitRequest).not.toHaveBeenCalled();
      expect(wrapper.emitted('changed')).toBeUndefined();
      expect(sessionStorage.length).toBe(0);
      if (boundary !== 'unmount')
        expect(
          wrapper
            .find(`[data-test="section-record-file-${uid(201)}"]`)
            .exists(),
        ).toBe(false);
    },
  );
  it('offers no hearing upload, blocks malformed/oversize files locally, and never invokes a generic owner upload', async () => {
    const hearing = render('hearing');
    expect(hearing.wrapper.find('input[type="file"]').exists()).toBe(false);
    const beforeUpload = vi.fn(() => true);
    const { wrapper } = render('execution-mailing', fixture(), undefined, {
      beforeUpload,
    });
    await selectUpload(
      wrapper,
      new File(['x'], 'malware.exe', { type: 'application/pdf' }),
    );
    const tooLarge = newFile();
    Object.defineProperty(tooLarge, 'size', { value: 20 * 1024 * 1024 + 1 });
    await selectUpload(wrapper, tooLarge);
    expect(beforeUpload).not.toHaveBeenCalled();
    expect(api.upload).not.toHaveBeenCalled();
    expect(api.genericUpload).not.toHaveBeenCalled();
  });
  function twoHearings(): CaseDetail {
    const item = fixture();
    const entry = item.recordEdits!.hearings![0]!;
    item.recordEdits!.hearings!.push({
      ...structuredClone(entry),
      arrangementId: uid(55),
      original: { hearingAt: '2026-10-08' },
      effective: { hearingAt: '2026-10-08' },
    });
    item.hearing.arrangements.push({
      ...item.hearing.arrangements[0]!,
      id: uid(55),
      hearingAt: '2026-10-08',
    });
    return item;
  }
  function retainHearing(target = uid(5)): CaseSectionRecordRequest {
    const request: CaseSectionRecordRequest = {
      kind: 'hearing',
      input: {
        arrangementId: target,
        trialRoundId: uid(9),
        expectedHearingRevision: 0,
        hearingAt: target === uid(5) ? '2026-10-07' : '2026-10-09',
        reason: '  原因原样保留  ',
        idempotencyKey: `original-${target}`,
      },
    };
    sessionStorage.setItem(
      caseSectionRecordStorageKey('INTERNAL:actor:department', uid(1), request),
      JSON.stringify({
        version: 1,
        actor: 'INTERNAL:actor:department',
        caseId: uid(1),
        request,
      }),
    );
    return request;
  }
  it('adopts the exact hinted pending target on mount, hint/context changes and explicit reopen, without taking the first same-kind request', async () => {
    const first = retainHearing();
    const second = retainHearing(uid(55));
    const item = twoHearings();
    const { wrapper, submitRequest } = render('hearing', item, undefined, {
      initialTargetId: uid(55),
    });
    expect(
      wrapper.get<HTMLSelectElement>('[data-test="section-record-target"]')
        .element.value,
    ).toBe(uid(55));
    expect(
      wrapper.get('[data-test="section-record-pending"]').text(),
    ).toContain(second.input.idempotencyKey);
    expect(
      wrapper.get('[data-test="section-record-target"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.setProps({
      initialTargetId: uid(5),
      contextKey: 'first-recovery-session',
      item: structuredClone(item),
    });
    expect(
      wrapper.get('[data-test="section-record-pending"]').text(),
    ).toContain(first.input.idempotencyKey);
    await wrapper.setProps({ openRevision: 1 });
    expect(
      wrapper.get<HTMLSelectElement>('[data-test="section-record-target"]')
        .element.value,
    ).toBe(uid(5));
    await wrapper.setProps({
      contextKey: 'new-host-context',
      initialTargetId: uid(55),
    });
    expect(
      wrapper.get<HTMLSelectElement>('[data-test="section-record-target"]')
        .element.value,
    ).toBe(uid(55));
    expect(wrapper.find('form').exists()).toBe(false);
    await wrapper.setProps({ item: structuredClone(item) });
    expect(
      wrapper.get('[data-test="section-record-pending"]').text(),
    ).toContain(second.input.idempotencyKey);
    await wrapper.get('[data-test="section-record-retry"]').trigger('click');
    await flushPromises();
    expect(submitRequest.mock.calls[0]![1]).toEqual(second);
    expect(
      readCaseSectionRecordRequests('INTERNAL:actor:department', uid(1)).map(
        (entry) => entry.request,
      ),
    ).toEqual([first]);
  });
  it('does not fall back from a missing explicit target to the current target or another pending request', async () => {
    const original = retainHearing();
    const { wrapper, submitRequest } = render('hearing', fixture(), undefined, {
      initialTargetId: uid(999),
    });
    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.find('[data-test="section-record-retry"]').exists()).toBe(
      false,
    );
    expect(submitRequest).not.toHaveBeenCalled();
    expect(
      readCaseSectionRecordRequests('INTERNAL:actor:department', uid(1))[0]!
        .request,
    ).toEqual(original);
  });
  it('invalidates an in-flight old target on an explicit hint switch while retaining the original body and ignoring late success', async () => {
    const old = deferred();
    const { wrapper, submitRequest } = render(
      'hearing',
      twoHearings(),
      undefined,
      { initialTargetId: uid(5) },
    );
    submitRequest.mockReturnValue(old.promise);
    await change(wrapper);
    await wrapper.get('form').trigger('submit');
    const original = submitRequest.mock.calls[0]![1];
    const signal = submitRequest.mock.calls[0]![2].signal!;
    await wrapper.setProps({ initialTargetId: uid(55) });
    expect(signal.aborted).toBe(true);
    expect(
      wrapper.get<HTMLSelectElement>('[data-test="section-record-target"]')
        .element.value,
    ).toBe(uid(5));
    expect(wrapper.get('[data-test="section-record-error"]').text()).toContain(
      '原目标请求结果待核对',
    );
    old.resolve();
    await flushPromises();
    expect(wrapper.emitted('changed')).toBeUndefined();
    expect(
      readCaseSectionRecordRequests('INTERNAL:actor:department', uid(1))[0]!
        .request,
    ).toEqual(original);
    expect(submitRequest).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])(
    'reports initial state synchronously and admits a %s recovery only once before the original transport, without transient unknown',
    async (recovery) => {
      const item = fixture();
      const original = recovery ? retainHearing() : undefined;
      const states: string[] = [];
      const host = createListWorkflowContext(async () => item);
      await host.sync({
        recordId: item.id,
        actorKey: 'actor-auth-1',
        actionKey: 'edit-section-records',
        title: '资料更正',
      });
      const session = host.state.value.session!;
      const beforeSubmit = vi.fn<
        NonNullable<InstanceType<typeof Panel>['$props']['beforeSubmit']>
      >(({ recovery }) => session.beginSubmit({ recovery }));
      const onState = (state: 'idle' | 'submitting' | 'unknown') => {
        states.push(state);
        if (state === 'unknown') {
          if (host.state.value.requestState === 'idle')
            session.restoreUnknown();
          else session.endSubmit('unknown');
        } else if (state === 'idle') session.endSubmit('failed');
      };
      const { wrapper, submitRequest } = render('hearing', item, undefined, {
        beforeSubmit,
        'onState-change': onState,
        onChanged: () => session.endSubmit('success'),
      });
      expect(states).toEqual([recovery ? 'unknown' : 'idle']);
      const pending = deferred();
      submitRequest.mockImplementation(() => {
        expect(host.state.value.requestState).toBe('submitting');
        expect(states).toEqual([recovery ? 'unknown' : 'idle', 'submitting']);
        return pending.promise;
      });
      if (recovery)
        await wrapper
          .get('[data-test="section-record-retry"]')
          .trigger('click');
      else {
        await change(wrapper);
        await wrapper.get('form').trigger('submit');
        await wrapper.get('form').trigger('submit');
      }
      expect(beforeSubmit).toHaveBeenCalledTimes(1);
      expect(beforeSubmit).toHaveBeenCalledWith({
        caseId: item.id,
        request: original ?? submitRequest.mock.calls[0]![1],
        recovery,
      });
      expect(submitRequest).toHaveBeenCalledTimes(1);
      expect(host.canLeave()).toBe(false);
      pending.resolve();
      await flushPromises();
      expect(states).toEqual([
        recovery ? 'unknown' : 'idle',
        'submitting',
        'idle',
      ]);
      expect(host.state.value.status).toBe('closed');
    },
  );
  it.each([undefined, uid(5)])(
    'invalidates a submitting openRevision-only reopen with hint %s and settles the real W as unknown until exact retry',
    async (initialTargetId) => {
      const item = fixture();
      const host = createListWorkflowContext(async () => item);
      await host.sync({
        recordId: item.id,
        actorKey: 'actor-auth-1',
        actionKey: 'edit-section-records',
        title: '资料更正',
      });
      const session = host.state.value.session!;
      const states: string[] = [];
      const late = deferred();
      const { wrapper, submitRequest } = render('hearing', item, undefined, {
        initialTargetId,
        beforeSubmit: ({ recovery }) => session.beginSubmit({ recovery }),
        'onState-change': (state) => {
          states.push(state);
          if (state === 'unknown') session.endSubmit('unknown');
          else if (state === 'idle') session.endSubmit('failed');
        },
        onChanged: () => session.endSubmit('success'),
      });
      submitRequest.mockReturnValueOnce(late.promise);
      await change(wrapper);
      await wrapper.get('form').trigger('submit');
      const original = submitRequest.mock.calls[0]![1];
      const signal = submitRequest.mock.calls[0]![2].signal!;
      await wrapper.setProps({ openRevision: 1 });
      expect(signal.aborted).toBe(true);
      expect(states).toEqual(['idle', 'submitting', 'unknown']);
      expect(host.canLeave()).toBe(false);
      late.resolve();
      await flushPromises();
      expect(wrapper.emitted('changed')).toBeUndefined();
      expect(host.state.value.requestState).toBe('unknown');
      expect(
        readCaseSectionRecordRequests('INTERNAL:actor:department', uid(1))[0]!
          .request,
      ).toEqual(original);
      await wrapper.get('[data-test="section-record-retry"]').trigger('click');
      await flushPromises();
      expect(submitRequest.mock.calls[1]![1]).toEqual(original);
      expect(host.state.value.status).toBe('closed');
      expect(sessionStorage.length).toBe(0);
    },
  );
  it('blocks unknown user/forced same-session target switches and adopts a forced target only in a fresh W session, without dual terminal states', async () => {
    const item = twoHearings();
    const host = createListWorkflowContext(async () => item);
    const context = {
      recordId: item.id,
      actorKey: 'actor-auth-1',
      actionKey: 'edit-section-records',
      title: '资料更正',
    };
    await host.sync(context);
    const oldSession = host.state.value.session!;
    const states: string[] = [];
    const late = deferred();
    const { wrapper, submitRequest } = render('hearing', item, undefined, {
      contextKey: oldSession.contextKey,
      initialTargetId: uid(5),
      beforeSubmit: ({ recovery }) =>
        host.state.value.session?.beginSubmit({ recovery }) ?? false,
      'onState-change': (state) => {
        states.push(state);
        const session = host.state.value.session;
        if (state === 'unknown') session?.endSubmit('unknown');
        else if (state === 'idle') session?.endSubmit('failed');
      },
      onChanged: () => host.state.value.session?.endSubmit('success'),
    });
    submitRequest.mockReturnValueOnce(late.promise);
    await change(wrapper);
    await wrapper.get('form').trigger('submit');
    const original = submitRequest.mock.calls[0]![1];
    await wrapper.setProps({ initialTargetId: uid(55) });
    expect(states).toEqual(['idle', 'submitting', 'unknown']);
    expect(host.canLeave()).toBe(false);
    expect(
      wrapper.get('[data-test="section-record-target"]').attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.get<HTMLSelectElement>('[data-test="section-record-target"]')
        .element.value,
    ).toBe(uid(5));
    expect(wrapper.get('[data-test="section-record-error"]').text()).toContain(
      '原目标请求结果待核对',
    );
    await host.sync(context);
    const newSession = host.state.value.session!;
    expect(oldSession.isCurrent()).toBe(false);
    await wrapper.setProps({
      contextKey: newSession.contextKey,
      initialTargetId: uid(55),
      item: structuredClone(item),
    });
    expect(states).toEqual(['idle', 'submitting', 'unknown', 'idle']);
    expect(host.state.value.requestState).toBe('idle');
    expect(host.canLeave()).toBe(true);
    expect(
      wrapper.get<HTMLSelectElement>('[data-test="section-record-target"]')
        .element.value,
    ).toBe(uid(55));
    expect(
      wrapper.get('[data-test="section-record-target"]').attributes('disabled'),
    ).toBeUndefined();
    late.resolve();
    await flushPromises();
    expect(wrapper.emitted('changed')).toBeUndefined();
    expect(host.state.value.session).toBe(newSession);
    expect(host.state.value.requestState).toBe('idle');
    expect(
      readCaseSectionRecordRequests('INTERNAL:actor:department', uid(1))[0]!
        .request,
    ).toEqual(original);
    await change(wrapper, '2026-10-09');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(submitRequest.mock.calls[1]![1].input).toMatchObject({
      arrangementId: uid(55),
    });
    expect(host.state.value.status).toBe('closed');
    expect(
      readCaseSectionRecordRequests('INTERNAL:actor:department', uid(1))[0]!
        .request,
    ).toEqual(original);
  });
  it('applies idle hint changes and explicit reopen exactly while leaving unchanged props alone', async () => {
    const { wrapper, submitRequest } = render(
      'hearing',
      twoHearings(),
      undefined,
      { initialTargetId: uid(55) },
    );
    await wrapper.get('[data-test="section-record-target"]').setValue(uid(5));
    await wrapper.setProps({ openRevision: 1 });
    expect(
      wrapper.get<HTMLSelectElement>('[data-test="section-record-target"]')
        .element.value,
    ).toBe(uid(55));
    await wrapper.setProps({ initialTargetId: uid(5) });
    expect(
      wrapper.get<HTMLSelectElement>('[data-test="section-record-target"]')
        .element.value,
    ).toBe(uid(5));
    expect(submitRequest).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'settles accepted host admission after local storage failure, preserving prior unknown=%s and sending zero POSTs',
    async (recovery) => {
      const item = fixture();
      const original = recovery ? retainHearing() : undefined;
      const retained = sessionStorage.length
        ? sessionStorage.getItem(sessionStorage.key(0)!)
        : null;
      const states: string[] = [];
      const host = createListWorkflowContext(async () => item);
      await host.sync({
        recordId: item.id,
        actorKey: 'actor-auth-1',
        actionKey: 'edit-section-records',
        title: '资料更正',
      });
      const session = host.state.value.session!;
      const beforeSubmit = vi.fn<
        NonNullable<InstanceType<typeof Panel>['$props']['beforeSubmit']>
      >(({ recovery }) => session.beginSubmit({ recovery }));
      const { wrapper, submitRequest } = render('hearing', item, undefined, {
        beforeSubmit,
        'onState-change': (state) => {
          states.push(state);
          if (state === 'unknown') {
            if (host.state.value.requestState === 'idle')
              session.restoreUnknown();
            else session.endSubmit('unknown');
          } else if (state === 'idle') session.endSubmit('failed');
        },
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('storage denied');
      });
      if (recovery)
        await wrapper
          .get('[data-test="section-record-retry"]')
          .trigger('click');
      else {
        await change(wrapper);
        await wrapper.get('form').trigger('submit');
      }
      await flushPromises();
      expect(beforeSubmit).toHaveBeenCalledTimes(1);
      expect(submitRequest).not.toHaveBeenCalled();
      expect(host.state.value.requestState).toBe(recovery ? 'unknown' : 'idle');
      expect(states).toEqual([
        recovery ? 'unknown' : 'idle',
        'submitting',
        recovery ? 'unknown' : 'idle',
      ]);
      expect(sessionStorage.length).toBe(recovery ? 1 : 0);
      if (original)
        expect(
          sessionStorage.getItem(
            caseSectionRecordStorageKey(
              'INTERNAL:actor:department',
              item.id,
              original,
            ),
          ),
        ).toBe(retained);
    },
  );
  it.each([false, true])(
    'preserves all original pending data when synchronous host admission denies or throws, recovery=%s',
    async (recovery) => {
      const original = recovery ? retainHearing() : undefined;
      const before = sessionStorage.length
        ? sessionStorage.getItem(sessionStorage.key(0)!)
        : null;
      const gate = vi
        .fn<NonNullable<InstanceType<typeof Panel>['$props']['beforeSubmit']>>()
        .mockReturnValue(false);
      const { wrapper, submitRequest } = render(
        'hearing',
        fixture(),
        undefined,
        { beforeSubmit: gate },
      );
      if (!recovery) await change(wrapper);
      const click = async () => {
        if (recovery)
          await wrapper
            .get('[data-test="section-record-retry"]')
            .trigger('click');
        else await wrapper.get('form').trigger('submit');
      };
      await click();
      gate.mockImplementation(() => {
        throw new Error('host denied');
      });
      await click();
      await flushPromises();
      expect(gate).toHaveBeenCalledTimes(2);
      expect(submitRequest).not.toHaveBeenCalled();
      expect(sessionStorage.length).toBe(recovery ? 1 : 0);
      if (original)
        expect(
          sessionStorage.getItem(
            caseSectionRecordStorageKey(
              'INTERNAL:actor:department',
              uid(1),
              original,
            ),
          ),
        ).toBe(before);
    },
  );
  it.each([false, true])(
    'settles an accepted host even when a synchronous permission preflight rejects before submitting becomes true, recovery=%s',
    async (recovery) => {
      if (recovery) retainHearing();
      const item = reactive(fixture());
      const host = createListWorkflowContext(async () => item);
      await host.sync({
        recordId: item.id,
        actorKey: 'actor-auth-1',
        actionKey: 'edit-section-records',
        title: '资料更正',
      });
      const session = host.state.value.session!;
      const states: string[] = [];
      const { wrapper, submitRequest } = render('hearing', item, undefined, {
        beforeSubmit: ({ recovery }) => {
          const admitted = session.beginSubmit({ recovery });
          item.recordEdits!.hearings![0]!.canEdit = false;
          return admitted;
        },
        'onState-change': (state) => {
          states.push(state);
          if (state === 'unknown') {
            if (host.state.value.requestState === 'idle')
              session.restoreUnknown();
            else session.endSubmit('unknown');
          } else if (state === 'idle') session.endSubmit('failed');
        },
      });
      if (recovery)
        await wrapper
          .get('[data-test="section-record-retry"]')
          .trigger('click');
      else {
        await change(wrapper);
        await wrapper.get('form').trigger('submit');
      }
      await flushPromises();
      expect(states).toEqual([
        recovery ? 'unknown' : 'idle',
        recovery ? 'unknown' : 'idle',
      ]);
      expect(host.state.value.requestState).toBe(recovery ? 'unknown' : 'idle');
      expect(submitRequest).not.toHaveBeenCalled();
      expect(sessionStorage.length).toBe(recovery ? 1 : 0);
    },
  );
  it.each([0, 400, 409])(
    'settles the real host after original transport outcome %s without a transient unknown before POST',
    async (status) => {
      const item = fixture();
      const host = createListWorkflowContext(async () => item);
      await host.sync({
        recordId: item.id,
        actorKey: 'actor-auth-1',
        actionKey: 'edit-section-records',
        title: '资料更正',
      });
      const session = host.state.value.session!;
      const states: string[] = [];
      const { wrapper, submitRequest } = render('hearing', item, undefined, {
        beforeSubmit: ({ recovery }) => session.beginSubmit({ recovery }),
        'onState-change': (state) => {
          states.push(state);
          if (state === 'unknown') session.endSubmit('unknown');
          else if (state === 'idle') session.endSubmit('failed');
        },
      });
      submitRequest.mockImplementation(() => {
        expect(states).toEqual(['idle', 'submitting']);
        expect(host.state.value.requestState).toBe('submitting');
        return Promise.reject(
          new ApiError(
            '结果',
            status,
            status === 0 ? 'NETWORK_ERROR' : 'VERSION_CONFLICT',
          ),
        );
      });
      await change(wrapper);
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(states).toEqual([
        'idle',
        'submitting',
        status === 0 ? 'unknown' : 'idle',
      ]);
      expect(host.state.value.requestState).toBe(
        status === 0 ? 'unknown' : 'idle',
      );
      expect(wrapper.emitted('changed')).toBeUndefined();
      expect(sessionStorage.length).toBe(status === 0 ? 1 : 0);
    },
  );
  it.each(kinds)(
    'prefills and saves only the exact %s record without a workflow version',
    async (kind) => {
      const item = fixture();
      const before = structuredClone(item);
      const { wrapper, submitRequest } = render(kind, item);
      expect(
        wrapper.get('[data-test="section-record-date"]').element,
      ).toHaveProperty(
        'value',
        {
          'execution-mailing': '2026-10-01',
          'execution-filing': '2026-10-02',
          'execution-finish': '2026-10-03',
          hearing: '2026-10-04',
          judgment: '2026-10-05',
          closure: '2026-10-06',
        }[kind],
      );
      await wrapper
        .get('[data-test="section-record-reason"]')
        .setValue('仅原因');
      expect(
        wrapper.get('[data-test="section-record-save"]').attributes('disabled'),
      ).toBeDefined();
      await change(wrapper);
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(submitRequest).toHaveBeenCalledTimes(1);
      const [caseId, request] = submitRequest.mock.calls[0]!;
      expect(caseId).toBe(item.id);
      expect(request.kind).toBe(kind);
      expect(request.input).not.toHaveProperty('expectedVersion');
      expect(request.input).not.toHaveProperty('expectedFinishId');
      expect(
        'correctionReason' in request.input
          ? request.input.correctionReason
          : request.input.reason,
      ).toBe('  更正登记日期  ');
      if (request.kind === 'closure')
        expect(request.input).toMatchObject({
          closureId: uid(7),
          expectedClosureRevision: 0,
          expectedClosureVersionId: uid(8),
          closeContentVersionIds: [file.contentVersionId],
          closeAmt: '100.00',
        });
      if (request.kind === 'execution-mailing')
        expect(request.input.mailReceiptContentVersionIds).toEqual([
          file.contentVersionId,
          otherFile.contentVersionId,
        ]);
      if (request.kind === 'judgment')
        expect(request.input).toMatchObject({
          judgmentAmountState: 'KNOWN',
          judgmentAmount: '120.00',
          paidLitigationFeeState: 'PENDING',
          paidLitigationFee: null,
        });
      if (request.kind === 'execution-finish')
        expect(request.input).toMatchObject({
          reason: '执行已结束',
          basisNote: '原依据',
        });
      expect(item).toEqual(before);
      expect(wrapper.emitted('changed')).toHaveLength(1);
      expect(sessionStorage.length).toBe(0);
    },
  );
  it.each(kinds)(
    'cancel %s never writes and restores the read values',
    async (kind) => {
      const { wrapper, submitRequest } = render(kind);
      const date = wrapper.get<HTMLInputElement>(
        '[data-test="section-record-date"]',
      ).element.value;
      await change(wrapper);
      await wrapper.get('[data-test="section-record-cancel"]').trigger('click');
      expect(submitRequest).not.toHaveBeenCalled();
      expect(wrapper.emitted('cancel')).toHaveLength(1);
      expect(
        wrapper.get<HTMLInputElement>('[data-test="section-record-date"]')
          .element.value,
      ).toBe(date);
      expect(sessionStorage.length).toBe(0);
    },
  );
  it('keeps unknown closure body/key and both original anchors through refresh, unmount and original-actor login', async () => {
    const first = render('closure');
    first.submitRequest.mockRejectedValueOnce(
      new ApiError('网络未知', 0, 'NETWORK_ERROR'),
    );
    await change(first.wrapper);
    await first.wrapper.get('form').trigger('submit');
    await flushPromises();
    const original = first.submitRequest.mock.calls[0]![1];
    const raw = sessionStorage.getItem(
      caseSectionRecordStorageKey(
        'INTERNAL:actor:department',
        uid(1),
        original,
      ),
    );
    expect(raw).not.toBeNull();
    first.wrapper.unmount();
    const changed = fixture();
    changed.closure!.current.id = uid(88);
    changed.recordEdits!.closures![0]!.closureRevision = 12;
    const second = render('closure', changed);
    await flushPromises();
    expect(
      second.wrapper.get('[data-test="section-record-pending"]').text(),
    ).toContain(uid(8));
    expect(second.submitRequest).not.toHaveBeenCalled();
    await second.wrapper
      .get('[data-test="section-record-retry"]')
      .trigger('click');
    await flushPromises();
    expect(second.submitRequest.mock.calls[0]![1]).toEqual(original);
    expect(second.wrapper.emitted('changed')).toHaveLength(1);
  });
  it('prevents double POST and ignores stale success after authorization changes, retaining the original request', async () => {
    const request = deferred();
    const { wrapper, submitRequest } = render('hearing');
    submitRequest.mockReturnValue(request.promise);
    await change(wrapper);
    await wrapper.get('form').trigger('submit');
    await wrapper.get('form').trigger('submit');
    expect(submitRequest).toHaveBeenCalledTimes(1);
    const signal = submitRequest.mock.calls[0]![2].signal!;
    await wrapper.setProps({ contextKey: 'auth-revision-2' });
    expect(signal.aborted).toBe(true);
    request.resolve();
    await flushPromises();
    expect(wrapper.emitted('changed')).toBeUndefined();
    expect(wrapper.find('[data-test="section-record-form"]').exists()).toBe(
      false,
    );
    expect(
      readCaseSectionRecordRequests('INTERNAL:actor:department', uid(1)),
    ).toHaveLength(1);
    await wrapper.setProps({
      actorKey: 'INTERNAL:other:department',
      contextKey: 'other',
    });
    expect(wrapper.find('[data-test="section-record-pending"]').exists()).toBe(
      false,
    );
    expect(submitRequest).toHaveBeenCalledTimes(1);
  });
  it('retains a readable original request when its target no longer appears in a fresh projection, without substituting a new target', async () => {
    const first = render('hearing');
    first.submitRequest.mockRejectedValue(
      new ApiError('结果未知', 0, 'NETWORK_ERROR'),
    );
    await change(first.wrapper);
    await first.wrapper.get('form').trigger('submit');
    await flushPromises();
    first.wrapper.unmount();
    const item = fixture();
    item.recordEdits!.hearings = [];
    const second = render('hearing', item);
    expect(
      second.wrapper.get('[data-test="section-record-pending"]').text(),
    ).toContain(uid(5));
    expect(second.wrapper.find('form').exists()).toBe(false);
    expect(
      second.wrapper.find('[data-test="section-record-retry"]').exists(),
    ).toBe(false);
    expect(second.submitRequest).not.toHaveBeenCalled();
    expect(
      readCaseSectionRecordRequests('INTERNAL:actor:department', uid(1)),
    ).toHaveLength(1);
  });
  it('preserves an aborted POST on unmount and permits an explicit identical retry only after the old call settles', async () => {
    const request = deferred();
    const first = render('execution-mailing');
    first.submitRequest.mockReturnValue(request.promise);
    await change(first.wrapper);
    await first.wrapper.get('form').trigger('submit');
    const original = first.submitRequest.mock.calls[0]![1];
    first.wrapper.unmount();
    request.reject(new DOMException('aborted', 'AbortError'));
    await flushPromises();
    const second = render('execution-mailing');
    await second.wrapper
      .get('[data-test="section-record-retry"]')
      .trigger('click');
    await flushPromises();
    expect(second.submitRequest.mock.calls[0]![1]).toEqual(original);
  });
  it.each([400, 409])(
    'releases definite %s failures, refreshes only a conflict, and never auto-resubmits',
    async (status) => {
      const { wrapper, submitRequest } = render('closure');
      submitRequest.mockRejectedValue(
        new ApiError('版本冲突', status, 'VERSION_CONFLICT'),
      );
      await change(wrapper);
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(sessionStorage.length).toBe(0);
      expect(wrapper.emitted('refresh')?.length ?? 0).toBe(
        status === 409 ? 1 : 0,
      );
      expect(submitRequest).toHaveBeenCalledTimes(1);
      expect(wrapper.emitted('changed')).toBeUndefined();
      if (status === 409) expect(wrapper.find('form').exists()).toBe(false);
    },
  );
  it.each([401, 403, 404])(
    'retains original %s denied request while clearing visible fields',
    async (status) => {
      const { wrapper, submitRequest } = render('hearing');
      submitRequest.mockRejectedValue(
        new ApiError('权限失效', status, 'FORBIDDEN'),
      );
      await change(wrapper);
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(sessionStorage.length).toBe(1);
      expect(wrapper.emitted('access-lost')).toHaveLength(1);
      expect(wrapper.find('[data-test="section-record-form"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-test="section-record-retry"]').exists()).toBe(
        false,
      );
    },
  );
  it('keeps idempotency conflicts unknown and rejects malformed recovery records with extra workflow anchors', async () => {
    const { wrapper, submitRequest } = render('closure');
    submitRequest.mockRejectedValue(
      new ApiError('幂等冲突', 409, 'IDEMPOTENCY_CONFLICT'),
    );
    await change(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(sessionStorage.length).toBe(1);
    expect(wrapper.emitted('refresh')).toBeUndefined();
    const [stored] = readCaseSectionRecordRequests(
      'INTERNAL:actor:department',
      uid(1),
    );
    expect(stored).toBeDefined();
    expect(
      decodeCaseSectionRecordRequest({
        ...stored,
        request: {
          ...stored!.request,
          input: { ...stored!.request.input, expectedVersion: 42 },
        },
      }),
    ).toBeNull();
    expect(
      decodeCaseSectionRecordRequest({
        ...stored,
        request: {
          ...stored!.request,
          input: {
            ...stored!.request.input,
            expectedClosureVersionId: undefined,
          },
        },
      }),
    ).toBeNull();
    sessionStorage.setItem(
      'case-section-record:v1:INTERNAL%3Aactor%3Adepartment:' +
        uid(1) +
        ':corrupt',
      '{}',
    );
    const second = render('hearing');
    await change(second.wrapper);
    await second.wrapper.get('form').trigger('submit');
    expect(second.submitRequest).not.toHaveBeenCalled();
    expect(
      second.wrapper.get('[data-test="section-record-error"]').text(),
    ).toContain('恢复记录');
  });
  it.each(kinds)(
    'offers no substitute workflow for %s when its target permission is false or no registered record exists',
    async (kind) => {
      const item = fixture();
      for (const entries of [
        item.recordEdits!.executionMailings!,
        item.recordEdits!.executionFilings!,
        item.recordEdits!.executionFinishes!,
        item.recordEdits!.hearings!,
        item.recordEdits!.judgments!,
        item.recordEdits!.closures!,
      ])
        for (const entry of entries) entry.canEdit = false;
      const { wrapper, submitRequest } = render(kind, item);
      expect(wrapper.find('form').exists()).toBe(false);
      await wrapper.setProps({
        item: { ...fixture(), recordEdits: undefined },
      });
      expect(
        wrapper.get('[data-test="section-record-unavailable"]').text(),
      ).toContain('没有');
      expect(submitRequest).not.toHaveBeenCalled();
    },
  );
  it.each(['judgment', 'closure'] as const)(
    'saves a corrected %s amount and preserves pending fee/null semantics',
    async (kind) => {
      const { wrapper, submitRequest } = render(kind);
      await wrapper
        .get('[data-test="section-record-amount"]')
        .setValue('130.25');
      await wrapper
        .get('[data-test="section-record-reason"]')
        .setValue('更正已登记金额');
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(submitRequest.mock.calls[0]![1].input).toMatchObject(
        kind === 'judgment'
          ? {
              judgmentAmountState: 'KNOWN',
              judgmentAmount: '130.25',
              paidLitigationFeeState: 'PENDING',
              paidLitigationFee: null,
            }
          : { closeAmountState: 'KNOWN', closeAmt: '130.25', note: '原说明' },
      );
    },
  );
  it('keeps original, effective and correction history values and exact attachment versions separate', async () => {
    const item = fixture();
    const entry = item.recordEdits!.executionMailings![0]!;
    const nextFile = {
      ...file,
      contentVersionId: uid(24),
      originalFilename: '更正.pdf',
    };
    entry.effective = {
      mailedAt: '2026-10-07',
      mailReceiptContentVersionIds: [nextFile.contentVersionId],
      files: [nextFile],
    };
    entry.mailingRevision = 1;
    entry.history = [
      {
        ...entry.effective,
        id: uid(100),
        priorCorrectionId: null,
        fromRevision: 0,
        toRevision: 1,
        correctionReason: '附件版本更正',
        recordedAt: '2026-10-15T00:00:00Z',
        recordedByUserId: uid(10),
      },
    ];
    const { wrapper } = render('execution-mailing', item);
    expect(
      wrapper.get('[data-test="section-record-date"]').element,
    ).toHaveProperty('value', '2026-10-07');
    expect(
      wrapper.get('[data-test="section-record-history"]').text(),
    ).toContain('2026-10-01');
    expect(
      wrapper.get('[data-test="section-record-history"]').text(),
    ).toContain('附件版本更正');
    expect(
      wrapper.get('[data-test="section-record-history"]').text(),
    ).toContain(file.contentVersionId);
    expect(
      wrapper.get('[data-test="section-record-effective-files"]').text(),
    ).toContain(nextFile.contentVersionId);
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('原登记版本'))!
      .trigger('click');
    expect(api.download).toHaveBeenCalledWith(
      file.materialId,
      file.contentVersionId,
      expect.any(AbortSignal),
    );
  });
  it('supports future/unknown hearing values without applying workflow stage rules', async () => {
    const { wrapper, submitRequest } = render('hearing');
    await change(wrapper, '2099-01-01');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(submitRequest.mock.calls[0]![1].input).toMatchObject({
      hearingAt: '2099-01-01',
    });
    await wrapper.setProps({ openRevision: 1 });
    await change(wrapper, '');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(submitRequest.mock.calls[1]![1].input).toMatchObject({
      hearingAt: null,
    });
  });
  it('selects the exact historical initial or remanded first-instance hearing target', async () => {
    const item = fixture();
    const old = item.recordEdits!.hearings![0]!;
    item.recordEdits!.hearings!.push({
      ...old,
      arrangementId: uid(55),
      trialRoundId: uid(99),
    });
    item.secondInstance.rounds.push({
      id: uid(99),
      sequence: 2,
      sourceResultId: null,
      revokedAt: null,
    });
    item.hearing.currentArrangement = null;
    const { wrapper, submitRequest } = render('hearing', item);
    expect(
      wrapper.get('[data-test="section-record-target"]').element,
    ).toHaveProperty('value', '');
    expect(wrapper.find('form').exists()).toBe(false);
    await wrapper.get('[data-test="section-record-target"]').setValue(uid(55));
    await change(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(submitRequest.mock.calls[0]![1].input).toMatchObject({
      arrangementId: uid(55),
      trialRoundId: uid(99),
    });
  });
  it('reuses and downloads exact frozen versions and preserves selected request order', async () => {
    const { wrapper, submitRequest } = render('execution-mailing');
    expect(wrapper.find('input[type="file"]').exists()).toBe(true);
    expect(api.upload).not.toHaveBeenCalled();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '下载精确版本')!
      .trigger('click');
    expect(api.download).toHaveBeenCalledWith(
      file.materialId,
      file.contentVersionId,
      expect.any(AbortSignal),
    );
    await wrapper
      .get(`[data-test="section-record-file-${file.contentVersionId}"]`)
      .setValue(false);
    await wrapper
      .get(`[data-test="section-record-file-${file.contentVersionId}"]`)
      .setValue(true);
    await wrapper
      .get('[data-test="section-record-reason"]')
      .setValue('重排附件');
    expect(
      wrapper.get('[data-test="section-record-save"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper
      .get('[data-test="section-record-date"]')
      .setValue('2026-10-07');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(submitRequest.mock.calls[0]![1].input).toMatchObject({
      mailReceiptContentVersionIds: [
        otherFile.contentVersionId,
        file.contentVersionId,
      ],
    });
  });
  it('does not turn a known amount back to a numeric zero or treat hidden draft money as a change', async () => {
    const item = fixture();
    const entry = item.recordEdits!.closures![0]!;
    entry.effective = {
      ...entry.effective,
      closeAmountState: 'PENDING',
      closeAmt: null,
    };
    entry.original = entry.effective;
    const { wrapper, submitRequest } = render('closure', item);
    await wrapper
      .get('[data-test="section-record-amount-state"]')
      .setValue('KNOWN');
    await wrapper.get('[data-test="section-record-amount"]').setValue('5');
    await wrapper
      .get('[data-test="section-record-amount-state"]')
      .setValue('PENDING');
    await wrapper.get('[data-test="section-record-reason"]').setValue('原因');
    expect(
      wrapper.get('[data-test="section-record-save"]').attributes('disabled'),
    ).toBeDefined();
    await change(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(submitRequest.mock.calls[0]![1].input).toMatchObject({
      closeAmountState: 'PENDING',
      closeAmt: null,
    });
  });
  it('replaces stale closure form anchors with a newly read version and requires re-entry before saving', async () => {
    const { wrapper, submitRequest } = render('closure');
    await change(wrapper);
    const item = fixture();
    item.closure!.current.id = uid(88);
    await wrapper.setProps({ item });
    expect(
      wrapper.get('[data-test="section-record-save"]').attributes('disabled'),
    ).toBeDefined();
    expect(wrapper.get('[data-test="section-record-error"]').text()).toContain(
      '版本',
    );
    await change(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(submitRequest.mock.calls[0]![1].input).toMatchObject({
      expectedClosureVersionId: uid(88),
      expectedClosureRevision: 0,
    });
  });
  it('preserves the unknown request if a successful HTTP response names another target', async () => {
    const { wrapper } = render('hearing');
    await wrapper.setProps({ submitRequest: submitCaseSectionRecordRequest });
    api.hearing.mockResolvedValue({
      caseId: uid(1),
      arrangementId: uid(55),
      trialRoundId: uid(9),
      hearingRevision: 6,
      hearingAt: '2026-10-07',
    });
    await change(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.emitted('changed')).toBeUndefined();
    expect(wrapper.find('[data-test="section-record-pending"]').exists()).toBe(
      true,
    );
    expect(sessionStorage.length).toBe(1);
  });
});
