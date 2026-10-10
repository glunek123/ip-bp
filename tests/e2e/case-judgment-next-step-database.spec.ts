import { test, expect } from '@playwright/test';
import { verifyCaseJudgmentNextStepDatabase } from '../support/case-judgment-next-step-database.mjs';

test('CA-009 real PostgreSQL choice, revocation, receipt, actor path, and stage guard', async () => {
  const result = await verifyCaseJudgmentNextStepDatabase();
  expect(result.stage).toBe('WAITING_JUDGMENT');
  expect(result.version).toBe(14);
  expect(result.checks).toHaveLength(10);
});
