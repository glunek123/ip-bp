import { expect, test, type Page, type Request } from '@playwright/test';
import {
  disconnectCustomerTestDatabase,
  resetCustomerE2eData,
  resetLocalAuthE2eData,
} from '../support/customer-database.mjs';
import {
  bumpCustomerSettlementLocalActorRevision,
  disconnectCustomerSettlementDatabase,
  getCustomerSettlementState,
  setCustomerSettlementGrant,
} from '../support/customer-settlement-database.mjs';

const localRoleId = '30000000-0000-4000-8000-000000000010';
const credentials = {
  username: 'e2e.local.admin',
  password: 'Browser-test-passphrase-2026',
};

async function login(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(credentials.username);
  await page.getByLabel('密码').fill(credentials.password);
  const response = page.waitForResponse(
    (value) =>
      value.url().endsWith('/api/v1/auth/login') &&
      value.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '登录', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page).toHaveURL(path);
}

async function createCustomer(page: Page, name: string): Promise<string> {
  await page.getByRole('link', { name: '新建客户' }).click();
  await page.getByLabel('客户名称').fill(name);
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  return page.url().split('/').at(-1)!;
}

async function grant(
  read: boolean,
  register: boolean,
  correct: boolean,
): Promise<void> {
  for (const [action, enabled] of [
    ['CUSTOMER_SETTLEMENT_READ', read],
    ['CUSTOMER_SETTLEMENT_REGISTER', register],
    ['CUSTOMER_SETTLEMENT_CORRECT', correct],
  ] as const)
    await setCustomerSettlementGrant(
      localRoleId,
      action,
      enabled,
      'DEPARTMENT',
    );
}

async function assertCookieCommand(
  request: Request,
): Promise<{ key: string; body: unknown }> {
  const headers = await request.allHeaders();
  expect(headers.cookie).toBeTruthy();
  expect(headers['x-csrf-token']).toBeTruthy();
  expect(headers.authorization).toBeUndefined();
  expect(headers['idempotency-key']).toBeTruthy();
  return { key: headers['idempotency-key']!, body: request.postDataJSON() };
}

async function fillRegister(
  page: Page,
  date: string,
  amount: string,
  received?: string,
): Promise<void> {
  const panel = page.locator('[data-test="settlement-panel"]');
  await panel.locator('[data-test="settlement-date-input"]').fill(date);
  await panel.locator('[data-test="settlement-amount-input"]').fill(amount);
  if (received !== undefined) {
    await panel.locator('[data-test="settlement-received-known"]').check();
    await panel
      .locator('[data-test="settlement-received-input"]')
      .fill(received);
  }
}

test.beforeEach(async () => {
  await resetCustomerE2eData();
  await resetLocalAuthE2eData();
});
test.afterAll(async () => {
  await resetLocalAuthE2eData();
  await resetCustomerE2eData();
  await disconnectCustomerSettlementDatabase();
  await disconnectCustomerTestDatabase();
});

test('real cookie session registers two same-month facts, corrects and reads exact history after relogin', async ({
  page,
}) => {
  await grant(false, true, false);
  await login(page, '/customers');
  const customerId = await createCustomer(page, 'CU008 页面事实客户');
  const listRequests: Request[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'GET' &&
      request.url().includes(`/customers/${customerId}/settlements`)
    )
      listRequests.push(request);
  });
  await page.getByRole('tab', { name: '结算记录' }).click();
  const panel = page.locator('[data-test="settlement-panel"]');
  await expect(
    panel.locator('[data-test="settlement-register-form"]'),
  ).toBeVisible();
  await expect(page.locator('[data-test="settlement-top-kpis"]')).toHaveCount(
    0,
  );
  await expect(panel.locator('[data-test="settlement-records"]')).toHaveCount(
    0,
  );
  expect(listRequests).toHaveLength(0);
  await fillRegister(page, '2026-10-02', '100.00');
  const firstResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/settlements`) &&
      response.request().method() === 'POST',
  );
  await panel.locator('[data-test="settlement-register-submit"]').click();
  const first = await firstResponse;
  expect(first.status(), await first.text()).toBe(201);
  const firstSent = await assertCookieCommand(first.request());
  expect(firstSent.body).toMatchObject({
    settlementDate: '2026-10-02',
    settlementAmount: '100.00',
    receivedAmount: null,
  });
  expect(listRequests).toHaveLength(0);
  await expect(
    panel.locator('[data-test="settlement-register-submit"]'),
  ).toBeEnabled();

  await fillRegister(page, '2026-10-19', '50.00', '0.00');
  await panel.locator('[data-test="settlement-received-date-known"]').check();
  await panel
    .locator('[data-test="settlement-received-date-input"]')
    .fill('2026-09-30');
  const secondResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/settlements`) &&
      response.request().method() === 'POST',
  );
  await panel.locator('[data-test="settlement-register-submit"]').click();
  const second = await secondResponse;
  expect(second.status(), await second.text()).toBe(201);
  expect((await assertCookieCommand(second.request())).body).toMatchObject({
    receivedAmount: '0.00',
    receivedDate: '2026-09-30',
  });
  expect(listRequests).toHaveLength(0);

  await grant(true, true, true);
  const listResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/customers/${customerId}/settlements?page=`) &&
      response.request().method() === 'GET',
  );
  await page.reload();
  const list = await listResponse;
  expect(list.status()).toBe(200);
  const projection = (await list.json()) as {
    total: number;
    stats: {
      totalSettlement: string;
      receivedKnownSubtotal: string;
      receivedUnknownCount: number;
      pendingAmount: null;
    };
    items: Array<{
      id: string;
      currentVersion: { receivedAmount: string | null };
    }>;
  };
  expect(projection.total).toBe(2);
  expect(projection.stats).toMatchObject({
    totalSettlement: '150.00',
    receivedKnownSubtotal: '0.00',
    receivedUnknownCount: 1,
    pendingAmount: null,
  });
  await expect(page.locator('[data-test="settlement-top-kpis"]')).toContainText(
    '¥150.00',
  );
  await page.getByRole('tab', { name: '结算记录' }).click();
  await expect(panel.locator('[data-test="settlement-record"]')).toHaveCount(2);
  const original = projection.items.find(
    (item) => item.currentVersion.receivedAmount === null,
  )!;
  await panel
    .locator(`[data-test="correct-settlement-${original.id}"]`)
    .click();
  await panel.locator('[data-test="settlement-amount-input"]').fill('120.00');
  await panel
    .locator('[data-test="settlement-correction-reason"]')
    .fill('原始凭据复核');
  const correctionResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/settlements/${original.id}/corrections`) &&
      response.request().method() === 'POST',
  );
  await panel.locator('[data-test="settlement-correct-submit"]').click();
  const corrected = await correctionResponse;
  expect(corrected.status(), await corrected.text()).toBe(200);
  expect((await assertCookieCommand(corrected.request())).body).toMatchObject({
    settlementAmount: '120.00',
    invoiceAmount: null,
    receivedAmount: null,
    receivedDate: null,
    reason: '原始凭据复核',
    expectedRecordVersion: 1,
  });
  await expect(page.locator('[data-test="settlement-top-kpis"]')).toContainText(
    '¥170.00',
  );
  await panel
    .locator(`[data-test="settlement-history-${original.id}"]`)
    .click();
  await expect(
    panel.locator(`[data-test="settlement-history-list-${original.id}"]`),
  ).toContainText('原始凭据复核');
  const history = await page.evaluate(
    async ({ customerId, recordId }) => {
      const response = await fetch(
        `/api/v1/customers/${customerId}/settlements/${recordId}/versions`,
        { credentials: 'include' },
      );
      return { status: response.status, body: await response.json() };
    },
    { customerId, recordId: original.id },
  );
  expect(history.status).toBe(200);
  expect(history.body.items).toMatchObject([
    {
      version: 2,
      settlementAmount: '120.00',
      correctionReason: '原始凭据复核',
    },
    { version: 1, settlementAmount: '100.00', correctionReason: null },
  ]);
  await page.reload();
  await expect(page.locator('[data-test="settlement-top-kpis"]')).toContainText(
    '¥170.00',
  );
  await page.getByRole('button', { name: '退出登录' }).click();
  await login(page, `/customers/${customerId}`);
  await expect(page.locator('[data-test="settlement-top-kpis"]')).toContainText(
    '¥170.00',
  );
});

test('lost response retries the exact cookie command once and freezes other customer writes', async ({
  page,
}) => {
  await grant(true, true, true);
  await login(page, '/customers');
  const customerId = await createCustomer(page, 'CU008 原键恢复客户');
  await page.getByRole('tab', { name: '结算记录' }).click();
  const panel = page.locator('[data-test="settlement-panel"]');
  await fillRegister(page, '2026-10-03', '9.00');
  let original: { key: string; body: unknown } | undefined;
  let intercepted = false;
  await page.route(
    `**/api/v1/customers/${customerId}/settlements`,
    async (route) => {
      if (intercepted || route.request().method() !== 'POST')
        return route.continue();
      intercepted = true;
      original = await assertCookieCommand(route.request());
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort('failed');
    },
  );
  await panel.locator('[data-test="settlement-register-submit"]').click();
  await expect(
    panel.locator('[data-test="settlement-retry-original"]'),
  ).toBeVisible();
  await page.getByRole('tab', { name: '权利资产' }).click();
  await expect(page.locator('[data-test="right-assets-frozen"]')).toBeVisible();
  await page.getByRole('tab', { name: '基本信息' }).click();
  await expect(page.locator('[data-test="edit-customer"]')).toHaveCount(0);
  const revisionBefore = await page.evaluate(async () => {
    const response = await fetch('/api/v1/auth/session', {
      credentials: 'include',
    });
    return ((await response.json()) as { authorizationRevision: number })
      .authorizationRevision;
  });
  await setCustomerSettlementGrant(
    localRoleId,
    'CUSTOMER_SETTLEMENT_REGISTER',
    false,
  );
  await setCustomerSettlementGrant(
    localRoleId,
    'CUSTOMER_SETTLEMENT_READ',
    false,
  );
  const revisionAfter = await bumpCustomerSettlementLocalActorRevision();
  expect(revisionAfter).toBe(revisionBefore + 1);
  await page.reload();
  await page.getByRole('tab', { name: '结算记录' }).click();
  await expect(page.locator('[data-test="settlement-top-kpis"]')).toHaveCount(
    0,
  );
  const deniedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/settlements`) &&
      response.request().method() === 'POST',
  );
  await panel
    .locator('[data-test="settlement-retry-original-private"]')
    .click();
  expect((await deniedResponse).status()).toBe(403);
  await expect(
    panel.locator('[data-test="settlement-retry-original-private"]'),
  ).toBeVisible();
  await grant(true, true, true);
  await page.reload();
  await page.getByRole('tab', { name: '结算记录' }).click();
  const replayResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/settlements`) &&
      response.request().method() === 'POST',
  );
  await panel.locator('[data-test="settlement-retry-original"]').click();
  const replay = await replayResponse;
  expect(replay.status()).toBe(201);
  expect(await assertCookieCommand(replay.request())).toEqual(original);
  await expect(panel.locator('[data-test="settlement-record"]')).toHaveCount(1);
  const state = await getCustomerSettlementState(customerId);
  expect(state.records).toHaveLength(1);
  expect(state.versionCount).toBe(1);
  expect(state.receiptCount).toBe(1);
});

test('sub-yuan overcollection stays visible in the real list and KPI after reload', async ({
  page,
}) => {
  await grant(true, true, true);
  await login(page, '/customers');
  const customerId = await createCustomer(page, 'CU008 不足一元超收客户');
  await page.getByRole('tab', { name: '结算记录' }).click();
  const panel = page.locator('[data-test="settlement-panel"]');
  await fillRegister(page, '2026-10-10', '1.00', '1.01');
  const commandResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/settlements`) &&
      response.request().method() === 'POST',
  );
  const listResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/customers/${customerId}/settlements?page=`) &&
      response.request().method() === 'GET',
  );
  await panel.locator('[data-test="settlement-register-submit"]').click();
  const command = await commandResponse;
  expect(command.status()).toBe(201);
  expect((await assertCookieCommand(command.request())).body).toMatchObject({
    settlementAmount: '1.00',
    receivedAmount: '1.01',
  });
  const list = await listResponse;
  expect(list.status()).toBe(200);
  expect(((await list.json()) as { stats: unknown }).stats).toMatchObject({
    totalSettlement: '1.00',
    receivedKnownSubtotal: '1.01',
    pendingAmount: '-0.01',
    recoveryRate: '101.00',
  });
  await expect(panel.locator('[data-test="settlement-record"]')).toHaveCount(1);
  await expect(
    page.locator('[data-test="settlement-kpi-pending"]'),
  ).toContainText('超收');
  await expect(
    page.locator('[data-test="settlement-kpi-pending"]'),
  ).toContainText('¥0.01');
  await expect(page.locator('[data-test="settlement-kpi-rate"]')).toContainText(
    '101.00%',
  );
  await page.reload();
  await expect(
    page.locator('[data-test="settlement-kpi-pending"]'),
  ).toContainText('¥0.01');
  await expect(page.locator('[data-test="settlement-kpi-rate"]')).toContainText(
    '101.00%',
  );
});

test('failed version history GET clears the sensitive projection and correction draft', async ({
  page,
}) => {
  await grant(true, true, true);
  await login(page, '/customers');
  const customerId = await createCustomer(page, 'CU008 历史读取失败客户');
  await page.getByRole('tab', { name: '结算记录' }).click();
  const panel = page.locator('[data-test="settlement-panel"]');
  await fillRegister(page, '2026-10-09', '64.00');
  const response = page.waitForResponse(
    (value) =>
      value.url().endsWith(`/customers/${customerId}/settlements`) &&
      value.request().method() === 'POST',
  );
  await panel.locator('[data-test="settlement-register-submit"]').click();
  const recordId = ((await (await response).json()) as { recordId: string })
    .recordId;
  await panel.locator(`[data-test="settlement-history-${recordId}"]`).click();
  await expect(
    panel.locator(`[data-test="settlement-history-list-${recordId}"]`),
  ).toBeVisible();
  await panel.locator(`[data-test="settlement-history-${recordId}"]`).click();
  await panel.locator(`[data-test="correct-settlement-${recordId}"]`).click();
  await expect(
    panel.locator('[data-test="settlement-register-form"]'),
  ).toContainText('64.00');
  await page.route(
    `**/api/v1/customers/${customerId}/settlements/${recordId}/versions*`,
    async (route) => route.abort('failed'),
  );
  await panel.locator(`[data-test="settlement-history-${recordId}"]`).click();
  await expect(page.locator('[data-test="settlement-top-kpis"]')).toHaveCount(
    0,
  );
  await expect(panel.locator('[data-test="settlement-records"]')).toHaveCount(
    0,
  );
  await expect(panel.getByText('64.00')).toHaveCount(0);
});

test('late settlement GET from another customer cannot replace a frozen current customer', async ({
  page,
}) => {
  await grant(true, true, true);
  await login(page, '/customers');
  const oldId = await createCustomer(page, 'CU008 旧客户迟到读取');
  await page.getByRole('tab', { name: '结算记录' }).click();
  await fillRegister(page, '2026-10-10', '41.00');
  const oldPost = page.waitForResponse(
    (value) =>
      value.url().endsWith(`/customers/${oldId}/settlements`) &&
      value.request().method() === 'POST',
  );
  await page.locator('[data-test="settlement-register-submit"]').click();
  expect((await oldPost).status()).toBe(201);
  await expect(page.locator('[data-test="settlement-top-kpis"]')).toContainText(
    '¥41.00',
  );
  await page.getByRole('link', { name: '← 返回客户列表' }).click();
  const currentId = await createCustomer(page, 'CU008 当前冻结客户');
  await page.getByRole('tab', { name: '结算记录' }).click();
  await fillRegister(page, '2026-10-10', '72.00');
  let responseLost = false;
  await page.route(
    `**/api/v1/customers/${currentId}/settlements`,
    async (route) => {
      if (responseLost || route.request().method() !== 'POST')
        return route.continue();
      responseLost = true;
      const result = await route.fetch();
      expect(result.status()).toBe(201);
      await route.abort('failed');
    },
  );
  await page.locator('[data-test="settlement-register-submit"]').click();
  await expect(
    page.locator('[data-test="settlement-retry-original"]'),
  ).toBeVisible();
  await page.getByRole('link', { name: '← 返回客户列表' }).click();
  let releaseOld!: () => void;
  let oldEntered!: () => void;
  const oldGate = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  const oldRequest = new Promise<void>((resolve) => {
    oldEntered = resolve;
  });
  await page.route(
    `**/api/v1/customers/${oldId}/settlements?*`,
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      oldEntered();
      await oldGate;
      try {
        await route.fulfill({ response });
      } catch {
        /* navigation aborted this old read */
      }
    },
  );
  await page.locator(`a[href="/customers/${oldId}"]`).click();
  await oldRequest;
  await page.getByRole('link', { name: '← 返回客户列表' }).click();
  await page.locator(`a[href="/customers/${currentId}"]`).click();
  await expect(
    page.getByRole('heading', { name: 'CU008 当前冻结客户' }),
  ).toBeVisible();
  releaseOld();
  await page.getByRole('tab', { name: '结算记录' }).click();
  await expect(
    page.locator('[data-test="settlement-retry-original"]'),
  ).toBeVisible();
  await page.getByRole('tab', { name: '权利资产' }).click();
  await expect(page.locator('[data-test="right-assets-frozen"]')).toBeVisible();
  await page.getByRole('tab', { name: '结算记录' }).click();
  await expect(
    page.locator('[data-test="settlement-top-kpis"]'),
  ).not.toContainText('¥41.00');
  await expect(
    page.locator('[data-test="settlement-register-submit"]'),
  ).toHaveCount(0);
});

test('real CAS 409 preserves the typed draft for manual comparison', async ({
  page,
}) => {
  await grant(true, true, true);
  await login(page, '/customers');
  const customerId = await createCustomer(page, 'CU008 冲突草稿客户');
  await page.getByRole('tab', { name: '结算记录' }).click();
  const panel = page.locator('[data-test="settlement-panel"]');
  await fillRegister(page, '2026-10-08', '38.00');
  const parallel = await page.evaluate(async (id) => {
    const detail = await fetch(`/api/v1/customers/${id}`, {
      credentials: 'include',
    });
    const session = await fetch('/api/v1/auth/session', {
      credentials: 'include',
    });
    const customer = (await detail.json()) as { version: number };
    const auth = (await session.json()) as { csrfToken: string };
    const response = await fetch(`/api/v1/customers/${id}/settlements`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': auth.csrfToken,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        expectedCustomerVersion: customer.version,
        settlementDate: '2026-10-08',
        settlementAmount: '1.00',
      }),
    });
    return response.status;
  }, customerId);
  expect(parallel).toBe(201);
  const conflictResponse = page.waitForResponse(
    (value) =>
      value.url().endsWith(`/customers/${customerId}/settlements`) &&
      value.request().method() === 'POST',
  );
  await panel.locator('[data-test="settlement-register-submit"]').click();
  expect((await conflictResponse).status()).toBe(409);
  await expect(
    panel.locator('[data-test="settlement-conflict"]'),
  ).toBeVisible();
  await expect(
    panel.locator('[data-test="settlement-amount-input"]'),
  ).toHaveValue('38.00');
  await expect(
    panel.locator('[data-test="settlement-register-submit"]'),
  ).toBeDisabled();
  const state = await getCustomerSettlementState(customerId);
  expect(state.records).toHaveLength(1);
});

test('storage failure sends no POST and revoked read clears sensitive projection', async ({
  page,
}) => {
  await grant(true, true, true);
  await login(page, '/customers');
  const customerId = await createCustomer(page, 'CU008 撤权客户');
  await page.getByRole('tab', { name: '结算记录' }).click();
  const panel = page.locator('[data-test="settlement-panel"]');
  await fillRegister(page, '2026-10-04', '77.00');
  let posts = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().endsWith(`/customers/${customerId}/settlements`)
    )
      posts += 1;
  });
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('denied', 'SecurityError');
    };
  });
  await panel.locator('[data-test="settlement-register-submit"]').click();
  await expect(panel.getByText('无法安全保存原请求')).toBeVisible();
  expect(posts).toBe(0);
  await page.reload();
  await page.getByRole('tab', { name: '结算记录' }).click();
  await fillRegister(page, '2026-10-04', '77.00');
  const registered = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/settlements`) &&
      response.request().method() === 'POST',
  );
  await panel.locator('[data-test="settlement-register-submit"]').click();
  expect((await registered).status()).toBe(201);
  await expect(page.locator('[data-test="settlement-top-kpis"]')).toContainText(
    '¥77.00',
  );
  await setCustomerSettlementGrant(
    localRoleId,
    'CUSTOMER_SETTLEMENT_READ',
    false,
  );
  const denied = await page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/customers/${id}/settlements`, {
      credentials: 'include',
    });
    return response.status;
  }, customerId);
  expect(denied).toBe(403);
  await page.reload();
  await expect(page.locator('[data-test="settlement-top-kpis"]')).toHaveCount(
    0,
  );
  await page.getByRole('tab', { name: '结算记录' }).click();
  await expect(panel.locator('[data-test="settlement-records"]')).toHaveCount(
    0,
  );
  await expect(panel.getByText('¥77.00')).toHaveCount(0);
});

test('confirmed POST followed by failed customer GET permits only read recovery', async ({
  page,
}) => {
  await grant(false, true, false);
  await login(page, '/customers');
  const customerId = await createCustomer(page, 'CU008 成功后读取失败客户');
  await page.getByRole('tab', { name: '结算记录' }).click();
  const panel = page.locator('[data-test="settlement-panel"]');
  await fillRegister(page, '2026-10-05', '12.00');
  let failedGet = false;
  let posts = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().endsWith(`/customers/${customerId}/settlements`)
    )
      posts += 1;
  });
  await page.route(`**/api/v1/customers/${customerId}`, async (route) => {
    if (failedGet || route.request().method() !== 'GET')
      return route.continue();
    failedGet = true;
    await route.abort('failed');
  });
  const response = page.waitForResponse(
    (value) =>
      value.url().endsWith(`/customers/${customerId}/settlements`) &&
      value.request().method() === 'POST',
  );
  await panel.locator('[data-test="settlement-register-submit"]').click();
  expect((await response).status()).toBe(201);
  await expect.poll(() => failedGet).toBe(true);
  await expect(
    panel.locator('[data-test="settlement-register-submit"]'),
  ).toBeDisabled();
  expect(posts).toBe(1);
  await page.unroute(`**/api/v1/customers/${customerId}`);
  await panel.locator('[data-test="settlement-refresh"]').click();
  await expect(
    panel.locator('[data-test="settlement-register-submit"]'),
  ).toBeEnabled();
  expect(posts).toBe(1);
  const state = await getCustomerSettlementState(customerId);
  expect(state.records).toHaveLength(1);
});

test('revoked read rejects the next GET and clears list, KPI, history and correction facts', async ({
  page,
}) => {
  await grant(true, true, true);
  await login(page, '/customers');
  const customerId = await createCustomer(page, 'CU008 读取撤权投影客户');
  await page.getByRole('tab', { name: '结算记录' }).click();
  const panel = page.locator('[data-test="settlement-panel"]');
  await fillRegister(page, '2026-10-06', '83.00');
  const createdResponse = page.waitForResponse(
    (value) =>
      value.url().endsWith(`/customers/${customerId}/settlements`) &&
      value.request().method() === 'POST',
  );
  await panel.locator('[data-test="settlement-register-submit"]').click();
  const created = await createdResponse;
  const recordId = ((await created.json()) as { recordId: string }).recordId;
  await expect(panel.locator('[data-test="settlement-record"]')).toHaveCount(1);
  await panel.locator(`[data-test="settlement-history-${recordId}"]`).click();
  await expect(
    panel.locator(`[data-test="settlement-history-list-${recordId}"]`),
  ).toBeVisible();
  await panel.locator(`[data-test="correct-settlement-${recordId}"]`).click();
  await expect(
    panel.locator('[data-test="settlement-register-form"]'),
  ).toContainText('83.00');
  await setCustomerSettlementGrant(
    localRoleId,
    'CUSTOMER_SETTLEMENT_READ',
    false,
  );
  const deniedResponse = page.waitForResponse(
    (value) =>
      value.url().includes(`/customers/${customerId}/settlements?page=`) &&
      value.request().method() === 'GET',
  );
  await panel.locator('[data-test="settlement-refresh"]').click();
  expect((await deniedResponse).status()).toBe(403);
  await expect(page.locator('[data-test="settlement-top-kpis"]')).toHaveCount(
    0,
  );
  await expect(panel.locator('[data-test="settlement-records"]')).toHaveCount(
    0,
  );
  await expect(
    panel.locator(`[data-test="settlement-history-list-${recordId}"]`),
  ).toHaveCount(0);
  await expect(panel.getByText('83.00')).toHaveCount(0);
});

test('confirmed command with failed storage removal survives remount as read-only recovery', async ({
  page,
}) => {
  await grant(false, true, false);
  await login(page, '/customers');
  const customerId = await createCustomer(page, 'CU008 清理存储失败客户');
  await page.getByRole('tab', { name: '结算记录' }).click();
  const panel = page.locator('[data-test="settlement-panel"]');
  await fillRegister(page, '2026-10-07', '14.00');
  let posts = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().endsWith(`/customers/${customerId}/settlements`)
    )
      posts += 1;
  });
  await page.evaluate(() => {
    Storage.prototype.removeItem = () => {
      throw new DOMException('denied', 'SecurityError');
    };
  });
  const response = page.waitForResponse(
    (value) =>
      value.url().endsWith(`/customers/${customerId}/settlements`) &&
      value.request().method() === 'POST',
  );
  await panel.locator('[data-test="settlement-register-submit"]').click();
  expect((await response).status()).toBe(201);
  await expect(
    panel.locator('[data-test="settlement-register-submit"]'),
  ).toBeDisabled();
  expect(posts).toBe(1);
  await page.reload();
  await page.getByRole('tab', { name: '结算记录' }).click();
  await expect(
    panel.locator('[data-test="settlement-retry-original-private"]'),
  ).toHaveCount(0);
  await expect(
    panel.locator('[data-test="settlement-register-submit"]'),
  ).toBeDisabled();
  expect(posts).toBe(1);
  await panel.locator('[data-test="settlement-refresh"]').click();
  await expect(
    panel.locator('[data-test="settlement-register-submit"]'),
  ).toBeEnabled();
  expect(posts).toBe(1);
  const state = await getCustomerSettlementState(customerId);
  expect(state.records).toHaveLength(1);
  expect(state.receiptCount).toBe(1);
});
