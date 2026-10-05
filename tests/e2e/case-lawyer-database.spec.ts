import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  createSubmittedCaseThroughApi,
  uploadCaseConfirmationFile,
} from '../support/case-complaint-confirmation-database.mjs';
import {
  allowInjectedFailures,
  coreLeadFixtures,
  countCaseComplaintConfirmationEffects,
  createHistoricalUnboundLawyerProfile,
  endCurrentLawyerAssignment,
  getUploadDraftStatus,
  rejectAuditWrites,
  rejectCaseComplaintConfirmationReceiptWrites,
  rejectCaseComplaintConfirmationReferenceWrites,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';
import { createLawyerAccountThroughApi } from '../support/case-lawyer-account.mjs';

const operator = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');

async function json<T>(
  response: Awaited<ReturnType<APIRequestContext['get']>>,
  status: number,
): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json() as Promise<T>;
}

test.beforeEach(async () => {
  await resetCoreLeadE2eData();
});
test.afterEach(async () => {
  await allowInjectedFailures();
});

function confirmationInput(versionId: string) {
  return {
    expectedVersion: 3,
    idempotencyKey: randomUUID(),
    confirmedComplaintContentVersionId: versionId,
    amountState: 'KNOWN',
    amount: '123.45',
    pendingReason: null,
    changeNote: null,
    confirmDisclose: true,
  };
}

test('real lawyer session handles CA-002 through CA-005 and loses access after binding revocation', async ({
  request,
}) => {
  test.setTimeout(240_000);
  const source = await createSubmittedCaseThroughApi(request, {
    submitAsLawyer: true,
  });
  const headers = { 'X-CSRF-Token': source.lawyerSession!.csrfToken };
  expect(source.lawyerSession).toMatchObject({ principalType: 'LAWYER' });

  const listed = await json<{
    total: number;
    counts: Record<string, number>;
    items: Array<{ id: string }>;
  }>(await request.get('/api/v1/lawyer/cases?view=department'), 200);
  expect(listed).toMatchObject({
    total: 1,
    counts: { WAITING_COMPLAINT_CONFIRMATION: 1 },
    items: [{ id: source.caseId }],
  });
  const detail = await json<{
    certificate: {
      files: Array<{ materialId: string; contentVersionId: string }>;
    };
    canConfirmComplaint: boolean;
  }>(await request.get(`/api/v1/lawyer/cases/${source.caseId}`), 200);
  expect(detail.canConfirmComplaint).toBe(true);
  expect(detail).not.toHaveProperty('owner');
  expect(detail).not.toHaveProperty('fees');
  const certificateFile = detail.certificate.files[0];
  expect(
    (
      await request.get(
        `/api/v1/materials/${certificateFile.materialId}/versions/${certificateFile.contentVersionId}/content`,
      )
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.get(
        `/api/v1/materials?ownerType=NOTARY_MATTER&ownerId=${source.caseId}`,
      )
    ).status(),
  ).toBe(403);

  const confirmedKey = randomUUID();
  await json(
    await request.post(
      `/api/v1/lawyer/cases/${source.caseId}/complaint-confirm`,
      {
        headers: { ...headers, 'Idempotency-Key': confirmedKey },
        data: {
          expectedVersion: 3,
          idempotencyKey: confirmedKey,
          confirmedComplaintContentVersionId: source.complaint.contentVersionId,
          amountState: 'KNOWN',
          amount: '123.45',
          pendingReason: null,
          changeNote: null,
          confirmDisclose: true,
        },
      },
    ),
    201,
  );

  const draft = await json<{ id: string }>(
    await request.post('/api/v1/materials/upload-drafts', {
      headers,
      data: {
        ownerType: 'CASE',
        ownerId: source.caseId,
        category: 'MAIL_RECEIPT',
        purpose: 'MAIL_RECEIPT',
        originalFilename: '律师邮寄凭证.pdf',
        declaredMimeType: 'application/pdf',
      },
    }),
    201,
  );
  const receipt = await json<{ contentVersionId: string }>(
    await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: pdf,
    }),
    200,
  );
  const mailedKey = randomUUID();
  await json(
    await request.post(`/api/v1/lawyer/cases/${source.caseId}/complaint-mail`, {
      headers: { ...headers, 'Idempotency-Key': mailedKey },
      data: {
        expectedVersion: 4,
        idempotencyKey: mailedKey,
        mailedAt: '2026-10-02',
        mailReceiptContentVersionIds: [receipt.contentVersionId],
      },
    }),
    201,
  );

  const evidence = await uploadCaseConfirmationFile(
    request,
    source.caseId,
    'FILING_EVIDENCE',
    headers,
  );
  const court = await json<{ id: string }>(
    await request.post(`/api/v1/lawyer/cases/${source.caseId}/filing-courts`, {
      headers,
      data: { name: `测试法院${randomUUID().slice(0, 6)}` },
    }),
    201,
  );
  const filedKey = randomUUID();
  await json(
    await request.post(`/api/v1/lawyer/cases/${source.caseId}/filing-submit`, {
      headers: { ...headers, 'Idempotency-Key': filedKey },
      data: {
        expectedVersion: 5,
        idempotencyKey: filedKey,
        courtId: court.id,
        submittedAt: '2026-10-03',
        filingEvidenceContentVersionIds: [evidence.contentVersionId],
        filingScreenshotContentVersionIds: [],
      },
    }),
    201,
  );
  const finalDetail = await json<{ stage: string; canSubmitFiling: boolean }>(
    await request.get(`/api/v1/lawyer/cases/${source.caseId}`),
    200,
  );
  expect(finalDetail).toMatchObject({
    stage: 'WAITING_FORMAL_ACCEPTANCE',
    canSubmitFiling: false,
  });

  await json(
    await request.patch(
      `/api/v1/lawyer-accounts/${source.lawyer.id}/bindings/${source.lawyer.profiles[0].bindingId}/status`,
      {
        headers: operator,
        data: { active: false, expectedVersion: 1 },
      },
    ),
    200,
  );
  expect([401, 403]).toContain(
    (await request.get(`/api/v1/lawyer/cases/${source.caseId}`)).status(),
  );
  await json(
    await request.post('/api/v1/auth/login', {
      data: {
        username: source.clientSession.user.username,
        password: 'client correct horse battery',
      },
    }),
    200,
  );
  expect(
    (await request.get(`/api/v1/lawyer/cases/${source.caseId}`)).status(),
  ).toBe(403);
  await json(
    await request.post('/api/v1/auth/login', {
      data: {
        username: source.notarySession.user.username,
        password: 'notary correct horse battery',
      },
    }),
    200,
  );
  expect(
    (await request.get(`/api/v1/lawyer/cases/${source.caseId}`)).status(),
  ).toBe(403);
});

test('operator and lawyer confirmation race has one winner and one durable fact', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const source = await createSubmittedCaseThroughApi(request, {
    submitAsLawyer: true,
  });
  const lawyerInput = confirmationInput(source.complaint.contentVersionId);
  const operatorInput = confirmationInput(source.complaint.contentVersionId);
  const responses = await Promise.all([
    request.post(`/api/v1/lawyer/cases/${source.caseId}/complaint-confirm`, {
      headers: {
        'X-CSRF-Token': source.lawyerSession!.csrfToken,
        'Idempotency-Key': lawyerInput.idempotencyKey,
      },
      data: lawyerInput,
    }),
    request.post(`/api/v1/cases/${source.caseId}/complaint-confirm`, {
      headers: { ...operator, 'Idempotency-Key': operatorInput.idempotencyKey },
      data: operatorInput,
    }),
  ]);
  expect(responses.map((response) => response.status()).sort()).toEqual([
    201, 409,
  ]);
  expect(await countCaseComplaintConfirmationEffects(source.caseId)).toEqual({
    facts: 1,
    receipts: 1,
    audits: 1,
    references: 1,
  });
});

test('lawyer confirmation replay requires the same request and a current assignment', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const source = await createSubmittedCaseThroughApi(request, {
    submitAsLawyer: true,
  });
  const input = confirmationInput(source.complaint.contentVersionId);
  const headers = {
    'X-CSRF-Token': source.lawyerSession!.csrfToken,
    'Idempotency-Key': input.idempotencyKey,
  };
  const url = `/api/v1/lawyer/cases/${source.caseId}/complaint-confirm`;

  const staleKey = randomUUID();
  const stale = await request.post(url, {
    headers: { ...headers, 'Idempotency-Key': staleKey },
    data: { ...input, idempotencyKey: staleKey, expectedVersion: 2 },
  });
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
  const first = await json<{ id: string; version: number }>(
    await request.post(url, { headers, data: input }),
    201,
  );
  expect(
    await json(await request.post(url, { headers, data: input }), 201),
  ).toEqual(first);
  const changed = await request.post(url, {
    headers,
    data: { ...input, amount: '124.00' },
  });
  expect(changed.status()).toBe(409);
  expect(await changed.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  const wrongStageKey = randomUUID();
  const wrongStage = await request.post(url, {
    headers: { ...headers, 'Idempotency-Key': wrongStageKey },
    data: { ...input, idempotencyKey: wrongStageKey, expectedVersion: 4 },
  });
  expect(wrongStage.status()).toBe(409);
  expect(await countCaseComplaintConfirmationEffects(source.caseId)).toEqual({
    facts: 1,
    receipts: 1,
    audits: 1,
    references: 1,
  });

  await endCurrentLawyerAssignment(
    source.caseId,
    source.lawyer.profiles[0].profileId,
  );
  expect(
    (await request.get(`/api/v1/lawyer/cases/${source.caseId}`)).status(),
  ).toBe(404);
  expect((await request.post(url, { headers, data: input })).status()).toBe(
    403,
  );
  expect(
    (
      await request.get(
        `/api/v1/materials?ownerType=CASE&ownerId=${source.caseId}`,
      )
    ).status(),
  ).toBe(403);
});

test('lawyer account and material operations enforce management, stage, and frozen-reference boundaries', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const source = await createSubmittedCaseThroughApi(request, {
    submitAsLawyer: true,
  });
  const headers = { 'X-CSRF-Token': source.lawyerSession!.csrfToken };
  expect((await request.get('/api/v1/lawyer-accounts')).status()).toBe(403);
  expect(
    (
      await request.post('/api/v1/lawyer-accounts', {
        headers,
        data: {
          fullName: '越权律师',
          username: `unauthorized-${randomUUID().slice(0, 8)}`,
          password: 'Lawyer password 2026!',
        },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.patch(
        `/api/v1/lawyer-accounts/${source.lawyer.id}/status`,
        {
          headers: { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
          data: { active: false, expectedAuthorizationRevision: 1 },
        },
      )
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post('/api/v1/materials/upload-drafts', {
        headers,
        data: {
          ownerType: 'CASE',
          ownerId: source.caseId,
          category: 'MAIL_RECEIPT',
          purpose: 'MAIL_RECEIPT',
          originalFilename: '错误阶段.pdf',
          declaredMimeType: 'application/pdf',
        },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.delete(
        `/api/v1/materials/${source.complaint.materialId}?expectedVersion=1`,
        { headers },
      )
    ).status(),
  ).toBe(409);
});

test('lawyer confirmation audit, frozen reference, and receipt faults roll back and permit retry', async ({
  request,
}) => {
  test.setTimeout(240_000);
  for (const inject of [
    () => rejectAuditWrites('case.complaint.confirmed'),
    rejectCaseComplaintConfirmationReferenceWrites,
    rejectCaseComplaintConfirmationReceiptWrites,
  ]) {
    const source = await createSubmittedCaseThroughApi(request, {
      submitAsLawyer: true,
    });
    const input = confirmationInput(source.complaint.contentVersionId);
    const headers = {
      'X-CSRF-Token': source.lawyerSession!.csrfToken,
      'Idempotency-Key': input.idempotencyKey,
    };
    await inject();
    const failed = await request.post(
      `/api/v1/lawyer/cases/${source.caseId}/complaint-confirm`,
      { headers, data: input },
    );
    expect(failed.status()).toBeGreaterThanOrEqual(500);
    const unchanged = await json<{ stage: string; version: number }>(
      await request.get(`/api/v1/lawyer/cases/${source.caseId}`),
      200,
    );
    expect(unchanged).toMatchObject({
      stage: 'WAITING_COMPLAINT_CONFIRMATION',
      version: 3,
    });
    expect(await countCaseComplaintConfirmationEffects(source.caseId)).toEqual({
      facts: 0,
      receipts: 0,
      audits: 0,
      references: 0,
    });
    await allowInjectedFailures();
    await json(
      await request.post(
        `/api/v1/lawyer/cases/${source.caseId}/complaint-confirm`,
        { headers, data: input },
      ),
      201,
    );
  }
});

test('a lawyer upload draft cannot finish after its binding is revoked', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const source = await createSubmittedCaseThroughApi(request, {
    submitAsLawyer: true,
  });
  const headers = { 'X-CSRF-Token': source.lawyerSession!.csrfToken };
  const draft = await json<{ id: string }>(
    await request.post('/api/v1/materials/upload-drafts', {
      headers,
      data: {
        ownerType: 'CASE',
        ownerId: source.caseId,
        category: 'COMPLAINT',
        purpose: 'COMPLAINT',
        originalFilename: '撤销后不得完成.pdf',
        declaredMimeType: 'application/pdf',
      },
    }),
    201,
  );
  await json(
    await request.patch(
      `/api/v1/lawyer-accounts/${source.lawyer.id}/bindings/${source.lawyer.profiles[0].bindingId}/status`,
      {
        headers: operator,
        data: { active: false, expectedVersion: 1 },
      },
    ),
    200,
  );
  expect([401, 403]).toContain(
    (
      await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
        headers: { ...headers, 'Content-Type': 'application/octet-stream' },
        data: pdf,
      })
    ).status(),
  );
  expect(await getUploadDraftStatus(draft.id)).toBe('OPEN');
});

test('operator chooses an unbound historical record, while matching candidates stay account-distinct', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const source = await createSubmittedCaseThroughApi(request);
  const historical = await createHistoricalUnboundLawyerProfile(source.caseId);
  const unbound = await json<{
    items: Array<{ profileId: string; caseBusinessNos: string[] }>;
  }>(
    await request.get('/api/v1/lawyer-accounts/unbound-profiles', {
      headers: operator,
    }),
    200,
  );
  expect(unbound.items).toContainEqual(
    expect.objectContaining({
      profileId: historical.id,
      caseBusinessNos: [expect.any(String)],
    }),
  );
  const bound = await json<{
    authorizationRevision: number;
    profiles: Array<{ profileId: string }>;
  }>(
    await request.post(`/api/v1/lawyer-accounts/${source.lawyer.id}/bindings`, {
      headers: operator,
      data: { profileId: historical.id, expectedAuthorizationRevision: 1 },
    }),
    201,
  );
  expect(bound.authorizationRevision).toBe(2);
  expect(bound.profiles).toHaveLength(2);
  const unboundAfter = await json<{ items: Array<{ profileId: string }> }>(
    await request.get('/api/v1/lawyer-accounts/unbound-profiles', {
      headers: operator,
    }),
    200,
  );
  expect(
    unboundAfter.items.some((profile) => profile.profileId === historical.id),
  ).toBe(false);

  const sameName = await createLawyerAccountThroughApi(request, {
    fullName: '诉状确认律师',
  });
  const foreignLawyer = await createLawyerAccountThroughApi(
    request,
    { fullName: '诉状确认律师' },
    { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
  );
  const candidates = await json<{
    items: Array<{
      lawyerAccountId: string;
      lawyerProfileId: string;
      username: string;
    }>;
  }>(
    await request.get(`/api/v1/cases/${source.caseId}/lawyer-accounts`, {
      headers: operator,
    }),
    200,
  );
  expect(
    candidates.items.filter(
      (item) => item.lawyerAccountId === source.lawyer.id,
    ),
  ).toEqual([
    expect.objectContaining({
      lawyerProfileId: source.lawyer.profiles[0].profileId,
    }),
  ]);
  expect(
    candidates.items.filter((item) => item.lawyerAccountId === sameName.id),
  ).toHaveLength(1);
  expect(
    candidates.items.some((item) => item.lawyerAccountId === foreignLawyer.id),
  ).toBe(false);
  expect(
    new Set(candidates.items.map((item) => item.lawyerAccountId)).size,
  ).toBe(candidates.items.length);
  const foreignUnbound = await json<{ items: unknown[] }>(
    await request.get('/api/v1/lawyer-accounts/unbound-profiles', {
      headers: { Authorization: `Bearer ${coreLeadFixtures.tokenB}` },
    }),
    200,
  );
  expect(foreignUnbound.items).toEqual([]);

  await json(
    await request.post('/api/v1/auth/login', {
      data: { username: sameName.username, password: sameName.password },
    }),
    200,
  );
  expect(
    (await request.get(`/api/v1/lawyer/cases/${source.caseId}`)).status(),
  ).toBe(404);
  await json(
    await request.post('/api/v1/auth/login', {
      data: {
        username: foreignLawyer.username,
        password: foreignLawyer.password,
      },
    }),
    200,
  );
  expect(
    (await request.get(`/api/v1/lawyer/cases/${source.caseId}`)).status(),
  ).toBe(404);

  const newPassword = 'Lawyer password reset 2026!';
  const passwordReset = await json<{ authorizationRevision: number }>(
    await request.post(
      `/api/v1/lawyer-accounts/${source.lawyer.id}/password-reset`,
      {
        headers: operator,
        data: { newPassword, expectedAuthorizationRevision: 2 },
      },
    ),
    201,
  );
  expect(passwordReset.authorizationRevision).toBe(3);
  expect(
    (
      await request.post('/api/v1/auth/login', {
        data: {
          username: source.lawyer.username,
          password: source.lawyer.password,
        },
      })
    ).status(),
  ).toBe(401);
  const newLogin = await json<{ principalType: string }>(
    await request.post('/api/v1/auth/login', {
      data: { username: source.lawyer.username, password: newPassword },
    }),
    200,
  );
  expect(newLogin.principalType).toBe('LAWYER');
  await json(
    await request.patch(`/api/v1/lawyer-accounts/${source.lawyer.id}/status`, {
      headers: operator,
      data: { active: false, expectedAuthorizationRevision: 3 },
    }),
    200,
  );
  expect(
    (await request.get(`/api/v1/lawyer/cases/${source.caseId}`)).status(),
  ).toBe(401);
});
