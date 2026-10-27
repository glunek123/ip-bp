import { expect, test } from '@playwright/test';
import { verifyBatch2CaseConsolidationMigration } from '../support/batch2-case-consolidation-migration.mjs';

test('Batch 2 migration preserves earlier cases and enforces root, child and immutable SQL constraints', async () => {
  test.setTimeout(240_000);
  expect(await verifyBatch2CaseConsolidationMigration()).toEqual({
    before: 0,
    preserved: 2,
    tables: 4,
    incompleteRoot: '23514',
    childProgress: '23514',
    immutableMember: '55000',
    mainProgress: null,
  });
});
