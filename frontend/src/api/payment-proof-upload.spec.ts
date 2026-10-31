import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  preparePaymentProofUpload,
  finalizePaymentProofUpload,
} from './payment-proof-upload';

const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const caseId = id(1),
  draftId = id(3);
const bytes = 'PNG original bytes';
const file = () => new File([bytes], 'proof.png', { type: 'image/png' });
const draft = () => ({
  id: draftId,
  ownerType: 'CASE',
  ownerId: caseId,
  category: 'CASE_CLOSURE_PAYMENT_PROOF',
  purpose: 'CASE_CLOSURE_PAYMENT_PROOF',
  originalFilename: 'proof.png',
  declaredMimeType: 'image/png',
  expiresAt: '2026-10-30T00:00:00.000Z',
});
const uploaded = () => ({
  materialId: id(5),
  contentVersionId: id(6),
  originalFilename: 'proof.png',
  purpose: 'CASE_CLOSURE_PAYMENT_PROOF',
  mimeType: 'image/png',
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

const context = { actorKey: 'actor', caseId, expectedVersion: 3 };
describe('payment proof original upload', () => {
  it('retains original draft and bytes across unknown finalize, and reuses exact successful CV', async () => {
    const fetch = mock();
    fetch
      .mockReset()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(draft()), { status: 201 }),
      )
      .mockRejectedValueOnce(new TypeError('lost response'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(uploaded()), { status: 201 }),
      );
    const source = file();
    const handle = await preparePaymentProofUpload(context, source);
    await expect(finalizePaymentProofUpload(handle, context)).rejects.toThrow();
    expect(await finalizePaymentProofUpload(handle, context)).toBe(
      uploaded().contentVersionId,
    );
    expect(await finalizePaymentProofUpload(handle, context)).toBe(
      uploaded().contentVersionId,
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[1][0]).toBe(
      '/api/v1/materials/upload-drafts/' + draftId + '/content',
    );
    expect(fetch.mock.calls[2][0]).toBe(fetch.mock.calls[1][0]);
    expect(fetch.mock.calls[1][1].body).toBe(source);
    expect(fetch.mock.calls[2][1].body).toBe(source);
  });
  it('normalizes uppercase case UUID against the server owner and on finalize', async () => {
    const upperContext = {
      ...context,
      caseId: 'ABCDEFAB-ABCD-4ABC-8ABC-ABCDEFABCDEF',
    };
    const fetch = mock({
      ...draft(),
      ownerId: upperContext.caseId.toLowerCase(),
    });
    const handle = await preparePaymentProofUpload(upperContext, file());
    expect(handle.caseId).toBe(upperContext.caseId.toLowerCase());
    expect(await finalizePaymentProofUpload(handle, upperContext)).toBe(
      uploaded().contentVersionId,
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body).ownerId).toBe(handle.caseId);
  });
  it('keeps unknown status after a subsequent explicit forbidden response', async () => {
    const fetch = mock();
    fetch
      .mockReset()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(draft()), { status: 201 }),
      )
      .mockRejectedValueOnce(new TypeError('lost'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 'FORBIDDEN',
            message: 'denied',
            requestId: 'r',
          }),
          { status: 403 },
        ),
      );
    const handle = await preparePaymentProofUpload(context, file());
    await expect(
      finalizePaymentProofUpload(handle, context),
    ).rejects.toMatchObject({ status: 0, code: 'UPLOAD_RESULT_UNKNOWN' });
    await expect(
      finalizePaymentProofUpload(handle, context),
    ).rejects.toMatchObject({ status: 0, code: 'UPLOAD_RESULT_UNKNOWN' });
    expect(fetch.mock.calls[1][0]).toBe(fetch.mock.calls[2][0]);
  });
  it.each([400, 403, 409, 410])(
    'preserves a first explicit refusal %s as certain',
    async (status) => {
      mock(draft(), uploaded());
      const handle = await preparePaymentProofUpload(context, file());
      vi.mocked(fetch)
        .mockReset()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              code: 'REJECTED',
              message: 'denied',
              requestId: 'r',
            }),
            { status },
          ),
        );
      await expect(
        finalizePaymentProofUpload(handle, context),
      ).rejects.toMatchObject({ status });
    },
  );
  it.each([{ actorKey: 'other' }, { caseId: id(8) }, { expectedVersion: 4 }])(
    'rejects identity change %j before sending',
    async (change) => {
      const fetch = mock();
      const handle = await preparePaymentProofUpload(context, file());
      await expect(
        finalizePaymentProofUpload(handle, { ...context, ...change }),
      ).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['ownerId', 'category', 'purpose', 'ownerType'])(
    'rejects mismatched draft %s',
    async (key) => {
      const fetch = mock({ ...draft(), [key]: 'wrong' });
      await expect(
        preparePaymentProofUpload(context, file()),
      ).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['sha256', 'sizeBytes', 'contentVersionId', 'purpose'])(
    'rejects mismatched finalized %s',
    async (key) => {
      mock(draft(), { ...uploaded(), [key]: 'wrong' });
      const handle = await preparePaymentProofUpload(context, file());
      await expect(
        finalizePaymentProofUpload(handle, context),
      ).rejects.toThrow();
    },
  );
  it.each([
    new File(['x'], 'x.pdf', { type: 'application/pdf' }),
    new File([], 'empty.png', { type: 'image/png' }),
    new File(['x'], 'x.jpg', { type: 'image/png' }),
    new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'big.png', {
      type: 'image/png',
    }),
  ])('rejects invalid file before networking', async (source) => {
    const fetch = mock();
    await expect(preparePaymentProofUpload(context, source)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
