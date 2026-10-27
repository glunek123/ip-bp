import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import ProductScreenshotsRow from './ProductScreenshotsRow.vue';

describe('ProductScreenshotsRow', () => {
  it('shows exact versions and emits preview, removal, and replacement actions', async () => {
    const item = {
      versionId: 'version-1',
      materialId: 'material-1',
      filename: '商品截图.png',
    };
    const wrapper = mount(ProductScreenshotsRow, {
      props: { items: [item], canEdit: true },
    });
    expect(wrapper.text()).toContain('商品截图.png');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('preview')?.[0]).toEqual([item]);
    await wrapper.findAll('button')[1]!.trigger('click');
    expect(wrapper.emitted('download')?.[0]).toEqual([item]);
    await wrapper.findAll('button')[2]!.trigger('click');
    expect(wrapper.emitted('remove')?.[0]).toEqual(['version-1']);
    const input = wrapper.get('input[type="file"]');
    expect(wrapper.get('[data-test="select-product-screenshots"]').text()).toBe(
      '替换截图',
    );
    const pickerClick = vi.spyOn(
      input.element as InstanceType<typeof globalThis.HTMLInputElement>,
      'click',
    );
    await wrapper
      .get('[data-test="select-product-screenshots"]')
      .trigger('click');
    expect(pickerClick).toHaveBeenCalledOnce();
    const file = new File(['image'], 'new.png', { type: 'image/png' });
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [file],
    });
    await input.trigger('change');
    expect(wrapper.emitted('replace')?.[0]).toEqual([[file]]);
  });

  it('keeps archived screenshots read-only', () => {
    const wrapper = mount(ProductScreenshotsRow, {
      props: { items: [], canEdit: false },
    });
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
  });

  it('uses an add label when no screenshot is attached', () => {
    const wrapper = mount(ProductScreenshotsRow, {
      props: { items: [], canEdit: true },
    });
    expect(wrapper.get('[data-test="select-product-screenshots"]').text()).toBe(
      '添加截图',
    );
  });
});
