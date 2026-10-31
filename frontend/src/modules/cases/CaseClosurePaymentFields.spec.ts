import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import CaseClosurePaymentFields, {
  type ClosurePaymentRecord,
} from './CaseClosurePaymentFields.vue';

const first: ClosurePaymentRecord = {
  id: 'pay-1',
  paymentDate: '2026-10-28',
  amount: '1250.30',
  payer: '甲公司',
  payee: '乙公司',
  receiptName: '回款一.png',
};
const second: ClosurePaymentRecord = {
  id: 'pay-2',
  paymentDate: '2026-10-29',
  amount: '0.70',
  payer: '甲公司',
  payee: '乙公司',
};

function mountFields(
  records = [first],
  paymentType: 'ONE_TIME' | 'INSTALLMENTS' = 'ONE_TIME',
  disabled = false,
) {
  return mount(CaseClosurePaymentFields, {
    props: { records, paymentType, disabled },
  });
}

describe('CaseClosurePaymentFields', () => {
  it('clears a screenshot without changing the payment fields or other rows', async () => {
    const receiptFile = new File(['a'], 'receipt.png');
    const wrapper = mountFields(
      [{ ...first, receiptFile }, second],
      'INSTALLMENTS',
    );
    await wrapper.get('[data-test="clear-receipt-pay-1"]').trigger('click');
    const { receiptName: _name, ...retained } = first;
    void _name;
    expect(wrapper.emitted('update:records')?.at(-1)?.[0]).toEqual([
      retained,
      second,
    ]);
    const disabled = mountFields([{ ...first, receiptFile }], 'ONE_TIME', true);
    await disabled.get('[data-test="clear-receipt-pay-1"]').trigger('click');
    expect(disabled.emitted('update:records')).toBeUndefined();
    wrapper.unmount();
    disabled.unmount();
  });
  it('allows adding the first record for an empty one-time payment', async () => {
    const wrapper = mountFields([], 'ONE_TIME');
    expect(wrapper.findAll('.payment-record')).toHaveLength(0);
    await wrapper.get('[data-test="add-record"]').trigger('click');
    const added = wrapper.emitted(
      'update:records',
    )?.[0]?.[0] as ClosurePaymentRecord[];
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      paymentDate: '',
      amount: '',
      payer: '',
      payee: '',
    });
    wrapper.unmount();
  });

  it('renders existing records and emits typed string updates from real controls', async () => {
    const wrapper = mountFields([first, second], 'INSTALLMENTS');
    expect(wrapper.text()).toContain('回款一.png');
    expect(wrapper.findAll('.payment-record')).toHaveLength(2);

    await wrapper
      .get('[data-test="payment-date-pay-1"]')
      .setValue('2026-10-30');
    expect(wrapper.emitted('update:records')?.at(-1)?.[0]).toEqual([
      { ...first, paymentDate: '2026-10-30' },
      second,
    ]);

    await wrapper
      .get('[data-test="payment-amount-pay-2"]')
      .setValue('100000000000.01');
    expect(wrapper.emitted('update:records')?.at(-1)?.[0]).toEqual([
      first,
      { ...second, amount: '100000000000.01' },
    ]);
    wrapper.unmount();
  });

  it('prevents switching to one-time when multiple rows exist without changing or dropping them', async () => {
    const wrapper = mountFields([first, second], 'INSTALLMENTS');
    await wrapper.get('.el-select__wrapper').trigger('click');
    await flushPromises();
    const option = [
      ...document.body.querySelectorAll<HTMLElement>(
        '.el-select-dropdown__item',
      ),
    ].find((element) => element.textContent?.includes('一次性付款'));
    expect(option).toBeDefined();
    option!.click();
    await flushPromises();
    expect(wrapper.get('[data-test="switch-error"]').text()).toContain(
      '请先自行处理记录',
    );
    expect(wrapper.emitted('update:paymentType')).toBeUndefined();
    expect(wrapper.findAll('.payment-record')).toHaveLength(2);
    wrapper.unmount();
  });

  it('adds and removes installment rows and emits a selected receipt file without claiming upload', async () => {
    const wrapper = mountFields([first], 'INSTALLMENTS');
    await wrapper.get('[data-test="add-record"]').trigger('click');
    const added = wrapper.emitted(
      'update:records',
    )?.[0]?.[0] as ClosurePaymentRecord[];
    expect(added).toHaveLength(2);
    await wrapper.setProps({ records: added });
    await wrapper.get('[data-test="remove-pay-1"]').trigger('click');
    expect(wrapper.emitted('update:records')?.at(-1)?.[0]).toEqual([added[1]]);

    const input = wrapper.get('[data-test="payment-receipt-pay-1"]');
    const file = new File(['image bytes'], '回款截图.png', {
      type: 'image/png',
    });
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [file],
    });
    await input.trigger('change');
    expect(wrapper.emitted('receipt-selected')?.[0]).toEqual(['pay-1', file]);
    const changed = wrapper
      .emitted('update:records')
      ?.at(-1)?.[0] as ClosurePaymentRecord[];
    expect(changed.find((record) => record.id === 'pay-1')).toEqual({
      ...first,
      receiptFile: file,
      receiptName: file.name,
    });
    wrapper.unmount();
  });

  it('disables all editing controls when disabled', async () => {
    const wrapper = mountFields([first], 'INSTALLMENTS', true);
    expect(
      (wrapper.get('[data-test="add-record"]').element as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        wrapper.get('[data-test="payment-receipt-pay-1"]')
          .element as HTMLInputElement
      ).disabled,
    ).toBe(true);
    await wrapper.get('[data-test="remove-pay-1"]').trigger('click');
    expect(wrapper.emitted('update:records')).toBeUndefined();
    wrapper.unmount();
  });
});
