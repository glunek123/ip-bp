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

test('real password sessions read confirmed files, upload a receipt, mail the case and retain facts after relogin', async ({
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
  await expect(page.locator('.page-head .pill')).toHaveText('诉状待确认');
  await page.locator('[data-test^="complaint-version-"]').first().check();
  await page.locator('[data-test="confirm-disclose-false"]').check();
  await page.locator('[data-test="confirmation-review"]').click();
  await expect(page.getByRole('dialog')).toContainText('确认后进入诉状待盖章');
  await page.locator('[data-test="confirmation-submit"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('诉状待盖章');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();

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
  await page
    .locator('[data-test="complaint-mailing-panel"] input[type="file"]')
    .setInputFiles({
      name: '真实邮寄凭证.pdf',
      mimeType: 'application/pdf',
      buffer: receiptBytes,
    });
  await expect(page.locator('[data-test="mailing-submit"]')).toHaveCount(0);
  await page.getByRole('button', { name: '核对邮寄信息' }).click();
  await page.locator('[data-test="mailing-submit"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('待提交立案');
  await expect(
    page.locator('[data-test="complaint-mailing-panel"]'),
  ).toContainText('邮寄登记记录');
  await page.reload();
  await expect(page.locator('.page-head .pill')).toHaveText('待提交立案');
  await expect(
    page.locator('[data-test="complaint-mailing-panel"]'),
  ).toContainText('真实邮寄凭证.pdf');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await loginWithPassword(page, username, password, '/client/leads');
  await page.goto(`/client/cases/${seeded.caseId}`);
  await expect(
    page.locator('[data-test="complaint-mailing-panel"]'),
  ).toContainText('实际邮寄日');
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
  await page.locator('[data-test^="complaint-version-"]').first().check();
  await page.locator('[data-test="confirm-disclose-false"]').check();
  await page.locator('[data-test="confirmation-review"]').click();
  await page.locator('[data-test="confirmation-submit"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('诉状待盖章');

  await page.getByRole('button', { name: '退出登录', exact: true }).click();
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
  await loginWithPassword(
    page,
    coreLeadFixtures.operatorUsername,
    coreLeadFixtures.operatorPassword,
    '/cases',
  );
  await page.goto(`/cases/${seeded.caseId}`);
  await expect(page.locator('.page-head .pill')).toHaveText('诉状待盖章');
  await page
    .locator('[data-test="complaint-mailing-panel"] input[type="file"]')
    .setInputFiles({
      name: '运营邮寄凭证.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n运营邮寄凭证\n%%EOF\n'),
    });
  await page.getByRole('button', { name: '核对邮寄信息' }).click();
  await page.locator('[data-test="mailing-submit"]').click();
  await expect(page.locator('.page-head .pill')).toHaveText('待提交立案');
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

  await loginWithPassword(page, username, password, '/client/leads');
  await page.goto(`/client/cases/${seeded.caseId}`);
  await expect(
    page.getByRole('heading', { name: '案件不存在或已不可访问' }),
  ).toBeVisible();
});
