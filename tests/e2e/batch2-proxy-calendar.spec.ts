import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { coreLeadFixtures } from '../support/core-lead-database.mjs';
import {
  assertBatch2Admission,
  readBatch2CertificateDownstream,
  readBatch2ProxyAudit,
  verifyBatch2EmptyMigrationAndEpoch,
} from '../support/batch2-proxy-calendar-acceptance.mjs';

// The ordinary runner checks its managed DB/app binding before server startup.
// This additional guard prevents this batch-specific acceptance from running
// against any prior managed test instance.
assertBatch2Admission();

const operator = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const other = { Authorization: `Bearer ${coreLeadFixtures.tokenSelf}` };
function prepared<T>(name: string): T {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} must contain an isolated synthetic fixture`);
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${name} is not valid fixture JSON`);
  }
}
const beijingDay = (offset: number) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (name: string) =>
    parts.find((item) => item.type === name)!.value;
  const date = new Date(
    `${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`,
  );
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

test.setTimeout(300_000);

test('186/187 empty chain, exact owner epoch and constraint counterexamples', async () => {
  const result = await verifyBatch2EmptyMigrationAndEpoch();
  expect(result.tables).toEqual([
    'calendar_manual_items',
    'calendar_reminder_reads',
    'case_refund_applications',
  ]);
  expect(result.epoch).toEqual([0, 0, 1, 2]);
  expect(result.invalidTypesRejected).toBe(true);
  expect(result.legacyExternalPreserved).toBe(true);
});

test('own manual item persists, other user cannot edit, read remains separate from closing and date change reopens', async ({
  request,
}) => {
  const title = `批次个人事项-${randomUUID()}`;
  const firstDay = beijingDay(-2);
  const secondDay = beijingDay(-1);
  const createdResponse = await request.post('/api/v1/calendar/personal', {
    headers: operator,
    data: { title, eventDate: firstDay, note: '批次验收' },
  });
  expect(createdResponse.status(), await createdResponse.text()).toBe(201);
  const created = (await createdResponse.json()) as {
    id: string;
    version: number;
  };
  const ownMonth = await request.get(
    `/api/v1/calendar/personal?month=${firstDay.slice(0, 7)}`,
    { headers: operator },
  );
  expect(ownMonth.status()).toBe(200);
  expect(await ownMonth.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: created.id, title }),
    ]),
  );
  const otherMonth = await request.get(
    `/api/v1/calendar/personal?month=${firstDay.slice(0, 7)}`,
    { headers: other },
  );
  if (otherMonth.status() === 200)
    expect(await otherMonth.json()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.id })]),
    );
  else expect(otherMonth.status()).toBe(403);
  const otherEdit = await request.patch(
    `/api/v1/calendar/personal/${created.id}`,
    {
      headers: other,
      data: {
        title: '越权编辑',
        eventDate: secondDay,
        note: null,
        expectedVersion: created.version,
      },
    },
  );
  expect([403, 404, 409]).toContain(otherEdit.status());
  const dueResponse = await request.get('/api/v1/calendar/reminders', {
    headers: operator,
  });
  expect(dueResponse.status()).toBe(200);
  const due = (
    (await dueResponse.json()) as Array<{
      sourceType: string;
      sourceId: string;
      sourceEpoch: string;
      eventDate: string;
      readAt: string | null;
    }>
  ).find((item) => item.sourceId === created.id);
  expect(due).toMatchObject({
    sourceType: 'MANUAL',
    sourceEpoch: created.id,
    eventDate: firstDay,
    readAt: null,
  });
  const read = await request.post('/api/v1/calendar/reminders/read', {
    headers: operator,
    data: {
      sourceType: due!.sourceType,
      sourceId: due!.sourceId,
      sourceEpoch: due!.sourceEpoch,
      eventDate: due!.eventDate,
    },
  });
  expect(read.status(), await read.text()).toBe(201);
  const afterRead = await request.get('/api/v1/calendar/reminders', {
    headers: operator,
  });
  expect(
    (
      (await afterRead.json()) as Array<{
        sourceId: string;
        readAt: string | null;
      }>
    ).find((item) => item.sourceId === created.id)?.readAt,
  ).not.toBeNull();
  const changed = await request.patch(
    `/api/v1/calendar/personal/${created.id}`,
    {
      headers: operator,
      data: {
        title,
        eventDate: secondDay,
        note: '改期',
        expectedVersion: created.version,
      },
    },
  );
  expect(changed.status(), await changed.text()).toBe(200);
  const afterChange = await request.get('/api/v1/calendar/reminders', {
    headers: operator,
  });
  expect(
    (
      (await afterChange.json()) as Array<{
        sourceId: string;
        eventDate: string;
        readAt: string | null;
      }>
    ).find((item) => item.sourceId === created.id),
  ).toMatchObject({ eventDate: secondDay, readAt: null });
  const stale = await request.post('/api/v1/calendar/reminders/read', {
    headers: operator,
    data: {
      sourceType: due!.sourceType,
      sourceId: due!.sourceId,
      sourceEpoch: due!.sourceEpoch,
      eventDate: firstDay,
    },
  });
  expect(stale.status()).toBe(404);
});

test('prepared formal judgment source: one application, exact retry and conflicting body', async ({
  request,
}) => {
  const sourceId = process.env.BATCH2_REFUND_SOURCE_ID;
  const sourceType = process.env.BATCH2_REFUND_SOURCE_TYPE;
  const ownerToken = process.env.BATCH2_REFUND_OWNER_TOKEN;
  if (
    !sourceId ||
    !['FIRST_INSTANCE_JUDGMENT', 'SECOND_INSTANCE_RESULT'].includes(
      sourceType ?? '',
    ) ||
    !ownerToken
  )
    throw new Error(
      'Prepare BATCH2_REFUND_SOURCE_ID, SOURCE_TYPE and OWNER_TOKEN from an isolated formal registration fixture',
    );
  const headers = { Authorization: `Bearer ${ownerToken}` };
  const body = {
    sourceType,
    sourceId,
    applicationDate: beijingDay(0),
    note: `批次真实申请-${randomUUID()}`,
  };
  const first = await request.post('/api/v1/calendar/refund-applications', {
    headers,
    data: body,
  });
  expect(first.status(), await first.text()).toBe(201);
  const receipt = (await first.json()) as { id: string };
  const same = await request.post('/api/v1/calendar/refund-applications', {
    headers,
    data: body,
  });
  expect(same.status(), await same.text()).toBe(201);
  expect(((await same.json()) as { id: string }).id).toBe(receipt.id);
  const changed = await request.post('/api/v1/calendar/refund-applications', {
    headers,
    data: { ...body, note: '冲突内容' },
  });
  expect(changed.status()).toBe(409);
  const due = await request.get('/api/v1/calendar/reminders', { headers });
  expect(
    ((await due.json()) as Array<{ sourceId: string }>).some(
      (item) => item.sourceId === sourceId,
    ),
  ).toBe(false);
});

test('prepared proxy customer review keeps real internal actor and exact request key', async ({
  request,
}) => {
  const fixtures = prepared<
    Array<{
      leadId: string;
      expectedVersion: number;
      operatorToken: string;
      operatorUserId: string;
      externalAccountExists: boolean;
    }>
  >('BATCH2_PROXY_REVIEW_FIXTURES');
  expect(fixtures.map((item) => item.externalAccountExists).sort()).toEqual([
    false,
    true,
  ]);
  for (const item of fixtures) {
    const path = `/api/v1/leads/${item.leadId}/proxy-reviews`;
    const headers = {
      Authorization: `Bearer ${item.operatorToken}`,
      'Idempotency-Key': randomUUID(),
    };
    const body = {
      result: 'INFRINGEMENT',
      expectedVersion: item.expectedVersion,
    };
    const first = await request.post(path, { headers, data: body });
    expect(first.status(), await first.text()).toBe(201);
    const retry = await request.post(path, { headers, data: body });
    expect(retry.status(), await retry.text()).toBe(201);
    expect(await retry.json()).toEqual(await first.json());
    const conflict = await request.post(path, {
      headers,
      data: {
        result: 'NO_INFRINGEMENT',
        reason: '不同请求',
        expectedVersion: item.expectedVersion,
      },
    });
    expect(conflict.status()).toBe(409);
    expect(await readBatch2ProxyAudit('review', item.leadId)).toEqual([
      expect.objectContaining({
        actor_kind: 'INTERNAL_PROXY',
        actor_user_id: item.operatorUserId,
        internal_actor_user_id: item.operatorUserId,
        binding_id: null,
      }),
    ]);
  }
});

test('prepared proxy withdrawal confirmation keeps the real actor', async ({
  request,
}) => {
  const item = prepared<{
    leadId: string;
    applicationId: string;
    expectedVersion: number;
    operatorToken: string;
    operatorUserId: string;
  }>('BATCH2_PROXY_WITHDRAW_FIXTURE');
  const headers = {
    Authorization: `Bearer ${item.operatorToken}`,
    'Idempotency-Key': randomUUID(),
  };
  const path = `/api/v1/leads/${item.leadId}/proxy-withdrawal-confirmations`;
  const body = {
    applicationId: item.applicationId,
    expectedVersion: item.expectedVersion,
  };
  const first = await request.post(path, { headers, data: body });
  expect(first.status(), await first.text()).toBe(201);
  const retry = await request.post(path, { headers, data: body });
  expect(retry.status(), await retry.text()).toBe(201);
  expect(await retry.json()).toEqual(await first.json());
  expect(await readBatch2ProxyAudit('withdrawal', item.applicationId)).toEqual([
    expect.objectContaining({
      actor_kind: 'INTERNAL_PROXY',
      actor_user_id: item.operatorUserId,
      internal_actor_user_id: item.operatorUserId,
      binding_id: null,
    }),
  ]);
});

test('prepared proxy certificate preserves certificate material, evidence and fee source', async ({
  request,
}) => {
  const item = prepared<{
    matterId: string;
    operatorToken: string;
    operatorUserId: string;
    body: {
      expectedVersion: number;
      certificateNo: string;
      certificateDate: string;
      contentVersionIds: string[];
      needDisclose: boolean;
      disclosureContentVersionIds: string[];
      fees: Record<string, { state: string; amount: string | null }>;
    };
  }>('BATCH2_PROXY_CERT_FIXTURE');
  const headers = {
    Authorization: `Bearer ${item.operatorToken}`,
    'Idempotency-Key': randomUUID(),
  };
  const path = `/api/v1/notary-matters/${item.matterId}/proxy-certificate`;
  const first = await request.post(path, { headers, data: item.body });
  expect(first.status(), await first.text()).toBe(201);
  const response = (await first.json()) as {
    case: { id: string };
    certificate: { files: unknown[] };
  };
  expect(response.certificate.files.length).toBe(
    item.body.contentVersionIds.length,
  );
  const retry = await request.post(path, { headers, data: item.body });
  expect(retry.status(), await retry.text()).toBe(201);
  expect(await retry.json()).toEqual(response);
  expect(await readBatch2ProxyAudit('certificate', item.matterId)).toEqual([
    expect.objectContaining({
      actor_kind: 'INTERNAL_PROXY',
      actor_user_id: item.operatorUserId,
      internal_actor_user_id: item.operatorUserId,
      binding_id: null,
    }),
  ]);
  const downstream = await readBatch2CertificateDownstream(
    item.matterId,
    response.case.id,
  );
  expect(downstream.fees).toBe(3);
  expect(downstream.evidence).toBeGreaterThan(0);
  expect(downstream.feeRecords).toBeGreaterThanOrEqual(
    Object.values(item.body.fees).filter((fee) => fee.state === 'KNOWN').length,
  );
});
