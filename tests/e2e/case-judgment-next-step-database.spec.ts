import { test, expect } from '@playwright/test';
import {
  verifyCaseJudgmentNextStepDatabase,
  verifyCaseJudgmentNextStepWithRealJudgment,
  verifyJudgmentChoiceCorrectionRace,
  verifyCoreCaseJudgmentNextStepFixtureCleanup,
} from '../support/case-judgment-next-step-database.mjs';
import {
  coreLeadFixtures,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';

test('CA-009 real PostgreSQL choice, revocation, receipt, actor path, and stage guard', async () => {
  const result = await verifyCaseJudgmentNextStepDatabase();
  expect(result.stage).toBe('WAITING_JUDGMENT');
  expect(result.version).toBe(14);
  expect(result.checks).toEqual(
    expect.arrayContaining([
      'audit insert failure rolls back whole choice',
      'choice fact insert failure rolls back whole choice',
      'appeal party insert failure rolls back whole choice',
      'receipt insert failure rolls back whole choice',
      'different-key concurrent revocations allow one winner',
      'direct SQL valid chain baseline accepted',
      'direct SQL wrong judgment anchor rejected',
      'direct SQL wrong version chain rejected',
      'direct SQL no appeal party rejected',
      'direct SQL execution with appeal party rejected',
      'direct SQL mismatched audit rejected',
      'direct SQL mismatched receipt rejected',
      'direct SQL foreign-case defendant rejected',
      'direct SQL cross-case choice pointer rejected',
    ]),
  );
});

test('CA-009 choice and full judgment correction compete under one case lock', async () => {
  const result = await verifyJudgmentChoiceCorrectionRace();
  expect(result.oneWinner).toBe(true);
  expect(result.atomic).toBe(true);
  expect(['INVALID_STATE', 'VERSION_CONFLICT']).toContain(result.loserCode);
});

test('CA-009 revokes a choice then corrects with real frozen judgment files over HTTP', async ({
  request,
}) => {
  const result = await verifyCaseJudgmentNextStepWithRealJudgment(request);
  expect(result).toEqual({
    choiceStage: 'SECOND_INSTANCE',
    revokedStage: 'WAITING_JUDGMENT',
    correctedVersion: 13,
    bytesPreserved: true,
  });
});

test('CA-009 fixture cleanup rolls back failed deletion and restores immutable guards', async () => {
  const result = await verifyCoreCaseJudgmentNextStepFixtureCleanup(
    coreLeadFixtures,
    resetCoreLeadE2eData,
  );
  expect(result).toEqual({
    faultRejected: true,
    rollbackPreserved: true,
    guardsRestored: true,
    targetRemoved: true,
    guardsEnabledAfterSuccess: true,
  });
});
