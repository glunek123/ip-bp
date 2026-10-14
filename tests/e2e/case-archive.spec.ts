import {
  openCaseWorkspaceCommand,
  revealCaseWorkspaceSection,
} from '../support/case-workspace-browser.js';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  clearCaseArchiveFixture,
  createClosedCaseArchiveSourceThroughApi,
  setCaseArchiveFixtureGrant,
} from '../support/case-archive-database.mjs';
import { clearCaseClosureFixture } from '../support/case-closure-database.mjs';
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

type Receipt = {
  id: string;
  archiveId: string;
  archiveVersionId: string;
  closureId: string;
  closureVersionId: string;
  stage: 'ARCHIVED';
  version: number;
  recordedAt: string;
};
type ArchiveVersion = {
  id: string;
  kind: 'ARCHIVE' | 'CORRECT';
  priorVersionId: string | null;
  closureVersionId: string;
  fromVersion: number;
  toVersion: number;
  archiveAt: string;
  archiveType: string;
  archiveReason: string;
  correctionReason?: string | null;
  recordedByUserId?: string;
};
type Detail = {
  id: string;
  stage: string;
  version: number;
  canArchive: boolean;
  canCorrectArchive: boolean;
  canRecordClosure: boolean;
  canCorrectClosure: boolean;
  closure: {
    id: string;
    current: {
      id: string;
      closeAt: string | null;
      closeAmountState: string;
      closeAmt: string | null;
      files: Array<{ materialId: string; contentVersionId: string }>;
    };
    history: unknown[];
  };
  archive: null | {
    id: string;
    closureId: string;
    closureVersionId: string;
    current: ArchiveVersion;
    history: ArchiveVersion[];
  };
};
const operator = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const bytes = Buffer.from(
  '%PDF-1.7\nCA017 exact prior closure PDF preserved after archive\n%%EOF\n',
);
async function data<T>(
  r: { status(): number; text(): Promise<string>; json(): Promise<unknown> },
  status = 200,
): Promise<T> {
  expect(r.status(), await r.text()).toBe(status);
  return r.json() as Promise<T>;
}
async function read(request: APIRequestContext, id: string, lawyer = false) {
  return data<Detail>(
    await request.get(
      `/api/v1/${lawyer ? 'lawyer/' : ''}cases/${id}`,
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
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname === '/api/v1/auth/login',
  );
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  const session = await data<{ csrfToken: string }>(await login);
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe(new URL(path, 'http://127.0.0.1:5174').pathname);
  return { 'X-CSRF-Token': session.csrfToken };
}
async function signOut(page: Page) {
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/u);
}
async function clean() {
  await clearCaseArchiveFixture();
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

test('internal case workspace keeps seven closed sections, real file bytes and pending amounts across compact viewports without case writes', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  const source = await createClosedCaseArchiveSourceThroughApi(request, {
    bytes,
  });
  const before = await read(request, source.caseId);
  expect(before.closure.current.closeAt).toBeNull();
  expect(before.closure.current.closeAmountState).toBe('PENDING');
  const caseWrites: string[] = [];
  page.on('request', (r) => {
    if (
      new URL(r.url()).pathname.startsWith(`/api/v1/cases/${source.caseId}`) &&
      !['GET', 'HEAD', 'OPTIONS'].includes(r.method())
    )
      caseWrites.push(r.method());
  });
  const path = `/cases/${source.caseId}?view=department&page=2&stage=WAITING_ARCHIVE`;
  await signIn(
    page,
    path,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  const workspace = page.locator('.case-workspace').first();
  const toggles = workspace.locator('.case-workspace-section__toggle');
  await expect(toggles).toHaveCount(7);
  await expect(toggles).toHaveText([
    /案件信息/u,
    /线索信息/u,
    /一审信息/u,
    /二审信息/u,
    /判决信息/u,
    /执行信息/u,
    /流程时间轴/u,
  ]);
  for (const toggle of await toggles.all())
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggles.first().click();
  await expect(toggles.first()).toHaveAttribute('aria-expanded', 'true');
  await expect(
    workspace.locator(
      '[data-section="case-info"] .case-workspace-section__body',
    ),
  ).toContainText('未记录');
  await expect(
    workspace.locator(
      '.case-workspace-section__body :is(input,select,textarea)',
    ),
  ).toHaveCount(0);
  await page.getByRole('tab', { name: '文件管理', exact: true }).click();
  await expect(page).toHaveURL(/[?&]tab=files(?:&|$)/u);
  const file = source.file;
  if (file === null) throw new Error('Synthetic exact-version file missing');
  const row = workspace
    .locator('[data-test="workspace-file"]')
    .filter({ hasText: file.contentVersionId });
  await expect(row).toHaveCount(1);
  const downloaded = page.waitForEvent('download');
  await row.getByRole('button', { name: /^下载 /u }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe(file.originalFilename);
  const downloadPath = await download.path();
  if (downloadPath === null) throw new Error('Browser download path missing');
  expect(readFileSync(downloadPath).equals(bytes)).toBe(true);
  await page.getByRole('tab', { name: '费用管理', exact: true }).click();
  await expect(workspace.locator('[data-test="amount-closure"]')).toContainText(
    'PENDING',
  );
  await expect(
    workspace.locator('[data-test="amount-closure"]'),
  ).not.toContainText('¥ 0');
  await expect(workspace.locator('[data-test="case-payments"]')).toContainText(
    '未提供',
  );
  await page.getByRole('tab', { name: '费用管理', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(
    page.getByRole('tab', { name: '案件详情', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(toggles.first()).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('End');
  await expect(
    page.getByRole('tab', { name: '费用管理', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(
    page.getByRole('tab', { name: '文件管理', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(
    page.getByRole('tab', { name: '案件详情', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await toggles.first().click();
  for (const [label, width, height, padding] of [
    ['desktop', 1440, 900, 16],
    ['tablet', 1024, 768, 12],
    ['mobile', 390, 844, 10],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(path);
    await expect(toggles).toHaveCount(7);
    for (const toggle of await toggles.all())
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(
      await workspace.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).paddingLeft),
      ),
    ).toBe(padding);
    expect(
      await page.evaluate(() => document.body.scrollWidth),
    ).toBeLessThanOrEqual(width + 1);
    await page.screenshot({
      path: testInfo.outputPath(`workspace-${label}-closed.png`),
      fullPage: true,
    });
    await page.getByRole('tab', { name: '文件管理', exact: true }).click();
    await expect(row).toHaveCount(1);
    await page.screenshot({
      path: testInfo.outputPath(`workspace-${label}-files.png`),
      fullPage: true,
    });
    await page.getByRole('tab', { name: '费用管理', exact: true }).click();
    await expect(
      workspace.locator('[data-test="amount-closure"]'),
    ).toContainText('PENDING');
    await page.screenshot({
      path: testInfo.outputPath(`workspace-${label}-fees.png`),
      fullPage: true,
    });
    const query = new URL(page.url()).searchParams;
    expect(query.get('view')).toBe('department');
    expect(query.get('page')).toBe('2');
    expect(query.get('stage')).toBe('WAITING_ARCHIVE');
  }
  expect(caseWrites).toEqual([]);
  const after = await read(request, source.caseId);
  expect(after.version).toBe(before.version);
  expect(after.closure).toEqual(before.closure);
  expect(after.archive).toBeNull();
});

test('normal operator archives pending amount and unknown closure date, appends reason history, keeps exact bytes and exposes only client stage', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const source = await createClosedCaseArchiveSourceThroughApi(request, {
    bytes,
  });
  await setCaseArchiveFixtureGrant(
    coreLeadFixtures.roleA,
    'case.archive',
    'TEAM',
  );
  await setCaseArchiveFixtureGrant(
    coreLeadFixtures.roleA,
    'case.archive.correct',
    'TEAM',
  );
  const before = await read(request, source.caseId);
  expect(before.archive).toBeNull();
  await signIn(
    page,
    `/cases/${source.caseId}`,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await openCaseWorkspaceCommand(
    page,
    'archive',
    '[data-test="archive-panel"]',
  );
  const panel = page.locator('[data-test="archive-panel"]');
  await expect(panel.locator('[data-test="archive-form"]')).toBeVisible();
  await expect(panel.locator('[data-test="archive-date"]')).toHaveValue('');
  await panel.locator('[data-test="archive-date"]').fill(today());
  await panel
    .locator('[data-test="archive-type"]')
    .selectOption('EXECUTION_COLLECTED');
  await panel
    .locator('[data-test="archive-reason"]')
    .fill('业务已办完；结案额待定，实际款项未登记。');
  const first = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname === `/api/v1/cases/${source.caseId}/archive`,
  );
  await panel.locator('[data-test="archive-submit"]').click();
  const posted = await first;
  const archived = await data<Receipt>(posted, 201);
  expect(posted.request().postDataJSON()).toMatchObject({
    expectedVersion: before.version,
    expectedClosureVersionId: source.closureResult.closureVersionId,
    archiveAt: today(),
    archiveType: 'EXECUTION_COLLECTED',
    archiveReason: '业务已办完；结案额待定，实际款项未登记。',
  });
  expect(archived).toMatchObject({
    id: source.caseId,
    closureId: source.closureResult.closureId,
    closureVersionId: source.closureResult.closureVersionId,
    stage: 'ARCHIVED',
    version: before.version + 1,
  });
  let detail = await read(request, source.caseId);
  expect(detail).toMatchObject({
    stage: 'ARCHIVED',
    canArchive: false,
    canCorrectArchive: true,
    canRecordClosure: false,
    canCorrectClosure: false,
  });
  expect(detail.closure).toEqual(before.closure);
  expect(detail.archive?.current).toMatchObject({
    id: archived.archiveVersionId,
    kind: 'ARCHIVE',
    priorVersionId: null,
    closureVersionId: source.closureResult.closureVersionId,
    fromVersion: before.version,
    toVersion: archived.version,
  });
  await page.reload();
  await revealCaseWorkspaceSection(page, 'case-info');
  await expect(page.locator('[data-section="case-info"]')).toContainText(
    '待确认',
  );
  await openCaseWorkspaceCommand(
    page,
    'archive',
    '[data-test="archive-panel"]',
  );

  await expect(panel.locator('[data-test="archive-current"]')).toContainText(
    '执行到款',
  );
  await expect(page.locator('[data-test="closure-correct"]')).toHaveCount(0);
  await panel.locator('summary').first().click();
  await panel.locator('[data-test="archive-correct"]').click();
  await panel
    .locator('[data-test="archive-type"]')
    .selectOption('EXECUTION_CLOSED');
  await panel
    .locator('[data-test="archive-reason"]')
    .fill('更正分类；结案原文书和资金状态保留。');
  await panel
    .locator('[data-test="archive-correction-reason"]')
    .fill('核实真实归档类型，追加更正保留原版。');
  const correctedResponse = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname ===
        `/api/v1/cases/${source.caseId}/archive-correction`,
  );
  await panel.locator('[data-test="archive-submit"]').click();
  const corrected = await data<Receipt>(await correctedResponse, 201);
  expect(corrected).toMatchObject({
    archiveId: archived.archiveId,
    closureVersionId: archived.closureVersionId,
    stage: 'ARCHIVED',
    version: archived.version + 1,
  });
  detail = await read(request, source.caseId);
  expect(detail.archive?.history).toHaveLength(2);
  expect(detail.archive?.history[0]).toMatchObject({
    id: archived.archiveVersionId,
    archiveType: 'EXECUTION_COLLECTED',
  });
  expect(detail.archive?.current).toMatchObject({
    id: corrected.archiveVersionId,
    priorVersionId: archived.archiveVersionId,
    archiveType: 'EXECUTION_CLOSED',
    correctionReason: '核实真实归档类型，追加更正保留原版。',
  });
  expect(detail.closure).toEqual(before.closure);
  await page.reload();
  await openCaseWorkspaceCommand(
    page,
    'archive',
    '[data-test="archive-panel"]',
  );

  await expect(panel.locator('[data-test="archive-current"]')).toContainText(
    '执行终本',
  );
  await signOut(page);
  await signIn(
    page,
    `/cases/${source.caseId}`,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await openCaseWorkspaceCommand(
    page,
    'archive',
    '[data-test="archive-panel"]',
  );
  await expect(panel.locator('[data-test="archive-current"]')).toContainText(
    '执行终本',
  );
  const directory = resolve('.local/ui002-evidence/browser-artifacts');
  mkdirSync(directory, { recursive: true });
  await panel.locator('summary').first().click();
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(panel.locator('[data-test="archive-current"]')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: resolve(directory, `archive-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/cases?view=mine&stage=ARCHIVED');
  await expect(
    page
      .locator('.business-list-table tbody tr')
      .filter({ hasText: source.caseId }),
  ).toHaveCount(0);
  await expect(page.locator('.business-list-table tbody tr')).toHaveCount(1);
  const list = await data<{
    items: Array<{
      id: string;
      stage: string;
      displaySummary: {
        closureAmount: { state: string; amount: null; sourceId: string };
      };
    }>;
    counts: { ARCHIVED: number };
  }>(
    await page.request.get(
      '/api/v1/cases?view=mine&stage=ARCHIVED&page=1&pageSize=20',
    ),
  );
  expect(list.items).toHaveLength(1);
  expect(list.items[0]).toMatchObject({
    id: source.caseId,
    stage: 'ARCHIVED',
    displaySummary: {
      closureAmount: {
        state: 'PENDING',
        amount: null,
        sourceId: source.closureResult.closureVersionId,
      },
    },
  });
  expect(list.counts.ARCHIVED).toBe(1);
  await signOut(page);
  await signIn(
    page,
    `/lawyer/cases/${source.caseId}`,
    source.lawyer.username,
    source.lawyer.password,
  );
  const lawyer = await read(page.request, source.caseId, true);
  expect(lawyer.archive?.history).toHaveLength(2);
  for (const version of lawyer.archive!.history) {
    expect(version).not.toHaveProperty('recordedByUserId');
    expect(version).not.toHaveProperty('correctionReason');
  }
  expect(lawyer.canCorrectArchive).toBe(false);
  await expect(page.locator('[data-test="archive-correct"]')).toHaveCount(0);
  const file = lawyer.closure.current.files[0]!;
  const download = await page.request.get(
    `/api/v1/materials/${file.materialId}/versions/${file.contentVersionId}/content`,
  );
  expect(download.status()).toBe(200);
  expect(Buffer.from(await download.body()).equals(bytes)).toBe(true);
  await signOut(page);
  await signIn(
    page,
    `/client/cases/${source.caseId}`,
    source.client.username,
    source.client.password,
  );
  const client = await data<{ stage: string }>(
    await page.request.get(`/api/v1/client/cases/${source.caseId}`),
  );
  expect(client.stage).toBe('ARCHIVED');
  for (const key of [
    'archive',
    'closure',
    'canArchive',
    'canCorrectArchive',
    'archiveReason',
    'correctionReason',
    'displaySummary',
  ])
    expect(client).not.toHaveProperty(key);
  await expect(page.locator('[data-test="archive-panel"]')).toHaveCount(0);
  await expect(page.getByText('已归档', { exact: true })).toBeVisible();
  const deniedDownload = await page.request.get(
    `/api/v1/materials/${file.materialId}/versions/${file.contentVersionId}/content`,
  );
  expect([403, 404]).toContain(deniedDownload.status());
});

test('current primary lawyer archives real zero and exact old file, cannot correct, and revoked binding denies the original archive key', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const source = await createClosedCaseArchiveSourceThroughApi(request, {
    realZero: true,
    bytes,
  });
  const csrf = await signIn(
    page,
    `/lawyer/cases/${source.caseId}`,
    source.lawyer.username,
    source.lawyer.password,
  );
  await openCaseWorkspaceCommand(
    page,
    'archive',
    '[data-test="archive-panel"]',
  );
  const panel = page.locator('[data-test="archive-panel"]');
  await expect(panel.locator('[data-test="archive-form"]')).toBeVisible();
  await panel.locator('[data-test="archive-date"]').fill(today());
  await panel.locator('[data-test="archive-type"]').selectOption('SETTLEMENT');
  await panel
    .locator('[data-test="archive-reason"]')
    .fill('当前承办律师登记实际业务归档，不生成实收。');
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname ===
        `/api/v1/lawyer/cases/${source.caseId}/archive`,
  );
  await panel.locator('[data-test="archive-submit"]').click();
  const posted = await response;
  const original = posted.request().postDataJSON() as Record<string, unknown>;
  const archived = await data<Receipt>(posted, 201);
  const detail = await read(page.request, source.caseId, true);
  expect(detail).toMatchObject({
    stage: 'ARCHIVED',
    canCorrectArchive: false,
    closure: {
      current: { closeAt: null, closeAmountState: 'KNOWN', closeAmt: '0.00' },
    },
  });
  expect(detail.archive?.current).not.toHaveProperty('correctionReason');
  expect(detail.archive?.current).not.toHaveProperty('recordedByUserId');
  await expect(panel.locator('[data-test="archive-correct"]')).toHaveCount(0);
  expect(
    (
      await page.request.post(
        `/api/v1/cases/${source.caseId}/archive-correction`,
        {
          headers: csrf,
          data: {
            ...original,
            expectedVersion: archived.version,
            idempotencyKey: randomUUID(),
            expectedArchiveVersionId: archived.archiveVersionId,
            correctionReason: '律师不应获内部更正',
          },
        },
      )
    ).status(),
  ).toBe(403);
  await page.reload();
  await openCaseWorkspaceCommand(
    page,
    'archive',
    '[data-test="archive-panel"]',
  );

  await expect(panel.locator('[data-test="archive-current"]')).toContainText(
    '和解结案',
  );
  const file = detail.closure.current.files[0]!;
  const content = await page.request.get(
    `/api/v1/materials/${file.materialId}/versions/${file.contentVersionId}/content`,
  );
  expect(content.status()).toBe(200);
  expect(Buffer.from(await content.body()).equals(bytes)).toBe(true);
  await endCurrentLawyerAssignment(
    source.caseId,
    source.lawyer.profiles[0]!.profileId,
  );
  expect(
    (
      await page.request.post(`/api/v1/lawyer/cases/${source.caseId}/archive`, {
        headers: csrf,
        data: original,
      })
    ).status(),
  ).toBe(403);
  const retained = await read(request, source.caseId);
  expect(retained.archive?.history).toHaveLength(1);
  expect(retained.archive?.current.id).toBe(archived.archiveVersionId);
});

test('lost archive success retains the original body through refresh and SPA remount and one explicit replay returns the same fixed receipt', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const source = await createClosedCaseArchiveSourceThroughApi(request);
  await setCaseArchiveFixtureGrant(
    coreLeadFixtures.roleA,
    'case.archive',
    'TEAM',
  );
  await signIn(
    page,
    `/cases/${source.caseId}`,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await openCaseWorkspaceCommand(
    page,
    'archive',
    '[data-test="archive-panel"]',
  );
  const panel = page.locator('[data-test="archive-panel"]');
  await expect(panel.locator('[data-test="archive-form"]')).toBeVisible();
  await panel.locator('[data-test="archive-date"]').fill(today());
  await panel.locator('[data-test="archive-type"]').selectOption('MEDIATION');
  await panel
    .locator('[data-test="archive-reason"]')
    .fill('只确认一次真实归档意图，未知原参必须保留。');
  const endpoint = `/api/v1/cases/${source.caseId}/archive`;
  const requests: Array<Record<string, unknown>> = [];
  let receipt: Receipt | undefined;
  await page.route(`**${endpoint}`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    if (requests.length === 1) {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      receipt = (await response.json()) as Receipt;
      await route.abort('failed');
    } else await route.continue();
  });
  await panel.locator('[data-test="archive-submit"]').click();
  await expect(panel.locator('[data-test="archive-retry"]')).toBeVisible();
  expect(requests).toHaveLength(1);
  const original = requests[0]!;
  await panel.locator('[data-test="archive-refresh"]').click();
  await expect(panel.locator('[data-test="archive-retry"]')).toBeVisible();
  expect(requests).toHaveLength(1);
  await page.locator('[data-test="calendar-nav"]').click();
  await expect(page.locator('[data-test="archive-panel"]')).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/cases/${source.caseId}$`, 'u'));
  expect(requests).toHaveLength(1);
  await openCaseWorkspaceCommand(
    page,
    'archive',
    '[data-test="archive-panel"]',
  );
  await expect(panel.locator('[data-test="archive-retry"]')).toBeVisible();
  expect(requests).toHaveLength(1);
  const replay = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' && new URL(r.url()).pathname === endpoint,
  );
  await panel.locator('[data-test="archive-retry"]').click();
  expect(await data<Receipt>(await replay, 201)).toEqual(receipt);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(original);
  const detail = await read(request, source.caseId);
  expect(detail.archive?.history).toHaveLength(1);
  expect(detail.archive?.current.id).toBe(receipt?.archiveVersionId);
  await expect(panel.locator('[data-test="archive-retry"]')).toHaveCount(0);
});
