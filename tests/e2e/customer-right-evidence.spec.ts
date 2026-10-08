import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  e2eFixtures,
  resetCustomerE2eData,
  disconnectCustomerTestDatabase,
} from '../support/customer-database.mjs';
import {
  clearCustomerRightAssetFixture,
  ensureRightAssetRealLogin,
  clearRightAssetRealLogin,
  setRightAssetWithdrawGrant,
  setRightAssetRoutineGrant,
  setRightAssetReadGrant,
  setRightAssetAdmitGrant,
  countRightEvidenceReferences,
  rightAssetEvidenceSnapshot,
  rightAssetReceiptFingerprint,
  rejectRightAssetAuditWrites,
  rejectRightEvidenceReferenceWrites,
  rejectRightAssetReceiptWrites,
} from '../support/customer-right-asset-database.mjs';

const auth = { Authorization: `Bearer ${e2eFixtures.tokenA}` };
const authSelf = { Authorization: `Bearer ${e2eFixtures.tokenSelf}` };
const firstBytes = Buffer.from('%PDF-1.4\nCU003 first private proof\n%%EOF\n');
const secondBytes = Buffer.from(
  '%PDF-1.4\nCU003 replacement private proof\n%%EOF\n',
);
let createdCustomerIds: string[] = [];
let credentials: { username: string; password: string };

async function createCustomerWithHolder(
  request: APIRequestContext,
  headers = auth,
) {
  const response = await request.post('/api/v1/customers', {
    headers,
    data: { name: `CU003 ${randomUUID()}` },
  });
  expect(response.status(), await response.text()).toBe(201);
  const customerId = (await response.json()).id as string;
  createdCustomerIds.push(customerId);
  const holder = await request.post(
    `/api/v1/customers/${customerId}/rights-holders`,
    {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      data: { expectedCustomerVersion: 1, name: 'CU003 Holder' },
    },
  );
  expect(holder.status(), await holder.text()).toBe(201);
  return { customerId, holderId: (await holder.json()).holder.id as string };
}

async function uploadProof(
  request: APIRequestContext,
  customerId: string,
  filename: string,
  mimeType: string,
  bytes: Buffer,
  headers = auth,
) {
  const draft = await request.post('/api/v1/materials/upload-drafts', {
    headers,
    data: {
      ownerType: 'CUSTOMER',
      ownerId: customerId,
      category: 'CUSTOMER_RIGHT_EVIDENCE',
      purpose: 'CUSTOMER_RIGHT_EVIDENCE',
      originalFilename: filename,
      declaredMimeType: mimeType,
    },
  });
  expect(draft.status(), await draft.text()).toBe(201);
  const draftId = (await draft.json()).id as string;
  return request.put(`/api/v1/materials/upload-drafts/${draftId}/content`, {
    headers: { ...headers, 'Content-Type': 'application/octet-stream' },
    data: bytes,
  });
}

test.beforeEach(async () => {
  await resetCustomerE2eData();
  createdCustomerIds = [];
  credentials = await ensureRightAssetRealLogin();
});
test.afterEach(async () => {
  await rejectRightAssetReceiptWrites(false);
  await rejectRightEvidenceReferenceWrites(false);
  await rejectRightAssetAuditWrites(false);
  await setRightAssetRoutineGrant(e2eFixtures.roleA, true);
  await setRightAssetReadGrant(e2eFixtures.roleA, true);
  await setRightAssetAdmitGrant(e2eFixtures.roleA, false);
  await setRightAssetWithdrawGrant(e2eFixtures.roleA, false);
  for (const customerId of createdCustomerIds.reverse())
    await clearCustomerRightAssetFixture(customerId, e2eFixtures.departmentA);
  await clearRightAssetRealLogin();
});
test.afterAll(async () => {
  await disconnectCustomerTestDatabase();
});

test('CU003 real password session uploads, freezes revisions and downloads exact historical bytes', async ({
  request,
  page,
}) => {
  const { customerId, holderId } = await createCustomerWithHolder(request);
  await setRightAssetWithdrawGrant(e2eFixtures.roleA, true);
  await page.goto(`/customers/${customerId}`);
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await page.getByLabel('用户名').fill(credentials.username);
  await page.getByLabel('密码').fill(credentials.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/customers/${customerId}$`));
  await page.getByRole('tab', { name: '权利资产' }).click();
  const session = await page.request.get('/api/v1/auth/session');
  expect(session.status()).toBe(200);
  expect((await session.json()).csrfToken).toMatch(/\S+/);
  await page.getByRole('button', { name: '登记权利资产' }).click();
  await page.getByLabel('资产名称').fill('CU003 私有证明商标');
  await page.getByLabel('资产类别').fill('商标权');
  await page.getByLabel('权利主体').selectOption(holderId);
  await page.getByLabel('选择权属证明文件').setInputFiles({
    name: 'first-proof.pdf',
    mimeType: 'application/pdf',
    buffer: firstBytes,
  });
  await page.getByRole('button', { name: '上传证明' }).click();
  await expect(page.getByText('上传成功，尚未登记')).toBeVisible();
  await page.getByRole('button', { name: '确认保存' }).click();
  await expect(
    page.getByRole('region', { name: '权利资产详情' }),
  ).toContainText('first-proof.pdf');

  const listed = await request.get(
    `/api/v1/customers/${customerId}/right-assets`,
    { headers: auth },
  );
  expect(listed.status()).toBe(200);
  const assetId = (await listed.json()).items[0].assetId as string;
  const detailV1 = await request.get(
    `/api/v1/customers/${customerId}/right-assets/${assetId}`,
    { headers: auth },
  );
  expect(detailV1.status()).toBe(200);
  const firstProof = (await detailV1.json()).fields.evidence[0] as {
    materialId: string;
    contentVersionId: string;
  };

  await page.getByRole('button', { name: '修订字段' }).click();
  await page.getByLabel('选择权属证明文件').setInputFiles({
    name: 'second-proof.pdf',
    mimeType: 'application/pdf',
    buffer: secondBytes,
  });
  await page.getByRole('button', { name: '上传证明' }).click();
  await expect(page.getByText('上传成功，尚未登记')).toBeVisible();
  await page.getByLabel(/first-proof\.pdf/).uncheck();
  await page.getByRole('button', { name: '确认保存' }).click();
  await expect(
    page.getByRole('region', { name: '权利资产详情' }),
  ).toContainText('second-proof.pdf');
  await page.reload();
  await page.getByRole('tab', { name: '权利资产' }).click();
  await page.getByRole('button', { name: 'CU003 私有证明商标' }).click();
  await page.getByText('历史版本 · 2 条').click();
  await expect(page.getByText(/first-proof\.pdf ·/)).toBeVisible();
  const historicalDownload = await page.request.get(
    `/api/v1/materials/${firstProof.materialId}/versions/${firstProof.contentVersionId}/content`,
  );
  expect(historicalDownload.status(), await historicalDownload.text()).toBe(
    200,
  );
  expect(await historicalDownload.body()).toEqual(firstBytes);

  await page.getByRole('button', { name: '撤下资产' }).click();
  await page.getByLabel('撤下原因').fill('历史证明仍需留存');
  await page.getByRole('button', { name: '确认撤下' }).click();
  await expect(page.getByText('已撤下')).toBeVisible();
  const afterWithdraw = await page.request.get(
    `/api/v1/materials/${firstProof.materialId}/versions/${firstProof.contentVersionId}/content`,
  );
  expect(afterWithdraw.status()).toBe(200);
  expect(await afterWithdraw.body()).toEqual(firstBytes);
});

test('CU003 batch needs explicit selection and advances parent version only for registered rows', async ({
  request,
  page,
}) => {
  const { customerId, holderId } = await createCustomerWithHolder(request);
  await page.goto(`/customers/${customerId}`);
  await page.getByLabel('用户名').fill(credentials.username);
  await page.getByLabel('密码').fill(credentials.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('tab', { name: '权利资产' }).click();
  await page.getByRole('button', { name: '批量上传权属' }).click();
  const batch = page.getByRole('region', { name: '批量上传权属' });
  await expect(batch.getByText('未识别，请人工填写')).toBeVisible();
  await expect(batch.getByRole('button', { name: '确认登记' })).toBeDisabled();
  let listed = await request.get(
    `/api/v1/customers/${customerId}/right-assets`,
    { headers: auth },
  );
  expect((await listed.json()).total).toBe(0);

  await batch.getByRole('button', { name: '添加一行' }).click();
  await batch.getByRole('button', { name: '添加一行' }).click();
  const rows = batch.locator('.right-assets-panel__batch-row');
  for (const index of [0, 2]) {
    const row = rows.nth(index);
    await row.getByLabel('资产名称').fill(`CU003 批量 ${index + 1}`);
    await row.getByLabel('资产类别').fill('商标权');
    await row.getByLabel('权利主体').selectOption(holderId);
    await row.getByLabel(`第 ${index + 1} 行证明文件`).setInputFiles({
      name: `batch-${index + 1}.pdf`,
      mimeType: 'application/pdf',
      buffer: firstBytes,
    });
    await row.getByRole('button', { name: '上传此行证明' }).click();
    await expect(row).toContainText('上传成功，尚未登记');
  }
  const invalid = rows.nth(1);
  await invalid.getByLabel('资产名称').fill('CU003 未完成行');
  await invalid.getByLabel('权利主体').selectOption(holderId);
  for (let index = 0; index < 3; index++)
    await rows.nth(index).getByLabel('选择此行登记').check();
  await batch.getByRole('button', { name: '确认登记' }).click();
  await expect(rows.nth(0)).toContainText('登记：已登记');
  await expect(rows.nth(1)).toContainText('登记：登记失败');
  await expect(rows.nth(2)).toContainText('登记：已登记');
  listed = await request.get(`/api/v1/customers/${customerId}/right-assets`, {
    headers: auth,
  });
  expect((await listed.json()).total).toBe(2);
  const customer = await request.get(`/api/v1/customers/${customerId}`, {
    headers: auth,
  });
  expect((await customer.json()).version).toBe(4);
  await batch.getByRole('button', { name: '确认登记' }).click();
  listed = await request.get(`/api/v1/customers/${customerId}/right-assets`, {
    headers: auth,
  });
  expect((await listed.json()).total).toBe(2);
});

test('CU003 exact proof validation, customer scope and atomic attach use live PostgreSQL', async ({
  request,
}) => {
  const { customerId, holderId } = await createCustomerWithHolder(request);
  const jpeg = await uploadProof(
    request,
    customerId,
    'proof.jpg',
    'image/jpeg',
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]),
  );
  expect(jpeg.status(), await jpeg.text()).toBe(200);
  const jpegVersion = (await jpeg.json()).contentVersionId as string;
  const png = await uploadProof(
    request,
    customerId,
    'proof.png',
    'image/png',
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
  );
  expect(png.status(), await png.text()).toBe(200);
  const pngVersion = (await png.json()).contentVersionId as string;
  const fake = await uploadProof(
    request,
    customerId,
    'fake.pdf',
    'application/pdf',
    Buffer.from('not a pdf'),
  );
  expect(fake.status()).toBe(400);
  const oversize = await uploadProof(
    request,
    customerId,
    'large.pdf',
    'application/pdf',
    Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.alloc(20 * 1024 * 1024),
      Buffer.from('X'),
    ]),
  );
  expect(oversize.status()).toBe(400);
  const unsupported = await request.post('/api/v1/materials/upload-drafts', {
    headers: auth,
    data: {
      ownerType: 'CUSTOMER',
      ownerId: customerId,
      category: 'CUSTOMER_RIGHT_EVIDENCE',
      purpose: 'CUSTOMER_RIGHT_EVIDENCE',
      originalFilename: 'bad.txt',
      declaredMimeType: 'text/plain',
    },
  });
  expect(unsupported.status()).toBe(400);
  const crossDepartment = await request.post(
    '/api/v1/materials/upload-drafts',
    {
      headers: { Authorization: `Bearer ${e2eFixtures.tokenB}` },
      data: {
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        category: 'CUSTOMER_RIGHT_EVIDENCE',
        purpose: 'CUSTOMER_RIGHT_EVIDENCE',
        originalFilename: 'foreign.pdf',
        declaredMimeType: 'application/pdf',
      },
    },
  );
  expect(crossDepartment.status()).toBe(404);

  const otherCustomer = await createCustomerWithHolder(request);
  const otherProof = await uploadProof(
    request,
    otherCustomer.customerId,
    'other.pdf',
    'application/pdf',
    firstBytes,
  );
  expect(otherProof.status()).toBe(200);
  const otherVersion = (await otherProof.json()).contentVersionId as string;
  const fields = {
    type: 'TRADEMARK',
    name: 'CU003 精确附件',
    number: null,
    category: '商标权',
    holderId,
    ownerText: null,
    trademarkClass: null,
    validFrom: null,
    validTo: null,
    validityMode: 'UNKNOWN',
  };
  const foreignAttach = await request.post(
    `/api/v1/customers/${customerId}/right-assets`,
    {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: {
        ...fields,
        expectedCustomerVersion: 2,
        contentVersionIds: [otherVersion],
      },
    },
  );
  expect(foreignAttach.status()).toBe(400);
  expect(await countRightEvidenceReferences(customerId)).toBe(0);

  const baseline = await rightAssetEvidenceSnapshot(customerId);
  const key = randomUUID();
  await rejectRightAssetAuditWrites(true);
  try {
    const failed = await request.post(
      `/api/v1/customers/${customerId}/right-assets`,
      {
        headers: { ...auth, 'Idempotency-Key': key },
        data: {
          ...fields,
          expectedCustomerVersion: 2,
          contentVersionIds: [jpegVersion, pngVersion],
        },
      },
    );
    expect(failed.status()).toBe(500);
    expect(await rightAssetEvidenceSnapshot(customerId)).toEqual(baseline);
    expect(await countRightEvidenceReferences(customerId)).toBe(0);
  } finally {
    await rejectRightAssetAuditWrites(false);
  }
  for (const injectFailure of [
    rejectRightEvidenceReferenceWrites,
    rejectRightAssetReceiptWrites,
  ]) {
    await injectFailure(true);
    try {
      const failed = await request.post(
        `/api/v1/customers/${customerId}/right-assets`,
        {
          headers: { ...auth, 'Idempotency-Key': key },
          data: {
            ...fields,
            expectedCustomerVersion: 2,
            contentVersionIds: [jpegVersion, pngVersion],
          },
        },
      );
      expect(failed.status()).toBe(500);
      expect(await rightAssetEvidenceSnapshot(customerId)).toEqual(baseline);
      expect(await countRightEvidenceReferences(customerId)).toBe(0);
    } finally {
      await injectFailure(false);
    }
  }
  const success = await request.post(
    `/api/v1/customers/${customerId}/right-assets`,
    {
      headers: { ...auth, 'Idempotency-Key': key },
      data: {
        ...fields,
        expectedCustomerVersion: 2,
        contentVersionIds: [jpegVersion, pngVersion],
      },
    },
  );
  expect(success.status(), await success.text()).toBe(201);
  const created = await success.json();
  expect(created.fields.evidence).toHaveLength(2);
  expect(await countRightEvidenceReferences(customerId)).toBe(2);

  const revisions = await Promise.all(
    [0, 1].map((index) =>
      request.post(
        `/api/v1/customers/${customerId}/right-assets/${created.assetId}/revisions`,
        {
          headers: { ...auth, 'Idempotency-Key': randomUUID() },
          data: {
            ...fields,
            name: `CU003 并发修订 ${index}`,
            expectedCustomerVersion: 3,
            expectedAssetVersion: 1,
            contentVersionIds: [jpegVersion],
          },
        },
      ),
    ),
  );
  expect(revisions.map((response) => response.status()).sort()).toEqual([
    201, 409,
  ]);
  expect(await countRightEvidenceReferences(customerId)).toBe(3);

  await setRightAssetRoutineGrant(e2eFixtures.roleA, false);
  const revokedUpload = await request.post('/api/v1/materials/upload-drafts', {
    headers: auth,
    data: {
      ownerType: 'CUSTOMER',
      ownerId: customerId,
      category: 'CUSTOMER_RIGHT_EVIDENCE',
      purpose: 'CUSTOMER_RIGHT_EVIDENCE',
      originalFilename: 'revoked.pdf',
      declaredMimeType: 'application/pdf',
    },
  });
  expect(revokedUpload.status()).toBe(403);
  await setRightAssetReadGrant(e2eFixtures.roleA, false);
  const revokedDownload = await request.get(
    `/api/v1/materials/${(await jpeg.json()).materialId}/versions/${jpegVersion}/content`,
    { headers: auth },
  );
  expect([403, 404]).toContain(revokedDownload.status());
});

test('CU003 SELF can upload own proof while admit-only cannot upload a team proof', async ({
  request,
}) => {
  const selfCustomer = await createCustomerWithHolder(request, authSelf);
  const selfProof = await uploadProof(
    request,
    selfCustomer.customerId,
    'self-proof.pdf',
    'application/pdf',
    firstBytes,
    authSelf,
  );
  expect(selfProof.status(), await selfProof.text()).toBe(200);
  const selfVersion = (await selfProof.json()).contentVersionId as string;
  const registered = await request.post(
    `/api/v1/customers/${selfCustomer.customerId}/right-assets`,
    {
      headers: { ...authSelf, 'Idempotency-Key': randomUUID() },
      data: {
        type: 'TRADEMARK',
        name: 'CU003 本人资产',
        number: null,
        category: '商标权',
        holderId: selfCustomer.holderId,
        ownerText: null,
        trademarkClass: null,
        validFrom: null,
        validTo: null,
        validityMode: 'UNKNOWN',
        expectedCustomerVersion: 2,
        contentVersionIds: [selfVersion],
      },
    },
  );
  expect(registered.status(), await registered.text()).toBe(201);
  const inaccessible = await request.get(
    `/api/v1/customers/${selfCustomer.customerId}/right-assets`,
    { headers: auth },
  );
  expect(inaccessible.status()).toBe(404);

  const teamCustomer = await createCustomerWithHolder(request);
  await setRightAssetAdmitGrant(e2eFixtures.roleA, true);
  await setRightAssetRoutineGrant(e2eFixtures.roleA, false);
  const proofDraft = await request.post('/api/v1/materials/upload-drafts', {
    headers: auth,
    data: {
      ownerType: 'CUSTOMER',
      ownerId: teamCustomer.customerId,
      category: 'CUSTOMER_RIGHT_EVIDENCE',
      purpose: 'CUSTOMER_RIGHT_EVIDENCE',
      originalFilename: 'admit-only.pdf',
      declaredMimeType: 'application/pdf',
    },
  });
  expect(proofDraft.status()).toBe(403);
});

test('CU003 omitted legacy fingerprint replays old evidence after current attachments change', async ({
  request,
}) => {
  const { customerId, holderId } = await createCustomerWithHolder(request);
  const body = {
    type: 'TRADEMARK',
    name: 'CU003 legacy replay',
    number: null,
    category: '商标权',
    holderId,
    ownerText: null,
    trademarkClass: null,
    validFrom: null,
    validTo: null,
    validityMode: 'UNKNOWN',
    expectedCustomerVersion: 2,
  };
  const key = randomUUID();
  const oldFingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        action: 'CREATE',
        customerId,
        assetId: null,
        expectedCustomerVersion: 2,
        fields: {
          type: body.type,
          name: body.name,
          number: body.number,
          category: body.category,
          holderId,
          ownerText: body.ownerText,
          trademarkClass: body.trademarkClass,
          validFrom: null,
          validTo: null,
          validityMode: body.validityMode,
        },
      }),
    )
    .digest('hex');
  const first = await request.post(
    `/api/v1/customers/${customerId}/right-assets`,
    {
      headers: { ...auth, 'Idempotency-Key': key },
      data: body,
    },
  );
  expect(first.status(), await first.text()).toBe(201);
  const firstResult = await first.json();
  expect(firstResult.fields.evidence).toEqual([]);
  expect(await rightAssetReceiptFingerprint(customerId, key)).toBe(
    oldFingerprint,
  );
  const uploaded = await uploadProof(
    request,
    customerId,
    'later.pdf',
    'application/pdf',
    firstBytes,
  );
  expect(uploaded.status()).toBe(200);
  const revision = await request.post(
    `/api/v1/customers/${customerId}/right-assets/${firstResult.assetId}/revisions`,
    {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: {
        ...body,
        expectedCustomerVersion: 3,
        expectedAssetVersion: 1,
        contentVersionIds: [(await uploaded.json()).contentVersionId],
      },
    },
  );
  expect(revision.status(), await revision.text()).toBe(201);
  expect((await revision.json()).fields.evidence).toHaveLength(1);
  const beforeReplay = await rightAssetEvidenceSnapshot(customerId);
  const replay = await request.post(
    `/api/v1/customers/${customerId}/right-assets`,
    {
      headers: { ...auth, 'Idempotency-Key': key },
      data: body,
    },
  );
  expect(replay.status(), await replay.text()).toBe(201);
  expect((await replay.json()).fields).toMatchObject({
    id: firstResult.fields.id,
    evidence: [],
  });
  expect(await rightAssetEvidenceSnapshot(customerId)).toEqual(beforeReplay);
});
