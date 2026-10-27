import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { seedBatch2UsernameFixture } from '../support/batch2-username-fixture.mjs';

const origin = 'http://127.0.0.1:5174';
const password = 'Username-acceptance-2026!';
let fixture: Awaited<ReturnType<typeof seedBatch2UsernameFixture>>;

test.setTimeout(180_000);
test.beforeAll(async () => {
  fixture = await seedBatch2UsernameFixture();
});

async function apiLogin(
  context: APIRequestContext,
  username: string,
  secret: string,
) {
  const response = await context.post('/api/v1/auth/login', {
    headers: { Origin: origin },
    data: { username, password: secret },
  });
  expect(response.status(), await response.text()).toBe(200);
  const view = (await response.json()) as {
    csrfToken: string;
    principalType: string;
    user: { username: string };
  };
  const restored = await context.get('/api/v1/auth/session');
  expect(restored.status(), await restored.text()).toBe(200);
  expect(await restored.json()).toMatchObject({
    principalType: view.principalType,
    user: { username: view.user.username },
  });
  return view;
}

async function pageLogin(page: Page, username: string, secret: string) {
  await page.goto('/login');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(secret);
  await page.getByRole('button', { name: '登录', exact: true }).click();
}

test('formal HTTP creation and real login work for all four principal types', async ({
  playwright,
}) => {
  const admin = await playwright.request.newContext({ baseURL: origin });
  try {
    const adminView = await apiLogin(
      admin,
      fixture.adminUsername,
      fixture.adminPassword,
    );
    expect(adminView.principalType).toBe('INTERNAL');
    const headers = { 'X-CSRF-Token': adminView.csrfToken };
    const scenarios = [
      {
        type: 'INTERNAL',
        username: `Internal+${fixture.suffix}@Example.COM`,
        path: '/api/v1/organization/users',
        data: {
          displayName: '合成内部人员',
          teamId: null,
          roleTemplateId: fixture.userRoleId,
        },
      },
      {
        type: 'CLIENT',
        username: `客户 用户${fixture.suffix}`,
        path: `/api/v1/customers/${fixture.customerId}/client-accounts`,
        data: { displayName: '合成客户审核人' },
      },
      {
        type: 'NOTARY',
        username: `Notary+${fixture.suffix}@Example.COM`,
        path: `/api/v1/notary-offices/${fixture.officeId}/accounts`,
        data: { displayName: '合成公证员' },
      },
      {
        type: 'LAWYER',
        username: `律师${fixture.suffix}`,
        path: '/api/v1/lawyer-accounts',
        data: { fullName: '合成承办律师' },
      },
    ] as const;
    for (const item of scenarios) {
      const created = await admin.post(item.path, {
        headers,
        data: { ...item.data, username: item.username, password },
      });
      expect(created.status(), `${item.type}: ${await created.text()}`).toBe(
        201,
      );
      const account = (await created.json()) as { username: string };
      expect(account.username).toBe(
        item.username.normalize('NFKC').toLowerCase(),
      );
      const user = await playwright.request.newContext({ baseURL: origin });
      try {
        const session = await apiLogin(user, item.username, password);
        expect(session.principalType).toBe(item.type);
        expect(session.user.username).toBe(account.username);
      } finally {
        await user.dispose();
      }
    }
    const duplicate = await admin.post(scenarios[0].path, {
      headers,
      data: {
        ...scenarios[0].data,
        username: ` ${scenarios[0].username
          .toUpperCase()
          .replace(/[A-Z]/gu, (letter) =>
            String.fromCharCode(letter.charCodeAt(0) + 0xfee0),
          )} `,
        password,
      },
    });
    expect(duplicate.status(), await duplicate.text()).toBe(409);
    expect(await duplicate.json()).toMatchObject({
      code: 'USERNAME_ALREADY_EXISTS',
    });
    for (const username of [
      'ab',
      'x'.repeat(65),
      '\ninvalid',
      'invalid\t',
      'invalid\u200b',
    ]) {
      const invalid = await admin.post(scenarios[0].path, {
        headers,
        data: { ...scenarios[0].data, username, password },
      });
      expect(
        invalid.status(),
        `${JSON.stringify(username)}: ${await invalid.text()}`,
      ).toBe(400);
      expect(await invalid.json()).toMatchObject({ code: 'USERNAME_INVALID' });
    }
  } finally {
    await admin.dispose();
  }
});

test('old ASCII account still logs in; invalid raw controls fail with its correct password', async ({
  playwright,
}) => {
  const old = await playwright.request.newContext({ baseURL: origin });
  try {
    const view = await apiLogin(
      old,
      ` ${fixture.adminUsername.toUpperCase()} `,
      fixture.adminPassword,
    );
    expect(view.user.username).toBe(fixture.adminUsername);
  } finally {
    await old.dispose();
  }
  for (const username of [
    `\n${fixture.adminUsername}`,
    `${fixture.adminUsername}\t`,
    `${fixture.adminUsername}\u0001`,
    `${fixture.adminUsername}\u0000`,
  ]) {
    const isolated = await playwright.request.newContext({ baseURL: origin });
    try {
      const failed = await isolated.post('/api/v1/auth/login', {
        headers: { Origin: origin },
        data: { username, password: fixture.adminPassword },
      });
      expect(failed.status(), await failed.text()).toBe(401);
      expect(await failed.json()).toMatchObject({
        code: 'AUTHENTICATION_FAILED',
      });
      const noSession = await isolated.get('/api/v1/auth/session');
      expect(noSession.status()).toBe(401);
    } finally {
      await isolated.dispose();
    }
  }
});

test('real page creates email and custom accounts, then shows duplicate and invalid feedback', async ({
  page,
}) => {
  await pageLogin(page, fixture.adminUsername, fixture.adminPassword);
  await expect(page).toHaveURL(/\/customers$/);
  await page.goto('/settings/people-access');
  const email = `Page+${fixture.suffix}@Example.COM`;
  const custom = `自定义 用户${fixture.suffix}`;
  for (const [name, username] of [
    ['邮箱用户', email],
    ['自定义用户', custom],
  ]) {
    await page.locator('[data-test="open-create-user"]').click();
    await page.getByLabel('姓名').fill(name);
    await page.getByLabel('登录用户名').fill(username);
    await page.getByLabel('初始密码').fill(password);
    await page
      .locator('[data-test="role-template"]')
      .selectOption(fixture.userRoleId);
    await page.locator('[data-test="submit-create-user"]').click();
    await expect(page.getByRole('heading', { name })).toBeVisible();
  }
  await page.locator('[data-test="open-create-user"]').click();
  await page.getByLabel('姓名').fill('重复用户');
  await page.getByLabel('登录用户名').fill(` ${email.toUpperCase()} `);
  await page.getByLabel('初始密码').fill(password);
  await page
    .locator('[data-test="role-template"]')
    .selectOption(fixture.userRoleId);
  await page.locator('[data-test="submit-create-user"]').click();
  await expect(page.getByRole('alert')).toContainText('用户名');
  await page.getByLabel('登录用户名').fill(`bad\u200b${fixture.suffix}`);
  await page.locator('[data-test="submit-create-user"]').click();
  await expect(page.getByRole('alert')).toContainText('用户名');
  await page.getByRole('button', { name: '退出登录' }).click();
  for (const [username, normalized] of [
    [email, email.toLowerCase()],
    [custom, custom],
  ]) {
    await pageLogin(page, username, password);
    await expect(page).toHaveURL(/\/customers$/);
    const session = await page.context().request.get('/api/v1/auth/session');
    expect(session.status(), await session.text()).toBe(200);
    expect(await session.json()).toMatchObject({
      user: { username: normalized },
    });
    await page.getByRole('button', { name: '退出登录' }).click();
  }
});
