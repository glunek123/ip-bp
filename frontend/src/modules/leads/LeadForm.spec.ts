import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
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
  await wrapper.get('input[name="needDisclose"][value="false"]').setValue(true);
}

describe('LeadForm', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('groups formal fields without changing their control names', () => {
    const wrapper = mount(LeadForm, { props: { context } });

    expect(wrapper.get('form').classes()).toContain('demo-form');
    expect(
      wrapper
        .get('[data-test="lead-facts-section"]')
        .find('select[name="customerId"]')
        .exists(),
    ).toBe(true);
    expect(
      wrapper
        .get('[data-test="products-section"]')
        .find('input[name="productTitle-0"]')
        .exists(),
    ).toBe(true);
    expect(
      wrapper
        .get('[data-test="products-section"]')
        .find('[data-test="product-screenshots-0"]')
        .exists(),
    ).toBe(true);
  });

  it('automatically selects the only rights holder and requires a choice for many', async () => {
    const wrapper = mount(LeadForm, { props: { context } });
    await wrapper.get('select[name="customerId"]').setValue('customer-a');
    await wrapper.get('select[name="rightsHolderId"]').setValue('holder-b');
    await wrapper.get('select[name="customerId"]').setValue('customer-b');
    expect(
      (
        wrapper.get('select[name="rightsHolderId"]')
          .element as HTMLSelectElement
      ).value,
    ).toBe('holder-c');
    expect(wrapper.text()).toContain('已按客户自动带出');
    expect(
      wrapper
        .get('select[name="rightsHolderId"]')
        .attributes('aria-describedby'),
    ).toContain('rights-holder-guidance');
    expect(wrapper.get('select[name="rightsHolderId"]').text()).toContain(
      '主体丙',
    );
    expect(wrapper.get('select[name="rightsHolderId"]').text()).not.toContain(
      '主体甲',
    );

    await wrapper.get('select[name="customerId"]').setValue('customer-a');
    expect(
      (
        wrapper.get('select[name="rightsHolderId"]')
          .element as HTMLSelectElement
      ).value,
    ).toBe('');
    expect(wrapper.text()).toContain(
      '该客户有多个权利主体，请选择本线索对应的一项',
    );
  });

  it('uses business wording and explains the estimate', () => {
    const wrapper = mount(LeadForm, { props: { context } });

    expect(wrapper.text()).toContain('权利主体');
    expect(wrapper.text()).toContain('案件类型');
    expect(wrapper.text()).not.toContain('发现平台');
    expect(wrapper.text()).toContain('平台店铺ID（选填）');
    expect(wrapper.text()).toContain('销量');
    expect(wrapper.text()).toContain('计算金额（元）');
    expect(wrapper.text()).toContain('销量为 0 时改用评论数');
    expect(wrapper.text()).toContain('商品链接和商品名称至少填写一项');
    expect(
      wrapper.get('input[name="productUrl-0"]').attributes('aria-describedby'),
    ).toBe('product-entry-guidance-0');
    expect(
      wrapper.get('input[name="quantity-0"]').attributes('aria-describedby'),
    ).toBe('product-estimate-guidance-0');
    expect(wrapper.find('[data-test="product-screenshots-0"]').exists()).toBe(
      true,
    );
    expect(
      wrapper
        .get('[data-test="product-entry-guidance-0"]')
        .find('.required-mark')
        .exists(),
    ).toBe(true);
    expect(wrapper.text()).toContain('申请披露店铺经营者信息');
    expect(wrapper.findAll('.required-mark').length).toBeGreaterThan(0);
  });

  it('requires an explicit disclosure choice and focuses the choice before submission', async () => {
    const wrapper = mount(LeadForm, {
      attachTo: document.body,
      props: { context },
    });
    expect(
      wrapper
        .findAll('input[name="needDisclose"]')
        .every((input) => !(input.element as HTMLInputElement).checked),
    ).toBe(true);
    wrapper.unmount();
    const unselected = mount(LeadForm, {
      attachTo: document.body,
      props: {
        context,
        initialValue: {
          customerId: 'customer-a',
          rightsHolderId: 'holder-a',
          caseType: 'CIVIL',
          infringementTypes: ['TRADEMARK'],
          source: 'ONLINE',
          platform: 'TAOBAO',
          foundAt: '2026-09-21T04:00:00Z',
          shopName: '测试店铺',
          products: [
            {
              title: '商品甲',
              quantity: 3,
              unitPrice: '0.10',
              commentCount: 9,
            },
          ],
        },
      },
    });
    await unselected.get('form').trigger('submit');
    expect(unselected.emitted('submit')).toBeUndefined();
    expect(unselected.text()).toContain('请选择是否申请披露店铺经营者信息');
    expect(document.activeElement).toBe(
      unselected.get('input[name="needDisclose"][value="true"]').element,
    );
    await unselected
      .get('input[name="needDisclose"][value="true"]')
      .setValue(true);
    await unselected.get('form').trigger('submit');
    expect(unselected.emitted('submit')?.[0]?.[0]).toMatchObject({
      fields: { needDisclose: true },
    });
    unselected.unmount();
  });

  it.each([true, false])(
    'preserves the existing disclosure boolean %s on edit',
    async (value) => {
      const wrapper = mount(LeadForm, {
        props: {
          context,
          customerLocked: true,
          initialValue: {
            customerId: 'customer-a',
            rightsHolderId: 'holder-b',
            needDisclose: value,
            caseType: 'CIVIL',
            infringementTypes: ['TRADEMARK'],
            source: 'ONLINE',
            platform: 'TAOBAO',
            foundAt: '2026-09-21T04:00:00Z',
            shopName: '测试店铺',
            products: [
              {
                title: '商品甲',
                quantity: 3,
                unitPrice: '0.10',
                commentCount: 9,
              },
            ],
          },
        },
      });
      expect(
        (
          wrapper.get(`input[name="needDisclose"][value="${value}"]`)
            .element as HTMLInputElement
        ).checked,
      ).toBe(true);
      expect(
        wrapper.get('select[name="customerId"]').attributes('disabled'),
      ).toBeDefined();
      expect(
        wrapper.get('select[name="rightsHolderId"]').attributes('disabled'),
      ).toBeDefined();
      await wrapper.get('form').trigger('submit');
      expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
        fields: {
          customerId: 'customer-a',
          rightsHolderId: 'holder-b',
          needDisclose: value,
        },
      });
    },
  );

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
    expect(wrapper.text()).toContain('商品链接和名称至少填写一项');
    expect(wrapper.text()).toContain('销量必须是非负整数');
    expect(wrapper.text()).toContain('金额最多保留两位小数');
    expect(wrapper.emitted('submit')).toBeUndefined();
    wrapper.unmount();
  });

  it('adds/removes products and previews estimates without floating-point drift', async () => {
    const wrapper = mount(LeadForm, { props: { context } });
    await fillRequired(wrapper);
    expect(wrapper.get('[data-test="estimate-0"]').text()).toContain('0.30');
    const dirtyCountBeforeAdd = wrapper.emitted('dirty')?.length ?? 0;
    await wrapper.get('[data-test="add-product"]').trigger('click');
    expect(wrapper.findAll('[data-test="product-row"]')).toHaveLength(2);
    expect(wrapper.emitted('dirty')).toHaveLength(dirtyCountBeforeAdd + 1);
    await wrapper.get('[data-test="remove-product-1"]').trigger('click');
    expect(wrapper.findAll('[data-test="product-row"]')).toHaveLength(1);
    expect(wrapper.emitted('dirty')).toHaveLength(dirtyCountBeforeAdd + 2);
  });

  it('rejects more than 20 screenshots and emits files separately from API fields', async () => {
    const wrapper = mount(LeadForm, { props: { context } });
    await fillRequired(wrapper);
    const input = wrapper.get('[data-test="product-screenshots-0"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: Array.from(
        { length: 21 },
        (_, index) => new File(['x'], `${index}.png`, { type: 'image/png' }),
      ),
    });
    await input.trigger('change');
    expect(wrapper.text()).toContain('所有商品截图合计最多 20 份');
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
    expect(payload.productScreenshotFiles).toHaveLength(1);
    expect(
      (payload.productScreenshotFiles as Array<{ files: File[] }>)[0]?.files,
    ).toHaveLength(1);
    expect(payload.fields).toMatchObject({
      customerId: 'customer-a',
      rightsHolderId: 'holder-a',
      infringementTypes: ['TRADEMARK'],
      products: [{ unitPrice: '0.10', quantity: 3, commentCount: 9 }],
      needDisclose: false,
    });
    expect(payload.fields).not.toHaveProperty('status');
    expect(payload.fields).not.toHaveProperty('estimatedAmount');
  });

  it.each([
    ['productTitle-0', ''],
    ['quantity-0', '-1'],
    ['unitPrice-0', '1.999'],
    ['commentCount-0', '-1'],
  ])('focuses the first invalid product field %s', async (name, value) => {
    const wrapper = mount(LeadForm, {
      attachTo: document.body,
      props: { context },
    });
    await fillRequired(wrapper);
    await wrapper.get(`[name="${name}"]`).setValue(value);
    await wrapper.get('form').trigger('submit');

    expect((document.activeElement as HTMLInputElement).name).toBe(name);
    wrapper.unmount();
  });
});
