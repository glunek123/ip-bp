import {
  calculateSettlement,
  SETTLEMENT_V1,
  SETTLEMENT_V2,
  customerPercentFromFormula,
} from './settlement-calculation';

const input = {
  closureAmount: '1000.00',
  closureAmountState: 'KNOWN' as const,
  fallbackClaimAmount: '9999.00',
  customerFormula: '客户结算金额=结案金额*70%',
  lawyerMode: 'FULL_RISK' as const,
  lawyerBaseFee: '0.00',
  lawyerSplitPercent: '30',
};

describe('Demo settlement arithmetic', () => {
  it('preserves the largest request money and supported percent precision without storage rounding', () => {
    expect(
      calculateSettlement({
        ...input,
        closureAmount: '9999999999999999.99',
        lawyerMode: 'HALF_RISK',
        lawyerBaseFee: '9999999999999999.99',
        lawyerSplitPercent: '100',
      }).lawyerAmount,
    ).toBe('20000000000000000.00');
    expect(customerPercentFromFormula('结案金额*99.1234567890123456%')).toBe(
      '99.1234567890123456',
    );
    expect(() =>
      customerPercentFromFormula('结案金额*99.12345678901234567%'),
    ).toThrow();
    expect(() =>
      calculateSettlement({ ...input, lawyerBaseFee: '10000000000000000' }),
    ).toThrow();
  });
  it('calculates customer and lawyer sides independently, including half and fixed modes', () => {
    expect(calculateSettlement(input)).toMatchObject({
      basis: '1000.00',
      customerAmount: '700.00',
      lawyerAmount: '300.00',
    });
    expect(
      calculateSettlement({
        ...input,
        lawyerMode: 'HALF_RISK',
        lawyerBaseFee: '120.00',
      }).lawyerAmount,
    ).toBe('420.00');
    expect(
      calculateSettlement({
        ...input,
        lawyerMode: 'FIXED_FEE',
        lawyerBaseFee: '120.00',
      }).lawyerAmount,
    ).toBe('120.00');
  });

  it('keeps explicit zero and unknown distinct from the fallback claim', () => {
    expect(
      calculateSettlement({
        ...input,
        closureAmount: null,
        closureAmountState: 'PENDING',
      }),
    ).toMatchObject({ basis: null, customerAmount: null, lawyerAmount: null });
    expect(
      calculateSettlement({ ...input, closureAmount: '0' }).customerAmount,
    ).toBe('0.00');
    expect(
      calculateSettlement({
        ...input,
        closureAmount: null,
        closureAmountState: 'UNRECORDED',
        fallbackClaimAmount: null,
      }).customerAmount,
    ).toBeNull();
    expect(
      calculateSettlement({
        ...input,
        closureAmount: null,
        closureAmountState: 'UNRECORDED',
      }).basis,
    ).toBe('9999.00');
    expect(
      calculateSettlement({
        ...input,
        customerFormula: null,
        lawyerMode: null,
        lawyerBaseFee: null,
        lawyerSplitPercent: null,
      }),
    ).toMatchObject({
      customerAmount: null,
      lawyerAmount: null,
    });
  });

  it('rounds legal positive inputs like Demo without binary floating point accumulation', () => {
    expect(
      calculateSettlement({
        ...input,
        closureAmount: '1.00',
        customerFormula: '结案金额 × 50%',
      }).customerAmount,
    ).toBe('1.00');
    expect(
      calculateSettlement({
        ...input,
        closureAmount: '0.10',
        customerFormula: '结案金额*10%',
      }).customerAmount,
    ).toBe('0.00');
  });

  it('preserves explicit manual values and rejects invalid percentage or money', () => {
    expect(
      calculateSettlement({
        ...input,
        customerManualAmount: '0',
        lawyerManualAmount: '100.20',
      }),
    ).toMatchObject({
      customerAmount: '0.00',
      customerSource: 'MANUAL',
      lawyerAmount: '100.20',
      lawyerSource: 'MANUAL',
    });
    expect(customerPercentFromFormula('结案金额*75.5%')).toBe('75.5');
    expect(() => customerPercentFromFormula('结案金额*101%')).toThrow();
    expect(() =>
      calculateSettlement({ ...input, closureAmount: '-1' }),
    ).toThrow();
  });
});

describe('settlement calculation version compatibility', () => {
  it('preserves V1 historical rounding and uses cents only for V2 manual overrides', () => {
    const values = {
      ...input,
      customerManualAmount: '123.50',
      lawyerManualAmount: '100.20',
    };
    expect(calculateSettlement(values, SETTLEMENT_V1)).toMatchObject({
      customerAmount: '124.00',
      lawyerAmount: '100.00',
    });
    expect(calculateSettlement(values, SETTLEMENT_V2)).toMatchObject({
      customerAmount: '123.50',
      lawyerAmount: '100.20',
      customerAutomaticAmount: '700.00',
      lawyerAutomaticAmount: '300.00',
    });
    expect(
      calculateSettlement({
        ...input,
        customerManualAmount: '0.01',
        lawyerManualAmount: '0',
      }),
    ).toMatchObject({
      customerAmount: '0.01',
      lawyerAmount: '0.00',
      customerSource: 'MANUAL',
      lawyerSource: 'MANUAL',
    });
  });
  it.each(['-0.01', '1.001', 'NaN', '1e2'])(
    'rejects invalid manual money %s',
    (value) => {
      expect(() =>
        calculateSettlement({ ...input, customerManualAmount: value }),
      ).toThrow('INVALID_SETTLEMENT_MONEY');
      expect(() =>
        calculateSettlement({ ...input, lawyerManualAmount: value }),
      ).toThrow('INVALID_SETTLEMENT_MONEY');
    },
  );
});
