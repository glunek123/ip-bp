import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  coreLeadFixtures,
  resetCoreLeadE2eData,
  setGrant,
  setInternalAccountActive,
} from '../support/core-lead-database.mjs';
import {
  allowBatchInjectedFailures,
  batchAuditCount,
  batchMatterState,
  batchReceiptCount,
  corruptBatchReceipt,
  createBatchWaitingReturnMatter,
  disconnectBatchDatabase,
  rejectBatchAuditWrites,
  rejectBatchReceiptWrites,
} from '../support/notary-return-archive-batch-database.mjs';

const authA = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const authB = { Authorization: `Bearer ${coreLeadFixtures.tokenB}` };
const authSelf = { Authorization: `Bearer ${coreLeadFixtures.tokenSelf}` };
const keep = (matterId: string, expectedVersion = 5) => ({
  matterId,
  returnChoice: 'KEEP',
  archiveReason: '客户确认保留',
  expectedVersion,
});
function submit(
  request: APIRequestContext,
  items: Array<Record<string, unknown>>,
  key = randomUUID(),
  headers = authA,
) {
  return request.post('/api/v1/notary-matters/return-archive-batches', {
    headers: { ...headers, 'Idempotency-Key': key },
    data: { items },
  });
}
async function assertUnchanged(ids: string[]) {
  for (const id of ids) {
    const state = await batchMatterState(id);
    expect(state).toMatchObject({
      matter: { stage: 'WAITING_RETURN', version: 5 },
      archives: 0,
      amounts: [],
      audits: 0,
    });
  }
  expect(await batchReceiptCount()).toBe(0);
  expect(await batchAuditCount()).toBe(0);
}

test.beforeEach(async () => {
  await resetCoreLeadE2eData();
});
test.afterAll(async () => {
  await allowBatchInjectedFailures();
  await disconnectBatchDatabase();
});

test('two different fee facts commit atomically and exact reordered replay validates immutable snapshots', async ({
  request,
}) => {
  const first = await createBatchWaitingReturnMatter({
    sampleFeeAmount: '100.00',
  });
  const second = await createBatchWaitingReturnMatter({
    sampleFeeAmount: '200.00',
  });
  const items = [
    {
      matterId: first.matterId,
      returnChoice: 'RETURN',
      refund: { state: 'KNOWN', amount: '60.25', partyKind: 'MERCHANT' },
      freight: {
        state: 'KNOWN',
        amount: '12.00',
        partyKind: 'OTHER',
        partyName: '快递公司',
      },
      archiveReason: '退货',
      expectedVersion: 5,
    },
    {
      matterId: second.matterId,
      returnChoice: 'REFUND_ONLY',
      refund: { state: 'PENDING' },
      archiveReason: '仅退款，金额待定',
      expectedVersion: 5,
    },
  ];
  const key = randomUUID();
  const created = await submit(request, items, key);
  expect(created.status(), await created.text()).toBe(201);
  const result = await created.json();
  expect(result.items.map((item: { id: string }) => item.id)).toEqual(
    [first.matterId, second.matterId].sort(),
  );
  expect((await batchMatterState(first.matterId)).amounts).toHaveLength(2);
  expect((await batchMatterState(second.matterId)).amounts).toHaveLength(1);
  expect(
    (
      await batchMatterState(first.matterId)
    ).evidence?.sampleFeeAmount?.toString(),
  ).toBe('100');
  expect(
    (
      await batchMatterState(second.matterId)
    ).evidence?.sampleFeeAmount?.toString(),
  ).toBe('200');
  expect(await batchReceiptCount()).toBe(1);
  expect(await batchAuditCount()).toBe(1);
  const replay = await submit(request, [...items].reverse(), key);
  expect(replay.status(), await replay.text()).toBe(201);
  expect(await replay.json()).toEqual(result);
  const changed = await submit(
    request,
    [items[0], { ...items[1], archiveReason: '更改' }],
    key,
  );
  expect(changed.status()).toBe(409);
  expect((await changed.json()).code).toBe('IDEMPOTENCY_CONFLICT');
  expect((await batchMatterState(first.matterId)).audits).toBe(1);
  expect((await batchMatterState(second.matterId)).audits).toBe(1);
  await corruptBatchReceipt(result.batchId);
  const corrupt = await submit(request, items, key);
  expect(corrupt.status()).toBe(500);
  expect((await corrupt.json()).code).toBe('INTERNAL_ERROR');
  expect(await batchReceiptCount()).toBe(1);
  expect(await batchAuditCount()).toBe(1);
  expect((await batchMatterState(first.matterId)).audits).toBe(1);
  expect((await batchMatterState(second.matterId)).audits).toBe(1);
});

test('stale second item, wrong stage, cross department and revoked grant reject the whole batch', async ({
  request,
}) => {
  const first = await createBatchWaitingReturnMatter();
  const second = await createBatchWaitingReturnMatter();
  const ids = [first.matterId, second.matterId];
  const stale = await submit(request, [
    keep(first.matterId),
    keep(second.matterId, 4),
  ]);
  expect(stale.status(), await stale.text()).toBe(409);
  expect((await stale.json()).code).toBe('VERSION_CONFLICT');
  await assertUnchanged(ids);
  const foreign = await createBatchWaitingReturnMatter({
    departmentId: coreLeadFixtures.departmentB,
  });
  const cross = await submit(request, [
    keep(first.matterId),
    keep(foreign.matterId),
  ]);
  expect([403, 404]).toContain(cross.status());
  await assertUnchanged(ids);
  const self = await submit(
    request,
    ids.map((id) => keep(id)),
    randomUUID(),
    authSelf,
  );
  expect(self.status()).toBe(403);
  await assertUnchanged(ids);
  await setGrant('notary.return.archive', false);
  try {
    const revoked = await submit(
      request,
      ids.map((id) => keep(id)),
    );
    expect(revoked.status()).toBe(403);
    await assertUnchanged(ids);
  } finally {
    await setGrant('notary.return.archive', true);
  }
  const wrong = await createBatchWaitingReturnMatter({
    stage: 'WAITING_CERTIFICATE',
    decision: 'ISSUE',
  });
  const wrongStage = await submit(request, [
    keep(first.matterId),
    keep(wrong.matterId),
  ]);
  expect(wrongStage.status()).toBe(409);
  expect((await batchMatterState(first.matterId)).archives).toBe(0);
  const noIssueMismatch = await createBatchWaitingReturnMatter({
    decision: 'ISSUE',
  });
  const mismatch = await submit(request, [
    keep(first.matterId),
    keep(noIssueMismatch.matterId),
  ]);
  expect(mismatch.status()).toBe(409);
  expect((await mismatch.json()).code).toBe('INVALID_STATE');
  const already = await createBatchWaitingReturnMatter({ stage: 'ARCHIVED' });
  const archived = await submit(request, [
    keep(first.matterId),
    keep(already.matterId),
  ]);
  expect(archived.status()).toBe(409);
  expect((await batchMatterState(first.matterId)).archives).toBe(0);
  const unknown = await submit(request, [
    keep(first.matterId),
    keep(randomUUID()),
  ]);
  expect(unknown.status()).toBe(404);
  expect((await batchMatterState(first.matterId)).archives).toBe(0);
  const otherDept = await submit(
    request,
    [keep(foreign.matterId)],
    randomUUID(),
    authB,
  );
  expect(otherDept.status(), await otherDept.text()).toBe(201);
});

test('refund limits and unknown original amount reject the full batch before any archive fact', async ({
  request,
}) => {
  const first = await createBatchWaitingReturnMatter({
    sampleFeeAmount: '100.00',
  });
  const second = await createBatchWaitingReturnMatter({
    sampleFeeAmount: '20.00',
  });
  const tooMuch = await submit(request, [
    keep(first.matterId),
    {
      matterId: second.matterId,
      returnChoice: 'REFUND_ONLY',
      refund: {
        state: 'KNOWN',
        amount: '20.01',
        partyKind: 'CUSTOMER',
      },
      archiveReason: '超过原额',
      expectedVersion: 5,
    },
  ]);
  expect(tooMuch.status()).toBe(409);
  expect((await tooMuch.json()).code).toBe('REFUND_EXCEEDS_ORIGINAL');
  await assertUnchanged([first.matterId, second.matterId]);
  const unknown = await createBatchWaitingReturnMatter({
    sampleFeeState: 'PENDING',
  });
  const noOriginal = await submit(request, [
    keep(first.matterId),
    {
      matterId: unknown.matterId,
      returnChoice: 'REFUND_ONLY',
      refund: {
        state: 'KNOWN',
        amount: '0.01',
        partyKind: 'FIRM',
      },
      archiveReason: '原额待定',
      expectedVersion: 5,
    },
  ]);
  expect(noOriginal.status()).toBe(409);
  expect((await noOriginal.json()).code).toBe('ORIGINAL_AMOUNT_UNKNOWN');
  await assertUnchanged([first.matterId, second.matterId, unknown.matterId]);
});

test('batch HTTP rejects duplicate IDs, 51 items, unknown fields and missing key before writes', async ({
  request,
}) => {
  const matter = await createBatchWaitingReturnMatter();
  const base = keep(matter.matterId);
  for (const items of [
    [base, { ...base, matterId: matter.matterId.toUpperCase() }],
    Array.from({ length: 51 }, () => base),
    [{ ...base, unknown: true }],
    [],
  ]) {
    const response = await submit(request, items);
    expect(response.status(), await response.text()).toBe(400);
  }
  const unknownBody = await request.post(
    '/api/v1/notary-matters/return-archive-batches',
    {
      headers: { ...authA, 'Idempotency-Key': randomUUID() },
      data: { items: [base], unknown: true },
    },
  );
  expect(unknownBody.status()).toBe(400);
  const missingKey = await request.post(
    '/api/v1/notary-matters/return-archive-batches',
    {
      headers: authA,
      data: { items: [base] },
    },
  );
  expect(missingKey.status()).toBe(400);
  await assertUnchanged([matter.matterId]);
});

test('batch audit and receipt failures roll back every PostgreSQL write', async ({
  request,
}) => {
  for (const inject of [rejectBatchAuditWrites, rejectBatchReceiptWrites]) {
    const first = await createBatchWaitingReturnMatter();
    const second = await createBatchWaitingReturnMatter();
    try {
      await inject();
      const failed = await submit(request, [
        keep(first.matterId),
        keep(second.matterId),
      ]);
      expect(failed.status(), await failed.text()).toBeGreaterThanOrEqual(500);
      expect(await batchMatterState(first.matterId)).toMatchObject({
        matter: { stage: 'WAITING_RETURN', version: 5 },
        archives: 0,
        audits: 0,
      });
      expect(await batchMatterState(second.matterId)).toMatchObject({
        matter: { stage: 'WAITING_RETURN', version: 5 },
        archives: 0,
        audits: 0,
      });
      expect(await batchReceiptCount()).toBe(0);
      expect(await batchAuditCount()).toBe(0);
    } finally {
      await allowBatchInjectedFailures();
    }
  }
});

test('same-key, different-key and single-versus-batch races commit one consistent winner', async ({
  request,
}) => {
  const first = await createBatchWaitingReturnMatter();
  const second = await createBatchWaitingReturnMatter();
  const items = [keep(first.matterId), keep(second.matterId)];
  const key = randomUUID();
  const same = await Promise.all([
    submit(request, items, key),
    submit(request, [...items].reverse(), key),
  ]);
  expect(same.map((response) => response.status())).toEqual([201, 201]);
  expect(await batchReceiptCount()).toBe(1);
  expect(await batchAuditCount()).toBe(1);
  const third = await createBatchWaitingReturnMatter();
  const fourth = await createBatchWaitingReturnMatter();
  const different = await Promise.all([
    submit(
      request,
      [keep(third.matterId), keep(fourth.matterId)],
      randomUUID(),
    ),
    submit(
      request,
      [keep(third.matterId), keep(fourth.matterId)],
      randomUUID(),
    ),
  ]);
  expect(different.map((response) => response.status()).sort()).toEqual([
    201, 409,
  ]);
  const fifth = await createBatchWaitingReturnMatter();
  const sixth = await createBatchWaitingReturnMatter();
  const cross = await Promise.all([
    submit(request, [keep(fifth.matterId), keep(sixth.matterId)]),
    request.post(`/api/v1/notary-matters/${fifth.matterId}/return-archive`, {
      headers: { ...authA, 'Idempotency-Key': randomUUID() },
      data: {
        returnChoice: 'KEEP',
        archiveReason: '单项竞争',
        expectedVersion: 5,
      },
    }),
  ]);
  expect(cross.map((response) => response.status()).sort()).toEqual([201, 409]);
  const sixthState = await batchMatterState(sixth.matterId);
  expect(sixthState.archives).toBe(cross[0].status() === 201 ? 1 : 0);
  await setInternalAccountActive(coreLeadFixtures.userA, false);
  try {
    const replay = await submit(request, items, key);
    expect(replay.status()).toBe(403);
  } finally {
    await setInternalAccountActive(coreLeadFixtures.userA, true);
  }
  await setGrant('notary.return.archive', false);
  try {
    const replay = await submit(request, items, key);
    expect(replay.status()).toBe(403);
  } finally {
    await setGrant('notary.return.archive', true);
  }
});

test('the maximum 50-item batch completes within the transaction budget', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const matters = await Promise.all(
    Array.from({ length: 50 }, () => createBatchWaitingReturnMatter()),
  );
  const started = Date.now();
  const response = await submit(
    request,
    matters.map((matter) => keep(matter.matterId)),
  );
  expect(response.status(), await response.text()).toBe(201);
  const result = await response.json();
  expect(result.items).toHaveLength(50);
  expect(await batchReceiptCount()).toBe(1);
  expect(await batchAuditCount()).toBe(1);
  test
    .info()
    .annotations.push({
      type: 'batch50ElapsedMs',
      description: String(Date.now() - started),
    });
});
