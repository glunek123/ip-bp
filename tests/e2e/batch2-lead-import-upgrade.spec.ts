import { expect, test } from '@playwright/test';
import { verifyBatch2LeadImportUpgrade } from '../support/batch2-lead-import-upgrade.mjs';

test('owned 184→190 migration preserves legacy receipts, retries failed DDL and fences new identity', async () => {
  test.setTimeout(600_000);
  const result = await verifyBatch2LeadImportUpgrade();
  expect(result).toMatchObject({
    migrationCount: 190,
    oldReceiptPreserved: true,
    forgedOwnerRejected: true,
    crossDepartmentRetryRejected: true,
    wrongProductRejected: true,
    faultRollbackAndRetry: true,
  });
  expect(result.newResponsibleOwner).toMatch(/^[a-f0-9-]{36}$/u);
  expect(result.retryActor).toBe(result.newResponsibleOwner);
});
