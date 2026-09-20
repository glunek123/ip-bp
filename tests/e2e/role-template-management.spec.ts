import { expect, test } from '@playwright/test';
import {
  allowRoleTemplateAuditWrites,
  countRoleTemplatesByName,
  disconnectCustomerTestDatabase,
  getRoleTemplateSnapshot,
  personnelFixtures,
  rejectRoleTemplateAuditWrites,
  resetPersonnelAccessE2eData,
  setPersonnelAdminRoleManageScope,
  verifyRoleManageMigration,
} from '../support/customer-database.mjs';

let admin: { username: string; password: string };

async function login(
  page: import('@playwright/test').Page,
  username: string,
  password: string,
) {
  await page.goto('/login');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
}

async function authenticatedRequest(page: import('@playwright/test').Page) {
  const response = await page.context().request.get('/api/v1/auth/session');
  expect(response.status(), await response.text()).toBe(200);
  const session = (await response.json()) as { csrfToken: string };
  return {
    request: page.context().request,
    headers: { 'X-CSRF-Token': session.csrfToken },
  };
}

async function openPeopleAccess(page: import('@playwright/test').Page) {
  await login(page, admin.username, admin.password);
  await expect(page).toHaveURL(/\/customers$/);
  await page.goto('/settings/people-access');
  await expect(page.getByRole('heading', { name: '角色模板' })).toBeVisible();
}

test.beforeEach(async () => {
  admin = await resetPersonnelAccessE2eData();
});

test.afterAll(async () => {
  await allowRoleTemplateAuditWrites();
  await disconnectCustomerTestDatabase();
});

test('administrator copies a template, assigns it, and edits permissions for the next request', async ({
  browser,
  page,
}) => {
  await openPeopleAccess(page);

  const sourceCard = page
    .locator('.role-template-card')
    .filter({ hasText: '团队客户经办' });
  await sourceCard.getByRole('button', { name: '复制' }).click();
  await page.getByLabel('模板名称').fill('团队客户经办副本');
  await page.getByRole('button', { name: '保存模板' }).click();
  const copiedCard = page
    .locator('.role-template-card')
    .filter({ hasText: '团队客户经办副本' });
  await expect(copiedCard).toBeVisible();

  const copied = await expect
    .poll(() => getRoleTemplateSnapshot('团队客户经办副本'))
    .not.toBeNull()
    .then(() => getRoleTemplateSnapshot('团队客户经办副本'));
  expect(copied).not.toBeNull();
  expect(copied!.grants).toEqual([
    { action: 'CUSTOMER_READ', scope: 'TEAM' },
    { action: 'CUSTOMER_CREATE_DRAFT', scope: 'TEAM' },
    { action: 'CUSTOMER_EDIT_ROUTINE', scope: 'TEAM' },
  ]);

  await page.locator('[data-test="open-create-user"]').click();
  await page.getByLabel('姓名').fill('模板运营员');
  await page.getByLabel('登录用户名').fill('role.operator');
  await page.getByLabel('初始密码').fill('Role-operator-pass-2026');
  await page
    .locator('[data-test="create-user-team"]')
    .selectOption(personnelFixtures.teamAId);
  await page.locator('[data-test="role-template"]').selectOption(copied!.id);
  await page.locator('[data-test="submit-create-user"]').click();
  await expect(page.getByRole('heading', { name: '模板运营员' })).toBeVisible();

  const operatorContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  const operatorPage = await operatorContext.newPage();
  try {
    await login(operatorPage, 'role.operator', 'Role-operator-pass-2026');
    await expect(operatorPage).toHaveURL(/\/customers$/);
    await expect(
      operatorPage.getByRole('link', { name: '新建客户' }),
    ).toBeVisible();

    const assigned = await getRoleTemplateSnapshot('团队客户经办副本');
    const authorizationRevision =
      assigned?.assignments[0]?.user.authorizationRevision;
    expect(authorizationRevision).toBeDefined();

    await copiedCard.getByRole('button', { name: '编辑' }).click();
    await expect(page.getByText('模板运营员')).toBeVisible();
    await page.locator('[data-test="grant-CUSTOMER_CREATE_DRAFT"]').uncheck();
    await page.getByRole('button', { name: '保存模板' }).click();
    await expect(copiedCard.getByText('V2')).toBeVisible();

    const updated = await getRoleTemplateSnapshot('团队客户经办副本');
    expect(updated?.version).toBe(2);
    expect(updated?.grants).not.toContainEqual({
      action: 'CUSTOMER_CREATE_DRAFT',
      scope: 'TEAM',
    });
    expect(updated?.assignments).toHaveLength(1);
    expect(updated?.assignments[0]?.user.authorizationRevision).toBe(
      authorizationRevision! + 1,
    );

    await operatorPage.reload();
    await expect(operatorPage).toHaveURL(/\/customers$/);
    await expect(
      operatorPage.getByRole('link', { name: '新建客户' }),
    ).toHaveCount(0);
  } finally {
    await operatorContext.close();
  }
});

test('department boundary, duplicate name, and audit failure are rejected without partial templates', async ({
  page,
}) => {
  await openPeopleAccess(page);
  const api = await authenticatedRequest(page);
  const command = {
    sourceRoleTemplateId: personnelFixtures.operatorRoleId,
    name: 'API复制模板',
    grants: [{ action: 'CUSTOMER_READ', scope: 'TEAM' }],
  };

  const duplicate = await api.request.post(
    '/api/v1/organization/role-templates',
    {
      headers: api.headers,
      data: { ...command, name: '团队客户经办' },
    },
  );
  expect(duplicate.status(), await duplicate.text()).toBe(409);

  const foreign = await api.request.post(
    '/api/v1/organization/role-templates',
    {
      headers: api.headers,
      data: {
        ...command,
        sourceRoleTemplateId: personnelFixtures.foreignRoleId,
      },
    },
  );
  expect(foreign.status(), await foreign.text()).toBe(403);

  await setPersonnelAdminRoleManageScope('TEAM');
  const teamOnly = await api.request.post(
    '/api/v1/organization/role-templates',
    { headers: api.headers, data: command },
  );
  expect(teamOnly.status(), await teamOnly.text()).toBe(403);
  await setPersonnelAdminRoleManageScope('DEPARTMENT');

  await rejectRoleTemplateAuditWrites('role-template.created');
  try {
    const auditFailure = await api.request.post(
      '/api/v1/organization/role-templates',
      {
        headers: api.headers,
        data: { ...command, name: '审计失败模板' },
      },
    );
    expect(auditFailure.status()).toBe(500);
    expect(await countRoleTemplatesByName('审计失败模板')).toBe(0);
  } finally {
    await allowRoleTemplateAuditWrites();
  }
});

test('concurrent edits allow one version winner and roll audit failures back', async ({
  page,
}) => {
  await openPeopleAccess(page);
  const api = await authenticatedRequest(page);
  const createdResponse = await api.request.post(
    '/api/v1/organization/role-templates',
    {
      headers: api.headers,
      data: {
        sourceRoleTemplateId: personnelFixtures.operatorRoleId,
        name: '并发编辑模板',
        grants: [{ action: 'CUSTOMER_READ', scope: 'TEAM' }],
      },
    },
  );
  expect(createdResponse.status(), await createdResponse.text()).toBe(201);
  const created = (await createdResponse.json()) as {
    id: string;
    version: number;
  };

  const edit = (name: string) =>
    api.request.patch(`/api/v1/organization/role-templates/${created.id}`, {
      headers: api.headers,
      data: {
        name,
        expectedVersion: created.version,
        grants: [{ action: 'CUSTOMER_READ', scope: 'DEPARTMENT' }],
      },
    });
  const responses = await Promise.all([edit('并发赢家甲'), edit('并发赢家乙')]);
  expect(responses.map((response) => response.status()).sort()).toEqual([
    200, 409,
  ]);
  const winnerResponse = responses.find(
    (response) => response.status() === 200,
  )!;
  const winner = (await winnerResponse.json()) as {
    name: string;
    version: number;
  };

  await rejectRoleTemplateAuditWrites('role-template.updated');
  try {
    const failed = await api.request.patch(
      `/api/v1/organization/role-templates/${created.id}`,
      {
        headers: api.headers,
        data: {
          name: '不应提交的模板名',
          expectedVersion: winner.version,
          grants: [{ action: 'CUSTOMER_READ', scope: 'SELF' }],
        },
      },
    );
    expect(failed.status()).toBe(500);
    expect(await countRoleTemplatesByName('不应提交的模板名')).toBe(0);
    expect((await getRoleTemplateSnapshot(winner.name))?.version).toBe(
      winner.version,
    );
  } finally {
    await allowRoleTemplateAuditWrites();
  }
});

test('migration upgrades only the structurally verified unshared bootstrap role', async () => {
  const result = await verifyRoleManageMigration();

  expect(result).toEqual({
    counts: { valid: 1, shared: 0, incomplete: 0 },
    revisions: { valid: 2, shared: 1, incomplete: 1 },
  });
});
