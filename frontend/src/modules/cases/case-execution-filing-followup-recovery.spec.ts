import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearFollowupPending,
  findFollowupPending,
  readFollowupPending,
  saveFollowupPending,
  type FollowupPending,
  type FollowupBody,
} from './case-execution-filing-followup-recovery';

const caseId = '11111111-1111-4111-8111-111111111111';
const filingId = '22222222-2222-4222-8222-222222222222';
const rootId = '33333333-3333-4333-8333-333333333333';
const request: FollowupPending = {
  identity: {
    actor: 'INTERNAL:user-1:dept-1:rev-1',
    caseId,
    filingId,
    command: 'record-feedback',
    rootId,
  },
  body: {
    feedbackId: rootId,
    expectedRevision: 0,
    idempotencyKey: 'fixed-key',
    feedbackOn: null,
    courtCaseNo: null,
    content: '法院通知补充资料',
  },
};

beforeEach(() => sessionStorage.clear());

describe('execution filing followup recovery', () => {
  it('keeps the exact request, actor, filing and root across reload', () => {
    saveFollowupPending(request);
    expect(readFollowupPending(request.identity)).toEqual(request);
    expect(
      findFollowupPending(request.identity.actor, caseId, filingId),
    ).toEqual([request]);
    expect(
      findFollowupPending(
        request.identity.actor,
        caseId.toUpperCase(),
        filingId.toUpperCase(),
      ),
    ).toEqual([request]);
    expect(findFollowupPending('other', caseId, filingId)).toEqual([]);
    expect(findFollowupPending(request.identity.actor, caseId, rootId)).toEqual(
      [],
    );
    sessionStorage.setItem(
      'case-execution-filing-followup:v1:other:%bad',
      '{bad',
    );
    expect(
      findFollowupPending(request.identity.actor, caseId, filingId),
    ).toEqual([request]);
    expect(() =>
      saveFollowupPending({
        ...request,
        body: { ...request.body, idempotencyKey: 'new-key' },
      }),
    ).toThrow();
    clearFollowupPending(request);
    expect(readFollowupPending(request.identity)).toBeNull();
  });

  it('blocks malformed storage and does not replace or erase it', () => {
    saveFollowupPending(request);
    const key = sessionStorage.key(0)!;
    sessionStorage.setItem(key, '{bad');
    expect(findFollowupPending(request.identity.actor, caseId, filingId)).toBe(
      'damaged',
    );
    expect(() => saveFollowupPending(request)).toThrow();
    expect(() => clearFollowupPending(request)).toThrow();
    expect(sessionStorage.getItem(key)).toBe('{bad');
  });

  it('rejects a body whose hidden root or revision differs from its route', () => {
    expect(() =>
      saveFollowupPending({
        ...request,
        body: { ...request.body, feedbackId: filingId } as FollowupBody,
      }),
    ).toThrow();
    expect(() =>
      saveFollowupPending({
        ...request,
        body: { ...request.body, expectedRevision: 1 } as FollowupBody,
      }),
    ).toThrow();
    expect(sessionStorage.length).toBe(0);
  });

  it('preserves supplement file order and rejects duplicate or empty selections', () => {
    const first = '44444444-4444-4444-8444-444444444444';
    const second = '55555555-5555-4555-8555-555555555555';
    const supplement: FollowupPending = {
      identity: { ...request.identity, command: 'submit-supplement' },
      body: {
        supplementId: rootId,
        expectedRevision: 0,
        idempotencyKey: 'supplement-key',
        submittedOn: null,
        note: '补交',
        contentVersionIds: [second, first],
      },
    };
    saveFollowupPending(supplement);
    expect(readFollowupPending(supplement.identity)).toEqual(supplement);
    expect(() =>
      saveFollowupPending({
        ...supplement,
        identity: { ...supplement.identity, rootId: first },
      }),
    ).toThrow();
    clearFollowupPending(supplement);
    expect(() =>
      saveFollowupPending({
        ...supplement,
        body: {
          ...supplement.body,
          contentVersionIds: [first, first],
        } as FollowupBody,
      }),
    ).toThrow();
  });

  it('accepts the API Unicode text boundary without trimming the original body', () => {
    const unicode: FollowupPending = {
      ...request,
      body: {
        ...request.body,
        content: `  ${'📝'.repeat(2000)}  `,
        courtCaseNo: '✍️'.repeat(100),
      } as FollowupBody,
    };
    saveFollowupPending(unicode);
    expect(readFollowupPending(request.identity)).toEqual(unicode);
    clearFollowupPending(unicode);
    expect(() =>
      saveFollowupPending({
        ...unicode,
        body: {
          ...unicode.body,
          content: `${'📝'.repeat(2001)}`,
        } as FollowupBody,
      }),
    ).toThrow();
  });
});
