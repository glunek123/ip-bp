import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseDetail } from '../../api/cases';
import { ApiError } from '../../api/http';
import CaseExecutionSubmissionPanel from './CaseExecutionSubmissionPanel.vue';
import {
  clearExecutionCommand,
  clearExecutionUpload,
  beginExecutionUpload,
  pendingExecutionCommand,
  readExecutionUpload,
} from './case-execution-recovery';

const api = vi.hoisted(() => ({
  submitExecution: vi.fn(),
  uploadMaterialFile: vi.fn(),
  listOwnerMaterials: vi.fn(),
  downloadMaterialVersion: vi.fn(),
}));
vi.mock('../../api/cases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/cases')>()),
  submitExecution: api.submitExecution,
}));
vi.mock('../../api/materials', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/materials')>()),
  uploadMaterialFile: api.uploadMaterialFile,
  listOwnerMaterials: api.listOwnerMaterials,
  downloadMaterialVersion: api.downloadMaterialVersion,
}));
vi.mock('../../app/workflow-events', () => ({
  notifyWorkflowChanged: vi.fn(),
}));

const id = (last: string) =>
  `70000000-0000-4000-8000-${last.padStart(12, '0')}`;
const file = {
  materialId: id('10'),
  contentVersionId: id('11'),
  originalFilename: '执行申请.pdf',
  mimeType: 'application/pdf',
  uploadedAt: '2026-10-12T00:00:00.000Z',
};
const secondFile = {
  materialId: id('12'),
  contentVersionId: id('13'),
  originalFilename: '执行申请补充.pdf',
  mimeType: 'application/pdf',
  uploadedAt: '2026-10-12T00:00:00.000Z',
};
const item = (overrides: Record<string, unknown> = {}) =>
  ({
    id: id('20'),
    version: 14,
    stage: 'WAITING_EXECUTION_DOCUMENTS',
    canSubmitExecution: true,
    judgmentNextStep: {
      current: { id: id('1'), trialRoundId: id('2'), next: 'EXECUTION' },
      history: [],
      revocations: [],
    },
    secondInstance: {
      currentTrialRoundId: id('2'),
      currentResult: null,
      rounds: [],
      progresses: [],
      results: [],
      revocations: [],
    },
    executionSubmission: {
      current: null,
      submissions: [],
      availableFiles: [file],
    },
    ...overrides,
  }) as unknown as CaseDetail;
const ownerMaterials = [
  {
    id: file.materialId,
    ownerType: 'CASE',
    ownerId: id('20'),
    category: 'EXECUTION_APPLICATION',
    purpose: 'EXECUTION_APPLICATION',
    currentVersionId: file.contentVersionId,
    status: 'ACTIVE',
    version: 1,
    deletedAt: null,
    createdAt: file.uploadedAt,
    updatedAt: file.uploadedAt,
    contentVersions: [
      {
        id: file.contentVersionId,
        materialId: file.materialId,
        originalFilename: file.originalFilename,
        mimeType: file.mimeType,
        sizeBytes: 100,
        sha256: 'a'.repeat(64),
        status: 'AVAILABLE',
        createdAt: file.uploadedAt,
      },
    ],
  },
];
const secondOwnerMaterial = {
  ...ownerMaterials[0]!,
  id: secondFile.materialId,
  currentVersionId: secondFile.contentVersionId,
  contentVersions: [
    {
      ...ownerMaterials[0]!.contentVersions[0]!,
      id: secondFile.contentVersionId,
      materialId: secondFile.materialId,
      originalFilename: secondFile.originalFilename,
      createdAt: secondFile.uploadedAt,
    },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  const pending = pendingExecutionCommand({
    actor: 'user-a:rev-1',
    caseId: id('20'),
  });
  if (pending)
    clearExecutionCommand({ actor: 'user-a:rev-1', caseId: id('20') });
  api.listOwnerMaterials.mockResolvedValue({ items: ownerMaterials });
  api.downloadMaterialVersion.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  clearExecutionCommand({ actor: 'user-a:rev-1', caseId: id('20') });
  clearExecutionCommand({ actor: 'user-b:rev-1', caseId: id('21') });
  sessionStorage.clear();
  const marker = beginExecutionUpload({
    actor: 'user-a:rev-1',
    caseId: id('20'),
  });
  clearExecutionUpload(marker);
  sessionStorage.clear();
});

function mountPanel(caseItem = item()) {
  return mount(CaseExecutionSubmissionPanel, {
    props: {
      item: caseItem,
      contextKey: 'identity-a',
      actorKey: 'user-a:rev-1',
    },
  });
}

describe('CaseExecutionSubmissionPanel', () => {
  it('allows an authorized resubmission while the current submission awaits confirmation', async () => {
    const current = {
      id: id('30'),
      trialRoundId: id('2'),
      judgmentNextStepId: id('1'),
      secondInstanceResultId: null,
      priorSubmissionId: null,
      changeReason: null,
      fromVersion: 13,
      toVersion: 14,
      submittedAt: file.uploadedAt,
      files: [secondFile],
    };
    api.submitExecution.mockResolvedValue({
      id: id('20'),
      submissionId: id('31'),
      stage: 'WAITING_EXECUTION_CONFIRMATION',
      version: 15,
      submittedAt: file.uploadedAt,
    });
    api.listOwnerMaterials.mockResolvedValueOnce({
      items: [...ownerMaterials, secondOwnerMaterial],
    });
    const wrapper = mountPanel(
      item({
        stage: 'WAITING_EXECUTION_CONFIRMATION',
        executionSubmission: {
          current,
          submissions: [current],
          availableFiles: [file, secondFile],
        },
      }),
    );
    await flushPromises();

    expect(wrapper.find('input[type="file"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="submit-execution"]').exists()).toBe(true);
    const choices = wrapper.findAll('input[type="checkbox"]');
    expect(choices).toHaveLength(2);
    const firstChoice = choices[0]!;
    const secondChoice = choices[1]!;
    await firstChoice.setValue(true);
    await secondChoice.setValue(true);
    await wrapper.get('textarea').setValue('更正执行材料');
    expect(
      (
        wrapper.get('[data-test="submit-execution"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    await wrapper.get('[data-test="submit-execution"]').trigger('click');
    await flushPromises();
    expect(api.submitExecution).toHaveBeenCalledWith(
      id('20'),
      expect.objectContaining({
        expectedVersion: 14,
        expectedSubmissionId: current.id,
        changeReason: '更正执行材料',
        executionApplicationContentVersionIds: [
          file.contentVersionId,
          secondFile.contentVersionId,
        ].sort(),
      }),
      'internal',
    );
    const firstBody = api.submitExecution.mock.calls[0]![1];

    await wrapper.get('textarea').setValue('补充说明');
    await wrapper.get('[data-test="submit-execution"]').trigger('click');
    await flushPromises();
    const changedReasonBody = api.submitExecution.mock.calls[1]![1];
    expect(changedReasonBody.idempotencyKey).not.toBe(firstBody.idempotencyKey);
    expect(changedReasonBody.executionApplicationContentVersionIds).toEqual(
      [file.contentVersionId, secondFile.contentVersionId].sort(),
    );

    await secondChoice.setValue(false);
    await wrapper.get('[data-test="submit-execution"]').trigger('click');
    await flushPromises();
    const changedFilesBody = api.submitExecution.mock.calls[2]![1];
    expect(changedFilesBody.idempotencyKey).not.toBe(
      changedReasonBody.idempotencyKey,
    );
    expect(changedFilesBody.executionApplicationContentVersionIds).toEqual([
      file.contentVersionId,
    ]);
  });

  it('keeps a pending submission read-only when this actor lacks submit capability', async () => {
    const wrapper = mountPanel(
      item({
        stage: 'WAITING_EXECUTION_CONFIRMATION',
        canSubmitExecution: false,
        executionSubmission: {
          current: null,
          submissions: [
            {
              id: id('30'),
              trialRoundId: id('2'),
              judgmentNextStepId: id('1'),
              secondInstanceResultId: null,
              priorSubmissionId: null,
              changeReason: null,
              fromVersion: 13,
              toVersion: 14,
              submittedAt: file.uploadedAt,
              files: [file],
            },
          ],
          availableFiles: [],
        },
      }),
    );
    await flushPromises();
    expect(wrapper.text()).toContain('执行材料提交历史');
    expect(wrapper.text()).toContain(file.originalFilename);
    expect(wrapper.text()).toContain('请在确认面板核对整套材料');
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="submit-execution"]').exists()).toBe(false);
  });

  it('shows only immutable history after the execution submission is confirmed', async () => {
    const wrapper = mountPanel(
      item({
        stage: 'WAITING_EXECUTION_STAMP',
        canSubmitExecution: false,
        executionSubmission: {
          current: null,
          submissions: [
            {
              id: id('30'),
              trialRoundId: id('2'),
              judgmentNextStepId: id('1'),
              secondInstanceResultId: null,
              priorSubmissionId: null,
              changeReason: null,
              fromVersion: 13,
              toVersion: 14,
              submittedAt: file.uploadedAt,
              files: [file],
            },
          ],
          availableFiles: [],
        },
        executionConfirmation: {
          id: id('31'),
          submissionId: id('30'),
          confirmedAt: file.uploadedAt,
          confirmedByUserId: id('32'),
          files: [file],
        },
      }),
    );
    await flushPromises();
    expect(wrapper.text()).toContain('执行材料提交历史');
    expect(wrapper.text()).toContain(file.originalFilename);
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="submit-execution"]').exists()).toBe(false);
  });

  it('auto-selects the sole eligible file and submits explicit nullable anchors', async () => {
    api.submitExecution.mockResolvedValue({
      id: id('20'),
      submissionId: id('30'),
      stage: 'WAITING_EXECUTION_CONFIRMATION',
      version: 15,
      submittedAt: file.uploadedAt,
    });
    const wrapper = mountPanel();
    await flushPromises();
    expect(
      (wrapper.get('input[type="checkbox"]').element as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (
        wrapper.get('[data-test="submit-execution"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    await wrapper.get('[data-test="submit-execution"]').trigger('click');
    await flushPromises();
    expect(api.submitExecution).toHaveBeenCalledWith(
      id('20'),
      expect.objectContaining({
        expectedVersion: 14,
        trialRoundId: id('2'),
        judgmentNextStepId: id('1'),
        secondInstanceResultId: null,
        expectedSubmissionId: null,
        executionApplicationContentVersionIds: [file.contentVersionId],
      }),
      'internal',
    );
  });

  it('submits a direct WAITING_EXECUTION_DOCUMENTS entry without an invented next-step ID', async () => {
    api.submitExecution.mockResolvedValue({
      id: id('20'),
      submissionId: null,
      stage: 'WAITING_EXECUTION_CONFIRMATION',
      version: 15,
      submittedAt: file.uploadedAt,
    });
    const wrapper = mountPanel(
      item({
        origin: {
          kind: 'EXTERNAL_ENTRY',
          initialStage: 'WAITING_EXECUTION_DOCUMENTS',
        },
        judgmentNextStep: { current: null, history: [], revocations: [] },
      }),
    );
    await flushPromises();
    await wrapper.get('[data-test="submit-execution"]').trigger('click');
    await flushPromises();

    expect(api.submitExecution).toHaveBeenCalledWith(
      id('20'),
      expect.objectContaining({
        trialRoundId: id('2'),
        judgmentNextStepId: null,
        secondInstanceResultId: null,
        expectedSubmissionId: null,
        executionApplicationContentVersionIds: [file.contentVersionId],
      }),
      'internal',
    );
  });

  it('submits a direct SECOND_INSTANCE result using the true result ID and no fabricated choice', async () => {
    const resultId = id('36');
    api.submitExecution.mockResolvedValue({
      id: id('20'),
      submissionId: id('37'),
      stage: 'WAITING_EXECUTION_CONFIRMATION',
      version: 15,
      submittedAt: file.uploadedAt,
    });
    const wrapper = mountPanel(
      item({
        stage: 'SECOND_INSTANCE',
        origin: { kind: 'EXTERNAL_ENTRY', initialStage: 'SECOND_INSTANCE' },
        judgmentNextStep: { current: null, history: [], revocations: [] },
        secondInstance: {
          currentTrialRoundId: id('2'),
          currentResult: { id: resultId, result: 'AFFIRM' },
          rounds: [{ id: id('2'), sequence: 1, sourceResultId: null }],
          progresses: [],
          results: [],
          revocations: [],
        },
      }),
    );
    await flushPromises();
    await wrapper.get('[data-test="submit-execution"]').trigger('click');
    await flushPromises();

    expect(api.submitExecution).toHaveBeenCalledWith(
      id('20'),
      expect.objectContaining({
        trialRoundId: id('2'),
        judgmentNextStepId: null,
        secondInstanceResultId: resultId,
      }),
      'internal',
    );
  });

  it('requires an explicit choice when multiple eligible files exist', async () => {
    api.listOwnerMaterials.mockResolvedValue({
      items: [
        ...ownerMaterials,
        {
          ...ownerMaterials[0],
          id: secondFile.materialId,
          currentVersionId: secondFile.contentVersionId,
          contentVersions: [
            {
              ...ownerMaterials[0]!.contentVersions[0],
              id: secondFile.contentVersionId,
              materialId: secondFile.materialId,
              originalFilename: secondFile.originalFilename,
            },
          ],
        },
      ],
    });
    const wrapper = mountPanel(
      item({
        executionSubmission: {
          current: null,
          submissions: [],
          availableFiles: [file, secondFile],
        },
      }),
    );
    await flushPromises();
    expect(
      wrapper
        .findAll('input[type="checkbox"]')
        .every((input) => !(input.element as HTMLInputElement).checked),
    ).toBe(true);
    expect(
      (
        wrapper.get('[data-test="submit-execution"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await wrapper.findAll('input[type="checkbox"]')[1]!.setValue(true);
    expect(
      (
        wrapper.get('[data-test="submit-execution"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it('persists an upload marker and blocks blind retry after an unknown result', async () => {
    api.uploadMaterialFile.mockRejectedValue(new TypeError('network lost'));
    const wrapper = mountPanel();
    await flushPromises();
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['pdf'], '执行申请.pdf', { type: 'application/pdf' })],
    });
    await input.trigger('change');
    await flushPromises();

    expect(wrapper.text()).toContain('上传结果未知');
    expect(
      readExecutionUpload({ actor: 'user-a:rev-1', caseId: id('20') }),
    ).not.toBeNull();
    expect(api.uploadMaterialFile).toHaveBeenCalledTimes(1);
    expect(
      (wrapper.get('input[type="file"]').element as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it('uploads direct execution-confirmation materials without exposing submission controls', async () => {
    api.uploadMaterialFile.mockResolvedValue({});
    const wrapper = mount(CaseExecutionSubmissionPanel, {
      props: {
        item: item({
          stage: 'WAITING_EXECUTION_CONFIRMATION',
          canSubmitExecution: false,
          canUploadDirectExecutionMaterials: true,
          origin: {
            kind: 'EXTERNAL_ENTRY',
            initialStage: 'WAITING_EXECUTION_CONFIRMATION',
          },
          judgmentNextStep: { current: null, history: [], revocations: [] },
        }),
        contextKey: 'identity-a',
        actorKey: 'user-a:rev-1',
        uploadOnly: true,
      },
    });
    await flushPromises();

    expect(
      wrapper.find('[data-test="execution-material-upload-only"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-test="submit-execution"]').exists()).toBe(false);
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0);
    expect(wrapper.find('textarea').exists()).toBe(false);

    const input = wrapper.get('[data-test="execution-material-upload-only"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['pdf'], 'execution.pdf', { type: 'application/pdf' })],
    });
    await input.trigger('change');
    await flushPromises();

    expect(api.uploadMaterialFile).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerType: 'CASE',
        ownerId: id('20'),
        category: 'EXECUTION_APPLICATION',
        purpose: 'EXECUTION_APPLICATION',
      }),
    );
    expect(api.submitExecution).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="submit-execution"]').exists()).toBe(false);
  });

  it('keeps direct upload-only mode read-only without the upload capability', async () => {
    const wrapper = mount(CaseExecutionSubmissionPanel, {
      props: {
        item: item({
          stage: 'WAITING_EXECUTION_CONFIRMATION',
          canSubmitExecution: false,
          origin: {
            kind: 'EXTERNAL_ENTRY',
            initialStage: 'WAITING_EXECUTION_CONFIRMATION',
          },
          judgmentNextStep: { current: null, history: [], revocations: [] },
        }),
        contextKey: 'identity-a',
        actorKey: 'user-a:rev-1',
        uploadOnly: true,
      },
    });
    await flushPromises();

    expect(
      wrapper.find('[data-test="execution-material-upload-only"]').exists(),
    ).toBe(false);
    expect(wrapper.find('[data-test="submit-execution"]').exists()).toBe(false);
    expect(api.uploadMaterialFile).not.toHaveBeenCalled();
    expect(api.submitExecution).not.toHaveBeenCalled();
  });

  it('does not treat canSubmitExecution as a direct upload capability', async () => {
    const wrapper = mount(CaseExecutionSubmissionPanel, {
      props: {
        item: item({
          stage: 'WAITING_EXECUTION_CONFIRMATION',
          canSubmitExecution: true,
          canUploadDirectExecutionMaterials: false,
          origin: {
            kind: 'EXTERNAL_ENTRY',
            initialStage: 'WAITING_EXECUTION_CONFIRMATION',
          },
          judgmentNextStep: { current: null, history: [], revocations: [] },
        }),
        contextKey: 'identity-a',
        actorKey: 'user-a:rev-1',
        uploadOnly: true,
      },
    });
    await flushPromises();

    expect(
      wrapper.find('[data-test="execution-material-upload-only"]').exists(),
    ).toBe(false);
    expect(api.uploadMaterialFile).not.toHaveBeenCalled();
  });

  it('keeps upload-only controls in recovery mode without exposing submit', async () => {
    api.uploadMaterialFile.mockRejectedValueOnce(new TypeError('network lost'));
    const wrapper = mount(CaseExecutionSubmissionPanel, {
      props: {
        item: item({
          stage: 'WAITING_EXECUTION_CONFIRMATION',
          canSubmitExecution: false,
          canUploadDirectExecutionMaterials: true,
          origin: {
            kind: 'EXTERNAL_ENTRY',
            initialStage: 'WAITING_EXECUTION_CONFIRMATION',
          },
          judgmentNextStep: { current: null, history: [], revocations: [] },
        }),
        contextKey: 'identity-a',
        actorKey: 'user-a:rev-1',
        uploadOnly: true,
      },
    });
    await flushPromises();
    const input = wrapper.get('[data-test="execution-material-upload-only"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['pdf'], 'execution.pdf', { type: 'application/pdf' })],
    });
    await input.trigger('change');
    await flushPromises();

    expect(wrapper.text()).toContain('上传结果未知');
    expect(wrapper.find('[data-test="submit-execution"]').exists()).toBe(false);
    expect(
      wrapper.find('[data-test="recover-execution-upload"]').exists(),
    ).toBe(true);
    expect(
      readExecutionUpload({ actor: 'user-a:rev-1', caseId: id('20') }),
    ).not.toBeNull();
  });

  it('rehydrates an unresolved upload marker after KeepAlive return', async () => {
    let resolveUpload!: (value: unknown) => void;
    api.uploadMaterialFile.mockReturnValueOnce(
      new Promise((resolve) => (resolveUpload = resolve)),
    );
    const visible = ref(true);
    const host = mount(
      defineComponent({
        setup: () => () =>
          h(KeepAlive, null, {
            default: () =>
              visible.value
                ? h(CaseExecutionSubmissionPanel, {
                    item: item(),
                    contextKey: 'identity-a',
                    actorKey: 'user-a:rev-1',
                  })
                : h('div'),
          }),
      }),
    );
    await flushPromises();
    const input = host.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['pdf'], 'first.pdf', { type: 'application/pdf' })],
    });
    await input.trigger('change');
    visible.value = false;
    await nextTick();
    resolveUpload({});
    await flushPromises();
    expect(
      readExecutionUpload({ actor: 'user-a:rev-1', caseId: id('20') }),
    ).not.toBeNull();
    visible.value = true;
    await nextTick();
    expect(
      (host.get('input[type="file"]').element as HTMLInputElement).disabled,
    ).toBe(true);
    host.unmount();
  });

  it('does not start an upload when the recovery marker cannot be stored', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('storage unavailable', 'QuotaExceededError');
    });
    const wrapper = mountPanel();
    await flushPromises();
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['pdf'], '执行申请.pdf', { type: 'application/pdf' })],
    });
    await input.trigger('change');
    await flushPromises();

    expect(api.uploadMaterialFile).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('上传尚未开始');
    expect(wrapper.text()).not.toContain('上传结果未知');
  });

  it('retries an unknown resubmission with its original body and key', async () => {
    api.submitExecution
      .mockRejectedValueOnce(new TypeError('network lost'))
      .mockResolvedValueOnce({});
    const current = {
      id: id('30'),
      trialRoundId: id('2'),
      judgmentNextStepId: id('1'),
      secondInstanceResultId: null,
      priorSubmissionId: null,
      changeReason: null,
      fromVersion: 13,
      toVersion: 14,
      submittedAt: file.uploadedAt,
      files: [secondFile],
    };
    const wrapper = mountPanel(
      item({
        stage: 'WAITING_EXECUTION_CONFIRMATION',
        executionSubmission: {
          current,
          submissions: [current],
          availableFiles: [file],
        },
      }),
    );
    await flushPromises();
    const choice = wrapper.get('input[type="checkbox"]');
    await choice.setValue(false);
    await wrapper.get('textarea').setValue('重提原因');
    expect(
      (
        wrapper.get('[data-test="submit-execution"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await choice.setValue(true);
    expect(
      (
        wrapper.get('[data-test="submit-execution"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    await wrapper.get('[data-test="submit-execution"]').trigger('click');
    await flushPromises();
    const firstBody = api.submitExecution.mock.calls[0]![1];
    expect(firstBody.expectedSubmissionId).toBe(current.id);
    expect(firstBody.executionApplicationContentVersionIds).toEqual([
      file.contentVersionId,
    ]);
    await wrapper.get('[data-test="retry-execution"]').trigger('click');
    await flushPromises();
    expect(api.submitExecution.mock.calls[1]![1]).toEqual(firstBody);
  });

  it('keeps a conflict visible after refresh and requires fresh selection', async () => {
    api.submitExecution.mockRejectedValue(
      new ApiError('version changed', 409, 'VERSION_CONFLICT'),
    );
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="submit-execution"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('案件版本冲突');
    expect(
      (
        wrapper.get('[data-test="submit-execution"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    await wrapper.setProps({ item: item({ version: 15 }) });
    await flushPromises();
    expect(wrapper.text()).toContain('案件版本冲突');
    await wrapper
      .get('[data-test="acknowledge-execution-conflict"]')
      .trigger('click');
    expect(
      (wrapper.get('input[type="checkbox"]').element as HTMLInputElement)
        .checked,
    ).toBe(false);
    await wrapper.get('input[type="checkbox"]').setValue(true);
    expect(
      (
        wrapper.get('[data-test="submit-execution"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it('does not let a late response from another case clear current recovery state', async () => {
    let finish!: (result: object) => void;
    api.submitExecution.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="submit-execution"]').trigger('click');
    expect(api.submitExecution).toHaveBeenCalledTimes(1);

    await wrapper.setProps({
      item: item({ id: id('21') }),
      actorKey: 'user-b:rev-1',
      contextKey: 'identity-b',
    });
    await flushPromises();
    finish({
      id: id('20'),
      submissionId: id('30'),
      stage: 'WAITING_EXECUTION_CONFIRMATION',
      version: 15,
      submittedAt: file.uploadedAt,
    });
    await flushPromises();

    expect(wrapper.text()).not.toContain('执行材料已提交');
    expect(
      pendingExecutionCommand({ actor: 'user-a:rev-1', caseId: id('20') }),
    ).toBeNull();
    expect(
      pendingExecutionCommand({ actor: 'user-b:rev-1', caseId: id('21') }),
    ).toBeNull();
  });

  it('hides cached submission history after a revoked read and ignores a late material response', async () => {
    let finishInitialRead!: (result: { items: typeof ownerMaterials }) => void;
    api.listOwnerMaterials
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishInitialRead = resolve;
        }),
      )
      .mockRejectedValueOnce(new ApiError('forbidden', 403, 'FORBIDDEN'));
    const marker = beginExecutionUpload({
      actor: 'user-a:rev-1',
      caseId: id('20'),
    });
    const wrapper = mountPanel(
      item({
        executionSubmission: {
          current: { id: id('30'), files: [file] },
          submissions: [
            {
              id: id('30'),
              submittedAt: file.uploadedAt,
              fromVersion: 14,
              toVersion: 15,
              changeReason: '更新执行申请材料',
              files: [file],
            },
          ],
          availableFiles: [file],
        },
      }),
    );
    await flushPromises();
    expect(wrapper.text()).toContain('提交历史');
    expect(wrapper.text()).toContain(file.originalFilename);

    const refreshCandidates = wrapper
      .findAll('button')
      .find((button) => button.text() === '刷新候选');
    expect(refreshCandidates).toBeDefined();
    await refreshCandidates!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('当前账号已无权读取或提交执行材料');
    expect(wrapper.text()).not.toContain('提交历史');
    expect(wrapper.text()).not.toContain(file.originalFilename);
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(wrapper.find('[data-test="submit-execution"]').exists()).toBe(false);
    expect(
      wrapper.findAll('button').some((button) => button.text() === '下载'),
    ).toBe(false);

    finishInitialRead({ items: ownerMaterials });
    await flushPromises();
    expect(wrapper.text()).not.toContain(file.originalFilename);
    expect(wrapper.text()).not.toContain('提交历史');
    clearExecutionUpload(marker);
  });
});
