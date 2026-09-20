import { expect, test } from '@playwright/test';
import {
  addPersonnelForeignMembership,
  allowPersonnelCreatedAuditWrites,
  countPersonnelCredentials,
  disconnectCustomerTestDatabase,
  getPersonnelAccessSnapshot,
  personnelFixtures,
  rejectPersonnelCreatedAuditWrites,
  resetPersonnelAccessE2eData,
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

async function createOperator(page: import('@playwright/test').Page) {
  await login(page, admin.username, admin.password);
  await expect(page).toHaveURL(/\/customers$/);
  const contextResponse = page.waitForResponse(
    '**/api/v1/organization/management-context',
  );
  await page.goto('/settings/people-access');
  await contextResponse;
  await page.locator('[data-test="open-create-user"]').click();
  await page.getByLabel('姓名').fill('运营乙');
  await page.getByLabel('登录用户名').fill('operator.b');
  await page.getByLabel('初始密码').fill('Operator-pass-2026');
  await page
    .locator('[data-test="create-user-team"]')
    .selectOption(personnelFixtures.teamAId);
  await page
    .locator('[data-test="role-template"]')
    .selectOption(personnelFixtures.operatorRoleId);
  await page.locator('[data-test="submit-create-user"]').click();
  await expect(page.getByRole('heading', { name: '运营乙' })).toBeVisible();
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

test.beforeEach(async () => {
  admin = await resetPersonnelAccessE2eData();
});

test.afterAll(async () => {
  await disconnectCustomerTestDatabase();
});

test('administrator creates a real person who logs in with the assigned Team scope', async ({
  page,
}) => {
  await createOperator(page);

  const snapshot = await getPersonnelAccessSnapshot('operator.b');
  expect(snapshot.accountActive).toBe(true);
  expect(snapshot.memberships).toEqual([
    { active: true, teamId: personnelFixtures.teamAId },
  ]);
  expect(snapshot.assignments).toEqual([
    {
      active: true,
      roleTemplateId: personnelFixtures.operatorRoleId,
      teamId: personnelFixtures.teamAId,
    },
  ]);
  expect(snapshot.auditActions).toContain('user.created');
  expect(snapshot.passwordHash).not.toContain('Operator-pass-2026');
  expect(snapshot.serializedAudits).not.toContain('Operator-pass-2026');

  await page.getByRole('button', { name: '退出登录' }).click();
  await login(page, 'operator.b', 'Operator-pass-2026');
  await expect(page).toHaveURL(/\/customers$/);
  await expect(page.getByRole('link', { name: '新建客户' })).toBeVisible();
});

test('team conflict is explained, then role revoke allows the direct move', async ({
  page,
}) => {
  await createOperator(page);

  const operatorCard = page
    .locator('.person-card')
    .filter({ hasText: '运营乙' });
  await operatorCard
    .locator('[data-test^="team-"]')
    .selectOption(personnelFixtures.teamBId);
  await expect(page.getByRole('alert')).toContainText(
    '先停用该人员当前的团队范围角色',
  );
  await operatorCard.getByRole('button', { name: '停用', exact: true }).click();
  await operatorCard
    .locator('select')
    .first()
    .selectOption(personnelFixtures.teamBId);
  await expect
    .poll(
      async () => (await getPersonnelAccessSnapshot('operator.b')).memberships,
    )
    .toEqual([{ active: true, teamId: personnelFixtures.teamBId }]);
});

test('password reset needs only the new password and invalidates the old one', async ({
  page,
}) => {
  await createOperator(page);
  const operatorCard = page
    .locator('.person-card')
    .filter({ hasText: '运营乙' });
  await operatorCard.getByRole('button', { name: '重置密码' }).click();
  await page.getByLabel('新密码').fill('Operator-new-pass-2026');
  await page.getByRole('button', { name: '确认重置' }).click();
  await page.getByRole('button', { name: '退出登录' }).click();

  await login(page, 'operator.b', 'Operator-pass-2026');
  await expect(page.getByRole('alert')).toContainText('用户名或密码不正确');
  await page.getByLabel('密码').fill('Operator-new-pass-2026');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/);
});

test('account, membership, and role lifecycle take effect without extra forms', async ({
  browser,
  page,
}) => {
  await createOperator(page);
  const operatorCard = page
    .locator('.person-card')
    .filter({ hasText: '运营乙' });
  const operatorContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  const operatorPage = await operatorContext.newPage();
  try {
    await login(operatorPage, 'operator.b', 'Operator-pass-2026');
    await expect(operatorPage).toHaveURL(/\/customers$/);

    await operatorCard.getByRole('button', { name: '停用成员' }).click();
    await expect(
      operatorCard.getByRole('button', { name: '恢复成员' }),
    ).toBeVisible();
    await operatorPage.goto('/customers');
    await expect(operatorPage).toHaveURL(/\/login\?returnTo=/);

    await operatorCard.getByRole('button', { name: '恢复成员' }).click();
    await login(operatorPage, 'operator.b', 'Operator-pass-2026');
    await expect(operatorPage).toHaveURL(/\/customers$/);

    await operatorCard.getByRole('button', { name: '停用账号' }).click();
    await expect(
      operatorCard.getByRole('button', { name: '启用账号' }),
    ).toBeVisible();
    await operatorPage.goto('/customers');
    await expect(operatorPage).toHaveURL(/\/login\?returnTo=/);
    await operatorCard.getByRole('button', { name: '启用账号' }).click();

    await operatorCard
      .getByRole('button', { name: '停用', exact: true })
      .click();
    await expect(
      operatorCard.getByRole('button', { name: '恢复', exact: true }),
    ).toBeVisible();
    await operatorCard
      .getByRole('button', { name: '恢复', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await getPersonnelAccessSnapshot('operator.b')).assignments,
      )
      .toEqual([expect.objectContaining({ active: true })]);
  } finally {
    await operatorContext.close();
  }
});

test('self, cross-department, and multi-department account mutations are rejected', async ({
  page,
}) => {
  await createOperator(page);
  const api = await authenticatedRequest(page);

  const self = await api.request.patch(
    `/api/v1/organization/users/${personnelFixtures.adminUserId}/status`,
    { headers: api.headers, data: { active: false } },
  );
  expect(self.status(), await self.text()).toBe(403);

  const foreign = await api.request.patch(
    `/api/v1/organization/users/${personnelFixtures.foreignUserId}/status`,
    { headers: api.headers, data: { active: false } },
  );
  expect(foreign.status(), await foreign.text()).toBe(403);

  await addPersonnelForeignMembership('operator.b');
  const snapshot = await getPersonnelAccessSnapshot('operator.b');
  const reset = await api.request.post(
    `/api/v1/organization/users/${snapshot.userId}/password-reset`,
    { headers: api.headers, data: { newPassword: 'Blocked-password-2026' } },
  );
  expect(reset.status(), await reset.text()).toBe(409);
  expect(await reset.json()).toMatchObject({
    code: 'GLOBAL_ACCOUNT_MANAGEMENT_REQUIRED',
  });
});

test('a failed audit write rolls the complete user creation transaction back', async ({
  page,
}) => {
  await login(page, admin.username, admin.password);
  await expect(page).toHaveURL(/\/customers$/);
  const api = await authenticatedRequest(page);
  await rejectPersonnelCreatedAuditWrites();
  try {
    const response = await api.request.post('/api/v1/organization/users', {
      headers: api.headers,
      data: {
        displayName: '事务失败人员',
        username: 'operator.rollback',
        password: 'Rollback-pass-2026',
        teamId: personnelFixtures.teamAId,
        roleTemplateId: personnelFixtures.operatorRoleId,
      },
    });
    expect(response.status()).toBe(500);
    expect(await countPersonnelCredentials('operator.rollback')).toBe(0);
  } finally {
    await allowPersonnelCreatedAuditWrites();
  }
});
