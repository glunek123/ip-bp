import { expect, test } from '@playwright/test';
import { verifyCaseComplaintConfirmationMigration } from '../support/case-complaint-confirmation-migration.mjs';

test('CA-003 forward migration preserves old submission and receipt, copies exact scopes, and retries after failure', async () => {
  test.setTimeout(180_000);
  const result = await verifyCaseComplaintConfirmationMigration();
  expect(result.empty.migrationCount).toBe(60);
  expect(result.empty.previousMigrationCount).toBe(57);
  expect(result.empty.stage).toBe(1);
  expect(result.empty.factTable).toBe(1);
  expect(result.empty.receiptTable).toBe(1);
  expect(result.upgrade.preserved).toMatchObject({
    stage: 'WAITING_COMPLAINT_CONFIRMATION',
    version: 3,
    complaint_amount_state: 'KNOWN',
    complaint_amount: '100.00',
  });
  expect(result.upgrade.oldReceiptCount).toBe(1);
  expect(result.upgrade.grants.map((grant) => grant.scope)).toEqual([
    'SELF',
    'TEAM',
  ]);
  expect(result.upgrade.revisions.active).toBe(
    result.upgrade.beforeRevision + 1,
  );
  expect(result.upgrade.revisions.inactive).toBe(1);
  expect(
    result.upgrade.versions.filter((row) => row.version === 2),
  ).toHaveLength(2);
  expect(result.upgrade.badAmountCode).toBe('23514');
  expect(result.upgrade.badStageCode).toBe('23514');
  expect(result.failure.enum).toEqual({
    failedCode: '42704',
    noPartialAction: 0,
    noPartialStage: 0,
    recoveredAction: 1,
    recoveredStage: 1,
  });
  expect(result.failure.facts).toEqual({
    failedCode: '42P07',
    noPartialStageCheck: 0,
    noReceipt: 0,
    recovered: 1,
  });
  expect(result.failure.grants).toEqual({
    failedCode: '23514',
    noPartialGrant: 0,
    unchangedTemplateVersion: 1,
    unchangedAccountRevision: 1,
    recoveredGrant: 1,
    recoveredTemplateVersion: 2,
    recoveredAccountRevision: 2,
  });
});
