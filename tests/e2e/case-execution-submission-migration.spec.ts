import { expect, test } from '@playwright/test';
import { verifyCaseExecutionSubmissionMigration } from '../support/case-execution-submission-migration.mjs';

test('CA-011 upgrades 130 migrations and preserves direct execution history across first submit and resubmit', async () => {
  expect(await verifyCaseExecutionSubmissionMigration()).toEqual({
    migrationCount: 134,
    oldChainPreserved: true,
    first: true,
    resubmitted: true,
    history: true,
    invalidRejected: true,
    atomic: true,
    retry: true,
    lawyerDraftBefore: { accepted: false, rejectedCode: '23514' },
    lawyerDraft: { accepted: true, rejectedCode: null },
    lawyerDraftAfterSubmit: { accepted: true, rejectedCode: null },
    actorInvalidRejected: true,
    actorAtomic: true,
    actorRetry: true,
    emptyChain: true,
  });
});
