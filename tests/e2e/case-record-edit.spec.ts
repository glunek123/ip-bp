import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import {
  coreLeadFixtures,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';
import { createSubmittedCaseThroughApi } from '../support/case-complaint-confirmation-database.mjs';
import {
  allowOtherEnterpriseAccountSetup,
  clearCaseComplaintMailingFixture,
} from '../support/case-complaint-mailing-database.mjs';
import {
  clearCaseFilingFixture,
  prepareCaseFilingFixture,
} from '../support/case-filing-database.mjs';
import {
  clearCaseAcceptanceFixture,
  prepareCaseAcceptanceFixture,
} from '../support/case-acceptance-database.mjs';
import {
  clearCaseArchiveFixture,
  createClosedCaseArchiveSourceThroughApi,
  setCaseArchiveFixtureGrant,
} from '../support/case-archive-database.mjs';
import { clearCaseClosureFixture } from '../support/case-closure-database.mjs';
import { clearCaseExecutionFinishFixture } from '../support/case-execution-finish-database.mjs';
import { clearCoreCaseSecondInstanceFixture } from '../support/case-second-instance-database.mjs';
import {
  clearCoreCaseHearingAdmin,
  clearCoreCaseHearingAdminSessions,
  prepareCoreCaseHearingAdmin,
} from '../support/case-hearing-database.mjs';
import { disconnectCustomerTestDatabase } from '../support/customer-database.mjs';
import { openCaseWorkspaceCommand } from '../support/case-workspace-browser.js';
import {
  clearRecordEditFixture,
  recordEditSnapshot,
  rejectRecordEditWrite,
  clearRecordEditFault,
  grantRecordEditPredecessorActions,
  setRecordEditGrant,
} from '../support/case-record-edit-database.js';

const operator = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const foreign = { Authorization: `Bearer ${coreLeadFixtures.tokenB}` };
const readOnly = { Authorization: `Bearer ${coreLeadFixtures.tokenSelf}` };
const pdf = Buffer.from('%PDF-1.4\nCE001 preserved acceptance bytes\n%%EOF\n');
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const pastWorkflowDate = () => {
  const past = new Date(`${today()}T00:00:00.000Z`);
  past.setUTCDate(past.getUTCDate() - 2);
  const date = past.toISOString().slice(0, 10);
  return date > '2026-09-28' ? date : '2026-09-28';
};
type HttpResponse = {
  status(): number;
  text(): Promise<string>;
  json(): Promise<unknown>;
};
type CaseDetail = {
  id: string;
  stage: string;
  version: number;
  courtCaseNo: string | null;
  defendants: Array<{
    id: string;
    phone: string | null;
    address: string | null;
  }>;
  acceptance: null | { id: string; acceptedAt: string; courtCaseNo: string };
  recordEdits: {
    canUpdateDefendantContact: boolean;
    canCorrectAcceptance: boolean;
    defendantContacts: Array<{
      defendantId: string;
      contactRevision: number;
      history: Array<{
        fromRevision: number;
        toRevision: number;
        phone: string | null;
        address: string | null;
      }>;
    }>;
    acceptanceCorrections: Array<{
      acceptanceId: string;
      acceptanceRevision: number;
      originalAcceptedAt: string;
      originalCourtCaseNo: string;
      history: Array<{
        priorCorrectionId: string | null;
        fromRevision: number;
        toRevision: number;
        acceptedAt: string;
        courtCaseNo: string;
        reason: string;
      }>;
    }>;
  };
};
type ContactResult = {
  caseId: string;
  defendantId: string;
  changeId: string;
  contactRevision: number;
  phone: string | null;
  address: string | null;
  recordedAt: string;
};
type CorrectionResult = {
  caseId: string;
  acceptanceId: string;
  correctionId: string;
  acceptanceRevision: number;
  acceptedAt: string;
  courtCaseNo: string;
  recordedAt: string;
};
async function body<T>(response: HttpResponse, status = 200): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json() as Promise<T>;
}
async function reject(response: HttpResponse, statuses: number[]) {
  expect(statuses, await response.text()).toContain(response.status());
}
async function read(
  request: APIRequestContext,
  caseId: string,
  headers = operator,
) {
  return body<CaseDetail>(
    await request.get(`/api/v1/cases/${caseId}`, { headers }),
  );
}
async function upload(
  request: APIRequestContext,
  caseId: string,
  category: string,
) {
  const draft = await body<{ id: string }>(
    await request.post('/api/v1/materials/upload-drafts', {
      headers: operator,
      data: {
        ownerType: 'CASE',
        ownerId: caseId,
        category,
        purpose: category,
        originalFilename: 'ce001-acceptance.pdf',
        declaredMimeType: 'application/pdf',
      },
    }),
    201,
  );
  return body<{ materialId: string; contentVersionId: string }>(
    await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
      headers: { ...operator, 'Content-Type': 'application/octet-stream' },
      data: pdf,
    }),
  );
}
async function acceptedCase(
  request: APIRequestContext,
  businessDate = today(),
) {
  const source = await createSubmittedCaseThroughApi(request);
  const caseId = source.caseId;
  await body(
    await request.post(`/api/v1/cases/${caseId}/complaint-confirm`, {
      headers: operator,
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
  const mail = await upload(request, caseId, 'MAIL_RECEIPT');
  await body(
    await request.post(`/api/v1/cases/${caseId}/complaint-mail`, {
      headers: operator,
      data: {
        expectedVersion: 4,
        idempotencyKey: randomUUID(),
        mailedAt: businessDate,
        mailReceiptContentVersionIds: [mail.contentVersionId],
      },
    }),
    201,
  );
  const court = await body<{ id: string }>(
    await request.post(`/api/v1/cases/${caseId}/filing-courts`, {
      headers: operator,
      data: { name: `CE001 court ${randomUUID().slice(0, 8)}` },
    }),
    201,
  );
  const filing = await upload(request, caseId, 'FILING_EVIDENCE');
  await body(
    await request.post(`/api/v1/cases/${caseId}/filing-submit`, {
      headers: operator,
      data: {
        expectedVersion: 5,
        idempotencyKey: randomUUID(),
        courtId: court.id,
        submittedAt: businessDate,
        filingEvidenceContentVersionIds: [filing.contentVersionId],
      },
    }),
    201,
  );
  const notice = await upload(request, caseId, 'ACCEPTANCE_NOTICE');
  const originalInput = {
    expectedVersion: 6,
    idempotencyKey: randomUUID(),
    acceptedAt: businessDate,
    courtCaseNo: 'CE001 原案号',
    acceptanceNoticeContentVersionIds: [notice.contentVersionId],
  };
  const originalReceipt = await body<Record<string, unknown>>(
    await request.post(`/api/v1/cases/${caseId}/acceptance-register`, {
      headers: operator,
      data: originalInput,
    }),
    201,
  );
  const detail = await read(request, caseId);
  expect(detail.acceptance).not.toBeNull();
  return { source, caseId, detail, notice, originalInput, originalReceipt };
}
function contactInput(defendantId: string, revision: number) {
  return {
    defendantId,
    expectedContactRevision: revision,
    idempotencyKey: randomUUID(),
    phone: '  010-12345678  ',
    address: '  北京市合成地址  ',
  };
}
function correctionInput(
  acceptanceId: string,
  revision: number,
  acceptedAt: string,
) {
  return {
    acceptanceId,
    expectedAcceptanceRevision: revision,
    idempotencyKey: randomUUID(),
    acceptedAt,
    courtCaseNo: `CE001 更正案号 ${revision + 1}`,
    reason: `核对法院受理回执 ${revision + 1}`,
  };
}
async function clean() {
  await clearRecordEditFixture();
  await clearCaseArchiveFixture();
  await clearCaseClosureFixture();
  await clearCaseExecutionFinishFixture();
  await clearCoreCaseHearingAdminSessions();
  await clearCoreCaseSecondInstanceFixture();
  await clearCaseAcceptanceFixture();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
  await resetCoreLeadE2eData();
  await clearCoreCaseHearingAdmin();
}
test.beforeEach(async () => {
  await clean();
  await prepareCoreCaseHearingAdmin();
  await prepareCaseFilingFixture();
  await prepareCaseAcceptanceFixture();
});
test.afterEach(clean);
test.afterAll(disconnectCustomerTestDatabase);

test('contact save keeps workflow and original facts, with fixed replay, CAS and atomic failure', async ({
  request,
}) => {
  test.setTimeout(240_000);
  const { caseId, detail } = await acceptedCase(request);
  const defendantId = detail.defendants[0].id;
  expect(detail.recordEdits.defendantContacts).toContainEqual(
    expect.objectContaining({ defendantId, contactRevision: 0, history: [] }),
  );
  expect(detail.recordEdits.canUpdateDefendantContact).toBe(false);
  await setRecordEditGrant(
    coreLeadFixtures.roleA,
    'case.defendant-contact.update',
    'TEAM',
    true,
  );
  const before = await recordEditSnapshot(caseId);
  const input = contactInput(defendantId, 0);
  const url = `/api/v1/cases/${caseId}/defendant-contact-update`;
  const saved = await body<ContactResult>(
    await request.post(url, { headers: operator, data: input }),
    201,
  );
  expect(saved).toMatchObject({
    caseId,
    defendantId,
    contactRevision: 1,
    phone: input.phone.trim(),
    address: input.address.trim(),
  });
  expect(
    await body<ContactResult>(
      await request.post(url, { headers: operator, data: input }),
      201,
    ),
  ).toEqual(saved);
  await reject(
    await request.post(url, {
      headers: operator,
      data: { ...input, phone: '异参' },
    }),
    [409],
  );
  await reject(
    await request.post(url, {
      headers: operator,
      data: { ...input, idempotencyKey: randomUUID() },
    }),
    [409],
  );
  const second = contactInput(defendantId, 1);
  second.phone = '  '; // Both values are submitted; blank becomes null.
  second.address = '新地址';
  const beforeFailure = await recordEditSnapshot(caseId);
  await rejectRecordEditWrite('receipt');
  await reject(
    await request.post(url, { headers: operator, data: second }),
    [500],
  );
  await clearRecordEditFault();
  const afterFailure = await recordEditSnapshot(caseId);
  expect(afterFailure).toEqual(beforeFailure);
  expect(afterFailure.contactChanges).toHaveLength(1);
  expect(afterFailure.recordEditReceipts).toHaveLength(1);
  const updated = await body<ContactResult>(
    await request.post(url, { headers: operator, data: second }),
    201,
  );
  expect(updated).toMatchObject({
    contactRevision: 2,
    phone: null,
    address: '新地址',
  });
  const current = await read(request, caseId);
  expect(current).toMatchObject({
    stage: detail.stage,
    version: detail.version,
    courtCaseNo: detail.courtCaseNo,
  });
  expect(current.defendants[0]).toMatchObject({
    id: defendantId,
    phone: null,
    address: '新地址',
  });
  expect(current.recordEdits.defendantContacts[0]).toMatchObject({
    contactRevision: 2,
  });
  expect(
    current.recordEdits.defendantContacts[0].history.map(
      ({ fromRevision, toRevision }) => [fromRevision, toRevision],
    ),
  ).toEqual([
    [0, 1],
    [1, 2],
  ]);
  const after = await recordEditSnapshot(caseId);
  expect(after.originalAcceptances).toEqual(before.originalAcceptances);
  expect(after.matchingReceipts).toEqual(before.matchingReceipts);
  expect(after.acceptanceReceipts).toEqual(before.acceptanceReceipts);
  expect(after.materials).toEqual(before.materials);
  expect(after.case[0]).toEqual(before.case[0]);
  expect(after.contactChanges).toHaveLength(2);
  expect(after.recordEditReceipts).toHaveLength(2);
  const raceA = { ...contactInput(defendantId, 2), phone: '并发甲' };
  const raceB = { ...contactInput(defendantId, 2), phone: '并发乙' };
  const raced = await Promise.all([
    request.post(url, { headers: operator, data: raceA }),
    request.post(url, { headers: operator, data: raceB }),
  ]);
  expect(raced.map((response) => response.status()).sort()).toEqual([201, 409]);
  const afterRace = await recordEditSnapshot(caseId);
  expect(afterRace.contactChanges).toHaveLength(3);
  expect(afterRace.recordEditReceipts).toHaveLength(3);
});

test('acceptance correction chains exact root and rejects invalid values, old revision and partial writes', async ({
  request,
}) => {
  test.setTimeout(240_000);
  const { caseId, detail, notice, originalInput, originalReceipt } =
    await acceptedCase(request);
  const acceptanceId = detail.acceptance!.id;
  await setRecordEditGrant(
    coreLeadFixtures.roleA,
    'case.acceptance.correct',
    'TEAM',
    true,
  );
  const before = await recordEditSnapshot(caseId);
  const url = `/api/v1/cases/${caseId}/acceptance-correction`;
  const firstInput = correctionInput(
    acceptanceId,
    0,
    detail.acceptance!.acceptedAt,
  );
  for (const invalid of [
    { ...firstInput, idempotencyKey: randomUUID(), reason: '  ' },
    { ...firstInput, idempotencyKey: randomUUID(), courtCaseNo: '  ' },
    { ...firstInput, idempotencyKey: randomUUID(), acceptedAt: '2026-09-27' },
    { ...firstInput, idempotencyKey: randomUUID(), acceptedAt: '2099-01-01' },
    {
      ...firstInput,
      idempotencyKey: randomUUID(),
      expectedVersion: detail.version,
    },
  ])
    await reject(
      await request.post(url, { headers: operator, data: invalid }),
      [400],
    );
  const first = await body<CorrectionResult>(
    await request.post(url, { headers: operator, data: firstInput }),
    201,
  );
  expect(first).toMatchObject({
    caseId,
    acceptanceId,
    acceptanceRevision: 1,
    acceptedAt: firstInput.acceptedAt,
    courtCaseNo: firstInput.courtCaseNo,
  });
  expect(
    await body<CorrectionResult>(
      await request.post(url, { headers: operator, data: firstInput }),
      201,
    ),
  ).toEqual(first);
  await reject(
    await request.post(url, {
      headers: operator,
      data: { ...firstInput, courtCaseNo: '异参' },
    }),
    [409],
  );
  await reject(
    await request.post(url, {
      headers: operator,
      data: { ...firstInput, idempotencyKey: randomUUID() },
    }),
    [409],
  );
  const secondInput = correctionInput(
    acceptanceId,
    1,
    detail.acceptance!.acceptedAt,
  );
  await rejectRecordEditWrite('acceptance');
  await reject(
    await request.post(url, { headers: operator, data: secondInput }),
    [500],
  );
  await clearRecordEditFault();
  expect((await recordEditSnapshot(caseId)).acceptanceCorrections).toHaveLength(
    1,
  );
  const second = await body<CorrectionResult>(
    await request.post(url, { headers: operator, data: secondInput }),
    201,
  );
  expect(second.acceptanceRevision).toBe(2);
  const current = await read(request, caseId);
  expect(current).toMatchObject({
    stage: detail.stage,
    version: detail.version,
    courtCaseNo: secondInput.courtCaseNo,
  });
  expect(current.acceptance).toMatchObject({
    id: acceptanceId,
    acceptedAt: secondInput.acceptedAt,
    courtCaseNo: secondInput.courtCaseNo,
  });
  expect(current.recordEdits.acceptanceCorrections[0]).toMatchObject({
    acceptanceId,
    acceptanceRevision: 2,
    originalAcceptedAt: originalInput.acceptedAt,
    originalCourtCaseNo: originalInput.courtCaseNo,
  });
  expect(
    current.recordEdits.acceptanceCorrections[0].history.map(
      ({ priorCorrectionId, fromRevision, toRevision, reason }) => ({
        priorCorrectionId,
        fromRevision,
        toRevision,
        reason,
      }),
    ),
  ).toEqual([
    {
      priorCorrectionId: null,
      fromRevision: 0,
      toRevision: 1,
      reason: firstInput.reason,
    },
    {
      priorCorrectionId: first.correctionId,
      fromRevision: 1,
      toRevision: 2,
      reason: secondInput.reason,
    },
  ]);
  const after = await recordEditSnapshot(caseId);
  expect(after.originalAcceptances).toEqual(before.originalAcceptances);
  expect(after.acceptanceReceipts).toEqual(before.acceptanceReceipts);
  expect(after.matchingReceipts).toEqual(before.matchingReceipts);
  expect(after.materials).toEqual(before.materials);
  expect(after.acceptanceCorrections).toHaveLength(2);
  expect(after.recordEditReceipts).toHaveLength(2);
  const originalReplay = await body<Record<string, unknown>>(
    await request.post(`/api/v1/cases/${caseId}/acceptance-register`, {
      headers: operator,
      data: originalInput,
    }),
    201,
  );
  expect(originalReplay).toEqual(originalReceipt);
  const file = await request.get(
    `/api/v1/materials/${notice.materialId}/versions/${notice.contentVersionId}/content`,
    { headers: operator },
  );
  expect(file.status()).toBe(200);
  expect(await file.body()).toEqual(pdf);
});

test('authorization and ownership are checked before replay and a newly authorized colleague can extend historical facts', async ({
  request,
}) => {
  test.setTimeout(300_000);
  const first = await acceptedCase(request);
  const second = await acceptedCase(request);
  const contactUrl = `/api/v1/cases/${first.caseId}/defendant-contact-update`;
  const correctionUrl = `/api/v1/cases/${first.caseId}/acceptance-correction`;
  await setRecordEditGrant(
    coreLeadFixtures.roleA,
    'case.defendant-contact.update',
    'TEAM',
    true,
  );
  await setRecordEditGrant(
    coreLeadFixtures.roleA,
    'case.acceptance.correct',
    'TEAM',
    true,
  );
  const contact = contactInput(first.detail.defendants[0].id, 0);
  const correction = correctionInput(
    first.detail.acceptance!.id,
    0,
    first.detail.acceptance!.acceptedAt,
  );
  for (const [url, value] of [
    [contactUrl, contact],
    [correctionUrl, correction],
  ] as const) {
    await reject(
      await request.post(url, { headers: foreign, data: value }),
      [403, 404],
    );
    await reject(
      await request.post(url, { headers: readOnly, data: value }),
      [403],
    );
    await reject(await request.post(url, { data: value }), [401, 403]);
  }
  await reject(
    await request.post(contactUrl, {
      headers: operator,
      data: { ...contact, defendantId: second.detail.defendants[0].id },
    }),
    [409],
  );
  await reject(
    await request.post(correctionUrl, {
      headers: operator,
      data: { ...correction, acceptanceId: second.detail.acceptance!.id },
    }),
    [409],
  );
  const contactSaved = await body<ContactResult>(
    await request.post(contactUrl, { headers: operator, data: contact }),
    201,
  );
  const correctionSaved = await body<CorrectionResult>(
    await request.post(correctionUrl, { headers: operator, data: correction }),
    201,
  );
  const historical = await recordEditSnapshot(first.caseId);
  expect(historical.contactChanges).toHaveLength(1);
  expect(historical.acceptanceCorrections).toHaveLength(1);
  expect(historical.recordEditReceipts).toHaveLength(2);
  await setRecordEditGrant(
    coreLeadFixtures.roleA,
    'case.defendant-contact.update',
    'TEAM',
    false,
  );
  await setRecordEditGrant(
    coreLeadFixtures.roleA,
    'case.acceptance.correct',
    'TEAM',
    false,
  );
  await reject(
    await request.post(contactUrl, { headers: operator, data: contact }),
    [403],
  );
  await reject(
    await request.post(correctionUrl, { headers: operator, data: correction }),
    [403],
  );
  const nextContact = {
    ...contactInput(first.detail.defendants[0].id, 1),
    phone: '010-43210001',
  };
  const nextCorrection = correctionInput(
    first.detail.acceptance!.id,
    1,
    first.detail.acceptance!.acceptedAt,
  );
  await reject(
    await request.post(contactUrl, {
      headers: operator,
      data: nextContact,
    }),
    [403],
  );
  await reject(
    await request.post(correctionUrl, {
      headers: operator,
      data: nextCorrection,
    }),
    [403],
  );
  expect(contactSaved.contactRevision).toBe(1);
  expect(correctionSaved.acceptanceRevision).toBe(1);
  const revoked = await read(request, first.caseId);
  expect(revoked.recordEdits).toMatchObject({
    canUpdateDefendantContact: false,
    canCorrectAcceptance: false,
  });
  expect(
    (await recordEditSnapshot(first.caseId)).recordEditReceipts,
  ).toHaveLength(2);
  await setRecordEditGrant(
    coreLeadFixtures.roleSelf,
    'case.defendant-contact.update',
    'DEPARTMENT',
    true,
  );
  await setRecordEditGrant(
    coreLeadFixtures.roleSelf,
    'case.acceptance.correct',
    'DEPARTMENT',
    true,
  );
  const nextActor = readOnly;
  expect(
    (await read(request, first.caseId, nextActor)).recordEdits,
  ).toMatchObject({
    canUpdateDefendantContact: true,
    canCorrectAcceptance: true,
  });
  const contactContinued = await body<ContactResult>(
    await request.post(contactUrl, {
      headers: nextActor,
      data: nextContact,
    }),
    201,
  );
  const correctionContinued = await body<CorrectionResult>(
    await request.post(correctionUrl, {
      headers: nextActor,
      data: nextCorrection,
    }),
    201,
  );
  expect(contactContinued.contactRevision).toBe(2);
  expect(correctionContinued.acceptanceRevision).toBe(2);
  const continued = await recordEditSnapshot(first.caseId);
  expect(historical.case).toHaveLength(1);
  expect((historical.case[0] as Record<string, unknown>).court_case_no).toBe(
    correction.courtCaseNo,
  );
  expect(continued.case).toEqual(
    historical.case.map((row) => ({
      ...(row as Record<string, unknown>),
      court_case_no: nextCorrection.courtCaseNo,
    })),
  );
  expect(continued.originalAcceptances).toEqual(historical.originalAcceptances);
  expect(continued.contactChanges).toHaveLength(2);
  expect(continued.acceptanceCorrections).toHaveLength(2);
  expect(continued.recordEditReceipts).toHaveLength(4);
  expect(continued.contactChanges).toEqual(
    expect.arrayContaining([
      historical.contactChanges[0],
      expect.objectContaining({
        id: contactContinued.changeId,
        recorded_by_user_id: coreLeadFixtures.userSelf,
        from_revision: 1,
        to_revision: 2,
      }),
    ]),
  );
  expect(continued.acceptanceCorrections).toEqual(
    expect.arrayContaining([
      historical.acceptanceCorrections[0],
      expect.objectContaining({
        id: correctionContinued.correctionId,
        recorded_by_user_id: coreLeadFixtures.userSelf,
        prior_correction_id: correctionSaved.correctionId,
        from_revision: 1,
        to_revision: 2,
      }),
    ]),
  );
  expect(continued.recordEditReceipts).toEqual(
    expect.arrayContaining([
      ...historical.recordEditReceipts,
      expect.objectContaining({
        actor_user_id: coreLeadFixtures.userSelf,
        command: 'DEFENDANT_CONTACT_UPDATE',
        result_snapshot: expect.objectContaining({
          changeId: contactContinued.changeId,
        }),
      }),
      expect.objectContaining({
        actor_user_id: coreLeadFixtures.userSelf,
        command: 'ACCEPTANCE_CORRECTION',
        result_snapshot: expect.objectContaining({
          correctionId: correctionContinued.correctionId,
        }),
      }),
    ]),
  );
  expect(continued.audits).toEqual(
    expect.arrayContaining([
      ...historical.audits,
      expect.objectContaining({
        actor_user_id: coreLeadFixtures.userSelf,
        action: 'case.defendant-contact.updated',
      }),
      expect.objectContaining({
        actor_user_id: coreLeadFixtures.userSelf,
        action: 'case.acceptance.corrected',
      }),
    ]),
  );
  await reject(
    await request.post(contactUrl, { headers: operator, data: contact }),
    [403],
  );
  await reject(
    await request.post(correctionUrl, { headers: operator, data: correction }),
    [403],
  );
  expect(await recordEditSnapshot(first.caseId)).toEqual(continued);
});

test('archived case accepts data corrections without changing its archive anchor, old receipts or file bytes', async ({
  request,
}) => {
  test.setTimeout(300_000);
  await allowOtherEnterpriseAccountSetup();
  const source = await createClosedCaseArchiveSourceThroughApi(request, {
    bytes: pdf,
  });
  await setCaseArchiveFixtureGrant(
    coreLeadFixtures.roleA,
    'case.archive',
    'TEAM',
  );
  const archived = await body<{ stage: string; version: number }>(
    await request.post(`/api/v1/cases/${source.caseId}/archive`, {
      headers: operator,
      data: {
        expectedVersion: source.closureResult.version,
        idempotencyKey: randomUUID(),
        expectedClosureVersionId: source.closureResult.closureVersionId,
        archiveAt: today(),
        archiveType: 'EXECUTION_COLLECTED',
        archiveReason: 'CE001 合成归档',
      },
    }),
    201,
  );
  expect(archived.stage).toBe('ARCHIVED');
  const before = await recordEditSnapshot(source.caseId);
  const detail = await read(request, source.caseId);
  const fileUrl = `/api/v1/materials/${source.file!.materialId}/versions/${source.file!.contentVersionId}/content`;
  const originalFile = await request.get(fileUrl, { headers: operator });
  expect(originalFile.status()).toBe(200);
  const bytesBefore = await originalFile.body();
  await setRecordEditGrant(
    coreLeadFixtures.roleA,
    'case.defendant-contact.update',
    'TEAM',
    true,
  );
  await setRecordEditGrant(
    coreLeadFixtures.roleA,
    'case.acceptance.correct',
    'TEAM',
    true,
  );
  await body<ContactResult>(
    await request.post(
      `/api/v1/cases/${source.caseId}/defendant-contact-update`,
      {
        headers: operator,
        data: contactInput(detail.defendants[0].id, 0),
      },
    ),
    201,
  );
  await body<CorrectionResult>(
    await request.post(`/api/v1/cases/${source.caseId}/acceptance-correction`, {
      headers: operator,
      data: correctionInput(
        detail.acceptance!.id,
        0,
        detail.acceptance!.acceptedAt,
      ),
    }),
    201,
  );
  const after = await recordEditSnapshot(source.caseId);
  const updated = await read(request, source.caseId);
  expect(updated).toMatchObject({
    stage: 'ARCHIVED',
    version: archived.version,
  });
  expect(after.archiveVersions).toEqual(before.archiveVersions);
  expect(after.archiveReceipts).toEqual(before.archiveReceipts);
  expect(after.originalAcceptances).toEqual(before.originalAcceptances);
  expect(after.matchingReceipts).toEqual(before.matchingReceipts);
  expect(after.acceptanceReceipts).toEqual(before.acceptanceReceipts);
  expect(after.materials).toEqual(before.materials);
  const beforeCase = before.case[0] as Record<string, unknown>;
  const afterCase = after.case[0] as Record<string, unknown>;
  expect(afterCase.stage).toBe(beforeCase.stage);
  expect(afterCase.version).toBe(beforeCase.version);
  expect(afterCase.current_acceptance_id).toBe(
    beforeCase.current_acceptance_id,
  );
  expect(afterCase.current_trial_round_id).toBe(
    beforeCase.current_trial_round_id,
  );
  const finalFile = await request.get(fileUrl, { headers: operator });
  expect(finalFile.status()).toBe(200);
  expect(await finalFile.body()).toEqual(bytesBefore);
});

test('real remand round keeps separate acceptance revisions and restores the corrected source number after an empty-child revocation', async ({
  request,
}) => {
  test.setTimeout(300_000);
  const businessDate = pastWorkflowDate();
  const source = await acceptedCase(request, businessDate);
  const url = `/api/v1/cases/${source.caseId}`;
  await grantRecordEditPredecessorActions();
  await setRecordEditGrant(
    coreLeadFixtures.roleA,
    'case.acceptance.correct',
    'TEAM',
    true,
  );
  const oldId = source.detail.acceptance!.id;
  const oldCorrection = {
    ...correctionInput(oldId, 0, source.detail.acceptance!.acceptedAt),
    courtCaseNo: 'CE001 原轮更正案号',
  };
  await body<CorrectionResult>(
    await request.post(`${url}/acceptance-correction`, {
      headers: operator,
      data: oldCorrection,
    }),
    201,
  );
  await body(
    await request.post(`${url}/hearing-schedule`, {
      headers: operator,
      data: {
        expectedVersion: source.detail.version,
        idempotencyKey: randomUUID(),
        hearingAt: businessDate,
      },
    }),
    201,
  );
  await expect
    .poll(async () => (await read(request, source.caseId)).stage, {
      timeout: 20_000,
    })
    .toBe('WAITING_JUDGMENT');
  const beforeJudgment = await read(request, source.caseId);
  const judgmentFile = await upload(request, source.caseId, 'JUDGMENT');
  const judgment = await body<{ judgmentId: string; version: number }>(
    await request.post(`${url}/judgment-register`, {
      headers: operator,
      data: {
        expectedVersion: beforeJudgment.version,
        idempotencyKey: randomUUID(),
        judgmentReceivedAt: businessDate,
        judgmentAmountState: 'KNOWN',
        judgmentAmount: '88.00',
        paidLitigationFeeState: 'KNOWN',
        paidLitigationFee: '0.00',
        judgmentContentVersionIds: [judgmentFile.contentVersionId],
      },
    }),
    201,
  );
  const choice = await body<{ version: number }>(
    await request.post(`${url}/judgment-next-step`, {
      headers: operator,
      data: {
        expectedVersion: judgment.version,
        idempotencyKey: randomUUID(),
        judgmentId: judgment.judgmentId,
        next: 'APPEAL',
        plaintiffAppeals: true,
        defendantIds: [],
      },
    }),
    201,
  );
  type AppealDetail = CaseDetail & {
    judgmentNextStep: { current: { id: string } };
    secondInstance: { currentTrialRoundId: string };
  };
  const appeal = await body<AppealDetail>(
    await request.get(url, { headers: operator }),
  );
  const sourceRoundId = appeal.secondInstance.currentTrialRoundId;
  const resultFile = await upload(
    request,
    source.caseId,
    'SECOND_INSTANCE_JUDGMENT',
  );
  const resultInput = (version: number) => ({
    expectedVersion: version,
    idempotencyKey: randomUUID(),
    trialRoundId: sourceRoundId,
    choiceId: appeal.judgmentNextStep.current.id,
    expectedProgressId: null,
    progress: {
      hearingAt: null,
      hearingPlace: null,
      judgeName: null,
      documentContentVersionIds: [],
      serviceContentVersionIds: [],
    },
    result: 'REMAND',
    resultReceivedAt: businessDate,
    judgmentContentVersionIds: [resultFile.contentVersionId],
    paidLitigationFee: { state: 'PENDING', amount: null },
  });
  const firstRemand = await body<{
    version: number;
    resultId: string;
    currentTrialRoundId: string;
    stage: string;
  }>(
    await request.post(`${url}/second-instance-result`, {
      headers: operator,
      data: resultInput(choice.version),
    }),
    201,
  );
  expect(firstRemand.stage).toBe('WAITING_FORMAL_ACCEPTANCE');
  const emptyChildId = firstRemand.currentTrialRoundId;
  const remanded = await read(request, source.caseId);
  expect(remanded.acceptance).toBeNull();
  await reject(
    await request.post(`${url}/acceptance-correction`, {
      headers: operator,
      data: {
        ...oldCorrection,
        idempotencyKey: randomUUID(),
        expectedAcceptanceRevision: 1,
        acceptedAt: today(),
        courtCaseNo: '晚于真实开庭日期',
      },
    }),
    [400],
  );
  const revoked = await body<{ stage: string; version: number }>(
    await request.post(`${url}/second-instance-result-revoke`, {
      headers: operator,
      data: {
        expectedVersion: firstRemand.version,
        idempotencyKey: randomUUID(),
        trialRoundId: sourceRoundId,
        resultId: firstRemand.resultId,
        reason: '空子轮撤销后恢复原轮',
      },
    }),
    201,
  );
  expect(revoked.stage).toBe('SECOND_INSTANCE');
  const restored = await read(request, source.caseId);
  expect(restored.courtCaseNo).toBe(oldCorrection.courtCaseNo);
  expect(restored.acceptance?.id).toBe(oldId);
  const secondRemand = await body<{
    version: number;
    currentTrialRoundId: string;
    stage: string;
  }>(
    await request.post(`${url}/second-instance-result`, {
      headers: operator,
      data: resultInput(revoked.version),
    }),
    201,
  );
  expect(secondRemand.currentTrialRoundId).not.toBe(emptyChildId);
  expect(secondRemand.stage).toBe('WAITING_FORMAL_ACCEPTANCE');
  const childFile = await upload(request, source.caseId, 'ACCEPTANCE_NOTICE');
  const childAccepted = await body<{ version: number }>(
    await request.post(`${url}/acceptance-register`, {
      headers: operator,
      data: {
        expectedVersion: secondRemand.version,
        idempotencyKey: randomUUID(),
        acceptedAt: businessDate,
        courtCaseNo: 'CE001 发回新轮案号',
        acceptanceNoticeContentVersionIds: [childFile.contentVersionId],
      },
    }),
    201,
  );
  const child = await read(request, source.caseId);
  expect(child.acceptance?.id).not.toBe(oldId);
  const childCorrection = {
    ...correctionInput(child.acceptance!.id, 0, child.acceptance!.acceptedAt),
    courtCaseNo: 'CE001 发回轮更正案号',
  };
  await body<CorrectionResult>(
    await request.post(`${url}/acceptance-correction`, {
      headers: operator,
      data: childCorrection,
    }),
    201,
  );
  const final = await read(request, source.caseId);
  expect(final).toMatchObject({
    stage: 'WAITING_HEARING',
    version: childAccepted.version,
    courtCaseNo: childCorrection.courtCaseNo,
  });
  expect(final.recordEdits.acceptanceCorrections).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ acceptanceId: oldId, acceptanceRevision: 1 }),
      expect.objectContaining({
        acceptanceId: child.acceptance!.id,
        acceptanceRevision: 1,
      }),
    ]),
  );
  expect(final.recordEdits.acceptanceCorrections).toHaveLength(2);
});

async function captureRecordEditDrawer(
  page: Page,
  testInfo: TestInfo,
  panel: Locator,
  name: string,
  controls: string[],
): Promise<void> {
  for (const { width, height } of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width, height });
    const drawer = page.locator('.case-workspace-editors[role="dialog"]');
    await expect(drawer).toBeVisible();
    await expect(panel).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width + 1);
    await expect
      .poll(async () => {
        const bounds = await drawer.boundingBox();
        return (
          bounds !== null &&
          bounds.x >= -1 &&
          bounds.x + bounds.width <= width + 1
        );
      })
      .toBe(true);
    for (const selector of controls) {
      const control = panel.locator(`[data-test="${selector}"]`);
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport();
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    }
    await page.screenshot({
      path: testInfo.outputPath(`case-record-edit-${name}-${width}.png`),
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test('browser saves and cancels contact, corrects acceptance with a reason, and refreshes effective values', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(300_000);
  const { caseId, detail } = await acceptedCase(request);
  await setRecordEditGrant(
    coreLeadFixtures.roleA,
    'case.defendant-contact.update',
    'TEAM',
    true,
  );
  await setRecordEditGrant(
    coreLeadFixtures.roleA,
    'case.acceptance.correct',
    'TEAM',
    true,
  );
  await signIn(page, `/cases/${caseId}`);
  await openCaseWorkspaceCommand(
    page,
    'defendant-contact-update',
    '[data-test="case-defendant-contact-panel"]',
  );
  const contactPanel = page.locator(
    '[data-test="case-defendant-contact-panel"]',
  );
  await contactPanel
    .locator('[data-test="defendant-contact-phone"]')
    .fill('取消的号码');
  await contactPanel.locator('[data-test="defendant-contact-cancel"]').click();
  await expect(contactPanel).not.toBeVisible();
  expect((await recordEditSnapshot(caseId)).contactChanges).toHaveLength(0);
  await openCaseWorkspaceCommand(
    page,
    'defendant-contact-update',
    '[data-test="case-defendant-contact-panel"]',
  );
  await contactPanel
    .locator('[data-test="defendant-contact-phone"]')
    .fill('010-88886666');
  await contactPanel
    .locator('[data-test="defendant-contact-address"]')
    .fill('北京市测试街道');
  await captureRecordEditDrawer(page, testInfo, contactPanel, 'contact', [
    'defendant-contact-phone',
    'defendant-contact-address',
    'defendant-contact-save',
    'defendant-contact-cancel',
  ]);
  const saveContact = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname ===
        `/api/v1/cases/${caseId}/defendant-contact-update`,
  );
  await contactPanel.locator('[data-test="defendant-contact-save"]').click();
  const contactResponse = await saveContact;
  const contact = await body<ContactResult>(contactResponse, 201);
  expect(contactResponse.request().headers()['x-csrf-token']).toBeTruthy();
  expect(contactResponse.request().postDataJSON()).toMatchObject({
    defendantId: detail.defendants[0].id,
    expectedContactRevision: 0,
    phone: '010-88886666',
    address: '北京市测试街道',
  });
  expect(contact.contactRevision).toBe(1);
  await openCaseWorkspaceCommand(
    page,
    'acceptance-correction',
    '[data-test="case-acceptance-correction-panel"]',
  );
  const correctionPanel = page.locator(
    '[data-test="case-acceptance-correction-panel"]',
  );
  await expect(
    correctionPanel.locator('[data-test="acceptance-correction-date"]'),
  ).toHaveValue(detail.acceptance!.acceptedAt);
  await correctionPanel
    .locator('[data-test="acceptance-correction-court-case-no"]')
    .fill('CE001 浏览器更正案号');
  await correctionPanel
    .locator('[data-test="acceptance-correction-reason"]')
    .fill('核对受理通知书');
  await captureRecordEditDrawer(page, testInfo, correctionPanel, 'acceptance', [
    'acceptance-correction-date',
    'acceptance-correction-court-case-no',
    'acceptance-correction-reason',
    'acceptance-correction-save',
    'acceptance-correction-cancel',
  ]);
  const saveCorrection = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname ===
        `/api/v1/cases/${caseId}/acceptance-correction`,
  );
  await correctionPanel
    .locator('[data-test="acceptance-correction-save"]')
    .click();
  const correctionResponse = await saveCorrection;
  const correction = await body<CorrectionResult>(correctionResponse, 201);
  expect(correctionResponse.request().headers()['x-csrf-token']).toBeTruthy();
  expect(correctionResponse.request().postDataJSON()).toMatchObject({
    acceptanceId: detail.acceptance!.id,
    expectedAcceptanceRevision: 0,
    courtCaseNo: 'CE001 浏览器更正案号',
    reason: '核对受理通知书',
  });
  expect(correction.acceptanceRevision).toBe(1);
  await page.reload();
  const refreshed = await read(request, caseId);
  expect(refreshed).toMatchObject({
    version: detail.version,
    stage: detail.stage,
    courtCaseNo: 'CE001 浏览器更正案号',
  });
  expect(refreshed.defendants[0]).toMatchObject({
    phone: '010-88886666',
    address: '北京市测试街道',
  });
  await expect(page.locator('[data-section="case-info"]')).toContainText(
    '010-88886666',
  );
  await expect(page.locator('[data-section="first-instance"]')).toContainText(
    'CE001 浏览器更正案号',
  );
});

test('browser keeps the original body and key after a committed response is lost', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const { caseId } = await acceptedCase(request);
  await setRecordEditGrant(
    coreLeadFixtures.roleA,
    'case.defendant-contact.update',
    'TEAM',
    true,
  );
  await signIn(page, `/cases/${caseId}`);
  await openCaseWorkspaceCommand(
    page,
    'defendant-contact-update',
    '[data-test="case-defendant-contact-panel"]',
  );
  const panel = page.locator('[data-test="case-defendant-contact-panel"]');
  await panel
    .locator('[data-test="defendant-contact-phone"]')
    .fill('010-77775555');
  const sent: unknown[] = [];
  let committed = false;
  await page.route(
    `**/api/v1/cases/${caseId}/defendant-contact-update`,
    async (route) => {
      sent.push(route.request().postDataJSON());
      if (!committed) {
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        committed = true;
        await route.abort('failed');
      } else await route.continue();
    },
  );
  await panel.locator('[data-test="defendant-contact-save"]').click();
  await expect(
    panel.locator('[data-test="record-edit-unknown"]'),
  ).toBeVisible();
  expect((await recordEditSnapshot(caseId)).contactChanges).toHaveLength(1);
  await panel.locator('[data-test="defendant-contact-retry-original"]').click();
  await expect(panel.locator('[data-test="record-edit-unknown"]')).toHaveCount(
    0,
  );
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(sent[0]);
  expect((await recordEditSnapshot(caseId)).contactChanges).toHaveLength(1);
  expect((await recordEditSnapshot(caseId)).recordEditReceipts).toHaveLength(1);
});

async function signIn(page: Page, path: string) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(coreLeadFixtures.operatorUsername);
  await page.getByLabel('密码').fill(coreLeadFixtures.operatorPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(path);
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
}
