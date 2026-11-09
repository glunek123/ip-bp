import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  coreLeadFixtures,
  resetCoreLeadE2eData,
  disconnectCoreLeadTestDatabase,
  countNotaryMatters,
} from '../support/core-lead-database.mjs';

const operator = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const jpg = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46,
]);

test.beforeEach(async () => {
  await resetCoreLeadE2eData();
});
test.afterAll(async () => {
  await disconnectCoreLeadTestDatabase();
});

async function uploadScreenshot(request: APIRequestContext, ownerId?: string) {
  const draft = await request.post('/api/v1/materials/upload-drafts', {
    headers: operator,
    data: {
      ownerType: 'LEAD_DRAFT',
      ...(ownerId ? { ownerId } : {}),
      category: 'LEAD_SCREENSHOT',
      purpose: 'LEAD_SCREENSHOT',
      originalFilename: `screenshot-${randomUUID()}.jpg`,
      declaredMimeType: 'image/jpeg',
    },
  });
  expect(draft.status(), await draft.text()).toBe(201);
  const { id, ownerId: reservedLeadId } = (await draft.json()) as {
    id: string;
    ownerId: string;
  };
  const uploaded = await request.put(
    `/api/v1/materials/upload-drafts/${id}/content`,
    {
      headers: { ...operator, 'Content-Type': 'application/octet-stream' },
      data: jpg,
    },
  );
  expect(uploaded.status(), await uploaded.text()).toBe(200);
  const { contentVersionId } = (await uploaded.json()) as {
    contentVersionId: string;
  };
  return { reservedLeadId, contentVersionId };
}

async function reviewedLead(
  request: APIRequestContext,
  csrf: string,
  screenshots = false,
) {
  const associated = screenshots ? await uploadScreenshot(request) : null;
  const legacy = associated
    ? await uploadScreenshot(request, associated.reservedLeadId)
    : null;
  const created = await request.post('/api/v1/leads', {
    headers: { ...operator, 'Idempotency-Key': randomUUID() },
    data: {
      ...(associated ? { reservedLeadId: associated.reservedLeadId } : {}),
      customerId: coreLeadFixtures.admittedCustomer,
      rightsHolderId: coreLeadFixtures.holder,
      caseType: 'CIVIL',
      infringementTypes: ['TRADEMARK'],
      source: 'ONLINE',
      platform: 'TAOBAO',
      foundAt: '2026-11-08T02:30:00.000Z',
      shopName: `自动移交-${randomUUID().slice(0, 8)}`,
      needDisclose: false,
      products: [
        {
          title: '关联截图商品',
          quantity: 1,
          unitPrice: '10.00',
          commentCount: 0,
          ...(associated
            ? { screenshotContentVersionIds: [associated.contentVersionId] }
            : {}),
        },
        {
          title: '无截图商品',
          quantity: 1,
          unitPrice: '20.00',
          commentCount: 0,
        },
      ],
      leadScreenshotContentVersionIds: legacy ? [legacy.contentVersionId] : [],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const pushed = await request.post(`/api/v1/leads/${id}/push`, {
    headers: { ...operator, 'Idempotency-Key': randomUUID() },
    data: { expectedVersion: 1 },
  });
  expect(pushed.status(), await pushed.text()).toBe(201);
  const reviewed = await request.post(`/api/v1/client/leads/${id}/reviews`, {
    headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': randomUUID() },
    data: { result: 'INFRINGEMENT', expectedVersion: 2 },
  });
  expect(reviewed.status(), await reviewed.text()).toBe(201);
  return { id, associated, legacy };
}

test('auto handoff freezes every product and only associated screenshot, then accepts real evidence', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const username = `notary-client-${randomUUID().slice(0, 8)}`;
  const password = 'notary client password 2026';
  const account = await request.post(
    `/api/v1/customers/${coreLeadFixtures.admittedCustomer}/client-accounts`,
    {
      headers: operator,
      data: { displayName: '自动移交审核员', username, password },
    },
  );
  expect(account.status(), await account.text()).toBe(201);
  const login = await request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://127.0.0.1:5174' },
    data: { username, password },
  });
  expect(login.status(), await login.text()).toBe(200);
  const { csrfToken } = (await login.json()) as { csrfToken: string };
  const officeResponse = await request.post('/api/v1/notary-offices', {
    headers: operator,
    data: { name: `自动移交公证处-${randomUUID().slice(0, 8)}` },
  });
  expect(officeResponse.status(), await officeResponse.text()).toBe(201);
  const { id: notaryOfficeId } = (await officeResponse.json()) as {
    id: string;
  };
  const first = await reviewedLead(request, csrfToken, true);
  const key = randomUUID();
  const confirm = () =>
    request.post(`/api/v1/leads/${first.id}/notary-matters/confirm`, {
      headers: { ...operator, 'Idempotency-Key': key },
      data: { notaryOfficeId, expectedVersion: 3 },
    });
  const response = await confirm();
  expect(response.status(), await response.text()).toBe(201);
  const result = (await response.json()) as {
    id: string;
    selectedProductIds: string[];
    selectedContentVersionIds: string[];
    evidenceMode: null;
    batchPurpose: null;
  };
  expect(result.selectedProductIds).toHaveLength(2);
  expect(result.selectedContentVersionIds).toEqual([
    first.associated!.contentVersionId,
  ]);
  expect(result.selectedContentVersionIds).not.toContain(
    first.legacy!.contentVersionId,
  );
  expect(result.evidenceMode).toBeNull();
  expect(result.batchPurpose).toBeNull();
  expect((await confirm()).status()).toBe(201);
  expect(await countNotaryMatters(first.id)).toBe(1);
  const detail = await request.get(`/api/v1/notary-matters/${result.id}`, {
    headers: operator,
  });
  expect(detail.status(), await detail.text()).toBe(200);
  expect((await detail.json()).selectedContentVersionIds).toEqual(
    result.selectedContentVersionIds,
  );
  const evidence = await request.post(
    `/api/v1/notary-matters/${result.id}/evidence`,
    {
      headers: { ...operator, 'Idempotency-Key': randomUUID() },
      data: {
        evidenceAt: '2026-11-08',
        sampleFeeState: 'PENDING',
        logistics: [{ companyState: 'NONE', trackingState: 'NONE' }],
        expectedVersion: 1,
      },
    },
  );
  expect(evidence.status(), await evidence.text()).toBe(201);
  expect((await evidence.json()).stage).toBe('WAITING_UNBOX');

  const second = await reviewedLead(request, csrfToken);
  const third = await reviewedLead(request, csrfToken);
  const batchKey = randomUUID();
  const items = [
    { leadId: second.id, expectedVersion: 3 },
    { leadId: third.id, expectedVersion: 3 },
  ];
  const batch = (requestItems: typeof items) =>
    request.post('/api/v1/leads/notary-matters/batch-confirm', {
      headers: { ...operator, 'Idempotency-Key': batchKey },
      data: { notaryOfficeId, items: requestItems },
    });
  const failed = await batch([
    { leadId: second.id, expectedVersion: 3 },
    { leadId: third.id, expectedVersion: 2 },
  ]);
  expect(failed.status()).toBe(409);
  expect(await countNotaryMatters(second.id)).toBe(0);
  expect(await countNotaryMatters(third.id)).toBe(0);
  const successful = await batch(items);
  expect(successful.status(), await successful.text()).toBe(201);
  expect((await successful.json()).items).toHaveLength(2);
  expect((await batch(items)).status()).toBe(201);
  expect(await countNotaryMatters(second.id)).toBe(1);
  expect(await countNotaryMatters(third.id)).toBe(1);
});
