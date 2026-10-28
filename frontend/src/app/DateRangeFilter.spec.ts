import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import DateRangeFilter from './DateRangeFilter.vue';

describe('DateRangeFilter', () => {
  it('shows the start and end independently and preserves one-sided ranges', async () => {
    const wrapper = mount(DateRangeFilter, {
      props: {
        label: '开庭日期',
        start: '',
        end: '',
        startLabel: '起始日期',
        endLabel: '结束日期',
      },
    });
    const summary = wrapper.get('summary');
    const displayed = summary.findAll('.range-value');
    expect(displayed.map((value) => value.text())).toEqual([
      '开始日期',
      '结束日期',
    ]);

    await wrapper.setProps({ start: '2026-03-04' });
    expect(displayed.map((value) => value.text())).toEqual([
      '2026-03-04',
      '结束日期',
    ]);
    await wrapper.setProps({ start: '', end: '2026-03-31' });
    expect(displayed.map((value) => value.text())).toEqual([
      '开始日期',
      '2026-03-31',
    ]);
    const inputs = wrapper.findAll('input[type="date"]');
    expect(inputs).toHaveLength(2);
    await inputs[0]!.setValue('2026-03-04');
    expect(wrapper.emitted('update:start')?.at(-1)).toEqual(['2026-03-04']);
    await wrapper.get('.panel-actions button').trigger('click');
    expect(wrapper.emitted('update:start')?.at(-1)).toEqual([undefined]);
    expect(wrapper.emitted('update:end')?.at(-1)).toEqual([undefined]);
  });
});
