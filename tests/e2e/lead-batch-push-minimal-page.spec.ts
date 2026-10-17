import { expect, test } from '@playwright/test';
import {
  createMinimalPageAcceptance,
  createMinimalPageRequestBudget,
} from '../support/minimal-page-acceptance.mjs';

type CreatedLead = { id: string; businessNo: string };

function localDateTimeInput(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

async function selectDictionaryValue(
  page: import('@playwright/test').Page,
  name: string,
  value: string,
): Promise<void> {
  const field = page.locator(`select[name="${name}"]`);
  await expect(field).toHaveCount(1);
  const option = field.locator(`option[value="${value}"]`);
  if ((await option.count()) !== 1)
    throw new Error(
      `Required live form dictionary value is missing: ${name}=${value}`,
    );
  await field.selectOption(value);
}

async function openLeadStatusFilter(
  page: import('@playwright/test').Page,
): Promise<void> {
  const expand = page.locator('[data-test="lead-expand"]');
  if ((await expand.getAttribute('aria-expanded')) !== 'true')
    await expand.click();
  await page
    .locator('[data-test="lead-counter"]')
    .filter({ hasText: '线索待审核' })
    .click();
}

async function createThroughPage(
  page: import('@playwright/test').Page,
  fixture: { customerId: string; rightsHolderId: string },
  runId: string,
  index: number,
): Promise<CreatedLead> {
  await expect(
    page.getByRole('heading', { name: '新建线索', exact: true }),
  ).toBeVisible();
  const shop = `minimal-page:${runId}:${index}`;
  const product = `${runId}-product-${index}`;

  await selectDictionaryValue(page, 'customerId', fixture.customerId);
  await selectDictionaryValue(page, 'rightsHolderId', fixture.rightsHolderId);
  await selectDictionaryValue(page, 'caseType', 'CIVIL');
  await selectDictionaryValue(page, 'source', 'ONLINE');
  await selectDictionaryValue(page, 'platform', 'TAOBAO');
  await page
    .locator('input[name="infringementTypes"][value="TRADEMARK"]')
    .check();
  await expect(
    page.locator('input[name="infringementTypes"]:checked'),
  ).toHaveCount(1);
  await page
    .locator('input[name="foundAt"]')
    .fill(localDateTimeInput(new Date()));
  await page.locator('input[name="shopName"]').fill(shop);
  await page.locator('input[name="productTitle-0"]').fill(product);
  await page.locator('input[name="productUrl-0"]').fill('');
  await page.locator('input[name="quantity-0"]').fill('1');
  await page.locator('input[name="unitPrice-0"]').fill('1.00');
  await page.locator('input[name="commentCount-0"]').fill('0');
  await page.locator('input[name="needDisclose"][value="false"]').check();
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
  await expect(page.locator('input[type="file"]')).toHaveValue('');

  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/leads') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '创建线索', exact: true }).click();
  const response = await createdResponse;
  expect(response.status()).toBe(201);
  const body: unknown = await response.json();
  if (
    body === null ||
    typeof body !== 'object' ||
    !('id' in body) ||
    typeof body.id !== 'string' ||
    !('businessNo' in body) ||
    typeof body.businessNo !== 'string'
  )
    throw new Error(
      'Lead create response did not include its actual ID and number',
    );
  await expect(page).toHaveURL(new RegExp(`/leads/${body.id}$`, 'u'));
  await expect(page.locator('[data-test="lead-facts"]')).toContainText(shop);
  return { id: body.id, businessNo: body.businessNo };
}

test('creates two leads in the page and pushes exactly those two in one batch', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const testInfo = test.info();
  const support = createMinimalPageAcceptance('LEAD_BATCH', {
    window: testInfo.config.metadata.minimalPageWindow,
  });
  const budget = createMinimalPageRequestBudget('LEAD_BATCH');
  const runtime = await support.prepare();
  const runId = runtime.runId;
  const created: CreatedLead[] = [];
  const businessRequests: Array<{
    method: string;
    path: string;
    idempotencyKey: string | undefined;
    bodyBase64: string | null;
    delivery: 'continued' | 'blocked_before_dispatch';
    responseStatus: number | null;
  }> = [];
  const requestRecords = new Map<
    import('@playwright/test').Request,
    (typeof businessRequests)[number]
  >();
  let budgetViolation = '';
  let loggedIn = false;
  let flowCompleted = false;
  let primaryFailure: unknown;
  let cleanupFailure: unknown;

  try {
    budget.setRunId(runId, runtime.actor.username);
    await support.beforeLogin();
    page.on('response', (response) => {
      const record = requestRecords.get(response.request());
      if (record) record.responseStatus = response.status();
    });
    await page.context().route('**/api/v1/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      let businessRequest: (typeof businessRequests)[number] | undefined;
      if (
        request.method() === 'POST' &&
        (path === '/api/v1/leads' || path === '/api/v1/leads/batch-push')
      ) {
        businessRequest = {
          method: request.method(),
          path,
          idempotencyKey: request.headers()['idempotency-key'],
          bodyBase64: request.postDataBuffer()?.toString('base64') ?? null,
          delivery: 'blocked_before_dispatch',
          responseStatus: null,
        };
        businessRequests.push(businessRequest);
        requestRecords.set(request, businessRequest);
      }
      try {
        budget.admit(
          request.method(),
          request.url(),
          request.postData() ?? undefined,
        );
      } catch (error) {
        budgetViolation =
          error instanceof Error ? error.message : String(error);
        await route.abort('blockedbyclient');
        return;
      }
      if (businessRequest) businessRequest.delivery = 'continued';
      await route.continue();
    });
    await page.goto('/login');
    await page.getByLabel('用户名').fill(runtime.actor.username);
    await page.getByLabel('密码').fill(runtime.actor.password);
    const loginResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/auth/login') &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '登录', exact: true }).click();
    expect((await loginResponse).status()).toBe(200);
    loggedIn = true;
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find(
      (cookie) => cookie.name === 'dev_cor_session',
    );
    if (!sessionCookie)
      throw new Error('Authenticated HttpOnly session cookie is unavailable');
    await support.bindSession(sessionCookie.value);
    await expect(page.locator('[data-test="app-sidebar"]')).toBeVisible();

    await page.locator('[data-test="lead-nav"]').click();
    await expect(page).toHaveURL(/\/leads(?:\?|$)/u);
    await page.locator('[data-test="create-lead"]').click();
    created.push(await createThroughPage(page, runtime.fixture, runId, 1));

    await page.locator('[data-test="lead-nav"]').click();
    await expect(page.locator('[data-test="create-lead"]')).toBeVisible();
    await page.locator('[data-test="create-lead"]').click();
    created.push(await createThroughPage(page, runtime.fixture, runId, 2));
    expect(new Set(created.map(({ id }) => id)).size).toBe(2);
    await support.registerLeads(created.map(({ id }) => id));
    budget.setLeads(created.map(({ id }) => id));

    await page.locator('[data-test="lead-nav"]').click();
    const rows = page.locator('[data-test="lead-row"]');
    for (const lead of created) {
      const row = rows.filter({ hasText: lead.businessNo });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('待推送');
      await row
        .getByRole('checkbox', { name: `选择 ${lead.businessNo}` })
        .check();
    }
    await expect(rows.locator('input[type="checkbox"]:checked')).toHaveCount(2);
    await page.locator('[data-test="open-batch-push"]').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('[data-test="batch-count"]')).toContainText(
      '2',
    );
    await expect(dialog.locator('[data-test="customer-group"]')).toHaveCount(1);
    await expect(dialog.locator('[data-test="customer-group"]')).toContainText(
      '2',
    );
    const batchResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/leads/batch-push') &&
        response.request().method() === 'POST',
    );
    await dialog.locator('[data-test="batch-submit"]').click();
    expect((await batchResponse).status()).toBe(201);
    await expect(dialog).toHaveCount(0);

    await openLeadStatusFilter(page);
    for (const lead of created) {
      const row = page
        .locator('[data-test="lead-row"]')
        .filter({ hasText: lead.businessNo });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('待审核');
      await row
        .getByRole('link', { name: `查看线索 ${lead.businessNo} 详情` })
        .click();
      await expect(page.locator('.page-head .pill')).toHaveText('线索待审核');
      await expect(page.locator('.lead-record-meta')).toContainText('版本 2');
      await page.locator('[data-test="refresh"]').click();
      await expect(page.locator('.page-head .pill')).toHaveText('线索待审核');
      await expect(page.locator('.lead-record-meta')).toContainText('版本 2');
      await page.locator('a.back-link[href="/leads"]').click();
      await openLeadStatusFilter(page);
    }
    await support.verifyLeadResult(created.map(({ id }) => id));
    flowCompleted = true;
  } catch (error) {
    primaryFailure = error;
  } finally {
    if (loggedIn) {
      try {
        const sessionClose = await support.closeSession(async () => {
          const logoutResponse = page.waitForResponse(
            (response) =>
              response.url().endsWith('/api/v1/auth/logout') &&
              response.request().method() === 'POST',
          );
          await page.locator('[data-test="logout"]').click();
          expect((await logoutResponse).status()).toBe(204);
          await expect(page).toHaveURL(/\/login(?:\?|$)/u);
          await expect(page.getByLabel('用户名')).toBeVisible();
        });
        if (flowCompleted && !primaryFailure) {
          expect(sessionClose.logoutSucceeded).toBe(true);
          expect(sessionClose.fallback).toBe(false);
          expect(sessionClose.revoked).toBe(true);
        }
      } catch (error) {
        cleanupFailure = error;
      }
    }
    if (flowCompleted && !primaryFailure && !cleanupFailure) {
      try {
        expect(budgetViolation).toBe('');
        budget.assertComplete();
      } catch (error) {
        cleanupFailure = error;
      }
    }
    try {
      await support.dispose();
    } catch (error) {
      cleanupFailure ??= error;
    }
    if (primaryFailure || cleanupFailure || !flowCompleted) {
      try {
        await testInfo.attach('actual-lead-business-requests.json', {
          body: Buffer.from(
            JSON.stringify(
              {
                actualCounts: budget.counts(),
                budgetViolation,
                businessRequests,
              },
              null,
              2,
            ),
          ),
          contentType: 'application/json',
        });
      } catch (error) {
        cleanupFailure ??= error;
      }
    }
  }
  if (primaryFailure && cleanupFailure)
    throw new AggregateError(
      [primaryFailure, cleanupFailure],
      'Lead page flow failed and session cleanup also failed',
    );
  if (primaryFailure) throw primaryFailure;
  if (cleanupFailure) throw cleanupFailure;
});
