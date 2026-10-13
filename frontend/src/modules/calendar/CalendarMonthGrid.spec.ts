import { enableAutoUnmount, mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CalendarMonthGrid from './CalendarMonthGrid.vue';
import type { CalendarEvent, CalendarHearingEvent } from './calendar-month';

const first: CalendarHearingEvent = {
  eventKey: 'hearing-a',
  caseId: 'case-a',
  hearingAt: '2024-02-29',
  caseLabel: '同名合成案件',
};
const second = { ...first, eventKey: 'hearing-b', caseId: 'case-b' };
const court: CalendarEvent = {
  eventKey: 'second-trial-a',
  date: '2024-02-29',
  type: 'court',
  title: '二审开庭 · 合成法院',
  sub: '第二法庭',
  caseId: 'case-a',
  courtDetails: {
    party: '合成权利主体',
    defendant: '合成被告',
    reason: '商标侵权',
    time: '14:30',
    place: '合成法院第二法庭',
    judge: '合成法官',
  },
};
const payment: CalendarEvent = {
  eventKey: 'pay-a',
  date: '2024-02-29',
  type: 'pay',
  title: '缴费截止 · 诉讼费',
  sub: '合成案号',
  caseId: 'case-b',
  caseDetails: {
    customer: '合成客户',
    rightsHolder: '合成权利主体',
    defendant: '合成被告',
    caseNumber: '（2024）合成民初1号',
    amount: '12345678901234567890.01',
  },
};

enableAutoUnmount(afterEach);

function render(
  overrides: Partial<InstanceType<typeof CalendarMonthGrid>['$props']> = {},
) {
  return mount(CalendarMonthGrid, {
    props: {
      month: '2024-02',
      events: [first, second],
      canRead: true,
      ...overrides,
    },
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('CalendarMonthGrid', () => {
  it('labels only caller-declared missing sources without inventing events', () => {
    const wrapper = render({ events: [], unconnectedTypes: ['pay', 'other'] });
    expect(
      wrapper.findAll('.calendar-legend li').map((item) => item.text()),
    ).toEqual(['开庭', '缴费截止 · 未接入', '协议到期', '重要节点 · 未接入']);
    expect(wrapper.find('.calendar-event').exists()).toBe(false);
  });
  it('uses a general empty state when no event source type is supplied', () => {
    const wrapper = render({ events: [] });
    expect(wrapper.get('[role="status"]').text()).toBe('本月暂无事件。');
  });
  it('returns to the caller-provided current month and marks only a valid current day', async () => {
    const wrapper = render({ month: '2023-12', today: '2024-02-29' });
    await wrapper.get('[aria-label="回到本月"]').trigger('click');
    expect(wrapper.emitted('update:month')).toEqual([['2024-02']]);
    expect(wrapper.get('h2').text()).toBe('2023年12月');
    await wrapper.setProps({ month: '2024-02' });
    expect(
      wrapper.get('[data-date="2024-02-29"]').attributes('aria-current'),
    ).toBe('date');
    await wrapper.setProps({ today: '2024-02-30' });
    expect(wrapper.find('[aria-current="date"]').exists()).toBe(false);
    expect(
      wrapper.get('[aria-label="回到本月"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.setProps({ today: null });
    expect(
      wrapper.get('[aria-label="回到本月"]').attributes('disabled'),
    ).toBeDefined();
  });

  it('shows all four types, independent titles/sub, and multiple explicit trial events', () => {
    const wrapper = render({
      events: [
        court,
        { ...court, eventKey: 'first-trial', title: '一审开庭 · 另一法院' },
        payment,
        {
          eventKey: 'contract',
          date: '2024-02-29',
          type: 'contract',
          title: '协议到期',
          caseId: null,
        },
        {
          eventKey: 'other',
          date: '2024-02-29',
          type: 'other',
          title: '来源明确的重要节点',
          caseId: null,
        },
      ],
    });
    expect(wrapper.findAll('.calendar-event')).toHaveLength(5);
    expect(wrapper.get('.calendar-event-court').text()).toBe(court.title);
    expect(wrapper.text()).toContain('一审开庭 · 另一法院');
    expect(wrapper.find('.calendar-event-pay').exists()).toBe(true);
    expect(wrapper.find('.calendar-event-contract').exists()).toBe(true);
    expect(wrapper.find('.calendar-event-other').exists()).toBe(true);
    expect(wrapper.get('[aria-label="事件类型图例"]').text()).toContain(
      '开庭缴费截止协议到期重要节点',
    );
  });

  it('shows the six authorized court fields with title/sub on hover or focus', async () => {
    const wrapper = render({ events: [court] });
    const button = wrapper.get('.calendar-event');
    await button.trigger('mouseenter');
    await nextTick();
    const tip = document.querySelector('[role="tooltip"]');
    expect(tip?.textContent).toContain('二审开庭 · 合成法院');
    expect(tip?.textContent).toContain('第二法庭');
    expect(
      [...(tip?.querySelectorAll('dt') ?? [])].map((node) => node.textContent),
    ).toEqual([
      '权利主体',
      '被告',
      '侵权类型',
      '开庭日期',
      '开庭地点',
      '承办法官',
    ]);
    expect(
      [...(tip?.querySelectorAll('dd') ?? [])].map((node) => node.textContent),
    ).toEqual([
      '合成权利主体',
      '合成被告',
      '商标侵权',
      '2024-02-29 14:30',
      '合成法院第二法庭',
      '合成法官',
    ]);
    expect(button.attributes('aria-describedby')).toBe(tip?.id);
    await button.trigger('mouseleave');
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    await button.trigger('focus');
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    await button.trigger('blur');
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('shows authorized non-court fields without changing exact amount strings or guessing missing values', async () => {
    const wrapper = render({ events: [payment] });
    await wrapper.get('.calendar-event').trigger('focus');
    expect(
      [...document.querySelectorAll('[role="tooltip"] dt')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['客户', '权利主体', '被告', '案号', '标的额']);
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      '12345678901234567890.01',
    );
    await wrapper.setProps({
      events: [{ ...payment, caseDetails: { amount: '0.00' } }],
    });
    await wrapper.get('.calendar-event').trigger('focus');
    expect(
      [...document.querySelectorAll('[role="tooltip"] dd')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['未知', '未知', '未知', '未知', '0.00']);
  });

  it('uses an informational notice for an unassociated event and never guesses a case from its sub', async () => {
    const wrapper = render({
      events: [
        {
          eventKey: 'contract',
          type: 'contract',
          date: '2024-02-29',
          title: '协议到期',
          sub: '（2024）合成民初1号',
          caseId: null,
        },
      ],
    });
    await wrapper.get('.calendar-event').trigger('mouseenter');
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      '（2024）合成民初1号',
    );
    await wrapper.get('.calendar-event').trigger('click');
    expect(wrapper.emitted('openCase')).toBeUndefined();
    expect(wrapper.get('[role="status"]').text()).toBe(
      '协议到期 · （2024）合成民初1号 · 未关联案件。',
    );
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    await wrapper.setProps({ loading: true });
    expect(wrapper.text()).not.toContain('协议到期');
  });

  it('clamps tooltip positioning to the viewport and flips below an anchor near the top edge', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        return this.getAttribute('role') === 'tooltip'
          ? new DOMRect(0, 0, 340, 240)
          : new DOMRect(1000, 0, 24, 24);
      },
    );
    const wrapper = render({ events: [court] });
    await wrapper.get('.calendar-event').trigger('mouseenter');
    await nextTick();
    const tip = document.querySelector<HTMLElement>('[role="tooltip"]');
    expect(tip?.style.left).toBe(`${window.innerWidth - 340 - 8}px`);
    expect(tip?.style.top).toBe('32px');
    expect(tip?.style.visibility).toBe('visible');
  });

  it.each(['click', 'scroll', 'resize', 'escape'])(
    'closes an active tooltip on %s and cleans up on unmount',
    async (action) => {
      const wrapper = render({ events: [court] });
      await wrapper.get('.calendar-event').trigger('mouseenter');
      expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
      if (action === 'click') document.dispatchEvent(new MouseEvent('click'));
      else if (action === 'escape')
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      else window.dispatchEvent(new Event(action));
      await nextTick();
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
      await wrapper.get('.calendar-event').trigger('focus');
      wrapper.unmount();
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
    },
  );

  it.each([{ canRead: false }, { loading: true }, { error: '读取失败' }])(
    'clears teleported details and ignores stale activation when state changes to %j',
    async (state) => {
      const wrapper = render({ events: [court] });
      const button = wrapper.get('.calendar-event');
      await button.trigger('mouseenter');
      expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
        '合成法官',
      );
      await wrapper.setProps(state);
      await button.trigger('focus');
      await button.trigger('click');
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
      expect(document.body.textContent).not.toContain('合成法官');
      expect(wrapper.html()).not.toContain('合成法院');
      expect(wrapper.emitted('openCase')).toBeUndefined();
    },
  );

  it('drops old tooltip content after same-event details are updated, cleared or the month changes', async () => {
    const wrapper = render({ events: [court] });
    await wrapper.get('.calendar-event').trigger('focus');
    await wrapper.setProps({ events: [{ ...court, courtDetails: undefined }] });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    await wrapper.get('.calendar-event').trigger('focus');
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      '未知',
    );
    expect(
      document.querySelector('[role="tooltip"]')?.textContent,
    ).not.toContain('合成法官');
    const stale = wrapper.get('.calendar-event');
    await wrapper.setProps({ events: [{ ...court, date: null }] });
    await stale.trigger('click');
    expect(wrapper.emitted('openCase')).toBeUndefined();
    await wrapper.setProps({ month: '2024-03' });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('escapes event and tooltip text and keeps separate tooltip identities per instance', async () => {
    const hostile = {
      ...court,
      title: '<script>title()</script>',
      sub: '<img src=x onerror=attack()>',
      courtDetails: { judge: '<script>judge()</script>' },
    };
    const wrapper = mount({
      render: () =>
        h('div', [
          h(CalendarMonthGrid, {
            month: '2024-02',
            events: [hostile],
            canRead: true,
          }),
          h(CalendarMonthGrid, {
            month: '2024-02',
            events: [court],
            canRead: true,
          }),
        ]),
    });
    const buttons = wrapper.findAll('.calendar-event');
    await buttons[0]?.trigger('focus');
    await buttons[1]?.trigger('focus');
    const tips = [...document.querySelectorAll('[role="tooltip"]')];
    expect(tips).toHaveLength(2);
    expect(tips[0]?.id).not.toBe(tips[1]?.id);
    expect(document.querySelector('[role="tooltip"] script')).toBeNull();
    expect(document.querySelector('[role="tooltip"] img')).toBeNull();
    expect(tips[0]?.textContent).toContain('<script>judge()</script>');
  });

  it('renders a Sunday-first month with leap-day arrangements and exact case links', async () => {
    const wrapper = render();
    expect(wrapper.get('h2').text()).toBe('2024年2月');
    expect(wrapper.findAll('th').map((item) => item.text())).toEqual([
      '周日',
      '周一',
      '周二',
      '周三',
      '周四',
      '周五',
      '周六',
    ]);
    const buttons = wrapper.get('[data-date="2024-02-29"]').findAll('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.attributes('aria-label')).toContain('2024-02-29 开庭');
    await buttons[0]?.trigger('click');
    await buttons[1]?.trigger('click');
    expect(wrapper.emitted('openCase')).toEqual([['case-a'], ['case-b']]);
  });

  it('emits controlled month changes across years and waits for the parent update', async () => {
    const wrapper = render({ month: '2025-12' });
    await wrapper.get('[aria-label="下个月"]').trigger('click');
    expect(wrapper.emitted('update:month')).toEqual([['2026-01']]);
    expect(wrapper.get('h2').text()).toBe('2025年12月');
    await wrapper.setProps({ month: '2026-01' });
    await wrapper.get('[aria-label="上个月"]').trigger('click');
    expect(wrapper.emitted('update:month')?.at(-1)).toEqual(['2025-12']);
  });

  it('shows an empty calendar and clears arrangements when their date moves or is removed', async () => {
    const wrapper = render({ events: [first] });
    await wrapper.setProps({ events: [{ ...first, hearingAt: '2024-02-28' }] });
    expect(
      wrapper.get('[data-date="2024-02-29"]').find('button').exists(),
    ).toBe(false);
    expect(
      wrapper.get('[data-date="2024-02-28"]').find('button').exists(),
    ).toBe(true);
    await wrapper.setProps({ events: [{ ...first, hearingAt: null }] });
    expect(wrapper.find('.calendar-event').exists()).toBe(false);
    expect(wrapper.get('[role="status"]').text()).toBe('本月暂无开庭安排。');
    expect(wrapper.find('table').exists()).toBe(true);
    await wrapper.setProps({ events: [] });
    expect(wrapper.find('.calendar-event').exists()).toBe(false);
  });

  it('recomputes the visible month from current input, without retaining old-month events', async () => {
    const wrapper = render({ events: [first] });
    await wrapper.setProps({ month: '2024-03' });
    expect(wrapper.get('[role="status"]').text()).toContain('本月暂无');
    expect(
      wrapper.get('[data-date="2024-02-29"]').find('button').exists(),
    ).toBe(false);
    await wrapper.setProps({ events: [{ ...first, hearingAt: '2024-03-01' }] });
    expect(
      wrapper.get('[data-date="2024-03-01"]').find('button').exists(),
    ).toBe(true);
  });

  it('removes all sensitive event DOM on permission loss and blocks stale button clicks', async () => {
    const wrapper = render();
    const oldButton = wrapper.get('.calendar-event');
    await wrapper.setProps({ canRead: false, error: '同名合成案件读取失败' });
    expect(wrapper.get('[role="status"]').text()).toBe('暂无日历查看权限。');
    expect(wrapper.html()).not.toContain('同名合成案件');
    expect(wrapper.html()).not.toContain('case-a');
    expect(wrapper.find('table').exists()).toBe(false);
    await oldButton.trigger('click');
    await wrapper.get('[aria-label="下个月"]').trigger('click');
    expect(wrapper.emitted('openCase')).toBeUndefined();
    expect(wrapper.emitted('update:month')).toBeUndefined();
  });

  it('does not leak events when initially denied, including while loading', () => {
    const wrapper = render({ canRead: false, loading: true });
    expect(wrapper.text()).toContain('暂无日历查看权限');
    expect(wrapper.html()).not.toContain('同名合成案件');
    expect(wrapper.find('.calendar-event').exists()).toBe(false);
  });

  it('distinguishes loading and failure from empty data and blocks stale activation', async () => {
    const wrapper = render();
    const oldButton = wrapper.get('.calendar-event');
    await wrapper.setProps({ loading: true });
    expect(wrapper.attributes('aria-busy')).toBe('true');
    expect(wrapper.text()).toContain('正在加载开庭日历');
    expect(wrapper.text()).not.toContain('本月暂无');
    expect(wrapper.html()).not.toContain('同名合成案件');
    await oldButton.trigger('click');
    expect(wrapper.emitted('openCase')).toBeUndefined();
    await wrapper.setProps({
      loading: false,
      error: '开庭日历读取失败，请稍后重试。',
    });
    expect(wrapper.get('[role="alert"]').text()).toContain('读取失败');
    expect(wrapper.find('table').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('本月暂无');
    await wrapper.setProps({ error: null, events: [first] });
    expect(wrapper.findAll('.calendar-event')).toHaveLength(1);
  });

  it('shows an explicit unknown label while retaining the exact ID and escaping text', async () => {
    const wrapper = render({ events: [{ ...first, caseLabel: null }] });
    expect(wrapper.get('.calendar-event').text()).toContain('案件名称未提供');
    await wrapper.get('.calendar-event').trigger('click');
    expect(wrapper.emitted('openCase')).toEqual([['case-a']]);
    await wrapper.setProps({
      events: [{ ...first, caseLabel: '<script>attack()</script>' }],
    });
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.get('.calendar-event').text()).toContain('<script>');
  });

  it('handles invalid and boundary months without silently showing a different month', async () => {
    const wrapper = render({ month: '2024-13' });
    expect(wrapper.get('[role="alert"]').text()).toContain('月份无效');
    expect(wrapper.find('table').exists()).toBe(false);
    await wrapper.get('[aria-label="下个月"]').trigger('click');
    expect(wrapper.emitted('update:month')).toBeUndefined();
    await wrapper.setProps({ month: '0001-01' });
    expect(
      wrapper.get('[aria-label="上个月"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.setProps({ month: '9999-12' });
    expect(
      wrapper.get('[aria-label="下个月"]').attributes('disabled'),
    ).toBeDefined();
  });
});
