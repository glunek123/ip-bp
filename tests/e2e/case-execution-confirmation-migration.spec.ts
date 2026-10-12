import { expect, test } from '@playwright/test';
import { verifyCaseExecutionConfirmationMigration } from '../support/case-execution-submission-migration.mjs';

test('CA-012 upgrades the full migration chain and guards confirmed execution history', async () => {
  expect(await verifyCaseExecutionConfirmationMigration()).toEqual({
    migrationCount: 136,
    emptyChain: true,
    sameScopePermission: true,
    invalidStage: '23514',
    oldHistoryPreserved: true,
    directResubmit: '23514',
    directSubmissionInsert: '23514',
    enumFailureAtomic: true,
    guardFailureAtomic: true,
    guardRetry: true,
  });
});
