import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import CaseEarlyClosureForm from './CaseEarlyClosureForm.vue';

describe('CaseEarlyClosureForm', () => {
  it('emits an isolated draft with selected files but performs no upload or API action', async () => {
    const wrapper = mount(CaseEarlyClosureForm);
    await wrapper.get('[data-test="close-date"]').setValue('2026-10-28');
    await wrapper.get('[data-test="close-amount"]').setValue('0');

    await wrapper.get('[data-test="add-record"]').trigger('click');
    const row = wrapper.get('.payment-record');
    await row.get('input[type="date"]').setValue('2026-10-27');
    await row.get('[aria-label="金额"]').setValue('125.50');
    await row.get('[aria-label="付款人"]').setValue('甲方');
    await row.get('[aria-label="收款人"]').setValue('乙方');

    const document = new File(['doc'], '结案文书.pdf', {
      type: 'application/pdf',
    });
    const input = wrapper.get('[data-test="closure-documents"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [document],
    });
    await input.trigger('change');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.emitted('document-selected')?.[0]).toEqual([document]);
    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      closeAt: '2026-10-28',
      closeAmountState: 'KNOWN',
      closeAmt: '0',
      closeDocuments: [document],
      paymentType: 'ONE_TIME',
      paymentRecords: [
        expect.objectContaining({
          paymentDate: '2026-10-27',
          amount: '125.50',
          payer: '甲方',
          payee: '乙方',
        }),
      ],
    });
    wrapper.unmount();
  });

  it('blocks invalid required fields and allows an unknown amount and no documents or payments', async () => {
    const wrapper = mount(CaseEarlyClosureForm);
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.find('[data-test="date-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="amount-error"]').exists()).toBe(true);

    await wrapper.get('[data-test="close-date"]').setValue('2026-10-29');
    await wrapper.get('[data-test="amount-state"]').setValue('PENDING');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')?.at(-1)?.[0]).toMatchObject({
      closeAt: '2026-10-29',
      closeAmountState: 'PENDING',
      closeAmt: null,
      closeDocuments: [],
      paymentRecords: [],
    });
    wrapper.unmount();
  });

  it.each(['0', '0.0', '0.00', '00000000000000.00'])(
    'blocks zero actual payment %s but accepts the minimum positive amount',
    async (amount) => {
      const wrapper = mount(CaseEarlyClosureForm);
      await wrapper.get('[data-test="close-date"]').setValue('2026-10-29');
      await wrapper.get('[data-test="close-amount"]').setValue('0');
      await wrapper.get('[data-test="add-record"]').trigger('click');
      const row = wrapper.get('.payment-record');
      await row.get('input[type="date"]').setValue('2026-10-29');
      await row.get('[aria-label="金额"]').setValue(amount);
      await row.get('[aria-label="付款人"]').setValue('甲');
      await row.get('[aria-label="收款人"]').setValue('乙');
      await wrapper.get('form').trigger('submit');
      expect(wrapper.emitted('submit')).toBeUndefined();
      expect(wrapper.text()).toContain('大于零');
      await row.get('[aria-label="金额"]').setValue('0.01');
      await wrapper.get('form').trigger('submit');
      expect(wrapper.emitted('submit')?.at(-1)?.[0]).toMatchObject({
        closeAmt: '0',
      });
      wrapper.unmount();
    },
  );

  it('does not submit partially completed payment records', async () => {
    const wrapper = mount(CaseEarlyClosureForm);
    await wrapper.get('[data-test="close-date"]').setValue('2026-10-29');
    await wrapper.get('[data-test="close-amount"]').setValue('100');
    await wrapper.get('[data-test="add-record"]').trigger('click');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.find('[data-test="payment-error"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('blocks more documents than the closure command accepts', async () => {
    const wrapper = mount(CaseEarlyClosureForm);
    await wrapper.get('[data-test="close-date"]').setValue('2026-10-29');
    await wrapper.get('[data-test="close-amount"]').setValue('100');
    const input = wrapper.get('[data-test="closure-documents"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: Array.from(
        { length: 11 },
        (_, index) =>
          new File(['doc'], `结案文书-${index}.pdf`, {
            type: 'application/pdf',
          }),
      ),
    });
    await input.trigger('change');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.text()).toContain('结案文书最多上传 10 份');
    wrapper.unmount();
  });
});
