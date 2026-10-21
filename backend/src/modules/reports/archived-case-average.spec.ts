import {
  archivedCaseAverage,
  InvalidReportAmountError,
} from './archived-case-average';

describe('archived case average claim amount', () => {
  it('uses numeric known amounts, excludes unknowns and includes an actual zero', () => {
    expect(
      archivedCaseAverage([
        { state: 'KNOWN', amount: '1000.00' },
        { state: 'KNOWN', amount: '3000.00' },
        { state: 'KNOWN', amount: '0.00' },
        { state: 'PENDING', amount: null },
        { state: 'UNRECORDED', amount: null },
      ]),
    ).toEqual({ status: 'VALUE', amount: '1333.33', reason: null });
    expect(archivedCaseAverage([{ state: 'KNOWN', amount: '0' }])).toEqual({
      status: 'VALUE',
      amount: '0.00',
      reason: null,
    });
  });
  it('distinguishes no archived cases from archived cases without known amounts', () => {
    expect(archivedCaseAverage([])).toEqual({
      status: 'NO_RECORDS',
      amount: null,
      reason: 'NO_ARCHIVED_CASES',
    });
    expect(
      archivedCaseAverage([
        { state: 'PENDING', amount: null },
        { state: 'UNRECORDED', amount: null },
      ]),
    ).toEqual({
      status: 'UNAVAILABLE',
      amount: null,
      reason: 'NO_KNOWN_AMOUNT',
    });
  });
  it('rounds once at the final mean using HALF_UP, including a half-cent boundary', () => {
    expect(
      archivedCaseAverage([
        { state: 'KNOWN', amount: '0' },
        { state: 'KNOWN', amount: '0.01' },
      ]).amount,
    ).toBe('0.01');
    expect(
      archivedCaseAverage([
        { state: 'KNOWN', amount: '0.01' },
        { state: 'KNOWN', amount: '0.01' },
        { state: 'KNOWN', amount: '0.02' },
      ]).amount,
    ).toBe('0.01');
  });
  it('retains cents at the database maximum without binary floating point', () => {
    expect(
      archivedCaseAverage([
        { state: 'KNOWN', amount: '99999999999999.99' },
        { state: 'KNOWN', amount: '99999999999999.98' },
      ]).amount,
    ).toBe('99999999999999.99');
  });
  it.each([
    '-1',
    'NaN',
    'Infinity',
    '1e2',
    '0.001',
    '001.00',
    '100000000000000.00',
  ])('fails on a damaged known source instead of excluding %s', (amount) => {
    expect(() => archivedCaseAverage([{ state: 'KNOWN', amount }])).toThrow(
      InvalidReportAmountError,
    );
  });
});
