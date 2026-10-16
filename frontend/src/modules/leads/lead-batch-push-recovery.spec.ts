import { afterEach, describe, expect, it } from 'vitest';
import {
  readPendingLeadBatchPush,
  savePendingLeadBatchPush,
  sameLeadBatchPush,
  type FrozenLeadBatchPush,
} from './lead-batch-push-recovery';

const attempt: FrozenLeadBatchPush = {
  identity: 'actor:INTERNAL:dept',
  idempotencyKey: 'fixed-key',
  items: [
    { leadId: '33333333-3333-4333-8333-333333333333', expectedVersion: 4 },
  ],
};

describe('lead batch recovery', () => {
  afterEach(() => localStorage.clear());
  it('round-trips the exact ordered request and idempotency key', () => {
    expect(savePendingLeadBatchPush({ [attempt.identity]: attempt })).toBe(
      true,
    );
    const restored = readPendingLeadBatchPush()?.[attempt.identity];
    expect(restored).toEqual(attempt);
    expect(sameLeadBatchPush(restored!, attempt)).toBe(true);
  });
  it('fails closed on malformed or unavailable local recovery data', () => {
    localStorage.setItem('lead-batch-push-pending-v1', '{');
    expect(readPendingLeadBatchPush()).toBeNull();
  });
  it('recovers an older authorization-revision key for the same actor and preserves other actors separately', () => {
    const legacyIdentity = 'actor:INTERNAL:dept:7';
    const legacy = { ...attempt, identity: legacyIdentity, uncertain: false };
    const other = {
      ...attempt,
      identity: 'another-actor:INTERNAL:another-dept:2',
      idempotencyKey: 'other-key',
    };
    localStorage.setItem(
      'lead-batch-push-pending-v1',
      JSON.stringify({ [legacyIdentity]: legacy, [other.identity]: other }),
    );
    const restored = readPendingLeadBatchPush();
    expect(restored?.[attempt.identity]).toEqual({
      ...attempt,
      uncertain: true,
    });
    expect(restored?.['another-actor:INTERNAL:another-dept']).toMatchObject({
      idempotencyKey: 'other-key',
      identity: 'another-actor:INTERNAL:another-dept',
    });
  });
});
