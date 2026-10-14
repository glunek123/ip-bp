import { randomUUID } from 'node:crypto';
import { expect, test, type APIResponse } from '@playwright/test';
import {
  coreLeadFixtures,
  resetCoreLeadE2eData,
  setRoleGrant,
} from '../support/core-lead-database.mjs';
import {
  caseArchiveSqlRejection,
  clearCaseArchiveFixture,
  createClosedCaseArchiveSourceThroughApi,
  setCaseArchiveFixtureGrant,
  withCaseArchiveFault,
} from '../support/case-archive-database.mjs';
import {
  clearCaseClosureFixture,
  createFinishedCaseClosureSourceThroughApi,
  setCaseClosureFixtureGrant,
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
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
type Receipt = {
  id: string;
  archiveId: string;
  archiveVersionId: string;
  closureId: string;
  closureVersionId: string;
  stage: 'ARCHIVED';
  version: number;
  recordedAt: string;
};
async function data<T>(r: APIResponse, status = 200): Promise<T> {
  expect(r.status(), await r.text()).toBe(status);
  return r.json() as Promise<T>;
}
async function clean() {
  await clearCaseArchiveFixture();
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

test('archive rechecks independent scope and revoked original keys, keeps old Closure and Finish receipts, and serializes reason corrections', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const source = await createClosedCaseArchiveSourceThroughApi(request, {
    bytes: Buffer.from(
      '%PDF-1.7\nCA017 immutable prior closure bytes\n%%EOF\n',
    ),
  });
  const endpoint = `/api/v1/cases/${source.caseId}/archive`;
  const input = {
    expectedVersion: source.closureResult.version,
    idempotencyKey: randomUUID(),
    expectedClosureVersionId: source.closureResult.closureVersionId,
    archiveAt: today(),
    archiveType: 'EXECUTION_COLLECTED',
    archiveReason: '业务已办完，实际款项未登记，不能由类型推定结清',
  };
  expect(
    (await request.post(endpoint, { headers: operator, data: input })).status(),
  ).toBe(403);
  await setRoleGrant(coreLeadFixtures.roleSelf, 'case.read', 'DEPARTMENT');
  await setCaseArchiveFixtureGrant(
    coreLeadFixtures.roleSelf,
    'case.archive',
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
  await setCaseArchiveFixtureGrant(
    coreLeadFixtures.roleA,
    'case.archive',
    'TEAM',
  );
  for (const patch of [
    { archiveAt: '2026-02-30' },
    { archiveAt: '2999-01-01' },
    { archiveAt: null },
    { archiveType: 'UNKNOWN' },
    { archiveReason: ' ' },
    { unexpectedField: true },
    { expectedClosureVersionId: 'not-a-uuid' },
  ])
    expect(
      (
        await request.post(endpoint, {
          headers: operator,
          data: { ...input, ...patch, idempotencyKey: randomUUID() },
        })
      ).status(),
    ).toBe(400);
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
        data: { ...input, expectedClosureVersionId: randomUUID() },
      })
    ).status(),
  ).toBe(409);
  const archived = await data<Receipt>(
    await request.post(endpoint, { headers: operator, data: input }),
    201,
  );
  expect(archived).toMatchObject({
    id: source.caseId,
    closureId: source.closureResult.closureId,
    closureVersionId: source.closureResult.closureVersionId,
    stage: 'ARCHIVED',
    version: input.expectedVersion + 1,
  });
  expect(
    await data<Receipt>(
      await request.post(endpoint, { headers: operator, data: input }),
      201,
    ),
  ).toEqual(archived);
  expect(
    (
      await data<{ code: string }>(
        await request.post(endpoint, {
          headers: operator,
          data: { ...input, archiveReason: '不同原参' },
        }),
        409,
      )
    ).code,
  ).toBe('IDEMPOTENCY_CONFLICT');
  await setCaseArchiveFixtureGrant(
    coreLeadFixtures.roleA,
    'case.archive',
    'TEAM',
    false,
  );
  expect(
    (await request.post(endpoint, { headers: operator, data: input })).status(),
  ).toBe(403);
  await setCaseArchiveFixtureGrant(
    coreLeadFixtures.roleA,
    'case.archive',
    'TEAM',
  );
  expect(
    await data<Receipt>(
      await request.post(endpoint, { headers: operator, data: input }),
      201,
    ),
  ).toEqual(archived);
  const correction = {
    ...input,
    expectedVersion: archived.version,
    idempotencyKey: randomUUID(),
    expectedArchiveVersionId: archived.archiveVersionId,
    archiveType: 'EXECUTION_CLOSED',
    correctionReason: '保留原归档记录，补充核实分类',
  };
  const correctEndpoint = `/api/v1/cases/${source.caseId}/archive-correction`;
  expect(
    (
      await request.post(correctEndpoint, {
        headers: operator,
        data: correction,
      })
    ).status(),
  ).toBe(403);
  await setCaseArchiveFixtureGrant(
    coreLeadFixtures.roleA,
    'case.archive.correct',
    'TEAM',
  );
  const competing = await Promise.all(
    ['甲', '乙'].map((archiveReason) =>
      request.post(correctEndpoint, {
        headers: operator,
        data: { ...correction, idempotencyKey: randomUUID(), archiveReason },
      }),
    ),
  );
  expect(competing.map((r) => r.status()).sort()).toEqual([201, 409]);
  const detail = await data<{
    stage: string;
    version: number;
    canRecordClosure: boolean;
    canCorrectClosure: boolean;
    archive: {
      closureVersionId: string;
      current: {
        priorVersionId: string;
        fromVersion: number;
        toVersion: number;
      };
      history: unknown[];
    };
    closure: {
      current: {
        id: string;
        closeAt: null;
        closeAmountState: string;
        closeAmt: null;
      };
    };
  }>(
    await request.get(`/api/v1/cases/${source.caseId}`, { headers: operator }),
  );
  expect(detail).toMatchObject({
    stage: 'ARCHIVED',
    version: archived.version + 1,
    canRecordClosure: false,
    canCorrectClosure: false,
    archive: {
      closureVersionId: source.closureResult.closureVersionId,
      current: {
        priorVersionId: archived.archiveVersionId,
        fromVersion: archived.version,
        toVersion: archived.version + 1,
      },
    },
    closure: {
      current: {
        id: source.closureResult.closureVersionId,
        closeAt: null,
        closeAmountState: 'PENDING',
        closeAmt: null,
      },
    },
  });
  expect(detail.archive.history).toHaveLength(2);
  expect(
    await data(
      await request.post(`/api/v1/cases/${source.caseId}/closure`, {
        headers: operator,
        data: source.closureInput,
      }),
      201,
    ),
  ).toEqual(source.closureResult);
  expect(
    await data(
      await request.post(`/api/v1/cases/${source.caseId}/execution-finish`, {
        headers: operator,
        data: source.finishInput,
      }),
      201,
    ),
  ).toEqual(source.finished);
  expect(
    await data<Receipt>(
      await request.post(endpoint, { headers: operator, data: input }),
      201,
    ),
  ).toEqual(archived);
  for (const probe of [
    'case-version-only',
    'version-update',
    'version-delete',
    'receipt-update',
    'receipt-delete',
    'audit-delete',
    'head-foreign-current',
    'head-change-closure',
    'prior-closure-update',
    'prior-document-delete',
    'stage-reopen',
  ] as const) {
    const result = await caseArchiveSqlRejection(source.caseId, probe);
    expect(result.code, probe).not.toBeNull();
    expect(result.unchanged, probe).toBe(true);
  }
});

test('each reached archive and correction write fault rolls back head, history, audit, CAS and receipt; exact original requests then succeed', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const bytes = Buffer.from(
    '%PDF-1.7\nCA017 preserved closure document through faults\n%%EOF\n',
  );
  const source = await createClosedCaseArchiveSourceThroughApi(request, {
    bytes,
    realZero: true,
  });
  await setCaseArchiveFixtureGrant(
    coreLeadFixtures.roleA,
    'case.archive',
    'TEAM',
  );
  await setCaseArchiveFixtureGrant(
    coreLeadFixtures.roleA,
    'case.archive.correct',
    'TEAM',
  );
  const input = {
    expectedVersion: source.closureResult.version,
    idempotencyKey: randomUUID(),
    expectedClosureVersionId: source.closureResult.closureVersionId,
    archiveAt: today(),
    archiveType: 'SETTLEMENT',
    archiveReason: '真实归档原因，与收款独立',
  };
  const endpoint = `/api/v1/cases/${source.caseId}/archive`;
  const post = () => request.post(endpoint, { headers: operator, data: input });
  for (const phase of [
    'audit',
    'head',
    'version',
    'case',
    'receipt',
  ] as const) {
    const result = await withCaseArchiveFault(source.caseId, phase, post);
    expect(result.reached, `archive fault ${phase} reached`).toBe(true);
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.unchanged).toBe(true);
  }
  const receipt = await data<Receipt>(await post(), 201);
  expect(await data<Receipt>(await post(), 201)).toEqual(receipt);
  const correction = {
    ...input,
    expectedVersion: receipt.version,
    idempotencyKey: randomUUID(),
    expectedArchiveVersionId: receipt.archiveVersionId,
    archiveType: 'MEDIATION',
    archiveReason: '真实更正后的归档资料',
    correctionReason: '更正说明不静默覆盖旧版',
  };
  const correct = () =>
    request.post(`/api/v1/cases/${source.caseId}/archive-correction`, {
      headers: operator,
      data: correction,
    });
  for (const phase of [
    'audit',
    'head',
    'version',
    'case',
    'receipt',
  ] as const) {
    const result = await withCaseArchiveFault(source.caseId, phase, correct);
    expect(result.reached, `correction fault ${phase} reached`).toBe(true);
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.unchanged).toBe(true);
  }
  const corrected = await data<Receipt>(await correct(), 201);
  expect(await data<Receipt>(await correct(), 201)).toEqual(corrected);
  expect(corrected.closureVersionId).toBe(
    source.closureResult.closureVersionId,
  );
  expect(corrected.version).toBe(receipt.version + 1);
  expect(source.file).not.toBeNull();
  const file = source.file!;
  const download = await request.get(
    `/api/v1/materials/${file.materialId}/versions/${file.contentVersionId}/content`,
    { headers: operator },
  );
  expect(download.status()).toBe(200);
  expect(Buffer.from(await download.body()).equals(bytes)).toBe(true);
  await setCaseArchiveFixtureGrant(
    coreLeadFixtures.roleA,
    'case.archive.correct',
    'TEAM',
    false,
  );
  expect((await correct()).status()).toBe(403);
  const retained = await data<{
    archive: { history: unknown[]; current: { id: string } };
  }>(
    await request.get(`/api/v1/cases/${source.caseId}`, { headers: operator }),
  );
  expect(retained.archive.history).toHaveLength(2);
  expect(retained.archive.current.id).toBe(corrected.archiveVersionId);
});

test('archive requires exact registered current closure and accepts the six classifications without deriving finance', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const source = await createFinishedCaseClosureSourceThroughApi(request);
  await setCaseArchiveFixtureGrant(
    coreLeadFixtures.roleA,
    'case.archive',
    'TEAM',
  );
  const endpoint = `/api/v1/cases/${source.caseId}/archive`;
  const input = {
    expectedVersion: source.finished.version,
    idempotencyKey: randomUUID(),
    expectedClosureVersionId: randomUUID(),
    archiveAt: today(),
    archiveType: 'VOIDED',
    archiveReason: '分类只记录业务，不删除原事实',
  };
  expect(
    (await request.post(endpoint, { headers: operator, data: input })).status(),
  ).toBe(409);
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleA,
    'case.closure.record',
    'TEAM',
  );
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleA,
    'case.closure.correct',
    'TEAM',
  );
  const closureInput = {
    expectedVersion: source.finished.version,
    idempotencyKey: randomUUID(),
    expectedFinishId: source.finished.finishId,
    closeAt: null,
    closeAmountState: 'PENDING',
    closeAmt: null,
    note: null,
    closeContentVersionIds: [],
  };
  const first = await data<{ version: number; closureVersionId: string }>(
    await request.post(`/api/v1/cases/${source.caseId}/closure`, {
      headers: operator,
      data: closureInput,
    }),
    201,
  );
  const current = await data<{ version: number; closureVersionId: string }>(
    await request.post(`/api/v1/cases/${source.caseId}/closure-correction`, {
      headers: operator,
      data: {
        ...closureInput,
        expectedVersion: first.version,
        idempotencyKey: randomUUID(),
        expectedClosureVersionId: first.closureVersionId,
        correctionReason: '更正当前结案说明',
        note: '准确当前版本',
      },
    }),
    201,
  );
  expect(
    (
      await request.post(endpoint, {
        headers: operator,
        data: {
          ...input,
          expectedVersion: current.version,
          expectedClosureVersionId: first.closureVersionId,
        },
      })
    ).status(),
  ).toBe(409);
  let receipt = await data<Receipt>(
    await request.post(endpoint, {
      headers: operator,
      data: {
        ...input,
        expectedVersion: current.version,
        expectedClosureVersionId: current.closureVersionId,
      },
    }),
    201,
  );
  await setCaseArchiveFixtureGrant(
    coreLeadFixtures.roleA,
    'case.archive.correct',
    'TEAM',
  );
  for (const archiveType of [
    'SETTLEMENT',
    'MEDIATION',
    'JUDGMENT_PERFORMED',
    'EXECUTION_COLLECTED',
    'EXECUTION_CLOSED',
  ]) {
    receipt = await data<Receipt>(
      await request.post(`/api/v1/cases/${source.caseId}/archive-correction`, {
        headers: operator,
        data: {
          ...input,
          expectedVersion: receipt.version,
          idempotencyKey: randomUUID(),
          expectedClosureVersionId: current.closureVersionId,
          expectedArchiveVersionId: receipt.archiveVersionId,
          archiveType,
          correctionReason: `精确分类更正 ${archiveType}`,
        },
      }),
      201,
    );
    expect(receipt.stage).toBe('ARCHIVED');
    expect(receipt.closureVersionId).toBe(current.closureVersionId);
  }
  const detail = await data<{
    archive: { history: unknown[] };
    closure: {
      current: { id: string; closeAmountState: string; closeAmt: null };
    };
  }>(
    await request.get(`/api/v1/cases/${source.caseId}`, { headers: operator }),
  );
  expect(detail.archive.history).toHaveLength(6);
  expect(detail.closure.current).toMatchObject({
    id: current.closureVersionId,
    closeAmountState: 'PENDING',
    closeAmt: null,
  });
});
