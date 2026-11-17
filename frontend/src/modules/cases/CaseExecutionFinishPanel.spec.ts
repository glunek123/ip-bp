import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import type { CaseFile } from '../../api/cases';
import CaseExecutionFinishPanel from './CaseExecutionFinishPanel.vue';

vi.mock('../../api/cases', async (original) => ({
  ...(await original<typeof import('../../api/cases')>()),
  todayShanghai: () => '2026-10-13',
}));
type Props = InstanceType<typeof CaseExecutionFinishPanel>['$props'];
type Input = NonNullable<Props['pendingRequest']>;
type Result = Awaited<ReturnType<Props['submitFinish']>>;
const file: CaseFile = {
  materialId: 'material-1',
  contentVersionId: 'version-1',
  originalFilename: '执行裁定书.pdf',
  mimeType: 'application/pdf',
};
const item: Props['item'] = {
  id: 'case-1',
  stage: 'EXECUTING',
  version: 10,
  canFinishExecution: true,
  executionFiling: { id: 'filing-1' },
  executionFinish: null,
};
const result: Result = {
  id: 'case-1',
  finishId: 'finish-1',
  filingId: 'filing-1',
  stage: 'WAITING_ARCHIVE',
  version: 11,
  finishedAt: '2026-10-12',
  recordedAt: '2026-10-13T01:00:00Z',
};
const original: Input = {
  expectedVersion: 10,
  expectedFilingId: 'filing-1',
  idempotencyKey: 'original-key',
  finishedAt: '2026-10-12',
  reason: ' （2026）浙0106执1234号 ',
  basisNote: null,
  basisContentVersionIds: ['version-2', 'version-1'],
};
const api = {
  submitFinish: vi.fn<Props['submitFinish']>(),
  listBasisFiles: vi.fn<Props['listBasisFiles']>(),
  uploadBasisFile: vi.fn<Props['uploadBasisFile']>(),
  downloadBasisFile: vi.fn<Props['downloadBasisFile']>(),
};
beforeEach(() => {
  vi.resetAllMocks();
  api.submitFinish.mockResolvedValue(result);
  api.listBasisFiles.mockResolvedValue([]);
  api.uploadBasisFile.mockResolvedValue(file);
  api.downloadBasisFile.mockResolvedValue();
});
function panel(extra: Partial<Props> = {}) {
  return mount(CaseExecutionFinishPanel, {
    props: {
      item: { ...item },
      contextKey: 'INTERNAL:user-1:dept-1:rev-1',
      pendingRequest: null,
      ...api,
      ...extra,
    },
  });
}
type Panel = ReturnType<typeof panel>;
function control(wrapper: Panel, name: string) {
  return wrapper.get(`[data-test="execution-finish-${name}"]`);
}
function disabled(wrapper: Panel, name: string) {
  return (control(wrapper, name).element as HTMLButtonElement).disabled;
}
async function fill(wrapper: Panel) {
  await flushPromises();
  await control(wrapper, 'date').setValue('2026-10-12');
  await control(wrapper, 'reason').setValue('执行完毕');
  await addFile(wrapper);
}
async function addFile(wrapper: Panel) {
  const input = control(wrapper, 'upload');
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: [
      new File(['actual bytes'], '执行裁定书.pdf', { type: 'application/pdf' }),
    ],
  });
  await input.trigger('change');
  await flushPromises();
}
async function submit(wrapper: Panel) {
  await control(wrapper, 'submit').trigger('click');
  await flushPromises();
}
describe('execution finish injected panel', () => {
  it('labels the card as 执行更新 with filing fields only', async () => {
    const wrapper = panel();
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain('执行更新');
    expect(text).toContain('执行正式立案日期');
    expect(text).toContain('执行案号');
    expect(text).toContain('执行文书');
    expect(text).not.toContain('实际结束日期');
    expect(text).not.toContain('结束原因');
    expect(text).not.toContain('依据说明');
    expect(wrapper.find('[data-test="execution-finish-note"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.findAll('[data-test="execution-finish-submit"]').length,
    ).toBe(1);
  });

  it('keeps the recorded filing facts read-only', async () => {
    const wrapper = panel({
      item: {
        ...item,
        executionFinish: {
          id: 'finish-1',
          finishedAt: '2026-10-01',
          reason: '（2026）浙0106执1234号',
          basisNote: null,
          filingId: 'filing-1',
          recordedAt: '2026-10-02T01:00:00Z',
          files: [file],
        },
      },
    });
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain('执行正式立案日期：2026-10-01');
    expect(text).toContain('执行案号：（2026）浙0106执1234号');
    expect(text).toContain('执行裁定书.pdf');
  });

  it('requires a date and a case number before confirmation', async () => {
    const wrapper = panel();
    await flushPromises();
    // 日期默认今天，未填案号时不可提交
    expect(disabled(wrapper, 'submit')).toBe(true);
    await control(wrapper, 'reason').setValue('执行完毕');
    await flushPromises();
    // 执行文书选填，日期与案号齐备即可提交
    expect(disabled(wrapper, 'submit')).toBe(false);
  });

  it('submits filing facts with a null note and the selected documents', async () => {
    const wrapper = panel();
    await fill(wrapper);
    await submit(wrapper);
    expect(api.submitFinish).toHaveBeenCalledTimes(1);
    const input = api.submitFinish.mock.calls[0]![1];
    expect(input.finishedAt).toBe('2026-10-12');
    expect(input.reason).toBe('执行完毕');
    expect(input.basisNote).toBe('执行完毕');
    expect(input.basisContentVersionIds).toEqual(['version-1']);
  });

  it('records a direct EXECUTING entry with a null filing anchor', async () => {
    const wrapper = panel({
      item: {
        ...item,
        executionFiling: null,
        origin: { kind: 'EXTERNAL_ENTRY', initialStage: 'EXECUTING' },
      },
    });
    await fill(wrapper);
    await submit(wrapper);
    expect(api.submitFinish.mock.calls[0]![1].expectedFilingId).toBeNull();
  });

  it('retries an unknown result with the exact original request', async () => {
    api.submitFinish
      .mockRejectedValueOnce(new ApiError('网络中断', 0, 'NETWORK_ERROR'))
      .mockResolvedValueOnce(result);
    const wrapper = panel({ pendingRequest: original });
    await flushPromises();
    expect(wrapper.text()).toContain('原请求待核实');
    await control(wrapper, 'retry').trigger('click');
    await flushPromises();
    expect(api.submitFinish.mock.calls[0]![1]).toEqual(original);
  });

  it('keeps the uploaded document selected', async () => {
    const wrapper = panel();
    await addFile(wrapper);
    expect(api.uploadBasisFile).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('已选 1 份');
  });
});
