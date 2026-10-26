import { expect, test } from '@playwright/test';
import {
  disconnectCustomerTestDatabase,
  resetCustomerE2eData,
  resetLocalAuthE2eData,
  setCustomerDocumentGrant,
} from '../support/customer-database.mjs';

test.afterAll(async () => disconnectCustomerTestDatabase());

test('customer creation drawer saves complete cooperation terms without a file and supports adding it later', async ({
  page,
}) => {
  await resetCustomerE2eData();
  const credentials = await resetLocalAuthE2eData();
  const roleId = '30000000-0000-4000-8000-000000000010';
  for (const action of [
    'CUSTOMER_AGREEMENT_READ',
    'CUSTOMER_AGREEMENT_EDIT',
  ] as const)
    await setCustomerDocumentGrant(roleId, action, true, 'DEPARTMENT');

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/customers');
  await page.getByLabel('用户名').fill(credentials.username);
  await page.getByLabel('密码').fill(credentials.password);
  const login = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/auth/login') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '登录', exact: true }).click();
  expect((await login).status()).toBe(200);
  await expect(page).toHaveURL('/customers');
  await page.getByRole('button', { name: '新建客户', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新建客户', exact: true });
  await expect(drawer.getByLabel('运营', { exact: true })).toHaveValue(
    credentials.userId,
  );
  await drawer.getByLabel('客户名称').fill('首版完整建档客户');
  await drawer
    .getByLabel('主体类型', { exact: true })
    .selectOption('ENTERPRISE');
  await drawer
    .getByLabel('统一社会信用代码', { exact: true })
    .fill('91330100MA2ABC1234X');
  await drawer.getByLabel('主营类目', { exact: true }).fill('家居日用');
  await drawer.getByLabel('区域', { exact: true }).selectOption('华东');
  await drawer.getByLabel('客户经理', { exact: true }).fill('合成经理');
  await drawer.getByLabel('合作协议名称', { exact: true }).fill('首版合作协议');
  await drawer
    .getByLabel('结算方式', { exact: true })
    .selectOption('月结 · 30 天');
  await drawer.getByLabel('合作模式', { exact: true }).selectOption('全风险');
  await drawer
    .getByLabel('结算条件（公式）', { exact: true })
    .fill('客户结算金额=结案金额*70%');
  await expect(
    drawer.getByText('可先保存合作信息，合作协议文件可在客户详情中补传。', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(drawer.locator('input[type="file"]')).toHaveCount(0);

  for (const [name, width, height] of [
    ['desktop', 1440, 1000],
    ['mobile', 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(drawer).toBeVisible();
    await expect
      .poll(() =>
        drawer.locator('input, select').evaluateAll((fields) =>
          fields.every((field) => {
            const box = field.getBoundingClientRect();
            return box.left >= 0 && box.right <= window.innerWidth;
          }),
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: `.local/customer-v1-db/new-customer-${name}.png`,
      fullPage: true,
    });
  }

  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/customers') &&
      response.request().method() === 'POST',
  );
  await drawer.getByRole('button', { name: '保存草稿', exact: true }).click();
  const result = await saved;
  expect(result.status(), await result.text()).toBe(201);
  const created = await result.json();
  expect(created).toMatchObject({
    profileStatus: 'draft',
    admittedAt: null,
    customerManagerName: '合成经理',
    responsibleUserId: credentials.userId,
  });
  await expect(drawer).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/customers/${created.id}`);
  await expect(
    page.getByRole('heading', { name: '首版完整建档客户', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('91330100MA2ABC1234X', { exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: '合作协议', exact: true }).click();
  const agreement = page.locator('[data-test="agreement-panel"]');
  await expect(
    agreement.getByText('首版合作协议', { exact: true }),
  ).toBeVisible();
  await expect(
    agreement.getByText('客户结算金额=结案金额*70%', { exact: true }),
  ).toBeVisible();
  await expect(
    agreement.getByText('未附合作协议文件', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: '合作协议', exact: true }).click();
  await expect(
    agreement.getByText('客户结算金额=结案金额*70%', { exact: true }),
  ).toBeVisible();

  await agreement.locator('[data-test="agreement-edit"]').click();
  await expect(agreement.getByLabel('结算条件（公式）')).toHaveValue(
    '客户结算金额=结案金额*70%',
  );
  await agreement.locator('input[type="file"]').setInputFiles({
    name: '后补合作协议.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n'),
  });
  await expect(
    agreement.getByText('合作协议文件已上传，尚未绑定到新版本。', {
      exact: true,
    }),
  ).toBeVisible();
  await agreement.locator('[data-test="agreement-submit"]').click();
  await expect(
    agreement.locator('[data-test="agreement-version"]'),
  ).toContainText('第 2 版');
  await page.reload();
  await page.getByRole('tab', { name: '合作协议', exact: true }).click();
  await expect(
    agreement.getByText('后补合作协议.pdf', { exact: true }),
  ).toBeVisible();
  await expect(
    agreement.getByText('客户结算金额=结案金额*70%', { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
