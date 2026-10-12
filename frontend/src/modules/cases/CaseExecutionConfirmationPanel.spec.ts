import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseDetail } from '../../api/cases';
import { ApiError } from '../../api/http';
import CaseExecutionConfirmationPanel from './CaseExecutionConfirmationPanel.vue';

const api = vi.hoisted(() => ({
  confirmCaseExecution: vi.fn(),
  downloadMaterialVersion: vi.fn(),
}));
vi.mock('../../api/cases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/cases')>()),
  confirmCaseExecution: api.confirmCaseExecution,
}));
vi.mock('../../api/materials', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/materials')>()),
  downloadMaterialVersion: api.downloadMaterialVersion,
}));
vi.mock('../../app/workflow-events', () => ({
  notifyWorkflowChanged: vi.fn(),
}));

const file = {
  materialId: 'material-1',
  contentVersionId: 'version-1',
  originalFilename: '执行申请书.pdf',
  mimeType: 'application/pdf',
  uploadedAt: '2026-10-12T01:00:00.000Z',
};
const submission = {
  id: 'submission-1',
  trialRoundId: 'trial-1',
  judgmentNextStepId: 'choice-1',
  secondInstanceResultId: null,
  priorSubmissionId: null,
  changeReason: null,
  fromVersion: 14,
  toVersion: 15,
  submittedAt: '2026-10-12T01:00:00.000Z',
  files: [file],
};
function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'case-1',
    version: 15,
    stage: 'WAITING_EXECUTION_CONFIRMATION',
    canConfirmExecution: true,
    canSubmitExecution: true,
    executionSubmission: {
      current: submission,
      submissions: [submission],
      availableFiles: [],
    },
    executionConfirmation: null,
    ...overrides,
  } as unknown as CaseDetail;
}
function mountPanel(item = detail()) {
  return mount(CaseExecutionConfirmationPanel, {
    props: {
      item,
      contextKey: 'user-1:revision-1',
      actorKey: 'INTERNAL:user-1:department-1',
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  api.confirmCaseExecution.mockResolvedValue({
    id: 'case-1',
    confirmationId: 'confirmation-1',
    submissionId: submission.id,
    stage: 'WAITING_EXECUTION_STAMP',
    version: 16,
    confirmedAt: '2026-10-12T02:00:00.000Z',
  });
  api.downloadMaterialVersion.mockResolvedValue(undefined);
});

describe('CaseExecutionConfirmationPanel', () => {
  it('confirms the current whole submission once and shows immutable files after refresh', async () => {
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain(file.originalFilename);
    expect(wrapper.text()).toContain('整套执行材料');
    await wrapper.get('[data-test="confirm-execution"]').trigger('click');
    await flushPromises();

    expect(api.confirmCaseExecution).toHaveBeenCalledTimes(1);
    expect(api.confirmCaseExecution).toHaveBeenCalledWith(
      'case-1',
      expect.objectContaining({
        expectedVersion: 15,
        expectedSubmissionId: submission.id,
      }),
      'internal',
    );
    expect(wrapper.emitted('changed')).toHaveLength(1);
    expect(wrapper.emitted('refresh')).toHaveLength(1);
    expect(wrapper.find('[data-test="confirm-execution"]').exists()).toBe(
      false,
    );

    await wrapper.setProps({
      item: detail({
        version: 16,
        stage: 'WAITING_EXECUTION_STAMP',
        canConfirmExecution: false,
        canSubmitExecution: false,
        executionConfirmation: {
          id: 'confirmation-1',
          submissionId: submission.id,
          confirmedAt: '2026-10-12T02:00:00.000Z',
          confirmedByUserId: 'operator-1',
          files: [file],
        },
      }),
    });
    expect(
      wrapper.get('[data-test="execution-confirmed-at"]').text(),
    ).toContain('2026');
    expect(
      wrapper
        .find(
          `[data-test="execution-confirmation-file-${file.contentVersionId}"]`,
        )
        .exists(),
    ).toBe(true);
    expect(wrapper.find('[data-test="confirm-execution"]').exists()).toBe(
      false,
    );
  });

  it('retries an unknown result with the original body and offers a status refresh', async () => {
    api.confirmCaseExecution
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({});
    const wrapper = mountPanel();
    await wrapper.get('[data-test="confirm-execution"]').trigger('click');
    await flushPromises();
    expect(api.confirmCaseExecution).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-test="retry-confirm-execution"]').exists()).toBe(
      true,
    );
    const originalBody = api.confirmCaseExecution.mock.calls[0]![1];

    await wrapper.setProps({ item: detail({ version: 16 }) });
    await wrapper
      .get('[data-test="refresh-unknown-execution-confirmation"]')
      .trigger('click');
    expect(wrapper.emitted('refresh')).toHaveLength(1);
    await wrapper.get('[data-test="retry-confirm-execution"]').trigger('click');
    await flushPromises();
    expect(api.confirmCaseExecution).toHaveBeenCalledTimes(2);
    expect(api.confirmCaseExecution.mock.calls[1]![1]).toEqual(originalBody);
  });

  it('requires a fresh key and expected submission after a version conflict refresh', async () => {
    api.confirmCaseExecution.mockRejectedValueOnce(
      new ApiError('conflict', 409, 'CONFLICT'),
    );
    const wrapper = mountPanel();
    await wrapper.get('[data-test="confirm-execution"]').trigger('click');
    await flushPromises();
    const firstBody = api.confirmCaseExecution.mock.calls[0]![1];
    await wrapper
      .get('[data-test="refresh-execution-conflict"]')
      .trigger('click');

    const nextSubmission = { ...submission, id: 'submission-2' };
    await wrapper.setProps({
      item: detail({
        version: 16,
        executionSubmission: {
          current: nextSubmission,
          submissions: [nextSubmission],
          availableFiles: [],
        },
      }),
    });
    await wrapper.get('[data-test="confirm-execution"]').trigger('click');
    await flushPromises();
    const nextBody = api.confirmCaseExecution.mock.calls[1]![1];
    expect(nextBody.expectedVersion).toBe(16);
    expect(nextBody.expectedSubmissionId).toBe('submission-2');
    expect(nextBody.idempotencyKey).not.toBe(firstBody.idempotencyKey);
  });

  it('clears all submission details after a forbidden response', async () => {
    api.confirmCaseExecution.mockRejectedValueOnce(
      new ApiError('forbidden', 403, 'FORBIDDEN'),
    );
    const wrapper = mountPanel();
    await wrapper.get('[data-test="confirm-execution"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).not.toContain(file.originalFilename);
    expect(wrapper.find('[data-test="confirm-execution"]').exists()).toBe(
      false,
    );
  });
});
