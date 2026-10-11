import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  coreLeadFixtures,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';
import { createSubmittedCaseThroughApi } from '../support/case-complaint-confirmation-database.mjs';
import { clearCoreCaseSecondInstanceFixture } from '../support/case-second-instance-database.mjs';
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
import {
  clearCoreCaseHearingAdmin,
  clearCoreCaseHearingAdminSessions,
  prepareCoreCaseHearingAdmin,
} from '../support/case-hearing-database.mjs';
import { disconnectCustomerTestDatabase } from '../support/customer-database.mjs';

const origin = 'http://127.0.0.1:5174';
const sourcePdf = Buffer.from('%PDF-1.4\nCA010 source attachment\n%%EOF\n');
const progressPdf = Buffer.from(
  '%PDF-1.4\nCA010 exact progress bytes\n%%EOF\n',
);
const servicePdf = Buffer.from('%PDF-1.4\nCA010 exact service bytes\n%%EOF\n');
const resultPdf = Buffer.from('%PDF-1.4\nCA010 exact result bytes\n%%EOF\n');
const todayShanghai = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const pastWorkflowDate = () => {
  const past = new Date(`${todayShanghai()}T00:00:00.000Z`);
  past.setUTCDate(past.getUTCDate() - 2);
  const date = past.toISOString().slice(0, 10);
  return date > '2026-09-28' ? date : '2026-09-28';
};

async function status(
  response: { status(): number; text(): Promise<string>; url(): string },
  expected: number,
) {
  const actual = response.status();
  const body = actual === expected ? '' : await response.text();
  expect(actual, `${response.url()} ${body}`).toBe(expected);
}

async function uploadInBrowserAndWaitForSelectableVersion(
  page: Page,
  input: Locator,
  optionList: Locator,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  const finalized = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'PUT' &&
      /^\/api\/v1\/materials\/upload-drafts\/[^/]+\/content$/u.test(
        url.pathname,
      )
    );
  });
  await input.setInputFiles(file);
  await status(await finalized, 200);
  const option = optionList.locator('label').filter({ hasText: file.name });
  await expect(option).toHaveCount(1);
  await expect(option.locator('input[type="checkbox"]')).toBeEnabled();
}

async function login(
  page: Page,
  path: string,
  username: string,
  password: string,
): Promise<string> {
  await page.goto(path);
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  const loginResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/auth/login',
  );
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(path);
  const response = await loginResponse;
  await status(response, 200);
  return ((await response.json()) as { csrfToken: string }).csrfToken;
}

async function logout(page: Page) {
  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === 'POST' &&
      new URL(candidate.url()).pathname === '/api/v1/auth/logout',
  );
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await status(await response, 204);
  await expect(page).toHaveURL(/\/login$/u);
}

async function uploadByApi(
  request: APIRequestContext,
  caseId: string,
  category: string,
  bytes: Buffer,
  headers: Record<string, string>,
): Promise<{
  materialId: string;
  contentVersionId: string;
  originalFilename: string;
}> {
  const originalFilename = `CA010-${category}-${randomUUID().slice(0, 6)}.pdf`;
  const draft = await request.post('/api/v1/materials/upload-drafts', {
    headers,
    data: {
      ownerType: 'CASE',
      ownerId: caseId,
      category,
      purpose: category,
      originalFilename,
      declaredMimeType: 'application/pdf',
    },
  });
  await status(draft, 201);
  const draftId = ((await draft.json()) as { id: string }).id;
  const finalized = await request.put(
    `/api/v1/materials/upload-drafts/${draftId}/content`,
    {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: bytes,
    },
  );
  await status(finalized, 200);
  return (await finalized.json()) as {
    materialId: string;
    contentVersionId: string;
    originalFilename: string;
  };
}

async function prepareSourceToAcceptance(
  request: APIRequestContext,
  submitAsLawyer = false,
) {
  const source = await createSubmittedCaseThroughApi(request, {
    submitAsLawyer,
  });
  const headers = { Authorization: `Bearer ${coreLeadFixtures.tokenA}` };
  const prefix = `/api/v1/cases/${source.caseId}`;
  const businessDate = pastWorkflowDate();
  const confirmed = await request.post(`${prefix}/complaint-confirm`, {
    headers,
    data: {
      expectedVersion: source.submitted.version,
      idempotencyKey: randomUUID(),
      confirmedComplaintContentVersionId: source.complaint.contentVersionId,
      amountState: 'KNOWN',
      amount: '123.45',
      pendingReason: null,
      confirmDisclose: true,
    },
  });
  await status(confirmed, 201);
  const receipt = await uploadByApi(
    request,
    source.caseId,
    'MAIL_RECEIPT',
    sourcePdf,
    headers,
  );
  const mailed = await request.post(`${prefix}/complaint-mail`, {
    headers,
    data: {
      expectedVersion: source.submitted.version + 1,
      idempotencyKey: randomUUID(),
      mailedAt: businessDate,
      mailReceiptContentVersionIds: [receipt.contentVersionId],
    },
  });
  await status(mailed, 201);
  const courtResponse = await request.post(`${prefix}/filing-courts`, {
    headers,
    data: { name: `CA010法院-${randomUUID().slice(0, 8)}` },
  });
  await status(courtResponse, 201);
  const court = (await courtResponse.json()) as { id: string };
  const evidence = await uploadByApi(
    request,
    source.caseId,
    'FILING_EVIDENCE',
    sourcePdf,
    headers,
  );
  const filed = await request.post(`${prefix}/filing-submit`, {
    headers,
    data: {
      expectedVersion: source.submitted.version + 2,
      idempotencyKey: randomUUID(),
      courtId: court.id,
      submittedAt: businessDate,
      filingEvidenceContentVersionIds: [evidence.contentVersionId],
    },
  });
  await status(filed, 201);
  const acceptanceFile = await uploadByApi(
    request,
    source.caseId,
    'ACCEPTANCE_NOTICE',
    sourcePdf,
    headers,
  );
  const detailResponse = await request.get(prefix, { headers });
  await status(detailResponse, 200);
  const detail = (await detailResponse.json()) as { version: number };
  const accepted = await request.post(`${prefix}/acceptance-register`, {
    headers,
    data: {
      expectedVersion: detail.version,
      idempotencyKey: randomUUID(),
      acceptedAt: businessDate,
      courtCaseNo: `（2026）甲0101民初${randomUUID().slice(0, 6)}号`,
      acceptanceNoticeContentVersionIds: [acceptanceFile.contentVersionId],
    },
  });
  await status(accepted, 201);
  return { ...source, businessDate, acceptanceFile };
}

async function prepareCoreTeamGrants(
  page: Page,
  admin: { username: string; password: string },
) {
  await login(page, '/settings/people-access', admin.username, admin.password);
  const roleButton = page.locator(
    `[data-test="edit-role-${coreLeadFixtures.roleA}"]`,
  );
  await expect(roleButton).toBeVisible();
  await roleButton.click();
  const editor = page.getByRole('dialog', { name: 'CORE TEAM' });
  for (const action of [
    'CASE_JUDGMENT_REGISTER',
    'CASE_JUDGMENT_NEXT_STEP',
    'CASE_JUDGMENT_NEXT_STEP_REVOKE',
    'CASE_SECOND_INSTANCE_SAVE',
    'CASE_SECOND_INSTANCE_RESULT',
    'CASE_SECOND_INSTANCE_RESULT_REVOKE',
  ]) {
    await editor.locator(`[data-test="grant-${action}"]`).check();
    await editor.locator(`[data-test="scope-${action}"]`).selectOption('TEAM');
  }
  const refreshed = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname ===
        '/api/v1/organization/management-context',
  );
  await editor.getByRole('button', { name: '保存模板' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const refreshedContext = await refreshed;
  await status(refreshedContext, 200);
  const context = (await refreshedContext.json()) as {
    roles: Array<{
      id: string;
      grants: Array<{ action: string; scope: string }>;
    }>;
  };
  const coreTeam = context.roles.find(
    (role) => role.id === coreLeadFixtures.roleA,
  );
  expect(coreTeam?.grants).toContainEqual({
    action: 'CUSTOMER_READ',
    scope: 'DEPARTMENT',
  });
  expect(coreTeam?.grants).toContainEqual({
    action: 'USER_MANAGE',
    scope: 'DEPARTMENT',
  });
  await logout(page);
}

async function scheduleHearingAsLawyer(
  page: Page,
  caseId: string,
  lawyer: { username: string; password: string },
  hearingAt: string,
) {
  const csrf = await login(
    page,
    '/lawyer/cases',
    lawyer.username,
    lawyer.password,
  );
  const detailResponse = await page.request.get(
    `/api/v1/lawyer/cases/${caseId}`,
  );
  await status(detailResponse, 200);
  const detail = (await detailResponse.json()) as { version: number };
  const scheduled = await page.request.post(
    `/api/v1/lawyer/cases/${caseId}/hearing-schedule`,
    {
      headers: { Origin: origin, 'X-CSRF-Token': csrf },
      data: {
        expectedVersion: detail.version,
        idempotencyKey: randomUUID(),
        hearingAt,
      },
    },
  );
  await status(scheduled, 201);
  await expect
    .poll(async () => {
      const current = await page.request.get(`/api/v1/lawyer/cases/${caseId}`);
      await status(current, 200);
      return ((await current.json()) as { stage: string }).stage;
    })
    .toBe('WAITING_JUDGMENT');
  await logout(page);
}

async function registerFirstJudgment(
  page: Page,
  caseId: string,
  receivedAt: string,
  amountState: 'KNOWN' | 'PENDING' = 'KNOWN',
): Promise<string> {
  await page.goto(`/cases/${caseId}`);
  const panel = page.locator('[data-test="case-judgment-panel"]');
  await expect(panel).toBeVisible();
  const filename = `CA010一审判决-${randomUUID().slice(0, 6)}.pdf`;
  await uploadInBrowserAndWaitForSelectableVersion(
    page,
    panel.locator('[data-test="judgment-file-input"]'),
    panel,
    { name: filename, mimeType: 'application/pdf', buffer: sourcePdf },
  );
  await panel
    .locator('label')
    .filter({ hasText: filename })
    .locator('input[type="checkbox"]')
    .check();
  await panel.locator('[data-test="judgment-date"]').fill(receivedAt);
  await panel
    .locator('[data-test="judgment-amount-state"]')
    .selectOption(amountState);
  if (amountState === 'KNOWN')
    await panel.locator('[data-test="judgment-amount"]').fill('88.00');
  await panel.locator('[data-test="paid-fee-state"]').selectOption('KNOWN');
  await panel.locator('[data-test="paid-fee-amount"]').fill('0.00');
  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === 'POST' &&
      new URL(candidate.url()).pathname ===
        `/api/v1/cases/${caseId}/judgment-register`,
  );
  await panel.locator('[data-test="judgment-submit"]').click();
  await status(await response, 201);
  return filename;
}

async function chooseAppeal(page: Page, caseId: string) {
  const panel = page.locator('[data-test="case-judgment-next-step-panel"]');
  await expect(panel).toBeVisible();
  await panel.locator('input[value="APPEAL"]').check();
  await panel.locator('[data-plaintiff-appeals="true"]').check();
  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === 'POST' &&
      new URL(candidate.url()).pathname ===
        `/api/v1/cases/${caseId}/judgment-next-step`,
  );
  await panel.getByRole('button', { name: '核对并提交选择' }).click();
  await panel.locator('[data-confirm-choice]').click();
  await status(await response, 201);
  const detailResponse = await page.request.get(`/api/v1/cases/${caseId}`);
  await status(detailResponse, 200);
  return (await detailResponse.json()) as {
    version: number;
    judgmentNextStep: {
      current: { id: string; next: string; trialRoundId: string } | null;
      history: Array<{ id: string; next: string; trialRoundId: string }>;
    };
  };
}

async function prepareAppealCase(
  page: Page,
  request: APIRequestContext,
  options: {
    submitAsLawyer?: boolean;
    firstJudgmentAmount?: 'KNOWN' | 'PENDING';
  } = {},
) {
  const source = await prepareSourceToAcceptance(
    request,
    options.submitAsLawyer,
  );
  await scheduleHearingAsLawyer(
    page,
    source.caseId,
    source.lawyer,
    source.businessDate,
  );
  await prepareCoreTeamGrants(page, hearingAdmin);
  await login(
    page,
    '/cases',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  const firstJudgmentFile = await registerFirstJudgment(
    page,
    source.caseId,
    source.businessDate,
    options.firstJudgmentAmount,
  );
  const initial = await chooseAppeal(page, source.caseId);
  return {
    ...source,
    firstJudgmentFile,
    initialChoiceId: initial.judgmentNextStep.current!.id,
  };
}

async function getInternalDetail(page: Page, caseId: string) {
  const response = await page.request.get(`/api/v1/cases/${caseId}`);
  await status(response, 200);
  return (await response.json()) as {
    id: string;
    version: number;
    stage: string;
    acceptance: { acceptedAt: string; courtCaseNo: string } | null;
    acceptances: Array<{
      id: string;
      trialRoundId: string;
      acceptedAt: string;
      courtCaseNo: string;
      files: Array<{
        materialId: string;
        contentVersionId: string;
        originalFilename: string;
      }>;
    }>;
    courtCaseNo: string | null;
    judgment: {
      current: null | {
        id: string;
        files: Array<{
          contentVersionId: string;
          originalFilename: string;
        }>;
      };
      history: Array<{ id: string }>;
      availableFiles: Array<{
        contentVersionId: string;
        originalFilename: string;
      }>;
    };
    judgmentNextStep: {
      current: { id: string; next: string; trialRoundId: string } | null;
      history: Array<{ id: string; next: string; trialRoundId: string }>;
    };
    secondInstance: {
      currentTrialRoundId: string | null;
      currentProgress: null | {
        id: string;
        trialRoundId: string;
        choiceId: string;
        hearingPlace: string | null;
        judgeName: string | null;
        documentFiles: Array<{
          materialId: string;
          contentVersionId: string;
          originalFilename: string;
        }>;
        serviceFiles: Array<{
          materialId: string;
          contentVersionId: string;
          originalFilename: string;
        }>;
      };
      currentResult: null | {
        id: string;
        trialRoundId: string;
        choiceId: string;
        result: string;
        childTrialRoundId: string | null;
        judgmentAmountState: string | null;
        judgmentAmount: string | null;
        paidLitigationFeeState: string;
        paidLitigationFee: string | null;
        files: Array<{
          materialId: string;
          contentVersionId: string;
          originalFilename: string;
        }>;
      };
      rounds: Array<{ id: string; sequence: number; revokedAt: string | null }>;
      progresses: Array<{
        id: string;
        trialRoundId: string;
        choiceId: string;
        hearingAt: string | null;
        hearingPlace: string | null;
        judgeName: string | null;
        documentFiles: Array<{
          materialId: string;
          contentVersionId: string;
          originalFilename: string;
        }>;
        serviceFiles: Array<{
          materialId: string;
          contentVersionId: string;
          originalFilename: string;
        }>;
      }>;
      results: Array<{
        id: string;
        trialRoundId: string;
        choiceId: string;
        result: string;
        judgmentAmountState: string | null;
        judgmentAmount: string | null;
        paidLitigationFeeState: string;
        paidLitigationFee: string | null;
        files: Array<{
          materialId: string;
          contentVersionId: string;
          originalFilename: string;
        }>;
      }>;
      revocations: Array<{ id: string; resultId: string; reason?: string }>;
    };
  };
}

async function browserDownloadBytes(
  page: Page,
  click: () => Promise<unknown>,
): Promise<Buffer> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    click(),
  ]);
  const path = await download.path();
  if (path === null) throw new Error('浏览器未生成附件下载文件');
  return readFile(path);
}

async function exactUploadedVersionId(
  page: Page,
  caseId: string,
  category: string,
  filename: string,
): Promise<string> {
  const response = await page.request.get(
    `/api/v1/materials?ownerType=CASE&ownerId=${encodeURIComponent(caseId)}`,
  );
  await status(response, 200);
  const body = (await response.json()) as {
    items: Array<{
      id: string;
      ownerType: string;
      ownerId: string;
      category: string;
      purpose: string;
      status: string;
      contentVersions: Array<{
        id: string;
        originalFilename: string;
        status: string;
      }>;
    }>;
  };
  const matches = body.items
    .filter(
      (material) =>
        material.ownerType === 'CASE' &&
        material.ownerId === caseId &&
        material.category === category &&
        material.purpose === category &&
        material.status === 'ACTIVE',
    )
    .flatMap((material) =>
      material.contentVersions.filter(
        (version) =>
          version.status === 'AVAILABLE' &&
          version.originalFilename === filename,
      ),
    );
  expect(matches).toHaveLength(1);
  return matches[0]!.id;
}

let hearingAdmin: { username: string; password: string };
test.beforeEach(async ({ page }) => {
  await clearCoreCaseHearingAdminSessions();
  await clearCaseAcceptanceFault();
  await clearCoreCaseSecondInstanceFixture();
  await clearCaseAcceptanceFixture();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
  await resetCoreLeadE2eData();
  await clearCoreCaseHearingAdmin();
  hearingAdmin = await prepareCoreCaseHearingAdmin();
  await prepareCaseFilingFixture();
  await prepareCaseAcceptanceFixture();
  await allowOtherEnterpriseAccountSetup();
});
test.afterEach(async () => {
  await clearCoreCaseHearingAdminSessions();
  await clearCaseAcceptanceFault();
  await clearCoreCaseSecondInstanceFixture();
  await clearCaseAcceptanceFixture();
  await clearCaseFilingFixture();
  await clearCaseComplaintMailingFixture();
  await resetCoreLeadE2eData();
  await clearCoreCaseHearingAdmin();
});
test.afterAll(async () => disconnectCustomerTestDatabase());

test('operator recovers an unknown real upload, then saves progress/result against the reselected current APPEAL', async ({
  page,
  request,
}) => {
  const source = await prepareAppealCase(page, request);
  const panel = page.locator('[data-test="second-instance-panel"]');
  const blankSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/cases/${source.caseId}/second-instance-save`,
  );
  await panel.locator('[data-test="second-instance-progress-save"]').click();
  await status(await blankSave, 201);
  const blankDetail = await getInternalDetail(page, source.caseId);
  expect(blankDetail.secondInstance.currentProgress).toBeNull();
  expect(blankDetail.secondInstance.progresses).toHaveLength(0);

  const firstDetail = await getInternalDetail(page, source.caseId);
  const firstChoiceId = firstDetail.judgmentNextStep.current!.id;
  const oldChoicePanel = page.locator(
    '[data-test="case-judgment-next-step-panel"]',
  );
  await oldChoicePanel
    .locator('[data-revoke-reason]')
    .fill('CA010浏览器回归：撤销后重新选择');
  const revokeChoiceResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/cases/${source.caseId}/judgment-next-step-revoke`,
  );
  await oldChoicePanel.locator('[data-revoke-choice]').click();
  await oldChoicePanel.locator('[data-confirm-revoke]').click();
  await status(await revokeChoiceResponse, 201);
  await page.reload();
  await chooseAppeal(page, source.caseId);
  const currentBeforeProgress = await getInternalDetail(page, source.caseId);
  const currentChoiceId = currentBeforeProgress.judgmentNextStep.current!.id;
  expect(currentChoiceId).not.toBe(firstChoiceId);

  await expect(panel).toBeVisible();
  const uploadName = 'CA010-丢失响应后恢复的普通文书.pdf';
  let didDropResponse = false;
  await page.route(
    (url) =>
      url.pathname.includes('/api/v1/materials/upload-drafts/') &&
      url.pathname.endsWith('/content'),
    async (route) => {
      if (didDropResponse || route.request().method() !== 'PUT') {
        await route.continue();
        return;
      }
      const realResponse = await route.fetch();
      expect(realResponse.ok()).toBe(true);
      didDropResponse = true;
      await route.abort('failed');
    },
  );
  await panel
    .locator('[data-test="second-instance-document-upload"]')
    .setInputFiles({
      name: uploadName,
      mimeType: 'application/pdf',
      buffer: progressPdf,
    });
  await expect(panel.getByRole('alert')).toContainText('上传结果未知');
  await expect(
    panel.locator('[data-test="second-instance-progress-save"]'),
  ).toBeDisabled();
  await panel.locator('[data-test="second-instance-recovery-refresh"]').click();
  const recoveryRow = panel.locator('li').filter({ hasText: uploadName });
  await expect(recoveryRow).toHaveCount(1);
  const recoveredVersionId = await exactUploadedVersionId(
    page,
    source.caseId,
    'SECOND_INSTANCE_DOCUMENT',
    uploadName,
  );
  const adopt = recoveryRow.locator(
    '[data-test="second-instance-recovery-adopt"]',
  );
  await expect(adopt).toBeDisabled();
  expect(
    await browserDownloadBytes(page, () =>
      recoveryRow
        .locator('[data-test="second-instance-recovery-download"]')
        .click(),
    ),
  ).toEqual(progressPdf);
  await expect(adopt).toBeEnabled();
  await adopt.click();
  await expect(panel.getByRole('status')).toContainText('已人工核对并选用');
  await page.unrouteAll({ behavior: 'wait' });

  const progress = panel.locator('[data-test="second-instance-progress-form"]');
  const serviceName = 'CA010-送达文书.pdf';
  await uploadInBrowserAndWaitForSelectableVersion(
    page,
    panel.locator('[data-test="second-instance-service-upload"]'),
    panel,
    { name: serviceName, mimeType: 'application/pdf', buffer: servicePdf },
  );
  const serviceVersionId = await exactUploadedVersionId(
    page,
    source.caseId,
    'SECOND_INSTANCE_SERVICE',
    serviceName,
  );
  await progress
    .locator('[data-test="second-instance-hearing-at"]')
    .fill(todayShanghai());
  await progress.getByLabel('开庭地点').fill('二审法院第一法庭');
  await progress.getByLabel('法官').fill('李法官');
  await progress
    .locator('label')
    .filter({ hasText: uploadName })
    .locator('input[type="checkbox"]')
    .check();
  await progress
    .locator('label')
    .filter({ hasText: serviceName })
    .locator('input[type="checkbox"]')
    .check();
  const saveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/cases/${source.caseId}/second-instance-save`,
  );
  await progress.locator('[data-test="second-instance-progress-save"]').click();
  await status(await saveResponse, 201);
  const saved = await getInternalDetail(page, source.caseId);
  expect(saved.secondInstance.currentProgress).toMatchObject({
    trialRoundId: currentBeforeProgress.secondInstance.currentTrialRoundId,
    choiceId: currentChoiceId,
    hearingPlace: '二审法院第一法庭',
    judgeName: '李法官',
  });
  expect(
    saved.secondInstance.currentProgress!.documentFiles.map(
      (file) => file.contentVersionId,
    ),
  ).toContain(recoveredVersionId);
  expect(
    saved.secondInstance.currentProgress!.serviceFiles.map(
      (file) => file.contentVersionId,
    ),
  ).toContain(serviceVersionId);
  expect(saved.secondInstance.currentProgress!.choiceId).not.toBe(
    firstChoiceId,
  );
  expect(saved.stage).toBe('SECOND_INSTANCE');
  await page.reload();
  await expect(panel).toContainText(uploadName);
  await expect(panel).toContainText(serviceName);
  await expect(panel).toContainText('二审法院第一法庭');
  const currentRound = saved.secondInstance.currentTrialRoundId!;
  const sequence = saved.secondInstance.rounds.find(
    (round) => round.id === currentRound,
  )!.sequence;
  const recoveredDocumentButton = panel
    .locator(`[data-test="second-instance-round-${sequence}"]`)
    .getByRole('button', { name: `${uploadName}（下载）` });
  expect(
    await browserDownloadBytes(page, () => recoveredDocumentButton.click()),
  ).toEqual(progressPdf);
  const serviceButton = panel
    .locator(`[data-test="second-instance-round-${sequence}"]`)
    .getByRole('button', { name: `${serviceName}（下载）` });
  expect(await browserDownloadBytes(page, () => serviceButton.click())).toEqual(
    servicePdf,
  );

  await logout(page);
  await login(
    page,
    '/cases',
    coreLeadFixtures.selfUsername,
    coreLeadFixtures.selfPassword,
  );
  await page.goto(`/cases/${source.caseId}`);
  const readOnlyPanel = page.locator('[data-test="second-instance-panel"]');
  await expect(
    readOnlyPanel.locator('[data-test="second-instance-progress-form"]'),
  ).toHaveCount(0);
  await expect(
    readOnlyPanel.locator('[data-test="second-instance-result-form"]'),
  ).toHaveCount(0);
  await expect(
    readOnlyPanel.locator('[data-test="second-instance-revoke-section"]'),
  ).toHaveCount(0);
  const readOnlyFile = readOnlyPanel
    .locator(`[data-test="second-instance-round-${sequence}"]`)
    .getByRole('button', { name: `${uploadName}（下载）` });
  expect(await browserDownloadBytes(page, () => readOnlyFile.click())).toEqual(
    progressPdf,
  );
  await logout(page);
  await login(
    page,
    '/cases',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await page.goto(`/cases/${source.caseId}`);

  const resultName = 'CA010-改判文书.pdf';
  await uploadInBrowserAndWaitForSelectableVersion(
    page,
    panel.locator('[data-test="second-instance-judgment-upload"]'),
    panel,
    { name: resultName, mimeType: 'application/pdf', buffer: resultPdf },
  );
  const resultVersionId = await exactUploadedVersionId(
    page,
    source.caseId,
    'SECOND_INSTANCE_JUDGMENT',
    resultName,
  );
  const result = panel.locator('[data-test="second-instance-result-form"]');
  await result
    .locator('[data-test="second-instance-result-option"][value="CHANGE"]')
    .check();
  await result
    .locator('[data-test="second-instance-received-at"]')
    .fill(todayShanghai());
  await result
    .locator('[data-test="second-instance-fee-state"][value="PENDING"]')
    .check();
  await result
    .locator('input[name="changed-amount-state"][value="KNOWN"]')
    .check();
  await result.getByLabel('改判金额').fill('0.00');
  await result
    .locator('label')
    .filter({ hasText: resultName })
    .locator('[data-test="second-instance-result-file-choice"]')
    .check();
  await result.locator('[data-test="second-instance-result-submit"]').click();
  const resultResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/cases/${source.caseId}/second-instance-result`,
  );
  await panel.locator('[data-test="second-instance-confirm-result"]').click();
  await status(await resultResponse, 201);
  const afterResult = await getInternalDetail(page, source.caseId);
  expect(afterResult.stage).toBe('WAITING_EXECUTION_DOCUMENTS');
  expect(afterResult.secondInstance.currentResult).toMatchObject({
    result: 'CHANGE',
    trialRoundId: currentBeforeProgress.secondInstance.currentTrialRoundId,
    choiceId: currentChoiceId,
    judgmentAmountState: 'KNOWN',
    judgmentAmount: '0.00',
    paidLitigationFeeState: 'PENDING',
    paidLitigationFee: null,
  });
  expect(
    afterResult.secondInstance.currentResult!.files.map(
      (file) => file.originalFilename,
    ),
  ).toContain(resultName);
  expect(
    afterResult.secondInstance.currentResult!.files.map(
      (file) => file.contentVersionId,
    ),
  ).toContain(resultVersionId);
  const resultRoundSequence = afterResult.secondInstance.rounds.find(
    (round) =>
      round.id === afterResult.secondInstance.currentResult!.trialRoundId,
  )!.sequence;
  const resultButton = panel
    .locator(`[data-test="second-instance-round-${resultRoundSequence}"]`)
    .getByRole('button', { name: `${resultName}（下载）` });
  expect(await browserDownloadBytes(page, () => resultButton.click())).toEqual(
    resultPdf,
  );
  await page.reload();
  await expect(panel).toContainText('改判');
  await logout(page);
  await login(
    page,
    '/cases',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  await page.goto(`/cases/${source.caseId}`);
  await expect(
    page.locator('[data-test="second-instance-panel"]'),
  ).toContainText(resultName);
});

test('operator revokes only an exact empty REMAND child and completes a distinct same-case round', async ({
  page,
  request,
}) => {
  const source = await prepareAppealCase(page, request);
  const caseId = source.caseId;
  const panel = page.locator('[data-test="second-instance-panel"]');
  const submitRemand = async (filename: string) => {
    await uploadInBrowserAndWaitForSelectableVersion(
      page,
      panel.locator('[data-test="second-instance-judgment-upload"]'),
      panel,
      { name: filename, mimeType: 'application/pdf', buffer: resultPdf },
    );
    const resultVersionId = await exactUploadedVersionId(
      page,
      source.caseId,
      'SECOND_INSTANCE_JUDGMENT',
      filename,
    );
    const form = panel.locator('[data-test="second-instance-result-form"]');
    await form
      .locator('[data-test="second-instance-result-option"][value="REMAND"]')
      .check();
    await form
      .locator('[data-test="second-instance-received-at"]')
      .fill(source.businessDate);
    await form
      .locator('[data-test="second-instance-fee-state"][value="PENDING"]')
      .check();
    await form
      .locator('label')
      .filter({ hasText: filename })
      .locator('[data-test="second-instance-result-file-choice"]')
      .check();
    await form.locator('[data-test="second-instance-result-submit"]').click();
    const responsePromise = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === 'POST' &&
        new URL(candidate.url()).pathname ===
          `/api/v1/cases/${caseId}/second-instance-result`,
    );
    await panel.locator('[data-test="second-instance-confirm-result"]').click();
    await status(await responsePromise, 201);
    return resultVersionId;
  };
  const firstRemandFilename = 'CA010-第一次发回文书.pdf';
  const firstRemandVersionId = await submitRemand(firstRemandFilename);
  await page.reload();
  const remanded = await getInternalDetail(page, caseId);
  expect(remanded.stage).toBe('WAITING_FORMAL_ACCEPTANCE');
  expect(remanded.id).toBe(caseId);
  expect(remanded.acceptance).toBeNull();
  expect(remanded.courtCaseNo).toBeNull();
  const canceledChildId = remanded.secondInstance.currentTrialRoundId!;
  const sourceRound = remanded.secondInstance.rounds.find(
    (round) => round.id !== canceledChildId,
  )!;
  expect(remanded.secondInstance.currentResult).toMatchObject({
    result: 'REMAND',
    childTrialRoundId: canceledChildId,
  });
  expect(
    remanded.secondInstance.currentResult!.files.map(
      (file) => file.contentVersionId,
    ),
  ).toContain(firstRemandVersionId);
  await expect(
    panel.locator(
      `[data-test="second-instance-round-${sourceRound.sequence}"]`,
    ),
  ).toContainText(source.firstJudgmentFile);
  const sourceResultButton = panel
    .locator(`[data-test="second-instance-round-${sourceRound.sequence}"]`)
    .getByRole('button', { name: `${firstRemandFilename}（下载）` });
  await expect(sourceResultButton).toBeVisible();
  expect(
    await browserDownloadBytes(page, () => sourceResultButton.click()),
  ).toEqual(resultPdf);
  const oldAcceptanceButton = panel
    .locator(`[data-test="second-instance-round-${sourceRound.sequence}"]`)
    .getByRole('button', {
      name: `${source.acceptanceFile.originalFilename}（下载）`,
    });
  expect(
    await browserDownloadBytes(page, () => oldAcceptanceButton.click()),
  ).toEqual(sourcePdf);

  const revokeSection = panel.locator(
    '[data-test="second-instance-revoke-section"]',
  );
  await revokeSection
    .locator('textarea')
    .fill('发回子轮次尚未受理，撤销后重登记');
  await revokeSection.locator('input[type="checkbox"]').check();
  await revokeSection.locator('[data-test="second-instance-revoke"]').click();
  const revokeResponse = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === 'POST' &&
      new URL(candidate.url()).pathname ===
        `/api/v1/cases/${caseId}/second-instance-result-revoke`,
  );
  await panel.locator('[data-test="second-instance-confirm-revoke"]').click();
  await status(await revokeResponse, 201);
  const revoked = await getInternalDetail(page, caseId);
  expect(revoked.stage).toBe('SECOND_INSTANCE');
  expect(
    revoked.secondInstance.rounds.find((round) => round.id === canceledChildId)
      ?.revokedAt,
  ).not.toBeNull();
  expect(revoked.secondInstance.revocations).toHaveLength(1);
  expect(revoked.secondInstance.results).toHaveLength(1);

  const secondRemandFilename = 'CA010-第二次发回文书.pdf';
  const secondRemandVersionId = await submitRemand(secondRemandFilename);
  const secondRemand = await getInternalDetail(page, caseId);
  const newChildId = secondRemand.secondInstance.currentTrialRoundId!;
  expect(
    secondRemand.secondInstance.currentResult!.files.map(
      (file) => file.contentVersionId,
    ),
  ).toContain(secondRemandVersionId);
  expect(newChildId).not.toBe(canceledChildId);
  expect(
    secondRemand.secondInstance.rounds.find((round) => round.id === newChildId)
      ?.sequence,
  ).toBeGreaterThan(
    secondRemand.secondInstance.rounds.find(
      (round) => round.id === canceledChildId,
    )!.sequence,
  );

  await page.goto(`/cases/${caseId}`);
  const acceptancePanel = page.locator('[data-test="case-acceptance-panel"]');
  await expect(acceptancePanel).toBeVisible();
  const acceptanceFilename = 'CA010-发回后重新受理通知书.pdf';
  await uploadInBrowserAndWaitForSelectableVersion(
    page,
    acceptancePanel.locator(
      '[data-test="acceptance-material-input-ACCEPTANCE_NOTICE"]',
    ),
    acceptancePanel,
    {
      name: acceptanceFilename,
      mimeType: 'application/pdf',
      buffer: sourcePdf,
    },
  );
  const acceptanceVersionId = await exactUploadedVersionId(
    page,
    caseId,
    'ACCEPTANCE_NOTICE',
    acceptanceFilename,
  );
  await acceptancePanel
    .locator('label')
    .filter({ hasText: acceptanceFilename })
    .locator('input[type="checkbox"]')
    .check();
  await acceptancePanel
    .locator('[data-test="acceptance-accepted-at"]')
    .fill(source.businessDate);
  const newCourtCaseNo = `（2026）甲0101民初${randomUUID().slice(0, 6)}号`;
  await acceptancePanel
    .locator('[data-test="acceptance-court-case-no"]')
    .fill(newCourtCaseNo);
  const acceptanceResponse = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === 'POST' &&
      new URL(candidate.url()).pathname ===
        `/api/v1/cases/${caseId}/acceptance-register`,
  );
  await acceptancePanel.getByRole('button', { name: '登记正式立案' }).click();
  await status(await acceptanceResponse, 201);
  const reaccepted = await getInternalDetail(page, caseId);
  expect(reaccepted).toMatchObject({
    stage: 'WAITING_HEARING',
    courtCaseNo: newCourtCaseNo,
    acceptance: { courtCaseNo: newCourtCaseNo },
  });
  expect(reaccepted.secondInstance.currentTrialRoundId).toBe(newChildId);
  expect(
    reaccepted.acceptances
      .find((acceptance) => acceptance.trialRoundId === newChildId)
      ?.files.map((file) => file.contentVersionId),
  ).toContain(acceptanceVersionId);
  const newRoundSequence = secondRemand.secondInstance.rounds.find(
    (round) => round.id === newChildId,
  )!.sequence;
  const newAcceptanceButton = panel
    .locator(`[data-test="second-instance-round-${newRoundSequence}"]`)
    .getByRole('button', { name: `${acceptanceFilename}（下载）` });
  expect(
    await browserDownloadBytes(page, () => newAcceptanceButton.click()),
  ).toEqual(sourcePdf);

  await logout(page);
  await scheduleHearingAsLawyer(
    page,
    caseId,
    source.lawyer,
    source.businessDate,
  );
  await login(
    page,
    '/cases',
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
  );
  const secondJudgmentFilename = await registerFirstJudgment(
    page,
    caseId,
    todayShanghai(),
    'PENDING',
  );
  const secondJudgmentVersionId = await exactUploadedVersionId(
    page,
    caseId,
    'JUDGMENT',
    secondJudgmentFilename,
  );
  const registeredSecondJudgment = await getInternalDetail(page, caseId);
  expect(
    registeredSecondJudgment.judgment.current?.files.map(
      (file) => file.contentVersionId,
    ),
  ).toContain(secondJudgmentVersionId);
  const currentJudgment = page.locator(
    '[data-test="case-judgment-panel"] [data-test="judgment-current"]',
  );
  const currentJudgmentFile = currentJudgment
    .locator('li')
    .filter({ hasText: secondJudgmentFilename });
  await expect(currentJudgmentFile).toBeVisible();
  expect(
    await browserDownloadBytes(page, () =>
      currentJudgmentFile.getByRole('button', { name: '下载判决书' }).click(),
    ),
  ).toEqual(sourcePdf);
  const newChoice = await chooseAppeal(page, caseId);
  const chosenSecondJudgment = await getInternalDetail(page, caseId);
  expect(
    chosenSecondJudgment.judgment.current?.files.map(
      (file) => file.contentVersionId,
    ),
  ).toContain(secondJudgmentVersionId);
  const round2Panel = page.locator('[data-test="second-instance-panel"]');
  await round2Panel
    .locator('[data-test="second-instance-hearing-at"]')
    .fill(todayShanghai());
  await round2Panel
    .locator('[data-test="second-instance-hearing-at"]')
    .press('Tab');
  const saveResponse = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === 'POST' &&
      new URL(candidate.url()).pathname ===
        `/api/v1/cases/${caseId}/second-instance-save`,
  );
  await round2Panel
    .locator('[data-test="second-instance-progress-save"]')
    .click();
  await status(await saveResponse, 201);
  const progressed = await getInternalDetail(page, caseId);
  expect(progressed.secondInstance.currentProgress?.trialRoundId).toBe(
    newChildId,
  );
  expect(progressed.secondInstance.currentProgress?.choiceId).toBe(
    newChoice.judgmentNextStep.current?.id,
  );
  expect(progressed.secondInstance.currentProgress?.choiceId).not.toBe(
    source.initialChoiceId,
  );
  await page.reload();
  await expect(
    round2Panel.locator(
      `[data-test="second-instance-round-${sourceRound.sequence}"]`,
    ),
  ).toContainText(firstRemandFilename);
  await expect(round2Panel).toContainText(secondJudgmentFilename);
  const oldRemandResultButton = round2Panel
    .locator(`[data-test="second-instance-round-${sourceRound.sequence}"]`)
    .getByRole('button', { name: `${firstRemandFilename}（下载）` });
  expect(
    await browserDownloadBytes(page, () => oldRemandResultButton.click()),
  ).toEqual(resultPdf);
  const oldAcceptanceAfterRoundTrip = round2Panel
    .locator(`[data-test="second-instance-round-${sourceRound.sequence}"]`)
    .getByRole('button', {
      name: `${source.acceptanceFile.originalFilename}（下载）`,
    });
  expect(
    await browserDownloadBytes(page, () => oldAcceptanceAfterRoundTrip.click()),
  ).toEqual(sourcePdf);
  const oldJudgmentButton = round2Panel
    .locator(`[data-test="second-instance-round-${sourceRound.sequence}"]`)
    .getByRole('button', { name: `${source.firstJudgmentFile}（下载）` });
  expect(
    await browserDownloadBytes(page, () => oldJudgmentButton.click()),
  ).toEqual(sourcePdf);
});

test('current PRIMARY lawyer can register CHANGE and AFFIRM while client projection stays restricted', async ({
  page,
  request,
  browser,
}) => {
  const source = await prepareAppealCase(page, request, {
    submitAsLawyer: true,
    firstJudgmentAmount: 'KNOWN',
  });
  await logout(page);
  await login(
    page,
    '/lawyer/cases',
    source.lawyer.username,
    source.lawyer.password,
  );
  await page.goto(`/lawyer/cases/${source.caseId}`);
  const lawyerPanel = page.locator('[data-test="second-instance-panel"]');
  await expect(lawyerPanel).toBeVisible();
  await expect(
    lawyerPanel.locator('[data-test="second-instance-revoke"]'),
  ).toHaveCount(0);

  await uploadInBrowserAndWaitForSelectableVersion(
    page,
    lawyerPanel.locator('[data-test="second-instance-document-upload"]'),
    lawyerPanel,
    {
      name: 'CA010律师进展材料.pdf',
      mimeType: 'application/pdf',
      buffer: progressPdf,
    },
  );
  const lawyerProgressVersionId = await exactUploadedVersionId(
    page,
    source.caseId,
    'SECOND_INSTANCE_DOCUMENT',
    'CA010律师进展材料.pdf',
  );
  await lawyerPanel
    .locator('form[data-test="second-instance-progress-form"] label')
    .filter({ hasText: 'CA010律师进展材料.pdf' })
    .locator('input[type="checkbox"]')
    .check();
  const lawyerServiceName = 'CA010律师送达材料.pdf';
  await uploadInBrowserAndWaitForSelectableVersion(
    page,
    lawyerPanel.locator('[data-test="second-instance-service-upload"]'),
    lawyerPanel,
    {
      name: lawyerServiceName,
      mimeType: 'application/pdf',
      buffer: servicePdf,
    },
  );
  const lawyerServiceVersionId = await exactUploadedVersionId(
    page,
    source.caseId,
    'SECOND_INSTANCE_SERVICE',
    lawyerServiceName,
  );
  await lawyerPanel
    .locator('form[data-test="second-instance-progress-form"] label')
    .filter({ hasText: lawyerServiceName })
    .locator('input[type="checkbox"]')
    .check();
  const lawyerProgressResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/lawyer/cases/${source.caseId}/second-instance-save`,
  );
  await lawyerPanel
    .locator('[data-test="second-instance-progress-save"]')
    .click();
  await status(await lawyerProgressResponse, 201);
  const savedLawyerDetailResponse = await page.request.get(
    `/api/v1/lawyer/cases/${source.caseId}`,
  );
  await status(savedLawyerDetailResponse, 200);
  const savedLawyerDetail = (await savedLawyerDetailResponse.json()) as {
    secondInstance: {
      currentProgress: null | {
        documentFiles: Array<{ contentVersionId: string }>;
        serviceFiles: Array<{ contentVersionId: string }>;
      };
    };
  };
  expect(
    savedLawyerDetail.secondInstance.currentProgress?.documentFiles.map(
      (file) => file.contentVersionId,
    ),
  ).toContain(lawyerProgressVersionId);
  expect(
    savedLawyerDetail.secondInstance.currentProgress?.serviceFiles.map(
      (file) => file.contentVersionId,
    ),
  ).toContain(lawyerServiceVersionId);
  await expect(lawyerPanel).toContainText('CA010律师进展材料.pdf');
  const lawyerProgressButton = lawyerPanel.getByRole('button', {
    name: 'CA010律师进展材料.pdf（下载）',
  });
  expect(
    await browserDownloadBytes(page, () => lawyerProgressButton.click()),
  ).toEqual(progressPdf);
  const lawyerServiceButton = lawyerPanel.getByRole('button', {
    name: `${lawyerServiceName}（下载）`,
  });
  expect(
    await browserDownloadBytes(page, () => lawyerServiceButton.click()),
  ).toEqual(servicePdf);
  await page.reload();

  await uploadInBrowserAndWaitForSelectableVersion(
    page,
    lawyerPanel.locator('[data-test="second-instance-judgment-upload"]'),
    lawyerPanel,
    {
      name: 'CA010律师改判文书.pdf',
      mimeType: 'application/pdf',
      buffer: resultPdf,
    },
  );
  const lawyerResultVersionId = await exactUploadedVersionId(
    page,
    source.caseId,
    'SECOND_INSTANCE_JUDGMENT',
    'CA010律师改判文书.pdf',
  );
  const lawyerResult = lawyerPanel.locator(
    '[data-test="second-instance-result-form"]',
  );
  await lawyerResult
    .locator('[data-test="second-instance-result-option"][value="CHANGE"]')
    .check();
  await lawyerResult
    .locator('[data-test="second-instance-received-at"]')
    .fill(todayShanghai());
  await lawyerResult
    .locator('[data-test="second-instance-fee-state"][value="KNOWN"]')
    .check();
  await lawyerResult.getByLabel('诉讼费金额').fill('0.00');
  await lawyerResult
    .locator('input[name="changed-amount-state"][value="PENDING"]')
    .check();
  await lawyerResult
    .locator('label')
    .filter({ hasText: 'CA010律师改判文书.pdf' })
    .locator('[data-test="second-instance-result-file-choice"]')
    .check();
  await lawyerResult
    .locator('[data-test="second-instance-result-submit"]')
    .click();
  const changeResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/lawyer/cases/${source.caseId}/second-instance-result`,
  );
  await lawyerPanel
    .locator('[data-test="second-instance-confirm-result"]')
    .click();
  await status(await changeResponse, 201);
  const lawyerDetailResponse = await page.request.get(
    `/api/v1/lawyer/cases/${source.caseId}`,
  );
  await status(lawyerDetailResponse, 200);
  const lawyerDetail = (await lawyerDetailResponse.json()) as {
    judgmentNextStep: { current: { id: string } | null };
    secondInstance: {
      currentResult: {
        choiceId: string;
        files: Array<{ contentVersionId: string }>;
      } | null;
    };
  };
  expect(lawyerDetail.secondInstance.currentResult?.choiceId).toBe(
    lawyerDetail.judgmentNextStep.current?.id,
  );
  expect(
    lawyerDetail.secondInstance.currentResult?.files.map(
      (file) => file.contentVersionId,
    ),
  ).toContain(lawyerResultVersionId);
  await page.reload();
  await expect(lawyerPanel).toContainText('待确认');
  await logout(page);
  await login(
    page,
    '/lawyer/cases',
    source.lawyer.username,
    source.lawyer.password,
  );
  await page.goto(`/lawyer/cases/${source.caseId}`);
  const persistedLawyerPanel = page.locator(
    '[data-test="second-instance-panel"]',
  );
  await expect(persistedLawyerPanel).toContainText('CA010律师改判文书.pdf');
  const lawyerResultButton = persistedLawyerPanel.getByRole('button', {
    name: 'CA010律师改判文书.pdf（下载）',
  });
  expect(
    await browserDownloadBytes(page, () => lawyerResultButton.click()),
  ).toEqual(resultPdf);

  const client = await browser.newContext({ baseURL: origin });
  try {
    const clientPage = await client.newPage();
    await login(
      clientPage,
      '/client/leads',
      source.clientSession.user.username,
      'client correct horse battery',
    );
    await clientPage.goto(`/client/cases/${source.caseId}`);
    await expect(clientPage.locator('.page-head .pill')).toContainText(
      '待写执行材料',
    );
    await expect(
      clientPage.locator('[data-test="second-instance-panel"]'),
    ).toHaveCount(0);
    await expect(
      clientPage.getByText('CA010律师改判文书.pdf', { exact: true }),
    ).toHaveCount(0);
    await expect(clientPage.getByText('诉讼费', { exact: false })).toHaveCount(
      0,
    );
  } finally {
    await client.close();
  }
});

for (const amountState of ['KNOWN', 'PENDING'] as const) {
  test(`current PRIMARY lawyer AFFIRM freezes the ${amountState.toLowerCase()} source-round judgment amount`, async ({
    page,
    request,
  }) => {
    const source = await prepareAppealCase(page, request, {
      submitAsLawyer: true,
      firstJudgmentAmount: amountState,
    });
    await logout(page);
    await login(
      page,
      '/lawyer/cases',
      source.lawyer.username,
      source.lawyer.password,
    );
    await page.goto(`/lawyer/cases/${source.caseId}`);
    const panel = page.locator('[data-test="second-instance-panel"]');
    await expect(panel).toBeVisible();
    const filename = `CA010律师维持原判-${amountState}.pdf`;
    await uploadInBrowserAndWaitForSelectableVersion(
      page,
      panel.locator('[data-test="second-instance-judgment-upload"]'),
      panel,
      { name: filename, mimeType: 'application/pdf', buffer: resultPdf },
    );
    const affirmVersionId = await exactUploadedVersionId(
      page,
      source.caseId,
      'SECOND_INSTANCE_JUDGMENT',
      filename,
    );
    const form = panel.locator('[data-test="second-instance-result-form"]');
    await form
      .locator('[data-test="second-instance-result-option"][value="AFFIRM"]')
      .check();
    await expect(form).toContainText(
      amountState === 'KNOWN'
        ? '维持原判金额（只读）：¥ 88.00'
        : '维持原判金额（只读）：待确认',
    );
    await expect(
      form.locator('input[name="changed-amount-state"]'),
    ).toHaveCount(0);
    await form
      .locator('[data-test="second-instance-received-at"]')
      .fill(todayShanghai());
    await form
      .locator('[data-test="second-instance-fee-state"][value="PENDING"]')
      .check();
    await form
      .locator('label')
      .filter({ hasText: filename })
      .locator('[data-test="second-instance-result-file-choice"]')
      .check();
    await form.locator('[data-test="second-instance-result-submit"]').click();
    const resultResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname ===
          `/api/v1/lawyer/cases/${source.caseId}/second-instance-result`,
    );
    await panel.locator('[data-test="second-instance-confirm-result"]').click();
    await status(await resultResponse, 201);
    const detailResponse = await page.request.get(
      `/api/v1/lawyer/cases/${source.caseId}`,
    );
    await status(detailResponse, 200);
    const detail = (await detailResponse.json()) as {
      secondInstance: {
        currentResult: null | {
          result: string;
          judgmentAmountState: string | null;
          judgmentAmount: string | null;
          paidLitigationFeeState: string;
          paidLitigationFee: string | null;
          files: Array<{ originalFilename: string; contentVersionId: string }>;
        };
      };
    };
    expect(detail.secondInstance.currentResult).toMatchObject({
      result: 'AFFIRM',
      judgmentAmountState: amountState,
      judgmentAmount: amountState === 'KNOWN' ? '88.00' : null,
      paidLitigationFeeState: 'PENDING',
      paidLitigationFee: null,
    });
    expect(
      detail.secondInstance.currentResult!.files.map(
        (file) => file.originalFilename,
      ),
    ).toContain(filename);
    expect(
      detail.secondInstance.currentResult!.files.map(
        (file) => file.contentVersionId,
      ),
    ).toContain(affirmVersionId);
    await page.reload();
    await expect(panel).toContainText(filename);
    const resultButton = panel.getByRole('button', {
      name: `${filename}（下载）`,
    });
    expect(
      await browserDownloadBytes(page, () => resultButton.click()),
    ).toEqual(resultPdf);
    await logout(page);
  });
}
