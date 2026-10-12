import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import CalendarMonthGrid from './CalendarMonthGrid.vue';
import type { CalendarHearingEvent } from './calendar-month';

const first: CalendarHearingEvent = {
  eventKey: 'hearing-a',
  caseId: 'case-a',
  hearingAt: '2024-02-29',
  caseLabel: '同名合成案件',
};
const second = { ...first, eventKey: 'hearing-b', caseId: 'case-b' };

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
