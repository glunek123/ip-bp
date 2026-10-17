import {
  assertEvidenceCommandReplay,
  evidenceCommandFingerprint,
} from './evidence-command';

describe('evidence command identity', () => {
  it('keeps a retry fingerprint stable across JSON key ordering and rejects a different target or body', () => {
    const first = evidenceCommandFingerprint('EDIT_GROUP', 'a', {
      expectedGroupVersion: 1,
      rows: [],
    });
    const retry = evidenceCommandFingerprint('EDIT_GROUP', 'a', {
      rows: [],
      expectedGroupVersion: 1,
    });
    expect(first).toBe(retry);
    expect(first).not.toBe(
      evidenceCommandFingerprint('EDIT_GROUP', 'b', {
        rows: [],
        expectedGroupVersion: 1,
      }),
    );
    expect(first).not.toBe(
      evidenceCommandFingerprint('EDIT_GROUP', 'a', {
        rows: [],
        expectedGroupVersion: 2,
      }),
    );
    expect(() =>
      assertEvidenceCommandReplay(
        { command: 'EDIT_GROUP', requestFingerprint: first },
        'EDIT_GROUP',
        retry,
      ),
    ).not.toThrow();
    expect(() =>
      assertEvidenceCommandReplay(
        { command: 'BULK_STATUS', requestFingerprint: first },
        'EDIT_GROUP',
        retry,
      ),
    ).toThrow('IDEMPOTENCY_KEY_REUSED');
  });
});
