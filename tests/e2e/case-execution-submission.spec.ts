import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  expect,
  request as playwrightRequest,
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
  const receipt = await uploadByApi(
    request,
    source.caseId,
    'MAIL_RECEIPT',
    headers,
  );
  const mailed = await request.post(`${prefix}/complaint-mail`, {
    headers,
    data: {
      expectedVersion: source.submitted.version + 1,
      idempotencyKey: randomUUID(),
      mailedAt: businessDate,
      mailReceiptContentVersionIds: [receipt],
    },
  });
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
) {
  const businessDate = pastWorkflowDate();
  const source = await createSubmittedCaseThroughApi(request);
  await prepareWaitingFormal(request, source, businessDate);
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
  return source;
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
        material.category === 'EXECUTION_APPLICATION' &&
        material.purpose === 'EXECUTION_APPLICATION' &&
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

test('operator uploads, explicitly submits, and retrieves exact execution bytes after re-login', async ({
  page,
  request,
}) => {
  const source = await prepareOperatorExecutionCase(page, request);
  const panel = page.locator('[data-test="execution-submission-panel"]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(
    '上传材料不会推进案件。确认提交后，案件进入“执行材料待确认”',
  );
  const beforeUpload = await page.request.get(`/api/v1/cases/${source.caseId}`);
  await status(beforeUpload, 200);
  const initial = (await beforeUpload.json()) as {
    stage: string;
    version: number;
    executionSubmission: { current: null; submissions: unknown[] };
  };
  expect(initial.stage).toBe('WAITING_EXECUTION_DOCUMENTS');
  expect(initial.executionSubmission.current).toBeNull();
  expect(initial.executionSubmission.submissions).toHaveLength(0);

  const filename = `CA011执行申请-${randomUUID().slice(0, 8)}.pdf`;
  const uploadResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      /^\/api\/v1\/materials\/upload-drafts\/[^/]+\/content$/u.test(
        new URL(response.url()).pathname,
      ),
  );
  await panel.locator('input[type="file"]').setInputFiles({
    name: filename,
    mimeType: 'application/pdf',
    buffer: applicationPdf,
  });
  await status(await uploadResponse, 200);
  await expect(panel.getByText(filename)).toBeVisible();
  const afterUpload = await page.request.get(`/api/v1/cases/${source.caseId}`);
  await status(afterUpload, 200);
  const uploaded = (await afterUpload.json()) as {
    stage: string;
    version: number;
    executionSubmission: { current: null; submissions: unknown[] };
  };
  expect(uploaded.stage).toBe('WAITING_EXECUTION_DOCUMENTS');
  expect(uploaded.version).toBe(initial.version);
  expect(uploaded.executionSubmission.current).toBeNull();
  expect(uploaded.executionSubmission.submissions).toHaveLength(0);
  const contentVersionId = await exactUploadedVersionId(
    page,
    source.caseId,
    filename,
  );
  const fileChoice = panel
    .locator('label')
    .filter({ hasText: filename })
    .locator('input[type="checkbox"]');
  await expect(fileChoice).toBeChecked();

  const submitRequest = page.waitForRequest(
    (requestEvent) =>
      requestEvent.method() === 'POST' &&
      new URL(requestEvent.url()).pathname ===
        `/api/v1/cases/${source.caseId}/execution-submit`,
  );
  const submitResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/cases/${source.caseId}/execution-submit`,
  );
  await panel.locator('[data-test="submit-execution"]').click();
  const [requestEvent, response] = await Promise.all([
    submitRequest,
    submitResponse,
  ]);
  await status(response, 201);
  const body = requestEvent.postDataJSON() as {
    expectedVersion: number;
    idempotencyKey: string;
    trialRoundId: string;
    judgmentNextStepId: string;
    secondInstanceResultId: null;
    expectedSubmissionId: null;
    executionApplicationContentVersionIds: string[];
  };
  expect(body.expectedVersion).toBe(initial.version);
  expect(body.idempotencyKey).toBeTruthy();
  expect(body.trialRoundId).toBeTruthy();
  expect(body.judgmentNextStepId).toBeTruthy();
  expect(body.secondInstanceResultId).toBeNull();
  expect(body.expectedSubmissionId).toBeNull();
  expect(body.executionApplicationContentVersionIds).toEqual([
    contentVersionId,
  ]);
  const receipt = (await response.json()) as {
    id: string;
    submissionId: string;
    version: number;
    stage: string;
  };
  expect(receipt.stage).toBe('WAITING_EXECUTION_CONFIRMATION');
  expect(receipt.version).toBe(initial.version + 1);
  expect(receipt.id).toBe(source.caseId);
  expect(receipt.submissionId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
  );
  await expect(page.locator('.page-head .pill')).toContainText(
    '执行材料待确认',
  );

  const persistedResponse = await page.request.get(
    `/api/v1/cases/${source.caseId}`,
  );
  await status(persistedResponse, 200);
  const persisted = (await persistedResponse.json()) as {
    stage: string;
    version: number;
    executionSubmission: {
      current: { id: string; files: Array<{ contentVersionId: string }> };
      submissions: unknown[];
    };
  };
  expect(persisted.stage).toBe('WAITING_EXECUTION_CONFIRMATION');
  expect(persisted.version).toBe(receipt.version);
  expect(persisted.executionSubmission.current.id).toBe(receipt.submissionId);
  expect(
    persisted.executionSubmission.current.files.map(
      (file) => file.contentVersionId,
    ),
  ).toEqual([contentVersionId]);
  expect(persisted.executionSubmission.submissions).toHaveLength(1);

  const exactFile = panel
    .locator('li')
    .filter({ hasText: filename })
    .getByRole('button', { name: '下载', exact: true });
  expect(await browserDownloadBytes(page, () => exactFile.click())).toEqual(
    applicationPdf,
  );
  await page.reload();
  await expect(page.locator('.page-head .pill')).toContainText(
    '执行材料待确认',
  );
  await expect(panel.getByText(filename)).toBeVisible();
  await logout(page);
  await login(
    page,
    `/cases/${source.caseId}`,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await expect(page.locator('.page-head .pill')).toContainText(
    '执行材料待确认',
  );
  const afterLoginPanel = page.locator(
    '[data-test="execution-submission-panel"]',
  );
  await expect(afterLoginPanel.getByText(filename)).toBeVisible();
  const afterLoginFile = afterLoginPanel
    .locator('li')
    .filter({ hasText: filename })
    .getByRole('button', { name: '下载', exact: true });
  expect(
    await browserDownloadBytes(page, () => afterLoginFile.click()),
  ).toEqual(applicationPdf);
});

test('current lawyer resubmits with a reason and keeps exact prior history after re-login', async ({
  page,
  request,
}) => {
  const source = await prepareOperatorExecutionCase(page, request);
  await logout(page);
  await login(
    page,
    '/lawyer/cases',
    source.lawyer.username,
    source.lawyer.password,
  );
  await page.goto(`/lawyer/cases/${source.caseId}`);
  const panel = page.locator('[data-test="execution-submission-panel"]');
  await expect(panel).toBeVisible();
  const endpoint = `/api/v1/lawyer/cases/${source.caseId}/execution-submit`;

  const firstFilename = `CA011律师执行申请首提-${randomUUID().slice(0, 8)}.pdf`;
  const firstUpload = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      /^\/api\/v1\/materials\/upload-drafts\/[^/]+\/content$/u.test(
        new URL(response.url()).pathname,
      ),
  );
  await panel.locator('input[type="file"]').setInputFiles({
    name: firstFilename,
    mimeType: 'application/pdf',
    buffer: applicationPdf,
  });
  await status(await firstUpload, 200);
  const firstContentVersionId = await exactUploadedVersionId(
    page,
    source.caseId,
    firstFilename,
  );
  await expect(
    panel
      .locator('label')
      .filter({ hasText: firstFilename })
      .locator('input[type="checkbox"]'),
  ).toBeChecked();
  const firstRequest = page.waitForRequest(
    (candidate) =>
      candidate.method() === 'POST' &&
      new URL(candidate.url()).pathname === endpoint,
  );
  const firstResponse = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === 'POST' &&
      new URL(candidate.url()).pathname === endpoint,
  );
  await panel.locator('[data-test="submit-execution"]').click();
  const [firstRequestEvent, firstResult] = await Promise.all([
    firstRequest,
    firstResponse,
  ]);
  await status(firstResult, 201);
  const firstInput = firstRequestEvent.postDataJSON() as {
    expectedVersion: number;
    expectedSubmissionId: null;
    executionApplicationContentVersionIds: string[];
  };
  expect(firstInput.expectedVersion).toBeGreaterThan(0);
  expect(firstInput.expectedSubmissionId).toBeNull();
  expect(firstInput.executionApplicationContentVersionIds).toEqual([
    firstContentVersionId,
  ]);
  const firstReceipt = (await firstResult.json()) as {
    version: number;
    submissionId: string;
  };
  expect(firstReceipt.submissionId).toBeTruthy();
  const afterFirstResponse = await page.request.get(
    `/api/v1/lawyer/cases/${source.caseId}`,
  );
  await status(afterFirstResponse, 200);
  const afterFirst = (await afterFirstResponse.json()) as {
    version: number;
    executionSubmission: {
      current: { id: string; files: Array<{ contentVersionId: string }> };
      submissions: Array<{ id: string; toVersion: number }>;
    };
  };
  expect(afterFirst.executionSubmission.current.id).toBe(
    firstReceipt.submissionId,
  );
  expect(
    afterFirst.executionSubmission.current.files.map(
      (file) => file.contentVersionId,
    ),
  ).toEqual([firstContentVersionId]);
  expect(afterFirst.executionSubmission.submissions).toHaveLength(1);
  expect(afterFirst.executionSubmission.submissions[0]!.toVersion).toBe(
    firstReceipt.version,
  );

  const secondFilename = `CA011律师执行申请重提-${randomUUID().slice(0, 8)}.pdf`;
  const secondUpload = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      /^\/api\/v1\/materials\/upload-drafts\/[^/]+\/content$/u.test(
        new URL(response.url()).pathname,
      ),
  );
  await panel.locator('input[type="file"]').setInputFiles({
    name: secondFilename,
    mimeType: 'application/pdf',
    buffer: revisedApplicationPdf,
  });
  await status(await secondUpload, 200);
  const secondContentVersionId = await exactUploadedVersionId(
    page,
    source.caseId,
    secondFilename,
  );
  const secondChoice = panel
    .locator('label')
    .filter({ hasText: secondFilename })
    .locator('input[type="checkbox"]');
  await expect(secondChoice).toBeVisible();
  await secondChoice.check();
  const changeReason = '补齐承办律师核对后的执行依据和送达信息';
  await panel.getByLabel(/重提原因/).fill(`  ${changeReason}  `);
  await expect(panel.locator('[data-test="submit-execution"]')).toBeEnabled();
  const secondRequest = page.waitForRequest(
    (candidate) =>
      candidate.method() === 'POST' &&
      new URL(candidate.url()).pathname === endpoint,
  );
  const secondResponse = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === 'POST' &&
      new URL(candidate.url()).pathname === endpoint,
  );
  await panel.locator('[data-test="submit-execution"]').click();
  const [secondRequestEvent, secondResult] = await Promise.all([
    secondRequest,
    secondResponse,
  ]);
  await status(secondResult, 201);
  const secondInput = secondRequestEvent.postDataJSON() as {
    expectedVersion: number;
    expectedSubmissionId: string;
    changeReason: string;
    executionApplicationContentVersionIds: string[];
  };
  expect(secondInput.expectedVersion).toBe(firstReceipt.version);
  expect(secondInput.expectedSubmissionId).toBe(firstReceipt.submissionId);
  expect(secondInput.changeReason).toBe(changeReason);
  expect(secondInput.executionApplicationContentVersionIds).toEqual([
    secondContentVersionId,
  ]);
  const secondReceipt = (await secondResult.json()) as {
    version: number;
    submissionId: string;
    stage: string;
  };
  expect(secondReceipt.stage).toBe('WAITING_EXECUTION_CONFIRMATION');
  expect(secondReceipt.version).toBe(firstReceipt.version + 1);

  const afterSecondResponse = await page.request.get(
    `/api/v1/lawyer/cases/${source.caseId}`,
  );
  await status(afterSecondResponse, 200);
  const afterSecond = (await afterSecondResponse.json()) as {
    executionSubmission: {
      current: {
        id: string;
        priorSubmissionId: string | null;
        changeReason: string | null;
        fromVersion: number;
        toVersion: number;
        files: Array<{ contentVersionId: string; originalFilename: string }>;
      };
      submissions: Array<{
        id: string;
        changeReason: string | null;
        files: Array<{ contentVersionId: string; originalFilename: string }>;
      }>;
    };
  };
  expect(afterSecond.executionSubmission.current.id).toBe(
    secondReceipt.submissionId,
  );
  expect(afterSecond.executionSubmission.current.priorSubmissionId).toBe(
    firstReceipt.submissionId,
  );
  expect(afterSecond.executionSubmission.current.changeReason).toBe(
    changeReason,
  );
  expect(afterSecond.executionSubmission.current.fromVersion).toBe(
    firstReceipt.version,
  );
  expect(afterSecond.executionSubmission.current.toVersion).toBe(
    secondReceipt.version,
  );
  expect(afterSecond.executionSubmission.current.files).toEqual([
    expect.objectContaining({
      contentVersionId: secondContentVersionId,
      originalFilename: secondFilename,
    }),
  ]);
  expect(afterSecond.executionSubmission.submissions).toHaveLength(2);
  const firstHistory = afterSecond.executionSubmission.submissions.find(
    (submission) => submission.id === firstReceipt.submissionId,
  );
  const currentHistory = afterSecond.executionSubmission.submissions.find(
    (submission) => submission.id === secondReceipt.submissionId,
  );
  expect(firstHistory?.files).toEqual([
    expect.objectContaining({
      contentVersionId: firstContentVersionId,
      originalFilename: firstFilename,
    }),
  ]);
  expect(currentHistory?.changeReason).toBe(changeReason);

  await page.reload();
  await expect(panel.getByText(changeReason)).toBeVisible();
  await expect(panel.getByText(firstFilename)).toBeVisible();
  await expect(panel.getByText(secondFilename)).toBeVisible();
  await logout(page);
  await login(
    page,
    '/lawyer/cases',
    source.lawyer.username,
    source.lawyer.password,
  );
  await page.goto(`/lawyer/cases/${source.caseId}`);
  const afterLoginPanel = page.locator(
    '[data-test="execution-submission-panel"]',
  );
  await expect(afterLoginPanel.getByText(changeReason)).toBeVisible();
  const history = afterLoginPanel.getByRole('region', {
    name: '执行材料提交历史',
  });
  const firstHistoryDownload = history
    .locator('li')
    .filter({ hasText: firstFilename })
    .getByRole('button', { name: '下载', exact: true });
  const secondHistoryDownload = history
    .locator('li')
    .filter({ hasText: secondFilename })
    .getByRole('button', { name: '下载', exact: true });
  expect(
    await browserDownloadBytes(page, () => firstHistoryDownload.click()),
  ).toEqual(applicationPdf);
  expect(
    await browserDownloadBytes(page, () => secondHistoryDownload.click()),
  ).toEqual(revisedApplicationPdf);
});

test('client can read the new stage but not execution facts or another enterprise case', async ({
  page,
  request,
  browser,
}) => {
  const source = await prepareOperatorExecutionCase(page, request);
  const filename = `CA011内部执行申请-${randomUUID().slice(0, 8)}.pdf`;
  const panel = page.locator('[data-test="execution-submission-panel"]');
  const uploadResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      /^\/api\/v1\/materials\/upload-drafts\/[^/]+\/content$/u.test(
        new URL(response.url()).pathname,
      ),
  );
  await panel.locator('input[type="file"]').setInputFiles({
    name: filename,
    mimeType: 'application/pdf',
    buffer: applicationPdf,
  });
  await status(await uploadResponse, 200);
  const exactVersionId = await exactUploadedVersionId(
    page,
    source.caseId,
    filename,
  );
  const unconfirmedFilename = `CA011待提交内部草稿-${randomUUID().slice(0, 8)}.pdf`;
  const unconfirmedUpload = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      /^\/api\/v1\/materials\/upload-drafts\/[^/]+\/content$/u.test(
        new URL(response.url()).pathname,
      ),
  );
  await panel.locator('input[type="file"]').setInputFiles({
    name: unconfirmedFilename,
    mimeType: 'application/pdf',
    buffer: revisedApplicationPdf,
  });
  await status(await unconfirmedUpload, 200);
  const unconfirmedVersionId = await exactUploadedVersionId(
    page,
    source.caseId,
    unconfirmedFilename,
  );
  await panel
    .locator('label')
    .filter({ hasText: filename })
    .locator('input[type="checkbox"]')
    .check();
  const submit = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/cases/${source.caseId}/execution-submit`,
  );
  await panel.locator('[data-test="submit-execution"]').click();
  await status(await submit, 201);

  const clientPage = await browser.newPage({ baseURL: origin });
  try {
    await login(
      clientPage,
      '/client/leads',
      source.clientSession.user.username,
      'client correct horse battery',
    );
    await clientPage.goto(`/client/cases/${source.caseId}`);
    await expect(clientPage.locator('.page-head .pill')).toContainText(
      '执行材料待确认',
    );
    await expect(
      clientPage.locator('[data-test="execution-submission-panel"]'),
    ).toHaveCount(0);
    await expect(clientPage.getByText(filename, { exact: true })).toHaveCount(
      0,
    );
    await expect(
      clientPage.getByText(unconfirmedFilename, { exact: true }),
    ).toHaveCount(0);
    const clientDetail = await clientPage.request.get(
      `/api/v1/client/cases/${source.caseId}`,
    );
    await status(clientDetail, 200);
    const projection = (await clientDetail.json()) as Record<string, unknown>;
    expect(projection.stage).toBe('WAITING_EXECUTION_CONFIRMATION');
    expect(projection).not.toHaveProperty('executionSubmission');
    expect(JSON.stringify(projection)).not.toContain(exactVersionId);
    expect(JSON.stringify(projection)).not.toContain(filename);
    expect(JSON.stringify(projection)).not.toContain(unconfirmedVersionId);
    expect(JSON.stringify(projection)).not.toContain(unconfirmedFilename);
    await expect(
      clientPage.getByRole('button', { name: /执行材料|重提/ }),
    ).toHaveCount(0);
    await logout(clientPage);
  } finally {
    await clientPage.close();
  }

  const foreign = await createOtherEnterpriseClient(request);
  const foreignPage = await browser.newPage({ baseURL: origin });
  try {
    await login(
      foreignPage,
      '/client/leads',
      foreign.username,
      foreign.password,
    );
    await foreignPage.goto(`/client/cases/${source.caseId}`);
    await expect(
      foreignPage.getByRole('heading', { name: '案件不存在或已不可访问' }),
    ).toBeVisible();
    const denied = await foreignPage.request.get(
      `/api/v1/client/cases/${source.caseId}`,
    );
    await status(denied, 404);
    await logout(foreignPage);
  } finally {
    await foreignPage.close();
  }
});

test('read-only and unrelated actors cannot write or cross case boundaries', async ({
  page,
  request,
}) => {
  const source = await prepareOperatorExecutionCase(page, request);
  const panel = page.locator('[data-test="execution-submission-panel"]');
  const filename = `CA011只读核验材料-${randomUUID().slice(0, 8)}.pdf`;
  const uploadResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      /^\/api\/v1\/materials\/upload-drafts\/[^/]+\/content$/u.test(
        new URL(response.url()).pathname,
      ),
  );
  await panel.locator('input[type="file"]').setInputFiles({
    name: filename,
    mimeType: 'application/pdf',
    buffer: applicationPdf,
  });
  await status(await uploadResponse, 200);
  const contentVersionId = await exactUploadedVersionId(
    page,
    source.caseId,
    filename,
  );
  const alternateFilename = `CA011只读拒绝用新材料-${randomUUID().slice(0, 8)}.pdf`;
  const alternateUpload = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      /^\/api\/v1\/materials\/upload-drafts\/[^/]+\/content$/u.test(
        new URL(response.url()).pathname,
      ),
  );
  await panel.locator('input[type="file"]').setInputFiles({
    name: alternateFilename,
    mimeType: 'application/pdf',
    buffer: revisedApplicationPdf,
  });
  await status(await alternateUpload, 200);
  const alternateContentVersionId = await exactUploadedVersionId(
    page,
    source.caseId,
    alternateFilename,
  );
  await panel
    .locator('label')
    .filter({ hasText: filename })
    .locator('input[type="checkbox"]')
    .check();
  const submitted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/cases/${source.caseId}/execution-submit`,
  );
  await panel.locator('[data-test="submit-execution"]').click();
  await status(await submitted, 201);
  const unrelatedSourceRequest = await playwrightRequest.newContext({
    baseURL: origin,
  });
  const unrelatedLawyerSource = await (async () => {
    try {
      return await createSubmittedCaseThroughApi(unrelatedSourceRequest, {
        submitAsLawyer: true,
      });
    } finally {
      await unrelatedSourceRequest.dispose();
    }
  })();

  await logout(page);
  await login(
    page,
    '/cases',
    coreLeadFixtures.selfUsername,
    coreLeadFixtures.selfPassword,
  );
  await page.goto(`/cases/${source.caseId}`);
  const readOnlyPanel = page.locator(
    '[data-test="execution-submission-panel"]',
  );
  await expect(readOnlyPanel).toBeVisible();
  await expect(readOnlyPanel.locator('input[type="file"]')).toHaveCount(0);
  await expect(
    readOnlyPanel.locator('[data-test="submit-execution"]'),
  ).toHaveCount(0);
  const detailResponse = await page.request.get(
    `/api/v1/cases/${source.caseId}`,
  );
  await status(detailResponse, 200);
  const detail = (await detailResponse.json()) as {
    version: number;
    stage: string;
    judgmentNextStep: { current: { id: string; trialRoundId: string } };
    secondInstance: { currentResult: { id: string } | null };
    executionSubmission: {
      current: {
        id: string;
        files: Array<{ materialId: string; contentVersionId: string }>;
      };
    };
  };
  expect(detail.stage).toBe('WAITING_EXECUTION_CONFIRMATION');
  expect(detail.executionSubmission.current.files).toEqual([
    expect.objectContaining({ contentVersionId }),
  ]);
  const download = readOnlyPanel
    .getByRole('region', { name: '执行材料提交历史' })
    .locator('li')
    .filter({ hasText: filename })
    .getByRole('button', { name: '下载', exact: true });
  expect(await browserDownloadBytes(page, () => download.click())).toEqual(
    applicationPdf,
  );
  const sessionResponse = await page.request.get('/api/v1/auth/session');
  await status(sessionResponse, 200);
  const csrfToken = ((await sessionResponse.json()) as { csrfToken: string })
    .csrfToken;
  const readOnlyIdempotencyKey = randomUUID();
  const deniedWrite = await page.request.post(
    `/api/v1/cases/${source.caseId}/execution-submit`,
    {
      headers: {
        Origin: origin,
        'X-CSRF-Token': csrfToken,
        'Idempotency-Key': readOnlyIdempotencyKey,
      },
      data: {
        expectedVersion: detail.version,
        idempotencyKey: readOnlyIdempotencyKey,
        trialRoundId: detail.judgmentNextStep.current.trialRoundId,
        judgmentNextStepId: detail.judgmentNextStep.current.id,
        secondInstanceResultId: detail.secondInstance.currentResult?.id ?? null,
        expectedSubmissionId: detail.executionSubmission.current.id,
        executionApplicationContentVersionIds: [alternateContentVersionId],
        changeReason: '只读账号不得提交重提',
      },
    },
  );
  expect(deniedWrite.status()).toBe(403);
  expect((await deniedWrite.json()).code).toBe('FORBIDDEN');
  await logout(page);

  await login(
    page,
    '/lawyer/cases',
    unrelatedLawyerSource.lawyer.username,
    unrelatedLawyerSource.lawyer.password,
  );
  const unrelatedLawyerDetail = await page.request.get(
    `/api/v1/lawyer/cases/${source.caseId}`,
  );
  expect([403, 404]).toContain(unrelatedLawyerDetail.status());
  await logout(page);

  const otherDepartmentRead = await request.get(
    `/api/v1/cases/${source.caseId}`,
    { headers: { Authorization: `Bearer ${coreLeadFixtures.tokenB}` } },
  );
  expect([403, 404]).toContain(otherDepartmentRead.status());
  const otherDepartmentIdempotencyKey = randomUUID();
  const otherDepartmentWrite = await request.post(
    `/api/v1/cases/${source.caseId}/execution-submit`,
    {
      headers: {
        Authorization: `Bearer ${coreLeadFixtures.tokenB}`,
        'Idempotency-Key': otherDepartmentIdempotencyKey,
      },
      data: {
        expectedVersion: detail.version,
        idempotencyKey: otherDepartmentIdempotencyKey,
        trialRoundId: detail.judgmentNextStep.current.trialRoundId,
        judgmentNextStepId: detail.judgmentNextStep.current.id,
        secondInstanceResultId: detail.secondInstance.currentResult?.id ?? null,
        expectedSubmissionId: detail.executionSubmission.current.id,
        executionApplicationContentVersionIds: [contentVersionId],
        changeReason: '跨部门账号不得改写执行材料',
      },
    },
  );
  expect([403, 404]).toContain(otherDepartmentWrite.status());
});

test('internal and current-lawyer preparation groups navigate to their execution cases', async ({
  page,
  request,
}) => {
  const source = await prepareOperatorExecutionCase(page, request);
  const internalGroup = page.locator(
    '[data-test="execution-preparation-stage"]',
  );
  await expect(internalGroup).toBeVisible();
  await internalGroup.click();
  await expect(page).toHaveURL(
    /\/cases\?view=mine&stageGroup=EXECUTION_PREPARATION$/u,
  );
  await expect(internalGroup.locator('.app-nav__badge')).toHaveText(/^\d+$/u);
  await page.getByRole('button', { name: '本部门全部' }).click();
  await expect(page).toHaveURL(
    /\/cases\?view=department&stageGroup=EXECUTION_PREPARATION$/u,
  );
  await expect(internalGroup.locator('.app-nav__badge')).toHaveText(/^\d+$/u);
  const internalCase = page.locator(
    `[data-test="case-list"] a[href^="/cases/${source.caseId}?"]`,
  );
  await expect(internalCase).toBeVisible();
  await expect(internalGroup).toContainText('准备执行文书');
  await page.locator('[data-test="case-view-mine"]').click();
  await expect(page).toHaveURL(
    /\/cases\?view=mine&stageGroup=EXECUTION_PREPARATION$/u,
  );
  await expect(
    page.locator('[data-test="execution-preparation-nav"]'),
  ).toContainText('准备执行文书');

  await logout(page);
  await login(
    page,
    '/lawyer/cases',
    source.lawyer.username,
    source.lawyer.password,
  );
  const lawyerGroup = page.locator(
    '[data-test="lawyer-execution-preparation-nav"] [data-test="execution-preparation-stage"]',
  );
  await expect(lawyerGroup).toBeVisible();
  await lawyerGroup.click();
  await expect(page).toHaveURL(
    /\/lawyer\/cases\?stageGroup=EXECUTION_PREPARATION$/u,
  );
  const lawyerCase = page.locator(
    `[data-test="lawyer-case-list"] a[href="/lawyer/cases/${source.caseId}"]`,
  );
  await expect(lawyerCase).toBeVisible();
});
