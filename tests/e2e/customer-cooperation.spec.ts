import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  allowCustomerMaintenanceStage,
  beginCustomerCooperationBlocker,
  beginForeignCustomerAccountBlocker,
  disconnectCustomerTestDatabase,
  e2eFixtures,
  getCustomerMaintenanceState,
  grantCustomerCooperation,
  grantCustomerLifecycle,
  rejectCustomerMaintenanceStage,
  resetCustomerE2eData,
  revokeCustomerCooperation,
  setCustomerOperatorState,
} from '../support/customer-database.mjs';
import {
  coreLeadFixtures,
  disconnectCoreLeadTestDatabase,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';

const authA = { Authorization: `Bearer ${e2eFixtures.tokenA}` };
const authB = { Authorization: `Bearer ${e2eFixtures.tokenB}` };
const authSelf = { Authorization: `Bearer ${e2eFixtures.tokenSelf}` };

async function draft(
  request: APIRequestContext,
  name: string,
  headers = authA,
) {
  const response = await request.post('/api/v1/customers', {
    headers,
    data: { name },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json() as Promise<{
    id: string;
    version: number;
    teamId: string;
  }>;
}

function maintenance(
  request: APIRequestContext,
  id: string,
  action: 'pause' | 'terminate' | 'resume',
  expectedVersion: number,
  key = randomUUID(),
  headers = authA,
  reason: string | undefined = '业务原因',
) {
  return request.post(`/api/v1/customers/${id}/cooperation`, {
    headers: { ...headers, 'Idempotency-Key': key },
    data: {
      expectedVersion,
      action,
      ...(reason === undefined ? {} : { reason }),
    },
  });
}

function transfer(
  request: APIRequestContext,
  id: string,
  expectedVersion: number,
  targetUserId: string,
  key = randomUUID(),
  headers = authA,
  reason = '分工调整',
) {
  return request.post(`/api/v1/customers/${id}/responsible-transfer`, {
    headers: { ...headers, 'Idempotency-Key': key },
    data: { expectedVersion, targetUserId, reason },
  });
}

test.beforeEach(async () => {
  await resetCustomerE2eData();
  await grantCustomerCooperation(e2eFixtures.roleA);
  await grantCustomerCooperation(e2eFixtures.roleSelf, 'SELF');
});
test.afterAll(async () => {
  await disconnectCustomerTestDatabase();
  await disconnectCoreLeadTestDatabase();
});

test('candidate read intersects transfer and SELF source loses read after cross-team transfer', async ({
  request,
}) => {
  const source = await draft(request, 'SELF 转派客户', authSelf);
  const candidates = await request.get(
    `/api/v1/customers/${source.id}/eligible-operators?page=1&pageSize=5`,
    { headers: authSelf },
  );
  expect(candidates.status(), await candidates.text()).toBe(200);
  const page: {
    items: Array<{ id: string; displayName: string; teamName: string | null }>;
  } = await candidates.json();
  expect(page.items.map((item) => item.id)).toContain(e2eFixtures.userA);
  expect(page.items.map((item) => item.id)).not.toContain(e2eFixtures.userB);
  expect(page.items.map((item) => item.id)).not.toContain(e2eFixtures.userSelf);
  expect(Object.keys(page.items[0]!).sort()).toEqual([
    'displayName',
    'id',
    'teamName',
  ]);

  // The destination has no customer.read grant; eligibility is an organization fact.
  await revokeCustomerCooperation(e2eFixtures.roleA, 'CUSTOMER_READ');
  const key = randomUUID();
  const moved = await transfer(
    request,
    source.id,
    source.version,
    e2eFixtures.userA,
    key,
    authSelf,
  );
  expect(moved.status(), await moved.text()).toBe(201);
  expect(await moved.json()).toMatchObject({
    customerId: source.id,
    action: 'responsible-transfer',
    resultVersion: source.version + 1,
    canReadAfter: false,
  });
  const state = await getCustomerMaintenanceState(source.id);
  expect(state.customer).toMatchObject({
    responsibleUserId: e2eFixtures.userA,
    teamId: e2eFixtures.teamSelf,
  });
  expect(state).toMatchObject({ facts: 1, receipts: 1, audits: 1 });
  expect(
    (
      await request.get(`/api/v1/customers/${source.id}`, { headers: authSelf })
    ).status(),
  ).toBe(404);
  // A committed historical command does not bypass current read authorization.
  expect(
    (
      await transfer(
        request,
        source.id,
        source.version,
        e2eFixtures.userA,
        key,
        authSelf,
      )
    ).status(),
  ).toBe(404);
});

test('target organization eligibility and action grant are enforced before any write', async ({
  request,
}) => {
  const source = await draft(request, '转派资格校验');
  const baseline = await getCustomerMaintenanceState(source.id);
  expect(
    (
      await transfer(request, source.id, source.version, e2eFixtures.userB)
    ).status(),
  ).toBe(404);
  for (const change of [
    { accountActive: false },
    { membershipActive: false },
    { teamStatus: 'INACTIVE' },
  ] as const) {
    await setCustomerOperatorState(e2eFixtures.userSelf, change);
    expect(
      (
        await transfer(request, source.id, source.version, e2eFixtures.userSelf)
      ).status(),
    ).toBe(404);
    await setCustomerOperatorState(e2eFixtures.userSelf, {
      accountActive: true,
      membershipActive: true,
      teamStatus: 'ACTIVE',
    });
  }
  expect(await getCustomerMaintenanceState(source.id)).toEqual(baseline);
  await revokeCustomerCooperation(
    e2eFixtures.roleA,
    'CUSTOMER_RESPONSIBLE_TRANSFER',
  );
  expect(
    (
      await request.get(`/api/v1/customers/${source.id}/eligible-operators`, {
        headers: authA,
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await transfer(request, source.id, source.version, e2eFixtures.userSelf)
    ).status(),
  ).toBe(404);
  expect(await getCustomerMaintenanceState(source.id)).toEqual(baseline);
  expect(
    (
      await request.get(`/api/v1/customers/${source.id}`, { headers: authB })
    ).status(),
  ).toBe(404);
});

test('a legitimately created CLIENT account is excluded from target candidates and transfer', async ({
  request,
}) => {
  await resetCoreLeadE2eData();
  await grantCustomerCooperation(coreLeadFixtures.roleA);
  const account = await request.post(
    `/api/v1/customers/${coreLeadFixtures.admittedCustomer}/client-accounts`,
    {
      headers: authA,
      data: {
        displayName: '合法客户账号',
        username: `cu005-${randomUUID().slice(0, 12)}`,
        password: 'Client-passphrase-2026',
      },
    },
  );
  expect(account.status(), await account.text()).toBe(201);
  const client: { id: string } = await account.json();
  const candidates = await request.get(
    `/api/v1/customers/${coreLeadFixtures.admittedCustomer}/eligible-operators`,
    { headers: authA },
  );
  expect(candidates.status(), await candidates.text()).toBe(200);
  const page: { items: Array<{ id: string }> } = await candidates.json();
  expect(page.items.map((item) => item.id)).not.toContain(client.id);
  const current = await request.get(
    `/api/v1/customers/${coreLeadFixtures.admittedCustomer}`,
    { headers: authA },
  );
  const customer: { version: number } = await current.json();
  const before = await getCustomerMaintenanceState(
    coreLeadFixtures.admittedCustomer,
  );
  const denied = await transfer(
    request,
    coreLeadFixtures.admittedCustomer,
    customer.version,
    client.id,
  );
  expect(denied.status()).toBe(404);
  expect(await denied.json()).toMatchObject({
    code: 'CUSTOMER_OPERATOR_NOT_ELIGIBLE',
  });
  expect(
    await getCustomerMaintenanceState(coreLeadFixtures.admittedCustomer),
  ).toEqual(before);
});

test('target stop, team move and grant revoke serialize with transfer', async ({
  request,
}) => {
  for (const kind of [
    'account-disable',
    'membership-move',
    'grant-revoke',
  ] as const) {
    const source = await draft(request, `转派并发 ${kind}`);
    const blocker = await beginCustomerCooperationBlocker(
      kind,
      e2eFixtures.userSelf,
    );
    let attempt: ReturnType<typeof transfer> | undefined;
    try {
      attempt = transfer(
        request,
        source.id,
        source.version,
        e2eFixtures.userSelf,
      );
      expect(await blocker.waitForBlocked()).toBe(true);
      await blocker.commit();
      const response = await attempt;
      if (kind === 'membership-move') {
        expect(response.status(), await response.text()).toBe(201);
        expect(await getCustomerMaintenanceState(source.id)).toMatchObject({
          customer: {
            responsibleUserId: e2eFixtures.userSelf,
            teamId: e2eFixtures.teamA,
          },
          facts: 1,
          receipts: 1,
          audits: 1,
        });
      } else {
        expect(response.status()).toBe(404);
        expect(await getCustomerMaintenanceState(source.id)).toMatchObject({
          customer: {
            version: source.version,
            responsibleUserId: e2eFixtures.userA,
          },
          facts: 0,
          receipts: 0,
          audits: 0,
        });
      }
    } finally {
      await blocker.rollback();
      if (attempt) await attempt.catch(() => undefined);
      if (kind === 'account-disable') {
        await setCustomerOperatorState(e2eFixtures.userSelf, {
          accountActive: true,
        });
      }
      if (kind === 'membership-move') {
        await setCustomerOperatorState(e2eFixtures.userSelf, {
          membershipTeamId: e2eFixtures.teamSelf,
        });
      }
      if (kind === 'grant-revoke') {
        await grantCustomerCooperation(e2eFixtures.roleA);
      }
    }
  }
});

test('cross-department account lock yields a retryable 409 and the original key can later commit', async ({
  request,
}) => {
  const source = await draft(request, '跨部门共享账号锁');
  const key = randomUUID();
  const baseline = await getCustomerMaintenanceState(source.id);
  const blocker = await beginForeignCustomerAccountBlocker(e2eFixtures.userA);
  try {
    const busy = await transfer(
      request,
      source.id,
      source.version,
      e2eFixtures.userSelf,
      key,
    );
    expect(busy.status(), await busy.text()).toBe(409);
    expect(await busy.json()).toMatchObject({
      code: 'CUSTOMER_MAINTENANCE_BUSY',
    });
    expect(await getCustomerMaintenanceState(source.id)).toEqual(baseline);
  } finally {
    await blocker.rollback();
  }
  const retried = await transfer(
    request,
    source.id,
    source.version,
    e2eFixtures.userSelf,
    key,
  );
  expect(retried.status(), await retried.text()).toBe(201);
  expect(await getCustomerMaintenanceState(source.id)).toMatchObject({
    customer: {
      version: source.version + 1,
      responsibleUserId: e2eFixtures.userSelf,
    },
    facts: 1,
    receipts: 1,
    audits: 1,
  });
});

test('authorized replay preserves the old fact after target deactivation but revoked action denies replay', async ({
  request,
}) => {
  const source = await draft(request, '回放目标变化');
  const key = randomUUID();
  const first = await transfer(
    request,
    source.id,
    source.version,
    e2eFixtures.userSelf,
    key,
  );
  expect(first.status(), await first.text()).toBe(201);
  const original = await first.json();
  await setCustomerOperatorState(e2eFixtures.userSelf, {
    accountActive: false,
  });
  const replay = await transfer(
    request,
    source.id,
    source.version,
    e2eFixtures.userSelf,
    key,
  );
  expect(replay.status(), await replay.text()).toBe(201);
  expect(await replay.json()).toEqual(original);
  const different = await transfer(
    request,
    source.id,
    source.version,
    e2eFixtures.userSelf,
    key,
    authA,
    '其他原因',
  );
  expect(different.status()).toBe(409);
  expect(await different.json()).toMatchObject({
    code: 'CUSTOMER_IDEMPOTENCY_CONFLICT',
  });
  expect(await getCustomerMaintenanceState(source.id)).toMatchObject({
    facts: 1,
    receipts: 1,
    audits: 1,
  });
  await revokeCustomerCooperation(
    e2eFixtures.roleA,
    'CUSTOMER_RESPONSIBLE_TRANSFER',
  );
  expect(
    (
      await transfer(
        request,
        source.id,
        source.version,
        e2eFixtures.userSelf,
        key,
      )
    ).status(),
  ).toBe(404);
});

test('cooperation transitions enforce CAS and write one fact, audit and receipt per success', async ({
  request,
}) => {
  const source = await draft(request, '合作并发切换');
  const [left, right] = await Promise.all([
    maintenance(request, source.id, 'pause', source.version),
    maintenance(request, source.id, 'pause', source.version),
  ]);
  expect([left.status(), right.status()].sort()).toEqual([201, 409]);
  const paused = await getCustomerMaintenanceState(source.id);
  expect(paused.customer).toMatchObject({
    version: source.version + 1,
    cooperationStatus: 'PAUSED',
  });
  expect(paused).toMatchObject({ facts: 1, receipts: 1, audits: 1 });
  const duplicate = await maintenance(
    request,
    source.id,
    'pause',
    source.version + 1,
  );
  expect(duplicate.status()).toBe(409);
  expect(await duplicate.json()).toMatchObject({
    code: 'CUSTOMER_COOPERATION_STATE_CONFLICT',
  });
  const terminated = await maintenance(
    request,
    source.id,
    'terminate',
    source.version + 1,
  );
  expect(terminated.status(), await terminated.text()).toBe(201);
  const resumed = await maintenance(
    request,
    source.id,
    'resume',
    source.version + 2,
    randomUUID(),
    authA,
    undefined,
  );
  expect(resumed.status(), await resumed.text()).toBe(201);
  expect(await getCustomerMaintenanceState(source.id)).toMatchObject({
    customer: { version: source.version + 3, cooperationStatus: 'COOPERATING' },
    facts: 3,
    receipts: 3,
    audits: 3,
  });
});

test('audit, fact and receipt failures roll back the customer version and state', async ({
  request,
}) => {
  for (const stage of ['audit', 'fact', 'receipt'] as const) {
    const source = await draft(request, `维护回滚 ${stage}`);
    await rejectCustomerMaintenanceStage(stage);
    try {
      const failed = await maintenance(
        request,
        source.id,
        'pause',
        source.version,
      );
      expect(failed.status()).toBeGreaterThanOrEqual(500);
      expect(await getCustomerMaintenanceState(source.id)).toMatchObject({
        customer: { version: source.version, cooperationStatus: 'COOPERATING' },
        facts: 0,
        receipts: 0,
        audits: 0,
      });
    } finally {
      await allowCustomerMaintenanceStage(stage);
    }
    const committed = await maintenance(
      request,
      source.id,
      'pause',
      source.version,
    );
    expect(committed.status(), await committed.text()).toBe(201);
  }
});

test('maintenance and empty-draft deletion serialize to one valid version transition', async ({
  request,
}) => {
  await grantCustomerLifecycle(e2eFixtures.roleA);
  const source = await draft(request, '维护和删除同版本竞争');
  const [pause, deletion] = await Promise.all([
    maintenance(request, source.id, 'pause', source.version),
    request.post(`/api/v1/customers/${source.id}/delete-draft`, {
      headers: { ...authA, 'Idempotency-Key': randomUUID() },
      data: { expectedVersion: source.version, reason: '空草稿删除' },
    }),
  ]);
  expect(
    [pause.status(), deletion.status()].filter((status) => status === 201),
  ).toHaveLength(1);
  expect(
    [pause.status(), deletion.status()].filter(
      (status) => status === 404 || status === 409,
    ),
  ).toHaveLength(1);
  const state = await getCustomerMaintenanceState(source.id);
  expect(state.customer?.version).toBe(source.version + 1);
  if (pause.status() === 201) {
    expect(state).toMatchObject({
      customer: { cooperationStatus: 'PAUSED', deletedAt: null },
      facts: 1,
      receipts: 1,
      audits: 1,
    });
  } else {
    expect(state.customer?.deletedAt).not.toBeNull();
    expect(state).toMatchObject({ facts: 0, receipts: 0, audits: 0 });
  }
});

test('maintenance and routine customer edit serialize without an audit FK deadlock', async ({
  request,
}) => {
  const source = await draft(request, '维护和普通编辑同版本竞争');
  const [pause, edit] = await Promise.all([
    maintenance(request, source.id, 'pause', source.version),
    request.patch(`/api/v1/customers/${source.id}`, {
      headers: authA,
      data: { expectedVersion: source.version, name: '普通编辑成功' },
    }),
  ]);
  expect(
    [pause.status(), edit.status()].filter(
      (status) => status === 200 || status === 201,
    ),
  ).toHaveLength(1);
  expect(
    [pause.status(), edit.status()].filter((status) => status === 409),
  ).toHaveLength(1);
  const state = await getCustomerMaintenanceState(source.id);
  expect(state.customer?.version).toBe(source.version + 1);
  if (pause.status() === 201) {
    expect(state).toMatchObject({
      customer: { cooperationStatus: 'PAUSED' },
      facts: 1,
      receipts: 1,
      audits: 1,
    });
  } else {
    expect(state).toMatchObject({
      customer: { cooperationStatus: 'COOPERATING' },
      facts: 0,
      receipts: 0,
      audits: 0,
    });
  }
});

test('paused customer blocks new lead but keeps an existing lead editable', async ({
  request,
}) => {
  await resetCoreLeadE2eData();
  await grantCustomerCooperation(coreLeadFixtures.roleA);
  const leadInput = {
    customerId: coreLeadFixtures.admittedCustomer,
    rightsHolderId: coreLeadFixtures.holder,
    caseType: 'CIVIL',
    infringementTypes: ['TRADEMARK'],
    source: 'ONLINE',
    platform: 'TAOBAO',
    foundAt: '2026-09-21T02:30:00.000Z',
    shopName: '已有线索',
    needDisclose: false,
    products: [
      { title: '测试商品', quantity: 2, unitPrice: '1.50', commentCount: 3 },
    ],
    leadScreenshotContentVersionIds: [],
  };
  const existing = await request.post('/api/v1/leads', {
    headers: { ...authA, 'Idempotency-Key': randomUUID() },
    data: leadInput,
  });
  expect(existing.status(), await existing.text()).toBe(201);
  const lead: { id: string; version: number } = await existing.json();
  const customer = await request.get(
    `/api/v1/customers/${coreLeadFixtures.admittedCustomer}`,
    { headers: authA },
  );
  expect(customer.status(), await customer.text()).toBe(200);
  const detail: { version: number } = await customer.json();
  const paused = await maintenance(
    request,
    coreLeadFixtures.admittedCustomer,
    'pause',
    detail.version,
  );
  expect(paused.status(), await paused.text()).toBe(201);
  const context = await request.get('/api/v1/leads/form-context', {
    headers: authA,
  });
  expect(context.status(), await context.text()).toBe(200);
  const form: { customers: Array<{ id: string }> } = await context.json();
  expect(form.customers.map((entry) => entry.id)).not.toContain(
    coreLeadFixtures.admittedCustomer,
  );
  const blocked = await request.post('/api/v1/leads', {
    headers: { ...authA, 'Idempotency-Key': randomUUID() },
    data: { ...leadInput, shopName: '暂停后新线索' },
  });
  expect(blocked.status()).toBe(409);
  expect(await blocked.json()).toMatchObject({
    code: 'LEAD_CUSTOMER_NOT_COOPERATING',
  });
  const editContext = await request.get(
    `/api/v1/leads/${lead.id}/edit-context`,
    { headers: authA },
  );
  expect(editContext.status(), await editContext.text()).toBe(200);
  const updated = await request.patch(`/api/v1/leads/${lead.id}`, {
    headers: authA,
    data: {
      ...leadInput,
      customerId: undefined,
      rightsHolderId: undefined,
      expectedVersion: lead.version,
      shopName: '暂停后仍可维护',
    },
  });
  expect(updated.status(), await updated.text()).toBe(200);
});

test('new lead insert and pause serialize from an admitted cooperating customer', async ({
  request,
}) => {
  await resetCoreLeadE2eData();
  await grantCustomerCooperation(coreLeadFixtures.roleA);
  const customerResponse = await request.get(
    `/api/v1/customers/${coreLeadFixtures.admittedCustomer}`,
    { headers: authA },
  );
  const customer: { version: number } = await customerResponse.json();
  const [pause, lead] = await Promise.all([
    maintenance(
      request,
      coreLeadFixtures.admittedCustomer,
      'pause',
      customer.version,
    ),
    request.post('/api/v1/leads', {
      headers: { ...authA, 'Idempotency-Key': randomUUID() },
      data: {
        customerId: coreLeadFixtures.admittedCustomer,
        rightsHolderId: coreLeadFixtures.holder,
        caseType: 'CIVIL',
        infringementTypes: ['TRADEMARK'],
        source: 'ONLINE',
        platform: 'TAOBAO',
        foundAt: '2026-09-21T02:30:00.000Z',
        shopName: '并发新增线索',
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
      },
    }),
  ]);
  expect(pause.status(), await pause.text()).toBe(201);
  expect([201, 409]).toContain(lead.status());
  if (lead.status() === 409) {
    expect(await lead.json()).toMatchObject({
      code: 'LEAD_CUSTOMER_NOT_COOPERATING',
    });
  } else {
    const created: { id: string } = await lead.json();
    const existing = await request.get(`/api/v1/leads/${created.id}`, {
      headers: authA,
    });
    expect(existing.status(), await existing.text()).toBe(200);
  }
  expect(
    await getCustomerMaintenanceState(coreLeadFixtures.admittedCustomer),
  ).toMatchObject({
    customer: { cooperationStatus: 'PAUSED', version: customer.version + 1 },
    facts: 1,
    receipts: 1,
    audits: 1,
  });
});
