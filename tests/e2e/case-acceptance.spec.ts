import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  disconnectCustomerTestDatabase,
  resetPersonnelAccessE2eData,
} from '../support/customer-database.mjs';
import {
  coreLeadFixtures,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';
import { createSubmittedCaseThroughApi } from '../support/case-complaint-confirmation-database.mjs';
import { clearCaseComplaintMailingFixture } from '../support/case-complaint-mailing-database.mjs';
import {
  clearCaseFilingFixture,
  prepareCaseFilingFixture,
} from '../support/case-filing-database.mjs';
import {
  clearCaseAcceptanceFault,
  clearCaseAcceptanceFixture,
  prepareCaseAcceptanceFixture,
} from '../support/case-acceptance-database.mjs';
import {
  closeCaseWorkspaceDrawer,
  openCaseWorkspaceCommand,
} from '../support/case-workspace-browser';

const operatorAuth = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const pdfBytes = Buffer.from(
  '%PDF-1.4\nCA006 browser acceptance bytes\n%%EOF\n',
);
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

async function expectStatus(
  response: { status(): number; text(): Promise<string> },
  status: number,
): Promise<void> {
  expect(response.status(), await response.text()).toBe(status);
}

async function login(
  page: Page,
  path: string,
  username: string,
  password: string,
): Promise<void> {
  await page.goto(path);
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(path);
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
}

async function downloadMaterialBytes(
  page: Page,
  panel: Locator,
  filename: string,
): Promise<Buffer> {
  const row = panel.locator('li').filter({ hasText: filename });
  await expect(row).toHaveCount(1);
  const button = row.getByRole('button', { name: '下载' });
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10_000 }),
    button.click({ timeout: 5_000 }),
  ]);
  return readFile(await download.path());
}

async function upload(
  request: APIRequestContext,
  caseId: string,
  category: 'MAIL_RECEIPT' | 'FILING_EVIDENCE',
  headers: Record<string, string>,
): Promise<string> {
  const draft = await request.post('/api/v1/materials/upload-drafts', {
    headers,
    data: {
      ownerType: 'CASE',
      ownerId: caseId,
      category,
      purpose: category,
      originalFilename: `${category}-${randomUUID().slice(0, 8)}.pdf`,
      declaredMimeType: 'application/pdf',
    },
  });
  await expectStatus(draft, 201);
  const draftId = (await draft.json()).id as string;
  const result = await request.put(
    `/api/v1/materials/upload-drafts/${draftId}/content`,
    {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: pdfBytes,
    },
  );
  await expectStatus(result, 200);
  return (await result.json()).contentVersionId as string;
}

async function waitingFormal(
  request: APIRequestContext,
  submitAsLawyer: boolean,
) {
  const source = await createSubmittedCaseThroughApi(request, {
    submitAsLawyer,
  });
  const headers = submitAsLawyer
    ? { 'X-CSRF-Token': source.lawyerSession!.csrfToken }
    : operatorAuth;
  const prefix = submitAsLawyer ? '/api/v1/lawyer/cases' : '/api/v1/cases';
  const confirmed = await request.post(
    `${prefix}/${source.caseId}/complaint-confirm`,
    {
      headers,
      data: {
        expectedVersion: 3,
        idempotencyKey: randomUUID(),
        confirmedComplaintContentVersionId: source.complaint.contentVersionId,
        amountState: 'KNOWN',
        amount: '123.45',
        pendingReason: null,
        confirmDisclose: true,
      },
    },
  );
  await expectStatus(confirmed, 201);
  const receipt = await upload(request, source.caseId, 'MAIL_RECEIPT', headers);
  const mailed = await request.post(
    `${prefix}/${source.caseId}/complaint-mail`,
    {
      headers,
      data: {
        expectedVersion: 4,
        idempotencyKey: randomUUID(),
        mailedAt: today(),
        mailReceiptContentVersionIds: [receipt],
      },
    },
  );
  await expectStatus(mailed, 201);
  const courtResponse = await request.post(
    `${prefix}/${source.caseId}/filing-courts`,
    {
      headers,
      data: { name: `CA006法院-${randomUUID().slice(0, 8)}` },
    },
  );
  await expectStatus(courtResponse, 201);
  const court = (await courtResponse.json()) as { id: string };
  const evidence = await upload(
    request,
    source.caseId,
    'FILING_EVIDENCE',
    headers,
  );
  const filed = await request.post(`${prefix}/${source.caseId}/filing-submit`, {
    headers,
    data: {
      expectedVersion: 5,
      idempotencyKey: randomUUID(),
      courtId: court.id,
      submittedAt: today(),
      filingEvidenceContentVersionIds: [evidence],
    },
  });
  await expectStatus(filed, 201);
  return source;
}

let personnelAdmin: { username: string; password: string };

test.beforeEach(async () => {
  await clearCaseAcceptanceFixture();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
  personnelAdmin = await resetPersonnelAccessE2eData();
  await resetCoreLeadE2eData();
  await prepareCaseFilingFixture();
  await prepareCaseAcceptanceFixture();
});
test.afterEach(async () => {
  await clearCaseAcceptanceFault();
  await clearCaseAcceptanceFixture();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
});
test.afterAll(async () => {
  await disconnectCustomerTestDatabase();
});

test('operator and assigned lawyer register through real browser sessions; client sees only its existing projection', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 1120 });
  const operatorCase = await waitingFormal(request, false);
  await login(
    page,
    '/customers',
    personnelAdmin.username,
    personnelAdmin.password,
  );
  await page.goto('/settings/people-access');
  await expect(page.getByRole('heading', { name: '角色模板' })).toBeVisible();
  const firstRoleEditor = page.locator('[data-test^="edit-role-"]').first();
  await expect(firstRoleEditor).toBeVisible();
  await firstRoleEditor.click();
  await expect(
    page.locator('[data-test="grant-CASE_ACCEPTANCE_REGISTER"]'),
  ).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login/u);

  await login(
    page,
    '/cases',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );

  await page.goto(`/cases/${operatorCase.caseId}`);
  await openCaseWorkspaceCommand(
    page,
    'acceptance',
    '[data-test="case-acceptance-panel"]',
  );
  const panel = page.locator('[data-test="case-acceptance-panel"]');
  await expect(panel).toBeVisible();
  const uploadDetailRefresh = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname ===
        `/api/v1/cases/${operatorCase.caseId}`,
    { timeout: 10_000 },
  );
  await panel
    .locator('[data-test="acceptance-material-input-ACCEPTANCE_NOTICE"]')
    .setInputFiles({
      name: '浏览器受理通知书.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBytes,
    });
  await expect(panel.getByText('浏览器受理通知书.pdf')).toBeVisible();
  await expectStatus(await uploadDetailRefresh, 200);
  await expect(
    page.getByRole('status', { name: '正在刷新案件详情…' }),
  ).toBeHidden();
  await panel.locator('input[type="checkbox"]').check();
  await panel.locator('[data-test="acceptance-accepted-at"]').fill(today());
  const operatorCourtCaseNo = `（2026）甲0101民初${randomUUID().slice(0, 6)}号`;
  await panel
    .locator('[data-test="acceptance-court-case-no"]')
    .fill(operatorCourtCaseNo);
  const due = today();
  await panel.getByLabel('缴费截止日期').fill(due);
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await expect(panel).toContainText('已保存草稿');
  const draftDetail = await page.request.get(
    `/api/v1/cases/${operatorCase.caseId}`,
  );
  await expectStatus(draftDetail, 200);
  expect(await draftDetail.json()).toMatchObject({
    stage: 'WAITING_FORMAL_ACCEPTANCE',
    acceptance: null,
  });
  const calendarPath = `/api/v1/calendar?month=${due.slice(0, 7)}`;
  const draftCalendar = await page.request.get(calendarPath);
  await expectStatus(draftCalendar, 200);
  expect((await draftCalendar.json()).events).not.toContainEqual(
    expect.objectContaining({ caseId: operatorCase.caseId, type: 'pay' }),
  );
  await page.reload();
  await openCaseWorkspaceCommand(
    page,
    'acceptance',
    '[data-test="case-acceptance-panel"]',
  );
  await expect(panel.getByLabel('缴费截止日期')).toHaveValue(due);
  await expect(
    panel.locator('[data-test="acceptance-court-case-no"]'),
  ).toHaveValue(operatorCourtCaseNo);
  await expect(panel.locator('input[type="checkbox"]')).toBeChecked();
  await page.screenshot({
    path: '.local/case-workflow-acceptance/formal-acceptance.png',
  });
  const detailRefresh = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname ===
        `/api/v1/cases/${operatorCase.caseId}`,
    { timeout: 10_000 },
  );
  const registerButton = panel.locator('[data-test="acceptance-register"]');
  await expect(registerButton).toBeEnabled();
  await registerButton.click();
  const refreshedDetail = await detailRefresh;
  await expectStatus(refreshedDetail, 200);
  const acceptedDetail = await refreshedDetail.json();
  expect(acceptedDetail).toMatchObject({
    stage: 'WAITING_HEARING',
    acceptance: { courtCaseNo: operatorCourtCaseNo },
  });
  await expect(page.locator('.detail-actions .pill')).toHaveText('待开庭');
  await expect(
    panel.locator('[data-test="case-acceptance-record"]'),
  ).toContainText(operatorCourtCaseNo);
  await expect(panel).toContainText(operatorCourtCaseNo);
  await expect(panel).toContainText('受理时冻结的版本');
  const acceptedCalendar = await page.request.get(calendarPath);
  await expectStatus(acceptedCalendar, 200);
  expect((await acceptedCalendar.json()).events).toContainEqual(
    expect.objectContaining({
      caseId: operatorCase.caseId,
      type: 'pay',
      sourceType: 'CASE_PAYMENT_DUE',
      date: due,
    }),
  );
  const operatorSession = await page.request.get('/api/v1/auth/session');
  await expectStatus(operatorSession, 200);
  const csrf = (await operatorSession.json()).csrfToken as string;
  const correctionPath = `/api/v1/cases/${operatorCase.caseId}/acceptance-correction`;
  const movedDate = new Date(Date.parse(due) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const correction = {
    acceptanceId: acceptedDetail.acceptance.id as string,
    acceptedAt: today(),
    courtCaseNo: operatorCourtCaseNo,
    reason: '隔离验收缴费截止日期更正',
  };
  for (const [expectedAcceptanceRevision, paymentDueAt] of [
    [0, movedDate],
    [1, null],
  ] as const) {
    const changed = await page.request.post(correctionPath, {
      headers: { Origin: new URL(page.url()).origin, 'X-CSRF-Token': csrf },
      data: {
        ...correction,
        expectedAcceptanceRevision,
        paymentDueAt,
        idempotencyKey: randomUUID(),
      },
    });
    await expectStatus(changed, 201);
    const view = await page.request.get(
      `/api/v1/calendar?month=${movedDate.slice(0, 7)}`,
    );
    await expectStatus(view, 200);
    const deadlines = (await view.json()).events.filter(
      (event: { caseId: string; type: string }) =>
        event.caseId === operatorCase.caseId && event.type === 'pay',
    );
    expect(deadlines.map((event: { date: string }) => event.date)).toEqual(
      paymentDueAt ? [paymentDueAt] : [],
    );
    const priorMonth = await page.request.get(calendarPath);
    await expectStatus(priorMonth, 200);
    expect((await priorMonth.json()).events).not.toContainEqual(
      expect.objectContaining({
        caseId: operatorCase.caseId,
        date: due,
        type: 'pay',
      }),
    );
  }
  await page.reload();
  await openCaseWorkspaceCommand(
    page,
    'acceptance',
    '[data-test="case-acceptance-panel"]',
  );
  await expect(
    page.locator('[data-test="case-acceptance-record"]'),
  ).toContainText(operatorCourtCaseNo);
  await closeCaseWorkspaceDrawer(page);
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login/u);
  await login(
    page,
    '/cases',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await page.goto(`/cases/${operatorCase.caseId}`);
  await openCaseWorkspaceCommand(
    page,
    'acceptance',
    '[data-test="case-acceptance-panel"]',
  );
  const operatorPanel = page.locator('[data-test="case-acceptance-panel"]');
  expect(
    await downloadMaterialBytes(page, operatorPanel, '浏览器受理通知书.pdf'),
  ).toEqual(pdfBytes);

  const clientContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    const clientPage = await clientContext.newPage();
    await login(
      clientPage,
      '/client/leads',
      operatorCase.clientSession.user.username,
      'client correct horse battery',
    );
    const clientCaseNav = clientPage.locator('[data-test="client-case-nav"]');
    await expect(clientCaseNav).toBeVisible();
    await clientCaseNav.click();
    await expect(clientPage).toHaveURL(/\/client\/cases$/u);
    await clientPage.goto(`/client/cases/${operatorCase.caseId}`);
    await expect(clientPage.getByText('待开庭', { exact: true })).toBeVisible();
    await expect(
      clientPage.getByText(operatorCourtCaseNo, { exact: true }),
    ).toHaveCount(0);
    await expect(
      clientPage.locator('[data-test="case-acceptance-panel"]'),
    ).toHaveCount(0);
    await expect(clientPage.getByText('浏览器受理通知书.pdf')).toHaveCount(0);
  } finally {
    await clientContext.close();
  }

  const lawyerCase = await waitingFormal(request, true);
  const lawyerPage = await browser.newPage({
    baseURL: new URL(page.url()).origin,
  });
  try {
    await login(
      lawyerPage,
      '/lawyer/cases',
      lawyerCase.lawyer.username,
      lawyerCase.lawyer.password,
    );
    await lawyerPage.goto(`/lawyer/cases/${lawyerCase.caseId}`);
    const lawyerPanel = lawyerPage.locator(
      '[data-test="case-acceptance-panel"]',
    );
    await expect(lawyerPanel).toBeVisible();
    await lawyerPanel
      .locator('[data-test="acceptance-accepted-at"]')
      .fill(today());
    await lawyerPanel
      .locator('[data-test="acceptance-court-case-no"]')
      .fill(`（2026）乙0202民初${randomUUID().slice(0, 6)}号`);
    await lawyerPanel.locator('[data-test="acceptance-register"]').click();
    await expect(
      lawyerPanel.locator('[data-test="case-acceptance-record"]'),
    ).toBeVisible();

    await lawyerPanel
      .locator('[data-test="acceptance-material-input-SERVICE_DOCUMENT"]')
      .setInputFiles({
        name: '律师后补送达文书.pdf',
        mimeType: 'application/pdf',
        buffer: pdfBytes,
      });
    await expect(lawyerPanel).toContainText('律师后补送达文书.pdf');
    await expect(lawyerPanel).toContainText('受理后补传材料');
    await expect(lawyerPage.getByText('待开庭', { exact: true })).toBeVisible();
    await lawyerPage.reload();
    await expect(
      lawyerPage.locator('[data-test="case-acceptance-panel"]'),
    ).toContainText('律师后补送达文书.pdf');
    expect(
      await downloadMaterialBytes(
        lawyerPage,
        lawyerPanel,
        '律师后补送达文书.pdf',
      ),
    ).toEqual(pdfBytes);
  } finally {
    await lawyerPage.close();
  }
});
