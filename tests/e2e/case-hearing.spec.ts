import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { disconnectCustomerTestDatabase } from '../support/customer-database.mjs';
import {
  coreLeadFixtures,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';
import { createSubmittedCaseThroughApi } from '../support/case-complaint-confirmation-database.mjs';
import {
  clearCaseFilingFixture,
  prepareCaseFilingFixture,
} from '../support/case-filing-database.mjs';
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
  clearCoreCaseHearingAdmin,
  clearCoreCaseHearingAdminSessions,
  prepareCoreCaseHearingAdmin,
} from '../support/case-hearing-database.mjs';

const operatorAuth = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const pdfBytes = Buffer.from(
  '%PDF-1.4\nCA007 browser acceptance bytes\n%%EOF\n',
);
const todayShanghai = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

function shiftBusinessDate(value: string, offsetDays: number): string {
  const shifted = new Date(`${value}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + offsetDays);
  return shifted.toISOString().slice(0, 10);
}

function pastWorkflowDate(): string {
  const twoDaysAgo = shiftBusinessDate(todayShanghai(), -2);
  return twoDaysAgo > '2026-09-28' ? twoDaysAgo : '2026-09-28';
}

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
): Promise<string> {
  await page.goto(path);
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  const loginResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/auth/login',
  );
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(path);
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
  const response = await loginResponse;
  await expectStatus(response, 200);
  return ((await response.json()) as { csrfToken: string }).csrfToken;
}

async function logout(page: Page): Promise<void> {
  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === 'POST' &&
      new URL(candidate.url()).pathname === '/api/v1/auth/logout',
  );
  await page.getByRole('button', { name: '退出登录' }).click();
  expect((await response).status()).toBe(204);
  await expect(page).toHaveURL(/\/login$/u);
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

async function createOtherEnterpriseClient(
  request: APIRequestContext,
): Promise<{ username: string; password: string }> {
  const username = `ca007-foreign-${randomUUID().slice(0, 8)}`;
  const password = 'foreign client password 2026';
  const loginResponse = await request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://127.0.0.1:5174' },
    data: {
      username: coreLeadFixtures.operatorUsername,
      password: coreLeadFixtures.operatorPassword,
    },
  });
  await expectStatus(loginResponse, 200);
  const session = (await loginResponse.json()) as { csrfToken: string };
  const created = await request.post(
    `/api/v1/customers/${coreLeadFixtures.selfCustomer}/client-accounts`,
    {
      headers: { 'X-CSRF-Token': session.csrfToken },
      data: { displayName: 'CA-007其他企业客户', username, password },
    },
  );
  await expectStatus(created, 201);
  return { username, password };
}

async function waitingFormal(
  request: APIRequestContext,
  businessDate: string,
  submitAsLawyer = false,
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
        mailedAt: businessDate,
        mailReceiptContentVersionIds: [receipt],
      },
    },
  );
  await expectStatus(mailed, 201);
  const courtResponse = await request.post(
    `${prefix}/${source.caseId}/filing-courts`,
    {
      headers,
      data: { name: `CA007法院-${randomUUID().slice(0, 8)}` },
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
      submittedAt: businessDate,
      filingEvidenceContentVersionIds: [evidence],
    },
  });
  await expectStatus(filed, 201);
  return source;
}

async function registerAcceptance(
  page: Page,
  caseId: string,
  acceptedAt: string,
  label: string,
): Promise<void> {
  await page.goto(`/cases/${caseId}`);
  const panel = page.locator('[data-test="case-acceptance-panel"]');
  await expect(panel).toBeVisible();
  await panel
    .locator('[data-test="acceptance-material-input-ACCEPTANCE_NOTICE"]')
    .setInputFiles({
      name: `${label}-受理通知书.pdf`,
      mimeType: 'application/pdf',
      buffer: pdfBytes,
    });
  await expect(panel.getByText(`${label}-受理通知书.pdf`)).toBeVisible();
  await panel.locator('input[type="checkbox"]').check();
  await panel.locator('[data-test="acceptance-accepted-at"]').fill(acceptedAt);
  await panel
    .locator('[data-test="acceptance-court-case-no"]')
    .fill(`（2026）甲0101民初${randomUUID().slice(0, 6)}号`);
  const acceptanceResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/cases/${caseId}/acceptance-register`,
  );
  const detailRefresh = page.waitForResponse(async (response) => {
    if (
      response.request().method() !== 'GET' ||
      new URL(response.url()).pathname !== `/api/v1/cases/${caseId}` ||
      response.status() !== 200
    )
      return false;
    const detail = (await response.json()) as {
      stage?: string;
      acceptance?: { acceptedAt?: string } | null;
    };
    return (
      detail.stage === 'WAITING_HEARING' &&
      detail.acceptance?.acceptedAt === acceptedAt
    );
  });
  await panel.getByRole('button', { name: '登记正式立案' }).click();
  const [registered, refreshed] = await Promise.all([
    acceptanceResponse,
    detailRefresh,
  ]);
  await expectStatus(registered, 201);
  await expectStatus(refreshed, 200);
  expect(await refreshed.json()).toMatchObject({
    stage: 'WAITING_HEARING',
    acceptance: { acceptedAt },
  });
  await expect(page.locator('.page-head .pill')).toHaveText('待开庭');
}

type HearingDetailPayload = {
  stage: 'WAITING_HEARING' | 'WAITING_JUDGMENT';
  hearing: {
    currentArrangement: { hearingAt: string | null } | null;
    currentAdvance: { id: string } | null;
    advances: Array<{ id: string }>;
  };
};

async function runHearingCommand(
  page: Page,
  caseId: string,
  command: 'hearing-schedule' | 'hearing-correct',
  stage: 'WAITING_HEARING' | 'WAITING_JUDGMENT',
  expectedAdvanceCount: number,
  expectedHearingAt: string | null,
  audience: 'internal' | 'lawyer' = 'internal',
): Promise<HearingDetailPayload> {
  const prefix =
    audience === 'lawyer' ? '/api/v1/lawyer/cases' : '/api/v1/cases';
  const commandResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `${prefix}/${caseId}/${command}`,
  );
  if (command === 'hearing-schedule')
    await page.locator('[data-test="hearing-save"]').click();
  else await page.locator('[data-test="hearing-correct"]').click();
  const saved = await commandResponse;
  await expectStatus(saved, 201);
  let latest: HearingDetailPayload | null = null;
  await expect
    .poll(async () => {
      const current = await page.request.get(`${prefix}/${caseId}`);
      if (current.status() !== 200)
        return {
          status: current.status(),
          stage: null,
          hearingAt: null,
          currentAdvance: false,
          advances: 0,
        };
      latest = (await current.json()) as HearingDetailPayload;
      return {
        status: current.status(),
        stage: latest.stage,
        hearingAt: latest.hearing.currentArrangement?.hearingAt ?? null,
        currentAdvance: latest.hearing.currentAdvance !== null,
        advances: latest.hearing.advances.length,
      };
    })
    .toEqual({
      status: 200,
      stage,
      hearingAt: expectedHearingAt,
      currentAdvance: stage === 'WAITING_JUDGMENT',
      advances: expectedAdvanceCount,
    });
  if (!latest) throw new Error('Latest case detail was not read');
  await page.reload();
  const visibleStage = stage === 'WAITING_HEARING' ? '待开庭' : '待判决';
  if (audience === 'lawyer')
    await expect(page.locator('.page-head')).toContainText(visibleStage);
  else await expect(page.locator('.page-head .pill')).toHaveText(visibleStage);
  return latest;
}

async function scheduleOverdue(
  page: Page,
  caseId: string,
  date: string,
  expectedAdvanceCount: number,
) {
  await page.locator('[data-test="hearing-date"]').fill(date);
  await expect(page.locator('[data-test="hearing-save"]')).toBeEnabled();
  const latest = await runHearingCommand(
    page,
    caseId,
    'hearing-schedule',
    'WAITING_JUDGMENT',
    expectedAdvanceCount,
    date,
  );
  expect(latest.hearing.advances).toHaveLength(expectedAdvanceCount);
  const history = page.locator('[data-test="hearing-history"]');
  await expect(history.getByText('系统自动推进至待判决')).toHaveCount(
    expectedAdvanceCount,
  );
}

let hearingAdmin: { username: string; password: string };

test.beforeEach(async () => {
  await clearCoreCaseHearingAdminSessions();
  await clearCaseAcceptanceFault();
  await clearCaseAcceptanceFixture();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
  await resetCoreLeadE2eData();
  await clearCoreCaseHearingAdmin();
  hearingAdmin = await prepareCoreCaseHearingAdmin();
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

test.afterAll(async () => {
  await disconnectCustomerTestDatabase();
});

test('formal role grants control overdue hearing registration and correction in real sessions', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(300_000);
  const acceptedAt = pastWorkflowDate();
  // Create the approved workflow sources before the role edit increments the
  // operator's authorization revision. All hearing commands still use browser
  // password sessions after the formal role grant below.
  const primary = await waitingFormal(request, acceptedAt);
  const secondary = await waitingFormal(request, acceptedAt, true);
  const adminCsrf = await login(
    page,
    '/settings/people-access',
    hearingAdmin.username,
    hearingAdmin.password,
  );
  expect(adminCsrf.length).toBeGreaterThan(0);
  const grantsBeforeResponse = await page.request.get(
    '/api/v1/organization/management-context',
  );
  await expectStatus(grantsBeforeResponse, 200);
  const grantsBefore = (await grantsBeforeResponse.json()) as {
    roles: Array<{
      id: string;
      grants: Array<{ action: string; scope: string }>;
    }>;
  };
  const roleBefore = grantsBefore.roles.find(
    (role) => role.id === coreLeadFixtures.roleA,
  );
  if (!roleBefore) throw new Error('CORE TEAM role missing before edit');
  const originalGrants = roleBefore.grants;
  const editorButton = page.locator(
    `[data-test="edit-role-${coreLeadFixtures.roleA}"]`,
  );
  await expect(editorButton).toBeVisible();
  await editorButton.click();
  const editor = page.getByRole('dialog', { name: 'CORE TEAM' });
  const scheduleGrant = editor.locator(
    '[data-test="grant-CASE_HEARING_SCHEDULE"]',
  );
  const correctGrant = editor.locator(
    '[data-test="grant-CASE_HEARING_CORRECT"]',
  );
  await scheduleGrant.check();
  await correctGrant.check();
  await editor
    .locator('[data-test="scope-CASE_HEARING_SCHEDULE"]')
    .selectOption('TEAM');
  await editor
    .locator('[data-test="scope-CASE_HEARING_CORRECT"]')
    .selectOption('TEAM');
  const grantsAfterResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname ===
        '/api/v1/organization/management-context',
  );
  await editor.getByRole('button', { name: '保存模板' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const updatedContext = await grantsAfterResponse;
  await expectStatus(updatedContext, 200);
  const grantsAfter = (await updatedContext.json()) as {
    roles: Array<{
      id: string;
      grants: Array<{ action: string; scope: string }>;
    }>;
  };
  const roleAfter = grantsAfter.roles.find(
    (role) => role.id === coreLeadFixtures.roleA,
  );
  if (!roleAfter) throw new Error('CORE TEAM role missing after edit');
  const scopeRank = { SELF: 1, TEAM: 2, DEPARTMENT: 3 } as const;
  const uncoveredGrants = originalGrants.filter(
    (grant) =>
      !roleAfter.grants.some(
        (savedGrant) =>
          savedGrant.action === grant.action &&
          scopeRank[savedGrant.scope as keyof typeof scopeRank] >=
            scopeRank[grant.scope as keyof typeof scopeRank],
      ),
  );
  expect(uncoveredGrants).toEqual([]);
  expect(roleAfter.grants).toEqual(
    expect.arrayContaining([
      { action: 'CASE_HEARING_SCHEDULE', scope: 'TEAM' },
      { action: 'CASE_HEARING_CORRECT', scope: 'TEAM' },
    ]),
  );
  await logout(page);

  const operatorCsrf = await login(
    page,
    '/cases',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  const accountProbe = await page.request.post(
    `/api/v1/customers/${coreLeadFixtures.admittedCustomer}/client-accounts`,
    {
      headers: { 'X-CSRF-Token': operatorCsrf },
      data: {
        displayName: 'CA-007既有管理能力核验',
        username: `ca007-existing-grant-${randomUUID().slice(0, 8)}`,
        password: 'CA-007 probe password 2026',
      },
    },
  );
  await expectStatus(accountProbe, 201);
  await registerAcceptance(page, primary.caseId, acceptedAt, '第一案');
  await page.goto(`/cases/${primary.caseId}`);
  const hearingPanel = page.locator('[data-test="case-hearing-panel"]');
  await expect(hearingPanel).toBeVisible();
  await expect(hearingPanel).toContainText('允许补录真实过去日期');
  await expect(hearingPanel).toContainText('不代表法院已经判决');
  await scheduleOverdue(page, primary.caseId, acceptedAt, 1);

  const futureDate = shiftBusinessDate(todayShanghai(), 2);
  await page.locator('[data-test="hearing-date"]').fill(futureDate);
  await page
    .locator('[data-test="hearing-correction-reason"]')
    .fill('法院来函确认原登记日期有误');
  await runHearingCommand(
    page,
    primary.caseId,
    'hearing-correct',
    'WAITING_HEARING',
    1,
    futureDate,
  );
  await expect(hearingPanel).toContainText('法院来函确认原登记日期有误');
  await page.reload();
  await expect(page.locator('.page-head .pill')).toHaveText('待开庭');
  await expect(hearingPanel).toContainText('登记开庭安排');
  await expect(hearingPanel).toContainText('系统自动推进至待判决');
  await expect(hearingPanel).toContainText('人工更正安排');
  await expect(hearingPanel).toContainText('法院来函确认原登记日期有误');
  await scheduleOverdue(page, primary.caseId, acceptedAt, 2);
  await expect(hearingPanel.getByText('系统自动推进至待判决')).toHaveCount(2);

  const foreignClient = await createOtherEnterpriseClient(request);
  await logout(page);
  const readOnlyCsrf = await login(
    page,
    '/cases',
    coreLeadFixtures.selfUsername,
    coreLeadFixtures.selfPassword,
  );
  await page.goto(`/cases/${primary.caseId}`);
  await expect(page.locator('.page-head .pill')).toHaveText('待判决');
  await expect(
    page.locator('[data-test="hearing-correction-form"]'),
  ).toHaveCount(0);
  const readOnlyDetail = await page.request.get(
    `/api/v1/cases/${primary.caseId}`,
  );
  await expectStatus(readOnlyDetail, 200);
  const deniedInternalKey = randomUUID();
  const deniedInternal = await page.request.post(
    `/api/v1/cases/${primary.caseId}/hearing-correct`,
    {
      headers: {
        'X-CSRF-Token': readOnlyCsrf,
        'Idempotency-Key': deniedInternalKey,
      },
      data: {
        expectedVersion: (await readOnlyDetail.json()).version as number,
        idempotencyKey: deniedInternalKey,
        hearingAt: futureDate,
        reason: '无权账号不得纠错',
      },
    },
  );
  expect(deniedInternal.status()).toBe(403);
  await logout(page);

  const lawyerPage = await browser.newPage({
    baseURL: new URL(page.url()).origin,
  });
  try {
    const lawyerCsrf = await login(
      lawyerPage,
      '/lawyer/cases',
      primary.lawyer.username,
      primary.lawyer.password,
    );
    await lawyerPage.goto(`/lawyer/cases/${primary.caseId}`);
    const lawyerPanel = lawyerPage.locator('[data-test="case-hearing-panel"]');
    await expect(lawyerPanel).toBeVisible();
    await expect(
      lawyerPanel.locator('[data-test="hearing-correction-form"]'),
    ).toHaveCount(0);
    await expect(lawyerPanel).not.toContainText('法院来函确认原登记日期有误');
    const lawyerDetail = await lawyerPage.request.get(
      `/api/v1/lawyer/cases/${primary.caseId}`,
    );
    await expectStatus(lawyerDetail, 200);
    const deniedLawyerKey = randomUUID();
    const deniedLawyer = await lawyerPage.request.post(
      `/api/v1/cases/${primary.caseId}/hearing-correct`,
      {
        headers: {
          'X-CSRF-Token': lawyerCsrf,
          'Idempotency-Key': deniedLawyerKey,
        },
        data: {
          expectedVersion: (await lawyerDetail.json()).version as number,
          idempotencyKey: deniedLawyerKey,
          hearingAt: futureDate,
          reason: '律师账号不得纠错',
        },
      },
    );
    expect(deniedLawyer.status()).toBe(403);
    await logout(lawyerPage);
  } finally {
    await lawyerPage.close();
  }

  const clientPage = await browser.newPage({
    baseURL: new URL(page.url()).origin,
  });
  try {
    await login(
      clientPage,
      '/client/leads',
      primary.clientSession.user.username,
      'client correct horse battery',
    );
    const clientCasesNav = clientPage.locator('[data-test="client-case-nav"]');
    await expect(clientCasesNav).toBeVisible();
    await clientCasesNav.click();
    await expect(clientPage).toHaveURL(/\/client\/cases$/u);
    await clientPage.getByRole('button', { name: '已登记' }).click();
    await expect(clientPage).toHaveURL(/\/client\/cases\?view=RECORDED$/u);
    const ownCaseLink = clientPage.locator(
      `[data-test="client-case-list"] a[href="/client/cases/${primary.caseId}"]`,
    );
    await expect(ownCaseLink).toBeVisible();
    await ownCaseLink.click();
    await expect(clientPage).toHaveURL(`/client/cases/${primary.caseId}`);
    await expect(clientPage.getByText('待判决', { exact: true })).toBeVisible();
    await expect(
      clientPage.locator('[data-test="case-hearing-panel"]'),
    ).toHaveCount(0);
    await expect(
      clientPage.getByText('法院来函确认原登记日期有误'),
    ).toHaveCount(0);
    await logout(clientPage);
  } finally {
    await clientPage.close();
  }

  const foreignClientPage = await browser.newPage({
    baseURL: new URL(page.url()).origin,
  });
  try {
    await login(
      foreignClientPage,
      '/client/leads',
      foreignClient.username,
      foreignClient.password,
    );
    await foreignClientPage.goto(`/client/cases/${primary.caseId}`);
    await expect(
      foreignClientPage.getByRole('heading', {
        name: '案件不存在或已不可访问',
      }),
    ).toBeVisible();
    await logout(foreignClientPage);
  } finally {
    await foreignClientPage.close();
  }

  await login(
    page,
    '/cases',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await registerAcceptance(page, secondary.caseId, acceptedAt, '第二案');
  await logout(page);
  const secondaryLawyerPage = await browser.newPage({
    baseURL: new URL(page.url()).origin,
  });
  try {
    await login(
      secondaryLawyerPage,
      '/lawyer/cases',
      secondary.lawyer.username,
      secondary.lawyer.password,
    );
    await secondaryLawyerPage.goto(`/lawyer/cases/${secondary.caseId}`);
    const secondaryLawyerPanel = secondaryLawyerPage.locator(
      '[data-test="case-hearing-panel"]',
    );
    await expect(secondaryLawyerPanel).toBeVisible();
    await expect(
      secondaryLawyerPanel.locator('[data-test="hearing-schedule-form"]'),
    ).toBeVisible();
    await expect(
      secondaryLawyerPanel.locator('[data-test="hearing-correction-form"]'),
    ).toHaveCount(0);
    await secondaryLawyerPanel
      .locator('[data-test="hearing-date"]')
      .fill(acceptedAt);
    await expect(
      secondaryLawyerPanel.locator('[data-test="hearing-save"]'),
    ).toBeEnabled();
    const lawyerResult = await runHearingCommand(
      secondaryLawyerPage,
      secondary.caseId,
      'hearing-schedule',
      'WAITING_JUDGMENT',
      1,
      acceptedAt,
      'lawyer',
    );
    expect(lawyerResult.hearing.advances).toHaveLength(1);
    await logout(secondaryLawyerPage);
  } finally {
    await secondaryLawyerPage.close();
  }

  await login(
    page,
    '/cases',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await page.goto(`/cases/${secondary.caseId}`);
  await expect(page.locator('.page-head .pill')).toHaveText('待判决');
  await page.locator('[data-test="hearing-date"]').fill(acceptedAt);
  await page
    .locator('[data-test="hearing-correction-reason"]')
    .fill('法院再次確認該日期已到期');
  await runHearingCommand(
    page,
    secondary.caseId,
    'hearing-correct',
    'WAITING_JUDGMENT',
    1,
    acceptedAt,
  );
  await expect(page.locator('[data-test="case-hearing-panel"]')).toContainText(
    '法院再次確認該日期已到期',
  );
  await logout(page);
});
