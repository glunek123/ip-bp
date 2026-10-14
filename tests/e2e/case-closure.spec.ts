import {
  closeCaseWorkspaceDrawer,
  openCaseWorkspaceCommand,
} from '../support/case-workspace-browser.js';
import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  coreLeadFixtures,
  endCurrentLawyerAssignment,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';
import {
  clearCaseClosureFixture,
  createFinishedCaseClosureSourceThroughApi,
  setCaseClosureFixtureGrant,
} from '../support/case-closure-database.mjs';
import { clearCaseExecutionFinishFixture } from '../support/case-execution-finish-database.mjs';
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
import { clearCoreCaseSecondInstanceFixture } from '../support/case-second-instance-database.mjs';
import {
  clearCoreCaseHearingAdmin,
  clearCoreCaseHearingAdminSessions,
} from '../support/case-hearing-database.mjs';
import { disconnectCustomerTestDatabase } from '../support/customer-database.mjs';

type FileRef = {
  materialId: string;
  contentVersionId: string;
  originalFilename: string;
  mimeType: string;
};
type Version = {
  id: string;
  kind: 'REGISTER' | 'CORRECT';
  priorVersionId: string | null;
  fromVersion: number;
  toVersion: number;
  closeAt: string | null;
  closeAmountState: 'KNOWN' | 'PENDING';
  closeAmt: string | null;
  note: string | null;
  correctionReason?: string | null;
  files: FileRef[];
};
type Detail = {
  id: string;
  stage: string;
  version: number;
  courtCaseNo: string | null;
  canRecordClosure: boolean;
  canCorrectClosure: boolean;
  executionFinish: { id: string };
  executionFiling: unknown;
  executionSubmission: unknown;
  closure: null | {
    id: string;
    finishId: string;
    current: Version;
    history: Version[];
  };
};
type Receipt = {
  id: string;
  closureId: string;
  closureVersionId: string;
  finishId: string;
  stage: 'WAITING_ARCHIVE';
  version: number;
  recordedAt: string;
};
const bytes = Buffer.from(
  '%PDF-1.7\nCA016 synthetic exact closure document\n%%EOF\n',
);
const operator = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };

async function body<T>(
  response: { status(): number; json(): Promise<unknown> },
  status = 200,
): Promise<T> {
  expect(response.status()).toBe(status);
  return (await response.json()) as T;
}
async function read(
  request: APIRequestContext,
  caseId: string,
  lawyer = false,
): Promise<Detail> {
  return body<Detail>(
    await request.get(
      `/api/v1/${lawyer ? 'lawyer/' : ''}cases/${caseId}`,
      lawyer ? {} : { headers: operator },
    ),
  );
}
async function signIn(
  page: Page,
  path: string,
  username: string,
  password: string,
) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  const login = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/auth/login',
  );
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  const session = await body<{ csrfToken: string }>(await login);
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe(new URL(path, 'http://127.0.0.1:5174').pathname);
  return { 'X-CSRF-Token': session.csrfToken };
}
async function signOut(page: Page) {
  await closeCaseWorkspaceDrawer(page);
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/u);
}
async function clean() {
  await clearCaseClosureFixture();
  await clearCaseExecutionFinishFixture();
  await clearCoreCaseHearingAdminSessions();
  await clearCaseAcceptanceFault();
  await clearCoreCaseSecondInstanceFixture();
  await clearCaseAcceptanceFixture();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
  await resetCoreLeadE2eData();
  await clearCoreCaseHearingAdmin();
}
test.beforeEach(async () => {
  await clean();
  await prepareCaseFilingFixture();
  await prepareCaseAcceptanceFixture();
  await allowOtherEnterpriseAccountSetup();
});
test.afterEach(clean);
test.afterAll(disconnectCustomerTestDatabase);

test('operator records unknown closure date and pending amount, appends a reason correction with exact bytes, and client remains minimal', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const source = await createFinishedCaseClosureSourceThroughApi(request);
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleA,
    'case.closure.record',
    'TEAM',
  );
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleA,
    'case.closure.correct',
    'TEAM',
  );
  const before = await read(request, source.caseId);
  expect(before.closure).toBeNull();
  expect(before).not.toHaveProperty('displaySummary');
  await signIn(
    page,
    `/cases/${source.caseId}`,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await openCaseWorkspaceCommand(
    page,
    'closure',
    '[data-test="closure-panel"]',
  );
  const panel = page.locator('[data-test="closure-panel"]');
  await expect(panel.locator('[data-test="closure-form"]')).toBeVisible();
  await expect(panel.locator('[data-test="closure-date"]')).toHaveValue('');
  await expect(panel.locator('[data-test="closure-amount-state"]')).toHaveValue(
    'PENDING',
  );
  await expect(panel.locator('[data-test="closure-amount"]')).toHaveCount(0);
  const first = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/cases/${source.caseId}/closure`,
  );
  await panel.locator('[data-test="closure-submit"]').click();
  const response = await first;
  const receipt = await body<Receipt>(response, 201);
  const input = response.request().postDataJSON() as Record<string, unknown>;
  expect(input).toMatchObject({
    expectedVersion: before.version,
    expectedFinishId: source.finished.finishId,
    closeAt: null,
    closeAmountState: 'PENDING',
    closeAmt: null,
    note: null,
    closeContentVersionIds: [],
  });
  expect(receipt).toMatchObject({
    id: source.caseId,
    finishId: source.finished.finishId,
    stage: 'WAITING_ARCHIVE',
    version: before.version + 1,
  });
  let detail = await read(request, source.caseId);
  expect(detail.closure?.current).toMatchObject({
    id: receipt.closureVersionId,
    kind: 'REGISTER',
    priorVersionId: null,
    closeAt: null,
    closeAmountState: 'PENDING',
    closeAmt: null,
    files: [],
  });
  expect(detail.executionFinish).toEqual(before.executionFinish);
  expect(detail.executionFiling).toEqual(before.executionFiling);
  expect(detail.executionSubmission).toEqual(before.executionSubmission);
  await page.reload();
  await openCaseWorkspaceCommand(
    page,
    'closure',
    '[data-test="closure-panel"]',
  );

  await expect(panel.locator('[data-test="closure-current"]')).toContainText(
    '未知',
  );
  await expect(panel.locator('[data-test="closure-current"]')).toContainText(
    '待定',
  );
  await expect(panel).toContainText('案件实收：未登记');
  await expect(panel).not.toContainText('已结清');
  await expect(panel).not.toContainText('未结清');
  await panel.locator('[data-test="closure-correct"]').click();
  await panel
    .locator('[data-test="closure-amount-state"]')
    .selectOption('KNOWN');
  await panel.locator('[data-test="closure-amount"]').fill('0.00');
  await panel
    .locator('[data-test="closure-note"]')
    .fill('真实零结案额，独立于判决和收款。');
  await panel
    .locator('[data-test="closure-reason"]')
    .fill('补充核实结案资料，保留首次待定记录。');
  const upload = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      /\/api\/v1\/materials\/upload-drafts\/[^/]+\/content$/u.test(
        new URL(response.url()).pathname,
      ),
  );
  await panel.locator('[data-test="closure-upload"]').setInputFiles({
    name: 'closure-exact.pdf',
    mimeType: 'application/pdf',
    buffer: bytes,
  });
  await body(await upload, 200);
  await expect(
    panel.locator('[data-test="closure-choice"]').first(),
  ).toBeVisible();
  if (
    !(await panel.locator('[data-test="closure-choice"]').first().isChecked())
  )
    await panel.locator('[data-test="closure-choice"]').first().check();
  const correction = page.waitForResponse(
    (result) =>
      result.request().method() === 'POST' &&
      new URL(result.url()).pathname ===
        `/api/v1/cases/${source.caseId}/closure-correction`,
  );
  await panel.locator('[data-test="closure-submit"]').click();
  const corrected = await body<Receipt>(await correction, 201);
  detail = await read(request, source.caseId);
  expect(detail.stage).toBe('WAITING_ARCHIVE');
  expect(detail.closure?.history).toHaveLength(2);
  expect(detail.closure?.history[0]).toMatchObject({
    id: receipt.closureVersionId,
    closeAt: null,
    closeAmountState: 'PENDING',
    closeAmt: null,
  });
  expect(detail.closure?.current).toMatchObject({
    id: corrected.closureVersionId,
    priorVersionId: receipt.closureVersionId,
    kind: 'CORRECT',
    closeAmountState: 'KNOWN',
    closeAmt: '0.00',
    correctionReason: '补充核实结案资料，保留首次待定记录。',
  });
  const file = detail.closure?.current.files[0];
  expect(file).toBeDefined();
  if (!file) throw new Error('Closure exact version missing');
  const downloaded = await request.get(
    `/api/v1/materials/${file.materialId}/versions/${file.contentVersionId}/content`,
    { headers: operator },
  );
  expect(downloaded.status()).toBe(200);
  expect(Buffer.from(await downloaded.body()).equals(bytes)).toBe(true);
  await signOut(page);
  await signIn(
    page,
    `/cases/${source.caseId}`,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await openCaseWorkspaceCommand(
    page,
    'closure',
    '[data-test="closure-panel"]',
  );
  await expect(panel.locator('[data-test="closure-current"]')).toContainText(
    '0.00',
  );
  await panel.locator('[data-test="closure-history"] summary').click();
  await expect(
    panel.locator('[data-test="closure-history-version"]'),
  ).toHaveCount(2);
  await signOut(page);
  await signIn(
    page,
    `/lawyer/cases/${source.caseId}`,
    source.lawyer.username,
    source.lawyer.password,
  );
  const lawyerHistory = await read(page.request, source.caseId, true);
  expect(lawyerHistory.closure?.history).toHaveLength(2);
  for (const version of lawyerHistory.closure!.history) {
    expect(version).not.toHaveProperty('recordedByUserId');
    expect(version).not.toHaveProperty('correctionReason');
  }
  expect(lawyerHistory.closure!.current.id).toBe(corrected.closureVersionId);
  expect(lawyerHistory.closure!.current.files).toEqual([file]);
  expect(lawyerHistory.closure!.history[0]!.files).toEqual([]);
  expect(lawyerHistory.closure!.history[1]!.files).toEqual([file]);
  const lawyerFile = lawyerHistory.closure!.current.files[0]!;
  const lawyerBytes = await page.request.get(
    `/api/v1/materials/${lawyerFile.materialId}/versions/${lawyerFile.contentVersionId}/content`,
  );
  expect(lawyerBytes.status()).toBe(200);
  expect(Buffer.from(await lawyerBytes.body()).equals(bytes)).toBe(true);
  await signOut(page);
  await signIn(
    page,
    `/client/cases/${source.caseId}`,
    source.client.username,
    source.client.password,
  );
  const client = await body<Record<string, unknown>>(
    await page.request.get(`/api/v1/client/cases/${source.caseId}`),
  );
  for (const key of [
    'closure',
    'displaySummary',
    'canRecordClosure',
    'canCorrectClosure',
    'closeAmt',
    'correctionReason',
    'audit',
  ])
    expect(client).not.toHaveProperty(key);
  expect(client.stage).toBe('WAITING_ARCHIVE');
  await expect(page.locator('[data-test="closure-panel"]')).toHaveCount(0);
  const clientDownload = await page.request.get(
    `/api/v1/materials/${file.materialId}/versions/${file.contentVersionId}/content`,
  );
  expect([403, 404]).toContain(clientDownload.status());
});

test('current primary lawyer records real zero with unknown date and cannot perform internal closure correction', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const source = await createFinishedCaseClosureSourceThroughApi(request);
  const csrf = await signIn(
    page,
    `/lawyer/cases/${source.caseId}`,
    source.lawyer.username,
    source.lawyer.password,
  );
  await openCaseWorkspaceCommand(
    page,
    'closure',
    '[data-test="closure-panel"]',
  );
  const panel = page.locator('[data-test="closure-panel"]');
  await expect(panel.locator('[data-test="closure-form"]')).toBeVisible();
  await panel
    .locator('[data-test="closure-amount-state"]')
    .selectOption('KNOWN');
  await panel.locator('[data-test="closure-amount"]').fill('0.00');
  await panel
    .locator('[data-test="closure-note"]')
    .fill('当前承办律师记录真实结案资料，不声明结清。');
  const posted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/lawyer/cases/${source.caseId}/closure`,
  );
  await panel.locator('[data-test="closure-submit"]').click();
  const postedResponse = await posted;
  const originalInput = postedResponse.request().postDataJSON() as Record<
    string,
    unknown
  >;
  const receipt = await body<Receipt>(postedResponse, 201);
  const detail = await read(page.request, source.caseId, true);
  expect(detail.closure?.current).toMatchObject({
    closeAt: null,
    closeAmountState: 'KNOWN',
    closeAmt: '0.00',
    files: [],
  });
  expect(detail.canCorrectClosure).toBe(false);
  expect(detail.closure?.current).not.toHaveProperty('recordedByUserId');
  expect(detail.closure?.current).not.toHaveProperty('correctionReason');
  await expect(panel.locator('[data-test="closure-correct"]')).toHaveCount(0);
  const refusal = await page.request.post(
    `/api/v1/cases/${source.caseId}/closure-correction`,
    {
      headers: csrf,
      data: {
        expectedVersion: receipt.version,
        idempotencyKey: randomUUID(),
        expectedFinishId: source.finished.finishId,
        expectedClosureVersionId: receipt.closureVersionId,
        closeAt: null,
        closeAmountState: 'KNOWN',
        closeAmt: '0.00',
        note: null,
        closeContentVersionIds: [],
        correctionReason: '不应获准的律师更正',
      },
    },
  );
  expect(refusal.status()).toBe(403);
  await page.reload();
  await openCaseWorkspaceCommand(
    page,
    'closure',
    '[data-test="closure-panel"]',
  );

  await expect(panel.locator('[data-test="closure-current"]')).toContainText(
    '0.00',
  );
  await endCurrentLawyerAssignment(
    source.caseId,
    source.lawyer.profiles[0]!.profileId,
  );
  const revokedReplay = await page.request.post(
    `/api/v1/lawyer/cases/${source.caseId}/closure`,
    { headers: csrf, data: originalInput },
  );
  expect(revokedReplay.status()).toBe(403);
  const preserved = await read(request, source.caseId);
  expect(preserved.closure?.history).toHaveLength(1);
  expect(preserved.closure?.current.id).toBe(receipt.closureVersionId);
});

test('lost closure success keeps the exact original request through refresh and SPA remount, then one explicit replay succeeds', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const source = await createFinishedCaseClosureSourceThroughApi(request);
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleA,
    'case.closure.record',
    'TEAM',
  );
  await signIn(
    page,
    `/cases/${source.caseId}`,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  const endpoint = `/api/v1/cases/${source.caseId}/closure`;
  const requests: unknown[] = [];
  await page.route(`**${endpoint}`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) {
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      await route.abort('failed');
    } else await route.continue();
  });
  await openCaseWorkspaceCommand(
    page,
    'closure',
    '[data-test="closure-panel"]',
  );
  const panel = page.locator('[data-test="closure-panel"]');
  await panel
    .locator('[data-test="closure-note"]')
    .fill('保留原键和原输入，不从读取推定本请求成功。');
  await panel.locator('[data-test="closure-submit"]').click();
  await expect(
    panel.locator('[data-test="closure-pending-summary"]'),
  ).toContainText('保留原键和原输入');
  await panel.locator('[data-test="closure-refresh"]').click();
  await expect(panel.locator('[data-test="closure-current"]')).toContainText(
    '保留原键和原输入',
  );
  await expect(panel.locator('[data-test="closure-retry"]')).toBeVisible();
  await closeCaseWorkspaceDrawer(page);
  await page.locator('[data-test="case-nav"]').click();
  const link = page
    .locator(`[data-test="case-list"] a[href^="/cases/${source.caseId}"]`)
    .first();
  await expect(link).toBeVisible();
  await link.click();
  expect(requests).toHaveLength(1);
  await openCaseWorkspaceCommand(
    page,
    'closure',
    '[data-test="closure-panel"]',
  );
  await expect(panel.locator('[data-test="closure-retry"]')).toBeVisible();
  const replay = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === endpoint,
  );
  await panel.locator('[data-test="closure-retry"]').click();
  await body(await replay, 201);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  const final = await read(request, source.caseId);
  expect(final.closure?.history).toHaveLength(1);
  expect(final.closure?.current.note).toBe(
    '保留原键和原输入，不从读取推定本请求成功。',
  );
});
