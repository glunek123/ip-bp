import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getClientCase,
  listClientCases,
  mailClientCaseComplaint,
  mailClientCaseExecution,
} from './client-cases';
afterEach(() => vi.unstubAllGlobals());
const item = {
  id: 'case-1',
  businessNo: 'CA-1',
  stage: 'WAITING_COMPLAINT_STAMP',
  version: 4,
  canMailComplaint: true,
  canMailExecution: false,
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
      executionConfirmationId: null,
      executionMailing: null,
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
  it('decodes WAITING_HEARING without exposing internal acceptance fields', async () => {
    mock({
      items: [{ ...item, stage: 'WAITING_HEARING' }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await expect(listClientCases()).resolves.toMatchObject({
      items: [{ stage: 'WAITING_HEARING' }],
    });
    mock({
      ...item,
      stage: 'WAITING_HEARING',
      confirmedAmountState: 'KNOWN',
      confirmedAmount: '123.45',
      confirmedAt: '2026-10-01T00:00:00Z',
      complaintFile: file,
      authorizationFiles: [],
      pendingReceiptFiles: [],
      complaintMailing: null,
      executionConfirmationId: null,
      executionMailing: null,
      acceptance: { acceptedAt: '2026-10-01', courtCaseNo: 'private' },
    });
    await expect(getClientCase('case-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('decodes WAITING_JUDGMENT only as a client stage projection', async () => {
    mock({
      items: [{ ...item, stage: 'WAITING_JUDGMENT' }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await expect(listClientCases()).resolves.toMatchObject({
      items: [{ stage: 'WAITING_JUDGMENT' }],
    });
    mock({
      ...item,
      stage: 'WAITING_JUDGMENT',
      confirmedAmountState: 'KNOWN',
      confirmedAmount: '123.45',
      confirmedAt: '2026-10-01T00:00:00Z',
      complaintFile: file,
      authorizationFiles: [],
      pendingReceiptFiles: [],
      complaintMailing: null,
      executionConfirmationId: null,
      executionMailing: null,
      hearing: { corrections: [] },
    });
    await expect(getClientCase('case-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it('decodes the two new stages without accepting internal choice facts', async () => {
    for (const stage of [
      'SECOND_INSTANCE',
      'WAITING_EXECUTION_DOCUMENTS',
      'WAITING_EXECUTION_CONFIRMATION',
    ]) {
      mock({
        items: [{ ...item, stage }],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      await expect(listClientCases()).resolves.toMatchObject({
        items: [{ stage }],
      });
    }
    mock({
      ...item,
      stage: 'WAITING_EXECUTION_CONFIRMATION',
      confirmedAmountState: 'KNOWN',
      confirmedAmount: '123.45',
      confirmedAt: '2026-10-01T00:00:00Z',
      complaintFile: file,
      authorizationFiles: [],
      pendingReceiptFiles: [],
      complaintMailing: null,
      executionConfirmationId: null,
      executionMailing: null,
    });
    await expect(getClientCase('case-1')).resolves.toMatchObject({
      stage: 'WAITING_EXECUTION_CONFIRMATION',
    });

    mock({
      ...item,
      stage: 'SECOND_INSTANCE',
      confirmedAmountState: 'KNOWN',
      confirmedAmount: '123.45',
      confirmedAt: '2026-10-01T00:00:00Z',
      complaintFile: file,
      authorizationFiles: [],
      pendingReceiptFiles: [],
      complaintMailing: null,
      executionConfirmationId: null,
      executionMailing: null,
      judgmentNextStep: { history: [] },
    });
    await expect(getClientCase('case-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
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

  it('decodes the client execution anchor and minimal mailing fact', async () => {
    const confirmationId = '80000000-0000-4000-8000-000000000101';
    const mailingId = '80000000-0000-4000-8000-000000000102';
    mock({
      ...item,
      stage: 'WAITING_EXECUTION_FILING',
      canMailExecution: false,
      confirmedAmountState: 'KNOWN',
      confirmedAmount: '123.45',
      confirmedAt: '2026-10-01T00:00:00Z',
      complaintFile: file,
      authorizationFiles: [],
      pendingReceiptFiles: [],
      complaintMailing: null,
      executionConfirmationId: confirmationId,
      executionMailing: {
        id: mailingId,
        mailedAt: '2026-10-02',
        recordedAt: '2026-10-02T03:00:00Z',
        files: [file],
      },
    });
    await expect(getClientCase('case-1')).resolves.toMatchObject({
      executionConfirmationId: confirmationId,
      executionMailing: { id: mailingId, files: [file] },
    });
  });

  it('delegates client execution mailing and validates confirmation anchor and version', async () => {
    const input = {
      expectedVersion: 8,
      idempotencyKey: 'key-execution-mail',
      expectedConfirmationId: '80000000-0000-4000-8000-000000000101',
      mailedAt: '2026-10-11',
      mailReceiptContentVersionIds: ['80000000-0000-4000-8000-000000000103'],
    };
    const fetch = mock({
      id: 'case-1',
      mailingId: '80000000-0000-4000-8000-000000000102',
      confirmationId: input.expectedConfirmationId,
      stage: 'WAITING_EXECUTION_FILING',
      version: 9,
      mailedAt: input.mailedAt,
      recordedAt: '2026-10-11T03:00:00Z',
    });
    await mailClientCaseExecution('case-1', input);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      '/api/v1/client/cases/case-1/execution-mail',
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual(input);

    mock({
      id: 'case-1',
      mailingId: '80000000-0000-4000-8000-000000000102',
      confirmationId: '80000000-0000-4000-8000-000000000104',
      stage: 'WAITING_EXECUTION_FILING',
      version: 9,
      mailedAt: input.mailedAt,
      recordedAt: '2026-10-11T03:00:00Z',
    });
    await expect(
      mailClientCaseExecution('case-1', input),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
