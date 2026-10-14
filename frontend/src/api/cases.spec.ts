import { ref } from 'vue';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  confirmCaseComplaint,
  confirmCaseExecution,
  createFilingCourt,
  getCase,
  updateCaseDefendantContact,
  correctCaseAcceptance,
  saveSecondInstanceAcceptance,
  listFilingCourts,
  listCases,
  listLawyerCases,
  listLawyerMatchCandidates,
  registerCaseAcceptance,
  mailCaseComplaint,
  mailCaseExecution,
  matchCase,
  submitCaseFiling,
  submitCaseExecutionFiling,
  submitComplaint,
  chooseCaseJudgmentNextStep,
  revokeCaseJudgmentNextStep,
  saveSecondInstance,
  registerSecondInstanceResult,
  revokeSecondInstanceResult,
} from './cases';
import * as casesApi from './cases';
import type {
  CaseJudgmentFact,
  SubmitExecutionInput,
  SubmitExecutionResult,
} from './cases';

afterEach(() => vi.unstubAllGlobals());

const archiveCaseId = '90000000-0000-4000-8000-000000000001';
const archiveInput: casesApi.ArchiveCaseInput = {
  expectedVersion: 20,
  idempotencyKey: 'archive-original-key',
  expectedClosureVersionId: '80000000-0000-4000-8000-000000000202',
  archiveAt: '2026-10-13',
  archiveType: 'EXECUTION_COLLECTED',
  archiveReason: '  保留原文，不推定结清  ',
};
const archiveReceipt: casesApi.CaseArchiveResult = {
  id: archiveCaseId,
  archiveId: '90000000-0000-4000-8000-000000000002',
  archiveVersionId: '90000000-0000-4000-8000-000000000003',
  closureId: '80000000-0000-4000-8000-000000000201',
  closureVersionId: archiveInput.expectedClosureVersionId,
  stage: 'ARCHIVED',
  version: 21,
  recordedAt: '2026-10-14T01:00:00.000Z',
};
function archiveDetailPayload() {
  const closure = closureDetailPayload();
  const current: casesApi.CaseArchiveVersion = {
    id: archiveReceipt.archiveVersionId,
    kind: 'ARCHIVE',
    priorVersionId: null,
    closureVersionId: archiveReceipt.closureVersionId,
    fromVersion: 20,
    toVersion: 21,
    archiveAt: archiveInput.archiveAt,
    archiveType: archiveInput.archiveType,
    archiveReason: archiveInput.archiveReason,
    correctionReason: null,
    recordedAt: archiveReceipt.recordedAt,
    recordedByUserId: '90000000-0000-4000-8000-000000000004',
  };
  return {
    ...closure,
    id: archiveCaseId,
    stage: 'ARCHIVED',
    version: 21,
    canArchive: false,
    canCorrectArchive: true,
    canRecordClosure: false,
    canCorrectClosure: false,
    archive: {
      id: archiveReceipt.archiveId,
      closureId: closure.closure.id,
      closureVersionId: closure.closure.current.id,
      current,
      history: [current],
    },
  };
}
describe('CA-017 fixed archive API', () => {
  it.each(['internal', 'lawyer'] as const)(
    'posts the exact body once for %s',
    async (audience) => {
      const fetch = mockJson(archiveReceipt, 201);
      await expect(
        casesApi.archiveCase(archiveCaseId, archiveInput, audience),
      ).resolves.toEqual(archiveReceipt);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]?.[0]).toBe(
        `/api/v1/${audience === 'lawyer' ? 'lawyer/cases' : 'cases'}/${archiveCaseId}/archive`,
      );
      expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual(
        archiveInput,
      );
      expect(fetch.mock.calls[0]?.[1]?.headers['Idempotency-Key']).toBe(
        archiveInput.idempotencyKey,
      );
    },
  );
  it.each([
    'VOIDED',
    'SETTLEMENT',
    'MEDIATION',
    'JUDGMENT_PERFORMED',
    'EXECUTION_COLLECTED',
    'EXECUTION_CLOSED',
  ] as const)(
    'accepts classification %s without adding financial fields',
    async (archiveType) => {
      const fetch = mockJson(archiveReceipt, 201);
      await casesApi.archiveCase(archiveCaseId, {
        ...archiveInput,
        archiveType,
      });
      expect(
        Object.keys(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))),
      ).toEqual(Object.keys(archiveInput));
    },
  );
  it('requires all explicit input keys, strict dates and anchors before transport', async () => {
    const invalid: unknown[] = [
      ...Object.keys(archiveInput).map((key) => {
        const copy: Record<string, unknown> = { ...archiveInput };
        delete copy[key];
        return copy;
      }),
      ...[
        { expectedVersion: 0 },
        { expectedVersion: Number.MAX_SAFE_INTEGER },
        { expectedClosureVersionId: 'bad' },
        { archiveAt: '2026-02-30' },
        { archiveAt: '2099-01-01' },
        { archiveType: 'OTHER' },
        { archiveReason: ' ' },
        { archiveReason: 'x'.repeat(2001) },
        { idempotencyKey: ' key ' },
        { unexpected: true },
      ].map((fields) => ({ ...archiveInput, ...fields })),
    ];
    for (const input of invalid) {
      const fetch = mockJson(archiveReceipt, 201);
      await expect(
        casesApi.archiveCase(archiveCaseId, input as casesApi.ArchiveCaseInput),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(fetch).not.toHaveBeenCalled();
    }
  });
  it('posts complete internal correction with original whitespace and fixed anchors', async () => {
    const input: casesApi.CorrectCaseArchiveInput = {
      ...archiveInput,
      expectedArchiveVersionId: archiveReceipt.archiveVersionId,
      correctionReason: '  核实登记错误  ',
    };
    const fetch = mockJson(archiveReceipt, 201);
    await casesApi.correctCaseArchive(archiveCaseId, input);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `/api/v1/cases/${archiveCaseId}/archive-correction`,
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual(input);
    for (const fields of [
      { expectedArchiveVersionId: 'bad' },
      { correctionReason: ' ' },
      { correctionReason: 'x'.repeat(501) },
    ]) {
      fetch.mockClear();
      await expect(
        casesApi.correctCaseArchive(archiveCaseId, { ...input, ...fields }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(fetch).not.toHaveBeenCalled();
    }
  });
  it.each([
    { id: 'other' },
    { archiveId: 'bad' },
    { archiveVersionId: 'bad' },
    { closureId: 'bad' },
    { closureVersionId: archiveReceipt.archiveVersionId },
    { stage: 'WAITING_ARCHIVE' },
    { version: 22 },
    { recordedAt: '2026-02-30T00:00:00Z' },
    { archiveReason: 'private' },
  ])('refuses incompatible fixed receipt %j', async (fields) => {
    mockJson({ ...archiveReceipt, ...fields }, 201);
    await expect(
      casesApi.archiveCase(archiveCaseId, archiveInput),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('decodes the exact finish → closure → archive chain with pending amount, null date and empty attachments', async () => {
    const payload = archiveDetailPayload();
    mockJson(payload);
    await expect(getCase(archiveCaseId)).resolves.toMatchObject({
      archive: payload.archive,
      closure: payload.closure,
    });
    const corrected: casesApi.CaseArchiveVersion = {
      ...payload.archive.current,
      id: '90000000-0000-4000-8000-000000000005',
      kind: 'CORRECT',
      priorVersionId: payload.archive.current.id,
      fromVersion: 21,
      toVersion: 22,
      correctionReason: '更正',
    };
    const archive = {
      ...payload.archive,
      current: corrected,
      history: [payload.archive.current, corrected],
    };
    mockJson({ ...payload, version: 22, archive });
    await expect(getCase(archiveCaseId)).resolves.toMatchObject({
      archive,
      closure: payload.closure,
    });
    for (const invalid of [
      { ...archive, closureId: archive.id },
      { ...archive, closureVersionId: corrected.id },
      { ...archive, current: { ...corrected, archiveReason: 'tamper' } },
      { ...archive, history: [corrected, payload.archive.current] },
      {
        ...archive,
        history: [
          payload.archive.current,
          { ...corrected, fromVersion: 20, toVersion: 21 },
        ],
      },
      {
        ...archive,
        history: [
          payload.archive.current,
          { ...corrected, closureVersionId: corrected.id },
        ],
      },
      {
        ...archive,
        current: { ...corrected, toVersion: 23 },
        history: [payload.archive.current, { ...corrected, toVersion: 23 }],
      },
      {
        ...archive,
        history: [
          payload.archive.current,
          { ...corrected, priorVersionId: corrected.id },
        ],
      },
    ]) {
      mockJson({ ...payload, version: 22, archive: invalid });
      await expect(getCase(archiveCaseId)).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
    for (const fields of [
      { archive: null },
      { closure: null },
      { executionFinish: null },
      { version: 23 },
      { stage: 'WAITING_ARCHIVE' },
      { canArchive: true },
      { canCorrectClosure: true },
    ]) {
      mockJson({ ...payload, ...fields });
      await expect(getCase(archiveCaseId)).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
  });
  it('accepts lawyer minimal archive history while refusing actor, correction reason and correction capability', async () => {
    const {
      owner: _owner,
      department: _department,
      fees: _fees,
      sourceLead: _lead,
      sourceNotaryMatter: _matter,
      ...base
    } = archiveDetailPayload();
    const {
      recordedByUserId: _closureActor,
      correctionReason: _closureReason,
      ...closureCurrent
    } = base.closure.current;
    const {
      recordedByUserId: _actor,
      correctionReason: _reason,
      ...current
    } = base.archive.current;
    void [
      _owner,
      _department,
      _fees,
      _lead,
      _matter,
      _closureActor,
      _closureReason,
      _actor,
      _reason,
    ];
    const payload = {
      ...base,
      canMatch: false,
      canCorrectArchive: false,
      closure: {
        ...base.closure,
        current: closureCurrent,
        history: [closureCurrent],
      },
      archive: { ...base.archive, current, history: [current] },
    };
    mockJson(payload);
    await expect(casesApi.getLawyerCase(archiveCaseId)).resolves.toMatchObject({
      archive: { current },
    });
    for (const fields of [
      { canCorrectArchive: true },
      { archive: base.archive },
    ]) {
      mockJson({ ...payload, ...fields });
      await expect(casesApi.getLawyerCase(archiveCaseId)).rejects.toMatchObject(
        { code: 'INVALID_RESPONSE' },
      );
    }
  });
  it('retains detached original requests on remount and isolates identity changes synchronously', () => {
    const auth = {};
    const identity = ref('operator:department:1');
    const session = casesApi.caseArchiveSession(auth, () => identity.value);
    session.setPending(archiveCaseId, {
      command: 'ARCHIVE',
      input: archiveInput,
    });
    const request = session.pending(archiveCaseId)!;
    request.input.archiveReason = 'mutated';
    expect(
      casesApi
        .caseArchiveSession(auth, () => identity.value)
        .pending(archiveCaseId)?.input.archiveReason,
    ).toBe(archiveInput.archiveReason);
    expect(session.markChanged(archiveReceipt.archiveVersionId)).toBe(true);
    expect(session.markChanged(archiveReceipt.archiveVersionId)).toBe(false);
    identity.value = 'operator:department:2';
    expect(session.pending(archiveCaseId)).toBeNull();
  });
});

const summaryBase = {
  id: 'case-1',
  businessNo: 'CA-1',
  stage: 'PENDING_MATCH',
  createdAt: '2026-09-28T00:00:00.000Z',
  version: 3,
  owner: { id: 'user-1', displayName: '负责人' },
  canMatch: true,
  canSubmitExecution: false,
  canConfirmExecution: false,
  canMailExecution: false,
  canSubmitExecutionFiling: false,
  canFinishExecution: false,
  canRecordClosure: false,
  canCorrectClosure: false,
  canArchive: false,
  canCorrectArchive: false,
  canSubmitComplaint: false,
  canConfirmComplaint: false,
  canMailComplaint: false,
  canSubmitFiling: false,
  canRegisterAcceptance: false,
  canUploadAcceptanceMaterials: false,
  canScheduleHearing: false,
  canCorrectHearing: false,
  canRegisterJudgment: false,
  canCorrectJudgment: false,
  canChooseJudgmentNextStep: false,
  canRevokeJudgmentNextStep: false,
  canSaveSecondInstance: false,
  canRegisterSecondInstanceResult: false,
  canRevokeSecondInstanceResult: false,
  sourceLead: { id: 'lead-1', businessNo: 'LD-1' },
  sourceNotaryMatter: { id: 'matter-1', businessNo: 'NZ-1' },
};
const unrecordedAmount = {
  state: 'UNRECORDED',
  amount: null,
  sourceType: null,
  sourceId: null,
};
const displaySummary = {
  customerName: '客户甲',
  rightsHolderName: '权利人甲',
  source: { platform: 'TAOBAO', shopName: '真实店铺', shopExternalId: null },
  defendants: [{ id: 'defendant-1', name: '被告甲' }],
  lawyers: [{ id: 'lawyer-1', fullName: '律师甲' }],
  court: null,
  courtCaseNo: null,
  claimAmount: unrecordedAmount,
  judgmentAmount: unrecordedAmount,
  closureAmount: unrecordedAmount,
};
const summary = { ...summaryBase, displaySummary };
const detail = {
  ...summaryBase,
  canSubmitExecution: false,
  executionSubmission: { current: null, submissions: [], availableFiles: [] },
  canConfirmExecution: false,
  canMailExecution: false,
  canSubmitExecutionFiling: false,
  canFinishExecution: false,
  canRecordClosure: false,
  canCorrectClosure: false,
  canArchive: false,
  canCorrectArchive: false,
  executionConfirmation: null,
  executionMailing: null,
  executionFiling: null,
  executionFinish: null,
  closure: null,
  archive: null,
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
  hearing: {
    currentArrangement: null,
    currentAdvance: null,
    arrangements: [],
    advances: [],
    corrections: [],
  },
  judgment: { current: null, history: [], availableFiles: [] },
  judgmentNextStep: { current: null, history: [], revocations: [] },
  acceptances: [],
  secondInstance: {
    currentTrialRoundId: null,
    currentProgress: null,
    currentResult: null,
    rounds: [],
    progresses: [],
    results: [],
    revocations: [],
  },
};
function mockJson(payload: unknown, status = 200) {
  const fetchMock = vi
    .fn()
    .mockImplementation(
      async () => new Response(JSON.stringify(payload), { status }),
    );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('cases API', () => {
  it('decodes optional record-edit projections and rejects broken revision chains', async () => {
    const acceptanceId = '90000000-0000-4000-8000-000000000021';
    const defendantId = '90000000-0000-4000-8000-000000000011';
    const acceptance = {
      id: acceptanceId,
      trialRoundId: '90000000-0000-4000-8000-000000000022',
      acceptedAt: '2026-10-06',
      courtCaseNo: 'CN-2',
      recordedAt: '2026-10-05T01:00:00.000Z',
      recordedByUserId: '90000000-0000-4000-8000-000000000030',
      files: [],
    };
    const recordEdits = {
      canUpdateDefendantContact: true,
      canCorrectAcceptance: true,
      defendantContacts: [
        {
          defendantId,
          contactRevision: 1,
          history: [
            {
              id: '90000000-0000-4000-8000-000000000012',
              fromRevision: 0,
              toRevision: 1,
              beforePhone: null,
              beforeAddress: null,
              phone: '123',
              address: 'Street',
              recordedAt: '2026-10-05T02:00:00.000Z',
              recordedByUserId: '90000000-0000-4000-8000-000000000030',
            },
          ],
        },
      ],
      acceptanceCorrections: [
        {
          acceptanceId,
          trialRoundId: acceptance.trialRoundId,
          acceptanceRevision: 1,
          originalAcceptedAt: '2026-10-05',
          originalCourtCaseNo: 'CN-1',
          history: [
            {
              id: '90000000-0000-4000-8000-000000000023',
              priorCorrectionId: null,
              fromRevision: 0,
              toRevision: 1,
              acceptedAt: acceptance.acceptedAt,
              courtCaseNo: acceptance.courtCaseNo,
              reason: '登记信息订正',
              recordedAt: '2026-10-05T03:00:00.000Z',
              recordedByUserId: '90000000-0000-4000-8000-000000000030',
            },
          ],
        },
      ],
    };
    const choiceId = '90000000-0000-4000-8000-000000000031';
    const trialRoundId = '90000000-0000-4000-8000-000000000032';
    const appealChoice = {
      id: choiceId,
      trialRoundId,
      judgmentId: '90000000-0000-4000-8000-000000000034',
      next: 'APPEAL',
      plaintiffRightsHolderId: '90000000-0000-4000-8000-000000000035',
      plaintiffName: '测试权利人',
      defendants: [],
      executionReadinessConfirmed: false,
      fromVersion: 1,
      toVersion: 2,
      recordedAt: '2026-10-06T03:00:00.000Z',
      recordedByUserId: '90000000-0000-4000-8000-000000000030',
    };
    const updatedRecordEdits = {
      ...recordEdits,
      canSaveSecondInstanceAcceptance: true,
      secondInstanceAcceptances: [
        {
          choiceId,
          trialRoundId,
          acceptanceRevision: 0,
          acceptedAt: null,
          courtCaseNo: null,
          canEdit: true,
          history: [],
        },
      ],
    };
    const payload = {
      ...detail,
      id: archiveCaseId,
      courtCaseNo: acceptance.courtCaseNo,
      defendants: [
        {
          id: defendantId,
          kind: 'PERSON',
          name: '被告甲',
          idNo: null,
          phone: '123',
          address: 'Street',
        },
      ],
      acceptance,
      acceptances: [acceptance],
      recordEdits: updatedRecordEdits,
      judgmentNextStep: {
        current: appealChoice,
        history: [appealChoice],
        revocations: [],
      },
      secondInstance: {
        ...detail.secondInstance,
        acceptances: [],
      },
    };
    mockJson(payload);
    await expect(getCase(archiveCaseId)).resolves.toMatchObject({
      acceptance: { acceptedAt: '2026-10-06', courtCaseNo: 'CN-2' },
      secondInstance: { acceptances: [] },
      recordEdits: {
        canSaveSecondInstanceAcceptance: true,
        secondInstanceAcceptances: [
          { choiceId, acceptanceRevision: 0, canEdit: true },
        ],
      },
    });

    const change = {
      id: '90000000-0000-4000-8000-000000000036',
      priorChangeId: null,
      fromRevision: 0,
      toRevision: 1,
      acceptedAt: '2026-10-07',
      courtCaseNo: 'CN-SECOND-1',
      reason: null,
      recordedAt: '2026-10-07T03:00:00.000Z',
      recordedByUserId: '90000000-0000-4000-8000-000000000030',
    };
    const registeredProjection = {
      choiceId,
      trialRoundId,
      acceptedAt: change.acceptedAt,
      courtCaseNo: change.courtCaseNo,
      recordedAt: change.recordedAt,
    };
    mockJson({
      ...payload,
      secondInstance: {
        ...payload.secondInstance,
        acceptances: [registeredProjection],
      },
      recordEdits: {
        ...updatedRecordEdits,
        secondInstanceAcceptances: [
          {
            choiceId,
            trialRoundId,
            acceptanceRevision: 1,
            acceptedAt: change.acceptedAt,
            courtCaseNo: change.courtCaseNo,
            canEdit: true,
            history: [change],
          },
        ],
      },
    });
    await expect(getCase(archiveCaseId)).resolves.toMatchObject({
      secondInstance: { acceptances: [registeredProjection] },
      recordEdits: {
        secondInstanceAcceptances: [
          { acceptanceRevision: 1, history: [change] },
        ],
      },
    });

    mockJson({ ...payload, recordEdits });
    const legacyResponse = await getCase(archiveCaseId);
    expect(legacyResponse.recordEdits).not.toHaveProperty(
      'canSaveSecondInstanceAcceptance',
    );
    expect(legacyResponse.recordEdits).not.toHaveProperty(
      'secondInstanceAcceptances',
    );

    mockJson({
      ...payload,
      recordEdits: {
        ...updatedRecordEdits,
        secondInstanceAcceptances: undefined,
      },
    });
    await expect(getCase(archiveCaseId)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });

    mockJson({
      ...payload,
      recordEdits: {
        ...updatedRecordEdits,
        acceptanceCorrections: [
          {
            ...updatedRecordEdits.acceptanceCorrections[0],
            acceptanceRevision: 2,
          },
        ],
      },
    });
    await expect(getCase(archiveCaseId)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('posts only the stable defendant contact fields with the original idempotency key', async () => {
    const response = {
      caseId: archiveCaseId,
      defendantId: '90000000-0000-4000-8000-000000000011',
      changeId: '90000000-0000-4000-8000-000000000012',
      contactRevision: 2,
      phone: '123',
      address: null,
      recordedAt: '2026-10-14T01:00:00.000Z',
    };
    const fetch = mockJson(response, 201);
    await expect(
      updateCaseDefendantContact(archiveCaseId, {
        defendantId: response.defendantId,
        expectedContactRevision: 1,
        idempotencyKey: 'contact-original-key',
        phone: ' 123 ',
        address: '   ',
      }),
    ).resolves.toEqual(response);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1/cases/${archiveCaseId}/defendant-contact-update`);
    expect(JSON.parse(String(init.body))).toEqual({
      defendantId: response.defendantId,
      expectedContactRevision: 1,
      idempotencyKey: 'contact-original-key',
      phone: '123',
      address: null,
    });
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe(
      'contact-original-key',
    );
  });

  it('posts a trimmed reason to the acceptance correction endpoint and validates its receipt', async () => {
    const response = {
      caseId: archiveCaseId,
      acceptanceId: '90000000-0000-4000-8000-000000000021',
      correctionId: '90000000-0000-4000-8000-000000000023',
      acceptanceRevision: 1,
      acceptedAt: '2026-10-06',
      courtCaseNo: 'CN-2',
      recordedAt: '2026-10-14T02:00:00.000Z',
    };
    const fetch = mockJson(response, 201);
    await expect(
      correctCaseAcceptance(archiveCaseId, {
        acceptanceId: response.acceptanceId,
        expectedAcceptanceRevision: 0,
        idempotencyKey: 'acceptance-correction-key',
        acceptedAt: response.acceptedAt,
        courtCaseNo: ' CN-2 ',
        reason: ' 登记信息订正 ',
      }),
    ).resolves.toEqual(response);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1/cases/${archiveCaseId}/acceptance-correction`);
    expect(JSON.parse(String(init.body))).toEqual({
      acceptanceId: response.acceptanceId,
      expectedAcceptanceRevision: 0,
      idempotencyKey: 'acceptance-correction-key',
      acceptedAt: response.acceptedAt,
      courtCaseNo: 'CN-2',
      reason: '登记信息订正',
    });
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe(
      'acceptance-correction-key',
    );
  });

  it('saves the separate second-instance acceptance record with revision-bound body and allows a justified clear', async () => {
    const input = {
      choiceId: '90000000-0000-4000-8000-000000000021',
      trialRoundId: '90000000-0000-4000-8000-000000000022',
      expectedAcceptanceRevision: 0,
      idempotencyKey: 'second-acceptance-first-key',
      acceptedAt: '2026-10-06',
      courtCaseNo: ' CN-2 ',
      reason: null,
    };
    const firstResponse = {
      caseId: archiveCaseId,
      choiceId: input.choiceId,
      trialRoundId: input.trialRoundId,
      changeId: '90000000-0000-4000-8000-000000000023',
      acceptanceRevision: 1,
      acceptedAt: input.acceptedAt,
      courtCaseNo: 'CN-2',
      recordedAt: '2026-10-14T01:00:00.000Z',
    };
    const fetch = mockJson(firstResponse, 201);
    await expect(
      saveSecondInstanceAcceptance(archiveCaseId, input),
    ).resolves.toEqual(firstResponse);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `/api/v1/cases/${archiveCaseId}/second-instance-acceptance-save`,
    );
    expect(JSON.parse(String(init.body))).toEqual({
      ...input,
      courtCaseNo: 'CN-2',
    });
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe(
      input.idempotencyKey,
    );

    const clearInput = {
      ...input,
      expectedAcceptanceRevision: 1,
      idempotencyKey: 'second-acceptance-correction-key',
      acceptedAt: null,
      courtCaseNo: null,
      reason: '更正误录的二审受理信息',
    };
    const clearResponse = {
      ...firstResponse,
      changeId: '90000000-0000-4000-8000-000000000024',
      acceptanceRevision: 2,
      acceptedAt: null,
      courtCaseNo: null,
      recordedAt: '2026-10-14T02:00:00.000Z',
    };
    const clearFetch = mockJson(clearResponse, 201);
    await expect(
      saveSecondInstanceAcceptance(archiveCaseId, clearInput),
    ).resolves.toEqual(clearResponse);
    expect(JSON.parse(String(clearFetch.mock.calls[0]?.[1]?.body))).toEqual(
      clearInput,
    );
  });

  it('strictly decodes execution submission history and execution-only timestamps', async () => {
    const empty = {
      ...detail,
      canSubmitExecution: true,
      executionSubmission: {
        current: null,
        submissions: [],
        availableFiles: [],
      },
      canConfirmExecution: false,
      canMailExecution: false,
      canSubmitExecutionFiling: false,
      canFinishExecution: false,
      canRecordClosure: false,
      canCorrectClosure: false,
      canArchive: false,
      canCorrectArchive: false,
      executionConfirmation: null,
      executionMailing: null,
      executionFiling: null,
      executionFinish: null,
      closure: null,
      archive: null,
    };
    mockJson(empty);
    await expect(getCase('case-1')).resolves.toMatchObject({
      canSubmitExecution: true,
      executionSubmission: {
        current: null,
        submissions: [],
        availableFiles: [],
      },
    });

    const file = {
      materialId: '80000000-0000-4000-8000-000000000101',
      contentVersionId: '80000000-0000-4000-8000-000000000102',
      originalFilename: '执行申请书.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      uploadedAt: '2026-10-11T08:30:00.000Z',
    };
    const submission = {
      id: '80000000-0000-4000-8000-000000000103',
      trialRoundId: '80000000-0000-4000-8000-000000000104',
      judgmentNextStepId: '80000000-0000-4000-8000-000000000105',
      secondInstanceResultId: null,
      priorSubmissionId: null,
      changeReason: null,
      fromVersion: 14,
      toVersion: 15,
      submittedAt: '2026-10-11T08:31:00.000Z',
      files: [file],
    };
    const populated = {
      ...empty,
      stage: 'WAITING_EXECUTION_CONFIRMATION',
      version: 15,
      canConfirmExecution: true,
      canMailExecution: false,
      canSubmitExecutionFiling: false,
      canFinishExecution: false,
      canRecordClosure: false,
      canCorrectClosure: false,
      canArchive: false,
      canCorrectArchive: false,
      executionSubmission: {
        current: submission,
        submissions: [submission],
        availableFiles: [],
      },
    };
    mockJson(populated);
    await expect(getCase('case-1')).resolves.toMatchObject({
      executionSubmission: { current: { files: [file] } },
    });

    const confirmed = {
      ...populated,
      stage: 'WAITING_EXECUTION_STAMP',
      canSubmitExecution: false,
      canConfirmExecution: false,
      canMailExecution: false,
      canSubmitExecutionFiling: false,
      canFinishExecution: false,
      canRecordClosure: false,
      canCorrectClosure: false,
      canArchive: false,
      canCorrectArchive: false,
      executionConfirmation: {
        id: '80000000-0000-4000-8000-000000000106',
        submissionId: submission.id,
        confirmedAt: '2026-10-11T08:32:00.000Z',
        confirmedByUserId: 'user-1',
        files: [file],
      },
    };
    mockJson(confirmed);
    await expect(getCase('case-1')).resolves.toMatchObject({
      stage: 'WAITING_EXECUTION_STAMP',
      executionConfirmation: { files: [file] },
    });

    const mailed = {
      ...confirmed,
      stage: 'WAITING_EXECUTION_FILING',
      version: 17,
      canMailExecution: false,
      executionMailing: {
        id: '80000000-0000-4000-8000-000000000171',
        confirmationId: confirmed.executionConfirmation.id,
        mailedAt: '2026-10-11',
        recordedAt: '2026-10-11T09:00:00.000Z',
        files: [
          {
            materialId: file.materialId,
            contentVersionId: file.contentVersionId,
            originalFilename: file.originalFilename,
            mimeType: file.mimeType,
          },
        ],
      },
    };
    mockJson(mailed);
    await expect(getCase('case-1')).resolves.toMatchObject({
      executionMailing: { confirmationId: confirmed.executionConfirmation.id },
    });
    mockJson({
      ...mailed,
      executionMailing: {
        ...mailed.executionMailing,
        confirmationId: '80000000-0000-4000-8000-000000000199',
      },
    });
    await expect(getCase('case-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });

    mockJson({
      ...populated,
      executionSubmission: {
        ...populated.executionSubmission,
        current: {
          ...submission,
          files: [{ ...file, uploadedAt: 'yesterday' }],
        },
        submissions: [
          { ...submission, files: [{ ...file, uploadedAt: 'yesterday' }] },
        ],
      },
    });
    await expect(getCase('case-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('confirms an exact execution submission using its expected version and idempotency key', async () => {
    const input = {
      expectedVersion: 15,
      idempotencyKey: '80000000-0000-4000-8000-000000000111',
      expectedSubmissionId: '80000000-0000-4000-8000-000000000103',
    };
    const fetchMock = mockJson({
      id: 'case-1',
      confirmationId: '80000000-0000-4000-8000-000000000106',
      submissionId: input.expectedSubmissionId,
      stage: 'WAITING_EXECUTION_STAMP',
      version: 16,
      confirmedAt: '2026-10-11T08:32:00.000Z',
    });
    await expect(confirmCaseExecution('case-1', input)).resolves.toMatchObject({
      stage: 'WAITING_EXECUTION_STAMP',
      submissionId: input.expectedSubmissionId,
      version: 16,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/cases/case-1/execution-confirm',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(input),
      }),
    );
  });

  it('mails confirmed execution with a strict anchored receipt and exact transition', async () => {
    const input = {
      expectedVersion: 16,
      idempotencyKey: '80000000-0000-4000-8000-000000000151',
      expectedConfirmationId: '80000000-0000-4000-8000-000000000106',
      mailedAt: '2026-10-11',
      mailReceiptContentVersionIds: ['80000000-0000-4000-8000-000000000152'],
    };
    const fetchMock = mockJson({
      id: 'case-1',
      mailingId: '80000000-0000-4000-8000-000000000153',
      confirmationId: input.expectedConfirmationId,
      stage: 'WAITING_EXECUTION_FILING',
      version: 17,
      mailedAt: input.mailedAt,
      recordedAt: '2026-10-11T09:00:00.000Z',
    });
    await expect(
      mailCaseExecution('case-1', input, 'lawyer'),
    ).resolves.toMatchObject({
      mailingId: '80000000-0000-4000-8000-000000000153',
      confirmationId: input.expectedConfirmationId,
      stage: 'WAITING_EXECUTION_FILING',
      version: 17,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/lawyer/cases/case-1/execution-mail',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Idempotency-Key': input.idempotencyKey,
        }),
        body: JSON.stringify(input),
      }),
    );

    mockJson({
      id: 'case-1',
      mailingId: '80000000-0000-4000-8000-000000000153',
      confirmationId: '80000000-0000-4000-8000-000000000154',
      stage: 'WAITING_EXECUTION_FILING',
      version: 17,
      mailedAt: input.mailedAt,
      recordedAt: '2026-10-11T09:00:00.000Z',
    });
    await expect(mailCaseExecution('case-1', input)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });

    const futureFetch = mockJson({});
    await expect(
      mailCaseExecution('case-1', { ...input, mailedAt: '2099-01-01' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(futureFetch).not.toHaveBeenCalled();
  });

  it('submits execution filing with the exact mailing anchor and transition', async () => {
    const input = {
      expectedVersion: 17,
      idempotencyKey: '80000000-0000-4000-8000-000000000161',
      expectedMailingId: '80000000-0000-4000-8000-000000000153',
      submittedAt: '2026-10-11',
      executionFilingProofContentVersionIds: [
        '80000000-0000-4000-8000-000000000162',
      ],
    };
    const fetchMock = mockJson({
      id: 'case-1',
      filingId: '80000000-0000-4000-8000-000000000163',
      mailingId: input.expectedMailingId,
      stage: 'EXECUTING',
      version: 18,
      submittedAt: input.submittedAt,
      recordedAt: '2026-10-11T10:00:00.000Z',
    });
    await expect(
      submitCaseExecutionFiling('case-1', input, 'lawyer'),
    ).resolves.toMatchObject({
      filingId: '80000000-0000-4000-8000-000000000163',
      mailingId: input.expectedMailingId,
      stage: 'EXECUTING',
      version: 18,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/lawyer/cases/case-1/execution-filing-submit',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(input),
      }),
    );
    mockJson({
      id: 'case-1',
      filingId: '80000000-0000-4000-8000-000000000163',
      mailingId: '80000000-0000-4000-8000-000000000164',
      stage: 'EXECUTING',
      version: 18,
      submittedAt: input.submittedAt,
      recordedAt: '2026-10-11T10:00:00.000Z',
    });
    await expect(
      submitCaseExecutionFiling('case-1', input),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('submits execution with explicit nullable anchors and preserves exact retry inputs', async () => {
    const call = Reflect.get(casesApi, 'submitExecution') as
      | ((
          id: string,
          input: SubmitExecutionInput,
          audience?: 'internal' | 'lawyer',
        ) => Promise<SubmitExecutionResult>)
      | undefined;
    expect(call).toBeTypeOf('function');
    if (!call) return;
    const input = {
      expectedVersion: 14,
      idempotencyKey: '80000000-0000-4000-8000-000000000111',
      trialRoundId: '80000000-0000-4000-8000-000000000104',
      judgmentNextStepId: '80000000-0000-4000-8000-000000000105',
      secondInstanceResultId: null,
      expectedSubmissionId: null,
      executionApplicationContentVersionIds: [
        '80000000-0000-4000-8000-000000000102',
      ],
    };
    const fetchMock = mockJson({
      id: 'case-1',
      submissionId: '80000000-0000-4000-8000-000000000103',
      stage: 'WAITING_EXECUTION_CONFIRMATION',
      version: 15,
      submittedAt: '2026-10-11T08:31:00.000Z',
    });
    await expect(call('case-1', input, 'lawyer')).resolves.toMatchObject({
      submissionId: '80000000-0000-4000-8000-000000000103',
      version: 15,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/lawyer/cases/case-1/execution-submit',
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual(input);

    const changedInput = {
      ...input,
      expectedVersion: 15,
      expectedSubmissionId: '80000000-0000-4000-8000-000000000103',
      changeReason: '补充执行申请材料',
    };
    const retryMock = mockJson({
      id: 'case-1',
      submissionId: '80000000-0000-4000-8000-000000000112',
      stage: 'WAITING_EXECUTION_CONFIRMATION',
      version: 16,
      submittedAt: '2026-10-11T08:32:00.000Z',
    });
    await expect(call('case-1', changedInput)).resolves.toMatchObject({
      version: 16,
    });
    expect(JSON.parse(String(retryMock.mock.calls[0]?.[1]?.body))).toEqual(
      changedInput,
    );
  });

  it.each(['COMPLAINT_PREPARATION', 'EXECUTION_PREPARATION'] as const)(
    'sends %s group filters without a synthetic count key',
    async (group) => {
      const counts = {
        PENDING_MATCH: 0,
        WAITING_COMPLAINT: 0,
        WAITING_COMPLAINT_CONFIRMATION: 0,
        WAITING_COMPLAINT_STAMP: 0,
        WAITING_FILING: 0,
        WAITING_FORMAL_ACCEPTANCE: 0,
        WAITING_HEARING: 0,
        WAITING_JUDGMENT: 0,
        SECOND_INSTANCE: 0,
        WAITING_EXECUTION_DOCUMENTS: 2,
        WAITING_EXECUTION_CONFIRMATION: 3,
        WAITING_EXECUTION_STAMP: 0,
        WAITING_EXECUTION_FILING: 0,
        EXECUTING: 0,
        WAITING_ARCHIVE: 0,
        ARCHIVED: 0,
      };
      const fetchMock = mockJson({
        items: [],
        total: 5,
        page: 1,
        pageSize: 20,
        counts,
      });
      const options = {
        view: 'department',
        stageGroup: group,
      } as Parameters<typeof listCases>[2];
      await listCases(1, 20, options);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        `/api/v1/cases?page=1&pageSize=20&view=department&stageGroup=${group}`,
      );

      const lawyerFetch = mockJson({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        counts,
      });
      const lawyerList = Reflect.get(casesApi, 'listLawyerCases') as
        | ((
            page: number,
            pageSize: number,
            stage?: string,
            options?: { stageGroup?: string },
          ) => Promise<unknown>)
        | undefined;
      expect(lawyerList).toBeTypeOf('function');
      if (!lawyerList) return;
      await lawyerList(1, 20, undefined, {
        stageGroup: group,
      });
      expect(lawyerFetch.mock.calls[0]?.[0]).toBe(
        `/api/v1/lawyer/cases?page=1&pageSize=20&stageGroup=${group}`,
      );
      expect(Object.keys(counts)).not.toContain('EXECUTION_PREPARATION');
    },
  );

  it('decodes nullable REMAND amounts in current and mixed history without admitting internal fields to lawyer', async () => {
    const id = (value: number) =>
      `70000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
    const file = {
      materialId: id(20),
      contentVersionId: id(21),
      originalFilename: '发回裁定.pdf',
      mimeType: 'application/pdf',
    };
    const remand = {
      id: id(5),
      trialRoundId: id(1),
      choiceId: id(3),
      judgmentId: id(4),
      progressId: null,
      result: 'REMAND',
      resultReceivedAt: '2026-10-10',
      judgmentAmountState: null,
      judgmentAmount: null,
      paidLitigationFeeState: 'PENDING',
      paidLitigationFee: null,
      fromVersion: 12,
      toVersion: 13,
      recordedAt: '2026-10-10T03:00:00Z',
      recordedByUserId: id(9),
      files: [file],
      childTrialRoundId: id(2),
      revocationId: null,
    };
    const priorChange = {
      ...remand,
      id: id(6),
      result: 'CHANGE',
      judgmentAmountState: 'KNOWN',
      judgmentAmount: '0.00',
      childTrialRoundId: null,
      revocationId: id(7),
      fromVersion: 10,
      toVersion: 11,
    };
    const secondInstance = {
      currentTrialRoundId: id(2),
      currentProgress: null,
      currentResult: remand,
      rounds: [
        { id: id(1), sequence: 1, sourceResultId: null, revokedAt: null },
        { id: id(2), sequence: 2, sourceResultId: id(5), revokedAt: null },
      ],
      progresses: [],
      results: [priorChange, remand],
      revocations: [
        {
          id: id(7),
          resultId: id(6),
          fromVersion: 11,
          toVersion: 12,
          recordedAt: '2026-10-10T02:00:00Z',
          reason: '改判误录',
          recordedByUserId: id(9),
        },
      ],
    };
    const remandDetail = {
      ...detail,
      stage: 'WAITING_FORMAL_ACCEPTANCE',
      version: 13,
      secondInstance,
    };
    mockJson(remandDetail);
    await expect(getCase('case-1')).resolves.toMatchObject({
      secondInstance: {
        currentResult: { result: 'REMAND', judgmentAmountState: null },
        results: [
          { result: 'CHANGE', judgmentAmount: '0.00' },
          { result: 'REMAND', judgmentAmount: null },
        ],
      },
    });
    const lawyerBase: Record<string, unknown> = { ...remandDetail };
    for (const key of [
      'owner',
      'department',
      'fees',
      'sourceLead',
      'sourceNotaryMatter',
    ])
      delete lawyerBase[key];
    const lawyerRemand: Record<string, unknown> = { ...remand };
    delete lawyerRemand.recordedByUserId;
    const lawyerChange: Record<string, unknown> = { ...priorChange };
    delete lawyerChange.recordedByUserId;
    const lawyerRevoke: Record<string, unknown> = {
      ...secondInstance.revocations[0],
    };
    delete lawyerRevoke.reason;
    delete lawyerRevoke.recordedByUserId;
    const lawyerPayload = {
      ...lawyerBase,
      canMatch: false,
      canCorrectHearing: false,
      canCorrectJudgment: false,
      canRevokeJudgmentNextStep: false,
      canRevokeSecondInstanceResult: false,
      canSubmitExecution: false,
      secondInstance: {
        ...secondInstance,
        currentResult: lawyerRemand,
        results: [lawyerChange, lawyerRemand],
        revocations: [lawyerRevoke],
      },
    };
    const readLawyer = Reflect.get(casesApi, 'getLawyerCase') as
      ((id: string) => Promise<Record<string, unknown>>) | undefined;
    expect(readLawyer).toBeTypeOf('function');
    if (!readLawyer) return;
    mockJson(lawyerPayload);
    await expect(readLawyer('case-1')).resolves.toMatchObject({
      secondInstance: { currentResult: { result: 'REMAND' } },
    });
    mockJson({
      ...lawyerPayload,
      secondInstance: {
        ...lawyerPayload.secondInstance,
        results: [lawyerChange, remand],
      },
    });
    await expect(readLawyer('case-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects REMAND fake amounts and missing CHANGE or AFFIRM amounts', async () => {
    const remand = {
      id: '70000000-0000-4000-8000-000000000005',
      trialRoundId: '70000000-0000-4000-8000-000000000001',
      choiceId: '70000000-0000-4000-8000-000000000003',
      judgmentId: '70000000-0000-4000-8000-000000000004',
      progressId: null,
      result: 'REMAND',
      resultReceivedAt: '2026-10-10',
      judgmentAmountState: null,
      judgmentAmount: null,
      paidLitigationFeeState: 'KNOWN',
      paidLitigationFee: '0.00',
      fromVersion: 12,
      toVersion: 13,
      recordedAt: '2026-10-10T03:00:00Z',
      recordedByUserId: '70000000-0000-4000-8000-000000000009',
      files: [
        {
          materialId: 'material-1',
          contentVersionId: 'version-1',
          originalFilename: '裁定.pdf',
          mimeType: 'application/pdf',
        },
      ],
      childTrialRoundId: '70000000-0000-4000-8000-000000000002',
      revocationId: null,
    };
    for (const invalid of [
      { ...remand, judgmentAmountState: 'PENDING' },
      { ...remand, judgmentAmountState: 'KNOWN', judgmentAmount: '0.00' },
      { ...remand, result: 'CHANGE', childTrialRoundId: null },
      { ...remand, result: 'AFFIRM', childTrialRoundId: null },
      { ...remand, judgmentAmount: '0.00' },
      { ...remand, extra: true },
    ]) {
      mockJson({
        ...detail,
        stage: 'WAITING_FORMAL_ACCEPTANCE',
        secondInstance: {
          ...detail.secondInstance,
          currentResult: invalid,
          results: [invalid],
        },
      });
      await expect(getCase('case-1')).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
  });

  it('posts second-instance progress with explicit nulls and the selected round', async () => {
    const fetch = mockJson({
      id: 'case-1',
      stage: 'SECOND_INSTANCE',
      version: 4,
      currentTrialRoundId: '70000000-0000-4000-8000-000000000001',
      progressId: '70000000-0000-4000-8000-000000000002',
      resultId: null,
      recordedAt: '2026-10-10T03:00:00Z',
    });
    await saveSecondInstance(
      'case-1',
      {
        expectedVersion: 3,
        idempotencyKey: 'save-key',
        trialRoundId: '70000000-0000-4000-8000-000000000001',
        choiceId: '70000000-0000-4000-8000-000000000003',
        expectedProgressId: null,
        progress: {
          hearingAt: null,
          hearingPlace: null,
          judgeName: null,
          documentContentVersionIds: [],
          serviceContentVersionIds: [],
        },
      },
      'lawyer',
    );
    expect(fetch.mock.calls[0]?.[0]).toBe(
      '/api/v1/lawyer/cases/case-1/second-instance-save',
    );
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      'Idempotency-Key': 'save-key',
    });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      expectedVersion: 3,
      idempotencyKey: 'save-key',
      trialRoundId: '70000000-0000-4000-8000-000000000001',
      choiceId: '70000000-0000-4000-8000-000000000003',
      expectedProgressId: null,
      progress: {
        hearingAt: null,
        hearingPlace: null,
        judgeName: null,
        documentContentVersionIds: [],
        serviceContentVersionIds: [],
      },
    });
  });

  it('accepts and replays an unchanged empty SAVE receipt at the original version', async () => {
    const roundId = '70000000-0000-4000-8000-000000000001';
    const input = {
      expectedVersion: 3,
      idempotencyKey: 'empty-save-key',
      trialRoundId: roundId,
      choiceId: '70000000-0000-4000-8000-000000000003',
      expectedProgressId: null,
      progress: {
        hearingAt: null,
        hearingPlace: null,
        judgeName: null,
        documentContentVersionIds: [],
        serviceContentVersionIds: [],
      },
    };
    const receipt = {
      id: 'case-1',
      stage: 'SECOND_INSTANCE',
      version: 3,
      currentTrialRoundId: roundId,
      progressId: null,
      resultId: null,
      recordedAt: '2026-10-10T03:00:00Z',
    };
    const fetch = mockJson(receipt, 201);

    expect(await saveSecondInstance('case-1', input)).toEqual(receipt);
    expect(await saveSecondInstance('case-1', input)).toEqual(receipt);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(fetch.mock.calls[1]?.[1]?.body);
    expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({
      'Idempotency-Key': input.idempotencyKey,
    });
  });

  it('accepts unchanged existing SAVE only at +0 and new progress only at +1', async () => {
    const roundId = '70000000-0000-4000-8000-000000000001';
    const oldProgressId = '70000000-0000-4000-8000-000000000002';
    const newProgressId = '70000000-0000-4000-8000-000000000007';
    const input = {
      expectedVersion: 3,
      idempotencyKey: 'anchored-save-key',
      trialRoundId: roundId,
      choiceId: '70000000-0000-4000-8000-000000000003',
      expectedProgressId: oldProgressId,
      progress: {
        hearingAt: '2026-10-10',
        hearingPlace: null,
        judgeName: null,
        documentContentVersionIds: [],
        serviceContentVersionIds: [],
      },
    };
    const receipt = {
      id: 'case-1',
      stage: 'SECOND_INSTANCE',
      version: 3,
      currentTrialRoundId: roundId,
      progressId: oldProgressId,
      resultId: null,
      recordedAt: '2026-10-10T03:00:00Z',
    };
    mockJson(receipt, 201);
    expect(await saveSecondInstance('case-1', input)).toEqual(receipt);
    mockJson({ ...receipt, version: 4, progressId: newProgressId }, 201);
    await expect(saveSecondInstance('case-1', input)).resolves.toMatchObject({
      version: 4,
      progressId: newProgressId,
    });
    for (const invalid of [
      { ...receipt, version: 4 },
      { ...receipt, progressId: newProgressId },
      { ...receipt, version: 5, progressId: newProgressId },
      { ...receipt, progressId: null },
    ]) {
      mockJson(invalid, 201);
      await expect(saveSecondInstance('case-1', input)).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
  });

  it('accepts and replays a RESULT receipt at +2 only when it creates progress', async () => {
    const roundId = '70000000-0000-4000-8000-000000000001';
    const progressId = '70000000-0000-4000-8000-000000000002';
    const input = {
      expectedVersion: 3,
      idempotencyKey: 'result-with-progress',
      trialRoundId: roundId,
      choiceId: '70000000-0000-4000-8000-000000000003',
      expectedProgressId: null,
      result: 'AFFIRM' as const,
      resultReceivedAt: '2026-10-10',
      judgmentContentVersionIds: ['70000000-0000-4000-8000-000000000005'],
      paidLitigationFee: { state: 'KNOWN' as const, amount: '0' },
      progress: {
        hearingAt: '2026-10-10',
        hearingPlace: null,
        judgeName: null,
        documentContentVersionIds: [],
        serviceContentVersionIds: [],
      },
    };
    const receipt = {
      id: 'case-1',
      stage: 'WAITING_EXECUTION_DOCUMENTS',
      version: 5,
      currentTrialRoundId: roundId,
      progressId,
      resultId: '70000000-0000-4000-8000-000000000004',
      recordedAt: '2026-10-10T03:00:00Z',
    };
    const fetch = mockJson(receipt, 201);
    expect(await registerSecondInstanceResult('case-1', input)).toEqual(
      receipt,
    );
    expect(await registerSecondInstanceResult('case-1', input)).toEqual(
      receipt,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(fetch.mock.calls[1]?.[1]?.body);
    expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({
      'Idempotency-Key': input.idempotencyKey,
    });
    for (const invalid of [
      { ...receipt, version: 4 },
      { ...receipt, version: 3 },
      { ...receipt, progressId: null },
    ]) {
      mockJson(invalid, 201);
      await expect(
        registerSecondInstanceResult('case-1', input),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });

  it('accepts RESULT at +1 only when it reuses the expected progress anchor', async () => {
    const roundId = '70000000-0000-4000-8000-000000000001';
    const progressId = '70000000-0000-4000-8000-000000000002';
    const input = {
      expectedVersion: 3,
      idempotencyKey: 'result-unchanged-progress',
      trialRoundId: roundId,
      choiceId: '70000000-0000-4000-8000-000000000003',
      expectedProgressId: progressId,
      result: 'AFFIRM' as const,
      resultReceivedAt: '2026-10-10',
      judgmentContentVersionIds: ['70000000-0000-4000-8000-000000000005'],
      paidLitigationFee: { state: 'KNOWN' as const, amount: '0' },
      progress: {
        hearingAt: null,
        hearingPlace: null,
        judgeName: null,
        documentContentVersionIds: [],
        serviceContentVersionIds: [],
      },
    };
    const receipt = {
      id: 'case-1',
      stage: 'WAITING_EXECUTION_DOCUMENTS',
      version: 4,
      currentTrialRoundId: roundId,
      progressId,
      resultId: '70000000-0000-4000-8000-000000000004',
      recordedAt: '2026-10-10T03:00:00Z',
    };
    mockJson(receipt, 201);
    expect(await registerSecondInstanceResult('case-1', input)).toEqual(
      receipt,
    );
    for (const invalid of [
      { ...receipt, version: 5 },
      { ...receipt, version: 3 },
      { ...receipt, progressId: null },
      {
        ...receipt,
        version: 4,
        progressId: '70000000-0000-4000-8000-000000000007',
      },
    ]) {
      mockJson(invalid, 201);
      await expect(
        registerSecondInstanceResult('case-1', input),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });

  it('registers an explicit result with frozen files and fee state', async () => {
    const fetch = mockJson({
      id: 'case-1',
      stage: 'WAITING_EXECUTION_DOCUMENTS',
      version: 4,
      currentTrialRoundId: '70000000-0000-4000-8000-000000000001',
      progressId: null,
      resultId: '70000000-0000-4000-8000-000000000004',
      recordedAt: '2026-10-10T03:00:00Z',
    });
    await registerSecondInstanceResult('case-1', {
      expectedVersion: 3,
      idempotencyKey: 'result-key',
      trialRoundId: '70000000-0000-4000-8000-000000000001',
      choiceId: '70000000-0000-4000-8000-000000000003',
      expectedProgressId: null,
      result: 'AFFIRM',
      resultReceivedAt: '2026-10-10',
      judgmentContentVersionIds: ['70000000-0000-4000-8000-000000000005'],
      paidLitigationFee: { state: 'KNOWN', amount: '0' },
      progress: {
        hearingAt: null,
        hearingPlace: null,
        judgeName: null,
        documentContentVersionIds: [],
        serviceContentVersionIds: [],
      },
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      '/api/v1/cases/case-1/second-instance-result',
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      expectedProgressId: null,
      result: 'AFFIRM',
      paidLitigationFee: { state: 'KNOWN', amount: '0' },
      judgmentContentVersionIds: ['70000000-0000-4000-8000-000000000005'],
    });
  });

  it('keeps the exact current progress anchor on a result and rejects a missing anchor', async () => {
    const fetch = mockJson({
      id: 'case-1',
      stage: 'WAITING_EXECUTION_DOCUMENTS',
      version: 4,
      currentTrialRoundId: '70000000-0000-4000-8000-000000000001',
      progressId: '70000000-0000-4000-8000-000000000006',
      resultId: '70000000-0000-4000-8000-000000000004',
      recordedAt: '2026-10-10T03:00:00Z',
    });
    const input = {
      expectedVersion: 3,
      idempotencyKey: 'result-current-progress',
      trialRoundId: '70000000-0000-4000-8000-000000000001',
      choiceId: '70000000-0000-4000-8000-000000000003',
      expectedProgressId: '70000000-0000-4000-8000-000000000006',
      result: 'AFFIRM' as const,
      resultReceivedAt: '2026-10-10',
      judgmentContentVersionIds: ['70000000-0000-4000-8000-000000000005'],
      paidLitigationFee: { state: 'KNOWN' as const, amount: '0' },
      progress: {
        hearingAt: null,
        hearingPlace: null,
        judgeName: null,
        documentContentVersionIds: [],
        serviceContentVersionIds: [],
      },
    };
    await registerSecondInstanceResult('case-1', input);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toHaveProperty(
      'expectedProgressId',
      input.expectedProgressId,
    );
    await expect(
      registerSecondInstanceResult('case-1', {
        ...input,
        expectedProgressId: undefined as unknown as string | null,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('exposes result revocation only through the internal route', async () => {
    const fetch = mockJson({
      id: 'case-1',
      stage: 'SECOND_INSTANCE',
      version: 5,
      currentTrialRoundId: '70000000-0000-4000-8000-000000000001',
      progressId: null,
      resultId: null,
      revocationId: '70000000-0000-4000-8000-000000000006',
      recordedAt: '2026-10-10T03:00:00Z',
    });
    await revokeSecondInstanceResult('case-1', {
      expectedVersion: 4,
      idempotencyKey: 'revoke-key',
      trialRoundId: '70000000-0000-4000-8000-000000000001',
      resultId: '70000000-0000-4000-8000-000000000004',
      reason: '复核后确认登记有误',
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      '/api/v1/cases/case-1/second-instance-result-revoke',
    );
  });

  it('posts the exact execution choice and validates its stage transition', async () => {
    const fetch = mockJson({
      id: 'case-1',
      stage: 'WAITING_EXECUTION_DOCUMENTS',
      version: 4,
      choiceId: '70000000-0000-4000-8000-000000000003',
      judgmentId: '70000000-0000-4000-8000-000000000002',
      recordedAt: '2026-10-10T03:00:00Z',
    });
    await chooseCaseJudgmentNextStep('case-1', {
      expectedVersion: 3,
      idempotencyKey: 'choice-key',
      judgmentId: '70000000-0000-4000-8000-000000000002',
      next: 'EXECUTION',
      executionReadinessConfirmed: true,
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      '/api/v1/cases/case-1/judgment-next-step',
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      expectedVersion: 3,
      idempotencyKey: 'choice-key',
      judgmentId: '70000000-0000-4000-8000-000000000002',
      next: 'EXECUTION',
      executionReadinessConfirmed: true,
    });
  });

  it('routes lawyer choices to the lawyer endpoint and rejects illegal branches', async () => {
    const fetch = mockJson({
      id: 'case-1',
      stage: 'SECOND_INSTANCE',
      version: 4,
      choiceId: '70000000-0000-4000-8000-000000000003',
      judgmentId: '70000000-0000-4000-8000-000000000002',
      recordedAt: '2026-10-10T03:00:00Z',
    });
    const valid = {
      expectedVersion: 3,
      idempotencyKey: 'appeal-key',
      judgmentId: '70000000-0000-4000-8000-000000000002',
      next: 'APPEAL' as const,
      plaintiffAppeals: true,
      defendantIds: ['70000000-0000-4000-8000-000000000004'],
    };
    await chooseCaseJudgmentNextStep('case-1', valid, 'lawyer');
    expect(fetch.mock.calls[0]?.[0]).toBe(
      '/api/v1/lawyer/cases/case-1/judgment-next-step',
    );
    await expect(
      chooseCaseJudgmentNextStep('case-1', {
        ...valid,
        plaintiffAppeals: false,
        defendantIds: [],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('posts only an internal revocation and validates its exact target', async () => {
    const fetch = mockJson({
      id: 'case-1',
      stage: 'WAITING_JUDGMENT',
      version: 5,
      choiceId: '70000000-0000-4000-8000-000000000003',
      revocationId: '70000000-0000-4000-8000-000000000005',
      judgmentId: '70000000-0000-4000-8000-000000000002',
      recordedAt: '2026-10-10T03:00:00Z',
    });
    await revokeCaseJudgmentNextStep('case-1', {
      expectedVersion: 4,
      idempotencyKey: 'revoke-key',
      choiceId: '70000000-0000-4000-8000-000000000003',
      reason: '复核后确认误选',
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      '/api/v1/cases/case-1/judgment-next-step-revoke',
    );
  });

  it('models the nullable internal REGISTER reason exactly', () => {
    expectTypeOf<CaseJudgmentFact['reason']>().toEqualTypeOf<
      string | null | undefined
    >();
  });

  it('decodes judgment facts with explicit pending and known-zero amounts', async () => {
    const file = {
      materialId: '70000000-0000-4000-8000-000000000001',
      contentVersionId: '70000000-0000-4000-8000-000000000002',
      originalFilename: '判决书.pdf',
      mimeType: 'application/pdf',
    };
    const fact = {
      id: '70000000-0000-4000-8000-000000000003',
      trialRoundId: '70000000-0000-4000-8000-000000000099',
      kind: 'REGISTER',
      priorFactId: null,
      judgmentReceivedAt: '2026-10-07',
      judgmentAmountState: 'KNOWN',
      judgmentAmount: '0.00',
      paidLitigationFeeState: 'PENDING',
      paidLitigationFee: null,
      fromVersion: 7,
      toVersion: 8,
      recordedAt: '2026-10-07T01:00:00.000Z',
      reason: null,
      recordedByUserId: '70000000-0000-4000-8000-000000000004',
      files: [file],
    };
    mockJson({
      ...detail,
      stage: 'WAITING_JUDGMENT',
      canRegisterJudgment: false,
      canCorrectJudgment: true,
      judgment: { current: fact, history: [fact], availableFiles: [] },
    });

    await expect(getCase('case-1')).resolves.toMatchObject({
      canCorrectJudgment: true,
      judgment: {
        current: {
          judgmentAmountState: 'KNOWN',
          judgmentAmount: '0.00',
          paidLitigationFeeState: 'PENDING',
          paidLitigationFee: null,
        },
        history: [
          {
            kind: 'REGISTER',
            files: [{ contentVersionId: file.contentVersionId }],
          },
        ],
      },
    });
  });

  it('requires internal correction reasons but accepts redacted lawyer corrections', async () => {
    const file = detail.certificate.files[0]!;
    const registered = {
      id: '70000000-0000-4000-8000-000000000003',
      trialRoundId: '70000000-0000-4000-8000-000000000099',
      kind: 'REGISTER',
      priorFactId: null,
      judgmentReceivedAt: '2026-10-07',
      judgmentAmountState: 'KNOWN',
      judgmentAmount: '0.00',
      paidLitigationFeeState: 'PENDING',
      paidLitigationFee: null,
      fromVersion: 7,
      toVersion: 8,
      recordedAt: '2026-10-07T01:00:00.000Z',
      reason: null,
      recordedByUserId: '70000000-0000-4000-8000-000000000004',
      files: [file],
    };
    const internalCorrection = {
      ...registered,
      id: '70000000-0000-4000-8000-000000000005',
      kind: 'CORRECT',
      priorFactId: registered.id,
      fromVersion: 8,
      toVersion: 9,
      reason: '判决金额按补正文书更正',
    };
    const internalResponse = {
      ...detail,
      stage: 'WAITING_JUDGMENT',
      version: 9,
      judgment: {
        current: internalCorrection,
        history: [registered, internalCorrection],
        availableFiles: [file],
      },
    };
    mockJson(internalResponse);
    await expect(getCase('case-1')).resolves.toMatchObject({
      judgment: { current: { reason: '判决金额按补正文书更正' } },
    });

    mockJson({
      ...internalResponse,
      judgment: {
        ...internalResponse.judgment,
        current: { ...internalCorrection, reason: null },
      },
    });
    await expect(getCase('case-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });

    const lawyerRegistered: Record<string, unknown> = {
      ...registered,
    };
    delete lawyerRegistered.reason;
    delete lawyerRegistered.recordedByUserId;
    const lawyerCorrection: Record<string, unknown> = {
      ...internalCorrection,
    };
    delete lawyerCorrection.reason;
    delete lawyerCorrection.recordedByUserId;
    const lawyerPayload = {
      id: 'case-1',
      businessNo: 'CA-1',
      stage: 'WAITING_JUDGMENT',
      version: 9,
      canMatch: false,
      canSubmitComplaint: false,
      canConfirmComplaint: false,
      canMailComplaint: false,
      canSubmitFiling: false,
      canRegisterAcceptance: false,
      canUploadAcceptanceMaterials: false,
      canScheduleHearing: false,
      canCorrectHearing: false,
      canRegisterJudgment: false,
      canCorrectJudgment: false,
      canChooseJudgmentNextStep: false,
      canRevokeJudgmentNextStep: false,
      canSaveSecondInstance: false,
      canRegisterSecondInstanceResult: false,
      canRevokeSecondInstanceResult: false,
      canSubmitExecution: false,
      executionSubmission: {
        current: null,
        submissions: [],
        availableFiles: [],
      },
      canConfirmExecution: false,
      canMailExecution: false,
      canSubmitExecutionFiling: false,
      canFinishExecution: false,
      canRecordClosure: false,
      canCorrectClosure: false,
      canArchive: false,
      canCorrectArchive: false,
      executionConfirmation: null,
      executionMailing: null,
      executionFiling: null,
      executionFinish: null,
      closure: null,
      archive: null,
      createdAt: '2026-09-28T00:00:00.000Z',
      matchedAt: null,
      matchedOn: null,
      defendants: detail.defendants,
      lawyers: detail.lawyers,
      customer: detail.customer,
      rightsHolder: detail.rightsHolder,
      certificate: detail.certificate,
      complaint: null,
      complaintConfirmation: null,
      complaintMailing: null,
      filingSubmission: null,
      courtCaseNo: null,
      acceptance: null,
      acceptanceMaterials: detail.acceptanceMaterials,
      hearing: detail.hearing,
      judgment: {
        current: lawyerCorrection,
        history: [lawyerRegistered, lawyerCorrection],
        availableFiles: [file],
      },
      judgmentNextStep: { current: null, history: [], revocations: [] },
      acceptances: [],
      secondInstance: {
        currentTrialRoundId: null,
        currentProgress: null,
        currentResult: null,
        rounds: [],
        progresses: [],
        results: [],
        revocations: [],
      },
    };
    const readLawyer = Reflect.get(casesApi, 'getLawyerCase') as
      ((id: string) => Promise<Record<string, unknown>>) | undefined;
    expect(readLawyer).toBeTypeOf('function');
    if (!readLawyer) return;
    mockJson(lawyerPayload);
    await expect(readLawyer('case-1')).resolves.toMatchObject({
      judgment: { current: { kind: 'CORRECT' } },
      canCorrectJudgment: false,
    });

    mockJson({
      ...lawyerPayload,
      judgment: {
        ...lawyerPayload.judgment,
        history: [
          lawyerRegistered,
          { ...lawyerCorrection, reason: '不可泄漏' },
        ],
      },
    });
    await expect(readLawyer('case-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('registers or corrects through exact authorized routes and validates receipts', async () => {
    const result = {
      id: 'case-1',
      stage: 'WAITING_JUDGMENT',
      version: 8,
      judgmentId: '70000000-0000-4000-8000-000000000003',
      recordedAt: '2026-10-07T01:00:00.000Z',
    };
    const register = Reflect.get(casesApi, 'registerCaseJudgment') as
      | ((
          id: string,
          input: Record<string, unknown>,
          audience?: string,
        ) => Promise<unknown>)
      | undefined;
    const correct = Reflect.get(casesApi, 'correctCaseJudgment') as
      | ((id: string, input: Record<string, unknown>) => Promise<unknown>)
      | undefined;
    expect(register).toBeTypeOf('function');
    expect(correct).toBeTypeOf('function');
    if (!register || !correct) return;
    const input = {
      expectedVersion: 7,
      idempotencyKey: 'judgment-key',
      judgmentReceivedAt: '2026-10-07',
      judgmentAmountState: 'KNOWN',
      judgmentAmount: '0.00',
      paidLitigationFeeState: 'PENDING',
      paidLitigationFee: null,
      judgmentContentVersionIds: ['70000000-0000-4000-8000-000000000002'],
    };

    const fetchMock = mockJson(result);
    await expect(register('case-1', input, 'lawyer')).resolves.toEqual(result);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/lawyer/cases/case-1/judgment-register',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(
      input,
    );
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Idempotency-Key'),
    ).toBe('judgment-key');

    const correctionFetch = mockJson({ ...result, version: 9 });
    await correct('case-1', {
      ...input,
      expectedVersion: 8,
      idempotencyKey: 'correct-key',
      reason: '判决日期录入错误',
    });
    expect(correctionFetch.mock.calls[0]?.[0]).toBe(
      '/api/v1/cases/case-1/judgment-correct',
    );
    expect(
      JSON.parse(String(correctionFetch.mock.calls[0]?.[1]?.body)),
    ).toEqual({
      ...input,
      expectedVersion: 8,
      idempotencyKey: 'correct-key',
      reason: '判决日期录入错误',
    });
  });

  it('strictly decodes waiting judgment and immutable hearing history', async () => {
    mockJson({
      ...detail,
      stage: 'WAITING_JUDGMENT',
      version: 8,
      canScheduleHearing: false,
      canCorrectHearing: true,
      hearing: {
        currentArrangement: {
          id: '80000000-0000-4000-8000-000000000001',
          trialRoundId: '70000000-0000-4000-8000-000000000099',
          hearingAt: '2026-10-05',
          source: 'CORRECTION',
          recordedAt: '2026-10-06T01:00:00.000Z',
          recordedByUserId: '80000000-0000-4000-8000-000000000006',
        },
        currentAdvance: {
          id: '80000000-0000-4000-8000-000000000002',
          trialRoundId: '70000000-0000-4000-8000-000000000099',
          arrangementId: '80000000-0000-4000-8000-000000000001',
          dueAt: '2026-10-06T00:00:00.000+08:00',
          executedAt: '2026-10-06T00:00:00.000+08:00',
        },
        arrangements: [],
        advances: [],
        corrections: [
          {
            id: '80000000-0000-4000-8000-000000000003',
            priorArrangementId: '80000000-0000-4000-8000-000000000004',
            priorAdvanceId: '80000000-0000-4000-8000-000000000005',
            newArrangementId: '80000000-0000-4000-8000-000000000001',
            resultStage: 'WAITING_JUDGMENT',
            recordedAt: '2026-10-06T01:00:00.000Z',
            recordedByUserId: '80000000-0000-4000-8000-000000000006',
            reason: '法院通知日期变化',
          },
        ],
      },
    });

    await expect(getCase('case-1')).resolves.toMatchObject({
      stage: 'WAITING_JUDGMENT',
      canCorrectHearing: true,
      hearing: {
        currentArrangement: { hearingAt: '2026-10-05', source: 'CORRECTION' },
        corrections: [{ reason: '法院通知日期变化' }],
      },
    });
  });

  it('posts explicit hearing dates or null through only the authorized schedule route', async () => {
    const schedule = Reflect.get(casesApi, 'scheduleCaseHearing') as
      | ((
          id: string,
          input: Record<string, unknown>,
          audience?: string,
        ) => Promise<unknown>)
      | undefined;
    expect(schedule).toBeTypeOf('function');
    if (!schedule) return;
    const response = {
      id: 'case-1',
      stage: 'WAITING_HEARING',
      version: 7,
      arrangementId: '80000000-0000-4000-8000-000000000001',
      hearingAt: '2020-01-01',
      recordedAt: '2026-10-06T01:00:00.000Z',
    };
    const fetchMock = mockJson(response);
    await expect(
      schedule(
        'case-1',
        {
          expectedVersion: 6,
          idempotencyKey: 'schedule-key',
          hearingAt: '2020-01-01',
        },
        'lawyer',
      ),
    ).resolves.toEqual(response);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/lawyer/cases/case-1/hearing-schedule');
    expect(JSON.parse(String(init.body))).toEqual({
      expectedVersion: 6,
      idempotencyKey: 'schedule-key',
      hearingAt: '2020-01-01',
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ...response, hearingAt: null })),
    );
    await schedule('case-1', {
      expectedVersion: 6,
      idempotencyKey: 'clear-key',
      hearingAt: null,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      expectedVersion: 6,
      idempotencyKey: 'clear-key',
      hearingAt: null,
    });
  });

  it('posts trimmed correction reasons only to the internal correction route', async () => {
    const correct = Reflect.get(casesApi, 'correctCaseHearing') as
      | ((id: string, input: Record<string, unknown>) => Promise<unknown>)
      | undefined;
    expect(correct).toBeTypeOf('function');
    if (!correct) return;
    const response = {
      id: 'case-1',
      stage: 'WAITING_HEARING',
      version: 9,
      arrangementId: '80000000-0000-4000-8000-000000000001',
      hearingAt: null,
      recordedAt: '2026-10-06T01:00:00.000Z',
    };
    const fetchMock = mockJson(response);
    await expect(
      correct('case-1', {
        expectedVersion: 8,
        idempotencyKey: 'correction-key',
        hearingAt: null,
        reason: '  法院尚未确定新日期  ',
      }),
    ).resolves.toEqual(response);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/cases/case-1/hearing-correct',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      expectedVersion: 8,
      idempotencyKey: 'correction-key',
      hearingAt: null,
      reason: '法院尚未确定新日期',
    });
  });

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
        id: '80000000-0000-4000-8000-000000000031',
        trialRoundId: '80000000-0000-4000-8000-000000000032',
        acceptedAt: '2026-10-05',
        courtCaseNo: '（2026）甲0101民初1号',
        recordedAt: '2026-10-05T01:00:00.000Z',
        recordedByUserId: '80000000-0000-4000-8000-000000000006',
        files: [{ category: 'ACCEPTANCE_NOTICE', ...file }],
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
  it('decodes a formal acceptance with no selected files in current and history', async () => {
    const acceptance = {
      id: '80000000-0000-4000-8000-000000000031',
      trialRoundId: '80000000-0000-4000-8000-000000000032',
      acceptedAt: '2026-10-05',
      courtCaseNo: '（2026）甲0101民初1号',
      recordedAt: '2026-10-05T01:00:00.000Z',
      recordedByUserId: '80000000-0000-4000-8000-000000000006',
      files: [],
    };
    const response = {
      ...detail,
      stage: 'WAITING_HEARING',
      version: 6,
      courtCaseNo: acceptance.courtCaseNo,
      canRegisterAcceptance: false,
      canUploadAcceptanceMaterials: true,
      acceptance,
      acceptances: [acceptance],
    };
    mockJson(response);
    await expect(getCase('case-1')).resolves.toMatchObject({
      acceptance: { files: [] },
      acceptances: [{ files: [] }],
    });
    mockJson({
      ...response,
      acceptances: [{ ...acceptance, files: [{ extra: true }] }],
    });
    await expect(getCase('case-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    mockJson({
      ...response,
      acceptance: { ...acceptance, unexpected: true },
    });
    await expect(getCase('case-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it('rejects legacy, malformed, and extra fields in the current acceptance', async () => {
    const acceptance = {
      id: '80000000-0000-4000-8000-000000000031',
      trialRoundId: '80000000-0000-4000-8000-000000000032',
      acceptedAt: '2026-10-05',
      courtCaseNo: '（2026）甲0101民初1号',
      recordedAt: '2026-10-05T01:00:00.000Z',
      recordedByUserId: '80000000-0000-4000-8000-000000000006',
      files: [
        {
          category: 'ACCEPTANCE_NOTICE',
          materialId: 'material-notice',
          contentVersionId: 'version-notice',
          originalFilename: '受理通知书.pdf',
          mimeType: 'application/pdf',
        },
      ],
    };
    const legacyAcceptance: Record<string, unknown> = { ...acceptance };
    delete legacyAcceptance.trialRoundId;
    for (const invalid of [
      legacyAcceptance,
      { ...acceptance, trialRoundId: 'old-round' },
      { ...acceptance, extra: true },
      { ...acceptance, files: [{ ...acceptance.files[0], category: 'OTHER' }] },
    ]) {
      mockJson({
        ...detail,
        courtCaseNo: acceptance.courtCaseNo,
        acceptance: invalid,
      });
      await expect(getCase('case-1')).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
  });
  it('requires the top-level court case number to match the accepted fact', async () => {
    const accepted = {
      ...detail,
      stage: 'WAITING_HEARING',
      version: 6,
      canRegisterAcceptance: false,
      canUploadAcceptanceMaterials: true,
      acceptance: {
        id: '80000000-0000-4000-8000-000000000031',
        trialRoundId: '80000000-0000-4000-8000-000000000032',
        acceptedAt: '2026-10-05',
        courtCaseNo: '（2026）甲0101民初1号',
        recordedAt: '2026-10-05T01:00:00.000Z',
        recordedByUserId: '80000000-0000-4000-8000-000000000006',
        files: [
          {
            category: 'ACCEPTANCE_NOTICE',
            materialId: 'material-notice',
            contentVersionId: 'version-notice',
            originalFilename: '受理通知书.pdf',
            mimeType: 'application/pdf',
          },
        ],
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
        WAITING_JUDGMENT: 0,
        SECOND_INSTANCE: 0,
        WAITING_EXECUTION_DOCUMENTS: 0,
        WAITING_EXECUTION_CONFIRMATION: 0,
        WAITING_EXECUTION_STAMP: 0,
        WAITING_EXECUTION_FILING: 0,
        EXECUTING: 0,
        WAITING_ARCHIVE: 0,
        ARCHIVED: 0,
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
        WAITING_JUDGMENT: 0,
        SECOND_INSTANCE: 0,
        WAITING_EXECUTION_DOCUMENTS: 0,
        WAITING_EXECUTION_CONFIRMATION: 0,
        WAITING_EXECUTION_STAMP: 0,
        WAITING_EXECUTION_FILING: 0,
        EXECUTING: 0,
        WAITING_ARCHIVE: 0,
        ARCHIVED: 0,
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
        WAITING_JUDGMENT: 0,
        SECOND_INSTANCE: 0,
        WAITING_EXECUTION_DOCUMENTS: 0,
        WAITING_EXECUTION_CONFIRMATION: 0,
        WAITING_EXECUTION_STAMP: 0,
        WAITING_EXECUTION_FILING: 0,
        EXECUTING: 0,
        WAITING_ARCHIVE: 0,
        ARCHIVED: 0,
      },
    });
    await expect(
      listCases(1, 20, { view: 'department' }),
    ).resolves.toMatchObject({
      items: [{ canMatch: false, canSubmitComplaint: true }],
    });
  });

  it('decodes execution submit capability in a nonempty internal case list', async () => {
    const counts = {
      PENDING_MATCH: 0,
      WAITING_COMPLAINT: 0,
      WAITING_COMPLAINT_CONFIRMATION: 0,
      WAITING_COMPLAINT_STAMP: 0,
      WAITING_FILING: 0,
      WAITING_FORMAL_ACCEPTANCE: 0,
      WAITING_HEARING: 0,
      WAITING_JUDGMENT: 0,
      SECOND_INSTANCE: 0,
      WAITING_EXECUTION_DOCUMENTS: 1,
      WAITING_EXECUTION_CONFIRMATION: 0,
      WAITING_EXECUTION_STAMP: 0,
      WAITING_EXECUTION_FILING: 0,
      EXECUTING: 0,
      WAITING_ARCHIVE: 0,
      ARCHIVED: 0,
    };
    const item = {
      ...summary,
      stage: 'WAITING_EXECUTION_DOCUMENTS',
      canSubmitExecution: true,
      canConfirmExecution: false,
      canMailExecution: false,
      canSubmitExecutionFiling: false,
      canFinishExecution: false,
      canRecordClosure: false,
      canCorrectClosure: false,
      canArchive: false,
      canCorrectArchive: false,
    };
    mockJson({ items: [item], total: 1, page: 1, pageSize: 20, counts });
    await expect(listCases()).resolves.toMatchObject({
      items: [
        {
          stage: 'WAITING_EXECUTION_DOCUMENTS',
          canSubmitExecution: true,
          canConfirmExecution: false,
          canMailExecution: false,
          canSubmitExecutionFiling: false,
          canFinishExecution: false,
          canRecordClosure: false,
          canCorrectClosure: false,
          canArchive: false,
          canCorrectArchive: false,
        },
      ],
    });

    mockJson({
      items: [{ ...item, unexpected: true }],
      total: 1,
      page: 1,
      pageSize: 20,
      counts,
    });
    await expect(listCases()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });

    const missingCapability = { ...item };
    Reflect.deleteProperty(missingCapability, 'canConfirmExecution');
    mockJson({
      items: [missingCapability],
      total: 1,
      page: 1,
      pageSize: 20,
      counts,
    });
    await expect(listCases()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });

    mockJson({
      items: [{ ...item, canConfirmExecution: 'yes' }],
      total: 1,
      page: 1,
      pageSize: 20,
      counts,
    });
    await expect(listCases()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('decodes execution submit capability in a nonempty lawyer case list', async () => {
    const counts = {
      PENDING_MATCH: 0,
      WAITING_COMPLAINT: 0,
      WAITING_COMPLAINT_CONFIRMATION: 0,
      WAITING_COMPLAINT_STAMP: 0,
      WAITING_FILING: 0,
      WAITING_FORMAL_ACCEPTANCE: 0,
      WAITING_HEARING: 0,
      WAITING_JUDGMENT: 0,
      SECOND_INSTANCE: 0,
      WAITING_EXECUTION_DOCUMENTS: 1,
      WAITING_EXECUTION_CONFIRMATION: 0,
      WAITING_EXECUTION_STAMP: 0,
      WAITING_EXECUTION_FILING: 0,
      EXECUTING: 0,
      WAITING_ARCHIVE: 0,
      ARCHIVED: 0,
    };
    const item = {
      id: 'case-1',
      businessNo: 'CA-1',
      stage: 'WAITING_EXECUTION_DOCUMENTS',
      version: 3,
      canMatch: false,
      canSubmitComplaint: false,
      canConfirmComplaint: false,
      canMailComplaint: false,
      canSubmitFiling: false,
      canRegisterAcceptance: false,
      canUploadAcceptanceMaterials: false,
      canScheduleHearing: false,
      canCorrectHearing: false,
      canRegisterJudgment: false,
      canCorrectJudgment: false,
      canChooseJudgmentNextStep: false,
      canRevokeJudgmentNextStep: false,
      canSaveSecondInstance: false,
      canRegisterSecondInstanceResult: false,
      canRevokeSecondInstanceResult: false,
      canSubmitExecution: true,
      canConfirmExecution: false,
      canMailExecution: false,
      canSubmitExecutionFiling: false,
      canFinishExecution: false,
      canRecordClosure: false,
      canCorrectClosure: false,
      canArchive: false,
      canCorrectArchive: false,
      createdAt: '2026-09-28T00:00:00.000Z',
    };
    mockJson({ items: [item], total: 1, page: 1, pageSize: 20, counts });
    await expect(listLawyerCases()).resolves.toMatchObject({
      items: [
        {
          stage: 'WAITING_EXECUTION_DOCUMENTS',
          canSubmitExecution: true,
          canConfirmExecution: false,
          canMailExecution: false,
          canSubmitExecutionFiling: false,
          canFinishExecution: false,
          canRecordClosure: false,
          canCorrectClosure: false,
          canArchive: false,
          canCorrectArchive: false,
        },
      ],
    });

    mockJson({
      items: [{ ...item, unexpected: true }],
      total: 1,
      page: 1,
      pageSize: 20,
      counts,
    });
    await expect(listLawyerCases()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });

    const missingCapability = { ...item };
    Reflect.deleteProperty(missingCapability, 'canConfirmExecution');
    mockJson({
      items: [missingCapability],
      total: 1,
      page: 1,
      pageSize: 20,
      counts,
    });
    await expect(listLawyerCases()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });

    mockJson({
      items: [{ ...item, canConfirmExecution: 'yes' }],
      total: 1,
      page: 1,
      pageSize: 20,
      counts,
    });
    await expect(listLawyerCases()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
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
        WAITING_JUDGMENT: 0,
        SECOND_INSTANCE: 0,
        WAITING_EXECUTION_DOCUMENTS: 0,
        WAITING_EXECUTION_CONFIRMATION: 0,
        WAITING_EXECUTION_STAMP: 0,
        WAITING_EXECUTION_FILING: 0,
        EXECUTING: 0,
        WAITING_ARCHIVE: 0,
        ARCHIVED: 0,
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
      canScheduleHearing: true,
      canCorrectHearing: false,
      canRegisterJudgment: false,
      canCorrectJudgment: false,
      canChooseJudgmentNextStep: true,
      canRevokeJudgmentNextStep: false,
      canSaveSecondInstance: false,
      canRegisterSecondInstanceResult: false,
      canRevokeSecondInstanceResult: false,
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
      canScheduleHearing: true,
      canCorrectHearing: false,
      canRegisterJudgment: false,
      canCorrectJudgment: false,
      canChooseJudgmentNextStep: true,
      canRevokeJudgmentNextStep: false,
      canSaveSecondInstance: false,
      canRegisterSecondInstanceResult: false,
      canRevokeSecondInstanceResult: false,
      canSubmitExecution: false,
      canConfirmExecution: false,
      canMailExecution: false,
      canSubmitExecutionFiling: false,
      canFinishExecution: false,
      canRecordClosure: false,
      canCorrectClosure: false,
      canArchive: false,
      canCorrectArchive: false,
      executionConfirmation: null,
      executionMailing: null,
      executionFiling: null,
      executionFinish: null,
      closure: null,
      archive: null,
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
      hearing: detail.hearing,
      judgment: detail.judgment,
      judgmentNextStep: { current: null, history: [], revocations: [] },
      acceptances: [],
      secondInstance: detail.secondInstance,
      executionSubmission: {
        current: null,
        submissions: [],
        availableFiles: [],
      },
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
        id: '80000000-0000-4000-8000-000000000031',
        trialRoundId: '80000000-0000-4000-8000-000000000032',
        acceptedAt: '2026-10-05',
        courtCaseNo: '（2026）甲0101民初1号',
        recordedAt: '2026-10-05T01:00:00.000Z',
        files: [
          {
            category: 'ACCEPTANCE_NOTICE',
            materialId: 'material-notice',
            contentVersionId: 'version-notice',
            originalFilename: '受理通知书.pdf',
            mimeType: 'application/pdf',
          },
        ],
      },
    };
    mockJson(acceptedLawyerDetail);
    await expect(read('case-1')).resolves.toMatchObject({
      stage: 'WAITING_HEARING',
      courtCaseNo: '（2026）甲0101民初1号',
      acceptance: { courtCaseNo: '（2026）甲0101民初1号' },
    });
    mockJson({
      ...acceptedLawyerDetail,
      acceptance: {
        ...acceptedLawyerDetail.acceptance,
        recordedByUserId: '80000000-0000-4000-8000-000000000006',
      },
    });
    await expect(read('case-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
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

  it('decodes the lawyer acceptance without optional files but rejects hidden actor and malformed history', async () => {
    const acceptance = {
      id: '80000000-0000-4000-8000-000000000031',
      trialRoundId: '80000000-0000-4000-8000-000000000032',
      acceptedAt: '2026-10-05',
      courtCaseNo: '（2026）甲0101民初1号',
      recordedAt: '2026-10-05T01:00:00.000Z',
      files: [],
    };
    const response = {
      id: 'case-1',
      businessNo: 'CA-1',
      stage: 'WAITING_HEARING',
      version: 6,
      canMatch: false,
      canSubmitComplaint: false,
      canConfirmComplaint: false,
      canMailComplaint: false,
      canSubmitFiling: false,
      canRegisterAcceptance: false,
      canUploadAcceptanceMaterials: true,
      canScheduleHearing: true,
      canCorrectHearing: false,
      canRegisterJudgment: false,
      canCorrectJudgment: false,
      canChooseJudgmentNextStep: false,
      canRevokeJudgmentNextStep: false,
      canSaveSecondInstance: false,
      canRegisterSecondInstanceResult: false,
      canRevokeSecondInstanceResult: false,
      canSubmitExecution: false,
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
      courtCaseNo: acceptance.courtCaseNo,
      acceptance,
      acceptanceMaterials: detail.acceptanceMaterials,
      hearing: detail.hearing,
      judgment: detail.judgment,
      judgmentNextStep: { current: null, history: [], revocations: [] },
      acceptances: [acceptance],
      secondInstance: detail.secondInstance,
      executionSubmission: {
        current: null,
        submissions: [],
        availableFiles: [],
      },
      canConfirmExecution: false,
      canMailExecution: false,
      canSubmitExecutionFiling: false,
      canFinishExecution: false,
      canRecordClosure: false,
      canCorrectClosure: false,
      canArchive: false,
      canCorrectArchive: false,
      executionConfirmation: null,
      executionMailing: null,
      executionFiling: null,
      executionFinish: null,
      closure: null,
      archive: null,
    };
    mockJson(response);
    await expect(casesApi.getLawyerCase('case-1')).resolves.toMatchObject({
      acceptance: { files: [] },
      acceptances: [{ files: [] }],
    });
    for (const invalidAcceptance of [
      {
        ...acceptance,
        recordedByUserId: '80000000-0000-4000-8000-000000000006',
      },
      {
        ...acceptance,
        files: [{ category: 'ACCEPTANCE_NOTICE', extra: true }],
      },
    ]) {
      mockJson({ ...response, acceptances: [invalidAcceptance] });
      await expect(casesApi.getLawyerCase('case-1')).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
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
        WAITING_JUDGMENT: 0,
        SECOND_INSTANCE: 0,
        WAITING_EXECUTION_DOCUMENTS: 0,
        WAITING_EXECUTION_CONFIRMATION: 0,
        WAITING_EXECUTION_STAMP: 0,
        WAITING_EXECUTION_FILING: 0,
        EXECUTING: 0,
        WAITING_ARCHIVE: 0,
        ARCHIVED: 0,
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

const finishInput = {
  expectedVersion: 18,
  idempotencyKey: 'finish-original-key',
  expectedFilingId: '80000000-0000-4000-8000-000000000181',
  finishedAt: '2026-10-01',
  reason: '  实际执行结束，原文本保留  ',
  basisNote: '  法院说明原文  ',
  basisContentVersionIds: [] as string[],
};
const finishReceipt = {
  id: 'case-1',
  finishId: '80000000-0000-4000-8000-000000000191',
  filingId: finishInput.expectedFilingId,
  stage: 'WAITING_ARCHIVE',
  version: 19,
  finishedAt: finishInput.finishedAt,
  recordedAt: '2026-10-13T07:00:00.000Z',
};
function finishDetailPayload() {
  const file = {
    materialId: '80000000-0000-4000-8000-000000000101',
    contentVersionId: '80000000-0000-4000-8000-000000000102',
    originalFilename: '真实材料.pdf',
    mimeType: 'application/pdf',
  };
  const submissionFile = { ...file, uploadedAt: '2026-10-01T00:00:00.000Z' };
  const submission = {
    id: '80000000-0000-4000-8000-000000000103',
    trialRoundId: '80000000-0000-4000-8000-000000000104',
    judgmentNextStepId: '80000000-0000-4000-8000-000000000105',
    secondInstanceResultId: null,
    priorSubmissionId: null,
    changeReason: null,
    fromVersion: 14,
    toVersion: 15,
    submittedAt: '2026-10-01T00:00:00.000Z',
    files: [submissionFile],
  };
  const confirmation = {
    id: '80000000-0000-4000-8000-000000000106',
    submissionId: submission.id,
    confirmedAt: '2026-10-01T00:00:00.000Z',
    confirmedByUserId: 'user-1',
    files: [submissionFile],
  };
  const mailing = {
    id: '80000000-0000-4000-8000-000000000171',
    confirmationId: confirmation.id,
    mailedAt: '2026-10-01',
    recordedAt: '2026-10-01T00:00:00.000Z',
    files: [file],
  };
  return {
    ...detail,
    stage: 'WAITING_ARCHIVE',
    version: 19,
    executionSubmission: {
      current: submission,
      submissions: [submission],
      availableFiles: [],
    },
    executionConfirmation: confirmation,
    executionMailing: mailing,
    executionFiling: {
      id: finishInput.expectedFilingId,
      mailingId: mailing.id,
      submittedAt: '2026-10-12',
      recordedAt: '2026-10-12T00:00:00.000Z',
      files: [file],
    },
    executionFinish: {
      id: finishReceipt.finishId,
      filingId: finishReceipt.filingId,
      finishedAt: finishInput.finishedAt,
      reason: finishInput.reason,
      basisNote: finishInput.basisNote,
      recordedAt: finishReceipt.recordedAt,
      files: [] as (typeof file)[],
    },
  };
}
describe('CA-015 execution finish contract', () => {
  it.each(['internal', 'lawyer'] as const)(
    'uses the shared command for %s without trimming or reordering the original input',
    async (audience) => {
      const fetch = mockJson(finishReceipt, 201);
      await expect(
        casesApi.finishCaseExecution('case-1', finishInput, audience),
      ).resolves.toEqual(finishReceipt);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]?.[0]).toBe(
        `/api/v1/${audience === 'lawyer' ? 'lawyer/cases' : 'cases'}/case-1/execution-finish`,
      );
      expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual(
        finishInput,
      );
      expect(fetch.mock.calls[0]?.[1]?.headers['Idempotency-Key']).toBe(
        finishInput.idempotencyKey,
      );
    },
  );
  it.each([
    { expectedVersion: 0 },
    { expectedVersion: Number.MAX_SAFE_INTEGER + 1 },
    { idempotencyKey: ' key ' },
    { expectedFilingId: 'old-filing' },
    { finishedAt: '2026-02-30' },
    { finishedAt: '2099-10-01' },
    { reason: ' ' },
    { reason: 'a'.repeat(2001) },
    { basisNote: '' },
    { basisNote: null },
    { basisContentVersionIds: ['invalid'] },
    { basisContentVersionIds: Array(11).fill(finishInput.expectedFilingId) },
    {
      basisContentVersionIds: [
        finishInput.expectedFilingId,
        finishInput.expectedFilingId,
      ],
    },
    { unexpected: true },
  ])('rejects malformed request %j before transport', async (override) => {
    const fetch = mockJson(finishReceipt, 201);
    await expect(
      casesApi.finishCaseExecution('case-1', { ...finishInput, ...override }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('requires every explicit key but accepts attachment-only basis and a real date earlier than filing', async () => {
    const missing: Record<string, unknown> = { ...finishInput };
    delete missing.basisNote;
    const fetch = mockJson(finishReceipt, 201);
    await expect(
      casesApi.finishCaseExecution(
        'case-1',
        missing as casesApi.FinishCaseExecutionInput,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      casesApi.finishCaseExecution('case-1', {
        ...finishInput,
        basisNote: null,
        basisContentVersionIds: [finishInput.expectedFilingId],
      }),
    ).resolves.toEqual(finishReceipt);
  });
  it.each([
    { id: 'other-case' },
    { finishId: 'finish-1' },
    { filingId: '80000000-0000-4000-8000-000000000199' },
    { stage: 'EXECUTING' },
    { version: 20 },
    { finishedAt: '2026-10-02' },
    { recordedAt: '2026-02-30T00:00:00Z' },
    { recordedAt: '2026-10-13T15:00:00+08:00' },
    { reason: 'leaked' },
  ])('rejects incompatible or extra receipt fields %j', async (override) => {
    mockJson({ ...finishReceipt, ...override }, 201);
    await expect(
      casesApi.finishCaseExecution('case-1', finishInput),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('decodes finish fact with note-only or attachment-only basis and ties it to the current filing', async () => {
    const payload = finishDetailPayload();
    mockJson(payload);
    await expect(getCase('case-1')).resolves.toMatchObject({
      executionFinish: payload.executionFinish,
      stage: 'WAITING_ARCHIVE',
    });
    const file = payload.executionFiling.files[0]!;
    mockJson({
      ...payload,
      executionFinish: {
        ...payload.executionFinish,
        basisNote: null,
        files: [file],
      },
    });
    await expect(getCase('case-1')).resolves.toMatchObject({
      executionFinish: { basisNote: null, files: [file] },
    });
    for (const override of [
      { executionFinish: null },
      { canFinishExecution: true },
      { stage: 'EXECUTING' },
      {
        executionFinish: {
          ...payload.executionFinish,
          filingId: '80000000-0000-4000-8000-000000000199',
        },
      },
      {
        executionFinish: {
          ...payload.executionFinish,
          basisNote: null,
          files: [],
        },
      },
      { executionFinish: { ...payload.executionFinish, files: [file, file] } },
      {
        executionFinish: {
          ...payload.executionFinish,
          recordedByUserId: 'internal-user',
        },
      },
    ]) {
      mockJson({ ...payload, ...override });
      await expect(getCase('case-1')).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
  });
  it('decodes the same authorized finish facts on lawyer detail without broadening the lawyer projection', async () => {
    const {
      owner,
      fees,
      department,
      sourceLead,
      sourceNotaryMatter,
      ...payload
    } = finishDetailPayload();
    void owner;
    void fees;
    void department;
    void sourceLead;
    void sourceNotaryMatter;
    const lawyerPayload = { ...payload, canMatch: false };
    mockJson(lawyerPayload);
    await expect(casesApi.getLawyerCase('case-1')).resolves.toMatchObject({
      executionFinish: payload.executionFinish,
    });
    mockJson({ ...lawyerPayload, fees: [] });
    await expect(casesApi.getLawyerCase('case-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});

it.each(['COMPLAINT_PREPARATION', 'EXECUTION_PREPARATION'] as const)(
  'rejects stage plus %s before sending requests',
  async (stageGroup) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      listCases(1, 20, { stage: 'WAITING_COMPLAINT', stageGroup }),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    await expect(
      listLawyerCases(1, 20, 'WAITING_COMPLAINT', { stageGroup }),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

const closureInput: casesApi.RecordCaseClosureInput = {
  expectedVersion: 19,
  idempotencyKey: 'closure-original-key',
  expectedFinishId: finishReceipt.finishId,
  closeAt: null,
  closeAmountState: 'PENDING',
  closeAmt: null,
  note: null,
  closeContentVersionIds: [],
};
const closureReceipt = {
  id: 'case-1',
  closureId: '80000000-0000-4000-8000-000000000201',
  closureVersionId: '80000000-0000-4000-8000-000000000202',
  finishId: finishReceipt.finishId,
  stage: 'WAITING_ARCHIVE',
  version: 20,
  recordedAt: '2026-10-13T10:00:00.000Z',
};
function closureDetailPayload() {
  const current = {
    id: closureReceipt.closureVersionId,
    kind: 'REGISTER',
    priorVersionId: null,
    finishId: finishReceipt.finishId,
    fromVersion: 19,
    toVersion: 20,
    closeAt: null,
    closeAmountState: 'PENDING',
    closeAmt: null,
    note: null,
    correctionReason: null,
    recordedAt: closureReceipt.recordedAt,
    recordedByUserId: '80000000-0000-4000-8000-000000000203',
    files: [],
  };
  return {
    ...finishDetailPayload(),
    version: 20,
    closure: {
      id: closureReceipt.closureId,
      finishId: finishReceipt.finishId,
      current,
      history: [current],
    },
  };
}
describe('CA-016 closure and list display contract', () => {
  it.each(['internal', 'lawyer'] as const)(
    'posts nullable, attachment-free registration through %s with exact original input',
    async (audience) => {
      const fetch = mockJson(closureReceipt, 201);
      await expect(
        casesApi.recordCaseClosure('case-1', closureInput, audience),
      ).resolves.toEqual(closureReceipt);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]?.[0]).toBe(
        `/api/v1/${audience === 'lawyer' ? 'lawyer/cases' : 'cases'}/case-1/closure`,
      );
      expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual(
        closureInput,
      );
      expect(fetch.mock.calls[0]?.[1]?.headers['Idempotency-Key']).toBe(
        closureInput.idempotencyKey,
      );
    },
  );
  it('preserves real zero, whitespace and attachment order and requires the correction anchor/reason', async () => {
    const input = {
      ...closureInput,
      closeAmountState: 'KNOWN' as const,
      closeAmt: '0.00',
      note: '  原文  ',
      closeContentVersionIds: [
        finishInput.expectedFilingId,
        finishReceipt.finishId,
      ],
      expectedClosureVersionId: closureReceipt.closureVersionId,
      correctionReason: '  实际更正原因  ',
    };
    const fetch = mockJson(closureReceipt, 201);
    await casesApi.correctCaseClosure('case-1', input);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      '/api/v1/cases/case-1/closure-correction',
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual(input);
    for (const override of [
      { expectedClosureVersionId: 'invalid' },
      { correctionReason: ' ' },
      { correctionReason: 'a'.repeat(501) },
    ]) {
      fetch.mockClear();
      await expect(
        casesApi.correctCaseClosure('case-1', { ...input, ...override }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(fetch).not.toHaveBeenCalled();
    }
  });
  it.each([
    { expectedVersion: 0 },
    { expectedVersion: Number.MAX_SAFE_INTEGER + 1 },
    { idempotencyKey: ' key ' },
    { expectedFinishId: 'bad' },
    { closeAt: '2026-02-30' },
    { closeAt: '2099-01-01' },
    { closeAmountState: 'KNOWN', closeAmt: null },
    { closeAmountState: 'KNOWN', closeAmt: '-1.00' },
    { closeAmountState: 'KNOWN', closeAmt: '100000000000000.00' },
    { closeAmountState: 'KNOWN', closeAmt: '1.001' },
    { closeAmt: '0.00' },
    { note: ' ' },
    { note: 'a'.repeat(2001) },
    {
      closeContentVersionIds: [finishReceipt.finishId, finishReceipt.finishId],
    },
    { closeContentVersionIds: ['bad'] },
    { closeContentVersionIds: Array(11).fill(finishReceipt.finishId) },
    { extra: true },
  ])('rejects invalid explicit input %j before transport', async (override) => {
    const fetch = mockJson(closureReceipt, 201);
    await expect(
      casesApi.recordCaseClosure('case-1', {
        ...closureInput,
        ...override,
      } as casesApi.RecordCaseClosureInput),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects each omitted key and does not automatically retry an unknown result', async () => {
    for (const key of Object.keys(closureInput)) {
      const input = { ...closureInput } as Record<string, unknown>;
      delete input[key];
      const fetch = mockJson(closureReceipt, 201);
      await expect(
        casesApi.recordCaseClosure(
          'case-1',
          input as casesApi.RecordCaseClosureInput,
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(fetch).not.toHaveBeenCalled();
    }
    const fetch = mockJson(
      { code: 'INTERNAL_ERROR', message: 'unknown', requestId: 'r1' },
      500,
    );
    await expect(
      casesApi.recordCaseClosure('case-1', closureInput),
    ).rejects.toMatchObject({ status: 500 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    { id: 'other' },
    { closureId: 'bad' },
    { closureVersionId: 'bad' },
    { finishId: finishInput.expectedFilingId },
    { version: 19 },
    { version: Number.MAX_SAFE_INTEGER + 1 },
    { stage: 'EXECUTING' },
    { recordedAt: '2026-02-30T10:00:00Z' },
    { note: 'leak' },
  ])('rejects malformed fixed receipt %j', async (override) => {
    mockJson({ ...closureReceipt, ...override }, 201);
    await expect(
      casesApi.recordCaseClosure('case-1', closureInput),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('decodes nullable first version and a contiguous correction with real zero; rejects wrong current and broken chains', async () => {
    const payload = closureDetailPayload();
    mockJson(payload);
    await expect(getCase('case-1')).resolves.toMatchObject({
      closure: payload.closure,
    });
    const corrected = {
      ...payload.closure.current,
      id: '80000000-0000-4000-8000-000000000204',
      kind: 'CORRECT',
      priorVersionId: payload.closure.current.id,
      fromVersion: 20,
      toVersion: 21,
      closeAmountState: 'KNOWN',
      closeAmt: '0.00',
      correctionReason: '更正真实金额',
    };
    const correction = {
      ...payload,
      version: 21,
      canCorrectClosure: true,
      canArchive: false,
      canCorrectArchive: false,
      closure: {
        ...payload.closure,
        current: corrected,
        history: [payload.closure.current, corrected],
      },
    };
    mockJson(correction);
    await expect(getCase('case-1')).resolves.toMatchObject({
      closure: { current: { closeAmt: '0.00' } },
    });
    for (const invalid of [
      { ...correction.closure, current: { ...corrected, note: 'tampered' } },
      { ...correction.closure, history: [corrected, payload.closure.current] },
      {
        ...correction.closure,
        current: { ...corrected, fromVersion: 19 },
        history: [payload.closure.current, { ...corrected, fromVersion: 19 }],
      },
      { ...correction.closure, finishId: finishInput.expectedFilingId },
      { ...correction.closure, current: { ...corrected, closeAmt: '0' } },
    ]) {
      mockJson({ ...correction, closure: invalid });
      await expect(getCase('case-1')).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
  });
  it('requires lawyer minimal closure projection and refuses internal summary, actor and correction reason', async () => {
    const { owner, department, fees, sourceLead, sourceNotaryMatter, ...base } =
      closureDetailPayload();
    void owner;
    void department;
    void fees;
    void sourceLead;
    void sourceNotaryMatter;
    const { recordedByUserId, correctionReason, ...current } =
      base.closure.current;
    void recordedByUserId;
    void correctionReason;
    const payload = {
      ...base,
      canMatch: false,
      closure: { ...base.closure, current, history: [current] },
    };
    mockJson(payload);
    await expect(casesApi.getLawyerCase('case-1')).resolves.toMatchObject({
      closure: { current },
    });
    for (const invalid of [
      { ...payload, displaySummary },
      { ...payload, canCorrectClosure: true },
      { ...payload, closure: base.closure },
      {
        ...payload,
        closure: {
          ...payload.closure,
          current: { ...current, correctionReason: 'leak' },
        },
      },
    ]) {
      mockJson(invalid);
      await expect(casesApi.getLawyerCase('case-1')).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
  });
  it('strictly decodes list summary source and money states without fabricating unrecorded amounts', async () => {
    const stages = [
      'PENDING_MATCH',
      'WAITING_COMPLAINT',
      'WAITING_COMPLAINT_CONFIRMATION',
      'WAITING_COMPLAINT_STAMP',
      'WAITING_FILING',
      'WAITING_FORMAL_ACCEPTANCE',
      'WAITING_HEARING',
      'WAITING_JUDGMENT',
      'SECOND_INSTANCE',
      'WAITING_EXECUTION_DOCUMENTS',
      'WAITING_EXECUTION_CONFIRMATION',
      'WAITING_EXECUTION_STAMP',
      'WAITING_EXECUTION_FILING',
      'EXECUTING',
      'WAITING_ARCHIVE',
      'ARCHIVED',
    ];
    const counts = Object.fromEntries(
      stages.map((stage) => [stage, stage === 'PENDING_MATCH' ? 1 : 0]),
    );
    const body = { items: [summary], total: 1, page: 1, pageSize: 20, counts };
    mockJson(body);
    await expect(listCases()).resolves.toMatchObject({
      items: [{ displaySummary }],
    });
    const sourced = {
      state: 'KNOWN',
      amount: '0.00',
      sourceType: 'COMPLAINT_CONFIRMATION',
      sourceId: finishReceipt.finishId,
    };
    mockJson({
      ...body,
      items: [
        {
          ...summary,
          displaySummary: { ...displaySummary, claimAmount: sourced },
        },
      ],
    });
    await expect(listCases()).resolves.toMatchObject({
      items: [{ displaySummary: { claimAmount: { amount: '0.00' } } }],
    });
    for (const invalid of [
      { ...sourced, sourceType: 'DRAFT' },
      { ...sourced, amount: '0' },
      { ...sourced, sourceId: null },
      { ...unrecordedAmount, amount: '0.00' },
      { ...sourced, state: 'PENDING', amount: '0.00' },
    ]) {
      mockJson({
        ...body,
        items: [
          {
            ...summary,
            displaySummary: { ...displaySummary, claimAmount: invalid },
          },
        ],
      });
      await expect(listCases()).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
    mockJson({ ...detail, displaySummary });
    await expect(getCase('case-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it('keeps unknown original requests through remount and clones arrays; clears synchronously on identity/revision change', () => {
    const identity = ref('user:department:revision1');
    const auth = {};
    const state = casesApi.caseClosureSession(auth, () => identity.value);
    state.setPending('case-1', { command: 'RECORD', input: closureInput });
    const remounted = casesApi.caseClosureSession(auth, () => identity.value);
    expect(remounted.pending('case-1')).toEqual({
      command: 'RECORD',
      input: closureInput,
    });
    remounted
      .pending('case-1')!
      .input.closeContentVersionIds.push('changed-copy');
    expect(state.pending('case-1')!.input.closeContentVersionIds).toEqual([]);
    expect(state.markChanged(closureReceipt.closureVersionId)).toBe(true);
    expect(state.markChanged(closureReceipt.closureVersionId)).toBe(false);
    identity.value = 'user:department:revision2';
    expect(state.pending('case-1')).toBeNull();
  });
});
