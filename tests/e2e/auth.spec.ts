import { expect, test } from '@playwright/test';
import {
  disconnectCustomerTestDatabase,
  resetLocalAuthE2eData,
  verifyLocalAuthMigration,
} from '../support/customer-database.mjs';

let credentials: { username: string; password: string };

test.beforeEach(async () => {
  credentials = await resetLocalAuthE2eData();
});

test.afterAll(async () => {
  await disconnectCustomerTestDatabase();
});

test('local account logs in, persists a customer, restores, and logs out', async ({
  page,
}) => {
  await page.goto('/customers');
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await page.getByLabel('用户名').fill(credentials.username);
  await page.getByLabel('密码').fill(credentials.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/);
  await page.getByRole('link', { name: '新建客户' }).click();
  await page.getByLabel('客户名称').fill('本地登录客户');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(
    page.getByRole('heading', { name: '本地登录客户', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: '本地登录客户', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/customers');
  await expect(page).toHaveURL(/\/login\?returnTo=/);
});

test('cookie-authenticated writes reject a missing CSRF token', async ({
  request,
}) => {
  const login = await request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://127.0.0.1:5174' },
    data: credentials,
  });
  expect(login.status(), await login.text()).toBe(200);
  const rejected = await request.post('/api/v1/customers', {
    data: { name: '缺少 CSRF' },
  });
  expect(rejected.status()).toBe(403);
  expect(await rejected.json()).toMatchObject({ code: 'CSRF_INVALID' });
  const session = await login.json();
  const accepted = await request.post('/api/v1/customers', {
    headers: { 'X-CSRF-Token': session.csrfToken },
    data: { name: '带 CSRF' },
  });
  expect(accepted.status(), await accepted.text()).toBe(201);
});

test('concurrent login failures atomically activate the source throttle', async ({
  request,
}) => {
  const attempts = await Promise.all(
    Array.from({ length: 6 }, () =>
      request.post('/api/v1/auth/login', {
        headers: { Origin: 'http://127.0.0.1:5174' },
        data: { ...credentials, password: 'definitely-wrong-password' },
      }),
    ),
  );
  expect(attempts.filter((response) => response.status() === 401)).toHaveLength(
    5,
  );
  expect(attempts.filter((response) => response.status() === 429)).toHaveLength(
    1,
  );
  const blocked = await request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://127.0.0.1:5174' },
    data: credentials,
  });
  expect(blocked.status()).toBe(429);
  expect(await blocked.json()).toMatchObject({ code: 'LOGIN_RATE_LIMITED' });
});

test('auth migration upgrades the nine-migration schema and rolls back dirty data', async () => {
  const result = await verifyLocalAuthMigration();
  expect(result).toEqual({
    previousMigrations: 9,
    displayName: 'legacy-user',
    externalSubject: 'legacy-user',
    authTables: ['auth_sessions', 'auth_throttles', 'local_credentials'],
    invalidUsernameConstraint: 'local_credentials_username_format_check',
    failedMigrationCode: '23514',
    failedColumns: 0,
    failedTables: 0,
    whitespaceMigrationCode: '23514',
    whitespaceRollbackPreserved: true,
  });
});
