import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaseDetail } from '../../api/cases';
import { ApiError } from '../../api/http';
import type { OwnerMaterial } from '../../api/materials';
import CaseWorkspaceFiles from './CaseWorkspaceFiles.vue';

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

function file(version = 'v1', materialId = 'm1') {
  return {
    materialId,
    contentVersionId: version,
    originalFilename: `${materialId}-${version}.pdf`,
    mimeType: 'application/pdf',
  };
}
function material(ownerId = 'case-1'): OwnerMaterial {
  return {
    id: 'm1',
    ownerType: 'CASE',
    ownerId,
    category: 'COMPLAINT',
    purpose: 'COMPLAINT',
    currentVersionId: 'v2',
    status: 'ACTIVE',
    version: 2,
    deletedAt: null,
    createdAt: '2026-10-14T00:00:00Z',
    updatedAt: '2026-10-14T00:00:00Z',
    contentVersions: ['v1', 'v2'].map((id) => ({
      id,
      materialId: 'm1',
      originalFilename: `m1-${id}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 10,
      sha256: 'a'.repeat(64),
      status: 'AVAILABLE',
      createdAt: '2026-10-14T00:00:00Z',
    })),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const wrappers: Array<ReturnType<typeof mount>> = [];
function render(
  item = structuredClone(baseItem),
  list = vi.fn().mockResolvedValue({ items: [], total: 0 }),
  download = vi.fn().mockResolvedValue(undefined),
) {
  const wrapper = mount(CaseWorkspaceFiles, {
    props: {
      item,
      contextKey: `${item.id}:actor-1:revision-1`,
      listCaseMaterials: list,
      downloadVersion: download,
    },
  });
  wrappers.push(wrapper);
  return { wrapper, list, download };
}
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
});

describe('CaseWorkspaceFiles', () => {
  it('deduplicates exact versions while retaining source and history, and downloads the frozen version', async () => {
    const item = structuredClone(baseItem);
    item.certificate.files = [file()];
    item.judgment.history = [
      {
        id: 'j-old',
        trialRoundId: 'round',
        kind: 'REGISTER',
        priorFactId: null,
        judgmentReceivedAt: '2026-10-12',
        judgmentAmountState: 'KNOWN',
        judgmentAmount: '0.00',
        paidLitigationFeeState: 'PENDING',
        paidLitigationFee: null,
        fromVersion: 1,
        toVersion: 2,
        recordedAt: '2026-10-12T00:00:00Z',
        files: [file()],
      },
    ];
    const { wrapper, list, download } = render(
      item,
      vi.fn().mockResolvedValue({ items: [material()], total: 1 }),
    );
    await flushPromises();
    const rows = wrapper.findAll('[data-test="workspace-file"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain('来源公证书');
    expect(rows[0]!.text()).toContain('一审判决历史 j-old');
    expect(rows[0]!.text()).toContain('历史版本');
    const details = rows[0]!.get('[data-test="workspace-file-details"]');
    expect(details.attributes('open')).toBeUndefined();
    expect(details.findAll('p').every((entry) => !entry.isVisible())).toBe(
      true,
    );
    details.element.setAttribute('open', '');
    expect(details.findAll('p').every((entry) => entry.isVisible())).toBe(true);
    expect(details.text()).toContain('版本标识：v1');
    expect(list).toHaveBeenCalledWith('case-1', {
      signal: expect.any(AbortSignal),
    });
    await rows[0]!.get('button').trigger('click');
    expect(download).toHaveBeenCalledWith('m1', 'v1', expect.any(AbortSignal));
  });

  it('keeps different materials with the same version key, excludes foreign and deleted pool entries', async () => {
    const item = structuredClone(baseItem);
    item.certificate.files = [file('v1', 'notary')];
    const deleted = {
      ...material(),
      id: 'deleted',
      status: 'DELETED' as const,
    };
    const foreignType = { ...material(), ownerType: 'NOTARY_MATTER' as const };
    const { wrapper } = render(
      item,
      vi.fn().mockResolvedValue({
        items: [material(), material('other-case'), deleted, foreignType],
        total: 4,
      }),
    );
    await flushPromises();
    expect(wrapper.findAll('[data-test="workspace-file"]')).toHaveLength(3);
    expect(wrapper.text()).not.toContain('deleted');
  });

  it('projects authorized file groups from every module and preserves exact history references', async () => {
    const item = structuredClone(baseItem);
    item.certificate.disclosureFiles = [file('disclosure')];
    item.complaint = {
      amountState: 'PENDING',
      amount: null,
      pendingReason: '待确认',
      submittedAt: '2026-10-01T00:00:00Z',
      submittedByUserId: 'u',
      complaintFiles: [file('complaint')],
      authorizationFiles: [file('auth')],
    };
    item.complaintConfirmation = {
      confirmedComplaintContentVersionId: 'complaint',
      amountState: 'KNOWN',
      amount: '0.00',
      pendingReason: null,
      changeNote: null,
      confirmDisclose: true,
      confirmedAt: '2026-10-02T00:00:00Z',
      confirmedByUserId: 'u',
      complaintFile: file('complaint'),
    };
    item.complaintMailing = {
      mailedAt: '2026-10-03',
      recordedAt: '2026-10-03T00:00:00Z',
      recordedByUserId: 'u',
      actorType: 'INTERNAL',
      receiptFiles: [file('mail')],
    };
    item.filingSubmission = {
      court: { id: 'court', name: '法院' },
      submittedAt: '2026-10-04',
      recordedAt: '2026-10-04T00:00:00Z',
      recordedByUserId: 'u',
      mediationNo: null,
      evidenceFiles: [file('filing')],
      screenshotFiles: [file('shot')],
    };
    item.acceptanceMaterials.PAYMENT_LIST = {
      available: [file('pay')],
      frozen: [file('frozen')],
      later: [file('later')],
    };
    const progress = {
      id: 'p',
      trialRoundId: 'r',
      choiceId: 'c',
      priorProgressId: null,
      hearingAt: null,
      hearingPlace: null,
      judgeName: null,
      fromVersion: 1,
      toVersion: 2,
      recordedAt: '2026-10-04T00:00:00Z',
      documentFiles: [file('second-doc')],
      serviceFiles: [file('second-service')],
    };
    item.secondInstance.currentProgress = progress;
    item.secondInstance.progresses = [progress];
    item.secondInstance.results = [
      {
        id: 's',
        trialRoundId: 'r',
        choiceId: 'c',
        judgmentId: 'j',
        progressId: 'p',
        resultReceivedAt: '2026-10-05',
        result: 'REMAND',
        judgmentAmountState: null,
        judgmentAmount: null,
        paidLitigationFeeState: 'PENDING',
        paidLitigationFee: null,
        fromVersion: 2,
        toVersion: 3,
        recordedAt: '2026-10-05T00:00:00Z',
        files: [file('second-result')],
        childTrialRoundId: 'child',
        revocationId: 'revoked',
      },
    ];
    const submission = {
      id: 'e',
      trialRoundId: 'r',
      judgmentNextStepId: 'n',
      secondInstanceResultId: null,
      priorSubmissionId: null,
      changeReason: null,
      fromVersion: 3,
      toVersion: 4,
      submittedAt: '2026-10-06T00:00:00Z',
      files: [{ ...file('execution'), uploadedAt: '2026-10-06T00:00:00Z' }],
    };
    item.executionSubmission = {
      current: submission,
      submissions: [submission],
      availableFiles: [],
    };
    item.executionConfirmation = {
      id: 'confirm',
      submissionId: 'e',
      confirmedAt: '2026-10-06T00:00:00Z',
      confirmedByUserId: 'u',
      files: submission.files,
    };
    item.executionMailing = {
      id: 'mail',
      confirmationId: 'confirm',
      mailedAt: '2026-10-07',
      recordedAt: '2026-10-07T00:00:00Z',
      files: [file('execution-mail')],
    };
    item.executionFiling = {
      id: 'filing',
      mailingId: 'mail',
      submittedAt: '2026-10-08',
      recordedAt: '2026-10-08T00:00:00Z',
      files: [file('execution-filing')],
    };
    item.executionFinish = {
      id: 'finish',
      filingId: 'filing',
      finishedAt: '2026-10-09',
      reason: '终结',
      basisNote: null,
      recordedAt: '2026-10-09T00:00:00Z',
      files: [file('finish')],
    };
    const closure = {
      id: 'close',
      kind: 'REGISTER' as const,
      priorVersionId: null,
      finishId: 'finish',
      fromVersion: 4,
      toVersion: 5,
      closeAt: null,
      closeAmountState: 'PENDING' as const,
      closeAmt: null,
      note: null,
      correctionReason: null,
      recordedAt: '2026-10-10T00:00:00Z',
      recordedByUserId: 'u',
      files: [file('closure')],
    };
    item.closure = {
      id: 'closure',
      finishId: 'finish',
      current: closure,
      history: [closure],
    };
    const { wrapper } = render(item);
    await flushPromises();
    expect(wrapper.findAll('[data-test="workspace-file"]')).toHaveLength(17);
    for (const label of [
      '来源披露',
      '已确认诉状',
      '授权材料',
      '立案证据',
      '冻结材料',
      '后续材料',
      '二审送达历史',
      '二审裁判历史',
      '已确认执行',
      '执行立案凭证',
      '执行结束依据',
      '结案历史',
    ])
      expect(wrapper.text()).toContain(label);
  });

  it('distinguishes empty, failed, and forbidden pool reads without removing authorized references', async () => {
    const { wrapper, list } = render();
    await flushPromises();
    expect(wrapper.text()).toContain('尚未登记文件');
    list.mockRejectedValueOnce(new ApiError('error', 500, 'ERROR'));
    await wrapper.setProps({
      contextKey: 'case-1:revision-2',
      item: {
        ...baseItem,
        certificate: { ...baseItem.certificate, files: [file()] },
      },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('加载失败');
    expect(wrapper.text()).not.toContain('尚未登记文件');
    expect(wrapper.findAll('[data-test="workspace-file"]')).toHaveLength(1);
    list.mockRejectedValueOnce(new ApiError('denied', 403, 'FORBIDDEN'));
    await wrapper.get('[data-test="retry-files"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('无访问权限');
    expect(wrapper.findAll('[data-test="workspace-file"]')).toHaveLength(1);
  });

  it.each([403, 404])(
    'removes only an inaccessible exact file on %i',
    async (status) => {
      const item = structuredClone(baseItem);
      item.certificate.files = [file(), file('v2')];
      const { wrapper } = render(
        item,
        undefined,
        vi.fn().mockRejectedValue(new ApiError('gone', status, 'GONE')),
      );
      await flushPromises();
      await wrapper
        .findAll('[data-test="workspace-file"]')[0]!
        .get('button')
        .trigger('click');
      await flushPromises();
      expect(wrapper.findAll('[data-test="workspace-file"]')).toHaveLength(1);
      expect(wrapper.text()).toContain('m1-v2.pdf');
      expect(wrapper.text()).toContain('已移除失效引用');
    },
  );

  it('retains a file after transient download failure and retries the same version', async () => {
    const item = structuredClone(baseItem);
    item.certificate.files = [file()];
    const download = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('failed', 500, 'ERROR'))
      .mockResolvedValueOnce(undefined);
    const { wrapper } = render(item, undefined, download);
    await flushPromises();
    await wrapper.get('[data-test="workspace-file"] button').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('文件下载失败');
    expect(wrapper.findAll('[data-test="workspace-file"]')).toHaveLength(1);
    await wrapper.get('[data-test="workspace-file"] button').trigger('click');
    await flushPromises();
    expect(download).toHaveBeenCalledTimes(2);
    expect(download.mock.calls[1]?.slice(0, 2)).toEqual(['m1', 'v1']);
  });

  it.each(['case', 'identity'])(
    'aborts loads and downloads and ignores late results on %s change',
    async (change) => {
      const pendingList = deferred<{ items: OwnerMaterial[]; total: number }>();
      const pendingDownload = deferred<void>();
      const list = vi
        .fn()
        .mockReturnValueOnce(pendingList.promise)
        .mockResolvedValueOnce({ items: [], total: 0 });
      const item = structuredClone(baseItem);
      item.certificate.files = [file()];
      const { wrapper, download } = render(
        item,
        list,
        vi.fn().mockReturnValue(pendingDownload.promise),
      );
      await wrapper.get('[data-test="workspace-file"] button').trigger('click');
      const listSignal: AbortSignal = list.mock.calls[0]![1].signal;
      const downloadSignal: AbortSignal = download.mock.calls[0]![2];
      await wrapper.setProps({
        item: { ...baseItem, id: change === 'case' ? 'case-2' : 'case-1' },
        contextKey: `${change}:new-actor`,
      });
      await flushPromises();
      expect(listSignal.aborted).toBe(true);
      expect(downloadSignal.aborted).toBe(true);
      pendingList.resolve({ items: [material()], total: 1 });
      pendingDownload.reject(new ApiError('old', 403, 'DENIED'));
      await flushPromises();
      expect(wrapper.findAll('[data-test="workspace-file"]')).toHaveLength(0);
      expect(wrapper.text()).not.toContain('失效引用');
      expect(wrapper.text()).toContain('尚未登记文件');
    },
  );

  it('does not reload the pool on same-context detail refresh and cancels on unmount', async () => {
    const pending = deferred<{ items: OwnerMaterial[]; total: number }>();
    const { wrapper, list } = render(
      undefined,
      vi.fn().mockReturnValue(pending.promise),
    );
    await wrapper.setProps({
      item: {
        ...baseItem,
        version: 8,
        certificate: { ...baseItem.certificate, files: [file('refreshed')] },
      },
    });
    expect(list).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('m1-refreshed.pdf');
    const signal: AbortSignal = list.mock.calls[0]![1].signal;
    wrapper.unmount();
    expect(signal.aborted).toBe(true);
    pending.resolve({ items: [material()], total: 1 });
    await flushPromises();
  });

  it('only requests an existing material editor with a matching stage and capability', async () => {
    const { wrapper } = render();
    await flushPromises();
    expect(wrapper.find('[data-test="open-upload"]').exists()).toBe(false);
    await wrapper.setProps({
      item: {
        ...baseItem,
        stage: 'WAITING_COMPLAINT',
        canSubmitComplaint: true,
      },
    });
    await wrapper.get('[data-test="open-upload"]').trigger('click');
    expect(wrapper.emitted('open-upload')).toEqual([[]]);
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    await wrapper.setProps({
      item: { ...baseItem, stage: 'ARCHIVED', canSubmitComplaint: true },
    });
    expect(wrapper.find('[data-test="open-upload"]').exists()).toBe(false);
    await wrapper.setProps({
      item: {
        ...baseItem,
        stage: 'WAITING_COMPLAINT',
        canSubmitComplaint: false,
      },
    });
    expect(wrapper.find('[data-test="open-upload"]').exists()).toBe(false);
  });
});
