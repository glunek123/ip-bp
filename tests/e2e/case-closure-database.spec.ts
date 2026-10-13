import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  coreLeadFixtures,
  resetCoreLeadE2eData,
  setRoleGrant,
} from '../support/core-lead-database.mjs';
import {
  caseClosureSqlRejection,
  clearCaseClosureFixture,
  createFinishedCaseClosureSourceThroughApi,
  setCaseClosureFixtureGrant,
  withCaseClosureFault,
} from '../support/case-closure-database.mjs';
import { clearCaseExecutionFinishFixture } from '../support/case-execution-finish-database.mjs';
import {
  allowOtherEnterpriseAccountSetup,
  clearCaseComplaintMailingFixture,
} from '../support/case-complaint-mailing-database.mjs';
import {
  clearCaseAcceptanceFault,
  clearCaseAcceptanceFixture,
  prepareCaseAcceptanceFixture,
} from '../support/case-acceptance-database.mjs';
import {
  clearCaseFilingFixture,
  prepareCaseFilingFixture,
} from '../support/case-filing-database.mjs';
import { clearCoreCaseSecondInstanceFixture } from '../support/case-second-instance-database.mjs';
import {
  clearCoreCaseHearingAdmin,
  clearCoreCaseHearingAdminSessions,
} from '../support/case-hearing-database.mjs';
import { disconnectCustomerTestDatabase } from '../support/customer-database.mjs';

const operator = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const self = { Authorization: `Bearer ${coreLeadFixtures.tokenSelf}` };
const foreign = { Authorization: `Bearer ${coreLeadFixtures.tokenB}` };
type Receipt = {
  id: string;
  closureId: string;
  closureVersionId: string;
  finishId: string;
  stage: string;
  version: number;
  recordedAt: string;
};
async function data<T>(
  response: Awaited<ReturnType<APIRequestContext['get']>>,
  status = 200,
): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json() as Promise<T>;
}
async function clean() {
  await clearCaseClosureFixture();
  await clearCaseExecutionFinishFixture();
  await clearCoreCaseHearingAdminSessions();
  await clearCaseAcceptanceFault();
  await clearCoreCaseSecondInstanceFixture();
  await clearCaseAcceptanceFixture();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
  await resetCoreLeadE2eData();
  await clearCoreCaseHearingAdmin();
}
test.beforeEach(async () => {
  await clean();
  await prepareCaseFilingFixture();
  await prepareCaseAcceptanceFixture();
  await allowOtherEnterpriseAccountSetup();
});
test.afterEach(clean);
test.afterAll(disconnectCustomerTestDatabase);

test('closure rechecks independent scope and revoked original keys, rejects stale anchors and malformed inputs, and serializes competing corrections', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const source = await createFinishedCaseClosureSourceThroughApi(request);
  const endpoint = `/api/v1/cases/${source.caseId}/closure`;
  const input = {
    expectedVersion: source.finished.version,
    idempotencyKey: randomUUID(),
    expectedFinishId: source.finished.finishId,
    closeAt: null,
    closeAmountState: 'PENDING',
    closeAmt: null,
    note: null,
    closeContentVersionIds: [],
  };
  expect(
    (await request.post(endpoint, { headers: operator, data: input })).status(),
  ).toBe(403);
  await setRoleGrant(coreLeadFixtures.roleSelf, 'case.read', 'DEPARTMENT');
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleSelf,
    'case.closure.record',
    'SELF',
  );
  expect(
    (
      await request.get(`/api/v1/cases/${source.caseId}`, { headers: self })
    ).status(),
  ).toBe(200);
  expect(
    (await request.post(endpoint, { headers: self, data: input })).status(),
  ).toBe(403);
  expect(
    (
      await request.get(`/api/v1/cases/${source.caseId}`, { headers: foreign })
    ).status(),
  ).toBe(404);
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleA,
    'case.closure.record',
    'TEAM',
  );
  for (const patch of [
    { closeAt: '2026-02-30' },
    { closeAt: '2999-01-01' },
    { closeAmountState: 'KNOWN', closeAmt: '-0.01' },
    { closeAmountState: 'KNOWN', closeAmt: '100000000000000.00' },
    { closeAmountState: 'PENDING', closeAmt: '0.00' },
    { note: ' ' },
    { unexpectedField: true },
    { closeContentVersionIds: [randomUUID(), randomUUID()] },
  ]) {
    const response = await request.post(endpoint, {
      headers: operator,
      data: { ...input, ...patch, idempotencyKey: randomUUID() },
    });
    expect(response.status()).toBe(400);
  }
  expect(
    (
      await request.post(endpoint, {
        headers: operator,
        data: { ...input, expectedVersion: input.expectedVersion - 1 },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.post(endpoint, {
        headers: operator,
        data: { ...input, expectedFinishId: randomUUID() },
      })
    ).status(),
  ).toBe(409);
  const receipt = await data<Receipt>(
    await request.post(endpoint, { headers: operator, data: input }),
    201,
  );
  expect(
    await data<Receipt>(
      await request.post(endpoint, { headers: operator, data: input }),
      201,
    ),
  ).toEqual(receipt);
  const conflict = await data<{ code: string }>(
    await request.post(endpoint, {
      headers: operator,
      data: { ...input, note: '不同原参' },
    }),
    409,
  );
  expect(conflict.code).toBe('IDEMPOTENCY_CONFLICT');
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleA,
    'case.closure.record',
    'TEAM',
    false,
  );
  expect(
    (await request.post(endpoint, { headers: operator, data: input })).status(),
  ).toBe(403);
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleA,
    'case.closure.record',
    'TEAM',
  );
  expect(
    await data<Receipt>(
      await request.post(endpoint, { headers: operator, data: input }),
      201,
    ),
  ).toEqual(receipt);
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleA,
    'case.closure.correct',
    'TEAM',
  );
  const correction = {
    ...input,
    expectedVersion: receipt.version,
    expectedClosureVersionId: receipt.closureVersionId,
    closeAmountState: 'KNOWN',
    closeAmt: '0.00',
    correctionReason: '合成验收真实原因更正',
  };
  const correctedEndpoint = `/api/v1/cases/${source.caseId}/closure-correction`;
  const competing = await Promise.all(
    ['甲', '乙'].map((note) =>
      request.post(correctedEndpoint, {
        headers: operator,
        data: { ...correction, idempotencyKey: randomUUID(), note },
      }),
    ),
  );
  expect(competing.map((item) => item.status()).sort()).toEqual([201, 409]);
  const detail = await data<{
    stage: string;
    version: number;
    closure: { current: { closeAmt: string }; history: unknown[] };
  }>(
    await request.get(`/api/v1/cases/${source.caseId}`, { headers: operator }),
  );
  expect(detail).toMatchObject({
    stage: 'WAITING_ARCHIVE',
    version: receipt.version + 1,
    closure: { current: { closeAmt: '0.00' } },
  });
  expect(detail.closure.history).toHaveLength(2);
  for (const probe of [
    'case-version-only',
    'version-update',
    'version-delete',
    'receipt-update',
    'receipt-delete',
    'audit-delete',
    'head-foreign-current',
  ] as const) {
    const result = await caseClosureSqlRejection(source.caseId, probe);
    expect(result.code).not.toBeNull();
    expect(result.unchanged).toBe(true);
  }
});

test('each reached closure write fault rolls back facts, audit, exact references, head, CAS and receipt; the original request can then succeed', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const source = await createFinishedCaseClosureSourceThroughApi(request);
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleA,
    'case.closure.record',
    'TEAM',
  );
  const bytes = Buffer.from(
    '%PDF-1.7\nCA016 atomic closure exact version\n%%EOF\n',
  );
  const draft = await data<{ id: string }>(
    await request.post('/api/v1/materials/upload-drafts', {
      headers: operator,
      data: {
        ownerType: 'CASE',
        ownerId: source.caseId,
        category: 'CASE_CLOSURE_DOCUMENT',
        purpose: 'CASE_CLOSURE_DOCUMENT',
        originalFilename: 'closure-atomic.pdf',
        declaredMimeType: 'application/pdf',
      },
    }),
    201,
  );
  const file = await data<{ materialId: string; contentVersionId: string }>(
    await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
      headers: { ...operator, 'Content-Type': 'application/octet-stream' },
      data: bytes,
    }),
  );
  const input = {
    expectedVersion: source.finished.version,
    idempotencyKey: randomUUID(),
    expectedFinishId: source.finished.finishId,
    closeAt: null,
    closeAmountState: 'KNOWN',
    closeAmt: '0.00',
    note: '真实零金额与原版附件',
    closeContentVersionIds: [file.contentVersionId],
  };
  const post = () =>
    request.post(`/api/v1/cases/${source.caseId}/closure`, {
      headers: operator,
      data: input,
    });
  for (const phase of [
    'audit',
    'head',
    'version',
    'document',
    'reference',
    'case',
    'receipt',
  ] as const) {
    const result = await withCaseClosureFault(source.caseId, phase, post);
    expect(result.reached, `fault ${phase} was actually reached`).toBe(true);
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.unchanged).toBe(true);
  }
  const receipt = await data<Receipt>(await post(), 201);
  expect(await data<Receipt>(await post(), 201)).toEqual(receipt);
  const immutable = await caseClosureSqlRejection(
    source.caseId,
    'document-delete',
  );
  expect(immutable.code).not.toBeNull();
  expect(immutable.unchanged).toBe(true);
  const downloaded = await request.get(
    `/api/v1/materials/${file.materialId}/versions/${file.contentVersionId}/content`,
    { headers: operator },
  );
  expect(downloaded.status()).toBe(200);
  expect(Buffer.from(await downloaded.body()).equals(bytes)).toBe(true);
});
