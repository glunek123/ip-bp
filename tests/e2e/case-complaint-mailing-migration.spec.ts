import { expect, test } from '@playwright/test';
import { verifyCaseComplaintMailingMigration } from '../support/case-complaint-mailing-migration.mjs';

test('CA-004 forward migrations preserve old facts, constrain new facts and retry atomically', async () => {
  test.setTimeout(240_000);
  const result = await verifyCaseComplaintMailingMigration();
  expect(result.empty).toEqual({ migrationCount: 64, previousMigrationCount: 60,
    stage: 1, factTable: 1, receiptTable: 1 });
  expect(result.upgrade).toMatchObject({ preservedStage: 'WAITING_COMPLAINT_STAMP',
    oldSubmitReceipt: 1, oldConfirmation: 1, oldConfirmReceipt: 1,
    copiedScope: 'TEAM', authorizationRevision: 2 });
  expect(result.constraints).toEqual({ badIdentity: '23514', badDate: '23514',
    badVersion: '23514', immutableFact: '23514', crossEnterprise: '23514',
    crossDepartment: '23514', wrongCategory: '23514', mixedActor: '23514',
    wrongAuditAction: '23514', revokedCleanup: 'EXPIRED' });
  expect(result.failure).toEqual({ enumFailed: '42704', enumNoPartial: 0,
    factsFailed: '42P07', factsNoPartial: 0, grantsFailed: '23514',
    grantsNoPartial: 0, actorPathFailed: '42701', actorPathNoPartial: 0,
    recoveredGrant: 1, recoveredRevision: 2 });
});
