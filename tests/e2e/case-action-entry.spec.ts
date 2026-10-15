import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import {
  coreLeadFixtures,
  seedCoreLeadE2eData,
} from '../support/core-lead-database.mjs';
import {
  clearCaseExternalEntryFixture,
  setCaseExternalEntryGrant,
  setCaseExternalEntryWorkflowGrant,
} from '../support/case-external-entry-database.mjs';
import { closeCaseWorkspaceDrawer } from '../support/case-workspace-browser';

const operator = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
async function login(page: Page, path: string) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/cases');
}

test.beforeEach(async () => {
  await clearCaseExternalEntryFixture();
  await seedCoreLeadE2eData({ reuseExisting: true });
  await setCaseExternalEntryGrant(
    coreLeadFixtures.roleA,
    'case.external-entry.create',
    'TEAM',
    true,
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.judgment.register',
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.judgment.next_step',
  );
});
test.afterEach(async () => {
  await clearCaseExternalEntryFixture();
});

async function createEntry(
  request: APIRequestContext,
  initialStage:
    | 'WAITING_JUDGMENT'
    | 'SECOND_INSTANCE'
    | 'WAITING_ARCHIVE' = 'WAITING_JUDGMENT',
) {
  const payload = {
    idempotencyKey: randomUUID(),
    entryKind: 'HISTORICAL_BACKFILL',
    initialStage,
    stageReachedOn: '2026-10-01',
    source: `CA018 E2E:UXQ01-C:${randomUUID()}`,
    reason: '合成列表办理入口验收',
    customerId: coreLeadFixtures.admittedCustomer,
    rightsHolderId: coreLeadFixtures.holder,
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
  };
  const created = await request.post('/api/v1/cases/external-entries', {
    headers: operator,
    data: payload,
  });
  expect(created.status()).toBe(201);
  return (await created.json()) as { id: string; businessNo: string };
}

test('list action opens the existing judgment form after fresh GET, closes and returns with filters', async ({
  page,
  request,
}) => {
  const item = await createEntry(request);
  const listPath = '/cases?view=department&stage=WAITING_JUDGMENT&page=1';
  await login(page, listPath);
  const writes: string[] = [];
  page.on('request', (req) => {
    if (
      req.method() !== 'GET' &&
      new URL(req.url()).pathname.startsWith(`/api/v1/cases/${item.id}`)
    )
      writes.push(req.url());
  });
  const row = page.getByRole('row').filter({ hasText: item.businessNo });
  await expect(
    row.getByRole('link', { name: item.businessNo, exact: true }),
  ).toBeVisible();
  const freshRead = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1/cases/${item.id}` &&
      response.request().method() === 'GET',
  );
  await row.getByRole('button', { name: '登记判决', exact: true }).click();
  const detail = await freshRead;
  expect(detail.status()).toBe(200);
  const fresh = (await detail.json()) as {
    id: string;
    version: number;
    canRegisterJudgment: boolean;
  };
  expect(fresh).toMatchObject({
    id: item.id,
    version: 1,
    canRegisterJudgment: true,
  });
  await expect(page.locator('[data-test="case-judgment-panel"]')).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.has('action'))
    .toBe(false);
  expect(writes).toEqual([]);
  await closeCaseWorkspaceDrawer(page);
  await page.getByRole('link', { name: '返回案件列表', exact: true }).click();
  await expect
    .poll(() => new URL(page.url()).pathname + new URL(page.url()).search)
    .toBe(listPath);
  await row.getByRole('button', { name: '登记判决', exact: true }).click();
  await expect(page.locator('[data-test="case-judgment-panel"]')).toBeVisible();
  await expect(page.locator('[data-test="case-judgment-panel"]')).toHaveCount(
    1,
  );
  expect(writes).toEqual([]);

  await page.locator('[data-test="judgment-date"]').fill(today());
  await page
    .locator('[data-test="judgment-amount-state"]')
    .selectOption('PENDING');
  await page.locator('[data-test="paid-fee-state"]').selectOption('PENDING');
  await page.locator('[data-test="judgment-file-input"]').setInputFiles({
    name: 'uxq01-judgment.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\nUXQ01-C synthetic judgment\n%%EOF\n'),
  });
  await expect(
    page.locator('[data-test^="judgment-file-"][type="checkbox"]'),
  ).toBeChecked();
  const committed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/v1/cases/${item.id}/judgment-register` &&
      response.request().method() === 'POST',
  );
  const confirmed = page.waitForResponse(
    async (response) =>
      new URL(response.url()).pathname === `/api/v1/cases/${item.id}` &&
      response.request().method() === 'GET' &&
      ((await response.json()) as { version: number }).version === 2,
  );
  await page.locator('[data-test="judgment-submit"]').click();
  const registered = await committed;
  expect(registered.status()).toBe(201);
  expect(registered.request().postDataJSON()).toMatchObject({
    expectedVersion: 1,
    judgmentAmountState: 'PENDING',
    judgmentAmount: null,
  });
  expect(await (await confirmed).json()).toMatchObject({
    id: item.id,
    version: 2,
    stage: 'WAITING_JUDGMENT',
    judgment: { current: { id: expect.any(String) } },
  });
  await closeCaseWorkspaceDrawer(page);
  await page.getByRole('link', { name: '返回案件列表', exact: true }).click();
  await expect(
    row.getByRole('button', { name: '登记判决', exact: true }),
  ).toHaveCount(0);
  await row
    .getByRole('button', { name: '选择判决后续流程', exact: true })
    .click();
  await expect(
    page.locator('[data-test="case-judgment-next-step-panel"]'),
  ).toBeVisible();
  expect(writes).toHaveLength(1);
});

test('invalid intent is consumed without opening a form or claiming permission failure', async ({
  page,
  request,
}) => {
  const item = await createEntry(request);
  await login(page, '/cases');
  await page.goto(`/cases/${item.id}?action=jump-stage&view=department&page=1`);
  await expect(page.locator('[data-test="case-action-notice"]')).toContainText(
    '入口已失效',
  );
  await expect
    .poll(() => new URL(page.url()).searchParams.has('action'))
    .toBe(false);
  await expect(
    page.locator('.case-workspace-editors[role="dialog"]'),
  ).not.toBeVisible();
});

test('a stale list capability is rechecked after grant loss and never opens another form', async ({
  page,
  request,
}) => {
  const item = await createEntry(request);
  await login(page, '/cases?view=department&stage=WAITING_JUDGMENT');
  const row = page.getByRole('row').filter({ hasText: item.businessNo });
  await expect(
    row.getByRole('button', { name: '登记判决', exact: true }),
  ).toBeVisible();
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.judgment.register',
    false,
  );
  const read = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1/cases/${item.id}`,
  );
  await row.getByRole('button', { name: '登记判决', exact: true }).click();
  const response = await read;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    id: item.id,
    canRegisterJudgment: false,
  });
  await expect(page.locator('[data-test="case-action-notice"]')).toHaveText(
    '此办理入口已失效，请查看当前案件可用操作。',
  );
  await expect(
    page.locator('.case-workspace-editors[role="dialog"]'),
  ).not.toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.has('action'))
    .toBe(false);
});

test('a delayed intent response cannot reopen a form after returning to the filtered list', async ({
  page,
  request,
}) => {
  const item = await createEntry(request);
  const listPath = '/cases?view=department&stage=WAITING_JUDGMENT&page=1';
  await login(page, listPath);
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let observed!: () => void;
  const requested = new Promise<void>((resolve) => {
    observed = resolve;
  });
  await page.route(`**/api/v1/cases/${item.id}`, async (route) => {
    const response = await route.fetch();
    observed();
    await released;
    await route.fulfill({ response });
  });
  try {
    await page
      .getByRole('row')
      .filter({ hasText: item.businessNo })
      .getByRole('button', { name: '登记判决', exact: true })
      .click();
    await requested;
    await expect(
      page.getByRole('heading', { name: '正在读取案件', exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: '返回案件列表', exact: true }).click();
    release();
    await expect
      .poll(() => new URL(page.url()).pathname + new URL(page.url()).search)
      .toBe(listPath);
    await expect(
      page.getByRole('row').filter({ hasText: item.businessNo }),
    ).toBeVisible();
    await expect(
      page.locator('.case-workspace-editors[role="dialog"]'),
    ).not.toBeVisible();
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('a historical second-instance list action opens the real round form', async ({
  page,
  request,
}) => {
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.second_instance.save',
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.second_instance.result',
  );
  const item = await createEntry(request, 'SECOND_INSTANCE');
  await login(page, '/cases?view=department&stage=SECOND_INSTANCE');
  const row = page.getByRole('row').filter({ hasText: item.businessNo });
  await row
    .getByRole('button', { name: '二审登记／结果', exact: true })
    .click();
  await expect(
    page.locator('[data-test="second-instance-panel"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-test="second-instance-round-1"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-test="second-instance-progress-form"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-test="second-instance-revoke-section"]'),
  ).not.toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.has('action'))
    .toBe(false);
});

test('archive entry follows a real closure fact and keeps the existing guarded form', async ({
  page,
  request,
}) => {
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.closure.record',
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.archive',
  );
  const item = await createEntry(request, 'WAITING_ARCHIVE');
  const bytes = Buffer.from(
    '%PDF-1.7\nUXQ01-C synthetic closure basis\n%%EOF\n',
  );
  const draft = await request.post('/api/v1/materials/upload-drafts', {
    headers: operator,
    data: {
      ownerType: 'CASE',
      ownerId: item.id,
      category: 'CASE_CLOSURE_DOCUMENT',
      purpose: 'CASE_CLOSURE_DOCUMENT',
      originalFilename: 'uxq01-closure.pdf',
      declaredMimeType: 'application/pdf',
    },
  });
  expect(draft.status()).toBe(201);
  const draftId = ((await draft.json()) as { id: string }).id;
  const upload = await request.put(
    `/api/v1/materials/upload-drafts/${draftId}/content`,
    {
      headers: { ...operator, 'Content-Type': 'application/octet-stream' },
      data: bytes,
    },
  );
  expect(upload.status()).toBe(200);
  const file = (await upload.json()) as { contentVersionId: string };
  const closure = await request.post(`/api/v1/cases/${item.id}/closure`, {
    headers: operator,
    data: {
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      expectedFinishId: null,
      closeAt: null,
      closeAmountState: 'PENDING',
      closeAmt: null,
      note: '合成结案资料',
      closeContentVersionIds: [file.contentVersionId],
    },
  });
  expect(closure.status()).toBe(201);
  await login(page, '/cases?view=department&stage=WAITING_ARCHIVE&page=1');
  const row = page.getByRole('row').filter({ hasText: item.businessNo });
  await row.getByRole('button', { name: '归档案件', exact: true }).click();
  await expect(page.locator('[data-test="archive-panel"]')).toBeVisible();
  await expect(page.locator('[data-test="archive-form"]')).toBeVisible();
  await expect(page.locator('[data-test="archive-submit"]')).toBeDisabled();
  await expect
    .poll(() => new URL(page.url()).searchParams.has('action'))
    .toBe(false);
  await closeCaseWorkspaceDrawer(page);
  const detail = await request.get(`/api/v1/cases/${item.id}`, {
    headers: operator,
  });
  expect(await detail.json()).toMatchObject({
    id: item.id,
    version: 2,
    stage: 'WAITING_ARCHIVE',
    archive: null,
  });
});
