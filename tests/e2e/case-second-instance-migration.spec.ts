import { test, expect } from '@playwright/test';
import { verifyCaseSecondInstanceMigration } from '../support/case-second-instance-migration.mjs';

test('CA-010 replays 127 migrations, preserves the old chain and retries an atomic repair', async () => {
  expect(await verifyCaseSecondInstanceMigration()).toEqual({
    migrationCount: 127,
    priorMigrationCount: 117,
    emptyRoundTable: true,
    oldChainPreserved: true,
    combinedDetachRejected: true,
    combinedDetachAtomic: true,
    guardsEnabled: true,
    oldFactImmutable: true,
    oldChainImmutable: true,
    pointerDetachRejected: true,
    arbitraryRoundRejected: true,
    invalidRejected: true,
    atomic: true,
    rollbackGuardsRestored: true,
    retry: true,
  });
});
