import { afterEach, expect, it, vi } from 'vitest';
import {
  clearPendingCaseSupplement,
  getPendingCaseSupplement,
  setPendingCaseSupplement,
} from './case-supplement-pending';

const caseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actorKey = 'user-a:revision-1';
const input = {
  kind: 'COURT_PREPAYMENT_NOTICE' as const,
  trialRoundId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  amount: '123.45',
  reason: '通知',
  idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
};
afterEach(() => globalThis.localStorage.clear());

it('keeps the original request across module reload and isolates actor and case', async () => {
  setPendingCaseSupplement({ actorKey, caseId, input });
  vi.resetModules();
  const reloaded = await import('./case-supplement-pending');
  expect(reloaded.getPendingCaseSupplement(actorKey, caseId)).toEqual({
    actorKey,
    caseId,
    input,
  });
  expect(getPendingCaseSupplement('user-b:revision-1', caseId)).toBeNull();
  expect(
    getPendingCaseSupplement(actorKey, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  ).toBeNull();
  clearPendingCaseSupplement(actorKey, caseId, 'different-key');
  expect(getPendingCaseSupplement(actorKey, caseId)).toEqual({
    actorKey,
    caseId,
    input,
  });
  clearPendingCaseSupplement(actorKey, caseId, input.idempotencyKey);
  expect(getPendingCaseSupplement(actorKey, caseId)).toBeNull();
});
