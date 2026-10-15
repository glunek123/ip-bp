import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  coreLeadFixtures,
  countLeadPushAudits,
  countLeadPushReceipts,
  disconnectCoreLeadTestDatabase,
  seedCoreLeadE2eData,
} from '../support/core-lead-database.mjs';
import {
  batchAuditCount,
  batchMatterState,
  batchReceiptCount,
  disconnectBatchDatabase,
} from '../support/notary-return-archive-batch-database.mjs';

const internalHeaders = {
  Authorization: `Bearer ${coreLeadFixtures.tokenA}`,
};
const loginOrigin = 'http://127.0.0.1:5174';
const openingPhoto = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9oADAMBAAIAAwAAABD/AP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8BP//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8BP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8QP//Z',
  'base64',
);

type LeadSummary = {
  id: string;
  businessNo: string;
  status: string;
  version: number;
};

type LeadDetailResponse = LeadSummary & {
  products: Array<{ id: string }>;
  shopName: string;
};

type WaitingReturnMatter = {
  id: string;
  businessNo: string;
};

function dataTest(page: Page, name: string) {
  return page.locator(`[data-test="${name}"]`);
}

async function readLeadThroughApi(
  request: APIRequestContext,
  leadId: string,
): Promise<LeadDetailResponse> {
  const response = await request.get(`/api/v1/leads/${leadId}`, {
    headers: internalHeaders,
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

async function login(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/(customers|client\/leads)$/u);
}

async function loginClientApi(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<string> {
  const response = await request.post('/api/v1/auth/login', {
    headers: { Origin: loginOrigin },
    data: { username, password },
  });
  expect(response.status(), await response.text()).toBe(200);
  const session: { principalType: string; csrfToken: string } =
    await response.json();
  expect(session.principalType).toBe('CLIENT');
  return session.csrfToken;
}

async function createClientAccount(request: APIRequestContext) {
  const username = `ui003-client-${randomUUID().slice(0, 10)}`;
  const password = 'ui003 client real password';
  const response = await request.post(
    `/api/v1/customers/${coreLeadFixtures.admittedCustomer}/client-accounts`,
    {
      headers: internalHeaders,
      data: { displayName: 'UI003批量归档客户', username, password },
    },
  );
  expect(response.status(), await response.text()).toBe(201);
  return { username, password };
}

async function createWaitingReturnMatter(
  request: APIRequestContext,
  clientCsrf: string,
): Promise<WaitingReturnMatter> {
  const suffix = randomUUID().slice(0, 10);
  const officeResponse = await request.post('/api/v1/notary-offices', {
    headers: internalHeaders,
    data: { name: `UI003公证处-${suffix}` },
  });
  expect(officeResponse.status(), await officeResponse.text()).toBe(201);
  const office: { id: string } = await officeResponse.json();

  const leadResponse = await request.post('/api/v1/leads', {
    headers: { ...internalHeaders, 'Idempotency-Key': randomUUID() },
    data: {
      customerId: coreLeadFixtures.admittedCustomer,
      rightsHolderId: coreLeadFixtures.holder,
      caseType: 'CIVIL',
      infringementTypes: ['TRADEMARK'],
      source: 'ONLINE',
      platform: 'TAOBAO',
      foundAt: '2026-10-01T02:30:00.000Z',
      shopName: `UI003真实流程店铺-${suffix}`,
      needDisclose: false,
      products: [
        {
          title: `UI003真实商品-${suffix}`,
          quantity: 1,
          unitPrice: '8.00',
          commentCount: 0,
        },
      ],
      leadScreenshotContentVersionIds: [],
    },
  });
  expect(leadResponse.status(), await leadResponse.text()).toBe(201);
  const lead: LeadSummary = await leadResponse.json();
  const pushed = await request.post(`/api/v1/leads/${lead.id}/push`, {
    headers: { ...internalHeaders, 'Idempotency-Key': randomUUID() },
    data: { expectedVersion: lead.version },
  });
  expect(pushed.status(), await pushed.text()).toBe(201);

  const reviewed = await request.post(
    `/api/v1/client/leads/${lead.id}/reviews`,
    {
      headers: { 'X-CSRF-Token': clientCsrf, 'Idempotency-Key': randomUUID() },
      data: { result: 'INFRINGEMENT', expectedVersion: lead.version + 1 },
    },
  );
  expect(reviewed.status(), await reviewed.text()).toBe(201);
  const currentLead = await readLeadThroughApi(request, lead.id);
  expect(currentLead.version).toBe(lead.version + 2);
  const transferred = await request.post(
    `/api/v1/leads/${lead.id}/notary-matters`,
    {
      headers: { ...internalHeaders, 'Idempotency-Key': randomUUID() },
      data: {
        selectedProductIds: [currentLead.products[0]!.id],
        selectedContentVersionIds: [],
        notaryOfficeId: office.id,
        evidenceMode: 'ONLINE_PURCHASE',
        batchPurpose: 'UI003真实API公证流程',
        expectedVersion: currentLead.version,
      },
    },
  );
  expect(transferred.status(), await transferred.text()).toBe(201);
  const matter: { id: string } = await transferred.json();

  const evidence = await request.post(
    `/api/v1/notary-matters/${matter.id}/evidence`,
    {
      headers: { ...internalHeaders, 'Idempotency-Key': randomUUID() },
      data: {
        evidenceAt: '2026-10-01',
        sampleFeeState: 'KNOWN',
        sampleFeeAmount: '12.00',
        logistics: [{ companyState: 'NONE', trackingState: 'NONE' }],
        expectedVersion: 1,
      },
    },
  );
  expect(evidence.status(), await evidence.text()).toBe(201);

  const photoDraftResponse = await request.post(
    '/api/v1/materials/upload-drafts',
    {
      headers: internalHeaders,
      data: {
        ownerType: 'NOTARY_MATTER',
        ownerId: matter.id,
        category: 'NOTARY_OPENING_PHOTO',
        purpose: 'NOTARY_OPENING_PHOTO',
        originalFilename: `ui003-opening-${suffix}.jpg`,
        declaredMimeType: 'image/jpeg',
      },
    },
  );
  expect(photoDraftResponse.status(), await photoDraftResponse.text()).toBe(
    201,
  );
  const photoDraft: { id: string } = await photoDraftResponse.json();
  const photoUpload = await request.put(
    `/api/v1/materials/upload-drafts/${photoDraft.id}/content`,
    {
      headers: {
        ...internalHeaders,
        'Content-Type': 'application/octet-stream',
      },
      data: openingPhoto,
    },
  );
  expect(photoUpload.status(), await photoUpload.text()).toBe(200);
  const photo: { contentVersionId: string } = await photoUpload.json();

  const opening = await request.post(
    `/api/v1/notary-matters/${matter.id}/opening`,
    {
      headers: { ...internalHeaders, 'Idempotency-Key': randomUUID() },
      data: { contentVersionIds: [photo.contentVersionId], expectedVersion: 2 },
    },
  );
  expect(opening.status(), await opening.text()).toBe(201);
  const openingReview = await request.post(
    `/api/v1/notary-matters/${matter.id}/opening-review`,
    {
      headers: { ...internalHeaders, 'Idempotency-Key': randomUUID() },
      data: { result: 'INFRINGEMENT', expectedVersion: 3 },
    },
  );
  expect(openingReview.status(), await openingReview.text()).toBe(201);
  const issuance = await request.post(
    `/api/v1/notary-matters/${matter.id}/issuance-decision`,
    {
      headers: { ...internalHeaders, 'Idempotency-Key': randomUUID() },
      data: { decision: 'NO_ISSUE', expectedVersion: 4 },
    },
  );
  expect(issuance.status(), await issuance.text()).toBe(201);

  const matterResponse = await request.get(
    `/api/v1/notary-matters/${matter.id}`,
    { headers: internalHeaders },
  );
  expect(matterResponse.status(), await matterResponse.text()).toBe(200);
  const currentMatter: {
    id: string;
    leadId: string;
    businessNo: string;
    stage: string;
    issuanceDecision: { decision: string } | null;
  } = await matterResponse.json();
  expect(currentMatter).toMatchObject({
    id: matter.id,
    leadId: lead.id,
    stage: 'WAITING_RETURN',
    issuanceDecision: { decision: 'NO_ISSUE' },
  });
  return currentMatter;
}

async function createWaitingPushLead(
  request: APIRequestContext,
  index: number,
): Promise<LeadSummary> {
  const suffix = randomUUID().slice(0, 10);
  const response = await request.post('/api/v1/leads', {
    headers: { ...internalHeaders, 'Idempotency-Key': randomUUID() },
    data: {
      customerId: coreLeadFixtures.admittedCustomer,
      rightsHolderId: coreLeadFixtures.holder,
      caseType: 'CIVIL',
      infringementTypes: ['TRADEMARK'],
      source: 'ONLINE',
      platform: 'TAOBAO',
      foundAt: '2026-10-02T02:30:00.000Z',
      shopName: `UI003待推送-${index}-${suffix}`,
      needDisclose: false,
      products: [
        {
          title: `UI003商品-${index}-${suffix}`,
          quantity: 1,
          unitPrice: '3.50',
          commentCount: index,
        },
      ],
      leadScreenshotContentVersionIds: [],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const lead: LeadSummary = await response.json();
  expect(lead).toMatchObject({ status: 'WAITING_PUSH', version: 1 });
  return lead;
}

test.beforeAll(async () => {
  await seedCoreLeadE2eData({ reuseExisting: true });
});

test.afterAll(async () => {
  await disconnectBatchDatabase();
  await disconnectCoreLeadTestDatabase();
});

test('operator batch-fills only the blank real notary-return reason and verifies both records after re-login', async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const client = await createClientAccount(request);
  const clientCsrf = await loginClientApi(
    request,
    client.username,
    client.password,
  );
  const firstMatter = await createWaitingReturnMatter(request, clientCsrf);
  const secondMatter = await createWaitingReturnMatter(request, clientCsrf);
  const receiptsBefore = await batchReceiptCount();
  const auditsBefore = await batchAuditCount();

  await login(
    page,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await page.goto('/notary-matters?stage=WAITING_RETURN');
  for (const matter of [firstMatter, secondMatter]) {
    const row = dataTest(page, 'matter-row').filter({
      has: page.locator(
        `[data-test="matter-link"][href="/notary-matters/${matter.id}"]`,
      ),
    });
    await expect(row).toBeVisible();
    await row.locator('[data-test="select-matter"]').check();
  }
  await dataTest(page, 'batch-archive-open').click();
  await expect(dataTest(page, 'shared-reason')).toBeVisible();

  await dataTest(page, `reason-${firstMatter.id}`).fill('第一事项原有原因');
  await dataTest(page, `choice-${firstMatter.id}`).selectOption('KEEP');
  await dataTest(page, `choice-${secondMatter.id}`).selectOption('KEEP');
  await dataTest(page, 'shared-reason').fill('两项共用说明');
  await dataTest(page, 'fill-blank-reasons').click();
  await expect(dataTest(page, `reason-${firstMatter.id}`)).toHaveValue(
    '第一事项原有原因',
  );
  await expect(dataTest(page, `reason-${secondMatter.id}`)).toHaveValue(
    '两项共用说明',
  );
  await expect(dataTest(page, 'shared-reason-filled-count')).toContainText(
    '已填入 1 项',
  );
  await dataTest(page, 'shared-reason').fill('');
  await expect(dataTest(page, `reason-${secondMatter.id}`)).toHaveValue(
    '两项共用说明',
  );
  await dataTest(page, `reason-${secondMatter.id}`).fill('第二事项单独原因');
  await expect(dataTest(page, 'batch-submit')).toBeEnabled();
  await dataTest(page, 'batch-submit').click();
  await expect(dataTest(page, 'batch-archive-open')).toBeVisible();
  await expect(page.locator('.return-archive-batch')).toHaveCount(0);

  expect(await batchMatterState(firstMatter.id)).toMatchObject({
    matter: { stage: 'ARCHIVED', version: 6 },
    archives: 1,
    audits: 1,
  });
  expect(await batchMatterState(secondMatter.id)).toMatchObject({
    matter: { stage: 'ARCHIVED', version: 6 },
    archives: 1,
    audits: 1,
  });
  expect(await batchReceiptCount()).toBe(receiptsBefore + 1);
  expect(await batchAuditCount()).toBe(auditsBefore + 1);

  await page.reload();
  await expect(page).toHaveURL(/\/notary-matters\?stage=WAITING_RETURN$/u);
  const returningContext = await browser.newContext();
  const returningPage = await returningContext.newPage();
  await login(
    returningPage,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  for (const [matter, reason] of [
    [firstMatter, '第一事项原有原因'],
    [secondMatter, '第二事项单独原因'],
  ] as const) {
    await returningPage.goto(`/notary-matters/${matter.id}`);
    await expect(
      returningPage.locator('[data-test="return-archive-record"]'),
    ).toContainText(reason);
  }
  await returningContext.close();
});

test('page-two quick edit preserves its query and an unknown real push replays the frozen command once', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const created: LeadSummary[] = [];
  for (let index = 1; index <= 22; index += 1) {
    created.push(await createWaitingPushLead(request, index));
  }

  const pageTwoResponse = await request.get(
    '/api/v1/leads?page=2&pageSize=20&status=WAITING_PUSH&view=LIBRARY',
    { headers: internalHeaders },
  );
  expect(pageTwoResponse.status(), await pageTwoResponse.text()).toBe(200);
  const pageTwo: { items: LeadSummary[]; total: number } =
    await pageTwoResponse.json();
  expect(pageTwo.total).toBeGreaterThanOrEqual(22);
  const createdIds = new Set(created.map((lead) => lead.id));
  const pageTwoCreated = pageTwo.items.filter((lead) =>
    createdIds.has(lead.id),
  );
  expect(pageTwoCreated.length).toBeGreaterThanOrEqual(2);
  const editTarget = pageTwoCreated[0]!;
  const pushTarget = pageTwoCreated[1]!;

  await login(
    page,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await page.goto('/leads?page=2&status=WAITING_PUSH');
  await expect(page).toHaveURL(/\/leads\?page=2&status=WAITING_PUSH$/u);
  const rowFor = (businessNo: string) =>
    dataTest(page, 'lead-row').filter({ hasText: businessNo });
  await expect(rowFor(editTarget.businessNo)).toBeVisible();
  await expect(rowFor(pushTarget.businessNo)).toBeVisible();

  await rowFor(editTarget.businessNo)
    .locator('[data-test="lead-quick-action"]')
    .click();
  await dataTest(page, 'quick-edit-lead').click();
  await expect
    .poll(() => {
      const currentUrl = new URL(page.url());
      const queryKeys = [...currentUrl.searchParams.keys()];
      return {
        origin: currentUrl.origin,
        pathname: currentUrl.pathname,
        queryKeys,
        returnTo: currentUrl.searchParams.get('returnTo'),
      };
    })
    .toEqual({
      origin: loginOrigin,
      pathname: `/leads/${editTarget.id}/edit`,
      queryKeys: ['returnTo'],
      returnTo: '/leads?page=2&status=WAITING_PUSH',
    });
  await dataTest(page, 'edit-cancel').click();
  await expect(page).toHaveURL(/\/leads\?page=2&status=WAITING_PUSH$/u);
  await expect(rowFor(editTarget.businessNo)).toBeVisible();

  await rowFor(editTarget.businessNo)
    .locator('[data-test="lead-quick-action"]')
    .click();
  await dataTest(page, 'quick-edit-lead').click();
  await page
    .locator('[name="shopName"]')
    .fill(`${editTarget.businessNo}-saved`);
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page).toHaveURL(/\/leads\?page=2&status=WAITING_PUSH$/u);
  const savedEdit = await readLeadThroughApi(request, editTarget.id);
  expect(savedEdit).toMatchObject({
    status: 'WAITING_PUSH',
    version: editTarget.version + 1,
    shopName: `${editTarget.businessNo}-saved`,
  });
  await expect(rowFor(pushTarget.businessNo)).toBeVisible();

  const latestPushTarget = await readLeadThroughApi(request, pushTarget.id);
  expect(latestPushTarget).toMatchObject({
    status: 'WAITING_PUSH',
    version: pushTarget.version,
  });
  const commands: Array<{
    body: unknown;
    key: string | undefined;
    resultStatus: number;
  }> = [];
  await page.route(`**/api/v1/leads/${pushTarget.id}/push`, async (route) => {
    const body = route.request().postDataJSON() as unknown;
    const headers = await route.request().allHeaders();
    const response = await route.fetch();
    commands.push({
      body,
      key: headers['idempotency-key'],
      resultStatus: response.status(),
    });
    if (commands.length === 1) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({ response });
  });
  await rowFor(pushTarget.businessNo)
    .locator('[data-test="lead-quick-action"]')
    .click();
  await expect(dataTest(page, 'quick-push-lead')).toBeVisible();
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('确认推送');
    await dialog.accept();
  });
  await dataTest(page, 'quick-push-lead').click();
  await expect(dataTest(page, 'retry-unknown-push')).toBeVisible();
  await expect(dataTest(page, 'retry-unknown-push')).toBeEnabled();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({
    body: { expectedVersion: latestPushTarget.version },
    key: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    resultStatus: 201,
  });

  const stored = await page.evaluate(() => {
    const value = sessionStorage.getItem(
      'dev-cor:lead-quick-actions:pending-push',
    );
    return value ? (JSON.parse(value) as Record<string, unknown>) : null;
  });
  expect(stored).toBeTruthy();
  expect(Object.values(stored ?? {})).toContainEqual(
    expect.objectContaining({
      leadId: pushTarget.id,
      expectedVersion: latestPushTarget.version,
      idempotencyKey: commands[0]!.key,
      status: 'PENDING',
    }),
  );

  await page.reload();
  await expect(page).toHaveURL(/\/leads\?page=2&status=WAITING_PUSH$/u);
  await expect(rowFor(pushTarget.businessNo)).toHaveCount(0);
  await expect(dataTest(page, 'lead-quick-actions-panel')).toBeVisible();
  await expect(dataTest(page, 'retry-unknown-push')).toBeVisible();
  await expect(dataTest(page, 'retry-unknown-push')).toBeEnabled();
  await dataTest(page, 'retry-unknown-push').click();
  await expect(dataTest(page, 'lead-quick-actions-panel')).toHaveCount(0);
  await expect(page).toHaveURL(/\/leads\?page=2&status=WAITING_PUSH$/u);
  await expect(rowFor(pushTarget.businessNo)).toHaveCount(0);
  await expect.poll(() => commands.length).toBe(2);
  expect(commands).toHaveLength(2);
  expect(commands[1]).toMatchObject({
    body: commands[0]!.body,
    key: commands[0]!.key,
  });
  expect(commands[1]!.resultStatus).toBeGreaterThanOrEqual(200);
  expect(commands[1]!.resultStatus).toBeLessThan(300);

  const pushed = await readLeadThroughApi(request, pushTarget.id);
  expect(pushed).toMatchObject({
    status: 'WAITING_REVIEW',
    version: latestPushTarget.version + 1,
  });
  expect(await countLeadPushReceipts(pushTarget.id)).toBe(1);
  expect(await countLeadPushAudits(pushTarget.id)).toBe(1);
  await page.unroute(`**/api/v1/leads/${pushTarget.id}/push`);
});
