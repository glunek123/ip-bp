import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCase, listCases } from './cases';

afterEach(() => vi.unstubAllGlobals());

describe('cases API', () => {
  it('decodes the minimal paginated case list with both source identities', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'case-1',
                businessNo: 'CA-1',
                stage: 'PENDING_MATCH',
                createdAt: '2026-09-28T00:00:00.000Z',
                sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
                sourceNotaryMatter: { id: 'matter-1', businessNo: 'NZ-1' },
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
          }),
        ),
      ),
    );

    await expect(listCases()).resolves.toMatchObject({
      items: [{ businessNo: 'CA-1', sourceNotaryMatter: { id: 'matter-1' } }],
      total: 1,
    });
  });

  it('rejects a case missing its originating lead', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'case-1',
                businessNo: 'CA-1',
                stage: 'PENDING_MATCH',
                createdAt: '2026-09-28T00:00:00.000Z',
                sourceLead: null,
                sourceNotaryMatter: { id: 'matter-1', businessNo: 'NZ-1' },
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
          }),
        ),
      ),
    );
    await expect(listCases()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('decodes only the specified internal read-only case detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'case-1',
            businessNo: 'CA-1',
            stage: 'PENDING_MATCH',
            createdAt: '2026-09-28T00:00:00.000Z',
            courtCaseNo: null,
            department: { id: 'department-1', name: '知产部' },
            customer: { id: 'customer-1', name: '客户甲' },
            rightsHolder: { id: 'holder-1', name: '权利人甲' },
            owner: { id: 'user-1', displayName: '负责人' },
            sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
            sourceNotaryMatter: { id: 'matter-1', businessNo: 'NZ-1' },
            certificate: {
              certificateNo: 'Z-100',
              certificateDate: '2026-09-28',
              issuedAt: '2026-09-28T00:00:00.000Z',
              needDisclose: false,
              files: [
                {
                  materialId: 'material-1',
                  contentVersionId: 'version-1',
                  originalFilename: 'certificate.pdf',
                  mimeType: 'application/pdf',
                },
              ],
              disclosureFiles: [],
            },
            fees: [
              {
                category: 'SAMPLE',
                state: 'KNOWN',
                amount: '12.00',
                sourceType: 'NOTARY_MATTER_EVIDENCE',
                sourceId: 'evidence-1',
              },
            ],
          }),
        ),
      ),
    );
    await expect(getCase('case-1')).resolves.toMatchObject({
      customer: { name: '客户甲' },
      certificate: { certificateNo: 'Z-100' },
      fees: [{ category: 'SAMPLE', amount: '12.00' }],
      courtCaseNo: null,
    });
  });
});
