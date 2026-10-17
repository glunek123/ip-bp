import { expect, test } from '@playwright/test';
import { verifyCaseSectionRecordMigration } from '../support/case-section-record-migration.mjs';

// Sole runner schedules this through pnpm test:e2e with a DB-only config while
// public is still at155. This is SQL replay evidence, not public Prisma deploy.
test('156/157 owned-schema replay, bounded failure/retry and preserved predecessor objects', async () => {
  test.setTimeout(600_000);
  const testInfo = test.info();
  const result = await verifyCaseSectionRecordMigration(async (evidence) => {
    await testInfo.attach('section-migration-sanitized-evidence', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
  });
  expect(result.source).toHaveLength(157);
  expect(result.publicUnchanged).toBe(true);
  expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
  expect(result.publicDigests.before).toBe(result.publicDigests.beforeCleanup);
  expect(result.publicDigests.before).toBe(result.publicDigests.after);
  expect(result.cleanedSchemas).toBe(2);
  expect(result.checks).toEqual([
    'empty-original-chain157',
    '156-controlled-failure-and-original-retry',
    'four-functions-exact-literal-date-replacements',
    '157-controlled-failure-and-original-retry',
    'old155-projected-data-acl-file-metadata-preserved',
    'owned-foreign-keys',
  ]);
  expect(result.enumStaging[0]?.labels).toHaveLength(3);
  expect(result.enumStaging[1]?.labels).toEqual([]);
  expect(result.memoryFile?.sha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(result.fixture).toContain('excludes Case histories and stored blobs');
});
