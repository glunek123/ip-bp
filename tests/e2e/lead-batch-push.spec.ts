import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  createLeadBatchPushDatabaseSupport,
  leadBatchPushLimits,
} from '../support/lead-batch-push-database.mjs';

type ActorKind = 'main' | 'terminal';
type Lead = {
  id: string;
  businessNo: string;
  customerId: string;
  status: string;
  version: number;
  products: Array<{ id: string }>;
};
type BatchResult = {
  items: Array<{ id: string; status: string; version: number }>;
};
type ApiError = {
  code?: string;
  details?: { failures?: Array<{ index: number; code: string }> };
};
type Session = { csrfToken: string };

const support = createLeadBatchPushDatabaseSupport();
const pushHeaders = (session: Session, key: string) => ({
  'X-CSRF-Token': session.csrfToken,
  'Idempotency-Key': key,
});

let runtime: Awaited<ReturnType<typeof support.prepare>>;
let createdLeadCount = 0;
const successfulBatchItems = new Map<string, number>();

test.beforeAll(async () => {
  // Missing data, credentials, migration proof or the protected runner is a hard BLOCKED error.
  runtime = await support.prepare();
});

function apiOrigin(): string {
  const value: unknown = test.info().project.use.baseURL;
  if (typeof value !== 'string')
    throw new Error(
      'UXQ03 batch push BLOCKED: Playwright baseURL is unavailable',
    );
  const origin = new URL(value).origin;
  if (!['http://127.0.0.1:3101', 'http://127.0.0.1:5174'].includes(origin))
    throw new Error(
      'UXQ03 batch push BLOCKED: API origin is outside the protected R2 runtime',
    );
  return origin;
}

async function login(
  request: APIRequestContext,
  kind: ActorKind,
): Promise<Session> {
  const credentials = runtime.credentials[kind];
  const response = await request.post('/api/v1/auth/login', {
    headers: { Origin: apiOrigin() },
    data: credentials,
  });
  expect(response.status()).toBe(200);
  const body: unknown = await response.json();
  if (
    body === null ||
    typeof body !== 'object' ||
    !('csrfToken' in body) ||
    typeof body.csrfToken !== 'string'
  )
    throw new Error(
      'UXQ03 batch push BLOCKED: login response has no CSRF token',
    );
  return { csrfToken: body.csrfToken };
}

async function createLead(
  request: APIRequestContext,
  session: Session,
  actorKind: ActorKind = 'main',
): Promise<Lead> {
  const suffix = randomUUID();
  const createKey = randomUUID();
  if (actorKind === 'main') await support.beginLeadCreation(createKey);
  const response = await request.post('/api/v1/leads', {
    headers: pushHeaders(session, createKey),
    data: {
      customerId: runtime.fixture.customerId,
      rightsHolderId: runtime.fixture.rightsHolderId,
      caseType: 'CIVIL',
      infringementTypes: ['TRADEMARK'],
      source: 'ONLINE',
      platform: 'TAOBAO',
      foundAt: '2026-10-16T03:00:00.000Z',
      shopName: `UXQ03 batch ${suffix}`,
      needDisclose: false,
      products: [
        {
          title: `UXQ03 product ${suffix}`,
          quantity: 1,
          unitPrice: '1.00',
          commentCount: 0,
        },
      ],
      leadScreenshotContentVersionIds: [],
    },
  });
  expect(response.status()).toBe(201);
  const lead: Lead = await response.json();
  if (actorKind === 'main')
    await support.registerCreatedLead(createKey, lead.id);
  expect(lead).toMatchObject({
    status: 'WAITING_PUSH',
    version: 1,
    customerId: runtime.fixture.customerId,
  });
  expect(lead.products.length).toBeGreaterThan(0);
  return lead;
}

async function createLeads(
  request: APIRequestContext,
  session: Session,
  count: number,
  actorKind: ActorKind = 'main',
): Promise<Lead[]> {
  if (
    count < 1 ||
    createdLeadCount + count > leadBatchPushLimits.maxNewLeads ||
    createdLeadCount + count > leadBatchPushLimits.maxCreateReceipts ||
    createdLeadCount + count > leadBatchPushLimits.maxLeadCreateAudits
  )
    throw new Error(
      'UXQ03 batch push BLOCKED: fixture exceeds the approved lead budget',
    );
  createdLeadCount += count;
  return Promise.all(
    Array.from({ length: count }, () =>
      createLead(request, session, actorKind),
    ),
  );
}

async function postBatch(
  request: APIRequestContext,
  session: Session,
  key: string,
  items: Array<{ leadId: string; expectedVersion: number }>,
) {
  const response = await request.post('/api/v1/leads/batch-push', {
    headers: pushHeaders(session, key),
    data: { items },
  });
  if (response.status() === 201 && !successfulBatchItems.has(key)) {
    successfulBatchItems.set(key, items.length);
    const successfulItems = [...successfulBatchItems.values()];
    if (
      successfulItems.length > leadBatchPushLimits.maxBatchReceipts ||
      successfulItems.reduce((sum, itemCount) => sum + itemCount, 0) >
        leadBatchPushLimits.maxLeadPushAudits
    )
      throw new Error(
        'UXQ03 batch push BLOCKED: fixture exceeds the approved receipt or audit budget',
      );
  }
  return response;
}

const itemsFor = (leads: ReadonlyArray<Lead>) =>
  leads.map(({ id, version }) => ({ leadId: id, expectedVersion: version }));

async function loginMain(request: APIRequestContext) {
  return login(request, 'main');
}

test('pushes a selected two-lead batch atomically and returns the original order', async ({
  request,
}) => {
  const session = await loginMain(request);
  const leads = await createLeads(request, session, 2);
  const key = randomUUID();
  const before = await support.readFacts(
    leads.map((lead) => lead.id),
    runtime.manifest.main.userId,
    [key],
  );
  const response = await postBatch(request, session, key, itemsFor(leads));
  expect(response.status()).toBe(201);
  const result: BatchResult = await response.json();
  expect(result.items.map((item) => item.id)).toEqual(
    leads.map((lead) => lead.id),
  );
  expect(
    result.items.every(
      (item) => item.status === 'WAITING_REVIEW' && item.version === 2,
    ),
  ).toBe(true);
  const after = await support.readFacts(
    leads.map((lead) => lead.id),
    runtime.manifest.main.userId,
    [key],
  );
  expect(after.leads).toHaveLength(2);
  expect(
    after.leads.every(
      (lead) => lead.status === 'WAITING_REVIEW' && lead.version === 2,
    ),
  ).toBe(true);
  expect(after.receipts).toHaveLength(1);
  expect(after.receipts[0]).toMatchObject({
    idempotency_key: key,
    original_request: { items: itemsFor(leads) },
  });
  expect(
    after.audits
      .filter((audit) => audit.action === 'lead.pushed')
      .reduce((sum, audit) => sum + audit.count, 0),
  ).toBe(2);
  expect(before.receipts).toHaveLength(0);
});

test('accepts exactly 20 items and rejects a 21-item request without adding a receipt', async ({
  request,
}) => {
  const session = await loginMain(request);
  const leads = await createLeads(
    request,
    session,
    leadBatchPushLimits.maxItemsPerBatch,
  );
  const key = randomUUID();
  const response = await postBatch(request, session, key, itemsFor(leads));
  expect(response.status()).toBe(201);
  const result: BatchResult = await response.json();
  expect(result.items).toHaveLength(20);
  const overLimitKey = randomUUID();
  const overLimit = await postBatch(request, session, overLimitKey, [
    ...itemsFor(leads),
    itemsFor(leads)[0]!,
  ]);
  expect(overLimit.status()).toBe(400);
  const facts = await support.readFacts(
    leads.map((lead) => lead.id),
    runtime.manifest.main.userId,
    [key, overLimitKey],
  );
  expect(facts.receipts).toHaveLength(1);
  expect(
    facts.leads.every(
      (lead) => lead.status === 'WAITING_REVIEW' && lead.version === 2,
    ),
  ).toBe(true);
  expect(
    facts.audits
      .filter((audit) => audit.action === 'lead.pushed')
      .reduce((sum, audit) => sum + audit.count, 0),
  ).toBe(20);
});

test('rejects one stale item with zero batch writes and no receipt', async ({
  request,
}) => {
  const session = await loginMain(request);
  const leads = await createLeads(request, session, 2);
  const key = randomUUID();
  const body = itemsFor(leads);
  body[1] = { ...body[1]!, expectedVersion: 2 };
  const before = await support.readFacts(
    leads.map((lead) => lead.id),
    runtime.manifest.main.userId,
    [key],
  );
  const response = await postBatch(request, session, key, body);
  expect(response.status()).toBe(409);
  const error: ApiError = await response.json();
  expect(error.code).toBe('BATCH_PUSH_REJECTED');
  expect(error.details?.failures).toContainEqual({
    index: 1,
    code: 'VERSION_CONFLICT',
  });
  const after = await support.readFacts(
    leads.map((lead) => lead.id),
    runtime.manifest.main.userId,
    [key],
  );
  expect(after).toEqual(before);
});

test('concurrent identical requests share one success receipt and one audit per lead', async ({
  request,
}) => {
  const session = await loginMain(request);
  const leads = await createLeads(request, session, 2);
  const key = randomUUID();
  const body = itemsFor(leads);
  const [first, second] = await Promise.all([
    postBatch(request, session, key, body),
    postBatch(request, session, key, body),
  ]);
  expect([first.status(), second.status()]).toEqual([201, 201]);
  const firstResult: BatchResult = await first.json();
  const secondResult: BatchResult = await second.json();
  expect(secondResult).toEqual(firstResult);
  const facts = await support.readFacts(
    leads.map((lead) => lead.id),
    runtime.manifest.main.userId,
    [key],
  );
  expect(facts.receipts).toHaveLength(1);
  expect(
    facts.audits
      .filter((audit) => audit.action === 'lead.pushed')
      .reduce((sum, audit) => sum + audit.count, 0),
  ).toBe(2);
});

test('recovers a discarded response with the exact original body and key after the leads advance stage', async ({
  request,
}) => {
  const session = await loginMain(request);
  const leads = await createLeads(request, session, 2);
  const key = randomUUID();
  const body = itemsFor(leads);
  // Deliberately discard the first client response; persisted receipt is the recovery source.
  await postBatch(request, session, key, body);
  const stored = await support.readFacts(
    leads.map((lead) => lead.id),
    runtime.manifest.main.userId,
    [key],
  );
  expect(stored.receipts).toHaveLength(1);
  expect(
    stored.leads.every(
      (lead) => lead.status === 'WAITING_REVIEW' && lead.version === 2,
    ),
  ).toBe(true);
  const replay = await postBatch(request, session, key, body);
  expect(replay.status()).toBe(201);
  expect(await replay.json()).toEqual(stored.receipts[0]!.result_snapshot);
  const after = await support.readFacts(
    leads.map((lead) => lead.id),
    runtime.manifest.main.userId,
    [key],
  );
  expect(after).toEqual(stored);
});

test('rolls back every lead and audit when the exact batch receipt insert fails', async ({
  request,
}) => {
  const session = await loginMain(request);
  const leads = await createLeads(request, session, 2);
  const key = randomUUID();
  const before = await support.readFacts(
    leads.map((lead) => lead.id),
    runtime.manifest.main.userId,
    [key],
  );
  await support.withReceiptInsertFailure(
    {
      actorUserId: runtime.manifest.main.userId,
      departmentId: runtime.fixture.departmentId,
      idempotencyKey: key,
      leadIds: leads.map((lead) => lead.id),
    },
    async () => {
      const response = await postBatch(request, session, key, itemsFor(leads));
      expect(response.status()).toBe(500);
    },
  );
  const after = await support.readFacts(
    leads.map((lead) => lead.id),
    runtime.manifest.main.userId,
    [key],
  );
  expect(after).toEqual(before);
});

test('keeps the successful receipt but refuses replay after revoking only the terminal actor assignment', async ({
  request,
}) => {
  const session = await login(request, 'terminal');
  const leads = await createLeads(request, session, 2, 'terminal');
  const key = randomUUID();
  const body = itemsFor(leads);
  const success = await postBatch(request, session, key, body);
  expect(success.status()).toBe(201);
  const committed = await support.readFacts(
    leads.map((lead) => lead.id),
    runtime.manifest.terminal.userId,
    [key],
  );
  expect(committed.receipts).toHaveLength(1);
  await support.revokeTerminalAssignment(runtime.manifest);
  const afterRevoke = await postBatch(request, session, key, body);
  expect([403, 409]).toContain(afterRevoke.status());
  const error: ApiError = await afterRevoke.json();
  if (afterRevoke.status() === 409) {
    expect(error.code).toBe('BATCH_PUSH_REJECTED');
    expect(error.details?.failures).toContainEqual({
      index: 0,
      code: 'NOT_AVAILABLE',
    });
  }
  const after = await support.readFacts(
    leads.map((lead) => lead.id),
    runtime.manifest.terminal.userId,
    [key],
  );
  expect(after).toEqual(committed);
});

test('does not disclose a non-existent lead as an available batch target', async ({
  request,
}) => {
  const session = await loginMain(request);
  const key = randomUUID();
  const before = await support.readFacts([], runtime.manifest.main.userId, [
    key,
  ]);
  const response = await postBatch(request, session, key, [
    { leadId: randomUUID(), expectedVersion: 1 },
  ]);
  expect(response.status()).toBe(409);
  const error: ApiError = await response.json();
  expect(error.code).toBe('BATCH_PUSH_REJECTED');
  expect(error.details?.failures).toContainEqual({
    index: 0,
    code: 'NOT_AVAILABLE',
  });
  const after = await support.readFacts([], runtime.manifest.main.userId, [
    key,
  ]);
  expect(after).toEqual(before);
});
