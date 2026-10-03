import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getClientCase,
  listClientCases,
  mailClientCaseComplaint,
} from './client-cases';
afterEach(() => vi.unstubAllGlobals());
const item = {
  id: 'case-1',
  businessNo: 'CA-1',
  stage: 'WAITING_COMPLAINT_STAMP',
  version: 4,
  canMailComplaint: true,
  rightsHolderName: '权利人甲',
  defendantNames: ['被告甲'],
};
const file = {
  materialId: 'material-1',
  contentVersionId: 'version-1',
  originalFilename: '凭证.pdf',
  mimeType: 'application/pdf',
};
function mock(payload: unknown) {
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(payload)));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
describe('client cases API', () => {
  it('strictly decodes the enterprise list projection', async () => {
    const fetch = mock({ items: [item], total: 1, page: 1, pageSize: 20 });
    await expect(listClientCases()).resolves.toMatchObject({
      items: [{ businessNo: 'CA-1' }],
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      '/api/v1/client/cases?view=PENDING&page=1&pageSize=20',
    );
  });
  it('rejects accidental internal fields in the client projection', async () => {
    mock({ items: [{ ...item, fees: [] }], total: 1, page: 1, pageSize: 20 });
    await expect(listClientCases()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it('decodes client detail with exact confirmed and mailing files', async () => {
    mock({
      ...item,
      confirmedAmountState: 'KNOWN',
      confirmedAmount: '123.45',
      confirmedAt: '2026-10-01T00:00:00Z',
      complaintFile: file,
      authorizationFiles: [],
      pendingReceiptFiles: [],
      complaintMailing: null,
    });
    await expect(getClientCase('case-1')).resolves.toMatchObject({
      complaintFile: file,
    });
  });

  it('decodes the new stage in the existing client projection only', async () => {
    mock({
      items: [{ ...item, stage: 'WAITING_FORMAL_ACCEPTANCE' }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await expect(listClientCases()).resolves.toMatchObject({
      items: [{ stage: 'WAITING_FORMAL_ACCEPTANCE' }],
    });
  });
  it('posts the exact client command and validates the transition', async () => {
    const fetch = mock({
      id: 'case-1',
      stage: 'WAITING_FILING',
      version: 5,
      mailedAt: '2026-10-02',
      recordedAt: '2026-10-02T03:00:00Z',
    });
    await mailClientCaseComplaint('case-1', {
      expectedVersion: 4,
      idempotencyKey: 'key-1',
      mailedAt: '2026-10-02',
      mailReceiptContentVersionIds: ['version-1'],
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      '/api/v1/client/cases/case-1/complaint-mail',
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      expectedVersion: 4,
      idempotencyKey: 'key-1',
      mailedAt: '2026-10-02',
      mailReceiptContentVersionIds: ['version-1'],
    });
  });
});
