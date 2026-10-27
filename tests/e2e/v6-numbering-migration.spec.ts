import { expect, test } from '@playwright/test';
import { verifyV6NumberingMigration } from '../support/v6-numbering-migration.mjs';

test.setTimeout(180_000);

test('v6 numbering cutover upgrades 178-180 and preserves historical width and rollback', async () => {
  const result = await verifyV6NumberingMigration();
  expect(result.migrationCount).toBe(180);
  expect(result.checks).toEqual([
    'full 178+179+180 migration chain',
    '180 enum added without grants',
    '1000 historical customers including deleted draft, 1000 leads',
    'global -1 blocks customer, lead/external shared allocator and normal case before any daily count',
    'failed cutover restores guard, counter and aliases',
    'cutover preserves 1000th customer, daily 1000 and old aliases',
    '100 historical normal cases and current service case 101 retain guards, suffixes and no daily consumption',
    'rollback retry and two-client concurrency stay unique across business days',
    '180 real Prisma store/service create-only, admit/material retained, manage separation, cross-department and revocation',
    'old lead/external receipt aliases resolve only by entity UUID while snapshots stay immutable',
  ]);
});
