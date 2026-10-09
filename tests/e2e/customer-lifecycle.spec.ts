import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  allowCustomerLifecycleStage,
  createExpiredCustomerUploadDraft,
  disconnectCustomerTestDatabase,
  e2eFixtures,
  getCustomerLifecycleCounts,
  grantCustomerLifecycle,
  rejectCustomerLifecycleStage,
  resetCustomerE2eData,
  resetLocalAuthE2eData,
  revokeCustomerLifecycle,
} from '../support/customer-database.mjs';

const auth = { Authorization: `Bearer ${e2eFixtures.tokenA}` };

test.beforeEach(async () => {
  await resetCustomerE2eData();
  await grantCustomerLifecycle(e2eFixtures.roleA);
});
test.afterAll(async () => disconnectCustomerTestDatabase());

test('empty draft survives delete/restore with one fact and receipt per command', async ({
  request,
}) => {
  const created = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: 'CU004 原客户', category: '测试类别' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const draft: { id: string; version: number; category: string } =
    await created.json();
  const key = randomUUID();
  const command = { expectedVersion: draft.version, reason: '  重复建档  ' };
  const deleted = await request.post(
    `/api/v1/customers/${draft.id}/delete-draft`,
    {
      headers: { ...auth, 'Idempotency-Key': key },
      data: command,
    },
  );
  expect(deleted.status(), await deleted.text()).toBe(201);
  expect((await deleted.json()).version).toBe(draft.version + 1);
  const replay = await request.post(
    `/api/v1/customers/${draft.id}/delete-draft`,
    {
      headers: { ...auth, 'Idempotency-Key': key },
      data: command,
    },
  );
  expect(replay.status(), await replay.text()).toBe(201);
  expect(await replay.json()).toEqual(await deleted.json());
  const collision = await request.post(
    `/api/v1/customers/${draft.id}/delete-draft`,
    {
      headers: { ...auth, 'Idempotency-Key': key },
      data: { expectedVersion: draft.version, reason: '不同正文' },
    },
  );
  expect(collision.status()).toBe(409);
  expect(
    (
      await request.get(`/api/v1/customers/${draft.id}`, { headers: auth })
    ).status(),
  ).toBe(404);
  const list = await request.get('/api/v1/customers', { headers: auth });
  expect(
    ((await list.json()) as { items: Array<{ id: string }> }).items.some(
      (item) => item.id === draft.id,
    ),
  ).toBe(false);
  const trash = await request.get('/api/v1/customers/deleted-drafts', {
    headers: auth,
  });
  expect(trash.status(), await trash.text()).toBe(200);
  expect(
    (
      (await trash.json()) as {
        items: Array<{ id: string; deletionReason: string }>;
      }
    ).items,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: draft.id, deletionReason: '重复建档' }),
    ]),
  );
  await revokeCustomerLifecycle(e2eFixtures.roleA, 'CUSTOMER_DELETE_DRAFT');
  const revokedReplay = await request.post(
    `/api/v1/customers/${draft.id}/delete-draft`,
    {
      headers: { ...auth, 'Idempotency-Key': key },
      data: command,
    },
  );
  expect(revokedReplay.status()).toBe(403);
  const restoreKey = randomUUID();
  const restored = await request.post(
    `/api/v1/customers/${draft.id}/restore-draft`,
    {
      headers: { ...auth, 'Idempotency-Key': restoreKey },
      data: { expectedVersion: draft.version + 1 },
    },
  );
  expect(restored.status(), await restored.text()).toBe(201);
  expect(await restored.json()).toMatchObject({
    id: draft.id,
    category: draft.category,
    version: draft.version + 2,
  });
  expect(
    (
      await request.get(`/api/v1/customers/${draft.id}`, { headers: auth })
    ).status(),
  ).toBe(200);
  const counts = await getCustomerLifecycleCounts(draft.id);
  expect(counts).toMatchObject({ facts: 2, receipts: 2, audits: 2 });
  expect(counts.customer?.deletedAt).toBeNull();
  await grantCustomerLifecycle(e2eFixtures.roleA);
  const deletedAgain = await request.post(
    `/api/v1/customers/${draft.id}/delete-draft`,
    {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: { expectedVersion: draft.version + 2 },
    },
  );
  expect(deletedAgain.status(), await deletedAgain.text()).toBe(201);
  const oldRestoreReplay = await request.post(
    `/api/v1/customers/${draft.id}/restore-draft`,
    {
      headers: { ...auth, 'Idempotency-Key': restoreKey },
      data: { expectedVersion: draft.version + 1 },
    },
  );
  expect(await oldRestoreReplay.json()).toEqual(await restored.json());
  expect(
    (
      await request.get(`/api/v1/customers/${draft.id}`, { headers: auth })
    ).status(),
  ).toBe(404);
  expect(await getCustomerLifecycleCounts(draft.id)).toMatchObject({
    facts: 3,
    receipts: 3,
    audits: 3,
  });
});

test('expired customer upload draft blocks deletion and keeps original version', async ({
  request,
}) => {
  const created = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: 'CU004 上传历史' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const draft: { id: string; version: number } = await created.json();
  await createExpiredCustomerUploadDraft(draft.id);
  const deleted = await request.post(
    `/api/v1/customers/${draft.id}/delete-draft`,
    {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: { expectedVersion: draft.version },
    },
  );
  expect(deleted.status(), await deleted.text()).toBe(409);
  expect((await deleted.json()).code).toBe('CUSTOMER_DRAFT_HAS_ASSOCIATIONS');
  expect(await getCustomerLifecycleCounts(draft.id)).toMatchObject({
    facts: 0,
    receipts: 0,
    audits: 0,
  });
});

test('deleted identity remains reserved and recovery hint requires current restore scope', async ({
  request,
}) => {
  const first = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: 'CU004 身份甲' },
  });
  const second = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: 'CU004 身份乙' },
  });
  expect(first.status()).toBe(201);
  expect(second.status()).toBe(201);
  const original: { id: string; version: number } = await first.json();
  const rival: { id: string; version: number } = await second.json();
  const identity = {
    identityType: 'credit-code',
    identityNumber: 'CU004-RESTORE-IDENTITY',
  };
  const assigned = await request.patch(`/api/v1/customers/${original.id}`, {
    headers: auth,
    data: { expectedVersion: original.version, ...identity },
  });
  expect(assigned.status(), await assigned.text()).toBe(200);
  const deleted = await request.post(
    `/api/v1/customers/${original.id}/delete-draft`,
    {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: { expectedVersion: original.version + 1 },
    },
  );
  expect(deleted.status(), await deleted.text()).toBe(201);
  const hidden = await request.get('/api/v1/customers/duplicates', {
    headers: auth,
    params: identity,
  });
  expect((await hidden.json()).exactIdentity).toEqual([]);
  const guided = await request.patch(`/api/v1/customers/${rival.id}`, {
    headers: auth,
    data: { expectedVersion: rival.version, ...identity },
  });
  expect(guided.status()).toBe(409);
  expect(await guided.json()).toMatchObject({
    code: 'CUSTOMER_IDENTITY_RESTORE_AVAILABLE',
    details: { customerId: original.id },
  });
  await revokeCustomerLifecycle(e2eFixtures.roleA, 'CUSTOMER_RESTORE_DRAFT');
  const masked = await request.patch(`/api/v1/customers/${rival.id}`, {
    headers: auth,
    data: { expectedVersion: rival.version, ...identity },
  });
  expect(masked.status()).toBe(409);
  expect(await masked.json()).toMatchObject({
    code: 'CUSTOMER_DUPLICATE_CONFLICT',
  });
  expect(JSON.stringify(await masked.json())).not.toContain(original.id);
  const foreign = await request.post(
    `/api/v1/customers/${original.id}/restore-draft`,
    {
      headers: {
        Authorization: `Bearer ${e2eFixtures.tokenB}`,
        'Idempotency-Key': randomUUID(),
      },
      data: { expectedVersion: original.version + 2 },
    },
  );
  expect([403, 404]).toContain(foreign.status());
});

test('eligible delete races an edit and a new upload draft without a hanging association', async ({
  request,
}) => {
  const first = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: 'CU004 竞态编辑' },
  });
  expect(first.status()).toBe(201);
  const editable: { id: string; version: number } = await first.json();
  const [deleted, edited] = await Promise.all([
    request.post(`/api/v1/customers/${editable.id}/delete-draft`, {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: { expectedVersion: editable.version },
    }),
    request.patch(`/api/v1/customers/${editable.id}`, {
      headers: auth,
      data: { expectedVersion: editable.version, name: 'CU004 竞态编辑新版' },
    }),
  ]);
  expect(
    [deleted.status(), edited.status()].filter(
      (status) => status >= 200 && status < 300,
    ),
  ).toHaveLength(1);
  const editRace = await getCustomerLifecycleCounts(editable.id);
  expect(editRace.customer?.version).toBe(editable.version + 1);
  expect(editRace.facts).toBe(deleted.ok() ? 1 : 0);
  expect(editRace.receipts).toBe(editRace.facts);
  expect(editRace.audits).toBe(editRace.facts);

  const second = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: 'CU004 竞态上传' },
  });
  expect(second.status()).toBe(201);
  const uploadable: { id: string; version: number } = await second.json();
  const [deleteUpload, uploadDraft] = await Promise.allSettled([
    request.post(`/api/v1/customers/${uploadable.id}/delete-draft`, {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: { expectedVersion: uploadable.version },
    }),
    createExpiredCustomerUploadDraft(uploadable.id),
  ]);
  expect(deleteUpload.status).toBe('fulfilled');
  if (deleteUpload.status !== 'fulfilled') return;
  const deleteWon = deleteUpload.value.status() === 201;
  expect(
    deleteWon
      ? uploadDraft.status === 'rejected'
      : uploadDraft.status === 'fulfilled',
  ).toBe(true);
  if (!deleteWon) expect(deleteUpload.value.status()).toBe(409);
  const uploadRace = await getCustomerLifecycleCounts(uploadable.id);
  expect(uploadRace.customer?.version).toBe(
    uploadable.version + (deleteWon ? 1 : 0),
  );
  expect(uploadRace.facts).toBe(deleteWon ? 1 : 0);
  expect(uploadRace.receipts).toBe(uploadRace.facts);
  expect(uploadRace.audits).toBe(uploadRace.facts);
});

test('audit, fact and receipt failures roll back the entire delete before same-key retry', async ({
  request,
}) => {
  for (const stage of ['audit', 'fact', 'receipt'] as const) {
    const created = await request.post('/api/v1/customers', {
      headers: auth,
      data: { name: `CU004 回滚 ${stage}` },
    });
    expect(created.status()).toBe(201);
    const draft: { id: string; version: number } = await created.json();
    const key = randomUUID();
    try {
      await rejectCustomerLifecycleStage(stage);
      const failed = await request.post(
        `/api/v1/customers/${draft.id}/delete-draft`,
        {
          headers: { ...auth, 'Idempotency-Key': key },
          data: { expectedVersion: draft.version },
        },
      );
      expect(failed.status()).toBe(500);
      const rolledBack = await getCustomerLifecycleCounts(draft.id);
      expect(rolledBack.customer?.version).toBe(draft.version);
      expect(rolledBack.customer?.deletedAt).toBeNull();
      expect(rolledBack).toMatchObject({ facts: 0, receipts: 0, audits: 0 });
    } finally {
      await allowCustomerLifecycleStage(stage);
    }
    const retried = await request.post(
      `/api/v1/customers/${draft.id}/delete-draft`,
      {
        headers: { ...auth, 'Idempotency-Key': key },
        data: { expectedVersion: draft.version },
      },
    );
    expect(retried.status(), await retried.text()).toBe(201);
    expect(await getCustomerLifecycleCounts(draft.id)).toMatchObject({
      facts: 1,
      receipts: 1,
      audits: 1,
    });
  }
});

test('browser hides deleted draft and restores through dedicated list', async ({
  page,
  request,
}) => {
  await page.context().setExtraHTTPHeaders(auth);
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        principalType: 'INTERNAL',
        user: {
          id: e2eFixtures.userA,
          displayName: '测试用户甲',
          username: 'e2e-user-a',
        },
        department: { id: e2eFixtures.departmentA, name: 'E2E 知产部' },
        departments: [{ id: e2eFixtures.departmentA, name: 'E2E 知产部' }],
        customer: null,
        notaryOffice: null,
        authorizationRevision: 1,
        expiresAt: '2099-01-01T00:00:00.000Z',
        csrfToken: '',
      }),
    }),
  );
  const created = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: 'CU004 浏览器草稿' },
  });
  expect(created.status()).toBe(201);
  const draft: { id: string } = await created.json();
  const detail = await request.get(`/api/v1/customers/${draft.id}`, {
    headers: auth,
  });
  expect((await detail.json()).capabilities.deleteDraft).toBe(true);
  await page.goto(`/customers/${draft.id}`);
  await expect(
    page.getByRole('heading', { name: 'CU004 浏览器草稿' }),
  ).toBeVisible();
  await page.locator('[data-test="delete-draft-open"]').click();
  await page.locator('[data-test="delete-draft-submit"]').click();
  await expect(page).toHaveURL(/\/customers$/);
  await expect(page.getByText('CU004 浏览器草稿')).toHaveCount(0);
  await page.locator('[data-test="deleted-drafts-link"]').click();
  await expect(page.getByText('CU004 浏览器草稿')).toBeVisible();
  await page.getByRole('button', { name: '恢复', exact: true }).click();
  await page.locator('[data-test="restore-draft-submit"]').click();
  await expect(page.getByText('没有可恢复的草稿')).toBeVisible();
  await page.reload();
  await page.goto(`/customers/${draft.id}`);
  await expect(
    page.getByRole('heading', { name: 'CU004 浏览器草稿' }),
  ).toBeVisible();
});

test('lost delete response keeps the same request across 404, reload, and revoked permission', async ({
  page,
  request,
}) => {
  await page.context().setExtraHTTPHeaders(auth);
  let displayedUserId = e2eFixtures.userA;
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        principalType: 'INTERNAL',
        user: {
          id: displayedUserId,
          displayName: '测试用户',
          username: 'e2e-user',
        },
        department: { id: e2eFixtures.departmentA, name: 'E2E 知产部' },
        departments: [{ id: e2eFixtures.departmentA, name: 'E2E 知产部' }],
        customer: null,
        notaryOffice: null,
        authorizationRevision: 1,
        expiresAt: '2099-01-01T00:00:00.000Z',
        csrfToken: '',
      }),
    }),
  );
  const created = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: 'CU004 丢响应草稿' },
  });
  expect(created.status()).toBe(201);
  const draft: { id: string } = await created.json();
  let intercepted = false;
  await page.route(
    `**/api/v1/customers/${draft.id}/delete-draft`,
    async (route) => {
      if (intercepted) return route.continue();
      intercepted = true;
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      await route.abort('failed');
    },
  );
  await page.goto(`/customers/${draft.id}`);
  await page.locator('[data-test="delete-draft-open"]').click();
  await page.locator('[data-test="delete-draft-submit"]').click();
  await expect(
    page.getByText('结果尚不确定。重试会使用原请求和同一幂等键。'),
  ).toBeVisible();
  const original = await page.evaluate(() => {
    const key = Object.keys(globalThis.sessionStorage).find((entry) =>
      entry.startsWith('customer-draft-command:'),
    );
    return key ? globalThis.sessionStorage.getItem(key) : null;
  });
  expect(original).not.toBeNull();
  await revokeCustomerLifecycle(e2eFixtures.roleA, 'CUSTOMER_DELETE_DRAFT');
  await page.reload();
  await expect(
    page.locator('[data-test="pending-delete-after-404"]'),
  ).toBeVisible();
  await page.getByRole('button', { name: '按原请求重试' }).click();
  await expect(
    page.locator('[data-test="pending-delete-after-404"]'),
  ).toBeVisible();
  expect(
    await page.evaluate(() => {
      const key = Object.keys(globalThis.sessionStorage).find((entry) =>
        entry.startsWith('customer-draft-command:'),
      );
      return key ? globalThis.sessionStorage.getItem(key) : null;
    }),
  ).toBe(original);
  displayedUserId = e2eFixtures.userB;
  await page.reload();
  await expect(
    page.locator('[data-test="pending-delete-after-404"]'),
  ).toHaveCount(0);
  displayedUserId = e2eFixtures.userA;
  await page.reload();
  await expect(
    page.locator('[data-test="pending-delete-after-404"]'),
  ).toBeVisible();
  await grantCustomerLifecycle(e2eFixtures.roleA);
  await page.getByRole('button', { name: '按原请求重试' }).click();
  await expect(page).toHaveURL(/\/customers$/);
  expect(
    await page.evaluate(() =>
      Object.keys(globalThis.sessionStorage).filter((entry) =>
        entry.startsWith('customer-draft-command:'),
      ),
    ),
  ).toEqual([]);
});

test('lost restore response remains retryable when trash is empty', async ({
  page,
  request,
}) => {
  await page.context().setExtraHTTPHeaders(auth);
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        principalType: 'INTERNAL',
        user: {
          id: e2eFixtures.userA,
          displayName: '测试用户甲',
          username: 'e2e-user-a',
        },
        department: { id: e2eFixtures.departmentA, name: 'E2E 知产部' },
        departments: [{ id: e2eFixtures.departmentA, name: 'E2E 知产部' }],
        customer: null,
        notaryOffice: null,
        authorizationRevision: 1,
        expiresAt: '2099-01-01T00:00:00.000Z',
        csrfToken: '',
      }),
    }),
  );
  const created = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: 'CU004 丢恢复响应' },
  });
  expect(created.status()).toBe(201);
  const draft: { id: string; version: number } = await created.json();
  const deleted = await request.post(
    `/api/v1/customers/${draft.id}/delete-draft`,
    {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: { expectedVersion: draft.version },
    },
  );
  expect(deleted.status()).toBe(201);
  let intercepted = false;
  await page.route(
    `**/api/v1/customers/${draft.id}/restore-draft`,
    async (route) => {
      if (intercepted) return route.continue();
      intercepted = true;
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      await route.abort('failed');
    },
  );
  await page.goto('/customers/deleted-drafts');
  await page.getByRole('button', { name: '恢复', exact: true }).click();
  await page.locator('[data-test="restore-draft-submit"]').click();
  await expect(
    page.getByText('结果尚不确定。只能按原请求重试。'),
  ).toBeVisible();
  const original = await page.evaluate(() => {
    const key = Object.keys(globalThis.sessionStorage).find((entry) =>
      entry.startsWith('customer-draft-command:'),
    );
    return key ? globalThis.sessionStorage.getItem(key) : null;
  });
  expect(original).not.toBeNull();
  await page.reload();
  await expect(
    page.locator('[data-test="pending-restore-after-empty"]'),
  ).toBeVisible();
  expect(
    await page.evaluate(() => {
      const key = Object.keys(globalThis.sessionStorage).find((entry) =>
        entry.startsWith('customer-draft-command:'),
      );
      return key ? globalThis.sessionStorage.getItem(key) : null;
    }),
  ).toBe(original);
  await page.getByRole('button', { name: '按原请求重试' }).click();
  await expect(
    page.locator('[data-test="pending-restore-after-empty"]'),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      Object.keys(globalThis.sessionStorage).filter((entry) =>
        entry.startsWith('customer-draft-command:'),
      ),
    ),
  ).toEqual([]);
  expect(
    (
      await request.get(`/api/v1/customers/${draft.id}`, { headers: auth })
    ).status(),
  ).toBe(200);
});

test('password cookie and CSRF carry delete, unknown retry, trash and restore across relogin', async ({
  page,
}) => {
  const credentials = await resetLocalAuthE2eData();
  const localRole = '30000000-0000-4000-8000-000000000010';
  await grantCustomerLifecycle(localRole, 'DEPARTMENT');
  await page.goto('/customers');
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await page.getByLabel('用户名').fill(credentials.username);
  await page.getByLabel('密码').fill(credentials.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/);
  await page.getByRole('link', { name: '新建客户' }).click();
  await page.getByLabel('客户名称').fill('真实 Cookie 生命周期');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(
    page.getByRole('heading', { name: '真实 Cookie 生命周期' }),
  ).toBeVisible();
  const detailUrl = page.url();
  const customerId = detailUrl.split('/').at(-1)!;
  let firstRequest:
    | {
        key: string | undefined;
        csrf: string | undefined;
        cookie: string | undefined;
        authorization: string | undefined;
      }
    | undefined;
  let intercepted = false;
  await page.route(
    `**/api/v1/customers/${customerId}/delete-draft`,
    async (route) => {
      if (intercepted) return route.continue();
      intercepted = true;
      const headers = route.request().headers();
      firstRequest = {
        key: headers['idempotency-key'],
        csrf: headers['x-csrf-token'],
        cookie: headers.cookie,
        authorization: headers.authorization,
      };
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      await route.abort('failed');
    },
  );
  await page.locator('[data-test="delete-draft-open"]').click();
  await page.locator('[data-test="delete-draft-submit"]').click();
  await expect(
    page.getByText('结果尚不确定。重试会使用原请求和同一幂等键。'),
  ).toBeVisible();
  expect(firstRequest?.key).toBeTruthy();
  expect(firstRequest?.csrf).toBeTruthy();
  expect(firstRequest?.cookie).toBeTruthy();
  expect(firstRequest?.authorization).toBeUndefined();
  await page.reload();
  await expect(
    page.locator('[data-test="pending-delete-after-404"]'),
  ).toBeVisible();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto(detailUrl);
  await page.getByLabel('用户名').fill(credentials.username);
  await page.getByLabel('密码').fill(credentials.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(
    page.locator('[data-test="pending-delete-after-404"]'),
  ).toBeVisible();
  await revokeCustomerLifecycle(localRole, 'CUSTOMER_DELETE_DRAFT');
  const revokedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customerId}/delete-draft`) &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '按原请求重试' }).click();
  expect((await revokedResponse).status()).toBe(403);
  await expect(
    page.locator('[data-test="pending-delete-after-404"]'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '按原请求重试' }),
  ).toBeEnabled();
  await grantCustomerLifecycle(localRole, 'DEPARTMENT');
  const replay = page.waitForRequest(
    (request) =>
      request.url().endsWith(`/customers/${customerId}/delete-draft`) &&
      request.method() === 'POST',
  );
  await page.getByRole('button', { name: '按原请求重试' }).click();
  const replayRequest = await replay;
  expect(replayRequest.headers()['idempotency-key']).toBe(firstRequest?.key);
  expect(replayRequest.headers()['x-csrf-token']).toBeTruthy();
  await expect(page).toHaveURL(/\/customers$/);
  await page.locator('[data-test="deleted-drafts-link"]').click();
  await expect(page.getByText('真实 Cookie 生命周期')).toBeVisible();
  await page.getByRole('button', { name: '恢复', exact: true }).click();
  const restoreRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith(`/customers/${customerId}/restore-draft`) &&
      request.method() === 'POST',
  );
  await page.locator('[data-test="restore-draft-submit"]').click();
  const restoredCommand = await restoreRequest;
  expect(restoredCommand.headers()['x-csrf-token']).toBeTruthy();
  expect(restoredCommand.headers().authorization).toBeUndefined();
  await expect(page.getByText('没有可恢复的草稿')).toBeVisible();
  await page.reload();
  await page.goto(detailUrl);
  await expect(
    page.getByRole('heading', { name: '真实 Cookie 生命周期' }),
  ).toBeVisible();
});

test('trash page reaches and restores the 21st deleted draft and identity recovery target', async ({
  page,
  request,
}) => {
  await page.context().setExtraHTTPHeaders(auth);
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        principalType: 'INTERNAL',
        user: {
          id: e2eFixtures.userA,
          displayName: '测试用户甲',
          username: 'e2e-user-a',
        },
        department: { id: e2eFixtures.departmentA, name: 'E2E 知产部' },
        departments: [{ id: e2eFixtures.departmentA, name: 'E2E 知产部' }],
        customer: null,
        notaryOffice: null,
        authorizationRevision: 1,
        expiresAt: '2099-01-01T00:00:00.000Z',
        csrfToken: '',
      }),
    }),
  );
  const originalCreate = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: 'CU004 第21条旧项', category: '保留资料' },
  });
  expect(originalCreate.status()).toBe(201);
  const original: { id: string; version: number } = await originalCreate.json();
  const identity = {
    identityType: 'credit-code',
    identityNumber: 'CU004-PAGE-21',
  };
  const assigned = await request.patch(`/api/v1/customers/${original.id}`, {
    headers: auth,
    data: { expectedVersion: original.version, ...identity },
  });
  expect(assigned.status()).toBe(200);
  const firstDelete = await request.post(
    `/api/v1/customers/${original.id}/delete-draft`,
    {
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      data: { expectedVersion: original.version + 1 },
    },
  );
  expect(firstDelete.status()).toBe(201);
  for (let index = 0; index < 20; index += 1) {
    const created = await request.post('/api/v1/customers', {
      headers: auth,
      data: { name: `CU004 后续 ${index}` },
    });
    expect(created.status()).toBe(201);
    const draft: { id: string; version: number } = await created.json();
    const deleted = await request.post(
      `/api/v1/customers/${draft.id}/delete-draft`,
      {
        headers: { ...auth, 'Idempotency-Key': randomUUID() },
        data: { expectedVersion: draft.version },
      },
    );
    expect(deleted.status()).toBe(201);
  }
  await page.goto('/customers/deleted-drafts');
  await expect(page.locator('[data-test="deleted-drafts-page"]')).toContainText(
    '第 1 / 2 页',
  );
  await expect(page.getByText('CU004 第21条旧项')).toHaveCount(0);
  await page.locator('[data-test="deleted-drafts-next"]').click();
  await expect(page.locator('[data-test="deleted-drafts-page"]')).toContainText(
    '第 2 / 2 页',
  );
  await expect(page.getByText('CU004 第21条旧项')).toBeVisible();
  const rivalCreate = await request.post('/api/v1/customers', {
    headers: auth,
    data: { name: 'CU004 冲突新项' },
  });
  const rival: { id: string; version: number } = await rivalCreate.json();
  const guided = await request.patch(`/api/v1/customers/${rival.id}`, {
    headers: auth,
    data: { expectedVersion: rival.version, ...identity },
  });
  expect(guided.status()).toBe(409);
  const conflict: { details: { customerId: string } } = await guided.json();
  expect(conflict.details.customerId).toBe(original.id);
  await page.goto(
    `/customers/deleted-drafts?focus=${conflict.details.customerId}`,
  );
  await expect(page.locator('[data-test="deleted-drafts-page"]')).toContainText(
    '第 2 / 2 页',
  );
  await expect(
    page.locator('[data-test="restore-draft-confirm"]'),
  ).toContainText(original.id);
  const restoreResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${original.id}/restore-draft`) &&
      response.request().method() === 'POST',
  );
  await page.locator('[data-test="restore-draft-submit"]').click();
  expect((await restoreResponse).status()).toBe(201);
  const restored = await request.get(`/api/v1/customers/${original.id}`, {
    headers: auth,
  });
  expect(restored.status()).toBe(200);
  expect(await restored.json()).toMatchObject({
    id: original.id,
    category: '保留资料',
    version: original.version + 3,
  });
});
