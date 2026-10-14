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
  const payload = input('SECOND_INSTANCE', {
    stageReachedOn: shanghaiDaysAgo(2),
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
  const accepted = await body<{
    acceptanceId: string;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${created.id}/acceptance-register`, {
      headers: operator,
      data: {
        expectedVersion: remanded.version,
        idempotencyKey: randomUUID(),
        acceptedAt: shanghaiToday(),
        courtCaseNo: `CA018-RMD-${randomUUID().slice(0, 8)}`,
        acceptanceNoticeContentVersionIds: [acceptanceFile.contentVersionId],
      },
    }),
    201,
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
