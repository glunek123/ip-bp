import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  coreLeadFixtures,
  disconnectCoreLeadTestDatabase,
  getLead,
  resetCoreLeadE2eData,
  setGrant,
} from '../support/core-lead-database.mjs';

const authorizationA = {
  Authorization: `Bearer ${coreLeadFixtures.tokenA}`,
};

async function login(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/u);
  await page.goto('/notary-matters');
}

async function loginApi(
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

async function createRealMatter(request: APIRequestContext): Promise<{
  matterId: string;
  clientUsername: string;
  clientPassword: string;
}> {
  const officeResponse = await request.post('/api/v1/notary-offices', {
    headers: authorizationA,
    data: { name: `列设置验收公证处-${randomUUID().slice(0, 8)}` },
  });
  expect(officeResponse.status(), await officeResponse.text()).toBe(201);
  const office: { id: string } = await officeResponse.json();

  const clientUsername = `nt008-client-${randomUUID().slice(0, 8)}`;
  const clientPassword = 'nt008 client real password';
  const accountResponse = await request.post(
    `/api/v1/customers/${coreLeadFixtures.admittedCustomer}/client-accounts`,
    {
      headers: authorizationA,
      data: {
        displayName: '列设置验收客户审核员',
        username: clientUsername,
        password: clientPassword,
      },
    },
  );
  expect(accountResponse.status(), await accountResponse.text()).toBe(201);
  await accountResponse.json();

  const leadResponse = await request.post('/api/v1/leads', {
    headers: { ...authorizationA, 'Idempotency-Key': randomUUID() },
    data: {
      customerId: coreLeadFixtures.admittedCustomer,
      rightsHolderId: coreLeadFixtures.holder,
      caseType: 'CIVIL',
      infringementTypes: ['TRADEMARK'],
      source: 'ONLINE',
      platform: 'TAOBAO',
      foundAt: '2026-09-24T02:30:00.000Z',
      shopName: `列设置真实事项-${randomUUID().slice(0, 8)}`,
      needDisclose: false,
      products: [
        {
          title: '真实公证验收商品',
          quantity: 1,
          unitPrice: '8.00',
          commentCount: 0,
        },
      ],
      leadScreenshotContentVersionIds: [],
    },
  });
  expect(leadResponse.status(), await leadResponse.text()).toBe(201);
  const lead: { id: string } = await leadResponse.json();
  const pushed = await request.post(`/api/v1/leads/${lead.id}/push`, {
    headers: { ...authorizationA, 'Idempotency-Key': randomUUID() },
    data: { expectedVersion: 1 },
  });
  expect(pushed.status(), await pushed.text()).toBe(201);

  const clientCsrf = await loginApi(request, clientUsername, clientPassword);
  const reviewed = await request.post(
    `/api/v1/client/leads/${lead.id}/reviews`,
    {
      headers: { 'X-CSRF-Token': clientCsrf, 'Idempotency-Key': randomUUID() },
      data: { result: 'INFRINGEMENT', expectedVersion: 2 },
    },
  );
  expect(reviewed.status(), await reviewed.text()).toBe(201);

  const leadFacts = await getLead(lead.id);
  expect(leadFacts).not.toBeNull();
  const handedOff = await request.post(
    `/api/v1/leads/${lead.id}/notary-matters`,
    {
      headers: { ...authorizationA, 'Idempotency-Key': randomUUID() },
      data: {
        selectedProductIds: [leadFacts!.products[0]!.id],
        selectedContentVersionIds: [],
        notaryOfficeId: office.id,
        evidenceMode: 'ONLINE_PURCHASE',
        batchPurpose: '列设置真实事项验收',
        expectedVersion: 3,
      },
    },
  );
  expect(handedOff.status(), await handedOff.text()).toBe(201);
  const matter: { id: string } = await handedOff.json();
  return { matterId: matter.id, clientUsername, clientPassword };
}

test.beforeEach(async () => {
  await resetCoreLeadE2eData();
});

test.afterAll(async () => {
  await disconnectCoreLeadTestDatabase();
});

test('real internal accounts persist personal notary columns across refresh, re-login, and browser sessions', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(180_000);
  const { matterId, clientUsername, clientPassword } =
    await createRealMatter(request);
  await login(
    page,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );

  const rows = page.locator('[data-test="matter-row"]');
  await expect(rows).toHaveCount(1);
  await expect(
    rows.first().locator('[data-test="matter-link"]'),
  ).toHaveAttribute('href', `/notary-matters/${matterId}`);
  const businessNo = await rows
    .first()
    .locator('[data-test="matter-link"]')
    .textContent();

  await page.locator('[data-test="column-settings-toggle"]').click();
  await page.locator('[data-column-key="sourceLead"]').uncheck();
  await page.getByRole('button', { name: '上移公证处' }).click();
  await page.locator('[data-test="save-columns"]').click();
  await expect(
    page.locator('[data-test="column-preference-status"]'),
  ).toContainText('已保存');
  await expect(page.locator('thead th')).toHaveText([
    '公证事项编号',
    '阶段',
    '公证处',
    '创建时间',
  ]);
  await page.reload();
  await expect(page.locator('thead th')).toHaveText([
    '公证事项编号',
    '阶段',
    '公证处',
    '创建时间',
  ]);
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('[data-test="matter-link"]')).toHaveText(
    businessNo!,
  );

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await login(
    page,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await expect(page.locator('thead th')).toHaveText([
    '公证事项编号',
    '阶段',
    '公证处',
    '创建时间',
  ]);

  const otherContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:5174',
  });
  try {
    const otherPage = await otherContext.newPage();
    await login(
      otherPage,
      coreLeadFixtures.operatorUsername,
      coreLeadFixtures.operatorPassword,
    );
    await expect(otherPage.locator('thead th')).toHaveText([
      '公证事项编号',
      '阶段',
      '公证处',
      '创建时间',
    ]);
    await expect(otherPage.locator('[data-test="matter-row"]')).toHaveCount(1);
  } finally {
    await otherContext.close();
  }

  await page.getByRole('button', { name: '退出登录' }).click();
  await login(
    page,
    coreLeadFixtures.selfUsername,
    coreLeadFixtures.selfPassword,
  );
  await expect(page.locator('[data-test="matter-row"]')).toHaveCount(0);
  await expect(page.getByText('当前没有公证事项')).toBeVisible();
  await page.locator('[data-test="column-settings-toggle"]').click();
  await expect(page.locator('[data-test="column-option"]')).toHaveCount(3);
  await expect(page.locator('[data-column-key="sourceLead"]')).toBeChecked();
  await expect(page.locator('[data-column-key="notaryOffice"]')).toBeChecked();
  await expect(page.locator('[data-column-key="createdAt"]')).toBeChecked();
  await page.locator('[data-column-key="notaryOffice"]').uncheck();
  await page.locator('[data-test="save-columns"]').click();
  await expect(
    page.locator('[data-column-key="notaryOffice"]'),
  ).not.toBeChecked();
  await page.reload();
  await page.locator('[data-test="column-settings-toggle"]').click();
  await expect(
    page.locator('[data-column-key="notaryOffice"]'),
  ).not.toBeChecked();
  await page.locator('[data-test="reset-columns"]').click();
  await expect(page.locator('[data-column-key="notaryOffice"]')).toBeChecked();
  await page.reload();
  await page.locator('[data-test="column-settings-toggle"]').click();
  await expect(page.locator('[data-column-key="sourceLead"]')).toBeChecked();
  await expect(page.locator('[data-column-key="notaryOffice"]')).toBeChecked();
  await expect(page.locator('[data-column-key="createdAt"]')).toBeChecked();

  await page.getByRole('button', { name: '退出登录' }).click();
  await login(
    page,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await expect(page.locator('thead th')).toHaveText([
    '公证事项编号',
    '阶段',
    '公证处',
    '创建时间',
  ]);
  await expect(page.locator('[data-test="matter-row"]')).toHaveCount(1);

  const csrfToken = await page.evaluate(async () => {
    const response = await fetch('/api/v1/auth/session');
    const session: { csrfToken: string } = await response.json();
    return session.csrfToken;
  });
  const invalidRequestStatuses = await page.evaluate(async (csrf) => {
    const endpoint = '/api/v1/notary-matters/list-preference';
    const headers = {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf,
    };
    const unknownColumn = await fetch(endpoint, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        order: ['businessNo', 'stage', 'unknown', 'notaryOffice', 'createdAt'],
        hidden: [],
      }),
    });
    const subjectOverride = await fetch(endpoint, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        order: [
          'businessNo',
          'stage',
          'sourceLead',
          'notaryOffice',
          'createdAt',
        ],
        hidden: [],
        userId: '20000000-0000-4000-8000-000000000002',
      }),
    });
    return [unknownColumn.status, subjectOverride.status];
  }, csrfToken);
  expect(invalidRequestStatuses).toEqual([400, 400]);

  const clientContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:5174',
  });
  try {
    const clientPage = await clientContext.newPage();
    await clientPage.goto('/login');
    await clientPage.getByLabel('用户名').fill(clientUsername);
    await clientPage.getByLabel('密码').fill(clientPassword);
    await clientPage.getByRole('button', { name: '登录', exact: true }).click();
    await expect(clientPage).toHaveURL(/\/client\/leads$/u);
    const externalStatus = await clientPage.evaluate(
      async () =>
        (await fetch('/api/v1/notary-matters/list-preference')).status,
    );
    expect(externalStatus).toBe(403);
  } finally {
    await clientContext.close();
  }

  await setGrant('lead.read', false);
  try {
    const revokedStatus = await page.evaluate(
      async () =>
        (await fetch('/api/v1/notary-matters/list-preference')).status,
    );
    expect(revokedStatus).toBe(403);
  } finally {
    await setGrant('lead.read', true);
  }
});
