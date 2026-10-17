import { expect, test } from '@playwright/test';
import { verifyRecordMaterialGuardRepair } from '../support/case-record-material-guard-repair.mjs';

// The sole runner uses a DB-only Playwright config and the shared resource lock.
// An owned-schema authorization shim reaches the real, complete 156/158 guards;
// this proves the material-reference SQL branch, not production authorization.
test('five record guards resolve material references and retain exact checks', async () => {
  test.setTimeout(300_000);
  const result = await verifyRecordMaterialGuardRepair();
  expect(result.checks).toHaveLength(10);
  expect(result.ledgerCount).toBeGreaterThanOrEqual(157);
  expect(result.publicUnchanged).toBe(true);
  expect(result.repairSha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(result.authorizationScope).toContain('guard SQL path only');
});
