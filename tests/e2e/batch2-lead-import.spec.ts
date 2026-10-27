import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertBatch2ImportTarget } from '../support/batch2-lead-import-target.mjs';
import {
  assertDistinctOperatorReceipt,
  assertRetriedImageTaskIdentity,
} from '../support/batch2-lead-operator-receipt.mjs';

// Activation requires a separately authorized, disposable batch-2 PG/app/files
// environment. The historic UI003 fixture is deliberately not reused.
test.beforeAll(() => {
  assertBatch2ImportTarget();
});
const backend = createRequire(resolve(process.cwd(), 'backend/package.json'));
const { unzipSync, zipSync, strToU8 } = backend('fflate') as {
  unzipSync: (bytes: Uint8Array) => Record<string, Uint8Array>;
  zipSync: (files: Record<string, Uint8Array>) => Uint8Array;
  strToU8: (value: string) => Uint8Array;
};

test('XLSX preview, lead persistence, failed screenshot task and exact replay', async ({
  request,
}) => {
  const token = process.env.BATCH2_IMPORT_OPERATOR_TOKEN;
  const customerId = process.env.BATCH2_IMPORT_CUSTOMER_ID;
  const rightsHolderId = process.env.BATCH2_IMPORT_HOLDER_ID;
  const otherToken = process.env.BATCH2_IMPORT_OTHER_DEPARTMENT_TOKEN;
  const operatorName = process.env.BATCH2_IMPORT_OPERATOR_NAME;
  const originalActorId = process.env.BATCH2_IMPORT_OPERATOR_ID;
  const retryToken = process.env.BATCH2_IMPORT_RETRY_OPERATOR_TOKEN;
  const retryActorId = process.env.BATCH2_IMPORT_RETRY_OPERATOR_ID;
  if (
    !token ||
    !customerId ||
    !rightsHolderId ||
    !otherToken ||
    !operatorName ||
    !originalActorId ||
    !retryToken ||
    !retryActorId
  )
    throw new Error('Batch-2 synthetic actor fixture is incomplete');
  const headers = { Authorization: `Bearer ${token}` };
  const template = await request.get('/api/v1/leads/xlsx-template', {
    headers,
  });
  expect(template.status()).toBe(200);
  const parts = unzipSync(new Uint8Array(await template.body()));
  const xml = new TextDecoder().decode(parts['xl/worksheets/sheet1.xml']);
  const row = `<row r="2"><c r="A2" t="inlineStr"><is><t>合成客户</t></is></c><c r="J2" t="inlineStr"><is><t>https://example.com/p</t></is></c></row>`;
  parts['xl/worksheets/sheet1.xml'] = strToU8(
    xml.replace('</sheetData>', `${row}</sheetData>`),
  );
  const preview = await request.post('/api/v1/leads/xlsx-preview', {
    headers: {
      ...headers,
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    data: Buffer.from(zipSync(parts)),
  });
  expect(preview.status(), await preview.text()).toBe(201);
  const sheets = (await preview.json()).sheets as Array<{
    rows: Array<{ rowNumber: number; cells: string[] }>;
  }>;
  expect(sheets[0]?.rows[0]?.cells).toHaveLength(73);
  expect(sheets[0]?.rows[1]?.rowNumber).toBe(2);

  const key = randomUUID();
  const body = {
    items: [
      {
        rowNumber: 2,
        operatorText: operatorName,
        remoteScreenshots: [
          {
            productNumber: 1,
            sourceGroupNumber: 1,
            urls: ['http://203.0.113.1/no-image.png'],
          },
        ],
        input: {
          customerId,
          rightsHolderId,
          caseType: 'CIVIL',
          infringementTypes: ['TRADEMARK'],
          source: 'ONLINE',
          platform: 'TAOBAO',
          foundAt: '2026-10-27T00:00:00.000Z',
          shopName: `合成导入店铺-${key}`,
          needDisclose: false,
          products: [
            {
              title: '合成商品',
              url: 'https://example.com/p',
              quantity: 0,
              unitPrice: '0',
              commentCount: 0,
            },
          ],
          leadScreenshotContentVersionIds: [],
        },
      },
    ],
  };
  const send = () =>
    request.post('/api/v1/leads/csv-import', {
      headers: { ...headers, 'Idempotency-Key': key },
      data: body,
    });
  const created = await send();
  expect(created.status(), await created.text()).toBe(201);
  const result = await created.json();
  const lead = result.items[0].lead;
  expect(lead.businessNo).toEqual(expect.any(String));
  expect(lead.businessNo.length).toBeGreaterThan(5);
  expect(lead.products).toHaveLength(1);
  const replay = await send();
  expect(replay.status()).toBe(201);
  expect((await replay.json()).items[0].lead.id).toBe(lead.id);
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `/api/v1/leads/${lead.id}/image-imports`,
          { headers },
        );
        return (await response.json())[0]?.status;
      },
      { timeout: 20_000 },
    )
    .toBe('FAILED');
  const tasks = await request.get(`/api/v1/leads/${lead.id}/image-imports`, {
    headers,
  });
  const items = await tasks.json();
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    rowNumber: 2,
    productNumber: 1,
    productId: lead.products[0].id,
    url: 'http://203.0.113.1/no-image.png',
    status: 'FAILED',
    failureCode: 'BLOCKED_ADDRESS',
  });
  const forbidden = await request.get(
    `/api/v1/leads/${lead.id}/image-imports`,
    {
      headers: { Authorization: `Bearer ${otherToken}` },
    },
  );
  expect([403, 404]).toContain(forbidden.status());
  const retained = await request.get(`/api/v1/leads/${lead.id}`, { headers });
  expect(retained.status()).toBe(200);
  expect((await retained.json()).products[0].id).toBe(lead.products[0].id);
  const retried = await request.post(
    `/api/v1/leads/${lead.id}/image-imports/${items[0].id}/retry`,
    {
      headers: { Authorization: `Bearer ${retryToken}` },
      data: { url: 'http://203.0.113.2/no-image.png' },
    },
  );
  expect(retried.status(), await retried.text()).toBe(201);
  await assertRetriedImageTaskIdentity({
    taskId: items[0].id,
    originalActorId,
    retryActorId,
  });
});

test('department importer assigns another responsible operator and self scope cannot assign that owner', async ({
  request,
}) => {
  const token = process.env.BATCH2_IMPORT_DEPARTMENT_OPERATOR_TOKEN;
  const selfToken = process.env.BATCH2_IMPORT_SELF_ONLY_TOKEN;
  const ownerName = process.env.BATCH2_IMPORT_TARGET_OPERATOR_NAME;
  const ownerId = process.env.BATCH2_IMPORT_TARGET_OPERATOR_ID;
  const ownerTeamId = process.env.BATCH2_IMPORT_TARGET_TEAM_ID;
  const actorId = process.env.BATCH2_IMPORT_DEPARTMENT_OPERATOR_ID;
  const customerId = process.env.BATCH2_IMPORT_CUSTOMER_ID;
  const rightsHolderId = process.env.BATCH2_IMPORT_HOLDER_ID;
  if (
    !token ||
    !selfToken ||
    !ownerName ||
    !ownerId ||
    !ownerTeamId ||
    !actorId ||
    !customerId ||
    !rightsHolderId
  )
    throw new Error('Batch-2 distinct-owner synthetic fixture is incomplete');
  const key = randomUUID();
  const body = {
    items: [
      {
        rowNumber: 2,
        operatorText: ownerName,
        input: {
          customerId,
          rightsHolderId,
          caseType: 'CIVIL',
          infringementTypes: ['TRADEMARK'],
          source: 'ONLINE',
          platform: 'TAOBAO',
          foundAt: '2026-10-27T00:00:00.000Z',
          shopName: `合成异人运营-${key}`,
          needDisclose: false,
          products: [
            { title: '合成商品', quantity: 0, unitPrice: '0', commentCount: 0 },
          ],
          leadScreenshotContentVersionIds: [],
        },
      },
    ],
  };
  const denied = await request.post('/api/v1/leads/csv-import', {
    headers: {
      Authorization: `Bearer ${selfToken}`,
      'Idempotency-Key': randomUUID(),
    },
    data: body,
  });
  expect(denied.status()).toBe(409);
  expect((await denied.json()).details.failures[0]).toMatchObject({
    rowNumber: 2,
    code: 'OPERATOR_NOT_AUTHORIZED',
  });
  const headers = { Authorization: `Bearer ${token}`, 'Idempotency-Key': key };
  const created = await request.post('/api/v1/leads/csv-import', {
    headers,
    data: body,
  });
  expect(created.status(), await created.text()).toBe(201);
  const lead = (await created.json()).items[0].lead;
  expect(lead).toMatchObject({
    responsibleUserId: ownerId,
    teamId: ownerTeamId,
  });
  await assertDistinctOperatorReceipt({
    leadId: lead.id,
    key,
    actorId,
    ownerId,
    teamId: ownerTeamId,
  });
  const replay = await request.post('/api/v1/leads/csv-import', {
    headers,
    data: body,
  });
  expect(replay.status(), await replay.text()).toBe(201);
  expect((await replay.json()).items[0].lead.id).toBe(lead.id);
});

test('operator maps and previews the 19-column workbook in the existing import panel', async ({
  page,
  request,
}) => {
  const username = process.env.BATCH2_IMPORT_OPERATOR_USERNAME;
  const password = process.env.BATCH2_IMPORT_OPERATOR_PASSWORD;
  const customer = process.env.BATCH2_IMPORT_CUSTOMER_NAME;
  const holder = process.env.BATCH2_IMPORT_HOLDER_NAME;
  const operator = process.env.BATCH2_IMPORT_OPERATOR_NAME;
  const token = process.env.BATCH2_IMPORT_OPERATOR_TOKEN;
  if (!username || !password || !customer || !holder || !operator || !token)
    throw new Error('Batch-2 browser fixture is incomplete');
  const template = await request.get('/api/v1/leads/xlsx-template', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(template.status()).toBe(200);
  const parts = unzipSync(new Uint8Array(await template.body()));
  const xml = new TextDecoder().decode(parts['xl/worksheets/sheet1.xml']);
  const escape = (value: string) =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  const values = [
    customer,
    holder,
    '',
    '2026-10-27',
    '民事',
    '线上',
    '淘宝',
    `合成导入店铺-${randomUUID()}`,
    '',
    'https://example.com/item',
    '合成商品',
    '0',
    '0',
    '0',
    'http://203.0.113.1/no-image.png',
    '',
    '否',
    '商标权',
    operator,
  ];
  const cells = values
    .map(
      (value, index) =>
        `<c r="${String.fromCharCode(65 + index)}2" t="inlineStr"><is><t>${escape(value)}</t></is></c>`,
    )
    .join('');
  parts['xl/worksheets/sheet1.xml'] = strToU8(
    xml.replace('</sheetData>', `<row r="2">${cells}</row></sheetData>`),
  );
  await page.goto('/leads');
  if (page.url().includes('/login')) {
    await page.getByLabel('用户名').fill(username);
    await page.getByLabel('密码').fill(password);
    await page.getByRole('button', { name: '登录' }).click();
  }
  await page.locator('[data-test="open-csv-import"]').click();
  await page.locator('[data-test="csv-file-input"]').setInputFiles({
    name: '合成线索.xlsx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(zipSync(parts)),
  });
  await expect(page.locator('[data-test="lead-column-mapping"]')).toBeVisible();
  await page.locator('[data-test="lead-confirm-mapping"]').click();
  await expect(page.locator('[data-test="csv-row-2"]')).toContainText(
    '合成商品',
  );
  await expect(page.locator('[data-test="csv-row-2"]')).toContainText(
    '待下载截图',
  );
  await page.locator('[data-test="csv-row-selection"]').check();
  await page.locator('[data-test="csv-confirm-request"]').click();
  await expect(page.getByText(/截图正在后台下载/u)).toBeVisible();
});
