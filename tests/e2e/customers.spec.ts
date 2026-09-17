import { expect, test } from '@playwright/test';
import {
  allowNamedCustomerWrites,
  allowCustomerDraftAuditWrites,
  assignDepartmentBRoleInsideDepartmentA,
  countCustomerDraftAuditEvents,
  countCustomers,
  disableDepartmentARoleAssignment,
  disconnectCustomerTestDatabase,
  e2eFixtures,
  findCustomerId,
  rejectCustomerDraftAuditWrites,
  rejectNamedCustomerWrites,
  resetCustomerE2eData,
} from '../support/customer-database.mjs';

const authorizationA = { Authorization: `Bearer ${e2eFixtures.tokenA}` };
const authorizationB = { Authorization: `Bearer ${e2eFixtures.tokenB}` };

test.beforeEach(async () => {
  await resetCustomerE2eData();
});

test.afterAll(async () => {
  await disconnectCustomerTestDatabase();
});

test('operations user creates a persisted draft and sees its audit history', async ({
  page,
}) => {
  await page.context().setExtraHTTPHeaders(authorizationA);
  await page.goto('/customers');
  await expect(
    page.getByRole('heading', { name: '客户', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: '新建客户' }).click();
  await page.getByLabel('客户名称').fill('真实数据库客户');
  await page.getByRole('button', { name: '保存草稿' }).click();

  await expect(
    page.getByRole('heading', { name: '真实数据库客户', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('办理历史 · 1 条')).toBeVisible();
  await page.getByText('办理历史 · 1 条').click();
  await expect(page.getByText('创建客户草稿', { exact: true })).toBeVisible();

  const customerId = await findCustomerId(
    e2eFixtures.departmentA,
    '真实数据库客户',
  );
  await expect(page).toHaveURL(`/customers/${customerId}`);
});

test('another department cannot list or address the customer', async ({
  request,
}) => {
  const createResponse = await request.post('/api/v1/customers', {
    headers: authorizationA,
    data: { name: '仅知产部可见' },
  });
  expect(createResponse.status()).toBe(201);
  const created = (await createResponse.json()) as { id: string };

  const foreignList = await request.get('/api/v1/customers', {
    headers: authorizationB,
  });
  expect(foreignList.status()).toBe(200);
  expect((await foreignList.json()).items).toEqual([]);

  const foreignDetail = await request.get(`/api/v1/customers/${created.id}`, {
    headers: authorizationB,
  });
  expect(foreignDetail.status()).toBe(404);
  expect(await foreignDetail.json()).toMatchObject({
    code: 'CUSTOMER_NOT_FOUND',
  });
});

test('the database rejects a role template assigned through another department', async () => {
  await expect(assignDepartmentBRoleInsideDepartmentA()).rejects.toBeDefined();
});

test('revoking the role assignment takes effect on the next request', async ({
  request,
}) => {
  const beforeRevocation = await request.get('/api/v1/customers', {
    headers: authorizationA,
  });
  expect(beforeRevocation.status()).toBe(200);

  await disableDepartmentARoleAssignment();

  const afterRevocation = await request.get('/api/v1/customers', {
    headers: authorizationA,
  });
  expect(afterRevocation.status()).toBe(403);
  expect(await afterRevocation.json()).toMatchObject({
    code: 'CUSTOMER_ACTION_FORBIDDEN',
  });
});

test('a customer insert failure does not create an audit event', async ({
  request,
}) => {
  const rejectedName = '客户写入必须失败';
  await rejectNamedCustomerWrites(rejectedName);

  try {
    const response = await request.post('/api/v1/customers', {
      headers: authorizationA,
      data: { name: rejectedName },
    });
    expect(response.status()).toBe(500);
  } finally {
    await allowNamedCustomerWrites();
  }

  await expect(
    countCustomerDraftAuditEvents(e2eFixtures.departmentA),
  ).resolves.toBe(0);
});

test('an audit write failure rolls back the customer insert', async ({
  request,
}) => {
  await rejectCustomerDraftAuditWrites();

  try {
    const response = await request.post('/api/v1/customers', {
      headers: authorizationA,
      data: { name: '必须整体回滚' },
    });
    expect(response.status()).toBe(500);
  } finally {
    await allowCustomerDraftAuditWrites();
  }

  await expect(
    countCustomers(e2eFixtures.departmentA, '必须整体回滚'),
  ).resolves.toBe(0);
});
