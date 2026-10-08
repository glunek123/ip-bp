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
  it('uses the dedicated customer proof category and rejects a file over 20 MiB before upload', async () => {
    const file = new File(['%PDF-1.4'], 'proof.pdf', {
      type: 'application/pdf',
    });
    const result = {
      ...uploaded,
      originalFilename: file.name,
      purpose: 'CUSTOMER_RIGHT_EVIDENCE',
      mimeType: file.type,
      sizeBytes: file.size,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'draft-proof',
            ownerType: 'CUSTOMER',
            ownerId: 'customer-1',
            category: 'CUSTOMER_RIGHT_EVIDENCE',
            purpose: 'CUSTOMER_RIGHT_EVIDENCE',
            originalFilename: file.name,
            declaredMimeType: file.type,
            expiresAt: '2026-10-08T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(result)));
    vi.stubGlobal('fetch', fetch);
    await expect(
      uploadMaterialFile({
        ownerType: 'CUSTOMER',
        ownerId: 'customer-1',
        category: 'CUSTOMER_RIGHT_EVIDENCE',
        purpose: 'CUSTOMER_RIGHT_EVIDENCE',
        file,
      }),
    ).resolves.toEqual(result);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      category: 'CUSTOMER_RIGHT_EVIDENCE',
      purpose: 'CUSTOMER_RIGHT_EVIDENCE',
    });
    const tooLarge = new File(
      [new Uint8Array(20 * 1024 * 1024 + 1)],
      'large.pdf',
      { type: 'application/pdf' },
    );
    await expect(
      uploadMaterialFile({
        ownerType: 'CUSTOMER',
        ownerId: 'customer-1',
        category: 'CUSTOMER_RIGHT_EVIDENCE',
        purpose: 'CUSTOMER_RIGHT_EVIDENCE',
        file: tooLarge,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('uploads real JUDGMENT documents with the court-document limits', async () => {
    const file = new File(['actual judgment bytes'], '判决书.jpg', {
      type: 'image/jpeg',
    });
    const result = {
      ...uploaded,
      materialId: 'material-judgment',
      contentVersionId: 'judgment-version',
      originalFilename: file.name,
      purpose: 'JUDGMENT',
      mimeType: file.type,
      sizeBytes: file.size,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'draft-judgment',
            ownerType: 'CASE',
            ownerId: 'case-1',
            category: 'JUDGMENT',
            purpose: 'JUDGMENT',
            originalFilename: file.name,
            declaredMimeType: file.type,
            expiresAt: '2026-10-07T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(result)));
    vi.stubGlobal('fetch', fetch);

    await expect(
      uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: 'case-1',
        category: 'JUDGMENT',
        purpose: 'JUDGMENT',
        file,
      }),
    ).resolves.toEqual(result);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      ownerId: 'case-1',
      category: 'JUDGMENT',
      purpose: 'JUDGMENT',
    });
    expect(fetch.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ body: file, method: 'PUT' }),
    );
  });

  it('uploads complaint files as real CASE-owned materials', async () => {
    const file = new File(['pdf-content'], '起诉状.pdf', {
      type: 'application/pdf',
    });
    const result = {
      ...uploaded,
      originalFilename: file.name,
      purpose: 'COMPLAINT',
      mimeType: file.type,
      sizeBytes: file.size,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'draft-case',
            ownerType: 'CASE',
            ownerId: 'case-1',
            category: 'COMPLAINT',
            purpose: 'COMPLAINT',
            originalFilename: file.name,
            declaredMimeType: file.type,
            expiresAt: '2026-09-30T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(result)));
    vi.stubGlobal('fetch', fetch);
    await expect(
      uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: 'case-1',
        category: 'COMPLAINT',
        purpose: 'COMPLAINT',
        file,
      }),
    ).resolves.toEqual(result);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      ownerType: 'CASE',
      ownerId: 'case-1',
      category: 'COMPLAINT',
      purpose: 'COMPLAINT',
    });
    expect(fetch.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ body: file, method: 'PUT' }),
    );
  });

  it('validates complaint uploads before creating a server draft', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: 'case-1',
        category: 'COMPLAINT',
        purpose: 'COMPLAINT',
        file: new File(['data'], '诉状.exe', {
          type: 'application/octet-stream',
        }),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uploads filing evidence and screenshots with their exact CASE categories', async () => {
    const evidence = new File(['evidence'], '起诉证据.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const screenshot = new File(['image'], '立案截图.jpg', {
      type: 'image/jpeg',
    });
    let currentCategory = '';
    const fetch = vi
      .fn()
      .mockImplementation(
        async (url: string | URL | Request, init?: RequestInit) => {
          if (String(url).endsWith('/content')) {
            return new Response(
              JSON.stringify({
                ...uploaded,
                originalFilename:
                  currentCategory === 'FILING_EVIDENCE'
                    ? evidence.name
                    : screenshot.name,
                purpose: currentCategory,
                mimeType:
                  currentCategory === 'FILING_EVIDENCE'
                    ? evidence.type
                    : screenshot.type,
                sizeBytes:
                  currentCategory === 'FILING_EVIDENCE'
                    ? evidence.size
                    : screenshot.size,
              }),
            );
          }
          const body = JSON.parse(String(init?.body)) as {
            category: string;
            originalFilename: string;
          };
          currentCategory = body.category;
          const id =
            body.category === 'FILING_EVIDENCE'
              ? 'evidence-draft'
              : 'screenshot-draft';
          return new Response(
            JSON.stringify({
              id,
              ownerType: 'CASE',
              ownerId: 'case-1',
              category: body.category,
              purpose: body.category,
              originalFilename: body.originalFilename,
              declaredMimeType:
                body.category === 'FILING_EVIDENCE'
                  ? evidence.type
                  : screenshot.type,
              expiresAt: '2026-10-04T00:00:00.000Z',
            }),
          );
        },
      );
    vi.stubGlobal('fetch', fetch);

    await expect(
      uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: 'case-1',
        category: 'FILING_EVIDENCE',
        purpose: 'FILING_EVIDENCE',
        file: evidence,
      }),
    ).resolves.toMatchObject({ purpose: 'FILING_EVIDENCE' });
    await expect(
      uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: 'case-1',
        category: 'FILING_SCREENSHOT',
        purpose: 'FILING_SCREENSHOT',
        file: screenshot,
      }),
    ).resolves.toMatchObject({ purpose: 'FILING_SCREENSHOT' });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      category: 'FILING_EVIDENCE',
      purpose: 'FILING_EVIDENCE',
      originalFilename: evidence.name,
    });
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toMatchObject({
      category: 'FILING_SCREENSHOT',
      purpose: 'FILING_SCREENSHOT',
      originalFilename: screenshot.name,
    });
    expect(fetch.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ body: evidence, method: 'PUT' }),
    );
    expect(fetch.mock.calls[3]?.[1]).toEqual(
      expect.objectContaining({ body: screenshot, method: 'PUT' }),
    );
  });

  it('uploads each formal acceptance category as a real CASE-owned PDF, JPEG, or PNG file', async () => {
    const file = new File(['notice'], '受理通知书.png', { type: 'image/png' });
    const result = {
      ...uploaded,
      originalFilename: file.name,
      purpose: 'ACCEPTANCE_NOTICE',
      mimeType: file.type,
      sizeBytes: file.size,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'draft-acceptance',
            ownerType: 'CASE',
            ownerId: 'case-1',
            category: 'ACCEPTANCE_NOTICE',
            purpose: 'ACCEPTANCE_NOTICE',
            originalFilename: file.name,
            declaredMimeType: file.type,
            expiresAt: '2026-10-06T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(result)));
    vi.stubGlobal('fetch', fetch);
    await expect(
      uploadMaterialFile({
        ownerType: 'CASE',
        ownerId: 'case-1',
        category: 'ACCEPTANCE_NOTICE',
        purpose: 'ACCEPTANCE_NOTICE',
        file,
      }),
    ).resolves.toEqual(result);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      ownerType: 'CASE',
      ownerId: 'case-1',
      category: 'ACCEPTANCE_NOTICE',
      purpose: 'ACCEPTANCE_NOTICE',
    });
  });

  it('enforces the distinct evidence and screenshot file type/size limits', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const invalidUploads = [
      {
        category: 'FILING_EVIDENCE' as const,
        purpose: 'FILING_EVIDENCE' as const,
        file: new File(['bad'], '证据.gif', { type: 'image/gif' }),
      },
      {
        category: 'FILING_SCREENSHOT' as const,
        purpose: 'FILING_SCREENSHOT' as const,
        file: new File(['bad'], '截图.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      },
      {
        category: 'FILING_EVIDENCE' as const,
        purpose: 'FILING_EVIDENCE' as const,
        file: new File([new Uint8Array(50 * 1024 * 1024 + 1)], '超大证据.pdf', {
          type: 'application/pdf',
        }),
      },
      {
        category: 'FILING_SCREENSHOT' as const,
        purpose: 'FILING_SCREENSHOT' as const,
        file: new File([new Uint8Array(20 * 1024 * 1024 + 1)], '超大截图.png', {
          type: 'image/png',
        }),
      },
    ];
    for (const upload of invalidUploads) {
      await expect(
        uploadMaterialFile({ ownerType: 'CASE', ownerId: 'case-1', ...upload }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

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

  it('normalizes surrounding filename whitespace for metadata while uploading the original File bytes', async () => {
    const file = new File(['real-file-content'], '  营业执照.pdf  ', {
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
            originalFilename: '营业执照.pdf',
            declaredMimeType: file.type,
            expiresAt: '2026-09-22T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...uploaded,
            originalFilename: '营业执照.pdf',
            sizeBytes: file.size,
          }),
        ),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(
      uploadMaterialFile({
        ownerType: 'CUSTOMER',
        ownerId: 'customer-1',
        category: 'CUSTOMER_IDENTITY',
        purpose: 'IDENTITY_FULL',
        file,
      }),
    ).resolves.toMatchObject({ originalFilename: '营业执照.pdf' });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      originalFilename: '营业执照.pdf',
    });
    expect(fetch.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ body: file }),
    );
  });

  it('rejects an empty normalized filename with the backend validation code before metadata upload', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      uploadMaterialFile({
        ownerType: 'CUSTOMER',
        ownerId: 'customer-1',
        category: 'CUSTOMER_IDENTITY',
        purpose: 'IDENTITY_FULL',
        file: new File(['content'], '   ', { type: 'application/pdf' }),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetch).not.toHaveBeenCalled();
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

  it('uploads an opening photo as a real notary matter material', async () => {
    const file = new File(['photo'], '开箱.jpg', { type: 'image/jpeg' });
    const result = {
      ...uploaded,
      originalFilename: file.name,
      purpose: 'NOTARY_OPENING_PHOTO',
      mimeType: file.type,
      sizeBytes: file.size,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'draft-1',
            ownerType: 'NOTARY_MATTER',
            ownerId: 'matter-1',
            category: 'NOTARY_OPENING_PHOTO',
            purpose: 'NOTARY_OPENING_PHOTO',
            originalFilename: file.name,
            declaredMimeType: file.type,
            expiresAt: '2026-09-24T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(result)));
    vi.stubGlobal('fetch', fetch);

    await expect(
      uploadMaterialFile({
        ownerType: 'NOTARY_MATTER',
        ownerId: 'matter-1',
        category: 'NOTARY_OPENING_PHOTO',
        purpose: 'NOTARY_OPENING_PHOTO',
        file,
      }),
    ).resolves.toEqual(result);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      ownerType: 'NOTARY_MATTER',
      ownerId: 'matter-1',
      category: 'NOTARY_OPENING_PHOTO',
      purpose: 'NOTARY_OPENING_PHOTO',
    });
    expect(fetch.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ body: file }),
    );
  });

  it('uploads a certificate PDF as a real notary matter material', async () => {
    const file = new File(['certificate'], '公证书.pdf', {
      type: 'application/pdf',
    });
    const result = {
      ...uploaded,
      originalFilename: file.name,
      purpose: 'NOTARY_CERTIFICATE',
      mimeType: file.type,
      sizeBytes: file.size,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'draft-2',
            ownerType: 'NOTARY_MATTER',
            ownerId: 'matter-1',
            category: 'NOTARY_CERTIFICATE',
            purpose: 'NOTARY_CERTIFICATE',
            originalFilename: file.name,
            declaredMimeType: file.type,
            expiresAt: '2026-09-28T00:00:00.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(result)));
    vi.stubGlobal('fetch', fetch);

    await expect(
      uploadMaterialFile({
        ownerType: 'NOTARY_MATTER',
        ownerId: 'matter-1',
        category: 'NOTARY_CERTIFICATE',
        purpose: 'NOTARY_CERTIFICATE',
        file,
      }),
    ).resolves.toEqual(result);
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

  it('cancels a late blob before it creates a browser link', async () => {
    const controller = new AbortController();
    const click = vi.fn();
    const createObjectURL = vi.fn().mockReturnValue('blob:late-download');
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click,
      remove: vi.fn(),
    } as unknown as HTMLAnchorElement);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    let finishBlob!: (blob: Blob) => void;
    const response = new Response(new Blob(['original-file']));
    const readBlob = vi.spyOn(response, 'blob').mockReturnValue(
      new Promise<Blob>((resolve) => {
        finishBlob = resolve;
      }),
    );
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetch);

    const download = downloadMaterialVersion(
      'material-1',
      'version-1',
      controller.signal,
    );
    await vi.waitFor(() => expect(readBlob).toHaveBeenCalledOnce());
    controller.abort();
    finishBlob(new Blob(['late-file']));

    await expect(download).rejects.toMatchObject({ name: 'AbortError' });
    expect((fetch.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(
      true,
    );
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it('does not click if cancellation happens while preparing the link and releases its URL', async () => {
    const controller = new AbortController();
    const click = vi.fn();
    const createObjectURL = vi.fn(() => {
      controller.abort();
      return 'blob:cancel-during-link';
    });
    const revokeObjectURL = vi.fn();
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click,
      remove: vi.fn(),
    } as unknown as HTMLAnchorElement);
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
      vi.fn().mockResolvedValue(new Response(new Blob(['file']))),
    );

    await expect(
      downloadMaterialVersion('material-1', 'version-1', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
      'blob:cancel-during-link',
    );
  });
});
