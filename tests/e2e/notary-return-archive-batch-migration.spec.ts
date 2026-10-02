import { expect, test } from '@playwright/test';
import { verifyNotaryReturnArchiveBatchMigration } from '../support/notary-return-archive-batch-migration.mjs';

test('NT-010 migration applies 57 copies, enforces receipt constraints and retries a real Prisma failure atomically', async () => {
  test.setTimeout(180_000);
  const result = await verifyNotaryReturnArchiveBatchMigration();
  expect(result).toMatchObject({
    migrationCount: 57,
    emptyChain: true,
    previousSchemaPreserved: true,
    constraints: {
      duplicateCode: '23505',
      badActorCode: '23503',
      badKeyCode: '23514',
      mutateCode: '23514',
      deleteCode: '23514',
    },
    failedDeployStatus: 1,
    failedMigrationAtomic: true,
    resolvedAndRetried: true,
  });
});
