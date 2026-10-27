// Pure assertion shared by the pre-app probe and its no-database contract test.
export function assertBatch2ConsolidationProbe(actual) {
  const expected = {
    before: 0,
    preserved: 2,
    tables: 4,
    incompleteRoot: '23514',
    rootAfterFailed: 0,
    incompleteRootRetry: '23514',
    childProgress: '23514',
    immutableMember: '55000',
    mainProgress: null,
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      '188 consolidation result differs from its existing spec assertion',
    );
}
