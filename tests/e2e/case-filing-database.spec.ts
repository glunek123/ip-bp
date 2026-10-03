import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  coreLeadFixtures,
  resetCoreLeadE2eData,
  reassignCaseToOtherFixtureTeam,
  setInternalAccountActive,
} from '../support/core-lead-database.mjs';
import { createSubmittedCaseThroughApi } from '../support/case-complaint-confirmation-database.mjs';
import { clearCaseComplaintMailingFixture } from '../support/case-complaint-mailing-database.mjs';
import {
  clearCaseFilingFault,
  clearCaseFilingFixture,
  countCaseFilingEffects,
  prepareCaseFilingFixture,
  rejectCaseFilingWrite,
  revokeCaseFilingGrant,
} from '../support/case-filing-database.mjs';

const auth = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const authOther = { Authorization: `Bearer ${coreLeadFixtures.tokenB}` };
const authSelf = { Authorization: `Bearer ${coreLeadFixtures.tokenSelf}` };
const pdf = Buffer.from('%PDF-1.4\nCA005 real evidence\n%%EOF\n');
const dateShanghai = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
type ApiCase = {
  caseId: string;
  complaint: { contentVersionId: string };
  clientSession: { user: { username: string } };
  notarySession: { csrfToken: string };
};
type ApiVersion = { materialId: string; contentVersionId: string };
type ApiResult = {
  id: string;
  stage: string;
  version: number;
  submittedAt: string;
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
  category: 'MAIL_RECEIPT' | 'FILING_EVIDENCE' | 'FILING_SCREENSHOT',
) {
  const draft = await json<{ id: string }>(
    await request.post('/api/v1/materials/upload-drafts', {
      headers: auth,
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
      headers: { ...auth, 'Content-Type': 'application/octet-stream' },
      data: pdf,
    }),
    200,
  );
}
async function waitingFilingCase(request: APIRequestContext) {
  const source = (await createSubmittedCaseThroughApi(
    request,
  )) as unknown as ApiCase;
  await json(
    await request.post(`/api/v1/cases/${source.caseId}/complaint-confirm`, {
      headers: auth,
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
  const receipt = await upload(request, source.caseId, 'MAIL_RECEIPT');
  await json(
    await request.post(`/api/v1/cases/${source.caseId}/complaint-mail`, {
      headers: auth,
      data: {
        expectedVersion: 4,
        idempotencyKey: randomUUID(),
        mailedAt: dateShanghai(),
        mailReceiptContentVersionIds: [receipt.contentVersionId],
      },
    }),
    201,
  );
  return source;
}
async function filingInput(request: APIRequestContext, caseId: string) {
  const court = await json<{ id: string; name: string }>(
    await request.post(`/api/v1/cases/${caseId}/filing-courts`, {
      headers: auth,
      data: { name: `真实法院${randomUUID().slice(0, 8)}` },
    }),
    201,
  );
  const evidence = await upload(request, caseId, 'FILING_EVIDENCE');
  const screenshot = await upload(request, caseId, 'FILING_SCREENSHOT');
  return {
    expectedVersion: 5,
    idempotencyKey: randomUUID(),
    courtId: court.id,
    submittedAt: dateShanghai(),
    mediationNo: '诉调2026-1',
    filingEvidenceContentVersionIds: [evidence.contentVersionId],
    filingScreenshotContentVersionIds: [screenshot.contentVersionId],
    evidence,
    screenshot,
    court,
  };
}
function filingBody(input: Awaited<ReturnType<typeof filingInput>>) {
  return {
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
    courtId: input.courtId,
    submittedAt: input.submittedAt,
    mediationNo: input.mediationNo,
    filingEvidenceContentVersionIds: input.filingEvidenceContentVersionIds,
    filingScreenshotContentVersionIds: input.filingScreenshotContentVersionIds,
  };
}

test.beforeEach(async () => {
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
  await resetCoreLeadE2eData();
  await prepareCaseFilingFixture();
});
test.afterEach(async () => {
  await clearCaseFilingFault();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
});

test('formal API source chain files one case and preserves exact files without client disclosure', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const source = await waitingFilingCase(request);
  const { caseId } = source;
  const input = await filingInput(request, caseId);
  const list = await json<{ items: Array<{ id: string; name: string }> }>(
    await request.get(`/api/v1/cases/${caseId}/filing-courts`, {
      headers: auth,
    }),
    200,
  );
  expect(list.items).toContainEqual(input.court);
  const { evidence, screenshot, court } = input;
  const body = filingBody(input);
  const result = await json<ApiResult>(
    await request.post(`/api/v1/cases/${caseId}/filing-submit`, {
      headers: auth,
      data: body,
    }),
    201,
  );
  expect(result).toMatchObject({
    id: caseId,
    stage: 'WAITING_FORMAL_ACCEPTANCE',
    version: 6,
    submittedAt: body.submittedAt,
    recordedAt: expect.any(String),
  });
  const detail = await json<Record<string, unknown>>(
    await request.get(`/api/v1/cases/${caseId}`, { headers: auth }),
    200,
  );
  expect(detail).toMatchObject({
    stage: 'WAITING_FORMAL_ACCEPTANCE',
    version: 6,
    courtCaseNo: null,
    filingSubmission: {
      court,
      submittedAt: body.submittedAt,
      mediationNo: body.mediationNo,
      evidenceFiles: [{ contentVersionId: evidence.contentVersionId }],
      screenshotFiles: [{ contentVersionId: screenshot.contentVersionId }],
    },
    complaintConfirmation: { amount: '123.45' },
  });
  const download = await request.get(
    `/api/v1/materials/${evidence.materialId}/versions/${evidence.contentVersionId}/content`,
    { headers: auth },
  );
  expect(download.status()).toBe(200);
  expect(await download.body()).toEqual(pdf);
  const replay = await json<ApiResult>(
    await request.post(`/api/v1/cases/${caseId}/filing-submit`, {
      headers: auth,
      data: body,
    }),
    201,
  );
  expect(replay).toEqual(result);
  expect(await countCaseFilingEffects(caseId)).toEqual({
    stage: 'WAITING_FORMAL_ACCEPTANCE',
    version: 6,
    facts: 1,
    versions: 2,
    references: 2,
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
    await request.get(`/api/v1/client/cases/${caseId}`),
    200,
  );
  expect(client).toMatchObject({
    stage: 'WAITING_FORMAL_ACCEPTANCE',
    confirmedAmount: '123.45',
  });
  expect(client).not.toHaveProperty('filingSubmission');
  const clientFile = await request.get(
    `/api/v1/materials/${evidence.materialId}/versions/${evidence.contentVersionId}/content`,
  );
  expect(clientFile.status()).toBe(404);
});

test('rejects wrong court, missing evidence, stale version, wrong scope and replays after transfer', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const { caseId } = await waitingFilingCase(request);
  const input = await filingInput(request, caseId);
  const body = filingBody(input);
  const bad = await request.post(`/api/v1/cases/${caseId}/filing-submit`, {
    headers: auth,
    data: { ...body, courtId: randomUUID() },
  });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).code).toBe('VALIDATION_ERROR');
  expect(
    (
      await request.post(`/api/v1/cases/${caseId}/filing-submit`, {
        headers: auth,
        data: { ...body, filingEvidenceContentVersionIds: [] },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post(`/api/v1/cases/${caseId}/filing-submit`, {
        headers: auth,
        data: { ...body, expectedVersion: 4 },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.post(`/api/v1/cases/${caseId}/filing-submit`, {
        headers: authOther,
        data: body,
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post(`/api/v1/cases/${caseId}/filing-submit`, {
        headers: authSelf,
        data: body,
      })
    ).status(),
  ).toBe(403);
  const result = await json<ApiResult>(
    await request.post(`/api/v1/cases/${caseId}/filing-submit`, {
      headers: auth,
      data: body,
    }),
    201,
  );
  expect(
    (
      await request.post(`/api/v1/cases/${caseId}/filing-submit`, {
        headers: auth,
        data: { ...body, mediationNo: 'changed' },
      })
    ).status(),
  ).toBe(409);
  await reassignCaseToOtherFixtureTeam(caseId);
  expect(
    (
      await request.post(`/api/v1/cases/${caseId}/filing-submit`, {
        headers: auth,
        data: body,
      })
    ).status(),
  ).toBe(403);
  expect(result.version).toBe(6);
});

test('rolls back stage, audit, fact, freeze and receipt on each injected failure', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const { caseId } = await waitingFilingCase(request);
  const input = await filingInput(request, caseId);
  const body = filingBody(input);
  for (const kind of ['audit', 'fact', 'freeze', 'receipt'] as const) {
    await rejectCaseFilingWrite(kind);
    const response = await request.post(
      `/api/v1/cases/${caseId}/filing-submit`,
      { headers: auth, data: body },
    );
    expect(response.status()).toBe(500);
    expect(await countCaseFilingEffects(caseId)).toEqual({
      stage: 'WAITING_FILING',
      version: 5,
      facts: 0,
      versions: 0,
      references: 0,
      receipts: 0,
      audits: 0,
    });
    await clearCaseFilingFault();
  }
  expect(
    (
      await request.post(`/api/v1/cases/${caseId}/filing-submit`, {
        headers: auth,
        data: body,
      })
    ).status(),
  ).toBe(201);
});

test('rejects other-case, duplicate, missing and wrong-category material versions', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const { caseId } = await waitingFilingCase(request);
  const input = await filingInput(request, caseId);
  const other = await waitingFilingCase(request);
  const foreignFile = await upload(request, other.caseId, 'FILING_EVIDENCE');
  const { evidence, screenshot } = input;
  const body = filingBody(input);
  for (const ids of [
    [foreignFile.contentVersionId],
    [evidence.contentVersionId, evidence.contentVersionId],
    [screenshot.contentVersionId],
    [randomUUID()],
  ]) {
    const response = await request.post(
      `/api/v1/cases/${caseId}/filing-submit`,
      {
        headers: auth,
        data: { ...body, filingEvidenceContentVersionIds: ids },
      },
    );
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
  }
  expect(await countCaseFilingEffects(caseId)).toEqual({
    stage: 'WAITING_FILING',
    version: 5,
    facts: 0,
    versions: 0,
    references: 0,
    receipts: 0,
    audits: 0,
  });
});

test('refuses client and notary submissions and rechecks revoked grant and disabled actor on replay', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const source = await waitingFilingCase(request);
  const { caseId } = source;
  const input = await filingInput(request, caseId);
  const body = filingBody(input);
  expect(
    (
      await request.post(`/api/v1/cases/${caseId}/filing-submit`, {
        headers: { 'X-CSRF-Token': source.notarySession.csrfToken },
        data: body,
      })
    ).status(),
  ).toBe(403);
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
  expect(
    (
      await request.post(`/api/v1/cases/${caseId}/filing-submit`, {
        data: body,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post(`/api/v1/cases/${caseId}/filing-courts`, {
        data: { name: '客户伪造法院' },
      })
    ).status(),
  ).toBe(403);
  const first = await json<ApiResult>(
    await request.post(`/api/v1/cases/${caseId}/filing-submit`, {
      headers: auth,
      data: body,
    }),
    201,
  );
  await revokeCaseFilingGrant();
  expect(
    (
      await request.post(`/api/v1/cases/${caseId}/filing-submit`, {
        headers: auth,
        data: body,
      })
    ).status(),
  ).toBe(403);
  await prepareCaseFilingFixture();
  await setInternalAccountActive(coreLeadFixtures.userA, false);
  try {
    expect(
      (
        await request.post(`/api/v1/cases/${caseId}/filing-submit`, {
          headers: auth,
          data: body,
        })
      ).status(),
    ).toBe(403);
  } finally {
    await setInternalAccountActive(coreLeadFixtures.userA, true);
  }
  expect(first.stage).toBe('WAITING_FORMAL_ACCEPTANCE');
  expect(await countCaseFilingEffects(caseId)).toEqual({
    stage: 'WAITING_FORMAL_ACCEPTANCE',
    version: 6,
    facts: 1,
    versions: 2,
    references: 2,
    receipts: 1,
    audits: 1,
  });
});

test('competing different keys and expected versions produce exactly one submission', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const { caseId } = await waitingFilingCase(request);
  const input = await filingInput(request, caseId);
  const body = filingBody(input);
  const [one, two] = await Promise.all([
    request.post(`/api/v1/cases/${caseId}/filing-submit`, {
      headers: auth,
      data: body,
    }),
    request.post(`/api/v1/cases/${caseId}/filing-submit`, {
      headers: auth,
      data: { ...body, idempotencyKey: randomUUID() },
    }),
  ]);
  expect([one.status(), two.status()].sort()).toEqual([201, 409]);
  expect(await countCaseFilingEffects(caseId)).toEqual({
    stage: 'WAITING_FORMAL_ACCEPTANCE',
    version: 6,
    facts: 1,
    versions: 2,
    references: 2,
    receipts: 1,
    audits: 1,
  });
});
