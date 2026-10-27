import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test';
import { assertBatch2Admission } from '../support/batch2-proxy-calendar-acceptance.mjs';
import { seedBatch2ProxyCalendarActors } from '../support/batch2-proxy-calendar-fixture.mjs';
import {
  grantBatch2RefundLifecycleActions,
  readBatch2RefundLedger,
  readBatch2RoundRevokedAt,
  verifyBatch2RefundBoundaryAndRead,
} from '../support/batch2-refund-lifecycle-fixture.mjs';
import { batch2SyntheticPdf } from '../support/batch2-synthetic-pdf.mjs';

assertBatch2Admission();
const origin = 'http://127.0.0.1:5174';
type Fixture = Awaited<ReturnType<typeof seedBatch2ProxyCalendarActors>>;
type Actor = { context: APIRequestContext; csrf: string };
type Case = { id: string; version: number; currentTrialRoundId: string };
type SecondResult = {
  resultId: string;
  currentTrialRoundId: string;
  recordedAt: string;
  stage: string;
  version: number;
};
let fixture: Fixture;
let actor: Actor;
let filingCourtId: string;

function shanghaiDay(offset = 0, instant: Date | string = new Date()) {
  const value = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant));
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
async function body<T>(response: APIResponse, expected = 201): Promise<T> {
  expect(response.status(), await response.text()).toBe(expected);
  return response.json() as Promise<T>;
}
function headers() {
  return { 'X-CSRF-Token': actor.csrf };
}
async function post<T>(caseId: string, command: string, data: object) {
  return body<T>(
    await actor.context.post(`/api/v1/cases/${caseId}/${command}`, {
      headers: headers(),
      data: { ...data, idempotencyKey: randomUUID() },
    }),
  );
}
async function upload(
  caseId: string,
  category: 'JUDGMENT' | 'SECOND_INSTANCE_JUDGMENT' | 'ACCEPTANCE_NOTICE',
  label: string,
) {
  const draft = await body<{ id: string }>(
    await actor.context.post('/api/v1/materials/upload-drafts', {
      headers: headers(),
      data: {
        ownerType: 'CASE',
        ownerId: caseId,
        category,
        purpose: category,
        originalFilename: `batch2-${category}-${randomUUID()}.pdf`,
        declaredMimeType: 'application/pdf',
      },
    }),
  );
  return body<{ contentVersionId: string }>(
    await actor.context.put(
      `/api/v1/materials/upload-drafts/${draft.id}/content`,
      {
        headers: { ...headers(), 'Content-Type': 'application/octet-stream' },
        data: batch2SyntheticPdf(label),
      },
    ),
    200,
  );
}
async function createDirectSecond(): Promise<Case> {
  const created = await body<{ id: string; version: number }>(
    await actor.context.post('/api/v1/cases/external-entries', {
      headers: headers(),
      data: {
        idempotencyKey: randomUUID(),
        entryKind: 'EXTERNAL_TRANSFER',
        initialStage: 'SECOND_INSTANCE',
        stageReachedOn: shanghaiDay(-6),
        source: `Batch2 refund source ${randomUUID()}`,
        reason: '合成二审现阶段转入',
        customerId: fixture.customers.withAccount,
        rightsHolderId: fixture.rightsHolderId,
        defendants: [{ kind: 'ORGANIZATION', name: '合成被告' }],
        lawyerAccountId: null,
        lawyerProfileId: null,
        known: {
          courtId: null,
          courtCaseNo: null,
          acceptedOn: shanghaiDay(-8),
          secondInstanceAcceptedOn: shanghaiDay(-7),
          platform: null,
          shopName: null,
          shopExternalId: null,
          caseType: null,
          infringementTypes: null,
        },
      },
    }),
  );
  const detail = await body<{
    secondInstance: { currentTrialRoundId: string };
  }>(await actor.context.get(`/api/v1/cases/${created.id}`), 200);
  return {
    ...created,
    currentTrialRoundId: detail.secondInstance.currentTrialRoundId,
  };
}
const emptyProgress = {
  hearingAt: null,
  hearingPlace: null,
  judgeName: null,
  documentContentVersionIds: [],
  serviceContentVersionIds: [],
};
async function saveSecond(current: Case) {
  return post<{ progressId: string | null; version: number }>(
    current.id,
    'second-instance-save',
    {
      expectedVersion: current.version,
      trialRoundId: current.currentTrialRoundId,
      choiceId: null,
      expectedProgressId: null,
      progress: emptyProgress,
    },
  );
}
async function registerSecond(
  current: Case,
  version: number,
  result: 'AFFIRM' | 'REMAND',
) {
  const file = await upload(
    current.id,
    'SECOND_INSTANCE_JUDGMENT',
    `Batch2 ${result} result`,
  );
  return post<SecondResult>(current.id, 'second-instance-result', {
    expectedVersion: version,
    trialRoundId: current.currentTrialRoundId,
    choiceId: null,
    expectedProgressId: null,
    progress: emptyProgress,
    result,
    resultReceivedAt: shanghaiDay(-5),
    judgmentContentVersionIds: [file.contentVersionId],
    paidLitigationFee: { state: 'PENDING', amount: null },
    ...(result === 'AFFIRM'
      ? { judgmentAmount: { state: 'KNOWN', amount: '120.00' } }
      : {}),
  });
}
async function refundDates(sourceId: string, recordedAt: string) {
  const dueDate = shanghaiDay(15, recordedAt);
  const dates = await body<
    Array<{
      sourceId: string;
      sourceType: string;
      dueDate: string;
      applied: boolean;
    }>
  >(
    await actor.context.get(
      `/api/v1/calendar/refund-dates?month=${dueDate.slice(0, 7)}`,
    ),
    200,
  );
  return { dueDate, source: dates.find((item) => item.sourceId === sourceId) };
}

test.describe.serial('Batch 2 formal refund lifecycle', () => {
  test.setTimeout(300_000);
  test.beforeAll(async ({ playwright }) => {
    fixture = await seedBatch2ProxyCalendarActors();
    const directory = await grantBatch2RefundLifecycleActions(fixture);
    filingCourtId = directory.courtId;
    const context = await playwright.request.newContext({ baseURL: origin });
    const login = await body<{
      principalType: string;
      csrfToken: string;
      user: { id: string };
    }>(
      await context.post('/api/v1/auth/login', {
        headers: { Origin: origin },
        data: {
          username: fixture.operator.username,
          password: fixture.operator.password,
        },
      }),
      200,
    );
    expect(login).toMatchObject({
      principalType: 'INTERNAL',
      user: { id: fixture.operator.id },
    });
    actor = { context, csrf: login.csrfToken };
  });
  test.afterAll(async () => {
    await actor?.context.dispose();
  });

  test('second result revocation removes the old source, new registration survives early archive and application', async () => {
    const current = await createDirectSecond();
    const progress = await saveSecond(current);
    const first = await registerSecond(current, progress.version, 'AFFIRM');
    expect(first.stage).toBe('WAITING_EXECUTION_DOCUMENTS');
    expect(await refundDates(first.resultId, first.recordedAt)).toMatchObject({
      source: {
        sourceType: 'SECOND_INSTANCE_RESULT',
        dueDate: shanghaiDay(15, first.recordedAt),
        applied: false,
      },
    });
    const revoked = await post<{ version: number; stage: string }>(
      current.id,
      'second-instance-result-revoke',
      {
        expectedVersion: first.version,
        trialRoundId: current.currentTrialRoundId,
        resultId: first.resultId,
        reason: '合成事实纠错后重新登记',
      },
    );
    expect(revoked.stage).toBe('SECOND_INSTANCE');
    expect(
      (await refundDates(first.resultId, first.recordedAt)).source,
    ).toBeUndefined();
    const replacement = await registerSecond(
      current,
      revoked.version,
      'AFFIRM',
    );
    expect(replacement.resultId).not.toBe(first.resultId);
    expect(
      (await refundDates(replacement.resultId, replacement.recordedAt)).source,
    ).toMatchObject({ applied: false });
    const boundary = await verifyBatch2RefundBoundaryAndRead(fixture, {
      caseId: current.id,
      resultId: replacement.resultId,
      recordedAt: replacement.recordedAt,
    });
    expect(boundary).toMatchObject({
      dueAt: `${shanghaiDay(15, replacement.recordedAt)}T01:00:00.000Z`,
      beforeAbsent: true,
      atPresent: true,
      readStable: true,
      persisted: 1,
      afterRead: expect.any(String),
    });
    const archived = await post<{ version: number; stage: string }>(
      current.id,
      'early-archive',
      {
        expectedVersion: replacement.version,
        archiveAt: shanghaiDay(),
        reason: '合成提前归档，保留独立财务待办',
      },
    );
    expect(archived.stage).toBe('ARCHIVED');
    expect(
      (await refundDates(replacement.resultId, replacement.recordedAt)).source,
    ).toMatchObject({ applied: false });
    expect(
      await readBatch2RefundLedger(
        current.id,
        fixture.departmentId,
        replacement.resultId,
      ),
    ).toEqual({
      applications: 0,
      reads: 1,
      refund_fees: 0,
      actual_refunds: 0,
    });
    await body(
      await actor.context.post('/api/v1/calendar/refund-applications', {
        headers: headers(),
        data: {
          sourceType: 'SECOND_INSTANCE_RESULT',
          sourceId: replacement.resultId,
          applicationDate: shanghaiDay(),
          note: '归档后真实登记已申请',
        },
      }),
    );
    expect(
      (await refundDates(replacement.resultId, replacement.recordedAt)).source,
    ).toMatchObject({ applied: true });
    expect(
      await readBatch2RefundLedger(
        current.id,
        fixture.departmentId,
        replacement.resultId,
      ),
    ).toEqual({
      applications: 1,
      reads: 1,
      refund_fees: 0,
      actual_refunds: 0,
    });
  });

  test('remand revocation invalidates its child round; re-remand and formal child judgment start independent clocks', async () => {
    const current = await createDirectSecond();
    const progress = await saveSecond(current);
    const first = await registerSecond(current, progress.version, 'REMAND');
    expect(first.stage).toBe('WAITING_FORMAL_ACCEPTANCE');
    expect(
      (await refundDates(first.resultId, first.recordedAt)).source,
    ).toMatchObject({
      sourceType: 'SECOND_INSTANCE_RESULT',
      dueDate: shanghaiDay(15, first.recordedAt),
    });
    const revoked = await post<{ version: number; stage: string }>(
      current.id,
      'second-instance-result-revoke',
      {
        expectedVersion: first.version,
        trialRoundId: current.currentTrialRoundId,
        resultId: first.resultId,
        reason: '空子轮撤销，核对新判决',
      },
    );
    expect(revoked.stage).toBe('SECOND_INSTANCE');
    expect(
      await readBatch2RoundRevokedAt(
        first.currentTrialRoundId,
        current.id,
        fixture.departmentId,
      ),
    ).toBeInstanceOf(Date);
    expect(
      (await refundDates(first.resultId, first.recordedAt)).source,
    ).toBeUndefined();
    const second = await registerSecond(current, revoked.version, 'REMAND');
    expect(second.currentTrialRoundId).not.toBe(first.currentTrialRoundId);
    expect(second.resultId).not.toBe(first.resultId);
    expect(
      (await refundDates(second.resultId, second.recordedAt)).source,
    ).toMatchObject({ applied: false });
    const acceptance = await upload(
      current.id,
      'ACCEPTANCE_NOTICE',
      'Batch2 remand acceptance',
    );
    const accepted = await post<{ version: number }>(
      current.id,
      'acceptance-register',
      {
        expectedVersion: second.version,
        courtId: filingCourtId,
        acceptedAt: shanghaiDay(-4),
        courtCaseNo: `B2R-${randomUUID().slice(0, 8)}`,
        acceptanceNoticeContentVersionIds: [acceptance.contentVersionId],
      },
    );
    const hearing = await post<{ version: number }>(
      current.id,
      'hearing-schedule',
      {
        expectedVersion: accepted.version,
        hearingAt: shanghaiDay(-3),
      },
    );
    expect(hearing.version).toBeGreaterThan(accepted.version);
    await expect
      .poll(async () => {
        const detail = await body<{ stage: string }>(
          await actor.context.get(`/api/v1/cases/${current.id}`),
          200,
        );
        return detail.stage;
      })
      .toBe('WAITING_JUDGMENT');
    const detail = await body<{ version: number }>(
      await actor.context.get(`/api/v1/cases/${current.id}`),
      200,
    );
    const judgmentFile = await upload(
      current.id,
      'JUDGMENT',
      'Batch2 remand judgment',
    );
    const judgment = await post<{
      judgmentId: string;
      version: number;
      recordedAt: string;
    }>(current.id, 'judgment-register', {
      expectedVersion: detail.version,
      judgmentReceivedAt: shanghaiDay(-2),
      judgmentAmountState: 'PENDING',
      judgmentAmount: null,
      paidLitigationFeeState: 'PENDING',
      paidLitigationFee: null,
      judgmentContentVersionIds: [judgmentFile.contentVersionId],
    });
    expect(
      (await refundDates(judgment.judgmentId, judgment.recordedAt)).source,
    ).toMatchObject({
      sourceType: 'FIRST_INSTANCE_JUDGMENT',
      dueDate: shanghaiDay(15, judgment.recordedAt),
      applied: false,
    });
    const correctionFile = await upload(
      current.id,
      'JUDGMENT',
      'Batch2 remand correction',
    );
    const correction = await post<{ judgmentId: string }>(
      current.id,
      'judgment-correct',
      {
        expectedVersion: judgment.version,
        judgmentReceivedAt: shanghaiDay(-2),
        judgmentAmountState: 'PENDING',
        judgmentAmount: null,
        paidLitigationFeeState: 'PENDING',
        paidLitigationFee: null,
        judgmentContentVersionIds: [correctionFile.contentVersionId],
        reason: '合成重审附件更正',
      },
    );
    expect(correction.judgmentId).not.toBe(judgment.judgmentId);
    expect(
      (await refundDates(judgment.judgmentId, judgment.recordedAt)).source,
    ).toMatchObject({
      dueDate: shanghaiDay(15, judgment.recordedAt),
      applied: false,
    });
  });
});
