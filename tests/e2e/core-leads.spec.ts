import { randomUUID } from 'node:crypto';
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
  countLeads,
  countStoredFiles,
  databaseCounts,
  disconnectCoreLeadTestDatabase,
  getCustomer,
  getLead,
  getMaterialAuditActions,
  getMaterialLifecycle,
  getMaterialByVersion,
  installMaterialStatusBarrier,
  markContentVersion,
  rejectAuditWrites,
  rejectLeadProductWrites,
  rejectMaterialMetadataWrites,
  resetCoreLeadE2eData,
  setGrant,
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

async function configureBrowser(page: Page) {
  await page.context().setExtraHTTPHeaders(authorizationA);
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: coreLeadFixtures.userA,
          displayName: '核心主管',
          username: 'core-lead-user-a',
        },
        department: { id: coreLeadFixtures.departmentA, name: 'CORE 知产部' },
        departments: [
          { id: coreLeadFixtures.departmentA, name: 'CORE 知产部' },
        ],
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
    ownerType: 'CUSTOMER' | 'LEAD_DRAFT';
    ownerId?: string;
    purpose: 'IDENTITY_FULL' | 'LEAD_SCREENSHOT';
    name: string;
    mime: string;
    bytes: Buffer;
  },
  headers = authorizationA,
): Promise<Uploaded> {
  const draft = await request.post('/api/v1/materials/upload-drafts', {
    headers,
    data: {
      ownerType: input.ownerType,
      ...(input.ownerId ? { ownerId: input.ownerId } : {}),
      category:
        input.ownerType === 'CUSTOMER'
          ? 'CUSTOMER_IDENTITY'
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

test('authorized supervisor admits a customer with real PDF and JPEG bytes', async ({
  page,
  request,
}) => {
  await configureBrowser(page);
  await page.goto(`/customers/${coreLeadFixtures.draftCustomer}`);
  await expect(page.getByRole('heading', { name: '待准入客户' })).toBeVisible();
  await page.getByLabel('客户主体类型').selectOption('ENTERPRISE');
  await page.getByLabel('身份证件类型').selectOption('BUSINESS_LICENSE');
  await page.getByLabel('材料用途').selectOption('IDENTITY_FULL');
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
  await page.getByLabel('姓名').fill('张主管');
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
  await page.getByLabel('客户').selectOption(coreLeadFixtures.admittedCustomer);
  await page.getByLabel('权利主体').selectOption(coreLeadFixtures.holder);
  await page.getByLabel('案件类型').selectOption('CIVIL');
  await page.getByLabel('发现时间').fill('2026-09-21T10:30');
  await page.getByLabel('来源').selectOption('ONLINE');
  await page.getByLabel('平台').selectOption('TAOBAO');
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

test('core lead migrations preserve legacy facts and roll back failed phases', async () => {
  const result = await verifyCoreLeadMigration();
  expect(result.empty.tables).toEqual([
    'customer_admission_receipts',
    'lead_command_receipts',
    'lead_number_counters',
    'leads',
    'materials',
    'upload_drafts',
  ]);
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
    revisions: { bootstrap: 2, shared: 1, incomplete: 1 },
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
