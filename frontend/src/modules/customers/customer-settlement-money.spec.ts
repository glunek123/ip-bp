import { describe, expect, it } from 'vitest';
import {
  formatSettlementAmount,
  formatSettlementPercent,
  settlementPendingDisplay,
  settlementRecoveryBarWidth,
} from './customer-settlement-money';

describe('customer settlement money display', () => {
  it('formats large exact values without converting through Number', () => {
    expect(formatSettlementAmount('200000000000000000.01')).toBe(
      '¥200,000,000,000,000,000.01',
    );
  });

  it('labels a negative pending amount as overpayment and shows its absolute value', () => {
    expect(settlementPendingDisplay('-20.00')).toEqual({
      label: '超收',
      amount: '¥20.00',
    });
  });

  it('does not confuse a known zero with an unknown amount', () => {
    expect(settlementPendingDisplay('0.00')).toEqual({
      label: '待回款',
      amount: '¥0.00',
    });
    expect(settlementPendingDisplay(null)).toEqual({
      label: '待回款',
      amount: '—，回款尚有未录入',
    });
  });

  it('clamps only the visual bar while keeping the displayed rate unchanged', () => {
    expect(formatSettlementPercent('120.00')).toBe('120.00%');
    expect(settlementRecoveryBarWidth('120.00')).toBe('100%');
    expect(settlementRecoveryBarWidth('32.50')).toBe('32.5%');
    expect(settlementRecoveryBarWidth(null)).toBe('0%');
  });
});
