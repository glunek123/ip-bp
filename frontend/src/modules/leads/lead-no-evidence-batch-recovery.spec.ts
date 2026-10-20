import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPendingLeadNoEvidenceBatch,
  readPendingLeadNoEvidenceBatches,
  savePendingLeadNoEvidenceBatches,
  type FrozenLeadNoEvidenceBatch,
} from './lead-no-evidence-batch-recovery';
const identity = 'actor:INTERNAL:department';
const attempt = (): FrozenLeadNoEvidenceBatch => ({
  identity,
  idempotencyKey: 'original-key',
  input: {
    items: [
      {
        leadId: 'ABCDEFAB-1234-4234-8234-123456789ABC',
        expectedVersion: 2,
        reason: ' 原始原因\n ',
      },
    ],
  },
});
describe('no evidence batch recovery', () => {
  beforeEach(() => localStorage.clear());
  it('roundtrips the full ordered original body, reason and key', () => {
    expect(savePendingLeadNoEvidenceBatches({ [identity]: attempt() })).toBe(
      true,
    );
    expect(readPendingLeadNoEvidenceBatches()).toEqual({
      [identity]: attempt(),
    });
    expect(clearPendingLeadNoEvidenceBatch(attempt())).toBe(true);
    expect(readPendingLeadNoEvidenceBatches()).toEqual({});
  });
  it('does not clear or overwrite a different saved attempt', () => {
    const newer = { ...attempt(), idempotencyKey: 'newer' };
    savePendingLeadNoEvidenceBatches({ [identity]: newer });
    expect(clearPendingLeadNoEvidenceBatch(attempt())).toBe(false);
    expect(readPendingLeadNoEvidenceBatches()?.[identity]).toEqual(newer);
  });
  it.each([
    '{broken',
    '[]',
    JSON.stringify({ [identity]: { ...attempt(), actorId: 'forged' } }),
    JSON.stringify({ 'other:INTERNAL:department': attempt() }),
    JSON.stringify({ [identity]: { ...attempt(), input: { items: [] } } }),
  ])('fails closed for invalid persistence %s', (raw) => {
    localStorage.setItem('lead-no-evidence-batch-pending-v1', raw);
    expect(readPendingLeadNoEvidenceBatches()).toBeNull();
  });
});
