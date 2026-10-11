import { test, expect } from '@playwright/test';
import { verifyCaseSecondInstanceMigration } from '../support/case-second-instance-migration.mjs';

test('CA-010 replays 130 migrations, upgrades the prior 128 and 129 and preserves the old chain', async () => {
  expect(await verifyCaseSecondInstanceMigration()).toEqual({
    migrationCount: 130,
    priorMigrationCount: 117,
    prior128Upgraded: true,
    prior129Upgraded: true,
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
