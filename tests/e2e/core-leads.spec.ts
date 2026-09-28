import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  allowInjectedFailures,
  coreLeadFixtures,
  countAdmissionReceipts,
  countLeadReceipts,
  countLeadPushAudits,
  countLeadPushReceipts,
  countLeadEvidenceDecisions,
  countLeadEvidenceReceipts,
  countLeadEvidenceAudits,
  countNotaryMatters,
  countNotaryHandoffReceipts,
  countNotaryHandoffAudits,
  countNotaryEvidence,
  countNotaryLogistics,
  countNotaryEvidenceReceipts,
  countNotaryEvidenceAudits,
  countNotaryOpenings,
  countNotaryOpeningReceipts,
  countNotaryOpeningAudits,
  countNotaryOpeningReferences,
  countNotaryOpeningReviewDecisions,
  countNotaryOpeningReviewAudits,
  countNotaryOpeningReviewReceipts,
  countNotaryIssuanceDecisions,
  countNotaryIssuanceAudits,
  countNotaryIssuanceReceipts,
  countNotaryCertificates,
  countNotaryCertificateAudits,
  countNotaryCertificateReceipts,
  countCasesForMatter,
  countCertificateMaterialReferences,
  getNotaryCertificate,
  getNotaryCase,
  rejectNotaryCertificateCaseWrites,
  rejectNotaryCertificateReceiptWrites,
  countLeadReviewDecisions,
  countLeadWithdrawalApplications,
  countLeadWithdrawalAudits,
  countLeadWithdrawalConfirmations,
  countClientLeadReviewReceipts,
  countLeads,
  countStoredFiles,
  databaseCounts,
  disconnectCoreLeadTestDatabase,
  getCustomer,
  getLead,
  getNotaryOpeningReviewMatter,
  forgeSameMatterOpeningPhotoReference,
  removeNotaryOpeningReviewPhotoReferences,
  getLeadEvidenceDecision,
  getLeadReviewDecision,
  getLeadReviewDecisions,
  getLeadWithdrawalApplication,
  getMaterialAuditActions,
  getMaterialLifecycle,
  getMaterialByVersion,
  installMaterialStatusBarrier,
  installNotaryUploadInsertBarrier,
  markContentVersion,
  rejectAuditWrites,
  rejectLeadPushReceiptWrites,
  rejectLeadEvidenceDecisionWrites,
  rejectLeadEvidenceReceiptWrites,
  rejectNotaryHandoffReceiptWrites,
  rejectNotaryEvidenceWrites,
  rejectNotaryEvidenceReceiptWrites,
  rejectNotaryOpeningWrites,
  rejectNotaryOpeningReferenceWrites,
  rejectNotaryOpeningReviewDecisionWrites,
  rejectNotaryOpeningReviewAuditWrites,
  rejectNotaryOpeningReviewReceiptWrites,
  rejectNotaryIssuanceAuditWrites,
  rejectLeadReviewDecisionWrites,
  rejectClientLeadReviewReceiptWrites,
  rejectWithdrawalApplicationWrites,
  rejectWithdrawalConfirmationWrites,
  rejectLeadProductWrites,
  rejectMaterialMetadataWrites,
  resetCoreLeadE2eData,
  removeLeadProducts,
  setClientAccountActive,
  setClientBindingActive,
  setClientUserActive,
  setNotaryBindingActive,
  setCustomerStatus,
  setGrant,
  setTeamActive,
  setLeadCounter,
  setMaterialDeletedAt,
  startMaterialCleanup,
  verifyCoreLeadMigration,
} from '../support/core-lead-database.mjs';

const authorizationA = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const authorizationSelf = {
  Authorization: `Bearer ${coreLeadFixtures.tokenSelf}`,
};
const pdfBytes = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n',
);
const jpegBytes = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46,
]);
const secondOpeningPhotoBytes = Buffer.concat([
  jpegBytes,
  Buffer.from([
    0x43, 0x4f, 0x52, 0x45, 0x2d, 0x4e, 0x54, 0x2d, 0x30, 0x30, 0x33,
  ]),
]);

async function configureBrowser(page: Page) {
  await page.context().setExtraHTTPHeaders(authorizationA);
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        principalType: 'INTERNAL',
        user: {
          id: coreLeadFixtures.userA,
          displayName: '核心主管',
          username: 'core-lead-user-a',
        },
        department: { id: coreLeadFixtures.departmentA, name: 'CORE 知产部' },
        departments: [
          { id: coreLeadFixtures.departmentA, name: 'CORE 知产部' },
        ],
        customer: null,
        notaryOffice: null,
        authorizationRevision: 1,
        expiresAt: '2099-01-01T00:00:00.000Z',
        csrfToken: '',
      }),
    }),
  );
}

type Uploaded = {
  materialId: string;
  contentVersionId: string;
  reservedOwnerId?: string;
};

async function upload(
  request: APIRequestContext,
  input: {
    ownerType: 'CUSTOMER' | 'LEAD_DRAFT' | 'NOTARY_MATTER';
    ownerId?: string;
    purpose:
      | 'IDENTITY_FULL'
      | 'LEAD_SCREENSHOT'
      | 'NOTARY_OPENING_PHOTO'
      | 'NOTARY_CERTIFICATE'
      | 'NOTARY_DISCLOSURE';
    name: string;
    mime: string;
    bytes: Buffer;
  },
  headers: Record<string, string> = authorizationA,
): Promise<Uploaded> {
  const draft = await request.post('/api/v1/materials/upload-drafts', {
    headers,
    data: {
      ownerType: input.ownerType,
      ...(input.ownerId ? { ownerId: input.ownerId } : {}),
      category:
        input.ownerType === 'CUSTOMER'
          ? 'CUSTOMER_IDENTITY'
          : input.ownerType === 'NOTARY_MATTER'
            ? input.purpose
            : 'LEAD_SCREENSHOT',
      purpose: input.purpose,
      originalFilename: input.name,
      declaredMimeType: input.mime,
    },
  });
  expect(draft.status(), await draft.text()).toBe(201);
  const created: { id: string; ownerId: string } = await draft.json();
  const result = await request.put(
    `/api/v1/materials/upload-drafts/${created.id}/content`,
    {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: input.bytes,
    },
  );
  expect(result.status(), await result.text()).toBe(200);
  return result.json();
}

function leadInput(overrides: Record<string, unknown> = {}) {
  return {
    customerId: coreLeadFixtures.admittedCustomer,
    rightsHolderId: coreLeadFixtures.holder,
    caseType: 'CIVIL',
    infringementTypes: ['TRADEMARK'],
    source: 'ONLINE',
    platform: 'TAOBAO',
    foundAt: '2026-09-21T02:30:00.000Z',
    shopName: '真实测试店铺',
    needDisclose: false,
    products: [
      {
        title: '测试商品',
        quantity: 2,
        unitPrice: '1.50',
        commentCount: 3,
      },
    ],
    leadScreenshotContentVersionIds: [],
    ...overrides,
  };
}

async function createLead(
  request: APIRequestContext,
  input = leadInput(),
  key = randomUUID(),
  headers = authorizationA,
) {
  return request.post('/api/v1/leads', {
    headers: { ...headers, 'Idempotency-Key': key },
    data: input,
  });
}

async function createClientAccount(
  request: APIRequestContext,
  input: {
    customerId?: string;
    username?: string;
    password?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const username = input.username ?? `client-${randomUUID().slice(0, 8)}`;
  const password = input.password ?? 'client correct horse battery';
  const response = await request.post(
    `/api/v1/customers/${input.customerId ?? coreLeadFixtures.admittedCustomer}/client-accounts`,
    {
      headers: input.headers ?? authorizationA,
      data: { displayName: '企业审核员', username, password },
    },
  );
  expect(response.status(), await response.text()).toBe(201);
  return { account: await response.json(), username, password };
}

function pushLead(
  request: APIRequestContext,
  leadId: string,
  expectedVersion: number,
  key = randomUUID(),
  headers = authorizationA,
) {
  return request.post(`/api/v1/leads/${leadId}/push`, {
    headers: { ...headers, 'Idempotency-Key': key },
    data: { expectedVersion },
  });
}

function decideNoEvidence(
  request: APIRequestContext,
  leadId: string,
  expectedVersion: number,
  reason: string,
  key = randomUUID(),
  headers: Record<string, string> = authorizationA,
) {
  return request.post(`/api/v1/leads/${leadId}/evidence-decisions`, {
    headers: { ...headers, 'Idempotency-Key': key },
    data: { result: 'NO_EVIDENCE', reason, expectedVersion },
  });
}

function transferToNotary(
  request: APIRequestContext,
  leadId: string,
  officeId: string,
  selectedProductIds: string[],
  expectedVersion: number,
  key = randomUUID(),
  createNewBatch = false,
) {
  return request.post(`/api/v1/leads/${leadId}/notary-matters`, {
    headers: { ...authorizationA, 'Idempotency-Key': key },
    data: {
      selectedProductIds,
      selectedContentVersionIds: [],
      notaryOfficeId: officeId,
      evidenceMode: 'ONLINE_PURCHASE',
      batchPurpose: createNewBatch ? '第二批购买取证' : '第一批购买取证',
      expectedVersion,
      ...(createNewBatch ? { createNewBatch: true } : {}),
    },
  });
}

function recordNotaryEvidence(
  request: APIRequestContext,
  matterId: string,
  input: Record<string, unknown>,
  key = randomUUID(),
  headers = authorizationA,
) {
  return request.post(`/api/v1/notary-matters/${matterId}/evidence`, {
    headers: { ...headers, 'Idempotency-Key': key },
    data: input,
  });
}

function recordNotaryOpening(
  request: APIRequestContext,
  matterId: string,
  input: Record<string, unknown>,
  key = randomUUID(),
  headers: Record<string, string> = authorizationA,
) {
  return request.post(`/api/v1/notary-matters/${matterId}/opening`, {
    headers: { ...headers, 'Idempotency-Key': key },
    data: input,
  });
}

function reviewNotaryOpening(
  request: APIRequestContext,
  matterId: string,
  input: Record<string, unknown>,
  key = randomUUID(),
  clientCsrf?: string,
) {
  const client = clientCsrf !== undefined;
  return request.post(
    `/api/v1/${client ? 'client/' : ''}notary-matters/${matterId}/opening-review`,
    {
      headers: client
        ? { 'Idempotency-Key': key, 'X-CSRF-Token': clientCsrf }
        : { ...authorizationA, 'Idempotency-Key': key },
      data: input,
    },
  );
}

async function createOpenedNotaryMatter(
  request: APIRequestContext,
  clientCsrf: string,
  sampleFee: { state: 'KNOWN'; amount: string } | { state: 'PENDING' } = {
    state: 'PENDING',
  },
) {
  const matterId = await createWaitingUnboxMatter(
    request,
    clientCsrf,
    sampleFee,
  );
  const photo = await upload(request, {
    ownerType: 'NOTARY_MATTER',
    ownerId: matterId,
    purpose: 'NOTARY_OPENING_PHOTO',
    name: 'review-opening.jpg',
    mime: 'image/jpeg',
    bytes: jpegBytes,
  });
  const opening = await recordNotaryOpening(request, matterId, {
    expectedVersion: 2,
    contentVersionIds: [photo.contentVersionId],
  });
  expect(opening.status(), await opening.text()).toBe(201);
  return matterId;
}

async function createIssuanceReadyMatter(
  request: APIRequestContext,
  clientCsrf: string,
  sampleFee: { state: 'KNOWN'; amount: string } | { state: 'PENDING' } = {
    state: 'PENDING',
  },
) {
  const matterId = await createOpenedNotaryMatter(
    request,
    clientCsrf,
    sampleFee,
  );
  const reviewed = await reviewNotaryOpening(request, matterId, {
    result: 'INFRINGEMENT',
    expectedVersion: 3,
  });
  expect(reviewed.status(), await reviewed.text()).toBe(201);
  return matterId;
}

async function createCertificateReadyMatter(
  request: APIRequestContext,
  clientCsrf: string,
) {
  const matterId = await createIssuanceReadyMatter(request, clientCsrf);
  const decision = await decideNotaryIssuance(request, matterId, 'ISSUE');
  expect(decision.status(), await decision.text()).toBe(201);
  expect(await getNotaryOpeningReviewMatter(matterId)).toEqual({
    stage: 'WAITING_CERTIFICATE',
    version: 5,
  });
  return matterId;
}

function decideNotaryIssuance(
  request: APIRequestContext,
  matterId: string,
  decision: 'ISSUE' | 'NO_ISSUE',
  key = randomUUID(),
) {
  return request.post(`/api/v1/notary-matters/${matterId}/issuance-decision`, {
    headers: { ...authorizationA, 'Idempotency-Key': key },
    data: { decision, expectedVersion: 4 },
  });
}

async function createWaitingUnboxMatter(
  request: APIRequestContext,
  clientCsrf: string,
  sampleFee: { state: 'KNOWN'; amount: string } | { state: 'PENDING' } = {
    state: 'PENDING',
  },
) {
  const matterId = await createPendingNotaryMatter(request, clientCsrf);
  const evidence = await recordNotaryEvidence(request, matterId, {
    evidenceAt: '2026-09-24',
    sampleFeeState: sampleFee.state,
    ...(sampleFee.state === 'KNOWN'
      ? { sampleFeeAmount: sampleFee.amount }
      : {}),
    logistics: [{ companyState: 'NONE', trackingState: 'NONE' }],
    expectedVersion: 1,
  });
  expect(evidence.status(), await evidence.text()).toBe(201);
  return matterId;
}

async function createPendingNotaryMatter(
  request: APIRequestContext,
  clientCsrf: string,
): Promise<string> {
  const officeResponse = await request.post('/api/v1/notary-offices', {
    headers: authorizationA,
    data: { name: `取证测试公证处-${randomUUID().slice(0, 8)}` },
  });
  expect(officeResponse.status(), await officeResponse.text()).toBe(201);
  const office: { id: string } = await officeResponse.json();
  const lead = await createInfringementReviewedLead(request, clientCsrf);
  const product = (await getLead(lead.id))!.products[0];
  const transferred = await transferToNotary(
    request,
    lead.id,
    office.id,
    [product.id],
    3,
  );
  expect(transferred.status(), await transferred.text()).toBe(201);
  const matter: { id: string } = await transferred.json();
  return matter.id;
}

async function loginClient(
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

async function createNotaryAccountForMatter(
  request: APIRequestContext,
  matterId: string,
) {
  const detail = await request.get(`/api/v1/notary-matters/${matterId}`, {
    headers: authorizationA,
  });
  expect(detail.status(), await detail.text()).toBe(200);
  const officeId = ((await detail.json()) as { notaryOffice: { id: string } })
    .notaryOffice.id;
  const username = `notary-${randomUUID().slice(0, 8)}`;
  const password = 'notary correct horse battery';
  const created = await request.post(
    `/api/v1/notary-offices/${officeId}/accounts`,
    {
      headers: authorizationA,
      data: { displayName: '公证处办理员', username, password },
    },
  );
  expect(created.status(), await created.text()).toBe(201);
  const accountId = ((await created.json()) as { id: string }).id;
  const login = await request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://127.0.0.1:5174' },
    data: { username, password },
  });
  expect(login.status(), await login.text()).toBe(200);
  const session: { principalType: string; csrfToken: string } =
    await login.json();
  expect(session.principalType).toBe('NOTARY');
  return {
    accountId,
    officeId,
    username,
    password,
    csrfToken: session.csrfToken,
  };
}

function issueNotaryCertificate(
  request: APIRequestContext,
  matterId: string,
  csrfToken: string,
  input: Record<string, unknown>,
  key = randomUUID(),
) {
  return request.post(`/api/v1/notary-portal/matters/${matterId}/certificate`, {
    headers: { 'X-CSRF-Token': csrfToken, 'Idempotency-Key': key },
    data: input,
  });
}

function certificateInput(contentVersionId: string, expectedVersion = 5) {
  return {
    expectedVersion,
    certificateNo: '（2026）测证字001号',
    certificateDate: '2026-09-28',
    contentVersionIds: [contentVersionId],
    needDisclose: false,
    disclosureContentVersionIds: [],
    fees: {
      notary: { state: 'KNOWN', amount: '120.00' },
      investigation: { state: 'PENDING', amount: null },
      disclosure: { state: 'KNOWN', amount: '0.00' },
    },
  };
}

async function uploadCertificateForNotary(
  request: APIRequestContext,
  matterId: string,
  csrfToken: string,
  name = '真实公证书.pdf',
) {
  return upload(
    request,
    {
      ownerType: 'NOTARY_MATTER',
      ownerId: matterId,
      purpose: 'NOTARY_CERTIFICATE',
      name,
      mime: 'application/pdf',
      bytes: pdfBytes,
    },
    { 'X-CSRF-Token': csrfToken },
  );
}

function recordNotaryPortalOpening(
  request: APIRequestContext,
  matterId: string,
  input: Record<string, unknown>,
  csrfToken: string,
  key = randomUUID(),
) {
  return request.post(`/api/v1/notary-portal/matters/${matterId}/opening`, {
    headers: { 'X-CSRF-Token': csrfToken, 'Idempotency-Key': key },
    data: input,
  });
}

function reviewLead(
  request: APIRequestContext,
  leadId: string,
  expectedVersion: number,
  csrfToken: string,
  key = randomUUID(),
  result: 'INFRINGEMENT' | 'NO_INFRINGEMENT' = 'INFRINGEMENT',
  reason?: string,
) {
  const data =
    result === 'INFRINGEMENT'
      ? { result, expectedVersion }
      : { result, reason, expectedVersion };
  return request.post(`/api/v1/client/leads/${leadId}/reviews`, {
    headers: { 'Idempotency-Key': key, 'X-CSRF-Token': csrfToken },
    data,
  });
}

async function archiveLeadForWithdrawal(
  request: APIRequestContext,
  csrfToken: string,
  input = leadInput(),
) {
  const created = await createLead(request, input);
  expect(created.status(), await created.text()).toBe(201);
  const lead: { id: string } = await created.json();
  expect((await pushLead(request, lead.id, 1)).status()).toBe(201);
  const reviewKey = randomUUID();
  const review = await reviewLead(
    request,
    lead.id,
    2,
    csrfToken,
    reviewKey,
    'NO_INFRINGEMENT',
    '原审核结论保持不变',
  );
  expect(review.status(), await review.text()).toBe(201);
  return { lead, reviewKey, reviewResult: await review.json() };
}

async function createInfringementReviewedLead(
  request: APIRequestContext,
  csrfToken: string,
) {
  const created = await createLead(request);
  expect(created.status(), await created.text()).toBe(201);
  const lead: { id: string } = await created.json();
  expect((await pushLead(request, lead.id, 1)).status()).toBe(201);
  const reviewed = await reviewLead(request, lead.id, 2, csrfToken);
  expect(reviewed.status(), await reviewed.text()).toBe(201);
  return lead;
}

function applyLeadWithdrawal(
  request: APIRequestContext,
  leadId: string,
  expectedVersion: number,
  reason: string,
  key = randomUUID(),
  headers = authorizationA,
) {
  return request.post(`/api/v1/leads/${leadId}/withdrawal-applications`, {
    headers: { ...headers, 'Idempotency-Key': key },
    data: { reason, expectedVersion },
  });
}

function confirmLeadWithdrawal(
  request: APIRequestContext,
  leadId: string,
  applicationId: string,
  expectedVersion: number,
  csrfToken: string,
  key = randomUUID(),
) {
  return request.post(
    `/api/v1/client/leads/${leadId}/withdrawal-confirmations`,
    {
      headers: { 'Idempotency-Key': key, 'X-CSRF-Token': csrfToken },
      data: { applicationId, expectedVersion },
    },
  );
}

function admissionInput(versionIds: string[]) {
  return {
    expectedVersion: 1,
    customerType: 'ENTERPRISE',
    name: '待准入客户',
    identityType: 'BUSINESS_LICENSE',
    identityNumber: 'CORE-ADMIT-001',
    identityValidityMode: 'LONG_TERM',
    admissionContactName: '张主管',
    admissionContactPhone: '13800000000',
    identityDocumentContentVersionIds: versionIds,
  };
}

test.beforeEach(async () => {
  await resetCoreLeadE2eData();
});

test.afterAll(async () => {
  await disconnectCoreLeadTestDatabase();
});

test('bound notary account opens only its assigned matter through real browser and remains revoked immediately', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const client = await createClientAccount(request);
  const clientCsrf = await loginClient(
    request,
    client.username,
    client.password,
  );
  const ownMatterId = await createWaitingUnboxMatter(request, clientCsrf);
  const otherMatterId = await createWaitingUnboxMatter(request, clientCsrf);
  const otherPhoto = await upload(request, {
    ownerType: 'NOTARY_MATTER',
    ownerId: otherMatterId,
    purpose: 'NOTARY_OPENING_PHOTO',
    name: 'other-office-opening.jpg',
    mime: 'image/jpeg',
    bytes: jpegBytes,
  });
  const ownOperatorDetail = await request.get(
    `/api/v1/notary-matters/${ownMatterId}`,
    { headers: authorizationA },
  );
  expect(ownOperatorDetail.status()).toBe(200);
  const ownMatter: {
    businessNo: string;
    notaryOffice: { id: string };
  } = await ownOperatorDetail.json();
  const otherOperatorDetail = await request.get(
    `/api/v1/notary-matters/${otherMatterId}`,
    { headers: authorizationA },
  );
  expect(otherOperatorDetail.status()).toBe(200);
  const otherMatter: { businessNo: string } = await otherOperatorDetail.json();
  const username = `notary-${randomUUID().slice(0, 8)}`;
  const password = 'notary correct horse battery';

  await page.goto('/notary-offices');
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/notary-offices$/u);
  await page
    .locator(`[data-test="office-accounts-${ownMatter.notaryOffice.id}"]`)
    .click();
  await expect(
    page.locator('[data-test="notary-office-account-create"]'),
  ).toBeVisible();
  await page
    .locator('[data-test="notary-account-display-name"]')
    .fill('公证处办理员');
  await page.locator('[data-test="notary-account-username"]').fill(username);
  await page.locator('[data-test="notary-account-password"]').fill(password);
  await page.locator('[data-test="create-notary-account"]').click();
  await expect(
    page
      .locator('[data-test="notary-account-row"]')
      .filter({ hasText: username }),
  ).toBeVisible();

  await page.getByRole('button', { name: '退出登录' }).click();
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/notary-portal\/matters$/u);
  await expect(page.locator('[data-test="notary-portal-nav"]')).toBeVisible();
  const ownRow = page.locator('[data-test="notary-portal-row"]');
  await expect(ownRow).toHaveCount(1);
  await expect(ownRow).toContainText(ownMatter.businessNo);
  await expect(page.getByText(otherMatter.businessNo)).toHaveCount(0);
  await page.goto(`/notary-portal/matters/${otherMatterId}`);
  await expect(page.getByText('事项不存在或已不可访问')).toBeVisible();
  await page.goto(`/notary-portal/matters/${ownMatterId}`);
  await expect(page.locator('[data-test="notary-opening-form"]')).toBeVisible();
  await page.locator('[data-test="notary-opening-photo-files"]').setInputFiles({
    name: '公证处真实开箱.jpg',
    mimeType: 'image/jpeg',
    buffer: jpegBytes,
  });
  await expect(page.getByText('公证处真实开箱.jpg')).toBeVisible();
  await page.locator('[data-test="notary-opening-photo-files"]').setInputFiles({
    name: '误传照片.jpg',
    mimeType: 'image/jpeg',
    buffer: jpegBytes,
  });
  await expect(page.getByText('误传照片.jpg')).toBeVisible();
  await page.getByRole('checkbox', { name: /误传照片/u }).uncheck();
  await page.getByLabel('寄件人姓名').fill('实际寄件人');
  await page.locator('[data-test="notary-opening-submit"]').click();
  await expect(
    page.locator('[data-test="notary-saved-opening"]'),
  ).toContainText('实际寄件人');
  await page.reload();
  await expect(
    page.locator('[data-test="notary-saved-opening"]'),
  ).toContainText('公证处真实开箱.jpg');
  await expect(
    page.locator('[data-test="notary-saved-opening"]'),
  ).not.toContainText('误传照片.jpg');
  const download = page.waitForEvent('download');
  await page.locator('[data-test="notary-opening-photo-download"]').click();
  expect(await readFile(await (await download).path())).toEqual(jpegBytes);
  expect(await countNotaryOpenings(ownMatterId)).toBe(1);
  expect(await countNotaryOpeningAudits(ownMatterId)).toBe(1);
  expect(await countNotaryOpeningReceipts(ownMatterId)).toBe(1);
  expect(await countNotaryOpeningReferences(ownMatterId)).toBe(1);

  await page.getByRole('button', { name: '退出登录' }).click();
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/notary-portal\/matters$/u);
  await page.goto(`/notary-portal/matters/${ownMatterId}`);
  await expect(
    page.locator('[data-test="notary-saved-opening"]'),
  ).toContainText('实际寄件人');

  const notaryLogin = await request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://127.0.0.1:5174' },
    data: { username, password },
  });
  expect(notaryLogin.status(), await notaryLogin.text()).toBe(200);
  expect((await notaryLogin.json()).principalType).toBe('NOTARY');
  expect((await request.get('/api/v1/notary-matters')).status()).toBe(403);
  expect(
    (
      await request.get(`/api/v1/notary-portal/matters/${otherMatterId}`)
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.get(
        `/api/v1/materials/${otherPhoto.materialId}/versions/${otherPhoto.contentVersionId}/content`,
      )
    ).status(),
  ).toBe(404);
  const accounts = await request.get(
    `/api/v1/notary-offices/${ownMatter.notaryOffice.id}/accounts`,
    { headers: authorizationA },
  );
  expect(accounts.status()).toBe(200);
  const account: { id: string } = (await accounts.json()).items.find(
    (item: { username: string }) => item.username === username,
  );
  expect(account?.id).toBeTruthy();
  const stopped = await request.patch(
    `/api/v1/notary-offices/${ownMatter.notaryOffice.id}/accounts/${account.id}/status`,
    { headers: authorizationA, data: { active: false } },
  );
  expect(stopped.status(), await stopped.text()).toBe(200);
  expect((await request.get('/api/v1/notary-portal/matters')).status()).toBe(
    401,
  );
});

test('revoked notary office binding invalidates the next request and login', async ({
  request,
}) => {
  const client = await createClientAccount(request);
  const clientCsrf = await loginClient(
    request,
    client.username,
    client.password,
  );
  const matterId = await createWaitingUnboxMatter(request, clientCsrf);
  const notary = await createNotaryAccountForMatter(request, matterId);
  expect((await request.get('/api/v1/notary-portal/matters')).status()).toBe(
    200,
  );
  await setNotaryBindingActive(notary.accountId, false);
  expect((await request.get('/api/v1/notary-portal/matters')).status()).toBe(
    401,
  );
  const login = await request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://127.0.0.1:5174' },
    data: { username: notary.username, password: notary.password },
  });
  expect(login.status()).toBe(401);
});

test('authorized supervisor admits a customer with real PDF and JPEG bytes', async ({
  page,
  request,
}) => {
  await configureBrowser(page);
  await page.goto(`/customers/${coreLeadFixtures.draftCustomer}`);
  await expect(page.getByRole('heading', { name: '待准入客户' })).toBeVisible();
  await page.getByLabel('客户组织类型').selectOption('ENTERPRISE');
  await page.getByLabel('身份证明类型').selectOption('BUSINESS_LICENSE');
  await expect(page.getByText('完整身份证明材料')).toBeVisible();
  const picker = page.locator('input[name="identityDocument"]');
  await picker.setInputFiles({
    name: 'license.pdf',
    mimeType: 'application/pdf',
    buffer: pdfBytes,
  });
  await expect(page.getByText('license.pdf')).toBeVisible();
  await upload(request, {
    ownerType: 'CUSTOMER',
    ownerId: coreLeadFixtures.draftCustomer,
    purpose: 'IDENTITY_FULL',
    name: 'license.jpg',
    mime: 'image/jpeg',
    bytes: jpegBytes,
  });

  const materials = await request.get(
    `/api/v1/materials?ownerType=CUSTOMER&ownerId=${coreLeadFixtures.draftCustomer}`,
    { headers: authorizationA },
  );
  const listed: {
    items: Array<{
      id: string;
      currentVersionId: string;
      contentVersions: Array<{ id: string; originalFilename: string }>;
    }>;
  } = await materials.json();
  expect(listed.items).toHaveLength(2);
  expect(JSON.stringify(listed)).not.toContain('storageKey');
  expect(JSON.stringify(listed)).not.toContain('uploadedBy');
  expect(JSON.stringify(listed)).not.toContain('departmentId');
  for (const item of listed.items) {
    const downloaded = await request.get(
      `/api/v1/materials/${item.id}/versions/${item.currentVersionId}/content`,
      { headers: authorizationA },
    );
    expect(downloaded.status()).toBe(200);
    const filename = item.contentVersions.find(
      (version) => version.id === item.currentVersionId,
    )?.originalFilename;
    expect(await downloaded.body()).toEqual(
      filename === 'license.pdf' ? pdfBytes : jpegBytes,
    );
  }

  await page.getByLabel('证件号码').fill('CORE-ADMIT-001');
  await page.getByLabel('有效期类型').selectOption('LONG_TERM');
  await page.getByLabel('联系人姓名').fill('张主管');
  await page.getByLabel('电话').fill('13800000000');
  await page.locator('[data-test="admit-submit"]').click();
  await expect(
    page.getByText('客户已完成准入，可用于创建正式线索。'),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('客户已完成准入，可用于创建正式线索。'),
  ).toBeVisible();
  await expect(
    getCustomer(coreLeadFixtures.draftCustomer),
  ).resolves.toMatchObject({
    profileStatus: 'ADMITTED',
    version: 2,
  });
});

test('operator creates, refreshes, views, and edits a waiting-push lead', async ({
  page,
}) => {
  await configureBrowser(page);
  await page.goto('/leads');
  const counters = page.locator('[data-test="lead-counter"]');
  await expect(counters).toHaveCount(4);
  await expect(counters).toHaveText([
    '待推送0',
    '线索待审核1',
    '线索待确认1',
    '线索已归档1',
  ]);
  await page.locator('[data-test="create-lead"]').click();
  await expect(page.locator('.required-mark').first()).toBeVisible();
  await page
    .locator('select[name="customerId"]')
    .selectOption(coreLeadFixtures.admittedCustomer);
  await expect(page.locator('select[name="rightsHolderId"]')).toHaveValue(
    coreLeadFixtures.holder,
  );
  await expect(page.getByText('已按客户自动带出')).toBeVisible();
  await page.getByLabel('拟办理业务类型').selectOption('CIVIL');
  await page.getByLabel('发现时间').fill('2026-09-21T10:30');
  await page.getByLabel('线索来源').selectOption('ONLINE');
  await page.getByLabel('发现平台').selectOption('TAOBAO');
  await page.getByLabel('店铺名称').fill('浏览器店铺');
  await page.getByLabel('商标权').check();
  await page.locator('input[name="productTitle-0"]').fill('浏览器商品');
  await page.locator('input[name="quantity-0"]').fill('2');
  await page.locator('input[name="unitPrice-0"]').fill('1.50');
  await page.locator('input[name="commentCount-0"]').fill('3');
  await expect(page.locator('[data-test="estimate-0"]')).toContainText('3.00');
  await page.locator('input[name="screenshots"]').setInputFiles({
    name: 'lead.jpg',
    mimeType: 'image/jpeg',
    buffer: jpegBytes,
  });
  await page.getByRole('button', { name: '创建线索' }).click();
  await expect(page.getByRole('heading', { name: /^LD-/u })).toBeVisible();
  await expect(page.getByText('浏览器店铺', { exact: true })).toBeVisible();
  await expect(page.getByText('lead.jpg')).toBeVisible();
  const id = page.url().split('/').at(-1)!;
  await page.reload();
  await page.locator('[data-test="edit-lead"]').click();
  await page.getByLabel('店铺名称').fill('浏览器店铺已修改');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(
    page.getByText('浏览器店铺已修改', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText('版本 2')).toBeVisible();
  await expect(getLead(id)).resolves.toMatchObject({
    version: 2,
    shopName: '浏览器店铺已修改',
  });
});

test('real operator and client logins persist infringement review, screenshot and operator follow-up in one browser chain', async ({
  page,
}) => {
  const clientUsername = `browser-client-${randomUUID().slice(0, 8)}`;
  const clientPassword = 'browser client password 2026';

  await page.goto('/customers');
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/u);

  await page.getByRole('link', { name: '已准入客户' }).click();
  await expect(
    page.locator('[data-test="client-account-panel"]'),
  ).toBeVisible();
  await page.getByLabel('客户侧使用人姓名').fill('浏览器企业审核员');
  await expect(page.getByText('初始密码至少 12 个字符')).toBeVisible();
  await page.getByLabel('用户名').fill(clientUsername);
  await page.getByLabel('初始密码').fill(clientPassword);
  await page.locator('[data-test="create-client-account"]').click();
  await expect(page.getByText('账号已创建并绑定')).toBeVisible();
  await expect(page.getByText(clientUsername)).toBeVisible();

  await page.locator('[data-test="lead-nav"]').click();
  await page.locator('[data-test="create-lead"]').click();
  await page
    .locator('select[name="customerId"]')
    .selectOption(coreLeadFixtures.admittedCustomer);
  await expect(page.locator('select[name="rightsHolderId"]')).toHaveValue(
    coreLeadFixtures.holder,
  );
  await page.getByLabel('拟办理业务类型').selectOption('CIVIL');
  await page.getByLabel('发现时间').fill('2026-09-22T10:30');
  await page.getByLabel('线索来源').selectOption('ONLINE');
  await page.getByLabel('发现平台').selectOption('TAOBAO');
  await page.getByLabel('店铺名称').fill('客户端闭环店铺');
  await page.getByLabel('商标权').check();
  await page.locator('input[name="productTitle-0"]').fill('客户端闭环商品');
  await page.locator('input[name="quantity-0"]').fill('2');
  await page.locator('input[name="unitPrice-0"]').fill('8.00');
  await page.locator('input[name="commentCount-0"]').fill('0');
  await page.locator('input[name="screenshots"]').setInputFiles({
    name: 'client-review.jpg',
    mimeType: 'image/jpeg',
    buffer: jpegBytes,
  });
  await page.getByRole('button', { name: '创建线索' }).click();
  await expect(page.getByRole('heading', { name: /^LD-/u })).toBeVisible();
  const leadId = page.url().split('/').at(-1)!;

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('状态将变为“线索待审核”');
    await dialog.dismiss();
  });
  await page.locator('[data-test="push-lead"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('待推送');

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('已准入客户');
    await dialog.accept();
  });
  await page.locator('[data-test="push-lead"]').click();
  await expect(page.locator('[data-test="push-success"]')).toContainText(
    '已推送给客户审核',
  );
  await expect(page.locator('.page-head .pill')).toHaveText('线索待审核');
  await expect(page.locator('[data-test="push-record"]')).toContainText(
    '核心主管',
  );

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel('用户名').fill(clientUsername);
  await page.getByLabel('密码').fill(clientPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/client\/leads$/u);
  const row = page.locator('[data-test="client-lead-row"]');
  await expect(row).toContainText('客户端闭环店铺');
  await row.getByRole('link').click();
  await expect(page).toHaveURL(
    new RegExp(`/client/leads/${leadId}(\\?|$)`, 'u'),
  );
  await expect(page.getByText('客户端闭环商品')).toBeVisible();
  await expect(page.getByText('client-review.jpg')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.locator('[data-test^="download-screenshot-"]').click();
  const originalDownload = await download;
  await expect(originalDownload.suggestedFilename()).toBe('client-review.jpg');
  expect(await readFile(await originalDownload.path())).toEqual(jpegBytes);
  await page.reload();
  await expect(page.getByText('客户端闭环店铺')).toBeVisible();
  await expect(page.getByText('client-review.jpg')).toBeVisible();
  await expect(
    page.locator('[data-test="confirm-infringement"]'),
  ).toBeVisible();

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('不能撤回');
    await dialog.dismiss();
  });
  await page.locator('[data-test="confirm-infringement"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('线索待审核');
  expect(await countLeadReviewDecisions(leadId)).toBe(0);

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('线索待确认');
    await dialog.accept();
  });
  await page.locator('[data-test="confirm-infringement"]').click();
  const clientRecord = page.locator('[data-test="client-review-record"]');
  await expect(clientRecord).toContainText('确认侵权');
  await expect(clientRecord).toContainText('浏览器企业审核员');
  await expect(clientRecord).toContainText('等待运营确认是否取证');
  const reviewerTime = (await clientRecord.locator('p').nth(2).textContent())
    ?.replace('审核时间：', '')
    .trim();
  expect(reviewerTime).toBeTruthy();
  await expect(page.locator('.page-head .pill')).toHaveText('线索待确认');
  expect(await countLeadReviewDecisions(leadId)).toBe(1);
  expect(await countClientLeadReviewReceipts(leadId)).toBe(1);

  await page.reload();
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText('浏览器企业审核员');
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText(reviewerTime!);
  const afterReviewDownload = page.waitForEvent('download');
  await page.locator('[data-test^="download-screenshot-"]').click();
  expect(await readFile(await (await afterReviewDownload).path())).toEqual(
    jpegBytes,
  );

  await page.getByRole('link', { name: /返回待审核线索/u }).click();
  await page.locator('[data-test="client-view-processed"]').click();
  await expect(
    page.getByRole('heading', { name: '已处理线索', exact: true }),
  ).toBeVisible();
  const processedRow = page.locator('[data-test="client-lead-row"]');
  await expect(processedRow).toContainText('客户端闭环店铺');
  await processedRow.getByRole('link').click();
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText(reviewerTime!);

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/u);
  await page.goto('/leads?status=WAITING_EVIDENCE_DECISION');
  const operatorRow = page
    .locator('[data-test="lead-row"]')
    .filter({ hasText: '客户端闭环店铺' });
  await expect(operatorRow).toContainText('线索待确认');
  await operatorRow.getByRole('link').click();
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText('浏览器企业审核员');
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText(reviewerTime!);
  const noEvidenceReason = '现场取证成本与现有材料不匹配，本次不再取证';
  await expect(
    page.locator('[data-test="no-evidence-reason"]'),
  ).toHaveAttribute('aria-required', 'true');
  await page.locator('[data-test="no-evidence-reason"]').fill(noEvidenceReason);
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('当前页面不能撤回');
    dialog.accept();
  });
  await page.locator('[data-test="archive-no-evidence"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('线索已归档');
  await expect(
    page.locator('[data-test="evidence-decision-record"]'),
  ).toContainText(noEvidenceReason);
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText(reviewerTime!);

  await page.reload();
  await expect(
    page.locator('[data-test="evidence-decision-record"]'),
  ).toContainText(noEvidenceReason);
  await page.getByRole('button', { name: '退出登录' }).click();
  await page.getByLabel('用户名').fill(clientUsername);
  await page.getByLabel('密码').fill(clientPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('[data-test="client-view-processed"]').click();
  await page
    .locator('[data-test="client-lead-row"]')
    .filter({ hasText: '客户端闭环店铺' })
    .getByRole('link')
    .click();
  await expect(
    page.locator('[data-test="client-evidence-decision-record"]'),
  ).toContainText(noEvidenceReason);
  await expect(page.getByText('下一步：等待运营确认是否取证')).toHaveCount(0);
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText(reviewerTime!);
  const archivedDownload = page.waitForEvent('download');
  await page.locator('[data-test^="download-screenshot-"]').click();
  expect(await readFile(await (await archivedDownload).path())).toEqual(
    jpegBytes,
  );
  await page.reload();
  await expect(
    page.locator('[data-test="client-evidence-decision-record"]'),
  ).toContainText(noEvidenceReason);
});

test('real operator and client logins transfer a lead and record notary evidence logistics durably', async ({
  page,
  request,
}) => {
  const clientUsername = `notary-client-${randomUUID().slice(0, 8)}`;
  const clientPassword = 'notary client password 2026';
  const officeName = `浏览器公证处-${randomUUID().slice(0, 8)}`;

  await page.goto('/customers');
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/u);

  await page.getByRole('link', { name: '已准入客户' }).click();
  await expect(
    page.locator('[data-test="client-account-panel"]'),
  ).toBeVisible();
  await page.getByLabel('客户侧使用人姓名').fill('公证闭环审核员');
  await page.getByLabel('用户名').fill(clientUsername);
  await page.getByLabel('初始密码').fill(clientPassword);
  await page.locator('[data-test="create-client-account"]').click();
  await expect(page.getByText('账号已创建并绑定')).toBeVisible();

  await page.goto('/notary-offices');
  await expect(
    page.locator('[data-test="notary-office-create-form"]'),
  ).toBeVisible();
  await page.locator('[data-test="new-notary-office-name"]').fill(officeName);
  await page.locator('[data-test="create-notary-office"]').click();
  await expect(page.locator('[data-test="notary-offices-list"]')).toContainText(
    officeName,
  );

  await page.locator('[data-test="lead-nav"]').click();
  await page.locator('[data-test="create-lead"]').click();
  await page
    .locator('select[name="customerId"]')
    .selectOption(coreLeadFixtures.admittedCustomer);
  await page.getByLabel('拟办理业务类型').selectOption('CIVIL');
  await page.getByLabel('发现时间').fill('2026-09-24T10:30');
  await page.getByLabel('线索来源').selectOption('ONLINE');
  await page.getByLabel('发现平台').selectOption('TAOBAO');
  await page.getByLabel('店铺名称').fill('公证移交闭环店铺');
  await page.getByLabel('商标权').check();
  await page.locator('input[name="productTitle-0"]').fill('公证移交商品');
  await page.locator('input[name="quantity-0"]').fill('2');
  await page.locator('input[name="unitPrice-0"]').fill('8.00');
  await page.locator('input[name="commentCount-0"]').fill('0');
  await page.locator('input[name="screenshots"]').setInputFiles({
    name: 'notary-source.jpg',
    mimeType: 'image/jpeg',
    buffer: jpegBytes,
  });
  await page.getByRole('button', { name: '创建线索' }).click();
  await expect(page.getByRole('heading', { name: /^LD-/u })).toBeVisible();
  const leadId = page.url().split('/').at(-1)!;

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('[data-test="push-lead"]').click();
  await expect(page.locator('[data-test="push-success"]')).toContainText(
    '已推送给客户审核',
  );
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel('用户名').fill(clientUsername);
  await page.getByLabel('密码').fill(clientPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/client\/leads$/u);
  const clientRow = page.locator('[data-test="client-lead-row"]');
  await expect(clientRow).toContainText('公证移交闭环店铺');
  await clientRow.getByRole('link').click();
  await expect(page).toHaveURL(
    new RegExp(`/client/leads/${leadId}(\\?|$)`, 'u'),
  );
  await expect(page.getByText('notary-source.jpg')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('[data-test="confirm-infringement"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('线索待确认');
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText('确认侵权');

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/u);
  await page.goto('/leads?status=WAITING_EVIDENCE_DECISION');
  const operatorRow = page
    .locator('[data-test="lead-row"]')
    .filter({ hasText: '公证移交闭环店铺' });
  await expect(operatorRow).toContainText('线索待确认');
  await operatorRow.getByRole('link').click();
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText('确认侵权');

  await expect(
    page.locator('[data-test^="select-product-"]').first(),
  ).toBeVisible();
  await page.locator('[data-test^="select-product-"]').first().check();
  const evidence = page.locator('[data-test^="select-evidence-"]').first();
  await expect(evidence).toBeVisible();
  await evidence.check();
  await expect(page.locator('[data-test="notary-office"]')).toContainText(
    officeName,
  );
  await page.locator('[data-test="batch-purpose"]').fill('首次线上购买取证');
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('已移交公证');
    dialog.accept();
  });
  await page.locator('[data-test="transfer-to-notary"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('已移交公证');
  await expect(
    page.locator('[data-test="lead-products-table"]').getByText('公证移交商品'),
  ).toBeVisible();
  const matterLink = page.locator('[data-test^="matter-link-"]').first();
  await expect(matterLink).toBeVisible();
  await expect(matterLink.locator('..')).toContainText(officeName);
  const matterHref = await matterLink.getAttribute('href');
  expect(matterHref).toMatch(/^\/notary-matters\/[0-9a-f-]+$/iu);
  await matterLink.click();
  await expect(page).toHaveURL(new RegExp(`${matterHref}(\\?|$)`, 'u'));
  const matterDetail = page.locator('[data-test="notary-matter-detail"]');
  await expect(page.locator('.page-head .pill')).toHaveText('待公证处取证');
  await expect(matterDetail).toContainText(officeName);
  await expect(
    page.locator('[data-test="notary-matter-products"]'),
  ).toContainText('公证移交商品');
  await expect(
    page.locator('[data-test="notary-matter-materials"]'),
  ).toContainText('notary-source.jpg');
  const matterDownload = page.waitForEvent('download');
  await page.locator('[data-test^="download-matter-material-"]').click();
  expect(await readFile(await (await matterDownload).path())).toEqual(
    jpegBytes,
  );
  await page.reload();
  await expect(matterDetail).toContainText('首次线上购买取证');
  await expect(
    page.locator('[data-test="notary-matter-materials"]'),
  ).toContainText('notary-source.jpg');

  await page.locator('[data-test="evidence-date"]').fill('2026-09-24');
  await page.locator('[data-test="sample-fee-state"]').selectOption('KNOWN');
  await page.locator('[data-test="sample-fee-amount"]').fill('12.00');
  await page
    .locator('[data-test="logistics-company-state-0"]')
    .selectOption('PRESENT');
  await page
    .locator('[data-test="logistics-company-value-0"]')
    .fill('真实快递公司');
  await page
    .locator('[data-test="logistics-tracking-state-0"]')
    .selectOption('NONE');
  await page.locator('[data-test="record-evidence-submit"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('等待开箱');
  await expect(page.locator('[data-test="saved-evidence"]')).toContainText(
    '真实快递公司',
  );
  await expect(page.locator('[data-test="saved-evidence"]')).toContainText(
    '快递单号：无',
  );
  await page.reload();
  await expect(page.locator('.page-head .pill')).toHaveText('等待开箱');
  await expect(page.locator('[data-test="saved-evidence"]')).toContainText(
    '12.00 元',
  );

  await expect(page.locator('[data-test="opening-form"]')).toBeVisible();
  await page.locator('[data-test="opening-photo-files"]').setInputFiles({
    name: '真实开箱照片.jpg',
    mimeType: 'image/jpeg',
    buffer: jpegBytes,
  });
  await expect(
    page.locator('[data-test^="select-opening-photo-"]').first(),
  ).toBeChecked();
  await page.locator('[data-test="opening-sender-name"]').fill('真实寄件人');
  await page.locator('[data-test="opening-sender-phone"]').fill('13800000000');
  await page.locator('[data-test="record-opening-submit"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('开箱审核中');
  await expect(page.locator('[data-test="saved-opening"]')).toContainText(
    '真实开箱照片.jpg',
  );
  await page.reload();
  await expect(page.locator('.page-head .pill')).toHaveText('开箱审核中');
  await expect(page.locator('[data-test="saved-opening"]')).toContainText(
    '真实寄件人',
  );
  const openingDownload = page.waitForEvent('download');
  await page.locator('[data-test^="download-opening-photo-"]').click();
  expect(await readFile(await (await openingDownload).path())).toEqual(
    jpegBytes,
  );

  const foreignClient = await createClientAccount(request, {
    customerId: coreLeadFixtures.foreignCustomer,
    headers: { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
  });
  await loginClient(request, foreignClient.username, foreignClient.password);
  expect((await request.get(`/api/v1/client/leads/${leadId}`)).status()).toBe(
    404,
  );
  expect(
    (
      await request.get(
        `/api/v1/notary-matters/${matterHref!.split('/').at(-1)}`,
      )
    ).status(),
  ).toBe(403);

  await page.getByRole('button', { name: '退出登录' }).click();
  await page.getByLabel('用户名').fill(clientUsername);
  await page.getByLabel('密码').fill(clientPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('[data-test="client-view-processed"]').click();
  const processedRow = page
    .locator('[data-test="client-lead-row"]')
    .filter({ hasText: '公证移交闭环店铺' });
  await expect(processedRow).toBeVisible();
  await processedRow.getByRole('link').click();
  await expect(page).toHaveURL(
    new RegExp(`/client/leads/${leadId}(\\?|$)`, 'u'),
  );
  await expect(page.getByText('公证移交商品')).toBeVisible();
  await expect(page.getByText('notary-source.jpg')).toBeVisible();
  await expect(page.getByText(/运营已将线索移交公证流程/u)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.locator('[data-test^="download-screenshot-"]').click();
  const originalDownload = await download;
  await expect(originalDownload.suggestedFilename()).toBe('notary-source.jpg');
  expect(await readFile(await originalDownload.path())).toEqual(jpegBytes);
  await page.reload();
  await expect(page.getByText('公证移交商品')).toBeVisible();
  await expect(page.getByText('notary-source.jpg')).toBeVisible();
});

test('operator corrects a full 50-photo opening queue after refresh without manual API calls', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const client = await createClientAccount(request);
  const csrf = await loginClient(request, client.username, client.password);
  const matterId = await createWaitingUnboxMatter(request, csrf);
  let mistaken: Uploaded | undefined;
  for (let index = 0; index < 50; index += 1) {
    const uploaded = await upload(request, {
      ownerType: 'NOTARY_MATTER',
      ownerId: matterId,
      purpose: 'NOTARY_OPENING_PHOTO',
      name: `开箱照片-${index + 1}.jpg`,
      mime: 'image/jpeg',
      bytes: jpegBytes,
    });
    if (index === 0) mistaken = uploaded;
  }
  expect(mistaken).toBeDefined();

  await page.goto(`/notary-matters/${matterId}`);
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(
    page.locator(
      '[data-test="opening-staged-row-' + mistaken!.contentVersionId + '"]',
    ),
  ).toBeVisible();
  await expect(page.locator('[data-test^="opening-staged-row-"]')).toHaveCount(
    50,
  );
  await page.reload();
  await expect(page.locator('[data-test^="opening-staged-row-"]')).toHaveCount(
    50,
  );
  await expect(
    page.locator('[data-test^="select-opening-photo-"]').first(),
  ).not.toBeChecked();

  await page
    .locator(`[data-test="delete-opening-photo-${mistaken!.materialId}"]`)
    .click();
  await expect(
    page.locator(
      `[data-test="opening-staged-row-${mistaken!.contentVersionId}"]`,
    ),
  ).toHaveCount(0);
  await expect(page.locator('[data-test^="opening-staged-row-"]')).toHaveCount(
    49,
  );
  await page.locator('[data-test="opening-photo-files"]').setInputFiles({
    name: '补传正确照片.jpg',
    mimeType: 'image/jpeg',
    buffer: jpegBytes,
  });
  await expect(page.locator('[data-test^="opening-staged-row-"]')).toHaveCount(
    50,
  );
  const selected = page.locator('[data-test^="select-opening-photo-"]:checked');
  await expect(selected).toHaveCount(1);
  await page.locator('[data-test="record-opening-submit"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('开箱审核中');
  await expect(page.locator('[data-test="saved-opening"]')).toContainText(
    '补传正确照片.jpg',
  );
  await expect(page.locator('[data-test="saved-opening"]')).not.toContainText(
    '开箱照片-1.jpg',
  );
  await page.reload();
  await expect(page.locator('[data-test="saved-opening"]')).toContainText(
    '补传正确照片.jpg',
  );
});

test('notary handoff serializes competing batches and rolls back when audit or receipt cannot persist', async ({
  request,
  page,
}) => {
  const client = await createClientAccount(request);
  const csrf = await loginClient(request, client.username, client.password);
  const officeResponse = await request.post('/api/v1/notary-offices', {
    headers: authorizationA,
    data: { name: `并发测试公证处-${randomUUID().slice(0, 8)}` },
  });
  expect(officeResponse.status(), await officeResponse.text()).toBe(201);
  const office: { id: string } = await officeResponse.json();
  const created = await createLead(
    request,
    leadInput({
      products: [
        {
          title: '取证商品甲',
          quantity: 1,
          unitPrice: '10.00',
          commentCount: 0,
        },
        {
          title: '取证商品乙',
          quantity: 1,
          unitPrice: '20.00',
          commentCount: 0,
        },
      ],
    }),
  );
  expect(created.status(), await created.text()).toBe(201);
  const lead: { id: string } = await created.json();
  expect((await pushLead(request, lead.id, 1)).status()).toBe(201);
  expect((await reviewLead(request, lead.id, 2, csrf)).status()).toBe(201);
  const products = (await getLead(lead.id))!.products;
  const firstKey = randomUUID();
  const first = transferToNotary(
    request,
    lead.id,
    office.id,
    [products[0].id],
    3,
    firstKey,
  );
  const competitor = transferToNotary(
    request,
    lead.id,
    office.id,
    [products[1].id],
    3,
  );
  const outcomes = await Promise.all([first, competitor]);
  expect(outcomes.map((response) => response.status()).sort()).toEqual([
    201, 409,
  ]);
  expect(await getLead(lead.id)).toMatchObject({
    status: 'TRANSFERRED_TO_NOTARY',
    version: 4,
  });
  expect(await countNotaryMatters(lead.id)).toBe(1);
  expect(await countNotaryHandoffReceipts(lead.id)).toBe(1);
  expect(await countNotaryHandoffAudits(lead.id)).toBe(1);
  const winning = outcomes.find((response) => response.status() === 201)!;
  const winningResult = await winning.json();
  const winningProduct = winningResult.selectedProductIds[0] as string;
  const winningKey = winningProduct === products[0].id ? firstKey : null;
  if (winningKey !== null) {
    const replay = await transferToNotary(
      request,
      lead.id,
      office.id,
      [products[0].id],
      3,
      firstKey,
    );
    expect(replay.status()).toBe(201);
    expect(await replay.json()).toEqual(winningResult);
  }
  const nextProduct = products.find(
    (product) => product.id !== winningProduct,
  )!;
  const second = await transferToNotary(
    request,
    lead.id,
    office.id,
    [nextProduct.id],
    4,
    randomUUID(),
    true,
  );
  expect(second.status(), await second.text()).toBe(201);
  const secondResult = await second.json();
  expect(secondResult).toMatchObject({
    leadId: lead.id,
    leadVersion: 5,
    selectedProductIds: [nextProduct.id],
  });
  expect(await countNotaryMatters(lead.id)).toBe(2);
  expect(await countNotaryHandoffReceipts(lead.id)).toBe(2);
  expect(await countNotaryHandoffAudits(lead.id)).toBe(2);
  const sourceDetail = await request.get(
    `/api/v1/notary-matters/${secondResult.id}`,
    { headers: authorizationA },
  );
  expect(sourceDetail.status(), await sourceDetail.text()).toBe(200);
  expect(await sourceDetail.json()).toMatchObject({
    sourceLead: { id: lead.id },
    selectedProductIds: [nextProduct.id],
  });

  const library = await request.get('/api/v1/leads?view=LIBRARY', {
    headers: authorizationA,
  });
  expect(library.status(), await library.text()).toBe(200);
  const libraryBody = await library.json();
  expect(
    libraryBody.items.some((item: { id: string }) => item.id === lead.id),
  ).toBe(false);
  expect(libraryBody.counts.TRANSFERRED_TO_NOTARY).toBe(0);
  expect(
    (
      await request.get(
        '/api/v1/leads?view=LIBRARY&status=TRANSFERRED_TO_NOTARY',
        {
          headers: authorizationA,
        },
      )
    ).status(),
  ).toBe(400);

  const matterList = await request.get(
    '/api/v1/notary-matters?stage=PENDING_EVIDENCE',
    {
      headers: authorizationA,
    },
  );
  expect(matterList.status(), await matterList.text()).toBe(200);
  const matterListBody = await matterList.json();
  expect(matterListBody.items.map((item: { id: string }) => item.id)).toEqual(
    expect.arrayContaining([winningResult.id, secondResult.id]),
  );
  expect(matterListBody.counts.PENDING_EVIDENCE).toBe(2);
  const archivedList = await request.get(
    '/api/v1/notary-matters?stage=ARCHIVED',
    { headers: authorizationA },
  );
  expect(archivedList.status(), await archivedList.text()).toBe(200);
  expect((await archivedList.json()).items).toEqual([]);
  expect(
    (
      await request.get('/api/v1/notary-matters?stage=UNKNOWN_STAGE', {
        headers: authorizationA,
      })
    ).status(),
  ).toBe(400);
  const selfList = await request.get('/api/v1/notary-matters', {
    headers: authorizationSelf,
  });
  expect(selfList.status(), await selfList.text()).toBe(200);
  expect((await selfList.json()).items).toEqual([]);
  const otherDepartmentList = await request.get('/api/v1/notary-matters', {
    headers: { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
  });
  expect(otherDepartmentList.status(), await otherDepartmentList.text()).toBe(
    200,
  );
  expect((await otherDepartmentList.json()).items).toEqual([]);
  expect((await request.get('/api/v1/notary-matters')).status()).toBe(403);

  await configureBrowser(page);
  await page.goto('/notary-matters');
  await expect(page.locator('[data-test="notary-nav"]')).toHaveClass(/active/u);
  await expect(page.locator('[data-test="matter-row"]')).toHaveCount(2);
  await page.goto('/leads');
  await expect(page.locator('[data-test="lead-row"]')).toHaveCount(0);

  try {
    for (const reject of [
      () => rejectAuditWrites('lead.transferred_to_notary'),
      () => rejectNotaryHandoffReceiptWrites(),
    ]) {
      const candidate = await createInfringementReviewedLead(request, csrf);
      const candidateProduct = (await getLead(candidate.id))!.products[0].id;
      await reject();
      const failed = await transferToNotary(
        request,
        candidate.id,
        office.id,
        [candidateProduct],
        3,
      );
      expect(failed.status()).toBeGreaterThanOrEqual(500);
      expect(await getLead(candidate.id)).toMatchObject({
        status: 'WAITING_EVIDENCE_DECISION',
        version: 3,
      });
      expect(await countNotaryMatters(candidate.id)).toBe(0);
      expect(await countNotaryHandoffReceipts(candidate.id)).toBe(0);
      expect(await countNotaryHandoffAudits(candidate.id)).toBe(0);
    }
  } finally {
    await allowInjectedFailures();
  }

  const decideOnlyCandidate = await createInfringementReviewedLead(
    request,
    csrf,
  );
  const decideOnlyProduct = (await getLead(decideOnlyCandidate.id))!.products[0]
    .id;
  await setGrant('lead.read', false);
  try {
    expect(
      (
        await request.get('/api/v1/notary-matters', {
          headers: authorizationA,
        })
      ).status(),
    ).toBe(403);
    const transferred = await transferToNotary(
      request,
      decideOnlyCandidate.id,
      office.id,
      [decideOnlyProduct],
      3,
    );
    expect(transferred.status(), await transferred.text()).toBe(201);
    expect(await countNotaryMatters(decideOnlyCandidate.id)).toBe(1);
    const matter = await transferred.json();
    expect(
      (
        await request.get(`/api/v1/notary-matters/${matter.id}`, {
          headers: authorizationA,
        })
      ).status(),
    ).toBe(403);
  } finally {
    await setGrant('lead.read', true);
  }
});

test('notary evidence registration enforces scope, validation, version, replay and concurrent winner', async ({
  request,
}) => {
  const client = await createClientAccount(request);
  const csrf = await loginClient(request, client.username, client.password);
  const matterId = await createPendingNotaryMatter(request, csrf);
  const input = {
    evidenceAt: '2026-09-24',
    sampleFeeState: 'PENDING',
    logistics: [
      {
        companyState: 'NONE',
        companyValue: null,
        trackingState: 'NONE',
        trackingValue: null,
      },
    ],
    expectedVersion: 1,
  };
  const before = await request.get(`/api/v1/notary-matters/${matterId}`, {
    headers: authorizationA,
  });
  expect(before.status(), await before.text()).toBe(200);
  expect(await before.json()).toMatchObject({
    stage: 'PENDING_EVIDENCE',
    version: 1,
    capabilities: { recordEvidence: true },
    evidence: null,
  });
  expect(
    (
      await request.post(`/api/v1/notary-matters/${matterId}/evidence`, {
        headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': randomUUID() },
        data: input,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post(`/api/v1/notary-matters/${matterId}/evidence`, {
        headers: authorizationA,
        data: input,
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await recordNotaryEvidence(request, matterId, input, randomUUID(), {
        Authorization: `Bearer ${coreLeadFixtures.tokenB}`,
      })
    ).status(),
  ).toBe(404);
  await setGrant('notary.evidence.record', false);
  expect((await recordNotaryEvidence(request, matterId, input)).status()).toBe(
    403,
  );
  await setGrant('notary.evidence.record', true);
  for (const invalid of [
    { ...input, evidenceAt: '2026-02-30' },
    { ...input, sampleFeeState: 'KNOWN' },
    { ...input, logistics: [] },
    {
      ...input,
      logistics: [
        {
          companyState: 'PRESENT',
          companyValue: '',
          trackingState: 'NONE',
          trackingValue: null,
        },
      ],
    },
  ]) {
    expect(
      (await recordNotaryEvidence(request, matterId, invalid)).status(),
    ).toBe(400);
  }
  expect(
    (
      await recordNotaryEvidence(request, matterId, {
        ...input,
        expectedVersion: 99,
      })
    ).status(),
  ).toBe(409);
  expect(await countNotaryEvidence(matterId)).toBe(0);
  const key = randomUUID();
  const competing = await Promise.all([
    recordNotaryEvidence(request, matterId, input, key),
    recordNotaryEvidence(request, matterId, {
      ...input,
      evidenceAt: '2026-09-23',
    }),
  ]);
  expect(competing.map((response) => response.status()).sort()).toEqual([
    201, 409,
  ]);
  expect(await countNotaryEvidence(matterId)).toBe(1);
  expect(await countNotaryLogistics(matterId)).toBe(1);
  expect(await countNotaryEvidenceReceipts(matterId)).toBe(1);
  expect(await countNotaryEvidenceAudits(matterId)).toBe(1);
  const winner = competing.find((response) => response.status() === 201)!;
  const saved = await winner.json();
  expect(saved).toMatchObject({
    id: matterId,
    stage: 'WAITING_UNBOX',
    version: 2,
    evidence: {
      sampleFeeState: 'PENDING',
      sampleFeeAmount: null,
      logistics: [{ companyState: 'NONE', trackingState: 'NONE' }],
    },
  });
  const detail = await request.get(`/api/v1/notary-matters/${matterId}`, {
    headers: authorizationA,
  });
  expect(await detail.json()).toMatchObject({
    stage: 'WAITING_UNBOX',
    version: 2,
    capabilities: { recordEvidence: false },
    evidence: saved.evidence,
  });
  const waitingList = await request.get(
    '/api/v1/notary-matters?stage=WAITING_UNBOX',
    {
      headers: authorizationA,
    },
  );
  expect(waitingList.status(), await waitingList.text()).toBe(200);
  expect(await waitingList.json()).toMatchObject({
    total: 1,
    counts: { PENDING_EVIDENCE: 0, WAITING_UNBOX: 1, UNBOX_REVIEW: 0 },
  });
  if (saved.evidence.evidenceAt === input.evidenceAt) {
    const replay = await recordNotaryEvidence(request, matterId, input, key);
    expect(replay.status()).toBe(201);
    expect(await replay.json()).toEqual(saved);
    expect(
      (
        await recordNotaryEvidence(
          request,
          matterId,
          { ...input, evidenceAt: '2026-09-22' },
          key,
        )
      ).status(),
    ).toBe(409);
  }
  expect((await recordNotaryEvidence(request, matterId, input)).status()).toBe(
    409,
  );
  await setGrant('notary.evidence.record', false);
  expect(
    (await recordNotaryEvidence(request, matterId, input, key)).status(),
  ).toBe(403);
});

test('notary evidence audit, fact or receipt failure rolls back every durable change', async ({
  request,
}) => {
  const client = await createClientAccount(request);
  const csrf = await loginClient(request, client.username, client.password);
  const input = {
    evidenceAt: '2026-09-24',
    sampleFeeState: 'KNOWN',
    sampleFeeAmount: '10.00',
    logistics: [
      {
        companyState: 'PRESENT',
        companyValue: '真实快递',
        trackingState: 'PRESENT',
        trackingValue: 'REAL-1',
      },
    ],
    expectedVersion: 1,
  };
  try {
    for (const inject of [
      rejectNotaryEvidenceWrites,
      () => rejectAuditWrites('notary.evidence_recorded'),
      rejectNotaryEvidenceReceiptWrites,
    ]) {
      const matterId = await createPendingNotaryMatter(request, csrf);
      await inject();
      const failed = await recordNotaryEvidence(request, matterId, input);
      expect(failed.status()).toBeGreaterThanOrEqual(500);
      const detail = await request.get(`/api/v1/notary-matters/${matterId}`, {
        headers: authorizationA,
      });
      expect(await detail.json()).toMatchObject({
        stage: 'PENDING_EVIDENCE',
        version: 1,
        evidence: null,
      });
      expect(await countNotaryEvidence(matterId)).toBe(0);
      expect(await countNotaryLogistics(matterId)).toBe(0);
      expect(await countNotaryEvidenceReceipts(matterId)).toBe(0);
      expect(await countNotaryEvidenceAudits(matterId)).toBe(0);
      await allowInjectedFailures();
    }
  } finally {
    await allowInjectedFailures();
  }
});

test('notary opening enforces scope, photo ownership, state, version, replay and one concurrent winner', async ({
  request,
}) => {
  const client = await createClientAccount(request);
  const csrf = await loginClient(request, client.username, client.password);
  const matterId = await createWaitingUnboxMatter(request, csrf);
  const otherMatterId = await createWaitingUnboxMatter(request, csrf);
  const photo = await upload(request, {
    ownerType: 'NOTARY_MATTER',
    ownerId: matterId,
    purpose: 'NOTARY_OPENING_PHOTO',
    name: 'opening.jpg',
    mime: 'image/jpeg',
    bytes: jpegBytes,
  });
  const otherPhoto = await upload(request, {
    ownerType: 'NOTARY_MATTER',
    ownerId: otherMatterId,
    purpose: 'NOTARY_OPENING_PHOTO',
    name: 'other.jpg',
    mime: 'image/jpeg',
    bytes: jpegBytes,
  });
  const input = {
    expectedVersion: 2,
    contentVersionIds: [photo.contentVersionId],
    senderName: '  真实寄件人  ',
  };
  const before = await request.get(`/api/v1/notary-matters/${matterId}`, {
    headers: authorizationA,
  });
  expect(await before.json()).toMatchObject({
    stage: 'WAITING_UNBOX',
    version: 2,
    opening: null,
    capabilities: { recordOpening: true },
  });
  expect(
    (
      await request.post(`/api/v1/notary-matters/${matterId}/opening`, {
        headers: authorizationA,
        data: input,
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await recordNotaryOpening(request, matterId, input, randomUUID(), {
        'X-CSRF-Token': csrf,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await recordNotaryOpening(request, matterId, input, randomUUID(), {
        Authorization: `Bearer ${coreLeadFixtures.tokenB}`,
      })
    ).status(),
  ).toBe(404);
  await setGrant('notary.unbox.record', false);
  expect((await recordNotaryOpening(request, matterId, input)).status()).toBe(
    403,
  );
  await setGrant('notary.unbox.record', true);
  for (const invalid of [
    { ...input, contentVersionIds: [] },
    {
      ...input,
      contentVersionIds: [photo.contentVersionId, photo.contentVersionId],
    },
    { ...input, contentVersionIds: [otherPhoto.contentVersionId] },
    { ...input, expectedVersion: 99 },
  ]) {
    const response = await recordNotaryOpening(request, matterId, invalid);
    expect([400, 409].includes(response.status()), await response.text()).toBe(
      true,
    );
  }
  await markContentVersion(photo.contentVersionId, 'DELETED');
  expect((await recordNotaryOpening(request, matterId, input)).status()).toBe(
    400,
  );
  await markContentVersion(photo.contentVersionId, 'AVAILABLE');
  expect(await countNotaryOpenings(matterId)).toBe(0);
  const pendingId = await createPendingNotaryMatter(request, csrf);
  expect((await recordNotaryOpening(request, pendingId, input)).status()).toBe(
    409,
  );

  const key = randomUUID();
  const outcomes = await Promise.all([
    recordNotaryOpening(request, matterId, input, key),
    recordNotaryOpening(request, matterId, {
      ...input,
      senderName: '另一寄件人',
    }),
  ]);
  expect(outcomes.map((response) => response.status()).sort()).toEqual([
    201, 409,
  ]);
  const winner = outcomes.find((response) => response.status() === 201)!;
  const result = await winner.json();
  expect(result).toMatchObject({
    id: matterId,
    stage: 'UNBOX_REVIEW',
    version: 3,
    opening: { photos: [{ contentVersionId: photo.contentVersionId }] },
  });
  expect(await countNotaryOpenings(matterId)).toBe(1);
  expect(await countNotaryOpeningReceipts(matterId)).toBe(1);
  expect(await countNotaryOpeningAudits(matterId)).toBe(1);
  expect(await countNotaryOpeningReferences(matterId)).toBe(1);
  const detail = await request.get(`/api/v1/notary-matters/${matterId}`, {
    headers: authorizationA,
  });
  expect(await detail.json()).toMatchObject({
    stage: 'UNBOX_REVIEW',
    version: 3,
    opening: { photos: [{ originalFilename: 'opening.jpg' }] },
    capabilities: { recordOpening: false },
  });
  const reviewList = await request.get(
    '/api/v1/notary-matters?stage=UNBOX_REVIEW',
    {
      headers: authorizationA,
    },
  );
  expect(reviewList.status(), await reviewList.text()).toBe(200);
  expect(await reviewList.json()).toMatchObject({
    total: 1,
    counts: { PENDING_EVIDENCE: 1, WAITING_UNBOX: 1, UNBOX_REVIEW: 1 },
  });
  const stored = await getMaterialByVersion(photo.contentVersionId);
  expect(stored).not.toBeNull();
  const download = await request.get(
    `/api/v1/materials/${stored!.materialId}/versions/${photo.contentVersionId}/content`,
    { headers: authorizationA },
  );
  expect(download.status()).toBe(200);
  expect(await download.body()).toEqual(jpegBytes);
  const clientDownload = await request.get(
    `/api/v1/materials/${stored!.materialId}/versions/${photo.contentVersionId}/content`,
    { headers: { 'X-CSRF-Token': csrf } },
  );
  expect(clientDownload.status(), await clientDownload.text()).toBe(200);
  expect(await clientDownload.body()).toEqual(jpegBytes);
  expect(
    (
      await request.get(
        `/api/v1/materials/${stored!.materialId}/versions/${photo.contentVersionId}/content`,
        { headers: { Authorization: `Bearer ${coreLeadFixtures.tokenB}` } },
      )
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.delete(
        `/api/v1/materials/${stored!.materialId}?expectedVersion=1`,
        { headers: authorizationA },
      )
    ).status(),
  ).toBe(409);
  const replay = await recordNotaryOpening(request, matterId, input, key);
  if (result.opening.senderName === '真实寄件人') {
    expect(replay.status()).toBe(201);
    expect(await replay.json()).toEqual(result);
    expect(
      (
        await recordNotaryOpening(
          request,
          matterId,
          {
            ...input,
            senderName: 'changed',
          },
          key,
        )
      ).status(),
    ).toBe(409);
  }
  await setGrant('notary.unbox.record', false);
  expect(
    (await recordNotaryOpening(request, matterId, input, key)).status(),
  ).toBe(403);
});

test('notary opening fact, audit or receipt failure rolls back stage, photos and receipt', async ({
  request,
}) => {
  const client = await createClientAccount(request);
  const csrf = await loginClient(request, client.username, client.password);
  try {
    for (const inject of [
      rejectNotaryOpeningWrites,
      () => rejectAuditWrites('notary.opening_recorded'),
      rejectNotaryOpeningReferenceWrites,
      rejectNotaryEvidenceReceiptWrites,
    ]) {
      const matterId = await createWaitingUnboxMatter(request, csrf);
      const photo = await upload(request, {
        ownerType: 'NOTARY_MATTER',
        ownerId: matterId,
        purpose: 'NOTARY_OPENING_PHOTO',
        name: 'rollback.jpg',
        mime: 'image/jpeg',
        bytes: jpegBytes,
      });
      await inject();
      const failed = await recordNotaryOpening(request, matterId, {
        expectedVersion: 2,
        contentVersionIds: [photo.contentVersionId],
      });
      expect(failed.status()).toBeGreaterThanOrEqual(500);
      const detail = await request.get(`/api/v1/notary-matters/${matterId}`, {
        headers: authorizationA,
      });
      expect(await detail.json()).toMatchObject({
        stage: 'WAITING_UNBOX',
        version: 2,
        opening: null,
      });
      expect(await countNotaryOpenings(matterId)).toBe(0);
      expect(await countNotaryOpeningAudits(matterId)).toBe(0);
      expect(await countNotaryOpeningReceipts(matterId)).toBe(0);
      expect(await countNotaryOpeningReferences(matterId)).toBe(0);
      await allowInjectedFailures();
    }
  } finally {
    await allowInjectedFailures();
  }
});

test('notary portal opening rolls back, replays once and races the operator safely', async ({
  request,
}) => {
  const client = await createClientAccount(request);
  const clientCsrf = await loginClient(
    request,
    client.username,
    client.password,
  );
  const matterId = await createWaitingUnboxMatter(request, clientCsrf);
  const racingMatterId = await createWaitingUnboxMatter(request, clientCsrf);
  const notary = await createNotaryAccountForMatter(request, matterId);
  const photo = await upload(
    request,
    {
      ownerType: 'NOTARY_MATTER',
      ownerId: matterId,
      purpose: 'NOTARY_OPENING_PHOTO',
      name: 'notary-rollback.jpg',
      mime: 'image/jpeg',
      bytes: jpegBytes,
    },
    { 'X-CSRF-Token': notary.csrfToken },
  );
  const input = {
    expectedVersion: 2,
    contentVersionIds: [photo.contentVersionId],
    senderName: '外部公证处',
  };
  const key = randomUUID();
  try {
    await rejectAuditWrites('notary.opening_recorded');
    const failed = await recordNotaryPortalOpening(
      request,
      matterId,
      input,
      notary.csrfToken,
      key,
    );
    expect(failed.status()).toBeGreaterThanOrEqual(500);
    const unchanged = await request.get(`/api/v1/notary-matters/${matterId}`, {
      headers: authorizationA,
    });
    expect(await unchanged.json()).toMatchObject({
      stage: 'WAITING_UNBOX',
      version: 2,
      opening: null,
    });
    expect(await countNotaryOpenings(matterId)).toBe(0);
    expect(await countNotaryOpeningAudits(matterId)).toBe(0);
    expect(await countNotaryOpeningReceipts(matterId)).toBe(0);
    expect(await countNotaryOpeningReferences(matterId)).toBe(0);
  } finally {
    await allowInjectedFailures();
  }
  const first = await recordNotaryPortalOpening(
    request,
    matterId,
    input,
    notary.csrfToken,
    key,
  );
  expect(first.status(), await first.text()).toBe(201);
  const result = await first.json();
  const replay = await recordNotaryPortalOpening(
    request,
    matterId,
    input,
    notary.csrfToken,
    key,
  );
  expect(replay.status()).toBe(201);
  expect(await replay.json()).toEqual(result);
  expect(
    (
      await recordNotaryPortalOpening(
        request,
        matterId,
        { ...input, senderName: 'changed' },
        notary.csrfToken,
        key,
      )
    ).status(),
  ).toBe(409);
  expect(
    (
      await recordNotaryPortalOpening(
        request,
        matterId,
        input,
        notary.csrfToken,
      )
    ).status(),
  ).toBe(409);
  expect(await countNotaryOpenings(matterId)).toBe(1);
  expect(await countNotaryOpeningAudits(matterId)).toBe(1);
  expect(await countNotaryOpeningReceipts(matterId)).toBe(1);

  const racingNotary = await createNotaryAccountForMatter(
    request,
    racingMatterId,
  );
  const racingPhoto = await upload(
    request,
    {
      ownerType: 'NOTARY_MATTER',
      ownerId: racingMatterId,
      purpose: 'NOTARY_OPENING_PHOTO',
      name: 'notary-race.jpg',
      mime: 'image/jpeg',
      bytes: jpegBytes,
    },
    { 'X-CSRF-Token': racingNotary.csrfToken },
  );
  const racingInput = {
    expectedVersion: 2,
    contentVersionIds: [racingPhoto.contentVersionId],
  };
  const outcomes = await Promise.all([
    recordNotaryPortalOpening(
      request,
      racingMatterId,
      racingInput,
      racingNotary.csrfToken,
    ),
    recordNotaryOpening(request, racingMatterId, racingInput),
  ]);
  expect(outcomes.map((response) => response.status()).sort()).toEqual([
    201, 409,
  ]);
  expect(await countNotaryOpenings(racingMatterId)).toBe(1);
  expect(await countNotaryOpeningAudits(racingMatterId)).toBe(1);
  expect(await countNotaryOpeningReceipts(racingMatterId)).toBe(1);
  expect(await countNotaryOpeningReferences(racingMatterId)).toBe(1);
});

test('notary photo upload and opening serialize on the same matter row', async ({
  request,
}) => {
  test.setTimeout(60_000);
  const client = await createClientAccount(request);
  const clientCsrf = await loginClient(
    request,
    client.username,
    client.password,
  );
  const matterId = await createWaitingUnboxMatter(request, clientCsrf);
  const notary = await createNotaryAccountForMatter(request, matterId);
  const firstPhoto = await upload(
    request,
    {
      ownerType: 'NOTARY_MATTER',
      ownerId: matterId,
      purpose: 'NOTARY_OPENING_PHOTO',
      name: 'first-opening.jpg',
      mime: 'image/jpeg',
      bytes: jpegBytes,
    },
    { 'X-CSRF-Token': notary.csrfToken },
  );
  const draft = await request.post('/api/v1/materials/upload-drafts', {
    headers: { 'X-CSRF-Token': notary.csrfToken },
    data: {
      ownerType: 'NOTARY_MATTER',
      ownerId: matterId,
      category: 'NOTARY_OPENING_PHOTO',
      purpose: 'NOTARY_OPENING_PHOTO',
      originalFilename: 'racing-opening.jpg',
      declaredMimeType: 'image/jpeg',
    },
  });
  expect(draft.status(), await draft.text()).toBe(201);
  const draftId = ((await draft.json()) as { id: string }).id;
  const barrier = await installNotaryUploadInsertBarrier(matterId);
  let released = false;
  try {
    const finalizing = request.put(
      `/api/v1/materials/upload-drafts/${draftId}/content`,
      {
        headers: {
          'X-CSRF-Token': notary.csrfToken,
          'Content-Type': 'application/octet-stream',
        },
        data: jpegBytes,
      },
    );
    await barrier.wait();
    const opening = recordNotaryPortalOpening(
      request,
      matterId,
      { expectedVersion: 2, contentVersionIds: [firstPhoto.contentVersionId] },
      notary.csrfToken,
    );
    await barrier.waitForOpeningLock();
    await barrier.release();
    released = true;
    const [uploaded, opened] = await Promise.all([finalizing, opening]);
    expect(uploaded.status(), await uploaded.text()).toBe(200);
    expect(opened.status(), await opened.text()).toBe(201);
  } finally {
    if (!released) await barrier.release();
  }
  expect(await countNotaryOpenings(matterId)).toBe(1);
  expect(await countNotaryOpeningReferences(matterId)).toBe(1);
  const operatorDetail = await request.get(
    `/api/v1/notary-matters/${matterId}`,
    {
      headers: authorizationA,
    },
  );
  expect(await operatorDetail.json()).toMatchObject({
    stage: 'UNBOX_REVIEW',
    version: 3,
  });
});

test('opening review uses real operator and client identities, independent grant and durable replay', async ({
  request,
}) => {
  const account = await createClientAccount(request);
  const csrf = await loginClient(request, account.username, account.password);
  const internalMatter = await createOpenedNotaryMatter(request, csrf);
  const clientMatter = await createOpenedNotaryMatter(request, csrf);
  const noPhotoMatter = await createOpenedNotaryMatter(request, csrf);
  await removeNotaryOpeningReviewPhotoReferences(noPhotoMatter);
  const pendingMatter = await createWaitingUnboxMatter(request, csrf);
  const requestBody = { result: 'INFRINGEMENT', expectedVersion: 3 };
  expect(
    (
      await reviewNotaryOpening(request, pendingMatter, {
        ...requestBody,
        expectedVersion: 2,
      })
    ).status(),
  ).toBe(409);
  expect(
    (await reviewNotaryOpening(request, noPhotoMatter, requestBody)).status(),
  ).toBe(409);
  expect(
    (
      await reviewNotaryOpening(request, internalMatter, {
        ...requestBody,
        expectedVersion: 2,
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.post(
        `/api/v1/notary-matters/${internalMatter}/opening-review`,
        {
          headers: {
            Authorization: `Bearer ${coreLeadFixtures.tokenB}`,
            'Idempotency-Key': randomUUID(),
          },
          data: requestBody,
        },
      )
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post(
        `/api/v1/notary-matters/${internalMatter}/opening-review`,
        {
          headers: { ...authorizationSelf, 'Idempotency-Key': randomUUID() },
          data: requestBody,
        },
      )
    ).status(),
  ).toBe(403);
  await setGrant('notary.opening.review', false);
  expect(
    (await reviewNotaryOpening(request, internalMatter, requestBody)).status(),
  ).toBe(403);
  await setGrant('notary.opening.review', true);
  const key = randomUUID();
  const first = await reviewNotaryOpening(
    request,
    internalMatter,
    requestBody,
    key,
  );
  expect(first.status(), await first.text()).toBe(201);
  expect(await first.json()).toMatchObject({
    id: internalMatter,
    stage: 'ISSUANCE_DECISION',
    version: 4,
    reviewDecision: { actorKind: 'INTERNAL' },
  });
  const replay = await reviewNotaryOpening(
    request,
    internalMatter,
    requestBody,
    key,
  );
  expect(replay.status()).toBe(201);
  expect(await replay.json()).toEqual(await first.json());
  expect(
    (
      await reviewNotaryOpening(
        request,
        internalMatter,
        { ...requestBody, expectedVersion: 4 },
        key,
      )
    ).status(),
  ).toBe(409);
  expect(await countNotaryOpeningReviewDecisions(internalMatter)).toBe(1);
  expect(await countNotaryOpeningReviewAudits(internalMatter)).toBe(1);
  expect(await countNotaryOpeningReviewReceipts(internalMatter)).toBe(1);
  const clientFirst = await reviewNotaryOpening(
    request,
    clientMatter,
    { result: 'NO_INFRINGEMENT', reason: '  未见侵权  ', expectedVersion: 3 },
    randomUUID(),
    csrf,
  );
  expect(clientFirst.status(), await clientFirst.text()).toBe(201);
  expect(await clientFirst.json()).toMatchObject({
    stage: 'ARCHIVED',
    version: 4,
    reviewDecision: { actorKind: 'CLIENT', reason: '未见侵权' },
  });
  expect(await countNotaryOpeningReviewAudits(clientMatter)).toBe(1);
  await setClientBindingActive(coreLeadFixtures.admittedCustomer, false);
  expect(
    (
      await reviewNotaryOpening(
        request,
        clientMatter,
        { result: 'NO_INFRINGEMENT', reason: '未见侵权', expectedVersion: 3 },
        randomUUID(),
        csrf,
      )
    ).status(),
  ).toBe(401);
  const foreign = await createClientAccount(request, {
    customerId: coreLeadFixtures.foreignCustomer,
    headers: { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
  });
  const foreignCsrf = await loginClient(
    request,
    foreign.username,
    foreign.password,
  );
  expect(
    (
      await reviewNotaryOpening(
        request,
        internalMatter,
        requestBody,
        randomUUID(),
        foreignCsrf,
      )
    ).status(),
  ).toBe(404);
});

test('opening review rejects a forged reference when its committed photo is unavailable', async ({
  request,
}) => {
  const account = await createClientAccount(request);
  const csrf = await loginClient(request, account.username, account.password);
  const matterId = await createWaitingUnboxMatter(request, csrf);
  const committedPhoto = await upload(request, {
    ownerType: 'NOTARY_MATTER',
    ownerId: matterId,
    purpose: 'NOTARY_OPENING_PHOTO',
    name: 'committed-review.jpg',
    mime: 'image/jpeg',
    bytes: jpegBytes,
  });
  const unsubmitted = await upload(request, {
    ownerType: 'NOTARY_MATTER',
    ownerId: matterId,
    purpose: 'NOTARY_OPENING_PHOTO',
    name: 'unsubmitted-review.jpg',
    mime: 'image/jpeg',
    bytes: jpegBytes,
  });
  const opening = await recordNotaryOpening(request, matterId, {
    expectedVersion: 2,
    contentVersionIds: [committedPhoto.contentVersionId],
  });
  expect(opening.status(), await opening.text()).toBe(201);
  await forgeSameMatterOpeningPhotoReference(
    matterId,
    unsubmitted.materialId,
    unsubmitted.contentVersionId,
  );
  await markContentVersion(committedPhoto.contentVersionId, 'DELETED');

  const review = await reviewNotaryOpening(request, matterId, {
    result: 'INFRINGEMENT',
    expectedVersion: 3,
  });
  expect(review.status(), await review.text()).toBe(409);
  expect((await review.json()).code).toBe('OPENING_PHOTO_REQUIRED');
  expect(await getNotaryOpeningReviewMatter(matterId)).toEqual({
    stage: 'UNBOX_REVIEW',
    version: 3,
  });
  expect(await countNotaryOpeningReviewDecisions(matterId)).toBe(0);
  expect(await countNotaryOpeningReviewAudits(matterId)).toBe(0);
  expect(await countNotaryOpeningReviewReceipts(matterId)).toBe(0);
});

test('client notary reads and photo bytes stay within enterprise, exact batch and live binding', async ({
  request,
}) => {
  const own = await createClientAccount(request);
  const csrf = await loginClient(request, own.username, own.password);
  const firstId = await createOpenedNotaryMatter(request, csrf);
  const firstOperator = await request.get(`/api/v1/notary-matters/${firstId}`, {
    headers: authorizationA,
  });
  expect(firstOperator.status()).toBe(200);
  const firstFact = await firstOperator.json();
  const lead = await getLead(firstFact.leadId);
  const second = await transferToNotary(
    request,
    firstFact.leadId,
    firstFact.notaryOffice.id,
    [lead!.products[0].id],
    4,
    randomUUID(),
    true,
  );
  expect(second.status(), await second.text()).toBe(201);
  const secondId = (await second.json()).id as string;
  expect(
    (
      await recordNotaryEvidence(request, secondId, {
        evidenceAt: '2026-09-24',
        sampleFeeState: 'PENDING',
        logistics: [{ companyState: 'NONE', trackingState: 'NONE' }],
        expectedVersion: 1,
      })
    ).status(),
  ).toBe(201);
  const secondPhoto = await upload(request, {
    ownerType: 'NOTARY_MATTER',
    ownerId: secondId,
    purpose: 'NOTARY_OPENING_PHOTO',
    name: 'second.jpg',
    mime: 'image/jpeg',
    bytes: jpegBytes,
  });
  const unsubmittedPhoto = await upload(request, {
    ownerType: 'NOTARY_MATTER',
    ownerId: secondId,
    purpose: 'NOTARY_OPENING_PHOTO',
    name: 'unsubmitted.jpg',
    mime: 'image/jpeg',
    bytes: jpegBytes,
  });
  expect(
    (
      await recordNotaryOpening(request, secondId, {
        expectedVersion: 2,
        contentVersionIds: [secondPhoto.contentVersionId],
      })
    ).status(),
  ).toBe(201);
  await forgeSameMatterOpeningPhotoReference(
    secondId,
    unsubmittedPhoto.materialId,
    unsubmittedPhoto.contentVersionId,
  );

  const list = await request.get('/api/v1/client/notary-matters');
  expect(list.status(), await list.text()).toBe(200);
  const listed = await list.json();
  expect(listed.items.map((item: { id: string }) => item.id)).toEqual(
    expect.arrayContaining([firstId, secondId]),
  );
  const detail = await request.get(`/api/v1/client/notary-matters/${firstId}`);
  expect(detail.status(), await detail.text()).toBe(200);
  const body = await detail.json();
  expect(body.opening.photos).toHaveLength(1);
  expect(body.capabilities.reviewOpening).toBe(true);
  expect(JSON.stringify(body)).not.toMatch(
    /sender|logistics|sampleFee|responsibleUserId|teamId|sourceSnapshot|actorUserId/u,
  );
  const firstPhoto = body.opening.photos[0];
  const path = (materialId: string, versionId: string) =>
    `/api/v1/materials/${materialId}/versions/${versionId}/content`;
  const bytes = await request.get(
    path(firstPhoto.materialId, firstPhoto.contentVersionId),
  );
  expect(bytes.status()).toBe(200);
  expect(await bytes.body()).toEqual(jpegBytes);
  const otherBatch = await request.get(
    path(secondPhoto.materialId, secondPhoto.contentVersionId),
  );
  expect(otherBatch.status()).toBe(200);
  const secondDetail = await request.get(
    `/api/v1/client/notary-matters/${secondId}`,
  );
  expect(secondDetail.status(), await secondDetail.text()).toBe(200);
  expect(
    (await secondDetail.json()).opening.photos.map(
      (photo: { contentVersionId: string }) => photo.contentVersionId,
    ),
  ).toEqual([secondPhoto.contentVersionId]);
  const secondOperator = await request.get(
    `/api/v1/notary-matters/${secondId}`,
    { headers: authorizationA },
  );
  expect(secondOperator.status(), await secondOperator.text()).toBe(200);
  expect(
    (await secondOperator.json()).opening.photos.map(
      (photo: { contentVersionId: string }) => photo.contentVersionId,
    ),
  ).toEqual([secondPhoto.contentVersionId]);
  const materials = await request.get(
    `/api/v1/materials?ownerType=NOTARY_MATTER&ownerId=${secondId}`,
  );
  expect(materials.status(), await materials.text()).toBe(200);
  expect(
    (await materials.json()).items.map((item: { id: string }) => item.id),
  ).toEqual([secondPhoto.materialId]);
  expect(
    (
      await request.get(
        path(unsubmittedPhoto.materialId, unsubmittedPhoto.contentVersionId),
      )
    ).status(),
  ).toBe(404);
  const wrongVersion = await request.get(
    path(firstPhoto.materialId, secondPhoto.contentVersionId),
  );
  expect(wrongVersion.status()).toBe(404);

  const reviewed = await reviewNotaryOpening(
    request,
    firstId,
    { result: 'NO_INFRINGEMENT', reason: '无侵权', expectedVersion: 3 },
    randomUUID(),
    csrf,
  );
  expect(reviewed.status(), await reviewed.text()).toBe(201);
  const pendingAfterReview = await request.get('/api/v1/client/notary-matters');
  expect(
    (await pendingAfterReview.json()).items.map(
      (item: { id: string }) => item.id,
    ),
  ).not.toContain(firstId);
  const batches = await request.get(
    `/api/v1/client/notary-matters?sourceLeadId=${firstFact.leadId}`,
  );
  expect(batches.status(), await batches.text()).toBe(200);
  expect(
    (await batches.json()).items.map((item: { id: string; stage: string }) => [
      item.id,
      item.stage,
    ]),
  ).toEqual(
    expect.arrayContaining([
      [firstId, 'ARCHIVED'],
      [secondId, 'UNBOX_REVIEW'],
    ]),
  );
  const archivedDetail = await request.get(
    `/api/v1/client/notary-matters/${firstId}`,
  );
  expect((await archivedDetail.json()).reviewDecision).toMatchObject({
    result: 'NO_INFRINGEMENT',
    reason: '无侵权',
  });

  const foreign = await createClientAccount(request, {
    customerId: coreLeadFixtures.foreignCustomer,
    headers: { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
  });
  await loginClient(request, foreign.username, foreign.password);
  const foreignBatches = await request.get(
    `/api/v1/client/notary-matters?sourceLeadId=${firstFact.leadId}`,
  );
  expect((await foreignBatches.json()).items).toEqual([]);
  expect(
    (await request.get(`/api/v1/client/notary-matters/${firstId}`)).status(),
  ).toBe(404);
  expect(
    (
      await request.get(
        path(firstPhoto.materialId, firstPhoto.contentVersionId),
      )
    ).status(),
  ).toBe(404);
  await loginClient(request, own.username, own.password);
  await setClientBindingActive(coreLeadFixtures.admittedCustomer, false);
  expect(
    (await request.get(`/api/v1/client/notary-matters/${firstId}`)).status(),
  ).toBe(401);
  expect(
    (
      await request.get(
        path(firstPhoto.materialId, firstPhoto.contentVersionId),
      )
    ).status(),
  ).toBe(401);
});

test('real operator and client browser reviews preserve batch history, isolate photos, and show loading and permission states', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const client = await createClientAccount(request);
  const clientCsrf = await loginClient(
    request,
    client.username,
    client.password,
  );
  const operatorMatterId = await createOpenedNotaryMatter(request, clientCsrf);
  const returnMatterId = await createOpenedNotaryMatter(request, clientCsrf);
  const returnFactResponse = await request.get(
    `/api/v1/notary-matters/${returnMatterId}`,
    { headers: authorizationA },
  );
  expect(returnFactResponse.status(), await returnFactResponse.text()).toBe(
    200,
  );
  const returnFact = await returnFactResponse.json();
  const operatorFactResponse = await request.get(
    `/api/v1/notary-matters/${operatorMatterId}`,
    { headers: authorizationA },
  );
  expect(operatorFactResponse.status(), await operatorFactResponse.text()).toBe(
    200,
  );
  const operatorFact = await operatorFactResponse.json();
  const lead = await getLead(operatorFact.leadId);
  expect(lead).not.toBeNull();

  const secondBatchResponse = await transferToNotary(
    request,
    operatorFact.leadId,
    operatorFact.notaryOffice.id,
    [lead!.products[0].id],
    lead!.version,
    randomUUID(),
    true,
  );
  expect(secondBatchResponse.status(), await secondBatchResponse.text()).toBe(
    201,
  );
  const secondBatch = await secondBatchResponse.json();
  const secondEvidence = await recordNotaryEvidence(request, secondBatch.id, {
    evidenceAt: '2026-09-24',
    sampleFeeState: 'KNOWN',
    sampleFeeAmount: '99.99',
    logistics: [
      {
        companyState: 'PRESENT',
        companyValue: '内部专用快递名称',
        trackingState: 'PRESENT',
        trackingValue: 'INTERNAL-TRACKING-NT003',
      },
    ],
    expectedVersion: 1,
  });
  expect(secondEvidence.status(), await secondEvidence.text()).toBe(201);
  const clientPhoto = await upload(request, {
    ownerType: 'NOTARY_MATTER',
    ownerId: secondBatch.id,
    purpose: 'NOTARY_OPENING_PHOTO',
    name: 'client-opening-nt003.jpg',
    mime: 'image/jpeg',
    bytes: secondOpeningPhotoBytes,
  });
  const secondOpening = await recordNotaryOpening(request, secondBatch.id, {
    expectedVersion: 2,
    contentVersionIds: [clientPhoto.contentVersionId],
    senderName: '内部专用寄件人-NT003',
    senderPhone: '13800000009',
  });
  expect(secondOpening.status(), await secondOpening.text()).toBe(201);

  const readOnlyMatterId = await createOpenedNotaryMatter(request, clientCsrf);
  const pendingEvidenceMatterId = await createPendingNotaryMatter(
    request,
    clientCsrf,
  );
  const pendingEvidenceFactResponse = await request.get(
    `/api/v1/notary-matters/${pendingEvidenceMatterId}`,
    { headers: authorizationA },
  );
  expect(
    pendingEvidenceFactResponse.status(),
    await pendingEvidenceFactResponse.text(),
  ).toBe(200);
  const pendingEvidenceBusinessNo = (await pendingEvidenceFactResponse.json())
    .businessNo as string;

  await page.goto('/customers');
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/u);
  await expect(page.locator('[data-test="app-shell"]')).toBeVisible();
  const internalListStatus = await page.evaluate(
    async () =>
      (
        await fetch('/api/v1/notary-matters?page=1&pageSize=1', {
          credentials: 'same-origin',
        })
      ).status,
  );
  expect(internalListStatus).toBe(200);
  await expect(page.locator('[data-test="notary-nav"]')).toBeVisible();
  await page.locator('[data-test="notary-nav"]').click();
  const operatorMatterRow = page
    .locator('[data-test="matter-row"]')
    .filter({ hasText: operatorFact.businessNo });
  await expect(operatorMatterRow).toBeVisible();
  await operatorMatterRow.locator('[data-test="matter-link"]').click();
  await expect(page).toHaveURL(
    new RegExp(`/notary-matters/${operatorMatterId}(\\?|$)`, 'u'),
  );
  await expect(
    page.locator('[data-test="notary-matter-detail"]'),
  ).toBeVisible();
  await expect(page.locator('[data-test="opening-review-form"]')).toBeVisible();

  let releaseReviewRequest = () => {};
  let markRequestIntercepted = () => {};
  const requestIntercepted = new Promise<void>((resolve) => {
    markRequestIntercepted = resolve;
  });
  const continueReviewRequest = new Promise<void>((resolve) => {
    releaseReviewRequest = resolve;
  });
  const reviewRoute = `**/api/v1/notary-matters/${operatorMatterId}/opening-review`;
  await page.route(reviewRoute, async (route) => {
    markRequestIntercepted();
    await continueReviewRequest;
    await route.continue();
  });
  await page.locator('[data-test="opening-review-result"]').check();
  const operatorSubmit = page.locator('[data-test="opening-review-submit"]');
  await operatorSubmit.click();
  await requestIntercepted;
  await expect(operatorSubmit).toBeDisabled();
  releaseReviewRequest();
  await expect(
    page.locator('[data-test="opening-review-record"]'),
  ).toContainText('确认侵权');
  await page.unroute(reviewRoute);
  await expect(
    page.locator('[data-test="opening-review-record"]'),
  ).toContainText('确认侵权');
  await expect(getNotaryOpeningReviewMatter(operatorMatterId)).resolves.toEqual(
    {
      stage: 'ISSUANCE_DECISION',
      version: 4,
    },
  );
  expect(await countNotaryOpeningReviewDecisions(operatorMatterId)).toBe(1);

  await page.locator('[data-test="issuance-decision-issue"]').check();
  await page.locator('[data-test="issuance-decision-submit"]').click();
  await expect(
    page.locator('[data-test="issuance-decision-record"]'),
  ).toContainText('待出证');
  await expect(
    page.locator('[data-test="notary-matter-detail"]'),
  ).not.toContainText('决定是否出证');
  await page.goto('/notary-matters');
  const returnMatterRow = page
    .locator('[data-test="matter-row"]')
    .filter({ hasText: returnFact.businessNo });
  await expect(returnMatterRow).toBeVisible();
  await returnMatterRow.locator('[data-test="matter-link"]').click();
  await page.locator('[data-test="opening-review-result"]').check();
  await page.locator('[data-test="opening-review-submit"]').click();
  await expect(
    page.locator('[data-test="issuance-decision-section"]'),
  ).toBeVisible();
  await page.locator('[data-test="issuance-decision-no-issue"]').check();
  await page.locator('[data-test="issuance-decision-submit"]').click();
  await expect(
    page.locator('[data-test="issuance-decision-record"]'),
  ).toContainText('待退货');
  await page.reload();
  await expect(
    page.locator('[data-test="issuance-decision-record"]'),
  ).toContainText('NO_ISSUE');
  await expect(page.getByRole('button', { name: '完成出证' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '办理退货' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '转案' })).toHaveCount(0);
  await page.getByRole('button', { name: '退出登录' }).click();
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/u);
  await page.goto(`/notary-matters/${operatorMatterId}`);
  await expect(
    page.locator('[data-test="issuance-decision-record"]'),
  ).toContainText('ISSUE');
  await page.goto(`/notary-matters/${returnMatterId}`);
  await expect(
    page.locator('[data-test="issuance-decision-record"]'),
  ).toContainText('NO_ISSUE');

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel('用户名').fill(client.username);
  await page.getByLabel('密码').fill(client.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/client\/leads$/u);
  await page.goto('/client/notary-matters');
  const pendingReviewRows = page.locator('[data-test="client-notary-row"]');
  await expect(pendingReviewRows).toHaveCount(2);
  await expect(
    pendingReviewRows.filter({ hasText: operatorFact.businessNo }),
  ).toHaveCount(0);
  await expect(
    pendingReviewRows.filter({ hasText: returnFact.businessNo }),
  ).toHaveCount(0);
  await expect(
    pendingReviewRows.filter({ hasText: pendingEvidenceBusinessNo }),
  ).toHaveCount(0);
  await page.goto(`/client/notary-matters/${operatorMatterId}`);
  await expect(
    page.locator('[data-test="client-issuance-decision-record"]'),
  ).toContainText('ISSUE');
  await expect(
    page.locator('[data-test="client-issuance-decision-record"]'),
  ).not.toContainText('运营');
  await expect(
    page.locator('[data-test="issuance-decision-submit"]'),
  ).toHaveCount(0);
  await page.goto(`/client/leads/${operatorFact.leadId}`);
  await page.locator('[data-test="client-notary-batches"]').click();
  await expect(page).toHaveURL(
    new RegExp(
      `/client/notary-matters\\?sourceLeadId=${operatorFact.leadId}`,
      'u',
    ),
  );
  const ownBatchRows = page.locator('[data-test="client-notary-row"]');
  await expect(ownBatchRows).toHaveCount(2);
  const reviewedBatchRow = ownBatchRows.filter({
    hasText: operatorFact.businessNo,
  });
  await expect(reviewedBatchRow).toContainText('待出证');
  const clientBatchRow = ownBatchRows.filter({
    hasText: secondBatch.businessNo,
  });
  await clientBatchRow.locator('[data-test="client-notary-link"]').click();
  await expect(
    page.locator('[data-test="client-opening-review-section"]'),
  ).toBeVisible();
  await expect(page.getByText('client-opening-nt003.jpg')).toBeVisible();
  const clientDetailText = await page.locator('main').last().innerText();
  expect(clientDetailText).not.toContain('99.99');
  expect(clientDetailText).not.toContain('内部专用快递名称');
  expect(clientDetailText).not.toContain('INTERNAL-TRACKING-NT003');
  expect(clientDetailText).not.toContain('内部专用寄件人-NT003');
  const photoDownload = page.waitForEvent('download');
  await page
    .locator(
      `[data-test="download-client-opening-photo-${clientPhoto.contentVersionId}"]`,
    )
    .click();
  expect(await readFile(await (await photoDownload).path())).toEqual(
    secondOpeningPhotoBytes,
  );

  await page
    .locator('[data-test="client-review-result-no-infringement"]')
    .check();
  const reason = '浏览器确认该批次照片未见侵权标识';
  await page.locator('[data-test="client-opening-review-reason"]').fill(reason);
  try {
    await rejectNotaryOpeningReviewDecisionWrites();
    await page.locator('[data-test="client-opening-review-submit"]').click();
    await expect(page.getByRole('alert')).toHaveText(
      '开箱审核失败，请稍后重试或刷新查看结果。',
    );
    expect(await countNotaryOpeningReviewDecisions(secondBatch.id)).toBe(0);
  } finally {
    await allowInjectedFailures();
  }
  await page.reload();
  await expect(
    page.locator('[data-test="client-opening-review-section"]'),
  ).toBeVisible();
  await page
    .locator('[data-test="client-review-result-no-infringement"]')
    .check();
  await page.locator('[data-test="client-opening-review-reason"]').fill(reason);
  await page.locator('[data-test="client-opening-review-submit"]').click();
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText('判定不侵权');
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText(reason);
  await expect(getNotaryOpeningReviewMatter(secondBatch.id)).resolves.toEqual({
    stage: 'ARCHIVED',
    version: 4,
  });
  expect(await countNotaryOpeningReviewDecisions(secondBatch.id)).toBe(1);
  await page.reload();
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText(reason);
  await page.getByRole('link', { name: '← 返回公证审核' }).click();
  await expect(ownBatchRows).toHaveCount(2);
  await expect(
    ownBatchRows.filter({ hasText: secondBatch.businessNo }),
  ).toContainText('已归档');
  await expect(
    ownBatchRows.filter({ hasText: operatorFact.businessNo }),
  ).toContainText('待出证');

  const foreignClient = await createClientAccount(request, {
    customerId: coreLeadFixtures.foreignCustomer,
    headers: { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
  });
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel('用户名').fill(foreignClient.username);
  await page.getByLabel('密码').fill(foreignClient.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/client\/leads$/u);
  await page.goto(`/client/notary-matters?sourceLeadId=${operatorFact.leadId}`);
  await expect(page.getByText('当前没有待审核公证事项')).toBeVisible();
  await page.goto(`/client/notary-matters/${operatorMatterId}`);
  await expect(
    page.getByRole('heading', { name: '公证事项不存在或当前企业不可访问' }),
  ).toBeVisible();
  const deniedPhotoStatus = await page.evaluate(
    async ({ materialId, contentVersionId }) =>
      (
        await fetch(
          `/api/v1/materials/${materialId}/versions/${contentVersionId}/content`,
        )
      ).status,
    {
      materialId: clientPhoto.materialId,
      contentVersionId: clientPhoto.contentVersionId,
    },
  );
  expect(deniedPhotoStatus).toBe(404);

  await setGrant('notary.opening.review', false);
  try {
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page).toHaveURL(/\/login$/u);
    await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
    await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/\/customers$/u);
    await expect(page.locator('[data-test="app-shell"]')).toBeVisible();
    await expect(page.locator('[data-test="notary-nav"]')).toBeVisible();
    await page.goto(`/notary-matters/${readOnlyMatterId}`);
    await expect(
      page.locator('[data-test="notary-matter-detail"]'),
    ).toBeVisible();
    await expect(page.locator('[data-test="saved-opening"]')).toBeVisible();
    await expect(
      page.locator('[data-test="opening-review-section"]'),
    ).toHaveCount(0);
  } finally {
    await setGrant('notary.opening.review', true);
  }

  await page.locator('[data-test="notary-nav"]').click();
  const finalOperatorMatterRow = page
    .locator('[data-test="matter-row"]')
    .filter({ hasText: operatorFact.businessNo });
  await expect(finalOperatorMatterRow).toBeVisible();
  await finalOperatorMatterRow.locator('[data-test="matter-link"]').click();
  await expect(
    page.locator('[data-test="opening-review-record"]'),
  ).toContainText('确认侵权');
  await expect(page.locator('[data-test="saved-opening"]')).toBeVisible();
  await page.locator('[data-test="notary-nav"]').click();
  const clientReviewedMatterRow = page
    .locator('[data-test="matter-row"]')
    .filter({ hasText: secondBatch.businessNo });
  await expect(clientReviewedMatterRow).toBeVisible();
  await clientReviewedMatterRow.locator('[data-test="matter-link"]').click();
  await expect(
    page.locator('[data-test="opening-review-record"]'),
  ).toContainText(reason);
  await expect(page.locator('[data-test="saved-opening"]')).toBeVisible();
  const sourceLeadResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().endsWith(`/api/v1/leads/${operatorFact.leadId}`),
  );
  await page.locator('[data-test="notary-matter-source-lead"]').click();
  const sourceLeadResult = await sourceLeadResponse;
  const sourceLeadBody = await sourceLeadResult.text();
  expect(sourceLeadResult.status(), sourceLeadBody).toBe(200);
  const sourceLeadPayload = JSON.parse(sourceLeadBody) as Record<
    string,
    unknown
  >;
  const sourceLeadDiagnostic = {
    contentType: sourceLeadResult.headers()['content-type'],
    keys: Object.keys(sourceLeadPayload).sort(),
    capabilities:
      sourceLeadPayload.capabilities &&
      typeof sourceLeadPayload.capabilities === 'object'
        ? Object.keys(sourceLeadPayload.capabilities).sort()
        : typeof sourceLeadPayload.capabilities,
    notaryMatterStages: Array.isArray(sourceLeadPayload.notaryMatters)
      ? sourceLeadPayload.notaryMatters.map((matter) =>
          matter && typeof matter === 'object' && 'stage' in matter
            ? matter.stage
            : typeof matter,
        )
      : typeof sourceLeadPayload.notaryMatters,
  };
  await expect(
    page.locator('[data-test="push-record"]'),
    JSON.stringify(sourceLeadDiagnostic),
  ).toContainText('核心主管');
  await expect(page.locator('[data-test="notary-matters"]')).toContainText(
    operatorFact.businessNo,
  );
  await expect(page.locator('[data-test="notary-matters"]')).toContainText(
    secondBatch.businessNo,
  );
});

test('operator and client race on one opening review and only one PostgreSQL decision commits', async ({
  request,
}) => {
  const account = await createClientAccount(request);
  const csrf = await loginClient(request, account.username, account.password);
  const matterId = await createOpenedNotaryMatter(request, csrf);
  const responses = await Promise.all([
    reviewNotaryOpening(request, matterId, {
      result: 'INFRINGEMENT',
      expectedVersion: 3,
    }),
    reviewNotaryOpening(
      request,
      matterId,
      { result: 'NO_INFRINGEMENT', reason: '无侵权', expectedVersion: 3 },
      randomUUID(),
      csrf,
    ),
  ]);
  expect(responses.map((response) => response.status()).sort()).toEqual([
    201, 409,
  ]);
  expect(await countNotaryOpeningReviewDecisions(matterId)).toBe(1);
  expect(await countNotaryOpeningReviewAudits(matterId)).toBe(1);
  expect(await countNotaryOpeningReviewReceipts(matterId)).toBe(1);
});

test('opening review decision, audit and receipt failures roll back the real PostgreSQL transaction', async ({
  request,
}) => {
  const account = await createClientAccount(request);
  const csrf = await loginClient(request, account.username, account.password);
  try {
    for (const inject of [
      rejectNotaryOpeningReviewDecisionWrites,
      rejectNotaryOpeningReviewAuditWrites,
      rejectNotaryOpeningReviewReceiptWrites,
    ]) {
      const matterId = await createOpenedNotaryMatter(request, csrf);
      await inject();
      const failed = await reviewNotaryOpening(request, matterId, {
        result: 'NO_INFRINGEMENT',
        reason: '无侵权',
        expectedVersion: 3,
      });
      expect(failed.status(), await failed.text()).toBeGreaterThanOrEqual(500);
      expect(await getNotaryOpeningReviewMatter(matterId)).toEqual({
        stage: 'UNBOX_REVIEW',
        version: 3,
      });
      expect(await countNotaryOpeningReviewDecisions(matterId)).toBe(0);
      expect(await countNotaryOpeningReviewAudits(matterId)).toBe(0);
      expect(await countNotaryOpeningReviewReceipts(matterId)).toBe(0);
      await allowInjectedFailures();
    }
  } finally {
    await allowInjectedFailures();
  }
});

test('issuance choices contend once per matter and a shared key rejects the other matter', async ({
  request,
}) => {
  const account = await createClientAccount(request);
  const csrf = await loginClient(request, account.username, account.password);
  const matterId = await createIssuanceReadyMatter(request, csrf);
  const sameMatter = await Promise.all([
    decideNotaryIssuance(request, matterId, 'ISSUE'),
    decideNotaryIssuance(request, matterId, 'NO_ISSUE'),
  ]);
  expect(sameMatter.map((response) => response.status()).sort()).toEqual([
    201, 409,
  ]);
  expect(await countNotaryIssuanceDecisions(matterId)).toBe(1);
  expect(await countNotaryIssuanceAudits(matterId)).toBe(1);
  expect(await countNotaryIssuanceReceipts(matterId)).toBe(1);

  const firstMatter = await createIssuanceReadyMatter(request, csrf);
  const secondMatter = await createIssuanceReadyMatter(request, csrf);
  const sharedKey = randomUUID();
  const acrossMatters = await Promise.all([
    decideNotaryIssuance(request, firstMatter, 'ISSUE', sharedKey),
    decideNotaryIssuance(request, secondMatter, 'NO_ISSUE', sharedKey),
  ]);
  expect(acrossMatters.map((response) => response.status()).sort()).toEqual([
    201, 409,
  ]);
  const loser = acrossMatters.find((response) => response.status() === 409)!;
  expect(await loser.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  expect(
    (await countNotaryIssuanceDecisions(firstMatter)) +
      (await countNotaryIssuanceDecisions(secondMatter)),
  ).toBe(1);
  expect(
    (await countNotaryIssuanceAudits(firstMatter)) +
      (await countNotaryIssuanceAudits(secondMatter)),
  ).toBe(1);
  expect(
    (await countNotaryIssuanceReceipts(firstMatter)) +
      (await countNotaryIssuanceReceipts(secondMatter)),
  ).toBe(1);
});

test('issuance audit and receipt failures roll back the real PostgreSQL transaction', async ({
  request,
}) => {
  const account = await createClientAccount(request);
  const csrf = await loginClient(request, account.username, account.password);
  try {
    for (const inject of [
      rejectNotaryIssuanceAuditWrites,
      rejectNotaryEvidenceReceiptWrites,
    ]) {
      const matterId = await createIssuanceReadyMatter(request, csrf);
      const key = randomUUID();
      await inject();
      const failed = await decideNotaryIssuance(
        request,
        matterId,
        'ISSUE',
        key,
      );
      expect(failed.status(), await failed.text()).toBeGreaterThanOrEqual(500);
      expect(await getNotaryOpeningReviewMatter(matterId)).toEqual({
        stage: 'ISSUANCE_DECISION',
        version: 4,
      });
      expect(await countNotaryIssuanceDecisions(matterId)).toBe(0);
      expect(await countNotaryIssuanceAudits(matterId)).toBe(0);
      expect(await countNotaryIssuanceReceipts(matterId)).toBe(0);
      await allowInjectedFailures();
      const retried = await decideNotaryIssuance(
        request,
        matterId,
        'ISSUE',
        key,
      );
      expect(retried.status(), await retried.text()).toBe(201);
      expect(await countNotaryIssuanceDecisions(matterId)).toBe(1);
      expect(await countNotaryIssuanceAudits(matterId)).toBe(1);
      expect(await countNotaryIssuanceReceipts(matterId)).toBe(1);
    }
  } finally {
    await allowInjectedFailures();
  }
});

test('real operator and client logins archive a no-infringement review and preserve it across refresh and processed view', async ({
  page,
}) => {
  const clientUsername = `archive-client-${randomUUID().slice(0, 8)}`;
  const clientPassword = 'archive client password 2026';
  const reason = '经核对，浏览器证据中的商品未使用我司权利标识';

  await page.goto('/customers');
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/u);

  await page.getByRole('link', { name: '已准入客户' }).click();
  await expect(
    page.locator('[data-test="client-account-panel"]'),
  ).toBeVisible();
  await page.getByLabel('客户侧使用人姓名').fill('归档浏览器审核员');
  await page.getByLabel('用户名').fill(clientUsername);
  await page.getByLabel('初始密码').fill(clientPassword);
  await page.locator('[data-test="create-client-account"]').click();
  await expect(page.getByText('账号已创建并绑定')).toBeVisible();

  await page.locator('[data-test="lead-nav"]').click();
  await page.locator('[data-test="create-lead"]').click();
  await page
    .locator('select[name="customerId"]')
    .selectOption(coreLeadFixtures.admittedCustomer);
  await page.getByLabel('拟办理业务类型').selectOption('CIVIL');
  await page.getByLabel('发现时间').fill('2026-09-22T10:30');
  await page.getByLabel('线索来源').selectOption('ONLINE');
  await page.getByLabel('发现平台').selectOption('TAOBAO');
  await page.getByLabel('店铺名称').fill('不侵权浏览器链路店铺');
  await page.getByLabel('商标权').check();
  await page.locator('input[name="productTitle-0"]').fill('待归档浏览器商品');
  await page.locator('input[name="quantity-0"]').fill('1');
  await page.locator('input[name="unitPrice-0"]').fill('12.00');
  await page.locator('input[name="commentCount-0"]').fill('0');
  await page.locator('input[name="screenshots"]').setInputFiles({
    name: 'archive-review.jpg',
    mimeType: 'image/jpeg',
    buffer: jpegBytes,
  });
  await page.getByRole('button', { name: '创建线索' }).click();
  await expect(page.getByRole('heading', { name: /^LD-/u })).toBeVisible();
  const leadId = page.url().split('/').at(-1)!;

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('[data-test="push-lead"]').click();
  await expect(page.locator('[data-test="push-success"]')).toContainText(
    '已推送给客户审核',
  );
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel('用户名').fill(clientUsername);
  await page.getByLabel('密码').fill(clientPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/client\/leads$/u);
  const row = page.locator('[data-test="client-lead-row"]');
  await expect(row).toContainText('不侵权浏览器链路店铺');
  await row.getByRole('link').click();
  await expect(page).toHaveURL(
    new RegExp(`/client/leads/${leadId}(\\?|$)`, 'u'),
  );
  await expect(page.getByText('archive-review.jpg')).toBeVisible();
  const screenshot = page.waitForEvent('download');
  await page.locator('[data-test^="download-screenshot-"]').click();
  expect(await readFile(await (await screenshot).path())).toEqual(jpegBytes);

  const reasonInput = page.locator('[data-test="no-infringement-reason"]');
  await expect(reasonInput).toHaveAttribute('aria-required', 'true');
  await reasonInput.fill(`  ${reason}  `);
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('当前版本不能在页面直接撤回');
    dialog.accept();
  });
  await page.locator('[data-test="confirm-no-infringement"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('线索已归档');
  const record = page.locator('[data-test="client-review-record"]');
  await expect(record).toContainText('判定不侵权并归档');
  await expect(record).toContainText(reason);
  await expect(record).toContainText('归档浏览器审核员');
  const archivedTime = (await record.locator('p').nth(4).textContent())
    ?.replace('归档时间：', '')
    .trim();
  expect(archivedTime).toBeTruthy();
  expect(await countLeadReviewDecisions(leadId)).toBe(1);
  expect(await countClientLeadReviewReceipts(leadId)).toBe(1);

  await page.reload();
  await expect(
    page.locator('[data-test="confirm-no-infringement"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText(reason);
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText(archivedTime!);
  const afterArchiveDownload = page.waitForEvent('download');
  await page.locator('[data-test^="download-screenshot-"]').click();
  expect(await readFile(await (await afterArchiveDownload).path())).toEqual(
    jpegBytes,
  );

  await page.getByRole('link', { name: /返回待审核线索/u }).click();
  await page.locator('[data-test="client-view-processed"]').click();
  await expect(page).toHaveURL(/view=processed/u);
  await expect(page.locator('[data-test="client-lead-row"]')).toContainText(
    '不侵权浏览器链路店铺',
  );
  await page.locator('[data-test="client-lead-row"] a').click();
  await expect(
    page.locator('[data-test="client-review-record"]'),
  ).toContainText(archivedTime!);

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/u);
  await page.goto('/leads?status=ARCHIVED');
  const operatorRow = page
    .locator('[data-test="lead-row"]')
    .filter({ hasText: '不侵权浏览器链路店铺' });
  await expect(operatorRow).toContainText('线索已归档');
  await operatorRow.getByRole('link').click();
  const operatorRecord = page.locator('[data-test="client-review-record"]');
  await expect(operatorRecord).toContainText(reason);
  await expect(operatorRecord).toContainText(archivedTime!);

  const originalDecision = await getLeadReviewDecision(leadId);
  expect(originalDecision).toMatchObject({
    result: 'NO_INFRINGEMENT',
    reason,
    archiveType: 'NO_INFRINGEMENT',
    fromVersion: 2,
    toVersion: 3,
  });
  const applicationReason = '发现新的权属证明，请原客户企业复核';
  await page.locator('[data-test="withdrawal-reason"]').fill(applicationReason);
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('仍保持归档');
    return dialog.accept();
  });
  await page.locator('[data-test="apply-withdrawal"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('线索已归档');
  await expect(page.locator('[data-test="withdrawal-success"]')).toContainText(
    '等待原客户企业确认',
  );
  const application = await getLeadWithdrawalApplication(leadId);
  expect(application).toMatchObject({
    reason: applicationReason,
    fromVersion: 3,
    toVersion: 4,
    confirmation: null,
  });
  expect(application?.resultSnapshot).toMatchObject({
    status: 'ARCHIVED',
    version: 4,
    reason: applicationReason,
  });
  expect(await getLead(leadId)).toMatchObject({
    status: 'ARCHIVED',
    version: 4,
    activeReviewDecisionId: originalDecision?.id,
  });
  expect(await countLeadWithdrawalAudits(leadId)).toBe(1);

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel('用户名').fill(clientUsername);
  await page.getByLabel('密码').fill(clientPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/client\/leads$/u);
  const pendingRow = page.locator('[data-test="client-lead-row"]');
  await expect(pendingRow).toContainText('待确认撤回');
  await expect(pendingRow).toContainText('不侵权浏览器链路店铺');
  await page.locator('[data-test="client-view-processed"]').click();
  await expect(
    page.getByRole('heading', { name: '已处理线索', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator('[data-test="client-lead-row"]')
      .filter({ hasText: '不侵权浏览器链路店铺' }),
  ).toHaveCount(0);
  await page.locator('[data-test="client-view-pending"]').click();
  await expect(
    page.getByRole('heading', { name: '待我审核', exact: true }),
  ).toBeVisible();
  await pendingRow.getByRole('link').click();
  await expect(
    page.locator('[data-test="withdrawal-application"]'),
  ).toContainText(applicationReason);
  await expect(page.locator('[data-test="confirm-withdrawal"]')).toBeVisible();
  const firstScreenshot = page.waitForEvent('download');
  await page.locator('[data-test^="download-screenshot-"]').click();
  expect(await readFile(await (await firstScreenshot).path())).toEqual(
    jpegBytes,
  );
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('原结论和归档记录保留');
    return dialog.accept();
  });
  await page.locator('[data-test="confirm-withdrawal"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('线索待审核');
  await expect(page.locator('[data-test="withdrawal-success"]')).toContainText(
    '原结论和归档记录仍保留',
  );
  expect(await getLead(leadId)).toMatchObject({
    status: 'WAITING_REVIEW',
    version: 5,
    activeReviewDecisionId: null,
  });
  const confirmedApplication = await getLeadWithdrawalApplication(leadId);
  expect(confirmedApplication?.confirmation).toMatchObject({
    fromVersion: 4,
    toVersion: 5,
    resultSnapshot: expect.objectContaining({ status: 'WAITING_REVIEW' }),
  });
  expect(await countLeadWithdrawalConfirmations(leadId)).toBe(1);
  expect(await countLeadReviewDecisions(leadId)).toBe(1);
  await page.reload();
  await expect(page.locator('.page-head .pill')).toHaveText('线索待审核');
  await expect(
    page.locator('[data-test="client-withdrawal-history"]'),
  ).toContainText(reason);
  await expect(
    page.locator('[data-test="client-withdrawal-history"]'),
  ).toContainText(applicationReason);
  const afterConfirmationDownload = page.waitForEvent('download');
  await page.locator('[data-test^="download-screenshot-"]').click();
  expect(
    await readFile(await (await afterConfirmationDownload).path()),
  ).toEqual(jpegBytes);

  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('当前入口不能撤回');
    return dialog.accept();
  });
  await page.locator('[data-test="confirm-infringement"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('线索待确认');
  expect(await countLeadReviewDecisions(leadId)).toBe(2);
  expect(await countClientLeadReviewReceipts(leadId)).toBe(2);
  await page.reload();
  await expect(page.locator('.page-head .pill')).toHaveText('线索待确认');
  await expect(
    page.locator('[data-test="client-withdrawal-history"]'),
  ).toContainText('确认侵权');
  await expect(
    page.locator('[data-test="client-withdrawal-history"]'),
  ).toContainText('客户确认撤回');

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/u);
  await page.goto('/leads?status=WAITING_EVIDENCE_DECISION');
  const finalOperatorRow = page
    .locator('[data-test="lead-row"]')
    .filter({ hasText: '不侵权浏览器链路店铺' });
  await expect(finalOperatorRow).toContainText('线索待确认');
  await finalOperatorRow.getByRole('link').click();
  await expect(page.locator('[data-test="withdrawal-history"]')).toContainText(
    reason,
  );
  await expect(page.locator('[data-test="withdrawal-history"]')).toContainText(
    applicationReason,
  );
  await expect(page.locator('[data-test="withdrawal-history"]')).toContainText(
    '客户确认撤回',
  );
  const decisions = await getLeadReviewDecisions(leadId);
  expect(decisions.map((decision) => decision.result)).toEqual([
    'NO_INFRINGEMENT',
    'INFRINGEMENT',
  ]);
  expect(decisions[0].receipt?.resultSnapshot).toMatchObject({
    status: 'ARCHIVED',
    version: 3,
    reviewDecision: { reason },
  });
  expect(await getLeadReviewDecision(leadId)).toMatchObject({
    result: 'INFRINGEMENT',
    fromVersion: 5,
    toVersion: 6,
  });
  expect(await getLead(leadId)).toMatchObject({
    status: 'WAITING_EVIDENCE_DECISION',
    version: 6,
  });
});

test('Demo-aligned shell works on desktop and mobile', async ({ page }) => {
  await configureBrowser(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/leads');
  await expect(page.locator('[data-test="app-sidebar"]')).toBeVisible();
  await expect(page.locator('[data-test="mobile-nav-toggle"]')).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-test="app-sidebar"]')).toBeHidden();
  await page.locator('[data-test="mobile-nav-toggle"]').click();
  await expect(page.locator('[data-test="app-sidebar"]')).toBeVisible();
  await page.locator('[data-test="lead-counter"]').first().click();
  await expect(page.locator('[data-test="app-sidebar"]')).toBeHidden();
});

test('product estimates use quantity then comments and reject invalid counts', async ({
  request,
}) => {
  const response = await createLead(
    request,
    leadInput({
      products: [
        { title: '销量优先', quantity: 2, unitPrice: '1.50', commentCount: 3 },
        { title: '评论回退', quantity: 0, unitPrice: '1.50', commentCount: 3 },
      ],
    }),
  );
  expect(response.status(), await response.text()).toBe(201);
  const created: { id: string; products: Array<{ estimatedAmount: string }> } =
    await response.json();
  expect(created.products.map((item) => item.estimatedAmount)).toEqual([
    '3.00',
    '4.50',
  ]);
  const stored = await getLead(created.id);
  expect(
    stored?.products.map((item) => item.estimatedAmount.toFixed(2)),
  ).toEqual(['3.00', '4.50']);
  for (const quantity of [-2, 1.5]) {
    const invalid = await createLead(
      request,
      leadInput({
        products: [
          { title: '非法数量', quantity, unitPrice: '1.00', commentCount: 0 },
        ],
      }),
    );
    expect(invalid.status()).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  }
});

test('draft, unlinked, cross-department, unauthorized, and foreign material facts stay hidden', async ({
  request,
}) => {
  const attempts = [
    leadInput({ customerId: coreLeadFixtures.draftCustomer }),
    leadInput({ rightsHolderId: coreLeadFixtures.unlinkedHolder }),
    leadInput({
      customerId: coreLeadFixtures.foreignCustomer,
      rightsHolderId: coreLeadFixtures.foreignHolder,
    }),
  ];
  for (const input of attempts) {
    const response = await createLead(request, input);
    expect(response.status()).toBe(404);
    const body = await response.text();
    expect(body).not.toContain(coreLeadFixtures.foreignCustomer);
    expect(body).not.toContain('外部门客户');
  }
  await setGrant('lead.create', false);
  const forbidden = await createLead(request);
  expect(forbidden.status()).toBe(403);
  expect(await forbidden.json()).toMatchObject({ code: 'ACTION_FORBIDDEN' });

  const foreign = await upload(
    request,
    {
      ownerType: 'CUSTOMER',
      ownerId: coreLeadFixtures.selfCustomer,
      purpose: 'IDENTITY_FULL',
      name: 'foreign.pdf',
      mime: 'application/pdf',
      bytes: pdfBytes,
    },
    authorizationSelf,
  );
  const denied = await request.post(
    `/api/v1/customers/${coreLeadFixtures.draftCustomer}/admission`,
    {
      headers: { ...authorizationA, 'Idempotency-Key': randomUUID() },
      data: admissionInput([foreign.contentVersionId]),
    },
  );
  expect(denied.status()).toBe(400);
  const deniedBody = await denied.json();
  expect(deniedBody).toMatchObject({ code: 'MATERIAL_VERSION_INVALID' });
  expect(JSON.stringify(deniedBody)).not.toContain(
    coreLeadFixtures.selfCustomer,
  );

  await setGrant('lead.create', true);
  const own = await upload(request, {
    ownerType: 'CUSTOMER',
    ownerId: coreLeadFixtures.draftCustomer,
    purpose: 'IDENTITY_FULL',
    name: 'expired.pdf',
    mime: 'application/pdf',
    bytes: pdfBytes,
  });
  await markContentVersion(own.contentVersionId, 'DELETED');
  const expired = await request.post(
    `/api/v1/customers/${coreLeadFixtures.draftCustomer}/admission`,
    {
      headers: { ...authorizationA, 'Idempotency-Key': randomUUID() },
      data: admissionInput([own.contentVersionId]),
    },
  );
  expect(expired.status()).toBe(400);
  expect(await expired.json()).toMatchObject({
    code: 'MATERIAL_VERSION_INVALID',
  });
});

test('customer admission and lead creation are idempotent while stale edits conflict', async ({
  request,
}) => {
  const material = await upload(request, {
    ownerType: 'CUSTOMER',
    ownerId: coreLeadFixtures.draftCustomer,
    purpose: 'IDENTITY_FULL',
    name: 'admit.pdf',
    mime: 'application/pdf',
    bytes: pdfBytes,
  });
  const key = randomUUID();
  const command = admissionInput([material.contentVersionId]);
  const first = await request.post(
    `/api/v1/customers/${coreLeadFixtures.draftCustomer}/admission`,
    {
      headers: { ...authorizationA, 'Idempotency-Key': key },
      data: command,
    },
  );
  const retry = await request.post(
    `/api/v1/customers/${coreLeadFixtures.draftCustomer}/admission`,
    {
      headers: { ...authorizationA, 'Idempotency-Key': key },
      data: command,
    },
  );
  expect(first.status()).toBe(201);
  expect(await retry.json()).toEqual(await first.json());
  expect(await countAdmissionReceipts()).toBe(1);
  const conflict = await request.post(
    `/api/v1/customers/${coreLeadFixtures.draftCustomer}/admission`,
    {
      headers: { ...authorizationA, 'Idempotency-Key': key },
      data: { ...command, admissionContactName: '不同指纹' },
    },
  );
  expect(conflict.status()).toBe(409);

  const leadKey = randomUUID();
  const leadFirst = await createLead(request, leadInput(), leadKey);
  const leadRetry = await createLead(request, leadInput(), leadKey);
  expect(leadFirst.status()).toBe(201);
  const lead = await leadFirst.json();
  expect(await leadRetry.json()).toEqual(lead);
  expect(await countLeadReceipts()).toBe(1);
  const leadConflict = await createLead(
    request,
    leadInput({ shopName: '不同指纹' }),
    leadKey,
  );
  expect(leadConflict.status()).toBe(409);
  const updated = await request.patch(`/api/v1/leads/${lead.id}`, {
    headers: authorizationA,
    data: {
      ...leadInput(),
      customerId: undefined,
      rightsHolderId: undefined,
      expectedVersion: 1,
    },
  });
  expect(updated.status()).toBe(200);
  const stale = await request.patch(`/api/v1/leads/${lead.id}`, {
    headers: authorizationA,
    data: {
      ...leadInput(),
      customerId: undefined,
      rightsHolderId: undefined,
      expectedVersion: 1,
    },
  });
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
});

test('push revalidates account, permission, customer, products, state, version, idempotency, and concurrency', async ({
  request,
}) => {
  const unavailableLeadResponse = await createLead(request);
  const unavailableLead = await unavailableLeadResponse.json();
  const unavailable = await pushLead(request, unavailableLead.id, 1);
  expect(unavailable.status()).toBe(409);
  expect(await unavailable.json()).toMatchObject({
    code: 'CLIENT_ACCOUNT_UNAVAILABLE',
  });

  await createClientAccount(request);
  const key = randomUUID();
  const first = await pushLead(request, unavailableLead.id, 1, key);
  expect(first.status(), await first.text()).toBe(201);
  const firstResult = await first.json();
  const replay = await pushLead(request, unavailableLead.id, 1, key);
  expect(replay.status()).toBe(201);
  expect(await replay.json()).toEqual(firstResult);
  expect(await countLeadPushAudits(unavailableLead.id)).toBe(1);
  expect(await countLeadPushReceipts(unavailableLead.id)).toBe(1);

  const sameKeyDifferentRequest = await pushLead(
    request,
    unavailableLead.id,
    2,
    key,
  );
  expect(sameKeyDifferentRequest.status()).toBe(409);
  expect(await sameKeyDifferentRequest.json()).toMatchObject({
    code: 'IDEMPOTENCY_CONFLICT',
  });
  const wrongState = await pushLead(request, unavailableLead.id, 2);
  expect(wrongState.status()).toBe(409);
  expect(await wrongState.json()).toMatchObject({ code: 'INVALID_STATE' });

  const staleLeadResponse = await createLead(request);
  const staleLead = await staleLeadResponse.json();
  const updatedStaleLead = await request.patch(
    `/api/v1/leads/${staleLead.id}`,
    {
      headers: authorizationA,
      data: {
        ...leadInput(),
        customerId: undefined,
        rightsHolderId: undefined,
        expectedVersion: 1,
      },
    },
  );
  expect(updatedStaleLead.status()).toBe(200);
  const stale = await pushLead(request, staleLead.id, 1);
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });

  await setGrant('lead.push', false);
  const permissionLeadResponse = await createLead(request);
  const permissionLead = await permissionLeadResponse.json();
  const forbidden = await pushLead(request, permissionLead.id, 1);
  expect(forbidden.status()).toBe(403);
  expect(await forbidden.json()).toMatchObject({ code: 'ACTION_FORBIDDEN' });
  await setGrant('lead.push', true);

  await setClientAccountActive(coreLeadFixtures.admittedCustomer, false);
  const inactive = await pushLead(request, permissionLead.id, 1);
  expect(inactive.status()).toBe(409);
  expect(await inactive.json()).toMatchObject({
    code: 'CLIENT_ACCOUNT_UNAVAILABLE',
  });
  await setClientAccountActive(coreLeadFixtures.admittedCustomer, true);

  await setCustomerStatus(coreLeadFixtures.admittedCustomer, 'DRAFT');
  const notAdmitted = await pushLead(request, permissionLead.id, 1);
  expect(notAdmitted.status()).toBe(409);
  expect(await notAdmitted.json()).toMatchObject({
    code: 'CUSTOMER_NOT_ADMITTED',
  });
  await setCustomerStatus(coreLeadFixtures.admittedCustomer, 'ADMITTED');

  await removeLeadProducts(permissionLead.id);
  const withoutProducts = await pushLead(request, permissionLead.id, 1);
  expect(withoutProducts.status()).toBe(409);
  expect(await withoutProducts.json()).toMatchObject({
    code: 'LEAD_PRODUCTS_REQUIRED',
  });

  const concurrentLeadResponse = await createLead(request);
  const concurrentLead = await concurrentLeadResponse.json();
  const competitors = await Promise.all([
    pushLead(request, concurrentLead.id, 1),
    pushLead(request, concurrentLead.id, 1),
  ]);
  expect(
    competitors.filter((response) => response.status() === 201),
  ).toHaveLength(1);
  expect(
    competitors.filter((response) => response.status() === 409),
  ).toHaveLength(1);
  expect(await countLeadPushAudits(concurrentLead.id)).toBe(1);
  expect(await countLeadPushReceipts(concurrentLead.id)).toBe(1);
});

test('push rolls back status, audit, and receipt when either durable record fails', async ({
  request,
}) => {
  await createClientAccount(request);
  const auditLeadResponse = await createLead(request);
  const auditLead = await auditLeadResponse.json();
  await rejectAuditWrites('lead.pushed');
  const auditFailure = await pushLead(request, auditLead.id, 1);
  expect(auditFailure.status()).toBe(500);
  expect(await getLead(auditLead.id)).toMatchObject({
    status: 'WAITING_PUSH',
    version: 1,
    pushedAt: null,
    pushedByUserId: null,
  });
  expect(await countLeadPushAudits(auditLead.id)).toBe(0);
  expect(await countLeadPushReceipts(auditLead.id)).toBe(0);

  await rejectLeadPushReceiptWrites();
  const receiptLeadResponse = await createLead(request);
  const receiptLead = await receiptLeadResponse.json();
  const receiptFailure = await pushLead(request, receiptLead.id, 1);
  expect(receiptFailure.status()).toBe(500);
  expect(await getLead(receiptLead.id)).toMatchObject({
    status: 'WAITING_PUSH',
    version: 1,
    pushedAt: null,
    pushedByUserId: null,
  });
  expect(await countLeadPushAudits(receiptLead.id)).toBe(0);
  expect(await countLeadPushReceipts(receiptLead.id)).toBe(0);
  await allowInjectedFailures();
});

test('client session sees only its enterprise pushed leads and revocation is immediate', async ({
  request,
}) => {
  const clientA = await createClientAccount(request, {
    username: 'client-enterprise-a',
  });
  await createClientAccount(request, {
    customerId: coreLeadFixtures.foreignCustomer,
    username: 'client-enterprise-b',
    headers: { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
  });
  const ownResponse = await createLead(request);
  const own = await ownResponse.json();
  expect((await pushLead(request, own.id, 1)).status()).toBe(201);
  const internalReview = await request.post(
    `/api/v1/client/leads/${own.id}/reviews`,
    {
      headers: { ...authorizationA, 'Idempotency-Key': randomUUID() },
      data: { result: 'INFRINGEMENT', expectedVersion: 2 },
    },
  );
  expect(internalReview.status()).toBe(403);
  const waitingResponse = await createLead(request);
  const waiting = await waitingResponse.json();

  const foreignResponse = await createLead(
    request,
    leadInput({
      customerId: coreLeadFixtures.foreignCustomer,
      rightsHolderId: coreLeadFixtures.foreignHolder,
      shopName: '外企业线索',
    }),
    randomUUID(),
    { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
  );
  const foreign = await foreignResponse.json();
  expect(
    (
      await pushLead(request, foreign.id, 1, randomUUID(), {
        Authorization: `Bearer ${coreLeadFixtures.tokenB}`,
      })
    ).status(),
  ).toBe(201);

  const login = await request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://127.0.0.1:5174' },
    data: { username: clientA.username, password: clientA.password },
  });
  expect(login.status(), await login.text()).toBe(200);
  expect(await login.json()).toMatchObject({
    principalType: 'CLIENT',
    customer: { id: coreLeadFixtures.admittedCustomer },
    department: null,
  });

  const list = await request.get('/api/v1/client/leads?page=1&pageSize=20');
  expect(list.status(), await list.text()).toBe(200);
  const listed = await list.json();
  expect(listed.items.map((item: { id: string }) => item.id)).toEqual([own.id]);
  expect(JSON.stringify(listed)).not.toContain('responsibleUserId');
  expect(JSON.stringify(listed)).not.toContain('remark');

  expect((await request.get(`/api/v1/client/leads/${own.id}`)).status()).toBe(
    200,
  );
  expect(
    (await request.get(`/api/v1/client/leads/${waiting.id}`)).status(),
  ).toBe(404);
  expect(
    (await request.get(`/api/v1/client/leads/${foreign.id}`)).status(),
  ).toBe(404);

  await setClientAccountActive(coreLeadFixtures.admittedCustomer, false);
  const revoked = await request.get(`/api/v1/client/leads/${own.id}`);
  expect(revoked.status()).toBe(401);
  expect(await revoked.json()).toMatchObject({ code: 'UNAUTHORIZED' });
});

test('client review enforces enterprise scope, state, version and idempotency in PostgreSQL', async ({
  request,
}) => {
  const clientA = await createClientAccount(request);
  const clientB = await createClientAccount(request, {
    customerId: coreLeadFixtures.foreignCustomer,
    headers: { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
  });
  const own = await (await createLead(request)).json();
  const unpushed = await (await createLead(request)).json();
  const foreign = await (
    await createLead(
      request,
      leadInput({
        customerId: coreLeadFixtures.foreignCustomer,
        rightsHolderId: coreLeadFixtures.foreignHolder,
      }),
      randomUUID(),
      { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
    )
  ).json();
  expect((await pushLead(request, own.id, 1)).status()).toBe(201);
  expect(
    (
      await pushLead(request, foreign.id, 1, randomUUID(), {
        Authorization: `Bearer ${coreLeadFixtures.tokenB}`,
      })
    ).status(),
  ).toBe(201);

  const foreignCsrf = await loginClient(
    request,
    clientB.username,
    clientB.password,
  );
  expect((await reviewLead(request, own.id, 2, foreignCsrf)).status()).toBe(
    404,
  );
  const csrf = await loginClient(request, clientA.username, clientA.password);
  expect((await reviewLead(request, unpushed.id, 1, csrf)).status()).toBe(404);
  expect((await reviewLead(request, foreign.id, 2, csrf)).status()).toBe(404);
  const stale = await reviewLead(request, own.id, 1, csrf);
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });

  const key = randomUUID();
  const accepted = await reviewLead(request, own.id, 2, csrf, key);
  expect(accepted.status(), await accepted.text()).toBe(201);
  const firstResult = await accepted.json();
  expect(firstResult).toMatchObject({
    id: own.id,
    status: 'WAITING_EVIDENCE_DECISION',
    version: 3,
    reviewDecision: {
      result: 'INFRINGEMENT',
      reviewerDisplayName: '企业审核员',
    },
  });
  const persisted = await getLeadReviewDecision(own.id);
  expect(persisted).toMatchObject({
    result: 'INFRINGEMENT',
    fromVersion: 2,
    toVersion: 3,
  });
  expect(persisted?.decidedAt.toISOString()).toBe(
    firstResult.reviewDecision.decidedAt,
  );
  expect(await getLead(own.id)).toMatchObject({
    status: 'WAITING_EVIDENCE_DECISION',
    version: 3,
  });
  expect(await countLeadReviewDecisions(own.id)).toBe(1);
  expect(await countClientLeadReviewReceipts(own.id)).toBe(1);
  const replay = await reviewLead(request, own.id, 2, csrf, key);
  expect(replay.status()).toBe(201);
  expect(await replay.json()).toEqual(firstResult);
  const conflict = await reviewLead(request, own.id, 3, csrf, key);
  expect(conflict.status()).toBe(409);
  expect(await conflict.json()).toMatchObject({
    code: 'IDEMPOTENCY_CONFLICT',
  });
  const wrongState = await reviewLead(request, own.id, 3, csrf);
  expect(wrongState.status()).toBe(409);
  expect(await wrongState.json()).toMatchObject({ code: 'INVALID_STATE' });
  expect(await countLeadReviewDecisions(own.id)).toBe(1);
  expect(await countClientLeadReviewReceipts(own.id)).toBe(1);

  const processed = await request.get(
    '/api/v1/client/leads?view=PROCESSED&page=1&pageSize=20',
  );
  expect(processed.status()).toBe(200);
  expect(
    (await processed.json()).items.map((item: { id: string }) => item.id),
  ).toEqual([own.id]);
  const clientDetail = await request.get(`/api/v1/client/leads/${own.id}`);
  expect(clientDetail.status()).toBe(200);
  expect((await clientDetail.json()).reviewDecision).toEqual(
    firstResult.reviewDecision,
  );
  const operatorDetail = await request.get(`/api/v1/leads/${own.id}`, {
    headers: authorizationA,
  });
  expect(operatorDetail.status()).toBe(200);
  expect((await operatorDetail.json()).reviewDecision).toEqual(
    firstResult.reviewDecision,
  );

  await setClientAccountActive(coreLeadFixtures.admittedCustomer, false);
  expect((await request.get(`/api/v1/client/leads/${own.id}`)).status()).toBe(
    401,
  );
  expect((await reviewLead(request, own.id, 2, csrf, key)).status()).toBe(401);
  const retained = await request.get(`/api/v1/leads/${own.id}`, {
    headers: authorizationA,
  });
  expect(retained.status()).toBe(200);
  expect((await retained.json()).reviewDecision).toEqual(
    firstResult.reviewDecision,
  );
});

test('client no-infringement review validates reason and archives with a durable replay snapshot', async ({
  request,
}) => {
  const clientA = await createClientAccount(request);
  const clientB = await createClientAccount(request, {
    customerId: coreLeadFixtures.foreignCustomer,
    headers: { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
  });
  const own = await (await createLead(request)).json();
  const unpushed = await (await createLead(request)).json();
  const foreign = await (
    await createLead(
      request,
      leadInput({
        customerId: coreLeadFixtures.foreignCustomer,
        rightsHolderId: coreLeadFixtures.foreignHolder,
      }),
      randomUUID(),
      { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
    )
  ).json();
  expect((await pushLead(request, own.id, 1)).status()).toBe(201);
  expect(
    (
      await pushLead(request, foreign.id, 1, randomUUID(), {
        Authorization: `Bearer ${coreLeadFixtures.tokenB}`,
      })
    ).status(),
  ).toBe(201);

  const foreignCsrf = await loginClient(
    request,
    clientB.username,
    clientB.password,
  );
  expect(
    (
      await reviewLead(
        request,
        own.id,
        2,
        foreignCsrf,
        randomUUID(),
        'NO_INFRINGEMENT',
        '不侵权原因',
      )
    ).status(),
  ).toBe(404);
  const csrf = await loginClient(request, clientA.username, clientA.password);
  expect(
    (
      await reviewLead(
        request,
        unpushed.id,
        1,
        csrf,
        randomUUID(),
        'NO_INFRINGEMENT',
        '不侵权原因',
      )
    ).status(),
  ).toBe(404);
  expect(
    (
      await reviewLead(
        request,
        foreign.id,
        2,
        csrf,
        randomUUID(),
        'NO_INFRINGEMENT',
        '不侵权原因',
      )
    ).status(),
  ).toBe(404);

  for (const reason of ['', '   ', 'x'.repeat(5001), 7 as unknown as string]) {
    const invalid = await reviewLead(
      request,
      own.id,
      2,
      csrf,
      randomUUID(),
      'NO_INFRINGEMENT',
      reason,
    );
    expect(invalid.status(), await invalid.text()).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  }
  const stale = await reviewLead(
    request,
    own.id,
    1,
    csrf,
    randomUUID(),
    'NO_INFRINGEMENT',
    '合理原因',
  );
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });

  const key = randomUUID();
  const submitted = await reviewLead(
    request,
    own.id,
    2,
    csrf,
    key,
    'NO_INFRINGEMENT',
    '  经核对，该商品未使用我司权利标识  ',
  );
  expect(submitted.status(), await submitted.text()).toBe(201);
  const firstResult = await submitted.json();
  expect(firstResult).toMatchObject({
    id: own.id,
    status: 'ARCHIVED',
    version: 3,
    reviewDecision: {
      result: 'NO_INFRINGEMENT',
      reason: '经核对，该商品未使用我司权利标识',
      archiveType: 'NO_INFRINGEMENT',
      reviewerDisplayName: '企业审核员',
    },
  });
  expect(firstResult.reviewDecision.archivedAt).toBe(
    firstResult.reviewDecision.decidedAt,
  );
  const persisted = await getLeadReviewDecision(own.id);
  expect(persisted).toMatchObject({
    result: 'NO_INFRINGEMENT',
    reason: '经核对，该商品未使用我司权利标识',
    archiveType: 'NO_INFRINGEMENT',
    fromVersion: 2,
    toVersion: 3,
  });
  expect(persisted?.archivedAt?.toISOString()).toBe(
    firstResult.reviewDecision.archivedAt,
  );
  expect(await getLead(own.id)).toMatchObject({
    status: 'ARCHIVED',
    version: 3,
  });
  expect(await countLeadReviewDecisions(own.id)).toBe(1);
  expect(await countClientLeadReviewReceipts(own.id)).toBe(1);

  const replay = await reviewLead(
    request,
    own.id,
    2,
    csrf,
    key,
    'NO_INFRINGEMENT',
    '经核对，该商品未使用我司权利标识',
  );
  expect(replay.status()).toBe(201);
  expect(await replay.json()).toEqual(firstResult);
  const conflict = await reviewLead(
    request,
    own.id,
    2,
    csrf,
    key,
    'NO_INFRINGEMENT',
    '另一个原因',
  );
  expect(conflict.status()).toBe(409);
  expect(await conflict.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  const wrongState = await reviewLead(
    request,
    own.id,
    3,
    csrf,
    randomUUID(),
    'NO_INFRINGEMENT',
    '合理原因',
  );
  expect(wrongState.status()).toBe(409);
  expect(await wrongState.json()).toMatchObject({ code: 'INVALID_STATE' });
  expect(await countLeadReviewDecisions(own.id)).toBe(1);
  expect(await countClientLeadReviewReceipts(own.id)).toBe(1);

  const processed = await request.get(
    '/api/v1/client/leads?view=PROCESSED&page=1&pageSize=20',
  );
  expect(processed.status()).toBe(200);
  expect(
    (await processed.json()).items.map((item: { id: string }) => item.id),
  ).toContain(own.id);
  const clientDetail = await request.get(`/api/v1/client/leads/${own.id}`);
  expect(clientDetail.status()).toBe(200);
  expect((await clientDetail.json()).reviewDecision).toEqual(
    firstResult.reviewDecision,
  );
  const operatorDetail = await request.get(`/api/v1/leads/${own.id}`, {
    headers: authorizationA,
  });
  expect(operatorDetail.status()).toBe(200);
  expect((await operatorDetail.json()).reviewDecision).toEqual(
    firstResult.reviewDecision,
  );
});

test('distinct no-infringement keys race safely and injected writes roll back every fact', async ({
  request,
}) => {
  const client = await createClientAccount(request);
  const racing = await (await createLead(request)).json();
  const firstFailure = await (await createLead(request)).json();
  const secondFailure = await (await createLead(request)).json();
  for (const lead of [racing, firstFailure, secondFailure]) {
    expect((await pushLead(request, lead.id, 1)).status()).toBe(201);
  }
  const csrf = await loginClient(request, client.username, client.password);
  const responses = await Promise.all([
    reviewLead(
      request,
      racing.id,
      2,
      csrf,
      randomUUID(),
      'NO_INFRINGEMENT',
      '核对后确认无侵权',
    ),
    reviewLead(
      request,
      racing.id,
      2,
      csrf,
      randomUUID(),
      'NO_INFRINGEMENT',
      '核对后确认无侵权',
    ),
  ]);
  expect(
    responses.filter((response) => response.status() === 201),
  ).toHaveLength(1);
  expect(
    responses.filter((response) => response.status() === 409),
  ).toHaveLength(1);
  expect(await countLeadReviewDecisions(racing.id)).toBe(1);
  expect(await countClientLeadReviewReceipts(racing.id)).toBe(1);

  await rejectLeadReviewDecisionWrites();
  expect(
    (
      await reviewLead(
        request,
        firstFailure.id,
        2,
        csrf,
        randomUUID(),
        'NO_INFRINGEMENT',
        '核对后确认无侵权',
      )
    ).status(),
  ).toBe(500);
  await allowInjectedFailures();
  expect(await getLead(firstFailure.id)).toMatchObject({
    status: 'WAITING_REVIEW',
    version: 2,
  });
  expect(await countLeadReviewDecisions(firstFailure.id)).toBe(0);
  expect(await countClientLeadReviewReceipts(firstFailure.id)).toBe(0);

  await rejectClientLeadReviewReceiptWrites();
  expect(
    (
      await reviewLead(
        request,
        secondFailure.id,
        2,
        csrf,
        randomUUID(),
        'NO_INFRINGEMENT',
        '核对后确认无侵权',
      )
    ).status(),
  ).toBe(500);
  await allowInjectedFailures();
  expect(await getLead(secondFailure.id)).toMatchObject({
    status: 'WAITING_REVIEW',
    version: 2,
  });
  expect(await countLeadReviewDecisions(secondFailure.id)).toBe(0);
  expect(await countClientLeadReviewReceipts(secondFailure.id)).toBe(0);
});

test('account, binding and admission revocation deny no-infringement review', async ({
  request,
}) => {
  const client = await createClientAccount(request);
  const lead = await (await createLead(request)).json();
  expect((await pushLead(request, lead.id, 1)).status()).toBe(201);
  let csrf = await loginClient(request, client.username, client.password);
  const submit = () =>
    reviewLead(
      request,
      lead.id,
      2,
      csrf,
      randomUUID(),
      'NO_INFRINGEMENT',
      '核对后确认无侵权',
    );

  await setClientUserActive(coreLeadFixtures.admittedCustomer, false);
  expect((await submit()).status()).toBe(401);
  await setClientUserActive(coreLeadFixtures.admittedCustomer, true);
  csrf = await loginClient(request, client.username, client.password);

  await setClientBindingActive(coreLeadFixtures.admittedCustomer, false);
  expect([401, 403]).toContain((await submit()).status());
  await setClientBindingActive(coreLeadFixtures.admittedCustomer, true);
  csrf = await loginClient(request, client.username, client.password);

  await setCustomerStatus(coreLeadFixtures.admittedCustomer, 'DRAFT');
  expect([401, 403]).toContain((await submit()).status());
  expect(await countLeadReviewDecisions(lead.id)).toBe(0);
  expect(await countClientLeadReviewReceipts(lead.id)).toBe(0);
  expect(await getLead(lead.id)).toMatchObject({
    status: 'WAITING_REVIEW',
    version: 2,
  });
});

test('two distinct client review keys allow exactly one committed decision', async ({
  request,
}) => {
  const client = await createClientAccount(request);
  const lead = await (await createLead(request)).json();
  expect((await pushLead(request, lead.id, 1)).status()).toBe(201);
  const csrf = await loginClient(request, client.username, client.password);
  const responses = await Promise.all([
    reviewLead(request, lead.id, 2, csrf),
    reviewLead(request, lead.id, 2, csrf),
  ]);
  expect(
    responses.filter((response) => response.status() === 201),
  ).toHaveLength(1);
  expect(
    responses.filter((response) => response.status() === 409),
  ).toHaveLength(1);
  expect(await countLeadReviewDecisions(lead.id)).toBe(1);
  expect(await countClientLeadReviewReceipts(lead.id)).toBe(1);
});

test('decision or receipt write failures roll back client review state', async ({
  request,
}) => {
  const client = await createClientAccount(request);
  const first = await (await createLead(request)).json();
  const second = await (await createLead(request)).json();
  expect((await pushLead(request, first.id, 1)).status()).toBe(201);
  expect((await pushLead(request, second.id, 1)).status()).toBe(201);
  const csrf = await loginClient(request, client.username, client.password);

  await rejectLeadReviewDecisionWrites();
  expect((await reviewLead(request, first.id, 2, csrf)).status()).toBe(500);
  expect(await getLead(first.id)).toMatchObject({
    status: 'WAITING_REVIEW',
    version: 2,
  });
  expect(await countLeadReviewDecisions(first.id)).toBe(0);
  expect(await countClientLeadReviewReceipts(first.id)).toBe(0);
  await allowInjectedFailures();

  await rejectClientLeadReviewReceiptWrites();
  expect((await reviewLead(request, second.id, 2, csrf)).status()).toBe(500);
  expect(await getLead(second.id)).toMatchObject({
    status: 'WAITING_REVIEW',
    version: 2,
  });
  expect(await countLeadReviewDecisions(second.id)).toBe(0);
  expect(await countClientLeadReviewReceipts(second.id)).toBe(0);
  await allowInjectedFailures();
});

test('account, binding and admission revocation deny the next client review request', async ({
  request,
}) => {
  const client = await createClientAccount(request);
  const lead = await (await createLead(request)).json();
  expect((await pushLead(request, lead.id, 1)).status()).toBe(201);
  let csrf = await loginClient(request, client.username, client.password);

  await setClientUserActive(coreLeadFixtures.admittedCustomer, false);
  expect((await reviewLead(request, lead.id, 2, csrf)).status()).toBe(401);
  await setClientUserActive(coreLeadFixtures.admittedCustomer, true);
  csrf = await loginClient(request, client.username, client.password);

  await setClientBindingActive(coreLeadFixtures.admittedCustomer, false);
  expect([401, 403]).toContain(
    (await reviewLead(request, lead.id, 2, csrf)).status(),
  );
  await setClientBindingActive(coreLeadFixtures.admittedCustomer, true);
  csrf = await loginClient(request, client.username, client.password);

  await setCustomerStatus(coreLeadFixtures.admittedCustomer, 'DRAFT');
  expect([401, 403]).toContain(
    (await reviewLead(request, lead.id, 2, csrf)).status(),
  );
  expect(await countLeadReviewDecisions(lead.id)).toBe(0);
  expect(await countClientLeadReviewReceipts(lead.id)).toBe(0);
  expect(await getLead(lead.id)).toMatchObject({
    status: 'WAITING_REVIEW',
    version: 2,
  });
});

test('audit, child-table, and material metadata failures roll back with blob compensation', async ({
  request,
}) => {
  const baseline = await databaseCounts();
  await rejectAuditWrites('lead.created');
  const auditFailure = await createLead(request);
  expect(auditFailure.status()).toBe(500);
  expect(await databaseCounts()).toEqual(baseline);

  await rejectLeadProductWrites();
  const childFailure = await createLead(
    request,
    leadInput({
      products: [
        {
          title: 'ROLLBACK-PRODUCT',
          quantity: 1,
          unitPrice: '1.00',
          commentCount: 0,
        },
      ],
    }),
  );
  expect(childFailure.status()).toBe(500);
  expect(await databaseCounts()).toEqual(baseline);

  await rejectMaterialMetadataWrites();
  const draft = await request.post('/api/v1/materials/upload-drafts', {
    headers: authorizationA,
    data: {
      ownerType: 'CUSTOMER',
      ownerId: coreLeadFixtures.draftCustomer,
      category: 'CUSTOMER_IDENTITY',
      purpose: 'IDENTITY_FULL',
      originalFilename: 'rollback.jpg',
      declaredMimeType: 'image/jpeg',
    },
  });
  expect(draft.status(), await draft.text()).toBe(201);
  const created = await draft.json();
  const beforeFiles = await countStoredFiles();
  const metadataFailure = await request.put(
    `/api/v1/materials/upload-drafts/${created.id}/content`,
    {
      headers: {
        ...authorizationA,
        'Content-Type': 'application/octet-stream',
      },
      data: jpegBytes,
    },
  );
  expect(metadataFailure.status()).toBe(500);
  expect(await countStoredFiles()).toBe(beforeFiles);
  expect(await databaseCounts()).toEqual(baseline);
  await allowInjectedFailures();
});

test('unreferenced material can be restored while frozen evidence cannot be deleted', async ({
  request,
}) => {
  const material = await upload(request, {
    ownerType: 'CUSTOMER',
    ownerId: coreLeadFixtures.draftCustomer,
    purpose: 'IDENTITY_FULL',
    name: 'recoverable.pdf',
    mime: 'application/pdf',
    bytes: pdfBytes,
  });
  const stored = await getMaterialByVersion(material.contentVersionId);
  const removed = await request.delete(
    `/api/v1/materials/${stored!.materialId}?expectedVersion=1`,
    { headers: authorizationA },
  );
  expect(removed.status()).toBe(200);
  const restored = await request.post(
    `/api/v1/materials/${stored!.materialId}/restore`,
    {
      headers: authorizationA,
      data: { expectedVersion: 2 },
    },
  );
  expect(restored.status()).toBe(201);
  const admitted = await request.post(
    `/api/v1/customers/${coreLeadFixtures.draftCustomer}/admission`,
    {
      headers: { ...authorizationA, 'Idempotency-Key': randomUUID() },
      data: admissionInput([material.contentVersionId]),
    },
  );
  expect(admitted.status(), await admitted.text()).toBe(201);
  const frozenCustomer = await request.delete(
    `/api/v1/materials/${stored!.materialId}?expectedVersion=3`,
    { headers: authorizationA },
  );
  expect(frozenCustomer.status()).toBe(409);

  const screenshot = await upload(request, {
    ownerType: 'LEAD_DRAFT',
    purpose: 'LEAD_SCREENSHOT',
    name: 'frozen.jpg',
    mime: 'image/jpeg',
    bytes: jpegBytes,
  });
  const lead = await createLead(
    request,
    leadInput({
      reservedLeadId: screenshot.reservedOwnerId,
      leadScreenshotContentVersionIds: [screenshot.contentVersionId],
    }),
  );
  expect(lead.status(), await lead.text()).toBe(201);
  const screenshotStored = await getMaterialByVersion(
    screenshot.contentVersionId,
  );
  const frozenLead = await request.delete(
    `/api/v1/materials/${screenshotStored!.materialId}?expectedVersion=1`,
    { headers: authorizationA },
  );
  expect(frozenLead.status()).toBe(409);
});

test('delete serialization rejects a material frozen after its zero-reference read', async ({
  request,
}) => {
  const material = await upload(request, {
    ownerType: 'CUSTOMER',
    ownerId: coreLeadFixtures.draftCustomer,
    purpose: 'IDENTITY_FULL',
    name: 'delete-race.pdf',
    mime: 'application/pdf',
    bytes: pdfBytes,
  });
  const stored = await getMaterialByVersion(material.contentVersionId);
  const barrier = await installMaterialStatusBarrier(
    stored!.materialId,
    'DELETED',
  );
  const deleting = request.delete(
    `/api/v1/materials/${stored!.materialId}?expectedVersion=1`,
    { headers: authorizationA },
  );
  await barrier.wait();
  const admitted = await request.post(
    `/api/v1/customers/${coreLeadFixtures.draftCustomer}/admission`,
    {
      headers: { ...authorizationA, 'Idempotency-Key': randomUUID() },
      data: admissionInput([material.contentVersionId]),
    },
  );
  expect(admitted.status(), await admitted.text()).toBe(201);
  await barrier.release();
  const removed = await deleting;
  expect(removed.status(), await removed.text()).toBe(409);
  expect(await getMaterialLifecycle(stored!.materialId)).toMatchObject({
    status: 'ACTIVE',
    version: 1,
    contentVersions: [{ status: 'AVAILABLE' }],
  });
  expect(await getMaterialAuditActions(stored!.materialId)).toEqual([]);
});

test('material delete audit failure rolls back its state transition', async ({
  request,
}) => {
  const material = await upload(request, {
    ownerType: 'CUSTOMER',
    ownerId: coreLeadFixtures.draftCustomer,
    purpose: 'IDENTITY_FULL',
    name: 'delete-audit.pdf',
    mime: 'application/pdf',
    bytes: pdfBytes,
  });
  const stored = await getMaterialByVersion(material.contentVersionId);
  await rejectAuditWrites('material.deleted');
  const removed = await request.delete(
    `/api/v1/materials/${stored!.materialId}?expectedVersion=1`,
    { headers: authorizationA },
  );
  expect(removed.status()).toBe(500);
  await allowInjectedFailures();
  expect(await getMaterialLifecycle(stored!.materialId)).toMatchObject({
    status: 'ACTIVE',
    version: 1,
    contentVersions: [{ status: 'AVAILABLE' }],
  });
  expect(await getMaterialAuditActions(stored!.materialId)).toEqual([]);
});

test('cleanup claim wins over restore without producing ACTIVE material with purged bytes', async ({
  request,
}) => {
  const material = await upload(request, {
    ownerType: 'CUSTOMER',
    ownerId: coreLeadFixtures.draftCustomer,
    purpose: 'IDENTITY_FULL',
    name: 'cleanup-wins.pdf',
    mime: 'application/pdf',
    bytes: pdfBytes,
  });
  const stored = await getMaterialByVersion(material.contentVersionId);
  const removed = await request.delete(
    `/api/v1/materials/${stored!.materialId}?expectedVersion=1`,
    { headers: authorizationA },
  );
  expect(removed.status(), await removed.text()).toBe(200);
  const now = new Date();
  await setMaterialDeletedAt(
    stored!.materialId,
    new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000),
  );
  const cleanup = startMaterialCleanup(
    new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
  );
  await cleanup.deleteStarted;
  const restored = await request.post(
    `/api/v1/materials/${stored!.materialId}/restore`,
    { headers: authorizationA, data: { expectedVersion: 2 } },
  );
  expect(restored.status(), await restored.text()).toBe(409);
  cleanup.allowDelete();
  await cleanup.result;
  expect(await getMaterialLifecycle(stored!.materialId)).toMatchObject({
    status: 'DELETED',
    version: 2,
    contentVersions: [{ status: 'PURGED' }],
  });
  expect(await getMaterialAuditActions(stored!.materialId)).toEqual([
    'material.deleted',
  ]);
});

test('restore lock makes cleanup skip the same material and current content version', async ({
  request,
}) => {
  const material = await upload(request, {
    ownerType: 'CUSTOMER',
    ownerId: coreLeadFixtures.draftCustomer,
    purpose: 'IDENTITY_FULL',
    name: 'restore-wins.pdf',
    mime: 'application/pdf',
    bytes: pdfBytes,
  });
  const stored = await getMaterialByVersion(material.contentVersionId);
  const removed = await request.delete(
    `/api/v1/materials/${stored!.materialId}?expectedVersion=1`,
    { headers: authorizationA },
  );
  expect(removed.status(), await removed.text()).toBe(200);
  const now = new Date();
  await setMaterialDeletedAt(
    stored!.materialId,
    new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000),
  );
  const barrier = await installMaterialStatusBarrier(
    stored!.materialId,
    'ACTIVE',
  );
  const restoring = request.post(
    `/api/v1/materials/${stored!.materialId}/restore`,
    { headers: authorizationA, data: { expectedVersion: 2 } },
  );
  await barrier.wait();
  const cleanup = startMaterialCleanup(
    new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
  );
  await cleanup.result;
  await barrier.release();
  const restored = await restoring;
  expect(restored.status(), await restored.text()).toBe(201);
  expect(await getMaterialLifecycle(stored!.materialId)).toMatchObject({
    status: 'ACTIVE',
    version: 3,
    contentVersions: [{ status: 'AVAILABLE' }],
  });
  expect(await getMaterialAuditActions(stored!.materialId)).toEqual([
    'material.deleted',
    'material.restored',
  ]);
});

test('lead numbers stop after 999 and concurrent creation never duplicates a number', async ({
  request,
}) => {
  await setLeadCounter(998);
  const last = await createLead(request);
  expect(last.status(), await last.text()).toBe(201);
  expect((await last.json()).businessNo).toMatch(/-999$/u);
  const exhausted = await createLead(request);
  expect(exhausted.status()).toBe(409);
  expect(await exhausted.json()).toMatchObject({
    code: 'LEAD_NUMBER_EXHAUSTED',
  });

  await setLeadCounter(0);
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      createLead(request, leadInput({ shopName: `并发店铺 ${index}` })),
    ),
  );
  const successes = results.filter((response) => response.status() === 201);
  const conflicts = results.filter((response) => response.status() === 409);
  expect(successes.length).toBeGreaterThan(1);
  expect(successes.length + conflicts.length).toBe(results.length);
  for (const response of conflicts) {
    expect(await response.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
  }
  const numbers = await Promise.all(
    successes.map(
      async (response) =>
        ((await response.json()) as { businessNo: string }).businessNo,
    ),
  );
  expect(new Set(numbers).size).toBe(numbers.length);
  expect(await countLeads()).toBe(4 + successes.length);
});

test('no-evidence archive enforces Grant, state, version, replay and enterprise read scope', async ({
  request,
}) => {
  const clientA = await createClientAccount(request);
  const clientB = await createClientAccount(request, {
    customerId: coreLeadFixtures.foreignCustomer,
    headers: { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
  });
  const csrfA = await loginClient(request, clientA.username, clientA.password);
  const lead = await createInfringementReviewedLead(request, csrfA);
  const clientCannotArchive = await decideNoEvidence(
    request,
    lead.id,
    3,
    '客户不能代替运营决定',
    randomUUID(),
    { 'X-CSRF-Token': csrfA },
  );
  expect(clientCannotArchive.status()).toBe(403);
  const waiting = await (await createLead(request)).json();
  expect(
    (await decideNoEvidence(request, waiting.id, 1, '状态错误')).status(),
  ).toBe(409);
  const missingReview = await decideNoEvidence(
    request,
    '70000000-0000-4000-8000-000000000002',
    1,
    '缺少客户确认侵权事实',
  );
  expect(missingReview.status()).toBe(409);
  const stale = await decideNoEvidence(request, lead.id, 2, '版本过期');
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
  for (const reason of ['', '   ', 'x'.repeat(5001)]) {
    const invalid = await decideNoEvidence(request, lead.id, 3, reason);
    expect(invalid.status(), await invalid.text()).toBe(400);
  }
  expect(
    (
      await decideNoEvidence(
        request,
        lead.id,
        3,
        '无范围',
        randomUUID(),
        authorizationSelf,
      )
    ).status(),
  ).toBe(403);
  const otherDepartment = await decideNoEvidence(
    request,
    lead.id,
    3,
    '跨部门',
    randomUUID(),
    { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
  );
  expect(otherDepartment.status()).toBe(404);
  await setGrant('lead.evidence.decide', false);
  expect((await decideNoEvidence(request, lead.id, 3, '无权限')).status()).toBe(
    403,
  );
  await setGrant('lead.evidence.decide', true);

  const key = randomUUID();
  const first = await decideNoEvidence(
    request,
    lead.id,
    3,
    '  本次不再取证  ',
    key,
  );
  expect(first.status(), await first.text()).toBe(201);
  const snapshot = await first.json();
  expect(snapshot).toMatchObject({
    leadId: lead.id,
    status: 'ARCHIVED',
    version: 4,
    reason: '本次不再取证',
  });
  expect(await getLead(lead.id)).toMatchObject({
    status: 'ARCHIVED',
    version: 4,
  });
  expect(await getLeadEvidenceDecision(lead.id)).toMatchObject({
    leadId: lead.id,
    result: 'NO_EVIDENCE',
    reason: '本次不再取证',
    archiveType: 'NO_EVIDENCE',
    fromVersion: 3,
    toVersion: 4,
  });
  expect(await countLeadReviewDecisions(lead.id)).toBe(1);
  expect(await countLeadEvidenceDecisions(lead.id)).toBe(1);
  expect(await countLeadEvidenceAudits(lead.id)).toBe(1);
  expect(await countLeadEvidenceReceipts(lead.id)).toBe(1);
  const replay = await decideNoEvidence(
    request,
    lead.id,
    3,
    '  本次不再取证  ',
    key,
  );
  expect(replay.status()).toBe(201);
  expect(await replay.json()).toEqual(snapshot);
  const changedIntent = await decideNoEvidence(
    request,
    lead.id,
    3,
    '不同原因',
    key,
  );
  expect(changedIntent.status()).toBe(409);
  expect(await changedIntent.json()).toMatchObject({
    code: 'IDEMPOTENCY_CONFLICT',
  });
  expect(
    (await decideNoEvidence(request, lead.id, 4, '再次归档')).status(),
  ).toBe(409);

  await setGrant('lead.evidence.decide', false);
  expect(
    (
      await decideNoEvidence(request, lead.id, 3, '  本次不再取证  ', key)
    ).status(),
  ).toBe(403);
  await setGrant('lead.evidence.decide', true);
  const detail = await request.get(`/api/v1/client/leads/${lead.id}`);
  expect(detail.status(), await detail.text()).toBe(200);
  const clientDetail = await detail.json();
  expect(clientDetail.evidenceDecision).toMatchObject({
    reason: '本次不再取证',
    archiveType: 'NO_EVIDENCE',
  });
  expect(clientDetail.reviewDecision).toMatchObject({ result: 'INFRINGEMENT' });
  expect(JSON.stringify(clientDetail)).not.toContain('responsibleUserId');
  const processed = await request.get('/api/v1/client/leads?view=PROCESSED');
  expect(processed.status(), await processed.text()).toBe(200);
  expect(
    (await processed.json()).items.map((item: { id: string }) => item.id),
  ).toContain(lead.id);

  await loginClient(request, clientB.username, clientB.password);
  expect((await request.get(`/api/v1/client/leads/${lead.id}`)).status()).toBe(
    404,
  );
});

test('no-evidence competing commands and failed durable writes never leave partial archive facts', async ({
  request,
}) => {
  const client = await createClientAccount(request);
  const csrf = await loginClient(request, client.username, client.password);
  const lead = await createInfringementReviewedLead(request, csrf);
  const contenders = await Promise.all([
    decideNoEvidence(request, lead.id, 3, '并发甲'),
    decideNoEvidence(request, lead.id, 3, '并发乙'),
  ]);
  expect(contenders.map((result) => result.status()).sort()).toEqual([
    201, 409,
  ]);
  expect(await countLeadEvidenceDecisions(lead.id)).toBe(1);
  expect(await countLeadEvidenceReceipts(lead.id)).toBe(1);
  expect(await countLeadEvidenceAudits(lead.id)).toBe(1);

  for (const reject of [
    () => rejectLeadEvidenceDecisionWrites(),
    () => rejectLeadEvidenceReceiptWrites(),
    () => rejectAuditWrites('lead.evidence_decided'),
  ]) {
    const candidate = await createInfringementReviewedLead(request, csrf);
    await reject();
    const failed = await decideNoEvidence(request, candidate.id, 3, '写入失败');
    expect(failed.status()).toBeGreaterThanOrEqual(500);
    expect(await getLead(candidate.id)).toMatchObject({
      status: 'WAITING_EVIDENCE_DECISION',
      version: 3,
    });
    expect(await countLeadEvidenceDecisions(candidate.id)).toBe(0);
    expect(await countLeadEvidenceAudits(candidate.id)).toBe(0);
    expect(await countLeadEvidenceReceipts(candidate.id)).toBe(0);
  }
});

test('withdrawal application enforces Grant, state, retries, races, and full transaction rollback', async ({
  request,
}) => {
  const client = await createClientAccount(request);
  const csrf = await loginClient(request, client.username, client.password);
  const archived = await archiveLeadForWithdrawal(request, csrf);
  const leadId = archived.lead.id;
  const originalDecision = await getLeadReviewDecision(leadId);
  expect(originalDecision?.result).toBe('NO_INFRINGEMENT');

  const waiting = await (await createLead(request)).json();
  expect(
    (await applyLeadWithdrawal(request, waiting.id, 1, '未归档')).status(),
  ).toBe(409);
  const infringementLead = await (await createLead(request)).json();
  expect((await pushLead(request, infringementLead.id, 1)).status()).toBe(201);
  const infringementReview = await reviewLead(
    request,
    infringementLead.id,
    2,
    csrf,
  );
  expect(infringementReview.status()).toBe(201);
  const wrongArchive = await applyLeadWithdrawal(
    request,
    infringementLead.id,
    3,
    '错误归档类型',
  );
  expect(wrongArchive.status()).toBe(409);
  expect(await wrongArchive.json()).toMatchObject({ code: 'INVALID_STATE' });
  for (const reason of ['', '   ', 'x'.repeat(5001)]) {
    const invalid = await applyLeadWithdrawal(request, leadId, 3, reason);
    expect(invalid.status(), await invalid.text()).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  }
  const stale = await applyLeadWithdrawal(request, leadId, 2, '过期版本');
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
  await setGrant('lead.withdraw.apply', false);
  expect(
    (await applyLeadWithdrawal(request, leadId, 3, '无授权')).status(),
  ).toBe(403);
  await setGrant('lead.withdraw.apply', true);
  await setTeamActive(coreLeadFixtures.teamA, false);

  const key = randomUUID();
  const accepted = await applyLeadWithdrawal(
    request,
    leadId,
    3,
    '  补充关键证据  ',
    key,
  );
  expect(accepted.status(), await accepted.text()).toBe(201);
  await setTeamActive(coreLeadFixtures.teamA, true);
  const snapshot = await accepted.json();
  expect(snapshot).toMatchObject({
    leadId,
    status: 'ARCHIVED',
    version: 4,
    reason: '补充关键证据',
  });
  await setGrant('lead.withdraw.apply', false);
  const revokedReplay = await applyLeadWithdrawal(
    request,
    leadId,
    3,
    '补充关键证据',
    key,
  );
  expect(revokedReplay.status()).toBe(403);
  await setGrant('lead.withdraw.apply', true);
  const replay = await applyLeadWithdrawal(
    request,
    leadId,
    3,
    '补充关键证据',
    key,
  );
  expect(replay.status()).toBe(201);
  expect(await replay.json()).toEqual(snapshot);
  const conflict = await applyLeadWithdrawal(
    request,
    leadId,
    3,
    '另一原因',
    key,
  );
  expect(conflict.status()).toBe(409);
  expect(await conflict.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  expect(await getLead(leadId)).toMatchObject({
    status: 'ARCHIVED',
    version: 4,
    activeReviewDecisionId: originalDecision?.id,
  });
  expect(await getLeadReviewDecision(leadId)).toEqual(originalDecision);
  expect(await countLeadWithdrawalApplications(leadId)).toBe(1);
  expect(await countLeadWithdrawalAudits(leadId)).toBe(1);

  const racing = await archiveLeadForWithdrawal(
    request,
    await loginClient(request, client.username, client.password),
  );
  const raced = await Promise.all([
    applyLeadWithdrawal(request, racing.lead.id, 3, '并发申请', randomUUID()),
    applyLeadWithdrawal(request, racing.lead.id, 3, '并发申请', randomUUID()),
  ]);
  expect(raced.filter((response) => response.status() === 201)).toHaveLength(1);
  expect(raced.filter((response) => response.status() === 409)).toHaveLength(1);
  expect(await countLeadWithdrawalApplications(racing.lead.id)).toBe(1);
  expect(await countLeadWithdrawalAudits(racing.lead.id)).toBe(1);

  for (const failure of ['application', 'audit'] as const) {
    const rollback = await archiveLeadForWithdrawal(
      request,
      await loginClient(request, client.username, client.password),
    );
    if (failure === 'application') await rejectWithdrawalApplicationWrites();
    else await rejectAuditWrites('lead.withdrawal_applied');
    expect(
      (
        await applyLeadWithdrawal(request, rollback.lead.id, 3, '应整体回滚')
      ).status(),
    ).toBe(500);
    await allowInjectedFailures();
    expect(await getLead(rollback.lead.id)).toMatchObject({
      status: 'ARCHIVED',
      version: 3,
    });
    expect(await countLeadWithdrawalApplications(rollback.lead.id)).toBe(0);
    expect(await countLeadWithdrawalAudits(rollback.lead.id)).toBe(0);
  }
});

test('withdrawal confirmation revalidates client identity, rolls back, and preserves immutable replay history', async ({
  request,
}) => {
  const owner = await createClientAccount(request);
  const foreign = await createClientAccount(request, {
    customerId: coreLeadFixtures.foreignCustomer,
    headers: { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
  });
  let csrf = await loginClient(request, owner.username, owner.password);
  const screenshot = await upload(request, {
    ownerType: 'LEAD_DRAFT',
    purpose: 'LEAD_SCREENSHOT',
    name: 'withdrawal-allowed.jpg',
    mime: 'image/jpeg',
    bytes: jpegBytes,
  });
  const archived = await archiveLeadForWithdrawal(
    request,
    csrf,
    leadInput({
      reservedLeadId: screenshot.reservedOwnerId,
      leadScreenshotContentVersionIds: [screenshot.contentVersionId],
    }),
  );
  const applied = await applyLeadWithdrawal(
    request,
    archived.lead.id,
    3,
    '原企业确认',
  );
  expect(applied.status()).toBe(201);
  const application = await applied.json();
  const foreignCsrf = await loginClient(
    request,
    foreign.username,
    foreign.password,
  );
  expect(
    (
      await confirmLeadWithdrawal(
        request,
        archived.lead.id,
        application.id,
        4,
        foreignCsrf,
      )
    ).status(),
  ).toBe(404);
  expect(
    (await request.get(`/api/v1/client/leads/${archived.lead.id}`)).status(),
  ).toBe(404);
  const foreignMaterial = await getMaterialByVersion(
    screenshot.contentVersionId,
  );
  const foreignScreenshot = await request.get(
    `/api/v1/materials/${foreignMaterial!.materialId}/versions/${screenshot.contentVersionId}/content`,
  );
  expect(foreignScreenshot.status()).toBe(404);
  csrf = await loginClient(request, owner.username, owner.password);
  const unpushed = await (await createLead(request)).json();
  expect(
    (
      await confirmLeadWithdrawal(request, unpushed.id, randomUUID(), 1, csrf)
    ).status(),
  ).toBe(404);
  const stale = await confirmLeadWithdrawal(
    request,
    archived.lead.id,
    application.id,
    3,
    csrf,
  );
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });

  await setClientUserActive(coreLeadFixtures.admittedCustomer, false);
  expect(
    (
      await confirmLeadWithdrawal(
        request,
        archived.lead.id,
        application.id,
        4,
        csrf,
      )
    ).status(),
  ).toBe(401);
  await setClientUserActive(coreLeadFixtures.admittedCustomer, true);
  csrf = await loginClient(request, owner.username, owner.password);
  await setClientBindingActive(coreLeadFixtures.admittedCustomer, false);
  expect([401, 403]).toContain(
    (
      await confirmLeadWithdrawal(
        request,
        archived.lead.id,
        application.id,
        4,
        csrf,
      )
    ).status(),
  );
  await setClientBindingActive(coreLeadFixtures.admittedCustomer, true);
  csrf = await loginClient(request, owner.username, owner.password);
  await setCustomerStatus(coreLeadFixtures.admittedCustomer, 'DRAFT');
  expect([401, 403]).toContain(
    (
      await confirmLeadWithdrawal(
        request,
        archived.lead.id,
        application.id,
        4,
        csrf,
      )
    ).status(),
  );
  await setCustomerStatus(coreLeadFixtures.admittedCustomer, 'ADMITTED');
  csrf = await loginClient(request, owner.username, owner.password);

  const allowedMaterial = await getMaterialByVersion(
    screenshot.contentVersionId,
  );
  expect(allowedMaterial).not.toBeNull();
  const allowedScreenshot = await request.get(
    `/api/v1/materials/${allowedMaterial!.materialId}/versions/${screenshot.contentVersionId}/content`,
  );
  expect(allowedScreenshot.status()).toBe(200);
  expect(await allowedScreenshot.body()).toEqual(jpegBytes);
  const unlinkedScreenshot = await upload(request, {
    ownerType: 'LEAD_DRAFT',
    purpose: 'LEAD_SCREENSHOT',
    name: 'withdrawal-unlinked.jpg',
    mime: 'image/jpeg',
    bytes: jpegBytes,
  });
  const unlinkedMaterial = await getMaterialByVersion(
    unlinkedScreenshot.contentVersionId,
  );
  const deniedUnlinked = await request.get(
    `/api/v1/materials/${unlinkedMaterial!.materialId}/versions/${unlinkedScreenshot.contentVersionId}/content`,
  );
  expect([403, 404]).toContain(deniedUnlinked.status());

  await rejectWithdrawalConfirmationWrites();
  expect(
    (
      await confirmLeadWithdrawal(
        request,
        archived.lead.id,
        application.id,
        4,
        csrf,
      )
    ).status(),
  ).toBe(500);
  await allowInjectedFailures();
  expect(await getLead(archived.lead.id)).toMatchObject({
    status: 'ARCHIVED',
    version: 4,
  });
  expect(await countLeadWithdrawalConfirmations(archived.lead.id)).toBe(0);
  const confirmationKey = randomUUID();
  const confirmed = await confirmLeadWithdrawal(
    request,
    archived.lead.id,
    application.id,
    4,
    csrf,
    confirmationKey,
  );
  expect(confirmed.status(), await confirmed.text()).toBe(201);
  const confirmationSnapshot = await confirmed.json();
  expect(confirmationSnapshot).toMatchObject({
    status: 'WAITING_REVIEW',
    version: 5,
    applicationId: application.id,
  });
  const repeatedWithNewKey = await confirmLeadWithdrawal(
    request,
    archived.lead.id,
    application.id,
    5,
    csrf,
  );
  expect(repeatedWithNewKey.status()).toBe(409);
  expect(await repeatedWithNewKey.json()).toMatchObject({
    code: 'INVALID_STATE',
  });
  await rejectClientLeadReviewReceiptWrites();
  expect((await reviewLead(request, archived.lead.id, 5, csrf)).status()).toBe(
    500,
  );
  await allowInjectedFailures();
  expect(await getLead(archived.lead.id)).toMatchObject({
    status: 'WAITING_REVIEW',
    version: 5,
    activeReviewDecisionId: null,
  });
  expect(await countLeadReviewDecisions(archived.lead.id)).toBe(1);
  const second = await reviewLead(request, archived.lead.id, 5, csrf);
  expect(second.status()).toBe(201);
  const secondSnapshot = await second.json();
  const priorReviewReplay = await reviewLead(
    request,
    archived.lead.id,
    2,
    csrf,
    archived.reviewKey,
    'NO_INFRINGEMENT',
    '原审核结论保持不变',
  );
  expect(priorReviewReplay.status()).toBe(201);
  expect(await priorReviewReplay.json()).toEqual(archived.reviewResult);
  const confirmationReplay = await confirmLeadWithdrawal(
    request,
    archived.lead.id,
    application.id,
    4,
    csrf,
    confirmationKey,
  );
  expect(await confirmationReplay.json()).toEqual(confirmationSnapshot);
  expect(await getLead(archived.lead.id)).toMatchObject({
    status: 'WAITING_EVIDENCE_DECISION',
    version: 6,
  });
  const decisions = await getLeadReviewDecisions(archived.lead.id);
  expect(decisions.map((decision) => decision.result)).toEqual([
    'NO_INFRINGEMENT',
    'INFRINGEMENT',
  ]);
  expect(decisions[0].receipt?.resultSnapshot).toEqual(archived.reviewResult);
  expect(decisions[1].receipt?.resultSnapshot).toEqual(secondSnapshot);
  const historicalScreenshot = await request.get(
    `/api/v1/materials/${allowedMaterial!.materialId}/versions/${screenshot.contentVersionId}/content`,
  );
  expect(historicalScreenshot.status()).toBe(200);
  expect(await historicalScreenshot.body()).toEqual(jpegBytes);

  const racingCsrf = await loginClient(request, owner.username, owner.password);
  const racing = await archiveLeadForWithdrawal(request, racingCsrf);
  const racingApplicationResponse = await applyLeadWithdrawal(
    request,
    racing.lead.id,
    3,
    '并发确认',
  );
  const racingApplication = await racingApplicationResponse.json();
  const confirmRace = await Promise.all([
    confirmLeadWithdrawal(
      request,
      racing.lead.id,
      racingApplication.id,
      4,
      racingCsrf,
      randomUUID(),
    ),
    confirmLeadWithdrawal(
      request,
      racing.lead.id,
      racingApplication.id,
      4,
      racingCsrf,
      randomUUID(),
    ),
  ]);
  expect(
    confirmRace.filter((response) => response.status() === 201),
    JSON.stringify(
      await Promise.all(
        confirmRace.map(async (response) => ({
          status: response.status(),
          body: await response.text(),
        })),
      ),
    ),
  ).toHaveLength(1);
  expect(
    confirmRace.filter((response) => response.status() === 409),
  ).toHaveLength(1);
  expect(await countLeadWithdrawalConfirmations(racing.lead.id)).toBe(1);
  expect(await getLead(racing.lead.id)).toMatchObject({
    status: 'WAITING_REVIEW',
    version: 5,
    activeReviewDecisionId: null,
  });
});

test('withdrawal migrations upgrade empty and previous schemas without losing immutable history', async () => {
  const output = execFileSync(
    process.execPath,
    ['backend/src/modules/leads/core-ld-withdrawal-migration-probe.mjs'],
    { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  expect(output).toContain('empty migration chain passed:');
  expect(output).toContain('previous-schema upgrade and constraints passed');
});

test('core lead migrations preserve legacy facts and roll back failed phases', async () => {
  const result = await verifyCoreLeadMigration();
  expect(result.empty.tables).toEqual([
    'client_lead_review_receipts',
    'customer_account_bindings',
    'customer_admission_receipts',
    'lead_command_receipts',
    'lead_number_counters',
    'lead_review_decisions',
    'leads',
    'materials',
    'upload_drafts',
  ]);
  expect(result.reviewIntegrity).toEqual({
    wrongCustomer: '23503',
    wrongReviewer: '23503',
    wrongBindingCustomer: '23503',
    wrongActor: '23503',
    wrongReceiptBinding: '23503',
    wrongLead: '23503',
    wrongVersion: '23503',
    invalidVersionPair: '23514',
    nonReviewAction: '23514',
    decisionUpdate: '55000',
    decisionDelete: '55000',
    receiptUpdate: '55000',
    receiptDelete: '55000',
    leadIdentityUpdate: '23503',
    bindingIdentityUpdate: '23503',
  });
  expect(result.reviewUpgrade).toEqual({
    rowsPreserved: true,
    leadFactsPreserved: true,
    receiptReplayable: true,
    decisionCount: 1,
    receiptCount: 1,
  });
  expect(result.archiveUpgrade).toEqual({
    oldFactsNull: true,
    oldSnapshotPreserved: true,
    oldFingerprintPreserved: true,
    oldReceiptLinked: true,
  });
  expect(result.archiveConstraints).toEqual({
    valid: null,
    blank: '23514',
    overlong: '23514',
    missingType: '23514',
    missingTime: '23514',
    mismatchedFacts: '23514',
    decisionUpdate: '55000',
    decisionDelete: '55000',
  });
  expect(result.archiveFailure).toEqual({
    code: '42701',
    originalColumnPreserved: 1,
    addedColumns: 0,
    archiveTypes: 0,
    addedConstraints: 0,
  });
  expect(result.reviewActionRecovery).toEqual({ actionCount: 1 });
  expect(result.reviewSchemaFailure).toEqual({
    code: '42P07',
    originalDecisionColumns: 1,
    receiptTables: 0,
    mutationTriggers: 0,
    reviewEnumTypes: 0,
  });
  expect(result.reviewIntegrityFailure).toEqual({
    code: '42723',
    addedConstraints: 0,
    receiptTriggers: 0,
  });
  expect(result.upgrade).toMatchObject({
    known: {
      customer_type: 'ENTERPRISE',
      identity_type: 'BUSINESS_LICENSE',
      profile_status: 'DRAFT',
    },
    unknown: {
      customer_type: 'legacy-company',
      identity_type: 'legacy-document',
      profile_status: 'DRAFT',
    },
    invalidAdmittedCode: '23514',
    compatibleAdmittedStatus: 'ADMITTED',
    grantCounts: { bootstrap: 4, shared: 0, incomplete: 0 },
    pushGrantCounts: { bootstrap: 1, shared: 0, incomplete: 0 },
    revisions: { bootstrap: 5, shared: 1, incomplete: 1 },
    identityIsolation: {
      unboundClientCode: '23514',
      clientMembershipCode: '23514',
      clientRoleCode: '23514',
      internalBindingCode: '23514',
      lastBindingDeleteCode: '23514',
      pushedAtOnlyCode: '23514',
      pushedByOnlyCode: '23514',
    },
  });
  expect(result.clientActionRecovery).toEqual({
    pushActionCount: 2,
    accountTypeExists: true,
  });
  expect(result.clientSchemaFailure).toEqual({
    code: '42P07',
    addedColumns: 0,
  });
  expect(result.schemaFailure).toEqual({
    code: '42P07',
    createdTables: 0,
    addedColumns: 0,
    addedConstraints: 0,
  });
  expect(result.backfillFailure).toEqual({
    code: '23514',
    grantCount: 0,
    revision: 1,
    grantInsertAttempts: 4,
    revisionUpdateAttempts: 1,
  });
});

test('real operator decision and notary browser archive a frozen certificate into one internal pending-match case', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const client = await createClientAccount(request);
  const clientCsrf = await loginClient(
    request,
    client.username,
    client.password,
  );
  const matterId = await createIssuanceReadyMatter(request, clientCsrf, {
    state: 'KNOWN',
    amount: '23.45',
  });
  const notary = await createNotaryAccountForMatter(request, matterId);

  await page.goto(`/notary-matters/${matterId}`);
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/notary-matters/${matterId}$`, 'u'));
  await expect(
    page.locator('[data-test="issuance-decision-section"]'),
  ).toBeVisible();
  await page.locator('[data-test="issuance-decision-issue"]').check();
  await page.locator('[data-test="issuance-decision-submit"]').click();
  await expect(
    page.locator('[data-test="issuance-decision-record"]'),
  ).toContainText('待出证');
  expect(await getNotaryOpeningReviewMatter(matterId)).toEqual({
    stage: 'WAITING_CERTIFICATE',
    version: 5,
  });

  await page.getByRole('button', { name: '退出登录' }).click();
  await page.goto(`/notary-portal/matters/${matterId}`);
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(notary.username);
  await page.getByLabel('密码').fill(notary.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/notary-portal/matters/${matterId}$`, 'u'),
  );

  const form = page.locator('[data-test="certificate-form"]');
  await expect(form).toBeVisible();
  await form
    .locator('[data-test="certificate-number"]')
    .fill('（2026）浙证字005号');
  await form.locator('[data-test="certificate-date"]').fill('2026-09-28');
  await form.locator('[data-test="certificate-file-input"]').setInputFiles({
    name: '已出具公证书.pdf',
    mimeType: 'application/pdf',
    buffer: pdfBytes,
  });
  const selectedCertificate = form.locator(
    '[data-test^="certificate-select-"]',
  );
  await expect(selectedCertificate).toHaveCount(1);
  await expect(selectedCertificate).toBeChecked();
  await form.locator('[data-test="fee-notary-state"]').selectOption('KNOWN');
  await form.locator('[data-test="fee-notary-amount"]').fill('120.00');
  await form
    .locator('[data-test="fee-investigation-state"]')
    .selectOption('PENDING');
  await form
    .locator('[data-test="fee-disclosure-state"]')
    .selectOption('KNOWN');
  await form.locator('[data-test="fee-disclosure-amount"]').fill('0.00');
  await form.locator('[data-test="certificate-submit"]').click();

  const record = page.locator('[data-test="certificate-record"]');
  await expect(record).toBeVisible();
  await expect(record).toContainText('（2026）浙证字005号');
  await expect(page.locator('[data-test="certificate-success"]')).toContainText(
    'CA-',
  );
  await page.reload();
  await expect(record).toContainText('（2026）浙证字005号');

  const portalDetail = await request.get(
    `/api/v1/notary-portal/matters/${matterId}`,
    { headers: { 'X-CSRF-Token': notary.csrfToken } },
  );
  expect(portalDetail.status(), await portalDetail.text()).toBe(200);
  const portalResult = await portalDetail.json();
  expect(portalResult).toMatchObject({
    id: matterId,
    stage: 'ARCHIVED',
    version: 6,
    certificate: {
      certificateNo: '（2026）浙证字005号',
      files: [
        {
          originalFilename: '已出具公证书.pdf',
          mimeType: 'application/pdf',
        },
      ],
      needDisclose: false,
      disclosureFiles: [],
    },
  });
  const frozenFile = portalResult.certificate.files[0] as {
    materialId: string;
    contentVersionId: string;
  };
  const certificateDownload = page.waitForEvent('download');
  await page
    .locator(
      `[data-test="download-certificate-${frozenFile.contentVersionId}"]`,
    )
    .click();
  expect(await readFile(await (await certificateDownload).path())).toEqual(
    pdfBytes,
  );

  const portalCertificate = portalResult.certificate as {
    caseId: string;
    caseBusinessNo: string;
  };
  expect(portalCertificate.caseId).toEqual(expect.any(String));
  expect(portalCertificate.caseBusinessNo).toMatch(/^CA-/u);
  const caseSummary = (await getNotaryCase(portalCertificate.caseId)) as {
    id: string;
    businessNo: string;
    stage: string;
  };
  expect(caseSummary).toMatchObject({
    id: portalCertificate.caseId,
    businessNo: portalCertificate.caseBusinessNo,
    stage: 'PENDING_MATCH',
  });
  expect(await getNotaryOpeningReviewMatter(matterId)).toEqual({
    stage: 'ARCHIVED',
    version: 6,
  });
  expect(await countNotaryCertificates(matterId)).toBe(1);
  expect(await countNotaryCertificateAudits(matterId)).toBe(1);
  expect(await countNotaryCertificateReceipts(matterId)).toBe(1);
  expect(await countCasesForMatter(matterId)).toBe(1);
  expect(await countCertificateMaterialReferences(matterId)).toBe(1);
  const storedCertificate = await getNotaryCertificate(matterId);
  expect(storedCertificate).toMatchObject({
    certificateNo: '（2026）浙证字005号',
  });
  expect(
    storedCertificate?.fees.map((fee) => ({
      category: fee.category,
      state: fee.state,
      amount: fee.amount?.toString() ?? null,
    })),
  ).toEqual(
    expect.arrayContaining([
      { category: 'NOTARY', state: 'KNOWN', amount: '120' },
      { category: 'INVESTIGATION', state: 'PENDING', amount: null },
      { category: 'DISCLOSURE', state: 'KNOWN', amount: '0' },
    ]),
  );
  expect(await getNotaryCase(caseSummary.id)).toMatchObject({
    id: caseSummary.id,
    businessNo: caseSummary.businessNo,
    stage: 'PENDING_MATCH',
    courtCaseNo: null,
    sourceNotaryMatterId: matterId,
  });

  expect(
    (
      await request.get(`/api/v1/cases/${caseSummary.id}`, {
        headers: { 'X-CSRF-Token': notary.csrfToken },
      })
    ).status(),
  ).toBe(403);
  const internalList = await request.get('/api/v1/cases', {
    headers: authorizationA,
  });
  expect(internalList.status(), await internalList.text()).toBe(200);
  expect((await internalList.json()).items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: caseSummary.id, stage: 'PENDING_MATCH' }),
    ]),
  );
  const internalDetail = await request.get(`/api/v1/cases/${caseSummary.id}`, {
    headers: authorizationA,
  });
  expect(internalDetail.status(), await internalDetail.text()).toBe(200);
  const caseDetail = await internalDetail.json();
  expect(caseDetail).toMatchObject({
    id: caseSummary.id,
    courtCaseNo: null,
    certificate: {
      certificateNo: '（2026）浙证字005号',
      files: [
        {
          contentVersionId: frozenFile.contentVersionId,
          originalFilename: '已出具公证书.pdf',
        },
      ],
    },
  });
  expect(caseDetail.fees).toHaveLength(4);
  expect(caseDetail.fees).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        category: 'NOTARY',
        state: 'KNOWN',
        amount: '120.00',
        sourceType: 'NOTARY_CERTIFICATE_FEE',
        sourceId: expect.any(String),
      }),
      expect.objectContaining({
        category: 'SAMPLE',
        state: 'KNOWN',
        amount: '23.45',
        sourceType: 'NOTARY_MATTER_EVIDENCE',
        sourceId: matterId,
      }),
      expect.objectContaining({
        category: 'INVESTIGATION',
        state: 'PENDING',
        amount: null,
        sourceType: 'NOTARY_CERTIFICATE_FEE',
      }),
      expect.objectContaining({
        category: 'DISCLOSURE',
        state: 'KNOWN',
        amount: '0.00',
        sourceType: 'NOTARY_CERTIFICATE_FEE',
      }),
    ]),
  );

  await page.getByRole('button', { name: '退出登录' }).click();
  await page.getByLabel('用户名').fill(notary.username);
  await page.getByLabel('密码').fill(notary.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/notary-portal\/matters$/u);
  await page.locator('[data-test="notary-segment-archived"]').click();
  await expect(page.locator('[data-test="notary-portal-row"]')).toHaveCount(1);

  await loginClient(request, client.username, client.password);
  expect((await request.get('/api/v1/cases')).status()).toBe(403);
  expect((await request.get(`/api/v1/cases/${caseSummary.id}`)).status()).toBe(
    403,
  );
});

test('certificate submission rejects another office and an inactive binding', async ({
  request,
}) => {
  const client = await createClientAccount(request);
  const clientCsrf = await loginClient(
    request,
    client.username,
    client.password,
  );
  const ownMatterId = await createCertificateReadyMatter(request, clientCsrf);
  const otherMatterId = await createCertificateReadyMatter(request, clientCsrf);
  const otherNotary = await createNotaryAccountForMatter(
    request,
    otherMatterId,
  );

  expect(
    (
      await request.get(`/api/v1/notary-portal/matters/${ownMatterId}`, {
        headers: { 'X-CSRF-Token': otherNotary.csrfToken },
      })
    ).status(),
  ).toBe(404);
  const ownDetail = await request.get(
    `/api/v1/notary-portal/matters/${otherMatterId}`,
    { headers: { 'X-CSRF-Token': otherNotary.csrfToken } },
  );
  expect(ownDetail.status(), await ownDetail.text()).toBe(200);
  const uploaded = await uploadCertificateForNotary(
    request,
    otherMatterId,
    otherNotary.csrfToken,
  );
  const input = certificateInput(uploaded.contentVersionId);
  await setNotaryBindingActive(otherNotary.accountId, false);
  try {
    const revoked = await issueNotaryCertificate(
      request,
      otherMatterId,
      otherNotary.csrfToken,
      input,
    );
    const revokedResult = await revoked.json();
    expect(revoked.status()).toBe(401);
    expect(revokedResult).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(await getNotaryOpeningReviewMatter(otherMatterId)).toEqual({
      stage: 'WAITING_CERTIFICATE',
      version: 5,
    });
    expect(await countNotaryCertificates(otherMatterId)).toBe(0);
  } finally {
    await setNotaryBindingActive(otherNotary.accountId, true);
  }
});

test('certificate command enforces old versions, idempotency and one concurrent winner', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const client = await createClientAccount(request);
  const clientCsrf = await loginClient(
    request,
    client.username,
    client.password,
  );
  const matterId = await createCertificateReadyMatter(request, clientCsrf);
  const notary = await createNotaryAccountForMatter(request, matterId);
  const uploaded = await uploadCertificateForNotary(
    request,
    matterId,
    notary.csrfToken,
  );
  const input = certificateInput(uploaded.contentVersionId);

  const stale = await issueNotaryCertificate(
    request,
    matterId,
    notary.csrfToken,
    { ...input, expectedVersion: 4 },
  );
  expect(stale.status(), await stale.text()).toBe(409);
  expect((await stale.json()).code).toBe('VERSION_CONFLICT');
  expect(await getNotaryOpeningReviewMatter(matterId)).toEqual({
    stage: 'WAITING_CERTIFICATE',
    version: 5,
  });

  const key = randomUUID();
  const first = await issueNotaryCertificate(
    request,
    matterId,
    notary.csrfToken,
    input,
    key,
  );
  expect(first.status(), await first.text()).toBe(201);
  const firstResult = await first.json();
  const replay = await issueNotaryCertificate(
    request,
    matterId,
    notary.csrfToken,
    input,
    key,
  );
  expect(replay.status(), await replay.text()).toBe(201);
  expect(await replay.json()).toEqual(firstResult);
  const changedReplay = await issueNotaryCertificate(
    request,
    matterId,
    notary.csrfToken,
    { ...input, certificateNo: '（2026）异参证字001号' },
    key,
  );
  expect(changedReplay.status(), await changedReplay.text()).toBe(409);
  expect((await changedReplay.json()).code).toBe('IDEMPOTENCY_CONFLICT');
  expect(await countNotaryCertificates(matterId)).toBe(1);
  expect(await countCasesForMatter(matterId)).toBe(1);
  expect(await countNotaryCertificateReceipts(matterId)).toBe(1);

  const concurrentClientCsrf = await loginClient(
    request,
    client.username,
    client.password,
  );
  const concurrentMatterId = await createCertificateReadyMatter(
    request,
    concurrentClientCsrf,
  );
  const concurrentNotary = await createNotaryAccountForMatter(
    request,
    concurrentMatterId,
  );
  const concurrentFile = await uploadCertificateForNotary(
    request,
    concurrentMatterId,
    concurrentNotary.csrfToken,
    '并发出证.pdf',
  );
  const concurrentInput = certificateInput(concurrentFile.contentVersionId);
  const outcomes = await Promise.all([
    issueNotaryCertificate(
      request,
      concurrentMatterId,
      concurrentNotary.csrfToken,
      concurrentInput,
    ),
    issueNotaryCertificate(
      request,
      concurrentMatterId,
      concurrentNotary.csrfToken,
      concurrentInput,
    ),
  ]);
  expect(outcomes.map((response) => response.status()).sort()).toEqual([
    201, 409,
  ]);
  expect(await getNotaryOpeningReviewMatter(concurrentMatterId)).toEqual({
    stage: 'ARCHIVED',
    version: 6,
  });
  expect(await countNotaryCertificates(concurrentMatterId)).toBe(1);
  expect(await countNotaryCertificateAudits(concurrentMatterId)).toBe(1);
  expect(await countNotaryCertificateReceipts(concurrentMatterId)).toBe(1);
  expect(await countCasesForMatter(concurrentMatterId)).toBe(1);
});

test('certificate audit, receipt and case failures roll back the full archive transaction', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const client = await createClientAccount(request);
  try {
    for (const inject of [
      () => rejectAuditWrites('notary.certificate_issued'),
      rejectNotaryCertificateReceiptWrites,
      rejectNotaryCertificateCaseWrites,
    ]) {
      const activeClientCsrf = await loginClient(
        request,
        client.username,
        client.password,
      );
      const matterId = await createCertificateReadyMatter(
        request,
        activeClientCsrf,
      );
      const notary = await createNotaryAccountForMatter(request, matterId);
      const uploaded = await uploadCertificateForNotary(
        request,
        matterId,
        notary.csrfToken,
      );
      const input = certificateInput(uploaded.contentVersionId);
      const key = randomUUID();
      await inject();
      const failed = await issueNotaryCertificate(
        request,
        matterId,
        notary.csrfToken,
        input,
        key,
      );
      expect(failed.status(), await failed.text()).toBeGreaterThanOrEqual(500);
      expect(await getNotaryOpeningReviewMatter(matterId)).toEqual({
        stage: 'WAITING_CERTIFICATE',
        version: 5,
      });
      expect(await countNotaryCertificates(matterId)).toBe(0);
      expect(await countNotaryCertificateAudits(matterId)).toBe(0);
      expect(await countNotaryCertificateReceipts(matterId)).toBe(0);
      expect(await countCasesForMatter(matterId)).toBe(0);
      expect(await countCertificateMaterialReferences(matterId)).toBe(0);
      expect(await getNotaryCertificate(matterId)).toBeNull();
      expect(
        (
          await request.get('/api/v1/cases', { headers: authorizationA })
        ).status(),
      ).toBe(200);

      await allowInjectedFailures();
      const retry = await issueNotaryCertificate(
        request,
        matterId,
        notary.csrfToken,
        input,
        key,
      );
      expect(retry.status(), await retry.text()).toBe(201);
      expect(await countNotaryCertificates(matterId)).toBe(1);
      expect(await countNotaryCertificateAudits(matterId)).toBe(1);
      expect(await countNotaryCertificateReceipts(matterId)).toBe(1);
      expect(await countCasesForMatter(matterId)).toBe(1);
      expect(await countCertificateMaterialReferences(matterId)).toBe(1);
    }
  } finally {
    await allowInjectedFailures();
  }
});
