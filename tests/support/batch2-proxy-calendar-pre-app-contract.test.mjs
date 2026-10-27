import assert from 'node:assert/strict';
import test from 'node:test';
import { assertBatch2ConsolidationProbe } from './batch2-proxy-calendar-pre-app-contract.mjs';

const completeResult = {
  before: 0,
  preserved: 2,
  tables: 4,
  incompleteRoot: '23514',
  rootAfterFailed: 0,
  incompleteRootRetry: '23514',
  childProgress: '23514',
  immutableMember: '55000',
  mainProgress: null,
};

test('pre-app accepts the complete 188 probe result', () => {
  assert.doesNotThrow(() => assertBatch2ConsolidationProbe(completeResult));
});

test('pre-app rejects omitted or changed failed-root probes', () => {
  const missing = { ...completeResult };
  delete missing.rootAfterFailed;
  assert.throws(() => assertBatch2ConsolidationProbe(missing));
  assert.throws(() =>
    assertBatch2ConsolidationProbe({
      ...completeResult,
      incompleteRootRetry: null,
    }),
  );
});
