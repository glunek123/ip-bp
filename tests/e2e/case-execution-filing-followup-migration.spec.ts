import { expect, test } from '@playwright/test';
import { verifyCaseExecutionFilingFollowupMigration } from '../support/case-execution-filing-followup-migration.mjs';

// Sole future R2 runner invokes this through protected pnpm test:e2e with a
// DB-only config while public remains at159. No automatic web server/setup.
test('EF160 isolated original-chain replay, failure rollback and exact retry', async () => {
  test.setTimeout(600_000);
  const testInfo = test.info();
  const result = await verifyCaseExecutionFilingFollowupMigration(
    async (evidence) => {
      await testInfo.attach('ef160-migration-sanitized-evidence', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json',
      });
    },
  );
  expect(result.source).toHaveLength(160);
  expect(result.source.at(-1)?.sha256).toBe(
    'e125a3278b0530860b1be49273fc667224451f8a6d35b420bdf14e2b9c684105',
  );
  expect(result.checks).toEqual([
    'empty-original-chain160',
    '160-controlled-failure-atomic-ddl-and-original-byte-retry',
    '159-classifier-exact-body-and-oid-owner-acl-config',
    '159-data-acl-and-file-metadata-preserved',
    'owned-foreign-keys',
  ]);
  expect(result.enumStaging).toHaveLength(5);
  expect(result.memoryFile?.sha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(result.fixture).toContain('excludes Case histories and stored blobs');
  expect(result.cleanedSchemas).toBe(2);
  expect(result.publicUnchanged).toBe(true);
  expect(result.publicDigests.before).toBe(result.publicDigests.beforeCleanup);
  expect(result.publicDigests.before).toBe(result.publicDigests.after);
});
