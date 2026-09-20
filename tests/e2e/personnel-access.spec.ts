import { expect, test } from '@playwright/test';
import {
  disconnectCustomerTestDatabase,
  getPersonnelAccessSnapshot,
  personnelFixtures,
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
  await expect(operatorCard.locator('select').first()).toHaveValue(
    personnelFixtures.teamBId,
  );
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
