import { flushPromises, mount } from '@vue/test-utils';
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

  it('retries an unknown submission with its original body and key', async () => {
    api.submitExecution
      .mockRejectedValueOnce(new TypeError('network lost'))
      .mockResolvedValueOnce({});
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('[data-test="submit-execution"]').trigger('click');
    await flushPromises();
    const firstBody = api.submitExecution.mock.calls[0]![1];
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
