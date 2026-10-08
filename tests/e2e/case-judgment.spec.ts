import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
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
const originalBytes = Buffer.from(
  '%PDF-1.4\nCA008 original judgment bytes\n%%EOF\n',
);
const correctionBytes = Buffer.from(
  '%PDF-1.4\nCA008 corrected judgment bytes\n%%EOF\n',
);
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
  const shifted = past.toISOString().slice(0, 10);
  return shifted > '2026-09-28' ? shifted : '2026-09-28';
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
      data: originalBytes,
    },
  );
  await expectStatus(result, 200);
  return (await result.json()).contentVersionId as string;
}

async function createOtherEnterpriseClient(
  request: APIRequestContext,
): Promise<{ username: string; password: string }> {
  const username = `ca008-foreign-${randomUUID().slice(0, 8)}`;
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
      data: { displayName: 'CA-008其他企业客户', username, password },
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
      data: { name: `CA008法院-${randomUUID().slice(0, 8)}` },
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

async function browserUpload(
  page: Page,
  caseId: string,
  category: 'ACCEPTANCE_NOTICE',
  filename: string,
  bytes: Buffer,
  csrf: string,
): Promise<string> {
  const draft = await page.request.post('/api/v1/materials/upload-drafts', {
    headers: {
      Origin: new URL(page.url()).origin,
      'X-CSRF-Token': csrf,
    },
    data: {
      ownerType: 'CASE',
      ownerId: caseId,
      category,
      purpose: category,
      originalFilename: filename,
      declaredMimeType: 'application/pdf',
    },
  });
  await expectStatus(draft, 201);
  const draftId = (await draft.json()).id as string;
  const uploaded = await page.request.put(
    `/api/v1/materials/upload-drafts/${draftId}/content`,
    {
      headers: {
        Origin: new URL(page.url()).origin,
        'X-CSRF-Token': csrf,
        'Content-Type': 'application/octet-stream',
      },
      data: bytes,
    },
  );
  await expectStatus(uploaded, 200);
  return (await uploaded.json()).contentVersionId as string;
}

async function prepareWaitingJudgment(
  page: Page,
  caseId: string,
  acceptedAt: string,
  operatorCsrf: string,
  lawyer: { username: string; password: string },
): Promise<void> {
  const acceptanceNotice = await browserUpload(
    page,
    caseId,
    'ACCEPTANCE_NOTICE',
    `CA008-受理通知书-${randomUUID().slice(0, 6)}.pdf`,
    originalBytes,
    operatorCsrf,
  );
  const internalDetail = await page.request.get(`/api/v1/cases/${caseId}`);
  await expectStatus(internalDetail, 200);
  const version = (await internalDetail.json()).version as number;
  const accepted = await page.request.post(
    `/api/v1/cases/${caseId}/acceptance-register`,
    {
      headers: {
        Origin: new URL(page.url()).origin,
        'X-CSRF-Token': operatorCsrf,
      },
      data: {
        expectedVersion: version,
        idempotencyKey: randomUUID(),
        acceptedAt,
        courtCaseNo: `（2026）甲0101民初${randomUUID().slice(0, 6)}号`,
        acceptanceNoticeContentVersionIds: [acceptanceNotice],
      },
    },
  );
  await expectStatus(accepted, 201);

  await logout(page);
  const lawyerCsrf = await login(
    page,
    '/lawyer/cases',
    lawyer.username,
    lawyer.password,
  );
  const prefix = `/api/v1/lawyer/cases/${caseId}`;
  const lawyerDetail = await page.request.get(prefix);
  await expectStatus(lawyerDetail, 200);
  const lawyerVersion = (await lawyerDetail.json()).version as number;
  const scheduled = await page.request.post(`${prefix}/hearing-schedule`, {
    headers: {
      Origin: new URL(page.url()).origin,
      'X-CSRF-Token': lawyerCsrf,
    },
    data: {
      expectedVersion: lawyerVersion,
      idempotencyKey: randomUUID(),
      hearingAt: acceptedAt,
    },
  });
  await expectStatus(scheduled, 201);
  await expect
    .poll(async () => {
      const judgmentStage = await page.request.get(prefix);
      if (judgmentStage.status() !== 200) return null;
      return (await judgmentStage.json()).stage as string;
    })
    .toBe('WAITING_JUDGMENT');
  await logout(page);
}

async function downloadBytes(page: Page, button: Locator): Promise<Buffer> {
  const downloadEvent = page.waitForEvent('download');
  await button.click();
  const download = await downloadEvent;
  const path = await download.path();
  if (!path) throw new Error('Judgment material download has no local file');
  return readFile(path);
}

let judgmentAdmin: { username: string; password: string };

test.beforeEach(async () => {
  await clearCoreCaseHearingAdminSessions();
  await clearCaseAcceptanceFault();
  await clearCaseAcceptanceFixture();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
  await resetCoreLeadE2eData();
  await clearCoreCaseHearingAdmin();
  judgmentAdmin = await prepareCoreCaseHearingAdmin();
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

test('operator registers, corrects, and downloads immutable judgment facts', async ({
  page,
  request,
  browser,
}) => {
  const acceptedAt = pastWorkflowDate();
  const primary = await waitingFormal(request, acceptedAt);
  await login(
    page,
    '/settings/people-access',
    judgmentAdmin.username,
    judgmentAdmin.password,
  );
  const contextBefore = await page.request.get(
    '/api/v1/organization/management-context',
  );
  await expectStatus(contextBefore, 200);
  const rolesBefore = (await contextBefore.json()) as {
    roles: Array<{
      id: string;
      grants: Array<{ action: string; scope: string }>;
    }>;
  };
  const roleBefore = rolesBefore.roles.find(
    (role) => role.id === coreLeadFixtures.roleA,
  );
  if (!roleBefore) throw new Error('CORE TEAM role missing before edit');
  const originalGrants = roleBefore.grants;
  const roleEditor = page.locator(
    `[data-test="edit-role-${coreLeadFixtures.roleA}"]`,
  );
  await expect(roleEditor).toBeVisible();
  await roleEditor.click();
  const editor = page.getByRole('dialog', { name: 'CORE TEAM' });
  for (const action of ['CASE_JUDGMENT_REGISTER', 'CASE_JUDGMENT_CORRECT']) {
    await editor.locator(`[data-test="grant-${action}"]`).check();
    await editor.locator(`[data-test="scope-${action}"]`).selectOption('TEAM');
  }
  const refreshedContext = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname ===
        '/api/v1/organization/management-context',
  );
  await editor.getByRole('button', { name: '保存模板' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectStatus(await refreshedContext, 200);
  const after = (await (
    await page.request.get('/api/v1/organization/management-context')
  ).json()) as {
    roles: Array<{
      id: string;
      grants: Array<{ action: string; scope: string }>;
    }>;
  };
  const roleAfter = after.roles.find(
    (role) => role.id === coreLeadFixtures.roleA,
  );
  if (!roleAfter) throw new Error('CORE TEAM role missing after edit');
  const scopeRank = { SELF: 1, TEAM: 2, DEPARTMENT: 3 } as const;
  expect(
    originalGrants.filter(
      (grant) =>
        !roleAfter.grants.some(
          (saved) =>
            saved.action === grant.action &&
            scopeRank[saved.scope as keyof typeof scopeRank] >=
              scopeRank[grant.scope as keyof typeof scopeRank],
        ),
    ),
  ).toEqual([]);
  expect(roleAfter.grants).toEqual(
    expect.arrayContaining([
      { action: 'CASE_JUDGMENT_REGISTER', scope: 'TEAM' },
      { action: 'CASE_JUDGMENT_CORRECT', scope: 'TEAM' },
    ]),
  );
  await logout(page);

  const operatorCsrf = await login(
    page,
    '/cases',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await prepareWaitingJudgment(
    page,
    primary.caseId,
    acceptedAt,
    operatorCsrf,
    primary.lawyer,
  );
  await login(
    page,
    '/cases',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await page.goto(`/cases/${primary.caseId}`);
  const panel = page.locator('[data-test="case-judgment-panel"]');
  await expect(panel).toBeVisible();
  const originalFilename = '一审判决原件.pdf';
  const frozenFilenames = [
    originalFilename,
    ...Array.from(
      { length: 9 },
      (_, index) => `一审判决历史-${String(index + 2).padStart(2, '0')}.pdf`,
    ),
  ];
  await panel.locator('[data-test="judgment-file-input"]').setInputFiles(
    frozenFilenames.map((name, index) => ({
      name,
      mimeType: 'application/pdf',
      buffer: index === 0 ? originalBytes : correctionBytes,
    })),
  );
  for (const filename of frozenFilenames)
    await expect(panel.getByText(filename)).toBeVisible();
  for (const filename of frozenFilenames)
    await panel.getByLabel(filename).check();
  await panel.locator('[data-test="judgment-date"]').fill(acceptedAt);
  await panel
    .locator('[data-test="judgment-amount-state"]')
    .selectOption('KNOWN');
  await panel.locator('[data-test="judgment-amount"]').fill('0.00');
  await panel.locator('[data-test="paid-fee-state"]').selectOption('PENDING');
  await expect(
    panel.locator('[data-test="judgment-review-summary"]'),
  ).toContainText('判决金额：已知 0.00 元');
  await expect(
    panel.locator('[data-test="judgment-review-summary"]'),
  ).toContainText('实缴诉讼费：待定');
  const registration = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/cases/${primary.caseId}/judgment-register`,
  );
  await panel.locator('[data-test="judgment-submit"]').click();
  await expectStatus(await registration, 201);
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/v1/cases/${primary.caseId}`,
      );
      if (response.status() !== 200) return null;
      const detail = (await response.json()) as {
        stage: string;
        judgment: {
          current: {
            judgmentAmount: string | null;
            paidLitigationFee: string | null;
          } | null;
        };
      };
      return {
        stage: detail.stage,
        amount: detail.judgment.current?.judgmentAmount,
        fee: detail.judgment.current?.paidLitigationFee,
      };
    })
    .toEqual({ stage: 'WAITING_JUDGMENT', amount: '0.00', fee: null });
  await expect(panel.getByRole('status')).toContainText('判决命令已受理');
  await page.reload();
  await expect(page.locator('.page-head .pill')).toHaveText('待判决');
  await expect(panel.locator('[data-test="judgment-current"]')).toContainText(
    originalFilename,
  );
  const currentOriginal = panel
    .locator('[data-test="judgment-current"] li')
    .filter({ hasText: originalFilename })
    .getByRole('button', { name: '下载判决书' });
  expect(await downloadBytes(page, currentOriginal)).toEqual(originalBytes);

  const correctionFilename = '一审判决更正版本.pdf';
  await expect(
    panel.locator('[data-test="judgment-file-input"]'),
  ).toBeEnabled();
  await panel.locator('[data-test="judgment-file-input"]').setInputFiles({
    name: correctionFilename,
    mimeType: 'application/pdf',
    buffer: correctionBytes,
  });
  await expect(panel.getByText(correctionFilename)).toBeVisible();
  for (const filename of frozenFilenames.slice(1))
    await panel.getByLabel(filename).check();
  await panel.getByLabel(correctionFilename).check();
  await panel
    .locator('[data-test="judgment-correction-reason"]')
    .fill('法院送达的补正文书确认原金额需要更正');
  await expect(
    panel.locator('[data-test="judgment-review-summary"]'),
  ).toContainText('更正后案件仍为待判决');
  await panel.locator('[data-test="judgment-amount"]').fill('42.50');
  await panel.locator('[data-test="paid-fee-state"]').selectOption('KNOWN');
  await panel.locator('[data-test="paid-fee-amount"]').fill('8.00');
  const correction = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/cases/${primary.caseId}/judgment-correct`,
  );
  await panel.locator('[data-test="judgment-correct"]').click();
  await expectStatus(await correction, 201);
  const internalDetail = await page.request.get(
    `/api/v1/cases/${primary.caseId}`,
  );
  await expectStatus(internalDetail, 200);
  await expect(panel.getByRole('status')).toContainText('判决命令已受理');
  const judgment = (await internalDetail.json()) as {
    stage: string;
    judgment: {
      current: { judgmentAmount: string | null };
      history: Array<{
        kind: 'REGISTER' | 'CORRECT';
        reason?: string | null;
        files: Array<{
          contentVersionId: string;
          originalFilename: string;
        }>;
      }>;
    };
  };
  expect(judgment.stage).toBe('WAITING_JUDGMENT');
  expect(judgment.judgment.current.judgmentAmount).toBe('42.50');
  expect(judgment.judgment.history).toHaveLength(2);
  const registeredFiles = judgment.judgment.history.find(
    (entry) => entry.kind === 'REGISTER',
  )!.files;
  const correctedFiles = judgment.judgment.history.find(
    (entry) => entry.kind === 'CORRECT',
  )!.files;
  expect(registeredFiles).toHaveLength(10);
  expect(correctedFiles).toHaveLength(10);
  expect(correctedFiles.map((entry) => entry.contentVersionId)).toEqual(
    expect.arrayContaining(
      registeredFiles
        .filter((entry) => entry.originalFilename !== originalFilename)
        .map((entry) => entry.contentVersionId),
    ),
  );
  expect(judgment.judgment.history).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'REGISTER',
        reason: null,
        files: expect.arrayContaining([
          expect.objectContaining({ originalFilename }),
        ]),
      }),
      expect.objectContaining({
        kind: 'CORRECT',
        reason: '法院送达的补正文书确认原金额需要更正',
        files: expect.arrayContaining([
          expect.objectContaining({ originalFilename: correctionFilename }),
        ]),
      }),
    ]),
  );
  await page.reload();
  await expect(panel.locator('[data-test="judgment-history"]')).toContainText(
    '法院送达的补正文书确认原金额需要更正',
  );
  await panel.locator('[data-test="judgment-history"] summary').click();
  await expect(panel.locator('[data-test="judgment-current"]')).toContainText(
    correctionFilename,
  );
  const historicalOriginal = panel
    .locator('[data-test="judgment-history"] ul.notary-offices-list > li')
    .filter({ hasText: originalFilename })
    .getByRole('button', { name: '下载判决书' });
  expect(await downloadBytes(page, historicalOriginal)).toEqual(originalBytes);
  const currentCorrection = panel
    .locator('[data-test="judgment-current"] li')
    .filter({ hasText: correctionFilename })
    .getByRole('button', { name: '下载判决书' });
  expect(await downloadBytes(page, currentCorrection)).toEqual(correctionBytes);
  await logout(page);
  await login(
    page,
    '/cases',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await page.goto(`/cases/${primary.caseId}`);
  await expect(page.locator('[data-test="judgment-history"]')).toContainText(
    '法院送达的补正文书确认原金额需要更正',
  );
  await logout(page);
  const lawyerPage = await browser.newPage({
    baseURL: new URL(page.url()).origin,
  });
  try {
    await login(
      lawyerPage,
      '/lawyer/cases',
      primary.lawyer.username,
      primary.lawyer.password,
    );
    await lawyerPage.goto(`/lawyer/cases/${primary.caseId}`);
    const lawyerPanel = lawyerPage.locator('[data-test="case-judgment-panel"]');
    await expect(lawyerPanel).toBeVisible();
    await expect(
      lawyerPanel.locator('[data-test="judgment-current"]'),
    ).toContainText('判决金额：已知 42.50');
    await expect(
      lawyerPanel.locator('[data-test="judgment-history"]'),
    ).toContainText('受控更正');
    await expect(lawyerPanel).not.toContainText(
      '法院送达的补正文书确认原金额需要更正',
    );
    const lawyerDetail = await lawyerPage.request.get(
      `/api/v1/lawyer/cases/${primary.caseId}`,
    );
    await expectStatus(lawyerDetail, 200);
    const redactedCorrection = (await lawyerDetail.json()) as {
      canCorrectJudgment: boolean;
      judgment: {
        current: Record<string, unknown>;
        history: Array<Record<string, unknown>>;
      };
    };
    expect(redactedCorrection.canCorrectJudgment).toBe(false);
    expect(redactedCorrection.judgment.current.kind).toBe('CORRECT');
    expect(redactedCorrection.judgment.current).not.toHaveProperty('reason');
    expect(redactedCorrection.judgment.current).not.toHaveProperty(
      'recordedByUserId',
    );
    expect(redactedCorrection.judgment.history).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'CORRECT' })]),
    );
    for (const fact of redactedCorrection.judgment.history) {
      expect(fact).not.toHaveProperty('reason');
      expect(fact).not.toHaveProperty('recordedByUserId');
    }
    await logout(lawyerPage);
  } finally {
    await lawyerPage.close();
  }
});

test('primary lawyer registers through a real session; clients see no judgment materials', async ({
  page,
  request,
  browser,
}) => {
  const acceptedAt = pastWorkflowDate();
  const secondary = await waitingFormal(request, acceptedAt, true);
  const operatorCsrf = await login(
    page,
    '/cases',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await prepareWaitingJudgment(
    page,
    secondary.caseId,
    acceptedAt,
    operatorCsrf,
    secondary.lawyer,
  );
  const foreignClient = await createOtherEnterpriseClient(request);
  const lawyerPage = await browser.newPage({
    baseURL: new URL(page.url()).origin,
  });
  try {
    await login(
      lawyerPage,
      '/lawyer/cases',
      secondary.lawyer.username,
      secondary.lawyer.password,
    );
    await lawyerPage.goto(`/lawyer/cases/${secondary.caseId}`);
    const lawyerPanel = lawyerPage.locator('[data-test="case-judgment-panel"]');
    await expect(lawyerPanel).toBeVisible();
    await expect(
      lawyerPanel.locator('[data-test="judgment-correction-form"]'),
    ).toHaveCount(0);
    const lawyerFilename = '承办律师登记判决.pdf';
    await lawyerPanel
      .locator('[data-test="judgment-file-input"]')
      .setInputFiles({
        name: lawyerFilename,
        mimeType: 'application/pdf',
        buffer: originalBytes,
      });
    await expect(lawyerPanel.getByText(lawyerFilename)).toBeVisible();
    await lawyerPanel.locator('[data-test="judgment-date"]').fill(acceptedAt);
    await lawyerPanel
      .locator('[data-test="judgment-amount-state"]')
      .selectOption('PENDING');
    await lawyerPanel
      .locator('[data-test="paid-fee-state"]')
      .selectOption('KNOWN');
    await lawyerPanel.locator('[data-test="paid-fee-amount"]').fill('0.00');
    const lawyerRegister = lawyerPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname ===
          `/api/v1/lawyer/cases/${secondary.caseId}/judgment-register`,
    );
    await lawyerPanel.locator('[data-test="judgment-submit"]').click();
    await expectStatus(await lawyerRegister, 201);
    await expect(lawyerPanel).not.toContainText('更正原因');
    const lawyerDetail = await lawyerPage.request.get(
      `/api/v1/lawyer/cases/${secondary.caseId}`,
    );
    await expectStatus(lawyerDetail, 200);
    const lawyerProjection = (await lawyerDetail.json()) as {
      canCorrectJudgment: boolean;
      judgment: {
        current: Record<string, unknown>;
        history: Array<Record<string, unknown>>;
      };
    };
    expect(lawyerProjection.canCorrectJudgment).toBe(false);
    expect(lawyerProjection.judgment.current).not.toHaveProperty('reason');
    expect(lawyerProjection.judgment.current).not.toHaveProperty(
      'recordedByUserId',
    );
    expect(lawyerProjection.judgment.history[0]).not.toHaveProperty('reason');
    expect(lawyerProjection.judgment.history[0]).not.toHaveProperty(
      'recordedByUserId',
    );
    await logout(lawyerPage);

    const clientPage = await browser.newPage({
      baseURL: new URL(page.url()).origin,
    });
    try {
      await login(
        clientPage,
        '/client/leads',
        secondary.clientSession.user.username,
        'client correct horse battery',
      );
      await clientPage.locator('[data-test="client-case-nav"]').click();
      await expect(clientPage).toHaveURL(/\/client\/cases$/u);
      await clientPage.getByRole('button', { name: '已登记' }).click();
      const ownCase = clientPage.locator(
        `[data-test="client-case-list"] a[href="/client/cases/${secondary.caseId}"]`,
      );
      await expect(ownCase).toBeVisible();
      await ownCase.click();
      await expect(clientPage).toHaveURL(`/client/cases/${secondary.caseId}`);
      await expect(
        clientPage.getByText('待判决', { exact: true }),
      ).toBeVisible();
      await expect(
        clientPage.locator('[data-test="case-judgment-panel"]'),
      ).toHaveCount(0);
      await expect(clientPage.getByText(lawyerFilename)).toHaveCount(0);
      await expect(clientPage.getByText('0.00')).toHaveCount(0);
      await logout(clientPage);
    } finally {
      await clientPage.close();
    }
  } finally {
    await lawyerPage.close();
  }

  const foreignPage = await browser.newPage({
    baseURL: new URL(page.url()).origin,
  });
  try {
    await login(
      foreignPage,
      '/client/leads',
      foreignClient.username,
      foreignClient.password,
    );
    await foreignPage.goto(`/client/cases/${secondary.caseId}`);
    await expect(
      foreignPage.getByRole('heading', { name: '案件不存在或已不可访问' }),
    ).toBeVisible();
    await logout(foreignPage);
  } finally {
    await foreignPage.close();
  }
});
