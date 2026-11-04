import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearLawyerAssignmentBatch,
  readLawyerAssignmentBatch,
  saveLawyerAssignmentBatch,
  type LawyerAssignmentBatch,
} from './case-lawyer-assignment-batch-recovery';
const identity = 'user-1:INTERNAL:department-1';
const caseId = '11111111-1111-4111-8111-111111111111';
const lawyerAccountId = '22222222-2222-4222-8222-222222222222';
const lawyerProfileId = '33333333-3333-4333-8333-333333333333';
const batch: LawyerAssignmentBatch = {
  identity,
  batchId: '44444444-4444-4444-8444-444444444444',
  target: {
    lawyerAccountId,
    lawyerProfileId,
    displayName: '张律师',
    username: 'zhang',
  },
  items: [
    {
      caseId,
      businessNo: 'A-1',
      state: 'PREPARED',
      input: {
        expectedVersion: 1,
        idempotencyKey: 'key-1',
        lawyerAccountId,
        lawyerProfileId,
      },
    },
  ],
};
beforeEach(() => globalThis.localStorage.clear());
describe('lawyer assignment batch recovery', () => {
  it('isolates each actor and keeps original body and key', () => {
    expect(saveLawyerAssignmentBatch(batch)).toBe(true);
    const other = { ...batch, identity: 'user-2:INTERNAL:department-1' };
    expect(saveLawyerAssignmentBatch(other)).toBe(true);
    expect(readLawyerAssignmentBatch(identity)).toEqual({
      state: 'valid',
      batch,
    });
    expect(readLawyerAssignmentBatch(other.identity)).toEqual({
      state: 'valid',
      batch: other,
    });
  });
  it('fails closed for damaged storage and blocks batch replacement', () => {
    globalThis.localStorage.setItem(
      `case-lawyer-assignment-batch-v1:${encodeURIComponent(identity)}`,
      '{bad',
    );
    expect(readLawyerAssignmentBatch(identity)).toEqual({ state: 'blocked' });
    expect(saveLawyerAssignmentBatch(batch)).toBe(false);
    globalThis.localStorage.clear();
    expect(saveLawyerAssignmentBatch(batch)).toBe(true);
    expect(
      saveLawyerAssignmentBatch({
        ...batch,
        batchId: '55555555-5555-4555-8555-555555555555',
      }),
    ).toBe(false);
    expect(clearLawyerAssignmentBatch(batch)).toBe(true);
  });
  it('does not accept a committed marker without its result', () => {
    expect(
      saveLawyerAssignmentBatch({
        ...batch,
        items: [{ ...batch.items[0]!, state: 'ASSIGNED' }],
      }),
    ).toBe(false);
  });
  it('rejects forged success markers with wrong versions or relationships', () => {
    const result = {
      id: caseId,
      stage: 'PENDING_MATCH' as const,
      version: 2,
      outcome: 'ASSIGNED' as const,
      requestedLawyerAccountId: lawyerAccountId,
      previousAssignment: null,
      currentAssignment: {
        id: '55555555-5555-4555-8555-555555555555',
        lawyerAccountId,
        lawyerProfileId,
        assignedAt: '2026-11-04T01:00:00Z',
      },
    };
    for (const bad of [
      { ...result, version: 3 },
      { ...result, previousAssignment: result.currentAssignment },
      {
        ...result,
        currentAssignment: {
          ...result.currentAssignment,
          lawyerProfileId: '66666666-6666-4666-8666-666666666666',
        },
      },
    ]) {
      expect(
        saveLawyerAssignmentBatch({
          ...batch,
          items: [{ ...batch.items[0]!, state: 'ASSIGNED', result: bad }],
        }),
      ).toBe(false);
    }
  });
});
