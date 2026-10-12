import { expect, test } from '@playwright/test';
import {
  verifyCaseExecutionSubmissionDatabase,
  verifyDirectExecutionChoiceRace,
  verifyExecutionAppealSource,
} from '../support/case-execution-submission-database.mjs';

test('CA-011 PostgreSQL command preserves execution submissions, files and receipts', async () => {
  expect(await verifyCaseExecutionSubmissionDatabase()).toEqual({
    first: true,
    concurrentSingleWinner: true,
    faultRollbacks: true,
    replay: true,
    revokedReplay: 'ACTION_FORBIDDEN',
    changedKey: 'IDEMPOTENCY_CONFLICT',
    firstRead: true,
    lawyerRead: true,
    resubmitted: true,
    lawyerSubmitted: true,
    lawyerUploadBytes: true,
    lawyerRevokedReplay: 'ACTION_FORBIDDEN',
    lawyerAssignmentRevokedReplay: 'ACTION_FORBIDDEN',
    staleAnchor: 'INVALID_STATE',
    noChange: 'INVALID_STATE',
    serviceChoiceBlocked: 'INVALID_STATE',
    history: true,
    lawyerHistory: true,
    oldFrozenBytes: true,
    blockedRevocation: '23514',
    bypassStage: '23514',
    final: true,
  });
});

test('CA-011 accepts current CHANGE result and blocks later result revocation in service and SQL', async () => {
  expect(await verifyExecutionAppealSource('CHANGE', false)).toEqual({
    badSourcesRejected: true,
    accepted: true,
    serviceBlocked: 'INVALID_STATE',
    sqlBlocked: '23514',
  });
});

test('CA-011 concurrent AFFIRM source revocation and submission have one winner', async () => {
  expect(await verifyExecutionAppealSource('AFFIRM', true)).toEqual({
    badSourcesRejected: true,
    raceSingleWinner: true,
  });
});

test('CA-011 rejects a REMAND result as execution source', async () => {
  expect(await verifyExecutionAppealSource('REMAND', false)).toEqual({
    remandRejected: 'INVALID_STATE',
    noFact: true,
  });
});

test('CA-011 concurrent direct choice revocation and submission have one winner', async () => {
  expect(await verifyDirectExecutionChoiceRace()).toEqual({
    raceSingleWinner: true,
  });
});
