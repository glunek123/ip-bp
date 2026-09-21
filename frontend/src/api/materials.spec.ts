import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteMaterial,
  downloadMaterialVersion,
  listOwnerMaterials,
  restoreMaterial,
  uploadMaterialFile,
} from './materials';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const uploaded = {
  materialId: 'material-1',
  contentVersionId: 'version-1',
  originalFilename: '营业执照.pdf',
  purpose: 'IDENTITY_FULL',
  mimeType: 'application/pdf',
  sizeBytes: 17,
  sha256: 'a'.repeat(64),
};

describe('materials API', () => {
  it('creates upload metadata then sends the original File as a raw body', async () => {
    const file = new File(['real-file-content'], '营业执照.pdf', {
      type: 'application/pdf',
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'draft-1',
            ownerType: 'CUSTOMER',
            ownerId: 'customer-1',
            category: 'CUSTOMER_IDENTITY',
            purpose: 'IDENTITY_FULL',
            originalFilename: file.name,
            declaredMimeType: file.type,
            expiresAt: '2026-09-22T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(uploaded)));
    vi.stubGlobal('fetch', fetch);

    await expect(
      uploadMaterialFile({
        ownerType: 'CUSTOMER',
        ownerId: 'customer-1',
        category: 'CUSTOMER_IDENTITY',
        purpose: 'IDENTITY_FULL',
        file,
      }),
    ).resolves.toEqual(uploaded);
    expect(fetch.mock.calls[0]).toEqual([
      '/api/v1/materials/upload-drafts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          ownerType: 'CUSTOMER',
          ownerId: 'customer-1',
          category: 'CUSTOMER_IDENTITY',
          purpose: 'IDENTITY_FULL',
          originalFilename: file.name,
          declaredMimeType: file.type,
        }),
      }),
    ]);
    expect(fetch.mock.calls[1]).toEqual([
      '/api/v1/materials/upload-drafts/draft-1/content',
      expect.objectContaining({ body: file, method: 'PUT' }),
    ]);
  });

  it('accepts and returns the server-reserved owner for lead drafts', async () => {
    const file = new File(['image'], '线索.png', { type: 'image/png' });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'draft-1',
            ownerType: 'LEAD_DRAFT',
            ownerId: 'reserved-lead-1',
            reservedOwnerId: 'reserved-lead-1',
            category: 'LEAD_SCREENSHOT',
            purpose: 'LEAD_SCREENSHOT',
            originalFilename: file.name,
            declaredMimeType: file.type,
            expiresAt: '2026-09-22T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...uploaded,
            originalFilename: file.name,
            purpose: 'LEAD_SCREENSHOT',
            mimeType: file.type,
            sizeBytes: file.size,
            reservedOwnerId: 'reserved-lead-1',
          }),
        ),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(
      uploadMaterialFile({
        ownerType: 'LEAD_DRAFT',
        category: 'LEAD_SCREENSHOT',
        purpose: 'LEAD_SCREENSHOT',
        file,
      }),
    ).resolves.toMatchObject({ reservedOwnerId: 'reserved-lead-1' });
  });

  it('rejects malformed upload and list responses', async () => {
    const file = new File(['real-file-content'], '营业执照.pdf', {
      type: 'application/pdf',
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ id: 'draft-1' }))),
    );
    await expect(
      uploadMaterialFile({
        ownerType: 'CUSTOMER',
        ownerId: 'customer-1',
        category: 'CUSTOMER_IDENTITY',
        purpose: 'IDENTITY_FULL',
        file,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ items: [{ id: 'material-1' }], total: 1 }),
          ),
        ),
    );
    await expect(
      listOwnerMaterials('CUSTOMER', 'customer-1'),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects a well-shaped upload response that does not match the requested purpose', async () => {
    const file = new File(['real-file-content'], '营业执照.pdf', {
      type: 'application/pdf',
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: 'draft-1',
              ownerType: 'CUSTOMER',
              ownerId: 'customer-1',
              category: 'CUSTOMER_IDENTITY',
              purpose: 'IDENTITY_FULL',
              originalFilename: file.name,
              declaredMimeType: file.type,
              expiresAt: '2026-09-22T00:00:00.000Z',
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ ...uploaded, purpose: 'LEAD_SCREENSHOT' }),
          ),
        ),
    );

    await expect(
      uploadMaterialFile({
        ownerType: 'CUSTOMER',
        ownerId: 'customer-1',
        category: 'CUSTOMER_IDENTITY',
        purpose: 'IDENTITY_FULL',
        file,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('decodes current material versions and uses optimistic delete/restore', async () => {
    const item = {
      id: 'material-1',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
      category: 'CUSTOMER_IDENTITY',
      purpose: 'IDENTITY_FULL',
      currentVersionId: 'version-1',
      status: 'ACTIVE',
      version: 1,
      deletedAt: null,
      createdAt: '2026-09-21T00:00:00.000Z',
      updatedAt: '2026-09-21T00:00:00.000Z',
      contentVersions: [
        {
          id: 'version-1',
          materialId: 'material-1',
          originalFilename: '营业执照.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 128,
          sha256: 'a'.repeat(64),
          status: 'AVAILABLE',
          createdAt: '2026-09-21T00:00:00.000Z',
        },
      ],
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [item], total: 1 })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'material-1', status: 'DELETED', version: 2 }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'material-1', status: 'ACTIVE', version: 3 }),
        ),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(listOwnerMaterials('CUSTOMER', 'customer-1')).resolves.toEqual(
      { items: [item], total: 1 },
    );
    await expect(deleteMaterial('material-1', 1)).resolves.toMatchObject({
      status: 'DELETED',
      version: 2,
    });
    await expect(restoreMaterial('material-1', 2)).resolves.toMatchObject({
      status: 'ACTIVE',
      version: 3,
    });
    expect(fetch.mock.calls[1]?.[0]).toBe(
      '/api/v1/materials/material-1?expectedVersion=1',
    );
    expect(fetch.mock.calls[2]?.[0]).toBe(
      '/api/v1/materials/material-1/restore',
    );
  });

  it('opens an authorized download only for the click and revokes its URL', async () => {
    const click = vi.fn();
    const remove = vi.fn();
    const anchor = { href: '', download: '', click, remove };
    vi.spyOn(document, 'createElement').mockReturnValue(
      anchor as unknown as HTMLAnchorElement,
    );
    const createObjectURL = vi.fn().mockReturnValue('blob:download-1');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Blob(['real-file']), {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': "attachment; filename*=UTF-8''id.pdf",
          },
        }),
      ),
    );

    await downloadMaterialVersion('material-1', 'version-1');

    expect(anchor).toMatchObject({
      href: 'blob:download-1',
      download: 'id.pdf',
    });
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:download-1');
  });
});
