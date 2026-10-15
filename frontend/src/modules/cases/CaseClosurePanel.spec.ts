import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import type { CaseFile } from '../../api/cases';
import CaseClosurePanel from './CaseClosurePanel.vue';

vi.mock('../../api/cases', async (original) => ({
  ...(await original<typeof import('../../api/cases')>()),
  todayShanghai: () => '2026-10-13',
}));
type Props = InstanceType<typeof CaseClosurePanel>['$props'];
type Pending = NonNullable<Props['pendingRequest']>;
type Result = Awaited<ReturnType<Props['recordClosure']>>;
type Version = NonNullable<Props['item']['closure']>['current'];
const file: CaseFile = {
  materialId: 'material-1',
  contentVersionId: 'version-1',
  originalFilename: '结案证明.pdf',
  mimeType: 'application/pdf',
};
const item: Props['item'] = {
  id: 'case-1',
  stage: 'WAITING_ARCHIVE',
  version: 10,
  canRecordClosure: true,
  canCorrectClosure: false,
  executionFinish: { id: 'finish-1' },
  closure: null,
};
const result: Result = {
  id: 'case-1',
  closureId: 'closure-1',
  closureVersionId: 'closure-version-1',
  finishId: 'finish-1',
  stage: 'WAITING_ARCHIVE',
  version: 11,
  recordedAt: '2026-10-13T01:00:00Z',
};
const original: Pending = {
  command: 'RECORD',
  input: {
    expectedVersion: 10,
    idempotencyKey: 'original-key',
    expectedFinishId: 'finish-1',
    closeAt: null,
    closeAmountState: 'PENDING',
    closeAmt: null,
    note: ' 原始说明 ',
    closeContentVersionIds: ['version-2', 'version-1'],
  },
};
const corrected: Pending = {
  command: 'CORRECT',
  input: {
    ...original.input,
    expectedClosureVersionId: 'closure-version-1',
    correctionReason: ' 核实原记录 ',
  },
};
const version: Version = {
  id: 'closure-version-1',
  kind: 'REGISTER',
  priorVersionId: null,
  finishId: 'finish-1',
  fromVersion: 10,
  toVersion: 11,
  closeAt: null,
  closeAmountState: 'KNOWN',
  closeAmt: '0.00',
  note: '原说明',
  correctionReason: null,
  recordedByUserId: 'user-1',
  recordedAt: result.recordedAt,
  files: [file],
};
function closed(
  current: Version = version,
  history: Version[] = [version],
): Props['item'] {
  return {
    ...item,
    version: current.toVersion,
    canRecordClosure: false,
    canCorrectClosure: true,
    closure: { id: 'closure-1', finishId: 'finish-1', current, history },
  };
}
const api = {
  recordClosure: vi.fn<Props['recordClosure']>(),
  correctClosure: vi.fn<Props['correctClosure']>(),
  listClosureFiles: vi.fn<Props['listClosureFiles']>(),
  uploadClosureFile: vi.fn<Props['uploadClosureFile']>(),
  downloadClosureFile: vi.fn<Props['downloadClosureFile']>(),
};
beforeEach(() => {
  vi.resetAllMocks();
  api.recordClosure.mockResolvedValue(result);
  api.correctClosure.mockResolvedValue({
    ...result,
    closureVersionId: 'closure-version-2',
    version: 12,
  });
  api.listClosureFiles.mockResolvedValue([]);
  api.uploadClosureFile.mockResolvedValue(file);
  api.downloadClosureFile.mockResolvedValue();
});
function panel(extra: Partial<Props> = {}) {
  return mount(CaseClosurePanel, {
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
  return wrapper.get(`[data-test="closure-${name}"]`);
}
function exists(wrapper: Panel, name: string) {
  return wrapper.find(`[data-test="closure-${name}"]`).exists();
}
function disabled(wrapper: Panel, name = 'submit') {
  return (control(wrapper, name).element as HTMLButtonElement).disabled;
}
async function submit(wrapper: Panel, name = 'submit') {
  await control(wrapper, name).trigger('click');
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
      new File(['real bytes'], '结案证明.pdf', { type: 'application/pdf' }),
    ],
  });
  await input.trigger('change');
  await flushPromises();
}
describe('injected closure panel', () => {
  it('opens correction for a real closure following an external WAITING_ARCHIVE root without inventing a finish', async () => {
    const source = structuredClone(closed());
    source.origin = { kind: 'EXTERNAL_ENTRY', initialStage: 'WAITING_ARCHIVE' };
    source.executionFinish = null;
    source.closure!.finishId = null;
    source.closure!.current.finishId = null;
    const wrapper = panel({ item: source, editOnly: true, editRequest: 1 });
    await control(wrapper, 'reason').setValue('核对外部接办后的真实结案资料');
    await control(wrapper, 'note').setValue('真实更正');
    await submit(wrapper);
    expect(api.correctClosure).toHaveBeenCalledWith(
      source.id,
      expect.objectContaining({
        expectedFinishId: null,
        expectedClosureVersionId: version.id,
        note: '真实更正',
      }),
    );
    expect(api.recordClosure).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('opens a section edit with saved values, cancels without a write, and only calls correction on save', async () => {
    const source = closed();
    const wrapper = panel({ item: source, editOnly: true, editRequest: 1 });
    await flushPromises();
    expect(control(wrapper, 'note').element).toHaveProperty(
      'value',
      version.note,
    );
    expect(control(wrapper, 'amount').element).toHaveProperty(
      'value',
      version.closeAmt,
    );
    await control(wrapper, 'note').setValue('取消的草稿');
    await control(wrapper, 'edit-cancel').trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
    expect(api.correctClosure).not.toHaveBeenCalled();
    await wrapper.setProps({ editRequest: 2 });
    expect(control(wrapper, 'note').element).toHaveProperty(
      'value',
      version.note,
    );
    await control(wrapper, 'note').setValue('核对后的说明');
    await control(wrapper, 'reason').setValue('核对原登记资料');
    await submit(wrapper);
    expect(api.recordClosure).not.toHaveBeenCalled();
    expect(api.correctClosure).toHaveBeenCalledWith(
      source.id,
      expect.objectContaining({
        expectedVersion: source.version,
        expectedClosureVersionId: version.id,
        closeAt: version.closeAt,
        closeAmountState: version.closeAmountState,
        closeAmt: version.closeAmt,
        note: '核对后的说明',
        closeContentVersionIds: [file.contentVersionId],
      }),
    );
    expect(source.stage).toBe('WAITING_ARCHIVE');
    wrapper.unmount();
  });
  it('keeps exact closure history and files readable after archive with no editing', async () => {
    const wrapper = panel({
      item: { ...closed(), stage: 'ARCHIVED', canCorrectClosure: false },
    });
    await flushPromises();
    expect(control(wrapper, 'current').text()).toContain(file.originalFilename);
    expect(control(wrapper, 'history').text()).toContain(file.originalFilename);
    expect(exists(wrapper, 'form')).toBe(false);
    expect(exists(wrapper, 'correct')).toBe(false);
    await control(wrapper, 'history').get('button').trigger('click');
    await flushPromises();
    expect(api.downloadClosureFile).toHaveBeenCalledWith(
      item.id,
      file,
      expect.any(AbortSignal),
    );
    expect(api.recordClosure).not.toHaveBeenCalled();
    expect(api.correctClosure).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it.each([
    { canRecordClosure: false },
    { stage: 'ARCHIVED' },
    { executionFinish: null },
  ])(
    'hides the normal form without valid capability and source: %j',
    async (change) => {
      const wrapper = panel({ item: { ...item, ...change } });
      await flushPromises();
      expect(exists(wrapper, 'form')).toBe(false);
      expect(api.listClosureFiles).not.toHaveBeenCalled();
      wrapper.unmount();
    },
  );
  it.each([false, true])(
    'saves directly with unknown date, pending amount and no attachment for lawyer=%s',
    async (lawyer) => {
      const wrapper = panel({ lawyer });
      await flushPromises();
      expect((control(wrapper, 'date').element as HTMLInputElement).value).toBe(
        '',
      );
      expect(exists(wrapper, 'amount')).toBe(false);
      await submit(wrapper);
      expect(api.recordClosure).toHaveBeenCalledTimes(1);
      expect(api.recordClosure.mock.calls[0]).toEqual([
        'case-1',
        {
          expectedVersion: 10,
          expectedFinishId: 'finish-1',
          idempotencyKey: expect.any(String),
          closeAt: null,
          closeAmountState: 'PENDING',
          closeAmt: null,
          note: null,
          closeContentVersionIds: [],
        },
      ]);
      expect(wrapper.emitted('changed')).toEqual([[result]]);
      expect(wrapper.text()).toContain('仍为待归档');
      expect(wrapper.text()).toContain('实收：未登记');
      wrapper.unmount();
    },
  );
  it('records closure for a direct WAITING_ARCHIVE entry without a fake finish ID', async () => {
    const wrapper = panel({
      item: {
        ...item,
        executionFinish: null,
        origin: { kind: 'EXTERNAL_ENTRY', initialStage: 'WAITING_ARCHIVE' },
      },
    });
    await flushPromises();
    await submit(wrapper);
    expect(api.recordClosure).toHaveBeenCalledWith(
      'case-1',
      expect.objectContaining({
        expectedFinishId: null,
        closeAmountState: 'PENDING',
        closeAmt: null,
      }),
    );
    wrapper.unmount();
  });
  it('preserves a real zero, business date and raw note without silently trimming', async () => {
    const wrapper = panel();
    await flushPromises();
    await control(wrapper, 'amount-state').setValue('KNOWN');
    expect(disabled(wrapper)).toBe(true);
    await control(wrapper, 'amount').setValue('0.00');
    await control(wrapper, 'date').setValue('2026-10-12');
    await control(wrapper, 'note').setValue(' 已核实 ');
    await submit(wrapper);
    expect(api.recordClosure.mock.calls[0]?.[1]).toMatchObject({
      closeAt: '2026-10-12',
      closeAmountState: 'KNOWN',
      closeAmt: '0.00',
      note: ' 已核实 ',
    });
    wrapper.unmount();
  });
  it.each(['-1', '1.234', '100000000000000', '1e3', ' ', 'NaN'])(
    'rejects invalid known amount %s',
    async (amount) => {
      const wrapper = panel();
      await control(wrapper, 'amount-state').setValue('KNOWN');
      await control(wrapper, 'amount').setValue(amount);
      expect(disabled(wrapper)).toBe(true);
      await submit(wrapper);
      expect(api.recordClosure).not.toHaveBeenCalled();
      wrapper.unmount();
    },
  );
  it('clears a previously known draft amount to null when state becomes pending', async () => {
    const wrapper = panel();
    await control(wrapper, 'amount-state').setValue('KNOWN');
    await control(wrapper, 'amount').setValue('23.40');
    await control(wrapper, 'amount-state').setValue('PENDING');
    await submit(wrapper);
    expect(api.recordClosure.mock.calls[0]?.[1].closeAmt).toBeNull();
    wrapper.unmount();
  });
  it('rejects future dates and whitespace-only notes, but adds no earlier-date gate', async () => {
    const wrapper = panel();
    await control(wrapper, 'date').setValue('2026-10-14');
    expect(disabled(wrapper)).toBe(true);
    await control(wrapper, 'date').setValue('2000-01-01');
    await control(wrapper, 'note').setValue('  ');
    expect(disabled(wrapper)).toBe(true);
    await control(wrapper, 'note').setValue('');
    expect(disabled(wrapper)).toBe(false);
    wrapper.unmount();
  });
  it('loads the complete current version for correction and requires the raw reason', async () => {
    const wrapper = panel({ item: closed() });
    await control(wrapper, 'correct').trigger('click');
    await flushPromises();
    expect((control(wrapper, 'amount').element as HTMLInputElement).value).toBe(
      '0.00',
    );
    expect(
      (control(wrapper, 'note').element as HTMLTextAreaElement).value,
    ).toBe('原说明');
    expect(disabled(wrapper)).toBe(true);
    await control(wrapper, 'reason').setValue('  ');
    expect(disabled(wrapper)).toBe(true);
    await control(wrapper, 'reason').setValue(' 更正日期 ');
    await control(wrapper, 'date').setValue('2026-10-12');
    await submit(wrapper);
    expect(api.correctClosure.mock.calls[0]?.[1]).toMatchObject({
      expectedVersion: 11,
      expectedFinishId: 'finish-1',
      expectedClosureVersionId: version.id,
      closeAt: '2026-10-12',
      closeAmt: '0.00',
      note: '原说明',
      correctionReason: ' 更正日期 ',
      closeContentVersionIds: [file.contentVersionId],
    });
    expect(api.recordClosure).not.toHaveBeenCalled();
    expect(wrapper.emitted('changed')).toHaveLength(1);
    wrapper.unmount();
  });
  it('keeps history and exact old files visible read-only, excludes internal reason for a lawyer', async () => {
    const current: Version = {
      ...version,
      id: 'closure-version-2',
      kind: 'CORRECT',
      priorVersionId: version.id,
      fromVersion: 11,
      toVersion: 12,
      closeAmountState: 'PENDING',
      closeAmt: null,
      note: '新说明',
      correctionReason: '内部更正原因',
      files: [],
    };
    const wrapper = panel({
      item: closed(current, [version, current]),
      lawyer: true,
    });
    expect(exists(wrapper, 'correct')).toBe(false);
    expect(exists(wrapper, 'form')).toBe(false);
    expect(wrapper.text()).toContain('0.00');
    expect(wrapper.text()).toContain('待定');
    expect(wrapper.text()).toContain('原说明');
    expect(wrapper.text()).not.toContain('内部更正原因');
    await control(wrapper, 'history').get('button').trigger('click');
    await flushPromises();
    expect(api.downloadClosureFile.mock.calls[0]?.slice(0, 2)).toEqual([
      'case-1',
      file,
    ]);
    wrapper.unmount();
  });
  it('selects exact uploaded files and does not let a late list erase them', async () => {
    const listing = deferred<CaseFile[]>();
    api.listClosureFiles.mockReturnValue(listing.promise);
    const wrapper = panel();
    await upload(wrapper);
    listing.resolve([]);
    await flushPromises();
    expect(wrapper.text()).toContain(file.originalFilename);
    await submit(wrapper);
    expect(api.recordClosure.mock.calls[0]?.[1].closeContentVersionIds).toEqual(
      [file.contentVersionId],
    );
    wrapper.unmount();
  });
  it('allows only one version per material and at most ten selected files', async () => {
    const files = Array.from({ length: 11 }, (_, index) => ({
      ...file,
      materialId: `material-${index}`,
      contentVersionId: `version-${index}`,
    }));
    api.listClosureFiles.mockResolvedValue([
      ...files,
      { ...files[0]!, contentVersionId: 'new-version' },
    ]);
    const wrapper = panel();
    await flushPromises();
    const choices = wrapper.findAll('[data-test="closure-choice"]');
    await choices[0]!.setValue(true);
    await choices[11]!.setValue(true);
    expect((choices[0]!.element as HTMLInputElement).checked).toBe(false);
    for (const choice of choices.slice(1, 10)) await choice.setValue(true);
    expect((choices[10]!.element as HTMLInputElement).disabled).toBe(true);
    await submit(wrapper);
    expect(
      api.recordClosure.mock.calls[0]?.[1].closeContentVersionIds,
    ).toHaveLength(10);
    wrapper.unmount();
  });
  it('blocks duplicate clicks until the command settles', async () => {
    const request = deferred<Result>();
    api.recordClosure.mockReturnValue(request.promise);
    const wrapper = panel();
    await submit(wrapper);
    await submit(wrapper, 'retry');
    expect(api.recordClosure).toHaveBeenCalledTimes(1);
    request.resolve(result);
    await flushPromises();
    expect(wrapper.emitted('changed')).toHaveLength(1);
    wrapper.unmount();
  });
  it.each([
    new Error('lost'),
    new ApiError('network', 0, 'NETWORK_ERROR'),
    new ApiError('timeout', 0, 'TIMEOUT'),
    new ApiError('bad receipt', 200, 'INVALID_RESPONSE'),
    new ApiError('server', 503, 'SERVER_ERROR'),
  ])(
    'retains exact original request for explicit retry after %s',
    async (failure) => {
      api.recordClosure
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce(result);
      const wrapper = panel({ pendingRequest: original });
      await submit(wrapper, 'retry');
      expect(wrapper.text()).toContain('结果暂时未知');
      expect(api.recordClosure).toHaveBeenCalledTimes(1);
      await control(wrapper, 'refresh').trigger('click');
      expect(wrapper.emitted('refresh')).toHaveLength(1);
      expect(api.recordClosure).toHaveBeenCalledTimes(1);
      await wrapper.setProps({ item: closed(), pendingRequest: null });
      expect(exists(wrapper, 'retry')).toBe(true);
      expect(wrapper.emitted('changed')).toBeUndefined();
      await submit(wrapper, 'retry');
      expect(api.recordClosure.mock.calls).toEqual([
        ['case-1', original.input],
        ['case-1', original.input],
      ]);
      expect(wrapper.emitted('changed')).toEqual([[result]]);
      wrapper.unmount();
    },
  );
  it('restores the exact correction command on remount even when current capability is false', async () => {
    api.correctClosure.mockRejectedValueOnce(
      new ApiError('timeout', 0, 'TIMEOUT'),
    );
    const first = panel({ pendingRequest: corrected, item: closed() });
    await submit(first, 'retry');
    const snapshot = first.emitted('pending-change')![0]![0] as Pending;
    first.unmount();
    const second = panel({
      pendingRequest: snapshot,
      item: { ...closed(), canCorrectClosure: false },
    });
    expect(api.correctClosure).toHaveBeenCalledTimes(1);
    await submit(second, 'retry');
    expect(api.correctClosure.mock.calls).toEqual([
      ['case-1', corrected.input],
      ['case-1', corrected.input],
    ]);
    expect(api.recordClosure).not.toHaveBeenCalled();
    second.unmount();
  });
  it.each([401, 403])(
    'clears sensitive form, pending request and history on %s',
    async (status) => {
      api.correctClosure.mockRejectedValue(
        new ApiError('denied', status, 'ACTION_FORBIDDEN'),
      );
      const wrapper = panel({ pendingRequest: corrected, item: closed() });
      await submit(wrapper, 'retry');
      expect(wrapper.text()).not.toContain('原说明');
      expect(wrapper.text()).not.toContain('核实原记录');
      expect(wrapper.text()).not.toContain(file.originalFilename);
      expect(exists(wrapper, 'retry')).toBe(false);
      expect(wrapper.emitted('pending-change')?.at(-1)).toEqual([null]);
      expect(wrapper.emitted('refresh')).toHaveLength(1);
      wrapper.unmount();
    },
  );
  it.each(['VERSION_CONFLICT', 'INVALID_STATE', 'IDEMPOTENCY_CONFLICT'])(
    'reports %s without changing keys or submitting again',
    async (code) => {
      api.recordClosure.mockRejectedValue(new ApiError('conflict', 409, code));
      const wrapper = panel({ pendingRequest: original });
      await submit(wrapper, 'retry');
      expect(api.recordClosure).toHaveBeenCalledTimes(1);
      expect(wrapper.emitted('pending-change')?.at(-1)).toEqual([null]);
      expect(wrapper.emitted('refresh')).toHaveLength(1);
      expect(exists(wrapper, 'form')).toBe(false);
      wrapper.unmount();
    },
  );
  it('allows manual correction after definite validation failure', async () => {
    api.recordClosure.mockRejectedValue(
      new ApiError('invalid', 400, 'VALIDATION_ERROR'),
    );
    const wrapper = panel();
    await submit(wrapper);
    expect(exists(wrapper, 'form')).toBe(true);
    expect(api.recordClosure).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('changed')).toBeUndefined();
    wrapper.unmount();
  });
  it.each(['VERSION_CONFLICT', 'INVALID_STATE', 'IDEMPOTENCY_CONFLICT'])(
    'allows a new manual intention after a trusted same-value refresh resolves %s',
    async (code) => {
      api.recordClosure.mockRejectedValueOnce(
        new ApiError('conflict', 409, code),
      );
      const wrapper = panel({ pendingRequest: original });
      await submit(wrapper, 'retry');
      expect(exists(wrapper, 'form')).toBe(false);
      await wrapper.setProps({ pendingRequest: null, item: { ...item } });
      await flushPromises();
      expect(exists(wrapper, 'form')).toBe(true);
      expect(api.recordClosure).toHaveBeenCalledTimes(1);
      expect(exists(wrapper, 'retry')).toBe(false);
      await control(wrapper, 'note').setValue('刷新核对后的新意图');
      await submit(wrapper);
      expect(api.recordClosure).toHaveBeenCalledTimes(2);
      const next = api.recordClosure.mock.calls[1]![1];
      expect(next.note).toBe('刷新核对后的新意图');
      expect(next.idempotencyKey).not.toBe(original.input.idempotencyKey);
      expect(wrapper.emitted('changed')).toEqual([[result]]);
      wrapper.unmount();
    },
  );
  it.each(['case', 'identity', 'department', 'authorization', 'unmount'])(
    'isolates late POST responses and clears sensitive data on %s changes',
    async (change) => {
      const request = deferred<Result>();
      api.correctClosure.mockReturnValue(request.promise);
      const wrapper = panel({ item: closed(), pendingRequest: corrected });
      await submit(wrapper, 'retry');
      if (change === 'case')
        await wrapper.setProps({ item: { ...item, id: 'case-2' } });
      if (change === 'identity')
        await wrapper.setProps({ contextKey: 'INTERNAL:user-2:dept-1:rev-1' });
      if (change === 'department')
        await wrapper.setProps({ contextKey: 'INTERNAL:user-1:dept-2:rev-1' });
      if (change === 'authorization')
        await wrapper.setProps({ contextKey: 'INTERNAL:user-1:dept-1:rev-2' });
      if (change === 'unmount') wrapper.unmount();
      request.resolve(result);
      await flushPromises();
      expect(wrapper.emitted('changed')).toBeUndefined();
      if (change !== 'unmount') {
        expect(wrapper.text()).not.toContain('原说明');
        expect(wrapper.text()).not.toContain('核实原记录');
        expect(wrapper.text()).not.toContain(file.originalFilename);
        expect(wrapper.emitted('pending-change')?.at(-1)).toEqual([null]);
        wrapper.unmount();
      }
    },
  );
  it('isolates late file lists and uploads after switching case', async () => {
    const listing = deferred<CaseFile[]>();
    const uploading = deferred<CaseFile>();
    api.listClosureFiles
      .mockReturnValueOnce(listing.promise)
      .mockResolvedValue([]);
    api.uploadClosureFile.mockReturnValue(uploading.promise);
    const wrapper = panel();
    await upload(wrapper);
    await wrapper.setProps({ item: { ...item, id: 'case-2' } });
    listing.resolve([file]);
    uploading.resolve(file);
    await flushPromises();
    expect(wrapper.text()).not.toContain(file.originalFilename);
    wrapper.unmount();
  });
  it.each(['listing', 'upload', 'download'])(
    'clears sensitive data on material %s denial',
    async (action) => {
      const failure = new ApiError('denied', 403, 'ACTION_FORBIDDEN');
      api.listClosureFiles.mockResolvedValue([file]);
      if (action === 'listing') api.listClosureFiles.mockRejectedValue(failure);
      if (action === 'upload') api.uploadClosureFile.mockRejectedValue(failure);
      if (action === 'download')
        api.downloadClosureFile.mockRejectedValue(failure);
      const wrapper = panel();
      await flushPromises();
      if (action === 'upload') await upload(wrapper);
      if (action === 'download') {
        await wrapper.get('button').trigger('click');
        await flushPromises();
      }
      expect(wrapper.text()).not.toContain(file.originalFilename);
      expect(exists(wrapper, 'form')).toBe(false);
      expect(wrapper.emitted('refresh')).toHaveLength(1);
      wrapper.unmount();
    },
  );
  it('keeps optional attachment failure distinct from command failure', async () => {
    api.listClosureFiles.mockRejectedValue(new Error('list'));
    api.uploadClosureFile.mockRejectedValue(new Error('upload'));
    const wrapper = panel();
    await flushPromises();
    expect(wrapper.text()).toContain('加载失败');
    expect(disabled(wrapper)).toBe(false);
    await upload(wrapper);
    expect(wrapper.text()).toContain('上传失败');
    await submit(wrapper);
    expect(wrapper.emitted('changed')).toEqual([[result]]);
    wrapper.unmount();
  });
  it.each(['identity', 'case', 'unmount'])(
    'cancels exact-version downloads after %s changes',
    async (change) => {
      const download = deferred<void>();
      api.downloadClosureFile.mockReturnValue(download.promise);
      const wrapper = panel({ item: closed(), lawyer: true });
      await control(wrapper, 'current').get('button').trigger('click');
      const signal = api.downloadClosureFile.mock.calls[0]![2];
      expect(signal.aborted).toBe(false);
      if (change === 'identity')
        await wrapper.setProps({ contextKey: 'LAWYER:user-2:dept-1:rev-1' });
      if (change === 'case')
        await wrapper.setProps({ item: { ...item, id: 'case-2' } });
      if (change === 'unmount') wrapper.unmount();
      expect(signal.aborted).toBe(true);
      download.reject(new Error('cancelled'));
      await flushPromises();
      expect(wrapper.text()).not.toContain('下载失败');
      if (change !== 'unmount') wrapper.unmount();
    },
  );
});
