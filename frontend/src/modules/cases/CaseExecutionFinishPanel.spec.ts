import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue';
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
  originalFilename: '结束证明.pdf',
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
  reason: ' 法院已结束执行 ',
  basisNote: ' 经核实文书 ',
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
async function fill(wrapper: Panel, note = '法院文书已核实') {
  await flushPromises();
  await control(wrapper, 'date').setValue('2026-10-12');
  await control(wrapper, 'reason').setValue('执行完毕');
  await control(wrapper, 'note').setValue(note);
}
async function submit(wrapper: Panel) {
  await control(wrapper, 'review').trigger('click');
  await control(wrapper, 'submit').trigger('click');
  await flushPromises();
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
async function upload(wrapper: Panel) {
  const input = control(wrapper, 'upload');
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: [
      new File(['actual bytes'], '结束证明.pdf', { type: 'application/pdf' }),
    ],
  });
  await input.trigger('change');
  await flushPromises();
}
describe('execution finish injected panel', () => {
  it('reloads basis files only when the return case read is verified', async () => {
    const late = deferred<CaseFile[]>();
    api.listBasisFiles
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce([file]);
    const visible = ref(true);
    const readRevision = ref(0);
    const host = mount(
      defineComponent({
        setup: () => () =>
          h(KeepAlive, null, {
            default: () =>
              visible.value
                ? h(CaseExecutionFinishPanel, {
                    item,
                    contextKey: 'INTERNAL:user-1:dept-1:rev-1',
                    pendingRequest: null,
                    readRevision: readRevision.value,
                    ...api,
                  })
                : h('div'),
          }),
      }),
    );
    expect(api.listBasisFiles).toHaveBeenCalledTimes(1);
    visible.value = false;
    await nextTick();
    late.resolve([file]);
    await flushPromises();
    visible.value = true;
    await nextTick();
    expect(api.listBasisFiles).toHaveBeenCalledTimes(1);
    readRevision.value = 1;
    await nextTick();
    await flushPromises();
    expect(api.listBasisFiles).toHaveBeenCalledTimes(2);
    expect(host.text()).toContain(file.originalFilename);
    host.unmount();
  });
  it.each([
    { canFinishExecution: false },
    { stage: 'WAITING_EXECUTION_FILING' },
    { executionFiling: null },
  ])(
    'does not offer a normal command without capability and current filing: %j',
    async (change) => {
      const wrapper = panel({ item: { ...item, ...change } });
      await flushPromises();
      expect(
        wrapper.find('[data-test="execution-finish-review"]').exists(),
      ).toBe(false);
      expect(api.listBasisFiles).not.toHaveBeenCalled();
      expect(api.submitFinish).not.toHaveBeenCalled();
      wrapper.unmount();
    },
  );
  it('requires a reason and independent basis; validates real dates without adding a filing minimum', async () => {
    const wrapper = panel();
    await fill(wrapper, '');
    expect(disabled(wrapper, 'review')).toBe(true);
    await control(wrapper, 'note').setValue('  ');
    expect(disabled(wrapper, 'review')).toBe(true);
    await control(wrapper, 'note').setValue('真实依据');
    await control(wrapper, 'date').setValue('2026-02-30');
    expect(disabled(wrapper, 'review')).toBe(true);
    await control(wrapper, 'date').setValue('2026-10-14');
    expect(disabled(wrapper, 'review')).toBe(true);
    await control(wrapper, 'date').setValue('2026-01-01');
    expect(disabled(wrapper, 'review')).toBe(false);
    expect((control(wrapper, 'date').element as HTMLInputElement).min).toBe('');
    await control(wrapper, 'reason').setValue(' '.repeat(3));
    expect(disabled(wrapper, 'review')).toBe(true);
    await control(wrapper, 'reason').setValue('字'.repeat(2001));
    expect(disabled(wrapper, 'review')).toBe(true);
    wrapper.unmount();
  });
  it('confirms actual values, preserves original whitespace, and emits snapshot before POST', async () => {
    const wrapper = panel();
    await fill(wrapper, ' 经核实文书 ');
    await control(wrapper, 'reason').setValue(' 执行完毕 ');
    await control(wrapper, 'review').trigger('click');
    expect(control(wrapper, 'review-summary').text()).toContain('2026-10-12');
    expect(control(wrapper, 'review-summary').text()).toContain('待归档');
    expect(api.submitFinish).not.toHaveBeenCalled();
    api.submitFinish.mockImplementation(async (_id, input) => {
      expect(wrapper.emitted('pending-change')?.[0]).toEqual([input]);
      return result;
    });
    await control(wrapper, 'submit').trigger('click');
    await flushPromises();
    expect(api.submitFinish).toHaveBeenCalledWith('case-1', {
      expectedVersion: 10,
      expectedFilingId: 'filing-1',
      idempotencyKey: expect.any(String),
      finishedAt: '2026-10-12',
      reason: ' 执行完毕 ',
      basisNote: ' 经核实文书 ',
      basisContentVersionIds: [],
    });
    expect(wrapper.emitted('changed')).toEqual([[result]]);
    expect(wrapper.emitted('pending-change')?.at(-1)).toEqual([null]);
    expect(control(wrapper, 'success').text()).toContain('已登记');
    wrapper.unmount();
  });
  it('canceling review or editing inputs requires a fresh confirmation', async () => {
    const wrapper = panel();
    await fill(wrapper);
    await control(wrapper, 'review').trigger('click');
    await control(wrapper, 'cancel').trigger('click');
    expect(api.submitFinish).not.toHaveBeenCalled();
    await control(wrapper, 'review').trigger('click');
    await control(wrapper, 'reason').setValue('法院终结执行');
    expect(wrapper.find('[data-test="execution-finish-submit"]').exists()).toBe(
      false,
    );
    wrapper.unmount();
  });
  it('uses explicitly selected exact existing versions and null for absent note', async () => {
    api.listBasisFiles.mockResolvedValue([
      file,
      { ...file, contentVersionId: 'version-2' },
    ]);
    const wrapper = panel();
    await fill(wrapper, '');
    expect(disabled(wrapper, 'review')).toBe(true);
    const choices = wrapper.findAll('[data-test="execution-finish-choice"]');
    await choices[1]!.setValue(true);
    await choices[0]!.setValue(true);
    await submit(wrapper);
    expect(api.submitFinish.mock.calls[0]?.[1]).toMatchObject({
      basisNote: null,
      basisContentVersionIds: ['version-2', 'version-1'],
    });
    wrapper.unmount();
  });
  it('uploads actual File bytes through the injected callback and selects returned version', async () => {
    const wrapper = panel();
    await fill(wrapper, '');
    await upload(wrapper);
    expect(api.uploadBasisFile).toHaveBeenCalledWith(
      'case-1',
      expect.any(File),
    );
    await submit(wrapper);
    expect(api.submitFinish.mock.calls[0]?.[1]).toMatchObject({
      basisNote: null,
      basisContentVersionIds: ['version-1'],
    });
    wrapper.unmount();
  });
  it('limits selection to ten versions', async () => {
    api.listBasisFiles.mockResolvedValue(
      Array.from({ length: 11 }, (_, index) => ({
        ...file,
        contentVersionId: `version-${index}`,
      })),
    );
    const wrapper = panel();
    await fill(wrapper, '');
    const choices = wrapper.findAll('[data-test="execution-finish-choice"]');
    for (const choice of choices.slice(0, 10)) await choice.setValue(true);
    expect((choices[10]!.element as HTMLInputElement).disabled).toBe(true);
    await submit(wrapper);
    expect(
      api.submitFinish.mock.calls[0]?.[1].basisContentVersionIds,
    ).toHaveLength(10);
    wrapper.unmount();
  });
  it('accepts both note and actual attachment and preserves both in the request', async () => {
    const wrapper = panel();
    await fill(wrapper, '核实说明');
    await upload(wrapper);
    await submit(wrapper);
    expect(api.submitFinish.mock.calls[0]?.[1]).toMatchObject({
      basisNote: '核实说明',
      basisContentVersionIds: ['version-1'],
    });
    wrapper.unmount();
  });
  it('releases a definite validation rejection for correction without an automatic POST', async () => {
    api.submitFinish.mockRejectedValue(
      new ApiError('invalid', 400, 'VALIDATION_ERROR'),
    );
    const wrapper = panel({ pendingRequest: original });
    await control(wrapper, 'retry').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('pending-change')?.at(-1)).toEqual([null]);
    expect(wrapper.find('[data-test="execution-finish-review"]').exists()).toBe(
      true,
    );
    expect(api.submitFinish).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('changed')).toBeUndefined();
    wrapper.unmount();
  });
  it.each(['listing', 'upload', 'download'])(
    'clears local sensitive views on material %s authorization failure',
    async (action) => {
      const failure = new ApiError('denied', 403, 'FORBIDDEN');
      if (action === 'listing') api.listBasisFiles.mockRejectedValue(failure);
      else api.listBasisFiles.mockResolvedValue([file]);
      api.uploadBasisFile.mockRejectedValue(failure);
      api.downloadBasisFile.mockRejectedValue(failure);
      const wrapper = panel();
      await flushPromises();
      if (action === 'upload') await upload(wrapper);
      if (action === 'download') {
        await wrapper.get('button').trigger('click');
        await flushPromises();
      }
      expect(wrapper.text()).not.toContain(file.originalFilename);
      expect(
        wrapper.find('[data-test="execution-finish-review"]').exists(),
      ).toBe(false);
      expect(wrapper.emitted('refresh')).toHaveLength(1);
      wrapper.unmount();
    },
  );
  it('prevents duplicate clicks while a request is outstanding', async () => {
    const request = deferred<Result>();
    api.submitFinish.mockReturnValue(request.promise);
    const wrapper = panel();
    await fill(wrapper);
    await submit(wrapper);
    await control(wrapper, 'retry').trigger('click');
    expect(api.submitFinish).toHaveBeenCalledTimes(1);
    request.resolve(result);
    await flushPromises();
    expect(wrapper.emitted('changed')).toHaveLength(1);
    wrapper.unmount();
  });
  it.each([
    new Error('connection lost'),
    new ApiError('network', 0, 'NETWORK_ERROR'),
    new ApiError('timeout', 0, 'TIMEOUT'),
    new ApiError('server', 503, 'SERVER_ERROR'),
    new ApiError('bad receipt', 200, 'INVALID_RESPONSE'),
  ])(
    'keeps exact original input for explicit retries on unknown results: %s',
    async (failure) => {
      api.submitFinish
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce(result);
      const wrapper = panel({ pendingRequest: original });
      await control(wrapper, 'retry').trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('结果暂时未知');
      expect(wrapper.find('[data-test="execution-finish-date"]').exists()).toBe(
        false,
      );
      await control(wrapper, 'retry').trigger('click');
      await flushPromises();
      expect(api.submitFinish.mock.calls).toEqual([
        ['case-1', original],
        ['case-1', original],
      ]);
      expect(wrapper.emitted('changed')).toEqual([[result]]);
      wrapper.unmount();
    },
  );
  it('keeps pending input on same-context refresh to an already finished case and does not claim its fact as success', async () => {
    const wrapper = panel({ pendingRequest: original });
    await wrapper.setProps({
      item: {
        ...item,
        version: 11,
        stage: 'WAITING_ARCHIVE',
        canFinishExecution: false,
        executionFinish: {
          id: 'other-finish',
          filingId: 'filing-1',
          finishedAt: '2026-10-11',
          reason: '其他办理人登记',
          basisNote: null,
          recordedAt: '2026-10-13T02:00:00Z',
          files: [file],
        },
      },
    });
    expect(control(wrapper, 'pending-summary').text()).toContain('2026-10-12');
    expect(control(wrapper, 'fact').text()).toContain('2026-10-11');
    expect(wrapper.emitted('changed')).toBeUndefined();
    await control(wrapper, 'refresh').trigger('click');
    expect(wrapper.emitted('refresh')).toHaveLength(1);
    expect(wrapper.emitted('pending-change')).toBeUndefined();
    expect(api.submitFinish).not.toHaveBeenCalled();
    await control(wrapper, 'retry').trigger('click');
    await flushPromises();
    expect(api.submitFinish).toHaveBeenCalledWith('case-1', original);
    wrapper.unmount();
  });
  it('retains snapshot for parent on unmount and restores it on remount', async () => {
    api.submitFinish.mockRejectedValueOnce(
      new ApiError('timeout', 0, 'TIMEOUT'),
    );
    const pendingChanged = vi.fn();
    const first = panel({ 'onPending-change': pendingChanged });
    await fill(first);
    await submit(first);
    const snapshot = api.submitFinish.mock.calls[0]![1];
    first.unmount();
    expect(pendingChanged.mock.calls).toEqual([[snapshot]]);
    const second = panel({
      pendingRequest: snapshot,
      item: {
        ...item,
        stage: 'WAITING_ARCHIVE',
        canFinishExecution: false,
        version: 11,
      },
    });
    expect(second.find('[data-test="execution-finish-retry"]').exists()).toBe(
      true,
    );
    await control(second, 'retry').trigger('click');
    await flushPromises();
    expect(api.submitFinish.mock.calls[1]).toEqual(['case-1', snapshot]);
    second.unmount();
  });
  it.each([401, 403])(
    'clears sensitive pending input and refreshes on %s rejection',
    async (status) => {
      api.submitFinish.mockRejectedValue(
        new ApiError('denied', status, 'FORBIDDEN'),
      );
      const wrapper = panel({ pendingRequest: original });
      await control(wrapper, 'retry').trigger('click');
      await flushPromises();
      expect(wrapper.text()).not.toContain(original.reason);
      expect(
        wrapper.find('[data-test="execution-finish-retry"]').exists(),
      ).toBe(false);
      expect(wrapper.emitted('pending-change')?.at(-1)).toEqual([null]);
      expect(wrapper.emitted('refresh')).toHaveLength(1);
      wrapper.unmount();
    },
  );
  it.each(['VERSION_CONFLICT', 'INVALID_STATE', 'IDEMPOTENCY_CONFLICT'])(
    'reports explicit conflict %s and does not automatically swap the key',
    async (code) => {
      api.submitFinish.mockRejectedValue(new ApiError('conflict', 409, code));
      const wrapper = panel({ pendingRequest: original });
      await control(wrapper, 'retry').trigger('click');
      await flushPromises();
      expect(wrapper.emitted('pending-change')?.at(-1)).toEqual([null]);
      expect(wrapper.emitted('refresh')).toHaveLength(1);
      expect(api.submitFinish).toHaveBeenCalledTimes(1);
      expect(wrapper.text()).toContain('刷新核对');
      wrapper.unmount();
    },
  );
  it('clears pending state on a new case, identity or authorization revision', async () => {
    for (const change of [
      { item: { ...item, id: 'case-2' } },
      { contextKey: 'INTERNAL:user-2:dept-1:rev-1' },
      { contextKey: 'INTERNAL:user-1:dept-1:rev-2' },
    ]) {
      const wrapper = panel({ pendingRequest: original });
      await wrapper.setProps(change);
      expect(
        wrapper.find('[data-test="execution-finish-retry"]').exists(),
      ).toBe(false);
      expect(wrapper.text()).not.toContain(original.reason);
      expect(wrapper.emitted('pending-change')?.at(-1)).toEqual([null]);
      wrapper.unmount();
    }
  });
  it('clears editable draft when capability changes and preserves unknown request for explicit reauthorization', async () => {
    const wrapper = panel();
    await fill(wrapper);
    await wrapper.setProps({ item: { ...item, canFinishExecution: false } });
    expect(wrapper.find('[data-test="execution-finish-reason"]').exists()).toBe(
      false,
    );
    await wrapper.setProps({ item: { ...item } });
    expect(
      (control(wrapper, 'reason').element as HTMLTextAreaElement).value,
    ).toBe('');
    await wrapper.setProps({
      pendingRequest: original,
      item: { ...item, canFinishExecution: false },
    });
    expect(wrapper.find('[data-test="execution-finish-retry"]').exists()).toBe(
      true,
    );
    wrapper.unmount();
  });
  it.each(['case', 'identity', 'permission', 'unmount'])(
    'ignores a late POST success after %s changes',
    async (change) => {
      const request = deferred<Result>();
      api.submitFinish.mockReturnValue(request.promise);
      const wrapper = panel({ pendingRequest: original });
      await control(wrapper, 'retry').trigger('click');
      if (change === 'case')
        await wrapper.setProps({ item: { ...item, id: 'case-2' } });
      if (change === 'identity')
        await wrapper.setProps({ contextKey: 'LAWYER:user-2:dept-1:rev-1' });
      if (change === 'permission')
        await wrapper.setProps({
          item: { ...item, canFinishExecution: false },
        });
      if (change === 'unmount') wrapper.unmount();
      request.resolve(result);
      await flushPromises();
      expect(wrapper.emitted('changed')).toBeUndefined();
      if (change !== 'unmount') wrapper.unmount();
    },
  );
  it('ignores late material listing and upload from previous case', async () => {
    const listing = deferred<CaseFile[]>();
    const uploading = deferred<CaseFile>();
    api.listBasisFiles
      .mockReturnValueOnce(listing.promise)
      .mockResolvedValue([]);
    api.uploadBasisFile.mockReturnValue(uploading.promise);
    const wrapper = panel();
    await upload(wrapper);
    await wrapper.setProps({ item: { ...item, id: 'case-2' } });
    listing.resolve([file]);
    uploading.resolve(file);
    await flushPromises();
    expect(wrapper.text()).not.toContain(file.originalFilename);
    expect(api.submitFinish).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('does not overwrite an uploaded version with a late earlier listing', async () => {
    const listing = deferred<CaseFile[]>();
    api.listBasisFiles.mockReturnValue(listing.promise);
    const wrapper = panel();
    await upload(wrapper);
    listing.resolve([]);
    await flushPromises();
    expect(wrapper.text()).toContain(file.originalFilename);
    wrapper.unmount();
  });
  it('shows material load and upload failures without inventing files or disabling note-based submission', async () => {
    api.listBasisFiles.mockRejectedValue(new Error('list failure'));
    api.uploadBasisFile.mockRejectedValue(new Error('upload failure'));
    const wrapper = panel();
    await fill(wrapper);
    expect(wrapper.text()).toContain('加载失败');
    expect(disabled(wrapper, 'review')).toBe(false);
    await upload(wrapper);
    expect(wrapper.text()).toContain('上传失败');
    expect(wrapper.text()).not.toContain(file.originalFilename);
    wrapper.unmount();
  });
  it.each(['case', 'identity', 'permission', 'unmount'])(
    'downloads the frozen original version and aborts on %s change',
    async (change) => {
      const download = deferred<void>();
      api.downloadBasisFile.mockReturnValue(download.promise);
      const wrapper = panel({
        item: {
          ...item,
          stage: 'WAITING_ARCHIVE',
          canFinishExecution: false,
          executionFinish: {
            id: 'finish-1',
            filingId: 'filing-1',
            finishedAt: '2026-10-12',
            recordedAt: '2026-10-13T01:00:00Z',
            reason: '法院终结执行',
            basisNote: '原版文书',
            files: [file],
          },
        },
      });
      expect(wrapper.text()).toContain('法院终结执行');
      expect(wrapper.text()).toContain('原版文书');
      await wrapper.get('button').trigger('click');
      const signal = api.downloadBasisFile.mock.calls[0]![2];
      expect(api.downloadBasisFile.mock.calls[0]).toEqual([
        'case-1',
        file,
        signal,
      ]);
      expect(signal.aborted).toBe(false);
      if (change === 'case')
        await wrapper.setProps({ item: { ...item, id: 'case-2' } });
      if (change === 'identity')
        await wrapper.setProps({ contextKey: 'LAWYER:user-2:dept-1:rev-1' });
      if (change === 'permission')
        await wrapper.setProps({
          item: { ...wrapper.props('item'), version: 11 },
        });
      if (change === 'unmount') wrapper.unmount();
      expect(signal.aborted).toBe(true);
      download.reject(new Error('cancelled'));
      await flushPromises();
      expect(wrapper.text()).not.toContain('下载失败');
      if (change !== 'unmount') wrapper.unmount();
    },
  );
});
