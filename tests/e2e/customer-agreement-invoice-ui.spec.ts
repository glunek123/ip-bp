import { expect, test, type Page, type Request } from '@playwright/test';
import { clearCustomerRightAssetFixture } from '../support/customer-right-asset-database.mjs';
import {
  disconnectCustomerTestDatabase,
  resetCustomerE2eData,
  resetLocalAuthE2eData,
  setLocalCustomerGrant,
  setCustomerDocumentGrant,
} from '../support/customer-database.mjs';

const localRoleId = '30000000-0000-4000-8000-000000000010';
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
const localDepartmentId = '10000000-0000-4000-8000-000000000010';
let assetFixtureCustomerId: string | undefined;

async function grantDocuments() {
  for (const action of [
    'CUSTOMER_AGREEMENT_READ',
    'CUSTOMER_AGREEMENT_EDIT',
    'CUSTOMER_INVOICE_READ',
    'CUSTOMER_INVOICE_EDIT',
  ] as const)
    await setCustomerDocumentGrant(localRoleId, action, true, 'DEPARTMENT');
}

async function passwordLogin(
  page: Page,
  returnTo: string,
  credentials: { username: string; password: string },
) {
  await page.goto(returnTo);
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(credentials.username);
  await page.getByLabel('密码').fill(credentials.password);
  const login = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/auth/login') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '登录', exact: true }).click();
  expect((await login).status()).toBe(200);
  await expect(page).toHaveURL(returnTo);
}

async function commandShape(request: Request) {
  const headers = await request.allHeaders();
  return {
    key: headers['idempotency-key'],
    csrf: headers['x-csrf-token'],
    cookie: headers.cookie,
    bearer: headers.authorization,
    body: request.postDataJSON(),
  };
}

test.beforeEach(async () => resetCustomerE2eData());
test.afterEach(async () => {
  if (assetFixtureCustomerId) {
    await clearCustomerRightAssetFixture(
      assetFixtureCustomerId,
      localDepartmentId,
    );
    assetFixtureCustomerId = undefined;
  }
});
test.afterAll(async () => disconnectCustomerTestDatabase());

test('unknown asset command keeps original cookie request across same-page access loss', async ({
  page,
}) => {
  const credentials = await resetLocalAuthE2eData();
  await passwordLogin(page, '/customers', credentials);
  await page.getByRole('link', { name: '新建客户' }).click();
  await page.getByLabel('客户名称').fill('CU003 资产原键恢复客户');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(
    page.getByRole('heading', { name: 'CU003 资产原键恢复客户' }),
  ).toBeVisible();
  const customerId = page.url().split('/').at(-1)!;
  assetFixtureCustomerId = customerId;
  await page.locator('[data-test="open-create-holder"]').click();
  await page.getByLabel('权利人名称').fill('CU003 资产原键权利人');
  await page.locator('[data-test="submit-create-holder"]').click();
  await expect(page.getByText('CU003 资产原键权利人')).toBeVisible();
  await page.getByRole('tab', { name: '权利资产' }).click();
  await page.getByRole('button', { name: '登记权利资产' }).click();
  await page.getByLabel('资产名称').fill('原请求待确认商标');
  await page.getByLabel('资产类别').fill('商标权');
  await expect(
    page
      .getByLabel('权利主体')
      .locator('option', { hasText: 'CU003 资产原键权利人' }),
  ).toHaveCount(1);
  await page
    .getByLabel('权利主体')
    .selectOption({ label: 'CU003 资产原键权利人' });
  let original: Awaited<ReturnType<typeof commandShape>> | undefined;
  let intercepted = false;
  await page.route(
    `**/api/v1/customers/${customerId}/right-assets`,
    async (route) => {
      if (intercepted || route.request().method() !== 'POST')
        return route.continue();
      intercepted = true;
      original = await commandShape(route.request());
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      await route.abort('failed');
    },
  );
  await page.getByRole('button', { name: '确认保存' }).click();
  await expect(page.getByRole('group', { name: '原请求待确认' })).toBeVisible();
  expect(original?.key).toBeTruthy();
  expect(original?.csrf).toBeTruthy();
  expect(original?.cookie).toBeTruthy();
  expect(original?.bearer).toBeUndefined();
  await page.getByRole('tab', { name: '基本信息' }).click();
  await setLocalCustomerGrant('CUSTOMER_READ', false);
  const deniedRead = page.waitForResponse(
    (response) =>
      response
        .url()
        .includes(`/customers/${customerId}/contacts?status=ENDED`) &&
      response.request().method() === 'GET',
  );
  await page
    .locator('#customer-tab-basic')
    .getByRole('button', { name: '已结束' })
    .click();
  expect([403, 404]).toContain((await deniedRead).status());
  await expect(
    page.locator('[data-test="customer-contact-unavailable"]'),
  ).toBeVisible();
  await expect(page.getByText('原请求待确认商标')).toHaveCount(0);
  await setLocalCustomerGrant('CUSTOMER_READ', true);
  await page.locator('[data-test="customer-contact-readonly-retry"]').click();
  await expect(page.getByText('暂无活动联系人')).toBeVisible();
  await page.getByRole('tab', { name: '权利资产' }).click();
  await expect(page.getByRole('group', { name: '原请求待确认' })).toBeVisible();
  const replay = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/right-assets`) &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '用原请求重试' }).click();
  const replayed = await replay;
  expect(replayed.status()).toBe(201);
  const replayHeaders = await replayed.request().allHeaders();
  expect(replayHeaders['idempotency-key']).toBe(original?.key);
  expect(replayed.request().postDataJSON()).toEqual(original?.body);
});

test('unknown asset proof upload survives same-page unmount until exact manual adoption', async ({
  page,
}) => {
  const credentials = await resetLocalAuthE2eData();
  await passwordLogin(page, '/customers', credentials);
  await page.getByRole('link', { name: '新建客户' }).click();
  await page.getByLabel('客户名称').fill('CU003 资产证明恢复客户');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(
    page.getByRole('heading', { name: 'CU003 资产证明恢复客户' }),
  ).toBeVisible();
  const customerId = page.url().split('/').at(-1)!;
  assetFixtureCustomerId = customerId;
  await page.getByRole('tab', { name: '权利资产' }).click();
  await page.getByRole('button', { name: '登记权利资产' }).click();
  await page.getByLabel('资产名称').fill('未提交的权属草稿');
  let uploaded: { materialId: string; contentVersionId: string } | undefined;
  let intercepted = false;
  await page.route(
    '**/api/v1/materials/upload-drafts/*/content',
    async (route) => {
      if (intercepted || route.request().method() !== 'PUT')
        return route.continue();
      intercepted = true;
      const result = await route.fetch();
      expect(result.status()).toBe(200);
      uploaded = (await result.json()) as {
        materialId: string;
        contentVersionId: string;
      };
      await route.abort('failed');
    },
  );
  await page.getByLabel('选择权属证明文件').setInputFiles({
    name: 'unknown-proof.pdf',
    mimeType: 'application/pdf',
    buffer: pdf,
  });
  await page.getByRole('button', { name: '上传证明' }).click();
  await expect(
    page.getByRole('region', { name: '人工核对单笔证明池' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '登记权利资产' }),
  ).toBeDisabled();
  await page.getByRole('tab', { name: '基本信息' }).click();
  await setLocalCustomerGrant('CUSTOMER_READ', false);
  const deniedRead = page.waitForResponse(
    (response) =>
      response
        .url()
        .includes(`/customers/${customerId}/contacts?status=ENDED`) &&
      response.request().method() === 'GET',
  );
  await page
    .locator('#customer-tab-basic')
    .getByRole('button', { name: '已结束' })
    .click();
  expect([403, 404]).toContain((await deniedRead).status());
  await expect(
    page.locator('[data-test="customer-contact-unavailable"]'),
  ).toBeVisible();
  await expect(page.getByText('未提交的权属草稿')).toHaveCount(0);
  await setLocalCustomerGrant('CUSTOMER_READ', true);
  await page.locator('[data-test="customer-contact-readonly-retry"]').click();
  await expect(page.getByText('暂无活动联系人')).toBeVisible();
  await page.getByRole('tab', { name: '权利资产' }).click();
  const pool = page.getByRole('region', { name: '人工核对单笔证明池' });
  await expect(pool).toBeVisible();
  await pool.getByRole('button', { name: '刷新证明池' }).click();
  await expect(pool.getByText(/unknown-proof\.pdf/u)).toBeVisible();
  await expect(pool.getByRole('button', { name: '选用此证明' })).toBeDisabled();
  await pool.getByRole('button', { name: '下载核对' }).click();
  const exact = await page.request.get(
    `/api/v1/materials/${uploaded!.materialId}/versions/${uploaded!.contentVersionId}/content`,
  );
  expect(exact.status()).toBe(200);
  expect(await exact.body()).toEqual(pdf);
  await expect(pool.getByRole('button', { name: '选用此证明' })).toBeEnabled();
  await pool.getByRole('button', { name: '选用此证明' }).click();
  await expect(pool).toHaveCount(0);
  await expect(page.getByLabel('资产名称')).toHaveValue('未提交的权属草稿');
  expect(uploaded?.contentVersionId).toBeTruthy();
});

test('real password session uploads an exact agreement file, revises it and clears invoice values', async ({
  page,
}) => {
  const credentials = await resetLocalAuthE2eData();
  await grantDocuments();
  await passwordLogin(page, '/customers', credentials);
  await page.getByRole('link', { name: '新建客户' }).click();
  await page.getByLabel('客户名称').fill('协议真实会话客户');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(
    page.getByRole('heading', { name: '协议真实会话客户' }),
  ).toBeVisible();
  const customerId = page.url().split('/').at(-1)!;
  const agreement = page.locator('[data-test="agreement-panel"]');
  const invoice = page.locator('[data-test="invoice-profile-panel"]');
  await expect(
    agreement.locator('[data-test="agreement-not-created"]'),
  ).toBeVisible();
  await expect(
    invoice.locator('[data-test="invoice-never-created"]'),
  ).toBeVisible();

  await agreement.locator('[data-test="agreement-edit"]').click();
  await agreement.getByLabel('协议名称').fill('原版协议');
  const draft = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/materials/upload-drafts') &&
      response.request().method() === 'POST',
  );
  const content = page.waitForResponse(
    (response) =>
      /\/api\/v1\/materials\/upload-drafts\/[^/]+\/content$/u.test(
        response.url(),
      ) && response.request().method() === 'PUT',
  );
  await agreement.locator('input[type="file"]').setInputFiles({
    name: 'agreement.pdf',
    mimeType: 'application/pdf',
    buffer: pdf,
  });
  expect((await draft).status()).toBe(201);
  const uploaded = await content;
  expect(uploaded.status()).toBe(200);
  const uploadedVersion = (await uploaded.json()) as {
    materialId: string;
    contentVersionId: string;
  };
  const create = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/agreements`) &&
      response.request().method() === 'POST',
  );
  await agreement.locator('[data-test="agreement-submit"]').click();
  const created = await create;
  expect(created.status()).toBe(201);
  const sent = await commandShape(created.request());
  expect(sent.key).toBeTruthy();
  expect(sent.csrf).toBeTruthy();
  expect(sent.cookie).toBeTruthy();
  expect(sent.bearer).toBeUndefined();
  expect(sent.body).toMatchObject({
    title: '原版协议',
    contentVersionIds: [uploadedVersion.contentVersionId],
  });
  await expect(
    agreement.locator('[data-test="agreement-version"]'),
  ).toContainText('第 1 版');

  await agreement.locator('[data-test="agreement-edit"]').click();
  await agreement.getByLabel('协议名称').fill('修订协议');
  await agreement.getByRole('button', { name: '移除此版附件' }).click();
  const revise = page.waitForResponse(
    (response) =>
      /\/agreements\/[^/]+\/revisions$/u.test(response.url()) &&
      response.request().method() === 'POST',
  );
  await agreement.locator('[data-test="agreement-submit"]').click();
  expect((await revise).status()).toBe(200);
  await expect(
    agreement.locator('[data-test="agreement-version"]'),
  ).toContainText('第 2 版');
  await agreement.locator('[data-test="agreement-history-toggle"]').click();
  const historical = page.waitForResponse((response) =>
    response
      .url()
      .endsWith(
        `/materials/${uploadedVersion.materialId}/versions/${uploadedVersion.contentVersionId}/content`,
      ),
  );
  await agreement
    .locator(
      `[data-test="history-download-${uploadedVersion.contentVersionId}"]`,
    )
    .click();
  const bytes = await historical;
  expect(bytes.status()).toBe(200);
  const exactBytes = await page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok)
      throw new Error(`Exact version download failed: ${response.status}`);
    return Array.from(new Uint8Array(await response.arrayBuffer()));
  }, `/api/v1/materials/${uploadedVersion.materialId}/versions/${uploadedVersion.contentVersionId}/content`);
  expect(Buffer.from(exactBytes)).toEqual(pdf);
  await page.reload();
  await expect(
    agreement.locator('[data-test="agreement-version"]'),
  ).toContainText('第 2 版');
  await page.getByRole('button', { name: '退出登录' }).click();
  await passwordLogin(page, `/customers/${customerId}`, credentials);
  await expect(
    agreement.locator('[data-test="agreement-version"]'),
  ).toContainText('第 2 版');

  await invoice.locator('[data-test="invoice-edit"]').click();
  await invoice.locator('[data-test="invoice-submit"]').click();
  await expect(invoice.locator('[data-test="invoice-version"]')).toContainText(
    '第 1 版',
  );
  await invoice.locator('[data-test="invoice-edit"]').click();
  await invoice.getByLabel('税号').fill('TEST-TAX-007');
  await invoice.getByLabel('开户银行及账号').fill('测试银行及账号');
  await invoice.locator('[data-test="invoice-submit"]').click();
  await expect(invoice.locator('[data-test="invoice-version"]')).toContainText(
    '第 2 版',
  );
  await invoice.locator('[data-test="invoice-edit"]').click();
  await invoice.getByLabel('税号').fill('');
  await invoice.getByLabel('开户银行及账号').fill('');
  await invoice.locator('[data-test="invoice-submit"]').click();
  await expect(invoice.locator('[data-test="invoice-version"]')).toContainText(
    '第 3 版',
  );
  await expect(invoice.getByText('TEST-TAX-007')).toHaveCount(0);
  await setCustomerDocumentGrant(localRoleId, 'CUSTOMER_AGREEMENT_READ', false);
  const denied = await page.evaluate(
    async ({ customerId, materialId, versionId, key, body, csrf }) => {
      const list = await fetch(
        `/api/v1/materials?ownerType=CUSTOMER&ownerId=${customerId}`,
        { credentials: 'include' },
      );
      const agreement = await fetch(
        `/api/v1/customers/${customerId}/agreements`,
        { credentials: 'include' },
      );
      const bytes = await fetch(
        `/api/v1/materials/${materialId}/versions/${versionId}/content`,
        { credentials: 'include' },
      );
      const replay = await fetch(`/api/v1/customers/${customerId}/agreements`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf,
          'Idempotency-Key': key,
        },
        body: JSON.stringify(body),
      });
      return {
        listStatus: list.status,
        listBody: await list.json(),
        agreementStatus: agreement.status,
        bytesStatus: bytes.status,
        replayStatus: replay.status,
      };
    },
    {
      customerId,
      materialId: uploadedVersion.materialId,
      versionId: uploadedVersion.contentVersionId,
      key: sent.key!,
      body: sent.body,
      csrf: sent.csrf!,
    },
  );
  expect(denied.listStatus).toBe(200);
  expect(denied.listBody).toMatchObject({ items: [], total: 0 });
  expect([403, 404]).toContain(denied.agreementStatus);
  expect([403, 404]).toContain(denied.bytesStatus);
  expect([403, 404]).toContain(denied.replayStatus);
});

test('unknown finalized upload recovers only after exact download and explicit adoption', async ({
  page,
}) => {
  const credentials = await resetLocalAuthE2eData();
  await grantDocuments();
  await passwordLogin(page, '/customers', credentials);
  await page.getByRole('link', { name: '新建客户' }).click();
  await page.getByLabel('客户名称').fill('协议上传核对客户');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(
    page.getByRole('heading', { name: '协议上传核对客户' }),
  ).toBeVisible();
  const customerId = page.url().split('/').at(-1)!;
  const agreement = page.locator('[data-test="agreement-panel"]');
  await agreement.locator('[data-test="agreement-edit"]').click();
  await agreement.getByLabel('协议名称').fill('核对后协议');
  let uploaded: { materialId: string; contentVersionId: string } | undefined;
  let intercepted = false;
  await page.route(
    '**/api/v1/materials/upload-drafts/*/content',
    async (route) => {
      if (intercepted || route.request().method() !== 'PUT')
        return route.continue();
      intercepted = true;
      const result = await route.fetch();
      expect(result.status()).toBe(200);
      uploaded = (await result.json()) as {
        materialId: string;
        contentVersionId: string;
      };
      await route.abort('failed');
    },
  );
  await agreement.locator('input[type="file"]').setInputFiles({
    name: 'lost.pdf',
    mimeType: 'application/pdf',
    buffer: pdf,
  });
  await expect(
    agreement.getByText(
      '协议上传结果未知。刷新列表后下载核对精确版本，不能再次上传。',
    ),
  ).toBeVisible();
  expect(intercepted).toBe(true);
  await expect(agreement.locator('input[type="file"]')).toBeDisabled();
  await expect(
    agreement.locator('[data-test="agreement-submit"]'),
  ).toBeDisabled();
  await agreement.locator('[data-test="agreement-recovery-refresh"]').click();
  const adoption = agreement.locator(
    `[data-test="recovery-adopt-${uploaded!.contentVersionId}"]`,
  );
  await expect(adoption).toBeDisabled();
  await agreement
    .locator(`[data-test="recovery-download-${uploaded!.contentVersionId}"]`)
    .click();
  await expect(adoption).toBeEnabled();
  await adoption.click();
  await expect(agreement.locator('input[type="file"]')).toBeEnabled();
  const create = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/agreements`) &&
      response.request().method() === 'POST',
  );
  await agreement.locator('[data-test="agreement-submit"]').click();
  const result = await create;
  expect(result.status()).toBe(201);
  expect((await commandShape(result.request())).body).toMatchObject({
    contentVersionIds: [uploaded!.contentVersionId],
  });
});

test('committed invoice response loss preserves cookie command and refreshes true current after old replay', async ({
  page,
}) => {
  const credentials = await resetLocalAuthE2eData();
  await grantDocuments();
  await passwordLogin(page, '/customers', credentials);
  await page.getByRole('link', { name: '新建客户' }).click();
  await page.getByLabel('客户名称').fill('开票原键恢复客户');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(
    page.getByRole('heading', { name: '开票原键恢复客户' }),
  ).toBeVisible();
  const url = page.url();
  const customerId = url.split('/').at(-1)!;
  const invoice = page.locator('[data-test="invoice-profile-panel"]');
  let original: Awaited<ReturnType<typeof commandShape>> | undefined;
  let committed: { customerVersion: number } | undefined;
  let intercepted = false;
  await page.route(
    `**/api/v1/customers/${customerId}/invoice-profile`,
    async (route) => {
      if (intercepted || route.request().method() !== 'POST')
        return route.continue();
      intercepted = true;
      original = await commandShape(route.request());
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      committed = (await response.json()) as { customerVersion: number };
      await route.abort('failed');
    },
  );
  await invoice.locator('[data-test="invoice-edit"]').click();
  await invoice.getByLabel('税号').fill('原请求税号');
  await invoice.locator('[data-test="invoice-submit"]').click();
  await expect.poll(() => intercepted).toBe(true);
  await expect.poll(() => committed).toBeDefined();
  await expect(invoice.getByRole('alert')).toContainText('结果未知');
  expect(original?.key).toBeTruthy();
  expect(original?.csrf).toBeTruthy();
  expect(original?.cookie).toBeTruthy();
  expect(original?.bearer).toBeUndefined();
  await page.getByRole('tab', { name: '权利资产' }).click();
  const assets = page.locator('#customer-tab-assets');
  await expect(
    assets.locator('[data-test="right-assets-frozen"]'),
  ).toBeVisible();
  await expect(
    assets.getByRole('button', { name: '登记权利资产' }),
  ).toBeDisabled();
  await page.getByRole('tab', { name: '基本信息' }).click();
  await expect(page.locator('[data-test="agreement-edit"]')).toBeDisabled();

  const later = await page.evaluate(
    async ({ path, csrf, customerVersion }) => {
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf,
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          expectedCustomerVersion: customerVersion,
          expectedInvoiceVersion: 1,
          taxNo: '后续当前税号',
        }),
      });
      return { status: response.status };
    },
    {
      path: `/api/v1/customers/${customerId}/invoice-profile/revisions`,
      csrf: original!.csrf!,
      customerVersion: committed!.customerVersion,
    },
  );
  expect(later.status).toBe(200);
  await page.reload();
  await expect(invoice.locator('[data-test="invoice-submit"]')).toContainText(
    '按原请求重试',
  );
  await page.getByRole('button', { name: '退出登录' }).click();
  await passwordLogin(page, url, credentials);
  await expect(invoice.locator('[data-test="invoice-submit"]')).toContainText(
    '按原请求重试',
  );

  await setCustomerDocumentGrant(localRoleId, 'CUSTOMER_INVOICE_EDIT', false);
  const denied = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/invoice-profile`) &&
      response.request().method() === 'POST',
  );
  await invoice.locator('[data-test="invoice-submit"]').click();
  expect((await denied).status()).toBe(403);
  await expect(invoice.locator('[data-test="invoice-submit"]')).toContainText(
    '按原请求重试',
  );
  await setCustomerDocumentGrant(localRoleId, 'CUSTOMER_INVOICE_READ', false);
  await page.reload();
  await expect(invoice.getByText('后续当前税号')).toHaveCount(0);
  await expect(invoice.getByText('原请求税号')).toHaveCount(0);
  await setCustomerDocumentGrant(
    localRoleId,
    'CUSTOMER_INVOICE_READ',
    true,
    'DEPARTMENT',
  );
  await setCustomerDocumentGrant(
    localRoleId,
    'CUSTOMER_INVOICE_EDIT',
    true,
    'DEPARTMENT',
  );
  await page.reload();
  const replay = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/invoice-profile`) &&
      response.request().method() === 'POST',
  );
  await invoice.locator('[data-test="invoice-submit"]').click();
  const replayed = await replay;
  expect(replayed.status()).toBe(201);
  expect(await commandShape(replayed.request())).toMatchObject({
    key: original?.key,
    body: original?.body,
  });
  await expect(invoice.locator('[data-test="invoice-version"]')).toContainText(
    '第 2 版',
  );
  await expect(invoice.getByText('后续当前税号')).toBeVisible();
});
