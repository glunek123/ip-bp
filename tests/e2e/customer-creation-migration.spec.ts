import { expect, test } from '@playwright/test';
import { verifyCustomerCreationMigration } from '../support/customer-creation-migration.mjs';

test.setTimeout(120_000);

test('customer creation migration upgrades the previous schema without changing historical facts', async () => {
  const result = await verifyCustomerCreationMigration();
  expect(result.migrationCount).toBe(178);
  expect(result.previousMigration).toBe(
    '20261025090000_case_second_instance_normal_source_guard',
  );
  expect(result.checks).toEqual([
    'empty full migration chain',
    'failed migration is atomic',
    'prior agreement preserved without backfill',
    'migration retry succeeds',
    'direct SQL rejects invalid settlement text',
    'new agreement records text without calculating',
    'agreement history remains immutable',
  ]);
});
