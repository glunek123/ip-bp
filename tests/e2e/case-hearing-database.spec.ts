import { expect, test } from '@playwright/test';
import { verifyCaseHearingDatabase } from '../support/case-hearing-database.mjs';

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
    futureStage: 'WAITING_HEARING',
    futureAdvanceNull: true,
    secondAdvanced: 1,
    finalAdvanceCount: 2,
    finalSystemAuditCount: 2,
    historyArrangementCount: 3,
    correctionCount: 2,
    immutableArrangement: '23514',
    immutableAdvance: '23514',
    immutableAudit: '23514',
    earlyDateSQL: '23514',
    mismatchAuditSQL: '23514',
    duplicateAdvance: '23505',
  });
});
