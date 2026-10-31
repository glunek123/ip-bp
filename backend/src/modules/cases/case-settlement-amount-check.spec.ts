import { checkCaseSettlementAmount } from './case-settlement-amount-check';

describe('case settlement amount check', () => {
  it('keeps an unknown required amount distinct from zero', () => {
    expect(checkCaseSettlementAmount(null, ['25.00'])).toEqual({
      state: 'UNKNOWN',
      requiredAmount: null,
      allocatedAmount: '25.00',
    });
    expect(checkCaseSettlementAmount(null, [])).toEqual({
      state: 'UNKNOWN',
      requiredAmount: null,
      allocatedAmount: '0.00',
    });
  });

  it('reports insufficient allocation for partial and multiple installments', () => {
    expect(checkCaseSettlementAmount('100.00', ['30.00'])).toEqual({
      state: 'INSUFFICIENT',
      requiredAmount: '100.00',
      allocatedAmount: '30.00',
    });
    expect(checkCaseSettlementAmount('100.00', ['30', '69.99'])).toEqual({
      state: 'INSUFFICIENT',
      requiredAmount: '100.00',
      allocatedAmount: '99.99',
    });
  });

  it('reaches the amount when confirmed allocations equal or exceed it', () => {
    expect(checkCaseSettlementAmount('100', ['30.00', '70.00'])).toEqual({
      state: 'REACHED',
      requiredAmount: '100.00',
      allocatedAmount: '100.00',
    });
    expect(checkCaseSettlementAmount('100.00', ['100.01'])).toEqual({
      state: 'REACHED',
      requiredAmount: '100.00',
      allocatedAmount: '100.01',
    });
  });

  it('does not infer a recorded receipt or invoice from a zero requirement alone', () => {
    expect(checkCaseSettlementAmount('0.00', [])).toEqual({
      state: 'UNKNOWN',
      requiredAmount: '0.00',
      allocatedAmount: '0.00',
    });
  });

  it('uses exact decimal arithmetic at the supported amount precision', () => {
    expect(
      checkCaseSettlementAmount('99999999999999.99', [
        '99999999999999.98',
        '0.01',
      ]),
    ).toEqual({
      state: 'REACHED',
      requiredAmount: '99999999999999.99',
      allocatedAmount: '99999999999999.99',
    });
  });

  it('requires callers to filter allocations to this case', () => {
    const caseAAllocations = ['20.00'];
    const caseBAllocations = ['80.00'];

    expect(checkCaseSettlementAmount('100.00', caseAAllocations).state).toBe(
      'INSUFFICIENT',
    );
    expect(checkCaseSettlementAmount('100.00', caseBAllocations).state).toBe(
      'INSUFFICIENT',
    );
  });

  it.each(['-1.00', '1.001', '01.00', 'NaN', 'Infinity', ''])(
    'rejects invalid required or allocated amount %p',
    (amount) => {
      expect(() => checkCaseSettlementAmount(amount, [])).toThrow(
        'INVALID_AMOUNT',
      );
      expect(() => checkCaseSettlementAmount('1.00', [amount])).toThrow(
        'INVALID_AMOUNT',
      );
    },
  );

  it('rejects runtime numeric values instead of coercing them to strings', () => {
    expect(() => checkCaseSettlementAmount(1 as unknown as string, [])).toThrow(
      'INVALID_AMOUNT',
    );
    expect(() =>
      checkCaseSettlementAmount('1.00', [1 as unknown as string]),
    ).toThrow('INVALID_AMOUNT');
  });
});
