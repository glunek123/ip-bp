import {
  reportKnownMoney,
  demoClosureRate,
  InvalidReportCountError,
} from './report-money-metrics';
import { InvalidReportAmountError } from './archived-case-average';
const known = (amount: string) => ({ state: 'KNOWN' as const, amount });

describe('known-only report money facts', () => {
  it('sums known amounts numerically, keeps real zero and exposes unknown counts', () => {
    expect(
      reportKnownMoney([
        known('100.00'),
        known('0'),
        { state: 'PENDING', amount: null },
        { state: 'UNRECORDED', amount: null },
      ]),
    ).toMatchObject({
      total: { status: 'VALUE', amount: '100.00' },
      knownCases: 2,
      unknownCases: 2,
      buckets: [{ count: 2 }, { count: 0 }, { count: 0 }, { count: 0 }],
    });
    expect(reportKnownMoney([known('0')]).total).toEqual({
      status: 'VALUE',
      amount: '0.00',
    });
  });
  it('uses exact left-inclusive 10/30/50-wan boundaries without unknowns entering the first bucket', () => {
    const result = reportKnownMoney(
      [
        '0',
        '99999.99',
        '100000',
        '299999.99',
        '300000',
        '499999.99',
        '500000',
      ].map(known),
    );
    expect(result.buckets).toEqual([
      { lowerInclusive: '0.00', upperExclusive: '100000.00', count: 2 },
      { lowerInclusive: '100000.00', upperExclusive: '300000.00', count: 2 },
      { lowerInclusive: '300000.00', upperExclusive: '500000.00', count: 2 },
      { lowerInclusive: '500000.00', upperExclusive: null, count: 1 },
    ]);
    expect(result.buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(
      result.knownCases,
    );
  });
  it('distinguishes an empty cohort and all-unknown sources from a known zero', () => {
    expect(reportKnownMoney([]).total).toEqual({
      status: 'NO_RECORDS',
      amount: null,
    });
    const result = reportKnownMoney([
      { state: 'PENDING', amount: null },
      { state: 'UNRECORDED', amount: null },
    ]);
    expect(result.total).toEqual({ status: 'NO_KNOWN_AMOUNT', amount: null });
    expect(result.unknownCases).toBe(2);
    expect(result.buckets.map((bucket) => bucket.count)).toEqual([0, 0, 0, 0]);
  });
  it('preserves cents when the total exceeds one database amount column', () => {
    expect(
      reportKnownMoney([known('99999999999999.99'), known('99999999999999.99')])
        .total,
    ).toEqual({ status: 'VALUE', amount: '199999999999999.98' });
  });
  it.each(['-1', 'NaN', 'Infinity', '0.001', '1e2', '001.00'])(
    'rejects damaged amounts %s instead of classifying them as unknown',
    (amount) => {
      expect(() => reportKnownMoney([known(amount)])).toThrow(
        InvalidReportAmountError,
      );
    },
  );
});

describe('Demo 结案率 from archived/total', () => {
  it('returns no-data on an empty denominator and a true zero on nonempty unarchived cases', () => {
    expect(demoClosureRate(0, 0)).toEqual({
      status: 'NO_RECORDS',
      percent: null,
    });
    expect(demoClosureRate(5, 0)).toEqual({ status: 'VALUE', percent: '0' });
  });
  it('uses the Demo whole-percent HALF_UP display without floating point', () => {
    expect(demoClosureRate(8, 1)).toEqual({ status: 'VALUE', percent: '13' });
    expect(demoClosureRate(3, 1)).toEqual({ status: 'VALUE', percent: '33' });
    expect(demoClosureRate(7, 7)).toEqual({ status: 'VALUE', percent: '100' });
  });
  it.each([
    [-1, 0],
    [1, -1],
    [1, 2],
    [1.5, 1],
    [Number.MAX_SAFE_INTEGER + 1, 0],
    [Infinity, 0],
  ])('rejects impossible counts %s/%s', (total, archived) => {
    expect(() => demoClosureRate(total, archived)).toThrow(
      InvalidReportCountError,
    );
  });
});
