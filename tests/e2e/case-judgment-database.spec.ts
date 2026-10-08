import { expect, test } from '@playwright/test';
import {
  verifyCaseJudgmentDatabase,
  verifyCoreCaseJudgmentFixtureCleanup,
} from '../support/case-judgment-database.mjs';
import {
  coreLeadFixtures,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';

test('CA-008 real PostgreSQL registration freezes bytes, preserves hearing advance, rolls back failure and appends correction', async () => {
  test.setTimeout(300_000);
  expect(await verifyCaseJudgmentDatabase()).toEqual({
    stage: 'WAITING_JUDGMENT',
    version: 10,
    judgmentFacts: 1,
    hearingAdvances: 1,
    currentMatches: true,
    frozenVersions: 10,
    frozenReferences: 10,
    elevenSelected: 'VALIDATION_ERROR',
    replacementVersion: 13,
    originalReferencesAfterReplacement: 10,
    originalBytesPreserved: true,
    pendingPool: 10,
    pendingExcess: 'VALIDATION_ERROR',
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
    sameEvent: '23514',
    extraSameEvent: '23514',
    unmatchedFactEvent: '23514',
    originalReferenceSetPreserved: true,
    nonJudgmentFirst: null,
    nonJudgmentDuplicate: '23505',
    updateOtherPurposeReference: null,
    reusedVersionAcrossFacts: 2,
    changeFrozenReference: '23514',
    deleteFrozenReference: '23514',
    deleteOtherPurposeReference: null,
    preservedFrozenReference: true,
    immutableFact: '23514',
    reverseStage: '23514',
    concurrentResults: ['OK:12', 'VERSION_CONFLICT'],
    afterRace: 3,
    revokedReplay: 'ACTION_FORBIDDEN',
    otherDepartment: 'RESOURCE_NOT_FOUND',
  });
});

test('CA-008 core-lead fixture cleanup is scoped and restores guards after failure', async () => {
  test.setTimeout(300_000);
  expect(
    await verifyCoreCaseJudgmentFixtureCleanup(
      coreLeadFixtures,
      resetCoreLeadE2eData,
    ),
  ).toEqual({
    faultRejected: true,
    rollbackPreserved: true,
    guardsRestored: true,
    targetRemoved: true,
    otherDepartmentPreserved: true,
    unknownOwnerRejected: true,
    unknownOwnerPreserved: true,
    disabledGuardRejected: true,
    replicationRoleRestored: true,
  });
});
