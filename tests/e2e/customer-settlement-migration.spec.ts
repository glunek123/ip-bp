import { expect, test } from '@playwright/test';
import { verifyCustomerSettlementMigration } from '../support/customer-settlement-migration.mjs';

test('CU008 forward migration is atomic and protects exact settlement history', async () => {
  const result = await verifyCustomerSettlementMigration();
  expect(result.migrationCount).toBe(112);
  expect(result.checks).toContain(
    '112 preserves latest deletion guard and adds settlement associations',
  );
  expect(result.checks).toContain('numeric columns without typmod');
  expect(result.checks).toContain('v1-v2-v3 and old receipt v1');
  expect(result.checks).toContain('zero settlement blocks delete');
});
