import { randomUUID } from 'node:crypto';
import { expect, request as playwrightRequest, test } from '@playwright/test';
import {
  disconnectCustomerTestDatabase,
  e2eFixtures,
  grantCustomerLifecycle,
  resetCustomerE2eData,
  setCustomerDocumentBaseReadScope,
  setCustomerDocumentTestState,
} from '../support/customer-database.mjs';
import {
  allowCustomerSettlementAudit,
  cleanupCustomerSettlementExternalActors,
  disconnectCustomerSettlementDatabase,
  getCustomerSettlementState,
  rejectCustomerSettlementAudit,
  setCustomerSettlementGrant,
} from '../support/customer-settlement-database.mjs';
import {
  coreLeadFixtures,
  disconnectCoreLeadTestDatabase,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';
import { createLawyerAccountThroughApi } from '../support/case-lawyer-account.mjs';

const auth = { Authorization: `Bearer ${e2eFixtures.tokenA}` };
const foreign = { Authorization: `Bearer ${e2eFixtures.tokenB}` };
const self = { Authorization: `Bearer ${e2eFixtures.tokenSelf}` };
const body = (
  expectedCustomerVersion: number,
  settlementAmount = '100.00',
) => ({
  expectedCustomerVersion,
  settlementDate: '2026-10-01',
  settlementAmount,
});

test.beforeEach(async () => {
  await cleanupCustomerSettlementExternalActors(e2eFixtures.departmentA);
  await resetCustomerE2eData();
});
test.afterAll(async () => {
  await cleanupCustomerSettlementExternalActors(e2eFixtures.departmentA);
  await resetCustomerE2eData();
  await disconnectCustomerSettlementDatabase();
  await disconnectCustomerTestDatabase();
  await disconnectCoreLeadTestDatabase();
});

test('register-only has no sensitive GET; correction-only known exact record works; immutable history and stats', async ({
  request,
}) => {
  const created = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: `CU008 ${randomUUID()}` },
  });
  expect(created.status(), await created.text()).toBe(201);
  const customer = (await created.json()) as { id: string; version: number };
  const url = `/api/v1/customers/${customer.id}/settlements`;
  let detail = await request.get(`/api/v1/customers/${customer.id}`, {
    headers: auth,
  });
  expect((await detail.json()) as { capabilities: unknown }).toMatchObject({
    capabilities: {
      settlement: { read: false, register: false, correct: false },
    },
  });
  await setCustomerSettlementGrant(
    e2eFixtures.roleA,
    'CUSTOMER_SETTLEMENT_REGISTER',
    true,
  );
  detail = await request.get(`/api/v1/customers/${customer.id}`, {
    headers: auth,
  });
  expect((await detail.json()) as { capabilities: unknown }).toMatchObject({
    capabilities: {
      settlement: { read: false, register: true, correct: false },
    },
  });
  expect((await request.get(url, { headers: auth })).status()).toBe(403);
  const key = randomUUID();
  const register = await request.post(url, {
    headers: { ...auth, 'Idempotency-Key': key },
    data: body(customer.version),
  });
  expect(register.status(), await register.text()).toBe(201);
  const first = (await register.json()) as {
    recordId: string;
    version: number;
    customerVersion: number;
    snapshot: {
      settlementAmount: string;
      invoiceAmount: null;
      receivedAmount: null;
    };
  };
  expect(first).toMatchObject({
    version: 1,
    customerVersion: customer.version + 1,
    snapshot: {
      settlementAmount: '100.00',
      invoiceAmount: null,
      receivedAmount: null,
    },
  });
  expect((await request.get(url, { headers: auth })).status()).toBe(403);
  await setCustomerSettlementGrant(
    e2eFixtures.roleA,
    'CUSTOMER_SETTLEMENT_REGISTER',
    false,
  );
  await setCustomerSettlementGrant(
    e2eFixtures.roleA,
    'CUSTOMER_SETTLEMENT_CORRECT',
    true,
  );
  const correction = {
    ...body(first.customerVersion, '100.01'),
    invoiceAmount: null,
    receivedAmount: '0.00',
    receivedDate: null,
    reason: '核对',
    expectedRecordVersion: 1,
  };
  const corrected = await request.post(`${url}/${first.recordId}/corrections`, {
    headers: { ...auth, 'Idempotency-Key': randomUUID() },
    data: correction,
  });
  expect(corrected.status(), await corrected.text()).toBe(200);
  const second = (await corrected.json()) as {
    version: number;
    customerVersion: number;
  };
  expect(second.version).toBe(2);
  expect((await request.get(url, { headers: auth })).status()).toBe(403);
  await setCustomerSettlementGrant(
    e2eFixtures.roleA,
    'CUSTOMER_SETTLEMENT_READ',
    true,
  );
  const list = await request.get(url, { headers: auth });
  expect(list.status(), await list.text()).toBe(200);
  expect(
    (await list.json()) as { total: number; stats: unknown; items: unknown[] },
  ).toMatchObject({
    total: 1,
    stats: {
      recordCount: 1,
      totalSettlement: '100.01',
      receivedKnownSubtotal: '0.00',
      pendingAmount: '100.01',
      recoveryRate: '0.00',
    },
    items: [
      { version: 2, currentVersion: { version: 2, correctionReason: '核对' } },
    ],
  });
  const versions = await request.get(`${url}/${first.recordId}/versions`, {
    headers: auth,
  });
  expect(versions.status()).toBe(200);
  expect(
    (await versions.json()) as { items: Array<{ version: number }> },
  ).toMatchObject({ items: [{ version: 2 }, { version: 1 }] });
  const ordinary = await request.get(`/api/v1/customers/${customer.id}`, {
    headers: auth,
  });
  expect(JSON.stringify(await ordinary.json())).not.toContain(
    'customer.settlement.register',
  );
  const replay = await request.post(url, {
    headers: { ...auth, 'Idempotency-Key': key },
    data: body(customer.version),
  });
  expect(replay.status()).toBe(403);
  await setCustomerSettlementGrant(
    e2eFixtures.roleA,
    'CUSTOMER_SETTLEMENT_REGISTER',
    true,
  );
  const authorizedReplay = await request.post(url, {
    headers: { ...auth, 'Idempotency-Key': key },
    data: body(customer.version),
  });
  expect(authorizedReplay.status(), await authorizedReplay.text()).toBe(201);
  expect(await authorizedReplay.json()).toEqual(first);
  const state = await getCustomerSettlementState(customer.id);
  expect(state.records).toHaveLength(1);
  expect(state.records[0]?.versions).toHaveLength(2);
  expect(state.records[0]?.receipts).toHaveLength(2);
  expect(state.audits).toHaveLength(2);
  await setCustomerDocumentTestState(customer.id, {
    responsibleUserId: e2eFixtures.userSelf,
    teamId: e2eFixtures.teamSelf,
  });
  const afterTransfer = await request.post(url, {
    headers: { ...auth, 'Idempotency-Key': key },
    data: body(customer.version),
  });
  expect(afterTransfer.status()).toBe(404);
});

test('unknown and zero remain distinct; page does not change whole-customer stats', async ({
  request,
}) => {
  const created = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: `CU008 ${randomUUID()}` },
  });
  const customer = (await created.json()) as { id: string; version: number };
  const url = `/api/v1/customers/${customer.id}/settlements`;
  await setCustomerSettlementGrant(
    e2eFixtures.roleA,
    'CUSTOMER_SETTLEMENT_REGISTER',
    true,
  );
  await setCustomerSettlementGrant(
    e2eFixtures.roleA,
    'CUSTOMER_SETTLEMENT_READ',
    true,
  );
  const first = await request.post(url, {
    headers: { ...auth, 'Idempotency-Key': randomUUID() },
    data: body(customer.version),
  });
  expect(first.status(), await first.text()).toBe(201);
  const firstResult = (await first.json()) as { customerVersion: number };
  const second = await request.post(url, {
    headers: { ...auth, 'Idempotency-Key': randomUUID() },
    data: {
      ...body(firstResult.customerVersion, '50.00'),
      receivedAmount: '0.00',
    },
  });
  expect(second.status(), await second.text()).toBe(201);
  const list = await request.get(`${url}?page=2&pageSize=1`, { headers: auth });
  expect(list.status(), await list.text()).toBe(200);
  expect(
    (await list.json()) as { total: number; items: unknown[]; stats: unknown },
  ).toMatchObject({
    total: 2,
    items: [{}],
    stats: {
      recordCount: 2,
      totalSettlement: '150.00',
      receivedKnownSubtotal: '0.00',
      receivedUnknownCount: 1,
      pendingAmount: null,
      recoveryRate: null,
    },
  });
  expect((await request.get(url, { headers: foreign })).status()).toBe(404);
});

test('scope, deleted customer and invalid input deny access without side effects', async ({
  request,
}) => {
  const created = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: `CU008 ${randomUUID()}` },
  });
  const customer = (await created.json()) as { id: string; version: number };
  const url = `/api/v1/customers/${customer.id}/settlements`;
  await setCustomerSettlementGrant(
    e2eFixtures.roleA,
    'CUSTOMER_SETTLEMENT_REGISTER',
    true,
    'SELF',
  );
  await setCustomerSettlementGrant(
    e2eFixtures.roleA,
    'CUSTOMER_SETTLEMENT_READ',
    true,
    'SELF',
  );
  expect((await request.get(url, { headers: auth })).status()).toBe(200);
  const invalid = await request.post(url, {
    headers: { ...auth, 'Idempotency-Key': randomUUID() },
    data: body(customer.version, '1.230'),
  });
  expect(invalid.status()).toBe(400);
  expect((await getCustomerSettlementState(customer.id)).records).toHaveLength(
    0,
  );
  await setCustomerDocumentTestState(customer.id, {
    responsibleUserId: e2eFixtures.userSelf,
    teamId: e2eFixtures.teamSelf,
  });
  expect((await request.get(url, { headers: auth })).status()).toBe(404);
  await setCustomerDocumentBaseReadScope('DEPARTMENT');
  expect((await request.get(url, { headers: auth })).status()).toBe(403);
  await setCustomerSettlementGrant(
    e2eFixtures.roleA,
    'CUSTOMER_SETTLEMENT_READ',
    true,
    'TEAM',
  );
  expect((await request.get(url, { headers: auth })).status()).toBe(403);
  await setCustomerSettlementGrant(
    e2eFixtures.roleA,
    'CUSTOMER_SETTLEMENT_READ',
    true,
    'DEPARTMENT',
  );
  expect((await request.get(url, { headers: auth })).status()).toBe(200);
  expect((await request.get(url, { headers: self })).status()).toBe(403);
  const another = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: `CU008 deleted ${randomUUID()}` },
  });
  const deletedCustomer = (await another.json()) as {
    id: string;
    version: number;
  };
  await grantCustomerLifecycle(e2eFixtures.roleA);
  const deleted = await request.post(
    `/api/v1/customers/${deletedCustomer.id}/delete-draft`,
    {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: { expectedVersion: deletedCustomer.version, reason: '无业务关联' },
    },
  );
  expect(deleted.status(), await deleted.text()).toBe(201);
  const deletedUrl = `/api/v1/customers/${deletedCustomer.id}/settlements`;
  expect((await request.get(deletedUrl, { headers: auth })).status()).toBe(404);
  const blocked = await request.post(deletedUrl, {
    headers: { ...auth, 'Idempotency-Key': randomUUID() },
    data: body(deletedCustomer.version + 1),
  });
  expect(blocked.status()).toBe(404);
});

test('audit rejection rolls back customer CAS, record and receipt; same key can retry', async ({
  request,
}) => {
  const created = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: `CU008 ${randomUUID()}` },
  });
  const customer = (await created.json()) as { id: string; version: number };
  const url = `/api/v1/customers/${customer.id}/settlements`;
  await setCustomerSettlementGrant(
    e2eFixtures.roleA,
    'CUSTOMER_SETTLEMENT_REGISTER',
    true,
  );
  const key = randomUUID();
  await rejectCustomerSettlementAudit();
  try {
    const failed = await request.post(url, {
      headers: { ...auth, 'Idempotency-Key': key },
      data: body(customer.version),
    });
    expect(failed.status()).toBeGreaterThanOrEqual(400);
  } finally {
    await allowCustomerSettlementAudit();
  }
  const afterFailure = await getCustomerSettlementState(customer.id);
  expect(afterFailure).toMatchObject({
    customerVersion: customer.version,
    records: [],
    audits: [],
  });
  const retried = await request.post(url, {
    headers: { ...auth, 'Idempotency-Key': key },
    data: body(customer.version),
  });
  expect(retried.status(), await retried.text()).toBe(201);
  expect((await getCustomerSettlementState(customer.id)).records).toHaveLength(
    1,
  );
});

test('different keys contend on the same customer version and zero settlement prevents deletion', async ({
  request,
}) => {
  const created = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: `CU008 ${randomUUID()}` },
  });
  const customer = (await created.json()) as { id: string; version: number };
  const url = `/api/v1/customers/${customer.id}/settlements`;
  await setCustomerSettlementGrant(
    e2eFixtures.roleA,
    'CUSTOMER_SETTLEMENT_REGISTER',
    true,
  );
  const [first, second] = await Promise.all(
    [1, 2].map(() =>
      request.post(url, {
        headers: { ...auth, 'Idempotency-Key': randomUUID() },
        data: body(customer.version, '0.00'),
      }),
    ),
  );
  expect([first.status(), second.status()].sort()).toEqual([201, 409]);
  const state = await getCustomerSettlementState(customer.id);
  expect(state.records).toHaveLength(1);
  expect(state.records[0]?.versions).toHaveLength(1);
  expect(state.records[0]?.receipts).toHaveLength(1);
  await grantCustomerLifecycle(e2eFixtures.roleA);
  const deletion = await request.post(
    `/api/v1/customers/${customer.id}/delete-draft`,
    {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: { expectedVersion: state.customerVersion, reason: '已有零元结算' },
    },
  );
  expect(deletion.status()).toBe(409);
});

test('real PG keeps the 21-record percent boundary exact through correction', async ({
  request,
}) => {
  const created = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: `CU008 ${randomUUID()}` },
  });
  const customer = (await created.json()) as { id: string; version: number };
  const url = `/api/v1/customers/${customer.id}/settlements`;
  for (const action of [
    'CUSTOMER_SETTLEMENT_READ',
    'CUSTOMER_SETTLEMENT_REGISTER',
    'CUSTOMER_SETTLEMENT_CORRECT',
  ] as const)
    await setCustomerSettlementGrant(e2eFixtures.roleA, action, true);
  let customerVersion = customer.version;
  for (let index = 0; index < 20; index += 1) {
    const createdRecord = await request.post(url, {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: {
        ...body(customerVersion, '9999999999999999.99'),
        receivedAmount: index === 0 ? '2010000000000000.00' : '0.00',
      },
    });
    expect(createdRecord.status(), await createdRecord.text()).toBe(201);
    customerVersion = (
      (await createdRecord.json()) as { customerVersion: number }
    ).customerVersion;
  }
  const finalRecord = await request.post(url, {
    headers: { ...auth, 'Idempotency-Key': randomUUID() },
    data: { ...body(customerVersion, '0.21'), receivedAmount: '0.00' },
  });
  expect(finalRecord.status(), await finalRecord.text()).toBe(201);
  const last = (await finalRecord.json()) as {
    recordId: string;
    customerVersion: number;
  };
  const below = await request.get(`${url}?pageSize=1`, { headers: auth });
  expect(
    (await below.json()) as { total: number; stats: unknown },
  ).toMatchObject({
    total: 21,
    stats: {
      totalSettlement: '200000000000000000.01',
      receivedKnownSubtotal: '2010000000000000.00',
      recoveryRate: '1.00',
    },
  });
  const corrected = await request.post(`${url}/${last.recordId}/corrections`, {
    headers: { ...auth, 'Idempotency-Key': randomUUID() },
    data: {
      ...body(last.customerVersion, '0.20'),
      invoiceAmount: null,
      receivedAmount: '0.00',
      receivedDate: null,
      reason: '边界复核',
      expectedRecordVersion: 1,
    },
  });
  expect(corrected.status(), await corrected.text()).toBe(200);
  const at = await request.get(`${url}?pageSize=1`, { headers: auth });
  expect((await at.json()) as { total: number; stats: unknown }).toMatchObject({
    total: 21,
    stats: { totalSettlement: '200000000000000000.00', recoveryRate: '1.01' },
  });
});

test('real CLIENT and LAWYER sessions have no settlement projection or write access', async ({
  request,
}) => {
  await resetCoreLeadE2eData();
  const customerId = coreLeadFixtures.admittedCustomer;
  const initialDetail = await request.get(`/api/v1/customers/${customerId}`, {
    headers: auth,
  });
  expect(initialDetail.status(), await initialDetail.text()).toBe(200);
  const customer = {
    id: customerId,
    version: ((await initialDetail.json()) as { version: number }).version,
  };
  for (const action of [
    'CUSTOMER_SETTLEMENT_READ',
    'CUSTOMER_SETTLEMENT_REGISTER',
    'CUSTOMER_SETTLEMENT_CORRECT',
  ] as const)
    await setCustomerSettlementGrant(e2eFixtures.roleA, action, true);
  const url = `/api/v1/customers/${customer.id}/settlements`;
  const registered = await request.post(url, {
    headers: { ...auth, 'Idempotency-Key': randomUUID() },
    data: body(customer.version),
  });
  expect(registered.status(), await registered.text()).toBe(201);
  const original = (await registered.json()) as {
    recordId: string;
    customerVersion: number;
  };
  const username = `client-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const password = 'client correct horse battery';
  const client = await request.post(
    `/api/v1/customers/${customer.id}/client-accounts`,
    {
      headers: auth,
      data: { displayName: '结算外部客户', username, password },
    },
  );
  expect(client.status(), await client.text()).toBe(201);
  const lawyer = await createLawyerAccountThroughApi(request);
  for (const candidate of [
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
        data: { username: candidate.username, password: candidate.password },
      });
      expect(login.status(), await login.text()).toBe(200);
      const identity = (await login.json()) as {
        principalType: string;
        csrfToken: string;
      };
      expect(identity.principalType).toBe(candidate.principal);
      for (const route of [
        url,
        `${url}/${original.recordId}`,
        `${url}/${original.recordId}/versions`,
      ]) {
        const response = await session.get(route);
        expect([403, 404]).toContain(response.status());
      }
      const headers = {
        Origin: 'http://127.0.0.1:5174',
        'X-CSRF-Token': identity.csrfToken,
        'Idempotency-Key': randomUUID(),
      };
      const write = await session.post(url, {
        headers,
        data: body(original.customerVersion),
      });
      expect([403, 404]).toContain(write.status());
      const correct = await session.post(
        `${url}/${original.recordId}/corrections`,
        {
          headers: { ...headers, 'Idempotency-Key': randomUUID() },
          data: {
            ...body(original.customerVersion),
            invoiceAmount: null,
            receivedAmount: null,
            receivedDate: null,
            reason: '外部不得更正',
            expectedRecordVersion: 1,
          },
        },
      );
      expect([403, 404]).toContain(correct.status());
    } finally {
      await session.dispose();
    }
  }
});
