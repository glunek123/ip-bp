import { expect, test } from '@playwright/test';
import { verifyCaseExecutionFinishDatabase } from '../support/case-execution-finish-database.mjs';

test('CA-015 PostgreSQL atomic finish and immutable evidence on an isolated synthetic fixture', async () => {
  const result = await verifyCaseExecutionFinishDatabase();
  expect(result).toMatchObject({
    wrongSource: 'INVALID_STATE',
    wrongVersion: 'VERSION_CONFLICT',
    noBasis: 'VALIDATION_ERROR',
    future: 'VALIDATION_ERROR',
    clientDenied: 'ACTION_FORBIDDEN',
    notaryDenied: 'ACTION_FORBIDDEN',
    foreignDenied: 'CASE_NOT_FOUND',
    wrongMaterial: 'MATERIAL_VERSION_INVALID',
    stageOnly: '23514',
    singleWinner: true,
    replay: true,
    conflict: 'IDEMPOTENCY_CONFLICT',
    disabledReplay: 'ACTION_FORBIDDEN',
    revokedReplay: 'ACTION_FORBIDDEN',
    restoredReplay: true,
    refusedReplayUnchanged: true,
    finalState: true,
    exactBasis: true,
    oldFactsPreserved: true,
  });
  expect(Object.values(result.faults)).toEqual(Array(6).fill(true));
  expect(Object.values(result.immutable)).toEqual(Array(7).fill('23514'));
});
