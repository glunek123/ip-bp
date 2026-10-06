import { expect, test } from '@playwright/test';
import { verifyCaseAcceptanceMigration } from '../support/case-acceptance-migration.mjs';

test('CA-006 forward migrations preserve 72 prior migrations and old facts, reject invalid SQL, and retry atomically', async () => {
  test.setTimeout(300_000);
  const result = await verifyCaseAcceptanceMigration();
  expect(result.empty).toEqual({
    previous: 72,
    total: 76,
    enumValue: 1,
    factTable: 1,
  });
  expect(result.upgrade).toEqual({
    oldFiling: 1,
    oldReceipt: 1,
    copiedGrant: 1,
    revision: 2,
    oldAcceptanceFact: 1,
    oldAcceptanceReceipt: 1,
    oldAcceptanceFrozen: 1,
    oldAcceptanceAudit: 1,
  });
  expect(result.constraints).toEqual({
    earlyDate: '23514',
    futureDate: '23514',
    wrongAudit: '23514',
    badVersion: '23514',
    postRegistrationAppend: '23514',
    parallelPostRegistrationAppends: ['23514', '23514'],
    frozenAfterRejected: 1,
    originalFactReceiptAfterRejected: 1,
    immutableFact: '23514',
    immutableAuditUpdate: '23514',
    immutableAuditDelete: '23514',
    relabelOldAuditToAcceptance: '23514',
    lawyerNewAction: 1,
    lawyerWrongStage: '23514',
    lawyerOldAction: 1,
    oldAuditUpdate: null,
    oldAuditDelete: null,
    incompleteReceipt: '23514',
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
    sealFailed: '42723',
    sealNoPartial: 0,
    sealGuardUnchanged: 1,
    sealRecovered: 1,
  });
});
