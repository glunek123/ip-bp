import { randomUUID } from 'node:crypto';
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
  type Request,
} from '@playwright/test';
import {
  disconnectCustomerTestDatabase,
  e2eFixtures,
  beginForeignCustomerAccountBlocker,
  getCustomerContactAccountCounts,
  getCustomerContactAdmissionEvidence,
  grantCustomerAdmission,
  grantCustomerRoutineEdit,
  grantCustomerCooperation,
  grantCustomerLifecycle,
  resetCustomerE2eData,
  resetLocalAuthE2eData,
  revokeCustomerRoutineEdit,
  setLocalCustomerGrant,
} from '../support/customer-database.mjs';
import {
  coreLeadFixtures,
  cleanupContactExternalActors,
  disconnectCoreLeadTestDatabase,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';
import { createLawyerAccountThroughApi } from '../support/case-lawyer-account.mjs';

const bearerA = { Authorization: `Bearer ${e2eFixtures.tokenA}` };
const bearerB = { Authorization: `Bearer ${e2eFixtures.tokenB}` };
const localRoleId = '30000000-0000-4000-8000-000000000010';
const pdfBytes = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n',
);
type Contact = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
  endedAt: string | null;
  version: number;
};
type ContactPage = {
  items: Contact[];
  total: number;
  primaryContactId: string | null;
};

async function passwordLogin(
  page: Page,
  returnTo: string,
  credentials: { username: string; password: string },
) {
  await page.goto(returnTo);
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(credentials.username);
  await page.getByLabel('密码').fill(credentials.password);
  const login = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/auth/login') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '登录', exact: true }).click();
  expect((await login).status()).toBe(200);
  await expect(page).toHaveURL(returnTo);
}

async function commandHeaders(request: Request) {
  const headers = await request.allHeaders();
  return {
    key: headers['idempotency-key'],
    csrf: headers['x-csrf-token'],
    cookie: headers.cookie,
    bearer: headers.authorization,
    body: request.postDataJSON(),
  };
}

async function listContacts(
  request: APIRequestContext,
  customerId: string,
  headers = bearerA,
  status: 'ACTIVE' | 'ENDED' = 'ACTIVE',
): Promise<ContactPage> {
  const response = await request.get(
    `/api/v1/customers/${customerId}/contacts?status=${status}`,
    { headers },
  );
  expect(response.status(), await response.text()).toBe(200);
  return response.json() as Promise<ContactPage>;
}

async function createDraft(
  request: APIRequestContext,
  name: string,
  data: Record<string, unknown> = {},
  headers = bearerA,
) {
  const response = await request.post('/api/v1/customers', {
    headers,
    data: { name, ...data },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json() as Promise<{ id: string; version: number }>;
}

function contactPanel(page: Page) {
  return page.locator('[data-test="customer-contacts-panel"]');
}

async function fillContact(
  page: Page,
  name: string,
  phone: string,
  email = '',
) {
  const form = contactPanel(page).locator('form');
  await form.getByLabel('姓名').fill(name);
  await form.getByLabel('电话').fill(phone);
  await form.getByLabel('邮箱').fill(email);
}

async function fillAdmission(page: Page, number: string) {
  await page.getByLabel('客户组织类型').selectOption('ENTERPRISE');
  await page.getByLabel('身份证明类型').selectOption('BUSINESS_LICENSE');
  await page.getByLabel('证件号码').fill(number);
  await page.getByLabel('有效期类型').selectOption('LONG_TERM');
  await page.locator('input[name="identityDocument"]').setInputFiles({
    name: 'license.pdf',
    mimeType: 'application/pdf',
    buffer: pdfBytes,
  });
  await expect(page.getByText('license.pdf')).toBeVisible();
}

async function browserCommandHeaders(page: Page, key: string) {
  const cookies = await page.context().cookies('http://127.0.0.1:5174');
  const csrf = cookies.find((cookie) => cookie.name === 'dev_cor_csrf')?.value;
  expect(csrf).toBeTruthy();
  return {
    Origin: 'http://127.0.0.1:5174',
    'X-CSRF-Token': csrf!,
    'Idempotency-Key': key,
  };
}

test.beforeAll(async () => {
  await cleanupContactExternalActors();
});

test.beforeEach(async () => {
  await resetCustomerE2eData();
});

test.afterAll(async () => {
  await cleanupContactExternalActors();
  await disconnectCustomerTestDatabase();
  await disconnectCoreLeadTestDatabase();
});

test('real password browser creates independent contacts, changes primary, ends and relogs in', async ({
  page,
}) => {
  const credentials = await resetLocalAuthE2eData();
  await passwordLogin(page, '/customers', credentials);
  await page.getByRole('link', { name: '新建客户' }).click();
  await page.getByLabel('客户名称').fill('真实联系人浏览器客户');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(
    page.getByRole('heading', { name: '真实联系人浏览器客户' }),
  ).toBeVisible();
  const customerId = page.url().split('/').at(-1)!;
  const panel = contactPanel(page);
  const writes: Request[] = [];
  page.on('request', (sent) => {
    if (
      sent.url().includes(`/api/v1/customers/${customerId}/contacts`) &&
      ['POST', 'PATCH'].includes(sent.method())
    )
      writes.push(sent);
  });

  await panel.locator('[data-test="contact-new"]').click();
  await fillContact(page, '同名联系人', '13800138001');
  await panel.getByRole('button', { name: '保存联系人' }).click();
  await expect(panel.getByText('同名联系人 · 13800138001')).toBeVisible();
  await expect(panel.getByRole('button', { name: '保存联系人' })).toBeEnabled();
  await panel.locator('[data-test="contact-new"]').click();
  await fillContact(page, '同名联系人', '13800138001');
  await panel.getByRole('button', { name: '保存联系人' }).click();
  await expect(panel.locator('li[data-test^="contact-"]')).toHaveCount(2);
  const rows = panel.locator('li[data-test^="contact-"]');
  const firstId = (await rows.nth(0).getAttribute('data-test'))!.slice(8);
  const secondId = (await rows.nth(1).getAttribute('data-test'))!.slice(8);
  expect(firstId).not.toBe(secondId);
  await rows.nth(0).getByRole('button', { name: '编辑' }).click();
  await panel.getByRole('button', { name: '设为主要' }).click();
  await expect(panel.locator(`[data-test="contact-${firstId}"]`)).toContainText(
    '主要',
  );
  await panel
    .locator(`[data-test="contact-${firstId}"]`)
    .getByRole('button', { name: '编辑' })
    .click();
  await panel.getByRole('button', { name: '取消主要' }).click();
  await expect(panel.getByText('当前未指定主要联系人')).toBeVisible();
  await panel
    .locator(`[data-test="contact-${secondId}"]`)
    .getByRole('button', { name: '编辑' })
    .click();
  await panel.getByLabel('结束原因（选填）').fill('岗位调整');
  await panel.getByRole('button', { name: '结束关系' }).click();
  await panel.getByRole('button', { name: '已结束' }).click();
  await expect(
    panel.locator(`[data-test="contact-${secondId}"]`),
  ).toContainText('同名联系人');
  await page.reload();
  await expect(panel.getByText('同名联系人 · 13800138001')).toBeVisible();
  await page.getByRole('button', { name: '退出登录' }).click();
  await passwordLogin(page, `/customers/${customerId}`, credentials);
  await panel.getByRole('button', { name: '已结束' }).click();
  await expect(
    panel.locator(`[data-test="contact-${secondId}"]`),
  ).toBeVisible();
  expect(writes).toHaveLength(5);
  for (const request of writes) {
    const sent = await commandHeaders(request);
    expect(sent.key).toBeTruthy();
    expect(sent.csrf).toBeTruthy();
    expect(sent.cookie).toBeTruthy();
    expect(sent.bearer).toBeUndefined();
  }
});

test('committed response loss preserves the original contact command across refresh and relogin', async ({
  page,
}) => {
  const credentials = await resetLocalAuthE2eData();
  await grantCustomerCooperation(localRoleId, 'DEPARTMENT');
  await grantCustomerLifecycle(localRoleId, 'DEPARTMENT');
  await passwordLogin(page, '/customers', credentials);
  await page.getByRole('link', { name: '新建客户' }).click();
  await page.getByLabel('客户名称').fill('联系人结果未知客户');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(
    page.getByRole('heading', { name: '联系人结果未知客户' }),
  ).toBeVisible();
  const url = page.url();
  const customerId = url.split('/').at(-1)!;
  const panel = contactPanel(page);
  let first: Awaited<ReturnType<typeof commandHeaders>> | undefined;
  let intercepted = false;
  await page.route(
    `**/api/v1/customers/${customerId}/contacts`,
    async (route) => {
      if (intercepted || route.request().method() !== 'POST')
        return route.continue();
      intercepted = true;
      first = await commandHeaders(route.request());
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      await route.abort('failed');
    },
  );
  await panel.locator('[data-test="contact-new"]').click();
  await fillContact(page, '原键联系人', '13800138002');
  await panel.getByRole('button', { name: '保存联系人' }).click();
  await expect(panel.getByRole('alert')).toContainText('原请求');
  await expect(page.locator('[data-test="edit-customer"]')).toHaveCount(0);
  await expect(page.locator('#customer-admission')).toHaveCount(0);
  await expect(page.locator('#customer-rights-holders')).toHaveCount(0);
  await expect(page.locator('#customer-accounts')).toHaveCount(0);
  await expect(page.locator('#customer-assets')).toHaveCount(0);
  await expect(page.locator('[data-test="pause-open"]')).toHaveCount(0);
  await expect(page.locator('[data-test="delete-draft-open"]')).toHaveCount(0);
  await expect(panel.locator('[data-test="contact-retry"]')).toBeVisible();
  await page.reload();
  await expect(panel.locator('[data-test="contact-retry"]')).toBeVisible();
  await page.getByRole('button', { name: '退出登录' }).click();
  await passwordLogin(page, url, credentials);
  const replay = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/contacts`) &&
      response.request().method() === 'POST',
  );
  await panel.locator('[data-test="contact-retry"]').click();
  const replayed = await replay;
  expect(replayed.status()).toBe(201);
  expect(await commandHeaders(replayed.request())).toMatchObject({
    key: first?.key,
    body: first?.body,
  });
  await expect(panel.getByText('原键联系人 · 13800138002')).toBeVisible();
  await expect(page.locator('[data-test="edit-customer"]')).toBeVisible();
  await panel.locator('[data-test="contact-new"]').click();
  await fillContact(page, '下一位联系人', '13800138003');
  const second = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/contacts`) &&
      response.request().method() === 'POST',
  );
  await panel.getByRole('button', { name: '保存联系人' }).click();
  const next = await second;
  expect(next.status()).toBe(201);
  expect((await commandHeaders(next.request())).body).toMatchObject({
    expectedCustomerVersion: 2,
  });
});

test('real PostgreSQL BUSY preserves the browser contact key and original body', async ({
  page,
}) => {
  const credentials = await resetLocalAuthE2eData();
  await passwordLogin(page, '/customers', credentials);
  await page.getByRole('link', { name: '新建客户' }).click();
  await page.getByLabel('客户名称').fill('联系人忙碌客户');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(
    page.getByRole('heading', { name: '联系人忙碌客户' }),
  ).toBeVisible();
  const customerId = page.url().split('/').at(-1)!;
  const panel = contactPanel(page);
  await panel.locator('[data-test="contact-new"]').click();
  await fillContact(page, '忙碌联系人', '13800138009');
  const blocker = await beginForeignCustomerAccountBlocker(credentials.userId);
  let first: Awaited<ReturnType<typeof commandHeaders>>;
  try {
    const busy = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/customers/${customerId}/contacts`) &&
        response.request().method() === 'POST',
    );
    await panel.getByRole('button', { name: '保存联系人' }).click();
    const response = await busy;
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'CUSTOMER_CONTACT_BUSY',
    });
    first = await commandHeaders(response.request());
    await expect(panel.locator('[data-test="contact-retry"]')).toBeVisible();
  } finally {
    await blocker.rollback();
  }
  const replay = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/contacts`) &&
      response.request().method() === 'POST',
  );
  await panel.locator('[data-test="contact-retry"]').click();
  const response = await replay;
  expect(response.status()).toBe(201);
  expect(await commandHeaders(response.request())).toMatchObject({
    key: first!.key,
    body: first!.body,
  });
  await expect(panel.getByText('忙碌联系人 · 13800138009')).toBeVisible();
});

test('confirmed contact write with failed current GET stays readonly until GET recovery', async ({
  page,
}) => {
  const credentials = await resetLocalAuthE2eData();
  await passwordLogin(page, '/customers', credentials);
  await page.getByRole('link', { name: '新建客户' }).click();
  await page.getByLabel('客户名称').fill('联系人只读恢复客户');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(
    page.getByRole('heading', { name: '联系人只读恢复客户' }),
  ).toBeVisible();
  const customerId = page.url().split('/').at(-1)!;
  const panel = contactPanel(page);
  let failedGet = false;
  await page.route(`**/api/v1/customers/${customerId}`, async (route) => {
    if (route.request().method() === 'GET' && !failedGet) {
      failedGet = true;
      return route.abort('failed');
    }
    return route.continue();
  });
  await panel.locator('[data-test="contact-new"]').click();
  await fillContact(page, '只读恢复联系人', '13800138010');
  const write = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/contacts`) &&
      response.request().method() === 'POST',
  );
  await panel.getByRole('button', { name: '保存联系人' }).click();
  expect((await write).status()).toBe(201);
  await expect(
    panel.locator('[data-test="contact-refresh-readonly"]'),
  ).toBeVisible();
  await expect(panel.locator('[data-test="contact-retry"]')).toHaveCount(0);
  await expect(panel.locator('[data-test="contact-new"]')).toHaveCount(0);
  await expect(page.locator('[data-test="edit-customer"]')).toHaveCount(0);
  await panel.locator('[data-test="contact-refresh-readonly"]').click();
  await expect(panel.locator('[data-test="contact-new"]')).toBeVisible();
  await expect(page.locator('[data-test="edit-customer"]')).toBeVisible();
});

test('actual revocation clears visible contacts and preserves an unknown original request', async ({
  page,
}) => {
  const credentials = await resetLocalAuthE2eData();
  await passwordLogin(page, '/customers', credentials);
  await page.getByRole('link', { name: '新建客户' }).click();
  await page.getByLabel('客户名称').fill('撤权后原键客户');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(
    page.getByRole('heading', { name: '撤权后原键客户' }),
  ).toBeVisible();
  const customerId = page.url().split('/').at(-1)!;
  const panel = contactPanel(page);
  await panel.locator('[data-test="contact-new"]').click();
  await fillContact(page, '可见原联系人', '13800138011');
  await panel.getByRole('button', { name: '保存联系人' }).click();
  await expect(panel.getByText('可见原联系人 · 13800138011')).toBeVisible();
  await expect(panel.getByRole('button', { name: '保存联系人' })).toBeEnabled();
  let original: Awaited<ReturnType<typeof commandHeaders>> | undefined;
  let intercepted = false;
  await page.route(
    `**/api/v1/customers/${customerId}/contacts`,
    async (route) => {
      if (intercepted || route.request().method() !== 'POST')
        return route.continue();
      intercepted = true;
      original = await commandHeaders(route.request());
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      await route.abort('failed');
    },
  );
  await panel.locator('[data-test="contact-new"]').click();
  await fillContact(page, '未知结果联系人', '13800138012');
  await panel.getByRole('button', { name: '保存联系人' }).click();
  await expect(panel.getByRole('alert')).toContainText('结果尚未确认');
  await expect(panel.locator('[data-test="contact-retry"]')).toBeEnabled();
  await setLocalCustomerGrant('CUSTOMER_EDIT_ROUTINE', false);
  const deniedWrite = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/contacts`) &&
      response.request().method() === 'POST',
  );
  await panel.locator('[data-test="contact-retry"]').click();
  expect((await deniedWrite).status()).toBe(403);
  await expect(panel.locator('[data-test="contact-retry"]')).toBeVisible();
  await setLocalCustomerGrant('CUSTOMER_READ', false);
  const deniedRead = page.waitForResponse(
    (response) =>
      response
        .url()
        .includes(`/customers/${customerId}/contacts?status=ENDED`) &&
      response.request().method() === 'GET',
  );
  await panel.getByRole('button', { name: '已结束' }).click();
  expect([403, 404]).toContain((await deniedRead).status());
  await expect(panel.locator('li[data-test^="contact-"]')).toHaveCount(0);
  await expect(panel.locator('[data-test="contact-retry"]')).toBeVisible();
  await setLocalCustomerGrant('CUSTOMER_READ', true);
  await setLocalCustomerGrant('CUSTOMER_EDIT_ROUTINE', true);
  await panel.locator('[data-test="contact-refresh-readonly"]').click();
  const replay = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/contacts`) &&
      response.request().method() === 'POST',
  );
  await panel.locator('[data-test="contact-retry"]').click();
  const replayed = await replay;
  expect(replayed.status()).toBe(201);
  expect(await commandHeaders(replayed.request())).toMatchObject({
    key: original?.key,
    body: original?.body,
  });
  await panel.getByRole('button', { name: '活动联系人' }).click();
  await expect(panel.locator('li[data-test^="contact-"]')).toHaveCount(2);
});

test('unknown cooperation freezes contact writes, while paused and terminated states allow them', async ({
  page,
}) => {
  const credentials = await resetLocalAuthE2eData();
  await grantCustomerCooperation(localRoleId, 'DEPARTMENT');
  await passwordLogin(page, '/customers', credentials);
  await page.getByRole('link', { name: '新建客户' }).click();
  await page.getByLabel('客户名称').fill('合作与联系人交叉维护客户');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(
    page.getByRole('heading', { name: '合作与联系人交叉维护客户' }),
  ).toBeVisible();
  const customerId = page.url().split('/').at(-1)!;
  const panel = contactPanel(page);
  const cooperation = page.locator('[data-test="cooperation-panel"]');
  let intercepted = false;
  await page.route(
    `**/api/v1/customers/${customerId}/cooperation`,
    async (route) => {
      if (intercepted || route.request().method() !== 'POST')
        return route.continue();
      intercepted = true;
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      await route.abort('failed');
    },
  );
  await cooperation.locator('[data-test="pause-open"]').click();
  await cooperation
    .locator('[data-test="maintenance-reason"]')
    .fill('临时暂停');
  await cooperation.locator('[data-test="maintenance-submit"]').click();
  await expect(cooperation.getByRole('alert')).toContainText('原请求已保留');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-test="contact-new"]')).toHaveCount(0);
  await expect(panel).toContainText('联系人暂时只读');
  const replay = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/cooperation`) &&
      response.request().method() === 'POST',
  );
  await cooperation.locator('[data-test="maintenance-submit"]').click();
  expect((await replay).status()).toBe(201);
  await expect(cooperation).toContainText('已暂停合作');
  await expect(panel.locator('[data-test="contact-new"]')).toBeVisible();
  await cooperation.locator('[data-test="terminate-open"]').click();
  await cooperation
    .locator('[data-test="maintenance-reason"]')
    .fill('合作结束');
  const terminate = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/cooperation`) &&
      response.request().method() === 'POST',
  );
  await cooperation.locator('[data-test="maintenance-submit"]').click();
  expect((await terminate).status()).toBe(201);
  await expect(cooperation).toContainText('已终止合作');
  await panel.locator('[data-test="contact-new"]').click();
  await fillContact(page, '终止后可维护', '13800138013');
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/contacts`) &&
      response.request().method() === 'POST',
  );
  await panel.getByRole('button', { name: '保存联系人' }).click();
  expect((await created).status()).toBe(201);
  await expect(panel.getByText('终止后可维护 · 13800138013')).toBeVisible();
});

test('unknown draft deletion keeps its recovery entry and blocks new contact commands', async ({
  page,
}) => {
  const credentials = await resetLocalAuthE2eData();
  await grantCustomerLifecycle(localRoleId, 'DEPARTMENT');
  await passwordLogin(page, '/customers', credentials);
  await page.getByRole('link', { name: '新建客户' }).click();
  await page.getByLabel('客户名称').fill('删除未知冻结联系人客户');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(
    page.getByRole('heading', { name: '删除未知冻结联系人客户' }),
  ).toBeVisible();
  const customerId = page.url().split('/').at(-1)!;
  const panel = contactPanel(page);
  let intercepted = false;
  await page.route(
    `**/api/v1/customers/${customerId}/delete-draft`,
    async (route) => {
      if (intercepted) return route.continue();
      intercepted = true;
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      await route.abort('failed');
    },
  );
  await page.locator('[data-test="delete-draft-open"]').click();
  await page.locator('[data-test="delete-draft-submit"]').click();
  await expect(
    page.locator('[data-test="delete-draft-confirm"]'),
  ).toContainText('结果尚不确定');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-test="contact-new"]')).toHaveCount(0);
  await expect(page.locator('[data-test="delete-draft-submit"]')).toHaveText(
    '按原请求重试',
  );
});

test('real password admission selects an exact active ID and freezes the snapshot after its end', async ({
  page,
}) => {
  const credentials = await resetLocalAuthE2eData();
  await grantCustomerAdmission(localRoleId, 'DEPARTMENT');
  await passwordLogin(page, '/customers', credentials);
  await page.getByRole('link', { name: '新建客户' }).click();
  await page.getByLabel('客户名称').fill('显式选人准入客户');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(
    page.getByRole('heading', { name: '显式选人准入客户' }),
  ).toBeVisible();
  const url = page.url();
  const customerId = url.split('/').at(-1)!;
  const panel = contactPanel(page);
  for (const [name, phone] of [
    ['候选甲', '13800138006'],
    ['候选乙', '13800138007'],
  ]) {
    await panel.locator('[data-test="contact-new"]').click();
    await fillContact(page, name!, phone!);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/customers/${customerId}/contacts`) &&
        response.request().method() === 'POST',
    );
    await panel.getByRole('button', { name: '保存联系人' }).click();
    expect((await saved).status()).toBe(201);
    await expect(
      panel.getByRole('button', { name: '保存联系人' }),
    ).toBeEnabled();
  }
  const secondId = (await panel
    .getByText('候选乙 · 13800138007')
    .locator('..')
    .getAttribute('data-test'))!.slice(8);
  const accountsBefore = await getCustomerContactAccountCounts(customerId);
  await fillAdmission(page, 'CONTACT-ADMIT-001');
  await page.getByLabel('选择一位活动联系人').selectOption(secondId);
  const admitted = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/admission`) &&
      response.request().method() === 'POST',
  );
  await page.locator('[data-test="admit-submit"]').click();
  const admissionResponse = await admitted;
  expect(admissionResponse.status(), await admissionResponse.text()).toBe(201);
  const sent = await commandHeaders(admissionResponse.request());
  expect(sent.key).toBeTruthy();
  expect(sent.csrf).toBeTruthy();
  expect(sent.cookie).toBeTruthy();
  expect(sent.bearer).toBeUndefined();
  expect(sent.body).toMatchObject({ admissionContactId: secondId });
  expect(sent.body).not.toHaveProperty('admissionContactName');
  expect(sent.body).not.toHaveProperty('admissionContactPhone');
  expect(sent.body).not.toHaveProperty('admissionContactEmail');
  const currentDetail = await page
    .context()
    .request.get(`http://127.0.0.1:5174/api/v1/customers/${customerId}`);
  expect(currentDetail.status()).toBe(200);
  const detail = (await currentDetail.json()) as Record<string, unknown>;
  expect(detail.responsibleUserId).toBe(credentials.userId);
  expect(detail).not.toHaveProperty('customerManagerId');
  await expect(
    panel.locator('[data-test="admission-contact-snapshot"]'),
  ).toContainText('候选乙');
  await panel
    .locator(`[data-test="contact-${secondId}"]`)
    .getByRole('button', { name: '编辑' })
    .click();
  await panel.getByLabel('结束原因（选填）').fill('联络关系结束');
  await panel.getByRole('button', { name: '结束关系' }).click();
  await expect(panel.locator(`[data-test="contact-${secondId}"]`)).toHaveCount(
    0,
  );
  const frozen = panel.locator('[data-test="admission-contact-snapshot"]');
  await expect(frozen).toContainText('候选乙');
  await page.reload();
  await expect(frozen).toContainText('候选乙');
  await page.getByRole('button', { name: '退出登录' }).click();
  await passwordLogin(page, url, credentials);
  await expect(frozen).toContainText('候选乙');
  await panel.getByRole('button', { name: '已结束' }).click();
  await expect(
    panel.locator(`[data-test="contact-${secondId}"]`),
  ).toBeVisible();
  expect(await getCustomerContactAccountCounts(customerId)).toEqual(
    accountsBefore,
  );
});

test('real password old new-customer form creates one contact and keeps its ID in the panel', async ({
  page,
}) => {
  const credentials = await resetLocalAuthE2eData();
  await passwordLogin(page, '/customers', credentials);
  await page.getByRole('link', { name: '新建客户' }).click();
  await page.getByLabel('客户名称').fill('旧建档表单客户');
  await page.getByLabel('联系人姓名').fill('旧联系人');
  await page.getByLabel('电话').fill('13800138008');
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/customers') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '保存草稿' }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const customerId = ((await response.json()) as { id: string }).id;
  expect((await commandHeaders(response.request())).body).toMatchObject({
    admissionContactName: '旧联系人',
    admissionContactPhone: '13800138008',
  });
  await expect(page).toHaveURL(`/customers/${customerId}`);
  await expect(
    contactPanel(page).locator('li[data-test^="contact-"]'),
  ).toHaveCount(1);
  const contactId = (await contactPanel(page)
    .locator('li[data-test^="contact-"]')
    .getAttribute('data-test'))!.slice(8);
  await page.reload();
  await expect(
    contactPanel(page).locator(`[data-test="contact-${contactId}"]`),
  ).toContainText('旧联系人');
});

test('real cookie service history serves page two with the original created version', async ({
  page,
}) => {
  const credentials = await resetLocalAuthE2eData();
  await passwordLogin(page, '/customers', credentials);
  await page.getByRole('link', { name: '新建客户' }).click();
  await page.getByLabel('客户名称').fill('联系人多页历史客户');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(
    page.getByRole('heading', { name: '联系人多页历史客户' }),
  ).toBeVisible();
  const customerId = page.url().split('/').at(-1)!;
  const panel = contactPanel(page);
  await panel.locator('[data-test="contact-new"]').click();
  await fillContact(page, '初始历史联系人', '13800138015');
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/contacts`) &&
      response.request().method() === 'POST',
  );
  await panel.getByRole('button', { name: '保存联系人' }).click();
  const createdResponse = await created;
  expect(createdResponse.status()).toBe(201);
  const original = (await createdResponse.json()) as {
    contact: { id: string; version: number };
    customerVersion: number;
  };
  let customerVersion = original.customerVersion;
  let contactVersion = original.contact.version;
  for (let index = 1; index <= 20; index += 1) {
    const edited = await page
      .context()
      .request.patch(
        `http://127.0.0.1:5174/api/v1/customers/${customerId}/contacts/${original.contact.id}`,
        {
          headers: await browserCommandHeaders(page, randomUUID()),
          data: {
            expectedCustomerVersion: customerVersion,
            expectedContactVersion: contactVersion,
            name: `历史版${index}`,
          },
        },
      );
    expect(edited.status(), await edited.text()).toBe(200);
    const result = (await edited.json()) as {
      customerVersion: number;
      contact: { version: number };
    };
    customerVersion = result.customerVersion;
    contactVersion = result.contact.version;
  }
  await page.reload();
  await panel
    .locator(`[data-test="contact-${original.contact.id}"]`)
    .getByRole('button', { name: /历史版20/u })
    .click();
  await expect(
    panel.getByRole('heading', { name: '联系人历史：历史版20' }),
  ).toBeVisible();
  await expect(panel.getByText('初始历史联系人', { exact: false })).toHaveCount(
    0,
  );
  await panel.getByRole('button', { name: '下一页' }).click();
  await expect(
    panel.getByText('初始历史联系人', { exact: false }),
  ).toBeVisible();
});

test('ended contact page two survives readonly recovery against the actual service', async ({
  page,
}) => {
  test.setTimeout(60000);
  const credentials = await resetLocalAuthE2eData();
  await passwordLogin(page, '/customers', credentials);
  await page.getByRole('link', { name: '新建客户' }).click();
  await page.getByLabel('客户名称').fill('结束联系人第二页客户');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(
    page.getByRole('heading', { name: '结束联系人第二页客户' }),
  ).toBeVisible();
  const customerId = page.url().split('/').at(-1)!;
  let version = 1;
  let oldestId = '';
  for (let index = 1; index <= 21; index += 1) {
    const created = await page
      .context()
      .request.post(
        `http://127.0.0.1:5174/api/v1/customers/${customerId}/contacts`,
        {
          headers: await browserCommandHeaders(page, randomUUID()),
          data: {
            expectedCustomerVersion: version,
            name: `结束页联系人${index}`,
            phone: `13800138${String(index).padStart(3, '0')}`,
          },
        },
      );
    expect(created.status(), await created.text()).toBe(201);
    const made = (await created.json()) as {
      contact: { id: string; version: number };
      customerVersion: number;
    };
    if (index === 1) oldestId = made.contact.id;
    version = made.customerVersion;
    const ended = await page
      .context()
      .request.post(
        `http://127.0.0.1:5174/api/v1/customers/${customerId}/contacts/${made.contact.id}/end`,
        {
          headers: await browserCommandHeaders(page, randomUUID()),
          data: {
            expectedCustomerVersion: version,
            expectedContactVersion: made.contact.version,
          },
        },
      );
    expect(ended.status(), await ended.text()).toBe(200);
    version = ((await ended.json()) as { customerVersion: number })
      .customerVersion;
  }
  await page.reload();
  const panel = contactPanel(page);
  await panel.getByRole('button', { name: '已结束' }).click();
  await expect(panel.getByText('1 / 2')).toBeVisible();
  await panel.getByRole('button', { name: '下一页' }).click();
  await expect(
    panel.locator(`[data-test="contact-${oldestId}"]`),
  ).toBeVisible();
  let failedGet = false;
  await page.route(`**/api/v1/customers/${customerId}`, async (route) => {
    if (route.request().method() === 'GET' && !failedGet) {
      failedGet = true;
      return route.abort('failed');
    }
    return route.continue();
  });
  await panel.locator('[data-test="contact-new"]').click();
  await fillContact(page, '恢复时新联系人', '13800138018');
  const newWrite = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/contacts`) &&
      response.request().method() === 'POST',
  );
  await panel.getByRole('button', { name: '保存联系人' }).click();
  expect((await newWrite).status()).toBe(201);
  await expect(
    panel.locator('[data-test="contact-refresh-readonly"]'),
  ).toBeVisible();
  await panel.locator('[data-test="contact-refresh-readonly"]').click();
  await expect(
    panel.locator(`[data-test="contact-${oldestId}"]`),
  ).toBeVisible();
  await expect(panel.getByText('2 / 2')).toBeVisible();
  await expect(panel.locator('[data-test="contact-new"]')).toBeVisible();
});

test('a late actual contact read from customer A cannot populate customer B', async ({
  page,
}) => {
  const credentials = await resetLocalAuthE2eData();
  await passwordLogin(page, '/customers', credentials);
  const customers: string[] = [];
  for (const [customerName, contactName, phone] of [
    ['迟到客户甲', '甲联系人', '13800138016'],
    ['迟到客户乙', '乙联系人', '13800138017'],
  ]) {
    await page.goto('/customers/new');
    await page.getByLabel('客户名称').fill(customerName!);
    await page.getByRole('button', { name: '保存草稿' }).click();
    await expect(
      page.getByRole('heading', { name: customerName! }),
    ).toBeVisible();
    customers.push(page.url().split('/').at(-1)!);
    const panel = contactPanel(page);
    await panel.locator('[data-test="contact-new"]').click();
    await fillContact(page, contactName!, phone!);
    await panel.getByRole('button', { name: '保存联系人' }).click();
    await expect(panel.getByText(`${contactName} · ${phone}`)).toBeVisible();
    await expect(
      panel.getByRole('button', { name: '保存联系人' }),
    ).toBeEnabled();
  }
  const [sourceId, targetId] = customers;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let observed!: () => void;
  const seen = new Promise<void>((resolve) => {
    observed = resolve;
  });
  let intercepted = false;
  await page.route(
    `**/api/v1/customers/${sourceId}/contacts?**`,
    async (route) => {
      if (intercepted) return route.continue();
      intercepted = true;
      const actual = await route.fetch();
      expect(actual.status()).toBe(200);
      observed();
      await held;
      await route.fulfill({ response: actual }).catch(() => {});
    },
  );
  try {
    await page.goto(`/customers/${sourceId}`);
    await seen;
    await page.goto(`/customers/${targetId}`);
    await expect(
      page.getByRole('heading', { name: '迟到客户乙' }),
    ).toBeVisible();
    await expect(
      contactPanel(page).getByText('乙联系人 · 13800138017'),
    ).toBeVisible();
  } finally {
    release();
  }
  await expect(
    contactPanel(page).getByText('甲联系人 · 13800138016'),
  ).toHaveCount(0);
  await expect(page).toHaveURL(`/customers/${targetId}`);
});

test('legacy flat contact keeps its ID through partial PATCH and explicit maintenance', async ({
  request,
}) => {
  const customer = await createDraft(request, '旧接口联系人客户', {
    admissionContactName: '原联系人',
    admissionContactPhone: '13800138004',
  });
  const original = (await listContacts(request, customer.id)).items[0]!;
  expect(original.name).toBe('原联系人');
  const patched = await request.patch(`/api/v1/customers/${customer.id}`, {
    headers: bearerA,
    data: {
      expectedVersion: customer.version,
      admissionContactEmail: 'old@example.com',
    },
  });
  expect(patched.status(), await patched.text()).toBe(200);
  const afterPatch = await listContacts(request, customer.id);
  expect(afterPatch.items).toHaveLength(1);
  expect(afterPatch.items[0]).toMatchObject({
    id: original.id,
    name: original.name,
    phone: original.phone,
    email: 'old@example.com',
  });
  const changed = await request.patch(
    `/api/v1/customers/${customer.id}/contacts/${original.id}`,
    {
      headers: { ...bearerA, 'Idempotency-Key': randomUUID() },
      data: {
        expectedCustomerVersion: 2,
        expectedContactVersion: afterPatch.items[0]!.version,
        name: '更新联系人',
      },
    },
  );
  expect(changed.status(), await changed.text()).toBe(200);
  expect((await changed.json()).contact.id).toBe(original.id);
});

test('old flat admission receipt fingerprint and frozen JSON survive manual contact edit and end', async ({
  request,
}) => {
  await grantCustomerAdmission(e2eFixtures.roleA, 'DEPARTMENT');
  const customer = await createDraft(request, '旧平铺准入留史客户', {
    admissionContactName: '旧准入联系人',
    admissionContactPhone: '13800138014',
  });
  const original = (await listContacts(request, customer.id)).items[0]!;
  const draft = await request.post('/api/v1/materials/upload-drafts', {
    headers: bearerA,
    data: {
      ownerType: 'CUSTOMER',
      ownerId: customer.id,
      category: 'CUSTOMER_IDENTITY',
      purpose: 'IDENTITY_FULL',
      originalFilename: 'old-flat.pdf',
      declaredMimeType: 'application/pdf',
    },
  });
  expect(draft.status(), await draft.text()).toBe(201);
  const draftId = ((await draft.json()) as { id: string }).id;
  const uploaded = await request.put(
    `/api/v1/materials/upload-drafts/${draftId}/content`,
    {
      headers: { ...bearerA, 'Content-Type': 'application/octet-stream' },
      data: pdfBytes,
    },
  );
  expect(uploaded.status(), await uploaded.text()).toBe(200);
  const contentVersionId = (
    (await uploaded.json()) as { contentVersionId: string }
  ).contentVersionId;
  const command = {
    expectedVersion: customer.version,
    customerType: 'ENTERPRISE',
    name: '旧平铺准入留史客户',
    identityType: 'BUSINESS_LICENSE',
    identityNumber: 'OLD-FLAT-CONTACT-001',
    identityValidityMode: 'LONG_TERM',
    admissionContactName: '旧准入联系人',
    admissionContactPhone: '13800138014',
    identityDocumentContentVersionIds: [contentVersionId],
  };
  const key = randomUUID();
  const admitted = await request.post(
    `/api/v1/customers/${customer.id}/admission`,
    {
      headers: { ...bearerA, 'Idempotency-Key': key },
      data: command,
    },
  );
  expect(admitted.status(), await admitted.text()).toBe(201);
  const admittedResult = (await admitted.json()) as { version: number };
  const frozenBefore = await getCustomerContactAdmissionEvidence(customer.id);
  expect(frozenBefore.bindings).toBe(0);
  const afterAdmission = (await listContacts(request, customer.id)).items;
  expect(afterAdmission).toHaveLength(1);
  expect(afterAdmission[0]!.id).toBe(original.id);
  const edited = await request.patch(
    `/api/v1/customers/${customer.id}/contacts/${original.id}`,
    {
      headers: { ...bearerA, 'Idempotency-Key': randomUUID() },
      data: {
        expectedCustomerVersion: admittedResult.version,
        expectedContactVersion: afterAdmission[0]!.version,
        name: '当前修改联系人',
      },
    },
  );
  expect(edited.status(), await edited.text()).toBe(200);
  const editResult = (await edited.json()) as {
    customerVersion: number;
    contact: { version: number };
  };
  const ended = await request.post(
    `/api/v1/customers/${customer.id}/contacts/${original.id}/end`,
    {
      headers: { ...bearerA, 'Idempotency-Key': randomUUID() },
      data: {
        expectedCustomerVersion: editResult.customerVersion,
        expectedContactVersion: editResult.contact.version,
      },
    },
  );
  expect(ended.status(), await ended.text()).toBe(200);
  const frozenAfter = await getCustomerContactAdmissionEvidence(customer.id);
  expect(frozenAfter).toEqual(frozenBefore);
  const replay = await request.post(
    `/api/v1/customers/${customer.id}/admission`,
    {
      headers: { ...bearerA, 'Idempotency-Key': key },
      data: command,
    },
  );
  expect(replay.status(), await replay.text()).toBe(201);
  expect(await replay.json()).toEqual(admittedResult);
  const current = await request.get(`/api/v1/customers/${customer.id}`, {
    headers: bearerA,
  });
  expect(current.status()).toBe(200);
  expect(await current.json()).toMatchObject({
    admissionContactName: null,
    admissionContactSnapshot: { name: '旧准入联系人' },
  });
});

test('revoked routine grant and foreign department cannot read or replay contact IDs', async ({
  request,
}) => {
  const customer = await createDraft(request, '权限边界客户');
  const key = randomUUID();
  const body = {
    expectedCustomerVersion: customer.version,
    name: '边界联系人',
    phone: '13800138005',
  };
  const create = await request.post(
    `/api/v1/customers/${customer.id}/contacts`,
    {
      headers: { ...bearerA, 'Idempotency-Key': key },
      data: body,
    },
  );
  expect(create.status(), await create.text()).toBe(201);
  const id = (await create.json()).contact.id as string;
  const another = await createDraft(request, '同部门另一客户');
  const wrongCustomerHistory = await request.get(
    `/api/v1/customers/${another.id}/contacts/${id}/versions`,
    { headers: bearerA },
  );
  expect(wrongCustomerHistory.status()).toBe(404);
  const wrongCustomerWrite = await request.post(
    `/api/v1/customers/${another.id}/contacts/${id}/end`,
    {
      headers: { ...bearerA, 'Idempotency-Key': randomUUID() },
      data: {
        expectedCustomerVersion: another.version,
        expectedContactVersion: 1,
      },
    },
  );
  expect(wrongCustomerWrite.status()).toBe(404);
  for (const path of [
    `/api/v1/customers/${customer.id}/contacts`,
    `/api/v1/customers/${customer.id}/contacts/${id}/versions`,
  ]) {
    const foreign = await request.get(path, { headers: bearerB });
    expect(foreign.status()).toBe(404);
  }
  const outsideTeam = await request.get(
    `/api/v1/customers/${customer.id}/contacts`,
    { headers: { Authorization: `Bearer ${e2eFixtures.tokenSelf}` } },
  );
  expect(outsideTeam.status()).toBe(404);
  const guessed = await request.post(
    `/api/v1/customers/${customer.id}/contacts/${id}/end`,
    {
      headers: { ...bearerB, 'Idempotency-Key': randomUUID() },
      data: { expectedCustomerVersion: 2, expectedContactVersion: 1 },
    },
  );
  expect(guessed.status()).toBe(404);
  await revokeCustomerRoutineEdit(e2eFixtures.roleA);
  const replay = await request.post(
    `/api/v1/customers/${customer.id}/contacts`,
    {
      headers: { ...bearerA, 'Idempotency-Key': key },
      data: body,
    },
  );
  expect(replay.status()).toBe(403);
  expect((await listContacts(request, customer.id)).items).toHaveLength(1);
});

test('real CLIENT and LAWYER sessions receive no contact management grant', async ({
  request,
}) => {
  await resetCoreLeadE2eData();
  await grantCustomerRoutineEdit(coreLeadFixtures.roleA, 'TEAM');
  const customerId = coreLeadFixtures.admittedCustomer;
  const current = await request.get(`/api/v1/customers/${customerId}`, {
    headers: bearerA,
  });
  expect(current.status()).toBe(200);
  const version = ((await current.json()) as { version: number }).version;
  const created = await request.post(
    `/api/v1/customers/${customerId}/contacts`,
    {
      headers: { ...bearerA, 'Idempotency-Key': randomUUID() },
      data: {
        expectedCustomerVersion: version,
        name: '外部身份边界联系人',
        phone: '13800138019',
      },
    },
  );
  expect(created.status(), await created.text()).toBe(201);
  const contactId = ((await created.json()) as { contact: { id: string } })
    .contact.id;
  const username = `client-${randomUUID().slice(0, 8)}`;
  const password = 'client correct horse battery';
  const account = await request.post(
    `/api/v1/customers/${customerId}/client-accounts`,
    {
      headers: bearerA,
      data: { displayName: '外部客户账号', username, password },
    },
  );
  expect(account.status(), await account.text()).toBe(201);
  const lawyer = await createLawyerAccountThroughApi(request);
  for (const actor of [
    { principal: 'CLIENT', username, password },
    {
      principal: 'LAWYER',
      username: lawyer.username,
      password: lawyer.password,
    },
  ]) {
    const session = await playwrightRequest.newContext({
      baseURL: 'http://127.0.0.1:5174',
    });
    try {
      const login = await session.post('/api/v1/auth/login', {
        headers: { Origin: 'http://127.0.0.1:5174' },
        data: { username: actor.username, password: actor.password },
      });
      expect(login.status(), await login.text()).toBe(200);
      const identity = (await login.json()) as {
        principalType: string;
        csrfToken: string;
      };
      expect(identity.principalType).toBe(actor.principal);
      const read = await session.get(
        `/api/v1/customers/${customerId}/contacts`,
      );
      expect([403, 404]).toContain(read.status());
      const history = await session.get(
        `/api/v1/customers/${customerId}/contacts/${contactId}/versions`,
      );
      expect([403, 404]).toContain(history.status());
      const write = await session.post(
        `/api/v1/customers/${customerId}/contacts`,
        {
          headers: {
            Origin: 'http://127.0.0.1:5174',
            'X-CSRF-Token': identity.csrfToken,
            'Idempotency-Key': randomUUID(),
          },
          data: {
            expectedCustomerVersion: version + 1,
            name: '外部账号不得创建',
            phone: '13800138020',
          },
        },
      );
      expect([403, 404]).toContain(write.status());
    } finally {
      await session.dispose();
    }
  }
  expect((await listContacts(request, customerId)).items).toHaveLength(2);
});
