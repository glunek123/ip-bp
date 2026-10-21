import {
  reportDistributions,
  InvalidReportDistributionError,
  ReportDistributionFact,
} from './report-distributions';

const fact = (
  court: ReportDistributionFact['court'] = null,
): ReportDistributionFact => ({ caseType: 'CIVIL', platform: 'TMALL', court });
describe('report distributions', () => {
  it('returns genuine empty distributions for an empty authorized cohort', () => {
    expect(reportDistributions([])).toEqual({
      types: [],
      platforms: [],
      courts: [],
      unrecordedCourtCases: 0,
    });
  });
  it('counts each case once per dimension and retains one null category', () => {
    const result = reportDistributions([
      fact(),
      fact(),
      { caseType: null, platform: null, court: null },
    ]);
    expect(result.types).toEqual([
      { value: 'CIVIL', count: 2 },
      { value: null, count: 1 },
    ]);
    expect(result.platforms).toEqual([
      { value: 'TMALL', count: 2 },
      { value: null, count: 1 },
    ]);
    expect(result.unrecordedCourtCases).toBe(3);
    expect(result.types.reduce((n, row) => n + row.count, 0)).toBe(3);
    expect(result.platforms.reduce((n, row) => n + row.count, 0)).toBe(3);
  });
  it('sorts by count then binary category value, with null last on ties', () => {
    const result = reportDistributions([
      { ...fact(), caseType: null, platform: null },
      { ...fact(), caseType: 'CIVIL', platform: 'TMALL' },
      { ...fact(), caseType: 'ADMINISTRATIVE', platform: 'JD' },
    ]);
    expect(result.types.map((row) => row.value)).toEqual([
      'ADMINISTRATIVE',
      'CIVIL',
      null,
    ]);
    expect(result.platforms.map((row) => row.value)).toEqual([
      'JD',
      'TMALL',
      null,
    ]);
  });
  it('groups courts by ID, not equal names, and breaks top-five ties by binary ID', () => {
    const rows = ['f', 'd', 'b', 'e', 'a', 'c'].map((id) =>
      fact({ id, name: '同名法院' }),
    );
    const result = reportDistributions([
      ...rows,
      fact({ id: 'f', name: '同名法院' }),
      fact(),
    ]);
    expect(result.courts).toEqual([
      { id: 'f', name: '同名法院', count: 2 },
      ...['a', 'b', 'c', 'd'].map((id) => ({ id, name: '同名法院', count: 1 })),
    ]);
    expect(result.unrecordedCourtCases).toBe(1);
  });
  it('fails a contradictory name for the same stable court ID', () => {
    expect(() =>
      reportDistributions([
        fact({ id: 'court', name: '甲' }),
        fact({ id: 'court', name: '乙' }),
      ]),
    ).toThrow(InvalidReportDistributionError);
  });
  it.each([
    { ...fact(), caseType: 'UNAPPROVED' },
    { ...fact(), platform: 'UNAPPROVED' },
    { ...fact(), caseType: undefined },
    { ...fact(), court: { id: '', name: '法院' } },
    { ...fact(), court: { id: 'court', name: ' ' } },
  ])(
    'rejects invalid source data rather than treating it as unknown',
    (invalid) => {
      expect(() =>
        reportDistributions([invalid as unknown as ReportDistributionFact]),
      ).toThrow(InvalidReportDistributionError);
    },
  );
});
