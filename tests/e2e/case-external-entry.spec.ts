import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  coreLeadFixtures,
  resetCoreLeadE2eData,
  setRoleGrant,
} from '../support/core-lead-database.mjs';
import { clearCaseArchiveFixture } from '../support/case-archive-database.mjs';
import { clearCaseClosureFixture } from '../support/case-closure-database.mjs';
import { clearCaseExecutionFinishFixture } from '../support/case-execution-finish-database.mjs';
import { clearCaseAcceptanceFixture } from '../support/case-acceptance-database.mjs';
import { clearCaseFilingFixture } from '../support/case-filing-database.mjs';
import { clearCaseComplaintMailingFixture } from '../support/case-complaint-mailing-database.mjs';
import {
  clearCoreCaseHearingAdmin,
  clearCoreCaseHearingAdminSessions,
} from '../support/case-hearing-database.mjs';
import { clearCoreCaseSecondInstanceFixture } from '../support/case-second-instance-database.mjs';
import {
  caseExternalEntrySnapshot,
  clearCaseExternalEntryFixture,
  setCaseExternalEntryGrant,
} from '../support/case-external-entry-database.mjs';

const operator = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const selfOnly = { Authorization: `Bearer ${coreLeadFixtures.tokenSelf}` };
const foreign = { Authorization: `Bearer ${coreLeadFixtures.tokenB}` };
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
] as const;
type Stage = (typeof stages)[number];
type Http = {
  status(): number;
  text(): Promise<string>;
  json(): Promise<unknown>;
};
type EntryInput = {
  idempotencyKey: string;
  entryKind: 'EXTERNAL_TRANSFER' | 'HISTORICAL_BACKFILL';
  initialStage: Stage;
  stageReachedOn: string;
  source: string;
  reason: string;
  customerId: string;
  rightsHolderId: string;
  defendants: Array<{ kind: 'PERSON' | 'ORGANIZATION'; name: string }>;
  lawyerAccountId: string | null;
  lawyerProfileId: string | null;
  known: {
    courtId: string | null;
    courtCaseNo: string | null;
    acceptedOn: string | null;
    secondInstanceAcceptedOn: string | null;
    platform: string | null;
    shopName: string | null;
    shopExternalId: string | null;
    caseType: string | null;
    infringementTypes: string[] | null;
  };
};
type Created = {
  id: string;
  businessNo: string;
  stage: Stage;
  version: 1;
  entryId: string;
  recordedAt: string;
};
type CaseView = {
  id: string;
  stage: Stage;
  version: number;
  sourceLead: unknown;
  sourceNotaryMatter: unknown;
  certificate: unknown;
  origin: {
    kind: 'EXTERNAL_ENTRY';
    entryId: string;
    entryKind: EntryInput['entryKind'];
    initialStage: Stage;
    stageReachedOn: string;
    source: string;
    reason?: string;
    recordedAt: string;
    recordedByUserId?: string;
    known: EntryInput['known'];
  };
  defendants: unknown[];
  currentTrialRoundId?: string | null;
  acceptance?: unknown;
  hearing?: unknown;
};

function shanghaiToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function shanghaiDaysAgo(days: number) {
  const date = new Date(`${shanghaiToday()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function input(stage: Stage, overrides: Partial<EntryInput> = {}): EntryInput {
  return {
    idempotencyKey: randomUUID(),
    entryKind: 'EXTERNAL_TRANSFER',
    initialStage: stage,
    stageReachedOn: shanghaiToday(),
    source: `CA018 E2E:${randomUUID()}`,
    reason: '合成验收：真实当前阶段转入',
    customerId: coreLeadFixtures.admittedCustomer,
    rightsHolderId: coreLeadFixtures.holder,
    defendants: [],
    lawyerAccountId: null,
    lawyerProfileId: null,
    known: {
      courtId: null,
      courtCaseNo: null,
      acceptedOn: null,
      secondInstanceAcceptedOn: null,
      platform: null,
      shopName: null,
      shopExternalId: null,
      caseType: null,
      infringementTypes: null,
    },
    ...overrides,
  };
}

async function body<T>(response: Http, status = 200): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json() as Promise<T>;
}

async function createEntry(
  request: APIRequestContext,
  payload: EntryInput,
  headers = operator,
) {
  return body<Created>(
    await request.post('/api/v1/cases/external-entries', {
      headers,
      data: payload,
    }),
    201,
  );
}

async function readCase(
  request: APIRequestContext,
  caseId: string,
  headers = operator,
) {
  return body<CaseView>(
    await request.get(`/api/v1/cases/${caseId}`, { headers }),
  );
}

async function uploadCaseFile(
  request: APIRequestContext,
  caseId: string,
  category: string,
  bytes: Buffer,
) {
  const draft = await body<{ id: string }>(
    await request.post('/api/v1/materials/upload-drafts', {
      headers: operator,
      data: {
        ownerType: 'CASE',
        ownerId: caseId,
        category,
        purpose: category,
        originalFilename: `ca018-${category}.pdf`,
        declaredMimeType: 'application/pdf',
      },
    }),
    201,
  );
  return body<{ materialId: string; contentVersionId: string }>(
    await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
      headers: { ...operator, 'Content-Type': 'application/octet-stream' },
      data: bytes,
    }),
    200,
  );
}

async function expectExactDownload(
  request: APIRequestContext,
  file: { materialId: string; contentVersionId: string },
  expectedBytes: Buffer,
) {
  const response = await request.get(
    `/api/v1/materials/${file.materialId}/versions/${file.contentVersionId}/content`,
    { headers: operator },
  );
  expect(response.status(), await response.text()).toBe(200);
  expect((await response.body()).equals(expectedBytes)).toBe(true);
}

async function clean() {
  await clearCaseArchiveFixture();
  await clearCaseClosureFixture();
  await clearCaseExecutionFinishFixture();
  await clearCoreCaseHearingAdminSessions();
  await clearCoreCaseSecondInstanceFixture();
  await clearCaseAcceptanceFixture();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
  await clearCaseExternalEntryFixture();
  await resetCoreLeadE2eData();
  await clearCoreCaseHearingAdmin();
  await setCaseExternalEntryGrant(
    coreLeadFixtures.roleA,
    'case.external-entry.create',
    'TEAM',
    true,
  );
  await setCaseExternalEntryGrant(
    coreLeadFixtures.roleA,
    'case.external-entry.archive',
    'DEPARTMENT',
    true,
  );
  await setRoleGrant(coreLeadFixtures.roleA, 'case.match', 'TEAM');
  await setRoleGrant(coreLeadFixtures.roleA, 'case.complaint.submit', 'TEAM');
  await setRoleGrant(coreLeadFixtures.roleA, 'case.complaint.confirm', 'TEAM');
  await setRoleGrant(coreLeadFixtures.roleA, 'case.complaint.mail', 'TEAM');
  await setRoleGrant(coreLeadFixtures.roleA, 'case.filing.submit', 'TEAM');
  await setRoleGrant(coreLeadFixtures.roleA, 'case.execution.finish', 'TEAM');
  await setRoleGrant(coreLeadFixtures.roleA, 'case.closure.record', 'TEAM');
  await setRoleGrant(coreLeadFixtures.roleA, 'case.archive', 'TEAM');
  await setRoleGrant(coreLeadFixtures.roleA, 'case.hearing.schedule', 'TEAM');
  await setRoleGrant(coreLeadFixtures.roleA, 'case.judgment.register', 'TEAM');
  await setRoleGrant(coreLeadFixtures.roleA, 'case.judgment.next_step', 'TEAM');
  await setRoleGrant(
    coreLeadFixtures.roleA,
    'case.second_instance.save',
    'TEAM',
  );
  await setRoleGrant(
    coreLeadFixtures.roleA,
    'case.second_instance.result',
    'TEAM',
  );
  await setRoleGrant(
    coreLeadFixtures.roleA,
    'case.acceptance.register',
    'TEAM',
  );
  await setRoleGrant(coreLeadFixtures.roleA, 'case.execution.submit', 'TEAM');
  await setRoleGrant(coreLeadFixtures.roleA, 'case.execution.confirm', 'TEAM');
  await setRoleGrant(coreLeadFixtures.roleA, 'case.execution.mail', 'TEAM');
  await setRoleGrant(
    coreLeadFixtures.roleA,
    'case.execution.filing.submit',
    'TEAM',
  );
}

async function sourceView(request: APIRequestContext, caseId: string) {
  return readCase(request, caseId);
}

async function submitComplaint(
  request: APIRequestContext,
  caseId: string,
  expectedVersion: number,
) {
  const complaintBytes = Buffer.from(
    '%PDF-1.7\nCA018 actual complaint content\n%%EOF\n',
  );
  const authorizationBytes = Buffer.from(
    '%PDF-1.7\nCA018 actual authorization content\n%%EOF\n',
  );
  const complaint = await uploadCaseFile(
    request,
    caseId,
    'COMPLAINT',
    complaintBytes,
  );
  const authorization = await uploadCaseFile(
    request,
    caseId,
    'AUTHORIZATION',
    authorizationBytes,
  );
  const submitted = await body<{ stage: string; version: number }>(
    await request.post(`/api/v1/cases/${caseId}/complaint-submit`, {
      headers: operator,
      data: {
        expectedVersion,
        idempotencyKey: randomUUID(),
        amountState: 'PENDING',
        amount: null,
        pendingReason: 'CA018 current submission amount awaits evidence',
        complaintContentVersionIds: [complaint.contentVersionId],
        authorizationContentVersionIds: [authorization.contentVersionId],
      },
    }),
    201,
  );
  return {
    submitted,
    complaint,
    complaintBytes,
    authorization,
    authorizationBytes,
  };
}

async function confirmComplaint(
  request: APIRequestContext,
  caseId: string,
  expectedVersion: number,
  complaintContentVersionId: string,
) {
  return body<{ stage: string; version: number }>(
    await request.post(`/api/v1/cases/${caseId}/complaint-confirm`, {
      headers: operator,
      data: {
        expectedVersion,
        idempotencyKey: randomUUID(),
        confirmedComplaintContentVersionId: complaintContentVersionId,
        amountState: 'KNOWN',
        amount: '123.45',
        pendingReason: null,
        confirmDisclose: true,
      },
    }),
    201,
  );
}

async function mailComplaint(
  request: APIRequestContext,
  caseId: string,
  expectedVersion: number,
) {
  const receiptBytes = Buffer.from(
    '%PDF-1.7\nCA018 actual complaint mail receipt\n%%EOF\n',
  );
  const receipt = await uploadCaseFile(
    request,
    caseId,
    'MAIL_RECEIPT',
    receiptBytes,
  );
  const result = await body<{ stage: string; version: number }>(
    await request.post(`/api/v1/cases/${caseId}/complaint-mail`, {
      headers: operator,
      data: {
        expectedVersion,
        idempotencyKey: randomUUID(),
        mailedAt: shanghaiToday(),
        mailReceiptContentVersionIds: [receipt.contentVersionId],
      },
    }),
    201,
  );
  return { result, receipt, receiptBytes };
}

async function submitFiling(
  request: APIRequestContext,
  caseId: string,
  expectedVersion: number,
) {
  const court = await createFilingCourt(request, caseId);
  const evidence = await uploadCaseFile(
    request,
    caseId,
    'FILING_EVIDENCE',
    Buffer.from('%PDF-1.7\nCA018 actual filing evidence\n%%EOF\n'),
  );
  const screenshot = await uploadCaseFile(
    request,
    caseId,
    'FILING_SCREENSHOT',
    Buffer.from('%PDF-1.7\nCA018 actual filing screenshot\n%%EOF\n'),
  );
  const result = await body<{
    stage: string;
    version: number;
    filingId: string;
  }>(
    await request.post(`/api/v1/cases/${caseId}/filing-submit`, {
      headers: operator,
      data: {
        expectedVersion,
        idempotencyKey: randomUUID(),
        courtId: court.id,
        submittedAt: shanghaiToday(),
        mediationNo: `CA018-${randomUUID().slice(0, 8)}`,
        filingEvidenceContentVersionIds: [evidence.contentVersionId],
        filingScreenshotContentVersionIds: [screenshot.contentVersionId],
      },
    }),
    201,
  );
  return {
    result,
    court,
    evidence,
    evidenceBytes: Buffer.from(
      '%PDF-1.7\nCA018 actual filing evidence\n%%EOF\n',
    ),
    screenshot,
    screenshotBytes: Buffer.from(
      '%PDF-1.7\nCA018 actual filing screenshot\n%%EOF\n',
    ),
  };
}

async function createFilingCourt(request: APIRequestContext, caseId: string) {
  return body<{ id: string; name?: string }>(
    await request.post(`/api/v1/cases/${caseId}/filing-courts`, {
      headers: operator,
      data: { name: `CA018 court ${randomUUID().slice(0, 8)}` },
    }),
    201,
  );
}

function acceptancePayload(
  expectedVersion: number,
  acceptedAt: string,
  courtCaseNo: string,
  noticeContentVersionId: string,
  courtId?: string,
) {
  return {
    expectedVersion,
    idempotencyKey: randomUUID(),
    acceptedAt,
    courtCaseNo,
    acceptanceNoticeContentVersionIds: [noticeContentVersionId],
    ...(courtId === undefined ? {} : { courtId }),
  };
}

async function submitAcceptance(
  request: APIRequestContext,
  caseId: string,
  payload: ReturnType<typeof acceptancePayload>,
) {
  return body<{
    stage: string;
    version: number;
    acceptanceId: string;
  }>(
    await request.post(`/api/v1/cases/${caseId}/acceptance-register`, {
      headers: operator,
      data: payload,
    }),
    201,
  );
}

async function submitExecution(
  request: APIRequestContext,
  caseId: string,
  expectedVersion: number,
) {
  const current = await sourceView(request, caseId);
  expect(current.currentTrialRoundId).toEqual(expect.any(String));
  const bytes = Buffer.from(
    '%PDF-1.7\nCA018 actual execution application bytes\n%%EOF\n',
  );
  const application = await uploadCaseFile(
    request,
    caseId,
    'EXECUTION_APPLICATION',
    bytes,
  );
  const result = await body<{
    submissionId: string;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${caseId}/execution-submit`, {
      headers: operator,
      data: {
        expectedVersion,
        idempotencyKey: randomUUID(),
        trialRoundId: current.currentTrialRoundId,
        judgmentNextStepId: null,
        secondInstanceResultId: null,
        expectedSubmissionId: null,
        executionApplicationContentVersionIds: [application.contentVersionId],
      },
    }),
    201,
  );
  return { result, application, bytes };
}

async function confirmExecution(
  request: APIRequestContext,
  caseId: string,
  expectedVersion: number,
  expectedSubmissionId: string | null,
  executionApplicationContentVersionIds?: string[],
) {
  return body<{ confirmationId: string; stage: string; version: number }>(
    await request.post(`/api/v1/cases/${caseId}/execution-confirm`, {
      headers: operator,
      data: {
        expectedVersion,
        idempotencyKey: randomUUID(),
        expectedSubmissionId,
        ...(expectedSubmissionId === null
          ? { executionApplicationContentVersionIds }
          : {}),
      },
    }),
    201,
  );
}

async function mailExecution(
  request: APIRequestContext,
  caseId: string,
  expectedVersion: number,
  expectedConfirmationId: string | null,
) {
  const receiptBytes = Buffer.from(
    '%PDF-1.7\nCA018 actual execution mail receipt\n%%EOF\n',
  );
  const receipt = await uploadCaseFile(
    request,
    caseId,
    'MAIL_RECEIPT',
    receiptBytes,
  );
  const result = await body<{
    mailingId: string;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${caseId}/execution-mail`, {
      headers: operator,
      data: {
        expectedVersion,
        idempotencyKey: randomUUID(),
        expectedConfirmationId,
        mailedAt: shanghaiToday(),
        mailReceiptContentVersionIds: [receipt.contentVersionId],
      },
    }),
    201,
  );
  return { result, receipt, receiptBytes };
}

async function submitExecutionFiling(
  request: APIRequestContext,
  caseId: string,
  expectedVersion: number,
  expectedMailingId: string | null,
) {
  const proofBytes = Buffer.from(
    '%PDF-1.7\nCA018 actual execution filing proof\n%%EOF\n',
  );
  const proof = await uploadCaseFile(
    request,
    caseId,
    'EXECUTION_FILING_PROOF',
    proofBytes,
  );
  const result = await body<{
    filingId: string;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${caseId}/execution-filing-submit`, {
      headers: operator,
      data: {
        expectedVersion,
        idempotencyKey: randomUUID(),
        expectedMailingId,
        submittedAt: shanghaiToday(),
        executionFilingProofContentVersionIds: [proof.contentVersionId],
      },
    }),
    201,
  );
  return { result, proof, proofBytes };
}

async function finishExecution(
  request: APIRequestContext,
  caseId: string,
  expectedVersion: number,
  expectedFilingId: string | null,
) {
  const basis = await uploadCaseFile(
    request,
    caseId,
    'EXECUTION_FINISH_BASIS',
    Buffer.from('%PDF-1.7\nCA018 actual execution finish basis\n%%EOF\n'),
  );
  const result = await body<{
    finishId: string;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${caseId}/execution-finish`, {
      headers: operator,
      data: {
        expectedVersion,
        idempotencyKey: randomUUID(),
        expectedFilingId,
        finishedAt: shanghaiToday(),
        reason: 'CA018 actual execution result recorded from current source',
        basisNote: null,
        basisContentVersionIds: [basis.contentVersionId],
      },
    }),
    201,
  );
  return { result, basis };
}

test.beforeEach(clean);
test.afterEach(clean);

test('creates all sixteen stages as explicit external roots without invented prior facts', async ({
  request,
}) => {
  test.setTimeout(180_000);
  for (const stage of stages) {
    const payload = input(stage);
    const created = await createEntry(request, payload);
    expect(created).toMatchObject({
      id: expect.any(String),
      businessNo: expect.any(String),
      stage,
      version: 1,
      entryId: expect.any(String),
      recordedAt: expect.any(String),
    });

    const current = await readCase(request, created.id);
    expect(current).toMatchObject({
      id: created.id,
      stage,
      version: 1,
      sourceLead: null,
      sourceNotaryMatter: null,
      certificate: null,
      origin: {
        kind: 'EXTERNAL_ENTRY',
        entryId: created.entryId,
        entryKind: payload.entryKind,
        initialStage: stage,
        stageReachedOn: payload.stageReachedOn,
        source: payload.source,
        reason: payload.reason,
        known: payload.known,
      },
    });
    if (stage === 'PENDING_MATCH') {
      expect(current.defendants).toEqual([]);
      expect(await caseExternalEntrySnapshot(created.id)).toMatchObject({
        entries: [expect.objectContaining({ initial_stage: stage })],
        receipts: [expect.objectContaining({ case_id: created.id })],
      });
    }
    if (stage === 'WAITING_HEARING') {
      expect(current.acceptance).toBeNull();
      expect(current.hearing).toBeNull();
      expect(current.currentTrialRoundId).toEqual(expect.any(String));
    }
  }
});

test('continues a PENDING_MATCH entry through real matching and actual complaint submission', async ({
  request,
}) => {
  const payload = input('PENDING_MATCH');
  const created = await createEntry(request, payload);
  const matched = await body<{ stage: string; version: number }>(
    await request.post(`/api/v1/cases/${created.id}/match`, {
      headers: operator,
      data: {
        expectedVersion: created.version,
        idempotencyKey: randomUUID(),
        matchedOn: payload.stageReachedOn,
        defendants: [{ kind: 'ORGANIZATION', name: 'CA018 合成被告' }],
        lawyer: { fullName: 'CA018 合成承办律师' },
      },
    }),
    201,
  );
  expect(matched).toMatchObject({ stage: 'WAITING_COMPLAINT', version: 2 });

  const materials: string[] = [];
  for (const purpose of ['COMPLAINT', 'AUTHORIZATION']) {
    const draft = await body<{ id: string }>(
      await request.post('/api/v1/materials/upload-drafts', {
        headers: operator,
        data: {
          ownerType: 'CASE',
          ownerId: created.id,
          category: purpose,
          purpose,
          originalFilename: `ca018-${purpose}.pdf`,
          declaredMimeType: 'application/pdf',
        },
      }),
      201,
    );
    const uploaded = await body<{ contentVersionId: string }>(
      await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
        headers: { ...operator, 'Content-Type': 'application/octet-stream' },
        data: Buffer.from(
          `%PDF-1.4\nCA018 ${purpose} real uploaded bytes\n%%EOF\n`,
        ),
      }),
      200,
    );
    materials.push(uploaded.contentVersionId);
  }
  const submitted = await body<{ stage: string; version: number }>(
    await request.post(`/api/v1/cases/${created.id}/complaint-submit`, {
      headers: operator,
      data: {
        expectedVersion: matched.version,
        idempotencyKey: randomUUID(),
        amountState: 'PENDING',
        amount: null,
        pendingReason: '等待真实金额材料',
        complaintContentVersionIds: [materials[0]],
        authorizationContentVersionIds: [materials[1]],
      },
    }),
    201,
  );
  expect(submitted).toMatchObject({
    stage: 'WAITING_COMPLAINT_CONFIRMATION',
    version: 3,
  });
  const current = await readCase(request, created.id);
  expect(current.origin).toMatchObject({
    kind: 'EXTERNAL_ENTRY',
    entryId: created.entryId,
    initialStage: 'PENDING_MATCH',
  });
});

test('continues the three complaint roots through their real next action with source lineage intact', async ({
  request,
}) => {
  const complaintRoot = await createEntry(
    request,
    input('WAITING_COMPLAINT', {
      defendants: [
        { kind: 'ORGANIZATION', name: 'CA018 complaint-stage defendant' },
      ],
    }),
  );
  const submitted = await submitComplaint(request, complaintRoot.id, 1);
  expect(submitted.submitted).toMatchObject({
    stage: 'WAITING_COMPLAINT_CONFIRMATION',
    version: 2,
  });
  const confirmed = await confirmComplaint(
    request,
    complaintRoot.id,
    submitted.submitted.version,
    submitted.complaint.contentVersionId,
  );
  expect(confirmed).toMatchObject({
    stage: 'WAITING_COMPLAINT_STAMP',
    version: 3,
  });
  await expectExactDownload(
    request,
    submitted.complaint,
    submitted.complaintBytes,
  );
  await expectExactDownload(
    request,
    submitted.authorization,
    submitted.authorizationBytes,
  );
  expect((await sourceView(request, complaintRoot.id)).origin).toMatchObject({
    entryId: complaintRoot.entryId,
    initialStage: 'WAITING_COMPLAINT',
  });

  const confirmationRoot = await createEntry(
    request,
    input('WAITING_COMPLAINT_CONFIRMATION', {
      defendants: [
        { kind: 'ORGANIZATION', name: 'CA018 confirmation defendant' },
      ],
    }),
  );
  const currentComplaintBytes = Buffer.from(
    '%PDF-1.7\nCA018 uploaded current complaint at confirmation root\n%%EOF\n',
  );
  const currentComplaint = await uploadCaseFile(
    request,
    confirmationRoot.id,
    'COMPLAINT',
    currentComplaintBytes,
  );
  const directConfirmation = await confirmComplaint(
    request,
    confirmationRoot.id,
    confirmationRoot.version,
    currentComplaint.contentVersionId,
  );
  expect(directConfirmation).toMatchObject({
    stage: 'WAITING_COMPLAINT_STAMP',
    version: 2,
  });
  const mailedAfterConfirmation = await mailComplaint(
    request,
    confirmationRoot.id,
    directConfirmation.version,
  );
  expect(mailedAfterConfirmation.result).toMatchObject({
    stage: 'WAITING_FILING',
    version: 3,
  });
  await expectExactDownload(
    request,
    mailedAfterConfirmation.receipt,
    mailedAfterConfirmation.receiptBytes,
  );

  const stampRoot = await createEntry(
    request,
    input('WAITING_COMPLAINT_STAMP', {
      defendants: [
        { kind: 'ORGANIZATION', name: 'CA018 complaint-stamp defendant' },
      ],
    }),
  );
  const mailedFromStamp = await mailComplaint(request, stampRoot.id, 1);
  expect(mailedFromStamp.result).toMatchObject({
    stage: 'WAITING_FILING',
    version: 2,
  });
  await expectExactDownload(
    request,
    mailedFromStamp.receipt,
    mailedFromStamp.receiptBytes,
  );
  const filedAfterMail = await submitFiling(
    request,
    stampRoot.id,
    mailedFromStamp.result.version,
  );
  expect(filedAfterMail.result).toMatchObject({
    stage: 'WAITING_FORMAL_ACCEPTANCE',
    version: 3,
  });
  await expectExactDownload(
    request,
    filedAfterMail.evidence,
    filedAfterMail.evidenceBytes,
  );
  await expectExactDownload(
    request,
    filedAfterMail.screenshot,
    filedAfterMail.screenshotBytes,
  );

  for (const [caseId, entryId, initialStage] of [
    [complaintRoot.id, complaintRoot.entryId, 'WAITING_COMPLAINT'],
    [
      confirmationRoot.id,
      confirmationRoot.entryId,
      'WAITING_COMPLAINT_CONFIRMATION',
    ],
    [stampRoot.id, stampRoot.entryId, 'WAITING_COMPLAINT_STAMP'],
  ] as const) {
    const final = await sourceView(request, caseId);
    expect(final.origin).toMatchObject({
      kind: 'EXTERNAL_ENTRY',
      entryId,
      initialStage,
    });
    expect(final.sourceLead).toBeNull();
    expect(final.sourceNotaryMatter).toBeNull();
    expect(final.certificate).toBeNull();
  }
  const downloaded = await request.get(
    `/api/v1/materials/${currentComplaint.materialId}/versions/${currentComplaint.contentVersionId}/content`,
    { headers: operator },
  );
  expect(downloaded.status(), await downloaded.text()).toBe(200);
  expect((await downloaded.body()).equals(currentComplaintBytes)).toBe(true);
});

test('continues filing and acceptance roots through real command successors', async ({
  request,
}) => {
  const filingRoot = await createEntry(
    request,
    input('WAITING_FILING', {
      defendants: [{ kind: 'ORGANIZATION', name: 'CA018 filing defendant' }],
    }),
  );
  const filing = await submitFiling(request, filingRoot.id, filingRoot.version);
  expect(filing.result).toMatchObject({
    stage: 'WAITING_FORMAL_ACCEPTANCE',
    version: 2,
  });
  const filingNotice = await uploadCaseFile(
    request,
    filingRoot.id,
    'ACCEPTANCE_NOTICE',
    Buffer.from('%PDF-1.7\nCA018 actual acceptance notice\n%%EOF\n'),
  );
  const filingSnapshot = await caseExternalEntrySnapshot(filingRoot.id);
  const filingAcceptanceFields = acceptancePayload(
    filing.result.version,
    shanghaiToday(),
    `CA018-${randomUUID().slice(0, 8)}`,
    filingNotice.contentVersionId,
  );
  const suppliedCourt = await request.post(
    `/api/v1/cases/${filingRoot.id}/acceptance-register`,
    {
      headers: operator,
      data: { ...filingAcceptanceFields, courtId: filing.court.id },
    },
  );
  expect(suppliedCourt.status(), await suppliedCourt.text()).toBe(400);
  expect(await caseExternalEntrySnapshot(filingRoot.id)).toEqual(
    filingSnapshot,
  );
  const acceptanceAfterFiling = await submitAcceptance(
    request,
    filingRoot.id,
    filingAcceptanceFields,
  );
  expect(acceptanceAfterFiling).toMatchObject({
    stage: 'WAITING_HEARING',
    version: 3,
  });
  await expectExactDownload(
    request,
    filingNotice,
    Buffer.from('%PDF-1.7\nCA018 actual acceptance notice\n%%EOF\n'),
  );

  const acceptanceDate = shanghaiDaysAgo(1);
  const courtSeed = await createEntry(
    request,
    input('WAITING_FILING', {
      defendants: [
        { kind: 'ORGANIZATION', name: 'CA018 acceptance court seed' },
      ],
    }),
  );
  const acceptanceCourt = await createFilingCourt(request, courtSeed.id);
  const firstInstanceAcceptedOn = shanghaiDaysAgo(3);
  const acceptanceRoot = await createEntry(
    request,
    input('WAITING_FORMAL_ACCEPTANCE', {
      stageReachedOn: acceptanceDate,
      known: {
        courtId: acceptanceCourt.id,
        courtCaseNo: `CA018-FIRST-${randomUUID().slice(0, 8)}`,
        acceptedOn: firstInstanceAcceptedOn,
        secondInstanceAcceptedOn: null,
        platform: null,
        shopName: null,
        shopExternalId: null,
        caseType: null,
        infringementTypes: null,
      },
      defendants: [
        { kind: 'ORGANIZATION', name: 'CA018 acceptance defendant' },
      ],
    }),
  );
  const rootNotice = await uploadCaseFile(
    request,
    acceptanceRoot.id,
    'ACCEPTANCE_NOTICE',
    Buffer.from('%PDF-1.7\nCA018 direct external acceptance notice\n%%EOF\n'),
  );
  const rootAcceptanceFields = acceptancePayload(
    acceptanceRoot.version,
    acceptanceDate,
    `CA018-ROOT-${randomUUID().slice(0, 8)}`,
    rootNotice.contentVersionId,
  );
  const rootSnapshot = await caseExternalEntrySnapshot(acceptanceRoot.id);
  const missingCourt = await request.post(
    `/api/v1/cases/${acceptanceRoot.id}/acceptance-register`,
    { headers: operator, data: rootAcceptanceFields },
  );
  expect(missingCourt.status(), await missingCourt.text()).toBe(400);
  expect(await caseExternalEntrySnapshot(acceptanceRoot.id)).toEqual(
    rootSnapshot,
  );
  const accepted = await submitAcceptance(request, acceptanceRoot.id, {
    ...rootAcceptanceFields,
    courtId: acceptanceCourt.id,
  });
  expect(accepted).toMatchObject({
    stage: 'WAITING_HEARING',
    version: 2,
  });
  const scheduled = await body<{
    stage: string;
    version: number;
    arrangementId: string;
  }>(
    await request.post(`/api/v1/cases/${acceptanceRoot.id}/hearing-schedule`, {
      headers: operator,
      data: {
        expectedVersion: accepted.version,
        idempotencyKey: randomUUID(),
        hearingAt: acceptanceDate,
      },
    }),
    201,
  );
  expect(scheduled).toMatchObject({ stage: 'WAITING_HEARING', version: 3 });
  await expectExactDownload(
    request,
    rootNotice,
    Buffer.from('%PDF-1.7\nCA018 direct external acceptance notice\n%%EOF\n'),
  );
  await expect
    .poll(async () => (await sourceView(request, acceptanceRoot.id)).stage, {
      timeout: 30_000,
    })
    .toBe('WAITING_JUDGMENT');
  const final = await sourceView(request, acceptanceRoot.id);
  expect(final.origin).toMatchObject({
    kind: 'EXTERNAL_ENTRY',
    entryId: acceptanceRoot.entryId,
    initialStage: 'WAITING_FORMAL_ACCEPTANCE',
  });
  expect(final.sourceLead).toBeNull();
  expect(final.sourceNotaryMatter).toBeNull();
  expect(final.certificate).toBeNull();
});

test('continues a WAITING_JUDGMENT entry through a real judgment and linked execution choice', async ({
  request,
}) => {
  const created = await createEntry(
    request,
    input('WAITING_JUDGMENT', {
      defendants: [{ kind: 'ORGANIZATION', name: 'CA018 judgment defendant' }],
    }),
  );
  const judgmentBytes = Buffer.from(
    '%PDF-1.7\nCA018 actual judgment registered from external current round\n%%EOF\n',
  );
  const judgmentFile = await uploadCaseFile(
    request,
    created.id,
    'JUDGMENT',
    judgmentBytes,
  );
  const judgment = await body<{
    judgmentId: string;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${created.id}/judgment-register`, {
      headers: operator,
      data: {
        expectedVersion: created.version,
        idempotencyKey: randomUUID(),
        judgmentReceivedAt: shanghaiToday(),
        judgmentAmountState: 'PENDING',
        judgmentAmount: null,
        paidLitigationFeeState: 'PENDING',
        paidLitigationFee: null,
        judgmentContentVersionIds: [judgmentFile.contentVersionId],
      },
    }),
    201,
  );
  expect(judgment).toMatchObject({ stage: 'WAITING_JUDGMENT', version: 2 });
  const choice = await body<{
    stage: string;
    version: number;
    choiceId: string;
  }>(
    await request.post(`/api/v1/cases/${created.id}/judgment-next-step`, {
      headers: operator,
      data: {
        expectedVersion: judgment.version,
        idempotencyKey: randomUUID(),
        judgmentId: judgment.judgmentId,
        next: 'EXECUTION',
        executionReadinessConfirmed: true,
      },
    }),
    201,
  );
  expect(choice).toMatchObject({
    stage: 'WAITING_EXECUTION_DOCUMENTS',
    version: 3,
    choiceId: expect.any(String),
  });
  expect((await sourceView(request, created.id)).origin).toMatchObject({
    kind: 'EXTERNAL_ENTRY',
    entryId: created.entryId,
    initialStage: 'WAITING_JUDGMENT',
  });
  const downloaded = await request.get(
    `/api/v1/materials/${judgmentFile.materialId}/versions/${judgmentFile.contentVersionId}/content`,
    { headers: operator },
  );
  expect(downloaded.status(), await downloaded.text()).toBe(200);
  expect((await downloaded.body()).equals(judgmentBytes)).toBe(true);
});

test('continues all four execution roots with nullable first predecessors and real IDs on every next step', async ({
  request,
}) => {
  const documentsRoot = await createEntry(
    request,
    input('WAITING_EXECUTION_DOCUMENTS'),
  );
  const submitted = await submitExecution(
    request,
    documentsRoot.id,
    documentsRoot.version,
  );
  expect(submitted.result).toMatchObject({
    stage: 'WAITING_EXECUTION_CONFIRMATION',
    version: 2,
  });
  const confirmedSubmitted = await confirmExecution(
    request,
    documentsRoot.id,
    submitted.result.version,
    submitted.result.submissionId,
  );
  expect(confirmedSubmitted).toMatchObject({
    stage: 'WAITING_EXECUTION_STAMP',
    version: 3,
  });
  await expectExactDownload(request, submitted.application, submitted.bytes);

  const confirmationRoot = await createEntry(
    request,
    input('WAITING_EXECUTION_CONFIRMATION'),
  );
  const confirmationApplicationBytes = Buffer.from(
    '%PDF-1.7\nCA018 actual application proof for direct confirmation root\n%%EOF\n',
  );
  const confirmationApplication = await uploadCaseFile(
    request,
    confirmationRoot.id,
    'EXECUTION_APPLICATION',
    confirmationApplicationBytes,
  );
  const directConfirmation = await confirmExecution(
    request,
    confirmationRoot.id,
    confirmationRoot.version,
    null,
    [confirmationApplication.contentVersionId],
  );
  expect(directConfirmation).toMatchObject({
    stage: 'WAITING_EXECUTION_STAMP',
    version: 2,
  });
  const mailedAfterConfirmation = await mailExecution(
    request,
    confirmationRoot.id,
    directConfirmation.version,
    directConfirmation.confirmationId,
  );
  expect(mailedAfterConfirmation.result).toMatchObject({
    stage: 'WAITING_EXECUTION_FILING',
    version: 3,
  });
  await expectExactDownload(
    request,
    mailedAfterConfirmation.receipt,
    mailedAfterConfirmation.receiptBytes,
  );
  const exactApplication = await request.get(
    `/api/v1/materials/${confirmationApplication.materialId}/versions/${confirmationApplication.contentVersionId}/content`,
    { headers: operator },
  );
  expect(exactApplication.status(), await exactApplication.text()).toBe(200);
  expect(
    (await exactApplication.body()).equals(confirmationApplicationBytes),
  ).toBe(true);

  const stampRoot = await createEntry(
    request,
    input('WAITING_EXECUTION_STAMP'),
  );
  const mailedFromStamp = await mailExecution(
    request,
    stampRoot.id,
    stampRoot.version,
    null,
  );
  expect(mailedFromStamp.result).toMatchObject({
    stage: 'WAITING_EXECUTION_FILING',
    version: 2,
  });
  const filedAfterMail = await submitExecutionFiling(
    request,
    stampRoot.id,
    mailedFromStamp.result.version,
    mailedFromStamp.result.mailingId,
  );
  expect(filedAfterMail.result).toMatchObject({
    stage: 'EXECUTING',
    version: 3,
  });
  await expectExactDownload(
    request,
    filedAfterMail.proof,
    filedAfterMail.proofBytes,
  );

  const filingRoot = await createEntry(
    request,
    input('WAITING_EXECUTION_FILING'),
  );
  const filed = await submitExecutionFiling(
    request,
    filingRoot.id,
    filingRoot.version,
    null,
  );
  expect(filed.result).toMatchObject({ stage: 'EXECUTING', version: 2 });
  const finished = await finishExecution(
    request,
    filingRoot.id,
    filed.result.version,
    filed.result.filingId,
  );
  expect(finished.result).toMatchObject({
    stage: 'WAITING_ARCHIVE',
    version: 3,
  });
  const closureFile = await uploadCaseFile(
    request,
    filingRoot.id,
    'CASE_CLOSURE_DOCUMENT',
    Buffer.from('%PDF-1.7\nCA018 closure after actual finish\n%%EOF\n'),
  );
  const closure = await body<{
    finishId: string;
    closureVersionId: string;
    version: number;
    stage: string;
  }>(
    await request.post(`/api/v1/cases/${filingRoot.id}/closure`, {
      headers: operator,
      data: {
        expectedVersion: finished.result.version,
        idempotencyKey: randomUUID(),
        expectedFinishId: finished.result.finishId,
        closeAt: null,
        closeAmountState: 'PENDING',
        closeAmt: null,
        note: 'CA018 closure follows the actual returned finish fact',
        closeContentVersionIds: [closureFile.contentVersionId],
      },
    }),
    201,
  );
  expect(closure).toMatchObject({
    finishId: finished.result.finishId,
    stage: 'WAITING_ARCHIVE',
    version: 4,
  });
  const archived = await body<{ stage: string; version: number }>(
    await request.post(`/api/v1/cases/${filingRoot.id}/archive`, {
      headers: operator,
      data: {
        expectedVersion: closure.version,
        idempotencyKey: randomUUID(),
        expectedClosureVersionId: closure.closureVersionId,
        archiveAt: shanghaiToday(),
        archiveType: 'EXECUTION_CLOSED',
        archiveReason: 'CA018 archive follows real finish and closure IDs',
      },
    }),
    201,
  );
  expect(archived).toMatchObject({ stage: 'ARCHIVED', version: 5 });
  await expectExactDownload(
    request,
    closureFile,
    Buffer.from('%PDF-1.7\nCA018 closure after actual finish\n%%EOF\n'),
  );

  for (const entry of [
    documentsRoot,
    confirmationRoot,
    stampRoot,
    filingRoot,
  ]) {
    const final = await sourceView(request, entry.id);
    expect(final.origin).toMatchObject({
      kind: 'EXTERNAL_ENTRY',
      entryId: entry.entryId,
      initialStage: entry.stage,
    });
    expect(final.sourceLead).toBeNull();
    expect(final.sourceNotaryMatter).toBeNull();
    expect(final.certificate).toBeNull();
  }
  const downloaded = await request.get(
    `/api/v1/materials/${submitted.application.materialId}/versions/${submitted.application.contentVersionId}/content`,
    { headers: operator },
  );
  expect(downloaded.status(), await downloaded.text()).toBe(200);
  expect((await downloaded.body()).equals(submitted.bytes)).toBe(true);
});

test('continues a direct WAITING_ARCHIVE root with null only for its absent finish, then archives the real closure', async ({
  request,
}) => {
  const created = await createEntry(request, input('WAITING_ARCHIVE'));
  const bytes = Buffer.from(
    '%PDF-1.7\nCA018 direct archive-entry closure document bytes\n%%EOF\n',
  );
  const document = await uploadCaseFile(
    request,
    created.id,
    'CASE_CLOSURE_DOCUMENT',
    bytes,
  );
  const before = await caseExternalEntrySnapshot(created.id);
  const missingFinish = await request.post(
    `/api/v1/cases/${created.id}/closure`,
    {
      headers: operator,
      data: {
        expectedVersion: created.version,
        idempotencyKey: randomUUID(),
        expectedFinishId: randomUUID(),
        closeAt: null,
        closeAmountState: 'PENDING',
        closeAmt: null,
        note: null,
        closeContentVersionIds: [document.contentVersionId],
      },
    },
  );
  expect([400, 409], await missingFinish.text()).toContain(
    missingFinish.status(),
  );
  expect(await caseExternalEntrySnapshot(created.id)).toEqual(before);

  const closure = await body<{
    finishId: string | null;
    closureVersionId: string;
    version: number;
    stage: string;
  }>(
    await request.post(`/api/v1/cases/${created.id}/closure`, {
      headers: operator,
      data: {
        expectedVersion: created.version,
        idempotencyKey: randomUUID(),
        expectedFinishId: null,
        closeAt: null,
        closeAmountState: 'PENDING',
        closeAmt: null,
        note: 'CA018 source root directly reached closure state',
        closeContentVersionIds: [document.contentVersionId],
      },
    }),
    201,
  );
  expect(closure).toMatchObject({
    finishId: null,
    stage: 'WAITING_ARCHIVE',
    version: created.version + 1,
  });
  const archived = await body<{ stage: string; version: number }>(
    await request.post(`/api/v1/cases/${created.id}/archive`, {
      headers: operator,
      data: {
        expectedVersion: closure.version,
        idempotencyKey: randomUUID(),
        expectedClosureVersionId: closure.closureVersionId,
        archiveAt: shanghaiToday(),
        archiveType: 'EXECUTION_CLOSED',
        archiveReason: 'CA018 archive after direct-root closure',
      },
    }),
    201,
  );
  expect(archived.stage).toBe('ARCHIVED');
  expect((await sourceView(request, created.id)).origin).toMatchObject({
    kind: 'EXTERNAL_ENTRY',
    entryId: created.entryId,
    initialStage: 'WAITING_ARCHIVE',
  });
  const downloaded = await request.get(
    `/api/v1/materials/${document.materialId}/versions/${document.contentVersionId}/content`,
    { headers: operator },
  );
  expect(downloaded.status(), await downloaded.text()).toBe(200);
  expect((await downloaded.body()).equals(bytes)).toBe(true);
});

test('continues an EXECUTING entry through real finish, closure, archive, and exact file downloads', async ({
  request,
}) => {
  const payload = input('EXECUTING');
  const created = await createEntry(request, payload);
  const finishBytes = Buffer.from(
    '%PDF-1.7\nCA018 real execution finish basis bytes\n%%EOF\n',
  );
  const finishFile = await uploadCaseFile(
    request,
    created.id,
    'EXECUTION_FINISH_BASIS',
    finishBytes,
  );
  const finished = await body<{
    finishId: string;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${created.id}/execution-finish`, {
      headers: operator,
      data: {
        expectedVersion: created.version,
        idempotencyKey: randomUUID(),
        expectedFilingId: null,
        finishedAt: shanghaiToday(),
        reason: 'CA018 合成验收中的真实执行终结',
        basisNote: null,
        basisContentVersionIds: [finishFile.contentVersionId],
      },
    }),
    201,
  );
  expect(finished).toMatchObject({ stage: 'WAITING_ARCHIVE', version: 2 });

  const closureBytes = Buffer.from(
    '%PDF-1.7\nCA018 real closure source bytes\n%%EOF\n',
  );
  const closureFile = await uploadCaseFile(
    request,
    created.id,
    'CASE_CLOSURE_DOCUMENT',
    closureBytes,
  );
  const beforeClosure = await caseExternalEntrySnapshot(created.id);
  for (const expectedFinishId of [null, randomUUID()]) {
    const rejectedClosure = await request.post(
      `/api/v1/cases/${created.id}/closure`,
      {
        headers: operator,
        data: {
          expectedVersion: finished.version,
          idempotencyKey: randomUUID(),
          expectedFinishId,
          closeAt: null,
          closeAmountState: 'PENDING',
          closeAmt: null,
          note: '必须引用刚刚真实登记的执行结束事实',
          closeContentVersionIds: [closureFile.contentVersionId],
        },
      },
    );
    expect([400, 409], await rejectedClosure.text()).toContain(
      rejectedClosure.status(),
    );
    expect(await caseExternalEntrySnapshot(created.id)).toEqual(beforeClosure);
  }
  const closure = await body<{
    closureVersionId: string;
    finishId: string;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${created.id}/closure`, {
      headers: operator,
      data: {
        expectedVersion: finished.version,
        idempotencyKey: randomUUID(),
        expectedFinishId: finished.finishId,
        closeAt: null,
        closeAmountState: 'PENDING',
        closeAmt: null,
        note: '执行结束后登记当前真实结案资料',
        closeContentVersionIds: [closureFile.contentVersionId],
      },
    }),
    201,
  );
  expect(closure).toMatchObject({
    finishId: finished.finishId,
    stage: 'WAITING_ARCHIVE',
    version: 3,
  });

  const archived = await body<{ stage: string; version: number }>(
    await request.post(`/api/v1/cases/${created.id}/archive`, {
      headers: operator,
      data: {
        expectedVersion: closure.version,
        idempotencyKey: randomUUID(),
        expectedClosureVersionId: closure.closureVersionId,
        archiveAt: shanghaiToday(),
        archiveType: 'EXECUTION_CLOSED',
        archiveReason: '当前案件已完成真实结案资料登记',
      },
    }),
    201,
  );
  expect(archived).toMatchObject({ stage: 'ARCHIVED', version: 4 });

  const final = await readCase(request, created.id);
  expect(final).toMatchObject({
    stage: 'ARCHIVED',
    version: 4,
    sourceLead: null,
    sourceNotaryMatter: null,
    certificate: null,
    origin: {
      kind: 'EXTERNAL_ENTRY',
      entryId: created.entryId,
      initialStage: 'EXECUTING',
    },
  });
  for (const [file, expectedBytes] of [
    [finishFile, finishBytes],
    [closureFile, closureBytes],
  ] as const) {
    const downloaded = await request.get(
      `/api/v1/materials/${file.materialId}/versions/${file.contentVersionId}/content`,
      { headers: operator },
    );
    expect(downloaded.status(), await downloaded.text()).toBe(200);
    expect((await downloaded.body()).equals(expectedBytes)).toBe(true);
  }
});

test('continues a WAITING_HEARING entry with an actual hearing, system advance, judgment, and execution choice', async ({
  request,
}) => {
  const reachedOn = shanghaiDaysAgo(2);
  const created = await createEntry(
    request,
    input('WAITING_HEARING', { stageReachedOn: reachedOn }),
  );
  const hearingAt = shanghaiDaysAgo(1);
  const scheduled = await body<{
    arrangementId: string;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${created.id}/hearing-schedule`, {
      headers: operator,
      data: {
        expectedVersion: created.version,
        idempotencyKey: randomUUID(),
        hearingAt,
      },
    }),
    201,
  );
  expect(scheduled).toMatchObject({
    stage: 'WAITING_HEARING',
    version: created.version + 1,
  });

  await expect
    .poll(async () => (await readCase(request, created.id)).stage, {
      timeout: 30_000,
    })
    .toBe('WAITING_JUDGMENT');
  const afterHearing = await readCase(request, created.id);
  expect(afterHearing.currentTrialRoundId).toEqual(expect.any(String));
  expect(afterHearing.origin).toMatchObject({
    kind: 'EXTERNAL_ENTRY',
    entryId: created.entryId,
    initialStage: 'WAITING_HEARING',
  });
  const hearing = afterHearing.hearing as {
    currentArrangement: { id: string; hearingAt: string };
    currentAdvance: { id: string; arrangementId: string };
  };
  expect(hearing).toMatchObject({
    currentArrangement: { id: scheduled.arrangementId, hearingAt },
    currentAdvance: {
      id: expect.any(String),
      arrangementId: scheduled.arrangementId,
    },
  });

  const judgmentBytes = Buffer.from(
    '%PDF-1.7\nCA018 actual judgment document bytes\n%%EOF\n',
  );
  const judgmentFile = await uploadCaseFile(
    request,
    created.id,
    'JUDGMENT',
    judgmentBytes,
  );
  const judgment = await body<{
    judgmentId: string;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${created.id}/judgment-register`, {
      headers: operator,
      data: {
        expectedVersion: afterHearing.version,
        idempotencyKey: randomUUID(),
        judgmentReceivedAt: shanghaiToday(),
        judgmentAmountState: 'PENDING',
        judgmentAmount: null,
        paidLitigationFeeState: 'PENDING',
        paidLitigationFee: null,
        judgmentContentVersionIds: [judgmentFile.contentVersionId],
      },
    }),
    201,
  );
  expect(judgment.stage).toBe('WAITING_JUDGMENT');

  const next = await body<{ stage: string; version: number }>(
    await request.post(`/api/v1/cases/${created.id}/judgment-next-step`, {
      headers: operator,
      data: {
        expectedVersion: judgment.version,
        idempotencyKey: randomUUID(),
        judgmentId: judgment.judgmentId,
        next: 'EXECUTION',
        executionReadinessConfirmed: true,
      },
    }),
    201,
  );
  expect(next).toMatchObject({
    stage: 'WAITING_EXECUTION_DOCUMENTS',
    version: judgment.version + 1,
  });
  expect((await readCase(request, created.id)).origin).toMatchObject({
    kind: 'EXTERNAL_ENTRY',
    entryId: created.entryId,
    initialStage: 'WAITING_HEARING',
  });
  const downloaded = await request.get(
    `/api/v1/materials/${judgmentFile.materialId}/versions/${judgmentFile.contentVersionId}/content`,
    { headers: operator },
  );
  expect(downloaded.status(), await downloaded.text()).toBe(200);
  expect((await downloaded.body()).equals(judgmentBytes)).toBe(true);
});

test('continues a SECOND_INSTANCE entry through real REMAND, child acceptance, and hearing', async ({
  request,
}) => {
  const courtSeed = await createEntry(
    request,
    input('WAITING_FILING', {
      defendants: [{ kind: 'ORGANIZATION', name: 'CA018 remand court seed' }],
    }),
  );
  const remandCourt = await createFilingCourt(request, courtSeed.id);
  const firstInstanceAcceptedOn = shanghaiDaysAgo(5);
  const secondInstanceAcceptedOn = shanghaiDaysAgo(2);
  const payload = input('SECOND_INSTANCE', {
    stageReachedOn: secondInstanceAcceptedOn,
    known: {
      courtId: remandCourt.id,
      courtCaseNo: `CA018-FIRST-${randomUUID().slice(0, 8)}`,
      acceptedOn: firstInstanceAcceptedOn,
      secondInstanceAcceptedOn,
      platform: null,
      shopName: null,
      shopExternalId: null,
      caseType: null,
      infringementTypes: null,
    },
  });
  const created = await createEntry(request, payload);
  const initial = await readCase(request, created.id);
  const externalRoundId = initial.currentTrialRoundId;
  expect(externalRoundId).toEqual(expect.any(String));

  const progress = {
    hearingAt: null,
    hearingPlace: null,
    judgeName: null,
    documentContentVersionIds: [],
    serviceContentVersionIds: [],
  };
  const saved = await body<{
    progressId: string;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${created.id}/second-instance-save`, {
      headers: operator,
      data: {
        expectedVersion: initial.version,
        idempotencyKey: randomUUID(),
        trialRoundId: externalRoundId,
        choiceId: null,
        expectedProgressId: null,
        progress,
      },
    }),
    201,
  );
  expect(saved).toMatchObject({
    stage: 'SECOND_INSTANCE',
    version: initial.version + 1,
  });

  const remandBytes = Buffer.from(
    '%PDF-1.7\nCA018 actual second-instance REMAND result bytes\n%%EOF\n',
  );
  const remandFile = await uploadCaseFile(
    request,
    created.id,
    'SECOND_INSTANCE_JUDGMENT',
    remandBytes,
  );
  const remanded = await body<{
    progressId: string;
    resultId: string;
    stage: string;
    version: number;
    currentTrialRoundId: string;
  }>(
    await request.post(`/api/v1/cases/${created.id}/second-instance-result`, {
      headers: operator,
      data: {
        expectedVersion: saved.version,
        idempotencyKey: randomUUID(),
        trialRoundId: externalRoundId,
        choiceId: null,
        expectedProgressId: saved.progressId,
        progress,
        result: 'REMAND',
        resultReceivedAt: shanghaiToday(),
        judgmentContentVersionIds: [remandFile.contentVersionId],
        paidLitigationFee: { state: 'PENDING', amount: null },
      },
    }),
    201,
  );
  expect(remanded).toMatchObject({
    stage: 'WAITING_FORMAL_ACCEPTANCE',
    currentTrialRoundId: expect.any(String),
  });
  expect(remanded.currentTrialRoundId).not.toBe(externalRoundId);
  const afterRemand = await readCase(request, created.id);
  expect(afterRemand.acceptance).toBeNull();
  expect(afterRemand.origin).toMatchObject({
    kind: 'EXTERNAL_ENTRY',
    entryId: created.entryId,
    initialStage: 'SECOND_INSTANCE',
    known: {
      courtId: remandCourt.id,
      courtCaseNo: payload.known.courtCaseNo,
      acceptedOn: firstInstanceAcceptedOn,
      secondInstanceAcceptedOn,
    },
  });

  const acceptanceBytes = Buffer.from(
    '%PDF-1.7\nCA018 real remand child acceptance notice bytes\n%%EOF\n',
  );
  const acceptanceFile = await uploadCaseFile(
    request,
    created.id,
    'ACCEPTANCE_NOTICE',
    acceptanceBytes,
  );
  const accepted = await submitAcceptance(
    request,
    created.id,
    acceptancePayload(
      remanded.version,
      shanghaiToday(),
      `CA018-RMD-${randomUUID().slice(0, 8)}`,
      acceptanceFile.contentVersionId,
      remandCourt.id,
    ),
  );
  expect(accepted).toMatchObject({
    stage: 'WAITING_HEARING',
    version: remanded.version + 1,
  });
  const childHearing = await body<{
    stage: string;
    version: number;
    arrangementId: string;
  }>(
    await request.post(`/api/v1/cases/${created.id}/hearing-schedule`, {
      headers: operator,
      data: {
        expectedVersion: accepted.version,
        idempotencyKey: randomUUID(),
        hearingAt: shanghaiToday(),
      },
    }),
    201,
  );
  expect(childHearing).toMatchObject({
    stage: 'WAITING_HEARING',
    version: accepted.version + 1,
    arrangementId: expect.any(String),
  });

  const final = await readCase(request, created.id);
  expect(final.currentTrialRoundId).toBe(remanded.currentTrialRoundId);
  expect(final.origin).toMatchObject({
    kind: 'EXTERNAL_ENTRY',
    entryId: created.entryId,
    initialStage: 'SECOND_INSTANCE',
  });
  for (const [file, expectedBytes] of [
    [remandFile, remandBytes],
    [acceptanceFile, acceptanceBytes],
  ] as const) {
    const downloaded = await request.get(
      `/api/v1/materials/${file.materialId}/versions/${file.contentVersionId}/content`,
      { headers: operator },
    );
    expect(downloaded.status(), await downloaded.text()).toBe(200);
    expect((await downloaded.body()).equals(expectedBytes)).toBe(true);
  }
});

test('returns a fixed receipt for exact replay and conflicts on a changed body', async ({
  request,
}) => {
  const payload = input('WAITING_COMPLAINT', {
    entryKind: 'HISTORICAL_BACKFILL',
  });
  const created = await createEntry(request, payload);
  const replay = await createEntry(request, payload);
  expect(replay).toEqual(created);

  const changed = await request.post('/api/v1/cases/external-entries', {
    headers: operator,
    data: { ...payload, reason: '同键不同原因' },
  });
  expect(changed.status(), await changed.text()).toBe(409);
  const snapshot = await caseExternalEntrySnapshot(created.id);
  expect(snapshot.entries).toHaveLength(1);
  expect(snapshot.receipts).toHaveLength(1);
});

test('enforces strict body, internal-only scope, and authorization before receipt replay', async ({
  request,
}) => {
  const optionsDenied = await request.get(
    '/api/v1/cases/external-entry-options',
    {
      headers: selfOnly,
    },
  );
  expect(optionsDenied.status()).toBe(200);
  const options = (await optionsDenied.json()) as Record<string, unknown>;
  expect(options.canCreate).toBe(false);
  expect(options.canCreateArchived).toBe(false);
  expect(options).not.toHaveProperty('customers');
  expect(options).not.toHaveProperty('rightsHolders');
  expect(options).not.toHaveProperty('lawyers');

  const noGrant = input('WAITING_COMPLAINT');
  const denied = await request.post('/api/v1/cases/external-entries', {
    headers: selfOnly,
    data: noGrant,
  });
  expect(denied.status(), await denied.text()).toBe(403);

  const foreignActor = await request.post('/api/v1/cases/external-entries', {
    headers: foreign,
    data: input('WAITING_COMPLAINT'),
  });
  expect(foreignActor.status(), await foreignActor.text()).toBe(403);
  const foreignCustomer = await request.post('/api/v1/cases/external-entries', {
    headers: operator,
    data: input('WAITING_COMPLAINT', {
      customerId: coreLeadFixtures.foreignCustomer,
      rightsHolderId: coreLeadFixtures.foreignHolder,
    }),
  });
  expect(foreignCustomer.status(), await foreignCustomer.text()).toBe(403);

  const strictBody = input('WAITING_COMPLAINT');
  const unknownKey = await request.post('/api/v1/cases/external-entries', {
    headers: operator,
    data: { ...strictBody, oldStage: 'WAITING_FILING' },
  });
  expect([400, 422], await unknownKey.text()).toContain(unknownKey.status());

  const revokedPayload = input('WAITING_COMPLAINT');
  const created = await createEntry(request, revokedPayload);
  const before = await caseExternalEntrySnapshot(created.id);
  await setCaseExternalEntryGrant(
    coreLeadFixtures.roleA,
    'case.external-entry.create',
    'TEAM',
    false,
  );
  const replayAfterRevocation = await request.post(
    '/api/v1/cases/external-entries',
    { headers: operator, data: revokedPayload },
  );
  expect(
    replayAfterRevocation.status(),
    await replayAfterRevocation.text(),
  ).toBe(403);
  expect(await caseExternalEntrySnapshot(created.id)).toEqual(before);
});
