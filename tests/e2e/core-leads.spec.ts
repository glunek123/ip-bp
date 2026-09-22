import { randomUUID } from 'node:crypto';
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
  countLeads,
  countStoredFiles,
  databaseCounts,
  disconnectCoreLeadTestDatabase,
  getCustomer,
  getLead,
  getMaterialAuditActions,
  getMaterialLifecycle,
  getMaterialByVersion,
  installMaterialStatusBarrier,
  markContentVersion,
  rejectAuditWrites,
  rejectLeadPushReceiptWrites,
  rejectLeadProductWrites,
  rejectMaterialMetadataWrites,
  resetCoreLeadE2eData,
  removeLeadProducts,
  setClientAccountActive,
  setCustomerStatus,
  setGrant,
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
  await page.getByLabel('客户').selectOption(coreLeadFixtures.admittedCustomer);
  await expect(page.getByLabel('权利人')).toHaveValue(coreLeadFixtures.holder);
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

test('real operator login, client-account binding, push, client login, read, download, and refresh form one browser chain', async ({
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
  await page.getByLabel('客户').selectOption(coreLeadFixtures.admittedCustomer);
  await expect(page.getByLabel('权利人')).toHaveValue(coreLeadFixtures.holder);
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
  await expect(page).toHaveURL(new RegExp(`/client/leads/${leadId}$`, 'u'));
  await expect(page.getByText('客户端闭环商品')).toBeVisible();
  await expect(page.getByText('client-review.jpg')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.locator('[data-test^="download-screenshot-"]').click();
  await expect((await download).suggestedFilename()).toBe('client-review.jpg');
  await page.reload();
  await expect(page.getByText('客户端闭环店铺')).toBeVisible();
  await expect(page.getByText('client-review.jpg')).toBeVisible();
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

test('core lead migrations preserve legacy facts and roll back failed phases', async () => {
  const result = await verifyCoreLeadMigration();
  expect(result.empty.tables).toEqual([
    'customer_account_bindings',
    'customer_admission_receipts',
    'lead_command_receipts',
    'lead_number_counters',
    'leads',
    'materials',
    'upload_drafts',
  ]);
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
    revisions: { bootstrap: 3, shared: 1, incomplete: 1 },
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
