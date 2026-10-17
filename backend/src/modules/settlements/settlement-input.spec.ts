import { assertFinancialKey, parseFinancialDay } from './settlement-input';

describe('financial request input boundaries', () => {
  it('rejects impossible dates without substituting today or zero', () => {
    for (const value of [
      '0000-01-01',
      '2026-02-29',
      '2026-04-31',
      '2026-13-01',
      '2026-10-17T00:00:00Z',
      '',
    ])
      expect(() => parseFinancialDay(value)).toThrow();
    expect(parseFinancialDay('2024-02-29').toISOString()).toBe(
      '2024-02-29T00:00:00.000Z',
    );
  });
  it('rejects blank or oversized keys', () => {
    for (const value of ['', '   ', null, 'x'.repeat(129)])
      expect(() => assertFinancialKey(value)).toThrow();
    expect(() => assertFinancialKey('same-request-1')).not.toThrow();
  });
});
