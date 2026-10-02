import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  allowInjectedFailures,
  coreLeadFixtures,
  countCaseComplaintConfirmationEffects,
  probeCaseComplaintConfirmationImmutability,
  reassignCaseToOtherFixtureTeam,
  rejectAuditWrites,
  rejectCaseComplaintConfirmationFactWrites,
  rejectCaseComplaintConfirmationReferenceWrites,
  rejectCaseComplaintConfirmationReceiptWrites,
  resetCoreLeadE2eData,
  setInternalAccountActive,
  setRoleGrant,
} from '../support/core-lead-database.mjs';
import {
  createSubmittedCaseThroughApi,
  uploadCaseConfirmationFile,
} from '../support/case-complaint-confirmation-database.mjs';

const auth = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const authSelf = { Authorization: `Bearer ${coreLeadFixtures.tokenSelf}` };
const authOther = { Authorization: `Bearer ${coreLeadFixtures.tokenB}` };
type Input = {
  expectedVersion: number;
  idempotencyKey: string;
  confirmedComplaintContentVersionId: string;
  amountState: 'KNOWN' | 'PENDING';
  amount: string | null;
  pendingReason: string | null;
  changeNote?: string;
  confirmDisclose: boolean;
};
function confirm(
  request: APIRequestContext,
  caseId: string,
  input: Input,
  headers: Record<string, string> = auth,
) {
  return request.post(`/api/v1/cases/${caseId}/complaint-confirm`, {
    headers: { ...headers, 'Idempotency-Key': input.idempotencyKey },
    data: input,
  });
}
function inputFor(versionId: string): Input {
  return {
    expectedVersion: 3,
    idempotencyKey: randomUUID(),
    confirmedComplaintContentVersionId: versionId,
    amountState: 'KNOWN',
    amount: '123.45',
    pendingReason: null,
    confirmDisclose: true,
  };
}

test.beforeEach(async () => {
  await resetCoreLeadE2eData();
});
test.afterEach(async () => {
  await allowInjectedFailures();
});

test('normal source chain confirms exact complaint, preserves submission and enforces live scope on replay', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const {
    caseId,
    complaint,
    authorization,
    submitted,
    clientSession,
    notarySession,
  } = await createSubmittedCaseThroughApi(request);
  const before = await request.get(`/api/v1/cases/${caseId}`, {
    headers: auth,
  });
  expect(before.status()).toBe(200);
  expect(await before.json()).toMatchObject({
    stage: 'WAITING_COMPLAINT_CONFIRMATION',
    canConfirmComplaint: true,
    complaintConfirmation: null,
  });
  const input = inputFor(complaint.contentVersionId);
  const created = await confirm(request, caseId, input);
  expect(created.status(), await created.text()).toBe(201);
  const result = await created.json();
  expect(result).toMatchObject({
    id: caseId,
    stage: 'WAITING_COMPLAINT_STAMP',
    version: 4,
    confirmedAt: expect.any(String),
  });
  const detail = await request.get(`/api/v1/cases/${caseId}`, {
    headers: auth,
  });
  expect(await detail.json()).toMatchObject({
    stage: 'WAITING_COMPLAINT_STAMP',
    canConfirmComplaint: false,
    complaint: {
      amountState: 'KNOWN',
      amount: '123.45',
      submittedAt: submitted.submittedAt,
      complaintFiles: [{ contentVersionId: complaint.contentVersionId }],
      authorizationFiles: [
        { contentVersionId: authorization.contentVersionId },
      ],
    },
    complaintConfirmation: {
      confirmedComplaintContentVersionId: complaint.contentVersionId,
      amountState: 'KNOWN',
      amount: '123.45',
      pendingReason: null,
      changeNote: null,
      confirmDisclose: true,
      confirmedAt: result.confirmedAt,
      complaintFile: { contentVersionId: complaint.contentVersionId },
    },
  });
  const listed = await request.get(
    '/api/v1/cases?view=mine&stage=WAITING_COMPLAINT_STAMP',
    { headers: auth },
  );
  expect(await listed.json()).toMatchObject({
    total: 1,
    counts: { WAITING_COMPLAINT_STAMP: 1 },
    items: [{ id: caseId, canConfirmComplaint: false }],
  });
  const originalDownload = await request.get(
    `/api/v1/materials/${authorization.materialId}/versions/${authorization.contentVersionId}/content`,
    { headers: auth },
  );
  expect(originalDownload.status()).toBe(200);
  const replay = await confirm(request, caseId, input);
  expect(replay.status()).toBe(201);
  expect(await replay.json()).toEqual(result);
  const changed = await confirm(request, caseId, {
    ...input,
    confirmDisclose: false,
  });
  expect(changed.status()).toBe(409);
  expect(await changed.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  expect(await countCaseComplaintConfirmationEffects(caseId)).toEqual({
    facts: 1,
    receipts: 1,
    audits: 1,
    references: 1,
  });
  expect(await probeCaseComplaintConfirmationImmutability(caseId)).toEqual({
    updateCode: '23514',
    deleteCode: '23514',
  });
  const sameDepartmentRead = await request.get(`/api/v1/cases/${caseId}`, {
    headers: authSelf,
  });
  expect(sameDepartmentRead.status()).toBe(200);
  const sameDepartmentDownload = await request.get(
    `/api/v1/materials/${complaint.materialId}/versions/${complaint.contentVersionId}/content`,
    { headers: authSelf },
  );
  expect(sameDepartmentDownload.status()).toBe(200);
  expect((await confirm(request, caseId, input, authSelf)).status()).toBe(403);
  expect((await confirm(request, caseId, input, authOther)).status()).toBe(404);
  expect([401, 403]).toContain(
    (
      await confirm(request, caseId, input, {
        'X-CSRF-Token': clientSession.csrfToken,
      })
    ).status(),
  );
  expect([401, 403]).toContain(
    (
      await confirm(request, caseId, input, {
        'X-CSRF-Token': notarySession.csrfToken,
      })
    ).status(),
  );
  await setInternalAccountActive(coreLeadFixtures.userA, false);
  expect([401, 403]).toContain(
    (await confirm(request, caseId, input)).status(),
  );
});

test('revision upload requires confirm scope and change note; stale, other-stage, and unavailable versions fail', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const { caseId, complaint } = await createSubmittedCaseThroughApi(request);
  const forbidden = await request.post('/api/v1/materials/upload-drafts', {
    headers: authSelf,
    data: {
      ownerType: 'CASE',
      ownerId: caseId,
      category: 'COMPLAINT',
      purpose: 'COMPLAINT',
      originalFilename: '无权.pdf',
      declaredMimeType: 'application/pdf',
    },
  });
  expect(forbidden.status()).toBe(403);
  const wrongCategory = await request.post('/api/v1/materials/upload-drafts', {
    headers: auth,
    data: {
      ownerType: 'CASE',
      ownerId: caseId,
      category: 'AUTHORIZATION',
      purpose: 'AUTHORIZATION',
      originalFilename: '授权书.pdf',
      declaredMimeType: 'application/pdf',
    },
  });
  expect(wrongCategory.status()).toBe(409);
  const revised = await uploadCaseConfirmationFile(request, caseId);
  const base = inputFor(revised.contentVersionId);
  const missingNote = await confirm(request, caseId, base);
  expect(missingNote.status()).toBe(400);
  const changedAmount = await confirm(request, caseId, {
    ...inputFor(complaint.contentVersionId),
    amount: '124.00',
  });
  expect(changedAmount.status()).toBe(400);
  const wrongVersion = await confirm(request, caseId, {
    ...base,
    confirmedComplaintContentVersionId: randomUUID(),
    changeNote: '版本更新',
  });
  expect(wrongVersion.status()).toBe(400);
  expect(await wrongVersion.json()).toMatchObject({
    code: 'MATERIAL_VERSION_INVALID',
  });
  const otherCase = await createSubmittedCaseThroughApi(request);
  const foreignMaterial = await confirm(request, caseId, {
    ...base,
    confirmedComplaintContentVersionId: otherCase.complaint.contentVersionId,
    changeNote: '改用其他文件',
  });
  expect(foreignMaterial.status()).toBe(400);
  expect(await foreignMaterial.json()).toMatchObject({
    code: 'MATERIAL_VERSION_INVALID',
  });
  const stale = await confirm(request, caseId, {
    ...base,
    expectedVersion: 2,
    changeNote: '版本更新',
  });
  expect(stale.status()).toBe(409);
  const approved = await confirm(request, caseId, {
    ...base,
    changeNote: '诉状修订后确认',
  });
  expect(approved.status(), await approved.text()).toBe(201);
  const after = await request.post('/api/v1/materials/upload-drafts', {
    headers: auth,
    data: {
      ownerType: 'CASE',
      ownerId: caseId,
      category: 'COMPLAINT',
      purpose: 'COMPLAINT',
      originalFilename: '后续.pdf',
      declaredMimeType: 'application/pdf',
    },
  });
  expect(after.status()).toBe(409);
  expect(await countCaseComplaintConfirmationEffects(caseId)).toEqual({
    facts: 1,
    receipts: 1,
    audits: 1,
    references: 1,
  });
});

test('revoking the confirm grant refuses an identical successful replay without changing its effects', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const { caseId, complaint } = await createSubmittedCaseThroughApi(request);
  const input = inputFor(complaint.contentVersionId);
  const initial = await confirm(request, caseId, input);
  expect(initial.status(), await initial.text()).toBe(201);
  const before = await countCaseComplaintConfirmationEffects(caseId);
  expect(before).toEqual({ facts: 1, receipts: 1, audits: 1, references: 1 });

  await setRoleGrant(
    coreLeadFixtures.roleA,
    'case.complaint.confirm',
    'TEAM',
    false,
  );
  const replay = await confirm(request, caseId, input);
  expect(replay.status()).toBe(403);
  expect(await countCaseComplaintConfirmationEffects(caseId)).toEqual(before);
});

test('reassigning the case to another team refuses an identical successful replay without changing its effects', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const { caseId, complaint } = await createSubmittedCaseThroughApi(request);
  const input = inputFor(complaint.contentVersionId);
  const initial = await confirm(request, caseId, input);
  expect(initial.status(), await initial.text()).toBe(201);
  const before = await countCaseComplaintConfirmationEffects(caseId);
  expect(before).toEqual({ facts: 1, receipts: 1, audits: 1, references: 1 });

  await reassignCaseToOtherFixtureTeam(caseId);
  const replay = await confirm(request, caseId, input);
  expect(replay.status()).toBe(403);
  expect(await countCaseComplaintConfirmationEffects(caseId)).toEqual(before);
});

test('audit, fact, freeze and receipt failures roll back all confirmation effects before retry', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const { caseId, complaint } = await createSubmittedCaseThroughApi(request);
  const input = inputFor(complaint.contentVersionId);
  for (const inject of [
    () => rejectAuditWrites('case.complaint.confirmed'),
    rejectCaseComplaintConfirmationFactWrites,
    rejectCaseComplaintConfirmationReferenceWrites,
    rejectCaseComplaintConfirmationReceiptWrites,
  ]) {
    await inject();
    const failed = await confirm(request, caseId, input);
    expect(failed.status()).toBeGreaterThanOrEqual(500);
    expect(await countCaseComplaintConfirmationEffects(caseId)).toEqual({
      facts: 0,
      receipts: 0,
      audits: 0,
      references: 0,
    });
    const unchanged = await request.get(`/api/v1/cases/${caseId}`, {
      headers: auth,
    });
    expect(await unchanged.json()).toMatchObject({
      stage: 'WAITING_COMPLAINT_CONFIRMATION',
      version: 3,
    });
    await allowInjectedFailures();
  }
  const retry = await confirm(request, caseId, input);
  expect(retry.status(), await retry.text()).toBe(201);
  expect(await countCaseComplaintConfirmationEffects(caseId)).toEqual({
    facts: 1,
    receipts: 1,
    audits: 1,
    references: 1,
  });
});

test('two concurrent keys produce one immutable confirmation', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const { caseId, complaint } = await createSubmittedCaseThroughApi(request);
  const first = inputFor(complaint.contentVersionId);
  const second = {
    ...first,
    idempotencyKey: randomUUID(),
    confirmDisclose: false,
  };
  const responses = await Promise.all([
    confirm(request, caseId, first),
    confirm(request, caseId, second),
  ]);
  expect(responses.map((response) => response.status()).sort()).toEqual([
    201, 409,
  ]);
  expect(await countCaseComplaintConfirmationEffects(caseId)).toEqual({
    facts: 1,
    receipts: 1,
    audits: 1,
    references: 1,
  });
});
