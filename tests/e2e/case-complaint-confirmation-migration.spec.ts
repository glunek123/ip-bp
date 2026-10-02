import { expect, test } from '@playwright/test';
import { verifyCaseComplaintConfirmationMigration } from '../support/case-complaint-confirmation-migration.mjs';

test('CA-003 forward migration preserves old submission and receipt, copies exact scopes, and retries after failure', async () => {
  test.setTimeout(180_000);
  const result = await verifyCaseComplaintConfirmationMigration();
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
  expect(result.failure.failedCode).toBe('42P07');
  expect(result.failure.noPartialStageCheck).toBe(0);
  expect(result.failure.noReceipt).toBe(0);
  expect(result.failure.recovered).toBe(1);
});
