import { expect, test } from '@playwright/test';
import { verifyCaseSecondInstanceDatabase } from '../support/case-second-instance-database.mjs';

test('CA-010 real PostgreSQL preserves anchors, remand history, receipts and atomic rollback', async () => {
  expect(await verifyCaseSecondInstanceDatabase()).toEqual({
    saved: true,
    saveReplay: true,
    changedKey: 'IDEMPOTENCY_CONFLICT',
    remand: true,
    remandReplay: true,
    oldRound: 'INVALID_STATE',
    clearedPointers: true,
    restored: true,
    revokedChildReactivation: '23503',
    bypassStage: '23514',
    immutableResult: '23514',
    faultRaised: true,
    rollback: true,
    progressRevision: true,
    repeatedFrozenVersions: true,
    preservedProgressBytes: true,
    noAudit: '23514',
    wrongCase: '23514',
    wrongPurpose: '23514',
    wrongDepartment: '23514',
    wrongResultCategory: 'MATERIAL_VERSION_INVALID',
    lawyerRead: true,
    roundHistory: true,
    remandRead: true,
    lawyerFile: true,
    clientRead: true,
    clientSecondFileDenied: true,
    formerLawyerDenied: true,
    formerFileDenied: true,
    race: ['OK:16', 'VERSION_CONFLICT'],
    final: true,
  });
});
