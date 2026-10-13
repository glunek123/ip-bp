import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Locator,
} from '@playwright/test';
import {
  coreLeadFixtures,
  disconnectCoreLeadTestDatabase,
  getLead,
  resetCoreLeadE2eData,
  setGrant,
  setRoleGrant,
} from '../support/core-lead-database.mjs';
import { createSubmittedCaseThroughApi } from '../support/case-complaint-confirmation-database.mjs';
import {
  disconnectOperationalDisplayDatabase,
  installLegacyNotaryPreference,
  readIssuedCertificateReferences,
  readStoredNotaryPreference,
} from '../support/operational-display-database.mjs';

const operator = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const foreign = { Authorization: `Bearer ${coreLeadFixtures.tokenB}` };
const columnOrder = [
  'businessNo',
  'stage',
  'rightsHolder',
  'platform',
  'shopName',
  'shopExternalId',
  'transferredAt',
  'evidenceAt',
  'openingPhotos',
  'certificateNo',
  'senderName',
  'senderPhone',
  'senderAddress',
  'notaryFee',
  'investigationFee',
  'sampleFee',
  'sourceLead',
  'notaryOffice',
  'createdAt',
];

type Item = {
  id: string;
  createdAt: string;
  transferredAt: string;
  sourceSummary: {
    customer: { id: string; name: string };
    rightsHolder: { id: string; name: string };
    platform: string;
  };
  openingSummary: { photoCount: number };
  certificateSummary: { certificateNo: string };
  fees: Record<string, { state: string; amount: string | null }>;
  linkedCase: { id: string } | null;
};
type CertificateFile = {
  purpose: string;
  materialId: string;
  contentVersionId: string;
  originalFilename: string;
  mimeType: string;
};
type MatterDetail = Item & { certificateFiles: CertificateFile[] };
type LeadItem = {
  id: string;
  shopExternalId: string | null;
  displayNames: Record<string, string>;
  products: Array<{
    url: string | null;
    quantity: number;
    commentCount: number;
    unitPrice: string;
    estimatedAmount: string;
  }>;
};
async function json<T = Record<string, unknown>>(
  response: Awaited<ReturnType<APIRequestContext['get']>>,
  status = 200,
): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json() as Promise<T>;
}

async function signIn(
  page: Page,
  path: string,
  username: string,
  password: string,
) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(path);
}

async function createExactLead(request: APIRequestContext) {
  return json<{ id: string }>(
    await request.post('/api/v1/leads', {
      headers: { ...operator, 'Idempotency-Key': randomUUID() },
      data: {
        customerId: coreLeadFixtures.admittedCustomer,
        rightsHolderId: coreLeadFixtures.holder,
        caseType: 'CIVIL',
        infringementTypes: ['TRADEMARK'],
        source: 'ONLINE',
        platform: 'TAOBAO',
        foundAt: '2026-09-21T02:30:00.000Z',
        shopName: `运营显示长店铺 ${'京'.repeat(65)} ${randomUUID().slice(0, 8)}`,
        shopExternalId: `DISPLAY-${randomUUID().slice(0, 8)}`,
        needDisclose: false,
        leadScreenshotContentVersionIds: [],
        products: [
          {
            title: '第一商品',
            url: 'https://example.com/products/one',
            quantity: 2,
            unitPrice: '1.50',
            commentCount: 3,
          },
          {
            title: '第二商品',
            url: 'https://example.com/products/two',
            quantity: 0,
            unitPrice: '1.50',
            commentCount: 3,
          },
        ],
      },
    }),
    201,
  );
}

async function scrollCheck(page: Page, region: Locator) {
  await expect(region).toBeVisible();
  const before = await region.evaluate((el) => ({
    left: el.scrollLeft,
    width: el.clientWidth,
    total: el.scrollWidth,
  }));
  if (page.viewportSize()?.width === 390)
    expect(before.total).toBeGreaterThan(before.width);
  if (before.total > before.width) {
    await region.focus();
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => region.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(before.left);
  }
  const widths = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    viewport: innerWidth,
  }));
  expect(widths.body).toBeLessThanOrEqual(widths.viewport + 1);
  const geometry = await region.locator('thead th').evaluateAll((cells) =>
    cells.map((cell) => {
      const box = cell.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        width: box.width,
        whiteSpace: getComputedStyle(cell).whiteSpace,
      };
    }),
  );
  for (let index = 1; index < geometry.length; index++)
    expect(geometry[index]!.left).toBeGreaterThanOrEqual(
      geometry[index - 1]!.right - 1,
    );
  expect(geometry.every((cell) => cell.width > 0)).toBe(true);
  const sample = await region
    .locator('tbody tr')
    .first()
    .evaluate((row) => {
      const cells = [...row.querySelectorAll('td')];
      return cells.map((cell, index) => {
        const bounds = cell.getBoundingClientRect();
        const content = cell.querySelector('summary') ?? cell;
        const contentBounds = content.getBoundingClientRect();
        const style = getComputedStyle(content);
        return {
          left: bounds.left,
          right: bounds.right,
          nextLeft: cells[index + 1]?.getBoundingClientRect().left ?? null,
          contentLeft: contentBounds.left,
          contentRight: contentBounds.right,
          whiteSpace: style.whiteSpace,
          overflowX: style.overflowX,
        };
      });
    });
  for (const cell of sample) {
    if (cell.nextLeft !== null)
      expect(cell.right).toBeLessThanOrEqual(cell.nextLeft + 1);
    expect(cell.contentLeft).toBeGreaterThanOrEqual(cell.left - 1);
    expect(cell.contentRight).toBeLessThanOrEqual(cell.right + 1);
    expect(cell.whiteSpace.length).toBeGreaterThan(0);
    expect(cell.overflowX.length).toBeGreaterThan(0);
  }
  await region.evaluate((el) => {
    el.scrollLeft = 0;
  });
}

test.beforeEach(async () => resetCoreLeadE2eData());
test.afterEach(async () => resetCoreLeadE2eData());
test.afterAll(async () => {
  await disconnectOperationalDisplayDatabase();
  await disconnectCoreLeadTestDatabase();
});

test('real source chain projects authorized display fields, exact amounts, frozen photos and scoped case', async ({
  request,
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const exactLead = await createExactLead(request);
  const chain = await createSubmittedCaseThroughApi(request);
  await json(
    await request.post(`/api/v1/leads/${exactLead.id}/push`, {
      headers: { ...operator, 'Idempotency-Key': randomUUID() },
      data: { expectedVersion: 1 },
    }),
    201,
  );
  const clientSession = await json<{ csrfToken: string }>(
    await request.post('/api/v1/auth/login', {
      headers: { Origin: 'http://127.0.0.1:5174' },
      data: {
        username: chain.client.username,
        password: chain.client.password,
      },
    }),
  );
  await json(
    await request.post(`/api/v1/client/leads/${exactLead.id}/reviews`, {
      headers: {
        'X-CSRF-Token': clientSession.csrfToken,
        'Idempotency-Key': randomUUID(),
      },
      data: { result: 'INFRINGEMENT', expectedVersion: 2 },
    }),
    201,
  );
  const office = await json<{ id: string }>(
    await request.post('/api/v1/notary-offices', {
      headers: operator,
      data: { name: `运营显示公证处-${randomUUID().slice(0, 8)}` },
    }),
    201,
  );
  const productIds = (await getLead(exactLead.id))!.products.map(
    (product) => product.id,
  );
  const pending = await json<{ id: string }>(
    await request.post(`/api/v1/leads/${exactLead.id}/notary-matters`, {
      headers: { ...operator, 'Idempotency-Key': randomUUID() },
      data: {
        selectedProductIds: productIds,
        selectedContentVersionIds: [],
        notaryOfficeId: office.id,
        evidenceMode: 'ONLINE_PURCHASE',
        batchPurpose: '运营显示三态费用验收',
        expectedVersion: 3,
      },
    }),
    201,
  );
  const uncollected = await json<Item>(
    await request.get(`/api/v1/notary-matters/${pending.id}`, {
      headers: operator,
    }),
  );
  expect(uncollected.fees).toMatchObject({
    notary: { state: 'UNRECORDED', amount: null },
    investigation: { state: 'UNRECORDED', amount: null },
    sample: { state: 'UNRECORDED', amount: null },
  });
  await json(
    await request.post(`/api/v1/notary-matters/${pending.id}/evidence`, {
      headers: { ...operator, 'Idempotency-Key': randomUUID() },
      data: {
        evidenceAt: '2026-09-24',
        sampleFeeState: 'KNOWN',
        sampleFeeAmount: '0.00',
        logistics: [{ companyState: 'NONE', trackingState: 'NONE' }],
        expectedVersion: 1,
      },
    }),
    201,
  );
  const zeroSample = await json<Item>(
    await request.get(`/api/v1/notary-matters/${pending.id}`, {
      headers: operator,
    }),
  );
  expect(zeroSample.fees.sample).toEqual({ state: 'KNOWN', amount: '0.00' });
  const list = await json<{ items: Item[] }>(
    await request.get('/api/v1/notary-matters', { headers: operator }),
  );
  const matter = list.items.find(
    (item) => item.linkedCase?.id === chain.caseId,
  );
  expect(matter).toBeDefined();
  if (!matter)
    throw new Error('Real certificate matter missing from authorized list');
  expect(matter.sourceSummary).toMatchObject({
    customer: { id: coreLeadFixtures.admittedCustomer },
    rightsHolder: { id: coreLeadFixtures.holder },
    platform: 'TAOBAO',
  });
  expect(matter.sourceSummary.customer.name).toBeTruthy();
  expect(matter.sourceSummary.rightsHolder.name).toBeTruthy();
  expect(matter.openingSummary.photoCount).toBe(1);
  expect(matter.certificateSummary.certificateNo).toBeTruthy();
  expect(matter.fees).toMatchObject({
    notary: { state: 'KNOWN', amount: '120.00' },
    investigation: { state: 'PENDING', amount: null },
    sample: { state: 'PENDING', amount: null },
  });
  expect(matter.linkedCase?.id).toBe(chain.caseId);
  const detail = await json<MatterDetail>(
    await request.get(`/api/v1/notary-matters/${matter.id}`, {
      headers: operator,
    }),
  );
  expect(detail.sourceSummary).toEqual(matter.sourceSummary);
  expect(detail.openingSummary.photoCount).toBe(1);
  const certificateReferences = await readIssuedCertificateReferences(
    matter.id,
  );
  expect(certificateReferences).toHaveLength(1);
  const frozen = certificateReferences[0]!;
  expect(detail.certificateFiles).toEqual([
    {
      purpose: 'NOTARY_CERTIFICATE',
      materialId: frozen.materialId,
      contentVersionId: frozen.contentVersionId,
      originalFilename: frozen.contentVersion.originalFilename,
      mimeType: 'application/pdf',
    },
  ]);
  expect(Object.keys(detail.certificateFiles[0]!)).not.toContain('storageKey');
  expect(Object.keys(detail.certificateFiles[0]!)).not.toContain(
    'currentVersionId',
  );
  const certificateContentPath = `/api/v1/materials/${frozen.materialId}/versions/${frozen.contentVersionId}/content`;
  const lead = await json<LeadItem>(
    await request.get(`/api/v1/leads/${exactLead.id}`, { headers: operator }),
  );
  expect(lead.displayNames).toMatchObject({
    customerName: expect.any(String),
    rightsHolderName: expect.any(String),
    responsibleUserName: expect.any(String),
  });
  expect(
    lead.products.reduce((sum, product) => sum + product.quantity, 0),
  ).toBe(2);
  expect(
    lead.products.reduce((sum, product) => sum + product.commentCount, 0),
  ).toBe(6);
  expect(lead.products[0]?.unitPrice).toBe('1.50');
  expect(lead.shopExternalId).toMatch(/^DISPLAY-/u);
  expect(lead.products.map((product) => product.url)).toEqual([
    'https://example.com/products/one',
    'https://example.com/products/two',
  ]);
  expect(lead.products.map((product) => product.estimatedAmount)).toEqual([
    '3.00',
    '4.50',
  ]);
  const shanghaiDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(matter.createdAt));
  expect(matter.transferredAt).toBe(shanghaiDate);

  await signIn(
    page,
    '/notary-matters',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  const certificateDownload = await page.request.get(certificateContentPath);
  expect(certificateDownload.status()).toBe(200);
  expect(certificateDownload.headers()['content-type']).toContain(
    'application/pdf',
  );
  expect(await certificateDownload.body()).toEqual(
    Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n'),
  );
  await expect(page.locator('[data-test="matter-row"]')).toHaveCount(2);
  await expect(
    page.locator(
      `[data-test="matter-row"]:has(a[href="/notary-matters/${matter.id}"]) [data-test="linked-case"]`,
    ),
  ).toHaveAttribute('href', `/cases/${chain.caseId}`);
  await setGrant('case.read', false);
  try {
    await page.context().clearCookies();
    await signIn(
      page,
      '/notary-matters',
      coreLeadFixtures.operatorUsername,
      coreLeadFixtures.operatorPassword,
    );
    await expect(
      page.locator('[data-test="matter-row"] [data-test="linked-case"]'),
    ).toHaveCount(0);
    const withoutCase = await json<{ items: Item[] }>(
      await page.request.get('/api/v1/notary-matters'),
    );
    expect(
      withoutCase.items.find((item) => item.id === matter.id)?.linkedCase,
    ).toBeNull();
  } finally {
    await setRoleGrant(coreLeadFixtures.roleA, 'case.read', 'DEPARTMENT');
  }
  await page.context().clearCookies();
  await signIn(
    page,
    '/notary-matters',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await expect(
    page.locator(
      `[data-test="matter-row"]:has(a[href="/notary-matters/${matter.id}"]) [data-test="linked-case"]`,
    ),
  ).toHaveAttribute('href', `/cases/${chain.caseId}`);

  expect(
    (
      await request.get('/api/v1/notary-matters', { headers: foreign })
    ).status(),
  ).toBe(200);
  const foreignList = await json<{ items: Item[] }>(
    await request.get('/api/v1/notary-matters', { headers: foreign }),
  );
  expect(foreignList.items).toEqual([]);
  expect([403, 404]).toContain(
    (
      await request.get(`/api/v1/notary-matters/${matter.id}`, {
        headers: foreign,
      })
    ).status(),
  );
  await setRoleGrant(coreLeadFixtures.roleSelf, 'lead.read', 'DEPARTMENT');
  try {
    const peer = await json<{ items: Item[] }>(
      await request.get('/api/v1/notary-matters', {
        headers: { Authorization: `Bearer ${coreLeadFixtures.tokenSelf}` },
      }),
    );
    expect(
      peer.items.some((item: { id: string }) => item.id === matter.id),
    ).toBe(true);
  } finally {
    await setRoleGrant(
      coreLeadFixtures.roleSelf,
      'lead.read',
      'DEPARTMENT',
      false,
    );
  }

  for (const credentials of [chain.client, chain.lawyer]) {
    const context = await browser.newContext({
      baseURL: 'http://127.0.0.1:5174',
    });
    try {
      const external = await context.newPage();
      await external.goto('/login');
      await external.getByLabel('用户名').fill(credentials.username);
      await external.getByLabel('密码').fill(credentials.password);
      await external.getByRole('button', { name: '登录', exact: true }).click();
      await expect(external).not.toHaveURL(/\/login$/u);
      for (const path of [
        '/api/v1/notary-matters',
        `/api/v1/notary-matters/${matter.id}`,
      ])
        expect((await external.request.get(path)).status()).toBe(403);
      const externalDownload = await external.request.get(
        certificateContentPath,
      );
      if (credentials === chain.client)
        expect([403, 404]).toContain(externalDownload.status());
      else {
        expect(externalDownload.status()).toBe(200);
        expect(await externalDownload.body()).toEqual(
          await certificateDownload.body(),
        );
      }
    } finally {
      await context.close();
    }
  }
});

test('legacy five-column preference expands on read without write; accounts and strict PUT stay isolated', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const legacy = [
    'businessNo',
    'stage',
    'createdAt',
    'sourceLead',
    'notaryOffice',
  ];
  await installLegacyNotaryPreference(coreLeadFixtures.userA);
  await signIn(
    page,
    '/notary-matters',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  const initial = await json<{ order: string[]; hidden: string[] }>(
    await page.request.get('/api/v1/notary-matters/list-preference'),
  );
  expect(initial.order).toHaveLength(19);
  expect(initial.order.slice(-3)).toEqual(legacy.slice(2));
  expect(initial.hidden).toEqual(['notaryOffice']);
  expect(await readStoredNotaryPreference(coreLeadFixtures.userA)).toEqual({
    columnOrder: legacy,
    hiddenColumns: ['notaryOffice'],
  });
  const csrf = (
    await json<{ csrfToken: string }>(
      await page.request.get('/api/v1/auth/session'),
    )
  ).csrfToken;
  const put = (order: string[], hidden: string[], extra = {}) =>
    page.request.put('/api/v1/notary-matters/list-preference', {
      headers: { 'X-CSRF-Token': csrf },
      data: { order, hidden, ...extra },
    });
  expect(
    (await put([...columnOrder.slice(0, -1), 'unknown'], [])).status(),
  ).toBe(400);
  expect((await put(columnOrder, ['businessNo'])).status()).toBe(400);
  expect(
    (
      await put(columnOrder, [], { userId: coreLeadFixtures.userSelf })
    ).status(),
  ).toBe(400);
  expect(await readStoredNotaryPreference(coreLeadFixtures.userA)).toEqual({
    columnOrder: legacy,
    hiddenColumns: ['notaryOffice'],
  });
  await json(await put(columnOrder, ['shopName']), 200);
  await page.reload();
  expect(
    (
      await json<{ hidden: string[] }>(
        await page.request.get('/api/v1/notary-matters/list-preference'),
      )
    ).hidden,
  ).toEqual(['shopName']);
  const otherContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:5174',
  });
  try {
    const other = await otherContext.newPage();
    await signIn(
      other,
      '/notary-matters',
      coreLeadFixtures.selfUsername,
      coreLeadFixtures.selfPassword,
    );
    expect(
      (
        await json<{ hidden: string[] }>(
          await other.request.get('/api/v1/notary-matters/list-preference'),
        )
      ).hidden,
    ).not.toEqual(['shopName']);
  } finally {
    await otherContext.close();
  }
  await page.getByRole('button', { name: '退出登录' }).click();
  await signIn(
    page,
    '/notary-matters',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  expect(
    (
      await json<{ hidden: string[] }>(
        await page.request.get('/api/v1/notary-matters/list-preference'),
      )
    ).hidden,
  ).toEqual(['shopName']);
  await page.locator('[data-test="column-settings-toggle"]').click();
  await page.locator('[data-test="reset-columns"]').click();
  await expect(page.locator('[data-test="save-columns"]')).toBeEnabled();
  await page.locator('[data-test="save-columns"]').click();
  await expect(
    page.locator('[data-test="column-preference-status"]'),
  ).toContainText('已保存');
  expect(
    (
      await json<{ hidden: string[] }>(
        await page.request.get('/api/v1/notary-matters/list-preference'),
      )
    ).hidden,
  ).toEqual(['sourceLead', 'notaryOffice', 'createdAt']);
});

test('three viewport screenshots retain readable real leads, notary and cases tables', async ({
  page,
  request,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const lead = await createExactLead(request);
  await createSubmittedCaseThroughApi(request);
  await signIn(
    page,
    '/notary-matters',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  const demoContext = await browser.newContext();
  const demoPage = await demoContext.newPage();
  try {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      const label = `${viewport.width}x${viewport.height}`;
      await demoPage.setViewportSize(viewport);
      await demoPage.goto(
        pathToFileURL(resolve(process.cwd(), 'demo/index.html')).href,
      );
      await demoPage.locator('#notary-parent').click();
      await demoPage.locator('#notary-subnav .nav-sub-item').first().click();
      await expect(demoPage.locator('#view-notary')).toBeVisible();
      await demoPage.screenshot({
        path: testInfo.outputPath(`demo-notary-reference-${label}.png`),
        fullPage: true,
      });
      for (const [route, name, row] of [
        ['/notary-matters', 'notary', '[data-test="matter-row"]'],
        ['/leads', 'leads', '[data-test="lead-row"]'],
        ['/cases', 'cases', '[data-test="case-list"] tbody tr'],
      ] as const) {
        await page.goto(route);
        await expect(page.locator(row).first()).toBeVisible();
        const region = page.locator('.business-list-scroll').first();
        await scrollCheck(page, region);
        await page.evaluate(() => {
          (document.activeElement as HTMLElement | null)?.blur();
          window.scrollTo(0, 0);
        });
        await page.screenshot({
          path: testInfo.outputPath(`${name}-${label}.png`),
          fullPage: true,
        });
        if (name === 'leads') {
          const exact = page
            .locator('[data-test="lead-row"]')
            .filter({ has: page.locator(`a[href="/leads/${lead.id}"]`) });
          await expect(
            exact.locator('[data-test="lead-quantity-total"]'),
          ).toHaveText('2');
          await expect(
            exact.locator('[data-test="lead-first-unit-price"]'),
          ).toHaveText('1.50');
          await expect(
            exact.locator('[data-test="lead-comment-total"]'),
          ).toHaveText('6');
          await expect(
            exact.locator('[data-test="lead-estimated-amount"]'),
          ).toHaveText('7.50');
          await exact.locator('details').first().locator('summary').click();
          await expect(exact.locator('details').first()).toHaveAttribute(
            'open',
            '',
          );
          await region.evaluate((el) => {
            el.scrollLeft = 0;
          });
          await page.evaluate(() => {
            (document.activeElement as HTMLElement | null)?.blur();
            window.scrollTo(0, 0);
          });
          await scrollCheck(page, region);
          await page.evaluate(() => {
            (document.activeElement as HTMLElement | null)?.blur();
            window.scrollTo(0, 0);
          });
          await page.screenshot({
            path: testInfo.outputPath(`${name}-expanded-${label}.png`),
            fullPage: true,
          });
        }
      }
    }
  } finally {
    await demoContext.close();
  }
});
