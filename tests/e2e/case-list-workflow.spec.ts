import { randomUUID } from 'node:crypto';
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test';
import {
  prepareCaseListWorkflowActors,
  captureCaseListWorkflowEnvironment,
} from '../support/case-list-workflow-database.mjs';
type CaseRead = {
  stage: string;
  version: number;
  judgment: { current: { judgmentAmount: string | null } | null };
  judgmentNextStep: { history: unknown[] };
  secondInstance: {
    currentResult: unknown | null;
    currentProgress: { hearingAt: string | null } | null;
  };
  recordEdits?: {
    secondInstanceAcceptances?: { acceptedAt: string | null }[];
    judgments?: {
      judgmentId: string;
      trialRoundId: string;
      judgmentRevision: number;
      canEdit: boolean;
      original: unknown;
      effective: {
        judgmentReceivedAt: string;
        paidLitigationFeeState: 'KNOWN' | 'PENDING';
        paidLitigationFee: string | null;
        judgmentContentVersionIds: string[];
      };
    }[];
  };
};

// Intentionally append-only. The managed runner reviews and runs this spec;
// it never imports the historical reset/clear fixtures.
let fixture: Awaited<ReturnType<typeof prepareCaseListWorkflowActors>>;
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const pdf = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
async function json<T>(response: APIResponse, status: number): Promise<T> {
  expect(
    response.status(),
    `Unexpected status for ${new URL(response.url()).pathname}`,
  ).toBe(status);
  return (await response.json()) as T;
}
async function login(page: Page, actor = fixture.operator) {
  await page.goto('/cases');
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await page.getByLabel('用户名').fill(actor.username);
  await page.getByLabel('密码').fill(actor.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/cases');
  return (
    await json<{ csrfToken: string }>(
      await page.request.get('/api/v1/auth/session'),
      200,
    )
  ).csrfToken;
}
async function upload(
  request: APIRequestContext,
  csrf: string,
  ownerType: 'CUSTOMER' | 'CASE',
  ownerId: string,
  category: string,
  purpose = category,
) {
  const draft = await json<{ id: string }>(
    await request.post('/api/v1/materials/upload-drafts', {
      headers: { 'X-CSRF-Token': csrf },
      data: {
        ownerType,
        ownerId,
        category,
        purpose,
        originalFilename: `c2-${randomUUID()}.pdf`,
        declaredMimeType: 'application/pdf',
      },
    }),
    201,
  );
  return json<{ contentVersionId: string }>(
    await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
      headers: {
        'X-CSRF-Token': csrf,
        'Content-Type': 'application/octet-stream',
      },
      data: pdf,
    }),
    200,
  );
}
async function parties(page: Page, csrf: string) {
  const request = page.request;
  const headers = { 'X-CSRF-Token': csrf };
  const name = `C2 合成客户 ${randomUUID()}`;
  const customer = await json<{ id: string; version: number }>(
    await request.post('/api/v1/customers', { headers, data: { name } }),
    201,
  );
  const contact = await json<{
    contact: { id: string };
    customerVersion: number;
  }>(
    await request.post(`/api/v1/customers/${customer.id}/contacts`, {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      data: {
        expectedCustomerVersion: customer.version,
        name: '合成联系人',
        phone: '13800138000',
        isPrimary: true,
      },
    }),
    201,
  );
  const material = await upload(
    request,
    csrf,
    'CUSTOMER',
    customer.id,
    'CUSTOMER_IDENTITY',
    'IDENTITY_FULL',
  );
  const admitted = await json<{ version: number }>(
    await request.post(`/api/v1/customers/${customer.id}/admission`, {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      data: {
        expectedVersion: contact.customerVersion,
        customerType: 'ENTERPRISE',
        name,
        identityType: 'BUSINESS_LICENSE',
        identityNumber: `C2-${randomUUID()}`,
        identityValidityMode: 'LONG_TERM',
        admissionContactId: contact.contact.id,
        identityDocumentContentVersionIds: [material.contentVersionId],
      },
    }),
    201,
  );
  const linked = await json<{ holder: { id: string } }>(
    await request.post(`/api/v1/customers/${customer.id}/rights-holders`, {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      data: {
        expectedCustomerVersion: admitted.version,
        name: `C2 合成权利主体 ${randomUUID()}`,
      },
    }),
    201,
  );
  return { customerId: customer.id, rightsHolderId: linked.holder.id };
}
async function entry(
  page: Page,
  csrf: string,
  parties: { customerId: string; rightsHolderId: string },
  initialStage: 'WAITING_JUDGMENT' | 'SECOND_INSTANCE' = 'WAITING_JUDGMENT',
) {
  return json<{ id: string; businessNo: string }>(
    await page.request.post('/api/v1/cases/external-entries', {
      headers: { 'X-CSRF-Token': csrf },
      data: {
        ...parties,
        idempotencyKey: randomUUID(),
        entryKind: 'HISTORICAL_BACKFILL',
        initialStage,
        stageReachedOn: today(),
        source: `C2:${fixture.run}:${randomUUID()}`,
        reason: '合成列表原位流程验收',
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
      },
    }),
    201,
  );
}
async function read(page: Page, id: string) {
  return json<CaseRead>(await page.request.get(`/api/v1/cases/${id}`), 200);
}
async function registered(page: Page, csrf: string, id: string) {
  const material = await upload(page.request, csrf, 'CASE', id, 'JUDGMENT');
  await json(
    await page.request.post(`/api/v1/cases/${id}/judgment-register`, {
      headers: { 'X-CSRF-Token': csrf },
      data: {
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
        judgmentReceivedAt: today(),
        judgmentAmountState: 'KNOWN',
        judgmentAmount: '12.30',
        paidLitigationFeeState: 'PENDING',
        paidLitigationFee: null,
        judgmentContentVersionIds: [material.contentVersionId],
      },
    }),
    201,
  );
}
const row = (page: Page, businessNo: string) =>
  page
    .locator('tbody tr')
    .filter({ has: page.getByRole('link', { name: businessNo, exact: true }) });
async function confirmChoice(
  page: Page,
  next: 'APPEAL' | 'EXECUTION',
  doubleClick = false,
) {
  const panel = page.locator('[data-test="case-judgment-next-step-panel"]');
  await expect(panel.locator('input[type="radio"]:checked')).toHaveCount(0);
  await panel.locator(`input[value="${next}"]`).check();
  await expect(panel.locator('button[type="submit"]')).toBeDisabled();
  await panel.locator('input[type="checkbox"]').check();
  await panel.locator('button[type="submit"]').click();
  if (doubleClick) await panel.locator('[data-confirm-choice]').dblclick();
  else await panel.locator('[data-confirm-choice]').click();
}
test.describe('case list in-place workflow (managed runner only)', () => {
  test.beforeAll(async () => {
    fixture = await prepareCaseListWorkflowActors();
  });
  test.afterAll(() => {
    if (fixture)
      expect(captureCaseListWorkflowEnvironment()).toBe(
        fixture.environmentFingerprint,
      );
  });

  test('page two registers then edits judgment without advancing, chooses appeal in place and persists after re-login', async ({
    page,
  }) => {
    const csrf = await login(page);
    const party = await parties(page, csrf);
    const target = await entry(page, csrf, party);
    for (let index = 0; index < 21; index++) await entry(page, csrf, party);
    const path = '/cases?view=department&stage=WAITING_JUDGMENT&page=2';
    await page.goto(path);
    await row(page, target.businessNo)
      .locator('[data-case-action="register-judgment"]')
      .click();
    await expect(
      page.locator('[data-test="case-judgment-panel"]'),
    ).toBeVisible();
    await page.locator('[data-test="judgment-date"]').fill(today());
    await page
      .locator('[data-test="judgment-amount-state"]')
      .selectOption('KNOWN');
    await page.locator('[data-test="judgment-amount"]').fill('12.30');
    await page.locator('[data-test="paid-fee-state"]').selectOption('PENDING');
    await page.locator('[data-test="judgment-file-input"]').setInputFiles({
      name: 'c2-list-judgment.pdf',
      mimeType: 'application/pdf',
      buffer: pdf,
    });
    const receipt = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname ===
          `/api/v1/cases/${target.id}/judgment-register`,
    );
    await page.locator('[data-test="judgment-submit"]').click();
    expect((await receipt).status()).toBe(201);
    await expect(page.locator('[data-test="case-list-workflow"]')).toHaveCount(
      0,
    );
    expect(new URL(page.url()).search).toBe(
      '?view=department&stage=WAITING_JUDGMENT&page=2',
    );
    expect((await read(page, target.id)).stage).toBe('WAITING_JUDGMENT');
    await row(page, target.businessNo)
      .locator('[data-case-action="correct-judgment"]')
      .click();
    await expect(page.locator('[data-test="judgment-amount"]')).toHaveValue(
      '12.30',
    );
    await page.locator('[data-test="judgment-amount"]').fill('99.99');
    await page
      .getByRole('button', { name: '取消／返回列表', exact: true })
      .click();
    expect((await read(page, target.id)).judgment.current?.judgmentAmount).toBe(
      '12.30',
    );
    await row(page, target.businessNo)
      .locator('[data-case-action="correct-judgment"]')
      .click();
    await page.locator('[data-test="judgment-amount"]').fill('42.50');
    await page
      .locator('[data-test="judgment-correction-reason"]')
      .fill('核对原件金额');
    const corrected = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname ===
          `/api/v1/cases/${target.id}/judgment-correct`,
    );
    await page.locator('[data-test="judgment-correct"]').click();
    expect((await corrected).status()).toBe(201);
    await expect(page.locator('[data-test="case-list-workflow"]')).toHaveCount(
      0,
    );
    expect(await read(page, target.id)).toMatchObject({
      stage: 'WAITING_JUDGMENT',
      judgment: { current: { judgmentAmount: '42.50' } },
    });
    await row(page, target.businessNo)
      .locator('[data-case-action="choose-next-step"]')
      .click();
    const chosen = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname ===
          `/api/v1/cases/${target.id}/judgment-next-step`,
    );
    await confirmChoice(page, 'APPEAL');
    expect((await chosen).status()).toBe(201);
    await expect(row(page, target.businessNo)).toHaveCount(0);
    const fact = await read(page, target.id);
    expect(fact.stage).toBe('SECOND_INSTANCE');
    expect(
      fact.recordEdits?.secondInstanceAcceptances?.every(
        (value) => value.acceptedAt === null,
      ),
    ).toBe(true);
    await page.reload();
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await login(page);
    expect(await read(page, target.id)).toMatchObject({
      stage: 'SECOND_INSTANCE',
      judgment: { current: { judgmentAmount: '42.50' } },
      secondInstance: { currentResult: null },
    });
  });

  test('lost response survives reload outside the filter and retries only the original body/key', async ({
    page,
  }) => {
    const csrf = await login(page);
    const party = await parties(page, csrf);
    const target = await entry(page, csrf, party);
    await registered(page, csrf, target.id);
    const path = `/api/v1/cases/${target.id}/judgment-next-step`;
    const commands: unknown[] = [];
    let lost = true;
    await page.route(`**${path}`, async (route) => {
      commands.push(route.request().postDataJSON());
      if (lost) {
        lost = false;
        const upstream = await route.fetch();
        expect(upstream.status()).toBe(201);
        await route.abort('failed');
      } else await route.continue();
    });
    await page.goto('/cases?view=department&stage=WAITING_JUDGMENT');
    await row(page, target.businessNo)
      .locator('[data-case-action="choose-next-step"]')
      .click();
    await confirmChoice(page, 'EXECUTION', true);
    await expect(page.locator('[data-test="retry-original"]')).toBeVisible();
    expect(commands).toHaveLength(1);
    await page.reload();
    await page
      .getByRole('region', { name: '未确认的案件办理请求' })
      .getByRole('button', { name: '核对原办理请求', exact: true })
      .click();
    await page.locator('[data-test="retry-original"]').click();
    await expect(page.locator('[data-test="case-list-workflow"]')).toHaveCount(
      0,
    );
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(commands[0]);
    const fact = await read(page, target.id);
    expect(fact.stage).toBe('WAITING_EXECUTION_DOCUMENTS');
    expect(fact.judgmentNextStep.history).toHaveLength(1);
  });

  test('second-instance progress saves without manufacturing acceptance or a result', async ({
    page,
  }) => {
    const csrf = await login(page);
    const party = await parties(page, csrf);
    const target = await entry(page, csrf, party, 'SECOND_INSTANCE');
    await page.goto('/cases?view=department&stage=SECOND_INSTANCE');
    await row(page, target.businessNo)
      .locator('[data-case-action="second-instance"]')
      .click();
    const panel = page.locator('[data-test="second-instance-panel"]');
    await expect(
      panel.locator('[data-test="second-instance-result-option"]'),
    ).toHaveCount(3);
    await expect(
      panel.locator('[data-test="second-instance-result-option"]:checked'),
    ).toHaveCount(0);
    await panel
      .locator('[data-test="second-instance-hearing-at"]')
      .fill(today());
    await panel.locator('[data-test="second-instance-progress-save"]').click();
    await expect(page.locator('[data-test="case-list-workflow"]')).toHaveCount(
      0,
    );
    const fact = await read(page, target.id);
    expect(fact.stage).toBe('SECOND_INSTANCE');
    expect(fact.secondInstance.currentResult).toBeNull();
    expect(fact.secondInstance.currentProgress?.hearingAt).toBe(today());
    await page.reload();
    expect(
      (await read(page, target.id)).secondInstance.currentResult,
    ).toBeNull();
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await login(page, fixture.reader);
    await page.goto('/cases?view=department&stage=SECOND_INSTANCE');
    await expect(
      row(page, target.businessNo).locator('[data-case-action]'),
    ).toHaveCount(0);
  });

  test('registered record editor cancels then saves on page two without advancing or changing the workflow version', async ({
    page,
  }) => {
    const csrf = await login(page);
    const party = await parties(page, csrf);
    const target = await entry(page, csrf, party);
    await registered(page, csrf, target.id);
    for (let index = 0; index < 21; index++) await entry(page, csrf, party);
    const before = await read(page, target.id);
    const original = before.recordEdits?.judgments?.[0];
    expect(original?.canEdit).toBe(true);
    if (!original) throw new Error('Expected registered judgment record');
    const path = '/cases?view=department&stage=WAITING_JUDGMENT&page=2';
    const endpoint = `/api/v1/cases/${target.id}/judgment-record-correction`;
    const commands: unknown[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === endpoint
      )
        commands.push(request.postDataJSON());
    });
    await page.goto(path);
    const open = async () => {
      await row(page, target.businessNo)
        .locator('[data-case-record-edit]')
        .click();
      await page
        .locator('[data-test="case-list-record-kind"]')
        .selectOption('judgment');
      return page.locator('[data-test="section-record-panel"]');
    };
    let panel = await open();
    await panel.locator('[data-test="section-record-amount"]').fill('99.99');
    await page
      .getByRole('button', { name: '取消／返回列表', exact: true })
      .click();
    expect(commands).toHaveLength(0);
    expect(await read(page, target.id)).toEqual(before);
    panel = await open();
    await expect(
      panel.locator('[data-test="section-record-amount"]'),
    ).toHaveValue('12.30');
    await panel.locator('[data-test="section-record-amount"]').fill('42.50');
    await panel
      .locator('[data-test="section-record-reason"]')
      .fill('列表核对判决原件金额');
    const response = page.waitForResponse(
      (value) =>
        value.request().method() === 'POST' &&
        new URL(value.url()).pathname === endpoint,
    );
    await panel.locator('[data-test="section-record-save"]').click();
    expect((await response).status()).toBe(201);
    await expect(page.locator('[data-test="case-list-workflow"]')).toHaveCount(
      0,
    );
    expect(commands).toEqual([
      {
        judgmentId: original.judgmentId,
        trialRoundId: original.trialRoundId,
        expectedJudgmentRevision: original.judgmentRevision,
        idempotencyKey: expect.any(String),
        judgmentReceivedAt: original.effective.judgmentReceivedAt,
        judgmentAmountState: 'KNOWN',
        judgmentAmount: '42.50',
        paidLitigationFeeState: original.effective.paidLitigationFeeState,
        paidLitigationFee: original.effective.paidLitigationFee,
        judgmentContentVersionIds: original.effective.judgmentContentVersionIds,
        reason: '列表核对判决原件金额',
      },
    ]);
    const after = await read(page, target.id);
    expect(after).toMatchObject({
      stage: before.stage,
      version: before.version,
      judgment: { current: { judgmentAmount: '42.50' } },
    });
    expect(after.recordEdits?.judgments?.[0]).toMatchObject({
      judgmentRevision: original.judgmentRevision + 1,
      original: original.original,
    });
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(
      path,
    );
    await page.reload();
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await login(page);
    expect(await read(page, target.id)).toEqual(after);
  });

  test('registered record lost response reopens the exact off-filter request after reload and re-login', async ({
    page,
  }) => {
    const csrf = await login(page);
    const party = await parties(page, csrf);
    const target = await entry(page, csrf, party);
    await registered(page, csrf, target.id);
    const before = await read(page, target.id);
    const endpoint = `/api/v1/cases/${target.id}/judgment-record-correction`;
    const commands: unknown[] = [];
    let lost = true;
    await page.route(`**${endpoint}`, async (route) => {
      commands.push(route.request().postDataJSON());
      if (lost) {
        lost = false;
        const upstream = await route.fetch();
        expect(upstream.status()).toBe(201);
        await route.abort('failed');
      } else await route.continue();
    });
    await page.goto('/cases?view=department&stage=WAITING_JUDGMENT');
    await row(page, target.businessNo)
      .locator('[data-case-record-edit]')
      .click();
    await page
      .locator('[data-test="case-list-record-kind"]')
      .selectOption('judgment');
    await page.locator('[data-test="section-record-amount"]').fill('53.20');
    await page
      .locator('[data-test="section-record-reason"]')
      .fill('核对丢失响应后的原请求');
    await page.locator('[data-test="section-record-save"]').click();
    await expect(
      page.locator('[data-test="section-record-retry"]'),
    ).toBeEnabled();
    expect(commands).toHaveLength(1);
    const corrected = await read(page, target.id);
    expect(corrected).toMatchObject({
      stage: before.stage,
      version: before.version,
      judgment: { current: { judgmentAmount: '53.20' } },
    });
    // A separate legitimate workflow command moves the record outside this list filter.
    const judgment = corrected.recordEdits?.judgments?.[0];
    if (!judgment) throw new Error('Expected registered judgment record');
    await json(
      await page.request.post(`/api/v1/cases/${target.id}/judgment-next-step`, {
        headers: { 'X-CSRF-Token': csrf },
        data: {
          expectedVersion: corrected.version,
          idempotencyKey: randomUUID(),
          judgmentId: judgment.judgmentId,
          next: 'APPEAL',
          plaintiffAppeals: true,
          defendantIds: [],
        },
      }),
      201,
    );
    const advanced = await read(page, target.id);
    await page.reload();
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await login(page);
    await page.goto('/cases?view=department&stage=WAITING_JUDGMENT');
    await expect(row(page, target.businessNo)).toHaveCount(0);
    expect(commands).toHaveLength(1);
    await page
      .getByRole('region', { name: '资料更正原请求恢复' })
      .getByRole('button', { name: /核对资料更正原请求/ })
      .click();
    await expect(
      page.locator('[data-test="section-record-retry"]'),
    ).toBeEnabled();
    expect(commands).toHaveLength(1);
    await page.locator('[data-test="section-record-retry"]').click();
    await expect(page.locator('[data-test="case-list-workflow"]')).toHaveCount(
      0,
    );
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(commands[0]);
    expect(await read(page, target.id)).toEqual(advanced);
  });
});
