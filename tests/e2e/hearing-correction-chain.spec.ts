import { expect, test } from '@playwright/test';
import { verifyHearingCorrectionChain } from '../support/hearing-correction-chain-database.mjs';

test('current 155: repeated hearing corrections preserve exact advance history and serialize with scheduling and judgment', async () => {
  test.setTimeout(180_000);
  const result = await verifyHearingCorrectionChain();
  expect(result.migrationCount).toBe(155);
  expect(result.branches).toEqual(['2026-10-08', '2026-10-10', null]);
  expect(result.races).toEqual([
    'schedule-first',
    'advance-first',
    'judgment-before-correction',
    'correction-before-judgment',
  ]);
  expect(result.lockProofs.map((proof) => proof.race)).toEqual(result.races);
  for (const proof of result.lockProofs) {
    let previous = -1;
    for (const event of [
      'first:acquired',
      'second:attempt',
      'first:barrier-released',
      'second:acquired',
    ]) {
      const index = proof.events.indexOf(event);
      expect(index, `${proof.race}: ${event}`).toBeGreaterThan(previous);
      previous = index;
    }
  }
  expect(result.scanStateChecks).toEqual([
    'non-candidate-correction-first',
    'non-candidate-advance-first',
  ]);
  expect(result.caseIds).toHaveLength(9);
  expect(new Set(result.caseIds).size).toBe(9);
  expect(result.revokedReplayDenied).toBe(true);
  expect(result.head).toMatch(/^[a-f0-9]{40}$/u);
  expect(result.tree).toMatch(/^[a-f0-9]{40}$/u);
  expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
});
