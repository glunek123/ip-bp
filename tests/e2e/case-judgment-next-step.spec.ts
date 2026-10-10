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
import { disconnectCustomerTestDatabase } from '../support/customer-database.mjs';

const origin = 'http://127.0.0.1:5174';
const pdf = Buffer.from('%PDF-1.4\nCA009 judgment fixture\n%%EOF\n');
const todayShanghai = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
function pastWorkflowDate(): string {
  const past = new Date(`${todayShanghai()}T00:00:00.000Z`);
  past.setUTCDate(past.getUTCDate() - 2);
  const date = past.toISOString().slice(0, 10);
  return date > '2026-09-28' ? date : '2026-09-28';
}
async function status(
  response: { status(): number; text(): Promise<string>; url(): string },
  expected: number,
) {
  const actual = response.status();
  let diagnostic = '';
  if (actual !== expected) {
    try {
      diagnostic = await response.text();
    } catch {
      // Navigation can make a browser response body unavailable. The status
      // assertion still reports the exact expected and actual status codes.
    }
  }
  expect(actual, `${response.url()} ${diagnostic}`).toBe(expected);
}
async function createOtherEnterpriseClient(
  request: APIRequestContext,
): Promise<{ username: string; password: string }> {
  const username = `ca009-foreign-${randomUUID().slice(0, 8)}`;
  const password = 'foreign client password 2026';
  const loginResponse = await request.post('/api/v1/auth/login', {
    headers: { Origin: origin },
    data: {
      username: coreLeadFixtures.operatorUsername,
      password: coreLeadFixtures.operatorPassword,
    },
  });
  await status(loginResponse, 200);
  const session = (await loginResponse.json()) as { csrfToken: string };
  const created = await request.post(
    `/api/v1/customers/${coreLeadFixtures.selfCustomer}/client-accounts`,
    {
      headers: { 'X-CSRF-Token': session.csrfToken },
      data: { displayName: 'CA-009其他企业客户', username, password },
    },
  );
  await status(created, 201);
  return { username, password };
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
  return (await response.json()).csrfToken as string;
}
async function logout(page: Page) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/auth/logout',
  );
  await page.getByRole('button', { name: '退出登录' }).click();
  await status(await responsePromise, 204);
  await expect(page).toHaveURL(/\/login$/u);
}
async function upload(
  page: Page,
  caseId: string,
  category: string,
  csrf: string,
): Promise<string> {
  const draft = await page.request.post('/api/v1/materials/upload-drafts', {
    headers: { Origin: new URL(page.url()).origin, 'X-CSRF-Token': csrf },
    data: {
      ownerType: 'CASE',
      ownerId: caseId,
      category,
      purpose: category,
      originalFilename: `${category}-${randomUUID().slice(0, 6)}.pdf`,
      declaredMimeType: 'application/pdf',
    },
  });
  await status(draft, 201);
  const draftId = (await draft.json()).id as string;
  const result = await page.request.put(
    `/api/v1/materials/upload-drafts/${draftId}/content`,
    {
      headers: {
        Origin: new URL(page.url()).origin,
        'X-CSRF-Token': csrf,
        'Content-Type': 'application/octet-stream',
      },
      data: pdf,
    },
  );
  await status(result, 200);
  return (await result.json()).contentVersionId as string;
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
    data: { name: `CA009法院-${randomUUID().slice(0, 8)}` },
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
      originalFilename: `${category}-${randomUUID().slice(0, 6)}.pdf`,
      declaredMimeType: 'application/pdf',
    },
  });
  await status(draft, 201);
  const draftId = (await draft.json()).id as string;
  const result = await request.put(
    `/api/v1/materials/upload-drafts/${draftId}/content`,
    {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: pdf,
    },
  );
  await status(result, 200);
  return (await result.json()).contentVersionId as string;
}
async function prepareWaitingJudgment(
  page: Page,
  caseId: string,
  lawyer: { username: string; password: string },
  businessDate: string,
  operatorCsrf: string,
) {
  const notice = await upload(page, caseId, 'ACCEPTANCE_NOTICE', operatorCsrf);
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
        expectedVersion: (await detail.json()).version,
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
        expectedVersion: (await lawyerDetail.json()).version,
        idempotencyKey: randomUUID(),
        hearingAt: businessDate,
      },
    },
  );
  await status(scheduled, 201);
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/v1/lawyer/cases/${caseId}`)
          ).json()
        ).stage,
    )
    .toBe('WAITING_JUDGMENT');
  await logout(page);
}
async function registerJudgment(
  page: Page,
  caseId: string,
  acceptedAt: string,
  lawyer = false,
) {
  const path = lawyer ? `/lawyer/cases/${caseId}` : `/cases/${caseId}`;
  await page.goto(path);
  const panel = page.locator('[data-test="case-judgment-panel"]');
  await expect(panel).toBeVisible();
  const filename = `CA009判决-${randomUUID().slice(0, 6)}.pdf`;
  await panel.locator('[data-test="judgment-file-input"]').setInputFiles({
    name: filename,
    mimeType: 'application/pdf',
    buffer: pdf,
  });
  await expect(panel.getByText(filename)).toBeVisible();
  await panel.locator('[data-test="judgment-date"]').fill(acceptedAt);
  await panel
    .locator('[data-test="judgment-amount-state"]')
    .selectOption('PENDING');
  await panel.locator('[data-test="paid-fee-state"]').selectOption('KNOWN');
  await panel.locator('[data-test="paid-fee-amount"]').fill('0.00');
  const endpoint = `${lawyer ? '/api/v1/lawyer' : '/api/v1'}/cases/${caseId}/judgment-register`;
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === endpoint,
  );
  await panel.locator('[data-test="judgment-submit"]').click();
  await status(await responsePromise, 201);
  return { filename, panel };
}

let admin: { username: string; password: string };
test.beforeEach(async () => {
  await clearCoreCaseHearingAdminSessions();
  await clearCaseAcceptanceFault();
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
  await clearCaseAcceptanceFixture();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
  await resetCoreLeadE2eData();
  await clearCoreCaseHearingAdmin();
});
test.afterAll(async () => disconnectCustomerTestDatabase());

test('real operator chooses, revokes, corrects, and chooses a new judgment path; lawyer and client projections stay scoped', async ({
  page,
  browser,
  request,
}) => {
  const businessDate = pastWorkflowDate();
  const internalCase = await createSubmittedCaseThroughApi(request, {
    defendants: [
      { kind: 'ORGANIZATION', name: '同名被告' },
      { kind: 'ORGANIZATION', name: '同名被告' },
    ],
  });
  const lawyerCase = await createSubmittedCaseThroughApi(request, {
    submitAsLawyer: true,
  });
  const foreignClient = await createOtherEnterpriseClient(request);
  await prepareWaitingFormal(request, internalCase, businessDate);
  await prepareWaitingFormal(request, lawyerCase, businessDate);

  await login(page, '/settings/people-access', admin.username, admin.password);
  const context = await page.request.get(
    '/api/v1/organization/management-context',
  );
  await status(context, 200);
  const roles = (await context.json()).roles as Array<{
    id: string;
    grants: Array<{ action: string; scope: string }>;
  }>;
  const role = roles.find(
    (candidate) => candidate.id === coreLeadFixtures.roleA,
  );
  if (!role) throw new Error('CORE TEAM role missing');
  const editorButton = page.locator(
    `[data-test="edit-role-${coreLeadFixtures.roleA}"]`,
  );
  await expect(editorButton).toBeVisible();
  await editorButton.click();
  const editor = page.getByRole('dialog', { name: 'CORE TEAM' });
  for (const action of [
    'CASE_JUDGMENT_REGISTER',
    'CASE_JUDGMENT_CORRECT',
    'CASE_JUDGMENT_NEXT_STEP',
    'CASE_JUDGMENT_NEXT_STEP_REVOKE',
  ]) {
    await editor.locator(`[data-test="grant-${action}"]`).check();
    await editor.locator(`[data-test="scope-${action}"]`).selectOption('TEAM');
  }
  const contextRefresh = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname ===
        '/api/v1/organization/management-context',
  );
  await editor.getByRole('button', { name: '保存模板' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await status(await contextRefresh, 200);
  await logout(page);

  let csrf = await login(
    page,
    '/cases',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await prepareWaitingJudgment(
    page,
    internalCase.caseId,
    internalCase.lawyer,
    businessDate,
    csrf,
  );
  await login(
    page,
    '/cases',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  const internalJudgment = await registerJudgment(
    page,
    internalCase.caseId,
    businessDate,
  );
  const next = page.locator('[data-test="case-judgment-next-step-panel"]');
  await expect(next).toBeVisible();
  await expect(next.locator('input[type="radio"]:checked')).toHaveCount(0);
  await next.locator('input[value="APPEAL"]').check();
  await expect(
    next.locator('[data-plaintiff-appeals="true"]'),
  ).not.toBeChecked();
  const internalDetail = await page.request.get(
    `/api/v1/cases/${internalCase.caseId}`,
  );
  await status(internalDetail, 200);
  const projection = await internalDetail.json();
  const defendants = projection.defendants as Array<{
    id: string;
    name: string;
  }>;
  expect(defendants.map(({ name }) => name)).toEqual(['同名被告', '同名被告']);
  await next.locator('[data-plaintiff-appeals="true"]').check();
  for (const defendant of defendants)
    await next.locator(`[data-defendant-id="${defendant.id}"]`).check();
  const submitChoice = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/cases/${internalCase.caseId}/judgment-next-step`,
  );
  await next.getByRole('button', { name: '核对并提交选择' }).click();
  await expect(next.getByRole('dialog')).toContainText('原告方');
  await next.locator('[data-confirm-choice]').click();
  await status(await submitChoice, 201);
  await expect(next).toContainText('二审');
  await expect(
    internalJudgment.panel.locator('[data-test="judgment-correction-form"]'),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.locator('[data-test="case-judgment-next-step-panel"]'),
  ).toContainText('二审');
  const persisted = await page.request.get(
    `/api/v1/cases/${internalCase.caseId}`,
  );
  await status(persisted, 200);
  const currentChoice = (
    (await persisted.json()).judgmentNextStep as {
      current: { id: string; defendants: Array<{ defendantId: string }> };
    }
  ).current;
  expect(
    currentChoice.defendants.map((entry) => entry.defendantId).sort(),
  ).toEqual(defendants.map((entry) => entry.id).sort());
  const revoke = page.locator('[data-test="case-judgment-next-step-panel"]');
  await expect(revoke).toContainText('撤销后案件将退回');
  await revoke
    .locator('[data-revoke-reason]')
    .fill('二审材料核对后决定先修正判决事实');
  const revokeResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/cases/${internalCase.caseId}/judgment-next-step-revoke`,
  );
  await revoke.locator('[data-revoke-choice]').click();
  await revoke.locator('[data-confirm-revoke]').click();
  await status(await revokeResponse, 201);
  await expect(revoke).toContainText('待判决');
  await expect(revoke).toContainText('二审材料核对后决定先修正判决事实');
  await expect(
    internalJudgment.panel.locator('[data-test="judgment-correction-form"]'),
  ).toBeVisible();
  await internalJudgment.panel
    .locator('[data-test="judgment-file-input"]')
    .setInputFiles({
      name: 'CA009更正判决.pdf',
      mimeType: 'application/pdf',
      buffer: pdf,
    });
  await expect(
    internalJudgment.panel.getByText('CA009更正判决.pdf'),
  ).toBeVisible();
  await internalJudgment.panel
    .locator('li')
    .filter({ hasText: 'CA009更正判决.pdf' })
    .locator('input[type="checkbox"]')
    .check();
  await internalJudgment.panel
    .locator('[data-test="judgment-date"]')
    .fill(businessDate);
  await internalJudgment.panel
    .locator('[data-test="judgment-amount-state"]')
    .selectOption('KNOWN');
  await internalJudgment.panel
    .locator('[data-test="judgment-amount"]')
    .fill('1.00');
  await internalJudgment.panel
    .locator('[data-test="paid-fee-state"]')
    .selectOption('KNOWN');
  await internalJudgment.panel
    .locator('[data-test="paid-fee-amount"]')
    .fill('0.00');
  await internalJudgment.panel
    .locator('[data-test="judgment-correction-reason"]')
    .fill('撤销后补齐判决金额事实');
  await expect(
    internalJudgment.panel.locator('[data-test="judgment-correct"]'),
  ).toBeEnabled();
  const correction = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/cases/${internalCase.caseId}/judgment-correct`,
  );
  await internalJudgment.panel
    .locator('[data-test="judgment-correct"]')
    .click();
  await status(await correction, 201);
  const execution = page.locator('[data-test="case-judgment-next-step-panel"]');
  await execution.locator('input[value="EXECUTION"]').check();
  await expect(execution.locator('input[type="checkbox"]')).not.toBeChecked();
  await execution
    .getByText(/已核实本案可进入执行准备/)
    .locator('input')
    .check();
  const chooseExecution = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/cases/${internalCase.caseId}/judgment-next-step`,
  );
  await execution.getByRole('button', { name: '核对并提交选择' }).click();
  await expect(execution.getByRole('dialog')).toContainText(
    '不代表已经申请强制执行',
  );
  await execution.locator('[data-confirm-choice]').click();
  await status(await chooseExecution, 201);
  await expect(execution).toContainText('待写执行材料');
  await expect(page.locator('.page-head .pill')).toContainText('待写执行材料');
  await expect(
    page.locator('[data-test="execution-preparation-stage"]'),
  ).toContainText('待写执行材料');
  await page.locator('[data-test="execution-preparation-stage"]').click();
  await page.getByRole('button', { name: '本部门全部' }).click();
  const internalStageLink = page.locator(
    `[data-test="case-list"] a[href^="/cases/${internalCase.caseId}?"]`,
  );
  await expect(internalStageLink).toBeVisible();
  await expect(
    page
      .locator('[data-test="case-list"] li')
      .filter({ hasText: '待写执行材料' }),
  ).toHaveCount(1);
  await internalStageLink.click();
  await expect(page.locator('.page-head .pill')).toContainText('待写执行材料');
  await page.reload();
  await expect(page.locator('.page-head .pill')).toContainText('待写执行材料');

  await logout(page);
  await login(
    page,
    '/cases',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await page.goto(`/cases/${internalCase.caseId}`);
  await expect(page.locator('.page-head .pill')).toContainText('待写执行材料');
  await logout(page);
  csrf = await login(
    page,
    '/cases',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await prepareWaitingJudgment(
    page,
    lawyerCase.caseId,
    lawyerCase.lawyer,
    businessDate,
    csrf,
  );
  const lawyerPage = await browser.newPage({ baseURL: origin });
  try {
    await login(
      lawyerPage,
      '/lawyer/cases',
      lawyerCase.lawyer.username,
      lawyerCase.lawyer.password,
    );
    const lawyerDetailResponse = await lawyerPage.request.get(
      `/api/v1/lawyer/cases/${lawyerCase.caseId}`,
    );
    await status(lawyerDetailResponse, 200);
    const lawyerProjection = await lawyerDetailResponse.json();
    expect(lawyerProjection.stage).toBe('WAITING_JUDGMENT');
    expect(lawyerProjection.canChooseJudgmentNextStep).toBe(false);
    expect(lawyerProjection.canRevokeJudgmentNextStep).toBe(false);
    expect(lawyerProjection.judgmentNextStep.current).toBeNull();
    await registerJudgment(lawyerPage, lawyerCase.caseId, businessDate, true);
    const judgmentDetailResponse = await lawyerPage.request.get(
      `/api/v1/lawyer/cases/${lawyerCase.caseId}`,
    );
    await status(judgmentDetailResponse, 200);
    expect(
      (await judgmentDetailResponse.json()).canChooseJudgmentNextStep,
    ).toBe(true);
    const lawyerNext = lawyerPage.locator(
      '[data-test="case-judgment-next-step-panel"]',
    );
    await expect(lawyerNext).toBeVisible();
    await expect(lawyerNext.locator('[data-revoke-choice]')).toHaveCount(0);
    await lawyerNext.locator('input[value="EXECUTION"]').check();
    await lawyerNext.locator('input[type="checkbox"]').check();
    const lawyerChoice = lawyerPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname ===
          `/api/v1/lawyer/cases/${lawyerCase.caseId}/judgment-next-step`,
    );
    await lawyerNext.getByRole('button', { name: '核对并提交选择' }).click();
    await lawyerNext.locator('[data-confirm-choice]').click();
    await status(await lawyerChoice, 201);
    await expect(lawyerNext).toContainText('待写执行材料');
    await expect(lawyerPage.locator('.page-head')).toContainText(
      '待写执行材料',
    );
    await logout(lawyerPage);
  } finally {
    await lawyerPage.close();
  }
  const clientPage = await browser.newPage({ baseURL: origin });
  try {
    await login(
      clientPage,
      '/client/leads',
      internalCase.clientSession.user.username,
      'client correct horse battery',
    );
    await clientPage.locator('[data-test="client-case-nav"]').click();
    await clientPage.getByRole('button', { name: '已登记' }).click();
    const ownCase = clientPage.locator(
      `[data-test="client-case-list"] a[href="/client/cases/${internalCase.caseId}"]`,
    );
    await expect(ownCase).toBeVisible();
    await ownCase.click();
    await expect(
      clientPage.getByText('待写执行材料', { exact: true }),
    ).toBeVisible();
    const clientProjectionResponse = await clientPage.request.get(
      `/api/v1/client/cases/${internalCase.caseId}`,
    );
    await status(clientProjectionResponse, 200);
    const clientProjection = await clientProjectionResponse.json();
    expect(clientProjection.stage).toBe('WAITING_EXECUTION_DOCUMENTS');
    expect(clientProjection).not.toHaveProperty('judgmentNextStep');
    expect(JSON.stringify(clientProjection)).not.toContain(
      '二审材料核对后决定先修正判决事实',
    );
    await clientPage.reload();
    await expect(
      clientPage.getByText('待写执行材料', { exact: true }),
    ).toBeVisible();
    await logout(clientPage);
    await login(
      clientPage,
      '/client/leads',
      internalCase.clientSession.user.username,
      'client correct horse battery',
    );
    await clientPage.locator('[data-test="client-case-nav"]').click();
    await clientPage.getByRole('button', { name: '已登记' }).click();
    const afterLoginCase = clientPage.locator(
      `[data-test="client-case-list"] a[href="/client/cases/${internalCase.caseId}"]`,
    );
    await expect(afterLoginCase).toBeVisible();
    await afterLoginCase.click();
    await expect(
      clientPage.getByText('待写执行材料', { exact: true }),
    ).toBeVisible();
  } finally {
    await clientPage.close();
  }
  const foreignPage = await browser.newPage({ baseURL: origin });
  try {
    await login(
      foreignPage,
      '/client/leads',
      foreignClient.username,
      foreignClient.password,
    );
    await foreignPage.goto(`/client/cases/${internalCase.caseId}`);
    await expect(
      foreignPage.getByRole('heading', { name: '案件不存在或已不可访问' }),
    ).toBeVisible();
    const denied = await foreignPage.request.get(
      `/api/v1/client/cases/${internalCase.caseId}`,
    );
    await status(denied, 404);
    await logout(foreignPage);
  } finally {
    await foreignPage.close();
  }
});
