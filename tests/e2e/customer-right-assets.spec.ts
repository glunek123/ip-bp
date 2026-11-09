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
  rightAssetEvidenceSnapshot,
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
async function createCustomerAndHolder(
  request: APIRequestContext,
  headers = authA,
) {
  const customer = await request.post('/api/v1/customers', {
    headers,
    data: { name: `CU002 ${randomUUID()}` },
  });
  await status(customer, 201);
  const customerId = (await customer.json()).id as string;
  createdCustomerId = customerId;
  const holder = await request.post(
    `/api/v1/customers/${customerId}/rights-holders`,
    {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
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
    status: 'VALID',
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

test('CU002 browser registers text-only asset and preserves an existing formal holder', async ({
  request,
  page,
}, testInfo) => {
  const { customerId, holderId } = await createCustomerAndHolder(request);
  await setRightAssetWithdrawGrant(e2eFixtures.roleA, true);
  const path = '/api/v1/customers/' + customerId + '/right-assets';
  const linked = await request.post(path, {
    headers: { ...authA, 'Idempotency-Key': randomUUID() },
    data: {
      ...fields(holderId),
      name: '已有正式关联',
      validFrom: '2020-03-14',
      validityMode: 'LONG_TERM',
      expectedCustomerVersion: 2,
    },
  });
  await status(linked, 201);
  const linkedId = (await linked.json()).assetId;
  await configureBearerBrowser(page);
  await page.goto('/customers/' + customerId);
  await page.getByRole('tab', { name: '权利资产' }).click();
  const table = page.locator('.right-assets-panel__list');
  await expect(table.getByRole('columnheader')).toHaveText([
    '类型',
    '权属文件',
    '注册号 / 申请号',
    '名称',
    '类别',
    '权利人',
    '注册日期',
    '有效期至',
    '状态',
    '操作',
  ]);
  const oldRow = table.getByRole('row', { name: /已有正式关联/u });
  await expect(oldRow).not.toContainText('2020-03-14');
  await expect(oldRow).toContainText('CU002 Holder');
  await oldRow.getByRole('button', { name: '编辑', exact: true }).click();
  const form = page.locator('form.right-assets-panel__form');
  await form.getByLabel('权利人').fill('只改版本上的登记文字');
  await form.getByRole('button', { name: /保存/u }).click();
  await expect(oldRow).toContainText('只改版本上的登记文字');
  const detail = await request.get(path + '/' + linkedId, { headers: authA });
  await status(detail, 200);
  expect((await detail.json()).fields).toMatchObject({
    holderId,
    ownerText: '只改版本上的登记文字',
    validFrom: '2020-03-14',
    registrationDate: null,
    trademarkClass: '25',
    validityMode: 'LONG_TERM',
  });

  await page.getByRole('button', { name: '登记权利资产' }).click();
  await form.getByLabel('名称', { exact: true }).fill('手填权利人资产');
  await form.getByLabel('类别', { exact: true }).fill('商标权');
  await form.getByLabel('权利人').fill('手填权利人甲');
  await form.getByLabel('注册日期').fill('2021-05-06');
  const statusSelect = form.getByRole('combobox', { name: /状态/u });
  await expect(statusSelect).toHaveValue('');
  await expect(statusSelect).toHaveAttribute('required');
  await statusSelect.selectOption('VALID');
  await expect(form.getByLabel('有效期至')).toHaveValue('');
  await form.screenshot({
    path: testInfo.outputPath('right-asset-register.png'),
    animations: 'disabled',
  });
  await form.getByRole('button', { name: /保存/u }).click();
  const row = table.getByRole('row', { name: /手填权利人资产/u });
  await expect(row).toContainText('手填权利人甲');
  await expect(row).toContainText('2021-05-06');
  await expect(row.getByRole('cell').nth(8)).toHaveText('有效');
  const assets = await request.get(path + '?view=active', { headers: authA });
  await status(assets, 200);
  const created = (await assets.json()).items.find(
    (item: { fields: { name: string } }) =>
      item.fields.name === '手填权利人资产',
  );
  expect(created.fields).toMatchObject({
    holderId: null,
    ownerText: '手填权利人甲',
    validFrom: null,
    registrationDate: '2021-05-06',
    validTo: null,
    status: 'VALID',
  });
  await table.screenshot({
    path: testInfo.outputPath('right-asset-table.png'),
    animations: 'disabled',
  });
});

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
  const beforeDistinctKeys = await rightAssetEvidenceSnapshot(customerId);
  const [differentKeyA, differentKeyB] = await Promise.all([
    create(
      request,
      customerId,
      holderId,
      randomUUID(),
      beforeDistinctKeys.customerVersion,
    ),
    create(
      request,
      customerId,
      holderId,
      randomUUID(),
      beforeDistinctKeys.customerVersion,
    ),
  ]);
  expect([differentKeyA.status(), differentKeyB.status()].sort()).toEqual([
    201, 409,
  ]);
  const afterDistinctKeys = await rightAssetEvidenceSnapshot(customerId);
  expect(afterDistinctKeys).toEqual({
    customerVersion: beforeDistinctKeys.customerVersion + 1,
    assets: beforeDistinctKeys.assets + 1,
    versions: beforeDistinctKeys.versions + 1,
    receipts: beforeDistinctKeys.receipts + 1,
    audits: beforeDistinctKeys.audits + 1,
  });
});

test('CU002 SELF grants allow own-customer create, read and revise while other customer stays hidden', async ({
  request,
}) => {
  const { customerId, holderId } = await createCustomerAndHolder(
    request,
    authSelf,
  );
  await status(
    await request.get(`/api/v1/customers/${customerId}/right-assets`, {
      headers: authSelf,
    }),
    200,
  );
  const created = await request.post(
    `/api/v1/customers/${customerId}/right-assets`,
    {
      headers: { ...authSelf, 'Idempotency-Key': randomUUID() },
      data: { ...fields(holderId), expectedCustomerVersion: 2 },
    },
  );
  await status(created, 201);
  const assetId = (await created.json()).assetId as string;
  const detail = await request.get(
    `/api/v1/customers/${customerId}/right-assets/${assetId}`,
    { headers: authSelf },
  );
  await status(detail, 200);
  const revised = await request.post(
    `/api/v1/customers/${customerId}/right-assets/${assetId}/revisions`,
    {
      headers: { ...authSelf, 'Idempotency-Key': randomUUID() },
      data: {
        ...fields(holderId),
        number: '本人真实登记号',
        expectedCustomerVersion: 3,
        expectedAssetVersion: 1,
      },
    },
  );
  await status(revised, 201);
  const latest = await request.get(
    `/api/v1/customers/${customerId}/right-assets/${assetId}`,
    { headers: authSelf },
  );
  await status(latest, 200);
  expect((await latest.json()).history).toHaveLength(2);
  await status(
    await request.get(`/api/v1/customers/${customerId}/right-assets`, {
      headers: authA,
    }),
    404,
  );
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
