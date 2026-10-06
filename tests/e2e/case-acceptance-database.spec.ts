import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  coreLeadFixtures,
  resetCoreLeadE2eData,
  endCurrentLawyerAssignment,
} from '../support/core-lead-database.mjs';
import { createSubmittedCaseThroughApi } from '../support/case-complaint-confirmation-database.mjs';
import { clearCaseComplaintMailingFixture } from '../support/case-complaint-mailing-database.mjs';
import {
  clearCaseFilingFixture,
  prepareCaseFilingFixture,
} from '../support/case-filing-database.mjs';
import {
  clearCaseAcceptanceFault,
  clearCaseAcceptanceFixture,
  countCaseAcceptanceEffects,
  prepareCaseAcceptanceFixture,
  rejectCaseAcceptanceWrite,
  revokeCaseAcceptanceGrant,
} from '../support/case-acceptance-database.mjs';

const auth = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const authOther = { Authorization: `Bearer ${coreLeadFixtures.tokenB}` };
const authSelf = { Authorization: `Bearer ${coreLeadFixtures.tokenSelf}` };
const pdf = Buffer.from('%PDF-1.4\nCA006 real acceptance\n%%EOF\n');
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
type ApiVersion = { materialId: string; contentVersionId: string };
type ApiSource = {
  caseId: string;
  complaint: ApiVersion;
  clientSession: { user: { username: string } };
  notarySession: { csrfToken: string };
  lawyerSession: { csrfToken: string } | null;
  lawyer: { profiles: Array<{ profileId: string }> };
};
type ApiResult = {
  id: string;
  stage: string;
  version: number;
  acceptedAt: string;
  courtCaseNo: string;
  recordedAt: string;
};
async function json<T>(
  response: Awaited<ReturnType<APIRequestContext['get']>>,
  status: number,
): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json() as Promise<T>;
}
async function upload(
  request: APIRequestContext,
  caseId: string,
  category:
    | 'MAIL_RECEIPT'
    | 'FILING_EVIDENCE'
    | 'ACCEPTANCE_NOTICE'
    | 'PAYMENT_LIST'
    | 'SERVICE_DOCUMENT',
  headers: Record<string, string> = auth,
) {
  const draft = await json<{ id: string }>(
    await request.post('/api/v1/materials/upload-drafts', {
      headers,
      data: {
        ownerType: 'CASE',
        ownerId: caseId,
        category,
        purpose: category,
        originalFilename: `${category}.pdf`,
        declaredMimeType: 'application/pdf',
      },
    }),
    201,
  );
  return json<ApiVersion>(
    await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: pdf,
    }),
    200,
  );
}
async function waitingFormal(request: APIRequestContext, lawyer = false) {
  const source = (await createSubmittedCaseThroughApi(
    request,
    lawyer ? { submitAsLawyer: true } : undefined,
  )) as ApiSource;
  const headers = lawyer
    ? { 'X-CSRF-Token': source.lawyerSession!.csrfToken }
    : auth;
  const prefix = lawyer ? '/api/v1/lawyer/cases' : '/api/v1/cases';
  await json(
    await request.post(`${prefix}/${source.caseId}/complaint-confirm`, {
      headers,
      data: {
        expectedVersion: 3,
        idempotencyKey: randomUUID(),
        confirmedComplaintContentVersionId: source.complaint.contentVersionId,
        amountState: 'KNOWN',
        amount: '123.45',
        pendingReason: null,
        confirmDisclose: true,
      },
    }),
    201,
  );
  const receipt = await upload(request, source.caseId, 'MAIL_RECEIPT', headers);
  await json(
    await request.post(`${prefix}/${source.caseId}/complaint-mail`, {
      headers,
      data: {
        expectedVersion: 4,
        idempotencyKey: randomUUID(),
        mailedAt: today(),
        mailReceiptContentVersionIds: [receipt.contentVersionId],
      },
    }),
    201,
  );
  const court = await json<{ id: string }>(
    await request.post(`${prefix}/${source.caseId}/filing-courts`, {
      headers,
      data: { name: `CA006 Court ${randomUUID().slice(0, 8)}` },
    }),
    201,
  );
  const evidence = await upload(
    request,
    source.caseId,
    'FILING_EVIDENCE',
    headers,
  );
  await json(
    await request.post(`${prefix}/${source.caseId}/filing-submit`, {
      headers,
      data: {
        expectedVersion: 5,
        idempotencyKey: randomUUID(),
        courtId: court.id,
        submittedAt: today(),
        filingEvidenceContentVersionIds: [evidence.contentVersionId],
      },
    }),
    201,
  );
  return { source, headers, prefix };
}

test.beforeEach(async () => {
  await clearCaseAcceptanceFixture();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
  await resetCoreLeadE2eData();
  await prepareCaseFilingFixture();
  await prepareCaseAcceptanceFixture();
});
test.afterEach(async () => {
  await clearCaseAcceptanceFault();
  await clearCaseAcceptanceFixture();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
});

test('operator registers exact acceptance files and later uploads without client disclosure', async ({
  request,
}) => {
  test.setTimeout(240_000);
  const { source } = await waitingFormal(request);
  const notice = await upload(request, source.caseId, 'ACCEPTANCE_NOTICE');
  const unselected = await upload(request, source.caseId, 'PAYMENT_LIST');
  const before = await json<{
    acceptanceMaterials: Record<string, { available: ApiVersion[] }>;
  }>(
    await request.get(`/api/v1/cases/${source.caseId}`, { headers: auth }),
    200,
  );
  expect(before.acceptanceMaterials.ACCEPTANCE_NOTICE.available).toContainEqual(
    expect.objectContaining({ contentVersionId: notice.contentVersionId }),
  );
  expect(before.acceptanceMaterials.PAYMENT_LIST.available).toContainEqual(
    expect.objectContaining({ contentVersionId: unselected.contentVersionId }),
  );
  const body = {
    expectedVersion: 6,
    idempotencyKey: randomUUID(),
    acceptedAt: today(),
    courtCaseNo: `  ${'案'.repeat(100)}  `,
    acceptanceNoticeContentVersionIds: [notice.contentVersionId],
  };
  expect(
    (
      await request.post(`/api/v1/cases/${source.caseId}/acceptance-register`, {
        headers: auth,
        data: { ...body, courtCaseNo: `  ${'案'.repeat(101)}  ` },
      })
    ).status(),
  ).toBe(400);
  const result = await json<ApiResult>(
    await request.post(`/api/v1/cases/${source.caseId}/acceptance-register`, {
      headers: auth,
      data: body,
    }),
    201,
  );
  expect(result).toMatchObject({
    stage: 'WAITING_HEARING',
    version: 7,
    acceptedAt: body.acceptedAt,
    courtCaseNo: body.courtCaseNo.trim(),
  });
  expect(
    await json<ApiResult>(
      await request.post(`/api/v1/cases/${source.caseId}/acceptance-register`, {
        headers: auth,
        data: { ...body, courtCaseNo: body.courtCaseNo.trim() },
      }),
      201,
    ),
  ).toEqual(result);
  const payment = await upload(request, source.caseId, 'PAYMENT_LIST');
  const detail = await json<{
    stage: string;
    acceptance: { acceptedAt: string; courtCaseNo: string };
    acceptanceMaterials: Record<
      string,
      { available: ApiVersion[]; frozen: ApiVersion[]; later: ApiVersion[] }
    >;
  }>(
    await request.get(`/api/v1/cases/${source.caseId}`, { headers: auth }),
    200,
  );
  expect(detail).toMatchObject({
    stage: 'WAITING_HEARING',
    acceptance: {
      acceptedAt: body.acceptedAt,
      courtCaseNo: body.courtCaseNo.trim(),
    },
  });
  expect(detail.acceptanceMaterials.ACCEPTANCE_NOTICE.frozen).toContainEqual(
    expect.objectContaining({ contentVersionId: notice.contentVersionId }),
  );
  expect(detail.acceptanceMaterials.ACCEPTANCE_NOTICE.available).toEqual([]);
  expect(detail.acceptanceMaterials.PAYMENT_LIST.available).toContainEqual(
    expect.objectContaining({ contentVersionId: unselected.contentVersionId }),
  );
  expect(detail.acceptanceMaterials.PAYMENT_LIST.later).toContainEqual(
    expect.objectContaining({ contentVersionId: payment.contentVersionId }),
  );
  const download = await request.get(
    `/api/v1/materials/${notice.materialId}/versions/${notice.contentVersionId}/content`,
    { headers: auth },
  );
  expect(download.status()).toBe(200);
  expect(await download.body()).toEqual(pdf);
  expect(await countCaseAcceptanceEffects(source.caseId)).toEqual({
    stage: 'WAITING_HEARING',
    version: 7,
    courtCaseNo: body.courtCaseNo.trim(),
    facts: 1,
    versions: 1,
    references: 1,
    receipts: 1,
    audits: 1,
  });
  await json(
    await request.post('/api/v1/auth/login', {
      headers: { Origin: 'http://127.0.0.1:5174' },
      data: {
        username: source.clientSession.user.username,
        password: 'client correct horse battery',
      },
    }),
    200,
  );
  const client = await json<Record<string, unknown>>(
    await request.get(`/api/v1/client/cases/${source.caseId}`),
    200,
  );
  expect(client.stage).toBe('WAITING_HEARING');
  expect(client).not.toHaveProperty('acceptance');
  expect(client).not.toHaveProperty('acceptanceMaterials');
  expect(client).not.toHaveProperty('courtCaseNo');
  expect(
    (
      await request.post(`/api/v1/cases/${source.caseId}/acceptance-register`, {
        data: body,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.get(
        `/api/v1/materials/${notice.materialId}/versions/${notice.contentVersionId}/content`,
      )
    ).status(),
  ).toBe(404);
});

test('current real lawyer registers without optional files and loses replay access after transfer', async ({
  request,
}) => {
  test.setTimeout(240_000);
  const { source, headers, prefix } = await waitingFormal(request, true);
  const body = {
    expectedVersion: 6,
    idempotencyKey: randomUUID(),
    acceptedAt: today(),
    courtCaseNo: 'LAWYER-CA006-1',
  };
  const result = await json<ApiResult>(
    await request.post(`${prefix}/${source.caseId}/acceptance-register`, {
      headers,
      data: body,
    }),
    201,
  );
  expect(result.stage).toBe('WAITING_HEARING');
  const detail = await json<{ acceptance: Record<string, unknown> }>(
    await request.get(`${prefix}/${source.caseId}`),
    200,
  );
  expect(detail.acceptance).not.toHaveProperty('recordedByUserId');
  expect(await countCaseAcceptanceEffects(source.caseId)).toMatchObject({
    facts: 1,
    versions: 0,
    receipts: 1,
  });
  const later = await upload(request, source.caseId, 'PAYMENT_LIST', headers);
  const downloadUrl = `/api/v1/materials/${later.materialId}/versions/${later.contentVersionId}/content`;
  expect((await request.get(downloadUrl)).status()).toBe(200);
  await endCurrentLawyerAssignment(
    source.caseId,
    source.lawyer.profiles[0].profileId,
  );
  expect(
    (
      await request.post(`${prefix}/${source.caseId}/acceptance-register`, {
        headers,
        data: body,
      })
    ).status(),
  ).toBe(403);
  expect((await request.get(downloadUrl)).status()).toBe(403);
});

test('rejects invalid versions and scope, then rolls back each failed side effect', async ({
  request,
}) => {
  test.setTimeout(240_000);
  const { source } = await waitingFormal(request);
  const notice = await upload(request, source.caseId, 'ACCEPTANCE_NOTICE');
  const wrong = await upload(request, source.caseId, 'PAYMENT_LIST');
  const body = {
    expectedVersion: 6,
    idempotencyKey: randomUUID(),
    acceptedAt: today(),
    courtCaseNo: 'CA006-rollback',
    acceptanceNoticeContentVersionIds: [notice.contentVersionId],
  };
  for (const ids of [
    [wrong.contentVersionId],
    [notice.contentVersionId, notice.contentVersionId],
    [randomUUID()],
  ]) {
    const response = await request.post(
      `/api/v1/cases/${source.caseId}/acceptance-register`,
      {
        headers: auth,
        data: { ...body, acceptanceNoticeContentVersionIds: ids },
      },
    );
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
  }
  for (const acceptedAt of ['2026-02-30', '9999-12-31', '2026-10-01']) {
    const response = await request.post(
      `/api/v1/cases/${source.caseId}/acceptance-register`,
      { headers: auth, data: { ...body, acceptedAt } },
    );
    expect(response.status()).toBe(400);
  }
  expect(
    (
      await request.post(`/api/v1/cases/${source.caseId}/acceptance-register`, {
        headers: auth,
        data: { ...body, expectedVersion: 5 },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.post(`/api/v1/cases/${source.caseId}/acceptance-register`, {
        headers: authSelf,
        data: body,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post(`/api/v1/cases/${source.caseId}/acceptance-register`, {
        headers: authOther,
        data: body,
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post(`/api/v1/cases/${source.caseId}/acceptance-register`, {
        headers: { 'X-CSRF-Token': source.notarySession.csrfToken },
        data: body,
      })
    ).status(),
  ).toBe(403);
  for (const kind of ['audit', 'fact', 'freeze', 'receipt'] as const) {
    await rejectCaseAcceptanceWrite(kind);
    const response = await request.post(
      `/api/v1/cases/${source.caseId}/acceptance-register`,
      { headers: auth, data: body },
    );
    expect(response.status()).toBe(500);
    expect(await countCaseAcceptanceEffects(source.caseId)).toEqual({
      stage: 'WAITING_FORMAL_ACCEPTANCE',
      version: 6,
      courtCaseNo: null,
      facts: 0,
      versions: 0,
      references: 0,
      receipts: 0,
      audits: 0,
    });
    await clearCaseAcceptanceFault();
  }
  expect(
    (
      await request.post(`/api/v1/cases/${source.caseId}/acceptance-register`, {
        headers: auth,
        data: body,
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await request.post(`/api/v1/cases/${source.caseId}/acceptance-register`, {
        headers: auth,
        data: { ...body, courtCaseNo: 'changed' },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.post(`/api/v1/cases/${source.caseId}/acceptance-register`, {
        headers: auth,
        data: { ...body, idempotencyKey: randomUUID(), expectedVersion: 7 },
      })
    ).status(),
  ).toBe(409);
  await revokeCaseAcceptanceGrant();
  expect(
    (
      await request.post(`/api/v1/cases/${source.caseId}/acceptance-register`, {
        headers: auth,
        data: body,
      })
    ).status(),
  ).toBe(403);
});

test('two concurrent registration keys yield exactly one immutable acceptance', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const { source } = await waitingFormal(request);
  const body = {
    expectedVersion: 6,
    acceptedAt: today(),
    courtCaseNo: 'CA006-concurrent',
  };
  const responses = await Promise.all(
    [1, 2].map(() =>
      request.post(`/api/v1/cases/${source.caseId}/acceptance-register`, {
        headers: auth,
        data: { ...body, idempotencyKey: randomUUID() },
      }),
    ),
  );
  expect(responses.map((response) => response.status()).sort()).toEqual([
    201, 409,
  ]);
  expect(await countCaseAcceptanceEffects(source.caseId)).toEqual({
    stage: 'WAITING_HEARING',
    version: 7,
    courtCaseNo: body.courtCaseNo,
    facts: 1,
    versions: 0,
    references: 0,
    receipts: 1,
    audits: 1,
  });
});
