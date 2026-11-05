import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearFilingBatch,
  filingActorIdentity,
  readFilingBatch,
  readFilingBatchState,
  saveFilingBatch,
  type FilingBatch,
} from './case-filing-batch-recovery';

const actor = 'user-1:INTERNAL:department-1';
const input = {
  expectedVersion: 3,
  idempotencyKey: 'key-1',
  courtId: '11111111-1111-4111-8111-111111111111',
  submittedAt: '2026-11-04',
  filingEvidenceContentVersionIds: ['22222222-2222-4222-8222-222222222222'],
};
const batch: FilingBatch = {
  identity: actor,
  batchId: '33333333-3333-4333-8333-333333333333',
  createdAt: '2026-11-04T01:00:00.000Z',
  items: [
    {
      caseId: '44444444-4444-4444-8444-444444444444',
      businessNo: 'A-1',
      state: 'PREPARED',
      input,
      courtName: '甲法院',
      evidenceFiles: [
        {
          materialId: '55555555-5555-4555-8555-555555555555',
          contentVersionId: input.filingEvidenceContentVersionIds[0]!,
          originalFilename: '诉状.pdf',
          mimeType: 'application/pdf',
        },
      ],
      screenshotFiles: [],
    },
  ],
};
beforeEach(() => globalThis.localStorage.clear());

describe('filing batch recovery', () => {
  it('keeps one account and department batch across authorization revisions', () => {
    expect(filingActorIdentity(`${actor}:1`)).toBe(actor);
    expect(filingActorIdentity(`${actor}:2`)).toBe(actor);
    expect(saveFilingBatch(batch)).toBe(true);
    expect(readFilingBatch(actor)).toEqual(batch);
    expect(readFilingBatch('other:INTERNAL:department-1')).toBeNull();
  });
  it('refuses to replace a live batch or lose an original body and key', () => {
    expect(saveFilingBatch(batch)).toBe(true);
    expect(
      saveFilingBatch({
        ...batch,
        batchId: '55555555-5555-4555-8555-555555555555',
      }),
    ).toBe(false);
    expect(readFilingBatch(actor)?.items[0]?.input).toEqual(input);
    expect(
      clearFilingBatch({
        ...batch,
        batchId: '55555555-5555-4555-8555-555555555555',
      }),
    ).toBe(false);
    expect(clearFilingBatch(batch)).toBe(true);
    expect(readFilingBatch(actor)).toBeNull();
  });
  it('rejects malformed records before a new write', () => {
    globalThis.localStorage.setItem(
      `case-filing-batch-v2:${encodeURIComponent(actor)}`,
      JSON.stringify({
        ...batch,
        items: [{ ...batch.items[0], input: { ...input, idempotencyKey: '' } }],
      }),
    );
    expect(readFilingBatch(actor)).toBeNull();
    expect(readFilingBatchState(actor)).toEqual({ state: 'blocked' });
    expect(saveFilingBatch(batch)).toBe(false);
  });
  it('keeps different actors in separate keys', () => {
    const other = { ...batch, identity: 'other:INTERNAL:department-1' };
    expect(saveFilingBatch(batch)).toBe(true);
    expect(saveFilingBatch(other)).toBe(true);
    expect(readFilingBatch(actor)).toEqual(batch);
    expect(readFilingBatch(other.identity)).toEqual(other);
  });
  it('requires a valid result only for COMMITTED records', () => {
    expect(
      saveFilingBatch({
        ...batch,
        items: [{ ...batch.items[0]!, state: 'COMMITTED' }],
      }),
    ).toBe(false);
    expect(
      saveFilingBatch({
        ...batch,
        items: [
          {
            ...batch.items[0]!,
            result: {
              id: batch.items[0]!.caseId,
              stage: 'WAITING_FORMAL_ACCEPTANCE',
              version: 4,
              submittedAt: input.submittedAt,
              recordedAt: '2026-11-04T01:00:00Z',
            },
          },
        ],
      }),
    ).toBe(false);
  });
  it('rejects a committed receipt with a later unrelated version', () => {
    expect(
      saveFilingBatch({
        ...batch,
        items: [
          {
            ...batch.items[0]!,
            state: 'COMMITTED',
            result: {
              id: batch.items[0]!.caseId,
              stage: 'WAITING_FORMAL_ACCEPTANCE',
              version: input.expectedVersion + 2,
              submittedAt: input.submittedAt,
              recordedAt: '2026-11-04T01:00:00Z',
            },
          },
        ],
      }),
    ).toBe(false);
  });
});
