import { test, expect } from '@playwright/test';
import { verifyCaseSecondInstanceMigration } from '../support/case-second-instance-migration.mjs';

test('CA-010 foundation replays 120 migrations, preserves the old chain and retries an atomic repair', async () => {
  expect(await verifyCaseSecondInstanceMigration()).toEqual({
    migrationCount: 120,
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
