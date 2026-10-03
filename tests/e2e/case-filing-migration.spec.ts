import { expect, test } from '@playwright/test';
import { verifyCaseFilingMigration } from '../support/case-filing-migration.mjs';

test('CA-005 forward migrations preserve old facts, reject invalid SQL and retry atomically', async () => {
  test.setTimeout(240_000);
  const result = await verifyCaseFilingMigration();
  expect(result.empty).toEqual({
    previousMigrationCount: 64,
    migrationCount: 67,
    stage: 1,
    courts: 1,
    facts: 1,
  });
  expect(result.upgrade).toEqual({
    stage: 'WAITING_FILING',
    oldMail: 1,
    oldReceipt: 1,
    grantScope: 'SELF',
    revision: 2,
  });
  expect(result.constraints).toEqual({
    duplicateCourt: '23505',
    crossDepartmentCourt: '23514',
    badDate: '23514',
    badCourtSnapshot: '23514',
    badVersion: '23514',
    immutableFact: '23514',
  });
  expect(result.failure).toEqual({
    enumFailed: '42704',
    enumNoPartial: 0,
    factsFailed: '42P07',
    factsNoPartial: 0,
    grantsFailed: '23514',
    grantsNoPartial: 0,
    revisionNoPartial: 1,
    recoveredGrant: 1,
  });
});
