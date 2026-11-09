import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  coreLeadFixtures,
  disconnectCoreLeadTestDatabase,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';

const requireBackend = createRequire(resolve('backend/package.json'));
const { Client } = requireBackend('pg') as {
  Client: new (options: { connectionString: string }) => {
    connect(): Promise<void>;
    query(sql: string, values: string[]): Promise<unknown>;
    end(): Promise<void>;
  };
};
const headers = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
type Review = { result: string; archiveDate?: string };
type LeadView = {
  id: string;
  version: number;
  status: string;
  businessNo: string;
  shopName: string;
  products: Array<{
    id: string;
    title: string;
    url: string | null;
    quantity: number;
    unitPrice: string;
    estimatedAmount: string;
  }>;
  reviewDecision: Review | null;
  evidenceDecision: { archiveDate: string; archiveType: string } | null;
  history: Array<{ kind: string; archiveDate?: string }>;
};
async function read(request: APIRequestContext, id: string) {
  const response = await request.get('/api/v1/leads/' + id, { headers });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as LeadView;
}
async function create(request: APIRequestContext, shopName: string) {
  const response = await request.post('/api/v1/leads', {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: {
      customerId: coreLeadFixtures.admittedCustomer,
      rightsHolderId: coreLeadFixtures.holder,
      caseType: 'CIVIL',
      infringementTypes: ['TRADEMARK'],
      source: 'ONLINE',
      platform: 'TAOBAO',
      foundAt: '2026-09-21T02:30:00.000Z',
      shopName,
      needDisclose: false,
      products: [
        { title: '测试商品', quantity: 2, unitPrice: '1.50', commentCount: 3 },
      ],
      leadScreenshotContentVersionIds: [],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as LeadView;
}
async function login(page: Page) {
  await page.goto('/leads');
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  const response = page.waitForResponse(
    (item) => new URL(item.url()).pathname === '/api/v1/auth/login',
  );
  await page.getByRole('button', { name: '登录', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page).toHaveURL(/\/leads$/u);
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
}
async function openStage(page: Page, status: string) {
  await page.goto('/leads?status=' + status);
}
function row(page: Page, lead: LeadView) {
  return page
    .locator('[data-test="lead-row"]')
    .filter({ hasText: lead.businessNo });
}
async function grantReview() {
  const connectionString = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== 'test' || !connectionString)
    throw new Error('Isolated test database required');
  const target = new URL(connectionString);
  if (target.hostname !== '127.0.0.1' || target.pathname !== '/dev_cor_test')
    throw new Error('Unexpected test database');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      "INSERT INTO role_grants(id,role_template_id,action,scope) VALUES(gen_random_uuid(),$1,'lead.review.proxy','DEPARTMENT') ON CONFLICT DO NOTHING",
      [coreLeadFixtures.roleA],
    );
  } finally {
    await client.end();
  }
}

test.afterAll(disconnectCoreLeadTestDatabase);

test('lead cards, single and batch decisions, and revival preserve earlier rounds', async ({
  page,
  request,
}, testInfo) => {
  await resetCoreLeadE2eData();
  await grantReview();
  test.setTimeout(90_000);
  const a = await create(request, '审核归档店');
  const b = await create(request, '确认归档店');
  const c = await create(request, '批量归档甲店');
  const d = await create(request, '批量归档乙店');
  const e = await create(request, '取证移交店');
  const office = await request.post('/api/v1/notary-offices', {
    headers,
    data: { name: '合成试测公证处' },
  });
  expect(office.status(), await office.text()).toBe(201);
  const { id: officeId } = (await office.json()) as { id: string };
  await login(page);
  await page.goto('/leads/' + a.id);
  await expect(
    page.getByRole('heading', { name: '基础信息', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('线索发现日期', { exact: true })).toBeVisible();
  await expect(page.getByText('运营', { exact: true })).toBeVisible();
  await expect(
    page.locator('[data-test="lead-product-summary"]'),
  ).toContainText('销售总额');
  await expect(
    page.locator('[data-test="lead-product-summary"]'),
  ).toContainText('3.00');
  await expect(page.getByText('截图（商品归属待关联）')).toHaveCount(0);
  await page.locator('[data-test="edit-lead-base-card"]').click();
  await page.locator('[data-test="routine-shop"]').fill('应被取消的店铺');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect((await read(request, a.id)).shopName).toBe(a.shopName);
  await page.locator('[data-test="edit-lead-base-card"]').click();
  await page.locator('[data-test="routine-shop"]').fill('审核归档店已编辑');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(
    page.getByText('审核归档店已编辑', { exact: true }),
  ).toBeVisible();
  await page.locator('[data-test="edit-lead-products-card"]').click();
  await page.getByLabel('商品名称', { exact: true }).fill('测试商品已编辑');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('测试商品已编辑', { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('审核归档店已编辑', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('测试商品已编辑', { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('lead-detail.png'),
    fullPage: true,
  });

  await openStage(page, 'WAITING_PUSH');
  await row(page, a).getByRole('button', { name: '推送', exact: true }).click();
  await expect(row(page, a)).toHaveCount(0);
  for (const lead of [b, c, d, e])
    await row(page, lead).getByRole('checkbox').check();
  await page.getByRole('button', { name: '批量推送', exact: true }).click();
  await expect(row(page, b)).toHaveCount(0);

  await openStage(page, 'WAITING_REVIEW');
  await row(page, a).getByRole('button', { name: '审核', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByText('推送日期', { exact: true })).toBeVisible();
  await dialog.getByLabel('审核结果').selectOption('NO_INFRINGEMENT');
  await dialog.getByLabel('归档日期').fill('2026-09-23');
  await dialog.getByLabel('归档原因').fill('审核确认无侵权');
  await dialog.screenshot({
    path: testInfo.outputPath('lead-review-archive.png'),
  });
  await dialog.getByRole('button', { name: '提交审核结果' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await read(request, a.id)).reviewDecision).toMatchObject({
    result: 'NO_INFRINGEMENT',
    archiveDate: '2026-09-23',
  });
  for (const lead of [b, c, d, e])
    await row(page, lead).getByRole('checkbox').check();
  await page.getByRole('button', { name: '批量审核', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '批量审核' });
  await dialog.getByLabel('审核结果').selectOption('INFRINGEMENT');
  await dialog.getByRole('button', { name: '提交审核结果' }).click();
  await expect(dialog).toHaveCount(0);

  await openStage(page, 'WAITING_EVIDENCE_DECISION');
  await row(page, b).getByRole('button', { name: '确认', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByText('审核日期', { exact: true })).toBeVisible();
  await dialog.getByLabel('确认结果').selectOption('NO_EVIDENCE');
  await dialog.getByLabel('归档类型').selectOption('LINK_REMOVED');
  await dialog.getByLabel('归档日期').fill('2026-09-24');
  await dialog.getByLabel('归档原因').fill('商品链接已下架');
  await dialog.screenshot({
    path: testInfo.outputPath('lead-confirm-archive.png'),
  });
  await dialog.getByRole('button', { name: '提交确认结果' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await read(request, b.id)).toMatchObject({
    status: 'ARCHIVED',
    reviewDecision: { result: 'INFRINGEMENT' },
    evidenceDecision: {
      archiveType: 'LINK_REMOVED',
      archiveDate: '2026-09-24',
    },
  });

  for (const lead of [c, d])
    await row(page, lead).getByRole('checkbox').check();
  await page.getByRole('button', { name: '批量确认', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '批量确认' });
  await dialog.getByLabel('确认结果').selectOption('NO_EVIDENCE');
  await dialog
    .getByLabel('归档类型')
    .selectOption('NO_INFRINGEMENT_INFORMATION');
  await dialog.getByLabel('归档日期').fill('2026-09-25');
  await dialog.getByLabel('归档原因').fill('本批未找到可取证信息');
  await dialog.screenshot({
    path: testInfo.outputPath('lead-batch-confirm.png'),
  });
  const stale = await read(request, d.id);
  const revision = await request.patch(
    '/api/v1/leads/' + d.id + '/routine-profile',
    {
      headers,
      data: {
        expectedRevision: stale.version,
        shopName: stale.shopName,
        remark: '并发更新后的备注',
        products: stale.products.map(
          ({ id, title, url, quantity, unitPrice }) => ({
            id,
            title,
            url,
            quantity,
            unitPrice,
          }),
        ),
      },
    },
  );
  expect(revision.status(), await revision.text()).toBe(200);
  await dialog.getByRole('button', { name: '提交确认结果' }).click();
  await expect(dialog.getByRole('alert')).toContainText('本批未保存');
  expect((await read(request, c.id)).status).toBe('WAITING_EVIDENCE_DECISION');
  await dialog.getByRole('button', { name: '重新读取' }).click();
  await expect(dialog.getByLabel('归档原因')).toHaveValue(
    '本批未找到可取证信息',
  );
  await dialog.getByRole('button', { name: '提交确认结果' }).click();
  await expect(dialog).toHaveCount(0);
  for (const lead of [c, d]) {
    expect((await read(request, lead.id)).evidenceDecision).toMatchObject({
      archiveType: 'NO_INFRINGEMENT_INFORMATION',
      archiveDate: '2026-09-25',
    });
  }

  await row(page, e).getByRole('button', { name: '确认', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('确认结果').selectOption('EVIDENCE');
  await dialog.getByLabel('公证处', { exact: true }).selectOption(officeId);
  await expect(dialog.getByText('新增公证处')).toHaveCount(0);
  await expect(dialog.getByText('取证方式')).toHaveCount(0);
  await dialog.screenshot({
    path: testInfo.outputPath('lead-confirm-notary.png'),
  });
  await dialog.getByRole('button', { name: '提交确认结果' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await read(request, e.id)).status).toBe('TRANSFERRED_TO_NOTARY');

  const archived = await read(request, b.id);
  const unauthorized = await request.post('/api/v1/leads/' + b.id + '/revive', {
    headers: {
      Authorization: `Bearer ${coreLeadFixtures.tokenB}`,
      'Idempotency-Key': randomUUID(),
    },
    data: { expectedVersion: archived.version },
  });
  expect(unauthorized.status()).toBe(404);
  await openStage(page, 'ARCHIVED');
  for (const lead of [a, b]) {
    await row(page, lead)
      .getByRole('button', { name: '复活', exact: true })
      .click();
    await expect(row(page, lead)).toHaveCount(0);
    const revived = await read(request, lead.id);
    expect(revived).toMatchObject({
      status: 'WAITING_PUSH',
      businessNo: lead.businessNo,
      reviewDecision: null,
      evidenceDecision: null,
    });
    expect(revived.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'REVIEW_DECISION' }),
      ]),
    );
  }
  expect((await read(request, b.id)).history).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'EVIDENCE_DECISION',
        archiveDate: '2026-09-24',
      }),
    ]),
  );
  const round = await read(request, b.id);
  for (const [action, fields] of [
    ['push', {}],
    ['proxy-reviews', { result: 'INFRINGEMENT' }],
    [
      'evidence-decisions',
      {
        result: 'NO_EVIDENCE',
        archiveType: 'NO_EVIDENCE',
        archiveDate: '2026-09-26',
        reason: '复活后的新一轮归档',
      },
    ],
  ] as const) {
    const current = await read(request, b.id);
    const response = await request.post(
      '/api/v1/leads/' + b.id + '/' + action,
      {
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: { expectedVersion: current.version, ...fields },
      },
    );
    expect(response.status(), await response.text()).toBe(201);
  }
  const rearchived = await read(request, b.id);
  expect(rearchived).toMatchObject({
    version: round.version + 3,
    status: 'ARCHIVED',
    evidenceDecision: { archiveType: 'NO_EVIDENCE', archiveDate: '2026-09-26' },
  });
  expect(
    rearchived.history
      .filter((item) => item.kind === 'EVIDENCE_DECISION')
      .map((item) => item.archiveDate),
  ).toEqual(['2026-09-24', '2026-09-26']);
});
