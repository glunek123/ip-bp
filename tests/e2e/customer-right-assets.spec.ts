import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  e2eFixtures,
  resetCustomerE2eData,
  disconnectCustomerTestDatabase,
} from '../support/customer-database.mjs';
import {
  clearCustomerRightAssetFixture,
  rejectRightAssetAuditWrites,
  rightAssetDatabaseSnapshot,
  setRightAssetRoutineGrant,
  setRightAssetWithdrawGrant,
  verifyRightAssetDatabaseGuards,
} from '../support/customer-right-asset-database.mjs';

const authA = { Authorization: `Bearer ${e2eFixtures.tokenA}` };
const authB = { Authorization: `Bearer ${e2eFixtures.tokenB}` };
const authSelf = { Authorization: `Bearer ${e2eFixtures.tokenSelf}` };
let createdCustomerId: string | undefined;

async function status(
  response: { status(): number; text(): Promise<string> },
  expected: number,
) {
  expect(response.status(), await response.text()).toBe(expected);
}
async function createCustomerAndHolder(request: APIRequestContext) {
  const customer = await request.post('/api/v1/customers', {
    headers: authA,
    data: { name: `CU002 ${randomUUID()}` },
  });
  await status(customer, 201);
  const customerId = (await customer.json()).id as string;
  createdCustomerId = customerId;
  const holder = await request.post(
    `/api/v1/customers/${customerId}/rights-holders`,
    {
      headers: { ...authA, 'Idempotency-Key': randomUUID() },
      data: { expectedCustomerVersion: 1, name: 'CU002 Holder' },
    },
  );
  await status(holder, 201);
  return { customerId, holderId: (await holder.json()).holder.id as string };
}
function fields(holderId: string) {
  return {
    type: 'TRADEMARK',
    name: 'CU002 测试商标',
    number: null,
    category: '商标权',
    holderId,
    ownerText: null,
    trademarkClass: '25',
    validFrom: null,
    validTo: null,
    validityMode: 'UNKNOWN',
  };
}
function create(
  request: APIRequestContext,
  customerId: string,
  holderId: string,
  key: string,
  expectedCustomerVersion = 2,
) {
  return request.post(`/api/v1/customers/${customerId}/right-assets`, {
    headers: { ...authA, 'Idempotency-Key': key },
    data: { ...fields(holderId), expectedCustomerVersion },
  });
}
async function configureBearerBrowser(page: Page) {
  await page.context().setExtraHTTPHeaders(authA);
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        principalType: 'INTERNAL',
        user: {
          id: e2eFixtures.userA,
          displayName: '测试用户甲',
          username: 'e2e-user-a',
        },
        department: { id: e2eFixtures.departmentA, name: 'E2E 知产部' },
        departments: [{ id: e2eFixtures.departmentA, name: 'E2E 知产部' }],
        customer: null,
        notaryOffice: null,
        authorizationRevision: 1,
        expiresAt: '2099-01-01T00:00:00.000Z',
        csrfToken: '',
      }),
    }),
  );
}

test.beforeEach(async () => {
  await resetCustomerE2eData();
  createdCustomerId = undefined;
});
test.afterEach(async () => {
  await rejectRightAssetAuditWrites(false);
  await setRightAssetRoutineGrant(e2eFixtures.roleA, true);
  await setRightAssetWithdrawGrant(e2eFixtures.roleA, false);
  if (createdCustomerId)
    await clearCustomerRightAssetFixture(
      createdCustomerId,
      e2eFixtures.departmentA,
    );
});
test.afterAll(async () => {
  await disconnectCustomerTestDatabase();
});

test('CU002 browser registers unknown facts, revises, refreshes immutable history and withdraws with separate grant', async ({
  request,
  page,
}) => {
  const { customerId, holderId } = await createCustomerAndHolder(request);
  await setRightAssetWithdrawGrant(e2eFixtures.roleA, true);
  await configureBearerBrowser(page);
  await page.goto(`/customers/${customerId}`);
  await page.getByRole('tab', { name: '权利资产' }).click();
  await expect(page.getByText('暂无人工登记的权利资产。')).toBeVisible();
  await page.getByRole('button', { name: '登记权利资产' }).click();
  await page.getByLabel('资产名称').fill('CU002 测试商标');
  await page.getByLabel('资产类别').fill('商标权');
  await page.getByLabel('权利主体').selectOption(holderId);
  await page.getByLabel('商标分类').fill('25');
  await page.getByRole('button', { name: '确认保存' }).click();
  await expect(
    page.getByRole('region', { name: '权利资产详情' }),
  ).toContainText('截止日期未知，未核验法律效力');
  await page.getByRole('button', { name: '修订字段' }).click();
  await page.getByLabel('资产号码').fill('真实登记号-01');
  await page.getByRole('button', { name: '确认保存' }).click();
  await page.reload();
  await page.getByRole('tab', { name: '权利资产' }).click();
  await page.getByRole('button', { name: 'CU002 测试商标' }).click();
  await expect(
    page.getByRole('region', { name: '权利资产详情' }),
  ).toContainText('真实登记号-01');
  await expect(page.getByText('历史版本 · 2 条')).toBeVisible();
  await page.getByText('历史版本 · 2 条').click();
  await expect(page.getByText('号码未知')).toBeVisible();
  await page.getByRole('button', { name: '撤下资产' }).click();
  await page.getByLabel('撤下原因').fill('登记范围调整');
  await page.getByRole('button', { name: '确认撤下' }).click();
  await expect(page.getByText('已撤下')).toBeVisible();
  const detail = await request.get(
    `/api/v1/customers/${customerId}/right-assets/${await listAssetId(request, customerId)}`,
    { headers: authA },
  );
  await status(detail, 200);
  expect((await detail.json()).history).toHaveLength(3);
});

async function listAssetId(request: APIRequestContext, customerId: string) {
  const response = await request.get(
    `/api/v1/customers/${customerId}/right-assets`,
    { headers: authA },
  );
  await status(response, 200);
  return (await response.json()).items[0].assetId as string;
}

test('CU002 scopes, replay, collision, concurrent CAS, revoke and DB guards', async ({
  request,
}) => {
  const { customerId, holderId } = await createCustomerAndHolder(request);
  const key = randomUUID();
  const [first, duplicate] = await Promise.all([
    create(request, customerId, holderId, key),
    create(request, customerId, holderId, key),
  ]);
  await status(first, 201);
  await status(duplicate, 201);
  const result = await first.json();
  expect((await duplicate.json()).assetId).toBe(result.assetId);
  const replay = await create(request, customerId, holderId, key);
  await status(replay, 201);
  expect((await replay.json()).fields.id).toBe(result.fields.id);
  const collision = await request.post(
    `/api/v1/customers/${customerId}/right-assets`,
    {
      headers: { ...authA, 'Idempotency-Key': key },
      data: {
        ...fields(holderId),
        name: '另一资产',
        expectedCustomerVersion: 2,
      },
    },
  );
  await status(collision, 409);
  expect((await collision.json()).code).toBe('IDEMPOTENCY_CONFLICT');
  await status(
    await request.get(`/api/v1/customers/${customerId}/right-assets`, {
      headers: authB,
    }),
    404,
  );
  await status(
    await request.get(`/api/v1/customers/${customerId}/right-assets`, {
      headers: authSelf,
    }),
    404,
  );
  await status(
    await request.post(
      `/api/v1/customers/${customerId}/right-assets/${result.assetId}/withdraw`,
      {
        headers: { ...authA, 'Idempotency-Key': randomUUID() },
        data: {
          expectedCustomerVersion: 3,
          expectedAssetVersion: 1,
          reason: '无独立权限',
        },
      },
    ),
    403,
  );
  await setRightAssetRoutineGrant(e2eFixtures.roleA, false);
  await status(await create(request, customerId, holderId, key), 403);
  await setRightAssetRoutineGrant(e2eFixtures.roleA, true);
  expect(await rightAssetDatabaseSnapshot(customerId)).toEqual({
    customerVersion: 3,
    assets: 1,
  });
  const second = await request.post(
    `/api/v1/customers/${customerId}/right-assets`,
    {
      headers: { ...authA, 'Idempotency-Key': randomUUID() },
      data: {
        ...fields(holderId),
        name: 'CU002 第二资产',
        expectedCustomerVersion: 3,
      },
    },
  );
  await status(second, 201);
  expect(
    await verifyRightAssetDatabaseGuards(
      customerId,
      result.assetId,
      e2eFixtures.departmentA,
      (await second.json()).assetId as string,
    ),
  ).toEqual({
    immutable: true,
    pointerRejected: true,
    missingPointerRejected: true,
    badVersionRejected: true,
    auditImmutable: true,
    dateRejected: true,
  });
});

test('CU002 forced audit failure rolls back and identical-key retry commits once', async ({
  request,
}) => {
  const { customerId, holderId } = await createCustomerAndHolder(request);
  const key = randomUUID();
  const before = await rightAssetDatabaseSnapshot(customerId);
  await rejectRightAssetAuditWrites(true);
  try {
    const failed = await create(request, customerId, holderId, key);
    await status(failed, 500);
    expect(await rightAssetDatabaseSnapshot(customerId)).toEqual(before);
  } finally {
    await rejectRightAssetAuditWrites(false);
  }
  const retried = await create(request, customerId, holderId, key);
  await status(retried, 201);
  expect(await rightAssetDatabaseSnapshot(customerId)).toEqual({
    customerVersion: before.customerVersion + 1,
    assets: 1,
  });
});
