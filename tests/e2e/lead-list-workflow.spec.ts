import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  coreLeadFixtures,
  countLeadPushReceipts,
  countLeadPushAudits,
  countNotaryHandoffReceipts,
  countNotaryHandoffAudits,
  disconnectCoreLeadTestDatabase,
} from '../support/core-lead-database.mjs';

// The runner supplies the existing synthetic coreLeadFixtures in its isolated instance.
// This file only appends UUID-named facts through public APIs. It does not seed, reset,
// clear, change grants or remove fixtures, and must never target the persistent preview.
const headers = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const byTest = (page: Page, name: string) =>
  page.locator(`[data-test="${name}"]`);
type Lead = {
  id: string;
  businessNo: string;
  status: string;
  version: number;
  shopName: string;
  products: Array<{ id: string }>;
  leadScreenshotContentVersionIds: string[];
  pendingWithdrawalApplication: null | { id: string; reason: string };
  evidenceDecision: null | { result: string; reason: string };
};
type Upload = { reservedOwnerId: string; contentVersionId: string };
async function readLead(request: APIRequestContext, id: string): Promise<Lead> {
  const response = await request.get(`/api/v1/leads/${id}`, { headers });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}
async function createLead(
  request: APIRequestContext,
  upload?: Upload,
): Promise<Lead> {
  const suffix = randomUUID();
  const response = await request.post('/api/v1/leads', {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: {
      customerId: coreLeadFixtures.admittedCustomer,
      rightsHolderId: coreLeadFixtures.holder,
      caseType: 'CIVIL',
      infringementTypes: ['TRADEMARK'],
      source: 'ONLINE',
      platform: 'TAOBAO',
      foundAt: '2026-10-15T02:30:00.000Z',
      shopName: `L-list-${suffix}`,
      needDisclose: false,
      products: [
        {
          title: `Product-${suffix}`,
          quantity: 1,
          unitPrice: '3.50',
          commentCount: 0,
        },
      ],
      leadScreenshotContentVersionIds: upload ? [upload.contentVersionId] : [],
      ...(upload ? { reservedLeadId: upload.reservedOwnerId } : {}),
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}
async function createClient(request: APIRequestContext) {
  const account = {
    username: `l-list-client-${randomUUID().slice(0, 12)}`,
    password: 'L isolated client password',
  };
  const response = await request.post(
    `/api/v1/customers/${coreLeadFixtures.admittedCustomer}/client-accounts`,
    {
      headers,
      data: { ...account, displayName: 'L列表合成客户' },
    },
  );
  expect(response.status(), await response.text()).toBe(201);
  return account;
}
async function clientLogin(
  request: APIRequestContext,
  account: { username: string; password: string },
  origin: string,
) {
  const response = await request.post('/api/v1/auth/login', {
    headers: { Origin: origin },
    data: account,
  });
  expect(response.status(), await response.text()).toBe(200);
  const session: { csrfToken: string; principalType: string } =
    await response.json();
  expect(session.principalType).toBe('CLIENT');
  return session.csrfToken;
}
async function operatorLogin(page: Page, path: string) {
  await page.goto(`/login?returnTo=${encodeURIComponent(path)}`);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`${path.split('?')[0]}(?:\\?|$)`, 'u'),
  );
  await expect(
    page.getByRole('heading', { name: '线索库', exact: true }),
  ).toBeVisible();
}
async function relogin(page: Page, path: string) {
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(/\/login/u);
  await operatorLogin(page, path);
}
async function reviewedLead(
  request: APIRequestContext,
  lead: Lead,
  csrf: string,
  result: 'INFRINGEMENT' | 'NO_INFRINGEMENT' = 'INFRINGEMENT',
) {
  const pushed = await request.post(`/api/v1/leads/${lead.id}/push`, {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: { expectedVersion: lead.version },
  });
  expect(pushed.status(), await pushed.text()).toBe(201);
  const reviewed = await request.post(
    `/api/v1/client/leads/${lead.id}/reviews`,
    {
      headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': randomUUID() },
      data: {
        result,
        expectedVersion: lead.version + 1,
        ...(result === 'NO_INFRINGEMENT'
          ? { reason: '合成客户误判用于撤回验收' }
          : {}),
      },
    },
  );
  expect(reviewed.status(), await reviewed.text()).toBe(201);
}
async function uploadScreenshot(request: APIRequestContext): Promise<Upload> {
  const draft = await request.post('/api/v1/materials/upload-drafts', {
    headers,
    data: {
      ownerType: 'LEAD_DRAFT',
      category: 'LEAD_SCREENSHOT',
      purpose: 'LEAD_SCREENSHOT',
      originalFilename: `L-list-${randomUUID()}.png`,
      declaredMimeType: 'image/png',
    },
  });
  expect(draft.status(), await draft.text()).toBe(201);
  const created: { id: string } = await draft.json();
  const content = await request.put(
    `/api/v1/materials/upload-drafts/${created.id}/content`,
    {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKz8AAAAASUVORK5CYII=',
        'base64',
      ),
    },
  );
  expect(content.status(), await content.text()).toBe(200);
  return content.json();
}
async function pageTwo(request: APIRequestContext, status: string) {
  const response = await request.get(
    `/api/v1/leads?page=2&pageSize=20&status=${status}&view=LIBRARY`,
    { headers },
  );
  expect(response.status(), await response.text()).toBe(200);
  const list: { items: Lead[]; total: number } = await response.json();
  return list;
}
function row(page: Page, businessNo: string) {
  return byTest(page, 'lead-row').filter({ hasText: businessNo });
}
test.afterAll(disconnectCoreLeadTestDatabase);

test('page-two edit does not advance; cancel and history are safe; a lost push response retries the exact original request after refresh', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await createClient(request);
  const created: Lead[] = [];
  for (let index = 0; index < 22; index++)
    created.push(await createLead(request));
  const ids = new Set(created.map((lead) => lead.id));
  const candidates = (await pageTwo(request, 'WAITING_PUSH')).items.filter(
    (lead) => ids.has(lead.id),
  );
  expect(candidates.length).toBeGreaterThanOrEqual(2);
  const editTarget = candidates[0]!,
    pushTarget = candidates[1]!;
  const path = '/leads?page=2&status=WAITING_PUSH';
  await operatorLogin(page, '/leads?page=1&status=WAITING_PUSH');
  await byTest(page, 'next-page').click();
  await expect(row(page, pushTarget.businessNo)).toBeVisible();
  const attempts: Array<{
    body: unknown;
    key: string | undefined;
    status: number;
  }> = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const endpoint = `**/api/v1/leads/${pushTarget.id}/push`;
  await page.route(endpoint, async (route) => {
    const outgoing = route.request(),
      response = await route.fetch();
    attempts.push({
      body: outgoing.postDataJSON() as unknown,
      key: outgoing.headers()['idempotency-key'],
      status: response.status(),
    });
    if (attempts.length === 1) {
      await held;
      await route.abort('connectionfailed');
    } else await route.fulfill({ response });
  });
  await row(page, pushTarget.businessNo)
    .getByRole('button', { name: '推送给客户审核', exact: true })
    .click();
  await page
    .getByRole('button', { name: '取消／返回列表', exact: true })
    .click();
  expect(attempts).toHaveLength(0);
  await page.goBack();
  await expect(page).toHaveURL(/page=1&status=WAITING_PUSH/u);
  await page.goForward();
  await expect(page).toHaveURL(/page=2&status=WAITING_PUSH/u);
  await row(page, editTarget.businessNo)
    .getByRole('button', { name: '推送给客户审核', exact: true })
    .click();
  await byTest(page, 'quick-edit-lead').click();
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe(path);
  await page
    .locator('[name="shopName"]')
    .fill(`${editTarget.businessNo}-saved`);
  const editResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/leads/${editTarget.id}`) &&
      response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  expect((await editResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/leads\?page=2&status=WAITING_PUSH$/u);
  expect(await readLead(request, editTarget.id)).toMatchObject({
    status: 'WAITING_PUSH',
    version: editTarget.version + 1,
    shopName: `${editTarget.businessNo}-saved`,
  });
  await row(page, pushTarget.businessNo)
    .getByRole('button', { name: '推送给客户审核', exact: true })
    .click();
  await byTest(page, 'submit-lead-workflow').dblclick();
  try {
    await expect.poll(() => attempts.length).toBe(1);
    expect(attempts[0]).toMatchObject({
      body: { expectedVersion: pushTarget.version },
      key: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      status: 201,
    });
  } finally {
    release();
  }
  await expect(byTest(page, 'retry-unknown-lead')).toBeEnabled();
  await expect(
    page.getByRole('button', { name: '取消／返回列表', exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(byTest(page, 'retry-unknown-lead')).toBeEnabled();
  await expect(row(page, pushTarget.businessNo)).toHaveCount(0);
  await byTest(page, 'retry-unknown-lead').click();
  await expect(byTest(page, 'lead-workflow-form')).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await expect(page).toHaveURL(/\/leads\?page=2&status=WAITING_PUSH$/u);
  expect(await readLead(request, pushTarget.id)).toMatchObject({
    status: 'WAITING_REVIEW',
    version: pushTarget.version + 1,
  });
  expect(await countLeadPushReceipts(pushTarget.id)).toBe(1);
  expect(await countLeadPushAudits(pushTarget.id)).toBe(1);
  const foreign = await request.get(`/api/v1/leads/${pushTarget.id}`, {
    headers: { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
  });
  expect(foreign.status()).toBe(404);
  await page.unroute(endpoint);
  await relogin(page, path);
  await expect(row(page, pushTarget.businessNo)).toHaveCount(0);
  expect(await readLead(request, editTarget.id)).toMatchObject({
    status: 'WAITING_PUSH',
    shopName: `${editTarget.businessNo}-saved`,
  });
});

test('page-two transfer and no-evidence branches submit real forms, recover exact transfer material/body/key and retain facts after relogin', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(240_000);
  if (!baseURL) throw new Error('The isolated runner must provide baseURL');
  const client = await createClient(request);
  const csrf = await clientLogin(request, client, new URL(baseURL).origin);
  const screenshot = await uploadScreenshot(request);
  const created: Lead[] = [];
  for (let index = 0; index < 22; index++) {
    const lead = await createLead(
      request,
      index === 0 ? screenshot : undefined,
    );
    await reviewedLead(request, lead, csrf);
    created.push(lead);
  }
  const transfer = created[0]!,
    archive = created[1]!;
  const secondPage = await pageTwo(request, 'WAITING_EVIDENCE_DECISION');
  expect(secondPage.items.map((lead) => lead.id)).toEqual(
    expect.arrayContaining([transfer.id, archive.id]),
  );
  const officeResponse = await request.post('/api/v1/notary-offices', {
    headers,
    data: { name: `L-list-office-${randomUUID()}` },
  });
  expect(officeResponse.status(), await officeResponse.text()).toBe(201);
  const office: { id: string } = await officeResponse.json();
  const path = '/leads?page=2&status=WAITING_EVIDENCE_DECISION';
  await operatorLogin(page, path);
  await row(page, transfer.businessNo)
    .getByRole('button', { name: '确认取证安排', exact: true })
    .click();
  await expect(byTest(page, 'choose-transfer')).not.toBeChecked();
  await expect(byTest(page, 'choose-no-evidence')).not.toBeChecked();
  await expect(byTest(page, 'submit-lead-workflow')).toBeDisabled();
  await byTest(page, 'choose-transfer').check();
  await expect(byTest(page, 'submit-lead-workflow')).toBeDisabled();
  const current = await readLead(request, transfer.id);
  await byTest(page, `select-product-${current.products[0]!.id}`).check();
  await byTest(page, `select-evidence-${screenshot.contentVersionId}`).check();
  await byTest(page, 'notary-office').selectOption(office.id);
  await byTest(page, 'batch-purpose').fill('L真实列表取证批次');
  const endpoint = `**/api/v1/leads/${transfer.id}/notary-matters`;
  const attempts: Array<{
    body: unknown;
    key: string | undefined;
    status: number;
  }> = [];
  let matterId = '';
  await page.route(endpoint, async (route) => {
    const response = await route.fetch();
    const result: { id: string } = await response.json();
    matterId = result.id;
    attempts.push({
      body: route.request().postDataJSON() as unknown,
      key: route.request().headers()['idempotency-key'],
      status: response.status(),
    });
    if (attempts.length === 1) await route.abort('connectionfailed');
    else await route.fulfill({ response });
  });
  await byTest(page, 'submit-lead-workflow').click();
  await expect(byTest(page, 'retry-unknown-lead')).toBeEnabled();
  await page.reload();
  await expect(byTest(page, 'retry-unknown-lead')).toBeEnabled();
  await byTest(page, 'retry-unknown-lead').click();
  await expect(byTest(page, 'lead-workflow-form')).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[0]).toMatchObject({
    status: 201,
    body: {
      selectedProductIds: [current.products[0]!.id],
      selectedContentVersionIds: [screenshot.contentVersionId],
      notaryOfficeId: office.id,
      evidenceMode: 'ONLINE_PURCHASE',
      batchPurpose: 'L真实列表取证批次',
      expectedVersion: current.version,
    },
  });
  expect(await countNotaryHandoffReceipts(transfer.id)).toBe(1);
  expect(await countNotaryHandoffAudits(transfer.id)).toBe(1);
  await expect(row(page, transfer.businessNo)).toHaveCount(0);
  await expect(page).toHaveURL(/page=2&status=WAITING_EVIDENCE_DECISION/u);
  await row(page, archive.businessNo)
    .getByRole('button', { name: '确认取证安排', exact: true })
    .click();
  await byTest(page, 'choose-no-evidence').check();
  await expect(byTest(page, 'submit-lead-workflow')).toBeDisabled();
  await byTest(page, 'no-evidence-reason').fill('L真实列表不取证');
  const archived = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/leads/${archive.id}/evidence-decisions`) &&
      response.request().method() === 'POST',
  );
  await byTest(page, 'submit-lead-workflow').click();
  expect((await archived).status()).toBe(201);
  await expect(byTest(page, 'lead-workflow-form')).toHaveCount(0);
  await expect(row(page, archive.businessNo)).toHaveCount(0);
  expect(await readLead(request, archive.id)).toMatchObject({
    status: 'ARCHIVED',
    evidenceDecision: { result: 'NO_EVIDENCE', reason: 'L真实列表不取证' },
  });
  await page.unroute(endpoint);
  await relogin(page, '/leads?status=ARCHIVED');
  expect(await readLead(request, transfer.id)).toMatchObject({
    status: 'TRANSFERRED_TO_NOTARY',
    version: current.version + 1,
  });
  const matter = await request.get(`/api/v1/notary-matters/${matterId}`, {
    headers,
  });
  expect(matter.status(), await matter.text()).toBe(200);
  expect(await matter.json()).toMatchObject({
    id: matterId,
    leadId: transfer.id,
    stage: 'PENDING_EVIDENCE',
  });
  await page.reload();
  await expect(row(page, archive.businessNo)).toBeVisible();
});

test('withdrawal application stays archived and persists its exact reason after refresh and relogin', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(120_000);
  if (!baseURL) throw new Error('The isolated runner must provide baseURL');
  const client = await createClient(request),
    lead = await createLead(request);
  const csrf = await clientLogin(request, client, new URL(baseURL).origin);
  await reviewedLead(request, lead, csrf, 'NO_INFRINGEMENT');
  await operatorLogin(page, '/leads?status=ARCHIVED');
  await row(page, lead.businessNo)
    .getByRole('button', { name: '申请撤回归档', exact: true })
    .click();
  await expect(byTest(page, 'submit-lead-workflow')).toBeDisabled();
  await byTest(page, 'withdrawal-reason').fill('L列表撤回误判');
  const response = page.waitForResponse(
    (item) =>
      item.url().endsWith(`/leads/${lead.id}/withdrawal-applications`) &&
      item.request().method() === 'POST',
  );
  await byTest(page, 'submit-lead-workflow').click();
  expect((await response).status()).toBe(201);
  await expect(byTest(page, 'lead-workflow-form')).toHaveCount(0);
  expect(await readLead(request, lead.id)).toMatchObject({
    status: 'ARCHIVED',
    version: lead.version + 3,
    pendingWithdrawalApplication: { reason: 'L列表撤回误判' },
  });
  await page.reload();
  await relogin(page, '/leads?status=ARCHIVED');
  await expect(row(page, lead.businessNo)).toBeVisible();
  await row(page, lead.businessNo)
    .getByRole('button', { name: '申请撤回归档', exact: true })
    .click();
  await expect(byTest(page, 'submit-lead-workflow')).toHaveCount(0);
  await expect(byTest(page, 'lead-workflow-form')).toContainText(
    '当前账号没有可办理的下一步',
  );
  expect(await readLead(request, lead.id)).toMatchObject({
    status: 'ARCHIVED',
    pendingWithdrawalApplication: { reason: 'L列表撤回误判' },
  });
});
