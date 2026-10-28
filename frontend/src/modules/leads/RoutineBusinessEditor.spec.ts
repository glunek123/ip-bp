import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import RoutineBusinessEditor from './RoutineBusinessEditor.vue';

const product = {
  id: 'product-1',
  title: '原商品',
  url: 'https://example.com/old',
  quantity: 2,
  unitPrice: '5.00',
};

describe('ordinary business editor', () => {
  it('starts with current values, saves only editable fields, and does not modify its inputs', async () => {
    const wrapper = mount(RoutineBusinessEditor, {
      props: { shopName: '原店铺', products: [product], pending: false },
    });
    expect(
      wrapper.get<HTMLInputElement>('[data-test="routine-shop"]').element.value,
    ).toBe('原店铺');
    await wrapper.get('[data-test="routine-shop"]').setValue('新店铺');
    await wrapper.get('[data-test="routine-product-title"]').setValue('新商品');
    await wrapper.get('[data-test="routine-product-quantity"]').setValue('3');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({
      shopName: '新店铺',
      products: [{ ...product, title: '新商品', quantity: 3 }],
    });
    expect(product.title).toBe('原商品');
  });

  it('cancels without saving and blocks invalid prices, links, and quantity', async () => {
    const wrapper = mount(RoutineBusinessEditor, {
      props: { shopName: '店铺', products: [product], pending: false },
    });
    for (const [selector, value] of [
      ['[data-test="routine-product-price"]', '-1'],
      ['[data-test="routine-product-url"]', 'javascript:alert(1)'],
      ['[data-test="routine-product-quantity"]', '-1'],
    ]) {
      await wrapper.get(selector).setValue(value);
      await wrapper.get('form').trigger('submit');
      expect(wrapper.emitted('save')).toBeUndefined();
      await wrapper
        .get(selector)
        .setValue(
          selector.includes('price')
            ? '5.00'
            : selector.includes('url')
              ? product.url
              : '2',
        );
    }
    await wrapper.get('[data-test="routine-cancel"]').trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
    expect(wrapper.emitted('save')).toBeUndefined();
  });
});
