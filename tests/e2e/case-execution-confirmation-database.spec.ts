import { expect, test } from '@playwright/test';
import {
  verifyCaseExecutionConfirmationDatabase,
  verifyExecutionConfirmationAppealSources,
} from '../support/case-execution-submission-database.mjs';

test('CA-012 PostgreSQL confirmation seals the complete submitted bundle atomically', async () => {
  expect(await verifyCaseExecutionConfirmationDatabase()).toEqual({
    source: true,
    wrongSubmission: 'INVALID_STATE',
    wrongCase: 'CASE_NOT_FOUND',
    faultRollbacks: true,
    raceSingleWinner: true,
    raceBoundCurrent: true,
    response: true,
    replay: true,
    changedKey: 'IDEMPOTENCY_CONFLICT',
    revokedReplay: 'ACTION_FORBIDDEN',
    internalProjection: true,
    lawyerProjection: true,
    resubmitBlocked: 'INVALID_STATE',
    sqlResubmitBlocked: '23514',
    rejectedStageReversal: '23514',
    singleFact: true,
    preservedBundle: true,
  });
});

test('CA-012 confirms execution submissions sourced from CHANGE and AFFIRM outcomes', async () => {
  expect(await verifyExecutionConfirmationAppealSources()).toEqual({
    change: true,
    affirm: true,
  });
});
