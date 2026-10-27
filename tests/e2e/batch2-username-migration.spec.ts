import { expect, test } from '@playwright/test';
import { verifyBatch2UsernameMigration } from '../support/batch2-username-migration.mjs';

test.setTimeout(300_000);

test('185 upgrades preserved legacy credentials and retains username constraints', async () => {
  const result = await verifyBatch2UsernameMigration();
  expect(result).toEqual({
    migrationCount: 185,
    legacyUsername: 'legacy.user',
    legacyLoginUsername: 'legacy.user',
    uniqueIndexRetained: true,
  });
});
