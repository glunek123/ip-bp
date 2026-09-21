import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import LeadForm from './LeadForm.vue';

const context = {
  customers: [
    {
      id: 'customer-a',
      name: '客户甲',
      rightsHolders: [
        { id: 'holder-a', name: '主体甲' },
        { id: 'holder-b', name: '主体乙' },
      ],
    },
    {
      id: 'customer-b',
      name: '客户乙',
      rightsHolders: [{ id: 'holder-c', name: '主体丙' }],
    },
  ],
  dictionaries: {
    caseTypes: [{ value: 'CIVIL', label: '民事' }],
    infringementTypes: [
      { value: 'TRADEMARK', label: '商标权' },
      { value: 'ART_COPYRIGHT', label: '美术作品著作权' },
    ],
    sources: [
      { value: 'ONLINE', label: '线上' },
      { value: 'OFFLINE', label: '线下' },
    ],
    platforms: {
      ONLINE: [{ value: 'TAOBAO', label: '淘宝' }],
      OFFLINE: [{ value: 'MAP', label: '地图' }],
    },
  },
} as const;

async function fillRequired(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('select[name="customerId"]').setValue('customer-a');
  await wrapper.get('select[name="rightsHolderId"]').setValue('holder-a');
  await wrapper.get('select[name="caseType"]').setValue('CIVIL');
  await wrapper.get('input[value="TRADEMARK"]').setValue(true);
  await wrapper.get('select[name="source"]').setValue('ONLINE');
  await wrapper.get('select[name="platform"]').setValue('TAOBAO');
  await wrapper.get('input[name="foundAt"]').setValue('2026-09-21T12:00');
  await wrapper.get('input[name="shopName"]').setValue('测试店铺');
  await wrapper.get('input[name="productTitle-0"]').setValue('商品甲');
  await wrapper.get('input[name="quantity-0"]').setValue('3');
  await wrapper.get('input[name="unitPrice-0"]').setValue('0.10');
  await wrapper.get('input[name="commentCount-0"]').setValue('9');
}

describe('LeadForm', () => {
  it('links admitted customers to only their rights holders and clears a hidden relation', async () => {
    const wrapper = mount(LeadForm, { props: { context } });
    await wrapper.get('select[name="customerId"]').setValue('customer-a');
    await wrapper.get('select[name="rightsHolderId"]').setValue('holder-b');
    await wrapper.get('select[name="customerId"]').setValue('customer-b');
    expect(
      (
        wrapper.get('select[name="rightsHolderId"]')
          .element as HTMLSelectElement
      ).value,
    ).toBe('');
    expect(wrapper.get('select[name="rightsHolderId"]').text()).toContain(
      '主体丙',
    );
    expect(wrapper.get('select[name="rightsHolderId"]').text()).not.toContain(
      '主体甲',
    );
  });

  it('resets only an incompatible platform when source changes', async () => {
    const wrapper = mount(LeadForm, { props: { context } });
    await wrapper.get('select[name="source"]').setValue('ONLINE');
    await wrapper.get('select[name="platform"]').setValue('TAOBAO');
    await wrapper.get('select[name="source"]').setValue('OFFLINE');
    expect(
      (wrapper.get('select[name="platform"]').element as HTMLSelectElement)
        .value,
    ).toBe('');
    expect(wrapper.get('select[name="platform"]').text()).toContain('地图');
  });

  it('validates multi-select, product identity, counts, decimal money and focuses first error', async () => {
    const wrapper = mount(LeadForm, {
      attachTo: document.body,
      props: { context },
    });
    await wrapper.get('form').trigger('submit');
    expect(wrapper.text()).toContain('请选择客户');
    expect(document.activeElement).toBe(
      wrapper.get('select[name="customerId"]').element,
    );

    await fillRequired(wrapper);
    await wrapper.get('input[name="productTitle-0"]').setValue('');
    await wrapper.get('input[name="quantity-0"]').setValue('-1');
    await wrapper.get('input[name="unitPrice-0"]').setValue('1.999');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.text()).toContain('商品链接和标题至少填写一项');
    expect(wrapper.text()).toContain('数量必须是非负整数');
    expect(wrapper.text()).toContain('金额最多保留两位小数');
    expect(wrapper.emitted('submit')).toBeUndefined();
    wrapper.unmount();
  });

  it('adds/removes products and previews estimates without floating-point drift', async () => {
    const wrapper = mount(LeadForm, { props: { context } });
    await fillRequired(wrapper);
    expect(wrapper.get('[data-test="estimate-0"]').text()).toContain('0.30');
    await wrapper.get('[data-test="add-product"]').trigger('click');
    expect(wrapper.findAll('[data-test="product-row"]')).toHaveLength(2);
    await wrapper.get('[data-test="remove-product-1"]').trigger('click');
    expect(wrapper.findAll('[data-test="product-row"]')).toHaveLength(1);
  });

  it('rejects more than 20 screenshots and emits files separately from API fields', async () => {
    const wrapper = mount(LeadForm, { props: { context } });
    await fillRequired(wrapper);
    const input = wrapper.get('input[name="screenshots"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: Array.from(
        { length: 21 },
        (_, index) => new File(['x'], `${index}.png`, { type: 'image/png' }),
      ),
    });
    await input.trigger('change');
    expect(wrapper.text()).toContain('最多选择 20 份截图');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toBeUndefined();

    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['x'], 'evidence.png', { type: 'image/png' })],
    });
    await input.trigger('change');
    await wrapper.get('form').trigger('submit');
    const payload = wrapper.emitted('submit')?.[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(payload.screenshotFiles).toHaveLength(1);
    expect(payload.fields).toMatchObject({
      customerId: 'customer-a',
      rightsHolderId: 'holder-a',
      infringementTypes: ['TRADEMARK'],
      products: [{ unitPrice: '0.10', quantity: 3, commentCount: 9 }],
    });
    expect(payload.fields).not.toHaveProperty('status');
    expect(payload.fields).not.toHaveProperty('estimatedAmount');
  });
});
