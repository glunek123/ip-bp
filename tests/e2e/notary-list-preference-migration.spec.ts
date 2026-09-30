import { expect, test } from '@playwright/test';
import { verifyNotaryListPreferenceMigration } from '../support/notary-list-preference-migration.mjs';

test('notary list preference migration keeps old accounts and enforces FK atomically', async () => {
  const result = await verifyNotaryListPreferenceMigration();
  expect(result).toMatchObject({
    emptyChain: true,
    previousSchemaPreserved: true,
    foreignKeyCode: '23503',
    restrictCode: '23503',
    failureCode: '42809',
    failedMigrationAtomic: true,
  });
});
