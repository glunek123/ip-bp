import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test, type APIResponse } from '@playwright/test';
import {
  coreLeadFixtures,
  seedCoreLeadE2eData,
  setRoleGrant,
} from '../support/core-lead-database.mjs';
import { prepareCaseFilingFixture } from '../support/case-filing-database.mjs';
import { prepareCaseAcceptanceFixture } from '../support/case-acceptance-database.mjs';
import { allowOtherEnterpriseAccountSetup } from '../support/case-complaint-mailing-database.mjs';
import {
  createSubmittedCaseThroughApi,
  uploadCaseConfirmationFile,
} from '../support/case-complaint-confirmation-database.mjs';
import { createLawyerAccountThroughApi } from '../support/case-lawyer-account.mjs';
import { setCaseClosureFixtureGrant } from '../support/case-closure-database.mjs';
import { disconnectCustomerTestDatabase } from '../support/customer-database.mjs';

const owner = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const backend = createRequire(resolve(process.cwd(), 'backend/package.json'));
const { unzipSync, strFromU8 } = backend('fflate') as {
  unzipSync: (bytes: Uint8Array) => Record<string, Uint8Array>;
  strFromU8: (bytes: Uint8Array) => string;
};
const { Client } = backend('pg') as {
  Client: new (options: { connectionString: string }) => {
    connect(): Promise<void>;
    query<T>(sql: string, values: string[]): Promise<{ rows: T[] }>;
    end(): Promise<void>;
  };
};
type Facts = {
  stage: string;
  version: number;
  assignmentCount: number;
  receiptCount: number;
  assignmentAuditCount: number;
  matchCount: number;
  earlyCount: number;
  closureCount: number;
  lawyerProfileId: string | null;
};
async function facts(caseId: string): Promise<Facts> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || process.env.NODE_ENV !== 'test')
    throw new Error('Isolated test database required');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query<Facts>(
      `SELECT c.stage,c.version,
      (SELECT count(*)::int FROM case_lawyer_assignments a WHERE a.case_id=c.id AND a.role='PRIMARY' AND a.ended_at IS NULL) AS "assignmentCount",
      (SELECT count(*)::int FROM case_lawyer_assignment_receipts r WHERE r.case_id=c.id) AS "receiptCount",
      (SELECT count(*)::int FROM audit_events e WHERE e.resource_id=c.id AND e.action='case.lawyer.assign.succeeded') AS "assignmentAuditCount",
      (SELECT count(*)::int FROM case_match_receipts m WHERE m.case_id=c.id) AS "matchCount",
      (SELECT count(*)::int FROM case_early_closures e WHERE e.case_id=c.id) AS "earlyCount",
      (SELECT count(*)::int FROM case_closures h WHERE h.case_id=c.id) AS "closureCount",
      (SELECT a.lawyer_id FROM case_lawyer_assignments a WHERE a.case_id=c.id AND a.role='PRIMARY' AND a.ended_at IS NULL LIMIT 1) AS "lawyerProfileId"
      FROM cases c WHERE c.id=$1::uuid`,
      [caseId],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!;
  } finally {
    await client.end();
  }
}
async function body<T>(response: APIResponse, status: number): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json() as Promise<T>;
}
test.afterAll(disconnectCustomerTestDatabase);

test('assignment keeps a normal source usable for match and early closure', async ({
  request,
}) => {
  test.setTimeout(180_000);
  // Retain the synthetic cases: older reset helpers do not know this receipt chain.
  await seedCoreLeadE2eData({ reuseExisting: true });
  await prepareCaseFilingFixture();
  await prepareCaseAcceptanceFixture();
  await allowOtherEnterpriseAccountSetup();
  await setRoleGrant(
    coreLeadFixtures.roleA,
    'case.lawyer.assign',
    'DEPARTMENT',
  );
  await setRoleGrant(coreLeadFixtures.roleA, 'case.export', 'DEPARTMENT');
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleA,
    'case.closure.record',
    'DEPARTMENT',
  );
  const lawyer = await createLawyerAccountThroughApi(request, {
    fullName: '分配后承办律师',
  });

  const matching = await createSubmittedCaseThroughApi(request, {
    stopAtPendingMatch: true,
  });
  const assignKey = randomUUID();
  const assigned = await body<{
    outcome: string;
    version: number;
    currentAssignment: { lawyerProfileId: string };
  }>(
    await request.post(`/api/v1/cases/${matching.caseId}/lawyer-assignment`, {
      headers: { ...owner, 'Idempotency-Key': assignKey },
      data: {
        expectedVersion: 1,
        idempotencyKey: assignKey,
        lawyerAccountId: lawyer.id,
      },
    }),
    201,
  );
  expect(assigned).toMatchObject({ outcome: 'ASSIGNED', version: 2 });
  expect(await facts(matching.caseId)).toMatchObject({
    stage: 'PENDING_MATCH',
    version: 2,
    assignmentCount: 1,
    receiptCount: 1,
    assignmentAuditCount: 1,
    matchCount: 0,
    earlyCount: 0,
    lawyerProfileId: assigned.currentAssignment.lawyerProfileId,
  });
  expect(
    await body(
      await request.post(`/api/v1/cases/${matching.caseId}/lawyer-assignment`, {
        headers: { ...owner, 'Idempotency-Key': assignKey },
        data: {
          expectedVersion: 1,
          idempotencyKey: assignKey,
          lawyerAccountId: lawyer.id,
        },
      }),
      201,
    ),
  ).toEqual(assigned);
  expect(await facts(matching.caseId)).toMatchObject({
    assignmentCount: 1,
    receiptCount: 1,
    assignmentAuditCount: 1,
  });
  const lawyerSession = await body<{ csrfToken: string }>(
    await request.post('/api/v1/auth/login', {
      headers: { Origin: 'http://127.0.0.1:5174' },
      data: { username: lawyer.username, password: lawyer.password },
    }),
    200,
  );
  expect(lawyerSession.csrfToken).toEqual(expect.any(String));
  expect(
    await body<{ id: string; stage: string }>(
      await request.get(`/api/v1/lawyer/cases/${matching.caseId}`),
      200,
    ),
  ).toMatchObject({ id: matching.caseId, stage: 'PENDING_MATCH' });
  const matched = await body<{ stage: string; version: number }>(
    await request.post(`/api/v1/cases/${matching.caseId}/match`, {
      headers: owner,
      data: {
        expectedVersion: assigned.version,
        idempotencyKey: randomUUID(),
        matchedOn: '2026-09-28',
        defendants: [{ kind: 'ORGANIZATION', name: '分配后匹配被告' }],
        lawyerAccountId: lawyer.id,
      },
    }),
    201,
  );
  expect(matched).toMatchObject({ stage: 'WAITING_COMPLAINT', version: 3 });
  expect(await facts(matching.caseId)).toMatchObject({
    stage: 'WAITING_COMPLAINT',
    version: 3,
    assignmentCount: 1,
    receiptCount: 1,
    assignmentAuditCount: 1,
    matchCount: 1,
  });
  const otherLawyer = await createLawyerAccountThroughApi(request, {
    fullName: '未承办律师',
  });
  await body(
    await request.post('/api/v1/auth/login', {
      headers: { Origin: 'http://127.0.0.1:5174' },
      data: { username: otherLawyer.username, password: otherLawyer.password },
    }),
    200,
  );
  expect([403, 404]).toContain(
    (await request.get(`/api/v1/lawyer/cases/${matching.caseId}`)).status(),
  );
  expect(
    await body<{ id: string; stage: string; version: number }>(
      await request.get(`/api/v1/cases/${matching.caseId}`, { headers: owner }),
      200,
    ),
  ).toMatchObject({
    id: matching.caseId,
    stage: 'WAITING_COMPLAINT',
    version: 3,
  });
  const complaint = await uploadCaseConfirmationFile(request, matching.caseId);
  const preview = await body<{
    items: Array<{
      status: string;
      candidates: Array<{ materialId: string; contentVersionId: string }>;
    }>;
  }>(
    await request.post('/api/v1/cases/complaint-export/preview', {
      headers: owner,
      data: { caseIds: [matching.caseId] },
    }),
    200,
  );
  expect(preview.items[0]).toMatchObject({
    status: 'READY',
    candidates: [{ contentVersionId: complaint.contentVersionId }],
  });
  const chosen = preview.items[0]!.candidates.find(
    (item) => item.contentVersionId === complaint.contentVersionId,
  )!;
  const zip = await request.post('/api/v1/cases/complaint-export/download', {
    headers: owner,
    data: {
      selections: [
        {
          caseId: matching.caseId,
          materialId: chosen.materialId,
          contentVersionId: chosen.contentVersionId,
        },
      ],
    },
  });
  expect(zip.status(), await zip.text()).toBe(200);
  expect(zip.headers()['content-type']).toContain('application/zip');
  const entries = unzipSync(new Uint8Array(await zip.body()));
  const manifest = JSON.parse(strFromU8(entries['manifest.json']!)) as {
    files: Array<{ contentVersionId: string; status: string }>;
  };
  expect(manifest.files).toMatchObject([
    { contentVersionId: complaint.contentVersionId, status: 'SUCCESS' },
  ]);
  const absentVersions = [randomUUID(), randomUUID()];
  const emptyZip = await request.post(
    '/api/v1/cases/complaint-export/download',
    {
      headers: owner,
      data: {
        selections: absentVersions.map((contentVersionId) => ({
          caseId: matching.caseId,
          materialId: chosen.materialId,
          contentVersionId,
        })),
      },
    },
  );
  expect(emptyZip.status(), await emptyZip.text()).toBe(409);
  expect(emptyZip.headers()['content-type']).toContain('application/json');
  expect(await emptyZip.json()).toMatchObject({
    code: 'CASE_EXPORT_EMPTY',
    details: {
      files: absentVersions.map((contentVersionId) => ({
        caseId: matching.caseId,
        materialId: chosen.materialId,
        contentVersionId,
        filename: null,
        reason: 'VERSION_UNAVAILABLE',
      })),
    },
  });

  const closing = await createSubmittedCaseThroughApi(request, {
    stopAtPendingMatch: true,
  });
  const closeAssignKey = randomUUID();
  const assignedToClose = await body<{ outcome: string; version: number }>(
    await request.post(`/api/v1/cases/${closing.caseId}/lawyer-assignment`, {
      headers: { ...owner, 'Idempotency-Key': closeAssignKey },
      data: {
        expectedVersion: 1,
        idempotencyKey: closeAssignKey,
        lawyerAccountId: lawyer.id,
      },
    }),
    201,
  );
  expect(assignedToClose).toMatchObject({ outcome: 'ASSIGNED', version: 2 });
  expect(await facts(closing.caseId)).toMatchObject({
    stage: 'PENDING_MATCH',
    version: 2,
    assignmentCount: 1,
    receiptCount: 1,
    assignmentAuditCount: 1,
    earlyCount: 0,
  });
  const closeAt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const closed = await body<{ stage: string; version: number }>(
    await request.post(`/api/v1/cases/${closing.caseId}/early-closure`, {
      headers: owner,
      data: {
        expectedVersion: assignedToClose.version,
        expectedStage: 'PENDING_MATCH',
        idempotencyKey: randomUUID(),
        closeAt,
        closeAmountState: 'PENDING',
        closeAmt: null,
        closeContentVersionIds: [],
        paymentType: 'ONE_TIME',
        paymentRecords: [],
      },
    }),
    201,
  );
  expect(closed).toMatchObject({ stage: 'WAITING_ARCHIVE', version: 4 });
  expect(await facts(closing.caseId)).toMatchObject({
    stage: 'WAITING_ARCHIVE',
    version: 4,
    assignmentCount: 1,
    receiptCount: 1,
    assignmentAuditCount: 1,
    earlyCount: 1,
    closureCount: 1,
  });
  expect(
    await body(
      await request.post(`/api/v1/cases/${closing.caseId}/lawyer-assignment`, {
        headers: { ...owner, 'Idempotency-Key': closeAssignKey },
        data: {
          expectedVersion: 1,
          idempotencyKey: closeAssignKey,
          lawyerAccountId: lawyer.id,
        },
      }),
      201,
    ),
  ).toEqual(assignedToClose);
  expect(await facts(closing.caseId)).toMatchObject({
    assignmentCount: 1,
    receiptCount: 1,
    assignmentAuditCount: 1,
    earlyCount: 1,
    closureCount: 1,
  });
  expect(
    await body<{ id: string; stage: string; version: number }>(
      await request.get(`/api/v1/cases/${closing.caseId}`, { headers: owner }),
      200,
    ),
  ).toMatchObject({ id: closing.caseId, stage: 'WAITING_ARCHIVE', version: 4 });
  expect(
    await body<{
      caseId: string;
      caseVersion: number;
      closure: { versionId: string };
    }>(
      await request.get(`/api/v1/cases/${closing.caseId}/closure-workspace`, {
        headers: owner,
      }),
      200,
    ),
  ).toMatchObject({
    caseId: closing.caseId,
    caseVersion: 4,
    closure: { versionId: expect.any(String) },
  });
});
