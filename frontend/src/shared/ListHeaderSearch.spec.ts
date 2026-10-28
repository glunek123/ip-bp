import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import ListHeaderSearch from './ListHeaderSearch.vue';

afterEach(() => {
  document.getElementById('module-list-search')?.remove();
});
describe('ListHeaderSearch', () => {
  it('places search next to breadcrumbs and emits edits, enter and clear', async () => {
    const target = document.createElement('div');
    target.id = 'module-list-search';
    document.body.append(target);
    const wrapper = mount(ListHeaderSearch, {
      props: { modelValue: '旧值', placeholder: '搜索编号' },
    });
    await wrapper.vm.$nextTick();
    const input = target.querySelector('input')!;
    expect(input.placeholder).toBe('搜索编号');
    input.value = '新值';
    input.dispatchEvent(new Event('input'));
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['新值']);
    target
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    expect(wrapper.emitted('search')).toHaveLength(1);
    target.querySelector('button')!.click();
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['']);
    expect(wrapper.emitted('search')).toHaveLength(2);
    wrapper.unmount();
  });
  it('still renders when mounted outside the app shell', () => {
    const wrapper = mount(ListHeaderSearch, {
      props: { modelValue: '', placeholder: '搜索' },
    });
    expect(wrapper.find('input').exists()).toBe(true);
  });
});
