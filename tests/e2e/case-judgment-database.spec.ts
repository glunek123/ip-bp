import { expect, test } from '@playwright/test';
import { verifyCaseJudgmentDatabase } from '../support/case-judgment-database.mjs';

test('CA-008 real PostgreSQL registration freezes bytes, preserves hearing advance, rolls back failure and appends correction', async () => {
  test.setTimeout(300_000);
  expect(await verifyCaseJudgmentDatabase()).toEqual({
    stage: 'WAITING_JUDGMENT',
    version: 10,
    judgmentFacts: 1,
    hearingAdvances: 1,
    currentMatches: true,
    frozenVersions: 1,
    frozenReferences: 1,
    bytesMatch: true,
    replaySame: true,
    hearingBlocked: 'INVALID_STATE',
    stale: 'VERSION_CONFLICT',
    noFile: 'VALIDATION_ERROR',
    faultRaised: true,
    rollbackFacts: true,
    rollbackCase: true,
    correctedStage: 'WAITING_JUDGMENT',
    correctedVersion: 11,
    historyCount: 2,
    priorMatches: true,
    nullEvent: '23514',
    sameEvent: '23505',
    nonJudgmentFirst: null,
    nonJudgmentDuplicate: '23505',
    reusedVersionAcrossFacts: 2,
    immutableFact: '23514',
    reverseStage: '23514',
    concurrentResults: ['OK:12', 'VERSION_CONFLICT'],
    afterRace: 3,
    revokedReplay: 'ACTION_FORBIDDEN',
    otherDepartment: 'RESOURCE_NOT_FOUND',
  });
});
