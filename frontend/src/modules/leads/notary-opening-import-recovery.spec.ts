import { beforeEach, describe, expect, it } from 'vitest';
import { clearPendingOpeningImportConfirm, getActiveOpeningImportBatch, getPendingOpeningImportConfirms, getPendingOpeningImportUpload, saveActiveOpeningImportBatch, savePendingOpeningImportConfirm, savePendingOpeningImportUpload } from './notary-opening-import-recovery';

beforeEach(() => localStorage.clear());
describe('opening import recovery', () => {
  it('keeps original upload hash/key and active batch scoped to identity', () => {
    savePendingOpeningImportUpload('dept:a', { key: 'original', sha256: 'abc', filename: 'a.zip', sizeBytes: 123 });
    saveActiveOpeningImportBatch('dept:a', 'batch');
    expect(getPendingOpeningImportUpload('dept:a')?.key).toBe('original');
    expect(getActiveOpeningImportBatch('dept:a')).toBe('batch');
    expect(getPendingOpeningImportUpload('dept:b')).toBeNull();
  });
  it('retains exact confirmation body/key until explicitly cleared', () => {
    const input = { matterId: 'matter', expectedVersion: 4, expectedRevision: 2 };
    savePendingOpeningImportConfirm('dept:a', { batchId: 'batch', itemId: 'item', key: 'original', input });
    expect(getPendingOpeningImportConfirms('dept:a')).toEqual([{ batchId: 'batch', itemId: 'item', key: 'original', input }]);
    clearPendingOpeningImportConfirm('dept:a', 'batch', 'item', 'other');
    expect(getPendingOpeningImportConfirms('dept:a')).toHaveLength(1);
  });
});
