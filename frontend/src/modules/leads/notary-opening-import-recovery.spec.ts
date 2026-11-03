import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPendingOpeningImportConfirm,
  getActiveOpeningImportBatch,
  getPendingOpeningImportConfirms,
  getPendingOpeningImportUpload,
  saveActiveOpeningImportBatch,
  savePendingOpeningImportConfirm,
  savePendingOpeningImportUpload,
} from './notary-opening-import-recovery';

const batchId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const itemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const matterId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
beforeEach(() => sessionStorage.clear());
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
    const original = globalThis.sessionStorage;
    Object.defineProperty(globalThis, 'sessionStorage', {
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
      Object.defineProperty(globalThis, 'sessionStorage', {
        configurable: true,
        value: original,
      });
    }
  });
});
