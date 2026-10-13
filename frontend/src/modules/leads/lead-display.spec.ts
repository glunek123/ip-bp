import { describe, expect, it } from 'vitest';
import type { LeadProduct } from '../../api/leads';
import { summarizeLeadProducts } from './lead-display';

const product = (input: Partial<LeadProduct> = {}): LeadProduct => ({
  id: 'p',
  position: 1,
  title: '真实商品',
  url: null,
  quantity: 2,
  commentCount: 3,
  unitPrice: '1.50',
  estimatedAmount: '3.00',
  ...input,
});

describe('recorded lead product summary', () => {
  it('preserves zero quantity and sums recorded estimates without recomputing sales', () => {
    const rows = [
      product(),
      product({ position: 2, quantity: 0, estimatedAmount: '4.50' }),
    ];
    expect(summarizeLeadProducts(rows)).toEqual({
      quantityTotal: '2',
      commentTotal: '6',
      estimatedAmount: '7.50',
      firstUnitPrice: '1.50',
    });
  });
  it('keeps cents beyond the floating point precision limit and picks the first position', () => {
    const rows = [
      product({ position: 2, estimatedAmount: '9999999999999999.99' }),
      product({ unitPrice: '0.10', estimatedAmount: '0.02' }),
    ];
    expect(summarizeLeadProducts(rows).estimatedAmount).toBe(
      '10000000000000000.01',
    );
    expect(summarizeLeadProducts(rows).firstUnitPrice).toBe('0.10');
    expect(rows[0]?.position).toBe(2);
  });
  it('keeps an empty set distinct from a recorded unit price of zero', () => {
    expect(summarizeLeadProducts([])).toEqual({
      quantityTotal: '0',
      commentTotal: '0',
      estimatedAmount: '0.00',
      firstUnitPrice: null,
    });
    expect(
      summarizeLeadProducts([product({ unitPrice: '0.00' })]).firstUnitPrice,
    ).toBe('0.00');
  });
  it.each(['-1.00', '1.001', 'NaN', '1e3'])(
    'rejects invalid recorded money %s',
    (amount) => {
      expect(() =>
        summarizeLeadProducts([product({ estimatedAmount: amount })]),
      ).toThrow(RangeError);
    },
  );
  it('rejects fractional counts', () => {
    expect(() => summarizeLeadProducts([product({ quantity: 0.5 })])).toThrow(
      RangeError,
    );
  });
});
