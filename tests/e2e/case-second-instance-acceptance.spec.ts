import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  coreLeadFixtures,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';
import { createSubmittedCaseThroughApi } from '../support/case-complaint-confirmation-database.mjs';
import {
  allowOtherEnterpriseAccountSetup,
  clearCaseComplaintMailingFixture,
} from '../support/case-complaint-mailing-database.mjs';
import {
  clearCaseFilingFixture,
  prepareCaseFilingFixture,
} from '../support/case-filing-database.mjs';
import {
  clearCaseAcceptanceFixture,
  prepareCaseAcceptanceFixture,
} from '../support/case-acceptance-database.mjs';
import { clearCaseArchiveFixture } from '../support/case-archive-database.mjs';
import { clearCaseClosureFixture } from '../support/case-closure-database.mjs';
import { clearCaseExecutionFinishFixture } from '../support/case-execution-finish-database.mjs';
import { clearCoreCaseSecondInstanceFixture } from '../support/case-second-instance-database.mjs';
import {
  clearCoreCaseHearingAdmin,
  clearCoreCaseHearingAdminSessions,
  prepareCoreCaseHearingAdmin,
} from '../support/case-hearing-database.mjs';
import { disconnectCustomerTestDatabase } from '../support/customer-database.mjs';
import {
  clearRecordEditFixture,
  setRecordEditGrant,
} from '../support/case-record-edit-database.js';
import {
  clearSecondInstanceAcceptanceFixture,
  grantSecondInstanceAcceptancePredecessors,
  rejectSecondInstanceAcceptanceWrite,
  clearSecondInstanceAcceptanceFault,
  secondInstanceAcceptanceSnapshot,
  setSecondInstanceAcceptanceGrant,
  withSecondInstanceAcceptanceDatabase,
} from '../support/case-second-instance-acceptance-database.mjs';

const operator = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const foreign = { Authorization: `Bearer ${coreLeadFixtures.tokenB}` };
const colleague = { Authorization: `Bearer ${coreLeadFixtures.tokenSelf}` };
const bytes = Buffer.from('%PDF-1.4\nCE002 original immutable bytes\n%%EOF\n');
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const daysAgo = (days: number) => {
  const date = new Date(`${today()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};
type Http = {
  status(): number;
  text(): Promise<string>;
  json(): Promise<unknown>;
};
type Detail = {
  id: string;
  stage: string;
  version: number;
  courtCaseNo: string | null;
  currentTrialRoundId: string | null;
  currentAcceptanceId: string | null;
  acceptance: { id: string; acceptedAt: string; courtCaseNo: string } | null;
  judgmentNextStep: {
    current: { id: string; trialRoundId: string; next: string } | null;
  };
  secondInstance: {
    currentProgress: { id: string } | null;
    acceptances: Array<{
      choiceId: string;
      trialRoundId: string;
      acceptedAt: string | null;
      courtCaseNo: string | null;
      recordedAt: string;
    }>;
  };
  recordEdits: {
    canSaveSecondInstanceAcceptance: boolean;
    secondInstanceAcceptances: Array<{
      choiceId: string;
      trialRoundId: string;
      acceptanceRevision: number;
      acceptedAt: string | null;
      courtCaseNo: string | null;
      canEdit: boolean;
      history: Array<{
        id: string;
        priorChangeId: string | null;
        fromRevision: number;
        toRevision: number;
        acceptedAt: string | null;
        courtCaseNo: string | null;
        reason: string | null;
        recordedByUserId: string;
      }>;
    }>;
  };
};
type Save = {
  caseId: string;
  choiceId: string;
  trialRoundId: string;
  changeId: string;
  acceptanceRevision: number;
  acceptedAt: string | null;
  courtCaseNo: string | null;
  recordedAt: string;
};

async function body<T>(response: Http, status = 200): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json() as Promise<T>;
}
async function reject(response: Http, statuses: number[]) {
  expect(statuses, await response.text()).toContain(response.status());
}
async function read(
  request: APIRequestContext,
  caseId: string,
  headers = operator,
) {
  return body<Detail>(
    await request.get(`/api/v1/cases/${caseId}`, { headers }),
  );
}
async function upload(
  request: APIRequestContext,
  caseId: string,
  category: string,
) {
  const draft = await body<{ id: string }>(
    await request.post('/api/v1/materials/upload-drafts', {
      headers: operator,
      data: {
        ownerType: 'CASE',
        ownerId: caseId,
        category,
        purpose: category,
        originalFilename: `CE002-${category}.pdf`,
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
  );
}
async function appealCase(
  request: APIRequestContext,
  submitAsLawyer = false,
  initialAgeDays = 3,
) {
  const source = await createSubmittedCaseThroughApi(request, {
    submitAsLawyer,
  });
  const caseId = source.caseId;
  const root = `/api/v1/cases/${caseId}`;
  const businessDate = daysAgo(initialAgeDays);
  await body(
    await request.post(`${root}/complaint-confirm`, {
      headers: operator,
      data: {
        expectedVersion: source.submitted.version,
        idempotencyKey: randomUUID(),
        confirmedComplaintContentVersionId: source.complaint.contentVersionId,
        amountState: 'KNOWN',
        amount: '123.45',
        pendingReason: null,
        confirmDisclose: true,
      },
    }),
    201,
  );
  const mail = await upload(request, caseId, 'MAIL_RECEIPT');
  await body(
    await request.post(`${root}/complaint-mail`, {
      headers: operator,
      data: {
        expectedVersion: source.submitted.version + 1,
        idempotencyKey: randomUUID(),
        mailedAt: businessDate,
        mailReceiptContentVersionIds: [mail.contentVersionId],
      },
    }),
    201,
  );
  const court = await body<{ id: string }>(
    await request.post(`${root}/filing-courts`, {
      headers: operator,
      data: { name: `CE002法院${randomUUID().slice(0, 8)}` },
    }),
    201,
  );
  const filing = await upload(request, caseId, 'FILING_EVIDENCE');
  await body(
    await request.post(`${root}/filing-submit`, {
      headers: operator,
      data: {
        expectedVersion: source.submitted.version + 2,
        idempotencyKey: randomUUID(),
        courtId: court.id,
        submittedAt: businessDate,
        filingEvidenceContentVersionIds: [filing.contentVersionId],
      },
    }),
    201,
  );
  const notice = await upload(request, caseId, 'ACCEPTANCE_NOTICE');
  const beforeAcceptance = await read(request, caseId);
  await body(
    await request.post(`${root}/acceptance-register`, {
      headers: operator,
      data: {
        expectedVersion: beforeAcceptance.version,
        idempotencyKey: randomUUID(),
        acceptedAt: businessDate,
        courtCaseNo: 'CE002原一审案号',
        acceptanceNoticeContentVersionIds: [notice.contentVersionId],
      },
    }),
    201,
  );
  const beforeHearing = await read(request, caseId);
  await body(
    await request.post(`${root}/hearing-schedule`, {
      headers: operator,
      data: {
        expectedVersion: beforeHearing.version,
        idempotencyKey: randomUUID(),
        hearingAt: businessDate,
      },
    }),
    201,
  );
  await expect
    .poll(async () => (await read(request, caseId)).stage, { timeout: 20_000 })
    .toBe('WAITING_JUDGMENT');
  const judgmentFile = await upload(request, caseId, 'JUDGMENT');
  const beforeJudgment = await read(request, caseId);
  const judgment = await body<{ judgmentId: string; version: number }>(
    await request.post(`${root}/judgment-register`, {
      headers: operator,
      data: {
        expectedVersion: beforeJudgment.version,
        idempotencyKey: randomUUID(),
        judgmentReceivedAt: businessDate,
        judgmentAmountState: 'KNOWN',
        judgmentAmount: '88.00',
        paidLitigationFeeState: 'KNOWN',
        paidLitigationFee: '0.00',
        judgmentContentVersionIds: [judgmentFile.contentVersionId],
      },
    }),
    201,
  );
  await body(
    await request.post(`${root}/judgment-next-step`, {
      headers: operator,
      data: {
        expectedVersion: judgment.version,
        idempotencyKey: randomUUID(),
        judgmentId: judgment.judgmentId,
        next: 'APPEAL',
        plaintiffAppeals: true,
        defendantIds: [],
      },
    }),
    201,
  );
  const detail = await read(request, caseId);
  expect(detail.judgmentNextStep.current?.next).toBe('APPEAL');
  const choiceId = detail.judgmentNextStep.current!.id;
  const trialRoundId = detail.judgmentNextStep.current!.trialRoundId;
  return {
    ...source,
    caseId,
    businessDate,
    choiceId,
    trialRoundId,
    detail,
    notice,
    root,
  };
}
function input(
  choiceId: string,
  trialRoundId: string,
  revision: number,
  acceptedAt: string | null,
  courtCaseNo: string | null,
  reason: string | null = null,
) {
  return {
    choiceId,
    trialRoundId,
    expectedAcceptanceRevision: revision,
    idempotencyKey: randomUUID(),
    acceptedAt,
    courtCaseNo,
    reason,
  };
}
async function clean() {
  await clearSecondInstanceAcceptanceFixture();
  await clearRecordEditFixture();
  await clearCaseArchiveFixture();
  await clearCaseClosureFixture();
  await clearCaseExecutionFinishFixture();
  await clearCoreCaseHearingAdminSessions();
  await clearCoreCaseSecondInstanceFixture();
  await clearCaseAcceptanceFixture();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
  await resetCoreLeadE2eData();
  await clearCoreCaseHearingAdmin();
}
test.beforeEach(async () => {
  await clean();
  await prepareCoreCaseHearingAdmin();
  await prepareCaseFilingFixture();
  await prepareCaseAcceptanceFixture();
  await allowOtherEnterpriseAccountSetup();
  await grantSecondInstanceAcceptancePredecessors();
});
test.afterEach(clean);
test.afterAll(disconnectCustomerTestDatabase);

test('first APPEAL registration keeps unknown value, then reasoned correction and clear form one immutable chain', async ({
  request,
}) => {
  test.setTimeout(240_000);
  const source = await appealCase(request);
  const url = `${source.root}/second-instance-acceptance-save`;
  const before = await secondInstanceAcceptanceSnapshot(source.caseId);
  expect(source.detail.recordEdits.canSaveSecondInstanceAcceptance).toBe(false);
  expect(source.detail.recordEdits.secondInstanceAcceptances).toContainEqual(
    expect.objectContaining({
      choiceId: source.choiceId,
      acceptanceRevision: 0,
      acceptedAt: null,
      courtCaseNo: null,
      history: [],
    }),
  );
  await setSecondInstanceAcceptanceGrant(coreLeadFixtures.roleA, 'TEAM', true);
  const firstInput = input(
    source.choiceId,
    source.trialRoundId,
    0,
    null,
    '  CE002二审案号  ',
  );
  const first = await body<Save>(
    await request.post(url, { headers: operator, data: firstInput }),
    201,
  );
  expect(first).toMatchObject({
    caseId: source.caseId,
    choiceId: source.choiceId,
    acceptanceRevision: 1,
    acceptedAt: null,
    courtCaseNo: 'CE002二审案号',
  });
  expect(
    await body<Save>(
      await request.post(url, { headers: operator, data: firstInput }),
      201,
    ),
  ).toEqual(first);
  const corrected = await body<Save>(
    await request.post(url, {
      headers: operator,
      data: input(
        source.choiceId,
        source.trialRoundId,
        1,
        source.businessDate,
        'CE002更正二审案号',
        '核对法院通知',
      ),
    }),
    201,
  );
  const cleared = await body<Save>(
    await request.post(url, {
      headers: operator,
      data: input(
        source.choiceId,
        source.trialRoundId,
        2,
        null,
        null,
        '原填报缺乏依据，清空待核',
      ),
    }),
    201,
  );
  expect([
    first.acceptanceRevision,
    corrected.acceptanceRevision,
    cleared.acceptanceRevision,
  ]).toEqual([1, 2, 3]);
  const after = await secondInstanceAcceptanceSnapshot(source.caseId);
  expect(after.changes).toHaveLength(3);
  expect(after.receipts).toHaveLength(3);
  expect(after.changes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: first.changeId,
        from_revision: 0,
        to_revision: 1,
        prior_change_id: null,
        reason: null,
      }),
      expect.objectContaining({
        id: corrected.changeId,
        from_revision: 1,
        to_revision: 2,
        prior_change_id: first.changeId,
        reason: '核对法院通知',
      }),
      expect.objectContaining({
        id: cleared.changeId,
        from_revision: 2,
        to_revision: 3,
        prior_change_id: corrected.changeId,
        accepted_at: null,
        court_case_no: null,
      }),
    ]),
  );
  expect(after.case).toEqual(before.case);
  expect(after.choices).toEqual(before.choices);
  expect(after.acceptances).toEqual(before.acceptances);
  expect(after.matchingReceipts).toEqual(before.matchingReceipts);
  expect(after.acceptanceReceipts).toEqual(before.acceptanceReceipts);
  expect(after.judgmentChoiceReceipts).toEqual(before.judgmentChoiceReceipts);
  expect(after.secondInstanceReceipts).toEqual(before.secondInstanceReceipts);
  expect(after.oldReceipts).toEqual(before.oldReceipts);
  expect(after.materials).toEqual(before.materials);
  expect(after.archive).toEqual(before.archive);
  expect(after.audits.length - before.audits.length).toBe(3);
  const detail = await read(request, source.caseId);
  expect(detail.secondInstance.acceptances).toContainEqual(
    expect.objectContaining({
      choiceId: source.choiceId,
      acceptedAt: null,
      courtCaseNo: null,
    }),
  );
  expect(detail.recordEdits.secondInstanceAcceptances).toContainEqual(
    expect.objectContaining({
      choiceId: source.choiceId,
      acceptanceRevision: 3,
      acceptedAt: null,
      courtCaseNo: null,
      history: expect.arrayContaining([
        expect.objectContaining({
          id: corrected.changeId,
          reason: '核对法院通知',
        }),
      ]),
    }),
  );
  const file = await request.get(
    `/api/v1/materials/${source.notice.materialId}/versions/${source.notice.contentVersionId}/content`,
    { headers: operator },
  );
  expect(file.status()).toBe(200);
  expect(await file.body()).toEqual(bytes);
});

test('strict input, ownership, permissions, replay and concurrent CAS allow one winner', async ({
  request,
}) => {
  test.setTimeout(300_000);
  const source = await appealCase(request);
  const other = await appealCase(request);
  const url = `${source.root}/second-instance-acceptance-save`;
  const original = input(
    source.choiceId,
    source.trialRoundId,
    0,
    source.businessDate,
    null,
  );
  await reject(
    await request.post(url, { headers: operator, data: original }),
    [403],
  );
  await setSecondInstanceAcceptanceGrant(coreLeadFixtures.roleA, 'TEAM', true);
  for (const invalid of [
    { ...original, acceptedAt: null },
    { ...original, reason: '首次不应填写原因' },
    { ...original, courtCaseNo: 'x'.repeat(101) },
    { ...original, expectedVersion: source.detail.version },
    { ...original, choiceId: other.choiceId },
    { ...original, trialRoundId: other.trialRoundId },
  ])
    await reject(
      await request.post(url, { headers: operator, data: invalid }),
      [400, 409],
    );
  await reject(
    await request.post(url, { headers: foreign, data: original }),
    [403, 404],
  );
  await reject(
    await request.post(url, { headers: colleague, data: original }),
    [403],
  );
  await reject(await request.post(url, { data: original }), [401, 403]);
  await body(
    await request.post(`${other.root}/judgment-next-step-revoke`, {
      headers: operator,
      data: {
        expectedVersion: other.detail.version,
        idempotencyKey: randomUUID(),
        choiceId: other.choiceId,
        reason: '没有二审事实的选择撤销',
      },
    }),
    201,
  );
  await reject(
    await request.post(`${other.root}/second-instance-acceptance-save`, {
      headers: operator,
      data: input(other.choiceId, other.trialRoundId, 0, null, '撤销根不可写'),
    }),
    [400, 409],
  );
  const competitor = {
    ...original,
    idempotencyKey: randomUUID(),
    courtCaseNo: '竞争的另一值',
  };
  const [a, b] = await Promise.all([
    request.post(url, { headers: operator, data: original }),
    request.post(url, { headers: operator, data: competitor }),
  ]);
  expect([a.status(), b.status()].sort()).toEqual([201, 409]);
  const winner =
    a.status() === 201 ? await body<Save>(a, 201) : await body<Save>(b, 201);
  const replayBody = a.status() === 201 ? original : competitor;
  expect(
    await body<Save>(
      await request.post(url, { headers: operator, data: replayBody }),
      201,
    ),
  ).toEqual(winner);
  await reject(
    await request.post(url, {
      headers: operator,
      data: { ...replayBody, acceptedAt: null, courtCaseNo: '重放异参' },
    }),
    [409],
  );
  await reject(
    await request.post(url, {
      headers: operator,
      data: input(source.choiceId, source.trialRoundId, 0, null, '过期资料'),
    }),
    [409],
  );
  await setSecondInstanceAcceptanceGrant(coreLeadFixtures.roleA, 'TEAM', false);
  await reject(
    await request.post(url, { headers: operator, data: replayBody }),
    [403],
  );
  expect(
    (await secondInstanceAcceptanceSnapshot(source.caseId)).changes,
  ).toHaveLength(1);
  await setSecondInstanceAcceptanceGrant(
    coreLeadFixtures.roleSelf,
    'DEPARTMENT',
    true,
  );
  const colleagueDetail = await read(request, source.caseId, colleague);
  expect(colleagueDetail.recordEdits.canSaveSecondInstanceAcceptance).toBe(
    true,
  );
  const next = await body<Save>(
    await request.post(url, {
      headers: colleague,
      data: input(
        source.choiceId,
        source.trialRoundId,
        1,
        source.businessDate,
        '同部门更正',
        '同部门核对',
      ),
    }),
    201,
  );
  expect(next.acceptanceRevision).toBe(2);
});

test('business date guards and injected SQL failure roll back every new fact', async ({
  request,
}) => {
  test.setTimeout(240_000);
  const source = await appealCase(request);
  await setSecondInstanceAcceptanceGrant(coreLeadFixtures.roleA, 'TEAM', true);
  const url = `${source.root}/second-instance-acceptance-save`;
  for (const date of [daysAgo(4), daysAgo(-1)])
    await reject(
      await request.post(url, {
        headers: operator,
        data: input(source.choiceId, source.trialRoundId, 0, date, null),
      }),
      [400],
    );
  const before = await secondInstanceAcceptanceSnapshot(source.caseId);
  await rejectSecondInstanceAcceptanceWrite();
  try {
    await reject(
      await request.post(url, {
        headers: operator,
        data: input(
          source.choiceId,
          source.trialRoundId,
          0,
          source.businessDate,
          null,
        ),
      }),
      [400, 409, 500],
    );
  } finally {
    await clearSecondInstanceAcceptanceFault();
  }
  expect(await secondInstanceAcceptanceSnapshot(source.caseId)).toEqual(before);
  const first = await body<Save>(
    await request.post(url, {
      headers: operator,
      data: input(source.choiceId, source.trialRoundId, 0, daysAgo(2), null),
    }),
    201,
  );
  const progress = await body<{ version: number }>(
    await request.post(`${source.root}/second-instance-save`, {
      headers: operator,
      data: {
        expectedVersion: source.detail.version,
        idempotencyKey: randomUUID(),
        trialRoundId: source.trialRoundId,
        choiceId: source.choiceId,
        expectedProgressId: null,
        progress: {
          hearingAt: daysAgo(2),
          hearingPlace: null,
          judgeName: null,
          documentContentVersionIds: [],
          serviceContentVersionIds: [],
        },
      },
    }),
    201,
  );
  expect(progress.version).toBeGreaterThan(source.detail.version);
  const currentProgress = (await read(request, source.caseId)).secondInstance
    .currentProgress;
  expect(currentProgress).not.toBeNull();
  const resultFile = await upload(
    request,
    source.caseId,
    'SECOND_INSTANCE_JUDGMENT',
  );
  await reject(
    await request.post(`${source.root}/second-instance-result`, {
      headers: operator,
      data: {
        expectedVersion: progress.version,
        idempotencyKey: randomUUID(),
        trialRoundId: source.trialRoundId,
        choiceId: source.choiceId,
        expectedProgressId: currentProgress!.id,
        progress: {
          hearingAt: daysAgo(2),
          hearingPlace: null,
          judgeName: null,
          documentContentVersionIds: [],
          serviceContentVersionIds: [],
        },
        result: 'REMAND',
        resultReceivedAt: source.businessDate,
        judgmentContentVersionIds: [resultFile.contentVersionId],
        paidLitigationFee: { state: 'PENDING', amount: null },
      },
    }),
    [400, 409],
  );
  await reject(
    await request.post(url, {
      headers: operator,
      data: input(
        source.choiceId,
        source.trialRoundId,
        1,
        today(),
        null,
        '晚于真实二审开庭',
      ),
    }),
    [400],
  );
  expect(
    (await secondInstanceAcceptanceSnapshot(source.caseId)).changes,
  ).toHaveLength(1);
  expect(first.acceptanceRevision).toBe(1);
});

test('registered chain blocks APPEAL revocation even after both effective values are cleared', async ({
  request,
}) => {
  test.setTimeout(240_000);
  const source = await appealCase(request);
  await setSecondInstanceAcceptanceGrant(coreLeadFixtures.roleA, 'TEAM', true);
  const url = `${source.root}/second-instance-acceptance-save`;
  await body(
    await request.post(url, {
      headers: operator,
      data: input(
        source.choiceId,
        source.trialRoundId,
        0,
        null,
        '待核二审案号',
      ),
    }),
    201,
  );
  await body(
    await request.post(url, {
      headers: operator,
      data: input(
        source.choiceId,
        source.trialRoundId,
        1,
        null,
        null,
        '原案号录入有误',
      ),
    }),
    201,
  );
  const before = await secondInstanceAcceptanceSnapshot(source.caseId);
  await reject(
    await request.post(`${source.root}/judgment-next-step-revoke`, {
      headers: operator,
      data: {
        expectedVersion: source.detail.version,
        idempotencyKey: randomUUID(),
        choiceId: source.choiceId,
        reason: '不得撤销已有二审资料的上诉选择',
      },
    }),
    [400, 409],
  );
  expect(await secondInstanceAcceptanceSnapshot(source.caseId)).toEqual(before);
});

test('real REMAND admits the historical APPEAL with actual downstream facts and keeps its chain separate from the new round', async ({
  request,
}) => {
  test.setTimeout(300_000);
  const source = await appealCase(request, false, 8);
  await setSecondInstanceAcceptanceGrant(coreLeadFixtures.roleA, 'TEAM', true);
  const resultFile = await upload(
    request,
    source.caseId,
    'SECOND_INSTANCE_JUDGMENT',
  );
  const remand = await body<{ version: number; currentTrialRoundId: string }>(
    await request.post(`${source.root}/second-instance-result`, {
      headers: operator,
      data: {
        expectedVersion: source.detail.version,
        idempotencyKey: randomUUID(),
        trialRoundId: source.trialRoundId,
        choiceId: source.choiceId,
        expectedProgressId: null,
        progress: {
          hearingAt: null,
          hearingPlace: null,
          judgeName: null,
          documentContentVersionIds: [],
          serviceContentVersionIds: [],
        },
        result: 'REMAND',
        resultReceivedAt: daysAgo(1),
        judgmentContentVersionIds: [resultFile.contentVersionId],
        paidLitigationFee: { state: 'PENDING', amount: null },
      },
    }),
    201,
  );
  const old = await body<Save>(
    await request.post(`${source.root}/second-instance-acceptance-save`, {
      headers: operator,
      data: input(
        source.choiceId,
        source.trialRoundId,
        0,
        null,
        '历史二审案号',
      ),
    }),
    201,
  );
  const oldCorrection = await body<Save>(
    await request.post(`${source.root}/second-instance-acceptance-save`, {
      headers: operator,
      data: input(
        source.choiceId,
        source.trialRoundId,
        1,
        daysAgo(2),
        '历史二审更正案号',
        '发回卷宗核对',
      ),
    }),
    201,
  );
  expect(oldCorrection.acceptanceRevision).toBe(2);
  const childNotice = await upload(request, source.caseId, 'ACCEPTANCE_NOTICE');
  await body(
    await request.post(`${source.root}/acceptance-register`, {
      headers: operator,
      data: {
        expectedVersion: remand.version,
        idempotencyKey: randomUUID(),
        acceptedAt: daysAgo(1),
        courtCaseNo: '发回后新一审案号',
        acceptanceNoticeContentVersionIds: [childNotice.contentVersionId],
      },
    }),
    201,
  );
  const child = await read(request, source.caseId);
  expect(child.courtCaseNo).toBe('发回后新一审案号');
  expect(child.recordEdits.secondInstanceAcceptances).toContainEqual(
    expect.objectContaining({
      choiceId: source.choiceId,
      acceptanceRevision: 2,
      acceptedAt: daysAgo(2),
      courtCaseNo: '历史二审更正案号',
      history: expect.arrayContaining([
        expect.objectContaining({ id: old.changeId, priorChangeId: null }),
      ]),
    }),
  );
  await setRecordEditGrant(
    coreLeadFixtures.roleA,
    'case.acceptance.correct',
    'TEAM',
    true,
  );
  await withSecondInstanceAcceptanceDatabase(async (client) => {
    const valid = async (candidate: string) =>
      (
        await client.query(
          'SELECT case_second_child_acceptance_date_valid($1::uuid,$2::date) AS valid',
          [remand.currentTrialRoundId, candidate],
        )
      ).rows[0]?.valid;
    expect(await valid(source.businessDate)).toBe(false);
    expect(await valid(daysAgo(1))).toBe(true);
  });
  const beforeInvalidChildCorrection = await secondInstanceAcceptanceSnapshot(
    source.caseId,
  );
  await reject(
    await request.post(`${source.root}/acceptance-correction`, {
      headers: operator,
      data: {
        acceptanceId: child.acceptance!.id,
        expectedAcceptanceRevision: 0,
        idempotencyKey: randomUUID(),
        acceptedAt: source.businessDate,
        courtCaseNo: '不允许早于父二审受理',
        reason: '测试发回日期下界',
      },
    }),
    [400, 409],
  );
  expect(await secondInstanceAcceptanceSnapshot(source.caseId)).toEqual(
    beforeInvalidChildCorrection,
  );
  const revisedParent = await body<Save>(
    await request.post(`${source.root}/second-instance-acceptance-save`, {
      headers: operator,
      data: input(
        source.choiceId,
        source.trialRoundId,
        2,
        daysAgo(6),
        '历史二审更正案号',
        '核对原受理日期',
      ),
    }),
    201,
  );
  expect(revisedParent.acceptanceRevision).toBe(3);
  await body(
    await request.post(`${source.root}/acceptance-correction`, {
      headers: operator,
      data: {
        acceptanceId: child.acceptance!.id,
        expectedAcceptanceRevision: 0,
        idempotencyKey: randomUUID(),
        acceptedAt: daysAgo(4),
        courtCaseNo: child.acceptance!.courtCaseNo,
        reason: '只按当前有效父受理日期核对',
      },
    }),
    201,
  );
  const finalParent = await body<Save>(
    await request.post(`${source.root}/second-instance-acceptance-save`, {
      headers: operator,
      data: input(
        source.choiceId,
        source.trialRoundId,
        3,
        daysAgo(7),
        '历史二审更正案号',
        '旧误填日期不阻止合法更正',
      ),
    }),
    201,
  );
  expect(finalParent.acceptanceRevision).toBe(4);
  const correctedChild = await read(request, source.caseId);
  expect(correctedChild.acceptance!.acceptedAt).toBe(daysAgo(4));
  expect(correctedChild.version).toBe(child.version);
  expect(correctedChild.stage).toBe(child.stage);
  expect(correctedChild.currentTrialRoundId).toBe(child.currentTrialRoundId);
  expect(correctedChild.currentAcceptanceId).toBe(child.currentAcceptanceId);
  const beforeHearing = await read(request, source.caseId);
  await body(
    await request.post(`${source.root}/hearing-schedule`, {
      headers: operator,
      data: {
        expectedVersion: beforeHearing.version,
        idempotencyKey: randomUUID(),
        hearingAt: daysAgo(1),
      },
    }),
    201,
  );
  await expect
    .poll(async () => (await read(request, source.caseId)).stage, {
      timeout: 20_000,
    })
    .toBe('WAITING_JUDGMENT');
  const nextJudgmentFile = await upload(request, source.caseId, 'JUDGMENT');
  const beforeJudgment = await read(request, source.caseId);
  const nextJudgment = await body<{ judgmentId: string; version: number }>(
    await request.post(`${source.root}/judgment-register`, {
      headers: operator,
      data: {
        expectedVersion: beforeJudgment.version,
        idempotencyKey: randomUUID(),
        judgmentReceivedAt: daysAgo(1),
        judgmentAmountState: 'KNOWN',
        judgmentAmount: '88.00',
        paidLitigationFeeState: 'KNOWN',
        paidLitigationFee: '0.00',
        judgmentContentVersionIds: [nextJudgmentFile.contentVersionId],
      },
    }),
    201,
  );
  await body(
    await request.post(`${source.root}/judgment-next-step`, {
      headers: operator,
      data: {
        expectedVersion: nextJudgment.version,
        idempotencyKey: randomUUID(),
        judgmentId: nextJudgment.judgmentId,
        next: 'APPEAL',
        plaintiffAppeals: true,
        defendantIds: [],
      },
    }),
    201,
  );
  const current = await read(request, source.caseId);
  const currentChoice = current.judgmentNextStep.current!;
  expect(currentChoice.id).not.toBe(source.choiceId);
  expect(current.recordEdits.secondInstanceAcceptances).toContainEqual(
    expect.objectContaining({
      choiceId: currentChoice.id,
      acceptanceRevision: 0,
      acceptedAt: null,
      courtCaseNo: null,
    }),
  );
  await body<Save>(
    await request.post(`${source.root}/second-instance-acceptance-save`, {
      headers: operator,
      data: input(
        currentChoice.id,
        currentChoice.trialRoundId,
        0,
        null,
        '当前二审案号',
      ),
    }),
    201,
  );
  const final = await read(request, source.caseId);
  expect(final.courtCaseNo).toBe('发回后新一审案号');
  expect(final.recordEdits.secondInstanceAcceptances).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        choiceId: source.choiceId,
        acceptanceRevision: 4,
        acceptedAt: daysAgo(7),
        courtCaseNo: '历史二审更正案号',
      }),
      expect.objectContaining({
        choiceId: currentChoice.id,
        acceptanceRevision: 1,
        courtCaseNo: '当前二审案号',
      }),
    ]),
  );
  const facts = await secondInstanceAcceptanceSnapshot(source.caseId);
  expect(facts.secondResults).toHaveLength(1);
  expect(facts.changes).toHaveLength(5);
  expect(facts.case[0]).toMatchObject({
    current_trial_round_id: currentChoice.trialRoundId,
  });
});

test('parent second-instance correction racing child first-instance correction commits only a date-consistent winner', async ({
  request,
}) => {
  test.setTimeout(300_000);
  const source = await appealCase(request, false, 4);
  await setSecondInstanceAcceptanceGrant(coreLeadFixtures.roleA, 'TEAM', true);
  await setRecordEditGrant(
    coreLeadFixtures.roleA,
    'case.acceptance.correct',
    'TEAM',
    true,
  );
  const resultFile = await upload(
    request,
    source.caseId,
    'SECOND_INSTANCE_JUDGMENT',
  );
  const remand = await body<{ version: number }>(
    await request.post(`${source.root}/second-instance-result`, {
      headers: operator,
      data: {
        expectedVersion: source.detail.version,
        idempotencyKey: randomUUID(),
        trialRoundId: source.trialRoundId,
        choiceId: source.choiceId,
        expectedProgressId: null,
        progress: {
          hearingAt: null,
          hearingPlace: null,
          judgeName: null,
          documentContentVersionIds: [],
          serviceContentVersionIds: [],
        },
        result: 'REMAND',
        resultReceivedAt: daysAgo(1),
        judgmentContentVersionIds: [resultFile.contentVersionId],
        paidLitigationFee: { state: 'PENDING', amount: null },
      },
    }),
    201,
  );
  await body<Save>(
    await request.post(`${source.root}/second-instance-acceptance-save`, {
      headers: operator,
      data: input(
        source.choiceId,
        source.trialRoundId,
        0,
        source.businessDate,
        null,
      ),
    }),
    201,
  );
  const notice = await upload(request, source.caseId, 'ACCEPTANCE_NOTICE');
  await body(
    await request.post(`${source.root}/acceptance-register`, {
      headers: operator,
      data: {
        expectedVersion: remand.version,
        idempotencyKey: randomUUID(),
        acceptedAt: daysAgo(1),
        courtCaseNo: '竞态子轮原案号',
        acceptanceNoticeContentVersionIds: [notice.contentVersionId],
      },
    }),
    201,
  );
  const child = await read(request, source.caseId);
  const before = await secondInstanceAcceptanceSnapshot(source.caseId);
  const [parent, childCorrection] = await Promise.all([
    request.post(`${source.root}/second-instance-acceptance-save`, {
      headers: operator,
      data: input(
        source.choiceId,
        source.trialRoundId,
        1,
        daysAgo(2),
        null,
        '父二审日期更正',
      ),
    }),
    request.post(`${source.root}/acceptance-correction`, {
      headers: operator,
      data: {
        acceptanceId: child.acceptance!.id,
        expectedAcceptanceRevision: 0,
        idempotencyKey: randomUUID(),
        acceptedAt: daysAgo(3),
        courtCaseNo: '竞态子轮更正案号',
        reason: '子轮日期核对',
      },
    }),
  ]);
  const statuses = [parent.status(), childCorrection.status()];
  expect(statuses.filter((status) => status === 201)).toHaveLength(1);
  expect(
    statuses.filter((status) => status === 400 || status === 409),
  ).toHaveLength(1);
  const final = await read(request, source.caseId);
  const parentDate = final.secondInstance.acceptances.find(
    (value) => value.choiceId === source.choiceId,
  )?.acceptedAt;
  expect(parentDate).not.toBeNull();
  expect(final.acceptance!.acceptedAt >= parentDate!).toBe(true);
  const after = await secondInstanceAcceptanceSnapshot(source.caseId);
  expect((after.case[0] as Record<string, unknown>).version).toBe(
    (before.case[0] as Record<string, unknown>).version,
  );
  expect((after.case[0] as Record<string, unknown>).stage).toBe(
    (before.case[0] as Record<string, unknown>).stage,
  );
  expect(after.acceptances).toEqual(before.acceptances);
  expect(after.secondResults).toEqual(before.secondResults);
  expect(after.archive).toEqual(before.archive);
  expect(after.materials).toEqual(before.materials);
  expect(after.changes.length - before.changes.length).toBe(
    parent.status() === 201 ? 1 : 0,
  );
});

test('browser cancels and saves distinct second-instance values; lawyer sees effective values, client stays minimal', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(300_000);
  const source = await appealCase(request, true);
  await setSecondInstanceAcceptanceGrant(coreLeadFixtures.roleA, 'TEAM', true);
  await signIn(page, `/cases/${source.caseId}`);
  await expect(page.locator('[data-section="first-instance"]')).toContainText(
    'CE002原一审案号',
  );
  await expect(
    page.locator('[data-test="second-instance-panel"]'),
  ).toContainText('一审');
  await openAcceptancePanel(page);
  const panel = page.locator('[data-test="second-instance-acceptance-panel"]');
  await expect(panel).toBeVisible();
  await panel
    .locator('[data-test="second-instance-acceptance-case-no"]')
    .fill('取消的二审案号');
  await panel
    .locator('[data-test="second-instance-acceptance-cancel"]')
    .click();
  expect(
    (await secondInstanceAcceptanceSnapshot(source.caseId)).changes,
  ).toHaveLength(0);
  await openAcceptancePanel(page);
  await panel
    .locator('[data-test="second-instance-acceptance-case-no"]')
    .fill('CE002浏览器二审案号');
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname ===
        `${source.root}/second-instance-acceptance-save`,
  );
  await panel.locator('[data-test="second-instance-acceptance-save"]').click();
  const saved = await body<Save>(await response, 201);
  expect(saved).toMatchObject({
    acceptanceRevision: 1,
    courtCaseNo: 'CE002浏览器二审案号',
  });
  await page.reload();
  const detail = await read(request, source.caseId);
  expect(detail.courtCaseNo).toBe('CE002原一审案号');
  expect(detail.secondInstance.acceptances).toContainEqual(
    expect.objectContaining({
      choiceId: source.choiceId,
      courtCaseNo: 'CE002浏览器二审案号',
    }),
  );
  await expect(
    page.locator('[data-test="second-instance-panel"]'),
  ).toContainText('CE002浏览器二审案号');
  await expect(page.locator('[data-section="first-instance"]')).toContainText(
    'CE002原一审案号',
  );
  const logout = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname === '/api/v1/auth/logout',
  );
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  expect((await logout).status()).toBe(204);
  await signInAs(
    page,
    `/lawyer/cases/${source.caseId}`,
    source.lawyer.username,
    source.lawyer.password,
  );
  const lawyer = await body<Record<string, unknown>>(
    await page.request.get(`/api/v1/lawyer/cases/${source.caseId}`),
  );
  expect(lawyer.recordEdits).toBeUndefined();
  expect(lawyer.secondInstance).toMatchObject({
    acceptances: [
      expect.objectContaining({
        choiceId: source.choiceId,
        courtCaseNo: 'CE002浏览器二审案号',
      }),
    ],
  });
  expect(JSON.stringify(lawyer)).not.toContain('recordedByUserId');
  expect(JSON.stringify(lawyer)).not.toContain('更正原因');
  const clientContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    const clientPage = await clientContext.newPage();
    await signInAs(
      clientPage,
      '/client/leads',
      source.clientSession.user.username,
      'client correct horse battery',
    );
    await clientPage.goto(`/client/cases/${source.caseId}`);
    const client = await body<Record<string, unknown>>(
      await clientPage.request.get(`/api/v1/client/cases/${source.caseId}`),
    );
    expect(client.recordEdits).toBeUndefined();
    expect(client.secondInstance).toBeUndefined();
    expect(JSON.stringify(client)).not.toContain('CE002浏览器二审案号');
  } finally {
    await clientContext.close();
  }
});

test('browser explicitly recovers the original body and key after a committed response is lost', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const source = await appealCase(request);
  await setSecondInstanceAcceptanceGrant(coreLeadFixtures.roleA, 'TEAM', true);
  await signIn(page, `/cases/${source.caseId}`);
  await openAcceptancePanel(page);
  const panel = page.locator('[data-test="second-instance-acceptance-panel"]');
  await panel
    .locator('[data-test="second-instance-acceptance-case-no"]')
    .fill('CE002丢响应案号');
  const sent: unknown[] = [];
  let committed = false;
  await page.route(
    `**${source.root}/second-instance-acceptance-save`,
    async (route) => {
      sent.push(route.request().postDataJSON());
      if (!committed) {
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        committed = true;
        await route.abort('failed');
      } else await route.continue();
    },
  );
  await panel.locator('[data-test="second-instance-acceptance-save"]').click();
  await expect(
    panel.locator('[data-test="second-instance-acceptance-retry"]'),
  ).toBeVisible();
  expect(
    (await secondInstanceAcceptanceSnapshot(source.caseId)).changes,
  ).toHaveLength(1);
  await panel.locator('[data-test="second-instance-acceptance-retry"]').click();
  await expect(
    panel.locator('[data-test="second-instance-acceptance-retry"]'),
  ).toHaveCount(0);
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(sent[0]);
  expect(
    (await secondInstanceAcceptanceSnapshot(source.caseId)).changes,
  ).toHaveLength(1);
  expect(
    (await secondInstanceAcceptanceSnapshot(source.caseId)).receipts,
  ).toHaveLength(1);
});

async function signInAs(
  page: Page,
  path: string,
  username: string,
  password: string,
) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(path);
}

async function signIn(page: Page, path: string) {
  await signInAs(
    page,
    path,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
}

async function openAcceptancePanel(page: Page) {
  await page.locator('[data-workspace-tab="details"]').click();
  const edit = page.locator(
    '[data-section="second-instance"] .case-workspace-section__edit',
  );
  await expect(edit).toBeEnabled();
  await edit.click();
  const drawer = page.locator('.case-workspace-editors[role="dialog"]');
  const command = drawer.locator('[data-test="workspace-command"]');
  await expect(
    command.locator('option[value="second-instance-acceptance"]'),
  ).toHaveCount(1);
  await command.selectOption('second-instance-acceptance');
  await expect(
    drawer.locator('[data-test="second-instance-acceptance-panel"]'),
  ).toBeVisible();
}
