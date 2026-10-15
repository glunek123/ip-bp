import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test';
import { coreLeadFixtures } from '../support/core-lead-database.mjs';
import { createCaseExecutionFilingSourceThroughApi } from '../support/case-execution-filing-database.mjs';
import { createSubmittedCaseThroughApi } from '../support/case-complaint-confirmation-database.mjs';
import {
  grantHistoricalRecordFixtureActions,
  historicalRecordFrozenSnapshot,
  historicalRecordSectionSnapshot,
  historicalRecordMutationProbe,
  withHistoricalRecordFault,
} from '../support/case-historical-record-edit-database.mjs';

// Runner owns fixture bootstrap, instance binding, migration and execution. This spec only appends.
const operator = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const foreign = { Authorization: `Bearer ${coreLeadFixtures.tokenB}` };
const readOnly = { Authorization: `Bearer ${coreLeadFixtures.tokenSelf}` };
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const closureBytes = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n',
);
async function uploadClosureDocument(
  request: APIRequestContext,
  caseId: string,
) {
  const draft = await body<{ id: string }>(
    await request.post('/api/v1/materials/upload-drafts', {
      headers: operator,
      data: {
        ownerType: 'CASE',
        ownerId: caseId,
        category: 'CASE_CLOSURE_DOCUMENT',
        purpose: 'CASE_CLOSURE_DOCUMENT',
        originalFilename: `h-closure-${randomUUID()}.pdf`,
        declaredMimeType: 'application/pdf',
      },
    }),
    201,
  );
  return body<File>(
    await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
      headers: { ...operator, 'Content-Type': 'application/octet-stream' },
      data: closureBytes,
    }),
    200,
  );
}
type File = { materialId: string; contentVersionId: string };
type Detail = {
  id: string;
  stage: string;
  version: number;
  hearing: {
    currentArrangement: {
      id: string;
      trialRoundId: string;
      hearingAt: string | null;
    };
    currentAdvance: { id: string } | null;
  };
  judgment: {
    current: {
      id: string;
      trialRoundId: string;
      judgmentReceivedAt: string;
      files: File[];
    };
    history: unknown[];
  };
  executionFiling: { id: string };
  executionFinish: { id: string } | null;
  closure: null | {
    id: string;
    current: { id: string; closeAt: string | null };
    history: unknown[];
  };
  archive: null | { closureVersionId: string; current: { id: string } };
  recordEdits: {
    hearings: Array<{
      arrangementId: string;
      hearingRevision: number;
      effective: { hearingAt: string | null };
    }>;
    judgments: Array<{
      judgmentId: string;
      judgmentRevision: number;
      effective: { judgmentAmount: string | null; judgmentReceivedAt: string };
    }>;
    closures: Array<{
      closureId: string;
      closureRevision: number;
      effective: { note: string | null; closeAt: string | null };
    }>;
  };
};
type Correction = {
  caseId: string;
  correctionId: string;
  recordedAt: string;
  hearingRevision?: number;
  judgmentRevision?: number;
  closureRevision?: number;
};
async function body<T>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()) as T;
}
const detail = (request: APIRequestContext, caseId: string) =>
  request
    .get(`/api/v1/cases/${caseId}`, { headers: operator })
    .then((response) => body<Detail>(response));
const post = (
  request: APIRequestContext,
  caseId: string,
  route: string,
  data: object,
  headers = operator,
) => request.post(`/api/v1/cases/${caseId}/${route}`, { headers, data });
async function code(response: APIResponse, status: number, value: string) {
  expect(await body<{ code: string }>(response, status)).toMatchObject({
    code: value,
  });
}
async function ordinarySource(request: APIRequestContext) {
  const source = await createCaseExecutionFilingSourceThroughApi(request, {
    onComplaintSubmitted: grantHistoricalRecordFixtureActions,
  });
  return { ...source, detail: await detail(request, source.caseId) };
}
async function anotherRealClosure(request: APIRequestContext) {
  const source = await ordinarySource(request);
  const finished = await body<{ finishId: string; version: number }>(
    await post(request, source.caseId, 'execution-finish', {
      expectedVersion: source.detail.version,
      idempotencyKey: randomUUID(),
      expectedFilingId: source.detail.executionFiling.id,
      finishedAt: today(),
      reason: 'H另一真实结案来源',
      basisNote: null,
      basisContentVersionIds: [],
    }),
    201,
  );
  return body<{ closureId: string; closureVersionId: string }>(
    await post(request, source.caseId, 'closure', {
      expectedVersion: finished.version,
      idempotencyKey: randomUUID(),
      expectedFinishId: finished.finishId,
      closeAt: null,
      closeAmountState: 'PENDING',
      closeAmt: null,
      note: null,
      closeContentVersionIds: [],
    }),
    201,
  );
}
async function uploadHistoricalFile(
  request: APIRequestContext,
  caseId: string,
  category:
    | 'MAIL_RECEIPT'
    | 'FILING_EVIDENCE'
    | 'ACCEPTANCE_NOTICE'
    | 'JUDGMENT'
    | 'SECOND_INSTANCE_JUDGMENT',
) {
  const draft = await body<{ id: string }>(
    await request.post('/api/v1/materials/upload-drafts', {
      headers: operator,
      data: {
        ownerType: 'CASE',
        ownerId: caseId,
        category,
        purpose: category,
        originalFilename: `h-remand-${randomUUID()}.pdf`,
        declaredMimeType: 'application/pdf',
      },
    }),
    201,
  );
  return body<File>(
    await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
      headers: { ...operator, 'Content-Type': 'application/octet-stream' },
      data: closureBytes,
    }),
    200,
  );
}
async function scheduledJudgment(
  request: APIRequestContext,
  caseId: string,
  businessDate: string,
) {
  const before = await detail(request, caseId);
  await body(
    await post(request, caseId, 'hearing-schedule', {
      expectedVersion: before.version,
      idempotencyKey: randomUUID(),
      hearingAt: businessDate,
    }),
    201,
  );
  await expect
    .poll(async () => (await detail(request, caseId)).stage, {
      timeout: 30_000,
    })
    .toBe('WAITING_JUDGMENT');
  const due = await detail(request, caseId);
  const file = await uploadHistoricalFile(request, caseId, 'JUDGMENT');
  await body(
    await post(request, caseId, 'judgment-register', {
      expectedVersion: due.version,
      idempotencyKey: randomUUID(),
      judgmentReceivedAt: businessDate,
      judgmentAmountState: 'KNOWN',
      judgmentAmount: '10.00',
      paidLitigationFeeState: 'KNOWN',
      paidLitigationFee: '0.00',
      judgmentContentVersionIds: [file.contentVersionId],
    }),
    201,
  );
  return detail(request, caseId);
}
async function realRemandSource(request: APIRequestContext) {
  const source = await createSubmittedCaseThroughApi(request);
  const { caseId } = source;
  const business = new Date(`${today()}T00:00:00.000Z`);
  business.setUTCDate(business.getUTCDate() - 3);
  const businessDate = business.toISOString().slice(0, 10);
  await grantHistoricalRecordFixtureActions();
  let current = await detail(request, caseId);
  await body(
    await post(request, caseId, 'complaint-confirm', {
      expectedVersion: current.version,
      idempotencyKey: randomUUID(),
      confirmedComplaintContentVersionId: source.complaint.contentVersionId,
      amountState: 'KNOWN',
      amount: '10.00',
      pendingReason: null,
      confirmDisclose: true,
    }),
    201,
  );
  const mailing = await uploadHistoricalFile(request, caseId, 'MAIL_RECEIPT');
  current = await detail(request, caseId);
  await body(
    await post(request, caseId, 'complaint-mail', {
      expectedVersion: current.version,
      idempotencyKey: randomUUID(),
      mailedAt: businessDate,
      mailReceiptContentVersionIds: [mailing.contentVersionId],
    }),
    201,
  );
  const court = await body<{ id: string }>(
    await post(request, caseId, 'filing-courts', {
      name: `H真实重审来源法院-${randomUUID()}`,
    }),
    201,
  );
  const filing = await uploadHistoricalFile(request, caseId, 'FILING_EVIDENCE');
  current = await detail(request, caseId);
  await body(
    await post(request, caseId, 'filing-submit', {
      expectedVersion: current.version,
      idempotencyKey: randomUUID(),
      courtId: court.id,
      submittedAt: businessDate,
      filingEvidenceContentVersionIds: [filing.contentVersionId],
    }),
    201,
  );
  const notice = await uploadHistoricalFile(
    request,
    caseId,
    'ACCEPTANCE_NOTICE',
  );
  current = await detail(request, caseId);
  await body(
    await post(request, caseId, 'acceptance-register', {
      expectedVersion: current.version,
      idempotencyKey: randomUUID(),
      acceptedAt: businessDate,
      courtCaseNo: `H原轮-${randomUUID()}`,
      acceptanceNoticeContentVersionIds: [notice.contentVersionId],
    }),
    201,
  );
  const parent = await scheduledJudgment(request, caseId, businessDate);
  await body(
    await post(request, caseId, 'judgment-next-step', {
      expectedVersion: parent.version,
      idempotencyKey: randomUUID(),
      judgmentId: parent.judgment.current.id,
      next: 'APPEAL',
      plaintiffAppeals: true,
      defendantIds: [],
    }),
    201,
  );
  const appeal = await body<
    Detail & { judgmentNextStep: { current: { id: string } } }
  >(await request.get(`/api/v1/cases/${caseId}`, { headers: operator }));
  const resultFile = await uploadHistoricalFile(
    request,
    caseId,
    'SECOND_INSTANCE_JUDGMENT',
  );
  const result = await body<{
    currentTrialRoundId: string;
    version: number;
    resultId: string;
    stage: string;
  }>(
    await post(request, caseId, 'second-instance-result', {
      expectedVersion: appeal.version,
      idempotencyKey: randomUUID(),
      trialRoundId: parent.judgment.current.trialRoundId,
      choiceId: appeal.judgmentNextStep.current.id,
      expectedProgressId: null,
      progress: {
        hearingAt: null,
        hearingPlace: null,
        judgeName: null,
        documentContentVersionIds: [],
        serviceContentVersionIds: [],
      },
      result: 'REMAND',
      resultReceivedAt: businessDate,
      judgmentContentVersionIds: [resultFile.contentVersionId],
      paidLitigationFee: { state: 'PENDING', amount: null },
    }),
    201,
  );
  expect(result.stage).toBe('WAITING_FORMAL_ACCEPTANCE');
  expect(result.currentTrialRoundId).not.toBe(
    parent.judgment.current.trialRoundId,
  );
  const childNotice = await uploadHistoricalFile(
    request,
    caseId,
    'ACCEPTANCE_NOTICE',
  );
  await body(
    await post(request, caseId, 'acceptance-register', {
      expectedVersion: result.version,
      idempotencyKey: randomUUID(),
      acceptedAt: businessDate,
      courtCaseNo: `H子轮-${randomUUID()}`,
      acceptanceNoticeContentVersionIds: [childNotice.contentVersionId],
    }),
    201,
  );
  const child = await scheduledJudgment(request, caseId, businessDate);
  expect(child.judgment.current.trialRoundId).toBe(result.currentTrialRoundId);
  return { caseId, parent, child, result };
}

test.describe('historical section record corrections: isolated append-only API/PG acceptance', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });
  test.beforeAll(async () => {
    await grantHistoricalRecordFixtureActions();
  });

  test('real historical hearing/judgment edits preserve stage, original facts, receipts, execution source and files', async ({
    request,
  }) => {
    const source = await ordinarySource(request);
    const { caseId } = source;
    const original = source.detail;
    const frozen = await historicalRecordFrozenSnapshot(caseId);
    const target = original.judgment.current;
    const originalBytes = await Promise.all(
      target.files.map(async (file) => {
        const response = await request.get(
          `/api/v1/materials/${file.materialId}/versions/${file.contentVersionId}/content`,
          { headers: operator },
        );
        expect(response.status()).toBe(200);
        return response.body();
      }),
    );
    const judgmentInput = {
      judgmentId: target.id,
      trialRoundId: target.trialRoundId,
      expectedJudgmentRevision: 0,
      idempotencyKey: randomUUID(),
      reason: 'H验收：真实判决资料更正',
      judgmentReceivedAt: today(),
      judgmentAmountState: 'KNOWN',
      judgmentAmount: '1.00',
      paidLitigationFeeState: 'KNOWN',
      paidLitigationFee: '0.00',
      judgmentContentVersionIds: target.files.map(
        (file) => file.contentVersionId,
      ),
    };
    const judgment = await body<Correction>(
      await post(request, caseId, 'judgment-record-correction', judgmentInput),
      201,
    );
    expect(judgment).toMatchObject({ caseId, judgmentRevision: 1 });
    expect(judgment).not.toHaveProperty('stage');
    expect(judgment).not.toHaveProperty('version');
    expect(
      await body(
        await post(
          request,
          caseId,
          'judgment-record-correction',
          judgmentInput,
        ),
        201,
      ),
    ).toEqual(judgment);
    await code(
      await post(request, caseId, 'judgment-record-correction', {
        ...judgmentInput,
        judgmentAmount: '2.00',
      }),
      409,
      'IDEMPOTENCY_CONFLICT',
    );
    const arrangement = original.hearing.currentArrangement;
    const hearingInput = {
      arrangementId: arrangement.id,
      trialRoundId: arrangement.trialRoundId,
      expectedHearingRevision: 0,
      idempotencyKey: randomUUID(),
      reason: 'H验收：更正已有开庭日期',
      hearingAt: today(),
    };
    const hearing = await body<Correction>(
      await post(request, caseId, 'hearing-record-correction', hearingInput),
      201,
    );
    expect(hearing.hearingRevision).toBe(1);
    const updated = await detail(request, caseId);
    expect(updated.stage).toBe('EXECUTING');
    expect(updated.version).toBe(original.version);
    expect(updated.hearing.currentAdvance).toEqual(
      original.hearing.currentAdvance,
    );
    expect(
      updated.recordEdits.hearings.find(
        (entry) => entry.arrangementId === arrangement.id,
      ),
    ).toMatchObject({ hearingRevision: 1, effective: { hearingAt: today() } });
    expect(
      updated.recordEdits.judgments.find(
        (entry) => entry.judgmentId === target.id,
      ),
    ).toMatchObject({
      judgmentRevision: 1,
      effective: { judgmentAmount: '1.00', judgmentReceivedAt: today() },
    });
    expect(await historicalRecordFrozenSnapshot(caseId)).toEqual(frozen);
    for (const [index, file] of target.files.entries()) {
      const response = await request.get(
        `/api/v1/materials/${file.materialId}/versions/${file.contentVersionId}/content`,
        { headers: operator },
      );
      expect(response.status()).toBe(200);
      expect(await response.body()).toEqual(originalBytes[index]);
    }
    for (const phase of [
      'audit',
      'fact',
      'document',
      'reference',
      'receipt',
    ] as const) {
      const result = await withHistoricalRecordFault(
        caseId,
        'judgment',
        phase,
        () =>
          post(request, caseId, 'judgment-record-correction', {
            ...judgmentInput,
            expectedJudgmentRevision: 1,
            idempotencyKey: randomUUID(),
            judgmentAmount: '3.00',
          }),
      );
      expect(result).toMatchObject({ reached: true, unchanged: true });
      expect(result.status).toBeGreaterThanOrEqual(400);
    }
    expect(
      await historicalRecordMutationProbe(
        caseId,
        judgment.correctionId,
        'judgment',
      ),
    ).toMatchObject({ unchanged: true, code: '23514' });
    expect(
      await historicalRecordMutationProbe(
        caseId,
        hearing.correctionId,
        'hearing',
      ),
    ).toMatchObject({ unchanged: true, code: '23514' });
    await code(
      await post(request, caseId, 'hearing-record-correction', {
        ...hearingInput,
        idempotencyKey: randomUUID(),
        expectedHearingRevision: 1,
        hearingAt: null,
      }),
      400,
      'VALIDATION_ERROR',
    );
    await code(
      await post(
        request,
        caseId,
        'judgment-record-correction',
        judgmentInput,
        readOnly,
      ),
      403,
      'ACTION_FORBIDDEN',
    );
    const cross = await post(
      request,
      caseId,
      'judgment-record-correction',
      judgmentInput,
      foreign,
    );
    expect([403, 404]).toContain(cross.status());
  });

  test('real closure version advance with revision zero rejects stale/foreign anchors; archive retains exact frozen version', async ({
    request,
  }) => {
    const source = await ordinarySource(request);
    const { caseId } = source;
    const finished = await body<{ finishId: string; version: number }>(
      await post(request, caseId, 'execution-finish', {
        expectedVersion: source.detail.version,
        idempotencyKey: randomUUID(),
        expectedFilingId: source.detail.executionFiling.id,
        finishedAt: today(),
        reason: 'H合成执行结束',
        basisNote: null,
        basisContentVersionIds: [],
      }),
      201,
    );
    const closureFile = await uploadClosureDocument(request, caseId);
    const oldInput = {
      expectedVersion: finished.version,
      idempotencyKey: randomUUID(),
      expectedFinishId: finished.finishId,
      closeAt: null,
      closeAmountState: 'PENDING',
      closeAmt: null,
      note: null,
      closeContentVersionIds: [closureFile.contentVersionId],
    };
    const first = await body<{
      closureId: string;
      closureVersionId: string;
      version: number;
    }>(await post(request, caseId, 'closure', oldInput), 201);
    const legacy = await body<{
      closureId: string;
      closureVersionId: string;
      version: number;
    }>(
      await post(request, caseId, 'closure-correction', {
        ...oldInput,
        expectedVersion: first.version,
        expectedClosureVersionId: first.closureVersionId,
        idempotencyKey: randomUUID(),
        correctionReason: 'H验收原流程版本推进',
        note: '原流程真实第二版',
      }),
      201,
    );
    const input = {
      closureId: first.closureId,
      expectedClosureVersionId: first.closureVersionId,
      expectedClosureRevision: 0,
      idempotencyKey: randomUUID(),
      correctionReason: 'H验收精确结案资料',
      closeAt: source.detail.judgment.current.judgmentReceivedAt,
      closeAmountState: 'KNOWN',
      closeAmt: '0.00',
      note: '保留真实零',
      closeContentVersionIds: [closureFile.contentVersionId],
    };
    const another = await anotherRealClosure(request);
    const beforeRejected = await historicalRecordSectionSnapshot(caseId);
    await code(
      await post(request, caseId, 'closure-record-correction', input),
      409,
      'VERSION_CONFLICT',
    );
    await code(
      await post(request, caseId, 'closure-record-correction', {
        ...input,
        expectedClosureVersionId: another.closureVersionId,
      }),
      409,
      'VERSION_CONFLICT',
    );
    const invalid = { ...input } as Partial<typeof input>;
    delete invalid.expectedClosureVersionId;
    await code(
      await post(request, caseId, 'closure-record-correction', invalid),
      400,
      'VALIDATION_ERROR',
    );
    expect(await historicalRecordSectionSnapshot(caseId)).toEqual(
      beforeRejected,
    );
    const exact = {
      ...input,
      expectedClosureVersionId: legacy.closureVersionId,
    };
    const edited = await body<Correction>(
      await post(request, caseId, 'closure-record-correction', exact),
      201,
    );
    expect(edited.closureRevision).toBe(1);
    expect(
      await body(
        await post(request, caseId, 'closure-record-correction', exact),
        201,
      ),
    ).toEqual(edited);
    await code(
      await post(request, caseId, 'closure-record-correction', {
        ...exact,
        expectedClosureVersionId: first.closureVersionId,
      }),
      409,
      'IDEMPOTENCY_CONFLICT',
    );
    await code(
      await post(request, caseId, 'closure-correction', {
        ...oldInput,
        expectedVersion: legacy.version,
        expectedClosureVersionId: legacy.closureVersionId,
        idempotencyKey: randomUUID(),
        correctionReason: '拒绝旧表单覆盖',
      }),
      409,
      'VERSION_CONFLICT',
    );
    await body(
      await post(request, caseId, 'archive', {
        expectedVersion: legacy.version,
        expectedClosureVersionId: legacy.closureVersionId,
        idempotencyKey: randomUUID(),
        archiveAt: today(),
        archiveType: 'EXECUTION_CLOSED',
        archiveReason: 'H资料更正兼容验收',
      }),
      201,
    );
    const frozen = await historicalRecordFrozenSnapshot(caseId);
    const archived = await detail(request, caseId);
    const next = {
      ...exact,
      expectedClosureRevision: 1,
      idempotencyKey: randomUUID(),
      note: '归档后仅修正资料',
    };
    await body(
      await post(request, caseId, 'closure-record-correction', next),
      201,
    );
    const read = await detail(request, caseId);
    expect(read.stage).toBe('ARCHIVED');
    expect(read.version).toBe(archived.version);
    expect(read.archive).toEqual(archived.archive);
    expect(read.closure?.current.id).toBe(legacy.closureVersionId);
    expect(
      read.recordEdits.closures.find(
        (entry) => entry.closureId === first.closureId,
      ),
    ).toMatchObject({ closureRevision: 2, effective: { note: next.note } });
    expect(await historicalRecordFrozenSnapshot(caseId)).toEqual(frozen);
    const closureDownload = await request.get(
      `/api/v1/materials/${closureFile.materialId}/versions/${closureFile.contentVersionId}/content`,
      { headers: operator },
    );
    expect(closureDownload.status()).toBe(200);
    expect(await closureDownload.body()).toEqual(closureBytes);
    expect(
      await historicalRecordMutationProbe(
        caseId,
        edited.correctionId,
        'closure',
      ),
    ).toMatchObject({ unchanged: true, code: '23514' });
    const beforeCompetition = (await historicalRecordSectionSnapshot(
      caseId,
    )) as {
      case_closure_record_corrections: unknown[];
      case_section_record_edit_receipts: unknown[];
    };
    const competition = await Promise.all(
      ['竞争甲', '竞争乙'].map((note) =>
        post(request, caseId, 'closure-record-correction', {
          ...next,
          expectedClosureRevision: 2,
          idempotencyKey: randomUUID(),
          note,
        }),
      ),
    );
    expect(competition.map((response) => response.status()).sort()).toEqual([
      201, 409,
    ]);
    for (const response of competition) {
      if (response.status() === 409)
        await code(response, 409, 'VERSION_CONFLICT');
      else
        expect(await body<Correction>(response, 201)).toMatchObject({
          closureRevision: 3,
        });
    }
    const afterCompetition = (await historicalRecordSectionSnapshot(
      caseId,
    )) as {
      case_closure_record_corrections: unknown[];
      case_section_record_edit_receipts: unknown[];
    };
    expect(afterCompetition.case_closure_record_corrections).toHaveLength(
      beforeCompetition.case_closure_record_corrections.length + 1,
    );
    expect(afterCompetition.case_section_record_edit_receipts).toHaveLength(
      beforeCompetition.case_section_record_edit_receipts.length + 1,
    );
    for (const phase of [
      'audit',
      'fact',
      'document',
      'reference',
      'receipt',
    ] as const) {
      const result = await withHistoricalRecordFault(
        caseId,
        'closure',
        phase,
        () =>
          post(request, caseId, 'closure-record-correction', {
            ...next,
            expectedClosureRevision: 3,
            idempotencyKey: randomUUID(),
            note: `注入${phase}失败`,
          }),
      );
      expect(result).toMatchObject({ reached: true, unchanged: true });
      expect(result.status).toBeGreaterThanOrEqual(400);
    }
  });
  test('real REMAND child corrections require exact parent/child round and retain both original chains', async ({
    request,
  }) => {
    const { caseId, parent, child, result } = await realRemandSource(request);
    const frozen = await historicalRecordFrozenSnapshot(caseId);
    const childJudgment = {
      judgmentId: child.judgment.current.id,
      trialRoundId: child.judgment.current.trialRoundId,
      expectedJudgmentRevision: 0,
      idempotencyKey: randomUUID(),
      reason: 'H真实重审子轮判决更正',
      judgmentReceivedAt: today(),
      judgmentAmountState: 'KNOWN',
      judgmentAmount: '11.00',
      paidLitigationFeeState: 'KNOWN',
      paidLitigationFee: '0.00',
      judgmentContentVersionIds: child.judgment.current.files.map(
        (file) => file.contentVersionId,
      ),
    };
    const childHearing = {
      arrangementId: child.hearing.currentArrangement.id,
      trialRoundId: child.hearing.currentArrangement.trialRoundId,
      expectedHearingRevision: 0,
      idempotencyKey: randomUUID(),
      reason: 'H真实子轮开庭更正',
      hearingAt: today(),
    };
    await code(
      await post(request, caseId, 'judgment-record-correction', {
        ...childJudgment,
        trialRoundId: parent.judgment.current.trialRoundId,
      }),
      404,
      'RESOURCE_NOT_FOUND',
    );
    await code(
      await post(request, caseId, 'hearing-record-correction', {
        ...childHearing,
        trialRoundId: parent.hearing.currentArrangement.trialRoundId,
      }),
      404,
      'RESOURCE_NOT_FOUND',
    );
    await body(
      await post(request, caseId, 'judgment-record-correction', childJudgment),
      201,
    );
    await body(
      await post(request, caseId, 'hearing-record-correction', childHearing),
      201,
    );
    const parentInput = {
      ...childJudgment,
      judgmentId: parent.judgment.current.id,
      trialRoundId: parent.judgment.current.trialRoundId,
      judgmentReceivedAt: parent.judgment.current.judgmentReceivedAt,
      idempotencyKey: randomUUID(),
      judgmentContentVersionIds: parent.judgment.current.files.map(
        (file) => file.contentVersionId,
      ),
      judgmentAmount: '12.00',
      reason: 'H保留真实原轮资料',
    };
    await code(
      await post(request, caseId, 'judgment-record-correction', {
        ...parentInput,
        trialRoundId: result.currentTrialRoundId,
      }),
      404,
      'RESOURCE_NOT_FOUND',
    );
    await code(
      await post(request, caseId, 'judgment-record-correction', {
        ...parentInput,
        idempotencyKey: randomUUID(),
        judgmentReceivedAt: today(),
      }),
      400,
      'VALIDATION_ERROR',
    );
    await body(
      await post(request, caseId, 'judgment-record-correction', parentInput),
      201,
    );
    const updated = await detail(request, caseId);
    expect(updated.stage).toBe('WAITING_JUDGMENT');
    expect(updated.version).toBe(child.version);
    expect(updated.judgment.current.id).toBe(child.judgment.current.id);
    expect(updated.recordEdits.judgments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          judgmentId: parent.judgment.current.id,
          judgmentRevision: 1,
        }),
        expect.objectContaining({
          judgmentId: child.judgment.current.id,
          judgmentRevision: 1,
        }),
      ]),
    );
    expect(await historicalRecordFrozenSnapshot(caseId)).toEqual(frozen);
  });
});
