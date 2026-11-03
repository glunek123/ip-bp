import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPendingOpeningImportConfirm,
  getActiveOpeningImportBatch,
  getPendingOpeningImportConfirms,
  getPendingOpeningImportUpload,
  persistOpeningImportRecovery,
  saveActiveOpeningImportBatch,
  savePendingOpeningImportConfirm,
  savePendingOpeningImportUpload,
} from './notary-opening-import-recovery';

const batchId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const itemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const matterId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
describe('opening import recovery', () => {
  it('keeps original upload hash/key and active batch scoped to identity', () => {
    savePendingOpeningImportUpload('dept:a', {
      key: 'original',
      sha256: 'a'.repeat(64),
      filename: 'a.zip',
      sizeBytes: 123,
    });
    saveActiveOpeningImportBatch('dept:a', batchId);
    expect(getPendingOpeningImportUpload('dept:a')?.key).toBe('original');
    expect(getActiveOpeningImportBatch('dept:a')).toBe(batchId);
    expect(getPendingOpeningImportUpload('dept:b')).toBeNull();
  });
  it('keeps an unknown request across an authorization revision bump for the same actor', () => {
    savePendingOpeningImportUpload('user:INTERNAL:department:1', {
      key: 'original',
      sha256: 'a'.repeat(64),
      filename: 'a.zip',
      sizeBytes: 123,
    });
    expect(
      getPendingOpeningImportUpload('user:INTERNAL:department:2')?.key,
    ).toBe('original');
    expect(
      getPendingOpeningImportUpload('other:INTERNAL:department:2'),
    ).toBeNull();
  });
  it('retains original commands after a tab closes and isolates another actor', () => {
    savePendingOpeningImportConfirm('dept:user:revision:1', {
      batchId,
      itemId,
      key: 'original-key',
      input: { matterId, expectedVersion: 4, expectedRevision: 2 },
    });
    sessionStorage.clear();
    expect(
      getPendingOpeningImportConfirms('dept:user:revision:2')[0]?.key,
    ).toBe('original-key');
    expect(getPendingOpeningImportConfirms('dept:other:revision:2')).toEqual(
      [],
    );
  });
  it('migrates a valid legacy session record and rejects damaged persistent state', () => {
    const key = 'notary-opening-import:v1:dept:user';
    sessionStorage.setItem(
      key,
      JSON.stringify({ activeBatchId: batchId, upload: null, confirms: [] }),
    );
    expect(getActiveOpeningImportBatch('dept:user')).toBe(batchId);
    expect(localStorage.getItem(key)).toBeNull();
    persistOpeningImportRecovery('dept:user');
    expect(sessionStorage.getItem(key)).toBeNull();
    sessionStorage.clear();
    expect(getActiveOpeningImportBatch('dept:user')).toBe(batchId);
    localStorage.setItem(
      key,
      JSON.stringify({
        activeBatchId: batchId,
        upload: null,
        confirms: [],
        token: 'must-not-be-retained',
      }),
    );
    expect(() => getActiveOpeningImportBatch('dept:user')).toThrow();
  });
  it('refuses to overwrite another tab original upload or confirmation', () => {
    const actor = 'dept:user';
    savePendingOpeningImportUpload(actor, {
      key: 'first-upload',
      sha256: 'a'.repeat(64),
      filename: 'a.zip',
      sizeBytes: 12,
    });
    expect(() =>
      savePendingOpeningImportUpload(actor, {
        key: 'second-upload',
        sha256: 'b'.repeat(64),
        filename: 'b.zip',
        sizeBytes: 12,
      }),
    ).toThrow();
    expect(getPendingOpeningImportUpload(actor)?.key).toBe('first-upload');
    savePendingOpeningImportConfirm(actor, {
      batchId,
      itemId,
      key: 'first-confirm',
      input: { matterId, expectedVersion: 2, expectedRevision: 1 },
    });
    expect(() =>
      savePendingOpeningImportConfirm(actor, {
        batchId,
        itemId,
        key: 'second-confirm',
        input: { matterId, expectedVersion: 2, expectedRevision: 1 },
      }),
    ).toThrow();
    expect(getPendingOpeningImportConfirms(actor)[0]?.key).toBe(
      'first-confirm',
    );
  });
  it('fails closed when a legacy tab has a distinct unknown command', () => {
    const actor = 'dept:user';
    savePendingOpeningImportConfirm(actor, {
      batchId,
      itemId,
      key: 'local-command',
      input: { matterId, expectedVersion: 2, expectedRevision: 1 },
    });
    const key = 'notary-opening-import:v1:dept:user';
    sessionStorage.setItem(
      key,
      JSON.stringify({
        activeBatchId: batchId,
        upload: null,
        confirms: [
          {
            batchId,
            itemId,
            key: 'legacy-command',
            input: { matterId, expectedVersion: 2, expectedRevision: 1 },
          },
        ],
      }),
    );
    expect(() => getPendingOpeningImportConfirms(actor)).toThrow();
    expect(sessionStorage.getItem(key)).toContain('legacy-command');
    expect(localStorage.getItem(key)).toContain('local-command');
  });
  it('retains exact confirmation body/key until explicitly cleared', () => {
    const input = { matterId, expectedVersion: 4, expectedRevision: 2 };
    savePendingOpeningImportConfirm('dept:a', {
      batchId,
      itemId,
      key: 'original',
      input,
    });
    expect(getPendingOpeningImportConfirms('dept:a')).toEqual([
      { batchId, itemId, key: 'original', input },
    ]);
    clearPendingOpeningImportConfirm('dept:a', batchId, itemId, 'other');
    expect(getPendingOpeningImportConfirms('dept:a')).toHaveLength(1);
  });
  it('rejects null confirmation input and unavailable storage before mutation', () => {
    expect(() =>
      savePendingOpeningImportConfirm('dept:a', {
        batchId,
        itemId,
        key: 'x',
        input: null as never,
      }),
    ).toThrow();
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: undefined,
    });
    try {
      expect(() =>
        savePendingOpeningImportUpload('dept:a', {
          key: 'x',
          sha256: 'a'.repeat(64),
          filename: 'a.zip',
          sizeBytes: 1,
        }),
      ).toThrow();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: original,
      });
    }
  });
});
