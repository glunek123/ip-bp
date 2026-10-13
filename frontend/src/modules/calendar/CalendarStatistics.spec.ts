import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { CalendarSummary } from '../../api/calendar';
import CalendarStatistics from './CalendarStatistics.vue';

enableAutoUnmount(afterEach);
const metrics: CalendarSummary['metrics'] = {
  next30: { state: 'AVAILABLE', count: 3, nearestDate: '2026-10-15' },
  court: { state: 'AVAILABLE', count: 8, nearestDate: '2026-10-15' },
  pay: { state: 'NOT_CONNECTED', count: null, nearestDate: null },
  contract: { state: 'AVAILABLE', count: 0, nearestDate: null },
  other: { state: 'NOT_CONNECTED', count: null, nearestDate: null },
};
const window = { from: '2026-10-13', through: '2026-11-12' };

describe('CalendarStatistics', () => {
  it('shows five server metrics, nearest dates, and the server window with zero distinct from missing source', () => {
    const wrapper = mount(CalendarStatistics, {
      props: { metrics, window, canRead: true },
    });
    expect(wrapper.findAll('dt').map((card) => card.text())).toEqual([
      '30天内待办',
      '开庭',
      '缴费截止',
      '协议到期',
      '重要节点',
    ]);
    expect(wrapper.findAll('dd').map((card) => card.text())).toEqual([
      '3',
      '8',
      '未接入',
      '0',
      '未接入',
    ]);
    expect(wrapper.text()).toContain('不随切月变化');
    expect(wrapper.text()).toContain('2026-10-13至2026-11-12，含两端');
    expect(wrapper.text()).toContain('未接入类别不计入');
    expect(wrapper.findAll('time')).toHaveLength(2);
    expect(wrapper.get('time').attributes('datetime')).toBe('2026-10-15');
  });
  it('distinguishes a forbidden source from a missing source', () => {
    const wrapper = mount(CalendarStatistics, {
      props: {
        metrics: {
          ...metrics,
          contract: { state: 'FORBIDDEN', count: null, nearestDate: null },
        },
        window,
        canRead: true,
      },
    });
    expect(wrapper.get('[data-statistic="contract"] dd').text()).toBe(
      '无查看权限',
    );
    expect(wrapper.get('[data-statistic="pay"] dd').text()).toBe('未接入');
  });
  it('hides previous metrics and nearest dates during loading, failure, and permission loss', async () => {
    const wrapper = mount(CalendarStatistics, {
      props: { metrics, window, canRead: true },
    });
    await wrapper.setProps({ loading: true });
    expect(
      wrapper.findAll('dd').every((card) => card.text() === '加载中'),
    ).toBe(true);
    expect(wrapper.find('time').exists()).toBe(false);
    await wrapper.setProps({ loading: false, error: '读取失败' });
    expect(
      wrapper.findAll('dd').every((card) => card.text() === '暂不可用'),
    ).toBe(true);
    await wrapper.setProps({ canRead: false });
    expect(
      wrapper.findAll('dd').every((card) => card.text() === '无查看权限'),
    ).toBe(true);
    expect(wrapper.find('p').exists()).toBe(false);
    await wrapper.setProps({ canRead: true, error: null });
    expect(wrapper.get('[data-statistic="court"] dd').text()).toBe('8');
  });
  it('does not label an absent response as zero or unconnected', () => {
    const wrapper = mount(CalendarStatistics, {
      props: { metrics: null, window: null, canRead: true },
    });
    expect(
      wrapper.findAll('dd').every((card) => card.text() === '待加载'),
    ).toBe(true);
    expect(wrapper.find('p').exists()).toBe(false);
  });
});
