import { flushPromises, mount } from '@vue/test-utils';
import { h, KeepAlive, nextTick, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import ReportSummaryPanel, {
  type LoadReportSummary,
  type ReportSummaryView,
} from './ReportSummaryPanel.vue';

const load = vi.fn<LoadReportSummary>();
const base = {
  actorKey: 'actor:INTERNAL:dept',
  contextKey: 'auth1:session1:/reports',
  scopeKey: 'approved-scope',
  access: 'allowed' as const,
  load,
};
const wrappers: ReturnType<typeof mount>[] = [];
function panel(access: 'checking' | 'allowed' | 'denied' = 'allowed') {
  const wrapper = mount(ReportSummaryPanel, { props: { ...base, access } });
  wrappers.push(wrapper);
  return wrapper;
}
function deferred() {
  let resolve!: (value: ReportSummaryView) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<ReportSummaryView>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  load.mockResolvedValue({ kind: 'value', decimalText: '2000' });
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
});

describe('report summary component seam', () => {
  it.each(['checking', 'denied'] as const)(
    'does not read or render money with access %s',
    async (access) => {
      const wrapper = panel(access);
      await flushPromises();
      expect(load).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="report-decimal"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="refresh-report"]').exists()).toBe(false);
    },
  );
  it.each([
    '0',
    '0.00',
    '2000.000000001',
    '90071992547409931234567890.00000000001',
  ])(
    'preserves exact decimal text %s without converting, rounding or shortening',
    async (decimalText) => {
      load.mockResolvedValue({ kind: 'value', decimalText });
      const wrapper = panel();
      await flushPromises();
      expect(load).toHaveBeenCalledExactlyOnceWith({
        signal: expect.any(AbortSignal),
      });
      expect(wrapper.get('[data-test="report-decimal"]').text()).toBe(
        decimalText,
      );
      expect(wrapper.get('h2').text()).toBe('已归档案件平均标的额');
      expect(wrapper.text()).toContain('元');
      expect(wrapper.text()).not.toContain('平均结案金额');
      expect(wrapper.text()).not.toContain('万元');
    },
  );
  it.each(['unavailable', 'no-records'] as const)(
    'displays explicit %s without interpreting it as zero',
    async (kind) => {
      load.mockResolvedValue({ kind, messageText: `调用方明确给定：${kind}` });
      const wrapper = panel();
      await flushPromises();
      expect(wrapper.get(`[data-test="report-${kind}"]`).text()).toBe(
        `调用方明确给定：${kind}`,
      );
      expect(wrapper.find('[data-test="report-decimal"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain('0.00');
    },
  );
  it('serializes refresh, shows loading and clears the previous projection immediately', async () => {
    const first = deferred(),
      second = deferred();
    load.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const wrapper = panel();
    expect(wrapper.text()).toContain('正在读取报表');
    expect(
      wrapper.get('[data-test="refresh-report"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('[data-test="refresh-report"]').trigger('click');
    expect(load).toHaveBeenCalledTimes(1);
    first.resolve({ kind: 'value', decimalText: '2000' });
    await flushPromises();
    await wrapper.get('[data-test="refresh-report"]').trigger('click');
    expect(load).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-test="report-decimal"]').exists()).toBe(false);
    second.resolve({ kind: 'value', decimalText: '3000.001' });
    await flushPromises();
    expect(wrapper.get('[data-test="report-decimal"]').text()).toBe('3000.001');
  });
  it.each([
    { actorKey: 'other:INTERNAL:dept' },
    { contextKey: 'auth2:session1:/reports' },
    { contextKey: 'auth1:session2:/reports' },
    { contextKey: 'auth1:session1:/reports?new-route' },
    { scopeKey: 'another-approved-scope' },
  ])(
    'aborts and isolates old success/finally after key change %j',
    async (change) => {
      const old = deferred(),
        current = deferred();
      load
        .mockResolvedValueOnce({ kind: 'value', decimalText: 'old-sensitive' })
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(current.promise);
      const wrapper = panel();
      await flushPromises();
      expect(wrapper.text()).toContain('old-sensitive');
      await wrapper.get('[data-test="refresh-report"]').trigger('click');
      const signal = load.mock.calls[1][0].signal;
      await wrapper.setProps(change);
      expect(signal.aborted).toBe(true);
      expect(load).toHaveBeenCalledTimes(3);
      old.resolve({ kind: 'value', decimalText: 'late-old-value' });
      await flushPromises();
      expect(wrapper.text()).not.toContain('old-sensitive');
      expect(wrapper.text()).not.toContain('late-old-value');
      expect(
        wrapper.get('[data-test="refresh-report"]').attributes('disabled'),
      ).toBeDefined();
      current.resolve({ kind: 'value', decimalText: '12.3456' });
      await flushPromises();
      expect(wrapper.get('[data-test="report-decimal"]').text()).toBe(
        '12.3456',
      );
    },
  );
  it('does not let old failure revoke or overwrite a newer projection', async () => {
    const old = deferred();
    load
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ kind: 'value', decimalText: '8.0001' });
    const wrapper = panel();
    await wrapper.setProps({ contextKey: 'new-session' });
    await flushPromises();
    old.reject(new ApiError('private-old-error', 403, 'FORBIDDEN'));
    await flushPromises();
    expect(wrapper.get('[data-test="report-decimal"]').text()).toBe('8.0001');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(
      wrapper.get('[data-test="refresh-report"]').attributes('disabled'),
    ).toBeUndefined();
  });
  it.each(['checking', 'denied'] as const)(
    'clears old money and cancels pending reads on access %s',
    async (access) => {
      const old = deferred();
      load
        .mockResolvedValueOnce({ kind: 'value', decimalText: 'old-sensitive' })
        .mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce({ kind: 'value', decimalText: '5' });
      const wrapper = panel();
      await flushPromises();
      await wrapper.get('[data-test="refresh-report"]').trigger('click');
      const signal = load.mock.calls[1][0].signal;
      await wrapper.setProps({ access });
      expect(signal.aborted).toBe(true);
      expect(wrapper.text()).not.toContain('old-sensitive');
      old.resolve({ kind: 'value', decimalText: 'late-sensitive' });
      await flushPromises();
      expect(wrapper.text()).not.toContain('late-sensitive');
      expect(load).toHaveBeenCalledTimes(2);
      await wrapper.setProps({ access: 'allowed' });
      await flushPromises();
      expect(load).toHaveBeenCalledTimes(3);
      expect(wrapper.get('[data-test="report-decimal"]').text()).toBe('5');
    },
  );
  it.each([401, 403])(
    'clears money and stops refreshing after HTTP %i without repairing permission',
    async (status) => {
      load
        .mockResolvedValueOnce({ kind: 'value', decimalText: '1000' })
        .mockRejectedValueOnce(
          new ApiError('private-response', status, 'DENIED'),
        );
      const wrapper = panel();
      await flushPromises();
      await wrapper.get('[data-test="refresh-report"]').trigger('click');
      await flushPromises();
      expect(wrapper.find('[data-test="report-decimal"]').exists()).toBe(false);
      expect(wrapper.get('[role="alert"]').text()).toContain(
        '当前无法读取报表',
      );
      expect(wrapper.text()).not.toContain('private-response');
      expect(wrapper.find('[data-test="refresh-report"]').exists()).toBe(false);
      await wrapper.setProps({ access: 'allowed' });
      await flushPromises();
      expect(load).toHaveBeenCalledTimes(2);
    },
  );
  it('shows an ordinary error distinctly and permits an explicit retry', async () => {
    load
      .mockResolvedValueOnce({ kind: 'value', decimalText: 'old' })
      .mockRejectedValueOnce(new Error('private-server-error'))
      .mockResolvedValueOnce({
        kind: 'no-records',
        messageText: '调用方给定空状态',
      });
    const wrapper = panel();
    await flushPromises();
    await wrapper.get('[data-test="refresh-report"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('报表读取失败，请重试。');
    expect(wrapper.text()).not.toContain('private-server-error');
    expect(wrapper.find('[data-test="report-decimal"]').exists()).toBe(false);
    await wrapper.get('[data-test="refresh-report"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="report-no-records"]').text()).toBe(
      '调用方给定空状态',
    );
  });
  it('aborts pending work on unmount', async () => {
    const pending = deferred();
    load.mockReturnValue(pending.promise);
    const wrapper = panel();
    const signal = load.mock.calls[0][0].signal;
    wrapper.unmount();
    expect(signal.aborted).toBe(true);
    pending.resolve({ kind: 'value', decimalText: 'late' });
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('aborts cached inactive work and reads fresh on activation without showing old cache', async () => {
    const old = deferred();
    load
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ kind: 'value', decimalText: 'fresh' });
    const show = ref(true);
    const wrapper = mount({
      setup: () => () =>
        h(KeepAlive, null, {
          default: () =>
            show.value ? h(ReportSummaryPanel, base) : h('p', '离开报表'),
        }),
    });
    wrappers.push(wrapper);
    const signal = load.mock.calls[0][0].signal;
    show.value = false;
    await nextTick();
    expect(signal.aborted).toBe(true);
    old.resolve({ kind: 'value', decimalText: 'stale-cached' });
    await flushPromises();
    show.value = true;
    await nextTick();
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).not.toContain('stale-cached');
    expect(wrapper.get('[data-test="report-decimal"]').text()).toBe('fresh');
  });
});
