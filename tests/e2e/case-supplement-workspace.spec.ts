import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  coreLeadFixtures,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';
import { createSubmittedCaseThroughApi } from '../support/case-complaint-confirmation-database.mjs';
import { prepareCaseFilingFixture } from '../support/case-filing-database.mjs';
import { prepareCaseAcceptanceFixture } from '../support/case-acceptance-database.mjs';
import { disconnectCustomerTestDatabase } from '../support/customer-database.mjs';

const owner = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const otherDepartment = { Authorization: `Bearer ${coreLeadFixtures.tokenB}` };
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const pdf = Buffer.from('%PDF-1.4\nsynthetic supplement fixture\n%%EOF\n');
async function upload(
  request: APIRequestContext,
  caseId: string,
  category: 'MAIL_RECEIPT' | 'FILING_EVIDENCE',
) {
  const draft = await request.post('/api/v1/materials/upload-drafts', {
    headers: owner,
    data: {
      ownerType: 'CASE',
      ownerId: caseId,
      category,
      purpose: category,
      originalFilename: `${category}-${randomUUID().slice(0, 8)}.pdf`,
      declaredMimeType: 'application/pdf',
    },
  });
  expect(draft.status(), await draft.text()).toBe(201);
  const id = ((await draft.json()) as { id: string }).id;
  const content = await request.put(
    `/api/v1/materials/upload-drafts/${id}/content`,
    {
      headers: { ...owner, 'Content-Type': 'application/octet-stream' },
      data: pdf,
    },
  );
  expect(content.status(), await content.text()).toBe(200);
  return ((await content.json()) as { contentVersionId: string })
    .contentVersionId;
}
test.afterAll(disconnectCustomerTestDatabase);

test('supplement notice is round-bound, append-only and idempotent without changing the case stage', async ({
  request,
}) => {
  test.setTimeout(180_000);
  await resetCoreLeadE2eData();
  await prepareCaseFilingFixture();
  await prepareCaseAcceptanceFixture();
  const source = await createSubmittedCaseThroughApi(request, {
    submitAsLawyer: false,
  });
  const casePath = `/api/v1/cases/${source.caseId}`;
  const confirmed = await request.post(`${casePath}/complaint-confirm`, {
    headers: owner,
    data: {
      expectedVersion: 3,
      idempotencyKey: randomUUID(),
      confirmedComplaintContentVersionId: source.complaint.contentVersionId,
      amountState: 'KNOWN',
      amount: '123.45',
      pendingReason: null,
      confirmDisclose: true,
    },
  });
  expect(confirmed.status(), await confirmed.text()).toBe(201);
  const mailId = await upload(request, source.caseId, 'MAIL_RECEIPT');
  const mailed = await request.post(`${casePath}/complaint-mail`, {
    headers: owner,
    data: {
      expectedVersion: 4,
      idempotencyKey: randomUUID(),
      mailedAt: today(),
      mailReceiptContentVersionIds: [mailId],
    },
  });
  expect(mailed.status(), await mailed.text()).toBe(201);
  const courtResponse = await request.post(`${casePath}/filing-courts`, {
    headers: owner,
    data: { name: `补录测试法院-${randomUUID().slice(0, 8)}` },
  });
  expect(courtResponse.status(), await courtResponse.text()).toBe(201);
  const courtId = ((await courtResponse.json()) as { id: string }).id;
  const evidenceId = await upload(request, source.caseId, 'FILING_EVIDENCE');
  const filed = await request.post(`${casePath}/filing-submit`, {
    headers: owner,
    data: {
      expectedVersion: 5,
      idempotencyKey: randomUUID(),
      courtId,
      submittedAt: today(),
      filingEvidenceContentVersionIds: [evidenceId],
    },
  });
  expect(filed.status(), await filed.text()).toBe(201);
  const accepted = await request.post(`${casePath}/acceptance-register`, {
    headers: owner,
    data: {
      expectedVersion: 6,
      idempotencyKey: randomUUID(),
      acceptedAt: today(),
      courtCaseNo: `（2026）测${randomUUID().slice(0, 8)}号`,
      acceptanceNoticeContentVersionIds: [],
      paymentListContentVersionIds: [],
      serviceDocumentContentVersionIds: [],
    },
  });
  expect(accepted.status(), await accepted.text()).toBe(201);
  const beforeResponse = await request.get(casePath, { headers: owner });
  expect(beforeResponse.status(), await beforeResponse.text()).toBe(200);
  const before = (await beforeResponse.json()) as {
    stage: string;
    version: number;
    archive?: unknown;
  };
  const workspaceResponse = await request.get(
    `${casePath}/supplemental-workspace`,
    { headers: owner },
  );
  expect(workspaceResponse.status(), await workspaceResponse.text()).toBe(200);
  const workspace = (await workspaceResponse.json()) as {
    entries: unknown[];
    sources: { trialRounds: Array<{ id: string }> };
  };
  expect(workspace.entries).toEqual([]);
  expect(workspace.sources.trialRounds).toHaveLength(1);
  const input = {
    kind: 'COURT_PREPAYMENT_NOTICE',
    trialRoundId: workspace.sources.trialRounds[0]!.id,
    amount: '123.45',
    reason: '合成预缴通知补录',
    idempotencyKey: randomUUID(),
  };
  const createdResponse = await request.post(
    `${casePath}/supplemental-workspace`,
    { headers: owner, data: input },
  );
  expect(createdResponse.status(), await createdResponse.text()).toBe(201);
  const created = (await createdResponse.json()) as {
    id: string;
    amount: string;
    trialRoundId: string;
  };
  expect(created).toMatchObject({
    amount: '123.45',
    trialRoundId: input.trialRoundId,
  });
  const replayResponse = await request.post(
    `${casePath}/supplemental-workspace`,
    { headers: owner, data: input },
  );
  expect(replayResponse.status(), await replayResponse.text()).toBe(201);
  expect(((await replayResponse.json()) as { id: string }).id).toBe(created.id);
  const conflict = await request.post(`${casePath}/supplemental-workspace`, {
    headers: owner,
    data: { ...input, amount: '999.00' },
  });
  expect(conflict.status()).toBe(409);
  const wrongRound = await request.post(`${casePath}/supplemental-workspace`, {
    headers: owner,
    data: {
      ...input,
      trialRoundId: randomUUID(),
      idempotencyKey: randomUUID(),
    },
  });
  expect(wrongRound.status()).toBe(400);
  const crossDepartment = await request.get(
    `${casePath}/supplemental-workspace`,
    { headers: otherDepartment },
  );
  expect([403, 404]).toContain(crossDepartment.status());
  const afterResponse = await request.get(casePath, { headers: owner });
  expect(afterResponse.status(), await afterResponse.text()).toBe(200);
  const after = (await afterResponse.json()) as {
    stage: string;
    version: number;
    archive?: unknown;
  };
  expect({
    stage: after.stage,
    version: after.version,
    archive: after.archive ?? null,
  }).toEqual({
    stage: before.stage,
    version: before.version,
    archive: before.archive ?? null,
  });
  const finalResponse = await request.get(
    `${casePath}/supplemental-workspace`,
    { headers: owner },
  );
  expect(finalResponse.status(), await finalResponse.text()).toBe(200);
  expect(
    ((await finalResponse.json()) as { entries: unknown[] }).entries,
  ).toHaveLength(1);
  const missingReason = await request.post('/api/v1/materials/upload-drafts', {
    headers: owner,
    data: {
      ownerType: 'CASE',
      ownerId: source.caseId,
      category: 'CASE_PRESERVATION_DOCUMENT',
      purpose: 'CASE_PRESERVATION_DOCUMENT',
      originalFilename: '保全测试.pdf',
      declaredMimeType: 'application/pdf',
    },
  });
  expect(missingReason.status()).toBe(400);
  const draft = await request.post('/api/v1/materials/upload-drafts', {
    headers: owner,
    data: {
      ownerType: 'CASE',
      ownerId: source.caseId,
      category: 'CASE_PRESERVATION_DOCUMENT',
      purpose: 'CASE_PRESERVATION_DOCUMENT',
      caseSupplementReason: '收到合成保全文书',
      originalFilename: '保全测试.pdf',
      declaredMimeType: 'application/pdf',
    },
  });
  expect(draft.status(), await draft.text()).toBe(201);
  const draftId = ((await draft.json()) as { id: string }).id;
  const uploaded = await request.put(
    `/api/v1/materials/upload-drafts/${draftId}/content`,
    {
      headers: { ...owner, 'Content-Type': 'application/octet-stream' },
      data: pdf,
    },
  );
  expect(uploaded.status(), await uploaded.text()).toBe(200);
  const file = (await uploaded.json()) as {
    materialId: string;
    contentVersionId: string;
  };
  const candidateResponse = await request.get(
    `${casePath}/supplemental-workspace`,
    { headers: owner },
  );
  expect(candidateResponse.status(), await candidateResponse.text()).toBe(200);
  const candidate = (await candidateResponse.json()) as {
    entries: unknown[];
    sources: {
      materials: Array<{
        materialId: string;
        contentVersionId: string;
        linked: boolean;
        uploadReason: string | null;
      }>;
    };
  };
  expect(candidate.entries).toHaveLength(1);
  expect(candidate.sources.materials).toContainEqual(
    expect.objectContaining({
      materialId: file.materialId,
      contentVersionId: file.contentVersionId,
      linked: false,
      uploadReason: '收到合成保全文书',
    }),
  );
  const linked = await request.post(`${casePath}/supplemental-workspace`, {
    headers: owner,
    data: {
      kind: 'PRESERVATION_DOCUMENT',
      materialId: file.materialId,
      contentVersionId: file.contentVersionId,
      reason: '关联保全实际文书',
      idempotencyKey: randomUUID(),
    },
  });
  expect(linked.status(), await linked.text()).toBe(201);
  const linkedResponse = await request.get(
    `${casePath}/supplemental-workspace`,
    { headers: owner },
  );
  expect(linkedResponse.status(), await linkedResponse.text()).toBe(200);
  const linkedWorkspace = (await linkedResponse.json()) as {
    entries: unknown[];
    sources: {
      materials: Array<{
        materialId: string;
        contentVersionId: string;
        linked: boolean;
      }>;
    };
  };
  expect(linkedWorkspace.entries).toHaveLength(2);
  expect(linkedWorkspace.sources.materials).toContainEqual(
    expect.objectContaining({
      materialId: file.materialId,
      contentVersionId: file.contentVersionId,
      linked: true,
    }),
  );
});
