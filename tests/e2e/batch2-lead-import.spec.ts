import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  assertAttachedLeadImage,
  seedBatch2LeadImportFixture,
  syntheticImageUrl,
} from '../support/batch2-lead-import-fixture.mjs';
import {
  assertDistinctOperatorReceipt,
  assertRetriedImageTaskIdentity,
} from '../support/batch2-lead-operator-receipt.mjs';

const origin = 'http://127.0.0.1:5174';
const backend = createRequire(resolve(process.cwd(), 'backend/package.json'));
const { unzipSync, zipSync, strToU8 } = backend('fflate') as {
  unzipSync: (bytes: Uint8Array) => Record<string, Uint8Array>;
  zipSync: (files: Record<string, Uint8Array>) => Uint8Array;
  strToU8: (value: string) => Uint8Array;
};
let fixture: Awaited<ReturnType<typeof seedBatch2LeadImportFixture>>;

test.setTimeout(180_000);
test.beforeAll(async ({ browserName }, testInfo) => {
  void browserName;
  const expected = resolve(
    process.cwd(),
    'tests/support/batch2-lead-import.config.ts',
  );
  if (
    !testInfo.config.configFile ||
    resolve(testInfo.config.configFile) !== expected
  )
    throw new Error('Batch-2 import requires its controlled Playwright config');
  fixture = await seedBatch2LeadImportFixture();
});

async function login(
  api: APIRequestContext,
  actor: { username: string; password: string },
) {
  const response = await api.post('/api/v1/auth/login', {
    headers: { Origin: origin },
    data: { username: actor.username, password: actor.password },
  });
  expect(response.status(), await response.text()).toBe(200);
  const session = (await response.json()) as {
    csrfToken: string;
    principalType: string;
  };
  expect(session.principalType).toBe('INTERNAL');
  const restored = await api.get('/api/v1/auth/session');
  expect(restored.status(), await restored.text()).toBe(200);
  return { 'X-CSRF-Token': session.csrfToken };
}

function importBody(ownerName: string, shopName: string, remoteUrls: string[]) {
  const products = Array.from(
    { length: Math.max(1, remoteUrls.length) },
    (_, index) => ({
      title: `合成商品${index + 1}`,
      url: `https://example.com/product-${index + 1}`,
      quantity: 0,
      unitPrice: '0',
      commentCount: 0,
    }),
  );
  return {
    items: [
      {
        rowNumber: 2,
        operatorText: ownerName,
        remoteScreenshots: remoteUrls.map((url, index) => ({
          productNumber: index + 1,
          sourceGroupNumber: index + 1,
          urls: [url],
        })),
        input: {
          customerId: fixture.customerId,
          rightsHolderId: fixture.holderId,
          caseType: 'CIVIL',
          infringementTypes: ['TRADEMARK'],
          source: 'ONLINE',
          platform: 'TAOBAO',
          foundAt: '2026-10-27T00:00:00.000Z',
          shopName,
          needDisclose: false,
          products,
          leadScreenshotContentVersionIds: [],
        },
      },
    ],
  };
}

async function imageTasks(api: APIRequestContext, leadId: string) {
  const response = await api.get(`/api/v1/leads/${leadId}/image-imports`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as Array<{
    id: string;
    rowNumber: number;
    productNumber: number;
    productId: string;
    url: string;
    status: string;
    failureCode: string | null;
    contentVersionId: string | null;
  }>;
}

test('XLSX preview, exact replay, blocked image, real private attachment and A-to-B retry', async ({
  playwright,
}) => {
  const a = await playwright.request.newContext({ baseURL: origin });
  const b = await playwright.request.newContext({ baseURL: origin });
  const other = await playwright.request.newContext({ baseURL: origin });
  try {
    const aHeaders = await login(a, fixture.actors.a);
    const bHeaders = await login(b, fixture.actors.b);
    await login(other, fixture.actors.other);
    const template = await a.get('/api/v1/leads/xlsx-template');
    expect(template.status(), await template.text()).toBe(200);
    const parts = unzipSync(new Uint8Array(await template.body()));
    const xml = new TextDecoder().decode(parts['xl/worksheets/sheet1.xml']);
    const row =
      '<row r="2"><c r="A2" t="inlineStr"><is><t>合成客户</t></is></c><c r="J2" t="inlineStr"><is><t>https://example.com/p</t></is></c></row>';
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      xml.replace('</sheetData>', `${row}</sheetData>`),
    );
    const preview = await a.post('/api/v1/leads/xlsx-preview', {
      headers: {
        ...aHeaders,
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
    const blocked = 'http://203.0.113.1/no-image.png';
    const body = importBody(fixture.actors.a.displayName, `导入店铺-${key}`, [
      blocked,
      syntheticImageUrl,
    ]);
    const send = () =>
      a.post('/api/v1/leads/csv-import', {
        headers: { ...aHeaders, 'Idempotency-Key': key },
        data: body,
      });
    const created = await send();
    expect(created.status(), await created.text()).toBe(201);
    const lead = (await created.json()).items[0].lead as {
      id: string;
      businessNo: string;
      products: Array<{ id: string }>;
    };
    expect(lead.businessNo).toMatch(/^\d{3,}\d{8}\d{3,}$/u);
    expect(lead.products).toHaveLength(2);
    const replay = await send();
    expect(replay.status(), await replay.text()).toBe(201);
    expect((await replay.json()).items[0].lead.id).toBe(lead.id);
    await expect
      .poll(
        async () => (await imageTasks(a, lead.id)).map((task) => task.status),
        {
          timeout: 30_000,
        },
      )
      .toEqual(['FAILED', 'ATTACHED']);
    const tasks = await imageTasks(a, lead.id);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      rowNumber: 2,
      productNumber: 1,
      productId: lead.products[0]?.id,
      url: blocked,
      failureCode: 'BLOCKED_ADDRESS',
    });
    expect(tasks[1]).toMatchObject({
      rowNumber: 2,
      productNumber: 2,
      productId: lead.products[1]?.id,
      url: syntheticImageUrl,
      status: 'ATTACHED',
    });
    const original = await assertAttachedLeadImage({
      taskId: tasks[1]!.id,
      leadId: lead.id,
      productId: lead.products[1]!.id,
      productNumber: 2,
      departmentId: fixture.departmentId,
    });
    expect(tasks[1]?.contentVersionId).toBe(original.contentVersionId);
    const forbidden = await other.get(`/api/v1/leads/${lead.id}/image-imports`);
    expect([403, 404]).toContain(forbidden.status());
    const retained = await a.get(`/api/v1/leads/${lead.id}`);
    expect(retained.status(), await retained.text()).toBe(200);
    expect((await retained.json()).products[1].id).toBe(lead.products[1]?.id);
    const retried = await b.post(
      `/api/v1/leads/${lead.id}/image-imports/${tasks[0]!.id}/retry`,
      {
        headers: bHeaders,
        data: { url: 'http://203.0.113.2/no-image.png' },
      },
    );
    expect(retried.status(), await retried.text()).toBe(201);
    await expect
      .poll(async () => (await imageTasks(a, lead.id))[0]?.status, {
        timeout: 30_000,
      })
      .toBe('FAILED');
    await assertRetriedImageTaskIdentity({
      taskId: tasks[0]!.id,
      originalActorId: fixture.actors.a.id,
      retryActorId: fixture.actors.b.id,
    });
    expect(
      await assertAttachedLeadImage({
        taskId: tasks[1]!.id,
        leadId: lead.id,
        productId: lead.products[1]!.id,
        productNumber: 2,
        departmentId: fixture.departmentId,
      }),
    ).toEqual(original);
  } finally {
    await Promise.all([a.dispose(), b.dispose(), other.dispose()]);
  }
});

test('SELF cannot choose another owner; DEPARTMENT persists the owner and team', async ({
  playwright,
}) => {
  const self = await playwright.request.newContext({ baseURL: origin });
  const department = await playwright.request.newContext({ baseURL: origin });
  try {
    const selfHeaders = await login(self, fixture.actors.self);
    const departmentHeaders = await login(department, fixture.actors.a);
    const body = importBody(
      fixture.actors.owner.displayName,
      `异人运营-${randomUUID()}`,
      [],
    );
    const denied = await self.post('/api/v1/leads/csv-import', {
      headers: { ...selfHeaders, 'Idempotency-Key': randomUUID() },
      data: body,
    });
    expect(denied.status(), await denied.text()).toBe(409);
    expect((await denied.json()).details.failures[0]).toMatchObject({
      rowNumber: 2,
      code: 'OPERATOR_NOT_AUTHORIZED',
    });
    const key = randomUUID();
    const send = () =>
      department.post('/api/v1/leads/csv-import', {
        headers: { ...departmentHeaders, 'Idempotency-Key': key },
        data: body,
      });
    const created = await send();
    expect(created.status(), await created.text()).toBe(201);
    const lead = (await created.json()).items[0].lead as {
      id: string;
      responsibleUserId: string;
      teamId: string;
    };
    expect(lead).toMatchObject({
      responsibleUserId: fixture.actors.owner.id,
      teamId: fixture.teamId,
    });
    await assertDistinctOperatorReceipt({
      leadId: lead.id,
      key,
      actorId: fixture.actors.a.id,
      ownerId: fixture.actors.owner.id,
      teamId: fixture.teamId,
    });
    const replay = await send();
    expect(replay.status(), await replay.text()).toBe(201);
    expect((await replay.json()).items[0].lead.id).toBe(lead.id);
  } finally {
    await Promise.all([self.dispose(), department.dispose()]);
  }
});

test('operator maps and previews the 19-column workbook in the import panel', async ({
  page,
  playwright,
}) => {
  const api = await playwright.request.newContext({ baseURL: origin });
  try {
    await login(api, fixture.actors.a);
    const template = await api.get('/api/v1/leads/xlsx-template');
    expect(template.status(), await template.text()).toBe(200);
    const parts = unzipSync(new Uint8Array(await template.body()));
    const xml = new TextDecoder().decode(parts['xl/worksheets/sheet1.xml']);
    const escape = (value: string) =>
      value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
    const values = [
      fixture.customerName,
      fixture.holderName,
      '',
      '2026-10-27',
      '民事',
      '线上',
      '淘宝',
      `界面导入-${randomUUID()}`,
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
      fixture.actors.a.displayName,
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
    await page.getByLabel('用户名').fill(fixture.actors.a.username);
    await page.getByLabel('密码').fill(fixture.actors.a.password);
    await page.getByRole('button', { name: '登录' }).click();
    await page.locator('[data-test="open-csv-import"]').click();
    await page.locator('[data-test="csv-file-input"]').setInputFiles({
      name: '合成线索.xlsx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(zipSync(parts)),
    });
    await expect(
      page.locator('[data-test="lead-column-mapping"]'),
    ).toBeVisible();
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
  } finally {
    await api.dispose();
  }
});
