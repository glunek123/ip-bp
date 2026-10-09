import { expect, test } from '@playwright/test';
import { verifyCustomerAgreementMigration } from '../support/customer-agreement-migration.mjs';

test('CU007 102 through 108 migration chain, rollback, old receipt and SQL guards', async () => {
  const result = await verifyCustomerAgreementMigration();
  expect(result.migrationCount).toBe(108);
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
    '107 normal v1 to v2',
    'RED linked audit details editable',
    'RED linked audit action editable',
    'RED linked audit actor editable',
    'RED linked audit type editable',
    'RED agreement current can retreat',
    'RED invoice current can retreat',
    'RED orphan agreement append accepted',
    'RED orphan invoice append accepted',
    '108 inconsistent history fails atomically',
    '108 applied after RED',
    '108 linked audit details immutable',
    '108 linked audit action immutable',
    '108 linked audit actor immutable',
    '108 linked audit type immutable',
    'linked audit delete blocked by existing FK',
    '108 action switch into document immutable',
    '108 type switch into document immutable',
    '108 agreement retreat rejected',
    '108 invoice retreat rejected',
    '108 orphan agreement append rejected',
    '108 orphan invoice append rejected',
    '108 normal v1 to v2 to v3',
  ]);
});
