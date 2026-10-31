import { checkArchivePayment } from './case-archive-payment-check';

describe('case archive payment check', () => {
  it('requires a known closure amount instead of treating unknown as zero', () => {
    expect(checkArchivePayment(null, ['100.00'])).toEqual({
      state: 'AMOUNT_UNKNOWN',
      paidAmount: null,
    });
  });

  it('exempts an explicitly recorded zero amount from the financial checks', () => {
    expect(checkArchivePayment('0.00', [])).toEqual({
      state: 'ZERO_AMOUNT',
      paidAmount: '0.00',
    });
  });

  it('rejects incomplete installments and accepts payment reaching or exceeding the closure amount', () => {
    expect(checkArchivePayment('100.00', ['30.00', '69.99'])).toEqual({
      state: 'PAYMENT_INCOMPLETE',
      paidAmount: '99.99',
    });
    expect(checkArchivePayment('100.00', ['30.00', '70.00'])).toEqual({
      state: 'PAYMENT_COMPLETE',
      paidAmount: '100.00',
    });
    expect(checkArchivePayment('100.00', ['100.01'])).toEqual({
      state: 'PAYMENT_COMPLETE',
      paidAmount: '100.01',
    });
  });

  it('adds money exactly, including the maximum existing closure amount', () => {
    expect(
      checkArchivePayment('99999999999999.99', ['99999999999999.98', '0.01']),
    ).toEqual({
      state: 'PAYMENT_COMPLETE',
      paidAmount: '99999999999999.99',
    });
  });

  it.each(['-1.00', '1.001', 'NaN', 'Infinity', ''])(
    'rejects invalid monetary input %p',
    (amount) => {
      expect(() => checkArchivePayment(amount, [])).toThrow('INVALID_AMOUNT');
      expect(() => checkArchivePayment('1.00', [amount])).toThrow(
        'INVALID_AMOUNT',
      );
    },
  );
});
