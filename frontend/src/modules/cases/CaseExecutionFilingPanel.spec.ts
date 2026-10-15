import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import CaseExecutionFilingPanel from './CaseExecutionFilingPanel.vue';

const api = vi.hoisted(() => ({
  submitCaseExecutionFiling: vi.fn(),
  listOwnerMaterials: vi.fn(),
  uploadMaterialFile: vi.fn(),
  downloadMaterialVersion: vi.fn(),
  todayShanghai: vi.fn(() => '2026-10-03'),
}));
vi.mock('../../api/cases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/cases')>()),
  submitCaseExecutionFiling: api.submitCaseExecutionFiling,
  todayShanghai: api.todayShanghai,
}));
vi.mock('../../api/materials', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/materials')>()),
  listOwnerMaterials: api.listOwnerMaterials,
  uploadMaterialFile: api.uploadMaterialFile,
  downloadMaterialVersion: api.downloadMaterialVersion,
}));
const item = {
  id: 'case-1',
  stage: 'WAITING_EXECUTION_FILING',
  version: 8,
  canSubmitExecutionFiling: true,
  canFinishExecution: false,
  executionMailing: {
    id: 'mailing-1',
    mailedAt: '2026-10-02',
    recordedAt: '2026-10-02T01:00:00Z',
    files: [],
  },
  executionFiling: null,
  executionFinish: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  api.todayShanghai.mockReturnValue('2026-10-03');
  api.listOwnerMaterials.mockResolvedValue({ items: [], total: 0 });
  api.uploadMaterialFile.mockImplementation(async ({ file }) => ({
    materialId: `m-${file.name}`,
    contentVersionId: `v-${file.name}`,
    originalFilename: file.name,
    mimeType: file.type,
  }));
  api.submitCaseExecutionFiling.mockResolvedValue({
    id: 'case-1',
    filingId: 'filing-1',
    mailingId: 'mailing-1',
    stage: 'EXECUTING',
    version: 9,
    submittedAt: '2026-10-03',
    recordedAt: '2026-10-03T01:00:00Z',
  });
});
function mountPanel(
  value: InstanceType<typeof CaseExecutionFilingPanel>['$props']['item'] =
    item,
  extra: Record<string, unknown> = {},
) {
  return mount(CaseExecutionFilingPanel, {
    props: { item: value, contextKey: 'INTERNAL:user-1:1', ...extra },
    global: { plugins: [createPinia()] },
  });
}
async function addProof(wrapper: ReturnType<typeof mount>) {
  const input = wrapper.get('[data-test="execution-filing-file-input"]');
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: [new File(['proof'], 'filing.pdf', { type: 'application/pdf' })],
  });
  await input.trigger('change');
  await flushPromises();
}
describe('case execution filing panel', () => {
  it('keeps the operation read-only for unauthorized actors', () => {
    const wrapper = mountPanel({ ...item, canSubmitExecutionFiling: false });
    expect(
      wrapper.find('[data-test="execution-filing-read-only"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-test="execution-filing-file-input"]').exists(),
    ).toBe(false);
  });
  it('requires proof, accepts a past date before mailing, and rejects future dates', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    const date = wrapper.get('[data-test="execution-filing-submitted-at"]');
    expect((date.element as HTMLInputElement).min).toBe('');
    expect((date.element as HTMLInputElement).max).toBe('2026-10-03');
    expect(
      (
        wrapper.get('[data-test="execution-filing-review"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await addProof(wrapper);
    await date.setValue('2026-10-01');
    expect(api.uploadMaterialFile).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'EXECUTION_FILING_PROOF',
        purpose: 'EXECUTION_FILING_PROOF',
      }),
    );
    expect(
      (
        wrapper.get('[data-test="execution-filing-review"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    await date.setValue('2026-10-04');
    expect(
      (
        wrapper.get('[data-test="execution-filing-review"]')
          .element as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it('submits the expected mailing anchor and selected content version after review', async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await addProof(wrapper);
    await wrapper
      .get('[data-test="execution-filing-submitted-at"]')
      .setValue('2026-10-01');
    await wrapper.get('[data-test="execution-filing-review"]').trigger('click');
    await wrapper.get('[data-test="execution-filing-submit"]').trigger('click');
    await flushPromises();
    expect(api.submitCaseExecutionFiling).toHaveBeenCalledWith(
      'case-1',
      expect.objectContaining({
        expectedVersion: 8,
        expectedMailingId: 'mailing-1',
        submittedAt: '2026-10-01',
        executionFilingProofContentVersionIds: ['v-filing.pdf'],
        idempotencyKey: expect.any(String),
      }),
      undefined,
    );
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });
  it('records direct-stage filing with a null mailing anchor and actual proof', async () => {
    api.submitCaseExecutionFiling.mockResolvedValueOnce({
      id: 'case-1',
      filingId: 'filing-direct',
      mailingId: null,
      stage: 'EXECUTING',
      version: 9,
      submittedAt: '2026-10-01',
      recordedAt: '2026-10-03T01:00:00Z',
    });
    const wrapper = mountPanel({
      ...item,
      executionMailing: null,
      origin: {
        kind: 'EXTERNAL_ENTRY',
        initialStage: 'WAITING_EXECUTION_FILING',
      },
    });
    await flushPromises();
    await addProof(wrapper);
    await wrapper
      .get('[data-test="execution-filing-submitted-at"]')
      .setValue('2026-10-01');
    await wrapper.get('[data-test="execution-filing-review"]').trigger('click');
    await wrapper.get('[data-test="execution-filing-submit"]').trigger('click');
    await flushPromises();
    expect(api.submitCaseExecutionFiling).toHaveBeenCalledWith(
      'case-1',
      expect.objectContaining({
        expectedMailingId: null,
        executionFilingProofContentVersionIds: ['v-filing.pdf'],
      }),
      undefined,
    );
  });
  it('retries an unknown result with the exact original request body', async () => {
    api.submitCaseExecutionFiling
      .mockRejectedValueOnce(new ApiError('timeout', 0, 'TIMEOUT'))
      .mockResolvedValueOnce({});
    const wrapper = mountPanel();
    await flushPromises();
    await addProof(wrapper);
    await wrapper.get('[data-test="execution-filing-review"]').trigger('click');
    await wrapper.get('[data-test="execution-filing-submit"]').trigger('click');
    await flushPromises();
    const original = api.submitCaseExecutionFiling.mock.calls[0];
    expect(wrapper.text()).toContain('提交结果暂时未知');
    await wrapper.setProps({
      item: {
        ...item,
        version: 9,
        stage: 'EXECUTING',
        canSubmitExecutionFiling: false,
      },
    });
    expect(wrapper.find('[data-test="execution-filing-retry"]').exists()).toBe(
      true,
    );
    await wrapper.get('[data-test="execution-filing-retry"]').trigger('click');
    await flushPromises();
    expect(api.submitCaseExecutionFiling.mock.calls[1]).toEqual(original);
  });
  it('does not emit a late filing result after the case context changes', async () => {
    let finish!: () => void;
    api.submitCaseExecutionFiling.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const wrapper = mountPanel();
    await flushPromises();
    await addProof(wrapper);
    await wrapper.get('[data-test="execution-filing-review"]').trigger('click');
    await wrapper.get('[data-test="execution-filing-submit"]').trigger('click');
    await wrapper.setProps({
      item: { ...item, id: 'case-2', version: 1 },
      contextKey: 'INTERNAL:user-1:2',
    });
    finish();
    await flushPromises();
    expect(wrapper.emitted('changed')).toBeUndefined();
    expect(wrapper.text()).not.toContain('执行备案登记已完成');
  });
});
