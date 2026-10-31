import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCaseArchiveReadiness } from '../../api/case-archive-readiness';
import { ApiError } from '../../api/http';
import CaseArchivePanel from './CaseArchivePanel.vue';

vi.mock('../../api/case-archive-readiness', async (original) => ({
  ...(await original<typeof import('../../api/case-archive-readiness')>()),
  getCaseArchiveReadiness: vi.fn(),
}));

vi.mock('../../api/cases', async (original) => ({
  ...(await original<typeof import('../../api/cases')>()),
  todayShanghai: () => '2026-10-14',
}));
type Props = InstanceType<typeof CaseArchivePanel>['$props'];
type Pending = NonNullable<Props['pendingRequest']>;
type Result = Awaited<ReturnType<Props['archiveCase']>>;
type Version = NonNullable<Props['item']['archive']>['current'];
const item: Props['item'] = {
  id: 'case-1',
  stage: 'WAITING_ARCHIVE',
  version: 11,
  canArchive: true,
  canCorrectArchive: false,
  closure: { id: 'closure-1', current: { id: 'closure-version-1' } },
  archive: null,
};
const result: Result = {
  id: item.id,
  archiveId: 'archive-1',
  archiveVersionId: 'archive-version-1',
  closureId: 'closure-1',
  closureVersionId: 'closure-version-1',
  stage: 'ARCHIVED',
  version: 12,
  recordedAt: '2026-10-14T01:00:00Z',
};
const original: Pending = {
  command: 'ARCHIVE',
  input: {
    expectedVersion: 11,
    idempotencyKey: 'original-key',
    expectedClosureVersionId: 'closure-version-1',
    archiveAt: '2026-10-13',
    archiveType: 'EXECUTION_CLOSED',
    archiveReason: ' 原归档原因\n保留空白 ',
  },
};
const version: Version = {
  id: 'archive-version-1',
  kind: 'ARCHIVE',
  priorVersionId: null,
  closureVersionId: 'closure-version-1',
  fromVersion: 11,
  toVersion: 12,
  archiveAt: '2026-10-13',
  archiveType: 'EXECUTION_CLOSED',
  archiveReason: '原归档原因',
  archiveNote: null,
  correctionReason: null,
  recordedAt: result.recordedAt,
  recordedByUserId: 'operator-1',
};
function archived(current = version, history = [version]): Props['item'] {
  return {
    ...item,
    stage: 'ARCHIVED',
    version: current.toVersion,
    canArchive: false,
    canCorrectArchive: true,
    archive: {
      id: 'archive-1',
      closureId: 'closure-1',
      closureVersionId: 'closure-version-1',
      current,
      history,
    },
  };
}
const api = {
  archiveCase: vi.fn<Props['archiveCase']>(),
  correctArchive: vi.fn<Props['correctArchive']>(),
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCaseArchiveReadiness).mockResolvedValue({
    caseVersion: 11,
    closureVersionId: 'closure-version-1',
    checkedAt: new Date().toISOString(),
    state: 'PASSED',
    checks: {
      payment: { state: 'PASSED', reason: 'CLOSURE_PAYMENT_REACHED' },
      refund: { state: 'PASSED', reason: 'REFUND_EXPLICITLY_NOT_APPLICABLE' },
      customer: { state: 'PASSED', reason: 'CUSTOMER_RECEIPTS_REACHED' },
      lawyer: { state: 'PASSED', reason: 'LAWYER_INVOICES_REACHED' },
    },
  });
  api.archiveCase.mockResolvedValue(result);
  api.correctArchive.mockResolvedValue({
    ...result,
    archiveVersionId: 'archive-version-2',
    version: 13,
  });
});
function panel(extra: Partial<Props> = {}) {
  return mount(CaseArchivePanel, {
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
  return wrapper.get(`[data-test="archive-${name}"]`);
}
function exists(wrapper: Panel, name: string) {
  return wrapper.find(`[data-test="archive-${name}"]`).exists();
}
function disabled(wrapper: Panel) {
  return control(wrapper, 'submit').attributes('disabled') !== undefined;
}
async function fill(wrapper: Panel, type = 'EXECUTION_CLOSED') {
  await flushPromises();
  if (exists(wrapper, 'check')) {
    vi.mocked(getCaseArchiveReadiness).mockResolvedValueOnce({
      ...(await vi.mocked(getCaseArchiveReadiness).getMockImplementation()!(
        'case-1',
      )),
      caseVersion: wrapper.props('item').version,
    });
    await control(wrapper, 'check').trigger('click');
    await flushPromises();
  }
  await control(wrapper, 'date').setValue('2026-10-13');
  await control(wrapper, 'type').setValue(type);
  await control(wrapper, 'reason').setValue(' 原归档原因\n保留空白 ');
}
async function submit(wrapper: Panel) {
  await control(wrapper, 'form').trigger('submit');
  await flushPromises();
}
async function retry(wrapper: Panel) {
  await control(wrapper, 'retry').trigger('click');
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

describe('CaseArchivePanel', () => {
  it('blocks safely when automatic readiness read is denied', async () => {
    vi.mocked(getCaseArchiveReadiness).mockRejectedValueOnce(
      new ApiError('denied', 403, 'ACTION_FORBIDDEN'),
    );
    const wrapper = panel();
    await flushPromises();
    expect(exists(wrapper, 'form')).toBe(false);
    expect(exists(wrapper, 'retry')).toBe(false);
    expect(api.archiveCase).not.toHaveBeenCalled();
    expect(control(wrapper, 'error').text()).toContain('权限已变化');
  });

  it.each(['BLOCKED', 'UNKNOWN'] as const)(
    'prevents archive for %s and renders latest conflict checks',
    async (state) => {
      const wrapper = panel();
      await fill(wrapper);
      const passed = await vi
        .mocked(getCaseArchiveReadiness)
        .getMockImplementation()!('case-1');
      const checks = {
        ...passed.checks,
        customer: { state, reason: 'CUSTOMER_RECEIPTS_INSUFFICIENT' },
      };
      api.archiveCase.mockRejectedValueOnce(
        new ApiError('未满足', 409, 'ARCHIVE_FINANCIAL_NOT_READY', undefined, {
          checks,
        }),
      );
      await submit(wrapper);
      expect(control(wrapper, 'check-customer').text()).toContain(
        '实际客户回款不足',
      );
      expect(disabled(wrapper)).toBe(true);
      expect(exists(wrapper, 'retry')).toBe(false);
      vi.mocked(getCaseArchiveReadiness).mockResolvedValueOnce({
        ...passed,
        state,
        checks,
      });
      await control(wrapper, 'check').trigger('click');
      await flushPromises();
      expect(disabled(wrapper)).toBe(true);
      await submit(wrapper);
      expect(api.archiveCase).toHaveBeenCalledTimes(1);
    },
  );
  it('automatically reads again after the case projection is refreshed', async () => {
    const wrapper = panel();
    await fill(wrapper);
    const passed = await vi
      .mocked(getCaseArchiveReadiness)
      .getMockImplementation()!('case-1');
    const response = deferred<typeof passed>();
    vi.mocked(getCaseArchiveReadiness).mockReturnValueOnce(response.promise);
    await wrapper.setProps({ item: { ...item } });
    expect(disabled(wrapper)).toBe(true);
    expect(getCaseArchiveReadiness).toHaveBeenCalledTimes(3);
    response.resolve(passed);
    await flushPromises();
    expect(disabled(wrapper)).toBe(false);
  });
  it('loads automatically and blocks new archives while the result is unknown', async () => {
    const passed = await vi
      .mocked(getCaseArchiveReadiness)
      .getMockImplementation()!('case-1');
    const response = deferred<typeof passed>();
    vi.mocked(getCaseArchiveReadiness).mockReturnValueOnce(response.promise);
    const wrapper = panel();
    await control(wrapper, 'date').setValue('2026-10-13');
    await control(wrapper, 'type').setValue('EXECUTION_CLOSED');
    await control(wrapper, 'reason').setValue('归档原因');
    expect(getCaseArchiveReadiness).toHaveBeenCalledExactlyOnceWith(
      'case-1',
      false,
    );
    expect(disabled(wrapper)).toBe(true);
    await submit(wrapper);
    expect(api.archiveCase).not.toHaveBeenCalled();
    response.resolve(passed);
    await flushPromises();
    expect(disabled(wrapper)).toBe(false);
    expect(control(wrapper, 'check-customer').text()).toContain(
      '实际客户回款已足额',
    );
  });
  it('blocks unknown results and ignores late checks after identity changes', async () => {
    const response =
      deferred<Awaited<ReturnType<typeof getCaseArchiveReadiness>>>();
    vi.mocked(getCaseArchiveReadiness).mockReturnValue(response.promise);
    const wrapper = panel();
    await control(wrapper, 'check').trigger('click');
    await wrapper.setProps({ contextKey: 'OTHER:user' });
    response.resolve({
      caseVersion: 11,
      closureVersionId: 'closure-version-1',
      checkedAt: new Date().toISOString(),
      state: 'PASSED',
      checks: {
        payment: { state: 'PASSED', reason: 'CLOSURE_PAYMENT_REACHED' },
        refund: { state: 'EXEMPT', reason: 'EXPLICIT_ZERO_CLOSURE_AMOUNT' },
        customer: { state: 'EXEMPT', reason: 'EXPLICIT_ZERO_CLOSURE_AMOUNT' },
        lawyer: { state: 'EXEMPT', reason: 'EXPLICIT_ZERO_CLOSURE_AMOUNT' },
      },
    });
    await flushPromises();
    expect(wrapper.text()).not.toContain('有效付款已达到结案金额');
    expect(api.archiveCase).not.toHaveBeenCalled();
  });

  it('opens a section correction with existing archive fields and cancels without a write', async () => {
    const source = archived();
    const wrapper = panel({ item: source, editOnly: true, editRequest: 1 });
    expect(control(wrapper, 'date').element).toHaveProperty(
      'value',
      version.archiveAt,
    );
    expect(control(wrapper, 'type').element).toHaveProperty(
      'value',
      version.archiveType,
    );
    expect(control(wrapper, 'reason').element).toHaveProperty(
      'value',
      version.archiveReason,
    );
    await control(wrapper, 'reason').setValue('取消的草稿');
    await control(wrapper, 'edit-cancel').trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
    expect(api.correctArchive).not.toHaveBeenCalled();
    await wrapper.setProps({ editRequest: 2 });
    expect(control(wrapper, 'reason').element).toHaveProperty(
      'value',
      version.archiveReason,
    );
    await control(wrapper, 'reason').setValue('核对后的原因');
    await control(wrapper, 'correction-reason').setValue('核对原登记');
    await submit(wrapper);
    expect(api.archiveCase).not.toHaveBeenCalled();
    expect(api.correctArchive).toHaveBeenCalledWith(
      source.id,
      expect.objectContaining({
        expectedVersion: source.version,
        expectedArchiveVersionId: version.id,
        archiveAt: version.archiveAt,
        archiveType: version.archiveType,
        archiveReason: '核对后的原因',
      }),
    );
    expect(source.stage).toBe('ARCHIVED');
    wrapper.unmount();
  });
  it('submits an optional note and displays the saved note in current and history', async () => {
    const wrapper = panel();
    await fill(wrapper);
    await control(wrapper, 'note').setValue('回款材料已核对');
    await submit(wrapper);
    expect(api.archiveCase).toHaveBeenCalledWith(
      item.id,
      expect.objectContaining({ archiveNote: '回款材料已核对' }),
    );
    const noted = { ...version, archiveNote: '回款材料已核对' };
    await wrapper.setProps({ item: archived(noted) });
    expect(wrapper.text()).toContain('归档备注：回款材料已核对');
  });
  it('starts with no default date/type, a single archive action and no finance/files controls', async () => {
    const wrapper = panel();
    expect(control(wrapper, 'date').element).toHaveProperty('value', '');
    expect(control(wrapper, 'type').element).toHaveProperty('value', '');
    expect(disabled(wrapper)).toBe(true);
    expect(wrapper.find('input[type=file]').exists()).toBe(false);
    expect(wrapper.text()).toContain('款项状态以实际记录为准');
    await fill(wrapper);
    await submit(wrapper);
    expect(api.archiveCase).toHaveBeenCalledExactlyOnceWith(item.id, {
      ...original.input,
      idempotencyKey: expect.any(String),
    });
    const input = api.archiveCase.mock.calls[0]![1];
    expect(Object.keys(input).sort()).toEqual(
      Object.keys(original.input).sort(),
    );
    expect(input.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/u);
    expect(wrapper.emitted('changed')).toEqual([[result]]);
    expect(wrapper.emitted('refresh')).toBeUndefined();
    expect(exists(wrapper, 'form')).toBe(false);
  });

  it.each([
    'VOIDED',
    'SETTLEMENT',
    'MEDIATION',
    'JUDGMENT_PERFORMED',
    'EXECUTION_COLLECTED',
    'EXECUTION_CLOSED',
  ])('submits only the selected stable type %s', async (type) => {
    const wrapper = panel();
    expect(
      control(wrapper, 'type')
        .findAll('option')
        .map((option) => option.attributes('value')),
    ).toEqual([
      '',
      'VOIDED',
      'SETTLEMENT',
      'MEDIATION',
      'JUDGMENT_PERFORMED',
      'EXECUTION_COLLECTED',
      'EXECUTION_CLOSED',
    ]);
    await fill(wrapper, type);
    await submit(wrapper);
    expect(api.archiveCase.mock.calls[0]![1].archiveType).toBe(type);
  });

  it('requires a real round-trip business date and bounded nonblank reasons', async () => {
    const wrapper = panel();
    await fill(wrapper);
    for (const date of ['', '2026-02-30', '2026-10-15', '2025-02-29']) {
      await control(wrapper, 'date').setValue(date);
      expect(disabled(wrapper)).toBe(true);
      await submit(wrapper);
    }
    expect(api.archiveCase).not.toHaveBeenCalled();
    await control(wrapper, 'date').setValue('2024-02-29');
    expect(disabled(wrapper)).toBe(false);
    for (const reason of [' \n ', 'a'.repeat(2001)]) {
      await control(wrapper, 'reason').setValue(reason);
      expect(disabled(wrapper)).toBe(true);
    }
    await control(wrapper, 'reason').setValue('a'.repeat(2000));
    expect(disabled(wrapper)).toBe(false);
    await control(wrapper, 'type').setValue('');
    expect(disabled(wrapper)).toBe(true);
  });

  it('lets the current lawyer archive with the same frozen request', async () => {
    const wrapper = panel({ lawyer: true });
    await fill(wrapper);
    await submit(wrapper);
    expect(api.archiveCase).toHaveBeenCalledOnce();
    expect(api.correctArchive).not.toHaveBeenCalled();
  });

  it.each([
    { ...item, canArchive: false },
    { ...item, closure: null },
    { ...item, stage: 'ENFORCING' },
    archived(),
  ])(
    'does not offer a new archive on a readonly or incompatible projection',
    (readonlyItem) => {
      expect(exists(panel({ item: readonlyItem }), 'form')).toBe(false);
      expect(api.archiveCase).not.toHaveBeenCalled();
    },
  );

  it('prefills correction and sends full fields with exact immutable anchors', async () => {
    const wrapper = panel({ item: archived() });
    expect(exists(wrapper, 'form')).toBe(false);
    await control(wrapper, 'correct').trigger('click');
    expect(control(wrapper, 'date').element).toHaveProperty(
      'value',
      version.archiveAt,
    );
    expect(control(wrapper, 'type').element).toHaveProperty(
      'value',
      version.archiveType,
    );
    expect(control(wrapper, 'reason').element).toHaveProperty(
      'value',
      version.archiveReason,
    );
    expect(disabled(wrapper)).toBe(false);
    await control(wrapper, 'correction-reason').setValue('a'.repeat(501));
    expect(disabled(wrapper)).toBe(true);
    await control(wrapper, 'correction-reason').setValue('');
    await control(wrapper, 'date').setValue('2026-10-14');
    await control(wrapper, 'type').setValue('SETTLEMENT');
    await control(wrapper, 'reason').setValue(' 更正后的归档原因 ');
    await submit(wrapper);
    expect(api.correctArchive).toHaveBeenCalledExactlyOnceWith(item.id, {
      expectedVersion: 12,
      idempotencyKey: expect.any(String),
      expectedClosureVersionId: 'closure-version-1',
      expectedArchiveVersionId: 'archive-version-1',
      archiveAt: '2026-10-14',
      archiveType: 'SETTLEMENT',
      archiveReason: ' 更正后的归档原因 ',
      correctionReason: '未填写',
    });
    expect(version.archiveReason).toBe('原归档原因');
    expect(api.archiveCase).not.toHaveBeenCalled();
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });

  it('cancels a correction without a command and clears its sensitive draft', async () => {
    const wrapper = panel({ item: archived() });
    await control(wrapper, 'correct').trigger('click');
    await control(wrapper, 'correction-reason').setValue('本次核对原因');
    await control(wrapper, 'cancel').trigger('click');
    expect(exists(wrapper, 'form')).toBe(false);
    await control(wrapper, 'correct').trigger('click');
    expect(control(wrapper, 'correction-reason').element).toHaveProperty(
      'value',
      '',
    );
    expect(api.correctArchive).not.toHaveBeenCalled();
  });

  it('shows exact current/history and hides internal correction audit for lawyers', () => {
    const corrected: Version = {
      ...version,
      id: 'archive-version-2',
      kind: 'CORRECT',
      priorVersionId: version.id,
      fromVersion: 12,
      toVersion: 13,
      archiveReason: '新归档原因',
      correctionReason: '内部原因',
      recordedByUserId: 'operator-2',
    };
    const currentItem = archived(corrected, [version, corrected]);
    const wrapper = panel({ item: currentItem });
    expect(control(wrapper, 'current').text()).toContain('新归档原因');
    expect(control(wrapper, 'history').findAll('article')).toHaveLength(2);
    expect(control(wrapper, 'history').text()).toContain('原归档原因');
    expect(control(wrapper, 'history').text()).toContain('内部原因');
    expect(control(wrapper, 'history').text()).toContain('closure-version-1');
    const lawyer = panel({ item: currentItem, lawyer: true });
    expect(lawyer.text()).toContain('新归档原因');
    expect(lawyer.text()).not.toContain('内部原因');
    expect(lawyer.text()).not.toContain('operator-2');
    expect(exists(lawyer, 'correct')).toBe(false);
  });

  it.each([
    new Error('network failure'),
    new ApiError('timeout', 0, 'TIMEOUT'),
    new ApiError('decode failure', 200, 'INVALID_RESPONSE'),
    new ApiError('server failure', 503, 'UNAVAILABLE'),
  ])(
    'keeps an unknown command across same-case refresh/null, then explicitly retries its original body',
    async (failure) => {
      api.archiveCase.mockRejectedValueOnce(failure);
      const wrapper = panel();
      await fill(wrapper);
      await submit(wrapper);
      const sent = { ...api.archiveCase.mock.calls[0]![1] };
      expect(control(wrapper, 'error').text()).toContain('结果暂时未知');
      await control(wrapper, 'refresh').trigger('click');
      await wrapper.setProps({
        item: { ...item, version: 12 },
        pendingRequest: null,
      });
      expect(exists(wrapper, 'retry')).toBe(true);
      expect(api.archiveCase).toHaveBeenCalledTimes(1);
      await retry(wrapper);
      expect(api.archiveCase.mock.calls[1]).toEqual([item.id, sent]);
      expect(wrapper.emitted('changed')).toEqual([[result]]);
    },
  );

  it('retries restored original requests after remount, even when a competitor archived the case', async () => {
    const wrapper = panel({ pendingRequest: original, item: archived() });
    expect(api.archiveCase).not.toHaveBeenCalled();
    expect(control(wrapper, 'pending-summary').element.textContent).toContain(
      original.input.archiveReason,
    );
    await retry(wrapper);
    expect(api.archiveCase).toHaveBeenCalledExactlyOnceWith(
      item.id,
      original.input,
    );
  });

  it('shows the exact pending note, including when a correction clears it', async () => {
    const withNote: Pending = {
      command: 'ARCHIVE',
      input: { ...original.input, archiveNote: ' 补充备注 ' },
    };
    const first = panel({ pendingRequest: withNote, item: archived() });
    expect(control(first, 'pending-summary').element.textContent).toContain(
      ' 补充备注 ',
    );
    await retry(first);
    expect(api.archiveCase.mock.calls.at(-1)?.[1]).toEqual(withNote.input);

    const cleared: Pending = {
      command: 'CORRECT',
      input: {
        ...original.input,
        archiveNote: '',
        expectedArchiveVersionId: version.id,
        correctionReason: '更正',
      },
    };
    const second = panel({ pendingRequest: cleared, item: archived() });
    expect(control(second, 'pending-summary').element.textContent).toContain(
      '归档备注 未填写',
    );
    await retry(second);
    expect(api.correctArchive.mock.calls.at(-1)?.[1]).toEqual(cleared.input);
  });

  it('restores and retries an unknown correction using its original archive/closure/version anchors', async () => {
    const correction: Pending = {
      command: 'CORRECT',
      input: {
        ...original.input,
        expectedVersion: 12,
        expectedArchiveVersionId: version.id,
        correctionReason: ' 原更正原因 ',
      },
    };
    const wrapper = panel({ item: archived(), pendingRequest: correction });
    await retry(wrapper);
    expect(api.correctArchive).toHaveBeenCalledExactlyOnceWith(
      item.id,
      correction.input,
    );
  });

  it('locks duplicate submission and copies requests away from parent/callback mutations', async () => {
    const response = deferred<Result>();
    api.archiveCase.mockImplementationOnce((_id, input) => {
      input.archiveReason = 'callback mutation';
      return response.promise;
    });
    const wrapper = panel();
    await fill(wrapper);
    await control(wrapper, 'form').trigger('submit');
    await control(wrapper, 'retry').trigger('click');
    expect(api.archiveCase).toHaveBeenCalledOnce();
    const published =
      wrapper.emitted<[Pending | null]>('pending-change')![0]![0]!;
    published.input.archiveReason = 'parent mutation';
    response.reject(new Error('timeout'));
    await flushPromises();
    expect(control(wrapper, 'pending-summary').element.textContent).toContain(
      original.input.archiveReason,
    );
    await retry(wrapper);
    expect(api.archiveCase.mock.calls[1]![1].archiveReason).toBe(
      original.input.archiveReason,
    );
  });

  it.each(['VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT'])(
    'releases definite 409 %s only for a fresh manual intention after trusted read',
    async (code) => {
      api.archiveCase.mockRejectedValueOnce(
        new ApiError('conflict', 409, code),
      );
      const wrapper = panel();
      await fill(wrapper);
      await submit(wrapper);
      expect(exists(wrapper, 'retry')).toBe(false);
      expect(exists(wrapper, 'form')).toBe(false);
      expect(wrapper.emitted('refresh')).toHaveLength(1);
      await wrapper.setProps({ item: { ...item } });
      expect(exists(wrapper, 'form')).toBe(true);
      expect(control(wrapper, 'date').element).toHaveProperty('value', '');
      expect(api.archiveCase).toHaveBeenCalledOnce();
      await fill(wrapper);
      await submit(wrapper);
      expect(api.archiveCase.mock.calls[1]![1].idempotencyKey).not.toBe(
        api.archiveCase.mock.calls[0]![1].idempotencyKey,
      );
    },
  );

  it('releases a definite validation failure for correction without pretending success', async () => {
    api.archiveCase.mockRejectedValueOnce(
      new ApiError('invalid', 400, 'VALIDATION_ERROR'),
    );
    const wrapper = panel();
    await fill(wrapper);
    await submit(wrapper);
    expect(exists(wrapper, 'retry')).toBe(false);
    expect(exists(wrapper, 'form')).toBe(true);
    expect(wrapper.emitted('changed')).toBeUndefined();
    expect(control(wrapper, 'error').text()).toContain('未保存');
  });

  it.each([401, 403])(
    'hides unknown original request after %s and retains recovery for remount',
    async (status) => {
      api.archiveCase.mockRejectedValueOnce(
        new ApiError('denied', status, 'FORBIDDEN'),
      );
      const wrapper = panel({ pendingRequest: original });
      await retry(wrapper);
      expect(exists(wrapper, 'current')).toBe(false);
      expect(exists(wrapper, 'retry')).toBe(false);
      expect(exists(wrapper, 'form')).toBe(false);
      expect(wrapper.text()).not.toContain(original.input.archiveReason);
      expect(wrapper.emitted('pending-change')?.at(-1)).toEqual([original]);
      await wrapper.setProps({
        pendingRequest: { ...original },
        item: archived(),
      });
      expect(exists(wrapper, 'retry')).toBe(false);
      expect(wrapper.emitted('changed')).toBeUndefined();
    },
  );

  it('preserves an unknown original key across retry denial and a same-identity remount', async () => {
    let recovery: Pending | null = null;
    const wrapper = panel({
      'onPending-change': (request) => {
        recovery = request;
      },
    });
    api.archiveCase.mockRejectedValueOnce(
      new ApiError('network', 0, 'NETWORK_ERROR'),
    );
    await fill(wrapper);
    await submit(wrapper);
    const sent = { ...api.archiveCase.mock.calls[0]![1] };
    api.archiveCase.mockRejectedValueOnce(
      new ApiError('denied', 403, 'FORBIDDEN'),
    );
    await retry(wrapper);
    expect(recovery).toEqual({ command: 'ARCHIVE', input: sent });
    expect(exists(wrapper, 'retry')).toBe(false);
    expect(exists(wrapper, 'form')).toBe(false);
    expect(wrapper.text()).not.toContain(sent.archiveReason);
    wrapper.unmount();
    const restored = panel({ pendingRequest: recovery });
    await retry(restored);
    expect(api.archiveCase.mock.calls[2]).toEqual([item.id, sent]);
    expect(restored.emitted('changed')).toEqual([[result]]);
  });
  it.each([401, 403])(
    'clears a definite first denial %s without preserving a command',
    async (status) => {
      const wrapper = panel();
      await fill(wrapper);
      api.archiveCase.mockRejectedValueOnce(
        new ApiError('denied', status, 'FORBIDDEN'),
      );
      await submit(wrapper);
      expect(wrapper.emitted('pending-change')?.at(-1)).toEqual([null]);
      expect(exists(wrapper, 'retry')).toBe(false);
      expect(exists(wrapper, 'form')).toBe(false);
    },
  );

  it.each([
    'INTERNAL:user-2:dept-1:rev-1',
    'INTERNAL:user-1:dept-2:rev-1',
    'INTERNAL:user-1:dept-1:rev-2',
  ])(
    'isolates identity/department/revision switch %s and its late response',
    async (key) => {
      const response = deferred<Result>();
      api.archiveCase.mockReturnValueOnce(response.promise);
      const wrapper = panel();
      await fill(wrapper);
      await control(wrapper, 'form').trigger('submit');
      await wrapper.setProps({ contextKey: key });
      expect(exists(wrapper, 'retry')).toBe(false);
      expect(exists(wrapper, 'form')).toBe(false);
      expect(wrapper.emitted('pending-change')?.at(-1)).toEqual([null]);
      response.resolve(result);
      await flushPromises();
      expect(wrapper.emitted('changed')).toBeUndefined();
      await wrapper.setProps({ item: { ...item } });
      expect(control(wrapper, 'reason').element).toHaveProperty('value', '');
    },
  );

  it('clears drafts on case/business revision changes and keeps unknown original command isolated from late results', async () => {
    const wrapper = panel();
    await fill(wrapper);
    await wrapper.setProps({ item: { ...item, version: 12 } });
    expect(control(wrapper, 'reason').element).toHaveProperty('value', '');
    const response = deferred<Result>();
    api.archiveCase.mockReturnValueOnce(response.promise);
    await fill(wrapper);
    await control(wrapper, 'form').trigger('submit');
    const sent = { ...api.archiveCase.mock.calls[0]![1] };
    await wrapper.setProps({ item: archived() });
    response.resolve(result);
    await flushPromises();
    expect(wrapper.emitted('changed')).toBeUndefined();
    expect(exists(wrapper, 'retry')).toBe(true);
    await retry(wrapper);
    expect(api.archiveCase.mock.calls[1]).toEqual([item.id, sent]);
    await wrapper.setProps({ item: { ...item, id: 'case-2' } });
    expect(wrapper.emitted('pending-change')?.at(-1)).toEqual([null]);
    expect(control(wrapper, 'reason').element).toHaveProperty('value', '');
  });

  it('ignores a late rejected command after switching case or unmounting, retaining parent pending on unmount', async () => {
    const response = deferred<Result>();
    api.archiveCase.mockReturnValueOnce(response.promise);
    const onPendingChange = vi.fn();
    const onChanged = vi.fn();
    const wrapper = panel({
      pendingRequest: original,
      'onPending-change': onPendingChange,
      onChanged,
    });
    await control(wrapper, 'retry').trigger('click');
    await wrapper.setProps({ item: { ...item, id: 'case-2' } });
    response.reject(new ApiError('old forbidden', 403, 'FORBIDDEN'));
    await flushPromises();
    expect(wrapper.emitted('refresh')).toBeUndefined();
    expect(exists(wrapper, 'form')).toBe(true);
    const next = deferred<Result>();
    api.archiveCase.mockReturnValueOnce(next.promise);
    await fill(wrapper);
    await control(wrapper, 'form').trigger('submit');
    const events = onPendingChange.mock.calls.length;
    wrapper.unmount();
    next.resolve(result);
    await flushPromises();
    expect(onPendingChange).toHaveBeenCalledTimes(events);
    expect(onChanged).not.toHaveBeenCalled();
  });
});
