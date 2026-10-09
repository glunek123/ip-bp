import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  allowContactReceiptWrites,
  createLegacyPendingDeletedCustomer,
  disconnectCustomerTestDatabase,
  e2eFixtures,
  getContactProvenance,
  grantCustomerAdmission,
  grantCustomerLifecycle,
  holdCustomerActorLock,
  resetCustomerE2eData,
  rejectContactReceiptWrites,
  revokeCustomerAdmission,
  revokeCustomerRoutineEdit,
} from '../support/customer-database.mjs';

const auth = { Authorization: `Bearer ${e2eFixtures.tokenA}` };

test.beforeEach(async () => {
  await resetCustomerE2eData();
});
test.afterAll(async () => {
  await disconnectCustomerTestDatabase();
});

test('legacy flat edits preserve one contact ID; manual duplicates, primary, end and replay keep history', async ({
  request,
}) => {
  const created = await request.post('/api/v1/customers', {
    headers: auth,
    data: {
      name: 'CU006 old client',
      admissionContactName: 'Sample Person',
      admissionContactPhone: '13800138000',
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const customer = (await created.json()) as { id: string; version: number };
  const url = `/api/v1/customers/${customer.id}/contacts`;
  const initialList = await request.get(url, { headers: auth });
  expect(initialList.status(), await initialList.text()).toBe(200);
  const initial = (await initialList.json()) as {
    items: Array<{ id: string; version: number; origin: string }>;
  };
  expect(initial.items).toHaveLength(1);
  expect(initial.items[0].origin).toBe('LEGACY_CREATE');
  const firstId = initial.items[0].id;
  const oldEdit = await request.patch(`/api/v1/customers/${customer.id}`, {
    headers: auth,
    data: {
      expectedVersion: customer.version,
      admissionContactPhone: '13900139000',
    },
  });
  expect(oldEdit.status(), await oldEdit.text()).toBe(200);
  const afterOldEdit = (await oldEdit.json()) as { version: number };
  const afterList = await request.get(url, { headers: auth });
  const after = (await afterList.json()) as {
    items: Array<{ id: string; version: number; phone: string }>;
  };
  expect(after.items).toHaveLength(1);
  expect(after.items[0]).toMatchObject({
    id: firstId,
    version: 2,
    phone: '13900139000',
  });
  const duplicateBody = {
    expectedCustomerVersion: afterOldEdit.version,
    name: 'Sample Person',
    phone: '13900139000',
  };
  const key = randomUUID();
  const duplicate = await request.post(url, {
    headers: { ...auth, 'Idempotency-Key': key },
    data: duplicateBody,
  });
  expect(duplicate.status(), await duplicate.text()).toBe(201);
  const duplicateResult = (await duplicate.json()) as {
    contact: { id: string };
    customerVersion: number;
  };
  expect(duplicateResult.contact.id).not.toBe(firstId);
  const setPrimary = await request.post(`${url}/${firstId}/primary`, {
    headers: { ...auth, 'Idempotency-Key': randomUUID() },
    data: {
      expectedCustomerVersion: duplicateResult.customerVersion,
      expectedContactVersion: 2,
      primary: true,
    },
  });
  expect(setPrimary.status(), await setPrimary.text()).toBe(200);
  const primaryResult = (await setPrimary.json()) as {
    customerVersion: number;
    primaryContactId: string;
  };
  expect(primaryResult.primaryContactId).toBe(firstId);
  const end = await request.post(`${url}/${firstId}/end`, {
    headers: { ...auth, 'Idempotency-Key': randomUUID() },
    data: {
      expectedCustomerVersion: primaryResult.customerVersion,
      expectedContactVersion: 3,
      reason: '关系结束',
    },
  });
  expect(end.status(), await end.text()).toBe(200);
  const endResult = (await end.json()) as {
    customerVersion: number;
    primaryContactId: string | null;
  };
  expect(endResult.primaryContactId).toBeNull();
  const detail = await request.get(`/api/v1/customers/${customer.id}`, {
    headers: auth,
  });
  expect(detail.status(), await detail.text()).toBe(200);
  expect(await detail.json()).toMatchObject({
    admissionContactName: null,
    admissionContactPhone: null,
  });
  const versions = await request.get(`${url}/${firstId}/versions`, {
    headers: auth,
  });
  expect(versions.status(), await versions.text()).toBe(200);
  const versionBody = (await versions.json()) as {
    items: Array<{ action: string }>;
  };
  expect(versionBody.items.map((item) => item.action)).toEqual([
    'ENDED',
    'PRIMARY_SET',
    'UPDATED',
    'CREATED',
  ]);
  const replay = await request.post(url, {
    headers: { ...auth, 'Idempotency-Key': key },
    data: duplicateBody,
  });
  expect(replay.status(), await replay.text()).toBe(201);
  expect(await replay.json()).toEqual(duplicateResult);
  const oldRetry = await request.patch(`/api/v1/customers/${customer.id}`, {
    headers: auth,
    data: {
      expectedVersion: endResult.customerVersion,
      admissionContactName: 'Cannot revive',
      admissionContactPhone: '13800138000',
    },
  });
  expect(oldRetry.status()).toBe(409);
  expect((await oldRetry.json()).code).toBe(
    'CUSTOMER_CONTACT_SELECTION_REQUIRED',
  );
});

test('selected contact admission receipt replays after contact edit and end while snapshot stays frozen', async ({
  request,
}) => {
  await grantCustomerAdmission(e2eFixtures.roleA);
  const created = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: 'CU006 selected admission' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const customer = (await created.json()) as { id: string; version: number };
  const contactUrl = `/api/v1/customers/${customer.id}/contacts`;
  const createContact = await request.post(contactUrl, {
    headers: { ...auth, 'Idempotency-Key': randomUUID() },
    data: {
      expectedCustomerVersion: customer.version,
      name: 'Selected Person',
      phone: '13800138000',
    },
  });
  expect(createContact.status(), await createContact.text()).toBe(201);
  const createdContact = (await createContact.json()) as {
    contact: { id: string; version: number };
    customerVersion: number;
  };
  const draft = await request.post('/api/v1/materials/upload-drafts', {
    headers: auth,
    data: {
      ownerType: 'CUSTOMER',
      ownerId: customer.id,
      category: 'CUSTOMER_IDENTITY',
      purpose: 'IDENTITY_FULL',
      originalFilename: 'cu006.pdf',
      declaredMimeType: 'application/pdf',
    },
  });
  expect(draft.status(), await draft.text()).toBe(201);
  const uploadDraft = (await draft.json()) as { id: string };
  const uploaded = await request.put(
    `/api/v1/materials/upload-drafts/${uploadDraft.id}/content`,
    {
      headers: { ...auth, 'Content-Type': 'application/octet-stream' },
      data: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n'),
    },
  );
  expect(uploaded.status(), await uploaded.text()).toBe(200);
  const material = (await uploaded.json()) as { contentVersionId: string };
  const command = {
    expectedVersion: createdContact.customerVersion,
    customerType: 'ENTERPRISE',
    name: 'CU006 selected admission',
    identityType: 'BUSINESS_LICENSE',
    identityNumber: 'CU006-SYNTHETIC-001',
    identityValidityMode: 'LONG_TERM',
    admissionContactId: createdContact.contact.id,
    identityDocumentContentVersionIds: [material.contentVersionId],
  };
  const key = randomUUID();
  const admitted = await request.post(
    `/api/v1/customers/${customer.id}/admission`,
    {
      headers: { ...auth, 'Idempotency-Key': key },
      data: command,
    },
  );
  expect(admitted.status(), await admitted.text()).toBe(201);
  const admittedResult = (await admitted.json()) as {
    version: number;
    admissionContactName: string;
  };
  expect(admittedResult.admissionContactName).toBe('Selected Person');
  const edited = await request.patch(
    `${contactUrl}/${createdContact.contact.id}`,
    {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: {
        expectedCustomerVersion: admittedResult.version,
        expectedContactVersion: createdContact.contact.version,
        name: 'Current Person',
      },
    },
  );
  expect(edited.status(), await edited.text()).toBe(200);
  const editedResult = (await edited.json()) as {
    customerVersion: number;
    contact: { version: number };
  };
  const ended = await request.post(
    `${contactUrl}/${createdContact.contact.id}/end`,
    {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: {
        expectedCustomerVersion: editedResult.customerVersion,
        expectedContactVersion: editedResult.contact.version,
      },
    },
  );
  expect(ended.status(), await ended.text()).toBe(200);
  const replay = await request.post(
    `/api/v1/customers/${customer.id}/admission`,
    {
      headers: { ...auth, 'Idempotency-Key': key },
      data: command,
    },
  );
  expect(replay.status(), await replay.text()).toBe(201);
  expect(await replay.json()).toEqual(admittedResult);
  const detail = await request.get(`/api/v1/customers/${customer.id}`, {
    headers: auth,
  });
  expect(detail.status(), await detail.text()).toBe(200);
  expect(await detail.json()).toMatchObject({
    profileStatus: 'admitted',
    admissionContactName: null,
    admissionContactSnapshot: {
      name: 'Selected Person',
      source: 'NEW_ADMISSION',
    },
  });
  await revokeCustomerAdmission(e2eFixtures.roleA);
  const revokedReplay = await request.post(
    `/api/v1/customers/${customer.id}/admission`,
    {
      headers: { ...auth, 'Idempotency-Key': key },
      data: command,
    },
  );
  expect([403, 404]).toContain(revokedReplay.status());
});

test('restore materializes one preserved legacy contact with the real restoring actor', async ({
  request,
}) => {
  await grantCustomerLifecycle(e2eFixtures.roleA);
  const customerId = await createLegacyPendingDeletedCustomer();
  const key = randomUUID();
  const restore = await request.post(
    `/api/v1/customers/${customerId}/restore-draft`,
    {
      headers: { ...auth, 'Idempotency-Key': key },
      data: { expectedVersion: 1 },
    },
  );
  expect(restore.status(), await restore.text()).toBe(201);
  expect(await getContactProvenance(customerId)).toMatchObject([
    {
      origin: 'LEGACY_BACKFILL',
      createdByUserId: e2eFixtures.userA,
      versions: [
        { actorUserId: e2eFixtures.userA, source: 'HUMAN', action: 'CREATED' },
      ],
    },
  ]);
  const replay = await request.post(
    `/api/v1/customers/${customerId}/restore-draft`,
    {
      headers: { ...auth, 'Idempotency-Key': key },
      data: { expectedVersion: 1 },
    },
  );
  expect(replay.status(), await replay.text()).toBe(201);
  expect(await getContactProvenance(customerId)).toHaveLength(1);
  const forbiddenDeletion = await request.post(
    `/api/v1/customers/${customerId}/delete-draft`,
    {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: { expectedVersion: 2 },
    },
  );
  expect(forbiddenDeletion.status()).toBe(409);
  expect((await forbiddenDeletion.json()).code).toBe(
    'CUSTOMER_DRAFT_HAS_ASSOCIATIONS',
  );
});

test('contact receipt replay requires current edit authority and hidden departments learn no contact ID', async ({
  request,
}) => {
  const created = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: 'CU006 revoke' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const customer = (await created.json()) as { id: string; version: number };
  const url = `/api/v1/customers/${customer.id}/contacts`;
  const key = randomUUID();
  const body = {
    expectedCustomerVersion: customer.version,
    name: 'Revoked Person',
    email: 'synthetic@example.test',
  };
  const first = await request.post(url, {
    headers: { ...auth, 'Idempotency-Key': key },
    data: body,
  });
  expect(first.status(), await first.text()).toBe(201);
  const contact = (await first.json()) as { contact: { id: string } };
  const foreign = { Authorization: `Bearer ${e2eFixtures.tokenB}` };
  expect((await request.get(url, { headers: foreign })).status()).toBe(404);
  expect(
    (
      await request.get(`${url}/${contact.contact.id}/versions`, {
        headers: foreign,
      })
    ).status(),
  ).toBe(404);
  await revokeCustomerRoutineEdit(e2eFixtures.roleA);
  const replay = await request.post(url, {
    headers: { ...auth, 'Idempotency-Key': key },
    data: body,
  });
  expect([403, 404]).toContain(replay.status());
});

test('concurrent creates serialize by customer version, and replay precedes stale CAS and current state', async ({
  request,
}) => {
  const created = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: 'CU006 concurrent' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const customer = (await created.json()) as { id: string; version: number };
  const url = `/api/v1/customers/${customer.id}/contacts`;
  const body = {
    expectedCustomerVersion: customer.version,
    name: 'Race Person',
    phone: '13800138000',
  };
  const keys = [randomUUID(), randomUUID()];
  const responses = await Promise.all(
    keys.map((key) =>
      request.post(url, {
        headers: { ...auth, 'Idempotency-Key': key },
        data: body,
      }),
    ),
  );
  expect(responses.map((response) => response.status()).sort()).toEqual([
    201, 409,
  ]);
  const winner = responses.findIndex((response) => response.status() === 201);
  const result = (await responses[winner].json()) as {
    contact: { id: string; version: number };
    customerVersion: number;
  };
  expect((await responses[1 - winner].json()).code).toBe(
    'CUSTOMER_VERSION_CONFLICT',
  );
  const list = await request.get(`${url}?page=1&pageSize=1&status=ACTIVE`, {
    headers: auth,
  });
  expect(list.status(), await list.text()).toBe(200);
  expect(await list.json()).toMatchObject({
    total: 1,
    page: 1,
    pageSize: 1,
    items: [{ id: result.contact.id }],
  });
  const replay = await request.post(url, {
    headers: { ...auth, 'Idempotency-Key': keys[winner] },
    data: body,
  });
  expect(replay.status(), await replay.text()).toBe(201);
  expect(await replay.json()).toEqual(result);
  const changedBody = await request.post(url, {
    headers: { ...auth, 'Idempotency-Key': keys[winner] },
    data: { ...body, phone: '13900139000' },
  });
  expect(changedBody.status()).toBe(409);
  expect((await changedBody.json()).code).toBe(
    'CUSTOMER_CONTACT_IDEMPOTENCY_CONFLICT',
  );
});

test('receipt write failure rolls back contact, version and customer CAS; original request succeeds after repair', async ({
  request,
}) => {
  const created = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: 'CU006 fault' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const customer = (await created.json()) as { id: string; version: number };
  const url = `/api/v1/customers/${customer.id}/contacts`;
  const body = {
    expectedCustomerVersion: customer.version,
    name: 'Fault Person',
    phone: '13800138000',
  };
  await rejectContactReceiptWrites();
  try {
    const failed = await request.post(url, {
      headers: { ...auth, 'Idempotency-Key': 'cu006-fault-receipt' },
      data: body,
    });
    expect(failed.status()).toBe(500);
    const detail = await request.get(`/api/v1/customers/${customer.id}`, {
      headers: auth,
    });
    expect(detail.status(), await detail.text()).toBe(200);
    expect(await detail.json()).toMatchObject({ version: customer.version });
    const list = await request.get(url, { headers: auth });
    expect(list.status(), await list.text()).toBe(200);
    expect(await list.json()).toMatchObject({ total: 0, items: [] });
  } finally {
    await allowContactReceiptWrites();
  }
  const retry = await request.post(url, {
    headers: { ...auth, 'Idempotency-Key': 'cu006-fault-receipt' },
    data: body,
  });
  expect(retry.status(), await retry.text()).toBe(201);
  const result = (await retry.json()) as {
    customerVersion: number;
    contact: { id: string };
  };
  expect(result.customerVersion).toBe(customer.version + 1);
  const versions = await request.get(`${url}/${result.contact.id}/versions`, {
    headers: auth,
  });
  expect(versions.status(), await versions.text()).toBe(200);
  expect(await versions.json()).toMatchObject({ total: 1 });
});

test('actor row NOWAIT exhaustion returns BUSY without consuming the key, then original command succeeds', async ({
  request,
}) => {
  const created = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: 'CU006 busy' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const customer = (await created.json()) as { id: string; version: number };
  const url = `/api/v1/customers/${customer.id}/contacts`;
  const key = randomUUID();
  const body = {
    expectedCustomerVersion: customer.version,
    name: 'Busy Person',
    phone: '13800138000',
  };
  const release = await holdCustomerActorLock(e2eFixtures.userA);
  try {
    const busy = await request.post(url, {
      headers: { ...auth, 'Idempotency-Key': key },
      data: body,
    });
    expect(busy.status(), await busy.text()).toBe(409);
    expect((await busy.json()).code).toBe('CUSTOMER_CONTACT_BUSY');
  } finally {
    await release();
  }
  const retry = await request.post(url, {
    headers: { ...auth, 'Idempotency-Key': key },
    data: body,
  });
  expect(retry.status(), await retry.text()).toBe(201);
  const list = await request.get(url, { headers: auth });
  expect(await list.json()).toMatchObject({ total: 1 });
});
