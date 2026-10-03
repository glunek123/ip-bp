import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  coreLeadFixtures,
  resetCoreLeadE2eData,
  reassignCaseToOtherFixtureTeam,
  setInternalAccountActive,
} from '../support/core-lead-database.mjs';
import { createSubmittedCaseThroughApi } from '../support/case-complaint-confirmation-database.mjs';
import {
  clearCaseComplaintMailingFixture,
  countCaseComplaintMailingEffects,
  prepareCaseComplaintMailingFixture,
  rejectCaseComplaintMailingWrite,
  clearCaseComplaintMailingFault,
  expireRevokedClientDraft,
  allowOtherEnterpriseAccountSetup,
  revokeCaseComplaintMailGrant,
} from '../support/case-complaint-mailing-database.mjs';

const auth = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const authSelf = { Authorization: `Bearer ${coreLeadFixtures.tokenSelf}` };
const authOther = { Authorization: `Bearer ${coreLeadFixtures.tokenB}` };
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
const futureBusinessDate = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + 48 * 60 * 60 * 1000));
type ApiSession = { csrfToken: string; user: { id: string; username: string } };
type ApiDraft = { id: string };
type ApiReceipt = { contentVersionId: string };
type ApiCaseList = { items: Array<{ id: string }> };
type ApiCaseDetail = {
  pendingReceiptFiles: ApiReceipt[];
  complaintMailing: unknown;
};
type ApiMailResult = {
  id: string;
  stage: string;
  version: number;
  mailedAt: string;
  recordedAt: string;
};

async function json<T = unknown>(
  response: Awaited<ReturnType<APIRequestContext['get']>>,
  status: number,
): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json() as Promise<T>;
}
async function confirmedCase(request: APIRequestContext) {
  const source = await createSubmittedCaseThroughApi(request);
  const input = {
    expectedVersion: 3,
    idempotencyKey: randomUUID(),
    confirmedComplaintContentVersionId: source.complaint.contentVersionId,
    amountState: 'KNOWN',
    amount: '123.45',
    pendingReason: null,
    confirmDisclose: true,
  };
  await json(
    await request.post(`/api/v1/cases/${source.caseId}/complaint-confirm`, {
      headers: auth,
      data: input,
    }),
    201,
  );
  return source;
}
async function restoreSourceClientSession(
  request: APIRequestContext,
  source: Awaited<ReturnType<typeof createSubmittedCaseThroughApi>>,
) {
  return json<ApiSession>(
    await request.post('/api/v1/auth/login', {
      headers: { Origin: 'http://127.0.0.1:5174' },
      data: {
        username: (source.clientSession as ApiSession).user.username,
        password: 'client correct horse battery',
      },
    }),
    200,
  );
}
async function createAndLoginClient(
  request: APIRequestContext,
  customerId: string,
  headers: Record<string, string>,
) {
  const username = `ca004-client-${randomUUID().slice(0, 8)}`;
  const password = 'ca004 client correct horse battery';
  await json(
    await request.post(`/api/v1/customers/${customerId}/client-accounts`, {
      headers,
      data: { displayName: '隔离测试客户', username, password },
    }),
    201,
  );
  return json<ApiSession>(
    await request.post('/api/v1/auth/login', {
      headers: { Origin: 'http://127.0.0.1:5174' },
      data: { username, password },
    }),
    200,
  );
}
async function uploadReceipt(
  request: APIRequestContext,
  caseId: string,
  headers: Record<string, string>,
) {
  const draft = await json<ApiDraft>(
    await request.post('/api/v1/materials/upload-drafts', {
      headers,
      data: {
        ownerType: 'CASE',
        ownerId: caseId,
        category: 'MAIL_RECEIPT',
        purpose: 'MAIL_RECEIPT',
        originalFilename: '实际邮寄凭证.pdf',
        declaredMimeType: 'application/pdf',
      },
    }),
    201,
  );
  return json<ApiReceipt>(
    await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: pdf,
    }),
    200,
  );
}
function mail(
  request: APIRequestContext,
  caseId: string,
  versionId: string,
  headers: Record<string, string>,
  key = randomUUID(),
  mailedAt = '2026-10-02',
) {
  return request.post(
    `/api/v1/${headers.Authorization ? '' : 'client/'}cases/${caseId}/complaint-mail`,
    {
      headers,
      data: {
        expectedVersion: 4,
        idempotencyKey: key,
        mailedAt,
        mailReceiptContentVersionIds: [versionId],
      },
    },
  );
}

test.beforeEach(async () => {
  await clearCaseComplaintMailingFixture();
  await resetCoreLeadE2eData();
  await prepareCaseComplaintMailingFixture();
});
test.afterEach(async () => {
  await clearCaseComplaintMailingFault();
  await clearCaseComplaintMailingFixture();
});

test('real client session reads exact confirmed files and mails one case without internal data', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const source = await createSubmittedCaseThroughApi(request);
  const { caseId, complaint, authorization } = source;
  const clientSession = await restoreSourceClientSession(request, source);
  expect((await request.get('/api/v1/client/cases')).status()).toBe(200);
  expect(
    await json(await request.get(`/api/v1/client/cases/${caseId}`), 404),
  ).toMatchObject({
    code: 'RESOURCE_NOT_FOUND',
  });
  await json(
    await request.post(`/api/v1/cases/${caseId}/complaint-confirm`, {
      headers: auth,
      data: {
        expectedVersion: 3,
        idempotencyKey: randomUUID(),
        confirmedComplaintContentVersionId: complaint.contentVersionId,
        amountState: 'KNOWN',
        amount: '123.45',
        pendingReason: null,
        confirmDisclose: true,
      },
    }),
    201,
  );
  const list = await json<ApiCaseList>(
    await request.get('/api/v1/client/cases'),
    200,
  );
  expect(list.items).toMatchObject([
    {
      id: caseId,
      rightsHolderName: expect.any(String),
      defendantNames: ['诉状确认被告公司'],
      canMailComplaint: true,
    },
  ]);
  const detail = await json<ApiCaseDetail>(
    await request.get(`/api/v1/client/cases/${caseId}`),
    200,
  );
  expect(detail).toMatchObject({
    stage: 'WAITING_COMPLAINT_STAMP',
    confirmedAmountState: 'KNOWN',
    confirmedAmount: '123.45',
    complaintFile: { contentVersionId: complaint.contentVersionId },
    authorizationFiles: [{ contentVersionId: authorization.contentVersionId }],
    complaintMailing: null,
  });
  for (const hidden of [
    'fees',
    'owner',
    'lawyers',
    'changeNote',
    'storageKey',
    'complaintAmount',
  ])
    expect(detail).not.toHaveProperty(hidden);
  for (const file of [complaint, authorization]) {
    const download = await request.get(
      `/api/v1/materials/${file.materialId}/versions/${file.contentVersionId}/content`,
    );
    expect(download.status()).toBe(200);
    expect(await download.body()).toEqual(pdf);
  }
  const clientHeaders = { 'X-CSRF-Token': clientSession.csrfToken };
  const receipt = await uploadReceipt(request, caseId, clientHeaders);
  const pending = await json<ApiCaseDetail>(
    await request.get(`/api/v1/client/cases/${caseId}`),
    200,
  );
  expect(pending.pendingReceiptFiles).toMatchObject([
    { contentVersionId: receipt.contentVersionId },
  ]);
  const key = randomUUID();
  const requestBody = {
    expectedVersion: 4,
    idempotencyKey: key,
    mailedAt: '2026-10-02',
    mailReceiptContentVersionIds: [receipt.contentVersionId],
  };
  expect(
    (
      await json<{ code: string }>(
        await request.post(`/api/v1/cases/${caseId}/complaint-mail`, {
          headers: clientHeaders,
          data: requestBody,
        }),
        403,
      )
    ).code,
  ).toBe('ACTION_FORBIDDEN');
  expect(
    (
      await json<{ code: string }>(
        await request.post(`/api/v1/client/cases/${caseId}/complaint-mail`, {
          headers: auth,
          data: requestBody,
        }),
        403,
      )
    ).code,
  ).toBe('ACTION_FORBIDDEN');
  expect(await countCaseComplaintMailingEffects(caseId)).toMatchObject({
    stage: 'WAITING_COMPLAINT_STAMP',
    version: 4,
    facts: 0,
    versions: 0,
    references: 0,
    receipts: 0,
    audits: 0,
  });
  const created = await json<ApiMailResult>(
    await mail(request, caseId, receipt.contentVersionId, clientHeaders, key),
    201,
  );
  expect(created).toMatchObject({
    id: caseId,
    stage: 'WAITING_FILING',
    version: 5,
    mailedAt: '2026-10-02',
    recordedAt: expect.any(String),
  });
  expect(
    await json(
      await request.post(`/api/v1/client/cases/${caseId}/complaint-mail`, {
        headers: clientHeaders,
        data: {
          mailReceiptContentVersionIds: [receipt.contentVersionId],
          mailedAt: '2026-10-02',
          idempotencyKey: key,
          expectedVersion: 4,
        },
      }),
      201,
    ),
  ).toEqual(created);
  expect(
    (
      await mail(
        request,
        caseId,
        receipt.contentVersionId,
        clientHeaders,
        key,
        '2026-10-01',
      )
    ).status(),
  ).toBe(409);
  const recorded = await json<ApiCaseList>(
    await request.get('/api/v1/client/cases?view=RECORDED'),
    200,
  );
  expect(recorded.items).toMatchObject([
    { id: caseId, stage: 'WAITING_FILING' },
  ]);
  const after = await json<ApiCaseDetail>(
    await request.get(`/api/v1/client/cases/${caseId}`),
    200,
  );
  expect(after.complaintMailing).toMatchObject({
    mailedAt: '2026-10-02',
    receiptFiles: [{ contentVersionId: receipt.contentVersionId }],
  });
  expect((await request.get(`/api/v1/cases/${caseId}`)).status()).toBe(403);
  expect(await countCaseComplaintMailingEffects(caseId)).toMatchObject({
    stage: 'WAITING_FILING',
    facts: 1,
    versions: 1,
    references: 1,
    receipts: 1,
    audits: 1,
  });
  const revoked = await request.patch(
    `/api/v1/customers/${coreLeadFixtures.admittedCustomer}/client-accounts/${clientSession.user.id}/status`,
    {
      headers: auth,
      data: { active: false },
    },
  );
  expect(revoked.status(), await revoked.text()).toBe(200);
  expect([401, 403]).toContain(
    (await request.get(`/api/v1/client/cases/${caseId}`)).status(),
  );
  expect([401, 403]).toContain(
    (
      await mail(request, caseId, receipt.contentVersionId, clientHeaders, key)
    ).status(),
  );
});

test('operator scope and failed writes roll back all mailing effects', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const { caseId } = await confirmedCase(request);
  const receipt = await uploadReceipt(request, caseId, auth);
  expect(
    (
      await request.get(`/api/v1/cases/${caseId}`, { headers: authOther })
    ).status(),
  ).toBe(404);
  expect(
    (await mail(request, caseId, receipt.contentVersionId, authSelf)).status(),
  ).toBe(403);
  for (const kind of ['audit', 'fact', 'freeze', 'receipt'] as const) {
    await rejectCaseComplaintMailingWrite(kind);
    const failed = await mail(request, caseId, receipt.contentVersionId, auth);
    expect(failed.status()).toBe(500);
    expect(await countCaseComplaintMailingEffects(caseId)).toMatchObject({
      stage: 'WAITING_COMPLAINT_STAMP',
      version: 4,
      facts: 0,
      versions: 0,
      references: 0,
      receipts: 0,
      audits: 0,
    });
    await clearCaseComplaintMailingFault();
  }
  const result = await json<ApiMailResult>(
    await mail(request, caseId, receipt.contentVersionId, auth),
    201,
  );
  expect(result.stage).toBe('WAITING_FILING');
  expect(
    (await mail(request, caseId, receipt.contentVersionId, auth)).status(),
  ).toBe(409);
});

test('client and operator compete under one case lock; invalid versions and dates fail', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const source = await confirmedCase(request);
  const { caseId } = source;
  const clientSession = await restoreSourceClientSession(request, source);
  const clientHeaders = { 'X-CSRF-Token': clientSession.csrfToken };
  const clientReceipt = await uploadReceipt(request, caseId, clientHeaders);
  const operatorReceipt = await uploadReceipt(request, caseId, auth);
  expect(
    (
      await mail(
        request,
        caseId,
        operatorReceipt.contentVersionId,
        clientHeaders,
      )
    ).status(),
  ).toBe(400);
  expect((await mail(request, caseId, randomUUID(), auth)).status()).toBe(400);
  expect(
    (
      await mail(
        request,
        caseId,
        clientReceipt.contentVersionId,
        clientHeaders,
        randomUUID(),
        futureBusinessDate(),
      )
    ).status(),
  ).toBe(400);
  const [clientResult, operatorResult] = await Promise.all([
    mail(request, caseId, clientReceipt.contentVersionId, clientHeaders),
    mail(request, caseId, operatorReceipt.contentVersionId, auth),
  ]);
  expect([clientResult.status(), operatorResult.status()].sort()).toEqual([
    201, 409,
  ]);
  expect(await countCaseComplaintMailingEffects(caseId)).toMatchObject({
    stage: 'WAITING_FILING',
    facts: 1,
    versions: 1,
    references: 1,
    receipts: 1,
    audits: 1,
  });
});

test('other enterprise and department client sessions cannot enumerate or guess CASE versions', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const { caseId, complaint } = await confirmedCase(request);
  await allowOtherEnterpriseAccountSetup();
  const otherEnterpriseSession = await createAndLoginClient(
    request,
    coreLeadFixtures.selfCustomer,
    auth,
  );
  expect(
    (await json<ApiCaseList>(await request.get('/api/v1/client/cases'), 200))
      .items,
  ).toEqual([]);
  expect((await request.get(`/api/v1/client/cases/${caseId}`)).status()).toBe(
    404,
  );
  expect(
    (
      await request.get(`/api/v1/materials?ownerType=CASE&ownerId=${caseId}`)
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.get(
        `/api/v1/materials/${complaint.materialId}/versions/${complaint.contentVersionId}/content`,
      )
    ).status(),
  ).toBe(404);
  expect(
    (
      await mail(request, caseId, complaint.contentVersionId, {
        'X-CSRF-Token': otherEnterpriseSession.csrfToken,
      })
    ).status(),
  ).toBe(404);
  await createAndLoginClient(
    request,
    coreLeadFixtures.foreignCustomer,
    authOther,
  );
  expect(
    (await json<ApiCaseList>(await request.get('/api/v1/client/cases'), 200))
      .items,
  ).toEqual([]);
  expect((await request.get(`/api/v1/client/cases/${caseId}`)).status()).toBe(
    404,
  );
  expect(
    (
      await request.get(
        `/api/v1/materials/${complaint.materialId}/versions/${complaint.contentVersionId}/content`,
      )
    ).status(),
  ).toBe(404);
});

test('revoked customer binding rejects draft finalize while cleanup may expire it', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const source = await confirmedCase(request);
  const clientSession = await restoreSourceClientSession(request, source);
  const draft = await json<ApiDraft>(
    await request.post('/api/v1/materials/upload-drafts', {
      headers: { 'X-CSRF-Token': clientSession.csrfToken },
      data: {
        ownerType: 'CASE',
        ownerId: source.caseId,
        category: 'MAIL_RECEIPT',
        purpose: 'MAIL_RECEIPT',
        originalFilename: '待邮寄凭证.pdf',
        declaredMimeType: 'application/pdf',
      },
    }),
    201,
  );
  await json(
    await request.patch(
      `/api/v1/customers/${coreLeadFixtures.admittedCustomer}/client-accounts/${clientSession.user.id}/status`,
      {
        headers: auth,
        data: { active: false },
      },
    ),
    200,
  );
  expect([401, 403]).toContain(
    (
      await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
        headers: {
          'X-CSRF-Token': clientSession.csrfToken,
          'Content-Type': 'application/octet-stream',
        },
        data: pdf,
      })
    ).status(),
  );
  expect(await expireRevokedClientDraft(draft.id)).toBe('EXPIRED');
});

test('revoked operator grant blocks an identical successful mailing replay', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const { caseId } = await confirmedCase(request);
  const receipt = await uploadReceipt(request, caseId, auth);
  const key = randomUUID();
  await json(
    await mail(request, caseId, receipt.contentVersionId, auth, key),
    201,
  );
  const before = await countCaseComplaintMailingEffects(caseId);
  await revokeCaseComplaintMailGrant();
  expect(
    (await mail(request, caseId, receipt.contentVersionId, auth, key)).status(),
  ).toBe(403);
  expect(await countCaseComplaintMailingEffects(caseId)).toEqual(before);
});

test('case reassignment and account deactivation each block operator mailing replay', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const { caseId } = await confirmedCase(request);
  const receipt = await uploadReceipt(request, caseId, auth);
  const key = randomUUID();
  await json(
    await mail(request, caseId, receipt.contentVersionId, auth, key),
    201,
  );
  const before = await countCaseComplaintMailingEffects(caseId);
  await reassignCaseToOtherFixtureTeam(caseId);
  expect(
    (await mail(request, caseId, receipt.contentVersionId, auth, key)).status(),
  ).toBe(403);
  expect(await countCaseComplaintMailingEffects(caseId)).toEqual(before);
  await setInternalAccountActive(coreLeadFixtures.userA, false);
  expect([401, 403]).toContain(
    (await mail(request, caseId, receipt.contentVersionId, auth, key)).status(),
  );
  expect(await countCaseComplaintMailingEffects(caseId)).toEqual(before);
});
