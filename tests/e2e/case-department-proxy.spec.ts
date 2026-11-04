import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test, type APIResponse } from '@playwright/test';
import {
  coreLeadFixtures,
  seedCoreLeadE2eData,
  setRoleGrant,
} from '../support/core-lead-database.mjs';
import {
  createFinishedCaseClosureSourceThroughApi,
  setCaseClosureFixtureGrant,
  withCaseClosureFault,
} from '../support/case-closure-database.mjs';
import { prepareCaseFilingFixture } from '../support/case-filing-database.mjs';
import { prepareCaseAcceptanceFixture } from '../support/case-acceptance-database.mjs';
import { createSubmittedCaseThroughApi } from '../support/case-complaint-confirmation-database.mjs';
import { allowOtherEnterpriseAccountSetup } from '../support/case-complaint-mailing-database.mjs';
import { disconnectCustomerTestDatabase } from '../support/customer-database.mjs';
import { setCaseExternalEntryGrant } from '../support/case-external-entry-database.mjs';
import { batch2SyntheticPdf } from '../support/batch2-synthetic-pdf.mjs';

const owner = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const colleague = { Authorization: `Bearer ${coreLeadFixtures.tokenSelf}` };
const foreign = { Authorization: `Bearer ${coreLeadFixtures.tokenB}` };
const requireBackend = createRequire(
  resolve(process.cwd(), 'backend/package.json'),
);
const { Client } = requireBackend('pg');
const { validateIsolatedTestDatabaseUrl } = requireBackend(
  '../scripts/test-environment.mjs',
) as {
  validateIsolatedTestDatabaseUrl: (value: string | undefined) => void;
};
async function body<T>(response: APIResponse, status: number): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json() as Promise<T>;
}

test.afterAll(disconnectCustomerTestDatabase);

test('department proxy settlement is scoped, revocable, and cannot correct closure alone', async ({
  request,
}) => {
  test.setTimeout(180_000);
  // This one-time fixture deliberately retains its synthetic API-created case.
  // The legacy reset helper cannot tear down the newer financial source chain.
  await seedCoreLeadE2eData({ reuseExisting: true });
  await prepareCaseFilingFixture();
  await prepareCaseAcceptanceFixture();
  await allowOtherEnterpriseAccountSetup();
  const source = await createFinishedCaseClosureSourceThroughApi(request);
  const closeAt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleA,
    'case.closure.record',
    'TEAM',
  );
  const closure = await body<{ version: number; closureVersionId: string }>(
    await request.post(`/api/v1/cases/${source.caseId}/closure`, {
      headers: owner,
      data: {
        expectedVersion: source.finished.version,
        expectedFinishId: source.finished.finishId,
        idempotencyKey: randomUUID(),
        closeAt,
        closeAmountState: 'PENDING',
        closeAmt: null,
        note: null,
        closeContentVersionIds: [],
      },
    }),
    201,
  );
  await setRoleGrant(coreLeadFixtures.roleSelf, 'case.read', 'DEPARTMENT');
  await setRoleGrant(
    coreLeadFixtures.roleSelf,
    'case.routine.edit',
    'DEPARTMENT',
    false,
  );
  const routineUrl = `/api/v1/cases/${source.caseId}/routine-profile`;
  const routine = await body<{
    revision: number;
    canEdit: boolean;
    products: Array<{
      id: string;
      title: string | null;
      url: string | null;
      quantity: number;
      unitPrice: string;
    }>;
  }>(await request.get(routineUrl, { headers: colleague }), 200);
  expect(routine.canEdit).toBe(false);
  await setRoleGrant(coreLeadFixtures.roleSelf, 'case.routine.edit', 'SELF');
  expect(
    (
      await body<{ canEdit: boolean }>(
        await request.get(routineUrl, { headers: colleague }),
        200,
      )
    ).canEdit,
  ).toBe(false);
  await setRoleGrant(
    coreLeadFixtures.roleSelf,
    'case.routine.edit',
    'DEPARTMENT',
  );
  expect(
    (
      await body<{ canEdit: boolean }>(
        await request.get(routineUrl, { headers: colleague }),
        200,
      )
    ).canEdit,
  ).toBe(true);
  await body(
    await request.patch(routineUrl, {
      headers: colleague,
      data: {
        expectedRevision: routine.revision,
        shopName: '合成案件代办店铺',
        remark: '本部门指定代办已编辑普通资料',
        products: routine.products.map(
          ({ id, title, url, quantity, unitPrice }) => ({
            id,
            title,
            url,
            quantity,
            unitPrice,
          }),
        ),
      },
    }),
    200,
  );
  await setRoleGrant(
    coreLeadFixtures.roleSelf,
    'case.routine.edit',
    'DEPARTMENT',
    false,
  );
  expect(
    (
      await body<{ canEdit: boolean }>(
        await request.get(routineUrl, { headers: colleague }),
        200,
      )
    ).canEdit,
  ).toBe(false);
  const endpoint = `/api/v1/cases/${source.caseId}/closure-settlement-updates`;
  const workspace = await body<{
    refund: { versionId: string | null };
    assessment: { versionId: string | null; termsVersion: number | null };
  }>(
    await request.get(`/api/v1/cases/${source.caseId}/closure-workspace`, {
      headers: owner,
    }),
    200,
  );
  const command = {
    expectedVersion: closure.version,
    expectedClosureVersionId: closure.closureVersionId,
    idempotencyKey: randomUUID(),
    closeAt,
    closeAmountState: 'KNOWN',
    closeAmt: '0.00',
    closeContentVersionIds: [],
    paymentType: 'ONE_TIME',
    paymentRecords: [],
    correctionReason: '合成代理结算完整性确认',
    refund: {
      expectedVersionId: workspace.refund.versionId,
      kind: 'DECLARE_NOT_APPLICABLE',
      items: [],
    },
    settlement: {
      expectedAssessmentVersionId: workspace.assessment.versionId,
      expectedTermsVersion: workspace.assessment.termsVersion,
      declaration: 'NOT_APPLICABLE',
    },
  };
  expect(
    (
      await request.post(endpoint, { headers: colleague, data: command })
    ).status(),
  ).toBe(403);
  await setRoleGrant(
    coreLeadFixtures.roleSelf,
    'case.closure.settlement.update',
    'SELF',
  );
  expect(
    (
      await request.post(endpoint, { headers: colleague, data: command })
    ).status(),
  ).toBe(403);
  await setRoleGrant(
    coreLeadFixtures.roleSelf,
    'case.closure.settlement.update',
    'DEPARTMENT',
  );
  expect(
    (
      await request.post(endpoint, {
        headers: colleague,
        data: {
          ...command,
          idempotencyKey: randomUUID(),
          refund: undefined,
          settlement: undefined,
          correctionReason: '仅改日期的异常更正',
        },
      })
    ).status(),
  ).toBe(403);
  for (const changed of [
    { closeAt: null },
    { closeContentVersionIds: [randomUUID()] },
  ]) {
    expect(
      (
        await request.post(endpoint, {
          headers: colleague,
          data: { ...command, ...changed, idempotencyKey: randomUUID() },
        })
      ).status(),
    ).toBe(403);
  }
  const committed = await body<{
    version: number;
    closureVersionId: string;
    refundInventoryVersionId: string;
    settlementAssessmentVersionId: string;
  }>(await request.post(endpoint, { headers: colleague, data: command }), 201);
  expect(committed.version).toBe(closure.version + 1);
  expect(committed.refundInventoryVersionId).toEqual(expect.any(String));
  expect(committed.settlementAssessmentVersionId).toEqual(expect.any(String));
  const paid = await body<{ version: number }>(
    await request.post(endpoint, {
      headers: colleague,
      data: {
        ...command,
        idempotencyKey: randomUUID(),
        expectedVersion: committed.version,
        expectedClosureVersionId: committed.closureVersionId,
        closeAmt: '10.00',
        correctionReason: '合成代办补录首笔付款',
        refund: undefined,
        settlement: undefined,
        paymentRecords: [
          {
            paidOn: command.closeAt,
            amount: '10.00',
            payer: '合成付款人',
            payee: '合成收款人',
            screenshotContentVersionId: null,
          },
        ],
      },
    }),
    201,
  );
  expect(paid.version).toBe(committed.version + 1);
  const proof = {
    ownerType: 'CASE',
    ownerId: source.caseId,
    category: 'CASE_CLOSURE_PAYMENT_PROOF',
    purpose: 'CASE_CLOSURE_PAYMENT_PROOF',
    originalFilename: `proxy-payment-${randomUUID()}.png`,
    declaredMimeType: 'image/png',
  };
  const draft = await body<{ id: string }>(
    await request.post('/api/v1/materials/upload-drafts', {
      headers: colleague,
      data: proof,
    }),
    201,
  );
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5b8AAAAASUVORK5CYII=',
    'base64',
  );
  await body(
    await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
      headers: { ...colleague, 'Content-Type': 'application/octet-stream' },
      data: png,
    }),
    200,
  );
  await setRoleGrant(
    coreLeadFixtures.roleSelf,
    'case.closure.settlement.update',
    'DEPARTMENT',
    false,
  );
  expect(
    (
      await request.post(endpoint, { headers: colleague, data: command })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post('/api/v1/materials/upload-drafts', {
        headers: colleague,
        data: {
          ...proof,
          originalFilename: `proxy-payment-revoked-${randomUUID()}.png`,
        },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.get(`/api/v1/cases/${source.caseId}`, { headers: foreign })
    ).status(),
  ).toBe(404);
});

test('department proxy early closure retains first payment and proof upload needs its own grant', async ({
  request,
}) => {
  test.setTimeout(120_000);
  await seedCoreLeadE2eData({ reuseExisting: true });
  await setCaseExternalEntryGrant(
    coreLeadFixtures.roleA,
    'case.external-entry.create',
    'TEAM',
    true,
  );
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const created = await body<{ id: string; version: number; stage: string }>(
    await request.post('/api/v1/cases/external-entries', {
      headers: owner,
      data: {
        idempotencyKey: randomUUID(),
        entryKind: 'EXTERNAL_TRANSFER',
        initialStage: 'PENDING_MATCH',
        stageReachedOn: today,
        source: `proxy-early-${randomUUID()}`,
        reason: '合成外部案件转入后本部门代办提前结案',
        customerId: coreLeadFixtures.admittedCustomer,
        rightsHolderId: coreLeadFixtures.holder,
        defendants: [],
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
  await setRoleGrant(coreLeadFixtures.roleSelf, 'case.read', 'DEPARTMENT');
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleSelf,
    'case.closure.record',
    'DEPARTMENT',
    false,
  );
  const endpoint = `/api/v1/cases/${created.id}/early-closure`;
  const command = {
    expectedVersion: created.version,
    expectedStage: created.stage,
    idempotencyKey: randomUUID(),
    closeAt: today,
    closeAmountState: 'KNOWN',
    closeAmt: '10.00',
    closeContentVersionIds: [],
    paymentType: 'ONE_TIME',
    paymentRecords: [
      {
        paidOn: today,
        amount: '10.00',
        payer: '合成付款人',
        payee: '合成收款人',
        screenshotContentVersionId: null,
      },
    ],
  };
  expect(
    (
      await request.post(endpoint, { headers: colleague, data: command })
    ).status(),
  ).toBe(403);
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleSelf,
    'case.closure.record',
    'SELF',
  );
  expect(
    (
      await request.post(endpoint, { headers: colleague, data: command })
    ).status(),
  ).toBe(403);
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleSelf,
    'case.closure.record',
    'DEPARTMENT',
  );
  const closed = await body<{ stage: string; version: number }>(
    await request.post(endpoint, { headers: colleague, data: command }),
    201,
  );
  expect(closed.stage).toBe('WAITING_ARCHIVE');
  expect(closed.version).toBe(created.version + 2);
  const proof = {
    ownerType: 'CASE',
    ownerId: created.id,
    category: 'CASE_CLOSURE_PAYMENT_PROOF',
    purpose: 'CASE_CLOSURE_PAYMENT_PROOF',
    originalFilename: `proxy-proof-${randomUUID()}.png`,
    declaredMimeType: 'image/png',
  };
  expect(
    (
      await request.post('/api/v1/materials/upload-drafts', {
        headers: colleague,
        data: proof,
      })
    ).status(),
  ).toBe(403);
  await setRoleGrant(
    coreLeadFixtures.roleSelf,
    'case.closure.settlement.update',
    'DEPARTMENT',
  );
  const draft = await body<{ id: string }>(
    await request.post('/api/v1/materials/upload-drafts', {
      headers: colleague,
      data: proof,
    }),
    201,
  );
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5b8AAAAASUVORK5CYII=',
    'base64',
  );
  const uploaded = await body<{ contentVersionId: string }>(
    await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
      headers: { ...colleague, 'Content-Type': 'application/octet-stream' },
      data: png,
    }),
    200,
  );
  expect(uploaded.contentVersionId).toEqual(expect.any(String));
  await setRoleGrant(
    coreLeadFixtures.roleSelf,
    'case.closure.settlement.update',
    'DEPARTMENT',
    false,
  );
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleSelf,
    'case.closure.record',
    'DEPARTMENT',
    false,
  );
  expect(
    (
      await request.post(endpoint, { headers: colleague, data: command })
    ).status(),
  ).toBe(403);
});

test('owner early closure on an independent external source is a baseline control', async ({
  request,
}) => {
  test.setTimeout(90_000);
  await seedCoreLeadE2eData({ reuseExisting: true });
  await setCaseExternalEntryGrant(
    coreLeadFixtures.roleA,
    'case.external-entry.create',
    'TEAM',
    true,
  );
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleA,
    'case.closure.record',
    'TEAM',
  );
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const created = await body<{ id: string; stage: string; version: number }>(
    await request.post('/api/v1/cases/external-entries', {
      headers: owner,
      data: {
        idempotencyKey: randomUUID(),
        entryKind: 'EXTERNAL_TRANSFER',
        initialStage: 'PENDING_MATCH',
        stageReachedOn: today,
        source: `owner-early-control-${randomUUID()}`,
        reason: '合成原负责人提前结案对照',
        customerId: coreLeadFixtures.admittedCustomer,
        rightsHolderId: coreLeadFixtures.holder,
        defendants: [],
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
  const response = await request.post(
    `/api/v1/cases/${created.id}/early-closure`,
    {
      headers: owner,
      data: {
        expectedVersion: created.version,
        expectedStage: created.stage,
        idempotencyKey: randomUUID(),
        closeAt: today,
        closeAmountState: 'KNOWN',
        closeAmt: '10.00',
        closeContentVersionIds: [],
        paymentType: 'ONE_TIME',
        paymentRecords: [
          {
            paidOn: today,
            amount: '10.00',
            payer: '合成付款人',
            payee: '合成收款人',
            screenshotContentVersionId: null,
          },
        ],
      },
    },
  );
  expect(response.status(), await response.text()).toBe(201);
});

test('normal source pending-match early closure retains the full terminal check', async ({
  request,
}) => {
  test.setTimeout(120_000);
  await seedCoreLeadE2eData({ reuseExisting: true });
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleA,
    'case.closure.record',
    'TEAM',
  );
  const source = await createSubmittedCaseThroughApi(request, {
    stopAtPendingMatch: true,
  });
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const closed = await body<{ stage: string; version: number }>(
    await request.post(`/api/v1/cases/${source.caseId}/early-closure`, {
      headers: owner,
      data: {
        expectedVersion: 1,
        expectedStage: 'PENDING_MATCH',
        idempotencyKey: randomUUID(),
        closeAt: today,
        closeAmountState: 'KNOWN',
        closeAmt: '0.00',
        closeContentVersionIds: [],
        paymentType: 'ONE_TIME',
        paymentRecords: [],
      },
    }),
    201,
  );
  expect(closed).toMatchObject({ stage: 'WAITING_ARCHIVE', version: 3 });
});

test('department proxy closes an independent normal pending-match source', async ({
  request,
}) => {
  test.setTimeout(120_000);
  await seedCoreLeadE2eData({ reuseExisting: true });
  await setRoleGrant(coreLeadFixtures.roleSelf, 'case.read', 'DEPARTMENT');
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleSelf,
    'case.closure.record',
    'DEPARTMENT',
  );
  const source = await createSubmittedCaseThroughApi(request, {
    stopAtPendingMatch: true,
  });
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const closed = await body<{ stage: string; version: number }>(
    await request.post(`/api/v1/cases/${source.caseId}/early-closure`, {
      headers: colleague,
      data: {
        expectedVersion: 1,
        expectedStage: 'PENDING_MATCH',
        idempotencyKey: randomUUID(),
        closeAt: today,
        closeAmountState: 'KNOWN',
        closeAmt: '0.00',
        closeContentVersionIds: [],
        paymentType: 'ONE_TIME',
        paymentRecords: [],
      },
    }),
    201,
  );
  expect(closed).toMatchObject({ stage: 'WAITING_ARCHIVE', version: 3 });
});

test('department proxy early closure rolls back when the closure receipt insert fails', async ({
  request,
}) => {
  test.setTimeout(90_000);
  await seedCoreLeadE2eData({ reuseExisting: true });
  await setCaseExternalEntryGrant(
    coreLeadFixtures.roleA,
    'case.external-entry.create',
    'TEAM',
    true,
  );
  await setRoleGrant(coreLeadFixtures.roleSelf, 'case.read', 'DEPARTMENT');
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleSelf,
    'case.closure.record',
    'DEPARTMENT',
  );
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const created = await body<{ id: string; stage: string; version: number }>(
    await request.post('/api/v1/cases/external-entries', {
      headers: owner,
      data: {
        idempotencyKey: randomUUID(),
        entryKind: 'EXTERNAL_TRANSFER',
        initialStage: 'PENDING_MATCH',
        stageReachedOn: today,
        source: `proxy-rollback-${randomUUID()}`,
        reason: '合成部门代办提前结案回滚',
        customerId: coreLeadFixtures.admittedCustomer,
        rightsHolderId: coreLeadFixtures.holder,
        defendants: [],
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
  const fault = await withCaseClosureFault(created.id, 'receipt', () =>
    request.post(`/api/v1/cases/${created.id}/early-closure`, {
      headers: colleague,
      data: {
        expectedVersion: created.version,
        expectedStage: created.stage,
        idempotencyKey: randomUUID(),
        closeAt: today,
        closeAmountState: 'KNOWN',
        closeAmt: '0.00',
        closeContentVersionIds: [],
        paymentType: 'ONE_TIME',
        paymentRecords: [],
      },
    }),
  );
  expect(fault).toMatchObject({ status: 500, reached: true, unchanged: true });
  const after = await body<{ stage: string; version: number; closure: null }>(
    await request.get(`/api/v1/cases/${created.id}`, { headers: owner }),
    200,
  );
  expect(after).toMatchObject({
    stage: created.stage,
    version: created.version,
    closure: null,
  });
});

test('department proxy can preupload an early closure document only with the department action', async ({
  request,
}) => {
  test.setTimeout(90_000);
  await seedCoreLeadE2eData({ reuseExisting: true });
  await setCaseExternalEntryGrant(
    coreLeadFixtures.roleA,
    'case.external-entry.create',
    'TEAM',
    true,
  );
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const created = await body<{ id: string }>(
    await request.post('/api/v1/cases/external-entries', {
      headers: owner,
      data: {
        idempotencyKey: randomUUID(),
        entryKind: 'EXTERNAL_TRANSFER',
        initialStage: 'PENDING_MATCH',
        stageReachedOn: today,
        source: `proxy-preupload-${randomUUID()}`,
        reason: '合成提前结案文书代办上传',
        customerId: coreLeadFixtures.admittedCustomer,
        rightsHolderId: coreLeadFixtures.holder,
        defendants: [],
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
  await setRoleGrant(coreLeadFixtures.roleSelf, 'case.read', 'DEPARTMENT');
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleSelf,
    'case.closure.record',
    'DEPARTMENT',
    false,
  );
  const draftInput = {
    ownerType: 'CASE',
    ownerId: created.id,
    category: 'CASE_CLOSURE_DOCUMENT',
    purpose: 'CASE_CLOSURE_DOCUMENT',
    originalFilename: `proxy-closure-${randomUUID()}.pdf`,
    declaredMimeType: 'application/pdf',
  };
  expect(
    (
      await request.post('/api/v1/materials/upload-drafts', {
        headers: colleague,
        data: draftInput,
      })
    ).status(),
  ).toBe(403);
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleSelf,
    'case.closure.record',
    'SELF',
  );
  expect(
    (
      await request.post('/api/v1/materials/upload-drafts', {
        headers: colleague,
        data: draftInput,
      })
    ).status(),
  ).toBe(403);
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleSelf,
    'case.closure.record',
    'DEPARTMENT',
  );
  const draft = await body<{ id: string }>(
    await request.post('/api/v1/materials/upload-drafts', {
      headers: colleague,
      data: draftInput,
    }),
    201,
  );
  const uploaded = await body<{ contentVersionId: string }>(
    await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
      headers: { ...colleague, 'Content-Type': 'application/octet-stream' },
      data: batch2SyntheticPdf('proxy early closure document'),
    }),
    200,
  );
  expect(uploaded.contentVersionId).toEqual(expect.any(String));
});

test('database closure field guard rejects a revoked correction grant without touching the receipt', async ({
  request,
}) => {
  test.setTimeout(90_000);
  await seedCoreLeadE2eData({ reuseExisting: true });
  await setCaseExternalEntryGrant(
    coreLeadFixtures.roleA,
    'case.external-entry.create',
    'TEAM',
    true,
  );
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleA,
    'case.closure.record',
    'TEAM',
  );
  await setRoleGrant(coreLeadFixtures.roleSelf, 'case.read', 'DEPARTMENT');
  await setRoleGrant(
    coreLeadFixtures.roleSelf,
    'case.closure.settlement.update',
    'DEPARTMENT',
  );
  for (const scope of ['SELF', 'TEAM'] as const)
    await setCaseClosureFixtureGrant(
      coreLeadFixtures.roleSelf,
      'case.closure.correct',
      scope,
      false,
    );
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const created = await body<{ id: string; version: number }>(
    await request.post('/api/v1/cases/external-entries', {
      headers: owner,
      data: {
        idempotencyKey: randomUUID(),
        entryKind: 'EXTERNAL_TRANSFER',
        initialStage: 'WAITING_ARCHIVE',
        stageReachedOn: today,
        source: `proxy-sql-guard-${randomUUID()}`,
        reason: '合成授权纠正后撤权的数据库守卫探针',
        customerId: coreLeadFixtures.admittedCustomer,
        rightsHolderId: coreLeadFixtures.holder,
        defendants: [],
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
  const original = await body<{ version: number; closureVersionId: string }>(
    await request.post(`/api/v1/cases/${created.id}/closure`, {
      headers: owner,
      data: {
        expectedVersion: created.version,
        expectedFinishId: null,
        idempotencyKey: randomUUID(),
        closeAt: null,
        closeAmountState: 'PENDING',
        closeAmt: null,
        note: null,
        closeContentVersionIds: [],
      },
    }),
    201,
  );
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleSelf,
    'case.closure.correct',
    'DEPARTMENT',
  );
  const updated = await body<{ closureVersionId: string }>(
    await request.post(
      `/api/v1/cases/${created.id}/closure-settlement-updates`,
      {
        headers: colleague,
        data: {
          expectedVersion: original.version,
          expectedClosureVersionId: original.closureVersionId,
          idempotencyKey: randomUUID(),
          closeAt: today,
          closeAmountState: 'KNOWN',
          closeAmt: '0.00',
          closeContentVersionIds: [],
          paymentType: 'ONE_TIME',
          paymentRecords: [],
          correctionReason: '合成独立纠正授权下更新日期',
          refund: {
            expectedVersionId: null,
            kind: 'DECLARE_NOT_APPLICABLE',
            items: [],
          },
        },
      },
    ),
    201,
  );
  await setCaseClosureFixtureGrant(
    coreLeadFixtures.roleSelf,
    'case.closure.correct',
    'DEPARTMENT',
    false,
  );
  if (process.env.NODE_ENV !== 'test')
    throw new Error('Isolated test database required');
  validateIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  let inTransaction = false;
  try {
    await client.connect();
    const facts = (
      await client.query(
        `SELECT v.close_at::text AS after_date,prior.close_at::text AS before_date,
          public.case_closure_actor_authorized($2::uuid,$3::uuid,$4::uuid,true) AS can_correct,
          (SELECT count(*)::integer FROM public.case_closure_settlement_update_receipts r
           WHERE r.closure_version_id=v.id) AS receipt_count
         FROM public.case_closure_versions v
         JOIN public.case_closure_versions prior ON prior.id=v.prior_version_id
         WHERE v.id=$1::uuid AND v.recorded_by_user_id=$2::uuid`,
        [
          updated.closureVersionId,
          coreLeadFixtures.userSelf,
          created.id,
          coreLeadFixtures.departmentA,
        ],
      )
    ).rows[0];
    expect(facts).toMatchObject({
      after_date: today,
      before_date: null,
      can_correct: false,
      receipt_count: 1,
    });
    await client.query('BEGIN');
    inTransaction = true;
    await client.query(`CREATE TEMP TABLE proxy_guard_probe (
      id uuid,case_id uuid,department_id uuid,actor_user_id uuid,closure_version_id uuid
    ) ON COMMIT DROP`);
    await client.query(`CREATE CONSTRAINT TRIGGER proxy_guard_probe_final
      AFTER INSERT ON pg_temp.proxy_guard_probe
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      EXECUTE FUNCTION public.check_proxy_settlement_closure_fields()`);
    await client.query(
      `INSERT INTO pg_temp.proxy_guard_probe
       (id,case_id,department_id,actor_user_id,closure_version_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid)`,
      [
        randomUUID(),
        created.id,
        coreLeadFixtures.departmentA,
        coreLeadFixtures.userSelf,
        updated.closureVersionId,
      ],
    );
    let code: string | null = null;
    try {
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    } catch (error) {
      code = (error as { code?: string }).code ?? null;
    }
    expect(code).toBe('23514');
  } finally {
    if (inTransaction) await client.query('ROLLBACK');
    await client.end();
  }
});
