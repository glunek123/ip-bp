import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test';
import {
  assertBatch2Admission,
  readBatch2CertificateDownstream,
  readBatch2ProxyAudit,
} from '../support/batch2-proxy-calendar-acceptance.mjs';
import {
  seedBatch2ProxyCalendarActors,
  transferBatch2SyntheticCaseOwner,
} from '../support/batch2-proxy-calendar-fixture.mjs';

assertBatch2Admission();
const origin = 'http://127.0.0.1:5174';
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
const openingPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64',
);
type Actor = {
  context: APIRequestContext;
  headers: { 'X-CSRF-Token': string };
  id: string;
};
type Fixture = Awaited<ReturnType<typeof seedBatch2ProxyCalendarActors>>;
let fixture: Fixture;
let operator: Actor;
let colleague: Actor;
let foreign: Actor;
let client: Actor;

const beijingDayAt = (instant: Date | string, offset = 0) => {
  const value = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant));
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
const day = (offset = 0) => beijingDayAt(new Date(), offset);
async function body<T>(response: APIResponse, status: number): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json() as Promise<T>;
}
const commandHeaders = (actor: Actor, key = randomUUID()) => ({
  ...actor.headers,
  'Idempotency-Key': key,
});
async function login(
  context: APIRequestContext,
  account: { id: string; username: string; password: string },
  principalType: string,
): Promise<Actor> {
  const response = await context.post('/api/v1/auth/login', {
    headers: { Origin: origin },
    data: { username: account.username, password: account.password },
  });
  const session = await body<{
    csrfToken: string;
    principalType: string;
    user: { id: string };
  }>(response, 200);
  expect(session).toMatchObject({ principalType, user: { id: account.id } });
  return {
    context,
    headers: { 'X-CSRF-Token': session.csrfToken },
    id: account.id,
  };
}
function leadInput(customerId: string, rightsHolderId: string) {
  return {
    customerId,
    rightsHolderId,
    caseType: 'CIVIL',
    infringementTypes: ['TRADEMARK'],
    source: 'ONLINE',
    platform: 'TAOBAO',
    foundAt: new Date().toISOString(),
    shopName: `批次合成店铺-${randomUUID()}`,
    needDisclose: false,
    products: [
      { title: '合成商品', quantity: 2, unitPrice: '10.00', commentCount: 1 },
    ],
    leadScreenshotContentVersionIds: [],
  };
}
async function createAndPush(customerId: string) {
  const created = await body<{
    id: string;
    businessNo: string;
    version: number;
  }>(
    await operator.context.post('/api/v1/leads', {
      headers: commandHeaders(operator),
      data: leadInput(customerId, fixture.rightsHolderId),
    }),
    201,
  );
  expect(created.version).toBe(1);
  const pushed = await body<{ version: number; status: string }>(
    await operator.context.post(`/api/v1/leads/${created.id}/push`, {
      headers: commandHeaders(operator),
      data: { expectedVersion: 1 },
    }),
    201,
  );
  expect(pushed).toMatchObject({ version: 2, status: 'WAITING_REVIEW' });
  return created;
}
async function upload(
  ownerType: 'CASE' | 'NOTARY_MATTER',
  ownerId: string,
  category: string,
  bytes: Buffer,
) {
  const draft = await body<{ id: string }>(
    await operator.context.post('/api/v1/materials/upload-drafts', {
      headers: operator.headers,
      data: {
        ownerType,
        ownerId,
        category,
        purpose: category,
        originalFilename: `batch2-${category}-${randomUUID()}.${category === 'NOTARY_OPENING_PHOTO' ? 'png' : 'pdf'}`,
        declaredMimeType:
          category === 'NOTARY_OPENING_PHOTO' ? 'image/png' : 'application/pdf',
      },
    }),
    201,
  );
  return body<{ materialId: string; contentVersionId: string }>(
    await operator.context.put(
      `/api/v1/materials/upload-drafts/${draft.id}/content`,
      {
        headers: {
          ...operator.headers,
          'Content-Type': 'application/octet-stream',
        },
        data: bytes,
      },
    ),
    200,
  );
}

test.describe.serial('Batch 2 owned proxy and calendar acceptance', () => {
  test.setTimeout(300_000);
  test.beforeAll(async ({ playwright }) => {
    fixture = await seedBatch2ProxyCalendarActors();
    operator = await login(
      await playwright.request.newContext({ baseURL: origin }),
      fixture.operator,
      'INTERNAL',
    );
    colleague = await login(
      await playwright.request.newContext({ baseURL: origin }),
      fixture.colleague,
      'INTERNAL',
    );
    foreign = await login(
      await playwright.request.newContext({ baseURL: origin }),
      fixture.foreign,
      'INTERNAL',
    );
    client = await login(
      await playwright.request.newContext({ baseURL: origin }),
      fixture.clientAccount,
      'CLIENT',
    );
  });
  test.afterAll(async () => {
    await Promise.all(
      [operator, colleague, foreign, client]
        .filter(Boolean)
        .map((actor) => actor.context.dispose()),
    );
  });

  test('personal item persists, another user cannot edit, late browser login shows content and read persists', async ({
    page,
  }) => {
    const eventDate = day(-1);
    const title = `本人日历-${randomUUID()}`;
    const created = await body<{ id: string; version: number }>(
      await operator.context.post('/api/v1/calendar/personal', {
        headers: operator.headers,
        data: { title, eventDate, note: '验收备注' },
      }),
      201,
    );
    const foreignEdit = await foreign.context.patch(
      `/api/v1/calendar/personal/${created.id}`,
      {
        headers: foreign.headers,
        data: {
          title: '越权',
          eventDate,
          note: null,
          expectedVersion: created.version,
        },
      },
    );
    expect([403, 404]).toContain(foreignEdit.status());
    const colleagueEdit = await colleague.context.patch(
      `/api/v1/calendar/personal/${created.id}`,
      {
        headers: colleague.headers,
        data: {
          title: '越权',
          eventDate,
          note: null,
          expectedVersion: created.version,
        },
      },
    );
    expect([403, 404]).toContain(colleagueEdit.status());
    const due = await body<
      Array<{
        sourceType: string;
        sourceId: string;
        sourceEpoch: string;
        eventDate: string;
        readAt: string | null;
      }>
    >(await operator.context.get('/api/v1/calendar/reminders'), 200);
    const item = due.find((entry) => entry.sourceId === created.id);
    expect(item).toMatchObject({
      sourceType: 'MANUAL',
      sourceEpoch: created.id,
      eventDate,
      readAt: null,
    });
    await page.goto('/calendar');
    await page.getByLabel('用户名').fill(fixture.operator.username);
    await page.getByLabel('密码').fill(fixture.operator.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.locator('.app-reminders__panel')).toContainText(title);
    await page
      .locator('.app-reminders__panel')
      .getByRole('button', { name: '查看' })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/calendar\\?month=${eventDate.slice(0, 7)}`, 'u'),
    );
    await expect(page.getByText(title)).toBeVisible();
    await page.locator('.app-reminders__toggle').click();
    await page
      .locator('.app-reminders__panel')
      .getByRole('button', { name: '标记已读' })
      .click();
    await expect(page.locator('.app-reminders__panel')).toContainText('已读');
    await page.reload();
    const read = await body<Array<{ sourceId: string; readAt: string | null }>>(
      await operator.context.get('/api/v1/calendar/reminders'),
      200,
    );
    expect(
      read.find((entry) => entry.sourceId === created.id)?.readAt,
    ).not.toBeNull();
    const changed = await body<{ version: number }>(
      await operator.context.patch(`/api/v1/calendar/personal/${created.id}`, {
        headers: operator.headers,
        data: {
          title,
          eventDate: day(-2),
          note: '改期',
          expectedVersion: created.version,
        },
      }),
      200,
    );
    expect(changed.version).toBe(created.version + 1);
    const reopened = await body<
      Array<{ sourceId: string; readAt: string | null }>
    >(await operator.context.get('/api/v1/calendar/reminders'), 200);
    expect(
      reopened.find((entry) => entry.sourceId === created.id)?.readAt,
    ).toBeNull();
  });

  test('real create/push, proxy review with and without client account, withdrawal and version competition', async () => {
    const withAccount = await createAndPush(fixture.customers.withAccount);
    const noAccount = await createAndPush(fixture.customers.withoutAccount);
    for (const [lead, result] of [
      [withAccount, 'INFRINGEMENT'],
      [noAccount, 'NO_INFRINGEMENT'],
    ] as const) {
      const key = randomUUID();
      const requestBody = {
        result,
        expectedVersion: 2,
        ...(result === 'NO_INFRINGEMENT' ? { reason: '真实核对无侵权' } : {}),
      };
      const path = `/api/v1/leads/${lead.id}/proxy-reviews`;
      const headers = commandHeaders(operator, key);
      const first = await body<{ version: number }>(
        await operator.context.post(path, { headers, data: requestBody }),
        201,
      );
      const replay = await body<{ version: number }>(
        await operator.context.post(path, { headers, data: requestBody }),
        201,
      );
      expect(replay).toEqual(first);
      const changedSameKey = await operator.context.post(path, {
        headers,
        data:
          result === 'INFRINGEMENT'
            ? {
                result: 'NO_INFRINGEMENT',
                reason: '不同结论',
                expectedVersion: 2,
              }
            : { result: 'INFRINGEMENT', expectedVersion: 2 },
      });
      expect(changedSameKey.status()).toBe(409);
      expect(await readBatch2ProxyAudit('review', lead.id)).toEqual([
        expect.objectContaining({
          actor_kind: 'INTERNAL_PROXY',
          actor_user_id: fixture.operator.id,
          internal_actor_user_id: fixture.operator.id,
          binding_id: null,
          result,
          occurred_at: expect.any(Date),
        }),
      ]);
      const stale = await operator.context.post(path, {
        headers: commandHeaders(operator),
        data: requestBody,
      });
      expect(stale.status()).toBe(409);
    }
    const application = await body<{ id: string; version: number }>(
      await operator.context.post(
        `/api/v1/leads/${noAccount.id}/withdrawal-applications`,
        {
          headers: commandHeaders(operator),
          data: { reason: '真实补充证据', expectedVersion: 3 },
        },
      ),
      201,
    );
    const withdrawalPath = `/api/v1/leads/${noAccount.id}/proxy-withdrawal-confirmations`;
    const withdrawalBody = {
      applicationId: application.id,
      expectedVersion: application.version,
    };
    const withdrawalHeaders = commandHeaders(operator);
    const first = await body<{ version: number }>(
      await operator.context.post(withdrawalPath, {
        headers: withdrawalHeaders,
        data: withdrawalBody,
      }),
      201,
    );
    expect(
      await body(
        await operator.context.post(withdrawalPath, {
          headers: withdrawalHeaders,
          data: withdrawalBody,
        }),
        201,
      ),
    ).toEqual(first);
    expect(
      (
        await operator.context.post(withdrawalPath, {
          headers: withdrawalHeaders,
          data: {
            applicationId: randomUUID(),
            expectedVersion: application.version,
          },
        })
      ).status(),
    ).toBe(409);
    expect(await readBatch2ProxyAudit('withdrawal', application.id)).toEqual([
      expect.objectContaining({
        actor_kind: 'INTERNAL_PROXY',
        actor_user_id: fixture.operator.id,
        internal_actor_user_id: fixture.operator.id,
        binding_id: null,
        result: 'WAITING_REVIEW',
        occurred_at: expect.any(Date),
      }),
    ]);
    const racedLead = await createAndPush(fixture.customers.withAccount);
    const [proxy, external] = await Promise.all([
      operator.context.post(`/api/v1/leads/${racedLead.id}/proxy-reviews`, {
        headers: commandHeaders(operator),
        data: { result: 'INFRINGEMENT', expectedVersion: 2 },
      }),
      client.context.post(`/api/v1/client/leads/${racedLead.id}/reviews`, {
        headers: commandHeaders(client),
        data: { result: 'INFRINGEMENT', expectedVersion: 2 },
      }),
    ]);
    expect([proxy.status(), external.status()].sort()).toEqual([201, 409]);
  });

  test('browser operator clicks proxy review and the persisted actor is internal', async ({
    page,
  }) => {
    const lead = await createAndPush(fixture.customers.withoutAccount);
    await page.goto(
      `/leads?status=WAITING_REVIEW&q=${encodeURIComponent(lead.businessNo)}`,
    );
    await page.getByLabel('用户名').fill(fixture.operator.username);
    await page.getByLabel('密码').fill(fixture.operator.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    const row = page
      .locator('[data-test="lead-row"]')
      .filter({ hasText: lead.businessNo });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '代办客户审核' }).click();
    await page.getByRole('radio', { name: '确认侵权' }).check();
    await page.locator('[data-test="submit-lead-workflow"]').click();
    await expect
      .poll(() => readBatch2ProxyAudit('review', lead.id))
      .toEqual([
        expect.objectContaining({
          actor_kind: 'INTERNAL_PROXY',
          actor_user_id: fixture.operator.id,
          internal_actor_user_id: fixture.operator.id,
          binding_id: null,
          result: 'INFRINGEMENT',
          occurred_at: expect.any(Date),
        }),
      ]);
  });

  test('real prior lead/notary steps allow proxy certificate with and without an external notary account', async () => {
    for (const externalAccountExists of [false, true]) {
      const lead = await createAndPush(fixture.customers.withAccount);
      await body(
        await operator.context.post(`/api/v1/leads/${lead.id}/proxy-reviews`, {
          headers: commandHeaders(operator),
          data: { result: 'INFRINGEMENT', expectedVersion: 2 },
        }),
        201,
      );
      const office = await body<{ id: string }>(
        await operator.context.post('/api/v1/notary-offices', {
          headers: operator.headers,
          data: { name: `批次公证处-${randomUUID()}` },
        }),
        201,
      );
      if (externalAccountExists)
        await body(
          await operator.context.post(
            `/api/v1/notary-offices/${office.id}/accounts`,
            {
              headers: operator.headers,
              data: {
                displayName: '合成公证员',
                username: `b2.notary.${randomUUID()}`,
                password: `B2Notary-${randomUUID()}-2026!`,
              },
            },
          ),
          201,
        );
      const detail = await body<{ products: Array<{ id: string }> }>(
        await operator.context.get(`/api/v1/leads/${lead.id}`),
        200,
      );
      const matter = await body<{ id: string }>(
        await operator.context.post(`/api/v1/leads/${lead.id}/notary-matters`, {
          headers: commandHeaders(operator),
          data: {
            selectedProductIds: [detail.products[0].id],
            selectedContentVersionIds: [],
            notaryOfficeId: office.id,
            evidenceMode: 'ONLINE_PURCHASE',
            batchPurpose: '本批真实取证',
            expectedVersion: 3,
          },
        }),
        201,
      );
      await body(
        await operator.context.post(
          `/api/v1/notary-matters/${matter.id}/evidence`,
          {
            headers: commandHeaders(operator),
            data: {
              evidenceAt: day(-1),
              sampleFeeState: 'PENDING',
              logistics: [{ companyState: 'NONE', trackingState: 'NONE' }],
              expectedVersion: 1,
            },
          },
        ),
        201,
      );
      const photo = await upload(
        'NOTARY_MATTER',
        matter.id,
        'NOTARY_OPENING_PHOTO',
        openingPng,
      );
      await body(
        await operator.context.post(
          `/api/v1/notary-matters/${matter.id}/opening`,
          {
            headers: commandHeaders(operator),
            data: {
              expectedVersion: 2,
              contentVersionIds: [photo.contentVersionId],
            },
          },
        ),
        201,
      );
      await body(
        await operator.context.post(
          `/api/v1/notary-matters/${matter.id}/opening-review`,
          {
            headers: commandHeaders(operator),
            data: { result: 'INFRINGEMENT', expectedVersion: 3 },
          },
        ),
        201,
      );
      await body(
        await operator.context.post(
          `/api/v1/notary-matters/${matter.id}/issuance-decision`,
          {
            headers: commandHeaders(operator),
            data: { decision: 'ISSUE', expectedVersion: 4 },
          },
        ),
        201,
      );
      const certificate = await upload(
        'NOTARY_MATTER',
        matter.id,
        'NOTARY_CERTIFICATE',
        pdf,
      );
      const certificateBody = {
        expectedVersion: 5,
        certificateNo: `（2026）批证字${randomUUID().slice(0, 8)}号`,
        certificateDate: day(),
        contentVersionIds: [certificate.contentVersionId],
        needDisclose: false,
        disclosureContentVersionIds: [],
        fees: {
          notary: { state: 'KNOWN', amount: '120.00' },
          investigation: { state: 'PENDING', amount: null },
          disclosure: { state: 'KNOWN', amount: '0.00' },
        },
      };
      const path = `/api/v1/notary-matters/${matter.id}/proxy-certificate`;
      const headers = commandHeaders(operator);
      const foreignAttempt = await foreign.context.post(path, {
        headers: commandHeaders(foreign),
        data: certificateBody,
      });
      expect([403, 404]).toContain(foreignAttempt.status());
      const issued = await body<{
        case: { id: string };
        certificate: { files: unknown[] };
      }>(
        await operator.context.post(path, { headers, data: certificateBody }),
        201,
      );
      expect(issued.certificate.files).toHaveLength(1);
      expect(
        await body(
          await operator.context.post(path, { headers, data: certificateBody }),
          201,
        ),
      ).toEqual(issued);
      expect(
        (
          await operator.context.post(path, {
            headers,
            data: {
              ...certificateBody,
              certificateNo: `${certificateBody.certificateNo}-不同`,
            },
          })
        ).status(),
      ).toBe(409);
      expect(await readBatch2ProxyAudit('certificate', matter.id)).toEqual([
        expect.objectContaining({
          actor_kind: 'INTERNAL_PROXY',
          actor_user_id: fixture.operator.id,
          internal_actor_user_id: fixture.operator.id,
          binding_id: null,
          result: certificateBody.certificateNo,
          occurred_at: expect.any(Date),
        }),
      ]);
      const downstream = await readBatch2CertificateDownstream(
        matter.id,
        issued.case.id,
      );
      expect(downstream).toMatchObject({ fees: 3 });
      expect(downstream.evidence).toBeGreaterThan(0);
      expect(downstream.feeRecords).toBeGreaterThanOrEqual(2);
      const downloaded = await operator.context.get(
        `/api/v1/materials/${certificate.materialId}/versions/${certificate.contentVersionId}/content`,
      );
      expect(downloaded.status(), await downloaded.text()).toBe(200);
      expect(Buffer.from(await downloaded.body())).toEqual(pdf);
    }
  });

  test('real formal REGISTER yields +15 day source; application is separate from read and refund', async () => {
    const today = day();
    const created = await body<{ id: string; version: number }>(
      await operator.context.post('/api/v1/cases/external-entries', {
        headers: operator.headers,
        data: {
          idempotencyKey: randomUUID(),
          entryKind: 'EXTERNAL_TRANSFER',
          initialStage: 'WAITING_JUDGMENT',
          stageReachedOn: today,
          source: `本批合成转入-${randomUUID()}`,
          reason: '真实现阶段转入验收',
          customerId: fixture.customers.withAccount,
          rightsHolderId: fixture.rightsHolderId,
          defendants: [{ kind: 'ORGANIZATION', name: '合成被告' }],
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
        },
      }),
      201,
    );
    const file = await upload('CASE', created.id, 'JUDGMENT', pdf);
    const judgment = await body<{
      judgmentId: string;
      recordedAt: string;
      version: number;
    }>(
      await operator.context.post(
        `/api/v1/cases/${created.id}/judgment-register`,
        {
          headers: operator.headers,
          data: {
            expectedVersion: created.version,
            idempotencyKey: randomUUID(),
            judgmentReceivedAt: today,
            judgmentAmountState: 'PENDING',
            judgmentAmount: null,
            paidLitigationFeeState: 'PENDING',
            paidLitigationFee: null,
            judgmentContentVersionIds: [file.contentVersionId],
          },
        },
      ),
      201,
    );
    const dueDate = beijingDayAt(judgment.recordedAt, 15);
    expect(judgment.recordedAt).toEqual(expect.any(String));
    const dates = await body<
      Array<{ sourceId: string; dueDate: string; applied: boolean }>
    >(
      await operator.context.get(
        `/api/v1/calendar/refund-dates?month=${dueDate.slice(0, 7)}`,
      ),
      200,
    );
    expect(dates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: judgment.judgmentId,
          dueDate,
          applied: false,
        }),
      ]),
    );
    expect(
      await transferBatch2SyntheticCaseOwner(
        created.id,
        fixture.departmentId,
        fixture.operator.id,
        fixture.colleague.id,
      ),
    ).toBe(1);
    const oldOwnerDates = await body<Array<{ sourceId: string }>>(
      await operator.context.get(
        `/api/v1/calendar/refund-dates?month=${dueDate.slice(0, 7)}`,
      ),
      200,
    );
    expect(
      oldOwnerDates.some((item) => item.sourceId === judgment.judgmentId),
    ).toBe(false);
    const newOwnerDates = await body<Array<{ sourceId: string }>>(
      await colleague.context.get(
        `/api/v1/calendar/refund-dates?month=${dueDate.slice(0, 7)}`,
      ),
      200,
    );
    expect(
      newOwnerDates.some((item) => item.sourceId === judgment.judgmentId),
    ).toBe(true);
    expect(
      await transferBatch2SyntheticCaseOwner(
        created.id,
        fixture.departmentId,
        fixture.colleague.id,
        fixture.operator.id,
      ),
    ).toBe(2);
    const correctionFile = await upload(
      'CASE',
      created.id,
      'JUDGMENT',
      Buffer.from('%PDF-1.4\ncorrected synthetic judgment\n%%EOF\n'),
    );
    const correction = await body<{ judgmentId: string; version: number }>(
      await operator.context.post(
        `/api/v1/cases/${created.id}/judgment-correct`,
        {
          headers: operator.headers,
          data: {
            expectedVersion: judgment.version,
            idempotencyKey: randomUUID(),
            judgmentReceivedAt: today,
            judgmentAmountState: 'PENDING',
            judgmentAmount: null,
            paidLitigationFeeState: 'PENDING',
            paidLitigationFee: null,
            judgmentContentVersionIds: [correctionFile.contentVersionId],
            reason: '核对后更换附件',
          },
        },
      ),
      201,
    );
    expect(correction.judgmentId).not.toBe(judgment.judgmentId);
    const afterCorrection = await body<
      Array<{ sourceId: string; dueDate: string }>
    >(
      await operator.context.get(
        `/api/v1/calendar/refund-dates?month=${dueDate.slice(0, 7)}`,
      ),
      200,
    );
    expect(
      afterCorrection.filter((item) => item.sourceId === judgment.judgmentId),
    ).toEqual([expect.objectContaining({ dueDate })]);
    const applicationBody = {
      sourceType: 'FIRST_INSTANCE_JUDGMENT',
      sourceId: judgment.judgmentId,
      applicationDate: today,
      note: '本批实际登记已申请',
    };
    const first = await body<{ id: string }>(
      await operator.context.post('/api/v1/calendar/refund-applications', {
        headers: operator.headers,
        data: applicationBody,
      }),
      201,
    );
    const replay = await body<{ id: string }>(
      await operator.context.post('/api/v1/calendar/refund-applications', {
        headers: operator.headers,
        data: applicationBody,
      }),
      201,
    );
    expect(replay.id).toBe(first.id);
    expect(
      (
        await operator.context.post('/api/v1/calendar/refund-applications', {
          headers: operator.headers,
          data: { ...applicationBody, note: '不同事实' },
        })
      ).status(),
    ).toBe(409);
    const applied = await body<Array<{ sourceId: string; applied: boolean }>>(
      await operator.context.get(
        `/api/v1/calendar/refund-dates?month=${dueDate.slice(0, 7)}`,
      ),
      200,
    );
    expect(applied).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: judgment.judgmentId,
          applied: true,
        }),
      ]),
    );
  });
});
