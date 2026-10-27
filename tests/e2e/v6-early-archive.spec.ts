import { expect, test } from '@playwright/test';
import { verifyV6EarlyArchive } from '../support/v6-early-archive.mjs';

test.setTimeout(180_000);

test('v6 early archive keeps a real external case and old receipt consistent', async () => {
  const result = await verifyV6EarlyArchive();
  expect(result.checks).toEqual([
    'real external case archives once with exact fact, receipt and audit',
    'late receipt failure rolls back and retry succeeds; concurrent replay converges',
    'mixed batch reports each result and replays without duplicate writes',
    'real scheduled hearing and early archive compete on one case lock; one terminal action persists',
    'source and old external receipt remain unchanged',
    'same-key replay, cross-department, external principal and revoked grant are enforced',
    'new litigation fact is rejected after archive',
  ]);
});
