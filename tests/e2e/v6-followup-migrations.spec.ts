import { expect, test } from '@playwright/test';
import { verifyV6FollowupMigrations } from '../support/v6-followup-migrations.mjs';

test.setTimeout(180_000);

test('v6 181-184 empty and supported upgrade migrations are atomic', async () => {
  const result = await verifyV6FollowupMigrations();
  expect(result.migrationCount).toBe(184);
  expect(result.checks).toEqual([
    'empty schema applies the exact 184 migration chain',
    '181 late collision rolls back dynamic guard wrappers and retries',
    '182 late function collision rolls back table and retries with material guard',
    '183 late relation collision rolls back earlier tables and retries',
    '184 late relation collision rolls back earlier tables and retries',
    '180-era customer and unready number counter survive 181-184',
  ]);
});
