import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import Form, {
  type SettlementUpdateSource,
} from './CaseClosureSettlementUpdateForm.vue';
import PaymentFields from './CaseClosurePaymentFields.vue';
const source: SettlementUpdateSource = {
  expectedClosureVersionId: 'version',
  closeAt: '2026-10-29',
  closeAmt: null,
  paymentType: 'INSTALLMENTS',
  documents: [{ id: 'doc-id', name: '历史文书' }],
  payments: [],
};

function existingPayment(id: string, amount: string) {
  return {
    id,
    versionId: `${id}-version`,
    paymentDate: '2026-10-29',
    amount,
    payer: '付款人',
    payee: '收款人',
    receiptIds: [],
  };
}
async function addPayment(
  wrapper: ReturnType<typeof mount<typeof Form>>,
  amount: string,
) {
  await wrapper.get('[data-test="add-record"]').trigger('click');
  const id = wrapper.getComponent(PaymentFields).props('records').at(-1)!.id;
  await wrapper.get(`[data-test="payment-date-${id}"]`).setValue('2026-10-29');
  await wrapper.get(`[data-test="payment-payer-${id}"]`).setValue('付款人');
  await wrapper.get(`[data-test="payment-payee-${id}"]`).setValue('收款人');
  await wrapper.get(`[data-test="payment-amount-${id}"]`).setValue(amount);
  return id;
}

describe('current effective payment totals', () => {
  it('keeps empty totals at zero without turning unknown closure amounts into zero or company receipts', () => {
    const wrapper = mount(Form, { props: { source } });
    expect(wrapper.get('[data-test="saved-payment-total"]').text()).toContain(
      '0.00 元',
    );
    expect(wrapper.get('[data-test="draft-payment-total"]').text()).toContain(
      '0.00 元',
    );
    expect(wrapper.get('[data-test="payment-total"]').text()).toContain(
      '0.00 元',
    );
    expect(wrapper.text()).toContain('不代表公司已回款');
    expect(wrapper.get('[data-test="unknown"]').element).toHaveProperty(
      'checked',
      true,
    );
  });
  it('adds 0.1 and 0.2 exactly and distinguishes saved payments from the unsaved preview', async () => {
    const wrapper = mount(Form, {
      props: {
        source: { ...source, payments: [existingPayment('old', '0.1')] },
      },
    });
    await addPayment(wrapper, '0.2');
    expect(wrapper.get('[data-test="saved-payment-total"]').text()).toContain(
      '0.10 元',
    );
    expect(wrapper.get('[data-test="draft-payment-total"]').text()).toContain(
      '0.20 元',
    );
    expect(wrapper.get('[data-test="payment-total"]').text()).toContain(
      '0.30 元',
    );
    expect(wrapper.get('[data-test="payment-total"]').text()).toContain(
      '待保存',
    );
    expect(wrapper.emitted('draft')).toBeUndefined();
  });
  it('recalculates several payments when a draft amount is edited or its row removed', async () => {
    const payments = [
      existingPayment('first', '1.01'),
      existingPayment('second', '2.02'),
    ];
    const wrapper = mount(Form, { props: { source: { ...source, payments } } });
    const first = await addPayment(wrapper, '3.03');
    const second = await addPayment(wrapper, '4.04');
    expect(wrapper.get('[data-test="payment-total"]').text()).toContain(
      '10.10 元',
    );
    await wrapper.get(`[data-test="payment-amount-${first}"]`).setValue('8.08');
    expect(wrapper.get('[data-test="payment-total"]').text()).toContain(
      '15.15 元',
    );
    await wrapper.get(`[data-test="remove-${second}"]`).trigger('click');
    expect(wrapper.get('[data-test="payment-total"]').text()).toContain(
      '11.11 元',
    );
    expect(wrapper.get('[data-test="saved-payment-total"]').text()).toContain(
      '3.03 元',
    );
    expect(payments.map((row) => row.amount)).toEqual(['1.01', '2.02']);
  });
  it('uses the refreshed effective version after correction and excludes a revoked payment', async () => {
    const first = existingPayment('first', '10.00');
    const second = existingPayment('second', '20.00');
    const wrapper = mount(Form, {
      props: { source: { ...source, payments: [first, second] } },
    });
    expect(wrapper.get('[data-test="payment-total"]').text()).toContain(
      '30.00 元',
    );
    const corrected = {
      ...first,
      versionId: 'corrected-version',
      amount: '12.34',
    };
    await wrapper.setProps({
      source: { ...source, payments: [corrected, second] },
    });
    expect(wrapper.get('[data-test="payment-total"]').text()).toContain(
      '32.34 元',
    );
    await wrapper.setProps({ source: { ...source, payments: [corrected] } });
    expect(wrapper.get('[data-test="payment-total"]').text()).toContain(
      '12.34 元',
    );
    expect(first.amount).toBe('10.00');
  });
  it('preserves cents when the aggregate exceeds the safe integer range', () => {
    const wrapper = mount(Form, {
      props: {
        source: {
          ...source,
          payments: [
            existingPayment('first', '99999999999999.99'),
            existingPayment('second', '99999999999999.99'),
          ],
        },
      },
    });
    expect(wrapper.get('[data-test="payment-total"]').text()).toContain(
      '199999999999999.98 元',
    );
  });
  it.each(['', '-1', 'abc', '1.001', '1e2', '100000000000000', '0'])(
    'withholds an aggregate while an unsaved payment amount is invalid: %j',
    async (amount) => {
      const wrapper = mount(Form, {
        props: {
          source: { ...source, payments: [existingPayment('saved', '2.34')] },
        },
      });
      await addPayment(wrapper, amount);
      expect(wrapper.get('[data-test="saved-payment-total"]').text()).toContain(
        '2.34 元',
      );
      expect(wrapper.get('[data-test="payment-total"]').text()).toContain(
        '待完善',
      );
      expect(wrapper.get('[data-test="payment-total"]').text()).not.toContain(
        '元',
      );
      expect(
        wrapper.get('[data-test="draft-payment-total"]').text(),
      ).not.toContain('元');
    },
  );
  it('withholds a total for a new row until its date and parties are complete', async () => {
    const wrapper = mount(Form, { props: { source } });
    await wrapper.get('[data-test="add-record"]').trigger('click');
    const id = wrapper.getComponent(PaymentFields).props('records')[0]!.id;
    await wrapper.get(`[data-test="payment-amount-${id}"]`).setValue('5.00');
    expect(wrapper.get('[data-test="payment-total"]').text()).toContain(
      '待完善',
    );
    await wrapper.get(`[data-test="remove-${id}"]`).trigger('click');
    expect(wrapper.get('[data-test="payment-total"]').text()).toContain(
      '0.00 元',
    );
  });
});
describe('settlement update isolated draft', () => {
  it('lets the user remove new documents and blocks exceeding the combined limit before submission', async () => {
    const wrapper = mount(Form, { props: { source } });
    const input = wrapper.get('[aria-label="补充结案文书"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: Array.from({ length: 10 }, (_, i) => new File(['x'], `${i}.pdf`)),
    });
    await input.trigger('change');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('draft')).toBeUndefined();
    expect(wrapper.text()).toContain('结案文书最多保留 10 份');
    await wrapper.get('[data-test="remove-document-0"]').trigger('click');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('draft')?.[0]?.[0]).toMatchObject({
      preservedDocumentIds: ['doc-id'],
      newDocuments: expect.any(Array),
    });
    const draft = wrapper.emitted('draft')?.[0]?.[0] as {
      newDocuments: File[];
    };
    expect(draft.newDocuments).toHaveLength(9);
  });
  it('preserves unknown amount and exact attachment references', async () => {
    const wrapper = mount(Form, { props: { source } });
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('draft')?.[0]?.[0]).toMatchObject({
      closeAmt: null,
      preservedDocumentIds: ['doc-id'],
      expectedClosureVersionId: 'version',
    });
    expect(source.closeAmt).toBeNull();
    expect(wrapper.text()).toContain('待确认');
  });
  it('distinguishes explicit zero and does not submit on cancel', async () => {
    const wrapper = mount(Form, { props: { source } });
    await wrapper.get('[data-test="cancel"]').trigger('click');
    expect(wrapper.emitted('draft')).toBeUndefined();
    expect(wrapper.emitted('cancel')).toHaveLength(1);
    await wrapper.get('[data-test="unknown"]').setValue(false);
    await wrapper.get('[data-test="amount"]').setValue('0');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('draft')?.[0]?.[0]).toMatchObject({
      closeAmt: '0',
      closeAmountState: 'KNOWN',
    });
  });
});

describe('settlement update source and refund versions', () => {
  const withRefund: SettlementUpdateSource = {
    ...source,
    refund: {
      versionId: 'refund-v1',
      completeness: 'COMPLETE',
      items: [
        {
          itemId: 'item1',
          party: 'DEFENDANT',
          status: 'SETTLED',
          description: '退费一',
        },
      ],
    },
  };
  it('resets all local drafts when authorized source changes', async () => {
    const wrapper = mount(Form, { props: { source: withRefund } });
    await wrapper.get('[data-test="unknown"]').setValue(false);
    await wrapper.get('[data-test="amount"]').setValue('999');
    await wrapper
      .get('[aria-label="退费操作"]')
      .setValue('DECLARE_NOT_APPLICABLE');
    await wrapper.setProps({
      source: {
        ...source,
        expectedClosureVersionId: 'new-version',
        closeAt: '2026-10-30',
        closeAmt: '20',
      },
    });
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('draft')?.[0]?.[0]).toMatchObject({
      expectedClosureVersionId: 'new-version',
      closeAt: '2026-10-30',
      closeAmt: '20',
      newDocuments: [],
      paymentRecords: [],
    });
    expect(wrapper.emitted('draft')?.[0]?.[0]).not.toHaveProperty('refund');
  });
  it('shows existing inventory and distinguishes settlement from company receipt', async () => {
    const wrapper = mount(Form, { props: { source: withRefund } });
    expect(wrapper.text()).toContain('已确认完整');
    expect(wrapper.text()).toContain('退费一');
    await wrapper.get('[aria-label="退费操作"]').setValue('RECORD');
    await wrapper.get('[aria-label="退费状态"]').setValue('RECEIVED');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('draft')?.[0]?.[0]).toMatchObject({
      refund: {
        expectedVersionId: 'refund-v1',
        kind: 'RECORD',
        items: [{ itemId: 'item1', status: 'RECEIVED' }],
      },
    });
    expect(withRefund.refund?.items[0]?.status).toBe('SETTLED');
    await wrapper.get('[data-test="remove-refund"]').trigger('click');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('draft')?.at(-1)?.[0]).toMatchObject({
      refund: { items: [] },
    });
  });
  it('confirms the source inventory version without sending modified rows and cancel never submits', async () => {
    const wrapper = mount(Form, { props: { source: withRefund } });
    await wrapper.get('[aria-label="退费操作"]').setValue('CONFIRM_COMPLETE');
    await wrapper.get('[data-test="cancel"]').trigger('click');
    expect(wrapper.emitted('draft')).toBeUndefined();
    await wrapper.get('form').trigger('submit');
    const draft = wrapper.emitted('draft')?.[0]?.[0];
    expect(draft).toMatchObject({
      refund: { expectedVersionId: 'refund-v1', kind: 'CONFIRM_COMPLETE' },
    });
    expect(draft).not.toHaveProperty('refund.items');
  });
});

describe('manual settlement amount drafts', () => {
  it.each(['12.34', '0', '12.3'])(
    'keeps exact valid manual amount %s',
    async (amount) => {
      const wrapper = mount(Form, {
        props: {
          source: {
            ...source,
            customerAmount: '8.88',
            settlement: {
              expectedAssessmentVersionId: null,
              expectedTermsVersion: null,
              declaration: 'NOT_APPLICABLE',
            },
          },
        },
      });
      await wrapper.get('[aria-label="customer-mode"]').setValue('MANUAL');
      await wrapper.get('[aria-label="customer-amount"]').setValue(amount);
      await wrapper.get('form').trigger('submit');
      expect(wrapper.emitted('draft')?.[0]?.[0]).toMatchObject({
        settlementAmounts: {
          customer: { mode: 'MANUAL', amount },
          lawyer: { mode: 'KEEP', amount: null },
        },
      });
      expect(wrapper.emitted('draft')?.[0]?.[0]).toMatchObject({
        settlement: {
          declaration: 'NOT_APPLICABLE',
          customerAmount: { mode: 'MANUAL', amount },
        },
      });
    },
  );
  it.each(['12.345', '-1', 'abc', ''])(
    'rejects invalid manual amount %s',
    async (amount) => {
      const wrapper = mount(Form, { props: { source } });
      await wrapper.get('[aria-label="lawyer-mode"]').setValue('MANUAL');
      await wrapper.get('[aria-label="lawyer-amount"]').setValue(amount);
      await wrapper.get('form').trigger('submit');
      expect(wrapper.emitted('draft')).toBeUndefined();
    },
  );
  it('switches manual to automatic without sending stale amount and isolates refresh', async () => {
    const wrapper = mount(Form, { props: { source } });
    await wrapper.get('[aria-label="customer-mode"]').setValue('MANUAL');
    await wrapper.get('[aria-label="customer-amount"]').setValue('12.34');
    await wrapper.get('[aria-label="customer-mode"]').setValue('AUTOMATIC');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('draft')?.[0]?.[0]).toMatchObject({
      settlementAmounts: { customer: { mode: 'AUTOMATIC', amount: null } },
    });
    await wrapper.setProps({
      source: {
        ...source,
        expectedClosureVersionId: 'refresh',
        customerAmount: '56.78',
      },
    });
    await wrapper.get('[aria-label="customer-mode"]').setValue('MANUAL');
    expect(
      (
        wrapper.get('[aria-label="customer-amount"]')
          .element as HTMLInputElement
      ).value,
    ).toBe('56.78');
    await wrapper.get('[data-test="cancel"]').trigger('click');
    expect(wrapper.emitted('draft')).toHaveLength(1);
  });
});

describe('refund per-item amounts', () => {
  const refundSource: SettlementUpdateSource = {
    ...source,
    refund: {
      versionId: 'refund',
      completeness: 'COMPLETE',
      items: [
        {
          itemId: 'one',
          party: 'COURT',
          status: 'PENDING',
          description: '一审退费',
          amount: null,
        },
      ],
    },
  };
  it('shows unknown, saves empty as null and explicit zero/cents as entered, refreshes saved amount', async () => {
    const wrapper = mount(Form, { props: { source: refundSource } });
    expect(wrapper.text()).toContain('待确认');
    await wrapper.get('[aria-label="退费操作"]').setValue('RECORD');
    await wrapper.get('[aria-label="退费金额"]').setValue('');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('draft')?.at(-1)?.[0]).toMatchObject({
      refund: { items: [{ amount: null }] },
    });
    for (const amount of ['0', '800.12']) {
      await wrapper.get('[aria-label="退费金额"]').setValue(amount);
      await wrapper.get('form').trigger('submit');
      expect(wrapper.emitted('draft')?.at(-1)?.[0]).toMatchObject({
        refund: { items: [{ amount }] },
      });
    }
    expect(refundSource.refund!.items[0]!.amount).toBeNull();
    await wrapper.setProps({
      source: {
        ...refundSource,
        expectedClosureVersionId: 'refreshed',
        refund: {
          ...refundSource.refund!,
          items: [{ ...refundSource.refund!.items[0]!, amount: '800.12' }],
        },
      },
    });
    expect(wrapper.text()).toContain('800.12元');
    expect(wrapper.text()).toContain('无诉讼退费（0元）');
    wrapper.unmount();
  });
  it('rejects negative/fractional-cent values and retains valid party restrictions even for zero', async () => {
    for (const amount of ['-1', '1.001', '01']) {
      const wrapper = mount(Form, { props: { source: refundSource } });
      await wrapper.get('[aria-label="退费操作"]').setValue('RECORD');
      await wrapper.get('[aria-label="退费金额"]').setValue(amount);
      await wrapper.get('form').trigger('submit');
      expect(wrapper.emitted('draft')).toBeUndefined();
      expect(wrapper.text()).toContain('最多两位小数');
      wrapper.unmount();
    }
    const wrapper = mount(Form, {
      props: {
        source: {
          ...refundSource,
          refund: {
            ...refundSource.refund!,
            items: [
              {
                ...refundSource.refund!.items[0]!,
                amount: '0.00',
                status: 'CONVERTED_TO_COST',
              },
            ],
          },
        },
      },
    });
    await wrapper.get('[aria-label="退费操作"]').setValue('RECORD');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('draft')).toBeUndefined();
    wrapper.unmount();
  });
});

it('saves known money with a pending closure date without creating payment facts', async () => {
  const wrapper = mount(Form, {
    props: { source: { ...source, closeAt: '', closeAmt: '12.34' } },
  });
  await wrapper.get('form').trigger('submit');
  expect(wrapper.emitted('draft')?.[0]?.[0]).toMatchObject({
    closeAt: null,
    closeAmountState: 'KNOWN',
    closeAmt: '12.34',
    paymentRecords: [],
  });
});
