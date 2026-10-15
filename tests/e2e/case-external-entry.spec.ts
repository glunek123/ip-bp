import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  coreLeadFixtures,
  seedCoreLeadE2eData,
} from '../support/core-lead-database.mjs';
import {
  createClosedCaseArchiveSourceThroughApi,
  setCaseArchiveFixtureGrant,
} from '../support/case-archive-database.mjs';
import { prepareCaseAcceptanceFixture } from '../support/case-acceptance-database.mjs';
import { prepareCaseFilingFixture } from '../support/case-filing-database.mjs';
import { allowOtherEnterpriseAccountSetup } from '../support/case-complaint-mailing-database.mjs';
import { createLawyerAccountThroughApi } from '../support/case-lawyer-account.mjs';
import {
  assertCaseExternalEntrySqlGuards,
  caseExternalEntryCreateCounts,
  caseExternalEntrySnapshot,
  clearCaseExternalEntryFixture,
  setCaseExternalEntryGrant,
  setCaseExternalEntryWorkflowGrant,
  withCaseExternalEntryCreateFault,
} from '../support/case-external-entry-database.mjs';

const operator = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
const selfOnly = { Authorization: `Bearer ${coreLeadFixtures.tokenSelf}` };
const foreign = { Authorization: `Bearer ${coreLeadFixtures.tokenB}` };
const stages = [
  'PENDING_MATCH',
  'WAITING_COMPLAINT',
  'WAITING_COMPLAINT_CONFIRMATION',
  'WAITING_COMPLAINT_STAMP',
  'WAITING_FILING',
  'WAITING_FORMAL_ACCEPTANCE',
  'WAITING_HEARING',
  'WAITING_JUDGMENT',
  'SECOND_INSTANCE',
  'WAITING_EXECUTION_DOCUMENTS',
  'WAITING_EXECUTION_CONFIRMATION',
  'WAITING_EXECUTION_STAMP',
  'WAITING_EXECUTION_FILING',
  'EXECUTING',
  'WAITING_ARCHIVE',
  'ARCHIVED',
] as const;
type Stage = (typeof stages)[number];
type Http = {
  status(): number;
  text(): Promise<string>;
  json(): Promise<unknown>;
};
type EntryInput = {
  idempotencyKey: string;
  entryKind: 'EXTERNAL_TRANSFER' | 'HISTORICAL_BACKFILL';
  initialStage: Stage;
  stageReachedOn: string;
  source: string;
  reason: string;
  customerId: string;
  rightsHolderId: string;
  defendants: Array<{ kind: 'PERSON' | 'ORGANIZATION'; name: string }>;
  lawyerAccountId: string | null;
  lawyerProfileId: string | null;
  known: {
    courtId: string | null;
    courtCaseNo: string | null;
    acceptedOn: string | null;
    secondInstanceAcceptedOn: string | null;
    platform: string | null;
    shopName: string | null;
    shopExternalId: string | null;
    caseType: string | null;
    infringementTypes: string[] | null;
  };
};
type Created = {
  id: string;
  businessNo: string;
  stage: Stage;
  version: 1;
  entryId: string;
  recordedAt: string;
};
type CaseView = {
  id: string;
  stage: Stage;
  version: number;
  sourceLead: unknown;
  sourceNotaryMatter: unknown;
  certificate: unknown;
  origin:
    | {
        kind: 'EXTERNAL_ENTRY';
        entryId: string;
        entryKind: EntryInput['entryKind'];
        initialStage: Stage;
        stageReachedOn: string;
        source: string;
        reason: string;
        recordedAt: string;
        recordedByUserId: string;
        known: EntryInput['known'];
      }
    | { kind: 'NOTARY' };
  defendants: unknown[];
  secondInstance: { currentTrialRoundId: string | null };
  canSubmitExecution: boolean;
  canUploadDirectExecutionMaterials: boolean;
  acceptance: unknown;
  hearing: unknown;
  executionConfirmation: {
    id: string;
    submissionId: string | null;
    files: Array<{
      materialId: string;
      contentVersionId: string;
      originalFilename: string;
      mimeType: string;
    }>;
  } | null;
  recordEdits?: {
    secondInstanceAcceptances?: Array<{
      choiceId: string | null;
      trialRoundId: string;
      acceptanceRevision: number;
      acceptedAt: string | null;
      courtCaseNo: string | null;
      history: unknown[];
    }>;
  };
};

function shanghaiToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function shanghaiDaysAgo(days: number) {
  const date = new Date(`${shanghaiToday()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function input(stage: Stage, overrides: Partial<EntryInput> = {}): EntryInput {
  return {
    idempotencyKey: randomUUID(),
    entryKind: 'EXTERNAL_TRANSFER',
    initialStage: stage,
    stageReachedOn: shanghaiToday(),
    source: `CA018 E2E:${randomUUID()}`,
    reason: '合成验收：真实当前阶段转入',
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
    ...overrides,
  };
}

async function body<T>(response: Http, status = 200): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json() as Promise<T>;
}

async function createEntry(
  request: APIRequestContext,
  payload: EntryInput,
  headers = operator,
) {
  return body<Created>(
    await request.post('/api/v1/cases/external-entries', {
      headers,
      data: payload,
    }),
    201,
  );
}

async function readCase(
  request: APIRequestContext,
  caseId: string,
  headers = operator,
) {
  return body<CaseView>(
    await request.get(`/api/v1/cases/${caseId}`, { headers }),
  );
}

function requiredCurrentTrialRoundId(detail: CaseView): string {
  const id = detail.secondInstance.currentTrialRoundId;
  if (typeof id !== 'string')
    throw new Error('Expected a current second-instance trial round');
  return id;
}

async function login(page: Page, path: string, self = false) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page
    .getByLabel('用户名')
    .fill(
      self ? coreLeadFixtures.selfUsername : coreLeadFixtures.operatorUsername,
    );
  await page
    .getByLabel('密码')
    .fill(
      self ? coreLeadFixtures.selfPassword : coreLeadFixtures.operatorPassword,
    );
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(path);
}

async function uploadCaseFile(
  request: APIRequestContext,
  caseId: string,
  category: string,
  bytes: Buffer,
) {
  const draft = await body<{ id: string }>(
    await request.post('/api/v1/materials/upload-drafts', {
      headers: operator,
      data: {
        ownerType: 'CASE',
        ownerId: caseId,
        category,
        purpose: category,
        originalFilename: `ca018-${category}.pdf`,
        declaredMimeType: 'application/pdf',
      },
    }),
    201,
  );
  return body<{ materialId: string; contentVersionId: string }>(
    await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
      headers: { ...operator, 'Content-Type': 'application/octet-stream' },
      data: bytes,
    }),
    200,
  );
}

async function expectExactDownload(
  request: APIRequestContext,
  file: { materialId: string; contentVersionId: string },
  expectedBytes: Buffer,
) {
  const response = await request.get(
    `/api/v1/materials/${file.materialId}/versions/${file.contentVersionId}/content`,
    { headers: operator },
  );
  expect(response.status(), await response.text()).toBe(200);
  expect((await response.body()).equals(expectedBytes)).toBe(true);
}

async function clean() {
  await clearCaseExternalEntryFixture();
  await seedCoreLeadE2eData({ reuseExisting: true });
  await setCaseExternalEntryGrant(
    coreLeadFixtures.roleA,
    'case.external-entry.create',
    'TEAM',
    true,
  );
  await setCaseExternalEntryGrant(
    coreLeadFixtures.roleA,
    'case.external-entry.archive',
    'DEPARTMENT',
    true,
  );
  await setCaseExternalEntryWorkflowGrant(coreLeadFixtures.roleA, 'case.match');
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.complaint.submit',
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.complaint.confirm',
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.complaint.mail',
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.filing.submit',
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.execution.finish',
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.closure.record',
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.archive',
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.hearing.schedule',
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.judgment.register',
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.judgment.next_step',
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.second_instance.save',
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.second_instance.result',
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.second-instance-acceptance.update',
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.acceptance.register',
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.execution.submit',
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.execution.confirm',
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.execution.mail',
  );
  await setCaseExternalEntryWorkflowGrant(
    coreLeadFixtures.roleA,
    'case.execution.filing.submit',
  );
}

async function sourceView(request: APIRequestContext, caseId: string) {
  return readCase(request, caseId);
}

async function submitComplaint(
  request: APIRequestContext,
  caseId: string,
  expectedVersion: number,
) {
  const complaintBytes = Buffer.from(
    '%PDF-1.7\nCA018 actual complaint content\n%%EOF\n',
  );
  const authorizationBytes = Buffer.from(
    '%PDF-1.7\nCA018 actual authorization content\n%%EOF\n',
  );
  const complaint = await uploadCaseFile(
    request,
    caseId,
    'COMPLAINT',
    complaintBytes,
  );
  const authorization = await uploadCaseFile(
    request,
    caseId,
    'AUTHORIZATION',
    authorizationBytes,
  );
  const submitted = await body<{ stage: string; version: number }>(
    await request.post(`/api/v1/cases/${caseId}/complaint-submit`, {
      headers: operator,
      data: {
        expectedVersion,
        idempotencyKey: randomUUID(),
        amountState: 'PENDING',
        amount: null,
        pendingReason: 'CA018 current submission amount awaits evidence',
        complaintContentVersionIds: [complaint.contentVersionId],
        authorizationContentVersionIds: [authorization.contentVersionId],
      },
    }),
    201,
  );
  return {
    submitted,
    complaint,
    complaintBytes,
    authorization,
    authorizationBytes,
  };
}

async function confirmComplaint(
  request: APIRequestContext,
  caseId: string,
  expectedVersion: number,
  complaintContentVersionId: string,
) {
  return body<{ stage: string; version: number }>(
    await request.post(`/api/v1/cases/${caseId}/complaint-confirm`, {
      headers: operator,
      data: {
        expectedVersion,
        idempotencyKey: randomUUID(),
        confirmedComplaintContentVersionId: complaintContentVersionId,
        amountState: 'KNOWN',
        amount: '123.45',
        pendingReason: null,
        changeNote: '根据补充证据确认诉讼金额',
        confirmDisclose: true,
      },
    }),
    201,
  );
}

async function mailComplaint(
  request: APIRequestContext,
  caseId: string,
  expectedVersion: number,
) {
  const receiptBytes = Buffer.from(
    '%PDF-1.7\nCA018 actual complaint mail receipt\n%%EOF\n',
  );
  const receipt = await uploadCaseFile(
    request,
    caseId,
    'MAIL_RECEIPT',
    receiptBytes,
  );
  const result = await body<{ stage: string; version: number }>(
    await request.post(`/api/v1/cases/${caseId}/complaint-mail`, {
      headers: operator,
      data: {
        expectedVersion,
        idempotencyKey: randomUUID(),
        mailedAt: shanghaiToday(),
        mailReceiptContentVersionIds: [receipt.contentVersionId],
      },
    }),
    201,
  );
  return { result, receipt, receiptBytes };
}

async function submitFiling(
  request: APIRequestContext,
  caseId: string,
  expectedVersion: number,
) {
  const court = await createFilingCourt(request, caseId);
  const evidence = await uploadCaseFile(
    request,
    caseId,
    'FILING_EVIDENCE',
    Buffer.from('%PDF-1.7\nCA018 actual filing evidence\n%%EOF\n'),
  );
  const screenshot = await uploadCaseFile(
    request,
    caseId,
    'FILING_SCREENSHOT',
    Buffer.from('%PDF-1.7\nCA018 actual filing screenshot\n%%EOF\n'),
  );
  const result = await body<{
    stage: string;
    version: number;
    filingId: string;
  }>(
    await request.post(`/api/v1/cases/${caseId}/filing-submit`, {
      headers: operator,
      data: {
        expectedVersion,
        idempotencyKey: randomUUID(),
        courtId: court.id,
        submittedAt: shanghaiToday(),
        mediationNo: `CA018-${randomUUID().slice(0, 8)}`,
        filingEvidenceContentVersionIds: [evidence.contentVersionId],
        filingScreenshotContentVersionIds: [screenshot.contentVersionId],
      },
    }),
    201,
  );
  return {
    result,
    court,
    evidence,
    evidenceBytes: Buffer.from(
      '%PDF-1.7\nCA018 actual filing evidence\n%%EOF\n',
    ),
    screenshot,
    screenshotBytes: Buffer.from(
      '%PDF-1.7\nCA018 actual filing screenshot\n%%EOF\n',
    ),
  };
}

async function createFilingCourt(request: APIRequestContext, caseId: string) {
  return body<{ id: string; name?: string }>(
    await request.post(`/api/v1/cases/${caseId}/filing-courts`, {
      headers: operator,
      data: { name: `CA018 court ${randomUUID().slice(0, 8)}` },
    }),
    201,
  );
}

function acceptancePayload(
  expectedVersion: number,
  acceptedAt: string,
  courtCaseNo: string,
  noticeContentVersionId: string,
  courtId?: string,
) {
  return {
    expectedVersion,
    idempotencyKey: randomUUID(),
    acceptedAt,
    courtCaseNo,
    acceptanceNoticeContentVersionIds: [noticeContentVersionId],
    ...(courtId === undefined ? {} : { courtId }),
  };
}

async function submitAcceptance(
  request: APIRequestContext,
  caseId: string,
  payload: ReturnType<typeof acceptancePayload>,
) {
  return body<{
    stage: string;
    version: number;
    acceptanceId: string;
  }>(
    await request.post(`/api/v1/cases/${caseId}/acceptance-register`, {
      headers: operator,
      data: payload,
    }),
    201,
  );
}

async function submitExecution(
  request: APIRequestContext,
  caseId: string,
  expectedVersion: number,
) {
  const current = await sourceView(request, caseId);
  expect(current.secondInstance.currentTrialRoundId).toEqual(
    expect.any(String),
  );
  const bytes = Buffer.from(
    '%PDF-1.7\nCA018 actual execution application bytes\n%%EOF\n',
  );
  const application = await uploadCaseFile(
    request,
    caseId,
    'EXECUTION_APPLICATION',
    bytes,
  );
  const result = await body<{
    submissionId: string;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${caseId}/execution-submit`, {
      headers: operator,
      data: {
        expectedVersion,
        idempotencyKey: randomUUID(),
        trialRoundId: requiredCurrentTrialRoundId(current),
        judgmentNextStepId: null,
        secondInstanceResultId: null,
        expectedSubmissionId: null,
        executionApplicationContentVersionIds: [application.contentVersionId],
      },
    }),
    201,
  );
  return { result, application, bytes };
}

async function confirmExecution(
  request: APIRequestContext,
  caseId: string,
  expectedVersion: number,
  expectedSubmissionId: string | null,
  executionApplicationContentVersionIds?: string[],
) {
  return body<{ confirmationId: string; stage: string; version: number }>(
    await request.post(`/api/v1/cases/${caseId}/execution-confirm`, {
      headers: operator,
      data: {
        expectedVersion,
        idempotencyKey: randomUUID(),
        expectedSubmissionId,
        ...(expectedSubmissionId === null
          ? { executionApplicationContentVersionIds }
          : {}),
      },
    }),
    201,
  );
}

async function mailExecution(
  request: APIRequestContext,
  caseId: string,
  expectedVersion: number,
  expectedConfirmationId: string | null,
) {
  const receiptBytes = Buffer.from(
    '%PDF-1.7\nCA018 actual execution mail receipt\n%%EOF\n',
  );
  const receipt = await uploadCaseFile(
    request,
    caseId,
    'MAIL_RECEIPT',
    receiptBytes,
  );
  const result = await body<{
    mailingId: string;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${caseId}/execution-mail`, {
      headers: operator,
      data: {
        expectedVersion,
        idempotencyKey: randomUUID(),
        expectedConfirmationId,
        mailedAt: shanghaiToday(),
        mailReceiptContentVersionIds: [receipt.contentVersionId],
      },
    }),
    201,
  );
  return { result, receipt, receiptBytes };
}

async function submitExecutionFiling(
  request: APIRequestContext,
  caseId: string,
  expectedVersion: number,
  expectedMailingId: string | null,
) {
  const proofBytes = Buffer.from(
    '%PDF-1.7\nCA018 actual execution filing proof\n%%EOF\n',
  );
  const proof = await uploadCaseFile(
    request,
    caseId,
    'EXECUTION_FILING_PROOF',
    proofBytes,
  );
  const result = await body<{
    filingId: string;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${caseId}/execution-filing-submit`, {
      headers: operator,
      data: {
        expectedVersion,
        idempotencyKey: randomUUID(),
        expectedMailingId,
        submittedAt: shanghaiToday(),
        executionFilingProofContentVersionIds: [proof.contentVersionId],
      },
    }),
    201,
  );
  return { result, proof, proofBytes };
}

async function finishExecution(
  request: APIRequestContext,
  caseId: string,
  expectedVersion: number,
  expectedFilingId: string | null,
) {
  const basis = await uploadCaseFile(
    request,
    caseId,
    'EXECUTION_FINISH_BASIS',
    Buffer.from('%PDF-1.7\nCA018 actual execution finish basis\n%%EOF\n'),
  );
  const result = await body<{
    finishId: string;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${caseId}/execution-finish`, {
      headers: operator,
      data: {
        expectedVersion,
        idempotencyKey: randomUUID(),
        expectedFilingId,
        finishedAt: shanghaiToday(),
        reason: 'CA018 actual execution result recorded from current source',
        basisNote: null,
        basisContentVersionIds: [basis.contentVersionId],
      },
    }),
    201,
  );
  return { result, basis };
}

test.beforeEach(clean);
test.afterEach(clean);

test('creates and refreshes an external entry in the browser and hides entry access without grant', async ({
  page,
  request,
}) => {
  await login(page, '/cases');
  const listEntryButton = page.getByRole('button', {
    name: /外部转入|转入.*补录/u,
  });
  await expect(listEntryButton).toBeVisible();
  await listEntryButton.click();
  await expect(page).toHaveURL(/\/cases\/external-entry$/u);
  await expect(
    page.getByRole('heading', { name: /外部转入|转入.*补录/u }),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: '录入类型', exact: true })
    .selectOption('EXTERNAL_TRANSFER');
  await page
    .getByRole('combobox', { name: '当前阶段', exact: true })
    .selectOption('PENDING_MATCH');
  await page.getByLabel('当前阶段真实业务日期').fill(shanghaiToday());
  const browserSource = `CA018 E2E:browser ${randomUUID()}`;
  await page.getByLabel('资料来源').fill(browserSource);
  await page.getByLabel('转入／补录原因').fill('浏览器录入真实当前状态');
  await page
    .getByRole('combobox', { name: '客户', exact: true })
    .selectOption(coreLeadFixtures.admittedCustomer);
  await page
    .getByRole('combobox', { name: '权利主体', exact: true })
    .selectOption(coreLeadFixtures.holder);
  const createResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/v1/cases/external-entries'),
  );
  await page.locator('form.case-entry-form button[type="submit"]').click();
  const created = await (await createResponse).json();
  await expect(page).toHaveURL(new RegExp(`/cases/${created.id}$`, 'u'));
  const stored = await readCase(request, created.id);
  expect(stored.origin).toMatchObject({
    source: browserSource,
    reason: '浏览器录入真实当前状态',
  });
  await page.reload();
  await page.goto('/cases');
  const row = page.getByRole('row').filter({ hasText: created.businessNo });
  await expect(row).toBeVisible();
  const sourceContext = row
    .locator('details')
    .filter({ hasText: '案件来源：' });
  await expect(sourceContext).toHaveCount(1);
  const sourceSummary = sourceContext.locator(':scope > summary');
  await expect(sourceSummary).toHaveCount(1);
  await sourceSummary.click();
  const sourceDetails = sourceContext
    .locator('p')
    .filter({ hasText: '案件来源：' });
  await expect(sourceDetails).toHaveCount(1);
  await expect(sourceDetails).toBeVisible();
  await expect(sourceDetails).toContainText('案件来源：');
  await expect(sourceDetails).toContainText('外部转入');
  await expect(sourceDetails).toContainText(shanghaiToday());

  await page.getByRole('button', { name: '退出登录' }).click();
  await login(page, '/cases', true);
  await expect(
    page.getByRole('button', { name: /外部转入|转入.*补录/u }),
  ).toHaveCount(0);
  await page.goto('/cases/external-entry');
  await expect(page.getByRole('status')).toContainText(
    '当前账号没有转入／补录权限',
  );
  await expect(page.locator('form.case-entry-form')).toHaveCount(0);
  await expect(page.getByLabel('客户')).toHaveCount(0);
});

test('registers direct external acceptance through the browser with its real court', async ({
  page,
  request,
}) => {
  const seed = await createEntry(request, input('WAITING_FILING'));
  const court = await createFilingCourt(request, seed.id);
  const date = shanghaiToday();
  const root = await createEntry(
    request,
    input('WAITING_FORMAL_ACCEPTANCE', {
      stageReachedOn: date,
      known: {
        courtId: court.id,
        courtCaseNo: `CA018-BROWSER-${randomUUID().slice(0, 8)}`,
        acceptedOn: date,
        secondInstanceAcceptedOn: null,
        platform: null,
        shopName: null,
        shopExternalId: null,
        caseType: null,
        infringementTypes: null,
      },
    }),
  );
  const notice = await uploadCaseFile(
    request,
    root.id,
    'ACCEPTANCE_NOTICE',
    Buffer.from('%PDF-1.7\nCA018 browser acceptance notice\n%%EOF\n'),
  );
  await login(page, `/cases/${root.id}`);
  const acceptanceAction = page.getByRole('button', {
    name: '正式立案／受理材料',
    exact: true,
  });
  await expect(acceptanceAction).toHaveCount(1);
  await expect(acceptanceAction).toBeVisible();
  await acceptanceAction.click();
  await expect(
    page.locator('[data-test="case-acceptance-panel"]'),
  ).toBeVisible();
  await page
    .locator('[data-test="acceptance-court-id"]')
    .selectOption(court.id);
  await page.locator('[data-test="acceptance-accepted-at"]').fill(date);
  await page
    .locator('[data-test="acceptance-court-case-no"]')
    .fill(`CA018-BROWSER-REGISTER-${randomUUID().slice(0, 8)}`);
  await page
    .locator('[data-test="case-acceptance-panel"] li')
    .filter({ hasText: 'ca018-ACCEPTANCE_NOTICE.pdf' })
    .locator('input[type="checkbox"]')
    .check();
  const action = page.waitForRequest(
    (req) =>
      req.method() === 'POST' &&
      req.url().includes(`/cases/${root.id}/acceptance-register`),
  );
  await page.locator('[data-test="acceptance-register"]').click();
  const payload = (await action).postDataJSON() as Record<string, unknown>;
  expect(payload.courtId).toBe(court.id);
  await expect(
    page.locator('[data-test="case-acceptance-record"]'),
  ).toBeVisible();
  expect((await readCase(request, root.id)).acceptance).toBeTruthy();
  await expectExactDownload(
    request,
    notice,
    Buffer.from('%PDF-1.7\nCA018 browser acceptance notice\n%%EOF\n'),
  );
});

test('uploads and confirms a complete direct execution material bundle in the browser', async ({
  page,
  request,
}) => {
  const root = await createEntry(
    request,
    input('WAITING_EXECUTION_CONFIRMATION'),
  );
  const directEntry = await readCase(request, root.id);
  expect(directEntry.canSubmitExecution).toBe(false);
  expect(directEntry.canUploadDirectExecutionMaterials).toBe(true);
  const bytes = Buffer.from(
    '%PDF-1.7\nCA018 browser execution application\n%%EOF\n',
  );
  const secondBytes = Buffer.from(
    '%PDF-1.7\nCA018 browser execution schedule\n%%EOF\n',
  );
  await login(page, `/cases/${root.id}`);
  await page.goto(`/cases/${root.id}?tab=files`);
  await page.locator('[data-test="open-upload"]').click();
  const uploadPanel = page.locator('[data-test="execution-submission-panel"]');
  await expect(uploadPanel).toBeVisible();
  const uploadInput = page.locator(
    '[data-test="execution-material-upload-only"]',
  );
  await expect(uploadInput).toBeVisible();
  const uploadFromBrowser = async (name: string, fileBytes: Buffer) => {
    const uploadedResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        response.url().includes('/api/v1/materials/upload-drafts/') &&
        response.url().endsWith('/content'),
    );
    await expect(uploadInput).toBeVisible();
    await expect(uploadInput).toBeEnabled();
    await uploadInput.setInputFiles({
      name,
      mimeType: 'application/pdf',
      buffer: fileBytes,
    });
    return (await (await uploadedResponse).json()) as {
      materialId: string;
      contentVersionId: string;
    };
  };
  const uploaded = await uploadFromBrowser(
    'ca018-execution-application.pdf',
    bytes,
  );
  const uploadedSecond = await uploadFromBrowser(
    'ca018-execution-schedule.pdf',
    secondBytes,
  );
  await expect(uploadPanel.locator('input[type="checkbox"]')).toHaveCount(0);
  await expect(
    uploadPanel.locator('[data-test="submit-execution"]'),
  ).toHaveCount(0);
  const beforeIncompleteConfirmation = await caseExternalEntrySnapshot(root.id);
  const incompleteResponse = await request.post(
    `/api/v1/cases/${root.id}/execution-confirm`,
    {
      headers: operator,
      data: {
        expectedVersion: root.version,
        idempotencyKey: randomUUID(),
        expectedSubmissionId: null,
        executionApplicationContentVersionIds: [uploaded.contentVersionId],
      },
    },
  );
  expect([400, 422]).toContain(incompleteResponse.status());
  expect(await readCase(request, root.id)).toMatchObject({
    stage: 'WAITING_EXECUTION_CONFIRMATION',
    version: root.version,
  });
  expect(await caseExternalEntrySnapshot(root.id)).toEqual(
    beforeIncompleteConfirmation,
  );
  await page.reload();
  const confirmationAction = page.locator(
    '[data-test="workspace-primary-action"]',
  );
  await expect(confirmationAction).toHaveCount(1);
  await expect(confirmationAction).toBeVisible();
  await confirmationAction.click();
  const confirmation = page.locator(
    '[data-test="execution-confirmation-panel"]',
  );
  await expect(confirmation).toHaveCount(1);
  await expect(confirmation).toBeVisible();
  const confirmRequest = page.waitForRequest(
    (req) =>
      req.method() === 'POST' &&
      req.url().includes(`/cases/${root.id}/execution-confirm`),
  );
  await page.locator('[data-test="confirm-execution"]').click();
  const confirmBody = (await confirmRequest).postDataJSON() as {
    expectedSubmissionId: string | null;
    executionApplicationContentVersionIds: string[];
  };
  expect(confirmBody.expectedSubmissionId).toBeNull();
  expect(confirmBody.executionApplicationContentVersionIds).toEqual(
    [uploaded.contentVersionId, uploadedSecond.contentVersionId].sort(),
  );
  await expect(
    confirmation.locator(
      `[data-test="execution-confirmation-file-${uploaded.contentVersionId}"]`,
    ),
  ).toBeVisible();
  await expect(
    confirmation.locator(
      `[data-test="execution-confirmation-file-${uploadedSecond.contentVersionId}"]`,
    ),
  ).toBeVisible();
  const after = await readCase(request, root.id);
  expect(after.stage).toBe('WAITING_EXECUTION_STAMP');
  expect(after.version).toBe(root.version + 1);
  expect(after.executionConfirmation?.submissionId).toBeNull();
  expect(after.executionConfirmation?.files).toHaveLength(2);
  expect(after.executionConfirmation?.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        materialId: uploaded.materialId,
        contentVersionId: uploaded.contentVersionId,
      }),
      expect.objectContaining({
        materialId: uploadedSecond.materialId,
        contentVersionId: uploadedSecond.contentVersionId,
      }),
    ]),
  );
  const confirmedFacts = await caseExternalEntrySnapshot(root.id);
  expect(confirmedFacts.confirmations).toHaveLength(1);
  expect(confirmedFacts.confirmationVersions).toHaveLength(2);
  expect(confirmedFacts.confirmationVersions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        content_version_id: uploaded.contentVersionId,
      }),
      expect.objectContaining({
        content_version_id: uploadedSecond.contentVersionId,
      }),
    ]),
  );
  await page.goto(`/cases/${root.id}?tab=files`);
  await expect(page.locator('[data-workspace-tab="files"]')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    page
      .locator('[data-test="workspace-file"]')
      .filter({ hasText: 'ca018-execution-application.pdf' }),
  ).toBeVisible();
  await expect(
    page
      .locator('[data-test="workspace-file"]')
      .filter({ hasText: 'ca018-execution-schedule.pdf' }),
  ).toBeVisible();
  const exact = await request.get(
    `/api/v1/materials/${uploaded.materialId}/versions/${uploaded.contentVersionId}/content`,
    { headers: operator },
  );
  expect(exact.status(), await exact.text()).toBe(200);
  expect((await exact.body()).equals(bytes)).toBe(true);
  const exactSecond = await request.get(
    `/api/v1/materials/${uploadedSecond.materialId}/versions/${uploadedSecond.contentVersionId}/content`,
    { headers: operator },
  );
  expect(exactSecond.status(), await exactSecond.text()).toBe(200);
  expect((await exactSecond.body()).equals(secondBytes)).toBe(true);
});

for (const amountState of ['KNOWN', 'PENDING'] as const) {
  test(`registers a direct AFFIRM result with ${amountState} amount in the browser`, async ({
    page,
    request,
  }) => {
    const seed = await createEntry(request, input('WAITING_FILING'));
    const court = await createFilingCourt(request, seed.id);
    const acceptedOn = shanghaiDaysAgo(4);
    const secondAcceptedOn = shanghaiDaysAgo(1);
    const root = await createEntry(
      request,
      input('SECOND_INSTANCE', {
        stageReachedOn: secondAcceptedOn,
        known: {
          courtId: court.id,
          courtCaseNo: `CA018-FIRST-${randomUUID().slice(0, 8)}`,
          acceptedOn,
          secondInstanceAcceptedOn: secondAcceptedOn,
          platform: null,
          shopName: null,
          shopExternalId: null,
          caseType: null,
          infringementTypes: null,
        },
      }),
    );
    await login(page, `/cases/${root.id}`);
    const secondInstanceAction = page.locator(
      '[data-test="workspace-primary-action"]',
    );
    await expect(secondInstanceAction).toHaveCount(1);
    await expect(secondInstanceAction).toBeVisible();
    await expect(secondInstanceAction).toHaveText('登记二审结果／进度');
    await secondInstanceAction.click();
    await expect(
      page.locator('[data-test="second-instance-panel"]'),
    ).toBeVisible();
    await page
      .locator('input[name="second-instance-result"][value="AFFIRM"]')
      .check();
    await page
      .locator('[data-test="second-instance-received-at"]')
      .fill(shanghaiToday());
    await page
      .locator(
        'input[name="changed-amount-state"][value="' + amountState + '"]',
      )
      .check();
    if (amountState === 'KNOWN')
      await page.getByLabel('二审判决金额').fill('321.50');
    await page
      .locator('input[name="second-instance-fee-state"][value="PENDING"]')
      .check();
    const judgmentBytes = Buffer.from(
      `%PDF-1.7\nCA018 direct AFFIRM ${amountState}\n%%EOF\n`,
    );
    await page
      .locator('[data-test="second-instance-judgment-upload"]')
      .setInputFiles({
        name: `ca018-affirm-${amountState}.pdf`,
        mimeType: 'application/pdf',
        buffer: judgmentBytes,
      });
    const fileChoice = page.locator(
      '[data-test="second-instance-result-file-choice"]',
    );
    await expect(fileChoice).toHaveCount(1);
    await fileChoice.check();
    const resultRequest = page.waitForRequest(
      (req) =>
        req.method() === 'POST' &&
        req.url().includes(`/cases/${root.id}/second-instance-result`),
    );
    await page.locator('[data-test="second-instance-result-submit"]').click();
    await expect(
      page.locator('[data-test="second-instance-confirmation"]'),
    ).toBeVisible();
    await page.locator('[data-test="second-instance-confirm-result"]').click();
    const payload = (await resultRequest).postDataJSON() as {
      choiceId: string | null;
      trialRoundId: string;
      result: string;
      judgmentAmount: { state: string; amount: string | null };
    };
    expect(payload).toMatchObject({
      choiceId: null,
      trialRoundId: expect.any(String),
      result: 'AFFIRM',
      judgmentAmount:
        amountState === 'KNOWN'
          ? { state: 'KNOWN', amount: '321.50' }
          : { state: 'PENDING', amount: null },
    });
    expect((await readCase(request, root.id)).stage).toBe('SECOND_INSTANCE');
  });
}

test('creates all sixteen stages as explicit external roots without invented prior facts', async ({
  request,
}) => {
  test.setTimeout(180_000);
  for (const stage of stages) {
    const payload = input(stage);
    const created = await createEntry(request, payload);
    expect(created).toMatchObject({
      id: expect.any(String),
      businessNo: expect.any(String),
      stage,
      version: 1,
      entryId: expect.any(String),
      recordedAt: expect.any(String),
    });

    const current = await readCase(request, created.id);
    expect(current).toMatchObject({
      id: created.id,
      stage,
      version: 1,
      sourceLead: null,
      sourceNotaryMatter: null,
      certificate: null,
      origin: {
        kind: 'EXTERNAL_ENTRY',
        entryId: created.entryId,
        entryKind: payload.entryKind,
        initialStage: stage,
        stageReachedOn: payload.stageReachedOn,
        source: payload.source,
        reason: payload.reason,
        known: payload.known,
      },
    });
    if (stage === 'PENDING_MATCH') {
      expect(current.defendants).toEqual([]);
      expect(await caseExternalEntrySnapshot(created.id)).toMatchObject({
        entries: [expect.objectContaining({ initial_stage: stage })],
        receipts: [expect.objectContaining({ case_id: created.id })],
      });
    }
    if (stage === 'WAITING_HEARING') {
      expect(current.acceptance).toBeNull();
      expect(current.hearing).toEqual({
        advances: [],
        arrangements: [],
        corrections: [],
        currentAdvance: null,
        currentArrangement: null,
      });
      expect(current.secondInstance.currentTrialRoundId).toEqual(
        expect.any(String),
      );
    }
  }
});

test('keeps a normally sourced notary case and its archive intact under CA018', async ({
  request,
}) => {
  test.setTimeout(90_000);
  await prepareCaseFilingFixture();
  await prepareCaseAcceptanceFixture();
  await allowOtherEnterpriseAccountSetup();
  await setCaseArchiveFixtureGrant(
    coreLeadFixtures.roleA,
    'case.archive',
    'TEAM',
  );

  const closureBytes = Buffer.from(
    '%PDF-1.7\nCA018 normal NOTARY closure document\n%%EOF\n',
  );
  const source = await createClosedCaseArchiveSourceThroughApi(request, {
    bytes: closureBytes,
  });
  const closureFile = source.file;
  if (closureFile === null) throw new Error('Expected real closure document');
  const before = await readCase(request, source.caseId);
  expect(before.stage).toBe('WAITING_ARCHIVE');
  expect(before.origin).toMatchObject({ kind: 'NOTARY' });
  expect(before.sourceLead).not.toBeNull();
  expect(before.sourceNotaryMatter).not.toBeNull();
  expect(before.certificate).not.toBeNull();
  expect(closureFile).toMatchObject({
    materialId: expect.any(String),
    contentVersionId: expect.any(String),
  });

  const emptyExternal = await caseExternalEntrySnapshot(source.caseId);
  expect(emptyExternal.entries).toEqual([]);
  expect(emptyExternal.receipts).toEqual([]);
  const endpoint = `/api/v1/cases/${source.caseId}/archive`;
  const archiveInput = {
    expectedVersion: source.closureResult.version,
    idempotencyKey: randomUUID(),
    expectedClosureVersionId: source.closureResult.closureVersionId,
    archiveAt: shanghaiToday(),
    archiveType: 'EXECUTION_COLLECTED',
    archiveReason: 'CA018 normal NOTARY source archived after real closure',
  };
  const missingClosure = await request.post(endpoint, {
    headers: operator,
    data: { ...archiveInput, expectedClosureVersionId: null },
  });
  expect(missingClosure.status(), await missingClosure.text()).toBe(400);
  expect(await caseExternalEntrySnapshot(source.caseId)).toEqual(emptyExternal);

  const archived = await body<{
    archiveId: string;
    stage: string;
    version: number;
  }>(
    await request.post(endpoint, { headers: operator, data: archiveInput }),
    201,
  );
  expect(archived).toMatchObject({
    archiveId: expect.any(String),
    stage: 'ARCHIVED',
    version: source.closureResult.version + 1,
  });
  const after = await readCase(request, source.caseId);
  expect(after.origin).toMatchObject({ kind: 'NOTARY' });
  expect(after.sourceLead).not.toBeNull();
  expect(after.sourceNotaryMatter).not.toBeNull();
  expect(after.certificate).not.toBeNull();
  const snapshot = await caseExternalEntrySnapshot(source.caseId);
  expect(snapshot.entries).toEqual([]);
  expect(snapshot.receipts).toEqual([]);
  expect(snapshot.archiveFacts).toHaveLength(1);
  expect(snapshot.closureDocuments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        content_version_id: closureFile.contentVersionId,
      }),
    ]),
  );
  await expectExactDownload(request, closureFile, closureBytes);
});

test('continues a PENDING_MATCH entry through real matching and actual complaint submission', async ({
  request,
}) => {
  const payload = input('PENDING_MATCH');
  const created = await createEntry(request, payload);
  const lawyer = await createLawyerAccountThroughApi(request, {
    fullName: 'CA018 合成承办律师',
  });
  const matched = await body<{ stage: string; version: number }>(
    await request.post(`/api/v1/cases/${created.id}/match`, {
      headers: operator,
      data: {
        expectedVersion: created.version,
        idempotencyKey: randomUUID(),
        matchedOn: payload.stageReachedOn,
        defendants: [{ kind: 'ORGANIZATION', name: 'CA018 合成被告' }],
        lawyerAccountId: lawyer.id,
      },
    }),
    201,
  );
  expect(matched).toMatchObject({ stage: 'WAITING_COMPLAINT', version: 2 });

  const materials: string[] = [];
  for (const purpose of ['COMPLAINT', 'AUTHORIZATION']) {
    const draft = await body<{ id: string }>(
      await request.post('/api/v1/materials/upload-drafts', {
        headers: operator,
        data: {
          ownerType: 'CASE',
          ownerId: created.id,
          category: purpose,
          purpose,
          originalFilename: `ca018-${purpose}.pdf`,
          declaredMimeType: 'application/pdf',
        },
      }),
      201,
    );
    const uploaded = await body<{ contentVersionId: string }>(
      await request.put(`/api/v1/materials/upload-drafts/${draft.id}/content`, {
        headers: { ...operator, 'Content-Type': 'application/octet-stream' },
        data: Buffer.from(
          `%PDF-1.4\nCA018 ${purpose} real uploaded bytes\n%%EOF\n`,
        ),
      }),
      200,
    );
    materials.push(uploaded.contentVersionId);
  }
  const submitted = await body<{ stage: string; version: number }>(
    await request.post(`/api/v1/cases/${created.id}/complaint-submit`, {
      headers: operator,
      data: {
        expectedVersion: matched.version,
        idempotencyKey: randomUUID(),
        amountState: 'PENDING',
        amount: null,
        pendingReason: '等待真实金额材料',
        complaintContentVersionIds: [materials[0]],
        authorizationContentVersionIds: [materials[1]],
      },
    }),
    201,
  );
  expect(submitted).toMatchObject({
    stage: 'WAITING_COMPLAINT_CONFIRMATION',
    version: 3,
  });
  const current = await readCase(request, created.id);
  expect(current.origin).toMatchObject({
    kind: 'EXTERNAL_ENTRY',
    entryId: created.entryId,
    initialStage: 'PENDING_MATCH',
  });
});

test('continues the three complaint roots through their real next action with source lineage intact', async ({
  request,
}) => {
  const complaintRoot = await createEntry(
    request,
    input('WAITING_COMPLAINT', {
      defendants: [
        { kind: 'ORGANIZATION', name: 'CA018 complaint-stage defendant' },
      ],
    }),
  );
  const submitted = await submitComplaint(request, complaintRoot.id, 1);
  expect(submitted.submitted).toMatchObject({
    stage: 'WAITING_COMPLAINT_CONFIRMATION',
    version: 2,
  });
  const confirmed = await confirmComplaint(
    request,
    complaintRoot.id,
    submitted.submitted.version,
    submitted.complaint.contentVersionId,
  );
  expect(confirmed).toMatchObject({
    stage: 'WAITING_COMPLAINT_STAMP',
    version: 3,
  });
  await expectExactDownload(
    request,
    submitted.complaint,
    submitted.complaintBytes,
  );
  await expectExactDownload(
    request,
    submitted.authorization,
    submitted.authorizationBytes,
  );
  expect((await sourceView(request, complaintRoot.id)).origin).toMatchObject({
    entryId: complaintRoot.entryId,
    initialStage: 'WAITING_COMPLAINT',
  });

  const confirmationRoot = await createEntry(
    request,
    input('WAITING_COMPLAINT_CONFIRMATION', {
      defendants: [
        { kind: 'ORGANIZATION', name: 'CA018 confirmation defendant' },
      ],
    }),
  );
  const currentComplaintBytes = Buffer.from(
    '%PDF-1.7\nCA018 uploaded current complaint at confirmation root\n%%EOF\n',
  );
  const currentComplaint = await uploadCaseFile(
    request,
    confirmationRoot.id,
    'COMPLAINT',
    currentComplaintBytes,
  );
  const directConfirmation = await confirmComplaint(
    request,
    confirmationRoot.id,
    confirmationRoot.version,
    currentComplaint.contentVersionId,
  );
  expect(directConfirmation).toMatchObject({
    stage: 'WAITING_COMPLAINT_STAMP',
    version: 2,
  });
  const mailedAfterConfirmation = await mailComplaint(
    request,
    confirmationRoot.id,
    directConfirmation.version,
  );
  expect(mailedAfterConfirmation.result).toMatchObject({
    stage: 'WAITING_FILING',
    version: 3,
  });
  await expectExactDownload(
    request,
    mailedAfterConfirmation.receipt,
    mailedAfterConfirmation.receiptBytes,
  );

  const stampRoot = await createEntry(
    request,
    input('WAITING_COMPLAINT_STAMP', {
      defendants: [
        { kind: 'ORGANIZATION', name: 'CA018 complaint-stamp defendant' },
      ],
    }),
  );
  const mailedFromStamp = await mailComplaint(request, stampRoot.id, 1);
  expect(mailedFromStamp.result).toMatchObject({
    stage: 'WAITING_FILING',
    version: 2,
  });
  await expectExactDownload(
    request,
    mailedFromStamp.receipt,
    mailedFromStamp.receiptBytes,
  );
  const filedAfterMail = await submitFiling(
    request,
    stampRoot.id,
    mailedFromStamp.result.version,
  );
  expect(filedAfterMail.result).toMatchObject({
    stage: 'WAITING_FORMAL_ACCEPTANCE',
    version: 3,
  });
  await expectExactDownload(
    request,
    filedAfterMail.evidence,
    filedAfterMail.evidenceBytes,
  );
  await expectExactDownload(
    request,
    filedAfterMail.screenshot,
    filedAfterMail.screenshotBytes,
  );

  for (const [caseId, entryId, initialStage] of [
    [complaintRoot.id, complaintRoot.entryId, 'WAITING_COMPLAINT'],
    [
      confirmationRoot.id,
      confirmationRoot.entryId,
      'WAITING_COMPLAINT_CONFIRMATION',
    ],
    [stampRoot.id, stampRoot.entryId, 'WAITING_COMPLAINT_STAMP'],
  ] as const) {
    const final = await sourceView(request, caseId);
    expect(final.origin).toMatchObject({
      kind: 'EXTERNAL_ENTRY',
      entryId,
      initialStage,
    });
    expect(final.sourceLead).toBeNull();
    expect(final.sourceNotaryMatter).toBeNull();
    expect(final.certificate).toBeNull();
  }
  const downloaded = await request.get(
    `/api/v1/materials/${currentComplaint.materialId}/versions/${currentComplaint.contentVersionId}/content`,
    { headers: operator },
  );
  expect(downloaded.status(), await downloaded.text()).toBe(200);
  expect((await downloaded.body()).equals(currentComplaintBytes)).toBe(true);
});

test('continues filing and acceptance roots through real command successors', async ({
  request,
}) => {
  const filingRoot = await createEntry(
    request,
    input('WAITING_FILING', {
      defendants: [{ kind: 'ORGANIZATION', name: 'CA018 filing defendant' }],
    }),
  );
  const filing = await submitFiling(request, filingRoot.id, filingRoot.version);
  expect(filing.result).toMatchObject({
    stage: 'WAITING_FORMAL_ACCEPTANCE',
    version: 2,
  });
  const filingNotice = await uploadCaseFile(
    request,
    filingRoot.id,
    'ACCEPTANCE_NOTICE',
    Buffer.from('%PDF-1.7\nCA018 actual acceptance notice\n%%EOF\n'),
  );
  const filingSnapshot = await caseExternalEntrySnapshot(filingRoot.id);
  const filingAcceptanceFields = acceptancePayload(
    filing.result.version,
    shanghaiToday(),
    `CA018-${randomUUID().slice(0, 8)}`,
    filingNotice.contentVersionId,
  );
  const suppliedCourt = await request.post(
    `/api/v1/cases/${filingRoot.id}/acceptance-register`,
    {
      headers: operator,
      data: { ...filingAcceptanceFields, courtId: filing.court.id },
    },
  );
  expect(suppliedCourt.status(), await suppliedCourt.text()).toBe(400);
  expect(await caseExternalEntrySnapshot(filingRoot.id)).toEqual(
    filingSnapshot,
  );
  const acceptanceAfterFiling = await submitAcceptance(
    request,
    filingRoot.id,
    filingAcceptanceFields,
  );
  expect(acceptanceAfterFiling).toMatchObject({
    stage: 'WAITING_HEARING',
    version: 3,
  });
  await expectExactDownload(
    request,
    filingNotice,
    Buffer.from('%PDF-1.7\nCA018 actual acceptance notice\n%%EOF\n'),
  );

  const acceptanceDate = shanghaiDaysAgo(1);
  const courtSeed = await createEntry(
    request,
    input('WAITING_FILING', {
      defendants: [
        { kind: 'ORGANIZATION', name: 'CA018 acceptance court seed' },
      ],
    }),
  );
  const acceptanceCourt = await createFilingCourt(request, courtSeed.id);
  const firstInstanceAcceptedOn = shanghaiDaysAgo(3);
  const acceptanceRoot = await createEntry(
    request,
    input('WAITING_FORMAL_ACCEPTANCE', {
      stageReachedOn: acceptanceDate,
      known: {
        courtId: acceptanceCourt.id,
        courtCaseNo: `CA018-FIRST-${randomUUID().slice(0, 8)}`,
        acceptedOn: firstInstanceAcceptedOn,
        secondInstanceAcceptedOn: null,
        platform: null,
        shopName: null,
        shopExternalId: null,
        caseType: null,
        infringementTypes: null,
      },
      defendants: [
        { kind: 'ORGANIZATION', name: 'CA018 acceptance defendant' },
      ],
    }),
  );
  const rootNotice = await uploadCaseFile(
    request,
    acceptanceRoot.id,
    'ACCEPTANCE_NOTICE',
    Buffer.from('%PDF-1.7\nCA018 direct external acceptance notice\n%%EOF\n'),
  );
  const rootAcceptanceFields = acceptancePayload(
    acceptanceRoot.version,
    acceptanceDate,
    `CA018-ROOT-${randomUUID().slice(0, 8)}`,
    rootNotice.contentVersionId,
  );
  const rootSnapshot = await caseExternalEntrySnapshot(acceptanceRoot.id);
  const missingCourt = await request.post(
    `/api/v1/cases/${acceptanceRoot.id}/acceptance-register`,
    { headers: operator, data: rootAcceptanceFields },
  );
  expect(missingCourt.status(), await missingCourt.text()).toBe(400);
  expect(await caseExternalEntrySnapshot(acceptanceRoot.id)).toEqual(
    rootSnapshot,
  );
  const accepted = await submitAcceptance(request, acceptanceRoot.id, {
    ...rootAcceptanceFields,
    courtId: acceptanceCourt.id,
  });
  expect(accepted).toMatchObject({
    stage: 'WAITING_HEARING',
    version: 2,
  });
  const scheduled = await body<{
    stage: string;
    version: number;
    arrangementId: string;
  }>(
    await request.post(`/api/v1/cases/${acceptanceRoot.id}/hearing-schedule`, {
      headers: operator,
      data: {
        expectedVersion: accepted.version,
        idempotencyKey: randomUUID(),
        hearingAt: acceptanceDate,
      },
    }),
    201,
  );
  expect(scheduled).toMatchObject({ stage: 'WAITING_HEARING', version: 3 });
  await expectExactDownload(
    request,
    rootNotice,
    Buffer.from('%PDF-1.7\nCA018 direct external acceptance notice\n%%EOF\n'),
  );
  await expect
    .poll(async () => (await sourceView(request, acceptanceRoot.id)).stage, {
      timeout: 30_000,
    })
    .toBe('WAITING_JUDGMENT');
  const final = await sourceView(request, acceptanceRoot.id);
  expect(final.origin).toMatchObject({
    kind: 'EXTERNAL_ENTRY',
    entryId: acceptanceRoot.entryId,
    initialStage: 'WAITING_FORMAL_ACCEPTANCE',
  });
  expect(final.sourceLead).toBeNull();
  expect(final.sourceNotaryMatter).toBeNull();
  expect(final.certificate).toBeNull();
});

test('continues a WAITING_JUDGMENT entry through a real judgment and linked execution choice', async ({
  request,
}) => {
  const created = await createEntry(
    request,
    input('WAITING_JUDGMENT', {
      defendants: [{ kind: 'ORGANIZATION', name: 'CA018 judgment defendant' }],
    }),
  );
  const judgmentBytes = Buffer.from(
    '%PDF-1.7\nCA018 actual judgment registered from external current round\n%%EOF\n',
  );
  const judgmentFile = await uploadCaseFile(
    request,
    created.id,
    'JUDGMENT',
    judgmentBytes,
  );
  const judgment = await body<{
    judgmentId: string;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${created.id}/judgment-register`, {
      headers: operator,
      data: {
        expectedVersion: created.version,
        idempotencyKey: randomUUID(),
        judgmentReceivedAt: shanghaiToday(),
        judgmentAmountState: 'PENDING',
        judgmentAmount: null,
        paidLitigationFeeState: 'PENDING',
        paidLitigationFee: null,
        judgmentContentVersionIds: [judgmentFile.contentVersionId],
      },
    }),
    201,
  );
  expect(judgment).toMatchObject({ stage: 'WAITING_JUDGMENT', version: 2 });
  const choice = await body<{
    stage: string;
    version: number;
    choiceId: string;
  }>(
    await request.post(`/api/v1/cases/${created.id}/judgment-next-step`, {
      headers: operator,
      data: {
        expectedVersion: judgment.version,
        idempotencyKey: randomUUID(),
        judgmentId: judgment.judgmentId,
        next: 'EXECUTION',
        executionReadinessConfirmed: true,
      },
    }),
    201,
  );
  expect(choice).toMatchObject({
    stage: 'WAITING_EXECUTION_DOCUMENTS',
    version: 3,
    choiceId: expect.any(String),
  });
  expect((await sourceView(request, created.id)).origin).toMatchObject({
    kind: 'EXTERNAL_ENTRY',
    entryId: created.entryId,
    initialStage: 'WAITING_JUDGMENT',
  });
  const downloaded = await request.get(
    `/api/v1/materials/${judgmentFile.materialId}/versions/${judgmentFile.contentVersionId}/content`,
    { headers: operator },
  );
  expect(downloaded.status(), await downloaded.text()).toBe(200);
  expect((await downloaded.body()).equals(judgmentBytes)).toBe(true);
});

test('continues all four execution roots with nullable first predecessors and real IDs on every next step', async ({
  request,
}) => {
  const documentsRoot = await createEntry(
    request,
    input('WAITING_EXECUTION_DOCUMENTS'),
  );
  const submitted = await submitExecution(
    request,
    documentsRoot.id,
    documentsRoot.version,
  );
  expect(submitted.result).toMatchObject({
    stage: 'WAITING_EXECUTION_CONFIRMATION',
    version: 2,
  });
  const confirmedSubmitted = await confirmExecution(
    request,
    documentsRoot.id,
    submitted.result.version,
    submitted.result.submissionId,
  );
  expect(confirmedSubmitted).toMatchObject({
    stage: 'WAITING_EXECUTION_STAMP',
    version: 3,
  });
  await expectExactDownload(request, submitted.application, submitted.bytes);

  const confirmationRoot = await createEntry(
    request,
    input('WAITING_EXECUTION_CONFIRMATION'),
  );
  const confirmationApplicationBytes = Buffer.from(
    '%PDF-1.7\nCA018 actual application proof for direct confirmation root\n%%EOF\n',
  );
  const confirmationApplication = await uploadCaseFile(
    request,
    confirmationRoot.id,
    'EXECUTION_APPLICATION',
    confirmationApplicationBytes,
  );
  const directConfirmation = await confirmExecution(
    request,
    confirmationRoot.id,
    confirmationRoot.version,
    null,
    [confirmationApplication.contentVersionId],
  );
  expect(directConfirmation).toMatchObject({
    stage: 'WAITING_EXECUTION_STAMP',
    version: 2,
  });
  const mailedAfterConfirmation = await mailExecution(
    request,
    confirmationRoot.id,
    directConfirmation.version,
    directConfirmation.confirmationId,
  );
  expect(mailedAfterConfirmation.result).toMatchObject({
    stage: 'WAITING_EXECUTION_FILING',
    version: 3,
  });
  await expectExactDownload(
    request,
    mailedAfterConfirmation.receipt,
    mailedAfterConfirmation.receiptBytes,
  );
  const exactApplication = await request.get(
    `/api/v1/materials/${confirmationApplication.materialId}/versions/${confirmationApplication.contentVersionId}/content`,
    { headers: operator },
  );
  expect(exactApplication.status(), await exactApplication.text()).toBe(200);
  expect(
    (await exactApplication.body()).equals(confirmationApplicationBytes),
  ).toBe(true);

  const stampRoot = await createEntry(
    request,
    input('WAITING_EXECUTION_STAMP'),
  );
  const mailedFromStamp = await mailExecution(
    request,
    stampRoot.id,
    stampRoot.version,
    null,
  );
  expect(mailedFromStamp.result).toMatchObject({
    stage: 'WAITING_EXECUTION_FILING',
    version: 2,
  });
  const filedAfterMail = await submitExecutionFiling(
    request,
    stampRoot.id,
    mailedFromStamp.result.version,
    mailedFromStamp.result.mailingId,
  );
  expect(filedAfterMail.result).toMatchObject({
    stage: 'EXECUTING',
    version: 3,
  });
  await expectExactDownload(
    request,
    filedAfterMail.proof,
    filedAfterMail.proofBytes,
  );

  const filingRoot = await createEntry(
    request,
    input('WAITING_EXECUTION_FILING'),
  );
  const filed = await submitExecutionFiling(
    request,
    filingRoot.id,
    filingRoot.version,
    null,
  );
  expect(filed.result).toMatchObject({ stage: 'EXECUTING', version: 2 });
  const finished = await finishExecution(
    request,
    filingRoot.id,
    filed.result.version,
    filed.result.filingId,
  );
  expect(finished.result).toMatchObject({
    stage: 'WAITING_ARCHIVE',
    version: 3,
  });
  const closureFile = await uploadCaseFile(
    request,
    filingRoot.id,
    'CASE_CLOSURE_DOCUMENT',
    Buffer.from('%PDF-1.7\nCA018 closure after actual finish\n%%EOF\n'),
  );
  const closure = await body<{
    finishId: string;
    closureVersionId: string;
    version: number;
    stage: string;
  }>(
    await request.post(`/api/v1/cases/${filingRoot.id}/closure`, {
      headers: operator,
      data: {
        expectedVersion: finished.result.version,
        idempotencyKey: randomUUID(),
        expectedFinishId: finished.result.finishId,
        closeAt: null,
        closeAmountState: 'PENDING',
        closeAmt: null,
        note: 'CA018 closure follows the actual returned finish fact',
        closeContentVersionIds: [closureFile.contentVersionId],
      },
    }),
    201,
  );
  expect(closure).toMatchObject({
    finishId: finished.result.finishId,
    stage: 'WAITING_ARCHIVE',
    version: 4,
  });
  const archived = await body<{ stage: string; version: number }>(
    await request.post(`/api/v1/cases/${filingRoot.id}/archive`, {
      headers: operator,
      data: {
        expectedVersion: closure.version,
        idempotencyKey: randomUUID(),
        expectedClosureVersionId: closure.closureVersionId,
        archiveAt: shanghaiToday(),
        archiveType: 'EXECUTION_CLOSED',
        archiveReason: 'CA018 archive follows real finish and closure IDs',
      },
    }),
    201,
  );
  expect(archived).toMatchObject({ stage: 'ARCHIVED', version: 5 });
  await expectExactDownload(
    request,
    closureFile,
    Buffer.from('%PDF-1.7\nCA018 closure after actual finish\n%%EOF\n'),
  );

  for (const entry of [
    documentsRoot,
    confirmationRoot,
    stampRoot,
    filingRoot,
  ]) {
    const final = await sourceView(request, entry.id);
    expect(final.origin).toMatchObject({
      kind: 'EXTERNAL_ENTRY',
      entryId: entry.entryId,
      initialStage: entry.stage,
    });
    expect(final.sourceLead).toBeNull();
    expect(final.sourceNotaryMatter).toBeNull();
    expect(final.certificate).toBeNull();
  }
  const downloaded = await request.get(
    `/api/v1/materials/${submitted.application.materialId}/versions/${submitted.application.contentVersionId}/content`,
    { headers: operator },
  );
  expect(downloaded.status(), await downloaded.text()).toBe(200);
  expect((await downloaded.body()).equals(submitted.bytes)).toBe(true);
});

test('continues a direct WAITING_ARCHIVE root with null only for its absent finish, then archives the real closure', async ({
  request,
}) => {
  const created = await createEntry(request, input('WAITING_ARCHIVE'));
  const bytes = Buffer.from(
    '%PDF-1.7\nCA018 direct archive-entry closure document bytes\n%%EOF\n',
  );
  const document = await uploadCaseFile(
    request,
    created.id,
    'CASE_CLOSURE_DOCUMENT',
    bytes,
  );
  const before = await caseExternalEntrySnapshot(created.id);
  const missingFinish = await request.post(
    `/api/v1/cases/${created.id}/closure`,
    {
      headers: operator,
      data: {
        expectedVersion: created.version,
        idempotencyKey: randomUUID(),
        expectedFinishId: randomUUID(),
        closeAt: null,
        closeAmountState: 'PENDING',
        closeAmt: null,
        note: null,
        closeContentVersionIds: [document.contentVersionId],
      },
    },
  );
  expect([400, 409], await missingFinish.text()).toContain(
    missingFinish.status(),
  );
  expect(await caseExternalEntrySnapshot(created.id)).toEqual(before);

  const closure = await body<{
    finishId: string | null;
    closureVersionId: string;
    version: number;
    stage: string;
  }>(
    await request.post(`/api/v1/cases/${created.id}/closure`, {
      headers: operator,
      data: {
        expectedVersion: created.version,
        idempotencyKey: randomUUID(),
        expectedFinishId: null,
        closeAt: null,
        closeAmountState: 'PENDING',
        closeAmt: null,
        note: 'CA018 source root directly reached closure state',
        closeContentVersionIds: [document.contentVersionId],
      },
    }),
    201,
  );
  expect(closure).toMatchObject({
    finishId: null,
    stage: 'WAITING_ARCHIVE',
    version: created.version + 1,
  });
  const archived = await body<{ stage: string; version: number }>(
    await request.post(`/api/v1/cases/${created.id}/archive`, {
      headers: operator,
      data: {
        expectedVersion: closure.version,
        idempotencyKey: randomUUID(),
        expectedClosureVersionId: closure.closureVersionId,
        archiveAt: shanghaiToday(),
        archiveType: 'EXECUTION_CLOSED',
        archiveReason: 'CA018 archive after direct-root closure',
      },
    }),
    201,
  );
  expect(archived.stage).toBe('ARCHIVED');
  expect((await sourceView(request, created.id)).origin).toMatchObject({
    kind: 'EXTERNAL_ENTRY',
    entryId: created.entryId,
    initialStage: 'WAITING_ARCHIVE',
  });
  const downloaded = await request.get(
    `/api/v1/materials/${document.materialId}/versions/${document.contentVersionId}/content`,
    { headers: operator },
  );
  expect(downloaded.status(), await downloaded.text()).toBe(200);
  expect((await downloaded.body()).equals(bytes)).toBe(true);
});

test('continues an EXECUTING entry through real finish, closure, archive, and exact file downloads', async ({
  request,
}) => {
  const payload = input('EXECUTING');
  const created = await createEntry(request, payload);
  const finishBytes = Buffer.from(
    '%PDF-1.7\nCA018 real execution finish basis bytes\n%%EOF\n',
  );
  const finishFile = await uploadCaseFile(
    request,
    created.id,
    'EXECUTION_FINISH_BASIS',
    finishBytes,
  );
  const finished = await body<{
    finishId: string;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${created.id}/execution-finish`, {
      headers: operator,
      data: {
        expectedVersion: created.version,
        idempotencyKey: randomUUID(),
        expectedFilingId: null,
        finishedAt: shanghaiToday(),
        reason: 'CA018 合成验收中的真实执行终结',
        basisNote: null,
        basisContentVersionIds: [finishFile.contentVersionId],
      },
    }),
    201,
  );
  expect(finished).toMatchObject({ stage: 'WAITING_ARCHIVE', version: 2 });

  const closureBytes = Buffer.from(
    '%PDF-1.7\nCA018 real closure source bytes\n%%EOF\n',
  );
  const closureFile = await uploadCaseFile(
    request,
    created.id,
    'CASE_CLOSURE_DOCUMENT',
    closureBytes,
  );
  const beforeClosure = await caseExternalEntrySnapshot(created.id);
  for (const expectedFinishId of [null, randomUUID()]) {
    const rejectedClosure = await request.post(
      `/api/v1/cases/${created.id}/closure`,
      {
        headers: operator,
        data: {
          expectedVersion: finished.version,
          idempotencyKey: randomUUID(),
          expectedFinishId,
          closeAt: null,
          closeAmountState: 'PENDING',
          closeAmt: null,
          note: '必须引用刚刚真实登记的执行结束事实',
          closeContentVersionIds: [closureFile.contentVersionId],
        },
      },
    );
    expect([400, 409], await rejectedClosure.text()).toContain(
      rejectedClosure.status(),
    );
    expect(await caseExternalEntrySnapshot(created.id)).toEqual(beforeClosure);
  }
  const closure = await body<{
    closureVersionId: string;
    finishId: string;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${created.id}/closure`, {
      headers: operator,
      data: {
        expectedVersion: finished.version,
        idempotencyKey: randomUUID(),
        expectedFinishId: finished.finishId,
        closeAt: null,
        closeAmountState: 'PENDING',
        closeAmt: null,
        note: '执行结束后登记当前真实结案资料',
        closeContentVersionIds: [closureFile.contentVersionId],
      },
    }),
    201,
  );
  expect(closure).toMatchObject({
    finishId: finished.finishId,
    stage: 'WAITING_ARCHIVE',
    version: 3,
  });

  const archived = await body<{ stage: string; version: number }>(
    await request.post(`/api/v1/cases/${created.id}/archive`, {
      headers: operator,
      data: {
        expectedVersion: closure.version,
        idempotencyKey: randomUUID(),
        expectedClosureVersionId: closure.closureVersionId,
        archiveAt: shanghaiToday(),
        archiveType: 'EXECUTION_CLOSED',
        archiveReason: '当前案件已完成真实结案资料登记',
      },
    }),
    201,
  );
  expect(archived).toMatchObject({ stage: 'ARCHIVED', version: 4 });

  const final = await readCase(request, created.id);
  expect(final).toMatchObject({
    stage: 'ARCHIVED',
    version: 4,
    sourceLead: null,
    sourceNotaryMatter: null,
    certificate: null,
    origin: {
      kind: 'EXTERNAL_ENTRY',
      entryId: created.entryId,
      initialStage: 'EXECUTING',
    },
  });
  for (const [file, expectedBytes] of [
    [finishFile, finishBytes],
    [closureFile, closureBytes],
  ] as const) {
    const downloaded = await request.get(
      `/api/v1/materials/${file.materialId}/versions/${file.contentVersionId}/content`,
      { headers: operator },
    );
    expect(downloaded.status(), await downloaded.text()).toBe(200);
    expect((await downloaded.body()).equals(expectedBytes)).toBe(true);
  }
});

test('continues a WAITING_HEARING entry with an actual hearing, system advance, judgment, and execution choice', async ({
  request,
}) => {
  const reachedOn = shanghaiDaysAgo(2);
  const created = await createEntry(
    request,
    input('WAITING_HEARING', { stageReachedOn: reachedOn }),
  );
  const hearingAt = shanghaiDaysAgo(1);
  const scheduled = await body<{
    arrangementId: string;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${created.id}/hearing-schedule`, {
      headers: operator,
      data: {
        expectedVersion: created.version,
        idempotencyKey: randomUUID(),
        hearingAt,
      },
    }),
    201,
  );
  expect(scheduled).toMatchObject({
    stage: 'WAITING_HEARING',
    version: created.version + 1,
  });

  await expect
    .poll(async () => (await readCase(request, created.id)).stage, {
      timeout: 30_000,
    })
    .toBe('WAITING_JUDGMENT');
  const afterHearing = await readCase(request, created.id);
  expect(afterHearing.secondInstance.currentTrialRoundId).toEqual(
    expect.any(String),
  );
  expect(afterHearing.origin).toMatchObject({
    kind: 'EXTERNAL_ENTRY',
    entryId: created.entryId,
    initialStage: 'WAITING_HEARING',
  });
  const hearing = afterHearing.hearing as {
    currentArrangement: { id: string; hearingAt: string };
    currentAdvance: { id: string; arrangementId: string };
  };
  expect(hearing).toMatchObject({
    currentArrangement: { id: scheduled.arrangementId, hearingAt },
    currentAdvance: {
      id: expect.any(String),
      arrangementId: scheduled.arrangementId,
    },
  });

  const judgmentBytes = Buffer.from(
    '%PDF-1.7\nCA018 actual judgment document bytes\n%%EOF\n',
  );
  const judgmentFile = await uploadCaseFile(
    request,
    created.id,
    'JUDGMENT',
    judgmentBytes,
  );
  const judgment = await body<{
    judgmentId: string;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${created.id}/judgment-register`, {
      headers: operator,
      data: {
        expectedVersion: afterHearing.version,
        idempotencyKey: randomUUID(),
        judgmentReceivedAt: shanghaiToday(),
        judgmentAmountState: 'PENDING',
        judgmentAmount: null,
        paidLitigationFeeState: 'PENDING',
        paidLitigationFee: null,
        judgmentContentVersionIds: [judgmentFile.contentVersionId],
      },
    }),
    201,
  );
  expect(judgment.stage).toBe('WAITING_JUDGMENT');

  const next = await body<{ stage: string; version: number }>(
    await request.post(`/api/v1/cases/${created.id}/judgment-next-step`, {
      headers: operator,
      data: {
        expectedVersion: judgment.version,
        idempotencyKey: randomUUID(),
        judgmentId: judgment.judgmentId,
        next: 'EXECUTION',
        executionReadinessConfirmed: true,
      },
    }),
    201,
  );
  expect(next).toMatchObject({
    stage: 'WAITING_EXECUTION_DOCUMENTS',
    version: judgment.version + 1,
  });
  expect((await readCase(request, created.id)).origin).toMatchObject({
    kind: 'EXTERNAL_ENTRY',
    entryId: created.entryId,
    initialStage: 'WAITING_HEARING',
  });
  const downloaded = await request.get(
    `/api/v1/materials/${judgmentFile.materialId}/versions/${judgmentFile.contentVersionId}/content`,
    { headers: operator },
  );
  expect(downloaded.status(), await downloaded.text()).toBe(200);
  expect((await downloaded.body()).equals(judgmentBytes)).toBe(true);
});

test('records and revises direct second-instance acceptance against its real entry round', async ({
  request,
}) => {
  const acceptedOn = shanghaiDaysAgo(2);
  const acceptedAt = acceptedOn;
  const created = await createEntry(
    request,
    input('SECOND_INSTANCE', {
      stageReachedOn: acceptedOn,
      defendants: [
        { kind: 'ORGANIZATION', name: 'CA018 direct second-instance party' },
      ],
      known: {
        courtId: null,
        courtCaseNo: null,
        acceptedOn: shanghaiDaysAgo(5),
        secondInstanceAcceptedOn: acceptedOn,
        platform: null,
        shopName: null,
        shopExternalId: null,
        caseType: null,
        infringementTypes: null,
      },
    }),
  );
  const initial = await readCase(request, created.id);
  const trialRoundId = requiredCurrentTrialRoundId(initial);
  expect(trialRoundId).toEqual(expect.any(String));

  const saveAcceptance = (input: {
    expectedAcceptanceRevision: number;
    acceptedAt: string | null;
    courtCaseNo: string | null;
    reason: string | null;
    idempotencyKey?: string;
  }) =>
    request.post(
      `/api/v1/cases/${created.id}/second-instance-acceptance-save`,
      {
        headers: operator,
        data: {
          choiceId: null,
          trialRoundId,
          idempotencyKey: input.idempotencyKey ?? randomUUID(),
          ...input,
        },
      },
    );

  const firstInput = {
    expectedAcceptanceRevision: 0,
    acceptedAt,
    courtCaseNo: `CA018-SECOND-${randomUUID().slice(0, 8)}`,
    reason: null,
    idempotencyKey: randomUUID(),
  };
  const first = await body<{
    choiceId: string | null;
    trialRoundId: string;
    changeId: string;
    acceptanceRevision: number;
    acceptedAt: string | null;
    courtCaseNo: string | null;
  }>(await saveAcceptance(firstInput), 201);
  expect(first).toMatchObject({
    choiceId: null,
    trialRoundId,
    acceptanceRevision: 1,
    acceptedAt,
    courtCaseNo: firstInput.courtCaseNo,
  });
  const replay = await body(await saveAcceptance(firstInput), 201);
  expect(replay).toEqual(first);

  const beforeStale = await caseExternalEntrySnapshot(created.id);
  const stale = await saveAcceptance({
    expectedAcceptanceRevision: 0,
    acceptedAt: null,
    courtCaseNo: 'CA018-STALE',
    reason: 'stale acceptance revision',
  });
  expect(stale.status(), await stale.text()).toBe(409);
  expect(await caseExternalEntrySnapshot(created.id)).toEqual(beforeStale);
  const beforeCorrection = await readCase(request, created.id);
  expect(beforeCorrection.recordEdits?.secondInstanceAcceptances).toEqual([
    expect.objectContaining({
      choiceId: null,
      trialRoundId,
      acceptanceRevision: 1,
      acceptedAt,
      courtCaseNo: firstInput.courtCaseNo,
      history: expect.any(Array),
    }),
  ]);

  const clearedDate = await body(
    await saveAcceptance({
      expectedAcceptanceRevision: 1,
      acceptedAt: null,
      courtCaseNo: firstInput.courtCaseNo,
      reason: 'CA018 correction clears an incorrect date',
    }),
    201,
  );
  expect(clearedDate).toMatchObject({
    choiceId: null,
    trialRoundId,
    acceptanceRevision: 2,
    acceptedAt: null,
    courtCaseNo: firstInput.courtCaseNo,
  });
  const clearedNumber = await body(
    await saveAcceptance({
      expectedAcceptanceRevision: 2,
      acceptedAt: null,
      courtCaseNo: null,
      reason: 'CA018 correction clears an unverified case number',
    }),
    201,
  );
  expect(clearedNumber).toMatchObject({
    acceptanceRevision: 3,
    acceptedAt: null,
    courtCaseNo: null,
  });
  expect(
    (await readCase(request, created.id)).recordEdits
      ?.secondInstanceAcceptances?.[0]?.history,
  ).toHaveLength(3);

  const appealRoot = await createEntry(
    request,
    input('WAITING_HEARING', { stageReachedOn: shanghaiDaysAgo(2) }),
  );
  const scheduled = await body<{ arrangementId: string; version: number }>(
    await request.post(`/api/v1/cases/${appealRoot.id}/hearing-schedule`, {
      headers: operator,
      data: {
        expectedVersion: appealRoot.version,
        idempotencyKey: randomUUID(),
        hearingAt: shanghaiDaysAgo(1),
      },
    }),
    201,
  );
  expect(scheduled.arrangementId).toEqual(expect.any(String));
  await expect
    .poll(async () => (await readCase(request, appealRoot.id)).stage, {
      timeout: 30_000,
    })
    .toBe('WAITING_JUDGMENT');
  const appealCase = await readCase(request, appealRoot.id);
  const judgmentFile = await uploadCaseFile(
    request,
    appealRoot.id,
    'JUDGMENT',
    Buffer.from('%PDF-1.7\nCA018 appeal source judgment\n%%EOF\n'),
  );
  const judgment = await body<{ judgmentId: string; version: number }>(
    await request.post(`/api/v1/cases/${appealRoot.id}/judgment-register`, {
      headers: operator,
      data: {
        expectedVersion: appealCase.version,
        idempotencyKey: randomUUID(),
        judgmentReceivedAt: shanghaiToday(),
        judgmentAmountState: 'PENDING',
        judgmentAmount: null,
        paidLitigationFeeState: 'PENDING',
        paidLitigationFee: null,
        judgmentContentVersionIds: [judgmentFile.contentVersionId],
      },
    }),
    201,
  );
  const appeal = await body<{ choiceId: string; version: number }>(
    await request.post(`/api/v1/cases/${appealRoot.id}/judgment-next-step`, {
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
  const appealSource = await readCase(request, appealRoot.id);
  const beforeRejectedNull = await caseExternalEntrySnapshot(appealRoot.id);
  const rejectedNull = await request.post(
    `/api/v1/cases/${appealRoot.id}/second-instance-acceptance-save`,
    {
      headers: operator,
      data: {
        choiceId: null,
        trialRoundId: requiredCurrentTrialRoundId(appealSource),
        expectedAcceptanceRevision: 0,
        idempotencyKey: randomUUID(),
        acceptedAt: shanghaiToday(),
        courtCaseNo: `CA018-APPEAL-${randomUUID().slice(0, 8)}`,
        reason: null,
      },
    },
  );
  expect(rejectedNull.status(), await rejectedNull.text()).toBe(409);
  expect(await caseExternalEntrySnapshot(appealRoot.id)).toEqual(
    beforeRejectedNull,
  );
  const acceptedAppeal = await body<{
    choiceId: string;
    acceptanceRevision: number;
  }>(
    await request.post(
      `/api/v1/cases/${appealRoot.id}/second-instance-acceptance-save`,
      {
        headers: operator,
        data: {
          choiceId: appeal.choiceId,
          trialRoundId: requiredCurrentTrialRoundId(appealSource),
          expectedAcceptanceRevision: 0,
          idempotencyKey: randomUUID(),
          acceptedAt: shanghaiToday(),
          courtCaseNo: `CA018-APPEAL-${randomUUID().slice(0, 8)}`,
          reason: null,
        },
      },
    ),
    201,
  );
  expect(acceptedAppeal).toMatchObject({
    choiceId: appeal.choiceId,
    acceptanceRevision: 1,
  });
  const beforeSqlProbes = await caseExternalEntrySnapshot(created.id);
  await assertCaseExternalEntrySqlGuards(created.id, appealRoot.entryId);
  expect(await caseExternalEntrySnapshot(created.id)).toEqual(beforeSqlProbes);
});

test('keeps direct second-instance execution resubmission and frozen confirmation on real IDs', async ({
  request,
}) => {
  const acceptedOn = shanghaiDaysAgo(3);
  const created = await createEntry(
    request,
    input('SECOND_INSTANCE', {
      stageReachedOn: acceptedOn,
      defendants: [
        { kind: 'ORGANIZATION', name: 'CA018 direct execution party' },
      ],
      known: {
        courtId: null,
        courtCaseNo: null,
        acceptedOn: shanghaiDaysAgo(6),
        secondInstanceAcceptedOn: acceptedOn,
        platform: null,
        shopName: null,
        shopExternalId: null,
        caseType: null,
        infringementTypes: null,
      },
    }),
  );
  const initial = await readCase(request, created.id);
  const trialRoundId = requiredCurrentTrialRoundId(initial);
  expect(trialRoundId).toEqual(expect.any(String));
  const progress = {
    hearingAt: null,
    hearingPlace: null,
    judgeName: null,
    documentContentVersionIds: [],
    serviceContentVersionIds: [],
  };
  const saved = await body<{ progressId: string | null; version: number }>(
    await request.post(`/api/v1/cases/${created.id}/second-instance-save`, {
      headers: operator,
      data: {
        expectedVersion: initial.version,
        idempotencyKey: randomUUID(),
        trialRoundId,
        choiceId: null,
        expectedProgressId: null,
        progress,
      },
    }),
    201,
  );
  const judgmentBytes = Buffer.from(
    '%PDF-1.7\nCA018 direct second-instance judgment bytes\n%%EOF\n',
  );
  const judgmentFile = await uploadCaseFile(
    request,
    created.id,
    'SECOND_INSTANCE_JUDGMENT',
    judgmentBytes,
  );
  const judgment = await body<{
    resultId: string;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${created.id}/second-instance-result`, {
      headers: operator,
      data: {
        expectedVersion: saved.version,
        idempotencyKey: randomUUID(),
        trialRoundId,
        choiceId: null,
        expectedProgressId: saved.progressId,
        progress,
        result: 'AFFIRM',
        resultReceivedAt: shanghaiToday(),
        judgmentContentVersionIds: [judgmentFile.contentVersionId],
        judgmentAmount: { state: 'KNOWN', amount: '4200.00' },
        paidLitigationFee: { state: 'PENDING', amount: null },
      },
    }),
    201,
  );
  expect(judgment.stage).toBe('WAITING_EXECUTION_DOCUMENTS');

  const uploadApplication = async (suffix: string) => {
    const bytes = Buffer.from(`%PDF-1.7\nCA018 application ${suffix}\n%%EOF\n`);
    const file = await uploadCaseFile(
      request,
      created.id,
      'EXECUTION_APPLICATION',
      bytes,
    );
    return { ...file, bytes };
  };
  const firstFile = await uploadApplication('first');
  const first = await body<{ submissionId: string; version: number }>(
    await request.post(`/api/v1/cases/${created.id}/execution-submit`, {
      headers: operator,
      data: {
        expectedVersion: judgment.version,
        idempotencyKey: randomUUID(),
        trialRoundId,
        judgmentNextStepId: null,
        secondInstanceResultId: judgment.resultId,
        expectedSubmissionId: null,
        executionApplicationContentVersionIds: [firstFile.contentVersionId],
      },
    }),
    201,
  );
  const beforeBadResubmit = await caseExternalEntrySnapshot(created.id);
  const badResubmit = await request.post(
    `/api/v1/cases/${created.id}/execution-submit`,
    {
      headers: operator,
      data: {
        expectedVersion: first.version,
        idempotencyKey: randomUUID(),
        trialRoundId,
        judgmentNextStepId: null,
        secondInstanceResultId: judgment.resultId,
        expectedSubmissionId: null,
        executionApplicationContentVersionIds: [firstFile.contentVersionId],
        changeReason: 'must cite the real current submission',
      },
    },
  );
  expect(badResubmit.status(), await badResubmit.text()).toBe(409);
  expect(await caseExternalEntrySnapshot(created.id)).toEqual(
    beforeBadResubmit,
  );

  const correctedFile = await uploadApplication('corrected');
  const corrected = await body<{ submissionId: string; version: number }>(
    await request.post(`/api/v1/cases/${created.id}/execution-submit`, {
      headers: operator,
      data: {
        expectedVersion: first.version,
        idempotencyKey: randomUUID(),
        trialRoundId,
        judgmentNextStepId: null,
        secondInstanceResultId: judgment.resultId,
        expectedSubmissionId: first.submissionId,
        executionApplicationContentVersionIds: [correctedFile.contentVersionId],
        changeReason:
          'CA018 replace the first execution package with a corrected current version',
      },
    }),
    201,
  );
  const confirmation = await confirmExecution(
    request,
    created.id,
    corrected.version,
    corrected.submissionId,
  );
  expect(confirmation.stage).toBe('WAITING_EXECUTION_STAMP');

  const facts = await caseExternalEntrySnapshot(created.id);
  expect(facts.executionSubmissions).toHaveLength(2);
  expect(facts.submissionVersions).toHaveLength(2);
  expect(facts.submissionVersions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        submission_id: first.submissionId,
        content_version_id: firstFile.contentVersionId,
      }),
      expect.objectContaining({
        submission_id: corrected.submissionId,
        content_version_id: correctedFile.contentVersionId,
      }),
    ]),
  );
  expect(facts.confirmations).toHaveLength(1);
  expect(facts.confirmations[0]).toMatchObject({
    submission_id: corrected.submissionId,
    external_entry_id: created.entryId,
  });
  expect(facts.confirmationVersions).toHaveLength(0);
  await expectExactDownload(request, firstFile, firstFile.bytes);
  await expectExactDownload(request, correctedFile, correctedFile.bytes);
  await expectExactDownload(request, judgmentFile, judgmentBytes);
});

test('continues a SECOND_INSTANCE entry through real REMAND, child acceptance, and hearing', async ({
  request,
}) => {
  const courtSeed = await createEntry(
    request,
    input('WAITING_FILING', {
      defendants: [{ kind: 'ORGANIZATION', name: 'CA018 remand court seed' }],
    }),
  );
  const remandCourt = await createFilingCourt(request, courtSeed.id);
  const firstInstanceAcceptedOn = shanghaiDaysAgo(5);
  const secondInstanceAcceptedOn = shanghaiDaysAgo(2);
  const payload = input('SECOND_INSTANCE', {
    stageReachedOn: secondInstanceAcceptedOn,
    known: {
      courtId: remandCourt.id,
      courtCaseNo: `CA018-FIRST-${randomUUID().slice(0, 8)}`,
      acceptedOn: firstInstanceAcceptedOn,
      secondInstanceAcceptedOn,
      platform: null,
      shopName: null,
      shopExternalId: null,
      caseType: null,
      infringementTypes: null,
    },
  });
  const created = await createEntry(request, payload);
  const initial = await readCase(request, created.id);
  const externalRoundId = requiredCurrentTrialRoundId(initial);
  expect(externalRoundId).toEqual(expect.any(String));

  const progress = {
    hearingAt: null,
    hearingPlace: null,
    judgeName: null,
    documentContentVersionIds: [],
    serviceContentVersionIds: [],
  };
  const saved = await body<{
    progressId: string | null;
    stage: string;
    version: number;
  }>(
    await request.post(`/api/v1/cases/${created.id}/second-instance-save`, {
      headers: operator,
      data: {
        expectedVersion: initial.version,
        idempotencyKey: randomUUID(),
        trialRoundId: externalRoundId,
        choiceId: null,
        expectedProgressId: null,
        progress,
      },
    }),
    201,
  );
  expect(saved).toMatchObject({
    stage: 'SECOND_INSTANCE',
    progressId: null,
    version: initial.version,
  });

  const remandBytes = Buffer.from(
    '%PDF-1.7\nCA018 actual second-instance REMAND result bytes\n%%EOF\n',
  );
  const remandFile = await uploadCaseFile(
    request,
    created.id,
    'SECOND_INSTANCE_JUDGMENT',
    remandBytes,
  );
  const remanded = await body<{
    progressId: string | null;
    resultId: string;
    stage: string;
    version: number;
    currentTrialRoundId: string;
  }>(
    await request.post(`/api/v1/cases/${created.id}/second-instance-result`, {
      headers: operator,
      data: {
        expectedVersion: saved.version,
        idempotencyKey: randomUUID(),
        trialRoundId: externalRoundId,
        choiceId: null,
        expectedProgressId: saved.progressId,
        progress,
        result: 'REMAND',
        resultReceivedAt: shanghaiToday(),
        judgmentContentVersionIds: [remandFile.contentVersionId],
        paidLitigationFee: { state: 'PENDING', amount: null },
      },
    }),
    201,
  );
  expect(remanded).toMatchObject({
    stage: 'WAITING_FORMAL_ACCEPTANCE',
    currentTrialRoundId: expect.any(String),
  });
  expect(remanded.currentTrialRoundId).not.toBe(externalRoundId);
  const afterRemand = await readCase(request, created.id);
  expect(afterRemand.acceptance).toBeNull();
  expect(afterRemand.origin).toMatchObject({
    kind: 'EXTERNAL_ENTRY',
    entryId: created.entryId,
    initialStage: 'SECOND_INSTANCE',
    known: {
      courtId: remandCourt.id,
      courtCaseNo: payload.known.courtCaseNo,
      acceptedOn: firstInstanceAcceptedOn,
      secondInstanceAcceptedOn,
    },
  });

  const acceptanceBytes = Buffer.from(
    '%PDF-1.7\nCA018 real remand child acceptance notice bytes\n%%EOF\n',
  );
  const acceptanceFile = await uploadCaseFile(
    request,
    created.id,
    'ACCEPTANCE_NOTICE',
    acceptanceBytes,
  );
  const accepted = await submitAcceptance(
    request,
    created.id,
    acceptancePayload(
      remanded.version,
      shanghaiToday(),
      `CA018-RMD-${randomUUID().slice(0, 8)}`,
      acceptanceFile.contentVersionId,
      remandCourt.id,
    ),
  );
  expect(accepted).toMatchObject({
    stage: 'WAITING_HEARING',
    version: remanded.version + 1,
  });
  const childHearing = await body<{
    stage: string;
    version: number;
    arrangementId: string;
  }>(
    await request.post(`/api/v1/cases/${created.id}/hearing-schedule`, {
      headers: operator,
      data: {
        expectedVersion: accepted.version,
        idempotencyKey: randomUUID(),
        hearingAt: shanghaiToday(),
      },
    }),
    201,
  );
  expect(childHearing).toMatchObject({
    stage: 'WAITING_HEARING',
    version: accepted.version + 1,
    arrangementId: expect.any(String),
  });

  const final = await readCase(request, created.id);
  expect(final.secondInstance.currentTrialRoundId).toBe(
    remanded.currentTrialRoundId,
  );
  expect(final.origin).toMatchObject({
    kind: 'EXTERNAL_ENTRY',
    entryId: created.entryId,
    initialStage: 'SECOND_INSTANCE',
  });
  for (const [file, expectedBytes] of [
    [remandFile, remandBytes],
    [acceptanceFile, acceptanceBytes],
  ] as const) {
    const downloaded = await request.get(
      `/api/v1/materials/${file.materialId}/versions/${file.contentVersionId}/content`,
      { headers: operator },
    );
    expect(downloaded.status(), await downloaded.text()).toBe(200);
    expect((await downloaded.body()).equals(expectedBytes)).toBe(true);
  }
});

test('returns a fixed receipt for exact replay and conflicts on a changed body', async ({
  request,
}) => {
  const payload = input('WAITING_COMPLAINT', {
    entryKind: 'HISTORICAL_BACKFILL',
  });
  const created = await createEntry(request, payload);
  const replay = await createEntry(request, payload);
  expect(replay).toEqual(created);

  const changed = await request.post('/api/v1/cases/external-entries', {
    headers: operator,
    data: { ...payload, reason: '同键不同原因' },
  });
  expect(changed.status(), await changed.text()).toBe(409);
  const snapshot = await caseExternalEntrySnapshot(created.id);
  expect(snapshot.entries).toHaveLength(1);
  expect(snapshot.receipts).toHaveLength(1);
});

test('serializes concurrent create receipts and keeps distinct keys distinct', async ({
  request,
}) => {
  const samePayload = input('WAITING_COMPLAINT');
  const sameResponses = await Promise.all(
    Array.from({ length: 4 }, () =>
      request.post('/api/v1/cases/external-entries', {
        headers: operator,
        data: samePayload,
      }),
    ),
  );
  const sameReceipts = await Promise.all(
    sameResponses.map((response) => body<Created>(response, 201)),
  );
  for (const receipt of sameReceipts) expect(receipt).toEqual(sameReceipts[0]);
  expect(
    await caseExternalEntryCreateCounts(
      samePayload.source,
      samePayload.idempotencyKey,
    ),
  ).toEqual({
    entries: 1,
    cases: 1,
    audits: 1,
    receipts: 1,
    defendants: 0,
    lawyers: 0,
  });

  const distinctPayloads = Array.from({ length: 3 }, () =>
    input('WAITING_COMPLAINT'),
  );
  const distinctResponses = await Promise.all(
    distinctPayloads.map((payload) =>
      request.post('/api/v1/cases/external-entries', {
        headers: operator,
        data: payload,
      }),
    ),
  );
  const distinctReceipts = await Promise.all(
    distinctResponses.map((response) => body<Created>(response, 201)),
  );
  expect(
    new Set(distinctReceipts.map(({ businessNo }) => businessNo)).size,
  ).toBe(3);
  for (const [index, payload] of distinctPayloads.entries()) {
    expect(
      await caseExternalEntryCreateCounts(
        payload.source,
        payload.idempotencyKey,
      ),
    ).toEqual({
      entries: 1,
      cases: 1,
      audits: 1,
      receipts: 1,
      defendants: 0,
      lawyers: 0,
    });
    const replay = await createEntry(request, payload);
    expect(replay).toEqual(distinctReceipts[index]);
  }
  expect(
    await caseExternalEntryCreateCounts(
      samePayload.source,
      samePayload.idempotencyKey,
    ),
  ).toMatchObject({ entries: 1, cases: 1, audits: 1, receipts: 1 });
});

test('rolls back every create write when audit, entry, or receipt insertion fails', async ({
  request,
}) => {
  for (const phase of ['audit', 'entry', 'receipt'] as const) {
    const payload = input('WAITING_COMPLAINT', {
      defendants: [
        { kind: 'PERSON', name: `CA018 fault ${phase} defendant one` },
        { kind: 'ORGANIZATION', name: `CA018 fault ${phase} defendant two` },
      ],
    });
    const injected = await withCaseExternalEntryCreateFault(
      payload,
      phase,
      () =>
        request.post('/api/v1/cases/external-entries', {
          headers: operator,
          data: payload,
        }),
    );
    expect(injected.status, `${phase} insert fault must reach the API`).toBe(
      500,
    );
    expect(
      injected.faultReached,
      `${phase} trigger sequence must advance`,
    ).toBe(true);
    expect(
      injected.after,
      `${phase} failure must roll back the whole write`,
    ).toBe(injected.before);

    const retried = await createEntry(request, payload);
    expect(retried).toMatchObject({
      stage: 'WAITING_COMPLAINT',
      version: 1,
    });
    expect(
      await caseExternalEntryCreateCounts(
        payload.source,
        payload.idempotencyKey,
      ),
    ).toEqual({
      entries: 1,
      cases: 1,
      audits: 1,
      receipts: 1,
      defendants: 2,
      lawyers: 0,
    });
  }
});

test('enforces strict body, internal-only scope, and authorization before receipt replay', async ({
  request,
}) => {
  const optionsDenied = await request.get(
    '/api/v1/cases/external-entry-options',
    {
      headers: selfOnly,
    },
  );
  expect(optionsDenied.status()).toBe(200);
  const options = (await optionsDenied.json()) as Record<string, unknown>;
  expect(options.canCreate).toBe(false);
  expect(options.canCreateArchived).toBe(false);
  expect(options).not.toHaveProperty('customers');
  expect(options).not.toHaveProperty('rightsHolders');
  expect(options).not.toHaveProperty('lawyers');

  const noGrant = input('WAITING_COMPLAINT');
  const denied = await request.post('/api/v1/cases/external-entries', {
    headers: selfOnly,
    data: noGrant,
  });
  expect(denied.status(), await denied.text()).toBe(403);

  const foreignActor = await request.post('/api/v1/cases/external-entries', {
    headers: foreign,
    data: input('WAITING_COMPLAINT'),
  });
  expect(foreignActor.status(), await foreignActor.text()).toBe(403);
  const foreignCustomer = await request.post('/api/v1/cases/external-entries', {
    headers: operator,
    data: input('WAITING_COMPLAINT', {
      customerId: coreLeadFixtures.foreignCustomer,
      rightsHolderId: coreLeadFixtures.foreignHolder,
    }),
  });
  expect(foreignCustomer.status(), await foreignCustomer.text()).toBe(403);

  const strictBody = input('WAITING_COMPLAINT');
  const unknownKey = await request.post('/api/v1/cases/external-entries', {
    headers: operator,
    data: { ...strictBody, oldStage: 'WAITING_FILING' },
  });
  expect([400, 422], await unknownKey.text()).toContain(unknownKey.status());

  const lawyer = await createLawyerAccountThroughApi(request, {
    fullName: 'CA018 strict-read lawyer',
  });
  const lawyerProfile = lawyer.profiles[0];
  if (!lawyerProfile)
    throw new Error('Expected a real profile for the synthetic lawyer account');
  const lawyerEntryInput = input('WAITING_EXECUTION_CONFIRMATION', {
    lawyerAccountId: lawyer.id,
    lawyerProfileId: lawyerProfile.profileId,
  });
  const lawyerEntry = await createEntry(request, lawyerEntryInput);

  const revokedPayload = input('WAITING_COMPLAINT');
  const created = await createEntry(request, revokedPayload);
  const before = await caseExternalEntrySnapshot(created.id);
  await setCaseExternalEntryGrant(
    coreLeadFixtures.roleA,
    'case.external-entry.create',
    'TEAM',
    false,
  );
  const replayAfterRevocation = await request.post(
    '/api/v1/cases/external-entries',
    { headers: operator, data: revokedPayload },
  );
  expect(
    replayAfterRevocation.status(),
    await replayAfterRevocation.text(),
  ).toBe(403);
  expect(await caseExternalEntrySnapshot(created.id)).toEqual(before);

  const lawyerSession = await body<{ csrfToken: string }>(
    await request.post('/api/v1/auth/login', {
      headers: { Origin: 'http://127.0.0.1:5174' },
      data: { username: lawyer.username, password: lawyer.password },
    }),
    200,
  );
  const lawyerReadResponse = await request.get(
    `/api/v1/lawyer/cases/${lawyerEntry.id}`,
  );
  expect(lawyerReadResponse.status(), await lawyerReadResponse.text()).toBe(
    200,
  );
  const lawyerRead = (await lawyerReadResponse.json()) as {
    canSubmitExecution: boolean;
    canUploadDirectExecutionMaterials: boolean;
    origin: {
      kind: 'EXTERNAL_ENTRY';
      entryKind: EntryInput['entryKind'];
      initialStage: Stage;
      stageReachedOn: string;
    };
  };
  expect(lawyerRead.canSubmitExecution).toBe(false);
  expect(lawyerRead.canUploadDirectExecutionMaterials).toBe(true);
  expect(lawyerRead.origin).toEqual({
    kind: 'EXTERNAL_ENTRY',
    entryKind: lawyerEntryInput.entryKind,
    initialStage: lawyerEntryInput.initialStage,
    stageReachedOn: lawyerEntryInput.stageReachedOn,
  });

  const lawyerCannotReadUnassignedCase = await request.get(
    `/api/v1/lawyer/cases/${created.id}`,
  );
  expect(
    lawyerCannotReadUnassignedCase.status(),
    await lawyerCannotReadUnassignedCase.text(),
  ).toBe(404);

  const lawyerCannotCreateInternally = await request.post(
    '/api/v1/cases/external-entries',
    {
      headers: {
        Origin: 'http://127.0.0.1:5174',
        'X-CSRF-Token': lawyerSession.csrfToken,
      },
      data: input('WAITING_COMPLAINT'),
    },
  );
  expect(
    lawyerCannotCreateInternally.status(),
    await lawyerCannotCreateInternally.text(),
  ).toBe(403);
});
