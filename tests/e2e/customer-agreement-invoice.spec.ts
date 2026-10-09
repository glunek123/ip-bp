import { randomUUID } from 'node:crypto';
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from '@playwright/test';
import {
  allowCustomerDocumentStage,
  disconnectCustomerTestDatabase,
  e2eFixtures,
  getCustomerDocumentCounts,
  grantCustomerLifecycle,
  resetCustomerE2eData,
  rejectCustomerDocumentStage,
  setCustomerDocumentBaseReadScope,
  setCustomerDocumentGrant,
  setCustomerDocumentTestState,
} from '../support/customer-database.mjs';
import {
  cleanupContactExternalActors,
  coreLeadFixtures,
  disconnectCoreLeadTestDatabase,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';
import { createLawyerAccountThroughApi } from '../support/case-lawyer-account.mjs';

const auth = { Authorization: `Bearer ${e2eFixtures.tokenA}` };
const foreign = { Authorization: `Bearer ${e2eFixtures.tokenB}` };
const self = { Authorization: `Bearer ${e2eFixtures.tokenSelf}` };
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');

async function customer(request: APIRequestContext) {
  const response = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: `CU007 ${randomUUID()}` },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json() as Promise<{ id: string; version: number }>;
}
async function grantAll() {
  for (const action of [
    'CUSTOMER_AGREEMENT_READ',
    'CUSTOMER_AGREEMENT_EDIT',
    'CUSTOMER_INVOICE_READ',
    'CUSTOMER_INVOICE_EDIT',
  ] as const)
    await setCustomerDocumentGrant(e2eFixtures.roleA, action, true);
}
async function upload(request: APIRequestContext, customerId: string) {
  const draft = await request.post('/api/v1/materials/upload-drafts', {
    headers: auth,
    data: {
      ownerType: 'CUSTOMER',
      ownerId: customerId,
      category: 'CUSTOMER_AGREEMENT',
      purpose: 'CUSTOMER_AGREEMENT',
      originalFilename: 'agreement.pdf',
      declaredMimeType: 'application/pdf',
    },
  });
  expect(draft.status(), await draft.text()).toBe(201);
  const id = ((await draft.json()) as { id: string }).id;
  const uploaded = await request.put(
    `/api/v1/materials/upload-drafts/${id}/content`,
    {
      headers: { ...auth, 'Content-Type': 'application/octet-stream' },
      data: pdf,
    },
  );
  expect(uploaded.status(), await uploaded.text()).toBe(200);
  return uploaded.json() as Promise<{
    materialId: string;
    contentVersionId: string;
    version: number;
  }>;
}

test.beforeEach(async () => resetCustomerE2eData());
test.afterAll(async () => {
  await disconnectCustomerTestDatabase();
  await disconnectCoreLeadTestDatabase();
});

test('CU007 exact agreement files, invoice versions, replay authorization and material list count', async ({
  request,
}) => {
  const c = await customer(request);
  const baseDetail = await request.get(`/api/v1/customers/${c.id}`, {
    headers: auth,
  });
  expect(baseDetail.status()).toBe(200);
  expect((await baseDetail.json()) as { capabilities: unknown }).toMatchObject({
    capabilities: {
      agreement: { read: false, edit: false },
      invoice: { read: false, edit: false },
    },
  });
  const denied = await request.get(`/api/v1/customers/${c.id}/agreements`, {
    headers: auth,
  });
  expect([403, 404]).toContain(denied.status());
  const emptyList = await request.get(
    `/api/v1/materials?ownerType=CUSTOMER&ownerId=${c.id}`,
    { headers: auth },
  );
  expect(emptyList.status()).toBe(200);
  await setCustomerDocumentGrant(
    e2eFixtures.roleA,
    'CUSTOMER_AGREEMENT_EDIT',
    true,
  );
  const editOnlyDetail = await request.get(`/api/v1/customers/${c.id}`, {
    headers: auth,
  });
  expect(editOnlyDetail.status()).toBe(200);
  expect(
    (await editOnlyDetail.json()) as { capabilities: unknown },
  ).toMatchObject({
    capabilities: { agreement: { read: false, edit: false } },
  });
  await grantAll();
  const grantedDetail = await request.get(`/api/v1/customers/${c.id}`, {
    headers: auth,
  });
  expect(grantedDetail.status()).toBe(200);
  expect(
    (await grantedDetail.json()) as { capabilities: unknown },
  ).toMatchObject({
    capabilities: {
      agreement: { read: true, edit: true },
      invoice: { read: true, edit: true },
    },
  });
  const m = await upload(request, c.id);
  const key = randomUUID();
  const createBody = {
    expectedCustomerVersion: c.version,
    title: '真实协议',
    validityMode: 'UNKNOWN',
    contentVersionIds: [m.contentVersionId],
  };
  const createdResponse = await request.post(
    `/api/v1/customers/${c.id}/agreements`,
    {
      headers: { ...auth, 'Idempotency-Key': key },
      data: createBody,
    },
  );
  expect(createdResponse.status(), await createdResponse.text()).toBe(201);
  const created = (await createdResponse.json()) as {
    agreement: {
      id: string;
      version: number;
      currentVersion: {
        files: Array<{ materialId: string; contentVersionId: string }>;
      };
    };
    customerVersion: number;
  };
  expect(created.agreement.currentVersion.files).toEqual([
    expect.objectContaining({
      materialId: m.materialId,
      contentVersionId: m.contentVersionId,
    }),
  ]);
  const ordinaryDetail = await request.get(`/api/v1/customers/${c.id}`, {
    headers: auth,
  });
  expect(ordinaryDetail.status()).toBe(200);
  expect(JSON.stringify(await ordinaryDetail.json())).not.toContain(
    'customer.agreement.created',
  );
  const replay = await request.post(`/api/v1/customers/${c.id}/agreements`, {
    headers: { ...auth, 'Idempotency-Key': key },
    data: createBody,
  });
  expect(replay.status()).toBe(201);
  expect(await replay.json()).toEqual(created);
  const mismatch = await request.post(`/api/v1/customers/${c.id}/agreements`, {
    headers: { ...auth, 'Idempotency-Key': key },
    data: { ...createBody, title: '异体' },
  });
  expect(mismatch.status()).toBe(409);
  const oldVersion = m.contentVersionId;
  const revision = await request.post(
    `/api/v1/customers/${c.id}/agreements/${created.agreement.id}/revisions`,
    {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: {
        expectedCustomerVersion: created.customerVersion,
        expectedAgreementVersion: 1,
        title: '修订协议',
        contentVersionIds: [],
      },
    },
  );
  expect(revision.status(), await revision.text()).toBe(200);
  const revised = (await revision.json()) as {
    customerVersion: number;
    agreement: { currentVersion: { files: unknown[] } };
  };
  expect(revised.agreement.currentVersion.files).toEqual([]);
  const historical = await request.get(
    `/api/v1/customers/${c.id}/agreements/${created.agreement.id}/versions`,
    { headers: auth },
  );
  expect(historical.status()).toBe(200);
  expect(((await historical.json()) as { total: number }).total).toBe(2);
  const bytes = await request.get(
    `/api/v1/materials/${m.materialId}/versions/${oldVersion}/content`,
    { headers: auth },
  );
  expect(bytes.status()).toBe(200);
  expect(await bytes.body()).toEqual(pdf);
  const invoice = await request.post(
    `/api/v1/customers/${c.id}/invoice-profile`,
    {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: { expectedCustomerVersion: revised.customerVersion },
    },
  );
  expect(invoice.status(), await invoice.text()).toBe(201);
  const first = (await invoice.json()) as { customerVersion: number };
  const invoiceRevision = await request.post(
    `/api/v1/customers/${c.id}/invoice-profile/revisions`,
    {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: {
        expectedCustomerVersion: first.customerVersion,
        expectedInvoiceVersion: 1,
        taxNo: 'TEST-TAX',
        bank: '测试银行账号',
      },
    },
  );
  expect(invoiceRevision.status(), await invoiceRevision.text()).toBe(200);
  const invoiceClear = await request.post(
    `/api/v1/customers/${c.id}/invoice-profile/revisions`,
    {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: {
        expectedCustomerVersion: (
          (await invoiceRevision.json()) as { customerVersion: number }
        ).customerVersion,
        expectedInvoiceVersion: 2,
        taxNo: null,
        bank: null,
      },
    },
  );
  expect(invoiceClear.status(), await invoiceClear.text()).toBe(200);
  expect(
    (
      (await invoiceClear.json()) as {
        profile: {
          currentVersion: { taxNo: string | null; bank: string | null };
        };
      }
    ).profile.currentVersion,
  ).toMatchObject({ taxNo: null, bank: null });
  const foreignRead = await request.get(
    `/api/v1/customers/${c.id}/invoice-profile`,
    { headers: foreign },
  );
  expect([403, 404]).toContain(foreignRead.status());
  const selfRead = await request.get(`/api/v1/customers/${c.id}/agreements`, {
    headers: self,
  });
  expect([403, 404]).toContain(selfRead.status());
  await setCustomerDocumentGrant(
    e2eFixtures.roleA,
    'CUSTOMER_AGREEMENT_READ',
    false,
  );
  const revokedDetail = await request.get(`/api/v1/customers/${c.id}`, {
    headers: auth,
  });
  expect(revokedDetail.status()).toBe(200);
  expect(
    (await revokedDetail.json()) as { capabilities: unknown },
  ).toMatchObject({
    capabilities: { agreement: { read: false, edit: false } },
  });
  const hidden = await request.get(
    `/api/v1/materials?ownerType=CUSTOMER&ownerId=${c.id}`,
    { headers: auth },
  );
  expect(hidden.status()).toBe(200);
  expect(await hidden.json()).toMatchObject({ items: [], total: 0 });
  const downloadDenied = await request.get(
    `/api/v1/materials/${m.materialId}/versions/${oldVersion}/content`,
    { headers: auth },
  );
  expect([403, 404]).toContain(downloadDenied.status());
  const replayDenied = await request.post(
    `/api/v1/customers/${c.id}/agreements`,
    {
      headers: { ...auth, 'Idempotency-Key': key },
      data: createBody,
    },
  );
  expect([403, 404]).toContain(replayDenied.status());
});

test('CU007 material entry points obey current read and edit grants', async ({
  request,
}) => {
  const c = await customer(request);
  await setCustomerDocumentGrant(
    e2eFixtures.roleA,
    'CUSTOMER_AGREEMENT_READ',
    true,
  );
  const createDraft = () =>
    request.post('/api/v1/materials/upload-drafts', {
      headers: auth,
      data: {
        ownerType: 'CUSTOMER',
        ownerId: c.id,
        category: 'CUSTOMER_AGREEMENT',
        purpose: 'CUSTOMER_AGREEMENT',
        originalFilename: 'agreement.pdf',
        declaredMimeType: 'application/pdf',
      },
    });
  expect([403, 404]).toContain((await createDraft()).status());
  await setCustomerDocumentGrant(
    e2eFixtures.roleA,
    'CUSTOMER_AGREEMENT_EDIT',
    true,
  );
  const draft = await createDraft();
  expect(draft.status(), await draft.text()).toBe(201);
  const draftId = ((await draft.json()) as { id: string }).id;
  await setCustomerDocumentGrant(
    e2eFixtures.roleA,
    'CUSTOMER_AGREEMENT_EDIT',
    false,
  );
  const finalDenied = await request.put(
    `/api/v1/materials/upload-drafts/${draftId}/content`,
    {
      headers: { ...auth, 'Content-Type': 'application/octet-stream' },
      data: pdf,
    },
  );
  expect([403, 404]).toContain(finalDenied.status());
  await setCustomerDocumentGrant(
    e2eFixtures.roleA,
    'CUSTOMER_AGREEMENT_EDIT',
    true,
  );
  const finalized = await request.put(
    `/api/v1/materials/upload-drafts/${draftId}/content`,
    {
      headers: { ...auth, 'Content-Type': 'application/octet-stream' },
      data: pdf,
    },
  );
  expect(finalized.status(), await finalized.text()).toBe(200);
  const material = (await finalized.json()) as {
    materialId: string;
    contentVersionId: string;
    version: number;
  };
  await setCustomerDocumentGrant(
    e2eFixtures.roleA,
    'CUSTOMER_AGREEMENT_EDIT',
    false,
  );
  const readOnly = await request.get(
    `/api/v1/materials?ownerType=CUSTOMER&ownerId=${c.id}`,
    { headers: auth },
  );
  expect(readOnly.status()).toBe(200);
  const listing = (await readOnly.json()) as {
    total: number;
    items: Array<{ version: number }>;
  };
  expect(listing.total).toBe(1);
  const materialVersion = listing.items[0].version;
  const readBytes = await request.get(
    `/api/v1/materials/${material.materialId}/versions/${material.contentVersionId}/content`,
    { headers: auth },
  );
  expect(readBytes.status()).toBe(200);
  const deleteDenied = await request.delete(
    `/api/v1/materials/${material.materialId}?expectedVersion=${materialVersion}`,
    { headers: auth },
  );
  expect([403, 404]).toContain(deleteDenied.status());
  await setCustomerDocumentGrant(
    e2eFixtures.roleA,
    'CUSTOMER_AGREEMENT_EDIT',
    true,
  );
  const deleted = await request.delete(
    `/api/v1/materials/${material.materialId}?expectedVersion=${materialVersion}`,
    { headers: auth },
  );
  expect(deleted.status(), await deleted.text()).toBe(200);
  const deletedVersion = ((await deleted.json()) as { version: number })
    .version;
  await setCustomerDocumentGrant(
    e2eFixtures.roleA,
    'CUSTOMER_AGREEMENT_EDIT',
    false,
  );
  const restoreDenied = await request.post(
    `/api/v1/materials/${material.materialId}/restore`,
    { headers: auth, data: { expectedVersion: deletedVersion } },
  );
  expect([403, 404]).toContain(restoreDenied.status());
  await setCustomerDocumentGrant(
    e2eFixtures.roleA,
    'CUSTOMER_AGREEMENT_EDIT',
    true,
  );
  const restored = await request.post(
    `/api/v1/materials/${material.materialId}/restore`,
    { headers: auth, data: { expectedVersion: deletedVersion } },
  );
  expect(restored.status(), await restored.text()).toBe(201);
});

test('CU007 omitted files inherit; CAS loser leaves no version, receipt or audit', async ({
  request,
}) => {
  const c = await customer(request);
  await grantAll();
  const m = await upload(request, c.id);
  const create = await request.post(`/api/v1/customers/${c.id}/agreements`, {
    headers: { ...auth, 'Idempotency-Key': randomUUID() },
    data: {
      expectedCustomerVersion: c.version,
      title: '首版',
      validityMode: 'UNKNOWN',
      contentVersionIds: [m.contentVersionId],
    },
  });
  expect(create.status(), await create.text()).toBe(201);
  const first = (await create.json()) as {
    customerVersion: number;
    agreement: { id: string; currentVersion: { files: unknown[] } };
  };
  const body = {
    expectedCustomerVersion: first.customerVersion,
    expectedAgreementVersion: 1,
    title: '继承附件',
  };
  const key = randomUUID();
  const requests = await Promise.all(
    [key, randomUUID()].map((id) =>
      request.post(
        `/api/v1/customers/${c.id}/agreements/${first.agreement.id}/revisions`,
        { headers: { ...auth, 'Idempotency-Key': id }, data: body },
      ),
    ),
  );
  expect(requests.map((response) => response.status()).sort()).toEqual([
    200, 409,
  ]);
  const winner = requests.find((response) => response.status() === 200)!;
  const winnerBody = (await winner.json()) as {
    agreement: { currentVersion: { files: unknown[] } };
  };
  expect(winnerBody.agreement.currentVersion.files).toEqual(
    first.agreement.currentVersion.files,
  );
  expect(await getCustomerDocumentCounts(c.id)).toMatchObject({
    agreements: 1,
    agreementVersions: 2,
    receipts: 2,
    audits: 2,
  });
  const losingKey = requests[0].status() === 409 ? key : null;
  if (losingKey) {
    const retry = await request.post(
      `/api/v1/customers/${c.id}/agreements/${first.agreement.id}/revisions`,
      { headers: { ...auth, 'Idempotency-Key': losingKey }, data: body },
    );
    expect(retry.status()).toBe(409);
  }
});

test('CU007 SELF, TEAM and DEPARTMENT follow current customer ownership and paused status', async ({
  request,
}) => {
  const c = await customer(request);
  await setCustomerDocumentGrant(
    e2eFixtures.roleA,
    'CUSTOMER_AGREEMENT_READ',
    true,
    'TEAM',
  );
  await setCustomerDocumentGrant(
    e2eFixtures.roleA,
    'CUSTOMER_AGREEMENT_EDIT',
    true,
    'TEAM',
  );
  await setCustomerDocumentGrant(
    e2eFixtures.roleSelf,
    'CUSTOMER_AGREEMENT_READ',
    true,
    'SELF',
  );
  await setCustomerDocumentGrant(
    e2eFixtures.roleSelf,
    'CUSTOMER_AGREEMENT_EDIT',
    true,
    'SELF',
  );
  const create = await request.post(`/api/v1/customers/${c.id}/agreements`, {
    headers: { ...auth, 'Idempotency-Key': randomUUID() },
    data: {
      expectedCustomerVersion: c.version,
      title: '无文件协议',
      validityMode: 'UNKNOWN',
    },
  });
  expect(create.status(), await create.text()).toBe(201);
  const first = (await create.json()) as {
    customerVersion: number;
    agreement: { id: string; currentVersion: { files: unknown[] } };
  };
  expect(first.agreement.currentVersion.files).toEqual([]);
  expect([403, 404]).toContain(
    (
      await request.get(`/api/v1/customers/${c.id}/agreements`, {
        headers: self,
      })
    ).status(),
  );
  await setCustomerDocumentTestState(c.id, {
    responsibleUserId: e2eFixtures.userSelf,
    teamId: e2eFixtures.teamSelf,
    cooperationStatus: 'PAUSED',
  });
  expect([403, 404]).toContain(
    (
      await request.get(`/api/v1/customers/${c.id}/agreements`, {
        headers: auth,
      })
    ).status(),
  );
  const visible = await request.get(`/api/v1/customers/${c.id}/agreements`, {
    headers: self,
  });
  expect(visible.status(), await visible.text()).toBe(200);
  const selfRevision = await request.post(
    `/api/v1/customers/${c.id}/agreements/${first.agreement.id}/revisions`,
    {
      headers: { ...self, 'Idempotency-Key': randomUUID() },
      data: {
        expectedCustomerVersion: first.customerVersion,
        expectedAgreementVersion: 1,
        title: '暂停仍可维护',
      },
    },
  );
  expect(selfRevision.status(), await selfRevision.text()).toBe(200);
  await setCustomerDocumentGrant(
    e2eFixtures.roleA,
    'CUSTOMER_AGREEMENT_READ',
    false,
  );
  await setCustomerDocumentGrant(
    e2eFixtures.roleA,
    'CUSTOMER_AGREEMENT_READ',
    true,
    'DEPARTMENT',
  );
  await setCustomerDocumentGrant(
    e2eFixtures.roleA,
    'CUSTOMER_AGREEMENT_EDIT',
    false,
  );
  await setCustomerDocumentGrant(
    e2eFixtures.roleA,
    'CUSTOMER_AGREEMENT_EDIT',
    true,
    'DEPARTMENT',
  );
  await setCustomerDocumentBaseReadScope('DEPARTMENT');
  const departmentRead = await request.get(
    `/api/v1/customers/${c.id}/agreements`,
    { headers: auth },
  );
  expect(departmentRead.status(), await departmentRead.text()).toBe(200);
  expect(((await departmentRead.json()) as { canEdit: boolean }).canEdit).toBe(
    true,
  );
  expect([403, 404]).toContain(
    (
      await request.get(`/api/v1/customers/${c.id}/agreements`, {
        headers: foreign,
      })
    ).status(),
  );
  await setCustomerDocumentTestState(c.id, { cooperationStatus: 'TERMINATED' });
  const terminatedRead = await request.get(
    `/api/v1/customers/${c.id}/agreements`,
    { headers: self },
  );
  expect(terminatedRead.status(), await terminatedRead.text()).toBe(200);
  const terminatedRevision = await request.post(
    `/api/v1/customers/${c.id}/agreements/${first.agreement.id}/revisions`,
    {
      headers: { ...self, 'Idempotency-Key': randomUUID() },
      data: {
        expectedCustomerVersion: (
          (await selfRevision.json()) as { customerVersion: number }
        ).customerVersion,
        expectedAgreementVersion: 2,
        title: '终止后仍可维护',
      },
    },
  );
  expect(terminatedRevision.status(), await terminatedRevision.text()).toBe(
    200,
  );
});

test('CU007 agreement creation and customer deletion serialize on the parent', async ({
  request,
}) => {
  const c = await customer(request);
  await grantAll();
  await grantCustomerLifecycle(e2eFixtures.roleA);
  const results = await Promise.all([
    request.post(`/api/v1/customers/${c.id}/agreements`, {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: {
        expectedCustomerVersion: c.version,
        title: '并发协议',
        validityMode: 'UNKNOWN',
      },
    }),
    request.post(`/api/v1/customers/${c.id}/delete-draft`, {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: { expectedVersion: c.version, reason: '并发删除' },
    }),
  ]);
  const statuses = results.map((response) => response.status());
  expect(statuses.filter((status) => status === 201)).toHaveLength(1);
  expect(statuses.every((status) => [201, 404, 409].includes(status))).toBe(
    true,
  );
  const counts = await getCustomerDocumentCounts(c.id);
  if (results[0].status() === 201)
    expect(counts).toMatchObject({
      agreements: 1,
      agreementVersions: 1,
      receipts: 1,
      audits: 1,
    });
  else
    expect(counts).toMatchObject({
      agreements: 0,
      agreementVersions: 0,
      receipts: 0,
      audits: 0,
    });
});

test('CU007 audit, reference and receipt failures roll back the entire revision', async ({
  request,
}) => {
  const c = await customer(request);
  await grantAll();
  const m = await upload(request, c.id);
  const firstResponse = await request.post(
    `/api/v1/customers/${c.id}/agreements`,
    {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: {
        expectedCustomerVersion: c.version,
        title: '原版',
        validityMode: 'UNKNOWN',
      },
    },
  );
  expect(firstResponse.status(), await firstResponse.text()).toBe(201);
  const first = (await firstResponse.json()) as {
    agreement: { id: string; version: number };
    customerVersion: number;
  };
  let customerVersion = first.customerVersion;
  let agreementVersion = first.agreement.version;
  for (const stage of ['audit', 'reference', 'receipt'] as const) {
    const body = {
      expectedCustomerVersion: customerVersion,
      expectedAgreementVersion: agreementVersion,
      title: `故障后恢复 ${stage}`,
      contentVersionIds: [m.contentVersionId],
    };
    const key = randomUUID();
    const before = await getCustomerDocumentCounts(c.id);
    await rejectCustomerDocumentStage(stage);
    try {
      const failed = await request.post(
        `/api/v1/customers/${c.id}/agreements/${first.agreement.id}/revisions`,
        { headers: { ...auth, 'Idempotency-Key': key }, data: body },
      );
      expect(failed.status()).toBe(500);
      expect(await getCustomerDocumentCounts(c.id)).toEqual(before);
    } finally {
      await allowCustomerDocumentStage(stage);
    }
    const retried = await request.post(
      `/api/v1/customers/${c.id}/agreements/${first.agreement.id}/revisions`,
      { headers: { ...auth, 'Idempotency-Key': key }, data: body },
    );
    expect(retried.status(), await retried.text()).toBe(200);
    const result = (await retried.json()) as {
      agreement: { version: number };
      customerVersion: number;
    };
    customerVersion = result.customerVersion;
    agreementVersion = result.agreement.version;
  }
  expect(await getCustomerDocumentCounts(c.id)).toMatchObject({
    agreements: 1,
    agreementVersions: 4,
    receipts: 4,
    audits: 4,
    references: 3,
  });
});

test('CU007 real CLIENT and LAWYER sessions cannot read, write or download agreement data', async ({
  request,
}) => {
  await resetCoreLeadE2eData();
  await grantAll();
  const customerId = coreLeadFixtures.admittedCustomer;
  const current = await request.get(`/api/v1/customers/${customerId}`, {
    headers: auth,
  });
  expect(current.status(), await current.text()).toBe(200);
  const customerVersion = ((await current.json()) as { version: number })
    .version;
  const m = await upload(request, customerId);
  const created = await request.post(
    `/api/v1/customers/${customerId}/agreements`,
    {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: {
        expectedCustomerVersion: customerVersion,
        title: '外部边界协议',
        validityMode: 'UNKNOWN',
        contentVersionIds: [m.contentVersionId],
      },
    },
  );
  expect(created.status(), await created.text()).toBe(201);
  const username = `client-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const password = 'client correct horse battery';
  try {
    const client = await request.post(
      `/api/v1/customers/${customerId}/client-accounts`,
      {
        headers: auth,
        data: { displayName: '外部客户账号', username, password },
      },
    );
    expect(client.status(), await client.text()).toBe(201);
    const lawyer = await createLawyerAccountThroughApi(request);
    for (const actor of [
      { principal: 'CLIENT', username, password },
      {
        principal: 'LAWYER',
        username: lawyer.username,
        password: lawyer.password,
      },
    ]) {
      const session = await playwrightRequest.newContext({
        baseURL: 'http://127.0.0.1:5174',
      });
      try {
        const login = await session.post('/api/v1/auth/login', {
          headers: { Origin: 'http://127.0.0.1:5174' },
          data: { username: actor.username, password: actor.password },
        });
        expect(login.status(), await login.text()).toBe(200);
        const identity = (await login.json()) as {
          principalType: string;
          csrfToken: string;
        };
        expect(identity.principalType).toBe(actor.principal);
        for (const route of [
          `/api/v1/customers/${customerId}/agreements`,
          `/api/v1/customers/${customerId}/invoice-profile`,
          `/api/v1/materials/${m.materialId}/versions/${m.contentVersionId}/content`,
        ]) {
          const read = await session.get(route);
          expect([403, 404]).toContain(read.status());
        }
        const writeHeaders = {
          Origin: 'http://127.0.0.1:5174',
          'X-CSRF-Token': identity.csrfToken,
          'Idempotency-Key': randomUUID(),
        };
        const write = await session.post(
          `/api/v1/customers/${customerId}/agreements`,
          {
            headers: writeHeaders,
            data: {
              expectedCustomerVersion: customerVersion + 1,
              title: '外部不得写',
              validityMode: 'UNKNOWN',
            },
          },
        );
        expect([403, 404]).toContain(write.status());
        const draft = await session.post('/api/v1/materials/upload-drafts', {
          headers: writeHeaders,
          data: {
            ownerType: 'CUSTOMER',
            ownerId: customerId,
            category: 'CUSTOMER_AGREEMENT',
            purpose: 'CUSTOMER_AGREEMENT',
            originalFilename: 'agreement.pdf',
            declaredMimeType: 'application/pdf',
          },
        });
        expect([403, 404]).toContain(draft.status());
      } finally {
        await session.dispose();
      }
    }
  } finally {
    await cleanupContactExternalActors();
  }
});
