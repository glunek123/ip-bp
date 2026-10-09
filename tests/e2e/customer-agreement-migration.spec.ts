import { expect, test } from '@playwright/test';
import { verifyCustomerAgreementMigration } from '../support/customer-agreement-migration.mjs';

test('CU007 102 through 107 migration chain, rollback, old receipt and SQL guards', async () => {
  const result = await verifyCustomerAgreementMigration();
  expect(result.migrationCount).toBe(107);
  expect(result.checks).toEqual([
    '102 checksum',
    '103 enum intermediate',
    '104 failure atomic',
    '106 reverse-label gap reproduced',
    '107 invalid historical data fails atomically',
    'old customer and receipt preserved',
    'no-file version and current pointer',
    'immutable version',
    'customer delete with agreement',
    'wrong agreement purpose',
    'wrong agreement category',
    'wrong draft purpose',
    'wrong draft category',
    'wrong reference purpose',
    'wrong reference type',
    'invalid current pointer',
  ]);
});
