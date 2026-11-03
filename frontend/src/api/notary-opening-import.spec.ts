import { describe, expect, it } from 'vitest';
import { decodeOpeningImportBatch } from './notary-opening-import';

const item = {
  id: 'item', folderName: 'parcel', revision: 1, status: 'READY',
  trackingCandidate: 'MOCK20261103001', trackingNo: 'MOCK20261103001',
  recognitionStatus: 'SUCCEEDED', senderCandidate: { name: null, phone: null, address: null },
  matchStatus: 'SUGGESTED', suggestedMatterId: 'matter', selectedMatterId: null,
  photos: [{ id: 'photo', filename: 'MOCK20261103001.png', mimeType: 'image/png', sizeBytes: 15 }],
};
describe('opening import response boundary', () => {
  it('accepts a persisted batch with recognition candidate and photo', () => {
    expect(decodeOpeningImportBatch({ id: 'batch', status: 'READY', expiresAt: '2026-11-04T00:00:00.000Z', recognitionMode: 'MOCK', items: [item] }).items[0]?.trackingCandidate).toBe('MOCK20261103001');
  });
  it('rejects unrecognized status and missing photo fields', () => {
    expect(() => decodeOpeningImportBatch({ id: 'batch', status: 'READY', expiresAt: '2026-11-04T00:00:00.000Z', recognitionMode: 'MOCK', items: [{ ...item, recognitionStatus: 'OCR_REAL' }] })).toThrow();
    expect(() => decodeOpeningImportBatch({ id: 'batch', status: 'READY', expiresAt: '2026-11-04T00:00:00.000Z', recognitionMode: 'MOCK', items: [{ ...item, photos: [{ id: 'photo' }] }] })).toThrow();
  });
});
