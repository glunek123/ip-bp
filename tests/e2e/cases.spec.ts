import { createHash, randomUUID } from 'node:crypto';
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
  countCasesForMatter,
  countCaseMatchAudits,
  emulatePreDateCaseMatch,
  getLead,
  getNotaryCase,
  rejectCaseMatchReceiptWrites,
  rejectAuditWrites,
  resetCoreLeadE2eData,
  setInternalAccountActive,
  setRoleGrant,
} from '../support/core-lead-database.mjs';

const authorizationA = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const authorizationB = { Authorization: `Bearer ${coreLeadFixtures.tokenB}` };
const authorizationSelf = {
  Authorization: `Bearer ${coreLeadFixtures.tokenSelf}`,
};
const pdfBytes = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n',
);
const jpegBytes = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46,
]);
type MatchInput = {
  expectedVersion: number;
  idempotencyKey: string;
  matchedOn: string;
  defendants: Array<{
    kind: 'PERSON' | 'ORGANIZATION';
    name: string;
    idNo?: string;
    phone?: string;
    address?: string;
  }>;
  lawyer: { fullName: string; lawFirm?: string; phone?: string };
};

async function configureBrowser(page: Page, authorization = authorizationA) {
  await page.context().setExtraHTTPHeaders(authorization);
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        principalType: 'INTERNAL',
        user: {
          id:
            authorization === authorizationSelf
              ? coreLeadFixtures.userSelf
              : coreLeadFixtures.userA,
          displayName:
            authorization === authorizationSelf ? '本部门只读人员' : '核心主管',
          username: 'case-e2e-user',
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

async function upload(
  request: APIRequestContext,
  input: {
    ownerType: 'NOTARY_MATTER';
    ownerId: string;
    purpose: 'NOTARY_OPENING_PHOTO' | 'NOTARY_CERTIFICATE';
    name: string;
    mime: string;
    bytes: Buffer;
  },
  headers: Record<string, string> = authorizationA,
) {
  const draft = await request.post('/api/v1/materials/upload-drafts', {
    headers,
    data: {
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      category: input.purpose,
      purpose: input.purpose,
      originalFilename: input.name,
      declaredMimeType: input.mime,
    },
  });
  expect(draft.status(), await draft.text()).toBe(201);
  const created: { id: string } = await draft.json();
  const result = await request.put(
    `/api/v1/materials/upload-drafts/${created.id}/content`,
    {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: input.bytes,
    },
  );
  expect(result.status(), await result.text()).toBe(200);
  return result.json() as Promise<{
    materialId: string;
    contentVersionId: string;
  }>;
}

async function createPendingMatchCase(request: APIRequestContext) {
  const username = `case-client-${randomUUID().slice(0, 8)}`;
  const password = 'client correct horse battery';
  const createdClient = await request.post(
    `/api/v1/customers/${coreLeadFixtures.admittedCustomer}/client-accounts`,
    {
      headers: authorizationA,
      data: { displayName: '案件验收客户', username, password },
    },
  );
  expect(createdClient.status(), await createdClient.text()).toBe(201);
  const login = await request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://127.0.0.1:5174' },
    data: { username, password },
  });
  expect(login.status(), await login.text()).toBe(200);
  const clientSession: { csrfToken: string } = await login.json();

  const leadResponse = await request.post('/api/v1/leads', {
    headers: { ...authorizationA, 'Idempotency-Key': randomUUID() },
    data: {
      customerId: coreLeadFixtures.admittedCustomer,
      rightsHolderId: coreLeadFixtures.holder,
      caseType: 'CIVIL',
      infringementTypes: ['TRADEMARK'],
      source: 'ONLINE',
      platform: 'TAOBAO',
      foundAt: '2026-09-21T02:30:00.000Z',
      shopName: `案件验收店铺-${randomUUID().slice(0, 8)}`,
      needDisclose: false,
      products: [
        {
          title: '案件验收商品',
          quantity: 1,
          unitPrice: '1.00',
          commentCount: 0,
        },
      ],
      leadScreenshotContentVersionIds: [],
    },
  });
  expect(leadResponse.status(), await leadResponse.text()).toBe(201);
  const lead: { id: string } = await leadResponse.json();
  const pushed = await request.post(`/api/v1/leads/${lead.id}/push`, {
    headers: { ...authorizationA, 'Idempotency-Key': randomUUID() },
    data: { expectedVersion: 1 },
  });
  expect(pushed.status(), await pushed.text()).toBe(201);
  const reviewed = await request.post(
    `/api/v1/client/leads/${lead.id}/reviews`,
    {
      headers: {
        'X-CSRF-Token': clientSession.csrfToken,
        'Idempotency-Key': randomUUID(),
      },
      data: { result: 'INFRINGEMENT', expectedVersion: 2 },
    },
  );
  expect(reviewed.status(), await reviewed.text()).toBe(201);

  const officeResponse = await request.post('/api/v1/notary-offices', {
    headers: authorizationA,
    data: { name: `案件验收公证处-${randomUUID().slice(0, 8)}` },
  });
  expect(officeResponse.status(), await officeResponse.text()).toBe(201);
  const office: { id: string } = await officeResponse.json();
  const productId = (await getLead(lead.id))!.products[0].id;
  const transfer = await request.post(
    `/api/v1/leads/${lead.id}/notary-matters`,
    {
      headers: { ...authorizationA, 'Idempotency-Key': randomUUID() },
      data: {
        selectedProductIds: [productId],
        selectedContentVersionIds: [],
        notaryOfficeId: office.id,
        evidenceMode: 'ONLINE_PURCHASE',
        batchPurpose: '案件验收取证',
        expectedVersion: 3,
      },
    },
  );
  expect(transfer.status(), await transfer.text()).toBe(201);
  const matter: { id: string } = await transfer.json();

  const evidence = await request.post(
    `/api/v1/notary-matters/${matter.id}/evidence`,
    {
      headers: { ...authorizationA, 'Idempotency-Key': randomUUID() },
      data: {
        evidenceAt: '2026-09-24',
        sampleFeeState: 'PENDING',
        logistics: [{ companyState: 'NONE', trackingState: 'NONE' }],
        expectedVersion: 1,
      },
    },
  );
  expect(evidence.status(), await evidence.text()).toBe(201);
  const openingPhoto = await upload(request, {
    ownerType: 'NOTARY_MATTER',
    ownerId: matter.id,
    purpose: 'NOTARY_OPENING_PHOTO',
    name: '案件验收开箱.jpg',
    mime: 'image/jpeg',
    bytes: jpegBytes,
  });
  const opening = await request.post(
    `/api/v1/notary-matters/${matter.id}/opening`,
    {
      headers: { ...authorizationA, 'Idempotency-Key': randomUUID() },
      data: {
        expectedVersion: 2,
        contentVersionIds: [openingPhoto.contentVersionId],
      },
    },
  );
  expect(opening.status(), await opening.text()).toBe(201);
  const openingReview = await request.post(
    `/api/v1/notary-matters/${matter.id}/opening-review`,
    {
      headers: { ...authorizationA, 'Idempotency-Key': randomUUID() },
      data: { result: 'INFRINGEMENT', expectedVersion: 3 },
    },
  );
  expect(openingReview.status(), await openingReview.text()).toBe(201);
  const issuance = await request.post(
    `/api/v1/notary-matters/${matter.id}/issuance-decision`,
    {
      headers: { ...authorizationA, 'Idempotency-Key': randomUUID() },
      data: { decision: 'ISSUE', expectedVersion: 4 },
    },
  );
  expect(issuance.status(), await issuance.text()).toBe(201);

  const notaryUsername = `case-notary-${randomUUID().slice(0, 8)}`;
  const notaryAccount = await request.post(
    `/api/v1/notary-offices/${office.id}/accounts`,
    {
      headers: authorizationA,
      data: {
        displayName: '案件验收公证员',
        username: notaryUsername,
        password: 'notary correct horse battery',
      },
    },
  );
  expect(notaryAccount.status(), await notaryAccount.text()).toBe(201);
  const notaryLogin = await request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://127.0.0.1:5174' },
    data: {
      username: notaryUsername,
      password: 'notary correct horse battery',
    },
  });
  expect(notaryLogin.status(), await notaryLogin.text()).toBe(200);
  const notarySession: { csrfToken: string } = await notaryLogin.json();
  const certificateFile = await upload(
    request,
    {
      ownerType: 'NOTARY_MATTER',
      ownerId: matter.id,
      purpose: 'NOTARY_CERTIFICATE',
      name: '案件验收公证书.pdf',
      mime: 'application/pdf',
      bytes: pdfBytes,
    },
    { 'X-CSRF-Token': notarySession.csrfToken },
  );
  const certificate = await request.post(
    `/api/v1/notary-portal/matters/${matter.id}/certificate`,
    {
      headers: {
        'X-CSRF-Token': notarySession.csrfToken,
        'Idempotency-Key': randomUUID(),
      },
      data: {
        expectedVersion: 5,
        certificateNo: `（2026）测证字${randomUUID().slice(0, 6)}号`,
        certificateDate: '2026-09-28',
        contentVersionIds: [certificateFile.contentVersionId],
        needDisclose: false,
        disclosureContentVersionIds: [],
        fees: {
          notary: { state: 'KNOWN', amount: '120.00' },
          investigation: { state: 'PENDING', amount: null },
          disclosure: { state: 'KNOWN', amount: '0.00' },
        },
      },
    },
  );
  expect(certificate.status(), await certificate.text()).toBe(201);
  const body: { case: { id: string } } = await certificate.json();
  const caseId = body.case.id;
  expect(caseId).toEqual(expect.any(String));
  expect(await getNotaryCase(caseId)).toMatchObject({
    id: caseId,
    stage: 'PENDING_MATCH',
  });
  expect(await countCasesForMatter(matter.id)).toBe(1);
  return { caseId, matterId: matter.id, certificateFile };
}

function matchCase(
  request: APIRequestContext,
  caseId: string,
  input: MatchInput,
  headers = authorizationA,
) {
  return request.post(`/api/v1/cases/${caseId}/match`, {
    headers: { ...headers, 'Idempotency-Key': input.idempotencyKey },
    data: input,
  });
}

test.beforeEach(async () => {
  await resetCoreLeadE2eData();
  await setRoleGrant(coreLeadFixtures.roleA, 'case.read', 'DEPARTMENT');
  await setRoleGrant(coreLeadFixtures.roleSelf, 'case.read', 'DEPARTMENT');
});

test.afterEach(async () => {
  await allowInjectedFailures();
});

test('an operator matches a real notary case and the result survives refresh', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { caseId } = await createPendingMatchCase(request);
  const mineBefore = await request.get(
    '/api/v1/cases?view=mine&stage=PENDING_MATCH',
    { headers: authorizationA },
  );
  expect(mineBefore.status(), await mineBefore.text()).toBe(200);
  expect(await mineBefore.json()).toMatchObject({
    items: [expect.objectContaining({ id: caseId, stage: 'PENDING_MATCH' })],
    total: 1,
    counts: { PENDING_MATCH: 1, WAITING_COMPLAINT: 0 },
  });
  const departmentBefore = await request.get(
    '/api/v1/cases?view=department&stage=PENDING_MATCH',
    { headers: authorizationA },
  );
  expect(departmentBefore.status(), await departmentBefore.text()).toBe(200);
  expect((await departmentBefore.json()).items).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: caseId })]),
  );
  await configureBrowser(page);
  await page.goto(`/cases/${caseId}`);
  await expect(page.locator('[data-test="case-match-form"]')).toBeVisible();
  const form = page.locator('[data-test="case-match-form"]');
  await form.getByLabel('主体类型').selectOption('ORGANIZATION');
  await form.getByLabel('名称').fill('杭州真实匹配测试公司');
  await form.getByLabel('身份证号（选填）').fill('91330000MATCH001');
  await form.getByLabel('电话（选填）').first().fill('05710000000');
  await form.getByLabel('地址（选填）').fill('浙江省杭州市');
  await form.getByLabel('律师姓名').fill('张律师');
  await expect(form.getByLabel('实际匹配日期')).not.toHaveValue('');
  await form.getByLabel('实际匹配日期').fill('2026-09-28');
  await form.getByLabel('电话（选填）').last().fill('05719999999');
  await page.getByRole('button', { name: '确认匹配并进入待写诉状' }).click();
  await expect(page.getByRole('status')).toContainText('待写诉状');
  await expect(page.locator('[data-test="case-match-form"]')).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: '当事人与承办律师' }),
  ).toBeVisible();
  await expect(page.getByText(/杭州真实匹配测试公司/u)).toBeVisible();
  await expect(page.getByText(/张律师/u)).toBeVisible();
  await expect(page.getByText(/实际匹配日期：2026-09-28/u)).toBeVisible();
  await expect(page.getByText(/系统登记时间/u)).toBeVisible();
  const detail = await request.get(`/api/v1/cases/${caseId}`, {
    headers: authorizationA,
  });
  expect(detail.status(), await detail.text()).toBe(200);
  expect(await detail.json()).toMatchObject({
    id: caseId,
    stage: 'WAITING_COMPLAINT',
    version: 2,
    defendants: [
      {
        kind: 'ORGANIZATION',
        name: '杭州真实匹配测试公司',
        idNo: '91330000MATCH001',
      },
    ],
    lawyers: [{ fullName: '张律师', lawFirm: null, role: 'PRIMARY' }],
    matchedOn: '2026-09-28',
    matchedAt: expect.any(String),
  });
  const waitingComplaint = await request.get(
    '/api/v1/cases?view=mine&stage=WAITING_COMPLAINT',
    { headers: authorizationA },
  );
  expect(await waitingComplaint.json()).toMatchObject({
    items: [
      expect.objectContaining({ id: caseId, stage: 'WAITING_COMPLAINT' }),
    ],
    counts: { PENDING_MATCH: 0, WAITING_COMPLAINT: 1 },
  });
});

test('same-department reader can download but cannot write; another department gets 404', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { caseId, certificateFile } = await createPendingMatchCase(request);
  const mine = await request.get('/api/v1/cases?view=mine', {
    headers: authorizationSelf,
  });
  expect(mine.status(), await mine.text()).toBe(200);
  expect(await mine.json()).toMatchObject({
    items: [],
    total: 0,
    counts: { PENDING_MATCH: 0, WAITING_COMPLAINT: 0 },
  });
  const department = await request.get(
    '/api/v1/cases?view=department&stage=PENDING_MATCH',
    { headers: authorizationSelf },
  );
  expect(department.status(), await department.text()).toBe(200);
  expect(await department.json()).toMatchObject({
    items: [expect.objectContaining({ id: caseId, canMatch: false })],
    total: 1,
    counts: { PENDING_MATCH: 1, WAITING_COMPLAINT: 0 },
  });
  await configureBrowser(page, authorizationSelf);
  await page.goto(`/cases/${caseId}`);
  await expect(page.locator('[data-test="case-read-only"]')).toBeVisible();
  await expect(page.getByRole('button', { name: '下载' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载' }).click();
  expect(await readFile(await (await download).path())).toEqual(pdfBytes);
  const denied = await matchCase(
    request,
    caseId,
    {
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      matchedOn: '2026-09-28',
      defendants: [{ kind: 'PERSON', name: '不应写入' }],
      lawyer: { fullName: '无权律师', lawFirm: '无权事务所' },
    },
    authorizationSelf,
  );
  expect(denied.status(), await denied.text()).toBe(403);
  const crossDepartment = await request.get(`/api/v1/cases/${caseId}`, {
    headers: authorizationB,
  });
  expect(crossDepartment.status(), await crossDepartment.text()).toBe(404);
  const foreignDownload = await request.get(
    `/api/v1/materials/${certificateFile.materialId}/versions/${certificateFile.contentVersionId}/content`,
    { headers: authorizationB },
  );
  expect(foreignDownload.status()).toBe(404);
});

test('case match rejects stale writes, serializes concurrent writes, and preserves idempotent replay', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const { caseId } = await createPendingMatchCase(request);
  const firstInput: MatchInput = {
    expectedVersion: 1,
    idempotencyKey: randomUUID(),
    matchedOn: '2026-09-28',
    defendants: [{ kind: 'PERSON', name: '王某', idNo: '330100199001010011' }],
    lawyer: {
      fullName: '李律师',
      lawFirm: '西湖律师事务所',
      phone: '05718888888',
    },
  };
  const future = await matchCase(request, caseId, {
    ...firstInput,
    matchedOn: '2999-01-01',
  });
  expect(future.status(), await future.text()).toBe(400);
  expect(await future.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  const stale = await matchCase(request, caseId, {
    ...firstInput,
    expectedVersion: 99,
  });
  expect(stale.status(), await stale.text()).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
  const secondInput: MatchInput = {
    ...firstInput,
    idempotencyKey: randomUUID(),
    defendants: [{ kind: 'ORGANIZATION', name: '并发公司' }],
  };
  const concurrent = await Promise.all([
    matchCase(request, caseId, firstInput),
    matchCase(request, caseId, secondInput),
  ]);
  expect(concurrent.map((response) => response.status()).sort()).toEqual([
    201, 409,
  ]);
  const winner = concurrent[0].status() === 201 ? firstInput : secondInput;
  const replay = await matchCase(request, caseId, winner);
  expect(replay.status(), await replay.text()).toBe(201);
  expect(await replay.json()).toMatchObject({ matchedOn: winner.matchedOn });
  const changedDate = await matchCase(request, caseId, {
    ...winner,
    matchedOn: '2026-09-27',
  });
  expect(changedDate.status(), await changedDate.text()).toBe(409);
  expect(await changedDate.json()).toMatchObject({
    code: 'IDEMPOTENCY_CONFLICT',
  });
  const conflict = await matchCase(request, caseId, {
    ...winner,
    defendants: [{ kind: 'ORGANIZATION', name: '幂等键冲突公司' }],
  });
  expect(conflict.status(), await conflict.text()).toBe(409);
});

test('pre-date matched case and success receipt remain readable and exactly replayable after upgrade', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const { caseId } = await createPendingMatchCase(request);
  const original: MatchInput = {
    expectedVersion: 1,
    idempotencyKey: randomUUID(),
    matchedOn: '2026-09-28',
    defendants: [{ kind: 'PERSON', name: '升级前当事人' }],
    lawyer: { fullName: '升级前律师', lawFirm: '旧律所' },
  };
  const created = await matchCase(request, caseId, original);
  expect(created.status(), await created.text()).toBe(201);
  const { matchedOn: originalDate, ...legacyRequest } = original;
  expect(originalDate).toBe('2026-09-28');
  const legacyFingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        caseId,
        ...legacyRequest,
        idempotencyKey: undefined,
      }),
    )
    .digest('hex');
  await emulatePreDateCaseMatch(caseId, legacyFingerprint);

  const detail = await request.get(`/api/v1/cases/${caseId}`, {
    headers: authorizationA,
  });
  expect(detail.status(), await detail.text()).toBe(200);
  expect(await detail.json()).toMatchObject({
    id: caseId,
    stage: 'WAITING_COMPLAINT',
    version: 2,
    matchedOn: null,
  });
  const replay = await request.post(`/api/v1/cases/${caseId}/match`, {
    headers: {
      ...authorizationA,
      'Idempotency-Key': legacyRequest.idempotencyKey,
    },
    data: legacyRequest,
  });
  expect(replay.status(), await replay.text()).toBe(201);
  expect(await replay.json()).toMatchObject({
    id: caseId,
    stage: 'WAITING_COMPLAINT',
    version: 2,
    matchedOn: null,
  });
  expect(await countCaseMatchAudits(caseId)).toBe(1);

  const modified = await matchCase(request, caseId, original);
  expect(modified.status(), await modified.text()).toBe(409);
  expect(await modified.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  const newKey = randomUUID();
  const missingDateNewKey = await request.post(
    `/api/v1/cases/${caseId}/match`,
    {
      headers: { ...authorizationA, 'Idempotency-Key': newKey },
      data: { ...legacyRequest, idempotencyKey: newKey },
    },
  );
  expect(missingDateNewKey.status(), await missingDateNewKey.text()).toBe(400);
  expect(await missingDateNewKey.json()).toMatchObject({
    code: 'VALIDATION_ERROR',
  });
  expect(await countCaseMatchAudits(caseId)).toBe(1);
});

test('revoking the operator account takes effect on the next match request', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const { caseId } = await createPendingMatchCase(request);
  await setInternalAccountActive(coreLeadFixtures.userA, false);
  try {
    const revoked = await matchCase(request, caseId, {
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      matchedOn: '2026-09-28',
      defendants: [{ kind: 'PERSON', name: '无权写入' }],
      lawyer: { fullName: '无权律师', lawFirm: '无权律师事务所' },
    });
    expect(revoked.status(), await revoked.text()).toBe(403);
    expect(await revoked.json()).toMatchObject({ code: 'ACTION_FORBIDDEN' });
  } finally {
    await setInternalAccountActive(coreLeadFixtures.userA, true);
  }
});

test('audit and receipt failures roll back the match and permit retry after recovery', async ({
  request,
}) => {
  test.setTimeout(120_000);
  for (const inject of [
    () => rejectAuditWrites('case.match.succeeded'),
    rejectCaseMatchReceiptWrites,
  ]) {
    const { caseId } = await createPendingMatchCase(request);
    const input: MatchInput = {
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      matchedOn: '2026-09-28',
      defendants: [{ kind: 'PERSON', name: '赵某' }],
      lawyer: { fullName: '周律师', lawFirm: '滨江律师事务所' },
    };
    await inject();
    const failed = await matchCase(request, caseId, input);
    expect(failed.status()).toBeGreaterThanOrEqual(500);
    const detail = await request.get(`/api/v1/cases/${caseId}`, {
      headers: authorizationA,
    });
    expect(await detail.json()).toMatchObject({
      id: caseId,
      stage: 'PENDING_MATCH',
      version: 1,
      matchedOn: null,
      defendants: [],
      lawyers: [],
    });
    await allowInjectedFailures();
    const retry = await matchCase(request, caseId, input);
    expect(retry.status(), await retry.text()).toBe(201);
  }
});
