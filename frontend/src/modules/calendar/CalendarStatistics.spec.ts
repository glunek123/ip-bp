import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import CalendarStatistics from './CalendarStatistics.vue';

enableAutoUnmount(afterEach);
const counts = { upcoming30: 3, court: 8, pay: null, contract: 0, other: null };

describe('CalendarStatistics', () => {
  it('shows five server counts and distinguishes zero from an unavailable source', () => {
    const wrapper = mount(CalendarStatistics, {
      props: { counts, canRead: true },
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
    expect(wrapper.text()).toContain('未接入类别不计入');
  });

  it('hides previous counts during loading, failure, and permission loss', async () => {
    const wrapper = mount(CalendarStatistics, {
      props: { counts, canRead: true },
    });
    await wrapper.setProps({ loading: true });
    expect(
      wrapper.findAll('dd').every((card) => card.text() === '加载中'),
    ).toBe(true);
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

  it('does not label absent response counts as either zero or unconnected', () => {
    const wrapper = mount(CalendarStatistics, {
      props: { counts: null, canRead: true },
    });
    expect(
      wrapper.findAll('dd').every((card) => card.text() === '待加载'),
    ).toBe(true);
    expect(wrapper.find('p').exists()).toBe(false);
  });
});
