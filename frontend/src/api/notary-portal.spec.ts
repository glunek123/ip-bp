import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getNotaryPortalMatter,
  listNotaryPortalMatters,
  recordNotaryPortalCertificate,
  recordNotaryPortalOpening,
} from './notary-portal';

afterEach(() => vi.unstubAllGlobals());
const matter = {
  id: 'matter-1',
  businessNo: 'NZ-1',
  stage: 'WAITING_UNBOX',
  version: 3,
  createdAt: '2026-09-28T00:00:00.000Z',
  evidence: null,
  opening: null,
  issuanceDecision: null,
  certificate: null,
  capabilities: { recordOpening: true, issueCertificate: false },
};

describe('notary portal API', () => {
  it('requests the waiting-certificate segment and decodes both visible stages', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: 'matter-2',
              businessNo: 'NZ-2',
              stage: 'WAITING_CERTIFICATE',
              version: 5,
              createdAt: '2026-09-28T00:00:00.000Z',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);

    await expect(
      listNotaryPortalMatters(1, 20, { stage: 'WAITING_CERTIFICATE' }),
    ).resolves.toMatchObject({ items: [{ stage: 'WAITING_CERTIFICATE' }] });
    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      'stage=WAITING_CERTIFICATE',
    );
  });
  it('decodes only the minimal notary matter list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              {
                id: matter.id,
                businessNo: matter.businessNo,
                stage: matter.stage,
                version: matter.version,
                createdAt: matter.createdAt,
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
          }),
        ),
      ),
    );
    await expect(listNotaryPortalMatters()).resolves.toMatchObject({
      total: 1,
      items: [{ id: 'matter-1' }],
    });
  });
  it('rejects a DTO containing customer or fee information', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ ...matter, customer: { name: 'private' } }),
          ),
        ),
    );
    await expect(getNotaryPortalMatter('matter-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it('decodes the waiting certificate detail without exposing internal fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'matter-1',
            businessNo: 'NZ-1',
            stage: 'WAITING_CERTIFICATE',
            version: 5,
            createdAt: '2026-09-28T00:00:00.000Z',
            evidence: null,
            opening: null,
            issuanceDecision: {
              decision: 'ISSUE',
              actorDisplayName: '审核员',
              decidedAt: '2026-09-28T00:00:00.000Z',
            },
            certificate: null,
            capabilities: { recordOpening: false, issueCertificate: true },
          }),
        ),
      ),
    );
    await expect(getNotaryPortalMatter('matter-1')).resolves.toMatchObject({
      stage: 'WAITING_CERTIFICATE',
      capabilities: { issueCertificate: true },
    });
  });
  it('decodes the archived portal projection with operational fields removed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'matter-1',
            businessNo: 'NZ-1',
            stage: 'ARCHIVED',
            version: 6,
            createdAt: '2026-09-28T00:00:00.000Z',
            evidence: null,
            opening: null,
            issuanceDecision: null,
            certificate: {
              certificateNo: 'Z-100',
              certificateDate: '2026-09-28',
              issuedAt: '2026-09-28T00:00:00.000Z',
              files: [
                {
                  materialId: 'certificate-1',
                  contentVersionId: 'version-1',
                  originalFilename: 'certificate.pdf',
                  mimeType: 'application/pdf',
                },
              ],
              disclosureFiles: [],
              needDisclose: false,
              caseId: 'case-1',
              caseBusinessNo: 'CA-1',
            },
            capabilities: { recordOpening: false, issueCertificate: false },
          }),
        ),
      ),
    );

    await expect(getNotaryPortalMatter('matter-1')).resolves.toMatchObject({
      stage: 'ARCHIVED',
      evidence: null,
      opening: null,
      issuanceDecision: null,
      certificate: { caseBusinessNo: 'CA-1' },
    });
  });
  it('rejects an archived projection that still contains evidence operations', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'matter-1',
            businessNo: 'NZ-1',
            stage: 'ARCHIVED',
            version: 6,
            createdAt: '2026-09-28T00:00:00.000Z',
            evidence: {
              evidenceAt: '2026-09-27',
              sampleFeeState: 'KNOWN',
              sampleFeeAmount: '12.00',
              logistics: [],
            },
            opening: null,
            issuanceDecision: null,
            certificate: {
              certificateNo: 'Z-100',
              certificateDate: '2026-09-28',
              issuedAt: '2026-09-28T00:00:00.000Z',
              files: [
                {
                  materialId: 'certificate-1',
                  contentVersionId: 'version-1',
                  originalFilename: 'certificate.pdf',
                  mimeType: 'application/pdf',
                },
              ],
              disclosureFiles: [],
              needDisclose: false,
              caseId: 'case-1',
              caseBusinessNo: 'CA-1',
            },
            capabilities: { recordOpening: false, issueCertificate: false },
          }),
        ),
      ),
    );

    await expect(getNotaryPortalMatter('matter-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it('posts an idempotent certificate command with only editable costs', async () => {
    const file = {
      materialId: 'material-1',
      contentVersionId: 'content-1',
      originalFilename: 'certificate.pdf',
      mimeType: 'application/pdf',
    };
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'matter-1',
          stage: 'ARCHIVED',
          version: 6,
          certificate: {
            certificateNo: 'Z-100',
            certificateDate: '2026-09-28',
            issuedAt: '2026-09-28T00:00:00.000Z',
            files: [file],
            needDisclose: false,
            disclosureFiles: [],
          },
          case: { id: 'case-1', businessNo: 'CA-1', stage: 'PENDING_MATCH' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const input = {
      expectedVersion: 5,
      certificateNo: 'Z-100',
      certificateDate: '2026-09-28',
      contentVersionIds: ['content-1'],
      needDisclose: false,
      disclosureContentVersionIds: [],
      fees: {
        notary: { state: 'KNOWN' as const, amount: '20.00' },
        investigation: { state: 'PENDING' as const, amount: null },
        disclosure: { state: 'KNOWN' as const, amount: '0.00' },
      },
    };
    await expect(
      recordNotaryPortalCertificate('matter-1', input, 'idempotency-1'),
    ).resolves.toMatchObject({ case: { id: 'case-1' }, stage: 'ARCHIVED' });
    expect(fetch.mock.calls[0]?.[0]).toContain(
      '/notary-portal/matters/matter-1/certificate',
    );
    expect(fetch.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': 'idempotency-1',
        }),
        body: JSON.stringify(input),
      }),
    );
  });
  it('decodes a saved UNBOX_REVIEW detail with its frozen opening photos', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'matter-1',
            businessNo: 'NZ-1',
            stage: 'UNBOX_REVIEW',
            version: 4,
            createdAt: '2026-09-28T00:00:00.000Z',
            evidence: {
              evidenceAt: '2026-09-27',
              sampleFeeState: 'KNOWN',
              sampleFeeAmount: '12.00',
              logistics: [],
            },
            opening: {
              senderName: null,
              senderPhone: null,
              senderAddress: null,
              recordedAt: '2026-09-28T00:00:00.000Z',
              photos: [
                {
                  materialId: 'material-1',
                  contentVersionId: 'content-1',
                  originalFilename: 'box.jpg',
                  mimeType: 'image/jpeg',
                },
              ],
            },
            issuanceDecision: null,
            certificate: null,
            capabilities: { recordOpening: false, issueCertificate: false },
          }),
        ),
      ),
    );

    const detail = await getNotaryPortalMatter('matter-1');
    expect(detail.stage).toBe('UNBOX_REVIEW');
    if (detail.stage === 'UNBOX_REVIEW') {
      expect(detail.opening?.photos[0]?.originalFilename).toBe('box.jpg');
    } else {
      throw new Error('Expected a saved opening detail');
    }
  });
  it('posts the existing opening input through the notary portal endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'matter-1',
          stage: 'UNBOX_REVIEW',
          version: 4,
          opening: {
            senderName: null,
            senderPhone: null,
            senderAddress: null,
            recordedAt: '2026-09-28T00:00:00.000Z',
            recordedByUserId: 'notary-user',
            photos: [
              { materialId: 'material-1', contentVersionId: 'content-1' },
            ],
          },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    await recordNotaryPortalOpening(
      'matter-1',
      { expectedVersion: 3, contentVersionIds: ['content-1'] },
      'key-1',
    );
    expect(fetch.mock.calls[0]?.[0]).toContain(
      '/notary-portal/matters/matter-1/opening',
    );
  });
});
