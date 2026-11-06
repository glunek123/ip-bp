import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  coreLeadFixtures,
  seedCoreLeadE2eData,
} from '../support/core-lead-database.mjs';
import {
  setCaseExternalEntryGrant,
  setCaseExternalEntryWorkflowGrant,
} from '../support/case-external-entry-database.mjs';
import { batch2SyntheticPdf } from '../support/batch2-synthetic-pdf.mjs';
import { withLitigationRefundCommitFault } from '../support/litigation-refund-fault.mjs';

const operator = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const selfOnly = { Authorization: `Bearer ${coreLeadFixtures.tokenSelf}` };
const foreign = { Authorization: `Bearer ${coreLeadFixtures.tokenB}` };
const backendRequire = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const validateBrowserTestDatabaseUrl = (
  backendRequire('../scripts/test-environment.mjs') as {
    validateBrowserTestDatabaseUrl(
      databaseUrl: string,
      root: string,
    ): { connectionString: string };
  }
).validateBrowserTestDatabaseUrl;
type DatabaseClient = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
};
const PgClient = (
  backendRequire('pg') as {
    Client: new (options: { connectionString: string }) => DatabaseClient;
  }
).Client;

type HttpResponse = {
  status(): number;
  text(): Promise<string>;
  json(): Promise<unknown>;
  body(): Promise<Buffer>;
};
type EntryCreated = { id: string; stage: string; version: number };
type CaseDetail = {
  id: string;
  stage: string;
  version: number;
  judgment: { current: { id: string; trialRoundId: string } | null };
};
type RefundSource = {
  type: 'JUDGMENT' | 'SECOND_INSTANCE_RESULT';
  id: string;
  trialRoundId: string;
};
type RefundRow = {
  caseId: string;
  itemId: string;
  inventoryVersionId: string;
  defendant: string;
  party: 'COURT' | 'DEFENDANT';
  amount: string | null;
  status: string;
  description: string;
  remark: string | null;
  source: RefundSource | null;
};
type RefundWorkspace = {
  caseId: string;
  inventoryVersionId: string | null;
  sources: Array<RefundSource & { label: string; courtNo: string | null }>;
  items: RefundRow[];
};
type RefundCommand = {
  commandId: string;
  inventoryVersionId: string;
  item: RefundRow;
};
type TestAttachments = {
  attach(
    name: string,
    options: { body: string | Buffer; contentType: string },
  ): Promise<void>;
};

async function responseJson<T>(
  response: HttpResponse,
  status = 200,
): Promise<T> {
  const text = await response.text();
  expect(response.status(), text).toBe(status);
  return JSON.parse(text) as T;
}

async function isolatedClient(): Promise<DatabaseClient> {
  const databaseUrl = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== 'test' || !databaseUrl)
    throw new Error(
      'Litigation refund fixture requires the isolated test database',
    );
  const validated = validateBrowserTestDatabaseUrl(databaseUrl, process.cwd());
  const client = new PgClient({
    connectionString: validated.connectionString,
  });
  await client.connect();
  const identity = (
    await client.query<{ db: string; schema: string }>(
      'SELECT current_database() AS db,current_schema() AS schema',
    )
  ).rows[0];
  if (identity?.db !== 'dev_cor_test' || identity.schema !== 'public') {
    await client.end();
    throw new Error('Unexpected litigation refund fixture database');
  }
  return client;
}

async function enableSyntheticGrants() {
  const client = await isolatedClient();
  try {
    const identity = (
      await client.query<{
        role: string | null;
        department: string | null;
        user_id: string | null;
      }>(
        `SELECT a.role_template_id AS role, a.department_id AS department, a.user_id
       FROM role_assignments a
       JOIN role_templates r ON r.id=a.role_template_id AND r.department_id=a.department_id
       WHERE a.role_template_id=$1 AND a.department_id=$2 AND a.user_id=$3 AND a.active AND r.active`,
        [
          coreLeadFixtures.roleA,
          coreLeadFixtures.departmentA,
          coreLeadFixtures.userA,
        ],
      )
    ).rows;
    if (identity.length !== 1)
      throw new Error('Expected the fixed synthetic roleA/userA assignment');
    for (const [action, scope] of [
      ['case.refund.read', 'DEPARTMENT'],
      ['case.refund.record', 'SELF'],
      ['case.refund.follow', 'SELF'],
      ['case.refund.export', 'DEPARTMENT'],
    ] as const) {
      await client.query(
        `INSERT INTO role_grants(id,role_template_id,action,scope)
         VALUES(gen_random_uuid(),$1,$2::permission_action,$3::permission_scope)
         ON CONFLICT DO NOTHING`,
        [coreLeadFixtures.roleA, action, scope],
      );
    }
  } finally {
    await client.end();
  }
  await setCaseExternalEntryGrant(
    coreLeadFixtures.roleA,
    'case.external-entry.create',
    'SELF',
    true,
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.judgment.register',
    true,
  );
}

type RefundPermission =
  | 'case.refund.read'
  | 'case.refund.record'
  | 'case.refund.follow'
  | 'case.refund.export';
type GrantScope = 'SELF' | 'TEAM' | 'DEPARTMENT';

async function appendRefundGrant(
  roleId: string,
  departmentId: string,
  userId: string,
  action: RefundPermission,
  scope: GrantScope,
): Promise<string> {
  const client = await isolatedClient();
  try {
    const assignment = await client.query<{ id: string }>(
      `SELECT r.id FROM role_templates r
       JOIN role_assignments a ON a.role_template_id=r.id AND a.department_id=r.department_id
       WHERE r.id=$1 AND r.department_id=$2 AND r.active AND a.user_id=$3 AND a.active`,
      [roleId, departmentId, userId],
    );
    if (assignment.rows.length !== 1)
      throw new Error(
        'Refund grant actor is outside the fixed synthetic fixture',
      );
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO role_grants(id,role_template_id,action,scope)
       VALUES(gen_random_uuid(),$1,$2::permission_action,$3::permission_scope)
       ON CONFLICT DO NOTHING RETURNING id`,
      [roleId, action, scope],
    );
    const grant =
      inserted.rows[0] ??
      (
        await client.query<{ id: string }>(
          `SELECT id FROM role_grants
         WHERE role_template_id=$1 AND action=$2::permission_action AND scope=$3::permission_scope`,
          [roleId, action, scope],
        )
      ).rows[0];
    if (!grant)
      throw new Error(`Could not retain grant identity for ${action}/${scope}`);
    return grant.id;
  } finally {
    await client.end();
  }
}

async function sqlFacts(caseId: string) {
  const client = await isolatedClient();
  try {
    const rows = await client.query(
      `SELECT c.version AS case_version,
        (SELECT count(*)::int FROM case_closures x WHERE x.case_id=c.id) AS closures,
        (SELECT count(*)::int FROM case_closure_versions x WHERE x.case_id=c.id) AS closure_versions,
        (SELECT count(*)::int FROM case_closure_payment_versions x WHERE x.case_id=c.id) AS payment_versions,
        (SELECT coalesce(sum(x.amount),0)::text FROM case_closure_payment_versions x WHERE x.case_id=c.id) AS payment_amount,
        (SELECT count(*)::int FROM fee_records x WHERE x.case_id=c.id AND x.deleted_at IS NULL) AS fee_records,
        (SELECT coalesce(sum(x.amount),0)::text FROM fee_records x WHERE x.case_id=c.id AND x.deleted_at IS NULL) AS fee_amount,
        (SELECT jsonb_agg(jsonb_build_object('id',j.id,'judgment_amount_state',j.judgment_amount_state,
          'judgment_amount',j.judgment_amount,'paid_fee_state',j.paid_litigation_fee_state,
          'paid_fee',j.paid_litigation_fee) ORDER BY j.id)
         FROM case_judgment_facts j WHERE j.case_id=c.id) AS judgment_fees
       FROM cases c WHERE c.id=$1`,
      [caseId],
    );
    expect(rows.rows).toHaveLength(1);
    return rows.rows[0];
  } finally {
    await client.end();
  }
}

async function commandFacts(caseId: string) {
  const client = await isolatedClient();
  try {
    const result = await client.query(
      `SELECT count(*)::int AS commands,
        count(*) FILTER (WHERE kind='REGISTER')::int AS registrations,
        count(*) FILTER (WHERE kind='FOLLOW')::int AS follow_ups
       FROM case_litigation_refund_commands WHERE case_id=$1`,
      [caseId],
    );
    return result.rows[0];
  } finally {
    await client.end();
  }
}

async function refundStorageFacts(caseId: string, auditReason: string) {
  const client = await isolatedClient();
  try {
    const result = await client.query<{ facts: unknown }>(
      `SELECT jsonb_build_object(
        'versions', coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.revision)
          FROM case_refund_inventory_versions v WHERE v.case_id=$1), '[]'::jsonb),
        'items', coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.item_id)
          FROM case_refund_inventory_items i WHERE i.case_id=$1), '[]'::jsonb),
        'amounts', coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.item_id,a.inventory_version_id)
          FROM case_refund_inventory_item_amounts a
          JOIN case_refund_inventory_versions v ON v.id=a.inventory_version_id
          WHERE v.case_id=$1), '[]'::jsonb),
        'metadata', coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.item_id,m.inventory_version_id)
          FROM case_litigation_refund_item_meta m
          JOIN case_refund_inventory_versions v ON v.id=m.inventory_version_id
          WHERE v.case_id=$1), '[]'::jsonb),
        'commands', coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.recorded_at,c.id)
          FROM case_litigation_refund_commands c WHERE c.case_id=$1), '[]'::jsonb),
        'audits', coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id)
          FROM audit_events a WHERE a.resource_type='CASE_REFUND_INVENTORY_VERSION'
            AND a.action='CASE_REFUND_INVENTORY_RECORD'
            AND a.details->>'reason'=$2), '[]'::jsonb)
      ) AS facts`,
      [caseId, auditReason],
    );
    return result.rows[0]?.facts;
  } finally {
    await client.end();
  }
}

async function attachRequest(
  testInfo: TestAttachments,
  name: string,
  method: 'POST' | 'PATCH',
  url: string,
  body: unknown,
) {
  await testInfo.attach(name, {
    body: JSON.stringify({ method, url, body }, null, 2),
    contentType: 'application/json',
  });
}

function readZipMember(bytes: Buffer, memberName: string): string {
  let centralOffset = -1;
  for (
    let offset = bytes.length - 22;
    offset >= Math.max(0, bytes.length - 65_557);
    offset -= 1
  ) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      centralOffset = bytes.readUInt32LE(offset + 16);
      break;
    }
  }
  if (centralOffset < 0) throw new Error('XLSX ZIP directory is missing');
  let offset = centralOffset;
  while (
    offset + 46 <= bytes.length &&
    bytes.readUInt32LE(offset) === 0x02014b50
  ) {
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (name === memberName) {
      const localNameLength = bytes.readUInt16LE(localOffset + 26);
      const localExtraLength = bytes.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.subarray(start, start + compressedSize);
      const uncompressed =
        method === 0 ? compressed : inflateRawSync(compressed);
      return uncompressed.toString('utf8');
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`XLSX member is missing: ${memberName}`);
}

async function uploadJudgment(
  request: APIRequestContext,
  caseId: string,
  headers = operator,
  testInfo?: TestAttachments,
) {
  const bytes = batch2SyntheticPdf('litigation-refund-current-judgment');
  const draftInput = {
    ownerType: 'CASE',
    ownerId: caseId,
    category: 'JUDGMENT',
    purpose: 'JUDGMENT',
    originalFilename: '合成退费来源判决书.pdf',
    declaredMimeType: 'application/pdf',
  };
  if (testInfo)
    await attachRequest(
      testInfo,
      `judgment-upload-draft-${caseId}.json`,
      'POST',
      '/api/v1/materials/upload-drafts',
      draftInput,
    );
  const draft = await responseJson<{ id: string }>(
    await request.post('/api/v1/materials/upload-drafts', {
      headers,
      data: draftInput,
    }),
    201,
  );
  if (testInfo)
    await testInfo.attach(`judgment-file-${caseId}.pdf`, {
      body: bytes,
      contentType: 'application/pdf',
    });
  const file = await responseJson<{
    materialId: string;
    contentVersionId: string;
  }>(
    await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: bytes,
    }),
  );
  return { bytes, file };
}

async function createJudgedCase(
  request: APIRequestContext,
  testInfo: TestAttachments,
  options: {
    headers: typeof operator;
    customerId: string;
    rightsHolderId: string;
    label: string;
  },
) {
  const defendant = `RF-${randomUUID()} ${options.label}`;
  const entryInput = {
    idempotencyKey: randomUUID(),
    entryKind: 'EXTERNAL_TRANSFER',
    initialStage: 'WAITING_JUDGMENT',
    stageReachedOn: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
    }).format(new Date()),
    source: `CA018 E2E:${randomUUID()}`,
    reason: `合成验收：诉讼退费范围 ${options.label}`,
    customerId: options.customerId,
    rightsHolderId: options.rightsHolderId,
    defendants: [{ kind: 'ORGANIZATION', name: defendant }],
    lawyerAccountId: null,
    lawyerProfileId: null,
    known: {
      courtId: null,
      courtCaseNo: null,
      acceptedOn: null,
      secondInstanceAcceptedOn: null,
      platform: null,
      shopName: null,
      shopExternalId: null,
      caseType: null,
      infringementTypes: null,
    },
  };
  await attachRequest(
    testInfo,
    `case-entry-${options.label}.json`,
    'POST',
    '/api/v1/cases/external-entries',
    entryInput,
  );
  const created = await responseJson<EntryCreated>(
    await request.post('/api/v1/cases/external-entries', {
      headers: options.headers,
      data: entryInput,
    }),
    201,
  );
  const { file } = await uploadJudgment(
    request,
    created.id,
    options.headers,
    testInfo,
  );
  const judgmentInput = {
    expectedVersion: created.version,
    idempotencyKey: randomUUID(),
    judgmentReceivedAt: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
    }).format(new Date()),
    judgmentAmountState: 'PENDING',
    judgmentAmount: null,
    paidLitigationFeeState: 'PENDING',
    paidLitigationFee: null,
    judgmentContentVersionIds: [file.contentVersionId],
  };
  await attachRequest(
    testInfo,
    `judgment-register-${options.label}.json`,
    'POST',
    `/api/v1/cases/${created.id}/judgment-register`,
    judgmentInput,
  );
  const judgment = await responseJson<{
    judgmentId: string;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${created.id}/judgment-register`, {
      headers: options.headers,
      data: judgmentInput,
    }),
    201,
  );
  expect(judgment).toMatchObject({ stage: 'WAITING_JUDGMENT', version: 2 });
  const workspace = await responseJson<RefundWorkspace>(
    await request.get(
      `/api/v1/cases/litigation-refunds/${created.id}/workspace`,
      { headers: options.headers },
    ),
  );
  const source = workspace.sources.find(
    (row) => row.type === 'JUDGMENT' && row.id === judgment.judgmentId,
  );
  expect(
    source,
    'Refund source must come from the live server workspace',
  ).toBeDefined();
  if (!source) throw new Error('Live judgment source is missing');
  return { created, judgment, source, workspace, defendant };
}

async function sendCommand<T extends RefundCommand>(
  request: APIRequestContext,
  method: 'POST' | 'PATCH',
  url: string,
  body: unknown,
  caseId: string,
  key: string,
): Promise<T> {
  const response =
    method === 'POST'
      ? await request.post(url, { headers: operator, data: body })
      : await request.patch(url, { headers: operator, data: body });
  if (response.status() === 500) {
    const receipt = await request.get(
      `/api/v1/cases/litigation-refunds/${caseId}/requests/${encodeURIComponent(key)}`,
      { headers: operator },
    );
    expect(
      receipt.status(),
      '500 is ambiguous; check the receipt before any retry',
    ).toBe(200);
    return responseJson<T>(receipt);
  }
  return responseJson<T>(response, method === 'PATCH' ? 200 : 201);
}

test('registers and follows two litigation refunds from the current judgment without closing the case', async ({
  request,
}, testInfo) => {
  await seedCoreLeadE2eData({ reuseExisting: true });
  await enableSyntheticGrants();
  const defendant = `RF${randomUUID()} 合成退费被告`;
  const source = `Litigation refunds E2E:${randomUUID()}`;
  const created = await responseJson<EntryCreated>(
    await request.post('/api/v1/cases/external-entries', {
      headers: operator,
      data: {
        idempotencyKey: randomUUID(),
        entryKind: 'EXTERNAL_TRANSFER',
        initialStage: 'WAITING_JUDGMENT',
        stageReachedOn: new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Shanghai',
        }).format(new Date()),
        source,
        reason: '合成验收：判决后登记诉讼退费',
        customerId: coreLeadFixtures.admittedCustomer,
        rightsHolderId: coreLeadFixtures.holder,
        defendants: [{ kind: 'ORGANIZATION', name: defendant }],
        lawyerAccountId: null,
        lawyerProfileId: null,
        known: {
          courtId: null,
          courtCaseNo: null,
          acceptedOn: null,
          secondInstanceAcceptedOn: null,
          platform: null,
          shopName: null,
          shopExternalId: null,
          caseType: null,
          infringementTypes: null,
        },
      },
    }),
    201,
  );
  expect(created).toMatchObject({ stage: 'WAITING_JUDGMENT', version: 1 });

  const { file, bytes } = await uploadJudgment(request, created.id);
  const judgmentInput = {
    expectedVersion: created.version,
    idempotencyKey: randomUUID(),
    judgmentReceivedAt: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
    }).format(new Date()),
    judgmentAmountState: 'PENDING',
    judgmentAmount: null,
    paidLitigationFeeState: 'PENDING',
    paidLitigationFee: null,
    judgmentContentVersionIds: [file.contentVersionId],
  };
  const judgment = await responseJson<{
    judgmentId: string;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${created.id}/judgment-register`, {
      headers: operator,
      data: judgmentInput,
    }),
    201,
  );
  expect(judgment).toMatchObject({ stage: 'WAITING_JUDGMENT', version: 2 });
  const beforeFinancialFacts = await sqlFacts(created.id);
  expect(beforeFinancialFacts).toMatchObject({
    case_version: 2,
    closures: 0,
    closure_versions: 0,
    payment_versions: 0,
    fee_records: 0,
  });

  const workspaceResponse = await request.get(
    `/api/v1/cases/litigation-refunds/${created.id}/workspace`,
    { headers: operator },
  );
  const workspace = await responseJson<RefundWorkspace>(workspaceResponse);
  expect(workspace.caseId).toBe(created.id);
  const currentSource = workspace.sources.find(
    (row) => row.type === 'JUDGMENT' && row.id === judgment.judgmentId,
  );
  expect(
    currentSource,
    'workspace must offer the real registered judgment source',
  ).toBeDefined();
  if (!currentSource)
    throw new Error('Current judgment source is missing from the workspace');

  const knownItemId = randomUUID();
  const unknownItemId = randomUUID();
  const knownKey = randomUUID();
  const unknownKey = randomUUID();
  const knownInput = {
    itemId: knownItemId,
    expectedInventoryVersionId: workspace.inventoryVersionId,
    sourceType: currentSource.type,
    sourceId: currentSource.id,
    party: 'COURT',
    amount: '123.45',
    description: '法院退还预交诉讼费（合成）',
    reason: '判决已登记，等待法院办理退费',
    idempotencyKey: knownKey,
  };
  const knownUrl = `/api/v1/cases/litigation-refunds/${created.id}/items`;
  const unknownInput = {
    ...knownInput,
    itemId: unknownItemId,
    expectedInventoryVersionId: null as string | null,
    party: 'DEFENDANT' as const,
    amount: null,
    description: '被告直接退还（金额待核）',
    reason: '合成来源已核实，金额资料待补',
    idempotencyKey: unknownKey,
  };
  const followInput = {
    expectedInventoryVersionId: '',
    status: 'SUBMITTED',
    remark: '已向法院提交退费申请（独立跟进备注）',
    reason: '首次提交后补录跟进',
    idempotencyKey: randomUUID(),
  };
  await attachRequest(
    testInfo,
    'known-refund-request.json',
    'POST',
    knownUrl,
    knownInput,
  );

  const known = await sendCommand<RefundCommand>(
    request,
    'POST',
    knownUrl,
    knownInput,
    created.id,
    knownKey,
  );
  expect(known.item).toMatchObject({
    itemId: knownItemId,
    amount: '123.45',
    status: 'PENDING',
    description: knownInput.description,
    source: {
      type: currentSource.type,
      id: currentSource.id,
      trialRoundId: currentSource.trialRoundId,
      valid: true,
    },
  });
  const afterKnown = await responseJson<RefundWorkspace>(
    await request.get(
      `/api/v1/cases/litigation-refunds/${created.id}/workspace`,
      { headers: operator },
    ),
  );
  expect(afterKnown.inventoryVersionId).toBe(known.inventoryVersionId);
  unknownInput.expectedInventoryVersionId = afterKnown.inventoryVersionId;

  await attachRequest(
    testInfo,
    'unknown-refund-request.json',
    'POST',
    knownUrl,
    unknownInput,
  );
  const unknown = await sendCommand<RefundCommand>(
    request,
    'POST',
    knownUrl,
    unknownInput,
    created.id,
    unknownKey,
  );
  expect(unknown.item).toMatchObject({
    itemId: unknownItemId,
    amount: null,
    status: 'PENDING',
    description: unknownInput.description,
    party: 'DEFENDANT',
    source: { type: currentSource.type, id: currentSource.id, valid: true },
  });
  followInput.expectedInventoryVersionId = unknown.inventoryVersionId;
  const followUrl = `/api/v1/cases/litigation-refunds/${created.id}/items/${knownItemId}/follow-up`;
  await attachRequest(
    testInfo,
    'refund-follow-up-request.json',
    'PATCH',
    followUrl,
    followInput,
  );
  const followed = await sendCommand<RefundCommand>(
    request,
    'PATCH',
    followUrl,
    followInput,
    created.id,
    followInput.idempotencyKey,
  );
  expect(followed.item).toMatchObject({
    itemId: knownItemId,
    amount: '123.45',
    status: 'SUBMITTED',
    description: knownInput.description,
    remark: followInput.remark,
  });
  const beforeReplayCounts = await commandFacts(created.id);
  expect(beforeReplayCounts).toEqual({
    commands: 3,
    registrations: 2,
    follow_ups: 1,
  });

  const receipt = await responseJson<RefundCommand>(
    await request.get(
      `/api/v1/cases/litigation-refunds/${created.id}/requests/${encodeURIComponent(knownKey)}`,
      { headers: operator },
    ),
  );
  expect(receipt).toEqual(known);
  const replay = await sendCommand<RefundCommand>(
    request,
    'POST',
    knownUrl,
    knownInput,
    created.id,
    knownKey,
  );
  expect(replay).toEqual(known);
  const changedInput = {
    ...knownInput,
    description: '同键不同请求体（合成冲突核验）',
  };
  await attachRequest(
    testInfo,
    'changed-body-conflict-request.json',
    'POST',
    knownUrl,
    changedInput,
  );
  const changedBody = await request.post(knownUrl, {
    headers: operator,
    data: changedInput,
  });
  expect(changedBody.status(), await changedBody.text()).toBe(409);
  expect(await commandFacts(created.id)).toEqual(beforeReplayCounts);

  const listResponse = await request.get(
    `/api/v1/cases/litigation-refunds?defendant=${encodeURIComponent(defendant)}`,
    { headers: operator },
  );
  const listed = await responseJson<{
    items: RefundRow[];
    total: number;
    summary: {
      unrefundedAmount: string;
      unrefundedCount: number;
      filteredAmount: string;
      unknownAmountCount: number;
    };
  }>(listResponse);
  expect(listed.total).toBe(2);
  expect(listed.items.map((row) => row.amount).sort()).toEqual(
    ['123.45', null].sort(),
  );
  expect(listed.summary).toMatchObject({
    unrefundedAmount: '123.45',
    unrefundedCount: 2,
    filteredAmount: '123.45',
    unknownAmountCount: 1,
  });

  const exportResponse = await request.get(
    `/api/v1/cases/litigation-refunds/export?defendant=${encodeURIComponent(defendant)}`,
    { headers: operator },
  );
  expect(exportResponse.status(), await exportResponse.text()).toBe(200);
  expect(exportResponse.headers()['content-type']).toContain(
    'spreadsheetml.sheet',
  );
  const sheet = readZipMember(
    await exportResponse.body(),
    'xl/worksheets/sheet1.xml',
  );
  const firstRow = sheet.match(/<row r="1">([\s\S]*?)<\/row>/u)?.[1] ?? '';
  expect([...firstRow.matchAll(/<c\s/g)].length).toBe(9);
  expect(sheet.match(/<row\s/g)?.length).toBe(3);
  expect(sheet).toContain('123.45');

  const caseDetail = await responseJson<CaseDetail>(
    await request.get(`/api/v1/cases/${created.id}`, { headers: operator }),
  );
  expect(caseDetail).toMatchObject({
    id: created.id,
    stage: 'WAITING_JUDGMENT',
    version: 2,
    judgment: { current: { id: judgment.judgmentId } },
  });
  expect(await sqlFacts(created.id)).toEqual(beforeFinancialFacts);
  const finalWorkspace = await responseJson<RefundWorkspace>(
    await request.get(
      `/api/v1/cases/litigation-refunds/${created.id}/workspace`,
      { headers: operator },
    ),
  );
  expect(finalWorkspace.items).toHaveLength(2);
  expect(
    finalWorkspace.items.find((row) => row.itemId === knownItemId),
  ).toMatchObject({
    amount: '123.45',
    status: 'SUBMITTED',
    description: knownInput.description,
    remark: followInput.remark,
  });
  expect(
    finalWorkspace.items.find((row) => row.itemId === unknownItemId),
  ).toMatchObject({
    amount: null,
    description: unknownInput.description,
    status: 'PENDING',
  });
  const downloaded = await request.get(
    `/api/v1/materials/${file.materialId}/versions/${file.contentVersionId}/content`,
    { headers: operator },
  );
  expect(downloaded.status(), await downloaded.text()).toBe(200);
  expect((await downloaded.body()).equals(bytes)).toBe(true);
});

test('enforces refund access scope and rolls back a failed command commit before exact-key recovery', async ({
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  await seedCoreLeadE2eData({ reuseExisting: true });

  await setCaseExternalEntryGrant(
    coreLeadFixtures.roleA,
    'case.external-entry.create',
    'SELF',
    true,
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.judgment.register',
    true,
  );
  await setCaseExternalEntryGrant(
    coreLeadFixtures.roleSelf,
    'case.external-entry.create',
    'SELF',
    true,
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleSelf,
    'case.judgment.register',
    true,
  );

  const grants: Array<{
    actor: string;
    action: RefundPermission;
    scope: GrantScope;
    id: string;
  }> = [];
  for (const [actor, roleId, departmentId, userId, action, scope] of [
    [
      'roleA',
      coreLeadFixtures.roleA,
      coreLeadFixtures.departmentA,
      coreLeadFixtures.userA,
      'case.refund.read',
      'DEPARTMENT',
    ],
    [
      'roleA',
      coreLeadFixtures.roleA,
      coreLeadFixtures.departmentA,
      coreLeadFixtures.userA,
      'case.refund.record',
      'SELF',
    ],
    [
      'roleA',
      coreLeadFixtures.roleA,
      coreLeadFixtures.departmentA,
      coreLeadFixtures.userA,
      'case.refund.follow',
      'SELF',
    ],
    [
      'roleA',
      coreLeadFixtures.roleA,
      coreLeadFixtures.departmentA,
      coreLeadFixtures.userA,
      'case.refund.export',
      'DEPARTMENT',
    ],
    [
      'roleSelf',
      coreLeadFixtures.roleSelf,
      coreLeadFixtures.departmentA,
      coreLeadFixtures.userSelf,
      'case.refund.read',
      'DEPARTMENT',
    ],
    [
      'roleSelf',
      coreLeadFixtures.roleSelf,
      coreLeadFixtures.departmentA,
      coreLeadFixtures.userSelf,
      'case.refund.follow',
      'SELF',
    ],
    [
      'roleB',
      coreLeadFixtures.roleB,
      coreLeadFixtures.departmentB,
      coreLeadFixtures.userB,
      'case.refund.read',
      'DEPARTMENT',
    ],
  ] as const) {
    grants.push({
      actor,
      action,
      scope,
      id: await appendRefundGrant(roleId, departmentId, userId, action, scope),
    });
  }
  await testInfo.attach('refund-scope-grant-identities.json', {
    body: JSON.stringify(grants, null, 2),
    contentType: 'application/json',
  });

  const selfCase = await createJudgedCase(request, testInfo, {
    headers: selfOnly,
    customerId: coreLeadFixtures.selfCustomer,
    rightsHolderId: coreLeadFixtures.selfHolder,
    label: 'self-owner',
  });
  const operatorCase = await createJudgedCase(request, testInfo, {
    headers: operator,
    customerId: coreLeadFixtures.admittedCustomer,
    rightsHolderId: coreLeadFixtures.holder,
    label: 'operator-owner',
  });

  const ownWorkspace = await responseJson<RefundWorkspace>(
    await request.get(
      `/api/v1/cases/litigation-refunds/${selfCase.created.id}/workspace`,
      { headers: selfOnly },
    ),
  );
  expect(ownWorkspace).toMatchObject({
    caseId: selfCase.created.id,
    canRecord: false,
    canFollow: true,
  });
  const sameDepartmentWorkspace = await responseJson<RefundWorkspace>(
    await request.get(
      `/api/v1/cases/litigation-refunds/${operatorCase.created.id}/workspace`,
      { headers: selfOnly },
    ),
  );
  expect(sameDepartmentWorkspace).toMatchObject({
    caseId: operatorCase.created.id,
    canRecord: false,
    canFollow: false,
  });
  const foreignDepartmentRead = await request.get(
    `/api/v1/cases/litigation-refunds/${operatorCase.created.id}/workspace`,
    { headers: foreign },
  );
  expect(
    foreignDepartmentRead.status(),
    await foreignDepartmentRead.text(),
  ).toBe(404);

  const deniedRegister = {
    itemId: randomUUID(),
    expectedInventoryVersionId: ownWorkspace.inventoryVersionId,
    sourceType: selfCase.source.type,
    sourceId: selfCase.source.id,
    party: 'COURT',
    amount: '1.00',
    description: '本人范围角色尝试未获授权的登记',
    reason: '必须由服务端拒绝',
    idempotencyKey: randomUUID(),
  };
  const deniedRegisterUrl = `/api/v1/cases/litigation-refunds/${selfCase.created.id}/items`;
  await attachRequest(
    testInfo,
    'self-role-denied-register.json',
    'POST',
    deniedRegisterUrl,
    deniedRegister,
  );
  const selfStorageBefore = await refundStorageFacts(
    selfCase.created.id,
    deniedRegister.reason,
  );
  const selfRegisterResponse = await request.post(deniedRegisterUrl, {
    headers: selfOnly,
    data: deniedRegister,
  });
  expect(selfRegisterResponse.status(), await selfRegisterResponse.text()).toBe(
    403,
  );
  expect(
    await refundStorageFacts(selfCase.created.id, deniedRegister.reason),
  ).toEqual(selfStorageBefore);

  const deniedFollow = {
    expectedInventoryVersionId: sameDepartmentWorkspace.inventoryVersionId,
    status: 'SUBMITTED',
    remark: '非本人案件不得跟进',
    reason: 'SELF范围拒绝测试',
    idempotencyKey: randomUUID(),
  };
  const deniedFollowUrl = `/api/v1/cases/litigation-refunds/${operatorCase.created.id}/items/${randomUUID()}/follow-up`;
  await attachRequest(
    testInfo,
    'self-role-denied-follow.json',
    'PATCH',
    deniedFollowUrl,
    deniedFollow,
  );
  const deniedFollowResponse = await request.patch(deniedFollowUrl, {
    headers: selfOnly,
    data: deniedFollow,
  });
  expect(deniedFollowResponse.status(), await deniedFollowResponse.text()).toBe(
    403,
  );

  const financialBefore = await sqlFacts(operatorCase.created.id);
  const refundBefore = await refundStorageFacts(
    operatorCase.created.id,
    `commit-fault-${operatorCase.created.id}`,
  );
  expect(await commandFacts(operatorCase.created.id)).toEqual({
    commands: 0,
    registrations: 0,
    follow_ups: 0,
  });
  const faultInput = {
    itemId: randomUUID(),
    expectedInventoryVersionId: null,
    sourceType: operatorCase.source.type,
    sourceId: operatorCase.source.id,
    party: 'COURT',
    amount: '0.00',
    description: '提交后由数据库故障回滚的合成退费',
    reason: `commit-fault-${operatorCase.created.id}`,
    idempotencyKey: randomUUID(),
  };
  const faultUrl = `/api/v1/cases/litigation-refunds/${operatorCase.created.id}/items`;
  await attachRequest(
    testInfo,
    'commit-fault-refund-request.json',
    'POST',
    faultUrl,
    faultInput,
  );
  const failedAtCommit = await withLitigationRefundCommitFault(
    operatorCase.created.id,
    () => request.post(faultUrl, { headers: operator, data: faultInput }),
  );
  expect(failedAtCommit.status(), await failedAtCommit.text()).toBe(500);
  const missingReceipt = await request.get(
    `/api/v1/cases/litigation-refunds/${operatorCase.created.id}/requests/${encodeURIComponent(faultInput.idempotencyKey)}`,
    { headers: operator },
  );
  expect(missingReceipt.status(), await missingReceipt.text()).toBe(404);
  expect(await commandFacts(operatorCase.created.id)).toEqual({
    commands: 0,
    registrations: 0,
    follow_ups: 0,
  });
  expect(
    await refundStorageFacts(operatorCase.created.id, faultInput.reason),
  ).toEqual(refundBefore);
  expect(await sqlFacts(operatorCase.created.id)).toEqual(financialBefore);

  const recovered = await sendCommand<RefundCommand>(
    request,
    'POST',
    faultUrl,
    faultInput,
    operatorCase.created.id,
    faultInput.idempotencyKey,
  );
  expect(recovered.item).toMatchObject({
    itemId: faultInput.itemId,
    amount: '0.00',
    status: 'PENDING',
    description: faultInput.description,
    source: {
      type: operatorCase.source.type,
      id: operatorCase.source.id,
      trialRoundId: operatorCase.source.trialRoundId,
      valid: true,
    },
  });
  const committedRefundFacts = await refundStorageFacts(
    operatorCase.created.id,
    faultInput.reason,
  );
  expect(await commandFacts(operatorCase.created.id)).toEqual({
    commands: 1,
    registrations: 1,
    follow_ups: 0,
  });
  const recoveredReceipt = await responseJson<RefundCommand>(
    await request.get(
      `/api/v1/cases/litigation-refunds/${operatorCase.created.id}/requests/${encodeURIComponent(faultInput.idempotencyKey)}`,
      { headers: operator },
    ),
  );
  expect(recoveredReceipt).toEqual(recovered);
  const exactReplay = await sendCommand<RefundCommand>(
    request,
    'POST',
    faultUrl,
    faultInput,
    operatorCase.created.id,
    faultInput.idempotencyKey,
  );
  expect(exactReplay).toEqual(recovered);
  expect(
    await refundStorageFacts(operatorCase.created.id, faultInput.reason),
  ).toEqual(committedRefundFacts);
  expect(await sqlFacts(operatorCase.created.id)).toEqual(financialBefore);
  const finalCase = await responseJson<CaseDetail>(
    await request.get(`/api/v1/cases/${operatorCase.created.id}`, {
      headers: operator,
    }),
  );
  expect(finalCase).toMatchObject({
    stage: 'WAITING_JUDGMENT',
    version: operatorCase.judgment.version,
    judgment: { current: { id: operatorCase.judgment.judgmentId } },
  });
});
