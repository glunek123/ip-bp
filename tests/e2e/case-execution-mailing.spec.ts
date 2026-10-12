import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
  clearCaseAcceptanceFault,
  clearCaseAcceptanceFixture,
  prepareCaseAcceptanceFixture,
} from '../support/case-acceptance-database.mjs';
import {
  clearCaseFilingFixture,
  prepareCaseFilingFixture,
} from '../support/case-filing-database.mjs';
import {
  clearCoreCaseHearingAdmin,
  clearCoreCaseHearingAdminSessions,
  prepareCoreCaseHearingAdmin,
} from '../support/case-hearing-database.mjs';
import { clearCoreCaseSecondInstanceFixture } from '../support/case-second-instance-database.mjs';
import { disconnectCustomerTestDatabase } from '../support/customer-database.mjs';
import { verifyConfirmedPublicCaseUpgrade } from '../support/case-execution-mailing-migration.mjs';

const origin = 'http://127.0.0.1:5174';
const applicationPdf = Buffer.from(
  '%PDF-1.4\nCA011 exact execution application bytes\n%%EOF\n',
);
const revisedApplicationPdf = Buffer.from(
  '%PDF-1.4\nCA011 distinct revised execution application bytes\n%%EOF\n',
);
const todayShanghai = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const pastWorkflowDate = () => {
  const past = new Date(`${todayShanghai()}T00:00:00.000Z`);
  past.setUTCDate(past.getUTCDate() - 2);
  const date = past.toISOString().slice(0, 10);
  return date > '2026-09-28' ? date : '2026-09-28';
};

async function status(
  response: { status(): number; text(): Promise<string>; url(): string },
  expected: number,
) {
  const actual = response.status();
  const body = actual === expected ? '' : await response.text();
  expect(actual, `${response.url()} ${body}`).toBe(expected);
}

async function login(
  page: Page,
  path: string,
  username: string,
  password: string,
): Promise<string> {
  await page.goto(path);
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/auth/login',
  );
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(path);
  const response = await responsePromise;
  await status(response, 200);
  return ((await response.json()) as { csrfToken: string }).csrfToken;
}

async function logout(page: Page) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/auth/logout',
  );
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await status(await responsePromise, 204);
  await expect(page).toHaveURL(/\/login$/u);
}

async function uploadByApi(
  request: APIRequestContext,
  caseId: string,
  category: string,
  headers: Record<string, string>,
): Promise<string> {
  const draft = await request.post('/api/v1/materials/upload-drafts', {
    headers,
    data: {
      ownerType: 'CASE',
      ownerId: caseId,
      category,
      purpose: category,
      originalFilename: `CA011-${category}-${randomUUID().slice(0, 8)}.pdf`,
      declaredMimeType: 'application/pdf',
    },
  });
  await status(draft, 201);
  const draftId = ((await draft.json()) as { id: string }).id;
  const content = await request.put(
    `/api/v1/materials/upload-drafts/${draftId}/content`,
    {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: applicationPdf,
    },
  );
  await status(content, 200);
  return ((await content.json()) as { contentVersionId: string })
    .contentVersionId;
}

async function prepareWaitingFormal(
  request: APIRequestContext,
  source: Awaited<ReturnType<typeof createSubmittedCaseThroughApi>>,
  businessDate: string,
  clientReceipt = false,
) {
  const headers = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
  const prefix = `/api/v1/cases/${source.caseId}`;
  const confirmed = await request.post(`${prefix}/complaint-confirm`, {
    headers,
    data: {
      expectedVersion: source.submitted.version,
      idempotencyKey: randomUUID(),
      confirmedComplaintContentVersionId: source.complaint.contentVersionId,
      amountState: 'KNOWN',
      amount: '123.45',
      pendingReason: null,
      confirmDisclose: true,
    },
  });
  await status(confirmed, 201);
  let receiptHeaders: Record<string, string> = headers;
  if (clientReceipt) {
    const loginResponse = await request.post('/api/v1/auth/login', {
      headers: { Origin: origin },
      data: {
        username: source.clientSession.user.username,
        password: 'client correct horse battery',
      },
    });
    await status(loginResponse, 200);
    const csrf = ((await loginResponse.json()) as { csrfToken: string })
      .csrfToken;
    receiptHeaders = { Origin: origin, 'X-CSRF-Token': csrf };
  }
  const receipts: string[] = [];
  for (let index = 0; index < (clientReceipt ? 10 : 1); index += 1) {
    receipts.push(
      await uploadByApi(request, source.caseId, 'MAIL_RECEIPT', receiptHeaders),
    );
  }
  const mailed = await request.post(
    clientReceipt
      ? `/api/v1/client/cases/${source.caseId}/complaint-mail`
      : `${prefix}/complaint-mail`,
    {
      headers: receiptHeaders,
      data: {
        expectedVersion: source.submitted.version + 1,
        idempotencyKey: randomUUID(),
        mailedAt: businessDate,
        mailReceiptContentVersionIds: receipts,
      },
    },
  );
  await status(mailed, 201);
  const courtResponse = await request.post(`${prefix}/filing-courts`, {
    headers,
    data: { name: `CA011法院-${randomUUID().slice(0, 8)}` },
  });
  await status(courtResponse, 201);
  const court = (await courtResponse.json()) as { id: string };
  const evidence = await uploadByApi(
    request,
    source.caseId,
    'FILING_EVIDENCE',
    headers,
  );
  const filed = await request.post(`${prefix}/filing-submit`, {
    headers,
    data: {
      expectedVersion: source.submitted.version + 2,
      idempotencyKey: randomUUID(),
      courtId: court.id,
      submittedAt: businessDate,
      filingEvidenceContentVersionIds: [evidence],
    },
  });
  await status(filed, 201);
  return receipts[0]!;
}

async function prepareWaitingJudgment(
  page: Page,
  caseId: string,
  lawyer: { username: string; password: string },
  businessDate: string,
  operatorCsrf: string,
) {
  const notice = await uploadByApi(page.request, caseId, 'ACCEPTANCE_NOTICE', {
    Origin: new URL(page.url()).origin,
    'X-CSRF-Token': operatorCsrf,
  });
  const detail = await page.request.get(`/api/v1/cases/${caseId}`);
  await status(detail, 200);
  const accepted = await page.request.post(
    `/api/v1/cases/${caseId}/acceptance-register`,
    {
      headers: {
        Origin: new URL(page.url()).origin,
        'X-CSRF-Token': operatorCsrf,
      },
      data: {
        expectedVersion: ((await detail.json()) as { version: number }).version,
        idempotencyKey: randomUUID(),
        acceptedAt: businessDate,
        courtCaseNo: `（2026）甲0101民初${randomUUID().slice(0, 6)}号`,
        acceptanceNoticeContentVersionIds: [notice],
      },
    },
  );
  await status(accepted, 201);
  await logout(page);
  const lawyerCsrf = await login(
    page,
    '/lawyer/cases',
    lawyer.username,
    lawyer.password,
  );
  const lawyerDetail = await page.request.get(`/api/v1/lawyer/cases/${caseId}`);
  await status(lawyerDetail, 200);
  const scheduled = await page.request.post(
    `/api/v1/lawyer/cases/${caseId}/hearing-schedule`,
    {
      headers: {
        Origin: new URL(page.url()).origin,
        'X-CSRF-Token': lawyerCsrf,
      },
      data: {
        expectedVersion: ((await lawyerDetail.json()) as { version: number })
          .version,
        idempotencyKey: randomUUID(),
        hearingAt: businessDate,
      },
    },
  );
  await status(scheduled, 201);
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/v1/lawyer/cases/${caseId}`);
      await status(response, 200);
      return ((await response.json()) as { stage: string }).stage;
    })
    .toBe('WAITING_JUDGMENT');
  await logout(page);
}

async function grantJudgmentAndExecutionActions(page: Page) {
  await login(page, '/settings/people-access', admin.username, admin.password);
  const button = page.locator(
    `[data-test="edit-role-${coreLeadFixtures.roleA}"]`,
  );
  await expect(button).toBeVisible();
  await button.click();
  const editor = page.getByRole('dialog', { name: 'CORE TEAM' });
  await expect(
    editor.locator('[data-test="grant-CASE_EXECUTION_CONFIRM"]'),
  ).toBeChecked();
  await expect(
    editor.locator('[data-test="scope-CASE_EXECUTION_CONFIRM"]'),
  ).toHaveValue('TEAM');
  for (const action of [
    'CASE_JUDGMENT_REGISTER',
    'CASE_JUDGMENT_NEXT_STEP',
    'CASE_EXECUTION_SUBMIT',
  ]) {
    await editor.locator(`[data-test="grant-${action}"]`).check();
    await editor.locator(`[data-test="scope-${action}"]`).selectOption('TEAM');
  }
  const refreshed = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname ===
        '/api/v1/organization/management-context',
  );
  await editor.getByRole('button', { name: '保存模板' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await status(await refreshed, 200);
  await logout(page);
}

async function registerJudgment(page: Page, caseId: string, date: string) {
  await page.goto(`/cases/${caseId}`);
  const panel = page.locator('[data-test="case-judgment-panel"]');
  await expect(panel).toBeVisible();
  const filename = `CA011判决-${randomUUID().slice(0, 8)}.pdf`;
  await panel.locator('[data-test="judgment-file-input"]').setInputFiles({
    name: filename,
    mimeType: 'application/pdf',
    buffer: applicationPdf,
  });
  await expect(panel.getByText(filename)).toBeVisible();
  await panel.locator('[data-test="judgment-date"]').fill(date);
  await panel
    .locator('[data-test="judgment-amount-state"]')
    .selectOption('PENDING');
  await panel.locator('[data-test="paid-fee-state"]').selectOption('KNOWN');
  await panel.locator('[data-test="paid-fee-amount"]').fill('0.00');
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/cases/${caseId}/judgment-register`,
  );
  await panel.locator('[data-test="judgment-submit"]').click();
  await status(await responsePromise, 201);
}

async function chooseExecution(page: Page, caseId: string) {
  const panel = page.locator('[data-test="case-judgment-next-step-panel"]');
  await expect(panel).toBeVisible();
  await panel.locator('input[value="EXECUTION"]').check();
  await panel
    .getByText(/已核实本案可进入执行准备/)
    .locator('input')
    .check();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/cases/${caseId}/judgment-next-step`,
  );
  await panel.getByRole('button', { name: '核对并提交选择' }).click();
  await expect(panel.getByRole('dialog')).toContainText(
    '不代表已经申请强制执行',
  );
  await panel.locator('[data-confirm-choice]').click();
  await status(await responsePromise, 201);
  await expect(page.locator('.page-head .pill')).toContainText('待写执行材料');
}

async function prepareOperatorExecutionCase(
  page: Page,
  request: APIRequestContext,
  clientReceipt = false,
) {
  const businessDate = pastWorkflowDate();
  const source = await createSubmittedCaseThroughApi(request);
  const priorReceiptId = await prepareWaitingFormal(
    request,
    source,
    businessDate,
    clientReceipt,
  );
  await grantJudgmentAndExecutionActions(page);
  const csrf = await login(
    page,
    '/cases',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await prepareWaitingJudgment(
    page,
    source.caseId,
    source.lawyer,
    businessDate,
    csrf,
  );
  await login(
    page,
    '/cases',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await registerJudgment(page, source.caseId, businessDate);
  await chooseExecution(page, source.caseId);
  return { ...source, priorReceiptId };
}

async function createOtherEnterpriseClient(
  request: APIRequestContext,
): Promise<{ username: string; password: string }> {
  const username = `ca011-foreign-${randomUUID().slice(0, 8)}`;
  const password = 'foreign client password 2026';
  const loggedIn = await request.post('/api/v1/auth/login', {
    headers: { Origin: origin },
    data: {
      username: coreLeadFixtures.operatorUsername,
      password: coreLeadFixtures.operatorPassword,
    },
  });
  await status(loggedIn, 200);
  const session = (await loggedIn.json()) as { csrfToken: string };
  const created = await request.post(
    `/api/v1/customers/${coreLeadFixtures.selfCustomer}/client-accounts`,
    {
      headers: { 'X-CSRF-Token': session.csrfToken },
      data: { displayName: 'CA-011其他企业客户', username, password },
    },
  );
  await status(created, 201);
  return { username, password };
}

async function exactUploadedVersionId(
  page: Page,
  caseId: string,
  filename: string,
  category = 'EXECUTION_APPLICATION',
): Promise<string> {
  const response = await page.request.get(
    `/api/v1/materials?ownerType=CASE&ownerId=${encodeURIComponent(caseId)}`,
  );
  await status(response, 200);
  const body = (await response.json()) as {
    items: Array<{
      ownerType: string;
      ownerId: string;
      category: string;
      purpose: string;
      status: string;
      contentVersions: Array<{
        id: string;
        originalFilename: string;
        status: string;
      }>;
    }>;
  };
  const matches = body.items
    .filter(
      (material) =>
        material.ownerType === 'CASE' &&
        material.ownerId === caseId &&
        material.category === category &&
        material.purpose === category &&
        material.status === 'ACTIVE',
    )
    .flatMap((material) =>
      material.contentVersions.filter(
        (version) =>
          version.status === 'AVAILABLE' &&
          version.originalFilename === filename,
      ),
    );
  expect(matches).toHaveLength(1);
  return matches[0]!.id;
}

async function browserDownloadBytes(page: Page, click: () => Promise<unknown>) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    click(),
  ]);
  const path = await download.path();
  if (path === null) throw new Error('浏览器未生成附件下载文件');
  return readFile(path);
}

let admin: { username: string; password: string };
test.beforeEach(async () => {
  await clearCoreCaseHearingAdminSessions();
  await clearCaseAcceptanceFault();
  await clearCoreCaseSecondInstanceFixture();
  await clearCaseAcceptanceFixture();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
  await resetCoreLeadE2eData();
  await clearCoreCaseHearingAdmin();
  admin = await prepareCoreCaseHearingAdmin();
  await prepareCaseFilingFixture();
  await prepareCaseAcceptanceFixture();
  await allowOtherEnterpriseAccountSetup();
});
test.afterEach(async () => {
  await clearCoreCaseHearingAdminSessions();
  await clearCaseAcceptanceFault();
  await clearCoreCaseSecondInstanceFixture();
  expect(await clearCoreCaseSecondInstanceFixture()).toEqual([]);
  await clearCaseAcceptanceFixture();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
  await resetCoreLeadE2eData();
  await clearCoreCaseHearingAdmin();
});
test.afterAll(async () => disconnectCustomerTestDatabase());

async function prepareConfirmedExecutionCase(
  page: Page,
  request: APIRequestContext,
  clientReceipt = false,
) {
  const source = await prepareOperatorExecutionCase(
    page,
    request,
    clientReceipt,
  );
  const prefix = `/api/v1/cases/${source.caseId}`;
  const beforeResponse = await page.request.get(prefix);
  await status(beforeResponse, 200);
  const before = (await beforeResponse.json()) as {
    version: number;
    judgmentNextStep: { current: { id: string; trialRoundId: string } };
    secondInstance: { currentResult: { id: string } | null };
  };
  const session = await page.request.get('/api/v1/auth/session');
  await status(session, 200);
  const csrf = ((await session.json()) as { csrfToken: string }).csrfToken;
  const headers = { Origin: origin, 'X-CSRF-Token': csrf };
  const applicationVersion = await uploadByApi(
    page.request,
    source.caseId,
    'EXECUTION_APPLICATION',
    headers,
  );
  const submitted = await page.request.post(`${prefix}/execution-submit`, {
    headers,
    data: {
      expectedVersion: before.version,
      idempotencyKey: randomUUID(),
      trialRoundId: before.judgmentNextStep.current.trialRoundId,
      judgmentNextStepId: before.judgmentNextStep.current.id,
      secondInstanceResultId: before.secondInstance.currentResult?.id ?? null,
      expectedSubmissionId: null,
      executionApplicationContentVersionIds: [applicationVersion],
    },
  });
  await status(submitted, 201);
  const submittedBody = (await submitted.json()) as {
    version: number;
    submissionId: string;
  };
  const confirmed = await page.request.post(`${prefix}/execution-confirm`, {
    headers,
    data: {
      expectedVersion: submittedBody.version,
      idempotencyKey: randomUUID(),
      expectedSubmissionId: submittedBody.submissionId,
    },
  });
  await status(confirmed, 201);
  return {
    source,
    confirmation: (await confirmed.json()) as {
      confirmationId: string;
      version: number;
    },
  };
}

test('CA-013/014 browser persists exact mailing and filing evidence through refresh and re-login', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(180_000);
  const { source } = await prepareConfirmedExecutionCase(page, request);
  const upgraded = await verifyConfirmedPublicCaseUpgrade(source.caseId);
  expect(upgraded).toMatchObject({ fullOldChain: true });
  expect(upgraded.oldForeignKeys).toBeGreaterThan(0);
  expect(upgraded.exactVersions).toBeGreaterThan(0);
  const prefix = `/api/v1/cases/${source.caseId}`;
  await page.reload();
  const mailPanel = page.locator('[data-test="execution-mailing-panel"]');
  await expect(mailPanel).toBeVisible();
  const mailName = `CA013-mail-${randomUUID().slice(0, 8)}.pdf`;
  await mailPanel
    .locator('[data-test="execution-mailing-file-input"]')
    .setInputFiles({
      name: mailName,
      mimeType: 'application/pdf',
      buffer: applicationPdf,
    });
  await expect(mailPanel.getByText(mailName).first()).toBeVisible();
  const exactMailVersion = await exactUploadedVersionId(
    page,
    source.caseId,
    mailName,
    'MAIL_RECEIPT',
  );
  await mailPanel
    .locator('[data-test="execution-mailed-at"]')
    .fill(todayShanghai());
  await mailPanel.locator('[data-test="execution-mailing-review"]').click();
  await expect(
    mailPanel.locator('[data-test="execution-mailing-review-summary"]'),
  ).toBeVisible();
  const mailingResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `${prefix}/execution-mail`,
  );
  await mailPanel.locator('[data-test="execution-mailing-submit"]').click();
  await status(await mailingResponse, 201);
  const mailDetailResponse = await page.request.get(prefix);
  await status(mailDetailResponse, 200);
  const mailDetail = (await mailDetailResponse.json()) as {
    stage: string;
    canMailExecution: boolean;
    canSubmitExecutionFiling: boolean;
    executionMailing: {
      id: string;
      files: Array<{ contentVersionId: string; originalFilename: string }>;
    };
  };
  expect(mailDetail.stage).toBe('WAITING_EXECUTION_FILING');
  expect(mailDetail.canMailExecution).toBe(false);
  expect(mailDetail.canSubmitExecutionFiling).toBe(true);
  expect(mailDetail.executionMailing.files).toEqual([
    expect.objectContaining({
      originalFilename: mailName,
      contentVersionId: exactMailVersion,
    }),
  ]);
  await page.reload();
  const persistedMail = page.locator('[data-test="execution-mailing-panel"]');
  expect(
    await browserDownloadBytes(page, () =>
      persistedMail
        .locator('li')
        .filter({ hasText: mailName })
        .getByRole('button')
        .click(),
    ),
  ).toEqual(applicationPdf);

  const filingPanel = page.locator('[data-test="execution-filing-panel"]');
  await expect(filingPanel).toBeVisible();
  const filingName = `CA014-proof-${randomUUID().slice(0, 8)}.pdf`;
  const filingBytes = revisedApplicationPdf;
  await filingPanel
    .locator('[data-test="execution-filing-file-input"]')
    .setInputFiles({
      name: filingName,
      mimeType: 'application/pdf',
      buffer: filingBytes,
    });
  await expect(filingPanel.getByText(filingName)).toBeVisible();
  await filingPanel
    .locator('[data-test="execution-filing-submitted-at"]')
    .fill(todayShanghai());
  await filingPanel.locator('[data-test="execution-filing-review"]').click();
  await expect(
    filingPanel.locator('[data-test="execution-filing-review-summary"]'),
  ).toBeVisible();
  const filingResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `${prefix}/execution-filing-submit`,
  );
  await filingPanel.locator('[data-test="execution-filing-submit"]').click();
  await status(await filingResponse, 201);
  await logout(page);
  await login(
    page,
    `/cases/${source.caseId}`,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  const finalDetailResponse = await page.request.get(prefix);
  await status(finalDetailResponse, 200);
  const finalDetail = (await finalDetailResponse.json()) as {
    stage: string;
    executionMailing: {
      id: string;
      files: Array<{ contentVersionId: string }>;
    };
    executionFiling: {
      mailingId: string;
      files: Array<{ contentVersionId: string; originalFilename: string }>;
    };
  };
  expect(finalDetail.stage).toBe('EXECUTING');
  expect(finalDetail.executionFiling.mailingId).toBe(
    finalDetail.executionMailing.id,
  );
  expect(finalDetail.executionFiling.files).toEqual([
    expect.objectContaining({ originalFilename: filingName }),
  ]);
  expect(
    await browserDownloadBytes(page, () =>
      page
        .locator('[data-test="execution-filing-panel"] li')
        .filter({ hasText: filingName })
        .getByRole('button')
        .click(),
    ),
  ).toEqual(filingBytes);

  const clientPage = await browser.newPage({ baseURL: origin });
  try {
    await login(
      clientPage,
      '/client/leads',
      source.clientSession.user.username,
      'client correct horse battery',
    );
    const clientResponse = await clientPage.request.get(
      `/api/v1/client/cases/${source.caseId}`,
    );
    await status(clientResponse, 200);
    const clientDetail = (await clientResponse.json()) as Record<
      string,
      unknown
    >;
    expect(clientDetail).toHaveProperty('executionMailing');
    expect(clientDetail).not.toHaveProperty('executionFiling');
    expect(clientDetail).not.toHaveProperty('executionConfirmation');
    expect(JSON.stringify(clientDetail)).not.toContain(filingName);
  } finally {
    await clientPage.close();
  }
});

test('CA-013 own enterprise client may mail while CA-014 accepts the current primary lawyer only', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90_000);
  const { source, confirmation } = await prepareConfirmedExecutionCase(
    page,
    request,
    true,
  );
  const priorComplaintReceipt = source.priorReceiptId;
  expect(priorComplaintReceipt).toBeTruthy();
  const clientPage = await browser.newPage({ baseURL: origin });
  let mailed: { mailingId: string; version: number };
  try {
    const csrf = await login(
      clientPage,
      '/client/leads',
      source.clientSession.user.username,
      'client correct horse battery',
    );
    const headers = { Origin: origin, 'X-CSRF-Token': csrf };
    const internalDenied = await clientPage.request.post(
      `/api/v1/cases/${source.caseId}/execution-mail`,
      {
        headers,
        data: {
          expectedVersion: confirmation.version,
          idempotencyKey: randomUUID(),
          expectedConfirmationId: confirmation.confirmationId,
          mailedAt: todayShanghai(),
          mailReceiptContentVersionIds: [priorComplaintReceipt],
        },
      },
    );
    expect(internalDenied.status()).toBe(403);
    expect(((await internalDenied.json()) as { code: string }).code).toBe(
      'ACTION_FORBIDDEN',
    );
    const wrongReceipt = await clientPage.request.post(
      `/api/v1/client/cases/${source.caseId}/execution-mail`,
      {
        headers,
        data: {
          expectedVersion: confirmation.version,
          idempotencyKey: randomUUID(),
          expectedConfirmationId: confirmation.confirmationId,
          mailedAt: todayShanghai(),
          mailReceiptContentVersionIds: [priorComplaintReceipt],
        },
      },
    );
    expect(wrongReceipt.status()).toBe(400);
    expect(((await wrongReceipt.json()) as { code: string }).code).toBe(
      'MATERIAL_VERSION_INVALID',
    );
    const receiptVersion = await uploadByApi(
      clientPage.request,
      source.caseId,
      'MAIL_RECEIPT',
      headers,
    );
    const mail = await clientPage.request.post(
      `/api/v1/client/cases/${source.caseId}/execution-mail`,
      {
        headers,
        data: {
          expectedVersion: confirmation.version,
          idempotencyKey: randomUUID(),
          expectedConfirmationId: confirmation.confirmationId,
          mailedAt: todayShanghai(),
          mailReceiptContentVersionIds: [receiptVersion],
        },
      },
    );
    await status(mail, 201);
    mailed = (await mail.json()) as { mailingId: string; version: number };
    const clientDetailResponse = await clientPage.request.get(
      `/api/v1/client/cases/${source.caseId}`,
    );
    await status(clientDetailResponse, 200);
    const clientDetail = (await clientDetailResponse.json()) as Record<
      string,
      unknown
    >;
    expect(clientDetail).toHaveProperty('executionMailing');
    expect(clientDetail).not.toHaveProperty('executionConfirmation');
    expect(clientDetail).not.toHaveProperty('executionFiling');
    const forbidden = await clientPage.request.post(
      `/api/v1/client/cases/${source.caseId}/execution-filing-submit`,
      {
        headers,
        data: {
          expectedVersion: mailed.version,
          idempotencyKey: randomUUID(),
          expectedMailingId: mailed.mailingId,
          submittedAt: todayShanghai(),
          executionFilingProofContentVersionIds: [receiptVersion],
        },
      },
    );
    expect([403, 404]).toContain(forbidden.status());
  } finally {
    await clientPage.close();
  }

  const foreign = await createOtherEnterpriseClient(request);
  const foreignPage = await browser.newPage({ baseURL: origin });
  try {
    const csrf = await login(
      foreignPage,
      '/client/leads',
      foreign.username,
      foreign.password,
    );
    const denied = await foreignPage.request.post(
      `/api/v1/client/cases/${source.caseId}/execution-mail`,
      {
        headers: { Origin: origin, 'X-CSRF-Token': csrf },
        data: {
          expectedVersion: confirmation.version,
          idempotencyKey: randomUUID(),
          expectedConfirmationId: confirmation.confirmationId,
          mailedAt: todayShanghai(),
          mailReceiptContentVersionIds: [priorComplaintReceipt],
        },
      },
    );
    expect([403, 404]).toContain(denied.status());
  } finally {
    await foreignPage.close();
  }

  await logout(page);
  await login(
    page,
    '/lawyer/cases',
    source.lawyer.username,
    source.lawyer.password,
  );
  const lawyerSession = await page.request.get('/api/v1/auth/session');
  await status(lawyerSession, 200);
  const lawyerCsrf = ((await lawyerSession.json()) as { csrfToken: string })
    .csrfToken;
  const proofVersion = await uploadByApi(
    page.request,
    source.caseId,
    'EXECUTION_FILING_PROOF',
    { Origin: origin, 'X-CSRF-Token': lawyerCsrf },
  );
  const filing = await page.request.post(
    `/api/v1/lawyer/cases/${source.caseId}/execution-filing-submit`,
    {
      headers: { Origin: origin, 'X-CSRF-Token': lawyerCsrf },
      data: {
        expectedVersion: mailed!.version,
        idempotencyKey: randomUUID(),
        expectedMailingId: mailed!.mailingId,
        submittedAt: todayShanghai(),
        executionFilingProofContentVersionIds: [proofVersion],
      },
    },
  );
  await status(filing, 201);
  await page.goto(`/lawyer/cases/${source.caseId}`);
  await expect(
    page.locator('[data-test="execution-filing-panel"]'),
  ).toBeVisible();
  const detail = await page.request.get(
    `/api/v1/lawyer/cases/${source.caseId}`,
  );
  await status(detail, 200);
  expect(((await detail.json()) as { stage: string }).stage).toBe('EXECUTING');
});
