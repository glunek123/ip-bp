import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ getJson: vi.fn(), requestJson: vi.fn() }));
vi.mock('./http', async (original) => ({
  ...(await original<typeof import('./http')>()),
  ...http,
}));

import {
  bulkEvidenceStatus,
  exportSelectedEvidence,
  listEvidence,
  matchingEvidenceIds,
  getEvidenceSourceGroup,
  getEvidenceGroup,
} from './evidence';

beforeEach(() => vi.resetAllMocks());

describe('evidence API', () => {
  it.each([
    { filename: '证物清单.csv', csv: '' },
    { filename: '证物清单.csv', csv: ' \t\r\n\u3000' },
    { filename: '', csv: '编号\r\nEV-1\r\n' },
    { filename: ' \t\r\n\u3000', csv: '编号\r\nEV-1\r\n' },
  ])('rejects blank export filename or CSV: %j', async (response) => {
    http.requestJson.mockResolvedValue(response);
    await expect(exportSelectedEvidence(['item-1'])).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('preserves valid Chinese filenames and CSV bytes including BOM and surrounding whitespace', async () => {
    const response = {
      filename: ' 证物清单（已选）.csv ',
      csv: '\uFEFF编号,备注\r\nEV-1,"原始 内容"\r\n \t',
    };
    http.requestJson.mockResolvedValue(response);
    await expect(exportSelectedEvidence(['item-1'])).resolves.toEqual(response);
  });

  it('reads a typed empty source without a write and keeps its version-zero virtual group', async () => {
    const group = {
      groupId: null,
      groupVersion: 0,
      sourceKind: 'CASE',
      sourceId: 'case-new',
      sourceVersion: 3,
      case: {
        id: 'case-new',
        platform: null,
        shopName: null,
        caseNo: null,
        stage: 'PENDING_MATCH',
        lawyerName: null,
      },
      items: [],
      paperCertificates: [],
    };
    http.getJson.mockResolvedValue(group);
    await expect(getEvidenceSourceGroup('CASE', 'case-new')).resolves.toEqual(
      group,
    );
    expect(http.getJson).toHaveBeenCalledWith(
      '/evidence/sources/CASE/case-new/group',
    );
    expect(http.requestJson).not.toHaveBeenCalled();
  });

  it('preserves every electronic version of a paper record instead of selecting the first file', async () => {
    const files = [
      { materialId: 'm-1', contentVersionId: 'cv-1', filename: '证书一.pdf' },
      { materialId: 'm-2', contentVersionId: 'cv-2', filename: '证书二.pdf' },
    ];
    const group = {
      groupId: 'group-1',
      groupVersion: 1,
      sourceKind: 'NOTARY_MATTER',
      sourceId: 'matter-1',
      sourceVersion: 8,
      case: {
        id: 'case-1',
        platform: null,
        shopName: null,
        caseNo: null,
        stage: 'PENDING_MATCH',
        lawyerName: null,
      },
      items: [],
      paperCertificates: [
        {
          id: 'paper-1',
          number: 'N1',
          status: 'NOT_ISSUED',
          issuedOn: null,
          officeName: null,
          pages: null,
          contentVersionId: null,
          contentMaterialId: null,
          electronicFiles: files,
        },
      ],
    };
    http.getJson.mockResolvedValue(group);
    const result = await getEvidenceGroup('group-1');
    expect(result.paperCertificates[0].electronicFiles).toEqual(files);
    expect(http.getJson).toHaveBeenCalledWith('/evidence/groups/group-1', {});
  });
  it('serializes multi-stage filtering through the shared /api/v1 HTTP base', async () => {
    http.getJson.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      counts: {
        statuses: {
          ALL: 0,
          UNDELIVERED: 0,
          IN_STOCK: 0,
          MAILED_TO_LAWYER: 0,
          DESTROYED: 0,
        },
        stages: {},
        allStageCases: 0,
      },
    });
    await listEvidence({
      page: 1,
      stages: ['FILED', 'APPEAL'],
      lawyerQuery: 'Lin',
    });
    expect(http.getJson).toHaveBeenCalledWith(
      '/evidence?page=1&stages=FILED&stages=APPEAL&lawyerQuery=Lin',
      {},
    );
  });

  it('requests the entire matching collection without pagination and rejects duplicate IDs', async () => {
    http.getJson
      .mockResolvedValueOnce({ ids: ['a', 'b', 'c'] })
      .mockResolvedValueOnce({ ids: ['a', 'a'] });
    await expect(
      matchingEvidenceIds({ page: 2, pageSize: 20, lawyerQuery: 'Lin' }),
    ).resolves.toEqual(['a', 'b', 'c']);
    expect(http.getJson).toHaveBeenCalledWith(
      '/evidence/matching-ids?lawyerQuery=Lin',
      {},
    );
    await expect(matchingEvidenceIds({})).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('passes explicit stable item and paper IDs to bulk update', async () => {
    http.requestJson.mockResolvedValue({
      changedEvidence: 1,
      changedPaperCertificates: 1,
    });
    await bulkEvidenceStatus(
      {
        evidenceIds: ['item-1'],
        paperCertificateIds: ['paper-2'],
        paperStatus: 'MAILED_TO_LAWYER',
      },
      'key-1',
    );
    expect(http.requestJson).toHaveBeenCalledWith('/evidence/bulk-status', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'key-1' },
      body: {
        evidenceIds: ['item-1'],
        paperCertificateIds: ['paper-2'],
        paperStatus: 'MAILED_TO_LAWYER',
      },
    });
  });

  it('exports only explicitly selected stable IDs', async () => {
    http.requestJson.mockResolvedValue({
      filename: 'selected.csv',
      csv: 'csv',
    });
    await exportSelectedEvidence(['item-2']);
    expect(http.requestJson).toHaveBeenCalledWith('/evidence/export', {
      method: 'POST',
      body: { evidenceIds: ['item-2'] },
    });
  });
});
