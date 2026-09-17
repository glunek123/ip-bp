import { expect, test } from '@playwright/test';
import {
  allowNamedCustomerWrites,
  allowCustomerDraftAuditWrites,
  allowCustomerUpdateAuditWrites,
  assignForeignDepartmentAuditActor,
  assignForeignDepartmentResponsibility,
  assignDepartmentBRoleInsideDepartmentA,
  countCustomerAuditEvents,
  countCustomerResourceAuditEvents,
  countCustomersByNormalizedIdentity,
  countCustomerDraftAuditEvents,
  countCustomers,
  disableDepartmentARoleAssignment,
  disconnectCustomerTestDatabase,
  duplicateDepartmentLevelRoleAssignment,
  e2eFixtures,
  findCustomerId,
  getCustomer,
  getCustomerById,
  getCustomerAuditEvents,
  getLatestCustomerAudit,
  rejectCustomerDraftAuditWrites,
  rejectCustomerUpdateAuditWrites,
  rejectNamedCustomerWrites,
  resetCustomerE2eData,
  verifyRoleAssignmentMigrationRollback,
} from '../support/customer-database.mjs';

const authorizationA = { Authorization: `Bearer ${e2eFixtures.tokenA}` };
const authorizationB = { Authorization: `Bearer ${e2eFixtures.tokenB}` };
const authorizationSelf = {
  Authorization: `Bearer ${e2eFixtures.tokenSelf}`,
};

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

  await page.getByRole('link', { name: '编辑资料' }).click();
  await page.getByLabel('客户名称').fill('真实数据库客户（更新）');
  await page.getByLabel('客户类型').fill('企业');
  await page.getByLabel('证件类型').fill('统一社会信用代码');
  await page.getByLabel('证件号码').fill('91310000abc123');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(
    page.getByRole('heading', { name: '真实数据库客户（更新）', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('91310000ABC123', { exact: true })).toBeVisible();
  await expect(page.getByText('办理历史 · 2 条')).toBeVisible();

  const customerId = await findCustomerId(
    e2eFixtures.departmentA,
    '真实数据库客户（更新）',
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
  expect((await foreignList.json()).total).toBe(0);

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

test('the role-assignment hardening migration rejects dirty data atomically', async () => {
  const result = await verifyRoleAssignmentMigrationRollback();
  expect(result.rejected).toBe(true);
  expect(result.constraintNames).toContain(
    'role_assignments_role_template_id_fkey',
  );
  expect(result.constraintNames).not.toContain(
    'role_assignments_role_template_id_department_id_fkey',
  );
});

test('TEAM and SELF grants isolate users inside the same department', async ({
  request,
}) => {
  const teamCreate = await request.post('/api/v1/customers', {
    headers: authorizationA,
    data: { name: '团队甲客户' },
  });
  expect(teamCreate.status()).toBe(201);
  const teamCustomer = (await teamCreate.json()) as { id: string };

  const selfListBefore = await request.get('/api/v1/customers', {
    headers: authorizationSelf,
  });
  expect(selfListBefore.status()).toBe(200);
  expect(await selfListBefore.json()).toMatchObject({ items: [], total: 0 });
  expect(
    (
      await request.get(`/api/v1/customers/${teamCustomer.id}`, {
        headers: authorizationSelf,
      })
    ).status(),
  ).toBe(404);

  const selfCreate = await request.post('/api/v1/customers', {
    headers: authorizationSelf,
    data: { name: '本人范围客户' },
  });
  expect(selfCreate.status()).toBe(201);
  const selfCustomer = (await selfCreate.json()) as { id: string };

  const teamList = await request.get('/api/v1/customers', {
    headers: authorizationA,
  });
  expect(await teamList.json()).toMatchObject({
    items: [expect.objectContaining({ id: teamCustomer.id })],
    total: 1,
  });
  expect(
    (
      await request.get(`/api/v1/customers/${selfCustomer.id}`, {
        headers: authorizationA,
      })
    ).status(),
  ).toBe(404);
});

test('the database enforces membership ownership and null-safe role assignment uniqueness', async () => {
  await expect(assignForeignDepartmentResponsibility()).rejects.toMatchObject({
    code: 'P2003',
    meta: expect.objectContaining({
      driverAdapterError: expect.objectContaining({
        cause: expect.objectContaining({
          originalCode: '23503',
          constraint: {
            index: 'customers_responsible_user_id_department_id_fkey',
          },
        }),
      }),
    }),
  });
  await expect(assignForeignDepartmentAuditActor()).rejects.toBeDefined();
  await expect(duplicateDepartmentLevelRoleAssignment()).rejects.toBeDefined();
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

test('edit revocation takes effect on the next request', async ({
  request,
}) => {
  const created = await request.post('/api/v1/customers', {
    headers: authorizationA,
    data: { name: '撤权前客户' },
  });
  const customer = (await created.json()) as { id: string };
  await disableDepartmentARoleAssignment();

  const response = await request.patch(`/api/v1/customers/${customer.id}`, {
    headers: authorizationA,
    data: { expectedVersion: 1, name: '撤权后不得修改' },
  });
  expect(response.status()).toBe(403);
  expect(await response.json()).toMatchObject({
    code: 'CUSTOMER_ACTION_FORBIDDEN',
  });
});

test('exact identity duplicates are blocked per department but allowed across departments', async ({
  request,
}) => {
  const first = await request.post('/api/v1/customers', {
    headers: authorizationA,
    data: { name: '证件客户甲' },
  });
  const second = await request.post('/api/v1/customers', {
    headers: authorizationA,
    data: { name: '证件客户乙' },
  });
  const foreign = await request.post('/api/v1/customers', {
    headers: authorizationB,
    data: { name: '另一部门客户' },
  });
  const firstId = (await first.json()).id as string;
  const secondId = (await second.json()).id as string;
  const foreignId = (await foreign.json()).id as string;
  const identity = {
    customerType: 'enterprise',
    identityType: 'credit-code',
    identityNumber: '91310000abc123',
  };

  expect(
    (
      await request.patch(`/api/v1/customers/${firstId}`, {
        headers: authorizationA,
        data: { expectedVersion: 1, name: '证件客户甲', ...identity },
      })
    ).status(),
  ).toBe(200);
  const visibleDuplicate = await request.get('/api/v1/customers/duplicates', {
    headers: authorizationA,
    params: {
      identityType: 'credit-code',
      identityNumber: '91310000abc123',
    },
  });
  expect(await visibleDuplicate.json()).toMatchObject({
    exactIdentity: [expect.objectContaining({ id: firstId })],
  });
  const foreignDuplicate = await request.get('/api/v1/customers/duplicates', {
    headers: authorizationB,
    params: {
      identityType: 'credit-code',
      identityNumber: '91310000abc123',
    },
  });
  expect(await foreignDuplicate.json()).toMatchObject({ exactIdentity: [] });
  const duplicate = await request.patch(`/api/v1/customers/${secondId}`, {
    headers: authorizationA,
    data: { expectedVersion: 1, name: '证件客户乙', ...identity },
  });
  expect(duplicate.status()).toBe(409);
  expect(await duplicate.json()).toMatchObject({
    code: 'CUSTOMER_IDENTITY_DUPLICATE',
  });
  expect(
    (
      await request.patch(`/api/v1/customers/${foreignId}`, {
        headers: authorizationB,
        data: { expectedVersion: 1, name: '另一部门客户', ...identity },
      })
    ).status(),
  ).toBe(200);
});

test('partial edits preserve omitted fields, reject null, and audit masked differences', async ({
  request,
}) => {
  const created = await request.post('/api/v1/customers', {
    headers: authorizationA,
    data: { name: '部分修改客户', category: '重点', region: '上海' },
  });
  const customerId = (await created.json()).id as string;
  const firstEdit = await request.patch(`/api/v1/customers/${customerId}`, {
    headers: authorizationA,
    data: {
      expectedVersion: 1,
      identityType: 'credit-code',
      identityNumber: 'ab',
    },
  });
  expect(firstEdit.status(), await firstEdit.text()).toBe(200);
  const partial = await request.patch(`/api/v1/customers/${customerId}`, {
    headers: authorizationA,
    data: { expectedVersion: 2, name: '部分修改后' },
  });
  expect(partial.status()).toBe(200);
  await expect(getCustomerById(customerId)).resolves.toMatchObject({
    name: '部分修改后',
    category: '重点',
    region: '上海',
    identityType: 'CREDIT-CODE',
    identityNumber: 'AB',
    version: 3,
  });
  const audit = await getLatestCustomerAudit(customerId);
  expect(audit.details).toMatchObject({
    changes: { name: { before: '部分修改客户', after: '部分修改后' } },
  });
  expect(JSON.stringify(audit.details)).not.toContain('AB');
  const auditEvents = await getCustomerAuditEvents(customerId);
  expect(auditEvents[0]?.details).toMatchObject({
    changes: {
      identityNumber: { before: null, after: '***' },
    },
  });

  const invalid = await request.patch(`/api/v1/customers/${customerId}`, {
    headers: authorizationA,
    data: { expectedVersion: 3, category: null },
  });
  expect(invalid.status()).toBe(400);
  await expect(getCustomerById(customerId)).resolves.toMatchObject({
    category: '重点',
    version: 3,
  });
});

test('concurrent identity updates accept only one customer', async ({
  request,
}) => {
  const [left, right] = await Promise.all([
    request.post('/api/v1/customers', {
      headers: authorizationA,
      data: { name: '并发客户甲' },
    }),
    request.post('/api/v1/customers', {
      headers: authorizationA,
      data: { name: '并发客户乙' },
    }),
  ]);
  const [leftId, rightId] = [
    ((await left.json()) as { id: string }).id,
    ((await right.json()) as { id: string }).id,
  ];
  const results = await Promise.all([
    request.patch(`/api/v1/customers/${leftId}`, {
      headers: authorizationA,
      data: {
        expectedVersion: 1,
        identityType: 'credit-code',
        identityNumber: 'RACE-91310000',
      },
    }),
    request.patch(`/api/v1/customers/${rightId}`, {
      headers: authorizationA,
      data: {
        expectedVersion: 1,
        identityType: 'credit-code',
        identityNumber: 'RACE-91310000',
      },
    }),
  ]);
  expect(results.map((response) => response.status()).sort()).toEqual([
    200, 409,
  ]);
  const rejected = results.find((response) => response.status() === 409);
  expect(await rejected?.json()).toMatchObject({
    code: 'CUSTOMER_IDENTITY_DUPLICATE',
  });
  await expect(
    countCustomersByNormalizedIdentity(
      e2eFixtures.departmentA,
      'CREDIT-CODE',
      'RACE-91310000',
    ),
  ).resolves.toBe(1);
});

test('duplicate matching normalizes NFKC and whitespace and supports excluding the current customer', async ({
  request,
}) => {
  const first = await request.post('/api/v1/customers', {
    headers: authorizationA,
    data: { name: '上海   品维' },
  });
  const firstId = (await first.json()).id as string;
  await request.patch(`/api/v1/customers/${firstId}`, {
    headers: authorizationA,
    data: {
      expectedVersion: 1,
      identityType: 'ｃｒｅｄｉｔ－ｃｏｄｅ',
      identityNumber: '９１３１００００ａｂｃ１２３',
    },
  });
  const byName = await request.get('/api/v1/customers/duplicates', {
    headers: authorizationA,
    params: { name: '上海 品维' },
  });
  expect(await byName.json()).toMatchObject({
    sameName: [expect.objectContaining({ id: firstId })],
  });
  const excluded = await request.get('/api/v1/customers/duplicates', {
    headers: authorizationA,
    params: {
      identityType: 'credit-code',
      identityNumber: '91310000ABC123',
      excludeCustomerId: firstId,
    },
  });
  expect(await excluded.json()).toMatchObject({ exactIdentity: [] });
});

test('a hidden same-name record cannot be inferred from the write response', async ({
  request,
}) => {
  const hidden = await request.post('/api/v1/customers', {
    headers: authorizationSelf,
    data: { name: '隐藏客户' },
  });
  expect(hidden.status()).toBe(201);
  const own = await request.post('/api/v1/customers', {
    headers: authorizationA,
    data: { name: '可见客户' },
  });
  const ownId = (await own.json()).id as string;
  const response = await request.patch(`/api/v1/customers/${ownId}`, {
    headers: authorizationA,
    data: {
      expectedVersion: 1,
      name: '隐藏客户',
    },
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ name: '隐藏客户' });
});

test('a hidden same-name record cannot be inferred from the create response', async ({
  request,
}) => {
  expect(
    (
      await request.post('/api/v1/customers', {
        headers: authorizationSelf,
        data: { name: '隐藏创建名称' },
      })
    ).status(),
  ).toBe(201);
  const response = await request.post('/api/v1/customers', {
    headers: authorizationA,
    data: { name: '隐藏创建名称' },
  });
  expect(response.status()).toBe(201);
  expect(await response.json()).toMatchObject({ name: '隐藏创建名称' });
});

test('concurrent same-name creates and edits cannot bypass the reason gate', async ({
  request,
}) => {
  const creates = await Promise.all([
    request.post('/api/v1/customers', {
      headers: authorizationA,
      data: { name: '并发同名创建' },
    }),
    request.post('/api/v1/customers', {
      headers: authorizationA,
      data: { name: '并发同名创建' },
    }),
  ]);
  expect(creates.map((response) => response.status()).sort()).toEqual([
    201, 409,
  ]);
  expect(
    await creates.find((response) => response.status() === 409)?.json(),
  ).toMatchObject({ code: 'CUSTOMER_NAME_REASON_REQUIRED' });
  await expect(
    countCustomers(e2eFixtures.departmentA, '并发同名创建'),
  ).resolves.toBe(1);

  const [left, right] = await Promise.all([
    request.post('/api/v1/customers', {
      headers: authorizationA,
      data: { name: '并发改名甲' },
    }),
    request.post('/api/v1/customers', {
      headers: authorizationA,
      data: { name: '并发改名乙' },
    }),
  ]);
  const edits = await Promise.all([
    request.patch(
      `/api/v1/customers/${((await left.json()) as { id: string }).id}`,
      {
        headers: authorizationA,
        data: { expectedVersion: 1, name: '并发同名修改' },
      },
    ),
    request.patch(
      `/api/v1/customers/${((await right.json()) as { id: string }).id}`,
      {
        headers: authorizationA,
        data: { expectedVersion: 1, name: '并发同名修改' },
      },
    ),
  ]);
  expect(edits.map((response) => response.status()).sort()).toEqual([200, 409]);
  expect(
    await edits.find((response) => response.status() === 409)?.json(),
  ).toMatchObject({ code: 'CUSTOMER_NAME_REASON_REQUIRED' });
  await expect(
    countCustomers(e2eFixtures.departmentA, '并发同名修改'),
  ).resolves.toBe(1);
});

test('same-department out-of-scope edits return 404 without changing data or audit', async ({
  request,
}) => {
  const hidden = await request.post('/api/v1/customers', {
    headers: authorizationSelf,
    data: { name: '不可编辑客户' },
  });
  const hiddenId = (await hidden.json()).id as string;
  const response = await request.patch(`/api/v1/customers/${hiddenId}`, {
    headers: authorizationA,
    data: { expectedVersion: 1, name: '越权修改' },
  });
  expect(response.status()).toBe(404);
  expect(await response.json()).toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
  await expect(getCustomerById(hiddenId)).resolves.toMatchObject({
    name: '不可编辑客户',
    version: 1,
  });
  await expect(
    countCustomerResourceAuditEvents(hiddenId, 'customer.updated'),
  ).resolves.toBe(0);
});

test('same-name creation requires a reason and keeps both audit facts', async ({
  request,
}) => {
  expect(
    (
      await request.post('/api/v1/customers', {
        headers: authorizationA,
        data: { name: '创建同名客户' },
      })
    ).status(),
  ).toBe(201);
  const withoutReason = await request.post('/api/v1/customers', {
    headers: authorizationA,
    data: { name: '创建同名客户' },
  });
  expect(withoutReason.status()).toBe(409);
  expect(await withoutReason.json()).toMatchObject({
    code: 'CUSTOMER_NAME_REASON_REQUIRED',
  });
  const withReason = await request.post('/api/v1/customers', {
    headers: authorizationA,
    data: {
      name: '创建同名客户',
      duplicateNameReason: '不同主体，经核对后继续',
    },
  });
  expect(withReason.status()).toBe(201);
  await expect(
    countCustomerAuditEvents(
      e2eFixtures.departmentA,
      'customer.duplicate-name-overridden',
    ),
  ).resolves.toBe(1);
});

test('same-name edit requires one reason and records the override audit', async ({
  request,
}) => {
  await request.post('/api/v1/customers', {
    headers: authorizationA,
    data: { name: '同名目标客户' },
  });
  const second = await request.post('/api/v1/customers', {
    headers: authorizationA,
    data: { name: '准备改名客户' },
  });
  const secondId = (await second.json()).id as string;

  const withoutReason = await request.patch(`/api/v1/customers/${secondId}`, {
    headers: authorizationA,
    data: { expectedVersion: 1, name: '同名目标客户' },
  });
  expect(withoutReason.status()).toBe(409);
  expect(await withoutReason.json()).toMatchObject({
    code: 'CUSTOMER_NAME_REASON_REQUIRED',
  });

  const withReason = await request.patch(`/api/v1/customers/${secondId}`, {
    headers: authorizationA,
    data: {
      expectedVersion: 1,
      name: '同名目标客户',
      duplicateNameReason: '不同业务主体，经核对后继续',
    },
  });
  expect(withReason.status()).toBe(200);
  await expect(
    countCustomerAuditEvents(
      e2eFixtures.departmentA,
      'customer.duplicate-name-overridden',
    ),
  ).resolves.toBe(1);
});

test('a stale edit version cannot overwrite the current customer', async ({
  request,
}) => {
  const created = await request.post('/api/v1/customers', {
    headers: authorizationA,
    data: { name: '并发客户' },
  });
  const customerId = (await created.json()).id as string;
  expect(
    (
      await request.patch(`/api/v1/customers/${customerId}`, {
        headers: authorizationA,
        data: { expectedVersion: 1, name: '先保存的名称' },
      })
    ).status(),
  ).toBe(200);

  const stale = await request.patch(`/api/v1/customers/${customerId}`, {
    headers: authorizationA,
    data: { expectedVersion: 1, name: '后到的旧版本' },
  });
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({
    code: 'CUSTOMER_VERSION_CONFLICT',
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

test('an update audit failure rolls back the customer modification', async ({
  request,
}) => {
  const created = await request.post('/api/v1/customers', {
    headers: authorizationA,
    data: { name: '修改前名称' },
  });
  const customerId = (await created.json()).id as string;
  await rejectCustomerUpdateAuditWrites();

  try {
    const response = await request.patch(`/api/v1/customers/${customerId}`, {
      headers: authorizationA,
      data: { expectedVersion: 1, name: '不得留下的名称' },
    });
    expect(response.status()).toBe(500);
  } finally {
    await allowCustomerUpdateAuditWrites();
  }

  await expect(
    getCustomer(e2eFixtures.departmentA, '修改前名称'),
  ).resolves.toMatchObject({ id: customerId, version: 1 });
  await expect(
    countCustomerAuditEvents(e2eFixtures.departmentA, 'customer.updated'),
  ).resolves.toBe(0);
});
