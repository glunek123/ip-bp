import { expect, test } from '@playwright/test';
import { verifyV6CaseCsvImport } from '../support/v6-case-csv-import.mjs';

test.setTimeout(180_000);

test('v6 case CSV import confirms exact suspected duplicates without merging', async () => {
  const result = await verifyV6CaseCsvImport();
  expect(result.checks).toEqual([
    'late CSV row failure rolls back case, receipt and row before retry',
    'fresh CSV imports with no duplicate confirmation and replays exactly once',
    'unselected same-file candidate requires exact row confirmation',
    'cross-file candidate requires exact case confirmation and stays a separate case',
    'concurrent same-file row admits exactly one case',
    'case-read denial and cross-department actor do not see duplicate candidates',
  ]);
});
