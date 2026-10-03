import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  confirmCaseComplaint,
  getCase,
  listCases,
  mailCaseComplaint,
  matchCase,
  submitComplaint,
} from './cases';
import * as casesApi from './cases';

afterEach(() => vi.unstubAllGlobals());

const summary = {
  id: 'case-1',
  businessNo: 'CA-1',
  stage: 'PENDING_MATCH',
  createdAt: '2026-09-28T00:00:00.000Z',
  version: 3,
  owner: { id: 'user-1', displayName: '负责人' },
  canMatch: true,
  canSubmitComplaint: false,
  canConfirmComplaint: false,
  canMailComplaint: false,
  canSubmitFiling: false,
  sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
  sourceNotaryMatter: { id: 'matter-1', businessNo: 'NZ-1' },
};
const detail = {
  ...summary,
  courtCaseNo: null,
  department: { id: 'department-1', name: '知产部' },
  customer: { id: 'customer-1', name: '客户甲' },
  rightsHolder: { id: 'holder-1', name: '权利人甲' },
  certificate: {
    certificateNo: 'Z-100',
    certificateDate: '2026-09-28',
    issuedAt: '2026-09-28T00:00:00.000Z',
    needDisclose: false,
    files: [
      {
        materialId: 'material-1',
        contentVersionId: 'file-1',
        originalFilename: 'cert.pdf',
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
  defendants: [
    {
      id: 'defendant-1',
      kind: 'PERSON',
      name: '被告甲',
      idNo: null,
      phone: null,
      address: null,
    },
  ],
  lawyers: [
    {
      id: 'lawyer-1',
      fullName: '律师甲',
      lawFirm: '律所甲',
      phone: null,
      role: 'PRIMARY',
      assignedAt: '2026-09-28T00:00:00.000Z',
    },
  ],
  matchedAt: null,
  matchedOn: null,
  canSubmitComplaint: false,
  complaint: null,
  complaintConfirmation: null,
  complaintMailing: null,
  filingSubmission: null,
};
function mockJson(payload: unknown) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(payload)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('cases API', () => {
  it('reads the formal court choices from the case-scoped API', async () => {
    const fetchMock = mockJson({
      items: [
        {
          id: '70000000-0000-4000-8000-000000000021',
          name: '甲市中级人民法院',
        },
      ],
    });
    const read = Reflect.get(casesApi, 'listFilingCourts') as
      ((id: string) => Promise<unknown>) | undefined;
    expect(typeof read).toBe('function');
    if (!read) return;
    await expect(read('case-1')).resolves.toEqual([
      {
        id: '70000000-0000-4000-8000-000000000021',
        name: '甲市中级人民法院',
      },
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/cases/case-1/filing-courts',
    );
  });

  it('creates a real filing court through the case-scoped API', async () => {
    const fetchMock = mockJson({
      id: '70000000-0000-4000-8000-000000000022',
      name: '甲市中级人民法院',
    });
    const create = Reflect.get(casesApi, 'createFilingCourt') as
      ((id: string, input: { name: string }) => Promise<unknown>) | undefined;
    expect(typeof create).toBe('function');
    if (!create) return;
    await expect(
      create('case-1', { name: '甲市中级人民法院' }),
    ).resolves.toEqual({
      id: '70000000-0000-4000-8000-000000000022',
      name: '甲市中级人民法院',
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      name: '甲市中级人民法院',
    });
  });

  it('submits the exact filing command and validates its durable response', async () => {
    const fetchMock = mockJson({
      id: 'case-1',
      stage: 'WAITING_FORMAL_ACCEPTANCE',
      version: 6,
      submittedAt: '2026-10-03',
      recordedAt: '2026-10-03T03:00:00Z',
    });
    const submit = Reflect.get(casesApi, 'submitCaseFiling') as
      | ((id: string, input: Record<string, unknown>) => Promise<unknown>)
      | undefined;
    expect(typeof submit).toBe('function');
    if (!submit) return;
    const input = {
      expectedVersion: 5,
      idempotencyKey: 'filing-key',
      courtId: '70000000-0000-4000-8000-000000000023',
      submittedAt: '2026-10-03',
      filingEvidenceContentVersionIds: ['70000000-0000-4000-8000-000000000024'],
      filingScreenshotContentVersionIds: [],
      mediationNo: '诉调-1',
    };
    await expect(submit('case-1', input)).resolves.toMatchObject({
      stage: 'WAITING_FORMAL_ACCEPTANCE',
      version: 6,
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('filing-key');
    expect(JSON.parse(String(init.body))).toEqual(input);
  });

  it('posts the exact internal mailing command and rejects invalid dates locally', async () => {
    const fetchMock = mockJson({
      id: 'case-1',
      stage: 'WAITING_FILING',
      version: 5,
      mailedAt: '2026-10-02',
      recordedAt: '2026-10-03T01:00:00Z',
    });
    const input = {
      expectedVersion: 4,
      idempotencyKey: 'mail-key',
      mailedAt: '2026-10-02',
      mailReceiptContentVersionIds: ['receipt-v1'],
    };
    await expect(mailCaseComplaint('case-1', input)).resolves.toMatchObject({
      stage: 'WAITING_FILING',
      version: 5,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/cases/case-1/complaint-mail',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(
      input,
    );
    const invalidFetch = mockJson({});
    await expect(
      mailCaseComplaint('case-1', { ...input, mailedAt: '2026-02-30' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(invalidFetch).not.toHaveBeenCalled();
  });
  it('decodes list and sends the selected view and stage filters', async () => {
    const fetchMock = mockJson({
      items: [summary],
      total: 1,
      page: 1,
      pageSize: 20,
      counts: {
        PENDING_MATCH: 2,
        WAITING_COMPLAINT: 1,
        WAITING_COMPLAINT_CONFIRMATION: 0,
        WAITING_COMPLAINT_STAMP: 0,
        WAITING_FILING: 0,
        WAITING_FORMAL_ACCEPTANCE: 0,
      },
    });
    await expect(
      listCases(1, 20, { view: 'department', stage: 'PENDING_MATCH' }),
    ).resolves.toMatchObject({
      items: [{ businessNo: 'CA-1', canMatch: true }],
      counts: {
        PENDING_MATCH: 2,
        WAITING_COMPLAINT: 1,
        WAITING_COMPLAINT_CONFIRMATION: 0,
        WAITING_COMPLAINT_STAMP: 0,
        WAITING_FILING: 0,
        WAITING_FORMAL_ACCEPTANCE: 0,
      },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/cases?page=1&pageSize=20&view=department&stage=PENDING_MATCH',
    );
  });

  it('keeps complaint submit capability on a nonempty real list response', async () => {
    mockJson({
      items: [
        {
          ...summary,
          stage: 'WAITING_COMPLAINT',
          canMatch: false,
          canSubmitComplaint: true,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      counts: {
        PENDING_MATCH: 0,
        WAITING_COMPLAINT: 1,
        WAITING_COMPLAINT_CONFIRMATION: 0,
        WAITING_COMPLAINT_STAMP: 0,
        WAITING_FILING: 0,
        WAITING_FORMAL_ACCEPTANCE: 0,
      },
    });
    await expect(
      listCases(1, 20, { view: 'department' }),
    ).resolves.toMatchObject({
      items: [{ canMatch: false, canSubmitComplaint: true }],
    });
  });

  it('omits the stage parameter for all-stage lists and rejects invalid summaries', async () => {
    const fetchMock = mockJson({
      items: [summary],
      total: 1,
      page: 1,
      pageSize: 20,
      counts: {
        PENDING_MATCH: 2,
        WAITING_COMPLAINT: 1,
        WAITING_COMPLAINT_CONFIRMATION: 0,
        WAITING_COMPLAINT_STAMP: 0,
        WAITING_FILING: 0,
        WAITING_FORMAL_ACCEPTANCE: 0,
      },
    });
    await listCases(1, 20, { stage: 'all' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/cases?page=1&pageSize=20&view=mine',
    );
    mockJson({
      items: [{ ...summary, owner: undefined }],
      total: 1,
      page: 1,
      pageSize: 20,
      counts: {
        PENDING_MATCH: 1,
        WAITING_COMPLAINT: 0,
        WAITING_COMPLAINT_CONFIRMATION: 0,
      },
    });
    await expect(listCases()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('decodes detail while preserving read-only certificate and fee data', async () => {
    mockJson(detail);
    await expect(getCase('case-1')).resolves.toMatchObject({
      customer: { name: '客户甲' },
      certificate: { certificateNo: 'Z-100' },
      fees: [{ category: 'SAMPLE', amount: '12.00' }],
      defendants: [{ name: '被告甲' }],
      matchedAt: null,
      matchedOn: null,
    });
  });

  it('strictly decodes the formal acceptance stage and internal filing facts', async () => {
    mockJson({
      ...detail,
      stage: 'WAITING_FORMAL_ACCEPTANCE',
      canSubmitFiling: false,
      filingSubmission: {
        court: {
          id: '70000000-0000-4000-8000-000000000011',
          name: '甲市中级人民法院',
        },
        submittedAt: '2026-10-03',
        recordedAt: '2026-10-03T03:00:00Z',
        recordedByUserId: '70000000-0000-4000-8000-000000000012',
        mediationNo: null,
        evidenceFiles: [
          {
            materialId: '70000000-0000-4000-8000-000000000013',
            contentVersionId: '70000000-0000-4000-8000-000000000014',
            originalFilename: '起诉状.pdf',
            mimeType: 'application/pdf',
          },
        ],
        screenshotFiles: [],
      },
    });
    await expect(getCase('case-1')).resolves.toMatchObject({
      stage: 'WAITING_FORMAL_ACCEPTANCE',
      filingSubmission: {
        court: { name: '甲市中级人民法院' },
        submittedAt: '2026-10-03',
        evidenceFiles: [{ originalFilename: '起诉状.pdf' }],
      },
    });
  });

  it('keeps an older matched case date unknown and accepts an unknown law firm', async () => {
    mockJson({
      ...detail,
      stage: 'WAITING_COMPLAINT',
      matchedAt: '2026-09-29T01:00:00Z',
      matchedOn: null,
      lawyers: [{ ...detail.lawyers[0], lawFirm: null }],
    });
    await expect(getCase('case-1')).resolves.toMatchObject({
      matchedOn: null,
      lawyers: [{ lawFirm: null }],
    });
  });

  it('decodes complaint state and its versioned attachments on case detail', async () => {
    mockJson({
      ...detail,
      stage: 'WAITING_COMPLAINT',
      canSubmitComplaint: true,
      canConfirmComplaint: false,
      complaint: null,
    });
    await expect(getCase('case-1')).resolves.toMatchObject({
      canSubmitComplaint: true,
      canConfirmComplaint: false,
      complaint: null,
    });
  });

  it('submits a complaint with exact version ids and validates the transition', async () => {
    const fetchMock = mockJson({
      id: 'case-1',
      stage: 'WAITING_COMPLAINT_CONFIRMATION',
      version: 4,
      submittedAt: '2026-09-30T01:00:00Z',
    });
    await submitComplaint('case-1', {
      expectedVersion: 3,
      idempotencyKey: 'complaint-key',
      amountState: 'PENDING',
      amount: null,
      pendingReason: '尚待客户提供',
      complaintContentVersionIds: ['complaint-v1'],
      authorizationContentVersionIds: ['authorization-v1'],
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/cases/case-1/complaint-submit',
    );
    expect(JSON.parse(String(init.body))).toEqual({
      expectedVersion: 3,
      idempotencyKey: 'complaint-key',
      amountState: 'PENDING',
      amount: null,
      pendingReason: '尚待客户提供',
      complaintContentVersionIds: ['complaint-v1'],
      authorizationContentVersionIds: ['authorization-v1'],
    });
  });

  it('strictly decodes the stamp stage and nullable confirmed complaint file', async () => {
    mockJson({
      ...detail,
      stage: 'WAITING_COMPLAINT_STAMP',
      canMatch: false,
      canSubmitComplaint: false,
      complaintConfirmation: {
        confirmedComplaintContentVersionId: 'complaint-v2',
        amountState: 'KNOWN',
        amount: '123.45',
        pendingReason: null,
        changeNote: '按客户补充版本确认',
        confirmDisclose: true,
        confirmedAt: '2026-10-02T02:00:00Z',
        confirmedByUserId: 'user-1',
        complaintFile: null,
      },
    });
    await expect(getCase('case-1')).resolves.toMatchObject({
      stage: 'WAITING_COMPLAINT_STAMP',
      complaintConfirmation: {
        confirmedComplaintContentVersionId: 'complaint-v2',
        complaintFile: null,
      },
    });
  });

  it('rejects confirmation summaries with malformed nullable files', async () => {
    mockJson({
      ...detail,
      stage: 'WAITING_COMPLAINT_STAMP',
      complaintConfirmation: {
        confirmedComplaintContentVersionId: 'complaint-v2',
        amountState: 'KNOWN',
        amount: '123.45',
        pendingReason: null,
        changeNote: null,
        confirmDisclose: false,
        confirmedAt: '2026-10-02T02:00:00Z',
        confirmedByUserId: 'user-1',
        complaintFile: { materialId: 'material-1' },
      },
    });
    await expect(getCase('case-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('posts complaint confirmation with the stable idempotency key and exact body', async () => {
    const fetchMock = mockJson({
      id: 'case-1',
      stage: 'WAITING_COMPLAINT_STAMP',
      version: 4,
      confirmedAt: '2026-10-02T02:00:00Z',
    });
    const input = {
      expectedVersion: 3,
      idempotencyKey: 'confirmation-key',
      confirmedComplaintContentVersionId:
        '70000000-0000-4000-8000-000000000001',
      amountState: 'PENDING' as const,
      amount: null,
      pendingReason: '待客户补交金额凭证',
      confirmDisclose: false,
    };
    await expect(confirmCaseComplaint('case-1', input)).resolves.toMatchObject({
      stage: 'WAITING_COMPLAINT_STAMP',
      version: 4,
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/cases/case-1/complaint-confirm',
    );
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe(
      'confirmation-key',
    );
    expect(JSON.parse(String(init.body))).toEqual(input);
  });

  it.each([
    {
      label: 'requires a UUID v4 material version',
      changes: { confirmedComplaintContentVersionId: 'complaint-v1' },
    },
    {
      label: 'rejects padded idempotency keys',
      changes: { idempotencyKey: ' key ' },
    },
    {
      label: 'uses the submitted amount decimal limits',
      changes: { amount: '01.000' },
    },
  ])('validates confirmation input: $label', async ({ changes }) => {
    const fetchMock = mockJson({});
    const input = {
      expectedVersion: 3,
      idempotencyKey: 'confirmation-key',
      confirmedComplaintContentVersionId:
        '70000000-0000-4000-8000-000000000001',
      amountState: 'KNOWN' as const,
      amount: '123.45',
      pendingReason: null,
      confirmDisclose: true,
      ...changes,
    };
    await expect(
      confirmCaseComplaint('case-1', input as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts match data with idempotency header and validates the transition response', async () => {
    const fetchMock = mockJson({
      id: 'case-1',
      stage: 'WAITING_COMPLAINT',
      version: 4,
      matchedAt: '2026-09-29T01:00:00Z',
      matchedOn: '2026-09-28',
    });
    await matchCase('case-1', {
      expectedVersion: 3,
      idempotencyKey: 'key-1',
      matchedOn: '2026-09-28',
      defendants: [{ kind: 'PERSON', name: ' 被告甲 ', idNo: ' ID-1 ' }],
      lawyer: { fullName: ' 律师甲 ', lawFirm: ' 律所甲 ' },
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('key-1');
    expect(JSON.parse(String(init.body))).toEqual({
      expectedVersion: 3,
      idempotencyKey: 'key-1',
      matchedOn: '2026-09-28',
      defendants: [{ kind: 'PERSON', name: '被告甲', idNo: 'ID-1' }],
      lawyer: { fullName: '律师甲', lawFirm: '律所甲' },
    });
  });

  it('omits an unknown law firm without replacing it with a placeholder', async () => {
    const fetchMock = mockJson({
      id: 'case-1',
      stage: 'WAITING_COMPLAINT',
      version: 4,
      matchedAt: '2026-09-29T01:00:00Z',
      matchedOn: '2026-09-28',
    });
    await matchCase('case-1', {
      expectedVersion: 3,
      idempotencyKey: 'key-no-firm',
      matchedOn: '2026-09-28',
      defendants: [{ kind: 'PERSON', name: '被告甲' }],
      lawyer: { fullName: '律师甲' },
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).lawyer).toEqual({
      fullName: '律师甲',
    });
  });

  it('rejects an invalid actual match date before sending a command', async () => {
    const fetchMock = mockJson({});
    await expect(
      matchCase('case-1', {
        expectedVersion: 3,
        idempotencyKey: 'bad-date',
        matchedOn: '2026-02-30',
        defendants: [{ kind: 'PERSON', name: '被告甲' }],
        lawyer: { fullName: '律师甲' },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
