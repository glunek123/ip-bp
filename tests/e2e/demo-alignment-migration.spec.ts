import { expect, test } from '@playwright/test';
import { verifyDemoAlignmentMigration } from '../support/demo-alignment-migration.mjs';

// DB-only protected runner. Listing this file cannot capture or create a Client.
test('Demo165 owned whole-file chain, four failures and exact retries preserve public161', async () => {
  test.setTimeout(1_200_000);
  const info = test.info();
  const result = await verifyDemoAlignmentMigration(async (evidence) => {
    await info.attach('demo165-sanitized-owned-risk', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
  });
  expect(result.source).toHaveLength(165);
  expect(result.sends).toBe(334);
  expect(result.rollbacks).toBe(4);
  expect(result.retries).toBe(4);
  expect(result.faults).toHaveLength(4);
  expect(result.createdSchemas).toHaveLength(2);
  expect(result.cleanedSchemas).toBe(2);
  expect(result.cleanup).toEqual({
    state: 'committed',
    schemasRetained: false,
  });
  expect(result.connectionEnd).toBe('confirmed');
  expect(result.publicUnchanged).toBe(true);
  expect(result.publicDigests.before).toBe(result.publicDigests.beforeCleanup);
  expect(result.publicDigests.before).toBe(
    result.publicDigests.afterDropInTransaction,
  );
  expect(result.projection).toEqual({
    fees: 0,
    groups: 2,
    items: 2,
    papers: 2,
    audits: 2,
    receipts: 0,
  });
  expect(result.catalogDelta).toEqual({
    tables: 12,
    enumTypes: 5,
    functions: 16,
    userTriggers: 23,
    constraints: 73,
    indexes: 43,
    existingEnumLabels: 15,
  });
  expect(result.checks).toEqual([
    'empty-original-whole-file-chain165',
    'old161-same-id-pk-hash-fk-mirror-origin',
    'four-whole-file-fault-rollbacks-and-raw-retries',
    'old161-columns-functions-acl-sequences-preserved',
    'Q0-N2-exact-projection',
    'owned-fk-and-namespace',
  ]);
});
