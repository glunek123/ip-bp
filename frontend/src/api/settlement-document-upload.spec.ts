import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadSettlementUpdateDocumentFile } from './settlement-document-upload';

const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const caseId = id(1),
  versionId = id(2),
  draftId = id(3),
  targetId = id(4);
const bytes = '%PDF-1.4 settlement';
const file = () =>
  new File([bytes], 'settlement.pdf', { type: 'application/pdf' });
const draft = () => ({
  id: draftId,
  ownerType: 'CASE',
  ownerId: caseId,
  category: 'CASE_CLOSURE_DOCUMENT',
  purpose: 'CASE_CLOSURE_DOCUMENT',
  originalFilename: 'settlement.pdf',
  declaredMimeType: 'application/pdf',
  expiresAt: '2026-10-30T00:00:00.000Z',
  settlementUpdateTarget: { id: targetId, expectedClosureVersionId: versionId },
});
const uploaded = () => ({
  materialId: id(5),
  contentVersionId: id(6),
  originalFilename: 'settlement.pdf',
  purpose: 'CASE_CLOSURE_DOCUMENT',
  mimeType: 'application/pdf',
  sizeBytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
});
function mock(first: unknown = draft(), second: unknown = uploaded()) {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(first), { status: 201 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify(second), { status: 201 }),
    );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
describe('settlement document upload preparation', () => {
  it('uses the exact closure head and server draft, returning the actual finalized content version', async () => {
    const fetch = mock();
    const source = file();
    const result = await uploadSettlementUpdateDocumentFile(
      caseId,
      versionId,
      source,
    );
    expect(result).toEqual({
      ...uploaded(),
      caseId,
      settlementUpdateTarget: draft().settlementUpdateTarget,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe(
      `/api/v1/materials/cases/${caseId}/settlement-update-document-upload-drafts`,
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      expectedClosureVersionId: versionId,
      originalFilename: source.name,
      declaredMimeType: source.type,
    });
    expect(fetch.mock.calls[1][0]).toBe(
      `/api/v1/materials/upload-drafts/${draftId}/content`,
    );
    expect(fetch.mock.calls[1][1]).toMatchObject({
      method: 'PUT',
      body: source,
    });
  });
  it.each([
    { ownerId: id(9) },
    { ownerType: 'CUSTOMER' },
    { category: 'JUDGMENT' },
    { purpose: 'JUDGMENT' },
    { declaredMimeType: 'image/png' },
    { id: '' },
    {
      settlementUpdateTarget: { id: targetId, expectedClosureVersionId: id(9) },
    },
    { settlementUpdateTarget: { id: '', expectedClosureVersionId: versionId } },
  ])('rejects mismatched draft before sending bytes: %j', async (patch) => {
    const fetch = mock({ ...draft(), ...patch });
    await expect(
      uploadSettlementUpdateDocumentFile(caseId, versionId, file()),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    { contentVersionId: undefined },
    { contentVersionId: id(5) },
    { purpose: 'JUDGMENT' },
    { mimeType: 'image/png' },
    { sha256: 'a'.repeat(64) },
    { sizeBytes: 999 },
    { originalFilename: 'other.pdf' },
  ])(
    'rejects mismatched finalize without reporting an association: %j',
    async (patch) => {
      mock(draft(), { ...uploaded(), ...patch });
      await expect(
        uploadSettlementUpdateDocumentFile(caseId, versionId, file()),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    },
  );
  it.each([
    new File(['x'], 'bad.doc', { type: 'application/msword' }),
    new File(['x'], 'bad.pdf', { type: 'image/png' }),
    new File([], 'empty.pdf', { type: 'application/pdf' }),
    new File(['x'], 'bad\n.pdf', { type: 'application/pdf' }),
  ])('rejects invalid files locally', async (source) => {
    const fetch = mock();
    await expect(
      uploadSettlementUpdateDocumentFile(caseId, versionId, source),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects files above 50MB before hashing or networking', async () => {
    const source = file();
    Object.defineProperty(source, 'size', { value: 50 * 1024 * 1024 + 1 });
    const fetch = mock();
    await expect(
      uploadSettlementUpdateDocumentFile(caseId, versionId, source),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('honors cancellation before any request', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = mock();
    await expect(
      uploadSettlementUpdateDocumentFile(caseId, versionId, file(), {
        signal: controller.signal,
      }),
    ).rejects.toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('propagates a closed gate without uploading or retrying', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'FORBIDDEN', message: 'closed' }), {
        status: 403,
      }),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(
      uploadSettlementUpdateDocumentFile(caseId, versionId, file()),
    ).rejects.toMatchObject({ status: 403 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('propagates an uncertain binary result without retry or success', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(draft()), { status: 201 }),
      )
      .mockRejectedValueOnce(new TypeError('connection lost'));
    vi.stubGlobal('fetch', fetch);
    await expect(
      uploadSettlementUpdateDocumentFile(caseId, versionId, file()),
    ).rejects.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
