import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test';
import {
  allowRightsHolderAuditWrites,
  getRightsHolderCounts,
  linkRightsHolderFixture,
  rejectRightsHolderAuditWrites,
  revokeRightsHolderGrant,
  verifyRightsHolderMigration,
  verifyRightsHolderNames,
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
  verifyAdmissionContactConstraintRejectsBlankValues,
  verifyRoleAssignmentMigrationRollback,
} from '../support/customer-database.mjs';

const authorizationA = { Authorization: `Bearer ${e2eFixtures.tokenA}` };
const authorizationB = { Authorization: `Bearer ${e2eFixtures.tokenB}` };
const authorizationSelf = {
  Authorization: `Bearer ${e2eFixtures.tokenSelf}`,
};

async function configureBearerBrowser(page: import('@playwright/test').Page) {
  await page.context().setExtraHTTPHeaders(authorizationA);
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: e2eFixtures.userA,
          displayName: '测试用户甲',
          username: 'e2e-user-a',
        },
        department: { id: e2eFixtures.departmentA, name: 'E2E 知产部' },
        departments: [{ id: e2eFixtures.departmentA, name: 'E2E 知产部' }],
        authorizationRevision: 1,
        expiresAt: '2099-01-01T00:00:00.000Z',
        csrfToken: '',
      }),
    }),
  );
}

async function createRightsCustomer(
  request: APIRequestContext,
  name: string,
  headers = authorizationA,
): Promise<string> {
  const response = await request.post('/api/v1/customers', {
    headers,
    data: { name },
  });
  expect(response.status(), await response.text()).toBe(201);
  const customer: { id: string } = await response.json();
  return customer.id;
}

function createHolder(
  request: APIRequestContext,
  customerId: string,
  data: Record<string, unknown>,
  key = randomUUID(),
  headers = authorizationA,
) {
  return request.post(`/api/v1/customers/${customerId}/rights-holders`, {
    headers: { ...headers, 'Idempotency-Key': key },
    data: { expectedCustomerVersion: 1, ...data },
  });
}

function linkHolder(
  request: APIRequestContext,
  customerId: string,
  rightsHolderId: string,
  version = 1,
  key = randomUUID(),
  headers = authorizationA,
) {
  return request.post(`/api/v1/customers/${customerId}/rights-holder-links`, {
    headers: { ...headers, 'Idempotency-Key': key },
    data: { expectedCustomerVersion: version, rightsHolderId },
  });
}

type HolderResult = {
  holder: { id: string; name: string; credit: string | null };
  linkId: string;
  customerVersion: number;
};

test.beforeEach(async () => {
  await resetCustomerE2eData();
});

test.afterAll(async () => {
  await disconnectCustomerTestDatabase();
});

test('rights holder browser reuses the same stable identity from two customers', async ({
  page,
}) => {
  await configureBearerBrowser(page);
  for (const name of ['主体客户 A', '主体客户 B']) {
    await page.goto('/customers/new');
    await page.getByLabel('客户名称').fill(name);
    await page.getByRole('button', { name: '保存草稿' }).click();
    await expect(
      page.getByRole('heading', { name, exact: true }),
    ).toBeVisible();
  }
  const customerA = await findCustomerId(e2eFixtures.departmentA, '主体客户 A');
  const customerB = await findCustomerId(e2eFixtures.departmentA, '主体客户 B');
  await page.goto(`/customers/${customerA}`);
  await page.getByRole('button', { name: '新建主体', exact: true }).click();
  await page.getByRole('button', { name: '创建并关联' }).click();
  await expect(page.getByText('请填写权利主体名称')).toBeVisible();
  await page.getByLabel('主体名称', { exact: true }).fill('共享权利主体 H');
  await page.getByRole('button', { name: '创建并关联' }).click();
  await page.getByRole('link', { name: '查看详情', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '共享权利主体 H' }),
  ).toBeVisible();
  const holderId = page.url().split('/').at(-1);
  expect(holderId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByText(holderId!, { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /编辑|删除|解除|默认/ }),
  ).toHaveCount(0);
  await page.goto(`/customers/${customerB}`);
  await page.getByRole('button', { name: '关联已有主体' }).click();
  await page.getByLabel('共享权利主体 H', { exact: true }).check();
  await page.getByRole('button', { name: '确认关联' }).click();
  await page.getByRole('link', { name: '查看详情', exact: true }).click();
  await expect(page).toHaveURL(
    `/customers/${customerB}/rights-holders/${holderId}`,
  );
  await expect(page.getByText(holderId!, { exact: true })).toBeVisible();
  await expect(page.getByText('主体客户 A', { exact: true })).toHaveCount(0);
  await expect(getCustomerById(customerA)).resolves.toMatchObject({
    version: 2,
  });
  await expect(getCustomerById(customerB)).resolves.toMatchObject({
    version: 2,
  });
});

test('rights holder validation rejects empty names but permits duplicate names and credits', async ({
  request,
}) => {
  const customerId = await createRightsCustomer(request, '主体字段客户');
  for (const name of ['', '   ', '\t\n']) {
    const response = await createHolder(request, customerId, { name });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  }
  const first = await createHolder(request, customerId, {
    name: '同名主体',
    credit: 'DUPLICATE',
  });
  expect(first.status(), await first.text()).toBe(201);
  const firstResult: HolderResult = await first.json();
  const second = await createHolder(request, customerId, {
    name: '同名主体',
    credit: 'DUPLICATE',
    expectedCustomerVersion: 2,
  });
  expect(second.status(), await second.text()).toBe(201);
  const secondResult: HolderResult = await second.json();
  expect(secondResult.holder.id).not.toBe(firstResult.holder.id);
  expect(secondResult.customerVersion).toBe(3);
});

test('rights holder database rejects every ECMAScript trim whitespace character', async ({
  request,
}) => {
  const whitespace = [
    0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680, 0x2000,
    0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009,
    0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
  ].map((codePoint) => String.fromCodePoint(codePoint));
  const blankNames = [...whitespace, '\r\n', whitespace.join('')];
  expect(blankNames.every((name) => name.trim() === '')).toBe(true);
  await expect(verifyRightsHolderNames(blankNames)).resolves.toEqual(
    blankNames.map(() => 'rights_holders_name_nonblank_check'),
  );
  await expect(
    verifyRightsHolderNames(['\t正常主体\u3000', '\u200b', '\u0085']),
  ).resolves.toEqual([null, null, null]);
  const customerId = await createRightsCustomer(request, '空白名称规范化客户');
  const response = await createHolder(request, customerId, {
    name: `${whitespace.join('')}正常主体${whitespace.join('')}`,
  });
  expect(response.status(), await response.text()).toBe(201);
  expect(await response.json()).toMatchObject({ holder: { name: '正常主体' } });
});

test('rights holder upgrade preserves old customers and enforces SQL constraints atomically', async () => {
  const result = await verifyRightsHolderMigration();
  expect(result).toMatchObject({
    previousMigrations: 7,
    previousSchema: '20260917060000_add_customer_admission_contact',
    upgradedSchema: '20260917080000_enforce_rights_holder_name_whitespace',
    preservedCustomers: 2,
    validLinks: 1,
    failedMigrationCode: '42P07',
    partialTables: 0,
    partialConstraints: 0,
    failedCustomers: 2,
    preservedHolders: 2,
    whitespaceMigrationFailure: '23514',
    whitespaceRollbackPreservedConstraint: true,
    whitespaceRollbackPreservedHolder: true,
  });
  expect(result.tables).toEqual(
    expect.arrayContaining([
      'rights_holders',
      'customer_rights_holder_links',
      'rights_holder_command_receipts',
    ]),
  );
  expect(result.rejections).toEqual([
    { code: '23502', constraint: null },
    { code: '23514', constraint: 'rights_holders_name_nonblank_check' },
    { code: '23514', constraint: 'rights_holders_name_nonblank_check' },
    {
      code: '23503',
      constraint: 'customer_rights_holder_links_customer_department_fkey',
    },
    {
      code: '23503',
      constraint: 'customer_rights_holder_links_holder_department_fkey',
    },
    {
      code: '23505',
      constraint: 'customer_rights_holder_links_customer_holder_key',
    },
  ]);
});

test('rights holder hidden UUID and cross-department routes never disclose hidden records', async ({
  request,
}) => {
  const visibleCustomer = await createRightsCustomer(request, '当前客户');
  const hiddenCustomer = await createRightsCustomer(
    request,
    '隐藏客户',
    authorizationSelf,
  );
  const foreignCustomer = await createRightsCustomer(
    request,
    '外部门客户',
    authorizationB,
  );
  const hiddenResponse = await createHolder(
    request,
    hiddenCustomer,
    { name: '隐藏主体', credit: 'HIDDEN-CREDIT' },
    randomUUID(),
    authorizationSelf,
  );
  const foreignResponse = await createHolder(
    request,
    foreignCustomer,
    { name: '外部门主体' },
    randomUUID(),
    authorizationB,
  );
  expect(hiddenResponse.status()).toBe(201);
  expect(foreignResponse.status()).toBe(201);
  const hidden: HolderResult = await hiddenResponse.json();
  const foreign: HolderResult = await foreignResponse.json();
  for (const holderId of [hidden.holder.id, foreign.holder.id, randomUUID()]) {
    const detail = await request.get(
      `/api/v1/customers/${visibleCustomer}/rights-holders/${holderId}`,
      { headers: authorizationA },
    );
    expect(detail.status()).toBe(404);
    expect(await detail.json()).toMatchObject({
      code: 'RIGHTS_HOLDER_NOT_FOUND',
    });
    const link = await linkHolder(request, visibleCustomer, holderId);
    expect(link.status()).toBe(404);
    expect(await link.json()).toMatchObject({
      code: 'RIGHTS_HOLDER_NOT_FOUND',
    });
    expect(await link.text()).not.toMatch(
      /隐藏|外部门|HIDDEN-CREDIT|departmentId|rightsHolderId/,
    );
  }
  for (const target of [hiddenCustomer, foreignCustomer]) {
    const response = await createHolder(request, target, {
      name: '越权新建主体',
    });
    expect(response.status()).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
  }
  const candidates = await request.get(
    `/api/v1/customers/${visibleCustomer}/linkable-rights-holders`,
    { headers: authorizationA },
  );
  expect(await candidates.json()).toMatchObject({ items: [], total: 0 });
  await expect(getCustomerById(visibleCustomer)).resolves.toMatchObject({
    version: 1,
  });
});

test('rights holder projections never expose another linked customer or private relationship', async ({
  request,
}) => {
  const visibleCustomer = await createRightsCustomer(request, '可见锚点客户');
  const nextCustomer = await createRightsCustomer(request, '目标客户');
  const hiddenCustomer = await createRightsCustomer(
    request,
    '不应泄漏的其他客户',
    authorizationSelf,
  );
  const created = await createHolder(request, visibleCustomer, {
    name: '可见主体',
  });
  expect(created.status()).toBe(201);
  const result: HolderResult = await created.json();
  await linkRightsHolderFixture(
    hiddenCustomer,
    result.holder.id,
    e2eFixtures.departmentA,
  );
  const responses = await Promise.all([
    request.get(`/api/v1/customers/${visibleCustomer}/rights-holders`, {
      headers: authorizationA,
    }),
    request.get(
      `/api/v1/customers/${visibleCustomer}/rights-holders/${result.holder.id}`,
      { headers: authorizationA },
    ),
    request.get(`/api/v1/customers/${nextCustomer}/linkable-rights-holders`, {
      headers: authorizationA,
    }),
  ]);
  const expectedFields = [
    'id',
    'name',
    'credit',
    'address',
    'legalRepresentative',
    'duty',
    'updatedAt',
  ].sort();
  const assertProjection = async (response: APIResponse) => {
    expect(response.ok()).toBe(true);
    const body = await response.json();
    const summary = body.items?.[0] ?? body.holder ?? body;
    expect(Object.keys(summary).sort()).toEqual(expectedFields);
    expect(JSON.stringify(body)).not.toContain(hiddenCustomer);
    expect(JSON.stringify(body)).not.toMatch(
      /不应泄漏|departmentId|responsibleUserId|teamId|links|customers|linkCount/,
    );
  };
  for (const response of responses) await assertProjection(response);
  await assertProjection(
    await linkHolder(request, nextCustomer, result.holder.id),
  );
  const hiddenDetail = await request.get(
    `/api/v1/customers/${hiddenCustomer}/rights-holders/${result.holder.id}`,
    { headers: authorizationA },
  );
  expect(hiddenDetail.status()).toBe(404);
});

test('rights holder concurrent duplicate links and idempotent replays persist one link and audit', async ({
  request,
}) => {
  const source = await createRightsCustomer(request, '并发来源客户');
  const target = await createRightsCustomer(request, '并发目标客户');
  const sameKeyTarget = await createRightsCustomer(request, '同键目标客户');
  const created = await createHolder(request, source, { name: '并发主体' });
  expect(created.status()).toBe(201);
  const result: HolderResult = await created.json();
  const responses = await Promise.all([
    linkHolder(request, target, result.holder.id),
    linkHolder(request, target, result.holder.id),
  ]);
  expect(responses.map((response) => response.status()).sort()).toEqual([
    201, 409,
  ]);
  const conflict = responses.find((response) => response.status() === 409)!;
  expect(await conflict.json()).toMatchObject({
    code: 'RIGHTS_HOLDER_ALREADY_LINKED',
  });
  const repeat = await linkHolder(request, target, result.holder.id, 2);
  expect(repeat.status()).toBe(409);
  expect(await repeat.json()).toMatchObject({
    code: 'RIGHTS_HOLDER_ALREADY_LINKED',
  });
  const key = randomUUID();
  const retries = await Promise.all([
    linkHolder(request, sameKeyTarget, result.holder.id, 1, key),
    linkHolder(request, sameKeyTarget, result.holder.id, 1, key),
  ]);
  expect(retries.map((response) => response.status())).toEqual([201, 201]);
  expect(await retries[0]!.json()).toEqual(await retries[1]!.json());
  const changed = await linkHolder(
    request,
    sameKeyTarget,
    result.holder.id,
    2,
    key,
  );
  expect(changed.status()).toBe(409);
  expect(await changed.json()).toMatchObject({
    code: 'IDEMPOTENCY_KEY_REUSED',
  });
  await expect(getRightsHolderCounts(e2eFixtures.departmentA)).resolves.toEqual(
    { holders: 1, links: 3, receipts: 3, createdAudits: 1, linkedAudits: 3 },
  );
  await expect(getCustomerById(target)).resolves.toMatchObject({ version: 2 });
  await expect(getCustomerById(sameKeyTarget)).resolves.toMatchObject({
    version: 2,
  });
});

test('rights holder creation replays identical keys and separates new commands', async ({
  request,
}) => {
  const customerId = await createRightsCustomer(request, '创建幂等客户');
  const key = randomUUID();
  const data = {
    name: '幂等主体',
    credit: 'PRIVATE-CREDIT',
    address: 'PRIVATE-ADDRESS',
    legalRepresentative: 'PRIVATE-PERSON',
    duty: 'PRIVATE-DUTY',
  };
  const responses = await Promise.all([
    createHolder(request, customerId, data, key),
    createHolder(request, customerId, data, key),
  ]);
  expect(responses.map((response) => response.status())).toEqual([201, 201]);
  const result: HolderResult = await responses[0]!.json();
  expect(await responses[1]!.json()).toEqual(result);
  const replay = await createHolder(request, customerId, data, key);
  expect(await replay.json()).toEqual(result);
  const mismatch = await createHolder(
    request,
    customerId,
    { ...data, name: '不同请求' },
    key,
  );
  expect(mismatch.status()).toBe(409);
  expect(await mismatch.json()).toMatchObject({
    code: 'IDEMPOTENCY_KEY_REUSED',
  });
  const differentKey = await createHolder(request, customerId, {
    ...data,
    expectedCustomerVersion: 2,
  });
  expect(differentKey.status()).toBe(201);
  expect((await differentKey.json()).holder.id).not.toBe(result.holder.id);
  await expect(getRightsHolderCounts(e2eFixtures.departmentA)).resolves.toEqual(
    { holders: 2, links: 2, receipts: 2, createdAudits: 2, linkedAudits: 2 },
  );
  const createdAudit = await getLatestCustomerAudit(
    result.holder.id,
    'rights-holder.created',
  );
  expect(createdAudit.details).toEqual({ rightsHolderId: result.holder.id });
  const linkedAudit = await getCustomerAuditEvents(
    customerId,
    'customer.rights-holder-linked',
  );
  expect(linkedAudit).toHaveLength(2);
  expect(JSON.stringify([createdAudit, linkedAudit])).not.toMatch(
    /PRIVATE-|幂等主体/,
  );
});

test('rights holder stale versions and revoked grants prevent writes and receipt replay', async ({
  request,
}) => {
  const source = await createRightsCustomer(request, '版本来源客户');
  const target = await createRightsCustomer(request, '版本目标客户');
  const key = randomUUID();
  const created = await createHolder(
    request,
    source,
    { name: '版本主体' },
    key,
  );
  expect(created.status()).toBe(201);
  const result: HolderResult = await created.json();
  const edit = await request.patch(`/api/v1/customers/${target}`, {
    headers: authorizationA,
    data: { expectedVersion: 1, category: '企业' },
  });
  expect(edit.status(), await edit.text()).toBe(200);
  for (const response of [
    await createHolder(request, source, { name: '过期主体' }),
    await linkHolder(request, target, result.holder.id),
  ]) {
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'CUSTOMER_VERSION_CONFLICT',
    });
  }
  await revokeRightsHolderGrant('CUSTOMER_EDIT_ROUTINE');
  const list = await request.get(`/api/v1/customers/${source}/rights-holders`, {
    headers: authorizationA,
  });
  expect(await list.json()).toMatchObject({
    capabilities: { create: false, link: false },
  });
  for (const response of [
    await createHolder(request, source, { name: '版本主体' }, key),
    await linkHolder(request, target, result.holder.id, 2),
  ]) {
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 'CUSTOMER_ACTION_FORBIDDEN',
    });
  }
  await expect(getRightsHolderCounts(e2eFixtures.departmentA)).resolves.toEqual(
    { holders: 1, links: 1, receipts: 1, createdAudits: 1, linkedAudits: 1 },
  );
});

test('rights holder link receipt replay requires current readable visibility', async ({
  request,
}) => {
  const source = await createRightsCustomer(request, '撤销读取来源');
  const target = await createRightsCustomer(request, '撤销读取目标');
  const created = await createHolder(request, source, {
    name: '不可继续读取主体',
  });
  const result: HolderResult = await created.json();
  const key = randomUUID();
  const link = await linkHolder(request, target, result.holder.id, 1, key);
  expect(link.status()).toBe(201);
  await revokeRightsHolderGrant('CUSTOMER_READ');
  const replay = await linkHolder(request, target, result.holder.id, 1, key);
  expect(replay.status()).toBe(404);
  expect(await replay.json()).toMatchObject({
    code: 'RIGHTS_HOLDER_NOT_FOUND',
  });
  expect(await replay.text()).not.toContain('不可继续读取主体');
});

test('rights holder each audit failure rolls back holder link receipt and version', async ({
  request,
}) => {
  const source = await createRightsCustomer(request, '回滚来源');
  const target = await createRightsCustomer(request, '回滚目标');
  for (const action of [
    'rights-holder.created',
    'customer.rights-holder-linked',
  ] as const) {
    await rejectRightsHolderAuditWrites(action);
    try {
      const response = await createHolder(request, source, {
        name: '不得持久化主体',
      });
      expect(response.status()).toBe(500);
      expect(await response.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(await response.text()).not.toMatch(
        /constraint|e2e_reject|Prisma|不得持久化/,
      );
      await expect(
        getRightsHolderCounts(e2eFixtures.departmentA),
      ).resolves.toEqual({
        holders: 0,
        links: 0,
        receipts: 0,
        createdAudits: 0,
        linkedAudits: 0,
      });
      await expect(getCustomerById(source)).resolves.toMatchObject({
        version: 1,
      });
    } finally {
      await allowRightsHolderAuditWrites();
    }
  }
  const created = await createHolder(request, source, { name: '应当保留主体' });
  expect(created.status()).toBe(201);
  const result: HolderResult = await created.json();
  await rejectRightsHolderAuditWrites('customer.rights-holder-linked');
  try {
    const response = await linkHolder(request, target, result.holder.id);
    expect(response.status()).toBe(500);
    await expect(getCustomerById(target)).resolves.toMatchObject({
      version: 1,
    });
    await expect(
      getRightsHolderCounts(e2eFixtures.departmentA),
    ).resolves.toEqual({
      holders: 1,
      links: 1,
      receipts: 1,
      createdAudits: 1,
      linkedAudits: 1,
    });
  } finally {
    await allowRightsHolderAuditWrites();
  }
});

test('operations user creates a persisted draft and sees its audit history', async ({
  page,
}) => {
  await configureBearerBrowser(page);
  await page.goto('/customers');
  await expect(
    page.getByRole('heading', { name: '客户', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: '新建客户' }).click();
  await page.getByLabel('客户名称').fill('真实数据库客户');
  await page.getByLabel('联系人姓名').fill('张三');
  await page.getByLabel('电话').fill('13800138000');
  await page.getByRole('button', { name: '保存草稿' }).click();

  await expect(
    page.getByRole('heading', { name: '真实数据库客户', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('办理历史 · 1 条')).toBeVisible();
  await expect(page.getByText('张三', { exact: true })).toBeVisible();
  await expect(page.getByText('13800138000', { exact: true })).toBeVisible();
  await page.getByText('办理历史 · 1 条').click();
  await expect(page.getByText('创建客户草稿', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: '编辑资料' }).click();
  await page.getByLabel('客户名称').fill('真实数据库客户（更新）');
  await page.getByLabel('客户类型').fill('企业');
  await page.getByLabel('证件类型').fill('统一社会信用代码');
  await page.getByLabel('证件号码').fill('91310000abc123');
  await page.getByLabel('邮箱').fill('contact@example.com');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(
    page.getByRole('heading', { name: '真实数据库客户（更新）', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('91310000ABC123', { exact: true })).toBeVisible();
  await expect(
    page.getByText('contact@example.com', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('办理历史 · 2 条')).toBeVisible();

  const customerId = await findCustomerId(
    e2eFixtures.departmentA,
    '真实数据库客户（更新）',
  );
  await expect(page).toHaveURL(`/customers/${customerId}`);
  await expect(getCustomerById(customerId)).resolves.toMatchObject({
    admissionContactName: '张三',
    admissionContactPhone: '13800138000',
    admissionContactEmail: 'contact@example.com',
    version: 2,
  });
  const contactAudit = await getLatestCustomerAudit(customerId);
  expect(contactAudit.details).toMatchObject({
    changes: {
      admissionContactEmail: {
        before: null,
        after: '***@example.com',
      },
    },
  });
  expect(JSON.stringify(contactAudit.details)).not.toContain(
    'contact@example.com',
  );
});

test('contact validation accepts email-only data and rejects incomplete contact data', async ({
  request,
}) => {
  const emailOnly = await request.post('/api/v1/customers', {
    headers: authorizationA,
    data: {
      name: '邮箱联系人客户',
      admissionContactName: '李四',
      admissionContactEmail: 'li.si@example.com',
    },
  });
  expect(emailOnly.status(), await emailOnly.text()).toBe(201);
  expect(await emailOnly.json()).toMatchObject({
    admissionContactName: '李四',
    admissionContactPhone: null,
    admissionContactEmail: 'li.si@example.com',
  });

  const incomplete = await request.post('/api/v1/customers', {
    headers: authorizationA,
    data: { name: '缺少联系方式客户', admissionContactName: '王五' },
  });
  expect(incomplete.status()).toBe(400);
  expect(await incomplete.json()).toMatchObject({ code: 'VALIDATION_ERROR' });

  const malformed = await request.post('/api/v1/customers', {
    headers: authorizationA,
    data: {
      name: '错误邮箱客户',
      admissionContactName: '赵六',
      admissionContactEmail: 'not-an-email',
    },
  });
  expect(malformed.status()).toBe(400);
});

test('the database rejects blank admission contact values', async () => {
  await expect(
    verifyAdmissionContactConstraintRejectsBlankValues(),
  ).resolves.toEqual([
    'customers_admission_contact_complete_check',
    'customers_admission_contact_complete_check',
    'customers_admission_contact_complete_check',
  ]);
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
    data: {
      expectedVersion: 1,
      admissionContactName: '撤权联系人',
      admissionContactPhone: '13800138000',
    },
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
    data: {
      expectedVersion: 1,
      admissionContactName: '旧版本联系人',
      admissionContactPhone: '13900139000',
    },
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
      data: {
        expectedVersion: 1,
        admissionContactName: '不得留下的联系人',
        admissionContactPhone: '13800138000',
      },
    });
    expect(response.status()).toBe(500);
  } finally {
    await allowCustomerUpdateAuditWrites();
  }

  await expect(
    getCustomer(e2eFixtures.departmentA, '修改前名称'),
  ).resolves.toMatchObject({
    id: customerId,
    admissionContactName: null,
    admissionContactPhone: null,
    version: 1,
  });
  await expect(
    countCustomerAuditEvents(e2eFixtures.departmentA, 'customer.updated'),
  ).resolves.toBe(0);
});
