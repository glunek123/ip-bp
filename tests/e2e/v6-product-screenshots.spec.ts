import { expect, test } from '@playwright/test';
import { verifyV6ProductScreenshots } from '../support/v6-product-screenshots.mjs';

test.setTimeout(180_000);

test('v6 product screenshots preserve product and material identities', async () => {
  const result = await verifyV6ProductScreenshots();
  expect(result.checks).toEqual([
    'late service failure rolls back version, screenshot and material reference',
    'stable product and exact PNG version persist through in-process edit',
    'cross-department, insufficient grant and archived state reject mutation',
  ]);
});
