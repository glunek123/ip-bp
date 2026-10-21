import { flushPromises, mount } from '@vue/test-utils';
import { h, KeepAlive, nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession } from '../../api/auth';
import type { ReportsOverview } from '../../api/reports';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../stores/auth';
const api = vi.hoisted(() => ({ capability: vi.fn(), overview: vi.fn() }));
vi.mock('../../api/reports', () => ({
  getReportsCapability: api.capability,
  getReportsOverview: api.overview,
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
const overview = (): Extract<ReportsOverview, { status: 'VALUE' }> => ({
  metric: 'ARCHIVED_CASE_AVERAGE_CLAIM_AMOUNT',
  currency: 'CNY',
  scope: 'DEPARTMENT',
  period: 'ALL_TIME',
  definitionVersion: 'RP001-1',
  generatedAt: '2026-10-21T08:00:00.000Z',
  totalCases: 5,
  inProgressCases: 3,
  archivedCases: 2,
  status: 'VALUE',
  amount: '2000.00',
  reason: null,
});
const wrappers: ReturnType<typeof mount>[] = [];
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
  api.overview.mockResolvedValue(overview());
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
});
describe('real RP001 reports page', () => {
  it('loads real capability then one snapshot and aligns all Demo fields without fake unapproved data', async () => {
    const { wrapper } = await page();
    expect(api.capability).toHaveBeenCalledTimes(1);
    expect(api.overview).toHaveBeenCalledExactlyOnceWith({
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
    expect(wrapper.findAll('[data-test^="report-pending-"]')).toHaveLength(6);
    for (const item of wrapper.findAll('[data-test^="report-pending-"]'))
      expect(item.text()).toContain('口径待确认');
    expect(wrapper.text()).not.toContain('平均结案金额');
    expect(wrapper.text()).not.toContain('运营工作量');
  });
  it.each(['0.00', '90071992547409931234567890.01'])(
    'displays exact approved amount %s',
    async (amount) => {
      api.overview.mockResolvedValue({ ...overview(), amount });
      const { wrapper } = await page();
      expect(wrapper.get('[data-test="report-decimal"]').text()).toBe(amount);
    },
  );
  it('keeps real counts when no archived sample exists', async () => {
    api.overview.mockResolvedValue({
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
    api.overview.mockResolvedValue({
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
    expect(api.overview).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain('2000.00');
    pending.resolve({ canRead: false });
    await flushPromises();
    expect(api.overview).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('当前无法读取报表');
  });
  it.each(['CLIENT', 'LAWYER', 'NOTARY'] as const)(
    'does not request reports as %s',
    async (principal) => {
      const { wrapper } = await page(principal);
      expect(api.capability).not.toHaveBeenCalled();
      expect(api.overview).not.toHaveBeenCalled();
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
    expect(api.overview).not.toHaveBeenCalled();
    await wrapper.get('[data-test="retry-report-capability"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="report-decimal"]').text()).toBe('2000.00');
  });
  it('clears counts, amount and metadata as soon as a refresh starts', async () => {
    const pending = deferred<ReportsOverview>();
    const { wrapper } = await page();
    api.overview.mockReturnValueOnce(pending.promise);
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
      const old = deferred<ReportsOverview>();
      api.overview
        .mockReturnValueOnce(old.promise)
        .mockResolvedValue(overview());
      const { wrapper, auth, router } = await page();
      const signal = api.overview.mock.calls[0][0].signal as AbortSignal;
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
    expect(api.overview).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('当前无法读取报表');
  });
  it.each([401, 403])(
    'clears every projection on HTTP %i and does not repair permissions',
    async (status) => {
      const { wrapper } = await page();
      api.overview.mockRejectedValueOnce(
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
    expect(api.overview).toHaveBeenCalledTimes(1);
    expect(wrapper.find('input[type="date"]').exists()).toBe(false);
  });
  it('revalidates current permission and discards inactive cached projections', async () => {
    const old = deferred<ReportsOverview>();
    api.overview.mockReturnValueOnce(old.promise).mockResolvedValue(overview());
    const { wrapper, show } = await page('INTERNAL', true);
    const signal = api.overview.mock.calls[0][0].signal as AbortSignal;
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
