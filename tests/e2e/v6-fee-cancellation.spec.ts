import { expect, test } from '@playwright/test';
import { verifyV6FeeCancellation } from '../support/v6-fee-cancellation.mjs';

test.setTimeout(180_000);

test('v6 cancellation and refund ledger uses verified actual payment', async () => {
  const result = await verifyV6FeeCancellation();
  expect(result.checks).toEqual([
    'archived case retains finance; paid and issued fees void, unopened fee deletes',
    'voiding preserves unknown payment until actual amount is verified',
    'explicit zero differs from unknown and nominal amount never caps refund',
    'late refund failure rolls back audit and fact, then same key retries',
    'same-case proof binds exact active version; cross-case and cross-department proofs reject',
    'frozen payment proof rejects head update; independent refund proof freezes its exact version',
    'orphan payment and refund proof references insert but fail at deferred COMMIT with no residual audit or reference',
    'partial, repeated and concurrent refunds stay within verified payment',
    'low grant and cross-department actor cannot reconcile a refund',
  ]);
});
