import { expect, test } from '@playwright/test';
import { verifyHearingEffectiveDateBridge } from '../support/hearing-effective-date-bridge-database.mjs';

test('156 effective hearing date drives only its current arrangement and serializes with record correction', async () => {
  test.setTimeout(180_000);
  const result = await verifyHearingEffectiveDateBridge();
  expect(result.migrationCount).toBe(156);
  expect(result.cases).toEqual([
    'future-to-past',
    'null-to-past',
    'past-to-future',
    'past-to-null',
    'latest-null-over-older-past',
    'replaced-arrangement-inactive',
  ]);
  expect(result.races).toEqual([
    'future-edit-first',
    'future-advance-first',
    'null-edit-first',
    'null-advance-first',
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
  expect(result.caseIds).toHaveLength(10);
  expect(new Set(result.caseIds).size).toBe(10);
  expect(result.head).toMatch(/^[a-f0-9]{40}$/u);
  expect(result.tree).toMatch(/^[a-f0-9]{40}$/u);
  expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
});
