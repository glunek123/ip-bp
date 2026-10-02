import { randomUUID } from 'node:crypto';
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
import {
  batchAuditCount,
  batchMatterState,
  batchReceiptCount,
  disconnectBatchDatabase,
} from '../support/notary-return-archive-batch-database.mjs';

const internalHeaders = {
  Authorization: `Bearer ${coreLeadFixtures.tokenA}`,
};
const openingPhoto = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9oADAMBAAIAAwAAABD/AP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8BP//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8BP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8QP//Z',
  'base64',
);

function dataTest(page: Page, name: string) {
  return page.locator(`[data-test="${name}"]`);
}

async function login(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/(customers|client\/leads)$/u);
}

async function createClientAccount(request: APIRequestContext) {
  const username = `nt010-client-${randomUUID().slice(0, 8)}`;
  const password = 'nt010 real client password';
  const response = await request.post(
    `/api/v1/customers/${coreLeadFixtures.admittedCustomer}/client-accounts`,
    {
      headers: internalHeaders,
      data: { displayName: '批量归档验收客户', username, password },
    },
  );
  expect(response.status(), await response.text()).toBe(201);
  return { username, password };
}

async function loginApi(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<string> {
  const response = await request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://127.0.0.1:5174' },
    data: { username, password },
  });
  expect(response.status(), await response.text()).toBe(200);
  const session: { principalType: string; csrfToken: string } =
    await response.json();
  expect(session.principalType).toBe('CLIENT');
  return session.csrfToken;
}

async function createWaitingReturnMatterThroughApi(
  request: APIRequestContext,
  clientCsrf: string,
  sampleFeeAmount: string,
  issuance: 'ISSUE' | 'NO_ISSUE' = 'NO_ISSUE',
): Promise<string> {
  const officeResponse = await request.post('/api/v1/notary-offices', {
    headers: internalHeaders,
    data: { name: `NT010浏览器验收-${randomUUID().slice(0, 8)}` },
  });
  expect(officeResponse.status(), await officeResponse.text()).toBe(201);
  const office: { id: string } = await officeResponse.json();
  const leadResponse = await request.post('/api/v1/leads', {
    headers: { ...internalHeaders, 'Idempotency-Key': randomUUID() },
    data: {
      customerId: coreLeadFixtures.admittedCustomer,
      rightsHolderId: coreLeadFixtures.holder,
      caseType: 'CIVIL',
      infringementTypes: ['TRADEMARK'],
      source: 'ONLINE',
      platform: 'TAOBAO',
      foundAt: '2026-09-24T02:30:00.000Z',
      shopName: `NT010浏览器商品-${randomUUID().slice(0, 8)}`,
      needDisclose: false,
      products: [
        {
          title: '真实批量归档商品',
          quantity: 1,
          unitPrice: '8.00',
          commentCount: 0,
        },
      ],
      leadScreenshotContentVersionIds: [],
    },
  });
  expect(leadResponse.status(), await leadResponse.text()).toBe(201);
  const lead: { id: string } = await leadResponse.json();
  const pushed = await request.post(`/api/v1/leads/${lead.id}/push`, {
    headers: { ...internalHeaders, 'Idempotency-Key': randomUUID() },
    data: { expectedVersion: 1 },
  });
  expect(pushed.status(), await pushed.text()).toBe(201);
  const reviewed = await request.post(
    `/api/v1/client/leads/${lead.id}/reviews`,
    {
      headers: { 'X-CSRF-Token': clientCsrf, 'Idempotency-Key': randomUUID() },
      data: { result: 'INFRINGEMENT', expectedVersion: 2 },
    },
  );
  expect(reviewed.status(), await reviewed.text()).toBe(201);
  const leadStateResponse = await request.get(`/api/v1/leads/${lead.id}`, {
    headers: internalHeaders,
  });
  expect(leadStateResponse.status(), await leadStateResponse.text()).toBe(200);
  const leadState: { products: Array<{ id: string }>; version: number } =
    await leadStateResponse.json();
  const transferred = await request.post(
    `/api/v1/leads/${lead.id}/notary-matters`,
    {
      headers: { ...internalHeaders, 'Idempotency-Key': randomUUID() },
      data: {
        selectedProductIds: [leadState.products[0]!.id],
        selectedContentVersionIds: [],
        notaryOfficeId: office.id,
        evidenceMode: 'ONLINE_PURCHASE',
        batchPurpose: 'NT-010真实浏览器批量归档',
        expectedVersion: leadState.version,
      },
    },
  );
  expect(transferred.status(), await transferred.text()).toBe(201);
  const matter: { id: string } = await transferred.json();
  const evidence = await request.post(
    `/api/v1/notary-matters/${matter.id}/evidence`,
    {
      headers: { ...internalHeaders, 'Idempotency-Key': randomUUID() },
      data: {
        evidenceAt: '2026-09-24',
        sampleFeeState: 'KNOWN',
        sampleFeeAmount,
        logistics: [{ companyState: 'NONE', trackingState: 'NONE' }],
        expectedVersion: 1,
      },
    },
  );
  expect(evidence.status(), await evidence.text()).toBe(201);
  const photoDraft = await request.post('/api/v1/materials/upload-drafts', {
    headers: internalHeaders,
    data: {
      ownerType: 'NOTARY_MATTER',
      ownerId: matter.id,
      category: 'NOTARY_OPENING_PHOTO',
      purpose: 'NOTARY_OPENING_PHOTO',
      originalFilename: 'nt010-real-opening.jpg',
      declaredMimeType: 'image/jpeg',
    },
  });
  expect(photoDraft.status(), await photoDraft.text()).toBe(201);
  const draft: { id: string } = await photoDraft.json();
  const photoUpload = await request.put(
    `/api/v1/materials/upload-drafts/${draft.id}/content`,
    {
      headers: {
        ...internalHeaders,
        'Content-Type': 'application/octet-stream',
      },
      data: openingPhoto,
    },
  );
  expect(photoUpload.status(), await photoUpload.text()).toBe(200);
  const photo: { contentVersionId: string } = await photoUpload.json();
  const opening = await request.post(
    `/api/v1/notary-matters/${matter.id}/opening`,
    {
      headers: { ...internalHeaders, 'Idempotency-Key': randomUUID() },
      data: { contentVersionIds: [photo.contentVersionId], expectedVersion: 2 },
    },
  );
  expect(opening.status(), await opening.text()).toBe(201);
  const openingReview = await request.post(
    `/api/v1/notary-matters/${matter.id}/opening-review`,
    {
      headers: { ...internalHeaders, 'Idempotency-Key': randomUUID() },
      data: { result: 'INFRINGEMENT', expectedVersion: 3 },
    },
  );
  expect(openingReview.status(), await openingReview.text()).toBe(201);
  const decision = await request.post(
    `/api/v1/notary-matters/${matter.id}/issuance-decision`,
    {
      headers: { ...internalHeaders, 'Idempotency-Key': randomUUID() },
      data: { decision: issuance, expectedVersion: 4 },
    },
  );
  expect(decision.status(), await decision.text()).toBe(201);
  return matter.id;
}

async function openBatchPanel(page: Page, matterIds: string[]): Promise<void> {
  for (const id of matterIds) {
    const row = dataTest(page, 'matter-row').filter({
      has: page.locator(
        `[data-test="matter-link"][href="/notary-matters/${id}"]`,
      ),
    });
    await row.locator('[data-test="select-matter"]').check();
  }
  await dataTest(page, 'batch-archive-open').click();
  await expect(page.getByText('正在读取事项详情。')).toBeHidden();
}

test.beforeEach(async () => {
  await resetCoreLeadE2eData();
});

test.afterAll(async () => {
  await disconnectBatchDatabase();
  await disconnectCoreLeadTestDatabase();
});

test('real operator archives separate facts and customer sees only the allowed result after re-login', async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const client = await createClientAccount(request);
  const clientCsrf = await loginApi(request, client.username, client.password);
  const firstMatterId = await createWaitingReturnMatterThroughApi(
    request,
    clientCsrf,
    '100.00',
  );
  const secondMatterId = await createWaitingReturnMatterThroughApi(
    request,
    clientCsrf,
    '200.00',
  );
  await login(
    page,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await page.goto('/notary-matters?stage=WAITING_RETURN');
  await openBatchPanel(page, [firstMatterId, secondMatterId]);

  await dataTest(page, `choice-${firstMatterId}`).selectOption('RETURN');
  await dataTest(page, `refund-state-${firstMatterId}`).selectOption('KNOWN');
  await dataTest(page, `refund-amount-${firstMatterId}`).fill('65.50');
  await page
    .locator(`[data-test="refund-party-${firstMatterId}"]`)
    .selectOption('MERCHANT');
  await page
    .locator(`[data-test="freight-state-${firstMatterId}"]`)
    .selectOption('KNOWN');
  await dataTest(page, `freight-amount-${firstMatterId}`).fill('12.00');
  await page
    .locator(`[data-test="freight-party-${firstMatterId}"]`)
    .selectOption('OTHER');
  await page
    .locator(`[data-test="freight-party-name-${firstMatterId}"]`)
    .fill('快递公司');
  await dataTest(page, `reason-${firstMatterId}`).fill('退回样品并据实登记');

  await page
    .locator(`[data-test="choice-${secondMatterId}"]`)
    .selectOption('REFUND_ONLY');
  await page
    .locator(`[data-test="refund-state-${secondMatterId}"]`)
    .selectOption('PENDING');
  await dataTest(page, `reason-${secondMatterId}`).fill('协商退款金额待定');
  await expect(dataTest(page, 'batch-submit')).toBeEnabled();
  await dataTest(page, 'batch-submit').click();

  await expect(page.getByText('「待退货」暂无记录')).toBeVisible();
  expect(await batchMatterState(firstMatterId)).toMatchObject({
    matter: { stage: 'ARCHIVED', version: 6 },
    archives: 1,
    audits: 1,
    evidence: { sampleFeeState: 'KNOWN' },
  });
  const firstState = await batchMatterState(firstMatterId);
  expect(firstState.evidence?.sampleFeeAmount?.toString()).toBe('100');
  expect(
    firstState.amounts
      .map((amount) => ({
        kind: amount.kind,
        state: amount.state,
        amount: amount.amount?.toString() ?? null,
        partyKind: amount.partyKind,
        partyName: amount.partyName,
      }))
      .sort((left, right) => left.kind.localeCompare(right.kind)),
  ).toEqual(
    [
      {
        kind: 'FREIGHT',
        state: 'KNOWN',
        amount: '12',
        partyKind: 'OTHER',
        partyName: '快递公司',
      },
      {
        kind: 'REFUND',
        state: 'KNOWN',
        amount: '65.5',
        partyKind: 'MERCHANT',
        partyName: null,
      },
    ].sort((left, right) => left.kind.localeCompare(right.kind)),
  );
  const secondState = await batchMatterState(secondMatterId);
  expect(secondState).toMatchObject({
    matter: { stage: 'ARCHIVED', version: 6 },
    archives: 1,
    audits: 1,
  });
  expect(secondState.evidence?.sampleFeeAmount?.toString()).toBe('200');
  expect(secondState.amounts).toMatchObject([
    {
      kind: 'REFUND',
      state: 'PENDING',
      amount: null,
      partyKind: null,
      partyName: null,
    },
  ]);
  expect(await batchReceiptCount()).toBe(1);
  expect(await batchAuditCount()).toBe(1);

  const operatorContext = await browser.newContext();
  const returningOperator = await operatorContext.newPage();
  await login(
    returningOperator,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await returningOperator.goto(`/notary-matters/${firstMatterId}`);
  await expect(
    returningOperator.locator('[data-test="return-archive-record"]'),
  ).toContainText('65.50');
  await returningOperator.goto(`/notary-matters/${secondMatterId}`);
  await expect(
    returningOperator.locator('[data-test="return-archive-record"]'),
  ).toContainText('待定');
  await operatorContext.close();

  const clientContext = await browser.newContext();
  const clientPage = await clientContext.newPage();
  await login(clientPage, client.username, client.password);
  await clientPage.goto(`/client/notary-matters/${firstMatterId}`);
  await expect(
    clientPage.locator('[data-test="client-return-archive-record"]'),
  ).toContainText('退货并退款');
  await expect(
    clientPage.locator('[data-test="client-return-archive-record"]'),
  ).toContainText('退回样品并据实登记');
  await expect(
    clientPage.locator('[data-test="client-return-archive-record"]'),
  ).not.toContainText('65.50');
  await expect(clientPage.getByText('100.00')).toHaveCount(0);
  const csrfToken = await clientPage.evaluate(async () => {
    const response = await fetch('/api/v1/auth/session', {
      credentials: 'same-origin',
    });
    const session = (await response.json()) as { csrfToken: string };
    return session.csrfToken;
  });
  const forbidden = await clientPage.request.post(
    '/api/v1/notary-matters/return-archive-batches',
    {
      headers: { 'X-CSRF-Token': csrfToken, 'Idempotency-Key': randomUUID() },
      data: {
        items: [
          {
            matterId: firstMatterId,
            returnChoice: 'KEEP',
            archiveReason: '客户不得操作内部归档',
            expectedVersion: 6,
          },
        ],
      },
    },
  );
  expect(forbidden.status()).toBe(403);
  expect((await batchMatterState(firstMatterId)).archives).toBe(1);
  await clientContext.close();
});

test('an ineligible selected matter blocks the whole page workflow without database changes', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const client = await createClientAccount(request);
  const clientCsrf = await loginApi(request, client.username, client.password);
  const eligibleId = await createWaitingReturnMatterThroughApi(
    request,
    clientCsrf,
    '100.00',
  );
  const wrongStageId = await createWaitingReturnMatterThroughApi(
    request,
    clientCsrf,
    '200.00',
    'ISSUE',
  );
  await login(
    page,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await page.goto('/notary-matters');
  await openBatchPanel(page, [eligibleId, wrongStageId]);
  await expect(
    page.getByText(
      '至少一项已不是可归档状态或当前账号无权归档，请重新读取事项。',
    ),
  ).toBeVisible();
  await expect(dataTest(page, 'batch-submit')).toHaveCount(0);
  expect(await batchMatterState(eligibleId)).toMatchObject({
    matter: { stage: 'WAITING_RETURN', version: 5 },
    archives: 0,
    amounts: [],
    audits: 0,
  });
  expect(await batchMatterState(wrongStageId)).toMatchObject({
    matter: { stage: 'WAITING_CERTIFICATE', version: 5 },
    archives: 0,
    amounts: [],
    audits: 0,
  });
  expect(await batchReceiptCount()).toBe(0);
  expect(await batchAuditCount()).toBe(0);
});
