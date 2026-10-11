import { expect, test } from '@playwright/test';
import { clearCaseAcceptanceFixture } from '../support/case-acceptance-database.mjs';
import { clearCoreCaseSecondInstanceFixture } from '../support/case-second-instance-database.mjs';

test('CA-010 core fixture cleanup precedes legacy acceptance cleanup and repeats safely', async () => {
  const cleared = await clearCoreCaseSecondInstanceFixture();
  expect(Array.isArray(cleared)).toBe(true);
  await clearCaseAcceptanceFixture();
  expect(await clearCoreCaseSecondInstanceFixture()).toEqual([]);
  await clearCaseAcceptanceFixture();
});
