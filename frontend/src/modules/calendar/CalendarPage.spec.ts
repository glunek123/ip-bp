import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { h, nextTick } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession } from '../../api/auth';
import type {
  CalendarDateEvent,
  CalendarSnapshot,
  CalendarSummary,
} from '../../api/calendar';
import { ApiError, type RequestOptions } from '../../api/http';
import { useAuthStore } from '../../stores/auth';
import CalendarPage from './CalendarPage.vue';

const api = vi.hoisted(() => ({
  snapshot:
    vi.fn<
      (month: string, options?: RequestOptions) => Promise<CalendarSnapshot>
    >(),
  summary: vi.fn<(options?: RequestOptions) => Promise<CalendarSummary>>(),
  manual: vi.fn(),
  refunds: vi.fn(),
  createManual: vi.fn(),
  updateManual: vi.fn(),
}));
vi.mock('../../api/calendar', () => ({
  getCalendarSnapshot: api.snapshot,
  getCalendarSummary: api.summary,
}));
vi.mock('../../api/calendar-reminders', () => ({
  listManualCalendar: api.manual,
  listRefundCalendar: api.refunds,
  createManualCalendar: api.createManual,
  updateManualCalendar: api.updateManual,
}));
enableAutoUnmount(afterEach);

function event(overrides: Partial<CalendarDateEvent> = {}): CalendarDateEvent {
  return {
    eventKey: 'FIRST_INSTANCE_HEARING:11111111-1111-4111-8111-111111111111',
    sourceType: 'FIRST_INSTANCE_HEARING',
    sourceId: '11111111-1111-4111-8111-111111111111',
    date: '2026-10-15',
    type: 'court',
    title: '同名合成案件',
    sub: '同名法院案号',
    caseId: '11111111-1111-4111-8111-111111111111',
    customerId: null,
    courtDetails: {
      party: null,
      defendant: null,
      reason: null,
      time: '14:30',
      place: '合成法庭',
      judge: null,
    },
    caseDetails: {
      customer: null,
      rightsHolder: null,
      defendant: null,
      caseNumber: null,
      amount: null,
    },
    ...overrides,
  };
}
const second = event({
  eventKey: 'SECOND_INSTANCE_HEARING:22222222-2222-4222-8222-222222222222',
  sourceType: 'SECOND_INSTANCE_HEARING',
  sourceId: '22222222-2222-4222-8222-222222222222',
  caseId: '22222222-2222-4222-8222-222222222222',
});
const agreement = event({
  eventKey: 'CUSTOMER_AGREEMENT_EXPIRY:33333333-3333-4333-8333-333333333333',
  sourceType: 'CUSTOMER_AGREEMENT_EXPIRY',
  sourceId: '33333333-3333-4333-8333-333333333333',
  type: 'contract',
  title: '协议到期 · 合成协议',
  caseId: null,
  customerId: '33333333-3333-4333-8333-333333333333',
  courtDetails: null,
  caseDetails: null,
});
function snapshot(
  month = '2026-10',
  events = [event(), second, agreement],
): CalendarSnapshot {
  return {
    today: '2026-10-13',
    timeZone: 'Asia/Shanghai',
    window: { from: '2026-10-13', through: '2026-11-12' },
    metrics: {
      next30: { state: 'AVAILABLE', count: 3, nearestDate: '2026-10-15' },
      court: { state: 'AVAILABLE', count: 8, nearestDate: '2026-10-15' },
      pay: { state: 'NOT_CONNECTED', count: null, nearestDate: null },
      contract: { state: 'AVAILABLE', count: 1, nearestDate: '2026-10-15' },
      other: { state: 'NOT_CONNECTED', count: null, nearestDate: null },
    },
    month,
    events: events
      .filter((item) => item.date.startsWith(`${month}-`))
      .sort(
        (left, right) =>
          left.date.localeCompare(right.date) ||
          left.eventKey.localeCompare(right.eventKey),
      ),
  };
}
function session(
  principalType: AuthSession['principalType'] = 'INTERNAL',
): AuthSession {
  return {
    principalType,
    user: { id: 'user-1', displayName: '合成用户', username: 'test' },
    department:
      principalType === 'INTERNAL'
        ? { id: 'department-1', name: '合成部门' }
        : null,
    departments: [],
    customer:
      principalType === 'CLIENT'
        ? { id: 'customer-1', name: '合成客户' }
        : null,
    notaryOffice:
      principalType === 'NOTARY'
        ? { id: 'notary-1', name: '合成公证处' }
        : null,
    authorizationRevision: 1,
    expiresAt: '2099-01-01T00:00:00Z',
    csrfToken: 'synthetic',
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function render(
  query = '?month=2026-10',
  principalType: AuthSession['principalType'] = 'INTERNAL',
) {
  const pinia = createPinia();
  const auth = useAuthStore(pinia);
  auth.session = session(principalType);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/calendar', component: CalendarPage },
      { path: '/cases/:id', component: { template: '<p>案件详情</p>' } },
      {
        path: '/client/cases/:id',
        component: { template: '<p>客户案件详情</p>' },
      },
      {
        path: '/lawyer/cases/:id',
        component: { template: '<p>律师案件详情</p>' },
      },
    ],
  });
  await router.push(`/calendar${query}`);
  const wrapper = mount(
    { render: () => h(RouterView) },
    { global: { plugins: [pinia, router] } },
  );
  await flushPromises();
  return { wrapper, router, auth };
}
beforeEach(() => {
  vi.resetAllMocks();
  api.manual.mockResolvedValue([]);
  api.refunds.mockResolvedValue([]);
  api.snapshot.mockImplementation(async (month) => snapshot(month));
  api.summary.mockResolvedValue(snapshot());
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('CalendarPage', () => {
  it('shows own manual and formal refund dates beside existing court and agreement sources', async () => {
    api.manual.mockResolvedValue([
      {
        id: 'manual-1',
        title: '本人事项',
        eventDate: '2026-10-20',
        note: '准备文件',
        version: 1,
      },
    ]);
    api.refunds.mockResolvedValue([
      {
        sourceType: 'FIRST_INSTANCE_JUDGMENT',
        sourceId: 'judgment-1',
        caseId: 'case-1',
        dueDate: '2026-10-28',
        title: '一审判决退费待核',
        businessNo: '案-1',
        applied: false,
      },
    ]);
    const { wrapper } = await render();
    expect(wrapper.findAll('.calendar-event')).toHaveLength(5);
    expect(wrapper.get('.calendar-personal').text()).toContain('本人事项');
    expect(
      wrapper
        .get('[data-event-key="FIRST_INSTANCE_JUDGMENT:judgment-1"]')
        .text(),
    ).toContain('退费');
  });
  it('uses only official month data and stable metrics with missing-source labels and server today', async () => {
    const { wrapper } = await render();
    expect(api.snapshot).toHaveBeenCalledWith('2026-10', {
      signal: expect.any(AbortSignal),
    });
    expect(api.summary).not.toHaveBeenCalled();
    expect(wrapper.findAll('.calendar-event')).toHaveLength(3);
    expect(wrapper.get('[data-statistic="court"] dd').text()).toBe('8');
    expect(wrapper.get('[data-statistic="pay"] dd').text()).toBe('未接入');
    expect(wrapper.get('[data-statistic="other"] dd').text()).toBe('未接入');
    expect(wrapper.get('[aria-current="date"]').attributes('data-date')).toBe(
      '2026-10-13',
    );
    await wrapper
      .get(`[data-event-key="${event().eventKey}"]`)
      .trigger('mouseenter');
    await nextTick();
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      '合成法庭',
    );
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      '未知',
    );
  });
  it('initializes absent URL month from Shanghai server today and preserves unrelated query', async () => {
    const { wrapper, router } = await render('?filter=retained');
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({
      filter: 'retained',
      month: '2026-10',
    });
    expect(api.summary).toHaveBeenCalledTimes(1);
    expect(api.snapshot).toHaveBeenCalledWith('2026-10', {
      signal: expect.any(AbortSignal),
    });
    expect(wrapper.find('table').exists()).toBe(true);
  });
  it.each(['?month=2026-13', '?month=2026-10&month=2026-11', '?month='])(
    'rejects invalid month query %s without a data request',
    async (query) => {
      const { wrapper } = await render(query);
      expect(api.snapshot).not.toHaveBeenCalled();
      expect(api.summary).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain('月份无效');
      expect(wrapper.find('.calendar-event').exists()).toBe(false);
    },
  );
  it('shows authorized empty events and forbidden agreement independently of unconnected sources', async () => {
    const result = snapshot('2026-10', []);
    result.metrics.court = { state: 'AVAILABLE', count: 0, nearestDate: null };
    result.metrics.contract = {
      state: 'FORBIDDEN',
      count: null,
      nearestDate: null,
    };
    api.snapshot.mockResolvedValue(result);
    const { wrapper } = await render();
    expect(wrapper.text()).toContain('本月暂无事件');
    expect(wrapper.get('[data-statistic="court"] dd').text()).toBe('0');
    expect(wrapper.get('[data-statistic="contract"] dd').text()).toBe(
      '无查看权限',
    );
    expect(wrapper.get('.calendar-legend').text()).toContain(
      '协议到期 · 无查看权限',
    );
    expect(wrapper.get('.calendar-legend').text()).toContain(
      '缴费截止 · 未接入',
    );
  });
  it('recovers an invalid month using the Today action and server calendar day', async () => {
    const { wrapper, router } = await render('?month=bad&filter=retained');
    await wrapper.get('[aria-label="今天"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({
      filter: 'retained',
      month: '2026-10',
    });
    expect(api.summary).toHaveBeenCalledTimes(1);
    expect(wrapper.find('table').exists()).toBe(true);
  });
  it('switches month through URL history, returns to server current month, and keeps cross-month metrics', async () => {
    const { wrapper, router } = await render();
    await wrapper.get('[aria-label="下个月"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.month).toBe('2026-11');
    expect(wrapper.get('[data-statistic="court"] dd').text()).toBe('8');
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.query.month).toBe('2026-10');
    await wrapper.get('[aria-label="上个月"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.month).toBe('2026-09');
    await wrapper.get('[aria-label="回到本月"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.month).toBe('2026-10');
    expect(wrapper.get('[data-statistic="court"] dd').text()).toBe('8');
  });
  it.each(['resolve', 'reject'] as const)(
    'ignores an old month that %s after the new snapshot',
    async (completion) => {
      const old = deferred<CalendarSnapshot>();
      api.snapshot.mockReturnValueOnce(old.promise);
      const { wrapper, router } = await render();
      const oldSignal = api.snapshot.mock.calls[0]?.[1]?.signal;
      await router.push('/calendar?month=2026-11');
      await flushPromises();
      expect(oldSignal?.aborted).toBe(true);
      if (completion === 'resolve') old.resolve(snapshot());
      else old.reject(new ApiError('old', 403, 'FORBIDDEN'));
      await flushPromises();
      expect(wrapper.get('h2').text()).toBe('2026年11月');
      expect(wrapper.get('[data-statistic="court"] dd').text()).toBe('8');
      expect(wrapper.text()).not.toContain('已无权');
      expect(wrapper.find('.calendar-event').exists()).toBe(false);
    },
  );
  it('clears old data on failed refresh and retries without pretending failure is empty', async () => {
    const { wrapper } = await render();
    api.snapshot.mockRejectedValueOnce(new Error('network'));
    await wrapper.get('[aria-label="刷新日历"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('.calendar-event').exists()).toBe(false);
    expect(wrapper.text()).toContain('暂时无法加载');
    expect(wrapper.text()).not.toContain('本月暂无事件');
    expect(wrapper.get('[data-statistic="court"] dd').text()).toBe('暂不可用');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '重新加载')
      ?.trigger('click');
    await flushPromises();
    expect(wrapper.findAll('.calendar-event')).toHaveLength(3);
  });
  it.each([401, 403])(
    'removes stale events, tooltip and statistics after HTTP %i and can recover',
    async (status) => {
      const { wrapper } = await render();
      await wrapper
        .get(`[data-event-key="${event().eventKey}"]`)
        .trigger('focus');
      api.snapshot.mockRejectedValueOnce(
        new ApiError('raw sensitive message', status, 'FORBIDDEN'),
      );
      await wrapper.get('[aria-label="刷新日历"]').trigger('click');
      await flushPromises();
      expect(wrapper.find('table').exists()).toBe(false);
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
      expect(wrapper.text()).not.toContain('同名合成案件');
      expect(wrapper.text()).not.toContain('raw sensitive');
      expect(wrapper.get('[data-statistic="court"] dd').text()).toBe(
        '无查看权限',
      );
      expect(
        wrapper.get('[aria-label="下个月"]').attributes('disabled'),
      ).toBeDefined();
      await wrapper
        .findAll('button')
        .find((button) => button.text() === '重新加载')
        ?.trigger('click');
      await flushPromises();
      expect(wrapper.find('table').exists()).toBe(true);
    },
  );
  it('clears data synchronously on authorization revision change and ignores the former identity response', async () => {
    const { wrapper, auth } = await render();
    const old = deferred<CalendarSnapshot>();
    api.snapshot.mockReturnValueOnce(old.promise);
    await wrapper.get('[aria-label="刷新日历"]').trigger('click');
    const oldSignal = api.snapshot.mock.calls.at(-1)?.[1]?.signal;
    const pending = deferred<CalendarSnapshot>();
    api.snapshot.mockReturnValueOnce(pending.promise);
    auth.session = { ...session(), authorizationRevision: 2 };
    await nextTick();
    expect(oldSignal?.aborted).toBe(true);
    expect(wrapper.find('.calendar-event').exists()).toBe(false);
    expect(wrapper.get('[data-statistic="court"] dd').text()).toBe('加载中');
    old.resolve(snapshot());
    await flushPromises();
    expect(wrapper.find('.calendar-event').exists()).toBe(false);
    pending.resolve(snapshot('2026-10', [second]));
    await flushPromises();
    expect(wrapper.findAll('.calendar-event')).toHaveLength(1);
    auth.clear();
    await nextTick();
    expect(wrapper.find('.calendar-event').exists()).toBe(false);
    expect(wrapper.get('[data-statistic="court"] dd').text()).toBe(
      '无查看权限',
    );
    auth.session = session('CLIENT');
    await flushPromises();
    expect(wrapper.find('table').exists()).toBe(true);
  });
  it('does not request data for a notary principal', async () => {
    const { wrapper } = await render('?month=2026-10', 'NOTARY');
    expect(api.snapshot).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('暂无日历查看权限');
  });
  it.each([
    ['INTERNAL', '/cases'],
    ['CLIENT', '/client/cases'],
    ['LAWYER', '/lawyer/cases'],
  ] as const)(
    'navigates %s to the exact second case ID despite duplicate title and case number',
    async (principalType, prefix) => {
      const { wrapper, router } = await render('?month=2026-10', principalType);
      await wrapper
        .get(`[data-event-key="${second.eventKey}"]`)
        .trigger('click');
      await flushPromises();
      expect(router.currentRoute.value.path).toBe(`${prefix}/${second.caseId}`);
    },
  );
  it('shows an unlinked agreement notice without guessing a case or customer destination', async () => {
    const { wrapper, router } = await render();
    const push = vi.spyOn(router, 'push');
    await wrapper
      .get(`[data-event-key="${agreement.eventKey}"]`)
      .trigger('click');
    expect(wrapper.text()).toContain('未关联案件');
    expect(push).not.toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe('/calendar');
  });
  it('blocks repeated navigation while pending and recovers after rejection', async () => {
    const { wrapper, router } = await render();
    const pending = deferred<void>();
    const push = vi.spyOn(router, 'push').mockReturnValueOnce(pending.promise);
    const button = wrapper.get(`[data-event-key="${event().eventKey}"]`);
    await button.trigger('click');
    await button.trigger('click');
    expect(push).toHaveBeenCalledTimes(1);
    pending.reject(new Error('navigation failed'));
    await flushPromises();
    expect(wrapper.text()).toContain('页面跳转暂时失败');
    await button.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(`/cases/${event().caseId}`);
  });
  it('recovers from a route-guard aborted month change', async () => {
    const { wrapper, router } = await render();
    let rejectNext = true;
    router.beforeEach(() => {
      if (rejectNext) {
        rejectNext = false;
        return false;
      }
      return true;
    });
    await wrapper.get('[aria-label="下个月"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('页面跳转未完成');
    expect(router.currentRoute.value.query.month).toBe('2026-10');
    await wrapper.get('[aria-label="下个月"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.month).toBe('2026-11');
    expect(wrapper.text()).not.toContain('页面跳转未完成');
  });
  it('releases the navigation lock after a duplicate Today destination without reloading the snapshot', async () => {
    const { wrapper, router } = await render();
    await wrapper.get('[aria-label="今天"]').trigger('click');
    await flushPromises();
    expect(api.snapshot).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).not.toContain('页面跳转');
    await wrapper.get('[aria-label="下个月"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.month).toBe('2026-11');
  });
  it('cancels an in-flight request on unmount', async () => {
    const pending = deferred<CalendarSnapshot>();
    api.snapshot.mockReturnValueOnce(pending.promise);
    const { wrapper } = await render();
    const signal = api.snapshot.mock.calls[0]?.[1]?.signal;
    wrapper.unmount();
    expect(signal?.aborted).toBe(true);
    pending.resolve(snapshot());
    await flushPromises();
  });
  it('reports initial summary failure and can retry using server month', async () => {
    api.summary.mockRejectedValueOnce(new Error('summary failed'));
    const { wrapper, router } = await render('');
    expect(wrapper.text()).toContain('暂时无法加载');
    expect(api.snapshot).not.toHaveBeenCalled();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '重新加载')
      ?.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.month).toBe('2026-10');
    expect(wrapper.find('table').exists()).toBe(true);
  });
  it('rejects a mismatched snapshot month instead of showing it as current data', async () => {
    api.snapshot.mockResolvedValueOnce(snapshot('2026-11'));
    const { wrapper } = await render();
    expect(wrapper.text()).toContain('暂时无法加载');
    expect(wrapper.find('.calendar-event').exists()).toBe(false);
  });
});
