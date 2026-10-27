import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  expect,
  test,
  type APIResponse,
  type Page,
  type Response,
} from '@playwright/test';
import {
  prepareV6CustomerPermissionsUi,
  readV6ArchivedSettlementFacts,
  readV6CustomerPermissionFacts,
  selectV6ArchivedSettlementCase,
} from '../support/v6-customer-permissions-ui.mjs';

const output = resolve(process.cwd(), '.local/v6-followups-20261026/ui');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGO4o6HxX2Panf8MIALEAQBSpgmJplS0fgAAAABJRU5ErkJggg==',
  'base64',
);

async function body<T>(
  response: APIResponse | Response,
  status: number,
): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()) as T;
}

async function capture(page: Page, name: string) {
  for (const [device, width, height] of [
    ['desktop', 1440, 1000],
    ['mobile', 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(async () => {
      await document.fonts.ready;
      window.scrollTo(0, 0);
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });
    await page.screenshot({
      path: resolve(output, `${name}-${device}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test('v6 synthetic same-department admission and create-only account use real HTTP', async ({
  page,
  playwright,
}) => {
  test.setTimeout(120_000);
  const fixture = await prepareV6CustomerPermissionsUi();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await mkdir(output, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/customers');
  await page.getByLabel('用户名').fill(fixture.operatorUsername);
  await page.getByLabel('密码').fill(fixture.operatorPassword);
  const login = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/auth/login') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '登录', exact: true }).click();
  const session = await body<{ csrfToken: string }>(await login, 200);
  const headers = {
    Origin: new URL(page.url()).origin,
    'X-CSRF-Token': session.csrfToken,
  };

  const creationContext = await body<{
    operators: Array<{ id: string }>;
  }>(await page.request.get('/api/v1/customers/creation-context'), 200);
  expect(creationContext.operators.map((person) => person.id)).toContain(
    fixture.selfUserId,
  );
  const name = `V6 同部门代办客户 ${randomUUID().slice(0, 8)}`;
  const created = await body<{ id: string; version: number }>(
    await page.request.post('/api/v1/customers', {
      headers,
      data: {
        name,
        responsibleUserId: fixture.selfUserId,
        admissionContactName: '合成准入联系人',
        admissionContactPhone: '13800000000',
      },
    }),
    201,
  );
  const draft = await body<{
    id: string;
    version: number;
    profileStatus: string;
    responsibleUserId: string;
    departmentId: string;
  }>(await page.request.get(`/api/v1/customers/${created.id}`), 200);
  expect(draft).toMatchObject({
    id: created.id,
    profileStatus: 'draft',
    responsibleUserId: fixture.selfUserId,
    departmentId: fixture.departmentId,
  });
  expect(draft.responsibleUserId).not.toBe(fixture.operatorUserId);
  expect(draft.version).toBe(created.version);

  const identityDraft = {
    ownerType: 'CUSTOMER',
    category: 'CUSTOMER_IDENTITY',
    purpose: 'IDENTITY_FULL',
    originalFilename: 'V6-合成同部门身份证明.png',
    declaredMimeType: 'image/png',
  };
  const denied = await page.request.post('/api/v1/materials/upload-drafts', {
    headers,
    data: { ...identityDraft, ownerId: fixture.foreignCustomerId },
  });
  expect(denied.status(), await denied.text()).toBe(404);
  const upload = await body<{ id: string; ownerId: string }>(
    await page.request.post('/api/v1/materials/upload-drafts', {
      headers,
      data: { ...identityDraft, ownerId: created.id },
    }),
    201,
  );
  expect(upload.ownerId).toBe(created.id);
  const version = await body<{
    materialId: string;
    contentVersionId: string;
  }>(
    await page.request.put(
      `/api/v1/materials/upload-drafts/${upload.id}/content`,
      {
        headers: { ...headers, 'Content-Type': 'application/octet-stream' },
        data: png,
      },
    ),
    200,
  );
  expect(version.materialId).toBeTruthy();
  expect(version.contentVersionId).toBeTruthy();
  const admission = await body<{
    id: string;
    version: number;
    profileStatus: string;
    responsibleUserId: string;
  }>(
    await page.request.post(`/api/v1/customers/${created.id}/admission`, {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      data: {
        expectedVersion: draft.version,
        customerType: 'ENTERPRISE',
        name,
        identityType: 'BUSINESS_LICENSE',
        identityNumber: `V6-ADMIT-${randomUUID().slice(0, 8)}`,
        identityValidityMode: 'LONG_TERM',
        admissionContactName: '合成准入联系人',
        admissionContactPhone: '13800000000',
        identityDocumentContentVersionIds: [version.contentVersionId],
      },
    }),
    201,
  );
  expect(admission).toMatchObject({
    id: created.id,
    version: draft.version + 1,
    profileStatus: 'admitted',
    responsibleUserId: fixture.selfUserId,
  });
  const admitted = await body<{
    profileStatus: string;
    version: number;
    responsibleUserId: string;
  }>(await page.request.get(`/api/v1/customers/${created.id}`), 200);
  expect(admitted).toMatchObject({
    profileStatus: 'admitted',
    version: admission.version,
    responsibleUserId: fixture.selfUserId,
  });
  const download = await page.request.get(
    `/api/v1/materials/${version.materialId}/versions/${version.contentVersionId}/content`,
  );
  expect(download.status(), await download.text()).toBe(200);
  expect(Buffer.from(await download.body())).toEqual(png);
  await page.goto(`/customers/${created.id}`);
  await expect(
    page.locator('#customer-profile').getByText('已准入'),
  ).toBeVisible();
  await capture(page, 'customer-same-department-admitted');

  const selfApi = await playwright.request.newContext({
    baseURL: 'http://127.0.0.1:5174',
  });
  try {
    const selfSession = await body<{ csrfToken: string }>(
      await selfApi.post('/api/v1/auth/login', {
        headers: { Origin: 'http://127.0.0.1:5174' },
        data: {
          username: fixture.selfUsername,
          password: fixture.selfPassword,
        },
      }),
      200,
    );
    const selfHeaders = {
      Origin: 'http://127.0.0.1:5174',
      'X-CSRF-Token': selfSession.csrfToken,
    };
    const account = await body<{
      id: string;
      bindingActive: boolean;
      accountActive: boolean;
      bindingVersion: number;
    }>(
      await selfApi.post(
        `/api/v1/customers/${fixture.selfCustomerId}/client-accounts`,
        {
          headers: selfHeaders,
          data: {
            displayName: 'V6 合成只建账号',
            username: `v6-create-only-${randomUUID().slice(0, 8)}`,
            password: 'synthetic correct horse battery',
          },
        },
      ),
      201,
    );
    expect(account).toMatchObject({
      bindingActive: true,
      accountActive: true,
      bindingVersion: 1,
    });
    const list = await selfApi.get(
      `/api/v1/customers/${fixture.selfCustomerId}/client-accounts`,
    );
    expect(list.status(), await list.text()).toBe(403);
    const status = await selfApi.patch(
      `/api/v1/customers/${fixture.selfCustomerId}/client-accounts/${account.id}/status`,
      { headers: selfHeaders, data: { active: false } },
    );
    expect(status.status(), await status.text()).toBe(403);
    const facts = await readV6CustomerPermissionFacts(
      created.id,
      account.id,
      version.contentVersionId,
    );
    expect(facts.customer).toMatchObject({
      department_id: fixture.departmentId,
      responsible_user_id: fixture.selfUserId,
      profile_status: 'ADMITTED',
      version: admission.version,
    });
    expect(facts.reference).toEqual([
      {
        material_id: version.materialId,
        content_version_id: version.contentVersionId,
        purpose: 'IDENTITY_FULL',
      },
    ]);
    expect(facts.account).toEqual([
      {
        binding_active: true,
        binding_version: 1,
        account_active: true,
      },
    ]);
  } finally {
    await selfApi.dispose();
  }

  await page.goto('/settlements');
  await page.getByRole('tab', { name: '客户结算' }).click();
  await expect(page.getByText('当前条件下暂无结算明细')).toBeVisible();
  await capture(page, 'settlement-customer-empty');
  await page.getByRole('tab', { name: '律师结算' }).click();
  await expect(page.getByText('当前条件下暂无结算明细')).toBeVisible();
  await capture(page, 'settlement-lawyer-empty');

  const settlementCase = await selectV6ArchivedSettlementCase();
  const beforeSettlement = await readV6ArchivedSettlementFacts(
    settlementCase.id,
  );
  expect(beforeSettlement.archive).toEqual({
    case_id: settlementCase.id,
    business_no: settlementCase.business_no,
    stage: 'ARCHIVED',
    version: 2,
    archive_id: settlementCase.archive_id,
    from_version: 1,
    to_version: 2,
  });
  expect(beforeSettlement.closureCount).toBe(0);
  expect(beforeSettlement.terms).toEqual([]);
  expect(beforeSettlement.launches).toEqual([]);
  expect(beforeSettlement.audits).toEqual([]);
  const settlementUrl = `/api/v1/settlements/cases/${settlementCase.id}`;
  const initialSettlement = await body<{
    stage: string;
    termsVersion: number;
    amountSource: {
      rootId: string | null;
      state: string;
      amount: string | null;
    };
    figures: { basis: string | null; customerAmount: string | null };
    launches: unknown[];
  }>(await page.request.get(settlementUrl), 200);
  expect(initialSettlement).toMatchObject({
    stage: 'ARCHIVED',
    termsVersion: 0,
    amountSource: { rootId: null, state: 'UNRECORDED', amount: null },
    figures: { basis: null, customerAmount: null },
    launches: [],
  });

  const customerFormula = '结案金额*70%';
  const formulaTerms = await body<{ caseId: string; termsVersion: number }>(
    await page.request.put(`${settlementUrl}/terms`, {
      headers,
      data: {
        idempotencyKey: randomUUID(),
        expectedTermsVersion: 0,
        side: 'CUSTOMER',
        customerFormula,
        manualAmount: null,
      },
    }),
    200,
  );
  expect(formulaTerms).toEqual({ caseId: settlementCase.id, termsVersion: 1 });
  const unknownAmount = await body<{
    termsVersion: number;
    figures: {
      basis: string | null;
      customerAmount: string | null;
      customerSource: string;
    };
  }>(await page.request.get(settlementUrl), 200);
  expect(unknownAmount).toMatchObject({
    termsVersion: 1,
    figures: { basis: null, customerAmount: null, customerSource: 'AUTOMATIC' },
  });
  const unknownLaunch = await page.request.post(`${settlementUrl}/launches`, {
    headers,
    data: {
      side: 'CUSTOMER',
      amount: '20.00',
      launchDate: '2026-10-26',
      expectedTermsVersion: 1,
      idempotencyKey: randomUUID(),
    },
  });
  expect(unknownLaunch.status(), await unknownLaunch.text()).toBe(400);
  expect((await unknownLaunch.json()) as { code: string }).toMatchObject({
    code: 'UNKNOWN_SETTLEMENT_AMOUNT',
  });
  const afterUnknown = await readV6ArchivedSettlementFacts(settlementCase.id);
  expect(afterUnknown.archive).toEqual(beforeSettlement.archive);
  expect(afterUnknown.closureCount).toBe(0);
  expect(afterUnknown.launches).toEqual([]);
  expect(afterUnknown.audits).toEqual([
    { action: 'settlement.terms.updated', count: 1 },
  ]);

  const manualTerms = await body<{ caseId: string; termsVersion: number }>(
    await page.request.put(`${settlementUrl}/terms`, {
      headers,
      data: {
        idempotencyKey: randomUUID(),
        expectedTermsVersion: 1,
        side: 'CUSTOMER',
        customerFormula,
        manualAmount: '20.00',
      },
    }),
    200,
  );
  expect(manualTerms).toEqual({ caseId: settlementCase.id, termsVersion: 2 });
  const manualDetail = await body<{
    termsVersion: number;
    amountSource: {
      rootId: string | null;
      state: string;
      amount: string | null;
    };
    terms: { customerFormula: string; customerManualAmount: string };
    figures: {
      basis: string | null;
      customerAmount: string;
      customerSource: string;
    };
    customerBalance: { remaining: string | null };
  }>(await page.request.get(settlementUrl), 200);
  expect(manualDetail).toMatchObject({
    termsVersion: 2,
    amountSource: { rootId: null, state: 'UNRECORDED', amount: null },
    terms: { customerFormula, customerManualAmount: '20.00' },
    figures: { basis: null, customerAmount: '20.00', customerSource: 'MANUAL' },
    customerBalance: { remaining: '20.00' },
  });
  const launchInput = {
    side: 'CUSTOMER',
    amount: '20.00',
    launchDate: '2026-10-26',
    expectedTermsVersion: 2,
    idempotencyKey: randomUUID(),
  };
  const launched = await body<{ id: string; nth: number; amount: string }>(
    await page.request.post(`${settlementUrl}/launches`, {
      headers,
      data: launchInput,
    }),
    201,
  );
  expect(launched).toMatchObject({ nth: 1, amount: '20.00' });
  expect(
    await body(
      await page.request.post(`${settlementUrl}/launches`, {
        headers,
        data: launchInput,
      }),
      201,
    ),
  ).toEqual(launched);
  const overdrawn = await page.request.post(`${settlementUrl}/launches`, {
    headers,
    data: { ...launchInput, amount: '1.00', idempotencyKey: randomUUID() },
  });
  expect(overdrawn.status(), await overdrawn.text()).toBe(409);
  expect((await overdrawn.json()) as { code: string }).toMatchObject({
    code: 'SETTLEMENT_CHANGED',
  });
  const filledDetail = await body<{
    launches: Array<{ id: string; billId: string | null }>;
    customerBalance: { remaining: string | null };
  }>(await page.request.get(settlementUrl), 200);
  expect(filledDetail.launches).toHaveLength(1);
  expect(filledDetail.launches[0]).toMatchObject({
    id: launched.id,
    billId: null,
  });
  expect(filledDetail.customerBalance.remaining).toBe('0.00');
  const afterSettlement = await readV6ArchivedSettlementFacts(
    settlementCase.id,
  );
  expect(afterSettlement.archive).toEqual(beforeSettlement.archive);
  expect(afterSettlement.closureCount).toBe(0);
  expect(afterSettlement.terms).toEqual([
    {
      version: 2,
      customer_formula: customerFormula,
      customer_manual_amount: '20.00',
      lawyer_manual_amount: null,
    },
  ]);
  expect(afterSettlement.launches).toEqual([
    {
      id: launched.id,
      side: 'CUSTOMER',
      nth: 1,
      amount: '20.00',
      bill_id: null,
      actor_user_id: fixture.operatorUserId,
    },
  ]);
  expect(afterSettlement.audits).toEqual([
    { action: 'settlement.launch.created', count: 1 },
    { action: 'settlement.terms.updated', count: 2 },
  ]);
  await page.goto('/settlements');
  await expect(page.getByRole('tab', { name: '客户结算' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const filledRow = page
    .getByRole('row')
    .filter({ hasText: settlementCase.business_no });
  await expect(filledRow).toBeVisible();
  await expect(filledRow).toContainText('20.00');
  await expect(filledRow).toContainText('未入单');
  await expect(filledRow.locator('td').nth(8)).toHaveText('—');
  await expect(filledRow.locator('td').nth(9)).toHaveText('—');
  await capture(page, 'settlement-customer-filled');

  await page.getByRole('tab', { name: '费用中心' }).click();
  await expect(page.getByRole('heading', { name: '费用中心' })).toBeVisible();
  await capture(page, 'settlement-fees-current');
  const evidenceList = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === '/api/v1/evidence',
  );
  await page.goto('/evidence');
  const evidencePage = await body<{ total: number }>(await evidenceList, 200);
  expect(evidencePage.total).toBe(0);
  await expect(page.getByRole('heading', { name: '证物管理' })).toBeVisible();
  await expect(page.getByText('共 0 件证物')).toBeVisible();
  await expect(
    page.getByText('没有匹配的证物，请调整筛选条件。'),
  ).toBeVisible();
  await expect(page.getByText('正在加载证物…')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await capture(page, 'evidence-read-only');
  expect(pageErrors).toEqual([]);
});
