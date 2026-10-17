import { describe, it, expect } from 'vitest';
import { previewSettlement, roundManualSettlement } from './settlement-preview';
const terms = {
  formula: '结案金额×70%',
  mode: 'FULL_RISK' as const,
  baseFee: '0',
  splitPercent: '30',
};
describe('exact settlement draft preview', () => {
  it('keeps known zero and unknown distinct, while fixed fee does not need a basis', () => {
    expect(previewSettlement('0.00', 'CUSTOMER', terms).amount).toBe('0.00');
    expect(previewSettlement(null, 'CUSTOMER', terms).amount).toBeNull();
    expect(
      previewSettlement(null, 'LAWYER', {
        ...terms,
        mode: 'FIXED_FEE',
        baseFee: '20.50',
      }).amount,
    ).toBe('21.00');
  });
  it('rounds each mode at whole yuan only after the full calculation', () => {
    expect(previewSettlement('105', 'CUSTOMER', terms).amount).toBe('74.00');
    expect(previewSettlement('105', 'LAWYER', terms).amount).toBe('32.00');
    expect(
      previewSettlement('105', 'LAWYER', {
        ...terms,
        mode: 'HALF_RISK',
        baseFee: '10.49',
      }).amount,
    ).toBe('42.00');
    expect(roundManualSettlement('73.50')).toBe('74.00');
  });
  it('preserves the maximum decimal amounts and 16-digit percentage without floating point loss', () => {
    expect(
      previewSettlement('9999999999999999.99', 'LAWYER', {
        ...terms,
        mode: 'HALF_RISK',
        baseFee: '9999999999999999.99',
        splitPercent: '100',
      }).amount,
    ).toBe('20000000000000000.00');
    expect(
      previewSettlement('100', 'CUSTOMER', {
        ...terms,
        formula: '70.1234567890123456%',
      }).amount,
    ).toBe('70.00');
    expect(
      previewSettlement('100', 'CUSTOMER', {
        ...terms,
        formula: '70.12345678901234567%',
      }).error,
    ).not.toBeNull();
    expect(
      previewSettlement('100', 'LAWYER', { ...terms, splitPercent: '0' }).error,
    ).not.toBeNull();
  });
});
