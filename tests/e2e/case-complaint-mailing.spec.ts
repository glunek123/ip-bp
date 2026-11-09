import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  coreLeadFixtures,
  resetCoreLeadE2eData,
} from '../support/core-lead-database.mjs';
import { createSubmittedCaseThroughApi } from '../support/case-complaint-confirmation-database.mjs';
import {
  allowOtherEnterpriseAccountSetup,
  clearCaseComplaintMailingFixture,
  prepareCaseComplaintMailingFixture,
} from '../support/case-complaint-mailing-database.mjs';
import {
  closeCaseWorkspaceDrawer,
  openCaseWorkspaceCommand,
} from '../support/case-workspace-browser';

async function loginWithPassword(
  page: Page,
  username: string,
  password: string,
  expectedPath: string,
) {
  await page.goto(expectedPath);
  await expect(page).toHaveURL(/\/login\?returnTo=/u);
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(expectedPath);
}
async function createClientAccount(
  request: import('@playwright/test').APIRequestContext,
  customerId: string,
  username: string,
  password: string,
) {
  const login = await request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://127.0.0.1:5174' },
    data: {
      username: coreLeadFixtures.operatorUsername,
      password: coreLeadFixtures.operatorPassword,
    },
  });
  expect(login.status()).toBe(200);
  const session = (await login.json()) as { csrfToken: string };
  const created = await request.post(
    `/api/v1/customers/${customerId}/client-accounts`,
    {
      headers: { 'X-CSRF-Token': session.csrfToken },
      data: { displayName: 'CA-004浏览器客户', username, password },
    },
  );
  expect(created.status()).toBe(201);
}
test.beforeEach(async () => {
  await resetCoreLeadE2eData();
  await prepareCaseComplaintMailingFixture();
});
test.afterEach(async () => {
  await clearCaseComplaintMailingFixture();
});

test('operator confirms and mails with date and remark while preserving an empty receipt list', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const seeded = await createSubmittedCaseThroughApi(request);
  await loginWithPassword(
    page,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
    '/cases',
  );
  await page.goto(`/cases/${seeded.caseId}`);
  await page.locator('[data-test="workspace-primary-action"]').click();
  await expect(page.locator('[data-test="confirmation-form"]')).toBeVisible();
  await expect(page.locator('[data-test="confirmation-amount"]')).toHaveValue(
    /\d/u,
  );
  await page.locator('[data-test="confirmation-submit"]').click();
  await expect(page.locator('.detail-actions .pill')).toHaveText('诉状待盖章');
  await closeCaseWorkspaceDrawer(page);
  await openCaseWorkspaceCommand(
    page,
    'mail-complaint',
    '[data-test="complaint-mailing-panel"]',
  );
  const panel = page.locator('[data-test="complaint-mailing-panel"]');
  await panel.locator('[data-test="complaint-mail-remark"]').fill('按约定邮寄');
  await expect(panel.locator('input[type="file"]')).toHaveCount(0);
  await panel.getByRole('button', { name: '核对邮寄信息' }).click();
  await page.screenshot({
    path: '.local/case-workflow-acceptance/complaint-mailing.png',
  });
  await panel.locator('[data-test="mailing-submit"]').click();
  await expect(page.locator('.detail-actions .pill')).toHaveText('待提交立案');
  await page.reload();
  const detail = await page.request.get(`/api/v1/cases/${seeded.caseId}`);
  expect(detail.status(), await detail.text()).toBe(200);
  expect(await detail.json()).toMatchObject({
    stage: 'WAITING_FILING',
    complaintMailing: { remark: '按约定邮寄', receiptFiles: [] },
  });
});

test.use({ testIdAttribute: 'data-test' });

test('batch mailing applies the same date and remark to each selected case', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const first = await createSubmittedCaseThroughApi(request);
  const second = await createSubmittedCaseThroughApi(request);
  const caseIds = [first.caseId, second.caseId];
  await loginWithPassword(
    page,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
    '/cases',
  );
  for (const caseId of caseIds) {
    await page.goto(`/cases/${caseId}`);
    await page
      .locator('[data-test="workspace-primary-action"]')
      .click({ timeout: 10_000 });
    await expect(page.locator('[data-test="confirmation-form"]')).toBeVisible();
    await page
      .locator('[data-test="confirmation-submit"]')
      .click({ timeout: 10_000 });
    await expect(page.locator('.detail-actions .pill')).toHaveText(
      '诉状待盖章',
    );
  }
  await page.goto('/cases?view=mine&stage=WAITING_COMPLAINT_STAMP');
  for (const caseId of caseIds) {
    await page.getByTestId(`select-case-${caseId}`).check({ timeout: 10_000 });
  }
  await page.getByTestId('start-complaint-batch-mail-complaint').click();
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
  }).format(new Date());
  const remark = '同批诉状分别邮寄';
  await page.getByTestId('batch-mail-date').fill(date);
  await page.getByTestId('batch-mail-remark').fill(remark);
  for (const caseId of caseIds) {
    await page.getByTestId(`continue-complaint-batch-${caseId}`).click();
    await expect(page.getByTestId('complaint-mail-remark')).toHaveValue(remark);
    await page.getByRole('button', { name: '核对邮寄信息' }).click();
    await page.getByTestId('mailing-submit').click();
    await expect(
      page.getByTestId(`complaint-batch-entry-${caseId}`),
    ).toContainText('已成功');
  }
  await page.reload();
  for (const caseId of caseIds) {
    const detail = await page.request.get(`/api/v1/cases/${caseId}`);
    expect(detail.status(), await detail.text()).toBe(200);
    expect(await detail.json()).toMatchObject({
      stage: 'WAITING_FILING',
      complaintMailing: { mailedAt: date, remark, receiptFiles: [] },
    });
  }
});
test('real password sessions preserve downloads for a legacy mailing receipt after relogin', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const seeded = await createSubmittedCaseThroughApi(request);
  const username = `ca004-browser-${randomUUID().slice(0, 8)}`;
  const password = 'client mailing password 2026';
  const adminLogin = await request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://127.0.0.1:5174' },
    data: {
      username: coreLeadFixtures.operatorUsername,
      password: coreLeadFixtures.operatorPassword,
    },
  });
  expect(adminLogin.status()).toBe(200);
  const adminSession = (await adminLogin.json()) as { csrfToken: string };
  const created = await request.post(
    `/api/v1/customers/${coreLeadFixtures.admittedCustomer}/client-accounts`,
    {
      headers: { 'X-CSRF-Token': adminSession.csrfToken },
      data: { displayName: 'CA-004浏览器客户', username, password },
    },
  );
  expect(created.status()).toBe(201);

  await loginWithPassword(
    page,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
    '/cases',
  );
  await page.goto(`/cases/${seeded.caseId}`);
  await expect(page.locator('.detail-actions .pill')).toHaveText('诉状待确认');
  await page.locator('[data-test="workspace-primary-action"]').click();
  await expect(page.locator('[data-test="confirmation-form"]')).toBeVisible();
  await page.locator('[data-test="confirmation-submit"]').click();
  await expect(page.locator('.detail-actions .pill')).toHaveText('诉状待盖章');
  await closeCaseWorkspaceDrawer(page);
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(/\/login/u);

  await loginWithPassword(page, username, password, '/client/leads');
  await page.goto('/client/cases');
  await expect(
    page.locator(
      `[data-test="client-case-list"] a[href="/client/cases/${seeded.caseId}"]`,
    ),
  ).toHaveCount(1);
  await page.goto(`/client/cases/${seeded.caseId}`);
  const expectedBytes = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n',
  );
  const receiptBytes = Buffer.from('%PDF-1.4\n邮寄凭证\n%%EOF\n');
  for (const selector of [
    '[data-test="client-complaint-download"]',
    '[data-test="client-authorization-download"]',
  ]) {
    const ready = page.waitForEvent('download');
    await page.locator(selector).click();
    const download = await ready;
    const filePath = await download.path();
    expect(filePath).not.toBeNull();
    expect(await readFile(filePath!)).toEqual(expectedBytes);
  }
  const api = page.request;
  const casePath = `/api/v1/client/cases/${seeded.caseId}`;
  const session = await api.get('/api/v1/auth/session');
  expect(session.status()).toBe(200);
  const headers = {
    Origin: new URL(page.url()).origin,
    'X-CSRF-Token': (await session.json()).csrfToken as string,
  };
  const draft = await api.post('/api/v1/materials/upload-drafts', {
    headers,
    data: {
      ownerType: 'CASE',
      ownerId: seeded.caseId,
      category: 'MAIL_RECEIPT',
      purpose: 'MAIL_RECEIPT',
      originalFilename: '真实邮寄凭证.pdf',
      declaredMimeType: 'application/pdf',
    },
  });
  expect(draft.status(), await draft.text()).toBe(201);
  const stored = await api.put(
    `/api/v1/materials/upload-drafts/${(await draft.json()).id}/content`,
    {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: receiptBytes,
    },
  );
  expect(stored.status(), await stored.text()).toBe(200);
  const legacyMail = await api.post(`${casePath}/complaint-mail`, {
    headers,
    data: {
      expectedVersion: (await (await api.get(casePath)).json()).version,
      idempotencyKey: randomUUID(),
      mailedAt: new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
      }).format(new Date()),
      mailReceiptContentVersionIds: [(await stored.json()).contentVersionId],
    },
  });
  expect(legacyMail.status(), await legacyMail.text()).toBe(201);
  await page.reload();
  await expect(
    page.locator('[data-test="complaint-mailing-panel"]'),
  ).toContainText('真实邮寄凭证.pdf');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(/\/login/u);
  await loginWithPassword(page, username, password, '/client/leads');
  await page.goto(`/client/cases/${seeded.caseId}`);
  await expect(
    page.locator('[data-test="complaint-mailing-panel"]'),
  ).toContainText('邮寄日期');
  await expect(page.locator('[data-test="mailing-submit"]')).toHaveCount(0);
  const receiptDownload = page
    .locator('[data-test="complaint-mailing-panel"]')
    .getByRole('button', { name: '下载' });
  await expect(receiptDownload).toBeVisible();
  const receiptReady = page.waitForEvent('download');
  await receiptDownload.click();
  const receipt = await receiptReady;
  const receiptPath = await receipt.path();
  expect(receiptPath).not.toBeNull();
  expect(await readFile(receiptPath!)).toEqual(receiptBytes);
});

test('authorized operator can mail a case, same-department colleague stays read-only, and another enterprise cannot read it', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const seeded = await createSubmittedCaseThroughApi(request);
  const username = `ca004-foreign-${randomUUID().slice(0, 8)}`;
  const password = 'foreign client password 2026';
  await allowOtherEnterpriseAccountSetup();
  await createClientAccount(
    request,
    coreLeadFixtures.selfCustomer,
    username,
    password,
  );

  await loginWithPassword(
    page,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
    '/cases',
  );
  await page.goto(`/cases/${seeded.caseId}`);
  await page.locator('[data-test="workspace-primary-action"]').click();
  await expect(page.locator('[data-test="confirmation-form"]')).toBeVisible();
  await page.locator('[data-test="confirmation-submit"]').click();
  await expect(page.locator('.detail-actions .pill')).toHaveText('诉状待盖章');

  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(/\/login/u);
  await loginWithPassword(
    page,
    coreLeadFixtures.selfUsername,
    coreLeadFixtures.selfPassword,
    '/cases',
  );
  await page.goto(`/cases/${seeded.caseId}`);
  await expect(
    page.locator(
      '[data-test="complaint-mailing-panel"] [data-test="case-read-only"]',
    ),
  ).toContainText('可以查看案件和下载获准材料');
  await expect(
    page.locator('[data-test="complaint-mailing-panel"] input[type="file"]'),
  ).toHaveCount(0);
  await expect(page.locator('[data-test="mailing-submit"]')).toHaveCount(0);
  const complaintDownload = page
    .locator('[data-test="complaint-read-only"]')
    .getByRole('button', { name: '下载' })
    .first();
  const complaintReady = page.waitForEvent('download');
  await complaintDownload.click();
  const complaint = await complaintReady;
  const complaintPath = await complaint.path();
  expect(complaintPath).not.toBeNull();
  expect(await readFile(complaintPath!)).toEqual(
    Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n'),
  );

  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(/\/login/u);
  await loginWithPassword(
    page,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
    '/cases',
  );
  await page.goto(`/cases/${seeded.caseId}`);
  await expect(page.locator('.detail-actions .pill')).toHaveText('诉状待盖章');
  await page.locator('[data-test="workspace-primary-action"]').click();
  await page
    .locator('[data-test="complaint-mail-remark"]')
    .fill('运营登记邮寄');
  await page.getByRole('button', { name: '核对邮寄信息' }).click();
  await page.locator('[data-test="mailing-submit"]').click();
  await expect(page.locator('.detail-actions .pill')).toHaveText('待提交立案');
  await page.goto('/cases?view=department');
  const filingStageLink = page
    .locator('[data-test="case-stage"]')
    .filter({ hasText: '待提交立案' });
  await expect(filingStageLink).toBeVisible();
  await filingStageLink.click();
  await expect(page).toHaveURL(
    /\/cases\?view=department&stage=WAITING_FILING/u,
  );
  await expect(page.locator('.page-head')).toContainText('待提交立案');
  await expect(
    page.locator(`[data-test="case-list"] a[href^="/cases/${seeded.caseId}"]`),
  ).toHaveCount(1);
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(/\/login/u);

  await loginWithPassword(page, username, password, '/client/leads');
  await page.goto(`/client/cases/${seeded.caseId}`);
  await expect(
    page.getByRole('heading', { name: '案件不存在或已不可访问' }),
  ).toBeVisible();
});
