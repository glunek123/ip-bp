import { randomUUID } from 'node:crypto';
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  notaryWorkflowActors,
  readNotaryWorkflowState,
} from '../support/notary-list-workflow-database.mjs';
const photo = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9oADAMBAAIAAwAAABD/AP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8BP//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8BP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8QP//Z',
  'base64',
);
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
const byTest = (page: Page, name: string) =>
  page.locator(`[data-test="${name}"]`);
type Account = { username: string; password: string };
type Matter = { id: string; businessNo: string; version: number };
async function login(page: Page, account: Account, path: string) {
  await page.goto('/login?returnTo=' + encodeURIComponent(path));
  await page.getByLabel('用户名').fill(account.username);
  await page.getByLabel('密码').fill(account.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname + url.search === path);
}
async function logout(page: Page) {
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
}
async function command(
  request: APIRequestContext,
  path: string,
  data: object,
  headers: Record<string, string>,
) {
  const response = await request.post(path, {
    data,
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
  });
  expect(response.status(), `Command failed: ${path}`).toBe(201);
  return response;
}
async function setup(request: APIRequestContext) {
  const actors = await notaryWorkflowActors();
  const headers = { Authorization: `Bearer ${actors.tokenA}` };
  const suffix = randomUUID();
  const client = {
    username: 'nt-list-client-' + suffix,
    password: 'notary list synthetic client password',
  };
  const portal = {
    username: 'nt-list-office-' + suffix,
    password: 'notary list synthetic office password',
  };
  await command(
    request,
    `/api/v1/customers/${actors.admittedCustomer}/client-accounts`,
    { ...client, displayName: '列表验收客户' },
    headers,
  );
  const officeResponse = await command(
    request,
    '/api/v1/notary-offices',
    { name: '列表验收公证处-' + suffix },
    headers,
  );
  const office: { id: string } = await officeResponse.json();
  await command(
    request,
    `/api/v1/notary-offices/${office.id}/accounts`,
    { ...portal, displayName: '列表验收公证员' },
    headers,
  );
  const loginResponse = await request.post('/api/v1/auth/login', {
    headers: {
      Origin: new URL(officeResponse.url()).origin,
    },
    data: client,
  });
  expect(loginResponse.status()).toBe(200);
  const clientSession: { csrfToken: string } = await loginResponse.json();
  const matters: Matter[] = [];
  // The target is created first; 22 newer unique matters keep the original
  // second page valid when a successful command removes the target from a filter.
  for (let index = 0; index < 23; index += 1) {
    const leadResponse = await command(
      request,
      '/api/v1/leads',
      {
        customerId: actors.admittedCustomer,
        rightsHolderId: actors.holder,
        caseType: 'CIVIL',
        infringementTypes: ['TRADEMARK'],
        source: 'ONLINE',
        platform: 'TAOBAO',
        foundAt: '2026-10-15T00:00:00.000Z',
        shopName: `列表合成-${suffix}-${index}`,
        needDisclose: false,
        products: [
          {
            title: '列表验收商品',
            quantity: 1,
            unitPrice: '8.00',
            commentCount: 0,
          },
        ],
        leadScreenshotContentVersionIds: [],
      },
      headers,
    );
    const lead: { id: string } = await leadResponse.json();
    await command(
      request,
      `/api/v1/leads/${lead.id}/push`,
      { expectedVersion: 1 },
      headers,
    );
    await command(
      request,
      `/api/v1/client/leads/${lead.id}/reviews`,
      { result: 'INFRINGEMENT', expectedVersion: 2 },
      { 'X-CSRF-Token': clientSession.csrfToken },
    );
    const leadGet = await request.get(`/api/v1/leads/${lead.id}`, { headers });
    expect(leadGet.status()).toBe(200);
    const detail: { version: number; products: Array<{ id: string }> } =
      await leadGet.json();
    const product = detail.products[0];
    if (!product) throw new Error('Missing real source product');
    const transferred = await command(
      request,
      `/api/v1/leads/${lead.id}/notary-matters`,
      {
        selectedProductIds: [product.id],
        selectedContentVersionIds: [],
        notaryOfficeId: office.id,
        evidenceMode: 'ONLINE_PURCHASE',
        batchPurpose: '原位列表验收',
        expectedVersion: detail.version,
      },
      headers,
    );
    matters.push(await transferred.json());
  }
  const target = matters[0];
  if (!target) throw new Error('Missing target');
  return {
    operator: {
      username: actors.operatorUsername,
      password: actors.operatorPassword,
    },
    portal,
    headers,
    target,
    decoys: matters.slice(1),
  };
}
async function openInternal(
  page: Page,
  id: string,
  stage: string,
  pageNumber = 1,
) {
  const path = `/notary-matters?stage=${stage}&page=${pageNumber}`;
  await page.goto(path);
  const row = byTest(page, 'matter-row').filter({
    has: page.locator(
      `[data-test="matter-link"][href="/notary-matters/${id}"]`,
    ),
  });
  await row.locator('[data-test="matter-action"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  return path;
}
async function openPortal(
  page: Page,
  id: string,
  stage: string,
  pageNumber = 1,
) {
  const path = `/notary-portal/matters?stage=${stage}&page=${pageNumber}`;
  await page.goto(path);
  const row = page.locator('li').filter({
    has: page.locator(
      `[data-test="notary-portal-row"][href="/notary-portal/matters/${id}"]`,
    ),
  });
  await row.locator('[data-test="notary-portal-action"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  return path;
}
async function submit(
  page: Page,
  id: string,
  endpoint: string,
  button: string,
) {
  const receipt = page.waitForResponse(
    (response) =>
      response.url().endsWith(endpoint) &&
      response.request().method() === 'POST',
  );
  await byTest(page, button).click();
  const response = await receipt;
  expect(response.status()).toBe(201);
  const result: { id: string } = await response.json();
  expect(result.id).toBe(id);
  await expect(page.getByRole('dialog')).toBeHidden();
}

for (const decision of ['ISSUE', 'NO_ISSUE', 'NO_INFRINGEMENT'] as const) {
  test(`real internal and portal list forms persist ${decision} without leaving the lists`, async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const fixture = await setup(request);
    const { target, decoys, headers } = fixture;
    await login(
      page,
      fixture.operator,
      '/notary-matters?stage=PENDING_EVIDENCE&page=2',
    );
    const before = await readNotaryWorkflowState(target.id);
    expect(before.stage).toBe('PENDING_EVIDENCE');
    const listPath = await openInternal(page, target.id, 'PENDING_EVIDENCE', 2);
    await page.getByRole('button', { name: '取消／返回列表' }).click();
    expect(await readNotaryWorkflowState(target.id)).toEqual(before);
    await openInternal(page, target.id, 'PENDING_EVIDENCE', 2);
    await byTest(page, 'evidence-date').fill('2026-10-15');
    await byTest(page, 'sample-fee-state').selectOption('PENDING');
    await byTest(page, 'logistics-company-state-0').selectOption('NONE');
    await byTest(page, 'logistics-tracking-state-0').selectOption('NONE');
    await submit(
      page,
      target.id,
      `/notary-matters/${target.id}/evidence`,
      'record-evidence-submit',
    );
    await expect(page).toHaveURL(
      (url) => url.pathname + url.search === listPath,
    );
    expect((await readNotaryWorkflowState(target.id)).stage).toBe(
      'WAITING_UNBOX',
    );
    for (const decoy of decoys)
      await command(
        request,
        `/api/v1/notary-matters/${decoy.id}/evidence`,
        {
          evidenceAt: '2026-10-15',
          sampleFeeState: 'PENDING',
          logistics: [{ companyState: 'NONE', trackingState: 'NONE' }],
          expectedVersion: 1,
        },
        headers,
      );
    await page.reload();
    await expect(page).toHaveURL(
      (url) => url.pathname + url.search === listPath,
    );
    await logout(page);
    const portalPath = '/notary-portal/matters?stage=WAITING_UNBOX&page=2';
    await login(page, fixture.portal, portalPath);
    await openPortal(page, target.id, 'WAITING_UNBOX', 2);
    await byTest(page, 'notary-opening-photo-files').setInputFiles({
      name: 'list-opening.jpg',
      mimeType: 'image/jpeg',
      buffer: photo,
    });
    await expect(
      page.locator('[data-test^="notary-opening-photo-select-"]').first(),
    ).toBeChecked();
    await page.locator('#sender-name').fill('合成寄件人');
    const attempts: Array<{ key: string | undefined; body: string | null }> =
      [];
    const endpoint = `**/api/v1/notary-portal/matters/${target.id}/opening`;
    if (decision === 'ISSUE')
      await page.route(endpoint, async (route) => {
        const outgoing = route.request();
        attempts.push({
          key: outgoing.headers()['idempotency-key'],
          body: outgoing.postData(),
        });
        const result = await route.fetch();
        expect(result.status()).toBe(201);
        if (attempts.length === 1) await route.abort('connectionfailed');
        else await route.fulfill({ response: result });
      });
    if (decision === 'ISSUE') {
      await byTest(page, 'notary-opening-submit').click();
      await expect(byTest(page, 'notary-workflow-retry')).toBeVisible();
      await page.reload();
      await byTest(page, 'notary-resume-request').click();
      await expect(byTest(page, 'notary-workflow-retry')).toBeEnabled();
      await submit(
        page,
        target.id,
        `/notary-portal/matters/${target.id}/opening`,
        'notary-workflow-retry',
      );
      expect(attempts).toHaveLength(2);
      expect(attempts[1]).toEqual(attempts[0]);
      await page.unroute(endpoint);
    } else
      await submit(
        page,
        target.id,
        `/notary-portal/matters/${target.id}/opening`,
        'notary-opening-submit',
      );
    await expect(page).toHaveURL(
      (url) => url.pathname + url.search === portalPath,
    );
    const opened = await readNotaryWorkflowState(target.id);
    expect(opened.stage).toBe('UNBOX_REVIEW');
    expect(opened.opening).toBe(1);
    await logout(page);
    await login(
      page,
      fixture.operator,
      '/notary-matters?stage=UNBOX_REVIEW&page=1',
    );
    await openInternal(page, target.id, 'UNBOX_REVIEW');
    await expect(
      page.locator('[data-test^="opening-review-result"]:checked'),
    ).toHaveCount(0);
    await byTest(
      page,
      decision === 'NO_INFRINGEMENT'
        ? 'opening-review-result-no-infringement'
        : 'opening-review-result',
    ).check();
    if (decision === 'NO_INFRINGEMENT') {
      await expect(byTest(page, 'opening-review-reason')).toBeVisible();
      await byTest(page, 'opening-review-reason').fill('实际核对未发现侵权');
    }
    await submit(
      page,
      target.id,
      `/notary-matters/${target.id}/opening-review`,
      'opening-review-submit',
    );
    if (decision === 'NO_INFRINGEMENT') {
      expect((await readNotaryWorkflowState(target.id)).stage).toBe('ARCHIVED');
      return;
    }
    await openInternal(page, target.id, 'ISSUANCE_DECISION');
    await expect(
      page.locator('[data-test^="issuance-decision-"]:checked'),
    ).toHaveCount(0);
    await byTest(
      page,
      decision === 'ISSUE'
        ? 'issuance-decision-issue'
        : 'issuance-decision-no-issue',
    ).check();
    await submit(
      page,
      target.id,
      `/notary-matters/${target.id}/issuance-decision`,
      'issuance-decision-submit',
    );
    if (decision === 'NO_ISSUE') {
      await openInternal(page, target.id, 'WAITING_RETURN');
      await byTest(page, 'return-archive-return').check();
      await expect(byTest(page, 'return-freight-fields')).toBeVisible();
      await byTest(page, 'return-archive-keep').check();
      await expect(byTest(page, 'return-freight-fields')).toBeHidden();
      await byTest(page, 'return-archive-reason').fill(
        '收到商品后保留，不退款',
      );
      await submit(
        page,
        target.id,
        `/notary-matters/${target.id}/return-archive`,
        'return-archive-submit',
      );
    } else {
      await logout(page);
      await login(
        page,
        fixture.portal,
        '/notary-portal/matters?stage=WAITING_CERTIFICATE&page=1',
      );
      await openPortal(page, target.id, 'WAITING_CERTIFICATE');
      await byTest(page, 'certificate-number').fill(
        '列表合成证书-' + randomUUID(),
      );
      await byTest(page, 'certificate-date').fill('2026-10-15');
      await byTest(page, 'certificate-file-input').setInputFiles({
        name: 'list-certificate.pdf',
        mimeType: 'application/pdf',
        buffer: pdf,
      });
      await expect(byTest(page, 'certificate-submit')).toBeEnabled();
      await submit(
        page,
        target.id,
        `/notary-portal/matters/${target.id}/certificate`,
        'certificate-submit',
      );
    }
    await page.reload();
    await logout(page);
    await login(
      page,
      fixture.operator,
      '/notary-matters?stage=ARCHIVED&page=1',
    );
    const final = await readNotaryWorkflowState(target.id);
    expect(final.stage).toBe('ARCHIVED');
    expect(final.evidence).toBe(1);
    expect(final.opening).toBe(1);
    expect(final.reviews).toBe(1);
    expect(final.certificates).toBe(decision === 'ISSUE' ? 1 : 0);
  });
}
