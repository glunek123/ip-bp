import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  allowContactReceiptWrites,
  createLegacyPendingDeletedCustomer,
  disconnectCustomerTestDatabase,
  e2eFixtures,
  getContactProvenance,
  getCustomerLifecycleCounts,
  grantCustomerAdmission,
  grantCustomerLifecycle,
  holdCustomerActorLock,
  resetCustomerE2eData,
  rejectContactReceiptWrites,
  revokeCustomerAdmission,
  revokeCustomerRoutineEdit,
} from '../support/customer-database.mjs';

const auth = { Authorization: `Bearer ${e2eFixtures.tokenA}` };
type PgProbeClient = {
  connect(): Promise<void>;
  query(
    sql: string,
    values?: string[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
  end(): Promise<void>;
};
const requireBackend = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const PgClient = (
  requireBackend('pg') as {
    Client: new (options: { connectionString: string }) => PgProbeClient;
  }
).Client;

async function waitForBlockedQuery(
  client: PgProbeClient,
  event: string,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await client.query(
      `SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND wait_event=$1`,
      [event],
    );
    if (Number(result.rows[0]?.count) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected blocked ${event} wait did not appear`);
}

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

test('lifecycle delete and legacy restore keep their exact key through actor NOWAIT BUSY with no partial history', async ({
  request,
}) => {
  await grantCustomerLifecycle(e2eFixtures.roleA);
  const pendingId = await createLegacyPendingDeletedCustomer();
  const restoreKey = randomUUID();
  const restoreBody = { expectedVersion: 1 };
  const releaseRestoreLock = await holdCustomerActorLock(e2eFixtures.userA);
  try {
    const busy = await request.post(
      `/api/v1/customers/${pendingId}/restore-draft`,
      {
        headers: { ...auth, 'Idempotency-Key': restoreKey },
        data: restoreBody,
      },
    );
    expect(busy.status(), await busy.text()).toBe(409);
    expect((await busy.json()).code).toBe('CUSTOMER_CONTACT_BUSY');
    expect(await getContactProvenance(pendingId)).toEqual([]);
    expect(await getCustomerLifecycleCounts(pendingId)).toMatchObject({
      customer: { version: 1 },
      facts: 0,
      receipts: 0,
      audits: 0,
    });
  } finally {
    await releaseRestoreLock();
  }
  const restored = await request.post(
    `/api/v1/customers/${pendingId}/restore-draft`,
    {
      headers: { ...auth, 'Idempotency-Key': restoreKey },
      data: restoreBody,
    },
  );
  expect(restored.status(), await restored.text()).toBe(201);
  expect(await getContactProvenance(pendingId)).toMatchObject([
    {
      versions: [{ action: 'CREATED', actorUserId: e2eFixtures.userA }],
    },
  ]);
  expect(await getCustomerLifecycleCounts(pendingId)).toMatchObject({
    facts: 1,
    receipts: 1,
    audits: 1,
  });

  const created = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: 'CU006 empty delete BUSY' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const draft = (await created.json()) as { id: string; version: number };
  const deleteKey = randomUUID();
  const deleteBody = { expectedVersion: draft.version };
  const releaseDeleteLock = await holdCustomerActorLock(e2eFixtures.userA);
  try {
    const busy = await request.post(
      `/api/v1/customers/${draft.id}/delete-draft`,
      {
        headers: { ...auth, 'Idempotency-Key': deleteKey },
        data: deleteBody,
      },
    );
    expect(busy.status(), await busy.text()).toBe(409);
    expect((await busy.json()).code).toBe('CUSTOMER_CONTACT_BUSY');
    expect(await getContactProvenance(draft.id)).toEqual([]);
    expect(await getCustomerLifecycleCounts(draft.id)).toMatchObject({
      customer: { version: draft.version, deletedAt: null },
      facts: 0,
      receipts: 0,
      audits: 0,
    });
  } finally {
    await releaseDeleteLock();
  }
  const deleted = await request.post(
    `/api/v1/customers/${draft.id}/delete-draft`,
    {
      headers: { ...auth, 'Idempotency-Key': deleteKey },
      data: deleteBody,
    },
  );
  expect(deleted.status(), await deleted.text()).toBe(201);
  expect(await getCustomerLifecycleCounts(draft.id)).toMatchObject({
    facts: 1,
    receipts: 1,
    audits: 1,
  });
});

test('same actor and key across two customers under overlapping transactions commits one and returns safe 409', async ({
  request,
}) => {
  const firstCreate = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: 'CU006 key race A' },
  });
  const secondCreate = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: 'CU006 key race B' },
  });
  expect(firstCreate.status(), await firstCreate.text()).toBe(201);
  expect(secondCreate.status(), await secondCreate.text()).toBe(201);
  const first = (await firstCreate.json()) as { id: string; version: number };
  const second = (await secondCreate.json()) as { id: string; version: number };
  const key = randomUUID();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('isolated E2E DATABASE_URL missing');
  const blocker = new PgClient({ connectionString: databaseUrl });
  await blocker.connect();
  try {
    const database = await blocker.query(
      'SELECT current_database() AS name,current_schema() AS schema',
    );
    if (
      database.rows[0]?.name !== 'dev_cor_test' ||
      database.rows[0]?.schema !== 'public'
    )
      throw new Error('wrong test database');
    await blocker.query('BEGIN');
    await blocker.query(
      'SELECT id FROM customers WHERE id=$1::uuid FOR UPDATE',
      [first.id],
    );
    const firstRequest = request.post(
      `/api/v1/customers/${first.id}/contacts`,
      {
        headers: { ...auth, 'Idempotency-Key': key },
        data: {
          expectedCustomerVersion: first.version,
          name: 'First racer',
          phone: '13800138000',
        },
      },
    );
    await waitForBlockedQuery(blocker, 'transactionid');
    const secondRequest = request.post(
      `/api/v1/customers/${second.id}/contacts`,
      {
        headers: { ...auth, 'Idempotency-Key': key },
        data: {
          expectedCustomerVersion: second.version,
          name: 'Second racer',
          phone: '13900139000',
        },
      },
    );
    await waitForBlockedQuery(blocker, 'advisory');
    await blocker.query('COMMIT');
    const responses = await Promise.all([firstRequest, secondRequest]);
    expect(responses.map((response) => response.status()).sort()).toEqual([
      201, 409,
    ]);
    expect((await responses[1].json()).code).toBe(
      'CUSTOMER_CONTACT_IDEMPOTENCY_CONFLICT',
    );
    expect(await getContactProvenance(second.id)).toEqual([]);
    const residue = await blocker.query(
      `SELECT
      (SELECT count(*)::int FROM customer_contact_command_receipts WHERE customer_id=$1::uuid) AS receipts,
      (SELECT count(*)::int FROM audit_events WHERE resource_type='customer-contact' AND details->>'customerId'=$1::text) AS audits`,
      [second.id],
    );
    expect(residue.rows[0]).toMatchObject({ receipts: 0, audits: 0 });
  } finally {
    await blocker.query('ROLLBACK').catch(() => {});
    await blocker.end();
  }
});

test('contact receipt key unique violation maps to safe 409 and rolls back staged contact', async ({
  request,
}) => {
  const created = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: 'CU006 receipt unique fault' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const customer = (await created.json()) as { id: string; version: number };
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('isolated E2E DATABASE_URL missing');
  const client = new PgClient({ connectionString: databaseUrl });
  await client.connect();
  try {
    const database = await client.query(
      'SELECT current_database() AS name,current_schema() AS schema',
    );
    if (
      database.rows[0]?.name !== 'dev_cor_test' ||
      database.rows[0]?.schema !== 'public'
    )
      throw new Error('wrong test database');
    await client.query(`CREATE FUNCTION cu006_reject_contact_receipt_key() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.idempotency_key='cu006-review-duplicate' THEN
        RAISE unique_violation USING CONSTRAINT='customer_contact_command_receipts_department_actor_key';
      END IF; RETURN NEW; END $$`);
    await client.query(`CREATE TRIGGER cu006_reject_contact_receipt_key BEFORE INSERT ON customer_contact_command_receipts
      FOR EACH ROW EXECUTE FUNCTION cu006_reject_contact_receipt_key()`);
    const failed = await request.post(
      `/api/v1/customers/${customer.id}/contacts`,
      {
        headers: { ...auth, 'Idempotency-Key': 'cu006-review-duplicate' },
        data: {
          expectedCustomerVersion: customer.version,
          name: 'Fault unique',
          phone: '13800138000',
        },
      },
    );
    expect(failed.status(), await failed.text()).toBe(409);
    expect((await failed.json()).code).toBe(
      'CUSTOMER_CONTACT_IDEMPOTENCY_CONFLICT',
    );
    expect(await getContactProvenance(customer.id)).toEqual([]);
    const residue = await client.query(
      `SELECT count(*)::int AS receipts FROM customer_contact_command_receipts WHERE customer_id=$1::uuid`,
      [customer.id],
    );
    expect(residue.rows[0]).toMatchObject({ receipts: 0 });
  } finally {
    try {
      await client.query(
        'DROP TRIGGER IF EXISTS cu006_reject_contact_receipt_key ON customer_contact_command_receipts',
      );
    } finally {
      try {
        await client.query(
          'DROP FUNCTION IF EXISTS cu006_reject_contact_receipt_key()',
        );
      } finally {
        await client.end();
      }
    }
  }
});
