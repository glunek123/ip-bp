import {
  closeCaseWorkspaceDrawer,
  openCaseWorkspaceCommand,
  revealCaseWorkspaceSection,
} from '../support/case-workspace-browser.js';
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
import { clearCaseExecutionFinishFixture } from '../support/case-execution-finish-database.mjs';
import { createCaseExecutionFilingSourceThroughApi } from '../support/case-execution-filing-database.mjs';
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
import { verifyExecutionFinishMigration } from '../support/case-execution-finish-migration.mjs';

const basisBytes = Buffer.from(
  '%PDF-1.7\nCA015 synthetic execution finish basis bytes\n%%EOF\n',
);
const todayShanghai = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

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
): Promise<void> {
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
  const expectedUrl = new URL(path, 'http://127.0.0.1:5174');
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe(expectedUrl.pathname);
  for (const [name, value] of expectedUrl.searchParams)
    await expect
      .poll(() => new URL(page.url()).searchParams.get(name))
      .toBe(value);
  await status(await responsePromise, 200);
}

async function logout(page: Page) {
  await closeCaseWorkspaceDrawer(page);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/auth/logout',
  );
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await status(await responsePromise, 204);
  await expect(page).toHaveURL(/\/login$/u);
}

async function uploadResponseBytes(page: Page, filename: string) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page
      .locator('[data-test="execution-finish-panel"]')
      .locator('li')
      .filter({ hasText: filename })
      .getByRole('button', { name: '下载' })
      .click(),
  ]);
  const path = await download.path();
  if (path === null)
    throw new Error('Browser did not save the basis attachment');
  return readFile(path);
}

let admin: { username: string; password: string };
test.beforeEach(async () => {
  await clearCaseExecutionFinishFixture();
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
  await clearCaseExecutionFinishFixture();
  await clearCaseAcceptanceFault();
  await clearCoreCaseSecondInstanceFixture();
  await clearCaseAcceptanceFixture();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
  await resetCoreLeadE2eData();
  await clearCoreCaseHearingAdmin();
});

test.afterAll(async () => disconnectCustomerTestDatabase());

async function grantFinishActionToExistingRoleA(page: Page) {
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
    'CASE_EXECUTION_FINISH',
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

async function executionFinishDetail(
  request: APIRequestContext,
  caseId: string,
  lawyer = false,
) {
  const endpoint = lawyer
    ? `/api/v1/lawyer/cases/${caseId}`
    : `/api/v1/cases/${caseId}`;
  const response = await request.get(endpoint);
  await status(response, 200);
  return (await response.json()) as Record<string, unknown>;
}

async function verifyDocumentGroupNavigation(
  page: Page,
  caseId: string,
  group: 'COMPLAINT_PREPARATION' | 'EXECUTION_PREPARATION',
  atomicStage: string,
) {
  const selector =
    group === 'COMPLAINT_PREPARATION'
      ? 'complaint-preparation-stage'
      : 'execution-preparation-stage';
  const stages =
    group === 'COMPLAINT_PREPARATION'
      ? [
          'WAITING_COMPLAINT',
          'WAITING_COMPLAINT_CONFIRMATION',
          'WAITING_COMPLAINT_STAMP',
        ]
      : [
          'WAITING_EXECUTION_DOCUMENTS',
          'WAITING_EXECUTION_CONFIRMATION',
          'WAITING_EXECUTION_STAMP',
        ];
  for (const view of ['mine', 'department']) {
    await page.goto(`/cases?view=${view}&stageGroup=${group}`);
    const link = page.locator(`[data-test="${selector}"]`);
    await expect(link).toHaveClass(/active/u);
    await expect(page.locator('[data-test="case-list"]')).toBeVisible();
    const response = await page.request.get(
      `/api/v1/cases?view=${view}&page=1&pageSize=20&stageGroup=${group}`,
    );
    await status(response, 200);
    const body = (await response.json()) as {
      items: Array<{ id: string; stage: string }>;
      total: number;
      counts: Record<string, number>;
    };
    expect(body.items.map((item) => item.id)).toContain(caseId);
    expect(body.items.every((item) => stages.includes(item.stage))).toBe(true);
    expect(body.total).toBe(
      stages.reduce((sum, stage) => sum + body.counts[stage]!, 0),
    );
    await expect(link.locator('.app-nav__badge')).toHaveText(
      String(body.total),
    );
    const detailLink = page
      .locator('[data-test="case-list"]')
      .locator(`a[href^="/cases/${caseId}"]`)
      .first();
    await detailLink.click();
    await expect(page).toHaveURL(new RegExp(`/cases/${caseId}`, 'u'));
    await page.goBack();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('stageGroup'))
      .toBe(group);
  }
  await page.goto(`/cases?view=mine&stage=${atomicStage}`);
  await expect(page.locator(`[data-test="${selector}"]`)).toHaveClass(
    /active/u,
  );
  expect(new URL(page.url()).searchParams.get('stage')).toBe(atomicStage);
  expect(new URL(page.url()).searchParams.has('stageGroup')).toBe(false);
}

test('operator finishes through the real panel with an explanation and customer sees only RECORDED facts', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const source = await createCaseExecutionFilingSourceThroughApi(request, {
    onComplaintSubmitted: async (caseId) => {
      await grantFinishActionToExistingRoleA(page);
      await login(
        page,
        '/cases',
        coreLeadFixtures.operatorUsername,
        coreLeadFixtures.operatorPassword,
      );
      await verifyDocumentGroupNavigation(
        page,
        caseId,
        'COMPLAINT_PREPARATION',
        'WAITING_COMPLAINT_CONFIRMATION',
      );
    },
    onExecutionPrepared: async (caseId) => {
      await verifyDocumentGroupNavigation(
        page,
        caseId,
        'EXECUTION_PREPARATION',
        'WAITING_EXECUTION_DOCUMENTS',
      );
    },
  });
  await logout(page);
  expect(source.stage).toBe('EXECUTING');
  const migration = await verifyExecutionFinishMigration(source.caseId);
  expect(migration).toMatchObject({
    empty: true,
    enumCommitted: true,
    injectedFailure: true,
    ddlRolledBack: true,
    forwardRecovery: true,
    preserved: true,
    oldBytesPreserved: true,
    stageOnlyRejected: true,
  });
  expect(migration.foreignKeys).toBeGreaterThan(0);

  await login(
    page,
    `/cases/${source.caseId}`,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await openCaseWorkspaceCommand(
    page,
    'finish',
    '[data-test="execution-finish-panel"]',
  );
  const panel = page.locator('[data-test="execution-finish-panel"]');
  await expect(panel).toBeVisible();
  await panel
    .locator('[data-test="execution-finish-date"]')
    .fill(todayShanghai());
  await panel
    .locator('[data-test="execution-finish-reason"]')
    .fill('合成验收案件已完成执行，记录实际履行结果。');
  await panel
    .locator('[data-test="execution-finish-note"]')
    .fill('依据法院执行回执；本说明不表示案件已结案。');
  const before = await executionFinishDetail(page.request, source.caseId);
  const beforeFiling = before.executionFiling as { id: string };
  const beforeExecutionFiling = before.executionFiling;
  const beforeExecutionSubmission = before.executionSubmission;
  await panel.locator('[data-test="execution-finish-review"]').click();
  await expect(
    panel.locator('[data-test="execution-finish-review-summary"]'),
  ).toContainText('待归档');
  const submitted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/cases/${source.caseId}/execution-finish`,
  );
  await panel.locator('[data-test="execution-finish-submit"]').click();
  const response = await submitted;
  await status(response, 201);
  const postedInput = response.request().postDataJSON() as {
    expectedVersion: number;
    expectedFilingId: string;
    idempotencyKey: string;
  };
  expect(postedInput.expectedVersion).toBe(before.version);
  expect(postedInput.expectedFilingId).toBe(beforeFiling.id);
  expect(response.request().headers()['idempotency-key']).toBe(
    postedInput.idempotencyKey,
  );
  const receipt = (await response.json()) as {
    id: string;
    finishId: string;
    filingId: string;
    stage: string;
    version: number;
    finishedAt: string;
  };
  expect(receipt).toMatchObject({
    id: source.caseId,
    stage: 'WAITING_ARCHIVE',
    finishedAt: todayShanghai(),
  });

  let detail = await executionFinishDetail(page.request, source.caseId);
  expect(detail.stage).toBe('WAITING_ARCHIVE');
  expect(detail.executionFiling).toBeTruthy();
  expect(detail.executionFiling).toEqual(beforeExecutionFiling);
  expect(detail.executionSubmission).toEqual(beforeExecutionSubmission);
  expect(detail.executionFinish).toMatchObject({
    id: receipt.finishId,
    filingId: receipt.filingId,
    finishedAt: todayShanghai(),
    reason: '合成验收案件已完成执行，记录实际履行结果。',
    basisNote: '依据法院执行回执；本说明不表示案件已结案。',
    files: [],
  });
  await page.reload();
  await revealCaseWorkspaceSection(page, 'execution');
  await page
    .locator('[data-section="execution"] .case-workspace-group-nav button')
    .filter({ hasText: '执行结束（当前）' })
    .click();
  const finishFact = page
    .locator('[data-section="execution"] .case-workspace-group')
    .filter({
      has: page.getByRole('heading', { name: '执行结束（当前）', exact: true }),
    });
  await expect(finishFact).toContainText(todayShanghai());
  await expect(finishFact).toContainText(
    '依据法院执行回执；本说明不表示案件已结案。',
  );
  await expect(
    panel.locator('[data-test="execution-finish-reason"]'),
  ).toHaveCount(0);
  await logout(page);
  await login(
    page,
    `/cases/${source.caseId}`,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  detail = await executionFinishDetail(page.request, source.caseId);
  expect(detail.executionFinish).toMatchObject({
    id: receipt.finishId,
    filingId: receipt.filingId,
    reason: '合成验收案件已完成执行，记录实际履行结果。',
  });
  await revealCaseWorkspaceSection(page, 'execution');
  await page
    .locator('[data-section="execution"] .case-workspace-group-nav button')
    .filter({ hasText: '执行结束（当前）' })
    .click();
  await expect(finishFact).toBeVisible();

  await logout(page);
  await login(
    page,
    '/client/cases?view=RECORDED',
    source.client.username,
    source.client.password,
  );
  const clientList = await page.request.get(
    '/api/v1/client/cases?view=RECORDED',
  );
  await status(clientList, 200);
  const listBody = (await clientList.json()) as {
    items: Array<{ id: string; stage: string }>;
  };
  expect(listBody.items).toContainEqual(
    expect.objectContaining({ id: source.caseId, stage: 'WAITING_ARCHIVE' }),
  );
  await page.goto(`/client/cases/${source.caseId}`);
  await expect(page.locator('.page-head .pill')).toContainText('待归档');
  await expect(
    page.locator('[data-test="execution-finish-panel"]'),
  ).toHaveCount(0);
  const clientDetail = await page.request.get(
    `/api/v1/client/cases/${source.caseId}`,
  );
  await status(clientDetail, 200);
  const clientProjection = (await clientDetail.json()) as Record<
    string,
    unknown
  >;
  expect(clientProjection.stage).toBe('WAITING_ARCHIVE');
  for (const field of [
    'executionFinish',
    'finishedAt',
    'reason',
    'basisNote',
    'finishId',
    'actorUserId',
    'auditEventId',
  ]) {
    expect(clientProjection).not.toHaveProperty(field);
  }
  expect(JSON.stringify(clientProjection)).not.toContain(
    '合成验收案件已完成执行，记录实际履行结果。',
  );
  expect(JSON.stringify(clientProjection)).not.toContain(
    '依据法院执行回执；本说明不表示案件已结案。',
  );
});

test('current PRIMARY lawyer finishes with an uploaded basis and downloads its original bytes after refresh and re-login', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const source = await createCaseExecutionFilingSourceThroughApi(request, {
    onComplaintSubmitted: async () => grantFinishActionToExistingRoleA(page),
  });
  expect(source.stage).toBe('EXECUTING');

  await login(
    page,
    '/lawyer/cases',
    source.lawyer.username,
    source.lawyer.password,
  );
  await page.goto(`/lawyer/cases/${source.caseId}`);
  await openCaseWorkspaceCommand(
    page,
    'finish',
    '[data-test="execution-finish-panel"]',
  );
  const panel = page.locator('[data-test="execution-finish-panel"]');
  await expect(panel).toBeVisible();
  const filename = `CA015-primary-basis-${randomUUID().slice(0, 8)}.pdf`;
  const upload = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      /^\/api\/v1\/materials\/upload-drafts\/[^/]+\/content$/u.test(
        new URL(response.url()).pathname,
      ),
  );
  await panel.locator('[data-test="execution-finish-upload"]').setInputFiles({
    name: filename,
    mimeType: 'application/pdf',
    buffer: basisBytes,
  });
  await status(await upload, 200);
  const chosen = panel
    .locator('label')
    .filter({ hasText: filename })
    .locator('[data-test="execution-finish-choice"]');
  await expect(chosen).toBeChecked();
  await panel
    .locator('[data-test="execution-finish-date"]')
    .fill(todayShanghai());
  await panel
    .locator('[data-test="execution-finish-reason"]')
    .fill('合成验收案件已执行完毕，以真实上传附件作为依据。');
  const before = await executionFinishDetail(page.request, source.caseId, true);
  const beforeFiling = before.executionFiling as { id: string };
  await panel.locator('[data-test="execution-finish-review"]').click();
  await expect(
    panel.locator('[data-test="execution-finish-review-summary"]'),
  ).toContainText(filename);
  const submitted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/lawyer/cases/${source.caseId}/execution-finish`,
  );
  await panel.locator('[data-test="execution-finish-submit"]').click();
  const response = await submitted;
  await status(response, 201);
  const postedInput = response.request().postDataJSON() as {
    expectedVersion: number;
    expectedFilingId: string;
    idempotencyKey: string;
    basisContentVersionIds: string[];
  };
  expect(postedInput.expectedVersion).toBe(before.version);
  expect(postedInput.expectedFilingId).toBe(beforeFiling.id);
  expect(response.request().headers()['idempotency-key']).toBe(
    postedInput.idempotencyKey,
  );
  const receipt = (await response.json()) as {
    id: string;
    finishId: string;
    filingId: string;
    stage: string;
    finishedAt: string;
  };
  expect(receipt).toMatchObject({
    id: source.caseId,
    stage: 'WAITING_ARCHIVE',
    finishedAt: todayShanghai(),
  });
  const detail = await executionFinishDetail(page.request, source.caseId, true);
  expect(detail.stage).toBe('WAITING_ARCHIVE');
  const finish = detail.executionFinish as {
    id: string;
    filingId: string;
    reason: string;
    basisNote: string | null;
    files: Array<{ contentVersionId: string; originalFilename: string }>;
  };
  expect(finish).toMatchObject({
    id: receipt.finishId,
    filingId: receipt.filingId,
    reason: '合成验收案件已执行完毕，以真实上传附件作为依据。',
    basisNote: null,
    files: [expect.objectContaining({ originalFilename: filename })],
  });
  expect(finish.files).toHaveLength(1);
  expect(postedInput.basisContentVersionIds).toEqual([
    finish.files[0]!.contentVersionId,
  ]);
  await page.reload();
  if (new URL(page.url()).pathname.startsWith('/cases/'))
    await revealCaseWorkspaceSection(page, 'execution');
  await expect(panel).toContainText(filename);
  await expect(await uploadResponseBytes(page, filename)).toEqual(basisBytes);
  await logout(page);
  await login(
    page,
    '/lawyer/cases',
    source.lawyer.username,
    source.lawyer.password,
  );
  await page.goto(`/lawyer/cases/${source.caseId}`);
  await expect(
    page.locator('[data-test="execution-finish-fact"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-test="execution-finish-panel"]'),
  ).toContainText('合成验收案件已执行完毕，以真实上传附件作为依据。');
  await expect(await uploadResponseBytes(page, filename)).toEqual(basisBytes);
});
