import { expect, test } from '@playwright/test';
import { verifyNotaryListExportMigration } from '../support/notary-list-export-migration.mjs';

test('notary list export migrations preserve old data, grant only role managers, and retry atomically', async () => {
  const result = await verifyNotaryListExportMigration();
  expect(result).toMatchObject({
    emptyChain: true,
    previousSchemaPreserved: true,
    roleManagerGrantOnly: true,
    readerUnchanged: true,
    affectedRevisionOnly: true,
    failedDeployStatus: 1,
    failedLedgerUnfinished: true,
    failedMigrationAtomic: true,
    resolvedAndRetried: true,
  });
});
