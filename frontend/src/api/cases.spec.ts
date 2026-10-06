import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  confirmCaseComplaint,
  createFilingCourt,
  getCase,
  listFilingCourts,
  listCases,
  listLawyerMatchCandidates,
  registerCaseAcceptance,
  mailCaseComplaint,
  matchCase,
  submitCaseFiling,
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
  canRegisterAcceptance: false,
  canUploadAcceptanceMaterials: false,
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
  acceptance: null,
  acceptanceMaterials: {
    ACCEPTANCE_NOTICE: { available: [], frozen: [], later: [] },
    PAYMENT_LIST: { available: [], frozen: [], later: [] },
    SERVICE_DOCUMENT: { available: [], frozen: [], later: [] },
  },
};
function mockJson(payload: unknown) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(payload)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('cases API', () => {
  it('decodes formal acceptance facts and the three separated material groups', async () => {
    const file = {
      materialId: 'material-notice',
      contentVersionId: 'version-notice',
      originalFilename: '受理通知书.pdf',
      mimeType: 'application/pdf',
    };
    mockJson({
      ...detail,
      stage: 'WAITING_HEARING',
      version: 6,
      courtCaseNo: '（2026）甲0101民初1号',
      canRegisterAcceptance: false,
      canUploadAcceptanceMaterials: true,
      acceptance: {
        acceptedAt: '2026-10-05',
        courtCaseNo: '（2026）甲0101民初1号',
        recordedAt: '2026-10-05T01:00:00.000Z',
        recordedByUserId: 'operator-1',
      },
      acceptanceMaterials: {
        ACCEPTANCE_NOTICE: { available: [], frozen: [file], later: [] },
        PAYMENT_LIST: { available: [], frozen: [], later: [] },
        SERVICE_DOCUMENT: { available: [], frozen: [], later: [] },
      },
    });
    await expect(getCase('case-1')).resolves.toMatchObject({
      stage: 'WAITING_HEARING',
      acceptance: { courtCaseNo: '（2026）甲0101民初1号' },
      acceptanceMaterials: {
        ACCEPTANCE_NOTICE: { frozen: [file] },
      },
    });
  });
  it('requires the top-level court case number to match the accepted fact', async () => {
    const accepted = {
      ...detail,
      stage: 'WAITING_HEARING',
      version: 6,
      canRegisterAcceptance: false,
      canUploadAcceptanceMaterials: true,
      acceptance: {
        acceptedAt: '2026-10-05',
        courtCaseNo: '（2026）甲0101民初1号',
        recordedAt: '2026-10-05T01:00:00.000Z',
        recordedByUserId: 'operator-1',
      },
    };
    for (const courtCaseNo of [null, '（2026）甲0101民初2号']) {
      mockJson({ ...accepted, courtCaseNo });
      await expect(getCase('case-1')).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
  });
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
        WAITING_HEARING: 0,
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
        WAITING_HEARING: 0,
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
        WAITING_HEARING: 0,
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
        WAITING_HEARING: 0,
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
      canRegisterAcceptance: false,
      canUploadAcceptanceMaterials: false,
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

  it('accepts a lawyer as the actor in an internal case mailing record', async () => {
    mockJson({
      ...detail,
      stage: 'WAITING_FILING',
      complaintMailing: {
        mailedAt: '2026-10-04',
        recordedAt: '2026-10-04T02:00:00Z',
        recordedByUserId: 'lawyer-user-1',
        actorType: 'LAWYER',
        receiptFiles: [
          {
            materialId: 'material-1',
            contentVersionId: 'mail-v1',
            originalFilename: '邮寄凭证.pdf',
            mimeType: 'application/pdf',
          },
        ],
      },
    });

    await expect(getCase('case-1')).resolves.toMatchObject({
      complaintMailing: { actorType: 'LAWYER' },
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
      lawyerAccountId: 'lawyer-account-1',
      lawyerProfileId: 'lawyer-profile-1',
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('key-1');
    expect(JSON.parse(String(init.body))).toEqual({
      expectedVersion: 3,
      idempotencyKey: 'key-1',
      matchedOn: '2026-09-28',
      defendants: [{ kind: 'PERSON', name: '被告甲', idNo: 'ID-1' }],
      lawyerAccountId: 'lawyer-account-1',
      lawyerProfileId: 'lawyer-profile-1',
    });
  });

  it('matches a case to a lawyer account and forwards the selected profile id', async () => {
    const fetchMock = mockJson({
      id: 'case-1',
      stage: 'WAITING_COMPLAINT',
      version: 4,
      matchedAt: '2026-09-29T01:00:00Z',
      matchedOn: '2026-09-28',
    });
    const input = {
      expectedVersion: 3,
      idempotencyKey: 'key-account-match',
      matchedOn: '2026-09-28',
      defendants: [{ kind: 'PERSON' as const, name: '被告甲' }],
      lawyerAccountId: 'lawyer-account-1',
      lawyerProfileId: 'lawyer-profile-1',
    };

    await matchCase('case-1', input);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual(input);
  });

  it('matches an account without adding a profile unless the candidate supplied it', async () => {
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
      lawyerAccountId: 'lawyer-account-2',
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      lawyerAccountId: 'lawyer-account-2',
    });
    expect(JSON.parse(String(init.body))).not.toHaveProperty('lawyerProfileId');
  });

  it('strictly decodes the narrow lawyer projection without internal fields', async () => {
    const lawyerDetail = {
      id: 'case-1',
      businessNo: 'CA-1',
      stage: 'WAITING_COMPLAINT',
      version: 4,
      canMatch: false,
      canSubmitComplaint: true,
      canConfirmComplaint: false,
      canMailComplaint: false,
      canSubmitFiling: false,
      canRegisterAcceptance: false,
      canUploadAcceptanceMaterials: false,
      createdAt: '2026-09-28T00:00:00.000Z',
      matchedAt: '2026-09-29T01:00:00Z',
      matchedOn: '2026-09-28',
      defendants: detail.defendants,
      lawyers: detail.lawyers,
      customer: { id: 'customer-1', name: '客户甲' },
      rightsHolder: { id: 'holder-1', name: '权利人甲' },
      certificate: detail.certificate,
      complaint: null,
      complaintConfirmation: null,
      complaintMailing: null,
      filingSubmission: null,
      courtCaseNo: null,
      acceptance: null,
      acceptanceMaterials: detail.acceptanceMaterials,
    };
    const read = Reflect.get(casesApi, 'getLawyerCase') as
      ((id: string) => Promise<Record<string, unknown>>) | undefined;
    expect(read).toBeTypeOf('function');
    if (!read) return;
    mockJson(lawyerDetail);
    await expect(read('case-1')).resolves.toMatchObject({
      canMatch: false,
      customer: { name: '客户甲' },
    });
    const acceptedLawyerDetail = {
      ...lawyerDetail,
      stage: 'WAITING_HEARING',
      version: 6,
      canRegisterAcceptance: false,
      canUploadAcceptanceMaterials: true,
      courtCaseNo: '（2026）甲0101民初1号',
      acceptance: {
        acceptedAt: '2026-10-05',
        courtCaseNo: '（2026）甲0101民初1号',
        recordedAt: '2026-10-05T01:00:00.000Z',
      },
    };
    mockJson(acceptedLawyerDetail);
    await expect(read('case-1')).resolves.toMatchObject({
      stage: 'WAITING_HEARING',
      courtCaseNo: '（2026）甲0101民初1号',
      acceptance: { courtCaseNo: '（2026）甲0101民初1号' },
    });
    for (const courtCaseNo of [null, '（2026）甲0101民初2号']) {
      mockJson({ ...acceptedLawyerDetail, courtCaseNo });
      await expect(read('case-1')).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
    mockJson({ ...lawyerDetail, fees: detail.fees });
    await expect(read('case-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('posts the existing complaint command through the lawyer route', async () => {
    const fetchMock = mockJson({
      id: 'case-1',
      stage: 'WAITING_COMPLAINT_CONFIRMATION',
      version: 4,
      submittedAt: '2026-10-06T01:00:00Z',
    });
    await submitComplaint(
      'case-1',
      {
        expectedVersion: 3,
        idempotencyKey: 'lawyer-submit-key',
        amountState: 'PENDING',
        amount: null,
        pendingReason: '待补',
        complaintContentVersionIds: ['complaint-v1'],
        authorizationContentVersionIds: ['authorization-v1'],
      },
      'lawyer',
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/lawyer/cases/case-1/complaint-submit',
    );
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Idempotency-Key'),
    ).toBe('lawyer-submit-key');
  });

  it('routes the shared confirmation, mailing, and filing commands through the lawyer API', async () => {
    const versionId = '70000000-0000-4000-8000-000000000001';
    const courtId = '70000000-0000-4000-8000-000000000021';
    const evidenceVersionId = '70000000-0000-4000-8000-000000000024';

    const confirmationFetch = mockJson({
      id: 'case-1',
      stage: 'WAITING_COMPLAINT_STAMP',
      version: 4,
      confirmedAt: '2026-10-02T02:00:00Z',
    });
    await confirmCaseComplaint(
      'case-1',
      {
        expectedVersion: 3,
        idempotencyKey: 'lawyer-confirm-key',
        confirmedComplaintContentVersionId: versionId,
        amountState: 'PENDING',
        amount: null,
        pendingReason: '待客户补交金额凭证',
        confirmDisclose: false,
      },
      'lawyer',
    );
    expect(confirmationFetch.mock.calls[0]?.[0]).toBe(
      '/api/v1/lawyer/cases/case-1/complaint-confirm',
    );

    const mailingFetch = mockJson({
      id: 'case-1',
      stage: 'WAITING_FILING',
      version: 5,
      mailedAt: '2026-10-02',
      recordedAt: '2026-10-03T01:00:00Z',
    });
    await mailCaseComplaint(
      'case-1',
      {
        expectedVersion: 4,
        idempotencyKey: 'lawyer-mail-key',
        mailedAt: '2026-10-02',
        mailReceiptContentVersionIds: [versionId],
      },
      'lawyer',
    );
    expect(mailingFetch.mock.calls[0]?.[0]).toBe(
      '/api/v1/lawyer/cases/case-1/complaint-mail',
    );

    const courtsFetch = mockJson({
      items: [{ id: courtId, name: '甲市中级人民法院' }],
    });
    await expect(listFilingCourts('case-1', 'lawyer')).resolves.toEqual([
      { id: courtId, name: '甲市中级人民法院' },
    ]);
    expect(courtsFetch.mock.calls[0]?.[0]).toBe(
      '/api/v1/lawyer/cases/case-1/filing-courts',
    );

    const createCourtFetch = mockJson({
      id: courtId,
      name: '乙市中级人民法院',
    });
    await createFilingCourt('case-1', { name: '乙市中级人民法院' }, 'lawyer');
    expect(createCourtFetch.mock.calls[0]?.[0]).toBe(
      '/api/v1/lawyer/cases/case-1/filing-courts',
    );

    const filingFetch = mockJson({
      id: 'case-1',
      stage: 'WAITING_FORMAL_ACCEPTANCE',
      version: 6,
      submittedAt: '2026-10-03',
      recordedAt: '2026-10-03T03:00:00Z',
    });
    await submitCaseFiling(
      'case-1',
      {
        expectedVersion: 5,
        idempotencyKey: 'lawyer-filing-key',
        courtId,
        submittedAt: '2026-10-03',
        filingEvidenceContentVersionIds: [evidenceVersionId],
        filingScreenshotContentVersionIds: [],
      },
      'lawyer',
    );
    expect(filingFetch.mock.calls[0]?.[0]).toBe(
      '/api/v1/lawyer/cases/case-1/filing-submit',
    );
    expect(
      new Headers(filingFetch.mock.calls[0]?.[1]?.headers).get(
        'Idempotency-Key',
      ),
    ).toBe('lawyer-filing-key');
  });

  it('registers acceptance through the lawyer route with the frozen DTO', async () => {
    const fetchMock = mockJson({
      id: 'case-1',
      stage: 'WAITING_HEARING',
      version: 7,
      acceptedAt: '2026-10-05',
      courtCaseNo: '甲0101民初1号',
      recordedAt: '2026-10-06T01:00:00.000Z',
    });
    const selected = '70000000-0000-4000-8000-000000000001';
    await registerCaseAcceptance(
      'case-1',
      {
        expectedVersion: 6,
        idempotencyKey: 'acceptance-key',
        acceptedAt: '2026-10-05',
        courtCaseNo: ' 甲0101民初1号 ',
        acceptanceNoticeContentVersionIds: [selected],
        paymentListContentVersionIds: [],
        serviceDocumentContentVersionIds: [],
      },
      'lawyer',
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/lawyer/cases/case-1/acceptance-register',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      expectedVersion: 6,
      idempotencyKey: 'acceptance-key',
      acceptedAt: '2026-10-05',
      courtCaseNo: '甲0101民初1号',
      acceptanceNoticeContentVersionIds: [selected],
      paymentListContentVersionIds: [],
      serviceDocumentContentVersionIds: [],
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
        lawyerAccountId: 'lawyer-account-1',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads account-deduplicated match candidates by username query', async () => {
    const fetchMock = mockJson({
      items: [
        {
          lawyerAccountId: 'account-1',
          username: 'lawyer.a',
          displayName: '律师甲',
          lawyerProfileId: 'profile-1',
        },
      ],
    });
    await expect(
      listLawyerMatchCandidates('case-1', 'lawyer.a'),
    ).resolves.toEqual([
      {
        lawyerAccountId: 'account-1',
        username: 'lawyer.a',
        displayName: '律师甲',
        lawyerProfileId: 'profile-1',
      },
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/cases/case-1/lawyer-accounts?q=lawyer.a',
    );
  });

  it('lists only the signed-in lawyer queue using its own route', async () => {
    const fetchMock = mockJson({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      counts: {
        PENDING_MATCH: 0,
        WAITING_COMPLAINT: 0,
        WAITING_COMPLAINT_CONFIRMATION: 0,
        WAITING_COMPLAINT_STAMP: 0,
        WAITING_FILING: 0,
        WAITING_FORMAL_ACCEPTANCE: 0,
        WAITING_HEARING: 0,
      },
    });
    const read = Reflect.get(casesApi, 'listLawyerCases') as
      | ((page: number, pageSize: number, stage?: string) => Promise<unknown>)
      | undefined;
    expect(read).toBeTypeOf('function');
    if (!read) return;
    await read(1, 20, 'WAITING_FILING');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/lawyer/cases?page=1&pageSize=20&stage=WAITING_FILING',
    );
  });
});
