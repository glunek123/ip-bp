import { flushPromises, mount } from '@vue/test-utils';
import { h, KeepAlive, nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession } from '../../api/auth';
import type { ReportsCenter } from '../../api/reports';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../stores/auth';
const api = vi.hoisted(() => ({ capability: vi.fn(), center: vi.fn() }));
const exportHttp = vi.hoisted(() => ({ postBlob: vi.fn() }));
vi.mock('../../api/http', async (original) => ({
  ...(await original<typeof import('../../api/http')>()),
  postBlob: exportHttp.postBlob,
}));
vi.mock('../../api/reports', () => ({
  getReportsCapability: api.capability,
  getReportsCenter: api.center,
}));
import ReportsPage from './ReportsPage.vue';

const session: AuthSession = {
  principalType: 'INTERNAL',
  user: { id: 'actor', username: 'synthetic', displayName: '运营' },
  department: { id: 'dept', name: '部门' },
  departments: [{ id: 'dept', name: '部门' }],
  customer: null,
  notaryOffice: null,
  authorizationRevision: 1,
  expiresAt: '2099-01-01T00:00:00Z',
  csrfToken: 'synthetic',
};
const overview = (): Extract<ReportsCenter, { status: 'VALUE' }> => ({
  metric: 'ARCHIVED_CASE_AVERAGE_CLAIM_AMOUNT',
  currency: 'CNY',
  scope: 'DEPARTMENT',
  period: 'ALL_TIME',
  definitionVersion: 'RP001-2',
  view: 'department',
  availableViews: ['mine', 'department'],
  exportViews: [],
  distributions: {
    types: [
      { value: 'CIVIL', count: 4 },
      { value: null, count: 1 },
    ],
    platforms: [
      { value: 'JD', count: 4 },
      { value: null, count: 1 },
    ],
    courts: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: '合成法院',
        count: 4,
      },
    ],
    unrecordedCourtCases: 1,
  },
  money: {
    total: { status: 'VALUE', amount: '40000.00' },
    knownCases: 4,
    unknownCases: 1,
    buckets: [
      { lowerInclusive: '0.00', upperExclusive: '100000.00', count: 1 },
      { lowerInclusive: '100000.00', upperExclusive: '300000.00', count: 1 },
      { lowerInclusive: '300000.00', upperExclusive: '500000.00', count: 1 },
      { lowerInclusive: '500000.00', upperExclusive: null, count: 1 },
    ],
  },
  closureRate: { status: 'VALUE', percent: '40' },
  generatedAt: '2026-10-21T08:00:00.000Z',
  totalCases: 5,
  inProgressCases: 3,
  archivedCases: 2,
  status: 'VALUE',
  amount: '2000.00',
  reason: null,
});
const wrappers: ReturnType<typeof mount>[] = [];
const nativeURL = globalThis.URL;
const createURL = vi.fn(() => 'blob:page-report'),
  revokeURL = vi.fn(),
  downloadClick = vi.fn();
const exportFile = () => ({
  blob: new Blob(['维度,项目,数值\r\n汇总,案件总数,5\r\n'], {
    type: 'text/csv;charset=utf-8',
  }),
  filename: '案件报表_2026-10-21.csv',
  mimeType: 'text/csv',
});
async function page(
  principal: AuthSession['principalType'] = 'INTERNAL',
  cached = false,
) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore(pinia);
  auth.session = { ...session, principalType: principal };
  auth.restored = true;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/reports', component: ReportsPage },
      { path: '/health', component: { template: '<p>离开报表</p>' } },
    ],
  });
  await router.push('/reports');
  await router.isReady();
  const show = ref(true);
  const wrapper = mount(
    {
      setup: () => () =>
        cached
          ? h(KeepAlive, null, {
              default: () => (show.value ? h(ReportsPage) : h('p', '离开报表')),
            })
          : h(RouterView),
    },
    { global: { plugins: [pinia, router] } },
  );
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, auth, router, show };
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
beforeEach(() => {
  vi.resetAllMocks();
  api.capability.mockResolvedValue({ canRead: true });
  api.center.mockResolvedValue(overview());
  exportHttp.postBlob.mockResolvedValue(exportFile());
  createURL.mockReturnValue('blob:page-report');
  vi.stubGlobal(
    'URL',
    class extends nativeURL {
      static createObjectURL = createURL;
      static revokeObjectURL = revokeURL;
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
    downloadClick,
  );
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('real RP001 reports page', () => {
  it('exports the exact current view once with no confirmation and revokes its download URL', async () => {
    api.center.mockResolvedValue({
      ...overview(),
      exportViews: ['department'],
    });
    const pending = deferred<ReturnType<typeof exportFile>>();
    exportHttp.postBlob.mockReturnValueOnce(pending.promise);
    const { wrapper } = await page();
    const button = wrapper.get('[data-test="export-reports"]');
    expect(button.attributes('disabled')).toBeUndefined();
    await button.trigger('click');
    await button.trigger('click');
    expect(exportHttp.postBlob).toHaveBeenCalledExactlyOnceWith(
      '/reports/export',
      { view: 'department' },
      { signal: expect.any(AbortSignal), retryOnCsrfInvalid: false },
    );
    expect(button.attributes('disabled')).toBeDefined();
    expect(createURL).not.toHaveBeenCalled();
    pending.resolve(exportFile());
    await flushPromises();
    expect(createURL).toHaveBeenCalledTimes(1);
    expect(downloadClick).toHaveBeenCalledTimes(1);
    expect(revokeURL).toHaveBeenCalledExactlyOnceWith('blob:page-report');
    expect(button.attributes('disabled')).toBeUndefined();
  });
  it.each([
    'view',
    'refresh',
    'actor',
    'session',
    'authorization',
    'route',
    'deactivate',
    'unmount',
  ])(
    'immediately aborts an export on %s and rejects its late Blob',
    async (mode) => {
      api.center.mockResolvedValue({
        ...overview(),
        exportViews: ['mine', 'department'],
      });
      const pending = deferred<ReturnType<typeof exportFile>>();
      exportHttp.postBlob.mockReturnValueOnce(pending.promise);
      const { wrapper, auth, router, show } = await page(
        'INTERNAL',
        mode === 'deactivate',
      );
      await wrapper.get('[data-test="export-reports"]').trigger('click');
      const signal = exportHttp.postBlob.mock.calls[0][2].signal as AbortSignal;
      if (mode === 'view') await wrapper.get('select').setValue('mine');
      if (mode === 'refresh')
        await wrapper.get('[data-test="refresh-report"]').trigger('click');
      if (mode === 'actor')
        auth.session = {
          ...auth.session!,
          user: { ...auth.session!.user, id: 'new-actor' },
        };
      if (mode === 'session') auth.session = { ...auth.session! };
      if (mode === 'authorization')
        auth.session = { ...auth.session!, authorizationRevision: 2 };
      if (mode === 'route') await router.push('/reports#changed');
      if (mode === 'deactivate') {
        show.value = false;
        await nextTick();
      }
      if (mode === 'unmount') {
        wrapper.unmount();
        wrappers.splice(wrappers.indexOf(wrapper), 1);
      }
      expect(signal.aborted).toBe(true);
      pending.resolve(exportFile());
      await flushPromises();
      expect(createURL).not.toHaveBeenCalled();
      expect(downloadClick).not.toHaveBeenCalled();
      expect(revokeURL).not.toHaveBeenCalled();
    },
  );
  it.each([401, 403, 500])(
    'shows a safe HTTP%i export failure without downloading or automatic retry',
    async (status) => {
      api.center.mockResolvedValue({
        ...overview(),
        exportViews: ['department'],
      });
      exportHttp.postBlob.mockRejectedValueOnce(
        new ApiError('private-export-body', status, 'ACTION_FORBIDDEN'),
      );
      const { wrapper } = await page();
      await wrapper.get('[data-test="export-reports"]').trigger('click');
      await flushPromises();
      expect(exportHttp.postBlob).toHaveBeenCalledTimes(1);
      expect(createURL).not.toHaveBeenCalled();
      expect(wrapper.text()).not.toContain('private-export-body');
      if (status === 401) {
        expect(wrapper.find('[data-test="report-decimal"]').exists()).toBe(
          false,
        );
      } else
        expect(
          wrapper.get('[data-test="report-export-error"]').text(),
        ).toContain(status === 403 ? '当前范围暂不可导出' : '报表导出失败');
      if (status === 403)
        expect(
          wrapper.get('[data-test="export-reports"]').attributes('disabled'),
        ).toBeDefined();
      expect(api.capability).toHaveBeenCalledTimes(1);
    },
  );
  it('ignores a late old export denial after a session changes', async () => {
    api.center.mockResolvedValue({
      ...overview(),
      exportViews: ['department'],
    });
    const pending = deferred<ReturnType<typeof exportFile>>();
    exportHttp.postBlob.mockReturnValueOnce(pending.promise);
    const { wrapper, auth } = await page();
    await wrapper.get('[data-test="export-reports"]').trigger('click');
    auth.session = { ...auth.session! };
    await flushPromises();
    pending.reject(
      new ApiError('private-stale-denial', 403, 'ACTION_FORBIDDEN'),
    );
    await flushPromises();
    expect(wrapper.find('[data-test="report-export-error"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.get('[data-test="export-reports"]').attributes('disabled'),
    ).toBeUndefined();
    expect(createURL).not.toHaveBeenCalled();
  });
  it('describes empty exportViews neutrally without inferring a specific missing grant', async () => {
    const { wrapper } = await page();
    expect(wrapper.get('#reports-export-note').text()).toBe(
      '当前范围暂不可导出',
    );
    expect(wrapper.text()).not.toContain('未获导出授权');
    expect(
      wrapper.get('[data-test="export-reports"]').attributes('disabled'),
    ).toBeDefined();
  });
  it('uses the returned default view and only offers server-authorized view choices', async () => {
    api.center.mockResolvedValue({
      ...overview(),
      view: 'mine',
      scope: 'SELF',
      availableViews: ['mine'],
    });
    const { wrapper } = await page();
    expect(api.center.mock.calls[0][0]).toBeUndefined();
    expect(
      wrapper
        .get('[data-test="report-view"]')
        .findAll('option')
        .map((row) => row.text()),
    ).toEqual(['本人负责']);
    expect(wrapper.get('select').element.value).toBe('mine');
    expect(wrapper.text()).toContain('本人负责');
    expect(wrapper.text()).not.toContain('本部门累计案件');
  });
  it('aborts and clears the whole old view on selection and ignores late responses', async () => {
    const { wrapper } = await page();
    const old = deferred<ReportsCenter>(),
      latest = deferred<ReportsCenter>();
    api.center
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(latest.promise);
    await wrapper.get('select').setValue('mine');
    await flushPromises();
    expect(api.center.mock.calls[1][0]).toBe('mine');
    const signal = api.center.mock.calls[1][1].signal as AbortSignal;
    expect(wrapper.get('[data-test="report-header-count"]').text()).toBe(
      '统计未读取',
    );
    expect(
      wrapper.find('[data-test="report-cumulative-decimal"]').exists(),
    ).toBe(false);
    expect(wrapper.findAll('.distribution-list li')).toHaveLength(0);
    await wrapper.get('select').setValue('department');
    await flushPromises();
    expect(signal.aborted).toBe(true);
    expect(api.center.mock.calls[2][0]).toBe('department');
    old.resolve({
      ...overview(),
      view: 'mine',
      scope: 'SELF',
      amount: '999999.00',
    });
    await flushPromises();
    expect(wrapper.text()).not.toContain('999999.00');
    latest.resolve(overview());
    await flushPromises();
    expect(wrapper.get('[data-test="report-decimal"]').text()).toBe('2000.00');
    expect(api.capability).toHaveBeenCalledTimes(1);
  });
  it('does not silently switch a forbidden explicit view and only enables a listed export view', async () => {
    api.center.mockResolvedValue({
      ...overview(),
      exportViews: ['department'],
    });
    const { wrapper } = await page();
    expect(
      wrapper.get('[data-test="export-reports"]').attributes('disabled'),
    ).toBeUndefined();
    api.center.mockRejectedValueOnce(
      new ApiError('private', 403, 'ACTION_FORBIDDEN'),
    );
    await wrapper.get('select').setValue('mine');
    await flushPromises();
    expect(api.center).toHaveBeenCalledTimes(2);
    expect(wrapper.find('select').exists()).toBe(false);
    expect(
      wrapper.find('[data-test="report-cumulative-decimal"]').exists(),
    ).toBe(false);
    expect(wrapper.text()).not.toContain('private');
  });
  it('loads real capability then one snapshot and aligns all Demo fields without fake unapproved data', async () => {
    const { wrapper } = await page();
    expect(api.capability).toHaveBeenCalledTimes(1);
    expect(api.center).toHaveBeenCalledExactlyOnceWith(undefined, {
      signal: expect.any(AbortSignal),
    });
    expect(wrapper.findAll('h2').map((item) => item.text())).toEqual([
      '案件总数',
      '累计标的额',
      '已归档案件平均标的额',
      '结案率',
      '平台分布',
      '案件类型分布',
      '立案法院 TOP 5',
      '标的额区间分布',
    ]);
    expect(wrapper.get('[data-test="report-header-count"]').text()).toBe('5');
    expect(wrapper.get('[data-test="report-total-count"]').text()).toBe('5 件');
    expect(
      wrapper.get('[data-test="report-in-progress-count"]').text(),
    ).toContain('3 件');
    expect(wrapper.get('[data-test="report-decimal"]').text()).toBe('2000.00');
    expect(wrapper.get('[data-test="report-metadata"]').text()).toContain(
      '已归档 2 件',
    );
    expect(wrapper.get('time').attributes('datetime')).toBe(
      overview().generatedAt,
    );
    expect(wrapper.findAll('[data-test^="report-pending-"]')).toHaveLength(0);
    expect(wrapper.get('[data-test="report-cumulative-decimal"]').text()).toBe(
      '40000.00',
    );
    expect(wrapper.get('[data-test="report-closure-percent"]').text()).toBe(
      '40 %',
    );
    expect(
      wrapper.get('[data-test="report-amount-coverage"]').text(),
    ).toContain('未知金额 1 件');
    expect(wrapper.text()).not.toContain('平均结案金额');
    expect(wrapper.text()).not.toContain('运营工作量');
  });
  it.each(['0.00', '90071992547409931234567890.01'])(
    'displays exact approved amount %s',
    async (amount) => {
      api.center.mockResolvedValue({ ...overview(), amount });
      const { wrapper } = await page();
      expect(wrapper.get('[data-test="report-decimal"]').text()).toBe(amount);
    },
  );
  it('keeps real counts when no archived sample exists', async () => {
    api.center.mockResolvedValue({
      ...overview(),
      status: 'NO_RECORDS',
      archivedCases: 0,
      inProgressCases: 5,
      amount: null,
      reason: 'NO_ARCHIVED_CASES',
    });
    const { wrapper } = await page();
    expect(wrapper.get('[data-test="report-no-records"]').text()).toBe(
      '暂无数据',
    );
    expect(wrapper.get('[data-test="report-header-count"]').text()).toBe('5');
  });
  it('distinguishes archived-but-all-unknown from empty records without replacing the amount with0', async () => {
    api.center.mockResolvedValue({
      ...overview(),
      status: 'UNAVAILABLE',
      amount: null,
      reason: 'NO_KNOWN_AMOUNT',
    });
    const { wrapper } = await page();
    expect(wrapper.get('[data-test="report-unavailable"]').text()).toContain(
      '暂无已知标的额',
    );
    expect(wrapper.get('[data-test="report-total-count"]').text()).toBe('5 件');
    expect(wrapper.find('[data-test="report-decimal"]').exists()).toBe(false);
  });
  it('does not read overview before permission is confirmed or after explicit denial', async () => {
    const pending = deferred<{ canRead: boolean }>();
    api.capability.mockReturnValue(pending.promise);
    const { wrapper } = await page();
    expect(api.center).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain('2000.00');
    pending.resolve({ canRead: false });
    await flushPromises();
    expect(api.center).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('当前无法读取报表');
  });
  it.each(['CLIENT', 'LAWYER', 'NOTARY'] as const)(
    'does not request reports as %s',
    async (principal) => {
      const { wrapper } = await page(principal);
      expect(api.capability).not.toHaveBeenCalled();
      expect(api.center).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain('当前无法读取报表');
    },
  );
  it('shows capability failure explicitly and retries only on intent', async () => {
    api.capability
      .mockRejectedValueOnce(new Error('private'))
      .mockResolvedValueOnce({ canRead: true });
    const { wrapper } = await page();
    expect(wrapper.text()).toContain('暂时无法核对');
    expect(wrapper.text()).not.toContain('private');
    expect(api.center).not.toHaveBeenCalled();
    await wrapper.get('[data-test="retry-report-capability"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="report-decimal"]').text()).toBe('2000.00');
  });
  it('clears counts, amount and metadata as soon as a refresh starts', async () => {
    const pending = deferred<ReportsCenter>();
    const { wrapper } = await page();
    api.center.mockReturnValueOnce(pending.promise);
    await wrapper.get('[data-test="refresh-report"]').trigger('click');
    expect(wrapper.get('[data-test="report-header-count"]').text()).toBe(
      '统计未读取',
    );
    expect(wrapper.find('[data-test="report-metadata"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="report-decimal"]').exists()).toBe(false);
    pending.resolve({ ...overview(), amount: '3.00' });
    await flushPromises();
    expect(wrapper.get('[data-test="report-decimal"]').text()).toBe('3.00');
  });
  it.each(['actor', 'department', 'authorization', 'session', 'route'])(
    'isolates an old overview on %s change',
    async (mode) => {
      const old = deferred<ReportsCenter>();
      api.center.mockReturnValueOnce(old.promise).mockResolvedValue(overview());
      const { wrapper, auth, router } = await page();
      const signal = api.center.mock.calls[0][1].signal as AbortSignal;
      if (mode === 'actor')
        auth.session = {
          ...auth.session!,
          user: { ...auth.session!.user, id: 'new-actor' },
        };
      if (mode === 'department')
        auth.session = {
          ...auth.session!,
          department: { id: 'new-dept', name: '新部门' },
        };
      if (mode === 'authorization')
        auth.session = { ...auth.session!, authorizationRevision: 2 };
      if (mode === 'session') auth.session = { ...auth.session! };
      if (mode === 'route') await router.push('/reports#new-route');
      await flushPromises();
      expect(signal.aborted).toBe(true);
      old.resolve({
        ...overview(),
        amount: '999999.00',
        totalCases: 99,
        inProgressCases: 97,
      });
      await flushPromises();
      expect(wrapper.get('[data-test="report-decimal"]').text()).toBe(
        '2000.00',
      );
      expect(wrapper.get('[data-test="report-header-count"]').text()).toBe('5');
    },
  );
  it('ignores an old capability success after current permission is denied', async () => {
    const old = deferred<{ canRead: boolean }>();
    api.capability
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ canRead: false });
    const { wrapper, auth } = await page();
    const signal = api.capability.mock.calls[0][0].signal as AbortSignal;
    auth.session = { ...auth.session!, authorizationRevision: 2 };
    await flushPromises();
    expect(signal.aborted).toBe(true);
    old.resolve({ canRead: true });
    await flushPromises();
    expect(api.center).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('当前无法读取报表');
  });
  it.each([401, 403])(
    'clears every projection on HTTP %i and does not repair permissions',
    async (status) => {
      const { wrapper } = await page();
      api.center.mockRejectedValueOnce(
        new ApiError('private', status, 'ACTION_FORBIDDEN'),
      );
      await wrapper.get('[data-test="refresh-report"]').trigger('click');
      await flushPromises();
      expect(wrapper.get('[data-test="report-header-count"]').text()).toBe(
        '统计未读取',
      );
      expect(wrapper.find('[data-test="report-decimal"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="report-metadata"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-test="refresh-report"]').exists()).toBe(false);
      expect(api.capability).toHaveBeenCalledTimes(1);
      expect(wrapper.text()).not.toContain('private');
    },
  );
  it('keeps export disabled and never offers a date filter or export request', async () => {
    const { wrapper } = await page();
    expect(
      wrapper.get('[data-test="export-reports"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('[data-test="export-reports"]').trigger('click');
    expect(api.center).toHaveBeenCalledTimes(1);
    expect(wrapper.find('input[type="date"]').exists()).toBe(false);
  });
  it('revalidates current permission and discards inactive cached projections', async () => {
    const old = deferred<ReportsCenter>();
    api.center.mockReturnValueOnce(old.promise).mockResolvedValue(overview());
    const { wrapper, show } = await page('INTERNAL', true);
    const signal = api.center.mock.calls[0][1].signal as AbortSignal;
    show.value = false;
    await nextTick();
    expect(signal.aborted).toBe(true);
    old.resolve({ ...overview(), amount: '999999.00' });
    await flushPromises();
    show.value = true;
    await nextTick();
    await flushPromises();
    expect(api.capability).toHaveBeenCalledTimes(2);
    expect(wrapper.get('[data-test="report-decimal"]').text()).toBe('2000.00');
  });
});
