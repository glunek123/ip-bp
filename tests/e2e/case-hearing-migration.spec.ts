import { expect, test } from '@playwright/test';
import { verifyCaseHearingMigration } from '../support/case-hearing-migration.mjs';

test('CA-007 empty chain, old facts, scoped grants, failed migration retry, and system audit constraints', async () => {
  test.setTimeout(300_000);
  const result = await verifyCaseHearingMigration();
  expect(result).toEqual({
    previous: 76,
    total: 82,
    emptyFactTable: 1,
    oldAcceptance: 1,
    oldReceipt: 1,
    uploadHumanPath: 1,
    legacyHumanAudit: 1,
    scheduleGrant: 1,
    correctGrant: 1,
    splitGrant: 0,
    roleOnlyGrant: 0,
    templateVersion: 2,
    accountRevision: 2,
    splitAccountRevision: 1,
    factMigrationFailure: '42P07',
    noPartialAuditColumn: 0,
    retryTable: 1,
    systemWithHuman: '23514',
    systemWrongAction: '23514',
    systemWrongResource: '23514',
    systemWithBinding: '23514',
    systemCrossDepartment: '23514',
    systemWithoutFact: '23514',
    humanWithoutActor: '23514',
    humanAutoAction: '23514',
  });
});
