import { expect, test } from '@playwright/test';
import {
  clearCoreCaseHearingFixture,
  inspectCoreCaseHearingFixture,
  inspectCoreCaseHearingGuards,
  seedCoreCaseHearingFixture,
  withCoreCaseHearingCleanupFault,
  verifyCaseHearingDatabase,
} from '../support/case-hearing-database.mjs';
import { clearCaseAcceptanceFixture } from '../support/case-acceptance-database.mjs';
import {
  coreLeadFixtures,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';

test('CA-007 persisted schedule restarts into one system advance, then repeated corrections and a new advance', async () => {
  test.setTimeout(300_000);
  const result = await verifyCaseHearingDatabase();
  expect(result).toEqual({
    initialVersion: 8,
    lawyerScheduled: true,
    replaySame: true,
    revokedReplayDenied: true,
    rollbackSaveClean: true,
    beforeDue: 0,
    failedAdvanceCount: 1,
    rollbackAdvanceClean: true,
    startupAdvanced: 1,
    secondStartupAdvanced: 0,
    firstAdvanceCount: 1,
    firstSystemAuditCount: 1,
    firstSystemActorNull: true,
    rollbackCorrectionClean: true,
    overdueStage: 'WAITING_JUDGMENT',
    overdueAdvanceSame: true,
    againOverdueStage: 'WAITING_JUDGMENT',
    againAdvanceSame: true,
    futureStage: 'WAITING_HEARING',
    futureAdvanceNull: true,
    secondAdvanced: 1,
    finalAdvanceCount: 2,
    finalSystemAuditCount: 2,
    historyArrangementCount: 4,
    correctionCount: 3,
    immutableArrangement: '23514',
    immutableAdvance: '23514',
    immutableAudit: '23514',
    earlyDateSQL: '23514',
    mismatchAuditSQL: '23514',
    duplicateAdvance: '23505',
    auditReasonMismatch: '23514',
    auditPriorArrangementMismatch: '23514',
    auditPriorAdvanceMismatch: '23514',
    auditResultStageMismatch: '23514',
    staleAdvanceChain: '23514',
    staleJudgmentChain: '23514',
  });
});

test('CA-007 hearing arrangement, advance and correction do not block scoped fixture cleanup', async () => {
  test.setTimeout(300_000);
  await clearCaseAcceptanceFixture();
  await resetCoreLeadE2eData();
  const caseId = await seedCoreCaseHearingFixture(coreLeadFixtures.departmentA);
  const otherCaseId = await seedCoreCaseHearingFixture(
    coreLeadFixtures.departmentB,
  );
  expect(await inspectCoreCaseHearingFixture(caseId)).toEqual({
    arrangements: 2,
    advances: 1,
    corrections: 1,
  });
  const guardsBefore = await inspectCoreCaseHearingGuards();
  expect(guardsBefore).toHaveLength(5);
  expect(guardsBefore.every((guard) => guard.enabled === 'O')).toBe(true);
  await withCoreCaseHearingCleanupFault(async () => {
    await expect(
      clearCoreCaseHearingFixture([coreLeadFixtures.departmentA]),
    ).rejects.toThrow('injected hearing cleanup failure');
  });
  expect(await inspectCoreCaseHearingGuards()).toEqual(guardsBefore);
  expect(await inspectCoreCaseHearingFixture(caseId)).toEqual({
    arrangements: 2,
    advances: 1,
    corrections: 1,
  });
  await clearCoreCaseHearingFixture([coreLeadFixtures.departmentA]);
  expect(await inspectCoreCaseHearingFixture(caseId)).toEqual({
    arrangements: 0,
    advances: 0,
    corrections: 0,
  });
  expect(await inspectCoreCaseHearingFixture(otherCaseId)).toEqual({
    arrangements: 2,
    advances: 1,
    corrections: 1,
  });
  expect(await inspectCoreCaseHearingGuards()).toEqual(guardsBefore);
  await clearCaseAcceptanceFixture();
  await resetCoreLeadE2eData();
  expect(await inspectCoreCaseHearingFixture(otherCaseId)).toEqual({
    arrangements: 0,
    advances: 0,
    corrections: 0,
  });
});
