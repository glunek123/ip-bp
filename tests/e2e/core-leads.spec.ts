import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  allowInjectedFailures,
  coreLeadFixtures,
  countAdmissionReceipts,
  countLeadReceipts,
  countLeadPushAudits,
  countLeadPushReceipts,
  countLeadEvidenceDecisions,
  countLeadEvidenceReceipts,
  countLeadEvidenceAudits,
  countLeadReviewDecisions,
  countLeadWithdrawalApplications,
  countLeadWithdrawalAudits,
  countLeadWithdrawalConfirmations,
  countClientLeadReviewReceipts,
  countLeads,
  countStoredFiles,
  databaseCounts,
  disconnectCoreLeadTestDatabase,
  getCustomer,
  getLead,
  getLeadEvidenceDecision,
  getLeadReviewDecision,
  getLeadReviewDecisions,
  getLeadWithdrawalApplication,
  getMaterialAuditActions,
  getMaterialLifecycle,
  getMaterialByVersion,
  installMaterialStatusBarrier,
  markContentVersion,
  rejectAuditWrites,
  rejectLeadPushReceiptWrites,
  rejectLeadEvidenceDecisionWrites,
  rejectLeadEvidenceReceiptWrites,
  rejectLeadReviewDecisionWrites,
  rejectClientLeadReviewReceiptWrites,
  rejectWithdrawalApplicationWrites,
  rejectWithdrawalConfirmationWrites,
  rejectLeadProductWrites,
  rejectMaterialMetadataWrites,
  resetCoreLeadE2eData,
  removeLeadProducts,
  setClientAccountActive,
  setClientBindingActive,
  setClientUserActive,
  setCustomerStatus,
  setGrant,
  setTeamActive,
  setLeadCounter,
  setMaterialDeletedAt,
  startMaterialCleanup,
  verifyCoreLeadMigration,
} from '../support/core-lead-database.mjs';

const authorizationA = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const authorizationSelf = {
  Authorization: `Bearer ${coreLeadFixtures.tokenSelf}`,
};
const pdfBytes = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n',
);
const jpegBytes = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46,
]);

async function configureBrowser(page: Page) {
  await page.context().setExtraHTTPHeaders(authorizationA);
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        principalType: 'INTERNAL',
        user: {
          id: coreLeadFixtures.userA,
          displayName: '核心主管',
          username: 'core-lead-user-a',
        },
        department: { id: coreLeadFixtures.departmentA, name: 'CORE 知产部' },
        departments: [
          { id: coreLeadFixtures.departmentA, name: 'CORE 知产部' },
        ],
        customer: null,
        authorizationRevision: 1,
        expiresAt: '2099-01-01T00:00:00.000Z',
        csrfToken: '',
      }),
    }),
  );
}

type Uploaded = {
  materialId: string;
  contentVersionId: string;
  reservedOwnerId?: string;
};

async function upload(
  request: APIRequestContext,
  input: {
    ownerType: 'CUSTOMER' | 'LEAD_DRAFT';
    ownerId?: string;
    purpose: 'IDENTITY_FULL' | 'LEAD_SCREENSHOT';
    name: string;
    mime: string;
    bytes: Buffer;
  },
  headers = authorizationA,
): Promise<Uploaded> {
  const draft = await request.post('/api/v1/materials/upload-drafts', {
    headers,
    data: {
      ownerType: input.ownerType,
      ...(input.ownerId ? { ownerId: input.ownerId } : {}),
      category:
        input.ownerType === 'CUSTOMER'
          ? 'CUSTOMER_IDENTITY'
          : 'LEAD_SCREENSHOT',
      purpose: input.purpose,
      originalFilename: input.name,
      declaredMimeType: input.mime,
    },
  });
  expect(draft.status(), await draft.text()).toBe(201);
  const created: { id: string; ownerId: string } = await draft.json();
  const result = await request.put(
    `/api/v1/materials/upload-drafts/${created.id}/content`,
    {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: input.bytes,
    },
  );
  expect(result.status(), await result.text()).toBe(200);
  return result.json();
}

function leadInput(overrides: Record<string, unknown> = {}) {
  return {
    customerId: coreLeadFixtures.admittedCustomer,
    rightsHolderId: coreLeadFixtures.holder,
    caseType: 'CIVIL',
    infringementTypes: ['TRADEMARK'],
    source: 'ONLINE',
    platform: 'TAOBAO',
    foundAt: '2026-09-21T02:30:00.000Z',
    shopName: '真实测试店铺',
    needDisclose: false,
    products: [
      {
        title: '测试商品',
        quantity: 2,
        unitPrice: '1.50',
        commentCount: 3,
      },
    ],
    leadScreenshotContentVersionIds: [],
    ...overrides,
  };
}

async function createLead(
  request: APIRequestContext,
  input = leadInput(),
  key = randomUUID(),
  headers = authorizationA,
) {
  return request.post('/api/v1/leads', {
    headers: { ...headers, 'Idempotency-Key': key },
    data: input,
  });
}

async function createClientAccount(
  request: APIRequestContext,
  input: {
    customerId?: string;
    username?: string;
    password?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const username = input.username ?? `client-${randomUUID().slice(0, 8)}`;
  const password = input.password ?? 'client correct horse battery';
  const response = await request.post(
    `/api/v1/customers/${input.customerId ?? coreLeadFixtures.admittedCustomer}/client-accounts`,
    {
      headers: input.headers ?? authorizationA,
      data: { displayName: '企业审核员', username, password },
    },
  );
  expect(response.status(), await response.text()).toBe(201);
  return { account: await response.json(), username, password };
}

function pushLead(
  request: APIRequestContext,
  leadId: string,
  expectedVersion: number,
  key = randomUUID(),
  headers = authorizationA,
) {
  return request.post(`/api/v1/leads/${leadId}/push`, {
    headers: { ...headers, 'Idempotency-Key': key },
    data: { expectedVersion },
  });
}

function decideNoEvidence(
  request: APIRequestContext,
  leadId: string,
  expectedVersion: number,
  reason: string,
  key = randomUUID(),
  headers: Record<string, string> = authorizationA,
) {
  return request.post(`/api/v1/leads/${leadId}/evidence-decisions`, {
    headers: { ...headers, 'Idempotency-Key': key },
    data: { result: 'NO_EVIDENCE', reason, expectedVersion },
  });
}

async function loginClient(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<string> {
  const response = await request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://127.0.0.1:5174' },
    data: { username, password },
  });
  expect(response.status(), await response.text()).toBe(200);
  const session: { principalType: string; csrfToken: string } =
    await response.json();
  expect(session.principalType).toBe('CLIENT');
  return session.csrfToken;
}

function reviewLead(
  request: APIRequestContext,
  leadId: string,
  expectedVersion: number,
  csrfToken: string,
  key = randomUUID(),
  result: 'INFRINGEMENT' | 'NO_INFRINGEMENT' = 'INFRINGEMENT',
  reason?: string,
) {
  const data =
    result === 'INFRINGEMENT'
      ? { result, expectedVersion }
      : { result, reason, expectedVersion };
  return request.post(`/api/v1/client/leads/${leadId}/reviews`, {
    headers: { 'Idempotency-Key': key, 'X-CSRF-Token': csrfToken },
    data,
  });
}

async function archiveLeadForWithdrawal(
  request: APIRequestContext,
  csrfToken: string,
  input = leadInput(),
) {
  const created = await createLead(request, input);
  expect(created.status(), await created.text()).toBe(201);
  const lead: { id: string } = await created.json();
  expect((await pushLead(request, lead.id, 1)).status()).toBe(201);
  const reviewKey = randomUUID();
  const review = await reviewLead(
    request,
    lead.id,
    2,
    csrfToken,
    reviewKey,
    'NO_INFRINGEMENT',
    '原审核结论保持不变',
  );
  expect(review.status(), await review.text()).toBe(201);
  return { lead, reviewKey, reviewResult: await review.json() };
}

async function createInfringementReviewedLead(
  request: APIRequestContext,
  csrfToken: string,
) {
  const created = await createLead(request);
  expect(created.status(), await created.text()).toBe(201);
  const lead: { id: string } = await created.json();
  expect((await pushLead(request, lead.id, 1)).status()).toBe(201);
  const reviewed = await reviewLead(request, lead.id, 2, csrfToken);
  expect(reviewed.status(), await reviewed.text()).toBe(201);
  return lead;
}

function applyLeadWithdrawal(
  request: APIRequestContext,
  leadId: string,
  expectedVersion: number,
  reason: string,
  key = randomUUID(),
  headers = authorizationA,
) {
  return request.post(`/api/v1/leads/${leadId}/withdrawal-applications`, {
    headers: { ...headers, 'Idempotency-Key': key },
    data: { reason, expectedVersion },
  });
}

function confirmLeadWithdrawal(
  request: APIRequestContext,
  leadId: string,
  applicationId: string,
  expectedVersion: number,
  csrfToken: string,
  key = randomUUID(),
) {
  return request.post(
    `/api/v1/client/leads/${leadId}/withdrawal-confirmations`,
    {
      headers: { 'Idempotency-Key': key, 'X-CSRF-Token': csrfToken },
      data: { applicationId, expectedVersion },
    },
  );
}

function admissionInput(versionIds: string[]) {
  return {
    expectedVersion: 1,
    customerType: 'ENTERPRISE',
    name: '待准入客户',
    identityType: 'BUSINESS_LICENSE',
    identityNumber: 'CORE-ADMIT-001',
    identityValidityMode: 'LONG_TERM',
    admissionContactName: '张主管',
    admissionContactPhone: '13800000000',
    identityDocumentContentVersionIds: versionIds,
  };
}

test.beforeEach(async () => {
  await resetCoreLeadE2eData();
});

test.afterAll(async () => {
  await disconnectCoreLeadTestDatabase();
});

test('authorized supervisor admits a customer with real PDF and JPEG bytes', async ({
  page,
  request,
}) => {
  await configureBrowser(page);
  await page.goto(`/customers/${coreLeadFixtures.draftCustomer}`);
  await expect(page.getByRole('heading', { name: '待准入客户' })).toBeVisible();
  await page.getByLabel('客户组织类型').selectOption('ENTERPRISE');
  await page.getByLabel('身份证明类型').selectOption('BUSINESS_LICENSE');
  await expect(page.getByText('完整身份证明材料')).toBeVisible();
  const picker = page.locator('input[name="identityDocument"]');
  await picker.setInputFiles({
    name: 'license.pdf',
    mimeType: 'application/pdf',
    buffer: pdfBytes,
  });
  await expect(page.getByText('license.pdf')).toBeVisible();
  await upload(request, {
    ownerType: 'CUSTOMER',
    ownerId: coreLeadFixtures.draftCustomer,
    purpose: 'IDENTITY_FULL',
    name: 'license.jpg',
    mime: 'image/jpeg',
    bytes: jpegBytes,
  });

  const materials = await request.get(
    `/api/v1/materials?ownerType=CUSTOMER&ownerId=${coreLeadFixtures.draftCustomer}`,
    { headers: authorizationA },
  );
  const listed: {
    items: Array<{
      id: string;
      currentVersionId: string;
      contentVersions: Array<{ id: string; originalFilename: string }>;
    }>;
  } = await materials.json();
  expect(listed.items).toHaveLength(2);
  expect(JSON.stringify(listed)).not.toContain('storageKey');
  expect(JSON.stringify(listed)).not.toContain('uploadedBy');
  expect(JSON.stringify(listed)).not.toContain('departmentId');
  for (const item of listed.items) {
    const downloaded = await request.get(
      `/api/v1/materials/${item.id}/versions/${item.currentVersionId}/content`,
      { headers: authorizationA },
    );
    expect(downloaded.status()).toBe(200);
    const filename = item.contentVersions.find(
      (version) => version.id === item.currentVersionId,
    )?.originalFilename;
    expect(await downloaded.body()).toEqual(
      filename === 'license.pdf' ? pdfBytes : jpegBytes,
    );
  }

  await page.getByLabel('证件号码').fill('CORE-ADMIT-001');
  await page.getByLabel('有效期类型').selectOption('LONG_TERM');
  await page.getByLabel('联系人姓名').fill('张主管');
  await page.getByLabel('电话').fill('13800000000');
  await page.locator('[data-test="admit-submit"]').click();
  await expect(
    page.getByText('客户已完成准入，可用于创建正式线索。'),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('客户已完成准入，可用于创建正式线索。'),
  ).toBeVisible();
  await expect(
    getCustomer(coreLeadFixtures.draftCustomer),
  ).resolves.toMatchObject({
    profileStatus: 'ADMITTED',
    version: 2,
  });
});

test('operator creates, refreshes, views, and edits a waiting-push lead', async ({
  page,
}) => {
  await configureBrowser(page);
  await page.goto('/leads');
  const counters = page.locator('[data-test="lead-counter"]');
  await expect(counters).toHaveCount(4);
  await expect(counters).toHaveText([
    '待推送0',
    '线索待审核1',
    '线索待确认1',
    '线索已归档1',
  ]);
  await page.locator('[data-test="create-lead"]').click();
  await expect(page.locator('.required-mark').first()).toBeVisible();
  await page
    .locator('select[name="customerId"]')
    .selectOption(coreLeadFixtures.admittedCustomer);
  await expect(page.locator('select[name="rightsHolderId"]')).toHaveValue(
    coreLeadFixtures.holder,
  );
  await expect(page.getByText('已按客户自动带出')).toBeVisible();
  await page.getByLabel('拟办理业务类型').selectOption('CIVIL');
  await page.getByLabel('发现时间').fill('2026-09-21T10:30');
  await page.getByLabel('线索来源').selectOption('ONLINE');
  await page.getByLabel('发现平台').selectOption('TAOBAO');
  await page.getByLabel('店铺名称').fill('浏览器店铺');
  await page.getByLabel('商标权').check();
  await page.locator('input[name="productTitle-0"]').fill('浏览器商品');
  await page.locator('input[name="quantity-0"]').fill('2');
  await page.locator('input[name="unitPrice-0"]').fill('1.50');
  await page.locator('input[name="commentCount-0"]').fill('3');
  await expect(page.locator('[data-test="estimate-0"]')).toContainText('3.00');
  await page.locator('input[name="screenshots"]').setInputFiles({
    name: 'lead.jpg',
    mimeType: 'image/jpeg',
    buffer: jpegBytes,
  });
  await page.getByRole('button', { name: '创建线索' }).click();
  await expect(page.getByRole('heading', { name: /^LD-/u })).toBeVisible();
  await expect(page.getByText('浏览器店铺', { exact: true })).toBeVisible();
  await expect(page.getByText('lead.jpg')).toBeVisible();
  const id = page.url().split('/').at(-1)!;
  await page.reload();
  await page.locator('[data-test="edit-lead"]').click();
  await page.getByLabel('店铺名称').fill('浏览器店铺已修改');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(
    page.getByText('浏览器店铺已修改', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText('版本 2')).toBeVisible();
  await expect(getLead(id)).resolves.toMatchObject({
    version: 2,
    shopName: '浏览器店铺已修改',
  });
});

test('real operator and client logins persist infringement review, screenshot and operator follow-up in one browser chain', async ({
  page,
}) => {
  const clientUsername = `browser-client-${randomUUID().slice(0, 8)}`;
  const clientPassword = 'browser client password 2026';

  await page.goto('/customers');
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/u);

  await page.getByRole('link', { name: '已准入客户' }).click();
  await expect(
    page.locator('[data-test="client-account-panel"]'),
  ).toBeVisible();
  await page.getByLabel('客户侧使用人姓名').fill('浏览器企业审核员');
  await expect(page.getByText('初始密码至少 12 个字符')).toBeVisible();
  await page.getByLabel('用户名').fill(clientUsername);
  await page.getByLabel('初始密码').fill(clientPassword);
  await page.locator('[data-test="create-client-account"]').click();
  await expect(page.getByText('账号已创建并绑定')).toBeVisible();
  await expect(page.getByText(clientUsername)).toBeVisible();

  await page.locator('[data-test="lead-nav"]').click();
  await page.locator('[data-test="create-lead"]').click();
  await page
    .locator('select[name="customerId"]')
    .selectOption(coreLeadFixtures.admittedCustomer);
  await expect(page.locator('select[name="rightsHolderId"]')).toHaveValue(
    coreLeadFixtures.holder,
  );
  await page.getByLabel('拟办理业务类型').selectOption('CIVIL');
  await page.getByLabel('发现时间').fill('2026-09-22T10:30');
  await page.getByLabel('线索来源').selectOption('ONLINE');
  await page.getByLabel('发现平台').selectOption('TAOBAO');
  await page.getByLabel('店铺名称').fill('客户端闭环店铺');
  await page.getByLabel('商标权').check();
  await page.locator('input[name="productTitle-0"]').fill('客户端闭环商品');
  await page.locator('input[name="quantity-0"]').fill('2');
  await page.locator('input[name="unitPrice-0"]').fill('8.00');
  await page.locator('input[name="commentCount-0"]').fill('0');
  await page.locator('input[name="screenshots"]').setInputFiles({
    name: 'client-review.jpg',
    mimeType: 'image/jpeg',
    buffer: jpegBytes,
  });
  await page.getByRole('button', { name: '创建线索' }).click();
  await expect(page.getByRole('heading', { name: /^LD-/u })).toBeVisible();
  const leadId = page.url().split('/').at(-1)!;

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('状态将变为“线索待审核”');
    await dialog.dismiss();
  });
  await page.locator('[data-test="push-lead"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('待推送');

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('已准入客户');
    await dialog.accept();
  });
  await page.locator('[data-test="push-lead"]').click();
  await expect(page.locator('[data-test="push-success"]')).toContainText(
    '已推送给客户审核',
  );
  await expect(page.locator('.page-head .pill')).toHaveText('线索待审核');
  await expect(page.locator('[data-test="push-record"]')).toContainText(
    '核心主管',
  );

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel('用户名').fill(clientUsername);
  await page.getByLabel('密码').fill(clientPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/client\/leads$/u);
  const row = page.locator('[data-test="client-lead-row"]');
  await expect(row).toContainText('客户端闭环店铺');
  await row.getByRole('link').click();
  await expect(page).toHaveURL(
    new RegExp(`/client/leads/${leadId}(\\?|$)`, 'u'),
  );
  await expect(page.getByText('客户端闭环商品')).toBeVisible();
  await expect(page.getByText('client-review.jpg')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.locator('[data-test^="download-screenshot-"]').click();
  const originalDownload = await download;
  await expect(originalDownload.suggestedFilename()).toBe('client-review.jpg');
  expect(await readFile(await originalDownload.path())).toEqual(jpegBytes);
  await page.reload();
  await expect(page.getByText('客户端闭环店铺')).toBeVisible();
  await expect(page.getByText('client-review.jpg')).toBeVisible();
  await expect(
    page.locator('[data-test="confirm-infringement"]'),
  ).toBeVisible();

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('不能撤回');
    await dialog.dismiss();
  });
  await page.locator('[data-test="confirm-infringement"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('线索待审核');
  expect(await countLeadReviewDecisions(leadId)).toBe(0);

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('线索待确认');
    await dialog.accept();
  });
  await page.locator('[data-test="confirm-infringement"]').click();
  const clientRecord = page.locator('[data-test="client-review-record"]');
  await expect(clientRecord).toContainText('确认侵权');
  await expect(clientRecord).toContainText('浏览器企业审核员');
  await expect(clientRecord).toContainText('等待运营确认是否取证');
  const reviewerTime = (await clientRecord.locator('p').nth(2).textContent())
    ?.replace('审核时间：', '')
    .trim();
  expect(reviewerTime).toBeTruthy();
  await expect(page.locator('.page-head .pill')).toHaveText('线索待确认');
  expect(await countLeadReviewDecisions(leadId)).toBe(1);
  expect(await countClientLeadReviewReceipts(leadId)).toBe(1);

  await page.reload();
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText('浏览器企业审核员');
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText(reviewerTime!);
  const afterReviewDownload = page.waitForEvent('download');
  await page.locator('[data-test^="download-screenshot-"]').click();
  expect(await readFile(await (await afterReviewDownload).path())).toEqual(
    jpegBytes,
  );

  await page.getByRole('link', { name: /返回待审核线索/u }).click();
  await page.locator('[data-test="client-view-processed"]').click();
  await expect(
    page.getByRole('heading', { name: '已处理线索', exact: true }),
  ).toBeVisible();
  const processedRow = page.locator('[data-test="client-lead-row"]');
  await expect(processedRow).toContainText('客户端闭环店铺');
  await processedRow.getByRole('link').click();
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText(reviewerTime!);

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/u);
  await page.goto('/leads?status=WAITING_EVIDENCE_DECISION');
  const operatorRow = page
    .locator('[data-test="lead-row"]')
    .filter({ hasText: '客户端闭环店铺' });
  await expect(operatorRow).toContainText('线索待确认');
  await operatorRow.getByRole('link').click();
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText('浏览器企业审核员');
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText(reviewerTime!);
  const noEvidenceReason = '现场取证成本与现有材料不匹配，本次不再取证';
  await expect(
    page.locator('[data-test="no-evidence-reason"]'),
  ).toHaveAttribute('aria-required', 'true');
  await page.locator('[data-test="no-evidence-reason"]').fill(noEvidenceReason);
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('当前页面不能撤回');
    dialog.accept();
  });
  await page.locator('[data-test="archive-no-evidence"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('线索已归档');
  await expect(
    page.locator('[data-test="evidence-decision-record"]'),
  ).toContainText(noEvidenceReason);
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText(reviewerTime!);

  await page.reload();
  await expect(
    page.locator('[data-test="evidence-decision-record"]'),
  ).toContainText(noEvidenceReason);
  await page.getByRole('button', { name: '退出登录' }).click();
  await page.getByLabel('用户名').fill(clientUsername);
  await page.getByLabel('密码').fill(clientPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('[data-test="client-view-processed"]').click();
  await page
    .locator('[data-test="client-lead-row"]')
    .filter({ hasText: '客户端闭环店铺' })
    .getByRole('link')
    .click();
  await expect(
    page.locator('[data-test="client-evidence-decision-record"]'),
  ).toContainText(noEvidenceReason);
  await expect(page.getByText('下一步：等待运营确认是否取证')).toHaveCount(0);
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText(reviewerTime!);
  const archivedDownload = page.waitForEvent('download');
  await page.locator('[data-test^="download-screenshot-"]').click();
  expect(await readFile(await (await archivedDownload).path())).toEqual(
    jpegBytes,
  );
  await page.reload();
  await expect(
    page.locator('[data-test="client-evidence-decision-record"]'),
  ).toContainText(noEvidenceReason);
});

test('real operator and client logins archive a no-infringement review and preserve it across refresh and processed view', async ({
  page,
}) => {
  const clientUsername = `archive-client-${randomUUID().slice(0, 8)}`;
  const clientPassword = 'archive client password 2026';
  const reason = '经核对，浏览器证据中的商品未使用我司权利标识';

  await page.goto('/customers');
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/u);

  await page.getByRole('link', { name: '已准入客户' }).click();
  await expect(
    page.locator('[data-test="client-account-panel"]'),
  ).toBeVisible();
  await page.getByLabel('客户侧使用人姓名').fill('归档浏览器审核员');
  await page.getByLabel('用户名').fill(clientUsername);
  await page.getByLabel('初始密码').fill(clientPassword);
  await page.locator('[data-test="create-client-account"]').click();
  await expect(page.getByText('账号已创建并绑定')).toBeVisible();

  await page.locator('[data-test="lead-nav"]').click();
  await page.locator('[data-test="create-lead"]').click();
  await page
    .locator('select[name="customerId"]')
    .selectOption(coreLeadFixtures.admittedCustomer);
  await page.getByLabel('拟办理业务类型').selectOption('CIVIL');
  await page.getByLabel('发现时间').fill('2026-09-22T10:30');
  await page.getByLabel('线索来源').selectOption('ONLINE');
  await page.getByLabel('发现平台').selectOption('TAOBAO');
  await page.getByLabel('店铺名称').fill('不侵权浏览器链路店铺');
  await page.getByLabel('商标权').check();
  await page.locator('input[name="productTitle-0"]').fill('待归档浏览器商品');
  await page.locator('input[name="quantity-0"]').fill('1');
  await page.locator('input[name="unitPrice-0"]').fill('12.00');
  await page.locator('input[name="commentCount-0"]').fill('0');
  await page.locator('input[name="screenshots"]').setInputFiles({
    name: 'archive-review.jpg',
    mimeType: 'image/jpeg',
    buffer: jpegBytes,
  });
  await page.getByRole('button', { name: '创建线索' }).click();
  await expect(page.getByRole('heading', { name: /^LD-/u })).toBeVisible();
  const leadId = page.url().split('/').at(-1)!;

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('[data-test="push-lead"]').click();
  await expect(page.locator('[data-test="push-success"]')).toContainText(
    '已推送给客户审核',
  );
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel('用户名').fill(clientUsername);
  await page.getByLabel('密码').fill(clientPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/client\/leads$/u);
  const row = page.locator('[data-test="client-lead-row"]');
  await expect(row).toContainText('不侵权浏览器链路店铺');
  await row.getByRole('link').click();
  await expect(page).toHaveURL(
    new RegExp(`/client/leads/${leadId}(\\?|$)`, 'u'),
  );
  await expect(page.getByText('archive-review.jpg')).toBeVisible();
  const screenshot = page.waitForEvent('download');
  await page.locator('[data-test^="download-screenshot-"]').click();
  expect(await readFile(await (await screenshot).path())).toEqual(jpegBytes);

  const reasonInput = page.locator('[data-test="no-infringement-reason"]');
  await expect(reasonInput).toHaveAttribute('aria-required', 'true');
  await reasonInput.fill(`  ${reason}  `);
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('当前版本不能在页面直接撤回');
    dialog.accept();
  });
  await page.locator('[data-test="confirm-no-infringement"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('线索已归档');
  const record = page.locator('[data-test="client-review-record"]');
  await expect(record).toContainText('判定不侵权并归档');
  await expect(record).toContainText(reason);
  await expect(record).toContainText('归档浏览器审核员');
  const archivedTime = (await record.locator('p').nth(4).textContent())
    ?.replace('归档时间：', '')
    .trim();
  expect(archivedTime).toBeTruthy();
  expect(await countLeadReviewDecisions(leadId)).toBe(1);
  expect(await countClientLeadReviewReceipts(leadId)).toBe(1);

  await page.reload();
  await expect(
    page.locator('[data-test="confirm-no-infringement"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText(reason);
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText(archivedTime!);
  const afterArchiveDownload = page.waitForEvent('download');
  await page.locator('[data-test^="download-screenshot-"]').click();
  expect(await readFile(await (await afterArchiveDownload).path())).toEqual(
    jpegBytes,
  );

  await page.getByRole('link', { name: /返回待审核线索/u }).click();
  await page.locator('[data-test="client-view-processed"]').click();
  await expect(page).toHaveURL(/view=processed/u);
  await expect(page.locator('[data-test="client-lead-row"]')).toContainText(
    '不侵权浏览器链路店铺',
  );
  await page.locator('[data-test="client-lead-row"] a').click();
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText(archivedTime!);

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/u);
  await page.goto('/leads?status=ARCHIVED');
  const operatorRow = page
    .locator('[data-test="lead-row"]')
    .filter({ hasText: '不侵权浏览器链路店铺' });
  await expect(operatorRow).toContainText('线索已归档');
  await operatorRow.getByRole('link').click();
  const operatorRecord = page.locator('[data-test="client-review-record"]');
  await expect(operatorRecord).toContainText(reason);
  await expect(operatorRecord).toContainText(archivedTime!);

  const originalDecision = await getLeadReviewDecision(leadId);
  expect(originalDecision).toMatchObject({
    result: 'NO_INFRINGEMENT',
    reason,
    archiveType: 'NO_INFRINGEMENT',
    fromVersion: 2,
    toVersion: 3,
  });
  const applicationReason = '发现新的权属证明，请原客户企业复核';
  await page.locator('[data-test="withdrawal-reason"]').fill(applicationReason);
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('仍保持归档');
    return dialog.accept();
  });
  await page.locator('[data-test="apply-withdrawal"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('线索已归档');
  await expect(page.locator('[data-test="withdrawal-success"]')).toContainText(
    '等待原客户企业确认',
  );
  const application = await getLeadWithdrawalApplication(leadId);
  expect(application).toMatchObject({
    reason: applicationReason,
    fromVersion: 3,
    toVersion: 4,
    confirmation: null,
  });
  expect(application?.resultSnapshot).toMatchObject({
    status: 'ARCHIVED',
    version: 4,
    reason: applicationReason,
  });
  expect(await getLead(leadId)).toMatchObject({
    status: 'ARCHIVED',
    version: 4,
    activeReviewDecisionId: originalDecision?.id,
  });
  expect(await countLeadWithdrawalAudits(leadId)).toBe(1);

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel('用户名').fill(clientUsername);
  await page.getByLabel('密码').fill(clientPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/client\/leads$/u);
  const pendingRow = page.locator('[data-test="client-lead-row"]');
  await expect(pendingRow).toContainText('待确认撤回');
  await expect(pendingRow).toContainText('不侵权浏览器链路店铺');
  await page.locator('[data-test="client-view-processed"]').click();
  await expect(
    page.getByRole('heading', { name: '已处理线索', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator('[data-test="client-lead-row"]')
      .filter({ hasText: '不侵权浏览器链路店铺' }),
  ).toHaveCount(0);
  await page.locator('[data-test="client-view-pending"]').click();
  await expect(
    page.getByRole('heading', { name: '待我审核', exact: true }),
  ).toBeVisible();
  await pendingRow.getByRole('link').click();
  await expect(
    page.locator('[data-test="withdrawal-application"]'),
  ).toContainText(applicationReason);
  await expect(page.locator('[data-test="confirm-withdrawal"]')).toBeVisible();
  const firstScreenshot = page.waitForEvent('download');
  await page.locator('[data-test^="download-screenshot-"]').click();
  expect(await readFile(await (await firstScreenshot).path())).toEqual(
    jpegBytes,
  );
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('原结论和归档记录保留');
    return dialog.accept();
  });
  await page.locator('[data-test="confirm-withdrawal"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('线索待审核');
  await expect(page.locator('[data-test="withdrawal-success"]')).toContainText(
    '原结论和归档记录仍保留',
  );
  expect(await getLead(leadId)).toMatchObject({
    status: 'WAITING_REVIEW',
    version: 5,
    activeReviewDecisionId: null,
  });
  const confirmedApplication = await getLeadWithdrawalApplication(leadId);
  expect(confirmedApplication?.confirmation).toMatchObject({
    fromVersion: 4,
    toVersion: 5,
    resultSnapshot: expect.objectContaining({ status: 'WAITING_REVIEW' }),
  });
  expect(await countLeadWithdrawalConfirmations(leadId)).toBe(1);
  expect(await countLeadReviewDecisions(leadId)).toBe(1);
  await page.reload();
  await expect(page.locator('.page-head .pill')).toHaveText('线索待审核');
  await expect(
    page.locator('[data-test="client-withdrawal-history"]'),
  ).toContainText(reason);
  await expect(
    page.locator('[data-test="client-withdrawal-history"]'),
  ).toContainText(applicationReason);
  const afterConfirmationDownload = page.waitForEvent('download');
  await page.locator('[data-test^="download-screenshot-"]').click();
  expect(
    await readFile(await (await afterConfirmationDownload).path()),
  ).toEqual(jpegBytes);

  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('当前入口不能撤回');
    return dialog.accept();
  });
  await page.locator('[data-test="confirm-infringement"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('线索待确认');
  expect(await countLeadReviewDecisions(leadId)).toBe(2);
  expect(await countClientLeadReviewReceipts(leadId)).toBe(2);
  await page.reload();
  await expect(page.locator('.page-head .pill')).toHaveText('线索待确认');
  await expect(
    page.locator('[data-test="client-withdrawal-history"]'),
  ).toContainText('确认侵权');
  await expect(
    page.locator('[data-test="client-withdrawal-history"]'),
  ).toContainText('客户确认撤回');

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/u);
  await page.goto('/leads?status=WAITING_EVIDENCE_DECISION');
  const finalOperatorRow = page
    .locator('[data-test="lead-row"]')
    .filter({ hasText: '不侵权浏览器链路店铺' });
  await expect(finalOperatorRow).toContainText('线索待确认');
  await finalOperatorRow.getByRole('link').click();
  await expect(page.locator('[data-test="withdrawal-history"]')).toContainText(
    reason,
  );
  await expect(page.locator('[data-test="withdrawal-history"]')).toContainText(
    applicationReason,
  );
  await expect(page.locator('[data-test="withdrawal-history"]')).toContainText(
    '客户确认撤回',
  );
  const decisions = await getLeadReviewDecisions(leadId);
  expect(decisions.map((decision) => decision.result)).toEqual([
    'NO_INFRINGEMENT',
    'INFRINGEMENT',
  ]);
  expect(decisions[0].receipt?.resultSnapshot).toMatchObject({
    status: 'ARCHIVED',
    version: 3,
    reviewDecision: { reason },
  });
  expect(await getLeadReviewDecision(leadId)).toMatchObject({
    result: 'INFRINGEMENT',
    fromVersion: 5,
    toVersion: 6,
  });
  expect(await getLead(leadId)).toMatchObject({
    status: 'WAITING_EVIDENCE_DECISION',
    version: 6,
  });
});

test('Demo-aligned shell works on desktop and mobile', async ({ page }) => {
  await configureBrowser(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/leads');
  await expect(page.locator('[data-test="app-sidebar"]')).toBeVisible();
  await expect(page.locator('[data-test="mobile-nav-toggle"]')).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-test="app-sidebar"]')).toBeHidden();
  await page.locator('[data-test="mobile-nav-toggle"]').click();
  await expect(page.locator('[data-test="app-sidebar"]')).toBeVisible();
  await page.locator('[data-test="lead-counter"]').first().click();
  await expect(page.locator('[data-test="app-sidebar"]')).toBeHidden();
});

test('product estimates use quantity then comments and reject invalid counts', async ({
  request,
}) => {
  const response = await createLead(
    request,
    leadInput({
      products: [
        { title: '销量优先', quantity: 2, unitPrice: '1.50', commentCount: 3 },
        { title: '评论回退', quantity: 0, unitPrice: '1.50', commentCount: 3 },
      ],
    }),
  );
  expect(response.status(), await response.text()).toBe(201);
  const created: { id: string; products: Array<{ estimatedAmount: string }> } =
    await response.json();
  expect(created.products.map((item) => item.estimatedAmount)).toEqual([
    '3.00',
    '4.50',
  ]);
  const stored = await getLead(created.id);
  expect(
    stored?.products.map((item) => item.estimatedAmount.toFixed(2)),
  ).toEqual(['3.00', '4.50']);
  for (const quantity of [-2, 1.5]) {
    const invalid = await createLead(
      request,
      leadInput({
        products: [
          { title: '非法数量', quantity, unitPrice: '1.00', commentCount: 0 },
        ],
      }),
    );
    expect(invalid.status()).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  }
});

test('draft, unlinked, cross-department, unauthorized, and foreign material facts stay hidden', async ({
  request,
}) => {
  const attempts = [
    leadInput({ customerId: coreLeadFixtures.draftCustomer }),
    leadInput({ rightsHolderId: coreLeadFixtures.unlinkedHolder }),
    leadInput({
      customerId: coreLeadFixtures.foreignCustomer,
      rightsHolderId: coreLeadFixtures.foreignHolder,
    }),
  ];
  for (const input of attempts) {
    const response = await createLead(request, input);
    expect(response.status()).toBe(404);
    const body = await response.text();
    expect(body).not.toContain(coreLeadFixtures.foreignCustomer);
    expect(body).not.toContain('外部门客户');
  }
  await setGrant('lead.create', false);
  const forbidden = await createLead(request);
  expect(forbidden.status()).toBe(403);
  expect(await forbidden.json()).toMatchObject({ code: 'ACTION_FORBIDDEN' });

  const foreign = await upload(
    request,
    {
      ownerType: 'CUSTOMER',
      ownerId: coreLeadFixtures.selfCustomer,
      purpose: 'IDENTITY_FULL',
      name: 'foreign.pdf',
      mime: 'application/pdf',
      bytes: pdfBytes,
    },
    authorizationSelf,
  );
  const denied = await request.post(
    `/api/v1/customers/${coreLeadFixtures.draftCustomer}/admission`,
    {
      headers: { ...authorizationA, 'Idempotency-Key': randomUUID() },
      data: admissionInput([foreign.contentVersionId]),
    },
  );
  expect(denied.status()).toBe(400);
  const deniedBody = await denied.json();
  expect(deniedBody).toMatchObject({ code: 'MATERIAL_VERSION_INVALID' });
  expect(JSON.stringify(deniedBody)).not.toContain(
    coreLeadFixtures.selfCustomer,
  );

  await setGrant('lead.create', true);
  const own = await upload(request, {
    ownerType: 'CUSTOMER',
    ownerId: coreLeadFixtures.draftCustomer,
    purpose: 'IDENTITY_FULL',
    name: 'expired.pdf',
    mime: 'application/pdf',
    bytes: pdfBytes,
  });
  await markContentVersion(own.contentVersionId, 'DELETED');
  const expired = await request.post(
    `/api/v1/customers/${coreLeadFixtures.draftCustomer}/admission`,
    {
      headers: { ...authorizationA, 'Idempotency-Key': randomUUID() },
      data: admissionInput([own.contentVersionId]),
    },
  );
  expect(expired.status()).toBe(400);
  expect(await expired.json()).toMatchObject({
    code: 'MATERIAL_VERSION_INVALID',
  });
});

test('customer admission and lead creation are idempotent while stale edits conflict', async ({
  request,
}) => {
  const material = await upload(request, {
    ownerType: 'CUSTOMER',
    ownerId: coreLeadFixtures.draftCustomer,
    purpose: 'IDENTITY_FULL',
    name: 'admit.pdf',
    mime: 'application/pdf',
    bytes: pdfBytes,
  });
  const key = randomUUID();
  const command = admissionInput([material.contentVersionId]);
  const first = await request.post(
    `/api/v1/customers/${coreLeadFixtures.draftCustomer}/admission`,
    {
      headers: { ...authorizationA, 'Idempotency-Key': key },
      data: command,
    },
  );
  const retry = await request.post(
    `/api/v1/customers/${coreLeadFixtures.draftCustomer}/admission`,
    {
      headers: { ...authorizationA, 'Idempotency-Key': key },
      data: command,
    },
  );
  expect(first.status()).toBe(201);
  expect(await retry.json()).toEqual(await first.json());
  expect(await countAdmissionReceipts()).toBe(1);
  const conflict = await request.post(
    `/api/v1/customers/${coreLeadFixtures.draftCustomer}/admission`,
    {
      headers: { ...authorizationA, 'Idempotency-Key': key },
      data: { ...command, admissionContactName: '不同指纹' },
    },
  );
  expect(conflict.status()).toBe(409);

  const leadKey = randomUUID();
  const leadFirst = await createLead(request, leadInput(), leadKey);
  const leadRetry = await createLead(request, leadInput(), leadKey);
  expect(leadFirst.status()).toBe(201);
  const lead = await leadFirst.json();
  expect(await leadRetry.json()).toEqual(lead);
  expect(await countLeadReceipts()).toBe(1);
  const leadConflict = await createLead(
    request,
    leadInput({ shopName: '不同指纹' }),
    leadKey,
  );
  expect(leadConflict.status()).toBe(409);
  const updated = await request.patch(`/api/v1/leads/${lead.id}`, {
    headers: authorizationA,
    data: {
      ...leadInput(),
      customerId: undefined,
      rightsHolderId: undefined,
      expectedVersion: 1,
    },
  });
  expect(updated.status()).toBe(200);
  const stale = await request.patch(`/api/v1/leads/${lead.id}`, {
    headers: authorizationA,
    data: {
      ...leadInput(),
      customerId: undefined,
      rightsHolderId: undefined,
      expectedVersion: 1,
    },
  });
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
});

test('push revalidates account, permission, customer, products, state, version, idempotency, and concurrency', async ({
  request,
}) => {
  const unavailableLeadResponse = await createLead(request);
  const unavailableLead = await unavailableLeadResponse.json();
  const unavailable = await pushLead(request, unavailableLead.id, 1);
  expect(unavailable.status()).toBe(409);
  expect(await unavailable.json()).toMatchObject({
    code: 'CLIENT_ACCOUNT_UNAVAILABLE',
  });

  await createClientAccount(request);
  const key = randomUUID();
  const first = await pushLead(request, unavailableLead.id, 1, key);
  expect(first.status(), await first.text()).toBe(201);
  const firstResult = await first.json();
  const replay = await pushLead(request, unavailableLead.id, 1, key);
  expect(replay.status()).toBe(201);
  expect(await replay.json()).toEqual(firstResult);
  expect(await countLeadPushAudits(unavailableLead.id)).toBe(1);
  expect(await countLeadPushReceipts(unavailableLead.id)).toBe(1);

  const sameKeyDifferentRequest = await pushLead(
    request,
    unavailableLead.id,
    2,
    key,
  );
  expect(sameKeyDifferentRequest.status()).toBe(409);
  expect(await sameKeyDifferentRequest.json()).toMatchObject({
    code: 'IDEMPOTENCY_CONFLICT',
  });
  const wrongState = await pushLead(request, unavailableLead.id, 2);
  expect(wrongState.status()).toBe(409);
  expect(await wrongState.json()).toMatchObject({ code: 'INVALID_STATE' });

  const staleLeadResponse = await createLead(request);
  const staleLead = await staleLeadResponse.json();
  const updatedStaleLead = await request.patch(
    `/api/v1/leads/${staleLead.id}`,
    {
      headers: authorizationA,
      data: {
        ...leadInput(),
        customerId: undefined,
        rightsHolderId: undefined,
        expectedVersion: 1,
      },
    },
  );
  expect(updatedStaleLead.status()).toBe(200);
  const stale = await pushLead(request, staleLead.id, 1);
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });

  await setGrant('lead.push', false);
  const permissionLeadResponse = await createLead(request);
  const permissionLead = await permissionLeadResponse.json();
  const forbidden = await pushLead(request, permissionLead.id, 1);
  expect(forbidden.status()).toBe(403);
  expect(await forbidden.json()).toMatchObject({ code: 'ACTION_FORBIDDEN' });
  await setGrant('lead.push', true);

  await setClientAccountActive(coreLeadFixtures.admittedCustomer, false);
  const inactive = await pushLead(request, permissionLead.id, 1);
  expect(inactive.status()).toBe(409);
  expect(await inactive.json()).toMatchObject({
    code: 'CLIENT_ACCOUNT_UNAVAILABLE',
  });
  await setClientAccountActive(coreLeadFixtures.admittedCustomer, true);

  await setCustomerStatus(coreLeadFixtures.admittedCustomer, 'DRAFT');
  const notAdmitted = await pushLead(request, permissionLead.id, 1);
  expect(notAdmitted.status()).toBe(409);
  expect(await notAdmitted.json()).toMatchObject({
    code: 'CUSTOMER_NOT_ADMITTED',
  });
  await setCustomerStatus(coreLeadFixtures.admittedCustomer, 'ADMITTED');

  await removeLeadProducts(permissionLead.id);
  const withoutProducts = await pushLead(request, permissionLead.id, 1);
  expect(withoutProducts.status()).toBe(409);
  expect(await withoutProducts.json()).toMatchObject({
    code: 'LEAD_PRODUCTS_REQUIRED',
  });

  const concurrentLeadResponse = await createLead(request);
  const concurrentLead = await concurrentLeadResponse.json();
  const competitors = await Promise.all([
    pushLead(request, concurrentLead.id, 1),
    pushLead(request, concurrentLead.id, 1),
  ]);
  expect(
    competitors.filter((response) => response.status() === 201),
  ).toHaveLength(1);
  expect(
    competitors.filter((response) => response.status() === 409),
  ).toHaveLength(1);
  expect(await countLeadPushAudits(concurrentLead.id)).toBe(1);
  expect(await countLeadPushReceipts(concurrentLead.id)).toBe(1);
});

test('push rolls back status, audit, and receipt when either durable record fails', async ({
  request,
}) => {
  await createClientAccount(request);
  const auditLeadResponse = await createLead(request);
  const auditLead = await auditLeadResponse.json();
  await rejectAuditWrites('lead.pushed');
  const auditFailure = await pushLead(request, auditLead.id, 1);
  expect(auditFailure.status()).toBe(500);
  expect(await getLead(auditLead.id)).toMatchObject({
    status: 'WAITING_PUSH',
    version: 1,
    pushedAt: null,
    pushedByUserId: null,
  });
  expect(await countLeadPushAudits(auditLead.id)).toBe(0);
  expect(await countLeadPushReceipts(auditLead.id)).toBe(0);

  await rejectLeadPushReceiptWrites();
  const receiptLeadResponse = await createLead(request);
  const receiptLead = await receiptLeadResponse.json();
  const receiptFailure = await pushLead(request, receiptLead.id, 1);
  expect(receiptFailure.status()).toBe(500);
  expect(await getLead(receiptLead.id)).toMatchObject({
    status: 'WAITING_PUSH',
    version: 1,
    pushedAt: null,
    pushedByUserId: null,
  });
  expect(await countLeadPushAudits(receiptLead.id)).toBe(0);
  expect(await countLeadPushReceipts(receiptLead.id)).toBe(0);
  await allowInjectedFailures();
});

test('client session sees only its enterprise pushed leads and revocation is immediate', async ({
  request,
}) => {
  const clientA = await createClientAccount(request, {
    username: 'client-enterprise-a',
  });
  await createClientAccount(request, {
    customerId: coreLeadFixtures.foreignCustomer,
    username: 'client-enterprise-b',
    headers: { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
  });
  const ownResponse = await createLead(request);
  const own = await ownResponse.json();
  expect((await pushLead(request, own.id, 1)).status()).toBe(201);
  const internalReview = await request.post(
    `/api/v1/client/leads/${own.id}/reviews`,
    {
      headers: { ...authorizationA, 'Idempotency-Key': randomUUID() },
      data: { result: 'INFRINGEMENT', expectedVersion: 2 },
    },
  );
  expect(internalReview.status()).toBe(403);
  const waitingResponse = await createLead(request);
  const waiting = await waitingResponse.json();

  const foreignResponse = await createLead(
    request,
    leadInput({
      customerId: coreLeadFixtures.foreignCustomer,
      rightsHolderId: coreLeadFixtures.foreignHolder,
      shopName: '外企业线索',
    }),
    randomUUID(),
    { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
  );
  const foreign = await foreignResponse.json();
  expect(
    (
      await pushLead(request, foreign.id, 1, randomUUID(), {
        Authorization: `Bearer ${coreLeadFixtures.tokenB}`,
      })
    ).status(),
  ).toBe(201);

  const login = await request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://127.0.0.1:5174' },
    data: { username: clientA.username, password: clientA.password },
  });
  expect(login.status(), await login.text()).toBe(200);
  expect(await login.json()).toMatchObject({
    principalType: 'CLIENT',
    customer: { id: coreLeadFixtures.admittedCustomer },
    department: null,
  });

  const list = await request.get('/api/v1/client/leads?page=1&pageSize=20');
  expect(list.status(), await list.text()).toBe(200);
  const listed = await list.json();
  expect(listed.items.map((item: { id: string }) => item.id)).toEqual([own.id]);
  expect(JSON.stringify(listed)).not.toContain('responsibleUserId');
  expect(JSON.stringify(listed)).not.toContain('remark');

  expect((await request.get(`/api/v1/client/leads/${own.id}`)).status()).toBe(
    200,
  );
  expect(
    (await request.get(`/api/v1/client/leads/${waiting.id}`)).status(),
  ).toBe(404);
  expect(
    (await request.get(`/api/v1/client/leads/${foreign.id}`)).status(),
  ).toBe(404);

  await setClientAccountActive(coreLeadFixtures.admittedCustomer, false);
  const revoked = await request.get(`/api/v1/client/leads/${own.id}`);
  expect(revoked.status()).toBe(401);
  expect(await revoked.json()).toMatchObject({ code: 'UNAUTHORIZED' });
});

test('client review enforces enterprise scope, state, version and idempotency in PostgreSQL', async ({
  request,
}) => {
  const clientA = await createClientAccount(request);
  const clientB = await createClientAccount(request, {
    customerId: coreLeadFixtures.foreignCustomer,
    headers: { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
  });
  const own = await (await createLead(request)).json();
  const unpushed = await (await createLead(request)).json();
  const foreign = await (
    await createLead(
      request,
      leadInput({
        customerId: coreLeadFixtures.foreignCustomer,
        rightsHolderId: coreLeadFixtures.foreignHolder,
      }),
      randomUUID(),
      { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
    )
  ).json();
  expect((await pushLead(request, own.id, 1)).status()).toBe(201);
  expect(
    (
      await pushLead(request, foreign.id, 1, randomUUID(), {
        Authorization: `Bearer ${coreLeadFixtures.tokenB}`,
      })
    ).status(),
  ).toBe(201);

  const foreignCsrf = await loginClient(
    request,
    clientB.username,
    clientB.password,
  );
  expect((await reviewLead(request, own.id, 2, foreignCsrf)).status()).toBe(
    404,
  );
  const csrf = await loginClient(request, clientA.username, clientA.password);
  expect((await reviewLead(request, unpushed.id, 1, csrf)).status()).toBe(404);
  expect((await reviewLead(request, foreign.id, 2, csrf)).status()).toBe(404);
  const stale = await reviewLead(request, own.id, 1, csrf);
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });

  const key = randomUUID();
  const accepted = await reviewLead(request, own.id, 2, csrf, key);
  expect(accepted.status(), await accepted.text()).toBe(201);
  const firstResult = await accepted.json();
  expect(firstResult).toMatchObject({
    id: own.id,
    status: 'WAITING_EVIDENCE_DECISION',
    version: 3,
    reviewDecision: {
      result: 'INFRINGEMENT',
      reviewerDisplayName: '企业审核员',
    },
  });
  const persisted = await getLeadReviewDecision(own.id);
  expect(persisted).toMatchObject({
    result: 'INFRINGEMENT',
    fromVersion: 2,
    toVersion: 3,
  });
  expect(persisted?.decidedAt.toISOString()).toBe(
    firstResult.reviewDecision.decidedAt,
  );
  expect(await getLead(own.id)).toMatchObject({
    status: 'WAITING_EVIDENCE_DECISION',
    version: 3,
  });
  expect(await countLeadReviewDecisions(own.id)).toBe(1);
  expect(await countClientLeadReviewReceipts(own.id)).toBe(1);
  const replay = await reviewLead(request, own.id, 2, csrf, key);
  expect(replay.status()).toBe(201);
  expect(await replay.json()).toEqual(firstResult);
  const conflict = await reviewLead(request, own.id, 3, csrf, key);
  expect(conflict.status()).toBe(409);
  expect(await conflict.json()).toMatchObject({
    code: 'IDEMPOTENCY_CONFLICT',
  });
  const wrongState = await reviewLead(request, own.id, 3, csrf);
  expect(wrongState.status()).toBe(409);
  expect(await wrongState.json()).toMatchObject({ code: 'INVALID_STATE' });
  expect(await countLeadReviewDecisions(own.id)).toBe(1);
  expect(await countClientLeadReviewReceipts(own.id)).toBe(1);

  const processed = await request.get(
    '/api/v1/client/leads?view=PROCESSED&page=1&pageSize=20',
  );
  expect(processed.status()).toBe(200);
  expect(
    (await processed.json()).items.map((item: { id: string }) => item.id),
  ).toEqual([own.id]);
  const clientDetail = await request.get(`/api/v1/client/leads/${own.id}`);
  expect(clientDetail.status()).toBe(200);
  expect((await clientDetail.json()).reviewDecision).toEqual(
    firstResult.reviewDecision,
  );
  const operatorDetail = await request.get(`/api/v1/leads/${own.id}`, {
    headers: authorizationA,
  });
  expect(operatorDetail.status()).toBe(200);
  expect((await operatorDetail.json()).reviewDecision).toEqual(
    firstResult.reviewDecision,
  );

  await setClientAccountActive(coreLeadFixtures.admittedCustomer, false);
  expect((await request.get(`/api/v1/client/leads/${own.id}`)).status()).toBe(
    401,
  );
  expect((await reviewLead(request, own.id, 2, csrf, key)).status()).toBe(401);
  const retained = await request.get(`/api/v1/leads/${own.id}`, {
    headers: authorizationA,
  });
  expect(retained.status()).toBe(200);
  expect((await retained.json()).reviewDecision).toEqual(
    firstResult.reviewDecision,
  );
});

test('client no-infringement review validates reason and archives with a durable replay snapshot', async ({
  request,
}) => {
  const clientA = await createClientAccount(request);
  const clientB = await createClientAccount(request, {
    customerId: coreLeadFixtures.foreignCustomer,
    headers: { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
  });
  const own = await (await createLead(request)).json();
  const unpushed = await (await createLead(request)).json();
  const foreign = await (
    await createLead(
      request,
      leadInput({
        customerId: coreLeadFixtures.foreignCustomer,
        rightsHolderId: coreLeadFixtures.foreignHolder,
      }),
      randomUUID(),
      { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
    )
  ).json();
  expect((await pushLead(request, own.id, 1)).status()).toBe(201);
  expect(
    (
      await pushLead(request, foreign.id, 1, randomUUID(), {
        Authorization: `Bearer ${coreLeadFixtures.tokenB}`,
      })
    ).status(),
  ).toBe(201);

  const foreignCsrf = await loginClient(
    request,
    clientB.username,
    clientB.password,
  );
  expect(
    (
      await reviewLead(
        request,
        own.id,
        2,
        foreignCsrf,
        randomUUID(),
        'NO_INFRINGEMENT',
        '不侵权原因',
      )
    ).status(),
  ).toBe(404);
  const csrf = await loginClient(request, clientA.username, clientA.password);
  expect(
    (
      await reviewLead(
        request,
        unpushed.id,
        1,
        csrf,
        randomUUID(),
        'NO_INFRINGEMENT',
        '不侵权原因',
      )
    ).status(),
  ).toBe(404);
  expect(
    (
      await reviewLead(
        request,
        foreign.id,
        2,
        csrf,
        randomUUID(),
        'NO_INFRINGEMENT',
        '不侵权原因',
      )
    ).status(),
  ).toBe(404);

  for (const reason of ['', '   ', 'x'.repeat(5001), 7 as unknown as string]) {
    const invalid = await reviewLead(
      request,
      own.id,
      2,
      csrf,
      randomUUID(),
      'NO_INFRINGEMENT',
      reason,
    );
    expect(invalid.status(), await invalid.text()).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  }
  const stale = await reviewLead(
    request,
    own.id,
    1,
    csrf,
    randomUUID(),
    'NO_INFRINGEMENT',
    '合理原因',
  );
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });

  const key = randomUUID();
  const submitted = await reviewLead(
    request,
    own.id,
    2,
    csrf,
    key,
    'NO_INFRINGEMENT',
    '  经核对，该商品未使用我司权利标识  ',
  );
  expect(submitted.status(), await submitted.text()).toBe(201);
  const firstResult = await submitted.json();
  expect(firstResult).toMatchObject({
    id: own.id,
    status: 'ARCHIVED',
    version: 3,
    reviewDecision: {
      result: 'NO_INFRINGEMENT',
      reason: '经核对，该商品未使用我司权利标识',
      archiveType: 'NO_INFRINGEMENT',
      reviewerDisplayName: '企业审核员',
    },
  });
  expect(firstResult.reviewDecision.archivedAt).toBe(
    firstResult.reviewDecision.decidedAt,
  );
  const persisted = await getLeadReviewDecision(own.id);
  expect(persisted).toMatchObject({
    result: 'NO_INFRINGEMENT',
    reason: '经核对，该商品未使用我司权利标识',
    archiveType: 'NO_INFRINGEMENT',
    fromVersion: 2,
    toVersion: 3,
  });
  expect(persisted?.archivedAt?.toISOString()).toBe(
    firstResult.reviewDecision.archivedAt,
  );
  expect(await getLead(own.id)).toMatchObject({
    status: 'ARCHIVED',
    version: 3,
  });
  expect(await countLeadReviewDecisions(own.id)).toBe(1);
  expect(await countClientLeadReviewReceipts(own.id)).toBe(1);

  const replay = await reviewLead(
    request,
    own.id,
    2,
    csrf,
    key,
    'NO_INFRINGEMENT',
    '经核对，该商品未使用我司权利标识',
  );
  expect(replay.status()).toBe(201);
  expect(await replay.json()).toEqual(firstResult);
  const conflict = await reviewLead(
    request,
    own.id,
    2,
    csrf,
    key,
    'NO_INFRINGEMENT',
    '另一个原因',
  );
  expect(conflict.status()).toBe(409);
  expect(await conflict.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  const wrongState = await reviewLead(
    request,
    own.id,
    3,
    csrf,
    randomUUID(),
    'NO_INFRINGEMENT',
    '合理原因',
  );
  expect(wrongState.status()).toBe(409);
  expect(await wrongState.json()).toMatchObject({ code: 'INVALID_STATE' });
  expect(await countLeadReviewDecisions(own.id)).toBe(1);
  expect(await countClientLeadReviewReceipts(own.id)).toBe(1);

  const processed = await request.get(
    '/api/v1/client/leads?view=PROCESSED&page=1&pageSize=20',
  );
  expect(processed.status()).toBe(200);
  expect(
    (await processed.json()).items.map((item: { id: string }) => item.id),
  ).toContain(own.id);
  const clientDetail = await request.get(`/api/v1/client/leads/${own.id}`);
  expect(clientDetail.status()).toBe(200);
  expect((await clientDetail.json()).reviewDecision).toEqual(
    firstResult.reviewDecision,
  );
  const operatorDetail = await request.get(`/api/v1/leads/${own.id}`, {
    headers: authorizationA,
  });
  expect(operatorDetail.status()).toBe(200);
  expect((await operatorDetail.json()).reviewDecision).toEqual(
    firstResult.reviewDecision,
  );
});

test('distinct no-infringement keys race safely and injected writes roll back every fact', async ({
  request,
}) => {
  const client = await createClientAccount(request);
  const racing = await (await createLead(request)).json();
  const firstFailure = await (await createLead(request)).json();
  const secondFailure = await (await createLead(request)).json();
  for (const lead of [racing, firstFailure, secondFailure]) {
    expect((await pushLead(request, lead.id, 1)).status()).toBe(201);
  }
  const csrf = await loginClient(request, client.username, client.password);
  const responses = await Promise.all([
    reviewLead(
      request,
      racing.id,
      2,
      csrf,
      randomUUID(),
      'NO_INFRINGEMENT',
      '核对后确认无侵权',
    ),
    reviewLead(
      request,
      racing.id,
      2,
      csrf,
      randomUUID(),
      'NO_INFRINGEMENT',
      '核对后确认无侵权',
    ),
  ]);
  expect(
    responses.filter((response) => response.status() === 201),
  ).toHaveLength(1);
  expect(
    responses.filter((response) => response.status() === 409),
  ).toHaveLength(1);
  expect(await countLeadReviewDecisions(racing.id)).toBe(1);
  expect(await countClientLeadReviewReceipts(racing.id)).toBe(1);

  await rejectLeadReviewDecisionWrites();
  expect(
    (
      await reviewLead(
        request,
        firstFailure.id,
        2,
        csrf,
        randomUUID(),
        'NO_INFRINGEMENT',
        '核对后确认无侵权',
      )
    ).status(),
  ).toBe(500);
  await allowInjectedFailures();
  expect(await getLead(firstFailure.id)).toMatchObject({
    status: 'WAITING_REVIEW',
    version: 2,
  });
  expect(await countLeadReviewDecisions(firstFailure.id)).toBe(0);
  expect(await countClientLeadReviewReceipts(firstFailure.id)).toBe(0);

  await rejectClientLeadReviewReceiptWrites();
  expect(
    (
      await reviewLead(
        request,
        secondFailure.id,
        2,
        csrf,
        randomUUID(),
        'NO_INFRINGEMENT',
        '核对后确认无侵权',
      )
    ).status(),
  ).toBe(500);
  await allowInjectedFailures();
  expect(await getLead(secondFailure.id)).toMatchObject({
    status: 'WAITING_REVIEW',
    version: 2,
  });
  expect(await countLeadReviewDecisions(secondFailure.id)).toBe(0);
  expect(await countClientLeadReviewReceipts(secondFailure.id)).toBe(0);
});

test('account, binding and admission revocation deny no-infringement review', async ({
  request,
}) => {
  const client = await createClientAccount(request);
  const lead = await (await createLead(request)).json();
  expect((await pushLead(request, lead.id, 1)).status()).toBe(201);
  let csrf = await loginClient(request, client.username, client.password);
  const submit = () =>
    reviewLead(
      request,
      lead.id,
      2,
      csrf,
      randomUUID(),
      'NO_INFRINGEMENT',
      '核对后确认无侵权',
    );

  await setClientUserActive(coreLeadFixtures.admittedCustomer, false);
  expect((await submit()).status()).toBe(401);
  await setClientUserActive(coreLeadFixtures.admittedCustomer, true);
  csrf = await loginClient(request, client.username, client.password);

  await setClientBindingActive(coreLeadFixtures.admittedCustomer, false);
  expect([401, 403]).toContain((await submit()).status());
  await setClientBindingActive(coreLeadFixtures.admittedCustomer, true);
  csrf = await loginClient(request, client.username, client.password);

  await setCustomerStatus(coreLeadFixtures.admittedCustomer, 'DRAFT');
  expect([401, 403]).toContain((await submit()).status());
  expect(await countLeadReviewDecisions(lead.id)).toBe(0);
  expect(await countClientLeadReviewReceipts(lead.id)).toBe(0);
  expect(await getLead(lead.id)).toMatchObject({
    status: 'WAITING_REVIEW',
    version: 2,
  });
});

test('two distinct client review keys allow exactly one committed decision', async ({
  request,
}) => {
  const client = await createClientAccount(request);
  const lead = await (await createLead(request)).json();
  expect((await pushLead(request, lead.id, 1)).status()).toBe(201);
  const csrf = await loginClient(request, client.username, client.password);
  const responses = await Promise.all([
    reviewLead(request, lead.id, 2, csrf),
    reviewLead(request, lead.id, 2, csrf),
  ]);
  expect(
    responses.filter((response) => response.status() === 201),
  ).toHaveLength(1);
  expect(
    responses.filter((response) => response.status() === 409),
  ).toHaveLength(1);
  expect(await countLeadReviewDecisions(lead.id)).toBe(1);
  expect(await countClientLeadReviewReceipts(lead.id)).toBe(1);
});

test('decision or receipt write failures roll back client review state', async ({
  request,
}) => {
  const client = await createClientAccount(request);
  const first = await (await createLead(request)).json();
  const second = await (await createLead(request)).json();
  expect((await pushLead(request, first.id, 1)).status()).toBe(201);
  expect((await pushLead(request, second.id, 1)).status()).toBe(201);
  const csrf = await loginClient(request, client.username, client.password);

  await rejectLeadReviewDecisionWrites();
  expect((await reviewLead(request, first.id, 2, csrf)).status()).toBe(500);
  expect(await getLead(first.id)).toMatchObject({
    status: 'WAITING_REVIEW',
    version: 2,
  });
  expect(await countLeadReviewDecisions(first.id)).toBe(0);
  expect(await countClientLeadReviewReceipts(first.id)).toBe(0);
  await allowInjectedFailures();

  await rejectClientLeadReviewReceiptWrites();
  expect((await reviewLead(request, second.id, 2, csrf)).status()).toBe(500);
  expect(await getLead(second.id)).toMatchObject({
    status: 'WAITING_REVIEW',
    version: 2,
  });
  expect(await countLeadReviewDecisions(second.id)).toBe(0);
  expect(await countClientLeadReviewReceipts(second.id)).toBe(0);
  await allowInjectedFailures();
});

test('account, binding and admission revocation deny the next client review request', async ({
  request,
}) => {
  const client = await createClientAccount(request);
  const lead = await (await createLead(request)).json();
  expect((await pushLead(request, lead.id, 1)).status()).toBe(201);
  let csrf = await loginClient(request, client.username, client.password);

  await setClientUserActive(coreLeadFixtures.admittedCustomer, false);
  expect((await reviewLead(request, lead.id, 2, csrf)).status()).toBe(401);
  await setClientUserActive(coreLeadFixtures.admittedCustomer, true);
  csrf = await loginClient(request, client.username, client.password);

  await setClientBindingActive(coreLeadFixtures.admittedCustomer, false);
  expect([401, 403]).toContain(
    (await reviewLead(request, lead.id, 2, csrf)).status(),
  );
  await setClientBindingActive(coreLeadFixtures.admittedCustomer, true);
  csrf = await loginClient(request, client.username, client.password);

  await setCustomerStatus(coreLeadFixtures.admittedCustomer, 'DRAFT');
  expect([401, 403]).toContain(
    (await reviewLead(request, lead.id, 2, csrf)).status(),
  );
  expect(await countLeadReviewDecisions(lead.id)).toBe(0);
  expect(await countClientLeadReviewReceipts(lead.id)).toBe(0);
  expect(await getLead(lead.id)).toMatchObject({
    status: 'WAITING_REVIEW',
    version: 2,
  });
});

test('audit, child-table, and material metadata failures roll back with blob compensation', async ({
  request,
}) => {
  const baseline = await databaseCounts();
  await rejectAuditWrites('lead.created');
  const auditFailure = await createLead(request);
  expect(auditFailure.status()).toBe(500);
  expect(await databaseCounts()).toEqual(baseline);

  await rejectLeadProductWrites();
  const childFailure = await createLead(
    request,
    leadInput({
      products: [
        {
          title: 'ROLLBACK-PRODUCT',
          quantity: 1,
          unitPrice: '1.00',
          commentCount: 0,
        },
      ],
    }),
  );
  expect(childFailure.status()).toBe(500);
  expect(await databaseCounts()).toEqual(baseline);

  await rejectMaterialMetadataWrites();
  const draft = await request.post('/api/v1/materials/upload-drafts', {
    headers: authorizationA,
    data: {
      ownerType: 'CUSTOMER',
      ownerId: coreLeadFixtures.draftCustomer,
      category: 'CUSTOMER_IDENTITY',
      purpose: 'IDENTITY_FULL',
      originalFilename: 'rollback.jpg',
      declaredMimeType: 'image/jpeg',
    },
  });
  expect(draft.status(), await draft.text()).toBe(201);
  const created = await draft.json();
  const beforeFiles = await countStoredFiles();
  const metadataFailure = await request.put(
    `/api/v1/materials/upload-drafts/${created.id}/content`,
    {
      headers: {
        ...authorizationA,
        'Content-Type': 'application/octet-stream',
      },
      data: jpegBytes,
    },
  );
  expect(metadataFailure.status()).toBe(500);
  expect(await countStoredFiles()).toBe(beforeFiles);
  expect(await databaseCounts()).toEqual(baseline);
  await allowInjectedFailures();
});

test('unreferenced material can be restored while frozen evidence cannot be deleted', async ({
  request,
}) => {
  const material = await upload(request, {
    ownerType: 'CUSTOMER',
    ownerId: coreLeadFixtures.draftCustomer,
    purpose: 'IDENTITY_FULL',
    name: 'recoverable.pdf',
    mime: 'application/pdf',
    bytes: pdfBytes,
  });
  const stored = await getMaterialByVersion(material.contentVersionId);
  const removed = await request.delete(
    `/api/v1/materials/${stored!.materialId}?expectedVersion=1`,
    { headers: authorizationA },
  );
  expect(removed.status()).toBe(200);
  const restored = await request.post(
    `/api/v1/materials/${stored!.materialId}/restore`,
    {
      headers: authorizationA,
      data: { expectedVersion: 2 },
    },
  );
  expect(restored.status()).toBe(201);
  const admitted = await request.post(
    `/api/v1/customers/${coreLeadFixtures.draftCustomer}/admission`,
    {
      headers: { ...authorizationA, 'Idempotency-Key': randomUUID() },
      data: admissionInput([material.contentVersionId]),
    },
  );
  expect(admitted.status(), await admitted.text()).toBe(201);
  const frozenCustomer = await request.delete(
    `/api/v1/materials/${stored!.materialId}?expectedVersion=3`,
    { headers: authorizationA },
  );
  expect(frozenCustomer.status()).toBe(409);

  const screenshot = await upload(request, {
    ownerType: 'LEAD_DRAFT',
    purpose: 'LEAD_SCREENSHOT',
    name: 'frozen.jpg',
    mime: 'image/jpeg',
    bytes: jpegBytes,
  });
  const lead = await createLead(
    request,
    leadInput({
      reservedLeadId: screenshot.reservedOwnerId,
      leadScreenshotContentVersionIds: [screenshot.contentVersionId],
    }),
  );
  expect(lead.status(), await lead.text()).toBe(201);
  const screenshotStored = await getMaterialByVersion(
    screenshot.contentVersionId,
  );
  const frozenLead = await request.delete(
    `/api/v1/materials/${screenshotStored!.materialId}?expectedVersion=1`,
    { headers: authorizationA },
  );
  expect(frozenLead.status()).toBe(409);
});

test('delete serialization rejects a material frozen after its zero-reference read', async ({
  request,
}) => {
  const material = await upload(request, {
    ownerType: 'CUSTOMER',
    ownerId: coreLeadFixtures.draftCustomer,
    purpose: 'IDENTITY_FULL',
    name: 'delete-race.pdf',
    mime: 'application/pdf',
    bytes: pdfBytes,
  });
  const stored = await getMaterialByVersion(material.contentVersionId);
  const barrier = await installMaterialStatusBarrier(
    stored!.materialId,
    'DELETED',
  );
  const deleting = request.delete(
    `/api/v1/materials/${stored!.materialId}?expectedVersion=1`,
    { headers: authorizationA },
  );
  await barrier.wait();
  const admitted = await request.post(
    `/api/v1/customers/${coreLeadFixtures.draftCustomer}/admission`,
    {
      headers: { ...authorizationA, 'Idempotency-Key': randomUUID() },
      data: admissionInput([material.contentVersionId]),
    },
  );
  expect(admitted.status(), await admitted.text()).toBe(201);
  await barrier.release();
  const removed = await deleting;
  expect(removed.status(), await removed.text()).toBe(409);
  expect(await getMaterialLifecycle(stored!.materialId)).toMatchObject({
    status: 'ACTIVE',
    version: 1,
    contentVersions: [{ status: 'AVAILABLE' }],
  });
  expect(await getMaterialAuditActions(stored!.materialId)).toEqual([]);
});

test('material delete audit failure rolls back its state transition', async ({
  request,
}) => {
  const material = await upload(request, {
    ownerType: 'CUSTOMER',
    ownerId: coreLeadFixtures.draftCustomer,
    purpose: 'IDENTITY_FULL',
    name: 'delete-audit.pdf',
    mime: 'application/pdf',
    bytes: pdfBytes,
  });
  const stored = await getMaterialByVersion(material.contentVersionId);
  await rejectAuditWrites('material.deleted');
  const removed = await request.delete(
    `/api/v1/materials/${stored!.materialId}?expectedVersion=1`,
    { headers: authorizationA },
  );
  expect(removed.status()).toBe(500);
  await allowInjectedFailures();
  expect(await getMaterialLifecycle(stored!.materialId)).toMatchObject({
    status: 'ACTIVE',
    version: 1,
    contentVersions: [{ status: 'AVAILABLE' }],
  });
  expect(await getMaterialAuditActions(stored!.materialId)).toEqual([]);
});

test('cleanup claim wins over restore without producing ACTIVE material with purged bytes', async ({
  request,
}) => {
  const material = await upload(request, {
    ownerType: 'CUSTOMER',
    ownerId: coreLeadFixtures.draftCustomer,
    purpose: 'IDENTITY_FULL',
    name: 'cleanup-wins.pdf',
    mime: 'application/pdf',
    bytes: pdfBytes,
  });
  const stored = await getMaterialByVersion(material.contentVersionId);
  const removed = await request.delete(
    `/api/v1/materials/${stored!.materialId}?expectedVersion=1`,
    { headers: authorizationA },
  );
  expect(removed.status(), await removed.text()).toBe(200);
  const now = new Date();
  await setMaterialDeletedAt(
    stored!.materialId,
    new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000),
  );
  const cleanup = startMaterialCleanup(
    new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
  );
  await cleanup.deleteStarted;
  const restored = await request.post(
    `/api/v1/materials/${stored!.materialId}/restore`,
    { headers: authorizationA, data: { expectedVersion: 2 } },
  );
  expect(restored.status(), await restored.text()).toBe(409);
  cleanup.allowDelete();
  await cleanup.result;
  expect(await getMaterialLifecycle(stored!.materialId)).toMatchObject({
    status: 'DELETED',
    version: 2,
    contentVersions: [{ status: 'PURGED' }],
  });
  expect(await getMaterialAuditActions(stored!.materialId)).toEqual([
    'material.deleted',
  ]);
});

test('restore lock makes cleanup skip the same material and current content version', async ({
  request,
}) => {
  const material = await upload(request, {
    ownerType: 'CUSTOMER',
    ownerId: coreLeadFixtures.draftCustomer,
    purpose: 'IDENTITY_FULL',
    name: 'restore-wins.pdf',
    mime: 'application/pdf',
    bytes: pdfBytes,
  });
  const stored = await getMaterialByVersion(material.contentVersionId);
  const removed = await request.delete(
    `/api/v1/materials/${stored!.materialId}?expectedVersion=1`,
    { headers: authorizationA },
  );
  expect(removed.status(), await removed.text()).toBe(200);
  const now = new Date();
  await setMaterialDeletedAt(
    stored!.materialId,
    new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000),
  );
  const barrier = await installMaterialStatusBarrier(
    stored!.materialId,
    'ACTIVE',
  );
  const restoring = request.post(
    `/api/v1/materials/${stored!.materialId}/restore`,
    { headers: authorizationA, data: { expectedVersion: 2 } },
  );
  await barrier.wait();
  const cleanup = startMaterialCleanup(
    new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
  );
  await cleanup.result;
  await barrier.release();
  const restored = await restoring;
  expect(restored.status(), await restored.text()).toBe(201);
  expect(await getMaterialLifecycle(stored!.materialId)).toMatchObject({
    status: 'ACTIVE',
    version: 3,
    contentVersions: [{ status: 'AVAILABLE' }],
  });
  expect(await getMaterialAuditActions(stored!.materialId)).toEqual([
    'material.deleted',
    'material.restored',
  ]);
});

test('lead numbers stop after 999 and concurrent creation never duplicates a number', async ({
  request,
}) => {
  await setLeadCounter(998);
  const last = await createLead(request);
  expect(last.status(), await last.text()).toBe(201);
  expect((await last.json()).businessNo).toMatch(/-999$/u);
  const exhausted = await createLead(request);
  expect(exhausted.status()).toBe(409);
  expect(await exhausted.json()).toMatchObject({
    code: 'LEAD_NUMBER_EXHAUSTED',
  });

  await setLeadCounter(0);
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      createLead(request, leadInput({ shopName: `并发店铺 ${index}` })),
    ),
  );
  const successes = results.filter((response) => response.status() === 201);
  const conflicts = results.filter((response) => response.status() === 409);
  expect(successes.length).toBeGreaterThan(1);
  expect(successes.length + conflicts.length).toBe(results.length);
  for (const response of conflicts) {
    expect(await response.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
  }
  const numbers = await Promise.all(
    successes.map(
      async (response) =>
        ((await response.json()) as { businessNo: string }).businessNo,
    ),
  );
  expect(new Set(numbers).size).toBe(numbers.length);
  expect(await countLeads()).toBe(4 + successes.length);
});

test('no-evidence archive enforces Grant, state, version, replay and enterprise read scope', async ({
  request,
}) => {
  const clientA = await createClientAccount(request);
  const clientB = await createClientAccount(request, {
    customerId: coreLeadFixtures.foreignCustomer,
    headers: { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
  });
  const csrfA = await loginClient(request, clientA.username, clientA.password);
  const lead = await createInfringementReviewedLead(request, csrfA);
  const clientCannotArchive = await decideNoEvidence(
    request,
    lead.id,
    3,
    '客户不能代替运营决定',
    randomUUID(),
    { 'X-CSRF-Token': csrfA },
  );
  expect(clientCannotArchive.status()).toBe(403);
  const waiting = await (await createLead(request)).json();
  expect(
    (await decideNoEvidence(request, waiting.id, 1, '状态错误')).status(),
  ).toBe(409);
  const missingReview = await decideNoEvidence(
    request,
    '70000000-0000-4000-8000-000000000002',
    1,
    '缺少客户确认侵权事实',
  );
  expect(missingReview.status()).toBe(409);
  const stale = await decideNoEvidence(request, lead.id, 2, '版本过期');
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
  for (const reason of ['', '   ', 'x'.repeat(5001)]) {
    const invalid = await decideNoEvidence(request, lead.id, 3, reason);
    expect(invalid.status(), await invalid.text()).toBe(400);
  }
  expect(
    (
      await decideNoEvidence(
        request,
        lead.id,
        3,
        '无范围',
        randomUUID(),
        authorizationSelf,
      )
    ).status(),
  ).toBe(403);
  const otherDepartment = await decideNoEvidence(
    request,
    lead.id,
    3,
    '跨部门',
    randomUUID(),
    { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
  );
  expect(otherDepartment.status()).toBe(404);
  await setGrant('lead.evidence.decide', false);
  expect((await decideNoEvidence(request, lead.id, 3, '无权限')).status()).toBe(
    403,
  );
  await setGrant('lead.evidence.decide', true);

  const key = randomUUID();
  const first = await decideNoEvidence(
    request,
    lead.id,
    3,
    '  本次不再取证  ',
    key,
  );
  expect(first.status(), await first.text()).toBe(201);
  const snapshot = await first.json();
  expect(snapshot).toMatchObject({
    leadId: lead.id,
    status: 'ARCHIVED',
    version: 4,
    reason: '本次不再取证',
  });
  expect(await getLead(lead.id)).toMatchObject({
    status: 'ARCHIVED',
    version: 4,
  });
  expect(await getLeadEvidenceDecision(lead.id)).toMatchObject({
    leadId: lead.id,
    result: 'NO_EVIDENCE',
    reason: '本次不再取证',
    archiveType: 'NO_EVIDENCE',
    fromVersion: 3,
    toVersion: 4,
  });
  expect(await countLeadReviewDecisions(lead.id)).toBe(1);
  expect(await countLeadEvidenceDecisions(lead.id)).toBe(1);
  expect(await countLeadEvidenceAudits(lead.id)).toBe(1);
  expect(await countLeadEvidenceReceipts(lead.id)).toBe(1);
  const replay = await decideNoEvidence(
    request,
    lead.id,
    3,
    '  本次不再取证  ',
    key,
  );
  expect(replay.status()).toBe(201);
  expect(await replay.json()).toEqual(snapshot);
  const changedIntent = await decideNoEvidence(
    request,
    lead.id,
    3,
    '不同原因',
    key,
  );
  expect(changedIntent.status()).toBe(409);
  expect(await changedIntent.json()).toMatchObject({
    code: 'IDEMPOTENCY_CONFLICT',
  });
  expect(
    (await decideNoEvidence(request, lead.id, 4, '再次归档')).status(),
  ).toBe(409);

  await setGrant('lead.evidence.decide', false);
  expect(
    (
      await decideNoEvidence(request, lead.id, 3, '  本次不再取证  ', key)
    ).status(),
  ).toBe(403);
  await setGrant('lead.evidence.decide', true);
  const detail = await request.get(`/api/v1/client/leads/${lead.id}`);
  expect(detail.status(), await detail.text()).toBe(200);
  const clientDetail = await detail.json();
  expect(clientDetail.evidenceDecision).toMatchObject({
    reason: '本次不再取证',
    archiveType: 'NO_EVIDENCE',
  });
  expect(clientDetail.reviewDecision).toMatchObject({ result: 'INFRINGEMENT' });
  expect(JSON.stringify(clientDetail)).not.toContain('responsibleUserId');
  const processed = await request.get('/api/v1/client/leads?view=PROCESSED');
  expect(processed.status(), await processed.text()).toBe(200);
  expect(
    (await processed.json()).items.map((item: { id: string }) => item.id),
  ).toContain(lead.id);

  await loginClient(request, clientB.username, clientB.password);
  expect((await request.get(`/api/v1/client/leads/${lead.id}`)).status()).toBe(
    404,
  );
});

test('no-evidence competing commands and failed durable writes never leave partial archive facts', async ({
  request,
}) => {
  const client = await createClientAccount(request);
  const csrf = await loginClient(request, client.username, client.password);
  const lead = await createInfringementReviewedLead(request, csrf);
  const contenders = await Promise.all([
    decideNoEvidence(request, lead.id, 3, '并发甲'),
    decideNoEvidence(request, lead.id, 3, '并发乙'),
  ]);
  expect(contenders.map((result) => result.status()).sort()).toEqual([
    201, 409,
  ]);
  expect(await countLeadEvidenceDecisions(lead.id)).toBe(1);
  expect(await countLeadEvidenceReceipts(lead.id)).toBe(1);
  expect(await countLeadEvidenceAudits(lead.id)).toBe(1);

  for (const reject of [
    () => rejectLeadEvidenceDecisionWrites(),
    () => rejectLeadEvidenceReceiptWrites(),
    () => rejectAuditWrites('lead.evidence_decided'),
  ]) {
    const candidate = await createInfringementReviewedLead(request, csrf);
    await reject();
    const failed = await decideNoEvidence(request, candidate.id, 3, '写入失败');
    expect(failed.status()).toBeGreaterThanOrEqual(500);
    expect(await getLead(candidate.id)).toMatchObject({
      status: 'WAITING_EVIDENCE_DECISION',
      version: 3,
    });
    expect(await countLeadEvidenceDecisions(candidate.id)).toBe(0);
    expect(await countLeadEvidenceAudits(candidate.id)).toBe(0);
    expect(await countLeadEvidenceReceipts(candidate.id)).toBe(0);
  }
});

test('withdrawal application enforces Grant, state, retries, races, and full transaction rollback', async ({
  request,
}) => {
  const client = await createClientAccount(request);
  const csrf = await loginClient(request, client.username, client.password);
  const archived = await archiveLeadForWithdrawal(request, csrf);
  const leadId = archived.lead.id;
  const originalDecision = await getLeadReviewDecision(leadId);
  expect(originalDecision?.result).toBe('NO_INFRINGEMENT');

  const waiting = await (await createLead(request)).json();
  expect(
    (await applyLeadWithdrawal(request, waiting.id, 1, '未归档')).status(),
  ).toBe(409);
  const infringementLead = await (await createLead(request)).json();
  expect((await pushLead(request, infringementLead.id, 1)).status()).toBe(201);
  const infringementReview = await reviewLead(
    request,
    infringementLead.id,
    2,
    csrf,
  );
  expect(infringementReview.status()).toBe(201);
  const wrongArchive = await applyLeadWithdrawal(
    request,
    infringementLead.id,
    3,
    '错误归档类型',
  );
  expect(wrongArchive.status()).toBe(409);
  expect(await wrongArchive.json()).toMatchObject({ code: 'INVALID_STATE' });
  for (const reason of ['', '   ', 'x'.repeat(5001)]) {
    const invalid = await applyLeadWithdrawal(request, leadId, 3, reason);
    expect(invalid.status(), await invalid.text()).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  }
  const stale = await applyLeadWithdrawal(request, leadId, 2, '过期版本');
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
  await setGrant('lead.withdraw.apply', false);
  expect(
    (await applyLeadWithdrawal(request, leadId, 3, '无授权')).status(),
  ).toBe(403);
  await setGrant('lead.withdraw.apply', true);
  await setTeamActive(coreLeadFixtures.teamA, false);

  const key = randomUUID();
  const accepted = await applyLeadWithdrawal(
    request,
    leadId,
    3,
    '  补充关键证据  ',
    key,
  );
  expect(accepted.status(), await accepted.text()).toBe(201);
  await setTeamActive(coreLeadFixtures.teamA, true);
  const snapshot = await accepted.json();
  expect(snapshot).toMatchObject({
    leadId,
    status: 'ARCHIVED',
    version: 4,
    reason: '补充关键证据',
  });
  await setGrant('lead.withdraw.apply', false);
  const revokedReplay = await applyLeadWithdrawal(
    request,
    leadId,
    3,
    '补充关键证据',
    key,
  );
  expect(revokedReplay.status()).toBe(403);
  await setGrant('lead.withdraw.apply', true);
  const replay = await applyLeadWithdrawal(
    request,
    leadId,
    3,
    '补充关键证据',
    key,
  );
  expect(replay.status()).toBe(201);
  expect(await replay.json()).toEqual(snapshot);
  const conflict = await applyLeadWithdrawal(
    request,
    leadId,
    3,
    '另一原因',
    key,
  );
  expect(conflict.status()).toBe(409);
  expect(await conflict.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  expect(await getLead(leadId)).toMatchObject({
    status: 'ARCHIVED',
    version: 4,
    activeReviewDecisionId: originalDecision?.id,
  });
  expect(await getLeadReviewDecision(leadId)).toEqual(originalDecision);
  expect(await countLeadWithdrawalApplications(leadId)).toBe(1);
  expect(await countLeadWithdrawalAudits(leadId)).toBe(1);

  const racing = await archiveLeadForWithdrawal(
    request,
    await loginClient(request, client.username, client.password),
  );
  const raced = await Promise.all([
    applyLeadWithdrawal(request, racing.lead.id, 3, '并发申请', randomUUID()),
    applyLeadWithdrawal(request, racing.lead.id, 3, '并发申请', randomUUID()),
  ]);
  expect(raced.filter((response) => response.status() === 201)).toHaveLength(1);
  expect(raced.filter((response) => response.status() === 409)).toHaveLength(1);
  expect(await countLeadWithdrawalApplications(racing.lead.id)).toBe(1);
  expect(await countLeadWithdrawalAudits(racing.lead.id)).toBe(1);

  for (const failure of ['application', 'audit'] as const) {
    const rollback = await archiveLeadForWithdrawal(
      request,
      await loginClient(request, client.username, client.password),
    );
    if (failure === 'application') await rejectWithdrawalApplicationWrites();
    else await rejectAuditWrites('lead.withdrawal_applied');
    expect(
      (
        await applyLeadWithdrawal(request, rollback.lead.id, 3, '应整体回滚')
      ).status(),
    ).toBe(500);
    await allowInjectedFailures();
    expect(await getLead(rollback.lead.id)).toMatchObject({
      status: 'ARCHIVED',
      version: 3,
    });
    expect(await countLeadWithdrawalApplications(rollback.lead.id)).toBe(0);
    expect(await countLeadWithdrawalAudits(rollback.lead.id)).toBe(0);
  }
});

test('withdrawal confirmation revalidates client identity, rolls back, and preserves immutable replay history', async ({
  request,
}) => {
  const owner = await createClientAccount(request);
  const foreign = await createClientAccount(request, {
    customerId: coreLeadFixtures.foreignCustomer,
    headers: { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
  });
  let csrf = await loginClient(request, owner.username, owner.password);
  const screenshot = await upload(request, {
    ownerType: 'LEAD_DRAFT',
    purpose: 'LEAD_SCREENSHOT',
    name: 'withdrawal-allowed.jpg',
    mime: 'image/jpeg',
    bytes: jpegBytes,
  });
  const archived = await archiveLeadForWithdrawal(
    request,
    csrf,
    leadInput({
      reservedLeadId: screenshot.reservedOwnerId,
      leadScreenshotContentVersionIds: [screenshot.contentVersionId],
    }),
  );
  const applied = await applyLeadWithdrawal(
    request,
    archived.lead.id,
    3,
    '原企业确认',
  );
  expect(applied.status()).toBe(201);
  const application = await applied.json();
  const foreignCsrf = await loginClient(
    request,
    foreign.username,
    foreign.password,
  );
  expect(
    (
      await confirmLeadWithdrawal(
        request,
        archived.lead.id,
        application.id,
        4,
        foreignCsrf,
      )
    ).status(),
  ).toBe(404);
  expect(
    (await request.get(`/api/v1/client/leads/${archived.lead.id}`)).status(),
  ).toBe(404);
  const foreignMaterial = await getMaterialByVersion(
    screenshot.contentVersionId,
  );
  const foreignScreenshot = await request.get(
    `/api/v1/materials/${foreignMaterial!.materialId}/versions/${screenshot.contentVersionId}/content`,
  );
  expect(foreignScreenshot.status()).toBe(404);
  csrf = await loginClient(request, owner.username, owner.password);
  const unpushed = await (await createLead(request)).json();
  expect(
    (
      await confirmLeadWithdrawal(request, unpushed.id, randomUUID(), 1, csrf)
    ).status(),
  ).toBe(404);
  const stale = await confirmLeadWithdrawal(
    request,
    archived.lead.id,
    application.id,
    3,
    csrf,
  );
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });

  await setClientUserActive(coreLeadFixtures.admittedCustomer, false);
  expect(
    (
      await confirmLeadWithdrawal(
        request,
        archived.lead.id,
        application.id,
        4,
        csrf,
      )
    ).status(),
  ).toBe(401);
  await setClientUserActive(coreLeadFixtures.admittedCustomer, true);
  csrf = await loginClient(request, owner.username, owner.password);
  await setClientBindingActive(coreLeadFixtures.admittedCustomer, false);
  expect([401, 403]).toContain(
    (
      await confirmLeadWithdrawal(
        request,
        archived.lead.id,
        application.id,
        4,
        csrf,
      )
    ).status(),
  );
  await setClientBindingActive(coreLeadFixtures.admittedCustomer, true);
  csrf = await loginClient(request, owner.username, owner.password);
  await setCustomerStatus(coreLeadFixtures.admittedCustomer, 'DRAFT');
  expect([401, 403]).toContain(
    (
      await confirmLeadWithdrawal(
        request,
        archived.lead.id,
        application.id,
        4,
        csrf,
      )
    ).status(),
  );
  await setCustomerStatus(coreLeadFixtures.admittedCustomer, 'ADMITTED');
  csrf = await loginClient(request, owner.username, owner.password);

  const allowedMaterial = await getMaterialByVersion(
    screenshot.contentVersionId,
  );
  expect(allowedMaterial).not.toBeNull();
  const allowedScreenshot = await request.get(
    `/api/v1/materials/${allowedMaterial!.materialId}/versions/${screenshot.contentVersionId}/content`,
  );
  expect(allowedScreenshot.status()).toBe(200);
  expect(await allowedScreenshot.body()).toEqual(jpegBytes);
  const unlinkedScreenshot = await upload(request, {
    ownerType: 'LEAD_DRAFT',
    purpose: 'LEAD_SCREENSHOT',
    name: 'withdrawal-unlinked.jpg',
    mime: 'image/jpeg',
    bytes: jpegBytes,
  });
  const unlinkedMaterial = await getMaterialByVersion(
    unlinkedScreenshot.contentVersionId,
  );
  const deniedUnlinked = await request.get(
    `/api/v1/materials/${unlinkedMaterial!.materialId}/versions/${unlinkedScreenshot.contentVersionId}/content`,
  );
  expect([403, 404]).toContain(deniedUnlinked.status());

  await rejectWithdrawalConfirmationWrites();
  expect(
    (
      await confirmLeadWithdrawal(
        request,
        archived.lead.id,
        application.id,
        4,
        csrf,
      )
    ).status(),
  ).toBe(500);
  await allowInjectedFailures();
  expect(await getLead(archived.lead.id)).toMatchObject({
    status: 'ARCHIVED',
    version: 4,
  });
  expect(await countLeadWithdrawalConfirmations(archived.lead.id)).toBe(0);
  const confirmationKey = randomUUID();
  const confirmed = await confirmLeadWithdrawal(
    request,
    archived.lead.id,
    application.id,
    4,
    csrf,
    confirmationKey,
  );
  expect(confirmed.status(), await confirmed.text()).toBe(201);
  const confirmationSnapshot = await confirmed.json();
  expect(confirmationSnapshot).toMatchObject({
    status: 'WAITING_REVIEW',
    version: 5,
    applicationId: application.id,
  });
  const repeatedWithNewKey = await confirmLeadWithdrawal(
    request,
    archived.lead.id,
    application.id,
    5,
    csrf,
  );
  expect(repeatedWithNewKey.status()).toBe(409);
  expect(await repeatedWithNewKey.json()).toMatchObject({
    code: 'INVALID_STATE',
  });
  await rejectClientLeadReviewReceiptWrites();
  expect((await reviewLead(request, archived.lead.id, 5, csrf)).status()).toBe(
    500,
  );
  await allowInjectedFailures();
  expect(await getLead(archived.lead.id)).toMatchObject({
    status: 'WAITING_REVIEW',
    version: 5,
    activeReviewDecisionId: null,
  });
  expect(await countLeadReviewDecisions(archived.lead.id)).toBe(1);
  const second = await reviewLead(request, archived.lead.id, 5, csrf);
  expect(second.status()).toBe(201);
  const secondSnapshot = await second.json();
  const priorReviewReplay = await reviewLead(
    request,
    archived.lead.id,
    2,
    csrf,
    archived.reviewKey,
    'NO_INFRINGEMENT',
    '原审核结论保持不变',
  );
  expect(priorReviewReplay.status()).toBe(201);
  expect(await priorReviewReplay.json()).toEqual(archived.reviewResult);
  const confirmationReplay = await confirmLeadWithdrawal(
    request,
    archived.lead.id,
    application.id,
    4,
    csrf,
    confirmationKey,
  );
  expect(await confirmationReplay.json()).toEqual(confirmationSnapshot);
  expect(await getLead(archived.lead.id)).toMatchObject({
    status: 'WAITING_EVIDENCE_DECISION',
    version: 6,
  });
  const decisions = await getLeadReviewDecisions(archived.lead.id);
  expect(decisions.map((decision) => decision.result)).toEqual([
    'NO_INFRINGEMENT',
    'INFRINGEMENT',
  ]);
  expect(decisions[0].receipt?.resultSnapshot).toEqual(archived.reviewResult);
  expect(decisions[1].receipt?.resultSnapshot).toEqual(secondSnapshot);
  const historicalScreenshot = await request.get(
    `/api/v1/materials/${allowedMaterial!.materialId}/versions/${screenshot.contentVersionId}/content`,
  );
  expect(historicalScreenshot.status()).toBe(200);
  expect(await historicalScreenshot.body()).toEqual(jpegBytes);

  const racingCsrf = await loginClient(request, owner.username, owner.password);
  const racing = await archiveLeadForWithdrawal(request, racingCsrf);
  const racingApplicationResponse = await applyLeadWithdrawal(
    request,
    racing.lead.id,
    3,
    '并发确认',
  );
  const racingApplication = await racingApplicationResponse.json();
  const confirmRace = await Promise.all([
    confirmLeadWithdrawal(
      request,
      racing.lead.id,
      racingApplication.id,
      4,
      racingCsrf,
      randomUUID(),
    ),
    confirmLeadWithdrawal(
      request,
      racing.lead.id,
      racingApplication.id,
      4,
      racingCsrf,
      randomUUID(),
    ),
  ]);
  expect(
    confirmRace.filter((response) => response.status() === 201),
    JSON.stringify(
      await Promise.all(
        confirmRace.map(async (response) => ({
          status: response.status(),
          body: await response.text(),
        })),
      ),
    ),
  ).toHaveLength(1);
  expect(
    confirmRace.filter((response) => response.status() === 409),
  ).toHaveLength(1);
  expect(await countLeadWithdrawalConfirmations(racing.lead.id)).toBe(1);
  expect(await getLead(racing.lead.id)).toMatchObject({
    status: 'WAITING_REVIEW',
    version: 5,
    activeReviewDecisionId: null,
  });
});

test('withdrawal migrations upgrade empty and previous schemas without losing immutable history', async () => {
  const output = execFileSync(
    process.execPath,
    ['backend/src/modules/leads/core-ld-withdrawal-migration-probe.mjs'],
    { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  expect(output).toContain('empty migration chain passed:');
  expect(output).toContain('previous-schema upgrade and constraints passed');
});

test('core lead migrations preserve legacy facts and roll back failed phases', async () => {
  const result = await verifyCoreLeadMigration();
  expect(result.empty.tables).toEqual([
    'client_lead_review_receipts',
    'customer_account_bindings',
    'customer_admission_receipts',
    'lead_command_receipts',
    'lead_number_counters',
    'lead_review_decisions',
    'leads',
    'materials',
    'upload_drafts',
  ]);
  expect(result.reviewIntegrity).toEqual({
    wrongCustomer: '23503',
    wrongReviewer: '23503',
    wrongBindingCustomer: '23503',
    wrongActor: '23503',
    wrongReceiptBinding: '23503',
    wrongLead: '23503',
    wrongVersion: '23503',
    invalidVersionPair: '23514',
    nonReviewAction: '23514',
    decisionUpdate: '55000',
    decisionDelete: '55000',
    receiptUpdate: '55000',
    receiptDelete: '55000',
    leadIdentityUpdate: '23503',
    bindingIdentityUpdate: '23503',
  });
  expect(result.reviewUpgrade).toEqual({
    rowsPreserved: true,
    leadFactsPreserved: true,
    receiptReplayable: true,
    decisionCount: 1,
    receiptCount: 1,
  });
  expect(result.archiveUpgrade).toEqual({
    oldFactsNull: true,
    oldSnapshotPreserved: true,
    oldFingerprintPreserved: true,
    oldReceiptLinked: true,
  });
  expect(result.archiveConstraints).toEqual({
    valid: null,
    blank: '23514',
    overlong: '23514',
    missingType: '23514',
    missingTime: '23514',
    mismatchedFacts: '23514',
    decisionUpdate: '55000',
    decisionDelete: '55000',
  });
  expect(result.archiveFailure).toEqual({
    code: '42701',
    originalColumnPreserved: 1,
    addedColumns: 0,
    archiveTypes: 0,
    addedConstraints: 0,
  });
  expect(result.reviewActionRecovery).toEqual({ actionCount: 1 });
  expect(result.reviewSchemaFailure).toEqual({
    code: '42P07',
    originalDecisionColumns: 1,
    receiptTables: 0,
    mutationTriggers: 0,
    reviewEnumTypes: 0,
  });
  expect(result.reviewIntegrityFailure).toEqual({
    code: '42723',
    addedConstraints: 0,
    receiptTriggers: 0,
  });
  expect(result.upgrade).toMatchObject({
    known: {
      customer_type: 'ENTERPRISE',
      identity_type: 'BUSINESS_LICENSE',
      profile_status: 'DRAFT',
    },
    unknown: {
      customer_type: 'legacy-company',
      identity_type: 'legacy-document',
      profile_status: 'DRAFT',
    },
    invalidAdmittedCode: '23514',
    compatibleAdmittedStatus: 'ADMITTED',
    grantCounts: { bootstrap: 4, shared: 0, incomplete: 0 },
    pushGrantCounts: { bootstrap: 1, shared: 0, incomplete: 0 },
    revisions: { bootstrap: 5, shared: 1, incomplete: 1 },
    identityIsolation: {
      unboundClientCode: '23514',
      clientMembershipCode: '23514',
      clientRoleCode: '23514',
      internalBindingCode: '23514',
      lastBindingDeleteCode: '23514',
      pushedAtOnlyCode: '23514',
      pushedByOnlyCode: '23514',
    },
  });
  expect(result.clientActionRecovery).toEqual({
    pushActionCount: 2,
    accountTypeExists: true,
  });
  expect(result.clientSchemaFailure).toEqual({
    code: '42P07',
    addedColumns: 0,
  });
  expect(result.schemaFailure).toEqual({
    code: '42P07',
    createdTables: 0,
    addedColumns: 0,
    addedConstraints: 0,
  });
  expect(result.backfillFailure).toEqual({
    code: '23514',
    grantCount: 0,
    revision: 1,
    grantInsertAttempts: 4,
    revisionUpdateAttempts: 1,
  });
});
